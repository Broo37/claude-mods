import { expect, test } from 'claude-code/testing'

import { type Sample, addSample, buckets, compact, sparkline } from '../hooks/history'
import { CFG, MIN, NOW, PANE, SAMPLE, START, world } from './world'

const DAY = 1440 * MIN

test('samples older than 7 days drop off', () => {
  const old: Sample = { at: NOW - 7 * DAY - MIN, s: 10, w: 5 }
  const kept: Sample = { at: NOW - 6 * DAY, s: 20, w: 6 }
  expect(addSample([old, kept], { at: NOW, s: 30, w: 7 }, NOW)).toEqual([kept, { at: NOW, s: 30, w: 7 }])
})

test('a reading within 5 minutes of the last replaces it', () => {
  const first: Sample = { at: NOW - 4 * MIN, s: 10, w: 5 }
  expect(addSample([first], { at: NOW, s: 12, w: 5 }, NOW)).toEqual([{ at: NOW, s: 12, w: 5 }])
  const older: Sample = { at: NOW - 6 * MIN, s: 10, w: 5 }
  expect(addSample([older], { at: NOW, s: 12, w: 5 }, NOW)).toHaveLength(2)
})

test('never more than 2100 samples: a week of one every 5 minutes fits whole', () => {
  let list: Sample[] = []
  for (let at = NOW - 7 * DAY + MIN; at <= NOW; at += 5 * MIN) list = addSample(list, { at, s: 1, w: 1 }, at)
  expect(list.length).toBeLessThanOrEqual(2100)
  expect(list[0]?.at).toBeLessThan(NOW - 6.9 * DAY)
})

test('sparkline and buckets', () => {
  expect(sparkline([0, 50, 100, null])).toBe('▁▅█ ')
  // Three samples in the last slice of 7: its max; the other slices empty.
  const list: Sample[] = [
    { at: NOW - 3 * MIN, s: 20, w: 1 },
    { at: NOW - 2 * MIN, s: 70, w: 1 },
    { at: NOW - MIN, s: 40, w: null },
  ]
  expect(buckets(list, NOW, 7, 's')).toEqual([null, null, null, null, null, null, 70])
  expect(buckets(list, NOW, 7, 'w')).toEqual([null, null, null, null, null, null, 1])
})

test('compact: one sample an hour, the most of each', () => {
  const list: Sample[] = [
    { at: NOW - 50 * MIN, s: 20, w: 3 },
    { at: NOW - 40 * MIN, s: 60, w: null },
    { at: NOW - 3 * 60 * MIN, s: 5, w: 1 },
  ]
  const hours = compact(list, NOW)
  expect(hours).toHaveLength(2)
  expect(hours.map(h => [h.s, h.w])).toEqual([[5, 1], [60, 3]])
})

test('after a probe, the reading is in the history and the chart in LIMITS', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  await $.session.start(START)
  await w.clock.advance(1200) // the probe's lock, then the history's
  const saved = JSON.parse(w.files.get(`${CFG}/clawd-mods/history.json`)?.text ?? '[]') as Sample[]
  expect(saved).toHaveLength(1)
  expect(saved[0]).toMatchObject({ s: 18, w: 57 })
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 42 }, surface: 'terminal' })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  await ui.unmount()
  const at = texts.findIndex(t => /^7 days\s+[▁-█ ]+$/.test(t))
  expect(at).toBeGreaterThan(texts.findIndex(t => /^5-hour/.test(t)))
})
