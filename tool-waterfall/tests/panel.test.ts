import { expect, test } from 'claude-code/testing'

import { linesOf } from '../hooks/chart'
import type { Call, Turn } from '../hooks/chart'
import { timelinePanelOf } from '../hooks/panel'

const call = (id: string, tool: string, start: number, end: number | null, isError = false): Call => ({
  id,
  tool,
  label: id,
  start,
  end,
  isError,
})

const RUNNING: Turn = { calls: [call('a', 'Read', 0, 1200), call('b', 'Bash', 1500, null)], lasted: null }

const ENDED: Turn = { calls: [call('a', 'Read', 0, 1200), call('b', 'Bash', 1500, 9000, true)], lasted: 41_000 }

const plain = (rows: readonly (readonly { text: string }[])[]) => rows.map(row => row.map(run => run.text).join(''))

test('lends no rows before any turn, so the Deck hides the panel', () => {
  expect(timelinePanelOf(null, 0, 43, 10).rows).toEqual([])
})

test('shows a running turn from its start, saying no tool has been called yet', () => {
  const panel = timelinePanelOf({ calls: [], lasted: null }, 3000, 43, 10)

  expect(panel).toMatchObject({ title: 'this turn', right: '3s running', isLive: true })
  expect(plain(panel.rows)).toEqual(['no tool calls yet'])
  expect(panel.rows[0]?.[0]?.color).toBe('inactive')
})

test('lends no rows for an ended turn that called no tool', () => {
  expect(timelinePanelOf({ calls: [], lasted: 3000 }, 0, 43, 10).rows).toEqual([])
})

test('titles a running turn this turn, says how far it has come at its right, and moves on its own', () => {
  const panel = timelinePanelOf(RUNNING, 41_000, 43, 10)

  expect(panel).toMatchObject({ id: 'timeline', title: 'this turn', right: '41s running · 2 tools', isLive: true })
  expect(panel.label).toEqual([])
})

test('titles an ended turn last turn, with its failures at its right, and keeps still', () => {
  expect(timelinePanelOf(ENDED, 0, 43, 10)).toMatchObject({ title: 'last turn', right: '41s · 2 tools · 1 failed', isLive: false })
})

test('lends the chart without its heading, in the Deck look', () => {
  expect(timelinePanelOf(ENDED, 0, 43, 10).rows).toEqual(linesOf(ENDED, 0, 43, 11, { name: 'inactive', lane: 'subtle' }).slice(1))
})

test('draws a tool name quietly in the Deck and keeps its color on the bar', () => {
  // At 43 columns a call takes two rows: what it was, then its bar.
  const [, read, bar] = timelinePanelOf(ENDED, 0, 43, 10).rows

  expect(read?.[0]?.text.trim()).toBe('Read')
  expect(read?.[0]?.color).toBe('inactive')
  expect(bar?.find(run => run.text.startsWith('━'))?.color).toBe('suggestion')
})

test('draws a bar as a thin line along a dotted lane, as Flightdeck draws its lanes', () => {
  const [, , read, , bash] = timelinePanelOf(ENDED, 0, 43, 10).rows

  // Read ran first, Bash after it: Bash's lane is dotted before its bar and after it.
  expect(plain([read ?? []])[0]).toMatch(/^━+·+ +1\.2s$/)
  expect(plain([bash ?? []])[0]).toMatch(/^·+━+·+ +✗ 7\.5s$/)
  expect(bash?.filter(run => run.text.startsWith('·')).map(run => run.color)).toEqual(['subtle', 'subtle'])
  expect(plain([read ?? [], bash ?? []]).map(row => row.length)).toEqual([43, 43])
  expect(plain(timelinePanelOf(ENDED, 0, 43, 10).rows).some(row => row.includes('█'))).toBe(false)
})

test('keeps within the rows asked for, the oldest calls under +N earlier', () => {
  const many: Turn = { calls: Array.from({ length: 30 }, (_, i) => call(`c${i}`, 'Read', i * 100, i * 100 + 50)), lasted: 5000 }
  const rows = plain(timelinePanelOf(many, 0, 43, 10).rows)

  expect(rows.length).toBeLessThanOrEqual(10)
  expect(rows.some(row => /^\+\d+ earlier$/.test(row))).toBe(true)
})

test('sums the turn up in one line', () => {
  expect(plain([timelinePanelOf(RUNNING, 41_000, 43, 10).summary ?? []])).toEqual(['turn 41s running · 2 tools'])
  expect(timelinePanelOf(null, 0, 43, 10).summary).toEqual([])
})
