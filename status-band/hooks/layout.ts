import type { Git, Peer, View } from '../types'

import {
  PALETTE,
  clampPercent,
  cost,
  duration,
  gradient,
  modelName,
  remaining,
  remainingLong,
  resetClock,
  resetDate,
  shortModel,
  shortPath,
} from './format'
import type { BarKind, Rgb } from './format'

export type Segment =
  | { text: string; color?: Rgb; isBold?: boolean }
  | { bar: BarKind; percent: number; width: number; pace?: number }
  // A mark that spins, one column wide, named after the session it stands beside.
  | { spin: string }
  // One row of a bar stood upright: `row` 0 is its cap, then its body from the top.
  | { column: BarKind; percent: number; height: number; width: number; row: number; pace?: number }

const SIZES = ['xsmall', 'small', 'medium', 'large', 'xlarge'] as const

export type Size = (typeof SIZES)[number]

const HOUR = 3_600_000

const STALE_AFTER = 6 * HOUR

const WIDE = {
  large: { width: 20, fiveHour: 'Usage 5H', sevenDay: 'Usage 7D', star: '⭐', resets: 'Reset in' },
  xlarge: { width: 40, fiveHour: '5H Limit', sevenDay: '7D Limit', star: '🌟', resets: 'Resets in' },
} as const

export const text = (value: string, color?: Rgb): Segment =>
  color === undefined ? { text: value } : { text: value, color }

export const bold = (value: string, color?: Rgb): Segment => ({ ...text(value, color), isBold: true })

const bar = (kind: BarKind, percent: number, width: number, pace?: number): Segment =>
  pace === undefined ? { bar: kind, percent, width } : { bar: kind, percent, width, pace }

// How long each limit's window is, to tell how much of it has passed.
const FIVE_HOURS = 5 * HOUR

const SEVEN_DAYS = 7 * 24 * HOUR

// How far through a window that ends at `resetsAt` the clock stands, in percent.
const paceOf = (resetsAt: number | null | undefined, window: number, now: number) =>
  resetsAt === null || resetsAt === undefined
    ? undefined
    : clampPercent(100 - ((resetsAt - now) * 100) / window)

const SEPARATOR = text(' │ ')

const LOADING = [text(' '), text('(loading..)', PALETTE.overlay)]

// The groups that have something to show, a separator between each two.
const joined = (groups: Segment[][]) =>
  groups
    .filter(group => group.length > 0)
    .flatMap((group, i) => (i === 0 ? group : [SEPARATOR, ...group]))

const isClean = (git: Git) => git.staged + git.unstaged + git.untracked === 0

export const readingsOf = (view: View) => {
  const fiveHour = view.limits.find(limit => limit.kind === 'five_hour')
  const sevenDay = view.limits.find(limit => limit.kind === 'seven_day')
  // A reading from a window that has rolled over describes last week.
  const codex = view.codex !== null && view.codex.resetsAt >= view.now ? view.codex : null

  return {
    hasLimits: fiveHour !== undefined,
    context: clampPercent(view.contextPercent),
    fiveHour: clampPercent(fiveHour?.percentUsed ?? 0),
    fiveHourResetsAt: fiveHour?.resetsAt ?? null,
    sevenDay: clampPercent(sevenDay?.percentUsed ?? 0),
    sevenDayResetsAt: sevenDay?.resetsAt ?? null,
    codex: clampPercent(codex?.percent ?? 0),
    liveCodex: codex,
    pace: {
      context: undefined,
      fiveHour: paceOf(fiveHour?.resetsAt, FIVE_HOURS, view.now),
      sevenDay: paceOf(sevenDay?.resetsAt, SEVEN_DAYS, view.now),
      codex: paceOf(codex?.resetsAt, SEVEN_DAYS, view.now),
    } satisfies Record<BarKind, number | undefined>,
  }
}

export const modelOf = (view: View, isShort: boolean) => {
  const name = modelName(view.model)

  return [
    text('🤖 '),
    bold(isShort ? shortModel(name) : name, PALETTE.teal),
    ...(view.effort === '' ? [] : [text(` ⚡${view.effort}`, PALETTE.peach)]),
  ]
}

const branchOf = ({ git }: View) => {
  if (git === null || git.branch === '') {
    return []
  }

  const ahead = git.ahead > 0 ? ` ↑${git.ahead}` : ''
  const behind = git.behind > 0 ? ` ↓${git.behind}` : ''

  return [text(` 🌿(${git.branch})${ahead}${behind}`, PALETTE.latteGreen)]
}

const placeOf = (view: View, isShort: boolean) => [
  text('📂 '),
  text(isShort ? shortPath(view.cwd, view.home) : view.cwd, PALETTE.subtext),
  ...branchOf(view),
]

export const gitOf = ({ git }: View) => {
  if (git === null) {
    return [text('🌿 '), text('no git', PALETTE.overlay)]
  }

  if (isClean(git)) {
    return [text('✅ clean', PALETTE.latteGreen)]
  }

  const staged = git.staged > 0 ? `+${git.staged}` : ''
  const unstaged = git.unstaged > 0 ? `!${git.unstaged}` : ''
  const untracked = git.untracked > 0 ? `?${git.untracked}` : ''

  return [text(`📝${staged}${unstaged}${untracked}`, PALETTE.latteYellow)]
}

export const envOf = (view: View) => [
  text('🐍 '),
  view.env === '' ? text('no env', PALETTE.overlay) : text(view.env, PALETTE.green),
]

// The plan stands with the model and its effort, as one group: what the session runs on.
export const accountOf = (view: View) =>
  view.account === '' ? [] : [text(' 💎 '), text(view.account, PALETTE.lavender)]

export const styleOf = (view: View) =>
  view.style === '' ? [] : [text('🎨 '), text(view.style, PALETTE.peach)]

// `frames` is what the icon shows beat after beat, in a round, where it may move.
export type PeerState = { icon: string; frames?: string[]; word: string; color: Rgb; rank: number }

// What another session is doing, as its pane says it, and where it stands
// among the others: the ones the person is needed at come first.
const ASKING: PeerState = { icon: '🙋 ', word: 'needs you', color: PALETTE.pink, rank: 0 }

// The twelve faces of a clock, an hour on from each to the next: time passes
// at a session that waits. Only the small hand moves, so a beat is no flash.
const CLOCK = ['🕐 ', '🕑 ', '🕒 ', '🕓 ', '🕔 ', '🕕 ', '🕖 ', '🕗 ', '🕘 ', '🕙 ', '🕚 ', '🕛 ']

// An icon that rests four beats and shows another on the fifth.
const blinking = (icon: string, other: string) => [icon, icon, icon, icon, other]

const PEER_STATES: Record<string, PeerState> = {
  // A check stood here first and read as "done", which is not what the row says.
  idle: { icon: '🕐 ', frames: CLOCK, word: 'waiting', color: PALETTE.green, rank: 1 },
  // No emoji is the shell's twin, so a wave washes over it.
  shell: { icon: '🐚 ', frames: blinking('🐚 ', '🌊 '), word: 'shell', color: PALETTE.overlay, rank: 2 },
  busy: { icon: '⏳ ', word: 'working', color: PALETTE.peach, rank: 3 },
}

export const stateOf = (peer: Peer): PeerState =>
  peer.needs === ''
    ? (PEER_STATES[peer.status] ?? { icon: '', word: peer.status, color: PALETTE.subtext, rank: 4 })
    : ASKING

const BLANK = [text(' ')]

// What may move in the pane: whether it can spin a mark in place, and the beat
// the icons move to.
export type Motion = { canSpin: boolean; beat: number }

// Whether a session is at work: the one state whose mark spins.
export const isAtWork = (peer: Peer) => stateOf(peer) === PEER_STATES.busy

// Whether a session's icon moves to the beat: a session that needs an answer
// keeps a still icon, which is what should catch the eye, not a motion.
export const hasBeat = (peer: Peer) => stateOf(peer).frames !== undefined

// How many rows the list takes when every session is named: two a session and
// an empty one between, or the one line that says there is none.
export const boardRows = (view: View) => (view.peers.length === 0 ? 1 : view.peers.length * 3 - 1)

// The other sessions running on this machine, as the lines of their pane: a
// name and under it what the session is doing, an empty line between two.
// Among those in the same state the one that changed last comes first, and
// what `rows` has no room for is counted on a last line. With a `motion`, a
// session at work gets a spinner where the pane can spin one, and the icons of
// the others move, each session a beat ahead of the one above it, so that two
// clocks do not show the same hour and two shells are not under the wave together.
export const boardOf = (
  view: View,
  rows = Number.POSITIVE_INFINITY,
  motion: Motion | null = null,
): Segment[][] => {
  if (view.peers.length === 0) {
    return [[text('No other sessions open.', PALETTE.overlay)]]
  }

  const ranked = [...view.peers].sort((a, b) => stateOf(a).rank - stateOf(b).rank || b.since - a.since)
  const room = Math.max(1, Math.floor((rows + 1) / 3))
  const shown = ranked.slice(0, ranked.length > room ? Math.max(1, room - 1) : room)
  const unnamed = ranked.length - shown.length
  const lines = shown.flatMap((peer, i) => {
    const state = stateOf(peer)
    const { word, color, frames } = state
    const icon =
      motion === null || frames === undefined
        ? state.icon
        : (frames[(motion.beat + i) % frames.length] ?? state.icon)
    // A spinner is one column and two spaces: as wide as an icon and the space after it.
    const mark =
      motion?.canSpin === true && isAtWork(peer)
        ? [{ spin: peer.id }, text('  ')]
        : icon === ''
          ? []
          : [text(icon)]

    return [
      ...(i > 0 ? [BLANK] : []),
      [...mark, bold(peer.name, PALETTE.subtext)],
      [text('   '), text(`${word} ${duration(Math.max(0, view.now - peer.since))}`, color)],
    ]
  })

  return unnamed > 0 ? [...lines, BLANK, [text(`+${unnamed} more`, PALETTE.overlay)]] : lines
}

export const costOf = (view: View) => [text('💰 '), text(cost(view.costUsd), PALETTE.yellow)]

export const timeOf = (view: View) => [
  text('⏰ '),
  text(duration(view.now - view.startedAt), PALETTE.subtext),
]

// The last turn as two groups: how long it took, and how many tools it called.
export const turnOf = ({ turn }: View) =>
  turn === null
    ? []
    : [
        [text('⌛ '), text(`last ${duration(turn.seconds * 1000)}`, PALETTE.subtext)],
        [
          text('🔧 '),
          text(`${turn.tools} ${turn.tools === 1 ? 'tool' : 'tools'}`, PALETTE.subtext),
        ],
      ]

const codexNoteOf = (view: View) => {
  const { liveCodex } = readingsOf(view)

  if (liveCodex === null) {
    return [
      text(view.codex === null ? 'no codex data' : 'window reset — run codex to refresh', PALETTE.overlay),
    ]
  }

  const age = view.now - liveCodex.readAt
  const left = remainingLong(liveCodex.resetsAt - view.now)

  return [
    text(`⏳ Resets in ${left}, 📅 ${resetDate(liveCodex.resetsAt)}`, PALETTE.codexGreen),
    ...(liveCodex.readAt > 0 && age >= STALE_AFTER
      ? [text(` (read ${Math.round(age / HOUR)}h ago)`, PALETTE.overlay)]
      : []),
  ]
}

const wideLines = (view: View, size: keyof typeof WIDE) => {
  const words = WIDE[size]
  const read = readingsOf(view)
  const { now } = view
  const fiveHourLeft = read.fiveHourResetsAt === null ? 'N/A' : remaining(read.fiveHourResetsAt - now)
  const fiveHourAt = read.fiveHourResetsAt === null ? 'N/A' : resetClock(read.fiveHourResetsAt)
  const sevenDayLeft = read.sevenDayResetsAt === null ? 'N/A' : remainingLong(read.sevenDayResetsAt - now)
  const sevenDayAt = read.sevenDayResetsAt === null ? 'N/A' : resetDate(read.sevenDayResetsAt)
  const limitOf = (
    icon: string,
    label: string,
    color: Rgb,
    kind: BarKind,
    percent: number,
    resets: string,
  ) =>
    read.hasLimits
      ? [
          text(`${icon} `),
          text(label, color),
          text(' '),
          bar(kind, percent, words.width, read.pace[kind]),
          text(' '),
          bold(`${percent}%`, color),
          text(' '),
          text(resets, color),
        ]
      : [text(`${icon} `), text(label, color), text(' '), bar(kind, 0, words.width), text(' 0%'), ...LOADING]

  return [
    joined([[...modelOf(view, false), ...accountOf(view)], styleOf(view)]),
    joined([placeOf(view, false), gitOf(view), envOf(view)]),
    joined([costOf(view), timeOf(view), ...turnOf(view)]),
    [
      text('🧠 '),
      text('Context', PALETTE.pink),
      text('  '),
      bar('context', read.context, words.width),
      text(' '),
      bold(`${read.context}% used`, PALETTE.pink),
      text(' '),
      text(
        `(${Math.round(view.contextTokens / 1000)}k/${Math.round(view.contextWindow / 1000)}k)`,
        PALETTE.pink,
      ),
    ],
    limitOf(
      '🚀',
      words.fiveHour,
      PALETTE.lavender,
      'fiveHour',
      read.fiveHour,
      `⏳ ${words.resets} ${fiveHourLeft}, 🕐 ${fiveHourAt}`,
    ),
    limitOf(
      words.star,
      words.sevenDay,
      PALETTE.yellow,
      'sevenDay',
      read.sevenDay,
      `⏳ ${words.resets} ${sevenDayLeft}, 📅 ${sevenDayAt}`,
    ),
    [
      text('🌀 '),
      text('Codex 7D', PALETTE.codexGreen),
      text(' '),
      bar('codex', read.codex, words.width, read.pace.codex),
      text(' '),
      bold(`${read.codex}%`, PALETTE.codexGreen),
      text(' '),
      ...codexNoteOf(view),
    ],
  ]
}

const mediumLines = (view: View) => {
  const read = readingsOf(view)

  return [
    joined([[...modelOf(view, false), ...accountOf(view)], styleOf(view)]),
    joined([placeOf(view, false), gitOf(view), envOf(view)]),
    [
      text('📝 '),
      text('Context', PALETTE.pink),
      text(' '),
      bar('context', read.context, 40),
      text(' '),
      bold(`${read.context}% used`),
    ],
    [
      text('🚀 Usage 5H '),
      bar('fiveHour', read.fiveHour, 10, read.pace.fiveHour),
      text(` ${read.fiveHour}% │ 7D `),
      bar('sevenDay', read.sevenDay, 10, read.pace.sevenDay),
      text(` ${read.sevenDay}%`),
      ...(read.hasLimits ? [] : LOADING),
      SEPARATOR,
      text('CX', PALETTE.codexGreen),
      text(' '),
      bar('codex', read.codex, 10, read.pace.codex),
      text(` ${read.codex}%`),
    ],
  ]
}

const smallLines = (view: View) => {
  const read = readingsOf(view)
  const meterOf = (label: string, color: Rgb, kind: BarKind, percent: number) => [
    text(label, color),
    text(' '),
    bar(kind, percent, 10, read.pace[kind]),
    text(' '),
    bold(`${percent}%`, gradient(kind, percent)),
  ]

  return [
    joined([modelOf(view, false), styleOf(view), placeOf(view, true)]),
    [
      text('🧠 '),
      ...joined([
        meterOf('Context', PALETTE.pink, 'context', read.context),
        meterOf('5H', PALETTE.lavender, 'fiveHour', read.fiveHour),
        meterOf('7D', PALETTE.yellow, 'sevenDay', read.sevenDay),
        meterOf('CX', PALETTE.codexGreen, 'codex', read.codex),
      ]),
      ...(read.hasLimits ? [] : LOADING),
    ],
  ]
}

const xsmallLines = (view: View) => {
  const read = readingsOf(view)
  const status =
    view.git === null
      ? []
      : [isClean(view.git) ? text('✅', PALETTE.green) : text('📝', PALETTE.latteYellow)]

  return [
    [...modelOf(view, true), text(' '), ...placeOf(view, true), ...status],
    [
      text('🧠 '),
      bar('context', read.context, 10),
      text(' '),
      text('5H', PALETTE.lavender),
      bar('fiveHour', read.fiveHour, 10, read.pace.fiveHour),
      text(' '),
      text('7D', PALETTE.yellow),
      bar('sevenDay', read.sevenDay, 10, read.pace.sevenDay),
      text(' '),
      text('CX', PALETTE.codexGreen),
      bar('codex', read.codex, 10, read.pace.codex),
      ...(read.hasLimits ? [] : LOADING),
    ],
  ]
}

export const sizeOf = (value: unknown): Size => SIZES.find(size => size === value) ?? 'xlarge'

// Where the band stands: above the prompt, in the place Claude Code keeps for
// one, or below it, in the place of the hint under the prompt.
export type Position = 'above' | 'below'

export const positionOf = (value: unknown): Position => (value === 'below' ? 'below' : 'above')

// The pill Claude Code draws before the hint, by the mode the session decides
// permissions in: read off its own table of them, and measured on screen.
const PILLS: Record<string, string> = {
  default: '⏸ manual mode on',
  plan: '⏸ plan mode on',
  acceptEdits: '⏵⏵ accept edits on',
  bypassPermissions: '⏵⏵ bypass permissions on',
  dontAsk: "⏵⏵ don't ask on",
  auto: '⏵⏵ auto mode on',
}

// What Claude Code draws between its pill and what a hook returns: " · ".
const PILL_GAP = 3

// How far a row drawn in the hint's place is pulled back to stand under the
// pill: Claude Code draws what a hook returns there after its own pill, which
// a hook can neither restyle nor take away.
export const hintShift = (mode: string) => (PILLS[mode] ?? PILLS.default ?? '').length + PILL_GAP

// What a hint says at rest, whichever mode the session is in: nothing worth a
// place in the band.
const RESTING_HINTS = ['(shift+tab to cycle)', '? for shortcuts']

// What is left of the hint Claude Code would draw once that is taken out.
export const hintRest = (hint: string) =>
  RESTING_HINTS.reduce((rest, phrase) => rest.replace(phrase, ''), hint).replace(/^[\s·]+|[\s·]+$/g, '')

export const linesOf = (view: View, size: Size): Segment[][] => {
  if (size === 'xsmall') {
    return xsmallLines(view)
  }

  if (size === 'small') {
    return smallLines(view)
  }

  return size === 'medium' ? mediumLines(view) : wideLines(view, size)
}
