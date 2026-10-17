import type { View } from '../types'

import { PALETTE, remainingShort, resetClock, resetDate, shortPath } from './format'
import type { BarKind, Rgb } from './format'
import { accountOf, bold, costOf, envOf, gitOf, modelOf, readingsOf, styleOf, text, timeOf, turnOf } from './layout'
import type { Segment } from './layout'

// The Status tab of the dock: the band's text rows stacked to fit its width,
// the four bars stood upright side by side, and when each limit resets.

const HOUR = 3_600_000

// A Codex reading older than this is said to be old.
const STALE_AFTER = 6 * HOUR

// The bars, left to right, each with the label under it and its color.
const BARS: readonly { kind: BarKind; label: string; color: Rgb }[] = [
  { kind: 'fiveHour', label: '5H', color: PALETTE.lavender },
  { kind: 'sevenDay', label: '7D', color: PALETTE.yellow },
  { kind: 'codex', label: 'CX', color: PALETTE.codexGreen },
  { kind: 'context', label: 'Ctx', color: PALETTE.pink },
]

// The rows a bar stands in: as many as the tab spares, within these.
const TALLEST = 10

const SHORTEST = 4

// What the percent of a limit says before the session has reported it.
const UNKNOWN = '…'

const BLANK: Segment[] = [text(' ')]

// How wide each bar is and how far apart they stand, for a tab this wide: an
// odd width, so the whisker has a middle, from 3 to 7, at least 2 apart.
export const columnGeometry = (columns: number) => {
  const most = Math.floor((columns - 6) / 4)
  const width = Math.min(7, Math.max(3, most % 2 === 0 ? most - 1 : most))

  return { width, gap: Math.max(2, Math.floor((columns - 4 * width) / 3)) }
}

// The groups that have something to show, a dot between each two.
const dotted = (groups: Segment[][]) =>
  groups.filter(group => group.length > 0).flatMap((group, i) => (i === 0 ? group : [text(' · '), ...group]))

const branchOf = ({ git }: View) => {
  if (git === null || git.branch === '') {
    return []
  }

  const ahead = git.ahead > 0 ? ` ↑${git.ahead}` : ''
  const behind = git.behind > 0 ? ` ↓${git.behind}` : ''

  return [text(`🌿 ${git.branch}${ahead}${behind}`, PALETTE.latteGreen)]
}

const textRowsOf = (view: View) =>
  [
    [...modelOf(view, false), ...accountOf(view)],
    styleOf(view),
    [text('📂 '), text(shortPath(view.cwd, view.home), PALETTE.subtext)],
    dotted([branchOf(view), gitOf(view), envOf(view)]),
    dotted([costOf(view), timeOf(view)]),
    dotted(turnOf(view)),
  ].filter(row => row.length > 0)

const resetLinesOf = (view: View) => {
  const read = readingsOf(view)
  const { now } = view
  const limit = view.limits.find(each => each.kind === 'five_hour')
  const week = view.limits.find(each => each.kind === 'seven_day')
  const lines: Segment[][] = []
  const line = (value: string, color: Rgb) => lines.push([text(value, color)])
  const left = (at: number | null | undefined) => (at === null || at === undefined ? 'N/A' : remainingShort(at - now))

  if (read.hasLimits) {
    line(`🚀 5H  ⏳ ${left(limit?.resetsAt)}${limit?.resetsAt == null ? '' : ` · 🕐 ${resetClock(limit.resetsAt)}`}`, PALETTE.lavender)
    line(`🌟 7D  ⏳ ${left(week?.resetsAt)}${week?.resetsAt == null ? '' : ` · 📅 ${resetDate(week.resetsAt)}`}`, PALETTE.yellow)
  } else {
    line('🚀 5H  (loading..)', PALETTE.lavender)
    line('🌟 7D  (loading..)', PALETTE.yellow)
  }

  const codex = read.liveCodex

  if (codex === null) {
    line(view.codex === null ? '🌀 CX  no codex data' : '🌀 CX  window reset — run codex to refresh', PALETTE.codexGreen)
  } else {
    line(`🌀 CX  ⏳ ${remainingShort(codex.resetsAt - now)} · 📅 ${resetDate(codex.resetsAt)}`, PALETTE.codexGreen)

    if (codex.readAt > 0 && now - codex.readAt >= STALE_AFTER) {
      line(`   (read ${Math.round((now - codex.readAt) / HOUR)}h ago)`, PALETTE.overlay)
    }
  }

  line(`🧠 ${Math.round(view.contextTokens / 1000)}k / ${Math.round(view.contextWindow / 1000)}k tokens`, PALETTE.pink)

  return lines
}

// A word in the middle of a bar's width.
const centered = (value: string, width: number) => {
  const before = Math.max(0, Math.floor((width - value.length) / 2))

  return `${' '.repeat(before)}${value}${' '.repeat(Math.max(0, width - value.length - before))}`
}

// The tab's lines, top to bottom, for a tab `columns` wide and `rows` tall.
// Where it is short the bars give up rows first, down to four; then the reset
// lines go, then the text rows: the bars stay.
export const tabLinesOf = (view: View, columns: number, rows: number): Segment[][] => {
  const read = readingsOf(view)
  const { width, gap } = columnGeometry(columns)
  const between = text(' '.repeat(gap))
  const textRows = textRowsOf(view)
  const resets = resetLinesOf(view)
  const across = (each: (bar: (typeof BARS)[number]) => Segment) =>
    BARS.flatMap((bar, i) => (i === 0 ? [each(bar)] : [between, each(bar)]))
  const linesFor = (height: number, hasText: boolean, hasResets: boolean) =>
    (hasText ? textRows.length + 1 : 0) + height + 3 + (hasResets ? resets.length + 1 : 0)
  const height = Math.min(TALLEST, Math.max(SHORTEST, rows - linesFor(0, true, true)))
  const hasResets = linesFor(height, true, true) <= rows
  const hasText = hasResets || linesFor(height, true, false) <= rows
  const percentOf = (kind: BarKind) => read[kind]
  const isUnknown = (kind: BarKind) => !read.hasLimits && (kind === 'fiveHour' || kind === 'sevenDay')

  const chart = [
    across(({ kind, color }) => bold(centered(isUnknown(kind) ? UNKNOWN : `${percentOf(kind)}%`, width), color)),
    ...Array.from({ length: height + 1 }, (_, row) =>
      across(({ kind }) => {
        const pace = read.pace[kind]

        return { column: kind, percent: percentOf(kind), height, width, row, ...(pace !== undefined && { pace }) }
      }),
    ),
    across(({ label, color }) => text(centered(label, width), color)),
  ]

  return [...(hasText ? [...textRows, BLANK] : []), ...chart, ...(hasResets ? [BLANK, ...resets] : [])]
}
