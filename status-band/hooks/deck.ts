import type { StatusBandPanel, StatusBandRun, View } from '../types'

import { PALETTE, barCells, barSpans, cost, duration, modelName, resetClock, resetDate, rgb, shortPath } from './format'
import type { BarKind, Rgb } from './format'
import { bold, readingsOf, stateOf, text } from './layout'
import type { Segment } from './layout'

// The limits as a panel of the Deck: one flat bar a row, all starting and
// ending in the same columns, and a dim row saying where the session is.

// The least a bar keeps, however narrow the pane.
const MIN_BAR = 5

// A row's name ('5H', 'ctx'), padded to the widest.
const NAME = 3

// The percent, right-aligned: ' 66%', '100%'.
const PERCENT = 4

// A space after the name and after the bar, two before what is said at the right.
const GAPS = 1 + 1 + 2

type BarRow = { name: string; color: Rgb; kind: BarKind; percent: number; pace: number | undefined; right: string }

const LOADING = '(loading..)'

// A count of tokens as the pane has room for it: 58k, 200k, 1M.
const tokens = (count: number) =>
  count >= 1_000_000 ? `${Number((count / 1_000_000).toFixed(1))}M` : `${Math.round(count / 1000)}k`

export const runsOf = (line: readonly Segment[]): StatusBandRun[] =>
  line.flatMap((segment): StatusBandRun[] => {
    if ('text' in segment) {
      return [
        {
          text: segment.text,
          ...(segment.color === undefined ? {} : { color: rgb(segment.color) }),
          ...(segment.isBold === true ? { isBold: true } : {}),
        },
      ]
    }

    if (!('bar' in segment)) {
      return []
    }

    return barSpans(barCells(segment.percent, segment.width, segment.bar, segment.pace)).map(span => ({
      text: span.text,
      color: rgb(span.color),
      ...(span.backgroundColor === undefined ? {} : { backgroundColor: rgb(span.backgroundColor) }),
    }))
  })

const barRowsOf = (view: View): BarRow[] => {
  const read = readingsOf(view)

  return [
    ...(read.hasLimits
      ? [
          {
            name: '5H',
            color: PALETTE.lavender,
            kind: 'fiveHour' as const,
            percent: read.fiveHour,
            pace: read.pace.fiveHour,
            right: read.fiveHourResetsAt === null ? '' : `↻ ${resetClock(read.fiveHourResetsAt)}`,
          },
          {
            name: '7D',
            color: PALETTE.yellow,
            kind: 'sevenDay' as const,
            percent: read.sevenDay,
            pace: read.pace.sevenDay,
            right: read.sevenDayResetsAt === null ? '' : `↻ ${resetDate(read.sevenDayResetsAt)}`,
          },
        ]
      : []),
    ...(read.liveCodex === null
      ? []
      : [
          {
            name: 'CX',
            color: PALETTE.codexGreen,
            kind: 'codex' as const,
            percent: read.codex,
            pace: read.pace.codex,
            right: `↻ ${resetDate(read.liveCodex.resetsAt)}`,
          },
        ]),
    {
      name: 'ctx',
      color: PALETTE.pink,
      kind: 'context',
      percent: read.context,
      pace: undefined,
      right: `${tokens(view.contextTokens)} / ${tokens(view.contextWindow)}`,
    },
  ]
}

const barLine = (row: BarRow, width: number): Segment[] => [
  text(row.name.padEnd(NAME), row.color),
  text(' '),
  row.pace === undefined
    ? { bar: row.kind, percent: row.percent, width }
    : { bar: row.kind, percent: row.percent, width, pace: row.pace },
  text(' '),
  bold(`${row.percent}%`.padStart(PERCENT), row.color),
  text('  '),
  text(row.right, row.color),
]

// Where the session is: the plan it runs on, its folder, its branch and what
// changed there, and the env when one is set; cut to the panel.
const placeOf = (view: View, columns: number): StatusBandRun[] => {
  const { git } = view
  const marks =
    git === null
      ? ''
      : [
          git.ahead > 0 ? `↑${git.ahead}` : '',
          git.behind > 0 ? `↓${git.behind}` : '',
          [git.staged > 0 ? `+${git.staged}` : '', git.unstaged > 0 ? `!${git.unstaged}` : '', git.untracked > 0 ? `?${git.untracked}` : ''].join(''),
        ]
          .filter(part => part !== '')
          .join(' ')
  const branch = git === null || git.branch === '' ? '' : [git.branch, marks].filter(part => part !== '').join(' ')
  const place = [view.account, shortPath(view.cwd, view.home), branch, view.env]
    .filter(part => part !== '')
    .join(' · ')
  const shown = place.length > columns ? `${place.slice(0, Math.max(0, columns - 1))}…` : place

  return [{ text: shown, isDim: true }]
}

const labelOf = (view: View): StatusBandRun[] => [
  { text: modelName(view.model).replace(/ \(1M context\)$/, ''), color: rgb(PALETTE.teal), isBold: true },
  ...(view.effort === '' ? [] : [{ text: ` ${view.effort}`, color: rgb(PALETTE.peach) }]),
]

// The limits in one line: the 5H and 7D windows, once read, and the context.
const summaryOf = (view: View): StatusBandRun[] => {
  const read = readingsOf(view)
  const gap = text(' · ')

  return runsOf([
    ...(read.hasLimits
      ? [text(`5H ${read.fiveHour}%`, PALETTE.lavender), gap, text(`7D ${read.sevenDay}%`, PALETTE.yellow), gap]
      : []),
    text(`ctx ${read.context}%`, PALETTE.pink),
  ])
}

export const limitsPanelOf = (view: View, columns: number): StatusBandPanel => {
  if (view.now === 0) {
    const loading = [{ text: LOADING, color: rgb(PALETTE.overlay) }]

    return { id: 'limits', title: 'limits', right: '', label: [], rows: [loading], summary: loading }
  }

  const bars = barRowsOf(view)
  const widest = Math.max(...bars.map(row => row.right.length))
  const width = Math.max(MIN_BAR, columns - NAME - PERCENT - GAPS - widest)
  const waiting: StatusBandRun[][] = readingsOf(view).hasLimits
    ? []
    : [runsOf([text('5H 7D ', PALETTE.overlay), text(LOADING, PALETTE.overlay)])]

  return {
    id: 'limits',
    title: 'limits',
    right: `${cost(view.costUsd)} · ${duration(view.now - view.startedAt)}`,
    label: labelOf(view),
    rows: [...waiting, ...bars.map(row => runsOf(barLine(row, width))), placeOf(view, columns)],
    summary: summaryOf(view),
  }
}

// What marks a session in the Deck, by its rank among the states: one cell,
// where the Sessions pane has an emoji. Needs you, waiting, shell, working.
const MARKS = ['?', '○', '◌', '●']

// The other sessions as a panel of the Deck: a row a session, ranked as the
// Sessions pane ranks them, its mark, its name and, at the right, what it is
// doing and since when. None open, or nothing read yet: no rows.
export const sessionsPanelOf = (view: View, columns: number, rows: number): StatusBandPanel => {
  const needing = view.peers.filter(peer => stateOf(peer).rank === 0).length
  const summary: StatusBandRun[] = [
    { text: `${view.peers.length} open` },
    ...(needing > 0 ? [{ text: ` · ${needing} needs you`, color: rgb(PALETTE.pink) }] : []),
  ]
  const panel: StatusBandPanel = { id: 'sessions', title: 'sessions', right: `${view.peers.length} open`, label: [], rows: [], summary }

  if (view.now === 0 || view.peers.length === 0) {
    return panel
  }

  const ranked = [...view.peers].sort((a, b) => stateOf(a).rank - stateOf(b).rank || b.since - a.since)
  const room = Math.max(1, rows)
  const shown = ranked.length > room ? ranked.slice(0, room - 1) : ranked
  const lines = shown.map((peer): StatusBandRun[] => {
    const state = stateOf(peer)
    const ink = rgb(state.color)
    const doing = `${state.word} ${duration(Math.max(0, view.now - peer.since))}`
    const space = Math.max(1, columns - 2 - doing.length - 1)
    const name = peer.name.length > space ? `${peer.name.slice(0, Math.max(0, space - 1))}…` : peer.name

    return [
      { text: `${MARKS[state.rank] ?? '·'} `, color: ink },
      { text: name, color: rgb(PALETTE.subtext), isBold: true },
      { text: ' '.repeat(Math.max(1, columns - 2 - name.length - doing.length)) },
      { text: doing, color: ink },
    ]
  })
  const more = ranked.length - shown.length

  return { ...panel, rows: more > 0 ? [...lines, [{ text: `+${more} more`, isDim: true }]] : lines }
}
