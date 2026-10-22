import type { StatusBandPanel, StatusBandRun, View } from '../types'

import { PALETTE, barCells, barSpans, cost, duration, modelName, resetClock, resetDate, rgb, shortPath } from './format'
import type { BarKind, Rgb } from './format'
import { bold, readingsOf, text } from './layout'
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

export const limitsPanelOf = (view: View, columns: number): StatusBandPanel => {
  if (view.now === 0) {
    return { id: 'limits', title: 'limits', right: '', label: [], rows: [[{ text: LOADING, color: rgb(PALETTE.overlay) }]] }
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
  }
}
