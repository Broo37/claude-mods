import { expect, test } from 'claude-code/testing'

import type { StatusBandRun, View } from '../types'
import { PALETTE, rgb } from '../hooks/format'
import { limitsPanelOf, runsOf } from '../hooks/deck'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

// A Thursday noon, local time, so the reset wording does not depend on the time zone.
const NOW = new Date(2026, 9, 22, 12, 0).getTime()

const VIEW: View = {
  now: NOW,
  model: 'claude-opus-5-5',
  effort: 'xhigh',
  style: 'Explanatory',
  cwd: 'C:\\Users\\admin\\.config\\yasb',
  home: 'C:\\Users\\admin',
  env: '',
  account: 'Pro',
  contextTokens: 58_000,
  contextWindow: 1_000_000,
  contextPercent: 6,
  limits: [
    { kind: 'five_hour', percentUsed: 66, resetsAt: new Date(2026, 9, 22, 14, 30).getTime() },
    { kind: 'seven_day', percentUsed: 8, resetsAt: new Date(2026, 9, 28, 22, 0).getTime() },
  ],
  costUsd: 0.42,
  isBoardClosed: false,
  isStatusClosed: false,
  mode: '',
  peers: [],
  startedAt: NOW - 3 * MINUTE,
  git: { branch: 'master', ahead: 0, behind: 0, staged: 0, unstaged: 1, untracked: 0 },
  codex: { percent: 7, resetsAt: new Date(2026, 9, 28, 15, 25).getTime(), readAt: NOW - HOUR },
  turn: null,
}

const plain = (runs: readonly StatusBandRun[]) => runs.map(run => run.text).join('')

const rowsAt = (view: View, columns: number) => limitsPanelOf(view, columns).rows.map(plain)

test('limits panel is titled limits, with the cost and session time at its right and the model as its label', () => {
  const panel = limitsPanelOf(VIEW, 43)

  expect(panel.id).toBe('limits')
  expect(panel.title).toBe('limits')
  expect(panel.right).toBe('$ 0.42 · 3m')
  expect(plain(panel.label)).toBe('Opus 5.5 xhigh')
})

test('the label leaves out the wide-context mark of the model name', () => {
  expect(plain(limitsPanelOf({ ...VIEW, model: 'claude-opus-5-5[1m]' }, 43).label)).toBe('Opus 5.5 xhigh')
})

test('limits panel rows are 5H, 7D, CX, ctx, then the place row', () => {
  const rows = rowsAt(VIEW, 43)

  expect(rows).toHaveLength(5)
  expect(rows[0]?.startsWith('5H  ')).toBe(true)
  expect(rows[1]?.startsWith('7D  ')).toBe(true)
  expect(rows[2]?.startsWith('CX  ')).toBe(true)
  expect(rows[3]?.startsWith('ctx ')).toBe(true)
  expect(rows[4]).toBe('Pro · ~\\.config\\yasb · master !1')
})

test('each bar row ends with its percent and when it resets, the context row with its tokens', () => {
  const rows = rowsAt(VIEW, 43)

  expect(rows[0]?.endsWith(' 66%  ↻ 14:30')).toBe(true)
  expect(rows[1]?.endsWith('  8%  ↻ Wed 22:00')).toBe(true)
  expect(rows[2]?.endsWith('  7%  ↻ Wed 15:25')).toBe(true)
  expect(rows[3]?.endsWith('  6%  58k / 1M')).toBe(true)
})

test('the bars all start and end in the same columns', () => {
  const rows = rowsAt(VIEW, 43).slice(0, 4)
  const percentAt = rows.map(row => row.indexOf('%'))

  expect(new Set(percentAt).size).toBe(1)
})

test('no row is wider than the panel', () => {
  for (const columns of [36, 43, 56]) {
    for (const row of rowsAt(VIEW, columns)) {
      expect(row.length).toBeLessThanOrEqual(columns)
    }
  }
})

test('a long place row is cut to the panel with an ellipsis', () => {
  const view = { ...VIEW, cwd: 'C:\\Users\\admin\\a\\very\\deep\\folder\\that\\goes\\on\\and\\on' }
  const place = rowsAt(view, 36).at(-1) ?? ''

  expect(place.length).toBe(36)
  expect(place.endsWith('…')).toBe(true)
})

test('a bar keeps at least five cells in a narrow panel', () => {
  const bar = /^5H {2}(\S+) /.exec(rowsAt(VIEW, 24)[0] ?? '')?.[1] ?? ''

  expect(bar.length).toBe(5)
})

test('the pace of the five-hour window is marked on its bar', () => {
  const bar = /^5H {2}(\S+) /.exec(rowsAt(VIEW, 43)[0] ?? '')?.[1] ?? ''

  expect(/[╂┃]/.test(bar)).toBe(true)
})

test('before anything is read the panel says it is loading', () => {
  const panel = limitsPanelOf({ ...VIEW, now: 0 }, 43)

  expect(panel.rows.map(plain)).toEqual(['(loading..)'])
  expect(panel.right).toBe('')
  expect(panel.label).toEqual([])
})

test('with no limits read yet one loading row stands in for 5H and 7D', () => {
  const rows = rowsAt({ ...VIEW, limits: [] }, 43)

  expect(rows[0]).toBe('5H 7D (loading..)')
  expect(rows.some(row => row.startsWith('5H  ') || row.startsWith('7D  '))).toBe(false)
  expect(rows.join('\n')).not.toMatch(/NaN|undefined/)
})

test('a Codex window that has rolled over leaves the CX row out', () => {
  const view = { ...VIEW, codex: { percent: 50, resetsAt: NOW - HOUR, readAt: NOW - 8 * 24 * HOUR } }

  expect(rowsAt(view, 43).some(row => row.startsWith('CX'))).toBe(false)
})

test('a window of 200k tokens reads as 200k', () => {
  const rows = rowsAt({ ...VIEW, contextWindow: 200_000, contextTokens: 86_400, contextPercent: 43 }, 43)

  expect(rows.find(row => row.startsWith('ctx'))?.endsWith('43%  86k / 200k')).toBe(true)
})

test('runsOf keeps a text segment color as rgb() and turns a bar into colored runs', () => {
  const runs = runsOf([
    { text: '5H', color: PALETTE.lavender, isBold: true },
    { bar: 'fiveHour', percent: 50, width: 10 },
  ])

  expect(runs[0]).toEqual({ text: '5H', color: rgb(PALETTE.lavender), isBold: true })
  expect(runs.slice(1).map(run => run.text).join('')).toHaveLength(10)
  expect(runs.slice(1).every(run => run.color?.startsWith('rgb(') === true)).toBe(true)
})
