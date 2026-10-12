import { expect, test } from 'claude-code/testing'

import type { View } from '../types'
import { warningsOf } from '../hooks/warnings'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

// A Monday afternoon, local time, so the reset wording does not depend on the time zone.
const NOW = new Date(2026, 9, 5, 16, 45).getTime()
const THURSDAY = new Date(2026, 9, 8, 19, 0).getTime()

const QUIET: View = {
  now: NOW,
  model: 'claude-opus-5-5',
  effort: '',
  style: '',
  cwd: '',
  home: '',
  env: '',
  account: '',
  contextTokens: 0,
  contextWindow: 200_000,
  contextPercent: 10,
  limits: [],
  costUsd: 0,
  isBoardClosed: false,
  mode: '',
  peers: [],
  startedAt: NOW,
  git: null,
  codex: null,
  turn: null,
}

const at = (fiveHour: number, sevenDay = 10, context = 10): View => ({
  ...QUIET,
  contextPercent: context,
  limits: [
    { kind: 'five_hour', percentUsed: fiveHour, resetsAt: NOW + 2 * HOUR + 15 * MINUTE },
    { kind: 'seven_day', percentUsed: sevenDay, resetsAt: THURSDAY },
  ],
})

test('says nothing while every reading is below its first mark', () => {
  expect(warningsOf(at(10), at(79, 79, 79))).toEqual([])
})

test('warns when the 5H limit climbs past 80', () => {
  expect(warningsOf(at(79), at(82))).toEqual(['⚠️ 5H limit at 82% · resets in 2h15m'])
})

test('does not repeat itself between two marks', () => {
  expect(warningsOf(at(82), at(85))).toEqual([])
})

test('raises the alarm at 90', () => {
  expect(warningsOf(at(85), at(91))).toEqual(['🚨 5H limit at 91% · resets in 2h15m'])
})

test('warns once for a climb past both marks', () => {
  expect(warningsOf(at(70), at(95))).toEqual(['🚨 5H limit at 95% · resets in 2h15m'])
})

test('says when the 7D limit resets by its day', () => {
  expect(warningsOf(at(10, 79), at(10, 80))).toEqual(['⚠️ 7D limit at 80% · resets Thu 19:00'])
})

test('points at /compact when the context fills', () => {
  expect(warningsOf(at(10, 10, 79), at(10, 10, 84))).toEqual(['⚠️ Context at 84% · /compact frees room'])
})

test('says nothing when a window resets', () => {
  expect(warningsOf(at(95, 95, 95), at(2, 2, 2))).toEqual([])
})

test('warns on a first reading that is already high', () => {
  expect(warningsOf(QUIET, at(85))).toEqual(['⚠️ 5H limit at 85% · resets in 2h15m'])
})

test('leaves out the reset when the session gives none', () => {
  const after = { ...QUIET, limits: [{ kind: 'five_hour', percentUsed: 85, resetsAt: null }] }

  expect(warningsOf(QUIET, after)).toEqual(['⚠️ 5H limit at 85%'])
})

test('judges a reading as the band shows it, rounded', () => {
  expect(warningsOf(at(79.4), at(79.6))).toEqual(['⚠️ 5H limit at 80% · resets in 2h15m'])
})

test('lists the limits before the context when several climb at once', () => {
  expect(warningsOf(at(10), at(85, 91, 82))).toEqual([
    '⚠️ 5H limit at 85% · resets in 2h15m',
    '🚨 7D limit at 91% · resets Thu 19:00',
    '⚠️ Context at 82% · /compact frees room',
  ])
})
