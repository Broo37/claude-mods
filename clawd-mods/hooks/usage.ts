// Pure helpers: no `$` here, so the tests call them directly.
// Parsing follows docs/PORTING.md and lib/usage.ps1 of clawd-usage-winwidget.

import type { Limits, LimitWindow, Mood, Period, SessionRow, SessionStatus } from '../types'

export const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

// ------------------------------------------------------------ /usage text ----

export type ProbeUsage = {
  session: LimitWindow | null
  week: LimitWindow | null
  fable: LimitWindow | null
  day: Period | null
  week7: Period | null
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
// "Oct 17, 5:19am (Europe/Moscow)", "Sep 21, 6am" or "Oct 17 at 2:29pm"
const STAMP = /([A-Za-z]{3})\s+(\d{1,2}),?\s*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap]m)/i
const SESSION_LINE = /Current session:\s*(\d+)%(?:[^\n]*?resets\s*([^\n]+))?/
const WEEK_LINE = /Current week \(all models\):\s*(\d+)%(?:[^\n]*?resets\s*([^\n]+))?/
const FABLE_LINE = /Current week \(Fable\):\s*(\d+)%(?:[^\n]*?resets\s*([^\n]+))?/

/**
 * A reset stamp in local time, which has no year: this year's, or next year's
 * when that lands more than 30 days in the past (New Year's Eve). The bracketed
 * time zone is the machine's own, so it is ignored.
 */
export function parseResetStamp(text: string, now: number): number | null {
  const m = STAMP.exec(text)
  if (!m) return null
  const month = MONTHS.indexOf((m[1] ?? '').toLowerCase())
  const day = Number(m[2])
  const hour12 = Number(m[3])
  const minute = m[4] === undefined ? 0 : Number(m[4])
  if (month < 0 || day < 1 || day > 31 || hour12 < 1 || hour12 > 12 || minute > 59) return null
  const hour = (hour12 % 12) + ((m[5] ?? '').toLowerCase() === 'pm' ? 12 : 0)
  const year = new Date(now).getFullYear()
  const at = new Date(year, month, day, hour, minute).getTime()
  return at < now - 30 * DAY ? new Date(year + 1, month, day, hour, minute).getTime() : at
}

function parseWindow(text: string, line: RegExp, now: number): LimitWindow | null {
  const m = line.exec(text)
  if (!m) return null
  // No "resets" on the line: the window has not started, which is 0%, not missing data.
  const stamp = m[2]
  return { pct: Number(m[1]), resetsAt: stamp === undefined ? null : parseResetStamp(stamp, now) }
}

/** The "Last 24h · 298 requests · 12 sessions" block and its indented lines, kept as printed. */
export function parsePeriod(text: string, label: 'Last 24h' | 'Last 7d'): Period | null {
  const lines = text.split('\n')
  const start = lines.findIndex(line => line.startsWith(label))
  if (start < 0) return null
  const header = (lines[start] ?? '').trim()
  // Singular on a quiet day: "1 request", "1 session".
  const requests = /(\d+)\s+requests?\b/.exec(header)
  const sessions = /(\d+)\s+sessions?\b/.exec(header)
  if (!requests || !sessions) return null
  const body: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (!/^[ \t]+\S/.test(line)) break
    body.push(line.trim())
  }
  return { header, requests: Number(requests[1]), sessions: Number(sessions[1]), lines: body }
}

/** What `claude -p /usage` printed, or null when it holds neither limit line. */
export function parseUsage(raw: string, now: number): ProbeUsage | null {
  const text = raw.replace(/\r\n?/g, '\n')
  const session = parseWindow(text, SESSION_LINE, now)
  const week = parseWindow(text, WEEK_LINE, now)
  if (session === null && week === null) return null
  return {
    session,
    week,
    fable: parseWindow(text, FABLE_LINE, now),
    day: parsePeriod(text, 'Last 24h'),
    week7: parsePeriod(text, 'Last 7d'),
  }
}

// ------------------------------------------------------- merging sources ----

/** The shared probe cache every copy of the mod reads (one file per account). */
export type ProbeCache = {
  /** When the probe last answered with numbers; 0 = never. */
  at: number
  /** When the last attempt ended, answered or not. */
  triedAt: number
  isFailed: boolean
  usage: ProbeUsage | null
  /** Recent probe runs, so their own `sessions/<pid>.json` is not counted. */
  probes: { from: number; to: number }[]
  /** The UTC offset the stamps were read in (`getTimezoneOffset`), to check against the machine's. */
  tzOffsetMin?: number
}

/** The 5-hour and weekly figures a session's own API responses carried. */
export type BuiltinFigures = { at: number; session: LimitWindow | null; week: LimitWindow | null }

export type RateLimitLike = { kind: string; percentUsed: number; resetsAt?: string }

export function fromRateLimits(rateLimits: readonly RateLimitLike[], at: number): BuiltinFigures | null {
  const pick = (kind: string): LimitWindow | null => {
    const one = rateLimits.find(limit => limit.kind === kind)
    if (!one) return null
    const resetsAt = one.resetsAt === undefined ? NaN : Date.parse(one.resetsAt)
    return { pct: one.percentUsed, resetsAt: Number.isNaN(resetsAt) ? null : resetsAt }
  }
  const session = pick('five_hour')
  const week = pick('seven_day')
  return session === null && week === null ? null : { at, session, week }
}

export const STALE_AFTER = 10 * MINUTE

/** The newest 5-hour and weekly figures of the two sources, before any window is aged. */
export function rawSession(probe: ProbeCache | null, builtin: BuiltinFigures | null): LimitWindow | null {
  const fromProbe = probe?.usage?.session ?? null
  if (builtin?.session && (fromProbe === null || builtin.at >= (probe?.at ?? 0))) return builtin.session
  return fromProbe
}

/** A window whose reset time has passed is 0% and not started, whatever was read before. */
function aged(window: LimitWindow | null, now: number): LimitWindow | null {
  if (window === null || window.resetsAt === null || window.resetsAt > now) return window
  return { pct: 0, resetsAt: null }
}

export function mergeLimits(probe: ProbeCache | null, builtin: BuiltinFigures | null, now: number): Limits | null {
  const usage = probe?.usage ?? null
  const useBuiltin = builtin !== null && (usage === null || builtin.at >= (probe?.at ?? 0))
  if (!useBuiltin && usage === null) return null
  const at = useBuiltin ? builtin.at : (probe?.at ?? 0)
  const failedSince = probe?.isFailed === true && probe.triedAt > at
  return {
    session: aged(useBuiltin ? (builtin.session ?? usage?.session ?? null) : (usage?.session ?? null), now),
    week: aged(useBuiltin ? (builtin.week ?? usage?.week ?? null) : (usage?.week ?? null), now),
    fable: aged(usage?.fable ?? null, now),
    day: usage?.day ?? null,
    week7: usage?.week7 ?? null,
    at,
    source: useBuiltin ? 'builtin' : 'probe',
    probedAt: usage === null ? 0 : (probe?.at ?? 0),
    isStale: failedSince || now - at > STALE_AFTER,
  }
}

/**
 * Whether this copy should run `claude -p /usage` now: every minute while
 * something works and no session's own figures are fresh, every five minutes
 * otherwise (the Fable row and the breakdown come only from the probe), at once
 * when a known reset time has passed, and never sooner than a minute after the
 * last try (two after a failure).
 */
export function isProbeDue(cache: ProbeCache | null, isRelaxed: boolean, now: number): boolean {
  const interval = isRelaxed ? 5 * MINUTE : MINUTE
  const at = cache?.at ?? 0
  const usage = cache?.usage ?? null
  const hasResetPassed = [usage?.session, usage?.week, usage?.fable].some(
    window => window?.resetsAt != null && window.resetsAt <= now && at < window.resetsAt,
  )
  const retry = cache?.isFailed ? 2 * MINUTE : MINUTE
  return (now - at >= interval || hasResetPassed) && now - (cache?.triedAt ?? 0) >= retry
}

// ------------------------------------------------------------ sessions ----

export type RegistryEntry = SessionRow & {
  sessionId: string
  entrypoint: string
  startedAt: number
}

function lastFolder(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

/** One `<config dir>/sessions/<pid>.json`, or null when it is not one. */
export function parseRegistryEntry(text: string): RegistryEntry | null {
  let j: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object') return null
    j = parsed as Record<string, unknown>
  } catch {
    return null
  }
  const pid = Number(j.pid)
  if (!Number.isInteger(pid) || pid <= 0) return null
  const cwd = typeof j.cwd === 'string' ? j.cwd : ''
  const name = typeof j.name === 'string' && j.name !== '' ? j.name : lastFolder(cwd)
  // busy: working; waiting: needs the person (permission, question, dialog); anything else is idle.
  const status: SessionStatus = j.status === 'busy' ? 'busy' : j.status === 'waiting' ? 'waiting' : 'idle'
  return {
    pid,
    name,
    cwd,
    status,
    waitingFor: typeof j.waitingFor === 'string' ? j.waitingFor : '',
    sessionId: typeof j.sessionId === 'string' ? j.sessionId : '',
    entrypoint: typeof j.entrypoint === 'string' ? j.entrypoint : '',
    startedAt: Number(j.startedAt) || 0,
  }
}

/** A `claude -p /usage` probe registers itself too (entrypoint `sdk-cli`) while it runs. */
export function isProbeEntry(entry: RegistryEntry, windows: readonly { from: number; to: number }[]): boolean {
  return entry.entrypoint === 'sdk-cli' &&
    windows.some(w => entry.startedAt >= w.from - 2000 && entry.startedAt <= w.to + 2000)
}

/** PIDs of `tasklist /FO CSV /NH` rows: `"claude.exe","49940","Console","1","182,708 K"`. */
export function parseTasklist(stdout: string): Set<number> {
  const pids = new Set<number>()
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^"([^"]*)","(\d+)"/.exec(line)
    if (m) pids.add(Number(m[2]))
  }
  return pids
}

/** PIDs of `ps -A -o pid=,comm=` rows that are a claude, node or bun process. */
export function parsePs(stdout: string): Set<number> {
  const pids = new Set<number>()
  for (const line of stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (m && /claude|node|bun/i.test(m[2] ?? '')) pids.add(Number(m[1]))
  }
  return pids
}

const STATUS_ORDER: Record<SessionStatus, number> = { waiting: 0, busy: 1, idle: 2 }

export function sortSessions(rows: readonly SessionRow[]): SessionRow[] {
  return [...rows].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name))
}

export function countSessions(rows: readonly SessionRow[]): { running: number; working: number; waiting: number } {
  return {
    running: rows.length,
    working: rows.filter(row => row.status === 'busy').length,
    waiting: rows.filter(row => row.status === 'waiting').length,
  }
}

// ---------------------------------------------------- mood, hearts, text ----

/** Clawd's mood, checked top to bottom. The widget's `sleep` (no session runs) can't happen here. */
export function moodOf(pct: number | null, busy: number, waiting: number): Mood {
  if (pct !== null && pct >= 100) return 'dead'
  if (waiting > 0) return 'wait'
  if (busy > 0) return 'work'
  return 'idle'
}

/** Heart halves left, 0..6: each half is about 16.7% of the session limit. */
export function heartHalves(pct: number | null): number | null {
  if (pct === null) return null
  return Math.min(6, Math.max(0, Math.ceil((Math.max(0, 100 - pct) * 6) / 100)))
}

export type HeartKind = 'full' | 'half' | 'empty'

export function hearts(halves: number): HeartKind[] {
  return [0, 1, 2].map(i => {
    const left = halves - 2 * i
    return left >= 2 ? 'full' : left === 1 ? 'half' : 'empty'
  })
}

export const HEART_GLYPH: Record<HeartKind, string> = { full: '♥', half: '❥', empty: '♡' }

export function heartsText(halves: number): string {
  return hearts(halves).map(kind => HEART_GLYPH[kind]).join('')
}

export type Level = 'ok' | 'warn' | 'crit'

/** Green below 60%, yellow from 60%, red from 85%. */
export function levelOf(pct: number): Level {
  return pct >= 85 ? 'crit' : pct >= 60 ? 'warn' : 'ok'
}

export const LEVEL_COLOR: Record<Level, string> = { ok: '#4ADE80', warn: '#FBBF24', crit: '#F87171' }

export function bar(pct: number, width: number): string {
  const filled = Math.min(width, Math.max(0, Math.round((pct / 100) * width)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export function countdown(ms: number): string {
  if (ms <= 0) return 'now'
  const minutes = Math.ceil(ms / MINUTE)
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Thu Oct 23, 1:29am", local time. */
export function formatStamp(at: number): string {
  const d = new Date(at)
  const h = d.getHours()
  const minutes = String(d.getMinutes()).padStart(2, '0')
  return `${DAYS[d.getDay()]} ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${h % 12 || 12}:${minutes}${h < 12 ? 'am' : 'pm'}`
}

/** A reset time short enough for the dock: "1:29am" today, "Fri 1:29am" this week, else "Oct 29, 1:29am". */
export function shortStamp(at: number, now: number): string {
  const d = new Date(at)
  const h = d.getHours()
  const time = `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`
  if (d.toDateString() === new Date(now).toDateString()) return time
  if (at > now && at - now < 6 * 1440 * MINUTE) return `${DAYS[d.getDay()]} ${time}`
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${time}`
}

export function pctText(pct: number): string {
  return `${Math.round(pct)}%`
}

export function sessionsText(rows: readonly SessionRow[]): string {
  const c = countSessions(rows)
  return `${c.running} running · ${c.working} working · ${c.waiting} waiting`
}
