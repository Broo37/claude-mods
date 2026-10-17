import { expect, test } from 'claude-code/testing'

import type { View } from '../types'
import type { Segment } from '../hooks/layout'
import { columnGeometry, tabLinesOf } from '../hooks/tab'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

// A Monday afternoon, local time, so the reset wording does not depend on the time zone.
const NOW = new Date(2026, 9, 5, 16, 45).getTime()

const VIEW: View = {
  now: NOW,
  model: 'claude-opus-5-5',
  effort: 'high',
  style: 'default',
  cwd: 'C:\\Users\\admin\\project',
  home: 'C:\\Users\\admin',
  env: '',
  account: '',
  contextTokens: 86_400,
  contextWindow: 200_000,
  contextPercent: 43,
  limits: [
    { kind: 'five_hour', percentUsed: 42, resetsAt: NOW + 2 * HOUR + 15 * MINUTE },
    { kind: 'seven_day', percentUsed: 18, resetsAt: new Date(2026, 9, 8, 19, 0).getTime() },
  ],
  costUsd: 1.234,
  isBoardClosed: false,
  isStatusClosed: false,
  mode: '',
  peers: [],
  startedAt: NOW - HOUR - 2 * MINUTE,
  git: { branch: 'main', ahead: 0, behind: 0, staged: 5, unstaged: 12, untracked: 0 },
  codex: { percent: 26, resetsAt: new Date(2026, 9, 9, 8, 30).getTime(), readAt: NOW - HOUR },
  turn: null,
}

// A line as plain text, each slice of an upright bar written as its width.
const written = (line: Segment[]) =>
  line.map(segment => ('column' in segment ? `[col ${segment.width}]` : 'text' in segment ? segment.text : '')).join('')

const columnsIn = (lines: Segment[][]) =>
  lines.flat().filter((segment): segment is Extract<Segment, { column: string }> => 'column' in segment)

test('sizes the bars to the tab: odd, 3 to 7 wide, at least 2 apart', () => {
  expect(columnGeometry(30)).toEqual({ width: 5, gap: 3 })
  expect(columnGeometry(50)).toEqual({ width: 7, gap: 7 })
  expect(columnGeometry(20)).toEqual({ width: 3, gap: 2 })
})

test('stacks the text rows of the band at the top of the tab', () => {
  expect(tabLinesOf(VIEW, 30, 40).slice(0, 5).map(written)).toEqual([
    '🤖 Opus 5.5 ⚡high',
    '🎨 default',
    '📂 ~\\project',
    '🌿 main · 📝+5!12 · 🐍 no env',
    '💰 $ 1.23 · ⏰ 1h2m',
  ])
})

test('adds the last turn under the text rows once a turn has ended', () => {
  expect(tabLinesOf({ ...VIEW, turn: { seconds: 19, tools: 2 } }, 30, 40).map(written)[5]).toBe('⌛ last 19s · 🔧 2 tools')
})

test('stands the four bars side by side, the percent above each and its label under it', () => {
  const lines = tabLinesOf(VIEW, 30, 40).map(written)

  expect(lines).toContain(' 42%     18%     26%     43% ')
  expect(lines).toContain(' 5H      7D      CX      Ctx ')
  expect(lines.filter(line => line === '[col 5]   [col 5]   [col 5]   [col 5]')).toHaveLength(11)
})

test('gives each bar its reading, a row of it a line, and the context bar no pace', () => {
  const lines = tabLinesOf(VIEW, 30, 40)
  const first = lines.find(line => line.some(segment => 'column' in segment)) ?? []
  const columns = columnsIn([first])

  expect(columns.map(({ column, percent, height, row }) => [column, percent, height, row])).toEqual([
    ['fiveHour', 42, 10, 0],
    ['sevenDay', 18, 10, 0],
    ['codex', 26, 10, 0],
    ['context', 43, 10, 0],
  ])
  expect(columns.slice(0, 3).every(column => column.pace !== undefined)).toBe(true)
  expect(columns.at(-1)).not.toHaveProperty('pace')
  expect(columnsIn(lines).filter(column => column.column === 'fiveHour').map(column => column.row)).toEqual([
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  ])
})

test('says when each limit resets in a line short enough for the tab', () => {
  expect(tabLinesOf(VIEW, 30, 40).slice(-4).map(written)).toEqual([
    '🚀 5H  ⏳ 2h15m · 🕐 19:00',
    '🌟 7D  ⏳ 3d2h · 📅 Thu 19:00',
    '🌀 CX  ⏳ 3d15h · 📅 Fri 08:30',
    '🧠 86k / 200k tokens',
  ])
})

test('gives the bars fewer rows in a short tab, then drops the reset lines, then the text rows', () => {
  const heightIn = (rows: number) => columnsIn(tabLinesOf(VIEW, 30, rows))[0]?.height

  expect(heightIn(24)).toBe(10)
  expect(heightIn(20)).toBe(6)
  expect(heightIn(17)).toBe(4)
  expect(tabLinesOf(VIEW, 30, 17).map(written).some(line => line.startsWith('🚀'))).toBe(false)
  expect(tabLinesOf(VIEW, 30, 17).map(written)[0]).toBe('🤖 Opus 5.5 ⚡high')
  expect(heightIn(12)).toBe(4)
  expect(tabLinesOf(VIEW, 30, 12).map(written).some(line => line.startsWith('🤖'))).toBe(false)

  for (const rows of [24, 20, 17, 12]) {
    expect(tabLinesOf(VIEW, 30, rows).length).toBeLessThanOrEqual(rows)
  }
})

test('widens the bars in a wider tab', () => {
  expect(columnsIn(tabLinesOf(VIEW, 50, 40))[0]?.width).toBe(7)
})

test('says the limits are loading before the session has reported them', () => {
  const lines = tabLinesOf({ ...VIEW, limits: [] }, 30, 40).map(written)

  expect(lines).toContain('🚀 5H  (loading..)')
  expect(lines).toContain('🌟 7D  (loading..)')
  expect(lines).toContain('  …       …      26%     43% ')
})

test('notes a stale Codex reading on a line of its own', () => {
  const stale = { ...VIEW, codex: { percent: 26, resetsAt: new Date(2026, 9, 9, 8, 30).getTime(), readAt: NOW - 7 * HOUR } }

  expect(tabLinesOf(stale, 30, 40).map(written)).toContain('   (read 7h ago)')
})

test('says so when there is no Codex reading', () => {
  expect(tabLinesOf({ ...VIEW, codex: null }, 30, 40).map(written)).toContain('🌀 CX  no codex data')
})
