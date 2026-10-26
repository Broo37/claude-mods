// clawd-mods: Clawd above the prompt, living by the account's limits and
// sessions, and /clawd for the numbers. A port of clawd-usage-winwidget (MIT):
// https://github.com/Enhed/clawd-usage-winwidget
//
// Every open session loads its own copy. They share one probe cache per account
// (<config dir>/clawd-mods/), so `claude -p /usage` runs once for all of them,
// and the PC checks once for the whole machine (%LOCALAPPDATA%/clawd-mods/).

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { ClawdEvent, ClawdView, Control, LimitWindow, SessionRow, SessionStatus, Tip } from '../types'
import { ACTS } from './clawd'
import { type PaneHandlers, renderPane } from './pane'
import { type FastFacts, type PcState, type SlowFacts, fixPrompt, parseFast, parseSlow, tipsOf } from './pc'
import { background, machineDirOf, readJson, runShared, withLock } from './shared'
import { type Place, type SkyProps, type Weather, parseGeocode, parseIpWho, parseMetNo, parseOpenMeteo, solarTimes } from './sky'
import { type ServiceAlert, parseSummary } from './status'
import { type Sample, addSample, compact } from './history'
import { type ProjectShare, parseProjects } from './projects'
import { type Reminder, type Repeat, dueOf, fullStamp, latestAt, nextAt, parseWhen, setText, whenDue } from './remind'
import {
  type BuiltinFigures,
  type ProbeCache,
  type RegistryEntry,
  MINUTE,
  fromRateLimits,
  heartHalves,
  isProbeDue,
  isProbeEntry,
  mergeLimits,
  moodOf,
  parsePs,
  parseRegistryEntry,
  parseTasklist,
  parseUsage,
  rawSession,
  sortSessions,
} from './usage'

const PANE = 'clawd'
const view = atom({ plugin: 'clawd-mods', key: 'view' } as const, null)

const SCAN_MS = 3000 // sessions/<pid>.json
const LIMITS_MS = 15_000 // the shared cache, and a probe when one is due
const ALIVE_MS = 60_000 // which session processes still run
const BUILTIN_FRESH_MS = 90_000
const LOCK_MS = 45_000
const LOCK_SETTLE_MS = 400
const PROBE_TIMEOUT_MS = 30_000
const PROBE_ARGS = ['-p', '/usage', '--output-format', 'text', '--no-session-persistence', '--safe-mode']
const PC_MS = 15_000 // looks at the PC checks; each runs only when due
const PC_FAST_MS = 120_000 // memory and processes: at most one PowerShell a check, machine-wide
const PC_SLOW_MS = 1_800_000 // restart, startup list, apps
const PC_TIMEOUT_MS = 20_000
const DEFAULT_PLACE = { lat: -6.2, lon: 106.8 } // Jakarta, until the place is known
const PLACE_MS = 86_400_000 // where this PC is: once a day
const PLACE_RETRY_MS = 600_000 // ... but a failed lookup (no network yet) again in 10 minutes
const WEATHER_FRESH_MS = 3 * 3_600_000 // an older reading no longer rains on Clawd
const STATUS_STALE_MS = 600_000 // an unreachable status page this long: the ! comes down
const WEATHER_MS = 900_000 // the weather: every 15 minutes, machine-wide
const WEATHER_TICK_MS = 60_000
const FETCH_TIMEOUT_MS = 15_000
const USER_AGENT = 'clawd-mods (a personal Claude Code mod)'
const STATUS_URL = 'https://status.claude.com/api/v2/summary.json'
const STATUS_MS = 120_000 // Claude's status page, machine-wide
const STATUS_TICK_MS = 30_000
const PROJECTS_MS = 3_600_000 // top projects: once an hour, per account
const PROJECTS_RETRY_MS = 900_000
const PROJECTS_TICK_MS = 300_000
const PROJECTS_TIMEOUT_MS = 120_000
const WEEK_MS = 7 * 86_400_000
const REMIND_MS = 15_000 // looks for due reminders
const LATE_MS = 5 * MINUTE // rung later than this after its time: it fell due while no session was open
const REPEATS: readonly Repeat[] = ['daily', 'weekly', 'monthly', 'yearly']

type Ctx = {
  configDir: string
  /** Per account: <config dir>/clawd-mods. */
  dir: string
  oldDir: string
  /** Facts about this PC, shared by every account (%LOCALAPPDATA%/clawd-mods). */
  machineDir: string
  sessionsDir: string
  me: string
  isWindows: boolean
}
type Lock = { owner: string; at: number }
type Alive = { at: number; pids: number[] }
type Entry = RegistryEntry & { mtimeMs: number }
/** pc-state.json: the person's answers about this PC, shared by every account. */
type PcFile = { knownStartup: string[] | null; snoozes: Record<string, number> }

// The module's own variables: a reload starts them over, as it restarts the timers.
const S = {
  ctx: null as Ctx | null,
  cache: null as ProbeCache | null,
  ownBuiltin: null as BuiltinFigures | null,
  sharedBuiltin: null as BuiltinFigures | null,
  lock: null as Lock | null,
  alive: { at: 0, pids: [] } as Alive,
  entries: [] as Entry[],
  isTurnRunning: false,
  isProbing: false,
  isScanning: false,
  isQuiet: false,
  prevBusy: -1,
  prevWaiting: 0,
  lastSession: null as LimitWindow | null,
  lastEvent: null as ClawdEvent | null,
  lastKey: '',
  pc: null as PcState | null,
  isPcStale: false,
  isPcBusy: false,
  tips: [] as Tip[],
  /** The `city` option; empty: found from the internet address. */
  city: '',
  place: null as Place | null,
  weather: null as Weather | null,
  isWeatherStale: false,
  isWeatherBusy: false,
  control: { kind: 'auto' } as Control,
  alert: null as ServiceAlert | null,
  /** The 7-day limits history, one sample an hour. */
  history: [] as Sample[],
  projects: null as ProjectShare[] | null,
  isProjectsBusy: false,
  reminders: [] as Reminder[],
  /** How many reminders were ringing at the last look: one more makes Clawd hop. */
  ringing: 0,
  isRemindBusy: false,
  /** The full names of the mod's tools the engine gave back, and what each does. */
  tools: {} as Record<string, 'remind' | 'reminders' | 'cancel'>,
  isStatusBusy: false,
  /** When the status page last answered, and whether that is too long ago to trust. */
  alertAt: 0,
  isAlertStale: false,
}

function newestBuiltin(): BuiltinFigures | null {
  return (S.ownBuiltin?.at ?? 0) >= (S.sharedBuiltin?.at ?? 0) ? S.ownBuiltin : S.sharedBuiltin
}

// -------------------------------------------------------------- publish ----

/** Rebuilds what the band, the pane and Clawd draw; writes it only when it changed. */
async function publish($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const builtin = newestBuiltin()
  const limits = mergeLimits(S.cache, builtin, now)

  // The 5-hour window reset: its reset time moved forward (or ran out) and the percent dropped.
  const session = rawSession(S.cache, builtin)
  if (session !== null) {
    const before = S.lastSession
    if (
      before?.resetsAt != null &&
      (session.resetsAt === null || session.resetsAt > before.resetsAt + 10 * MINUTE) &&
      session.pct < before.pct
    ) {
      S.lastEvent = { id: now, kind: 'reset' }
    }
    S.lastSession = session
  }

  const probeWindows = [...(S.cache?.probes ?? [])]
  if (S.lock && now - S.lock.at < LOCK_MS) probeWindows.push({ from: S.lock.at, to: now })
  let own: SessionStatus = 'idle'
  const others: SessionRow[] = []
  for (const entry of S.entries) {
    if (entry.sessionId === S.ctx?.me) {
      own = entry.status
      continue
    }
    // Files outlive their processes: a PID the last check saw, or a file written since.
    const isAlive = S.alive.pids.includes(entry.pid) || entry.mtimeMs > S.alive.at
    if (!isAlive || isProbeEntry(entry, probeWindows)) continue
    others.push({ pid: entry.pid, name: entry.name, cwd: entry.cwd, status: entry.status, waitingFor: entry.waitingFor })
  }
  const sessions = sortSessions(others)

  // This session counts for Clawd's mood (not for the "running" line): its turns
  // straight from the hooks, a question it waits on from its registry file.
  const self: SessionStatus = S.isTurnRunning ? 'busy' : own === 'waiting' ? 'waiting' : 'idle'
  const busy = sessions.filter(row => row.status === 'busy').length + (self === 'busy' ? 1 : 0)
  const waiting = sessions.filter(row => row.status === 'waiting').length + (self === 'waiting' ? 1 : 0)
  // A session finished its reply (rather than stopping to wait for the person).
  if (S.prevBusy > 0 && busy < S.prevBusy && waiting <= S.prevWaiting) S.lastEvent = { id: now, kind: 'finished' }
  S.prevBusy = busy
  S.prevWaiting = waiting
  S.isQuiet = busy === 0 && waiting === 0

  const pct = limits?.session?.pct ?? null
  S.tips = S.pc ? tipsOf(S.pc, now) : []
  const next: ClawdView = {
    limits,
    sessions,
    mood: moodOf(pct, busy, waiting),
    halves: heartHalves(pct),
    isCrit: pct !== null && pct >= 85,
    event: S.lastEvent,
    minute: Math.floor(now / MINUTE),
    tips: S.tips,
    pcStale: S.isPcStale,
    place: S.place,
    weather: S.weather,
    weatherStale: S.isWeatherStale,
    control: S.control,
    alert: S.alert,
    alertAt: S.alertAt,
    alertStale: S.isAlertStale,
    history: S.history,
    projects: S.projects,
    reminders: {
      due: S.reminders.filter(r => r.firedAt !== null).sort((a, b) => a.at - b.at),
      next: S.reminders
        .filter(r => r.firedAt === null)
        .sort((a, b) => whenDue(a) - whenDue(b))
        .slice(0, 3),
    },
  }
  const key = JSON.stringify(next)
  if (key !== S.lastKey) {
    S.lastKey = key
    await update($, view, () => next)
  }
}

// ------------------------------------------------------------- sessions ----

/** Which PIDs run: shared between the copies for a minute, `tasklist` or `ps` past that. */
async function refreshAlive($: EngineInterface, now: number): Promise<void> {
  const ctx = S.ctx
  if (!ctx || now - S.alive.at < ALIVE_MS) return
  const path = `${ctx.dir}/alive.json`
  const shared = await readJson<Alive>($, path)
  if (shared && now - shared.at < ALIVE_MS) {
    S.alive = shared
    return
  }
  try {
    const argv = ctx.isWindows
      ? ['tasklist', '/FI', 'IMAGENAME eq claude.exe', '/FO', 'CSV', '/NH']
      : ['ps', '-A', '-o', 'pid=,comm=']
    const { stdout } = await $.process.run(argv, { timeoutMs: 15_000 })
    const pids = ctx.isWindows ? parseTasklist(stdout) : parsePs(stdout)
    S.alive = { at: await $.clock.now(), pids: [...pids] }
    await $.fs.write(path, JSON.stringify(S.alive))
  } catch {
    // Can't tell: count every file for now, and try again in a minute.
    S.alive = { at: now, pids: S.entries.map(entry => entry.pid) }
  }
}

async function scan($: EngineInterface): Promise<void> {
  const ctx = S.ctx
  if (!ctx || S.isScanning) return
  S.isScanning = true
  try {
    const now = await $.clock.now()
    const list = await $.fs.list(ctx.sessionsDir).catch(() => [])
    const next: Entry[] = []
    for (const file of list) {
      if (file.kind !== 'file' || !file.name.endsWith('.json')) continue
      const text = await $.fs.read(`${ctx.sessionsDir}/${file.name}`).catch(() => '')
      const entry = parseRegistryEntry(text)
      if (entry) next.push({ ...entry, mtimeMs: file.mtimeMs })
    }
    S.entries = next
    S.lock = await readJson<Lock>($, `${ctx.dir}/lock.json`)
    await refreshAlive($, now)
    await publish($)
  } finally {
    S.isScanning = false
  }
}

// --------------------------------------------------------------- limits ----

async function runProbe($: EngineInterface, cwd: string): Promise<string | null> {
  for (const exe of S.ctx?.isWindows ? ['claude', 'claude.exe'] : ['claude']) {
    try {
      const { stdout } = await $.process.run([exe, ...PROBE_ARGS], { cwd, timeoutMs: PROBE_TIMEOUT_MS })
      return stdout
    } catch (error) {
      // "cannot start" tries the next name; a timeout or anything else ends it.
      if (!/start|ENOENT|not found/i.test(String(error))) return null
    }
  }
  return null
}

/**
 * Runs one probe if the lock is still ours after a short wait: write the lock,
 * wait, read it back (the file system here has no atomic create).
 */
async function probe($: EngineInterface, ctx: Ctx, now: number): Promise<void> {
  const { dir, me, configDir } = ctx
  await $.fs.write(`${dir}/lock.json`, JSON.stringify({ owner: me, at: now }))
  await $.clock.sleep(LOCK_SETTLE_MS)
  const held = await readJson<Lock>($, `${dir}/lock.json`)
  if (held?.owner !== me || held.at !== now) return
  S.lock = held
  // Another copy may have finished one while this one waited.
  const latest = await readJson<ProbeCache>($, `${dir}/cache.json`)
  if (latest && latest.triedAt > (S.cache?.triedAt ?? 0)) {
    S.cache = latest
    return
  }
  const text = await runProbe($, configDir)
  const done = await $.clock.now()
  const usage = text === null ? null : parseUsage(text, done)
  const probes = [...(latest?.probes ?? []), { from: now, to: done }].slice(-5)
  const next: ProbeCache = usage
    ? { at: done, triedAt: done, isFailed: false, usage, probes, tzOffsetMin: new Date(done).getTimezoneOffset() }
    : // Failed or timed out: keep the last numbers, marked stale.
      { at: latest?.at ?? 0, triedAt: done, isFailed: true, usage: latest?.usage ?? null, probes }
  S.cache = next
  await $.fs.write(`${dir}/cache.json`, JSON.stringify(next))
  if (usage) background(noteHistory($, ctx, { at: done, s: usage.session?.pct ?? null, w: usage.week?.pct ?? null }))
}

/** Adds a reading to the account's 7-day history, one writer at a time; the view keeps it by the hour. */
async function noteHistory($: EngineInterface, ctx: Ctx, sample: Sample): Promise<void> {
  const path = `${ctx.dir}/history.json`
  const saved = await withLock($, ctx.me, `${ctx.dir}/history.lock.json`, async () => {
    const list = addSample((await readJson<Sample[]>($, path)) ?? [], sample, sample.at)
    await $.fs.write(path, JSON.stringify(list))
    return list
  })
  if (saved === null) return // another copy is writing; the next reading comes soon
  S.history = compact(saved, sample.at)
  await publish($)
}

/** Reads the shared cache, and probes when one is due and no other copy holds a fresh lock. */
async function refreshLimits($: EngineInterface, isAsked = false): Promise<void> {
  const ctx = S.ctx
  if (!ctx) return
  S.cache = (await readJson<ProbeCache>($, `${ctx.dir}/cache.json`)) ?? S.cache
  S.sharedBuiltin = await readJson<BuiltinFigures>($, `${ctx.dir}/builtin.json`)
  const now = await $.clock.now()
  const history = await readJson<Sample[]>($, `${ctx.dir}/history.json`)
  if (history) S.history = compact(history, now)
  const isFresh = now - (newestBuiltin()?.at ?? 0) < BUILTIN_FRESH_MS
  if (isProbeDue(S.cache, !isAsked && (isFresh || S.isQuiet), now) && !S.isProbing) {
    S.lock = await readJson<Lock>($, `${ctx.dir}/lock.json`)
    if (!S.lock || S.lock.owner === ctx.me || now - S.lock.at >= LOCK_MS) {
      S.isProbing = true
      try {
        await probe($, ctx, now)
      } finally {
        S.isProbing = false
      }
    }
  }
  await publish($)
}

/** This session's own figures, after each reply: shared, so idle copies need no probe. */
async function noteBuiltin($: EngineInterface, rateLimits: readonly SessionRateLimit[]): Promise<void> {
  const figures = fromRateLimits(rateLimits, await $.clock.now())
  if (!S.ctx || figures === null) return
  S.ownBuiltin = figures
  await $.fs.write(`${S.ctx.dir}/builtin.json`, JSON.stringify(figures)).catch(() => undefined)
  background(noteHistory($, S.ctx, { at: figures.at, s: figures.session?.pct ?? null, w: figures.week?.pct ?? null }))
  await publish($)
}

// -------------------------------------------------------------- PC tips ----

async function runPcCheck($: EngineInterface, kind: 'fast' | 'slow'): Promise<string> {
  const script = `${$.plugin.root}/scripts/pc-check.ps1`
  const argv = ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Kind', kind]
  return (await $.process.run(argv, { timeoutMs: PC_TIMEOUT_MS })).stdout
}

/** A read-change-write of pc-state.json, under its lock; null when another copy holds it. */
async function changePcFile($: EngineInterface, ctx: Ctx, change: (file: PcFile) => PcFile | null): Promise<PcFile | null> {
  const path = `${ctx.machineDir}/pc-state.json`
  return withLock($, ctx.me, `${ctx.machineDir}/pc-state.lock.json`, async () => {
    const file = (await readJson<PcFile>($, path)) ?? { knownStartup: null, snoozes: {} }
    const next = change(file)
    if (next === null) return file
    await $.fs.write(path, JSON.stringify(next))
    return next
  })
}

/**
 * The PC checks, run by one copy for the whole machine when due (shared.ts),
 * read by every copy. A failed check keeps the last facts, marked stale.
 */
/**
 * This account's top projects of the last 7 days, from its session logs:
 * once an hour, by one session of the account (the logs are the account's).
 */
async function refreshProjects($: EngineInterface): Promise<void> {
  const ctx = S.ctx
  if (!ctx?.isWindows || S.isProjectsBusy) return
  S.isProjectsBusy = true
  try {
    const job = { dir: ctx.dir, name: 'projects', everyMs: PROJECTS_MS, retryMs: PROJECTS_RETRY_MS }
    const got = await runShared<ProjectShare[]>($, ctx.me, job, async () => {
      const since = String((await $.clock.now()) - WEEK_MS)
      const script = `${$.plugin.root}/scripts/projects.ps1`
      const argv = ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script]
      const { stdout } = await $.process.run([...argv, '-ProjectsDir', `${ctx.configDir}/projects`, '-Since', since], {
        timeoutMs: PROJECTS_TIMEOUT_MS,
      })
      return parseProjects(stdout)
    })
    S.projects = got?.value ?? null
    await publish($)
  } finally {
    S.isProjectsBusy = false
  }
}

// ------------------------------------------------------------ reminders ----

/** A read-change-write of reminders.json under its lock; null when another copy holds it. */
async function changeReminders(
  $: EngineInterface,
  ctx: Ctx,
  change: (list: Reminder[], now: number) => Reminder[],
): Promise<Reminder[] | null> {
  const path = `${ctx.machineDir}/reminders.json`
  const saved = await withLock($, ctx.me, `${ctx.machineDir}/reminders.lock.json`, async () => {
    const list = change((await readJson<Reminder[]>($, path)) ?? [], await $.clock.now())
    await $.fs.write(path, JSON.stringify(list))
    return list
  })
  if (saved) {
    S.reminders = saved
    await publish($)
  }
  return saved
}

async function addReminder($: EngineInterface, r: { at: number; repeat: Repeat | null; text: string }): Promise<string> {
  const ctx = S.ctx
  if (!ctx) return 'Clawd is not ready yet.'
  const id = `${Math.floor(r.at / MINUTE).toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const added = { id, ...r, firedAt: null, firedBy: null, isLate: false, snoozeUntil: null }
  const saved = await changeReminders($, ctx, list => [...list, added])
  return saved ? setText(r) : 'Another session is saving a reminder: try again.'
}

/**
 * Rings the reminders that fell due: the copy that claims one (under the
 * lock) sends the notification, every copy shows it with its buttons and the
 * bell until it is answered. One missed while no session was open rings late.
 */
async function checkReminders($: EngineInterface): Promise<void> {
  const ctx = S.ctx
  if (!ctx || S.isRemindBusy) return
  S.isRemindBusy = true
  try {
    const now = await $.clock.now()
    S.reminders = (await readJson<Reminder[]>($, `${ctx.machineDir}/reminders.json`)) ?? []
    let claimed: Reminder[] = []
    if (dueOf(S.reminders, now).length > 0) {
      await changeReminders($, ctx, (list, at) => {
        // A repeat rings for its latest time (missed ones are not rung one by one).
        claimed = dueOf(list, at).map(r => {
          const due = r.snoozeUntil ?? latestAt(r, at)
          return { ...r, at: latestAt(r, at), snoozeUntil: null, firedAt: at, firedBy: ctx.me, isLate: at - due > LATE_MS }
        })
        return list.map(r => claimed.find(one => one.id === r.id) ?? r)
      })
    }
    for (const r of claimed) {
      await $.ui.notify(r.isLate ? `${r.text} (late: it fell due while Claude Code was closed)` : r.text, { title: 'Clawd reminds you' })
    }
    const ringing = S.reminders.filter(r => r.firedAt !== null).length
    if (ringing > S.ringing) S.lastEvent = { id: now, kind: 'bell' }
    S.ringing = ringing
    await publish($)
  } finally {
    S.isRemindBusy = false
  }
}

/** Done: a one-off is gone; a repeat moves on to its next time after now. */
async function doneReminder($: EngineInterface, id: string): Promise<void> {
  if (!S.ctx) return
  await changeReminders($, S.ctx, (list, now) =>
    list.flatMap(r => {
      if (r.id !== id) return [r]
      const next = nextAt(r, now)
      return next === null ? [] : [{ ...r, at: next, firedAt: null, firedBy: null, isLate: false, snoozeUntil: null }]
    }),
  )
}

/** +15m, +1h: rings again then. */
async function laterReminder($: EngineInterface, id: string, ms: number): Promise<void> {
  if (!S.ctx) return
  await changeReminders($, S.ctx, (list, now) =>
    // Its own time stays: a repeat goes on from its schedule after Done.
    list.map(r => (r.id === id ? { ...r, snoozeUntil: now + ms, firedAt: null, firedBy: null, isLate: false } : r)),
  )
}

/** Claude's three tools: set one at an exact time, list them, cancel one. */
async function registerTools($: EngineInterface): Promise<void> {
  const specs = [
    {
      kind: 'remind' as const,
      name: 'remind',
      description:
        "Set a reminder for the user. Clawd (their clawd-mods mod) rings it at that time with a desktop notification and a bell over him, in whichever Claude Code session with the mod is open. Turn the user's words into an exact time in their time zone.",
      inputSchema: {
        type: 'object',
        properties: {
          at: { type: 'string', description: 'When, ISO 8601 with the UTC offset, e.g. 2026-10-23T09:00:00+07:00' },
          text: { type: 'string', description: 'What to remind of, short' },
          repeat: { type: 'string', enum: REPEATS, description: 'Optional: ring again every day, week, month or year' },
        },
        required: ['at', 'text'],
      },
    },
    { kind: 'reminders' as const, name: 'reminders', description: "List the user's Clawd reminders: id, time, repeat, text." },
    {
      kind: 'cancel' as const,
      name: 'cancel_reminder',
      description: 'Cancel one of the Clawd reminders, by the id the reminders tool lists.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  ]
  for (const { kind, ...spec } of specs) {
    const { tool } = await $.tool.register(spec)
    S.tools[tool] = kind
  }
}

/** A call of one of the mod's tools: the text the model reads, or a refusal. */
async function answerTool($: EngineInterface, kind: 'remind' | 'reminders' | 'cancel', input: Record<string, unknown>): Promise<{ result: string } | { deny: string }> {
  if (kind === 'remind') {
    const at = typeof input.at === 'string' ? Date.parse(input.at) : Number.NaN
    const text = typeof input.text === 'string' ? input.text.trim() : ''
    const repeat = REPEATS.find(one => one === input.repeat) ?? null
    if (!Number.isFinite(at) || !text) return { deny: 'Give `at` as ISO 8601 with its UTC offset, and a `text`.' }
    const now = await $.clock.now()
    if (at <= now && repeat === null) return { deny: 'That time has passed.' }
    // A repeat whose first time today has passed starts at its next time, not with a late ring.
    return { result: await addReminder($, { at: nextAt({ at, repeat }, now) ?? at, repeat, text }) }
  }
  const ctx = S.ctx
  if (!ctx) return { deny: 'Clawd is not ready yet.' }
  const list = (await readJson<Reminder[]>($, `${ctx.machineDir}/reminders.json`)) ?? []
  if (kind === 'reminders') {
    if (list.length === 0) return { result: 'No reminders.' }
    return {
      result: [...list]
        .sort((a, b) => a.at - b.at)
        .map(r => [r.id, fullStamp(r.at), ...(r.repeat ? [r.repeat] : []), r.text, ...(r.firedAt ? ['ringing now'] : [])].join(' · '))
        .join('\n'),
    }
  }
  const gone = list.find(r => r.id === input.id)
  if (!gone) return { deny: `No reminder with the id "${String(input.id)}".` }
  const saved = await changeReminders($, ctx, latest => latest.filter(r => r.id !== gone.id))
  return saved ? { result: `Cancelled: ${gone.text}.` } : { deny: 'Another session is saving: try again.' }
}

async function refreshPc($: EngineInterface): Promise<void> {
  const ctx = S.ctx
  if (!ctx?.isWindows || S.isPcBusy) return
  S.isPcBusy = true
  try {
    const dir = ctx.machineDir
    const fast = await runShared<FastFacts[]>($, ctx.me, { dir, name: 'pc-fast', everyMs: PC_FAST_MS }, async last => {
      const facts = parseFast(await runPcCheck($, 'fast'), await $.clock.now())
      return facts && [...(last ?? []), facts].slice(-3)
    })
    const slow = await runShared<SlowFacts>($, ctx.me, { dir, name: 'pc-slow', everyMs: PC_SLOW_MS }, async () =>
      parseSlow(await runPcCheck($, 'slow'), await $.clock.now()),
    )
    let file = (await readJson<PcFile>($, `${dir}/pc-state.json`)) ?? { knownStartup: null, snoozes: {} }
    const startup = slow?.value?.startup
    // The first startup list seen counts as known: only entries added later are tips.
    if (file.knownStartup === null && startup) {
      file = (await changePcFile($, ctx, last => (last.knownStartup === null ? { ...last, knownStartup: startup } : null))) ?? file
    }
    S.pc = { fast: fast?.value ?? [], slow: slow?.value ?? null, knownStartup: file.knownStartup, snoozes: file.snoozes }
    S.isPcStale = (fast?.isFailed ?? false) || (slow?.isFailed ?? false)
    await publish($)
  } finally {
    S.isPcBusy = false
  }
}

/** Fix it: the tip goes to Claude in this session, who proposes and asks before each command. */
async function fixTip($: EngineInterface, id: string): Promise<void> {
  const tip = S.tips.find(one => one.id === id)
  if (!tip) return
  try {
    await $.prompt.submit({ text: fixPrompt(tip) })
    if (S.isTurnRunning) $.ui.toast('Fix it is queued: Claude takes it after this reply.')
  } catch {
    $.ui.toast('Claude could not take it now: try Fix it again when the reply ends.')
  }
}

/** Not now: hidden for every session until its snooze ends (a day; a month for unused apps). */
async function snoozeTip($: EngineInterface, id: string): Promise<void> {
  const ctx = S.ctx
  const tip = S.tips.find(one => one.id === id)
  if (!ctx || !tip) return
  const now = await $.clock.now()
  const saved = await changePcFile($, ctx, file => ({
    ...file,
    snoozes: { ...Object.fromEntries(Object.entries(file.snoozes).filter(([, until]) => until > now)), [id]: now + tip.snoozeMs },
  }))
  if (saved === null) {
    $.ui.toast('Another session is saving: try Not now again.')
    return
  }
  if (S.pc) S.pc = { ...S.pc, snoozes: saved.snoozes }
  await publish($)
}

// ------------------------------------------------------- service status ----

/**
 * Claude's status page every 2 minutes, one copy for the machine. A summary
 * that says all is operational clears the alert; one that cannot be read
 * keeps the last answer (the runner keeps the value, marked failed).
 */
async function refreshStatus($: EngineInterface): Promise<void> {
  const ctx = S.ctx
  if (!ctx || S.isStatusBusy) return
  S.isStatusBusy = true
  try {
    // An operational page is a good answer with no alert: the runner keeps values, so wrap it.
    const got = await runShared<{ alert: ServiceAlert | null }>($, ctx.me, { dir: ctx.machineDir, name: 'status', everyMs: STATUS_MS }, async () => {
      const text = await fetchText($, STATUS_URL)
      return text.trimStart().startsWith('{') ? { alert: parseSummary(text) } : null
    })
    S.alert = got?.value?.alert ?? null
    // Unreachable a while: the last answer stays, marked, and is no longer news over Clawd.
    S.alertAt = got?.at ?? 0
    S.isAlertStale = S.alert !== null && (await $.clock.now()) - S.alertAt > STATUS_STALE_MS
    await publish($)
  } finally {
    S.isStatusBusy = false
  }
}

// -------------------------------------------------------------- weather ----

/** A GET that gives up after FETCH_TIMEOUT_MS (`$.http.fetch` has no timeout of its own). */
async function fetchText($: EngineInterface, url: string, headers?: Record<string, string>): Promise<string> {
  const answer = await Promise.race([
    $.http.fetch(url, headers ? { headers } : undefined),
    $.clock.sleep(FETCH_TIMEOUT_MS).then(() => null),
  ])
  if (answer === null) throw new Error(`timed out: ${url}`)
  if (!answer.ok) throw new Error(`HTTP ${answer.status}: ${url}`)
  return answer.text
}

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'place'

/** Open-Meteo, else met.no; null when neither answers with a reading. */
async function fetchWeather($: EngineInterface, at: Place): Promise<Weather | null> {
  const meteo =
    `https://api.open-meteo.com/v1/forecast?latitude=${at.lat}&longitude=${at.lon}` +
    '&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day&daily=sunrise,sunset&timezone=auto&forecast_days=1'
  const first = await fetchText($, meteo)
    .then(text => parseOpenMeteo(text, at))
    .catch(() => null)
  if (first) return first
  const metNo = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${at.lat}&lon=${at.lon}`
  return parseMetNo(await fetchText($, metNo, { 'User-Agent': USER_AGENT }), at, await $.clock.now())
}

/**
 * Where this PC is (the `city` option, or its internet address) once a day,
 * and the weather there every 15 minutes: one copy fetches for the machine.
 * Offline, the last reading stays, marked stale, and the sky keeps the clock.
 */
async function refreshWeather($: EngineInterface): Promise<void> {
  const ctx = S.ctx
  if (!ctx || S.isWeatherBusy) return
  S.isWeatherBusy = true
  try {
    const dir = ctx.machineDir
    const city = S.city
    const placeJob = { dir, name: city ? `place-${slug(city)}` : 'place-auto', everyMs: PLACE_MS, retryMs: PLACE_RETRY_MS }
    const place = await runShared<Place>($, ctx.me, placeJob, async () =>
      city
        ? parseGeocode(await fetchText($, `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`))
        : parseIpWho(await fetchText($, 'https://ipwho.is/')),
    )
    S.place = place?.value ?? null
    const at = S.place
    if (at) {
      const weatherJob = { dir, name: `weather-${slug(at.city)}`, everyMs: WEATHER_MS }
      const weather = await runShared<Weather>($, ctx.me, weatherJob, () => fetchWeather($, at))
      S.weather = weather?.value ?? null
      S.isWeatherStale = (weather?.isFailed ?? false) && S.weather !== null
    }
    await publish($)
  } finally {
    S.isWeatherBusy = false
  }
}

/**
 * Before 0.4.0 the mod was clawd-usage and kept its shared files in
 * <config dir>/clawd-usage/. Carry the figures over once; the lock and the
 * alive list rebuild themselves.
 */
async function migrate($: EngineInterface, ctx: Ctx): Promise<void> {
  if ((await readJson<unknown>($, `${ctx.dir}/cache.json`)) !== null) return
  for (const name of ['cache.json', 'builtin.json']) {
    try {
      await $.fs.write(`${ctx.dir}/${name}`, await $.fs.read(`${ctx.oldDir}/${name}`))
    } catch {
      // Not there, or not readable: nothing to carry.
    }
  }
}

async function start($: EngineInterface, city: string): Promise<void> {
  S.city = city
  const configDir =
    (await $.env.get('CLAUDE_CONFIG_DIR')) ||
    `${(await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '~'}/.claude`
  S.ctx = {
    configDir,
    dir: `${configDir}/clawd-mods`,
    oldDir: `${configDir}/clawd-usage`,
    machineDir: machineDirOf(
      { localAppData: (await $.env.get('LOCALAPPDATA')) || undefined, home: (await $.env.get('HOME')) || undefined },
      configDir,
    ),
    sessionsDir: `${configDir}/sessions`,
    me: await $.session.id(),
    isWindows: (await $.env.get('OS')) === 'Windows_NT',
  }
  await migrate($, S.ctx)
  // Versions before 0.3.0 pinned a status line entry under the prompt: take it down.
  $.ui.status(undefined)
  await $.command.register({
    name: 'clawd',
    description: 'Clawd: limits with exact reset times, live sessions, the /usage breakdown',
    argumentHint: '[play <animation>|demo|auto|band on|off]',
  })
  await $.command.register({
    name: 'remind',
    description: 'Clawd rings a reminder: /remind 20m check the deploy · tomorrow 9 standup · daily 9:00 pills',
    argumentHint: '<when> <what>',
  })
  await registerTools($).catch(() => undefined)
  await scan($)
  background(checkReminders($))
  $.clock.every(REMIND_MS, () => background(checkReminders($)))
  background(refreshLimits($))
  $.clock.every(SCAN_MS, () => background(scan($)))
  $.clock.every(LIMITS_MS, () => background(refreshLimits($)))
  if (S.ctx.isWindows) {
    background(refreshProjects($))
    $.clock.every(PROJECTS_TICK_MS, () => background(refreshProjects($)))
  }
  background(refreshStatus($))
  $.clock.every(STATUS_TICK_MS, () => background(refreshStatus($)))
  background(refreshWeather($))
  $.clock.every(WEATHER_TICK_MS, () => background(refreshWeather($)))
  // PC tips read Windows itself; elsewhere there are none.
  if (S.ctx.isWindows) {
    background(refreshPc($))
    $.clock.every(PC_MS, () => background(refreshPc($)))
  }
}

/** `/clawd play [name]`, `/clawd demo`, `/clawd auto`: Clawd on request, and live again. */
async function setControl($: EngineInterface, words: string[]): Promise<string> {
  const id = await $.clock.now()
  const [verb, name] = words
  if (verb === 'play' && !name) return `Animations: ${ACTS.join(', ')}. Play one with /clawd play <name>.`
  if (verb === 'play' && name && !ACTS.includes(name)) return `No animation called "${name}".`
  S.control = verb === 'play' && name ? { kind: 'play', act: name, id } : verb === 'demo' ? { kind: 'demo', id } : { kind: 'auto' }
  await publish($)
  if (S.control.kind === 'play') return `Playing ${name}.`
  if (S.control.kind === 'demo') return 'Demo: every animation, then every mood, 3 s each; then he is live again. /clawd auto stops it.'
  return 'Clawd is live again.'
}

/**
 * `/clawd band on|off` (or `/clawd band` to flip it): sets the `band` row of
 * /config, which reloads the mod with the new value, as a change in the menu does.
 */
async function setBand($: EngineInterface, words: string[]): Promise<string> {
  // `<plugin>.<field>`; a plugin loaded from a folder may be keyed `<name>@inline`.
  const name = $.plugin.name.split('@')[0]
  const row = (await $.config.list()).find(
    one => one.key.endsWith('.band') && (one.provider.plugin.split('@')[0] === name || one.key.split(/[.@]/)[0] === name),
  )
  if (!row) return 'The band setting is not in /config.'
  const wanted = words[0] === 'on' ? true : words[0] === 'off' ? false : row.value !== true
  if (row.value === wanted) return `The band is already ${wanted ? 'on' : 'off'}.`
  const { deny } = await $.config.set({ key: row.key, value: wanted })
  return deny ?? `The band is ${wanted ? 'on' : 'off'}. /clawd stays either way.`
}

// -------------------------------------------------------------- drawing ----

/**
 * The sky over Clawd for the minute the view was drawn: the weather's kind
 * and wind; its sunrise and sunset while they are today's, else the sunrise
 * equation for the place (or Jakarta before any place is known).
 */
function skyOf(v: ClawdView): SkyProps {
  const now = v.minute * MINUTE
  const w = v.weather
  const place = v.place ?? DEFAULT_PLACE
  const isToday = w !== null && Math.abs(now - w.sunrise) < 18 * 60 * MINUTE
  const { sunrise, sunset } = isToday ? w : solarTimes(place.lat, place.lon, now)
  // Hours offline, the old reading no longer rains on him: a clear sky by the clock.
  const isRecent = w !== null && now - w.at < WEATHER_FRESH_MS
  return { kind: isRecent ? w.kind : null, sunrise, sunset, now, ...(isRecent && { windFromDeg: w.windFromDeg, windKmh: w.windKmh }) }
}


export const register: Register = (on, options) => {
  // A change of the /config row reloads the module, so this is read once a load.
  const showBand = options.band !== false
  const showSky = options.sky !== false
  const city = typeof options.city === 'string' ? options.city.trim() : ''

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // Headless runs (`claude -p`, the probe among them) get no band, timers or probes.
    if (e.isInteractive) await start($, city)
    return started
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && S.ctx) {
      S.isTurnRunning = true
      background(publish($))
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && S.ctx) {
      S.isTurnRunning = false
      await noteBuiltin($, (await $.session.usage()).rateLimits)
    }
    return done
  })

  on('session.measure', async ($, e, next) => {
    if (S.ctx && e.changed.includes('rateLimits')) await noteBuiltin($, e.rateLimits)
    return next(e)
  })

  on('command.run', { command: 'remind' }, async ($, e) => {
    const words = e.args.trim()
    if (!words) {
      const next = S.reminders.filter(r => r.firedAt === null).sort((a, b) => a.at - b.at).slice(0, 5)
      const list = next.map(r => `${fullStamp(r.at)}: ${r.text}`).join(' · ')
      return { text: `Usage: /remind <when> <what>, e.g. /remind 20m check the deploy.${list ? ` Next: ${list}` : ''}` }
    }
    const parsed = parseWhen(words, await $.clock.now())
    return { text: 'error' in parsed ? parsed.error : await addReminder($, parsed) }
  })

  // Claude's reminder tools, by the full names the engine gave back at registration.
  on('tool.call', async ($, e, next) => {
    const kind = S.tools[e.tool]
    if (!kind) return next(e)
    return answerTool($, kind, e as unknown as Record<string, unknown>)
    // Failing, one of Clawd's own tools says so; any other tool goes on untouched.
  }).catch(($, e, next) => (S.tools[e.tool] && !next.called ? { deny: 'Clawd could not do that just now: try again.' } : next(e)))

  on('command.run', { command: 'clawd' }, async ($, e) => {
    const words = e.args.trim().toLowerCase().split(/\s+/)
    if (words[0] === 'band') return { text: await setBand($, words.slice(1)) }
    if (words[0] === 'play' || words[0] === 'demo' || words[0] === 'auto') return { text: await setControl($, words) }
    await $.ui.open({ id: PANE, title: 'Clawd' })
    background(refreshLimits($, true))
    return { text: 'Clawd pane opened.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!showBand) return next(e)
    const below = await next(e)
    const v = await read($, view)
    // Clawd's yard: the whole band, so he can walk to its right edge; none below 12.
    const yard = e.props.bodyColumns
    if (e.props.hasSurvey || v === null || yard < 12 || (e.surface !== 'terminal' && e.surface !== 'desktop')) return below
    const { Box, Client } = $.ui.resolve(e)

    // Clawd alone: his mood and hearts carry the limits; /clawd has the numbers.
    // He stands on top of what is beneath (clean-view's checklist, when this mod
    // is listed before it), his sky the row between him and the chat.
    return (
      <Box flexDirection="column">
        <Box key="yard">
          <Client
            key="clawd"
            module="./clawd.tsx"
            width={yard}
            height={4}
            props={{
              mood: v.mood,
              halves: v.halves,
              isCrit: v.isCrit,
              worried: v.tips.some(tip => tip.level === 'red'),
              event: v.event,
              sky: showSky ? skyOf(v) : null,
              control: v.control,
              overhead:
                v.reminders.due.length > 0
                  ? 'bell'
                  : v.alert && !v.alertStale
                    ? v.alert.level === 'major'
                      ? 'alert-major'
                      : 'alert-minor'
                    : null,
              width: yard,
            }}
          />
        </Box>
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const v = await read($, view)
    if (v === null) return <Text dimColor>Clawd is still looking around…</Text>
    const handlers: PaneHandlers = {
      fix: id => background(fixTip($, id)),
      snooze: id => background(snoozeTip($, id)),
      done: id => background(doneReminder($, id)),
      later: (id, ms) => background(laterReminder($, id, ms)),
    }
    return renderPane({ Box, Text, Button }, v, e.props.bodyColumns, v.minute * MINUTE, handlers)
  })
}
