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

test('lends no rows for a turn with no calls yet', () => {
  expect(timelinePanelOf({ calls: [], lasted: null }, 3000, 43, 10).rows).toEqual([])
})

test('titles a running turn this turn, says how far it has come at its right, and moves on its own', () => {
  const panel = timelinePanelOf(RUNNING, 41_000, 43, 10)

  expect(panel).toMatchObject({ id: 'timeline', title: 'this turn', right: '41s… · 2 tools', isLive: true })
  expect(panel.label).toEqual([])
})

test('titles an ended turn last turn, with its failures at its right, and keeps still', () => {
  expect(timelinePanelOf(ENDED, 0, 43, 10)).toMatchObject({ title: 'last turn', right: '41s · 2 tools · 1 failed', isLive: false })
})

test('lends the chart without its heading', () => {
  expect(timelinePanelOf(ENDED, 0, 43, 10).rows).toEqual(linesOf(ENDED, 0, 43, 11).slice(1))
})

test('keeps within the rows asked for, the oldest calls under +N earlier', () => {
  const many: Turn = { calls: Array.from({ length: 30 }, (_, i) => call(`c${i}`, 'Read', i * 100, i * 100 + 50)), lasted: 5000 }
  const rows = plain(timelinePanelOf(many, 0, 43, 10).rows)

  expect(rows.length).toBeLessThanOrEqual(10)
  expect(rows.some(row => /^\+\d+ earlier$/.test(row))).toBe(true)
})
