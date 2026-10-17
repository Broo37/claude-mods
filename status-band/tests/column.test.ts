import { expect, test } from 'claude-code/testing'

import { boxHeight, columnRows } from '../hooks/column'
import { MARKER_LUMA, gradient, lit, toned } from '../hooks/format'
import type { BarSpan } from '../hooks/format'

// A bar as the glyphs of its rows, top to bottom.
const glyphs = (rows: BarSpan[][]) => rows.map(row => row.map(span => span.text).join(''))

test('stands a box of whole rows on the bottom, a whisker above it and a cap on top', () => {
  expect(glyphs(columnRows({ kind: 'fiveHour', percent: 50, height: 4, width: 5 }, null))).toEqual([
    '──┬──',
    '  │  ',
    '  │  ',
    '▄▄▄▄▄',
    '▄▄▄▄▄',
  ])
})

test('fills the top of the box in eighths of a row', () => {
  expect(glyphs(columnRows({ kind: 'fiveHour', percent: 30, height: 4, width: 5 }, null))[3]).toBe('▂▂▂▂▂')
})

test('stands an empty bar on a base and fills a full one up to its cap', () => {
  expect(glyphs(columnRows({ kind: 'sevenDay', percent: 0, height: 3, width: 5 }, null))).toEqual([
    '──┬──',
    '  │  ',
    '  │  ',
    '──┴──',
  ])
  expect(glyphs(columnRows({ kind: 'sevenDay', percent: 100, height: 2, width: 3 }, null))).toEqual(['─┬─', '▄▄▄', '▄▄▄'])
})

test('shades the box from the bottom up, two colors a row', () => {
  const [, top, bottom] = columnRows({ kind: 'fiveHour', percent: 100, height: 2, width: 5 }, null)

  expect(bottom).toEqual([{ text: '▄▄▄▄▄', color: gradient('fiveHour', 0), backgroundColor: gradient('fiveHour', 25) }])
  expect(top).toEqual([{ text: '▄▄▄▄▄', color: gradient('fiveHour', 50), backgroundColor: gradient('fiveHour', 75) }])
})

test('marks the pace on the whisker as a heavy stroke across it, brighter than the whisker', () => {
  const rows = columnRows({ kind: 'fiveHour', percent: 20, height: 5, width: 5, pace: 60 }, null)

  expect(glyphs(rows)[2]).toBe('━━╋━━')
  expect(rows[2]?.[0]?.color).toEqual(toned(gradient('fiveHour', 20), MARKER_LUMA))
})

test('cuts the pace into the box as a dark stroke, a part-filled row counting as the box', () => {
  expect(glyphs(columnRows({ kind: 'codex', percent: 80, height: 5, width: 5, pace: 20 }, null))[4]).toBe('━━━━━')
  expect(glyphs(columnRows({ kind: 'codex', percent: 30, height: 4, width: 5, pace: 30 }, null))[3]).toBe('━━━━━')
})

test('keeps a reading or a pace out of range inside the bar', () => {
  expect(glyphs(columnRows({ kind: 'context', percent: 140, height: 2, width: 3 }, null))).toEqual(['─┬─', '▄▄▄', '▄▄▄'])
  expect(glyphs(columnRows({ kind: 'context', percent: -5, height: 2, width: 3 }, null))).toEqual(['─┬─', ' │ ', '─┴─'])
  expect(glyphs(columnRows({ kind: 'fiveHour', percent: 0, height: 4, width: 3, pace: 100 }, null))[1]).toBe('━╋━')
})

test('keeps every row as wide as its bar, the whisker in the middle', () => {
  for (const width of [3, 7]) {
    const rows = glyphs(columnRows({ kind: 'sevenDay', percent: 45, height: 6, width, pace: 70 }, null))

    expect(rows.every(row => row.length === width)).toBe(true)
    expect(rows[1]?.indexOf('│')).toBe((width - 1) / 2)
  }
})

test('lightens the box near the glint, most at its head, and leaves the whisker alone', () => {
  const bar = { kind: 'fiveHour', percent: 40, height: 5, width: 5 } as const
  const still = columnRows(bar, null)
  const glinting = columnRows(bar, 0)

  expect(glinting[5]?.[0]?.color).toEqual(lit(still[5]?.[0]?.color ?? [0, 0, 0], 0.6))
  expect(glinting[4]?.[0]?.color).toEqual(lit(still[4]?.[0]?.color ?? [0, 0, 0], 0.35))
  expect(glinting[1]).toEqual(still[1])
})

test('says how many rows a box touches', () => {
  expect(boxHeight(30, 4)).toBe(2)
  expect(boxHeight(0, 10)).toBe(0)
  expect(boxHeight(100, 10)).toBe(10)
})
