import { expect, test } from 'claude-code/testing'

import { claimed, newest, stampOf } from '../hooks/times'

const MINUTE = 60_000

// A Wednesday morning, local time, so the wording does not depend on the time zone.
const NOW = new Date(2026, 9, 7, 8, 45).getTime()

test('writes the time a prompt was sent today as its clock alone', () => {
  expect(stampOf(new Date(2026, 9, 7, 8, 5).getTime(), NOW)).toBe('08:05')
  expect(stampOf(new Date(2026, 9, 7, 0, 0).getTime(), NOW)).toBe('00:00')
})

test('names the day of a prompt sent on another day', () => {
  expect(stampOf(new Date(2026, 9, 6, 23, 59).getTime(), NOW)).toBe('6 Oct 23:59')
  expect(stampOf(new Date(2025, 11, 31, 14, 32).getTime(), NOW)).toBe('31 Dec 14:32')
})

test('gives a row the time of the oldest waiting prompt that has its words', () => {
  const waiting = [
    { text: 'first', at: NOW - 3 * MINUTE },
    { text: 'again', at: NOW - 2 * MINUTE },
    { text: 'again', at: NOW - MINUTE },
  ]

  expect(claimed(waiting, 'again', NOW)).toEqual({
    at: NOW - 2 * MINUTE,
    rest: [
      { text: 'first', at: NOW - 3 * MINUTE },
      { text: 'again', at: NOW - MINUTE },
    ],
  })
})

test('gives no time to a row whose words no waiting prompt has', () => {
  const waiting = [{ text: 'first', at: NOW }]

  expect(claimed(waiting, 'something else', NOW)).toEqual({ rest: waiting })
})

test('does not mind the spaces around a prompt', () => {
  expect(claimed([{ text: '  hi there\n', at: NOW }], 'hi there', NOW).at).toBe(NOW)
})

test('lets a prompt wait ten minutes for its row, no longer', () => {
  const waiting = [
    { text: 'a command that draws no row', at: NOW - 11 * MINUTE },
    { text: 'hi', at: NOW - 9 * MINUTE },
  ]

  expect(claimed(waiting, 'a command that draws no row', NOW)).toEqual({
    rest: [{ text: 'hi', at: NOW - 9 * MINUTE }],
  })
})

test('keeps the newest times when there are more than it holds', () => {
  expect(newest({ a: 1, b: 3, c: 2 }, 2)).toEqual({ b: 3, c: 2 })
  expect(newest({ a: 1 }, 2)).toEqual({ a: 1 })
})
