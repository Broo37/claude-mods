import { atom, read, update } from 'claude-code'
import type { EngineInterface, FsEntry, Register, SessionUsage, Timer } from 'claude-code'

import type { Codex, Git, Limit, Peer, View } from '../types'

import { boxHeight, columnRows } from './column'
import { PALETTE, barCells, barSpans, glintCells, rgb, spinnerCell } from './format'
import type { BarKind, BarSpan } from './format'
import { boardOf, boardRows, hasBeat, hintRest, hintShift, isAtWork, linesOf, positionOf, sizeOf } from './layout'
import type { Position, Segment, Size } from './layout'
import {
  accountIn,
  effortIn,
  parseCodex,
  parseGit,
  parsePeer,
  planIn,
  profileIn,
  styleIn,
  tailScript,
} from './parse'
import { HOPS_MS, PET_COLUMNS, PET_FRAME_MS, PET_HOME, PET_ROWS, isHot, petFrame, petOf } from './pet'
import type { Creature, Mood } from './pet'
import { tabLinesOf } from './tab'
import { peerNews, warningsOf } from './warnings'

type Rollout = { path: string; size: number; mtimeMs: number }

const EMPTY: View = {
  now: 0,
  model: '',
  effort: '',
  style: '',
  cwd: '',
  home: '',
  env: '',
  account: '',
  contextTokens: 0,
  contextWindow: 0,
  contextPercent: 0,
  limits: [],
  costUsd: 0,
  isBoardClosed: false,
  isStatusClosed: false,
  mode: '',
  peers: [],
  startedAt: 0,
  git: null,
  codex: null,
  turn: null,
}

const view = atom({ plugin: 'status-band', key: 'view' } as const, EMPTY, { shape: 'view-6' })

const TICK = 30_000

// A warning stays up longer than a toast's usual four seconds.
const WARNING_MS = 8000

const PROCESS_TIMEOUT = 10_000

// $.fs.read refuses a larger file, so a larger rollout is tailed instead.
const READ_LIMIT = 4 * 1024 * 1024

const TAIL_BYTES = 65_536

// Several Codex sessions can be live at once, and the newest reading is not
// always in the file touched last.
const NEWEST = 8

const ROLLOUT = /^rollout-.*\.jsonl$/

// What each rollout last read as, so a tick reads only the ones that changed.
const readings = new Map<string, Rollout & { reading: Codex | null }>()

let isRefreshing = false

// How often the other sessions are looked at: what one is doing should show
// within seconds, and a look costs two folder listings.
const PEERS_MS = 5000

const PRESENCE = /^\d+\.json$/

// What each presence file last read as, so a look reads only the ones that changed.
const presences = new Map<string, Rollout & { peer: Peer | null }>()

let isLooking = false

// Whether the other sessions have been looked at since this module loaded:
// what they were doing before that is no news to tell.
let hasLooked = false

// How far the lines of the pane stand off its left edge: as far as the band's do.
const BOARD_GUTTER = 2

// The pane the other sessions are listed in, and the width asked for it: room
// for thirty columns of a line, and the gutter before it.
const BOARD = { id: 'sessions', title: 'Sessions', columns: 30 + BOARD_GUTTER }

// Whether this module has asked for that pane: once is enough, it stays up.
let hasOpenedBoard = false

// The tab the status is drawn in, beside the other sessions' pane and as wide.
// While the dock places it, the band gives it the place it held by the prompt.
const STATUS = { id: 'status', title: 'Status', columns: 30 + BOARD_GUTTER }

// Whether the status goes in that tab at all, as the person chose in /config.
let isTabOn = true

// Whether this module has asked for that tab.
let hasOpenedStatus = false

// Whether the tab has been drawn in the dock since it was opened: the first time
// it is, the band is drawn again, to give way to it.
let isTabDrawn = false

// Whether the pane was seated inline above the prompt, where no side pane is (a
// terminal not in fullscreen): it is closed again and the band keeps its place.
let isInline = false

// The width of terminal from which the side pane docks a pane asked for, in fullscreen.
const DOCK_COLUMNS = 110

// Whether the Status tab is on screen in the dock, so the band leaves its place
// to Claude Code: on, drawn in the dock, not closed by the person, and placed.
async function isTabPlaced($: EngineInterface, shown: View) {
  return (
    isTabOn &&
    isTabDrawn &&
    !isInline &&
    !shown.isStatusClosed &&
    (await $.ui.panes()).some(pane => pane.id === STATUS.id && pane.isPlaced)
  )
}

// How long one frame of the mark beside a session at work stands, the timer
// that moves it on, and the frame it is at.
const SPIN_MS = 100

let spinning: Timer | null = null

let spinFrame = 0

// The marks the pane last drew, which is what a frame repaints.
let spun: { requestId: string; keys: string[] } | null = null

// The icons of the other sessions move to a slower beat. An emoji cannot be
// repainted in place, so each beat draws the pane again: hence slow.
const BEAT_MS = 600

let beating: Timer | null = null

let beat = 0

let settingsEffort: string | undefined

// The account does not change under a running session, so it is read once.
let account: string | undefined

// One frame of a sweep, how far the glint moves in it, and how far its light reaches.
const FRAME_MS = 50

const GLINT_STEP = 2

const GLINT_REACH = 2

// How long after a sweep starts the next may start while Claude works.
const WORK_GAP_MS = 3500

// How long a state write is given to reach the screen before a sweep runs over it.
const SETTLE_MS = 150

// What `register` was given: the size to draw, whether the bars may animate, and
// where the band stands.
let size: Size = 'xlarge'

let isAnimated = true

let position: Position = 'above'

// Under what name the last mode seen is kept between sessions.
const MODE_KEY = 'mode'

// How many blocks the longest box last drawn holds: how far a glint has to
// travel, and nothing for one to travel over while it is 0.
let reach = 0

// Where the head of a glint stands over the boxes, while one sweeps.
let glint: number | null = null

let sweep: Timer | null = null

let working: Timer | null = null

// The pet under the list of the pane: the name its raster is repainted under,
// the creature the person chose, what the session is doing as the pet shows it
// and since when, and whether the five-hour limit is nearly spent.
const PET = 'pet'

let pet: Creature | null = null

let mood: Mood = 'asleep'

let moodAt = 0

let isSweating = false

// Where the pet stands, and where it set out on the walk it is on.
let petX = PET_HOME

let petFrom = PET_HOME

// The pane the pet was last drawn in, which is what a frame repaints, and the
// timer that moves it while it has something to show.
let petPane: string | null = null

let walking: Timer | null = null

let isStepping = false

const measured = ({
  context,
  rateLimits,
  cost,
}: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>) => {
  const tokens = context.tokens ?? 0

  return {
    contextTokens: tokens,
    contextWindow: context.window,
    contextPercent: context.percent ?? (context.window > 0 ? (tokens * 100) / context.window : 0),
    limits: rateLimits.map(({ kind, percentUsed, resetsAt }): Limit => {
      const at = Date.parse(resetsAt ?? '')

      return { kind, percentUsed, resetsAt: Number.isNaN(at) ? null : at }
    }),
    costUsd: cost?.usd ?? 0,
  }
}

const textProps = (segment: Extract<Segment, { text: string }>) => ({
  wrap: 'truncate-end' as const,
  ...(segment.color !== undefined && { color: rgb(segment.color) }),
  ...(segment.isBold === true && { bold: true }),
})

const spanProps = ({ color, backgroundColor }: BarSpan) => ({
  color: rgb(color),
  ...(backgroundColor !== undefined && { backgroundColor: rgb(backgroundColor) }),
})

async function accountOf($: EngineInterface, home: string, configDir: string) {
  let plan = ''

  try {
    // The default profile keeps its account file beside its config directory,
    // a named profile inside its own.
    plan = planIn(await $.fs.read(`${configDir === '' ? home : configDir}/.claude.json`))
  } catch {
    // No readable account file: the profile's name alone, if it has one.
  }

  return accountIn(profileIn(configDir), plan)
}

async function factsOf($: EngineInterface) {
  const [model, cwd, settings, userProfile, userHome, conda, venv, os, configDir] =
    await Promise.all([
      $.session.model(),
      $.session.cwd(),
      $.settings.read(),
      $.env.get('USERPROFILE'),
      $.env.get('HOME'),
      $.env.get('CONDA_DEFAULT_ENV'),
      $.env.get('VIRTUAL_ENV'),
      $.env.get('OS'),
      $.env.get('CLAUDE_CONFIG_DIR'),
    ])
  const home = userProfile ?? userHome ?? ''
  account ??= await accountOf($, home, configDir ?? '')

  return {
    model,
    cwd,
    home,
    account,
    style: styleIn(settings),
    effort: effortIn(settings, model),
    env: conda || (venv ? 'venv' : ''),
    isWindows: os === 'Windows_NT',
  }
}

async function gitOf($: EngineInterface, cwd: string): Promise<Git | null> {
  try {
    // One read-only status: unlike `git diff`, it honours GIT_OPTIONAL_LOCKS
    // and so never takes the index lock.
    const ran = await $.process.run(
      ['git', '-C', cwd, 'status', '--porcelain=v2', '--branch', '-uall'],
      { env: { GIT_OPTIONAL_LOCKS: '0' }, timeoutMs: PROCESS_TIMEOUT },
    )

    return ran.exitCode === 0 ? parseGit(ran.stdout) : null
  } catch {
    return null
  }
}

async function rolloutsIn($: EngineInterface, dir: string, depth: number): Promise<Rollout[]> {
  const found: Rollout[] = []

  try {
    for (const entry of await $.fs.list(dir)) {
      const path = `${dir}/${entry.name}`

      if (entry.kind === 'dir' && depth > 0) {
        found.push(...(await rolloutsIn($, path, depth - 1)))
      } else if (entry.kind === 'file' && ROLLOUT.test(entry.name)) {
        found.push({ path, size: entry.size, mtimeMs: entry.mtimeMs })
      }
    }
  } catch {
    // A folder that is not there holds no rollouts.
  }

  return found
}

async function tailOf($: EngineInterface, path: string, isWindows: boolean) {
  const ran = isWindows
    ? await $.process.run(
        ['powershell', '-NoProfile', '-NonInteractive', '-Command', tailScript(path, TAIL_BYTES)],
        { timeoutMs: PROCESS_TIMEOUT },
      )
    : await $.process.run(['tail', '-c', String(TAIL_BYTES), path], { timeoutMs: PROCESS_TIMEOUT })
  const cut = ran.stdout.indexOf('\n')

  // The seek lands mid-line, so what comes before the first break is a fragment.
  return cut < 0 ? '' : ran.stdout.slice(cut + 1)
}

async function readingOf($: EngineInterface, rollout: Rollout, isWindows: boolean) {
  const known = readings.get(rollout.path)

  if (known !== undefined && known.size === rollout.size && known.mtimeMs === rollout.mtimeMs) {
    return known.reading
  }

  try {
    const text =
      rollout.size > READ_LIMIT
        ? await tailOf($, rollout.path, isWindows)
        : await $.fs.read(rollout.path)
    const reading = parseCodex(text)
    readings.set(rollout.path, { ...rollout, reading })

    return reading
  } catch {
    return null
  }
}

// Codex CLI exposes no usage of its own, so the weekly window is read from the
// rate limits it writes into each session's rollout.
async function codexOf($: EngineInterface, home: string, isWindows: boolean) {
  const found = [
    ...(await rolloutsIn($, `${home}/.codex/sessions`, 4)),
    ...(await rolloutsIn($, `${home}/.codex/archived_sessions`, 0)),
  ]
  const newest = found.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, NEWEST)
  let best: Codex | null = null

  for (const rollout of newest) {
    const reading = await readingOf($, rollout, isWindows)

    if (reading !== null && (best === null || reading.readAt > best.readAt)) {
      best = reading
    }
  }

  for (const path of readings.keys()) {
    if (!newest.some(rollout => rollout.path === path)) {
      readings.delete(path)
    }
  }

  return best
}

const slashed = (path: string) => path.replace(/\\/g, '/')

// The other sessions running on this machine. Claude Code keeps a small file
// for each session that runs, in a folder of the profile it runs on: its name,
// what it is doing and since when. The default profile's folder is looked at
// too, so a session on another account shows as well.
async function peersOf($: EngineInterface) {
  const [userProfile, userHome, configDir, own] = await Promise.all([
    $.env.get('USERPROFILE'),
    $.env.get('HOME'),
    $.env.get('CLAUDE_CONFIG_DIR'),
    $.session.id(),
  ])
  const home = userProfile ?? userHome ?? ''
  const folders = new Set(
    [`${home}/.claude/sessions`, `${configDir || `${home}/.claude`}/sessions`].map(slashed),
  )
  const seen = new Set<string>()
  const peers: Peer[] = []

  for (const folder of folders) {
    let entries: FsEntry[] = []

    try {
      entries = await $.fs.list(folder)
    } catch {
      // A profile with no such folder runs no session.
    }

    for (const entry of entries) {
      if (entry.kind !== 'file' || !PRESENCE.test(entry.name)) {
        continue
      }

      const path = `${folder}/${entry.name}`
      const known = presences.get(path)
      let peer = known?.peer ?? null
      seen.add(path)

      if (known === undefined || known.size !== entry.size || known.mtimeMs !== entry.mtimeMs) {
        try {
          peer = parsePeer(await $.fs.read(path))
        } catch {
          // Gone between the listing and the read: the session has ended.
          peer = null
        }

        presences.set(path, { path, size: entry.size, mtimeMs: entry.mtimeMs, peer })
      }

      if (peer !== null && peer.id !== own) {
        peers.push(peer)
      }
    }
  }

  for (const path of presences.keys()) {
    if (!seen.has(path)) {
      presences.delete(path)
    }
  }

  return peers
}

// Repaints one mark with a frame. A mark that is no longer on screen (its
// session stopped, the pane was closed or drawn anew) is left alone after that.
async function repaint($: EngineInterface, requestId: string, key: string, cells: string) {
  let isGone = false

  try {
    isGone = (await $.ui.blit({ requestId, key, columns: 1, rows: 1, cells })).deny !== undefined
  } catch {
    isGone = true
  }

  if (isGone && spun !== null && spun.requestId === requestId) {
    spun = { requestId, keys: spun.keys.filter(other => other !== key) }
  }
}

// Moves every mark the pane last drew on by one frame, in place: no redraw.
function spinMarks($: EngineInterface) {
  spinFrame += 1

  if (spun === null) {
    return
  }

  const cells = spinnerCell(spinFrame)

  for (const key of spun.keys) {
    void repaint($, spun.requestId, key, cells)
  }
}

// Opens the Status tab, after the other sessions' pane so that it is the tab in
// front, and notices when the person has closed it: a tab that was opened and
// is no longer among the open panes. Then the band stands in for it, until the
// person asks for the tab again. With the tab switched off in /config, a tab
// still up from before (panes outlast a reload) is closed.
async function watchStatus($: EngineInterface) {
  if (!isTabOn) {
    if ((await $.ui.panes()).some(pane => pane.id === STATUS.id)) {
      hasOpenedStatus = false
      await $.ui.close({ id: STATUS.id })
    }

    return
  }

  if (isInline) {
    return
  }

  const shown = await read($, view)

  if (hasOpenedStatus && !(await $.ui.panes()).some(pane => pane.id === STATUS.id)) {
    hasOpenedStatus = false
    isTabDrawn = false
    await update($, view, last => ({ ...last, isStatusClosed: true }))
    $.ui.invalidate('ui.render')
  } else if (!hasOpenedStatus && !shown.isStatusClosed) {
    hasOpenedStatus = true
    void $.ui.open(STATUS)
  }
}

// Looks at the other sessions, redraws the band when one of them has changed,
// and tells the person when one now waits for them.
async function watchPeers($: EngineInterface) {
  if (isLooking) {
    return
  }

  isLooking = true

  try {
    const peers = await peersOf($)
    let news: string[] = []
    let isClosed = false

    await update($, view, last => {
      isClosed = last.isBoardClosed

      if (JSON.stringify(last.peers) === JSON.stringify(peers)) {
        return last
      }

      news = hasLooked ? peerNews(last.peers, peers) : []

      return { ...last, peers }
    })
    hasLooked = true

    // A pane that was opened and is no longer among the open ones was closed
    // by the person: it is theirs to ask for again.
    if (hasOpenedBoard && !(await $.ui.panes()).some(pane => pane.id === BOARD.id)) {
      hasOpenedBoard = false
      isClosed = true
      await update($, view, last => ({ ...last, isBoardClosed: true }))
    }

    // Alone there is nothing to list, and the chat keeps its whole width.
    if (peers.length > 0 && !isClosed && !hasOpenedBoard) {
      hasOpenedBoard = true
      void $.ui.open(BOARD)
    }

    await watchStatus($)

    // While the pane is up, the mark beside a session at work spins, and the
    // icons of the sessions that move to the beat are drawn again on each one.
    const isUp = isAnimated && hasOpenedBoard
    const isSpinning = isUp && peers.some(isAtWork)
    const isBeating = isUp && peers.some(hasBeat)

    if (isSpinning && spinning === null) {
      spinning = $.clock.every(SPIN_MS, () => spinMarks($))
    } else if (!isSpinning && spinning !== null) {
      spinning.cancel()
      spinning = null
    }

    if (isBeating && beating === null) {
      beating = $.clock.every(BEAT_MS, () => {
        beat += 1
        $.ui.invalidate('ui.render')
      })
    } else if (!isBeating && beating !== null) {
      beating.cancel()
      beating = null
      beat = 0
    }

    for (const line of news) {
      $.ui.toast(line, { timeoutMs: WARNING_MS })
    }
  } catch (error) {
    $.ui.log(`status-band: looking at the other sessions failed: ${error instanceof Error ? error.message : String(error)}`, {
      to: 'debug',
    })
  } finally {
    isLooking = false
  }
}

// The readings the bars show, as one string: two views that differ here draw different bars.
const barsOf = (shown: View) =>
  linesOf(shown, size)
    .flat()
    .flatMap(segment => ('bar' in segment ? [`${segment.bar}:${segment.percent}`] : []))
    .join(' ')

function stopSweep() {
  sweep?.cancel()
  sweep = null
  glint = null
}

// Runs one glint across the boxes the band last drew, then leaves them as drawn.
// Each frame is a redraw: the bars are text, which draws its colors exactly, and
// only a raster, which rounds them, can be repainted in place.
function sweepBars($: EngineInterface) {
  if (!isAnimated || sweep !== null || reach === 0) {
    return
  }

  let head = -GLINT_REACH

  sweep = $.clock.every(FRAME_MS, () => {
    head += GLINT_STEP

    // `reach` is read afresh each frame: a redraw mid-sweep may have drawn a longer box.
    if (head > reach + GLINT_REACH) {
      stopSweep()
    } else {
      glint = head
    }

    $.ui.invalidate('ui.render')
  })
}

// Moves the view on, tells the person what the move climbed past, and lets
// the bars show that they moved.
async function advance($: EngineInterface, step: (last: View) => View) {
  let warnings: string[] = []
  let hasMoved = false

  await update($, view, last => {
    const next = step(last)
    warnings = warningsOf(last, next)
    hasMoved = barsOf(last) !== barsOf(next)

    return next
  })

  for (const warning of warnings) {
    $.ui.toast(warning, { timeoutMs: WARNING_MS })
  }

  if (hasMoved) {
    // After the redraw the write causes, so the glint runs over the new bars.
    $.clock.after(SETTLE_MS, () => sweepBars($))
  }
}

async function refresh($: EngineInterface) {
  if (isRefreshing) {
    return
  }

  isRefreshing = true

  try {
    const { effort, isWindows, ...facts } = await factsOf($)
    const [usage, git, codex, now] = await Promise.all([
      $.session.usage(),
      gitOf($, facts.cwd),
      codexOf($, facts.home, isWindows),
      $.clock.now(),
    ])
    const hasNewEffort = effort !== settingsEffort
    settingsEffort = effort

    await advance($, last => ({
      ...last,
      ...facts,
      ...measured(usage),
      startedAt: usage.startedAt,
      git,
      codex,
      now,
      // A turn reports the effort it really ran with, so the setting speaks
      // only when it changes, or when a /clear has emptied the view.
      effort: hasNewEffort || last.now === 0 ? effort : last.effort,
    }))
  } catch (error) {
    $.ui.log(`status-band: reading failed: ${error instanceof Error ? error.message : String(error)}`, {
      to: 'debug',
    })
  } finally {
    isRefreshing = false
  }
}

// The mode the session decides permissions in sets how wide the pill before a
// band under the prompt is. A session's hooks are told it, but not at its start,
// so the last one seen is kept for the next session to begin with.
async function seeMode($: EngineInterface, mode: string | undefined) {
  if (position !== 'below' || mode === undefined || mode === '') {
    return
  }

  let isNew = false

  await update($, view, last => {
    isNew = last.mode !== mode

    return isNew ? { ...last, mode } : last
  })

  if (isNew) {
    await $.store.set(MODE_KEY, mode)
  }
}

async function recallMode($: EngineInterface) {
  if (position !== 'below') {
    return
  }

  try {
    const mode = await $.store.get(MODE_KEY)

    if (typeof mode === 'string') {
      await update($, view, last => (last.mode === '' ? { ...last, mode } : last))
    }
  } catch {
    // Nothing kept, or nothing readable: the default mode's pill is taken.
  }
}

type Site = Parameters<EngineInterface['ui']['resolve']>[0]

// What each row of the band holds, the same wherever the band stands, and how
// many blocks the longest box among them holds.
function rowsOf($: EngineInterface, e: Site, shown: View) {
  const { Box, Text } = $.ui.resolve(e)
  let longest = 0

  const rows = linesOf(shown, size).map(line =>
    line.flatMap(segment => {
      if ('text' in segment) {
        return [<Text {...textProps(segment)}>{segment.text}</Text>]
      }

      // A row of the band holds texts and bars; a mark that spins is the pane's.
      if (!('bar' in segment)) {
        return []
      }

      const cells = barCells(segment.percent, segment.width, segment.bar, segment.pace)
      longest = Math.max(longest, cells.filter(cell => cell.isFilled).length)

      return [
        <Box flexShrink={0}>
          {barSpans(glint === null ? cells : glintCells(cells, glint)).map(span => (
            <Text {...spanProps(span)}>{span.text}</Text>
          ))}
        </Box>,
      ]
    }),
  )

  return { rows, longest }
}

// The pet's frame at a moment. A walk is drawn from where it set out; without
// animation the pet stands in the first frame of whatever it is doing.
const petNow = (creature: Creature, now: number) =>
  petFrame(creature, mood, isAnimated ? now - moodAt : 0, {
    isHot: isSweating,
    x: mood === 'working' ? petFrom : petX,
  })

// Paints the pet's next frame in place. Once it has hopped it falls asleep and
// is painted no more; a pet whose pane is gone waits to be drawn again.
async function stepPet($: EngineInterface) {
  if (isStepping || pet === null) {
    return
  }

  isStepping = true

  try {
    const now = await $.clock.now()

    if (mood === 'done' && now - moodAt >= HOPS_MS) {
      mood = 'asleep'
      moodAt = now
    }

    const frame = petNow(pet, now)
    petX = frame.x
    let isGone = petPane === null

    if (petPane !== null) {
      try {
        const painted = await $.ui.blit({
          requestId: petPane,
          key: PET,
          columns: PET_COLUMNS,
          rows: PET_ROWS,
          cells: frame.cells,
        })
        isGone = painted.deny !== undefined
      } catch {
        isGone = true
      }
    }

    if (isGone) {
      petPane = null
    }

    if (isGone || mood === 'asleep') {
      walking?.cancel()
      walking = null
    }
  } finally {
    isStepping = false
  }
}

// Has the pet move while it has something to show and a pane to show it in.
function movePet($: EngineInterface) {
  if (isAnimated && pet !== null && mood !== 'asleep' && petPane !== null && walking === null) {
    walking = $.clock.every(PET_FRAME_MS, () => void stepPet($))
  }
}

// Tells the pet what the session is doing now. A turn that starts while one
// runs is a subagent's, and the walk goes on.
async function petTo($: EngineInterface, next: Mood) {
  if (pet === null || mood === next) {
    return
  }

  const now = await $.clock.now()
  // Without animation there are no hops to show: the pet goes straight to sleep.
  mood = next === 'done' && !isAnimated ? 'asleep' : next
  moodAt = now
  petFrom = petX

  if (isAnimated) {
    movePet($)
  } else if (petPane !== null) {
    // A still pet changes only when its pane is drawn again.
    $.ui.invalidate('ui.render')
  }
}

export const register: Register = (on, options) => {
  size = sizeOf(options.size)
  isAnimated = options.animate !== false
  position = positionOf(options.position)
  pet = petOf(options.pet)
  isTabOn = options.tab !== false
  let tools = 0

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sessions',
      description: 'Show the other Claude Code sessions on this machine in a pane',
    })
    await $.command.register({ name: 'band', description: 'Show the status in a tab of the side pane' })
    $.clock.every(TICK, () => void refresh($))
    $.clock.every(PEERS_MS, () => void watchPeers($))
    $.clock.after(0, () => void refresh($))
    $.clock.after(0, () => void recallMode($))
    $.clock.after(0, () => void watchPeers($))

    return next(e)
  })

  // /clear, /resume and /branch empty $.state and raise no session.start.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, ($, e, next) => {
    $.clock.after(0, () => void refresh($))
    $.clock.after(0, () => void recallMode($))
    $.clock.after(0, () => void watchPeers($))

    return next(e)
  })

  on('command.run', { command: 'sessions' }, async $ => {
    await update($, view, last => ({ ...last, isBoardClosed: false }))

    // Asked for while it is a tab behind another pane, it is asked for to be
    // seen. The pane opened last is the tab in front (opening an open pane
    // again changes nothing), so it is closed and opened again; meanwhile it
    // is not taken for a pane the person closed.
    if ((await $.ui.panes()).some(pane => pane.id === BOARD.id && !pane.isShown)) {
      hasOpenedBoard = false
      await $.ui.close({ id: BOARD.id })
    }

    hasOpenedBoard = true
    const opened = await $.ui.open(BOARD)

    return { text: opened.isPlaced ? 'Sessions pane opened.' : 'Sessions pane: widen the terminal to see it.' }
  })

  // The Status tab, asked for: brought to the front as the Sessions pane is,
  // and no longer taken for one the person closed.
  on('command.run', { command: 'band' }, async ($, e) => {
    if (!isTabOn) {
      return { text: 'Status tab is off: switch "Status tab" on in /config.' }
    }

    // Asked for, a pane is placed at any width: outside a docking side pane it
    // would stand inline above the prompt, where the band already shows it all.
    if (!e.presentation.isFullscreen || e.presentation.columns < DOCK_COLUMNS) {
      return { text: `Status tab: the side pane needs a fullscreen terminal at least ${DOCK_COLUMNS} columns wide.` }
    }

    isInline = false
    await update($, view, last => ({ ...last, isStatusClosed: false }))

    if ((await $.ui.panes()).some(pane => pane.id === STATUS.id && !pane.isShown)) {
      hasOpenedStatus = false
      await $.ui.close({ id: STATUS.id })
    }

    hasOpenedStatus = true
    const opened = await $.ui.open(STATUS)
    $.ui.invalidate('ui.render')

    return { text: opened.isPlaced ? 'Status tab opened.' : 'Status tab: widen the terminal to see it.' }
  })

  // The Status tab: the band's text rows, the bars stood upright side by side,
  // and when each limit resets, two columns off the pane's edge as the
  // Sessions pane's lines are.
  on('ui.render', { component: 'Pane', requestId: STATUS.id }, async ($, e) => {
    const shown = await read($, view)
    const { Box, Text } = $.ui.resolve(e)

    // Seated inline above the prompt, it is no tab of the side pane: it is
    // closed again, by the mod, and the band keeps its place.
    if (e.props.placement !== 'dock') {
      if (!isInline) {
        isInline = true
        hasOpenedStatus = false
        isTabDrawn = false
        $.clock.after(0, () => void $.ui.close({ id: STATUS.id }).then(() => $.ui.invalidate('ui.render')))
      }

      return <Box />
    }

    if (shown.now === 0) {
      return (
        <Box flexDirection="column" paddingLeft={BOARD_GUTTER}>
          <Box>
            <Text color={rgb(PALETTE.overlay)}>(loading..)</Text>
          </Box>
        </Box>
      )
    }

    const lines = tabLinesOf(shown, e.props.bodyColumns - BOARD_GUTTER, e.props.scroll.bodyRows)
    // Each bar's rows, worked out once and drawn a row a line, a glint passing
    // up them while one sweeps.
    const bars = new Map<BarKind, BarSpan[][]>()
    const rowOf = (segment: Extract<Segment, { column: BarKind }>) => {
      const { column: kind, percent, height, width, pace } = segment
      const rows = bars.get(kind) ?? columnRows({ kind, percent, height, width, ...(pace !== undefined && { pace }) }, glint)
      bars.set(kind, rows)

      return rows[segment.row] ?? []
    }
    // A glint travels as far as the tallest box, counted in rows.
    reach = Math.max(
      0,
      ...lines.flat().flatMap(segment => ('column' in segment ? [boxHeight(segment.percent, segment.height)] : [])),
    )

    // Drawn the first time, the tab takes the band's place: the band is drawn again to give way.
    if (!isTabDrawn) {
      isTabDrawn = true
      $.clock.after(0, () => $.ui.invalidate('ui.render'))
    }

    return (
      <Box flexDirection="column" paddingLeft={BOARD_GUTTER}>
        {lines.map(line => (
          <Box>
            {line.flatMap(segment => {
              if ('text' in segment) {
                return [<Text {...textProps(segment)}>{segment.text}</Text>]
              }

              if (!('column' in segment)) {
                return []
              }

              return [
                <Box flexShrink={0}>
                  {rowOf(segment).map(span => (
                    <Text {...spanProps(span)}>{span.text}</Text>
                  ))}
                </Box>,
              ]
            })}
          </Box>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: BOARD.id }, async ($, e) => {
    const shown = await read($, view)
    const { Box, Text } = $.ui.resolve(e)
    // Only the terminal has a raster, which is what a mark is spun in.
    const Raster = isAnimated && e.surface === 'terminal' ? $.ui.resolve(e).Raster : undefined
    const motion = isAnimated ? { canSpin: Raster !== undefined, beat } : null
    const keys: string[] = []
    // The pet is a picture of pixels, which only a raster holds. It stands under
    // the list where the pane has the rows for both and an empty one between:
    // the list comes first.
    const PetRaster = e.surface === 'terminal' ? $.ui.resolve(e).Raster : undefined
    const rows = e.props.scroll.bodyRows
    const creature = PetRaster !== undefined && rows >= boardRows(shown) + 1 + PET_ROWS ? pet : null
    isSweating = isHot(shown.limits)
    const frame = creature === null ? null : petNow(creature, await $.clock.now())

    const board = (
      <Box flexDirection="column" paddingLeft={BOARD_GUTTER}>
        {boardOf(shown, frame === null ? rows : rows - 1 - PET_ROWS, motion).map(line => (
          <Box>
            {line.flatMap(segment => {
              if ('text' in segment) {
                return [<Text {...textProps(segment)}>{segment.text}</Text>]
              }

              if (!('spin' in segment) || Raster === undefined) {
                return []
              }

              const key = `spin-${segment.spin}`
              keys.push(key)

              return [<Raster key={key} columns={1} rows={1} cells={spinnerCell(spinFrame)} />]
            })}
          </Box>
        ))}
        {PetRaster === undefined || frame === null
          ? []
          : [
              <Box marginTop={1}>
                <PetRaster key={PET} columns={PET_COLUMNS} rows={PET_ROWS} cells={frame.cells} />
              </Box>,
            ]}
      </Box>
    )

    spun = Raster === undefined ? null : { requestId: e.requestId, keys }
    petPane = frame === null ? null : e.requestId

    if (frame !== null) {
      petX = frame.x
    }

    movePet($)

    return board
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    await seeMode($, e.permission_mode)

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    // Before the first reading there is nothing to compare a measurement with,
    // so it is left for that reading to judge.
    await advance($, last => (last.now === 0 ? last : { ...last, ...measured(e) }))

    return next(e)
  })

  on('turn.start', ($, e, next) => {
    tools = 0

    if (isAnimated) {
      // While Claude works the bars keep glinting, so the band reads as live.
      working?.cancel()
      working = $.clock.every(WORK_GAP_MS, () => sweepBars($))
      $.clock.after(0, () => sweepBars($))
    }

    $.clock.after(0, () => void petTo($, 'working'))

    return next(e)
  })

  on('tool.call', ($, e, next) => {
    // A question put to the person is no tool of the turn's, whoever asks it:
    // Claude, or a mod that holds a risky command until the person approves it.
    if (e.agentId === undefined && e.tool !== 'AskUserQuestion') {
      tools += 1
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }

    working?.cancel()
    working = null

    const turn = { seconds: Math.round(e.durationMs / 1000), tools }
    await update($, view, last => ({ ...last, turn }))
    $.clock.after(0, () => void refresh($))
    $.clock.after(0, () => void petTo($, 'done'))

    return next(e)
  })

  on('classic.Stop', async ($, e, next) => {
    const effort = e.effort?.level ?? ''
    await update($, view, last => ({ ...last, effort }))
    await seeMode($, e.permission_mode)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = await read($, view)

    // A survey is drawn in a place of its own, so the band stays up beside it.
    // Where the Status tab is on screen, the status is there.
    if (position === 'below' || shown.now === 0 || (await isTabPlaced($, shown))) {
      return next(e)
    }

    const { Box } = $.ui.resolve(e)
    const { rows, longest } = rowsOf($, e, shown)
    reach = longest

    return (
      <Box flexDirection="column" paddingTop={1}>
        {rows.map(row => (
          <Box>{row}</Box>
        ))}
      </Box>
    )
  })

  // Claude Code keeps no band under the prompt, so there the rows stand in the
  // place of its hint. It draws them after its own mode pill, on the pill's
  // line: the first row follows the pill there, so the pill leads the band, and
  // the others are pulled back to stand under it.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const shown = await read($, view)

    if (position !== 'below' || shown.now === 0 || (await isTabPlaced($, shown))) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const { rows, longest } = rowsOf($, e, shown)
    const [first = [], ...others] = rows
    const more = hintRest(e.props.hint)
    reach = longest

    return (
      <Box flexDirection="column">
        <Box>
          {[
            ...first,
            ...(more === '' ? [] : [<Text dimColor wrap="truncate-end">{` · ${more}`}</Text>]),
          ]}
        </Box>
        <Box flexDirection="column" {...(e.surface === 'terminal' && { marginLeft: -hintShift(shown.mode) })}>
          {others.map(row => (
            <Box>{row}</Box>
          ))}
        </Box>
      </Box>
    )
  })
}
