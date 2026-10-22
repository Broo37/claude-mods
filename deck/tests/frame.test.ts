import { expect, test } from 'claude-code/testing'

import { PANELS, headerOf, miniOf, orderOf, panelsFrom, visible } from '../hooks/frame'
import type { DeckPanel, DeckRun } from '../hooks/frame'

const plain = (runs: readonly DeckRun[]) => runs.map(run => run.text).join('')

const PLAN: DeckPanel = {
  id: 'plan',
  title: 'plan',
  right: '',
  label: [{ text: '▶ 2/4 · 1m 12s' }],
  rows: [[{ text: '▶ 🔨 Build the pricing section' }]],
}

const LIMITS: DeckPanel = {
  id: 'limits',
  title: 'limits',
  right: '$ 0.42 · 3m',
  label: [{ text: 'Opus 5.5', isBold: true }, { text: ' xhigh' }],
  rows: [[{ text: '5H  ████ 66%' }]],
}

test('keeps the panels in their own order', () => {
  expect(orderOf(['plan', 'limits'], null)).toEqual(['plan', 'limits'])
})

test('puts the panel asked for on top', () => {
  expect(orderOf(['plan', 'limits'], 'limits')).toEqual(['limits', 'plan'])
  expect(orderOf(['plan', 'limits'], 'plan')).toEqual(['plan', 'limits'])
})

test('ignores a top that is no panel', () => {
  expect(orderOf(['plan', 'limits'], 'sessions')).toEqual(['plan', 'limits'])
})

test('heads the Deck with its name, the model, then the job', () => {
  expect(plain(headerOf([PLAN, LIMITS], 60))).toBe('DECK · Opus 5.5 xhigh · ▶ 2/4 · 1m 12s')
  expect(headerOf([PLAN, LIMITS], 60)[0]).toEqual({ text: 'DECK', isBold: true })
})

test('leaves out a label a panel does not have', () => {
  expect(plain(headerOf([PLAN, { ...LIMITS, label: [] }], 60))).toBe('DECK · ▶ 2/4 · 1m 12s')
})

test('cuts the header to the width, ending in an ellipsis', () => {
  const header = plain(headerOf([PLAN, LIMITS], 30))

  expect(header).toHaveLength(30)
  expect(header.endsWith('…')).toBe(true)
})

test('shows only the panels with rows', () => {
  expect(visible([{ ...PLAN, rows: [] }, LIMITS]).map(panel => panel.id)).toEqual(['limits'])
})

test('reads the panels setting: known panels in its order, the rest dropped', () => {
  expect(panelsFrom('sessions, limits')).toEqual(['sessions', 'limits'])
  expect(panelsFrom('plan,nope,timeline,plan')).toEqual(['plan', 'timeline'])
})

test('falls back to every panel in its own order when the setting names none', () => {
  expect(panelsFrom('')).toEqual([...PANELS])
  expect(panelsFrom('nope')).toEqual([...PANELS])
  expect(panelsFrom(undefined)).toEqual(['plan', 'limits', 'timeline', 'sessions'])
})

const TIMELINE: DeckPanel = { id: 'timeline', title: 'this turn', right: '41s', label: [], rows: [[{ text: 'Read ██' }]], summary: [{ text: 'turn 41s… · 2 tools' }] }

const SESSIONS: DeckPanel = { id: 'sessions', title: 'sessions', right: '2 open', label: [], rows: [[{ text: '○ a' }]], summary: [{ text: '2 open' }] }

const SUMMED = [
  { ...PLAN, summary: [{ text: '▶ 2/4 Build the pricing section' }] },
  { ...LIMITS, summary: [{ text: '5H 66% · 7D 8% · ctx 6%' }] },
  TIMELINE,
  SESSIONS,
]

test('sums the Deck up in four rows at most: the header, then a line a panel', () => {
  expect(miniOf(SUMMED, 60).map(plain)).toEqual([
    'DECK · Opus 5.5 xhigh · ▶ 2/4 · 1m 12s',
    '▶ 2/4 Build the pricing section',
    '5H 66% · 7D 8% · ctx 6%',
    'turn 41s… · 2 tools',
  ])
})

test('sums up the sessions where there is no turn to sum up', () => {
  expect(miniOf([SUMMED[0], SUMMED[1], { ...TIMELINE, summary: [] }, SESSIONS] as DeckPanel[], 60).map(plain).at(-1)).toBe('2 open')
})

test('cuts every row of the mini summary to the width', () => {
  for (const row of miniOf(SUMMED, 30).map(plain)) {
    expect(row.length).toBeLessThanOrEqual(30)
  }
})
