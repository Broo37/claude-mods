import { expect, test } from 'claude-code/testing'

import type { StatusBandRun, View } from '../types'
import { PALETTE, rgb } from '../hooks/format'
import { limitsPanelOf, runsOf, sessionsPanelOf } from '../hooks/deck'

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

test('the pace of the five-hour window shows on its bar where the ink changes, with no mark of its own', () => {
  const bar = /^5H {2}(\S+) /.exec(rowsAt(VIEW, 43)[0] ?? '')?.[1] ?? ''

  expect(bar).toMatch(/^━+·+$/)
  expect(/[█╂┃┿│]/.test(bar)).toBe(false)
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

// ── The sessions panel ─────────────────────────────────────────────────────

const PEERS: View['peers'] = [
  { id: 'a', name: 'claude-mods', status: 'busy', since: NOW - 4 * MINUTE, needs: '' },
  { id: 'b', name: 'geisa-pk-sellout', status: 'idle', since: NOW - 29 * MINUTE, needs: '' },
  { id: 'c', name: 'reset-cust-location', status: 'idle', since: NOW - 22 * MINUTE, needs: 'permission' },
  { id: 'd', name: 'ta-geisa-prep', status: 'shell', since: NOW - 12 * MINUTE, needs: '' },
]

const sessionsAt = (view: View, columns: number, rows = 8) => sessionsPanelOf(view, columns, rows).rows.map(plain)

test('sessions panel is titled sessions and says at its right how many are open', () => {
  const panel = sessionsPanelOf({ ...VIEW, peers: PEERS }, 43, 8)

  expect(panel).toMatchObject({ id: 'sessions', title: 'sessions', right: '4 open', label: [] })
})

test('lists a session a row, the one that needs you first, then by state as the Sessions pane ranks them', () => {
  const rows = sessionsAt({ ...VIEW, peers: PEERS }, 43)

  expect(rows).toHaveLength(4)
  expect(rows[0]?.startsWith('? reset-cust-location')).toBe(true)
  expect(rows[0]?.endsWith('needs you 22m')).toBe(true)
  expect(rows.map(row => row.split(' ')[1])).toEqual(['reset-cust-location', 'geisa-pk-sellout', 'ta-geisa-prep', 'claude-mods'])
})

test('marks each session by its state', () => {
  expect(sessionsAt({ ...VIEW, peers: PEERS }, 43).map(row => row[0])).toEqual(['?', '○', '◌', '●'])
})

test('keeps each session row exactly as wide as the panel, a long name cut', () => {
  for (const columns of [36, 56]) {
    for (const row of sessionsAt({ ...VIEW, peers: PEERS }, columns)) {
      expect(row.length).toBe(columns)
    }
  }

  expect(sessionsAt({ ...VIEW, peers: PEERS }, 30)[0]).toContain('…')
})

test('counts the sessions it has no room for on a last row', () => {
  const rows = sessionsAt({ ...VIEW, peers: PEERS }, 43, 3)

  expect(rows).toHaveLength(3)
  expect(rows[2]).toBe('+2 more')
})

test('lends no session rows when no other session is open, or before anything is read', () => {
  expect(sessionsAt({ ...VIEW, peers: [] }, 43)).toEqual([])
  expect(sessionsAt({ ...VIEW, now: 0, peers: PEERS }, 43)).toEqual([])
})

// ── One-line summaries ──────────────────────────────────────────────────────

test('sums the limits up in one line', () => {
  expect(plain(limitsPanelOf(VIEW, 43).summary ?? [])).toBe('5H 66% · 7D 8% · ctx 6%')
  expect(plain(limitsPanelOf({ ...VIEW, now: 0 }, 43).summary ?? [])).toBe('(loading..)')
  expect(plain(limitsPanelOf({ ...VIEW, limits: [] }, 43).summary ?? [])).toBe('ctx 6%')
})

test('sums the sessions up in one line, saying how many need you', () => {
  expect(plain(sessionsPanelOf({ ...VIEW, peers: PEERS }, 43, 8).summary ?? [])).toBe('4 open · 1 needs you')
  expect(plain(sessionsPanelOf({ ...VIEW, peers: PEERS.slice(0, 1) }, 43, 8).summary ?? [])).toBe('1 open')
})

// ── Flat bars in zones ──────────────────────────────────────────────────────

const barRunsOf = (row: readonly StatusBandRun[]) => row.filter(run => /^[━─·]+$/.test(run.text))

// The five-hour window as the view reads it, `percentUsed` used, resetting
// `left` minutes after noon: 150 minutes left is half the window gone.
const fiveHourAt = (percentUsed: number, left: number): View => ({
  ...VIEW,
  limits: [
    { kind: 'five_hour', percentUsed, resetsAt: NOW + left * MINUTE },
    { kind: 'seven_day', percentUsed: 8, resetsAt: new Date(2026, 9, 28, 22, 0).getTime() },
  ],
})

const zonesOf = (runs: readonly StatusBandRun[]) => runs.map(run => [run.text[0], run.color])

test('draws a bar in zones: a heavy line for what is used, a light line up to the pace, dots beyond, no ramp', () => {
  // 20% used with half the five-hour window gone.
  const row = limitsPanelOf(fiveHourAt(20, 150), 43).rows[0] ?? []
  const fiveHour = barRunsOf(row)
  const width = fiveHour.reduce((cells, run) => cells + run.text.length, 0)

  expect(row.every(run => run.color?.startsWith('rgb(') !== true)).toBe(true)
  expect(zonesOf(fiveHour)).toEqual([
    ['━', 'text'],
    ['─', 'inactive'],
    ['·', 'subtle'],
  ])
  // The light line ends on the cell the pace falls on.
  expect((fiveHour[0]?.text.length ?? 0) + (fiveHour[1]?.text.length ?? 0)).toBe(Math.floor(width / 2) + 1)
  expect(row.find(run => run.text.trim() === '20%')).toMatchObject({ color: 'text', isBold: true })
})

test('turns the part of a bar past its pace to warning while it runs ahead of its window', () => {
  // 66% used with half the five-hour window gone.
  const row = limitsPanelOf(VIEW, 43).rows[0] ?? []
  const fiveHour = barRunsOf(row)
  const width = fiveHour.reduce((cells, run) => cells + run.text.length, 0)

  expect(zonesOf(fiveHour)).toEqual([
    ['━', 'text'],
    ['━', 'warning'],
    ['·', 'subtle'],
  ])
  expect(fiveHour[0]?.text.length).toBe(Math.floor(width / 2))
  expect(row.find(run => run.text.trim() === '66%')?.color).toBe('warning')
})

test('rounding to cells never puts a bar on the wrong side of its pace', () => {
  // Five cells: a pace of 45% falls on the third. 46% would round to two
  // cells, under the pace; one point ahead still shows warning.
  const ahead = barRunsOf(limitsPanelOf(fiveHourAt(46, 165), 24).rows[0] ?? [])
  // A pace of 59% falls on the third cell too. 55% would round to three
  // cells, over it; four points behind still stops short of it.
  const behind = barRunsOf(limitsPanelOf(fiveHourAt(55, 123), 24).rows[0] ?? [])

  expect(zonesOf(ahead)).toEqual([
    ['━', 'text'],
    ['━', 'warning'],
    ['·', 'subtle'],
  ])
  expect(zonesOf(behind)).toEqual([
    ['━', 'text'],
    ['─', 'inactive'],
    ['·', 'subtle'],
  ])
})

test('a bar with no pace, as the context, is a heavy line on dots', () => {
  const context = barRunsOf(limitsPanelOf(VIEW, 43).rows[3] ?? [])

  expect(zonesOf(context)).toEqual([
    ['━', 'text'],
    ['·', 'subtle'],
  ])
})

test('leaves the names of the other sessions in the plain text ink', () => {
  const [row] = sessionsPanelOf({ ...VIEW, peers: PEERS }, 43, 8).rows

  expect(row?.[1]).toMatchObject({ text: 'reset-cust-location', isBold: true })
  expect(row?.[1]?.color).toBeUndefined()
})
