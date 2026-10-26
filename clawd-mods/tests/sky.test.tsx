import { expect, test } from 'claude-code/testing'

import { cloudColor, moonGlyph, moonLit, moonPhase, skyCells, skyRows, solarTimes, sunColumn } from '../hooks/sky'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const SYNODIC = 29.530588853 * DAY

test('the sun crosses the yard from sunrise to sunset', () => {
  const rise = Date.UTC(2026, 9, 22, 22, 30)
  const set = rise + 12 * HOUR
  expect(sunColumn(rise, rise, set, 61)).toBe(0)
  expect(sunColumn(rise + 6 * HOUR, rise, set, 61)).toBe(30)
  expect(sunColumn(set, rise, set, 61)).toBe(60)
  expect(sunColumn(set + 1, rise, set, 61)).toBeNull()
  expect(sunColumn(rise - 1, rise, set, 61)).toBeNull()
})

test('moon phases', () => {
  const newMoon = Date.UTC(2000, 0, 6, 18, 14)
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-3 || Math.abs(Math.abs(a - b) - 1) < 1e-3
  expect(near(moonPhase(newMoon), 0)).toBe(true)
  expect(near(moonPhase(newMoon + SYNODIC / 2), 0.5)).toBe(true)
  expect(near(moonPhase(newMoon + 10 * SYNODIC), 0)).toBe(true)
  expect(moonLit(0.5)).toBe(100)
  expect(moonLit(0)).toBe(0)
  expect(moonLit(0.25)).toBe(50)
  // Nerd Font moon phases: Maple Mono NF has them, and has no ◐ ◑.
  expect(moonGlyph(0)).toBe('\u{F0F64}')
  expect(moonGlyph(0.25)).toBe('\u{F0F61}')
  expect(moonGlyph(0.5)).toBe('\u{F0F62}')
  expect(moonGlyph(0.25)).not.toBe(moonGlyph(0.75))
})

test('solar times: Jakarta on 2026-10-23', () => {
  // Any moment of that local day; UTC+7.
  const { sunrise, sunset } = solarTimes(-6.2, 106.8, Date.UTC(2026, 9, 23, 5))
  const local = (at: number) => {
    const d = new Date(at + 7 * HOUR)
    return d.getUTCHours() * 60 + d.getUTCMinutes()
  }
  // Published for that week: about 05:31 and 17:47.
  expect(local(sunrise)).toBeGreaterThanOrEqual(5 * 60 + 20)
  expect(local(sunrise)).toBeLessThanOrEqual(5 * 60 + 40)
  expect(local(sunset)).toBeGreaterThanOrEqual(17 * 60 + 40)
  expect(local(sunset)).toBeLessThanOrEqual(17 * 60 + 55)
  expect(new Date(sunrise + 7 * HOUR).getUTCDate()).toBe(23)
})

test('night: moon and stars, nothing on the overhead columns', () => {
  const rise = Date.UTC(2026, 9, 22, 22, 30)
  const night = { kind: 'clear' as const, sunrise: rise, sunset: rise + 12 * HOUR, now: rise + 15 * HOUR }
  const cells = skyCells(night, 60, 0, [30])
  expect(cells).toHaveLength(60)
  const moon = moonGlyph(moonPhase(night.now))
  expect(cells.filter(cell => cell.ch === moon)).toHaveLength(1)
  expect(cells.filter(cell => cell.ch !== ' ' && cell.ch !== moon).length).toBeGreaterThanOrEqual(3)
  expect(cells[30]?.ch).toBe(' ')
})

test('day: the sun at its column, and clouds when it is cloudy', () => {
  const rise = Date.UTC(2026, 9, 22, 22, 30)
  const noon = { kind: 'clear' as const, sunrise: rise, sunset: rise + 12 * HOUR, now: rise + 6 * HOUR }
  const clear = skyCells(noon, 61, 0, [])
  expect(clear[30]?.ch).toBe('\u{F0599}')
  expect(clear.filter(cell => cell.ch !== ' ')).toHaveLength(1)
  const cloudy = skyCells({ ...noon, kind: 'cloudy' }, 61, 0, [])
  expect(cloudy.filter(cell => /[▁-█]/.test(cell.ch)).length).toBeGreaterThanOrEqual(4)
  // The sun steps aside from what stands overhead.
  const aside = skyCells(noon, 61, 0, [30])
  expect(aside[30]?.ch).toBe(' ')
  expect(aside.some(cell => cell.ch === '\u{F0599}')).toBe(true)
})

const RISE = Date.UTC(2026, 9, 22, 22, 30)
const DAYTIME = { sunrise: RISE, sunset: RISE + 12 * HOUR, now: RISE + 6 * HOUR }
const text = (cells: { ch: string }[]) => cells.map(cell => cell.ch).join('')

test("clouds are the widget's stepped mounds, not grey bars", () => {
  // Overcast hides the sun: the rows are clouds alone.
  const sky = { kind: 'overcast' as const, ...DAYTIME }
  const shapes = new Set<string>()
  for (const tick of [0, 400, 1200, 3000, 9000]) {
    for (const row of skyRows(sky, 120, tick, []).map(text)) {
      // Blocks rising from the bottom in eighths: no shade blocks, no quadrants.
      expect(row).toMatch(/^[ ▁-█]+$/)
      for (const cloud of row.trim().split(/ +/)) if (cloud) shapes.add(cloud)
    }
  }
  // Its tallest shape, ....###..... over three wider rows, a step for each.
  expect([...shapes].some(cloud => cloud.includes('▃▆█▇▅▃'))).toBe(true)
  // Lower at both ends than in the middle: a mound.
  expect(skyRows(sky, 120, 400, []).map(text).join('')).not.toMatch(/█ |^█| █$/)
})

test('cloudier weather, more clouds; a wider sky, more of them; a third fly a row lower', () => {
  const cells = (kind: 'cloudy' | 'storm', cols: number) =>
    [0, 600, 1200, 1800].map(tick => skyRows({ kind, ...DAYTIME }, cols, tick, []).flat().filter(cell => cell.ch !== ' ').length)
      .reduce((a, b) => a + b)
  expect(cells('storm', 70)).toBeGreaterThan(cells('cloudy', 70))
  expect(cells('cloudy', 140)).toBeGreaterThan(cells('cloudy', 35))
  expect(text(skyRows({ kind: 'clear', ...DAYTIME }, 120, 0, [])[1] ?? [])).toBe(' '.repeat(120))
  const low = [0, 1500, 3000, 4500, 6000].some(tick => /[▁-█]/.test(text(skyRows({ kind: 'overcast', ...DAYTIME }, 120, tick, [])[1] ?? [])))
  expect(low).toBe(true)
})

test("clouds in the widget's grey: light by day, dark at night, darker in rain", () => {
  expect(cloudColor({ kind: 'cloudy', ...DAYTIME })).toBe('#808085')
  expect(cloudColor({ kind: 'cloudy', ...DAYTIME, now: RISE + 15 * HOUR })).toBe('#48484E')
  expect(cloudColor({ kind: 'rain', ...DAYTIME })).toBe('#5C5C62')
  // At sunrise, halfway between.
  const dawn = cloudColor({ kind: 'cloudy', ...DAYTIME, now: RISE })
  expect(dawn > '#48484E' && dawn < '#808085').toBe(true)
  // The overhead mark's column stays clear of clouds too.
  for (const tick of [0, 300, 600, 900]) expect(skyCells({ kind: 'storm', ...DAYTIME }, 60, tick, [30])[30]?.ch).toBe(' ')
})
