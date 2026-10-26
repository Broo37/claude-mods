import { type Engine, expect, test } from 'claude-code/testing'

import { create, step } from '../hooks/clawd'
import { type Place, type Weather, kindOfCode, parseGeocode, parseIpWho, parseMetNo, parseOpenMeteo } from '../hooks/sky'
import { BAND, NOW, PANE, SAMPLE, START, world } from './world'

const HOUR = 3_600_000
const JAKARTA: Place = { city: 'Jakarta', lat: -6.2088, lon: 106.8456 }

// Fetched 2026-10-23 for Jakarta and trimmed; current weather set to rain.
const OPEN_METEO = JSON.stringify({
  latitude: -6.221441,
  longitude: 106.78094,
  utc_offset_seconds: 25200,
  timezone: 'Asia/Jakarta',
  current: { time: '2026-10-23T14:00', interval: 900, temperature_2m: 27.1, weather_code: 61, wind_speed_10m: 9.0, wind_direction_10m: 164, is_day: 1 },
  daily: { time: ['2026-10-23'], sunrise: ['2026-10-23T05:28'], sunset: ['2026-10-23T17:45'] },
})
const metNo = (symbol: string): string =>
  JSON.stringify({
    type: 'Feature',
    properties: {
      timeseries: [
        {
          time: '2026-10-23T12:00:00Z',
          data: {
            instant: { details: { air_temperature: 29.3, wind_from_direction: 9.9, wind_speed: 2.0 } },
            next_1_hours: { summary: { symbol_code: symbol }, details: { precipitation_amount: 0.2 } },
          },
        },
      ],
    },
  })
const IPWHO = JSON.stringify({ success: true, city: 'Jakarta', latitude: -6.2088, longitude: 106.8456 })
const BANDUNG = JSON.stringify({ results: [{ id: 1650357, name: 'Bandung', latitude: -6.92222, longitude: 107.60694, country: 'Indonesia' }] })

const OM_URL = 'https://api.open-meteo.com/'
const MET_URL = 'https://api.met.no/'
const IP_URL = 'https://ipwho.is/'
const GEO_URL = 'https://geocoding-api.open-meteo.com/'

type Found = { type: string; props: Record<string, unknown>; text: string }
async function paneTexts($: Engine): Promise<Found[]> {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 42 }, surface: 'terminal' })
  const texts = (await ui.findAll({ type: 'Text' })) as Found[]
  await ui.unmount()
  return texts
}

test('Open-Meteo: now, sunrise and sunset', () => {
  const w = parseOpenMeteo(OPEN_METEO, JAKARTA)
  expect(w).toMatchObject({ city: 'Jakarta', tempC: 27.1, kind: 'rain', isDay: true, windKmh: 9, windFromDeg: 164 })
  expect(w?.sunrise).toBe(Date.UTC(2026, 9, 23, 5, 28) - 7 * HOUR)
  expect(w?.sunset).toBe(Date.UTC(2026, 9, 23, 17, 45) - 7 * HOUR)
  expect(w?.at).toBe(Date.UTC(2026, 9, 23, 14, 0) - 7 * HOUR)
  expect(parseOpenMeteo('{"error":true,"reason":"bad latitude"}', JAKARTA)).toBeNull()
})

test('WMO codes', () => {
  const table: [number, string][] = [
    [0, 'clear'], [1, 'clear'], [2, 'cloudy'], [3, 'overcast'], [45, 'fog'], [48, 'fog'],
    [51, 'drizzle'], [57, 'drizzle'], [61, 'rain'], [67, 'rain'], [80, 'rain'], [82, 'rain'],
    [71, 'snow'], [77, 'snow'], [85, 'snow'], [86, 'snow'], [95, 'storm'], [99, 'storm'],
  ]
  for (const [code, kind] of table) expect([code, kindOfCode(code)]).toEqual([code, kind])
})

test('met.no: its symbols, wind in m/s, sunrise from the sunrise equation', () => {
  const now = Date.UTC(2026, 9, 23, 12)
  const w = parseMetNo(metNo('rain'), JAKARTA, now) as Weather
  expect(w).toMatchObject({ city: 'Jakarta', tempC: 29.3, kind: 'rain', windFromDeg: 9.9 })
  expect(w.windKmh).toBe(7.2)
  expect(w.sunrise).toBeLessThan(w.sunset)
  const table: [string, string][] = [
    ['clearsky_day', 'clear'], ['fair_night', 'clear'], ['partlycloudy_day', 'cloudy'], ['cloudy', 'overcast'],
    ['fog', 'fog'], ['lightrain', 'drizzle'], ['heavyrainandthunder', 'storm'], ['lightsnow', 'snow'], ['sleet', 'snow'],
  ]
  for (const [symbol, kind] of table) expect([symbol, parseMetNo(metNo(symbol), JAKARTA, now)?.kind]).toEqual([symbol, kind])
  expect(parseMetNo('{}', JAKARTA, now)).toBeNull()
})

test('places: from the internet address, or a city by name', () => {
  expect(parseIpWho(IPWHO)).toEqual(JAKARTA)
  expect(parseIpWho('{"success":false,"message":"Reserved range"}')).toBeNull()
  expect(parseGeocode(BANDUNG)).toEqual({ city: 'Bandung', lat: -6.92222, lon: 107.60694 })
  expect(parseGeocode('{"generationtime_ms":0.1}')).toBeNull()
})

test('pane: one line now, one dim line of sun and moon', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  w.web[IP_URL] = () => IPWHO
  w.web[OM_URL] = () => OPEN_METEO
  await $.session.start(START)
  await w.clock.advance(2000)
  const texts = await paneTexts($)
  expect(texts.find(t => t.text === '▌ WEATHER')?.props.color).toBe('#60A5FA')
  expect(texts.some(t => /^▌ WEATHER\s+Jakarta/.test(t.text))).toBe(true)
  expect(texts.some(t => /27°C · rain · wind 9 km\/h/.test(t.text))).toBe(true)
  // `u`: the moon is a Nerd Font icon, outside the 16-bit range.
  const sun = texts.find(t => /↑ \d\d?:\d\d {2}↓ \d\d?:\d\d · moon . \d+% lit/u.test(t.text))
  expect(sun?.props.dimColor).toBe(true)
  // Clawd's sky has the weather now.
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Client' }))?.props).toMatchObject({ props: { sky: { kind: 'rain', windFromDeg: 164 } } })
  await band.unmount()
})

test('falls back to met.no, with its User-Agent', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  w.web[IP_URL] = () => IPWHO
  w.web[OM_URL] = () => {
    throw new Error('503')
  }
  w.web[MET_URL] = () => metNo('rain')
  await $.session.start(START)
  await w.clock.advance(2000)
  expect(w.fetches.find(f => f.url.startsWith(MET_URL))?.headers['User-Agent']).toBe('clawd-mods (a personal Claude Code mod)')
  expect((await paneTexts($)).some(t => /29°C · rain/.test(t.text))).toBe(true)
})

test('a city in /config skips the IP lookup', { options: { city: 'Bandung' } }, async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  w.web[GEO_URL] = () => BANDUNG
  w.web[OM_URL] = () => OPEN_METEO
  await $.session.start(START)
  await w.clock.advance(2000)
  expect(w.fetches.filter(f => f.url.startsWith(IP_URL))).toEqual([])
  expect(w.fetches.filter(f => f.url.startsWith(GEO_URL)).map(f => f.url)).toEqual([
    'https://geocoding-api.open-meteo.com/v1/search?name=Bandung&count=1',
  ])
  expect(w.fetches.find(f => f.url.startsWith(OM_URL))?.url).toContain('latitude=-6.92222&longitude=107.60694')
  expect((await paneTexts($)).some(t => /^▌ WEATHER\s+Bandung/.test(t.text))).toBe(true)
})

test('offline: no weather, the sky still follows the clock; a last reading is kept, marked stale', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  await $.session.start(START)
  await w.clock.advance(2000)
  expect((await paneTexts($)).some(t => t.text === '▌ WEATHER')).toBe(false)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const sky = ((await band.find({ type: 'Client' }))?.props.props as { sky: { kind: unknown; sunrise: number; sunset: number } }).sky
  expect(sky.kind).toBeNull()
  expect(sky.sunrise).toBeLessThan(sky.sunset)
  await band.unmount()
})

test('offline after a reading: the last weather stays, marked stale', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  const old = parseOpenMeteo(OPEN_METEO, JAKARTA)
  const ago = NOW - 40 * 60_000
  w.files.set('C:/L/clawd-mods/place-auto.json', { text: JSON.stringify({ at: ago, triedAt: ago, isFailed: false, value: JAKARTA }), mtimeMs: NOW })
  w.files.set('C:/L/clawd-mods/weather-jakarta.json', { text: JSON.stringify({ at: ago, triedAt: ago, isFailed: false, value: old }), mtimeMs: NOW })
  await $.session.start(START)
  await w.clock.advance(2000)
  const texts = await paneTexts($)
  expect(texts.some(t => /27°C · rain/.test(t.text))).toBe(true)
  expect(texts.some(t => /No connection/.test(t.text))).toBe(true)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Client' }))?.props).toMatchObject({ props: { sky: { kind: 'rain' } } })
  await band.unmount()
})

test('offline at the start, online later: the weather comes within a quarter hour', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  await $.session.start(START)
  await w.clock.advance(5 * 60_000)
  w.web[IP_URL] = () => IPWHO
  w.web[OM_URL] = () => OPEN_METEO
  await w.clock.advance(15 * 60_000)
  expect((await paneTexts($)).some(t => /27°C · rain/.test(t.text))).toBe(true)
})

test('offline for hours: the sky drops the old weather, the pane keeps it marked', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  const old = parseOpenMeteo(OPEN_METEO, JAKARTA)
  const ago = NOW - 4 * HOUR
  w.files.set('C:/L/clawd-mods/place-auto.json', { text: JSON.stringify({ at: ago, triedAt: NOW - 60_000, isFailed: false, value: JAKARTA }), mtimeMs: NOW })
  w.files.set('C:/L/clawd-mods/weather-jakarta.json', { text: JSON.stringify({ at: ago, triedAt: ago, isFailed: false, value: { ...old, at: ago } }), mtimeMs: NOW })
  await $.session.start(START)
  await w.clock.advance(2000)
  expect((await paneTexts($)).some(t => /No connection/.test(t.text))).toBe(true)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Client' }))?.props).toMatchObject({ props: { sky: { kind: null } } })
  await band.unmount()
})

// ----------------------------------------------------- Clawd in the weather ----

const props = (kind: 'rain' | 'storm') => ({
  mood: 'idle' as const,
  halves: 6,
  isCrit: false,
  worried: false,
  event: null,
  sky: { kind, sunrise: NOW - 6 * HOUR, sunset: NOW + 6 * HOUR, now: NOW },
  control: { kind: 'auto' as const },
  overhead: null,
  width: 40,
})
const text = (row: { text: string }[] | undefined): string => (row ?? []).map(run => run.text).join('')

test('rain falls across the yard, around Clawd', () => {
  const m = create(props('rain'))
  for (let i = 0; i < 60; i += 1) step(m, 40)
  const drops = [1, 2, 3].map(row => [...text(m.rows[row])].filter(ch => ch === '│').length)
  expect(drops.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(6)
})

test('a storm flashes, and Clawd hops at the thunder', () => {
  const m = create(props('storm'))
  m.act = null
  let flashed = false
  for (let i = 0; i < 600 && !flashed; i += 1) {
    step(m, 40)
    if (text(m.rows[0]).includes('\u{F0241}')) {
      flashed = true
      expect(m.act).toBe('jump')
    }
  }
  expect(flashed).toBe(true)
})
