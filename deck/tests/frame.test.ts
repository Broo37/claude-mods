import { expect, test } from 'claude-code/testing'

import { headerOf, orderOf, visible } from '../hooks/frame'
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
