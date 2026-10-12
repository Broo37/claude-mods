import { expect, test } from 'claude-code/testing'

import { badgeOf, clockOf, lastedOf, partsOf, tookOf } from '../hooks/format'

const ROW = { isRunning: false, isErrored: false, isInterrupted: false }

// A Wednesday morning, local time, so the wording does not depend on the time zone.
const DONE = new Date(2026, 9, 8, 8, 47).getTime()

const RECEIPT = { durationMs: 134_000, tools: 18, failed: 1, costUsd: 0.42, fiveHour: 3, doneAt: DONE }

test('writes how long a call took in tenths of a second under ten seconds', () => {
  expect(tookOf(162)).toBe('0.2s')
  expect(tookOf(2238)).toBe('2.2s')
  expect(tookOf(9940)).toBe('9.9s')
  expect(tookOf(0)).toBe('0.0s')
})

test('writes a longer call in whole seconds, minutes and hours', () => {
  expect(tookOf(9960)).toBe('10s')
  expect(tookOf(12_400)).toBe('12s')
  expect(tookOf(64_000)).toBe('1m 4s')
  expect(tookOf(3_725_000)).toBe('1h 2m')
})

test('writes how long a turn lasted in whole seconds, as Claude Code does', () => {
  expect(lastedOf(6453)).toBe('6s')
  expect(lastedOf(134_000)).toBe('2m 14s')
  expect(lastedOf(3_725_000)).toBe('1h 2m')
  expect(lastedOf(400)).toBe('0s')
})

test('writes the time of day as hours and minutes', () => {
  expect(clockOf(DONE)).toBe('08:47')
  expect(clockOf(new Date(2026, 9, 8, 14, 9).getTime())).toBe('14:09')
})

test('ends a call that went well with a green check and how long it took', () => {
  expect(badgeOf({ ms: 2238, isError: false }, ROW)).toEqual({ text: '✓ 2.2s', color: 'success' })
})

test('ends a call that failed with a red cross and how long it took', () => {
  expect(badgeOf({ ms: 162, isError: true }, ROW)).toEqual({ text: '✗ 0.2s', color: 'error' })
  // The row knows of a failure the answer did not name.
  expect(badgeOf({ ms: 162, isError: false }, { ...ROW, isErrored: true })).toEqual({ text: '✗ 0.2s', color: 'error' })
})

test('ends a call that was interrupted with a cross in the color of a warning', () => {
  expect(badgeOf({ ms: 5000, isError: true }, { ...ROW, isErrored: true, isInterrupted: true })).toEqual({
    text: '✗ 5.0s',
    color: 'warning',
  })
})

test('gives a call it did not time a red cross alone when it failed, and nothing otherwise', () => {
  expect(badgeOf(undefined, { ...ROW, isErrored: true })).toEqual({ text: '✗', color: 'error' })
  expect(badgeOf(undefined, ROW)).toBe(null)
  // A call still running may yet go well.
  expect(badgeOf(undefined, { ...ROW, isRunning: true, isErrored: true })).toBe(null)
})

test('writes the receipt of a turn part by part, each in its own color', () => {
  expect(partsOf(RECEIPT)).toEqual([
    { text: '2m 14s', isBold: true },
    { text: '18 tools', color: 'suggestion' },
    { text: '1 failed', color: 'error' },
    { text: '$ 0.42', color: 'warning' },
    { text: '5H +3%', color: 'claude' },
    { text: 'done 08:47', isDim: true },
  ])
})

test('leaves out of a receipt what the turn did not have', () => {
  expect(partsOf({ ...RECEIPT, tools: 0, failed: 0, costUsd: 0, fiveHour: 0 })).toEqual([
    { text: '2m 14s', isBold: true },
    { text: 'done 08:47', isDim: true },
  ])
  expect(partsOf({ ...RECEIPT, tools: 1, failed: 0, costUsd: 0.004, fiveHour: 0.4 }).map(part => part.text)).toEqual([
    '2m 14s',
    '1 tool',
    'done 08:47',
  ])
})

test('leaves out the cost and the limit when they could not be read', () => {
  expect(partsOf({ ...RECEIPT, costUsd: null, fiveHour: null }).map(part => part.text)).toEqual([
    '2m 14s',
    '18 tools',
    '1 failed',
    'done 08:47',
  ])
})

test('writes a share of the limit that is not whole with its tenth', () => {
  expect(partsOf({ ...RECEIPT, fiveHour: 0.5 }).map(part => part.text)).toContain('5H +0.5%')
  expect(partsOf({ ...RECEIPT, fiveHour: 12.5 }).map(part => part.text)).toContain('5H +12.5%')
})
