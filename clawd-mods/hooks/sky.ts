// Clawd's sky: the row above him. The sun by the hour between sunrise and
// sunset; at night the moon in its real phase and a few twinkling stars;
// clouds drift by when it is cloudy. Sunrise and sunset come from the weather
// when there is any, else from the sunrise equation for the last known place.

import type { Cell, Place, SkyKind, Weather } from '../types'

export type { Place, SkyKind, Weather }

/** What the sky row is drawn from; `kind` null: no weather known, a clear sky. */
export type SkyProps = { kind: SkyKind | null; sunrise: number; sunset: number; now: number; windFromDeg?: number; windKmh?: number }

const DAY = 86_400_000
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14) // a known new moon
const SYNODIC = 29.530588853 * DAY
// Glyphs Maple Mono NF (the user's font) has, one cell wide: Nerd Font icons
// for the sun and the moon; it has no ☼, ◐ or ◑, which a terminal borrows.
/** Material Design weather-sunny. */
export const SUN_GLYPH = '\u{F0599}'
/** Material Design moon phases, new to waning crescent, an eighth of the month each. */
const MOON_GLYPHS = ['\u{F0F64}', '\u{F0F65}', '\u{F0F61}', '\u{F0F66}', '\u{F0F62}', '\u{F0F68}', '\u{F0F63}', '\u{F0F67}']
const SUN = { ch: SUN_GLYPH, fg: '#FDE047' }
const MOON = '#E5E7EB'
const STAR = '#A1A1AA'
const RAD = Math.PI / 180

/** Where the moon is in its month: 0 new, 0.5 full, back to 1. */
export function moonPhase(at: number): number {
  const phase = ((at - NEW_MOON) / SYNODIC) % 1
  return phase < 0 ? phase + 1 : phase
}

/** The moon as it looks at this phase: new, crescent, quarter, gibbous, full and back. */
export function moonGlyph(phase: number): string {
  return MOON_GLYPHS[Math.round(phase * 8) % 8] ?? (MOON_GLYPHS[0] as string)
}

/** How much of the moon is lit, 0–100. */
export function moonLit(phase: number): number {
  return Math.round(((1 - Math.cos(2 * Math.PI * phase)) / 2) * 100)
}

/** The sun's column while it is up: 0 at sunrise, the last column at sunset; null at night. */
export function sunColumn(now: number, sunrise: number, sunset: number, cols: number): number | null {
  if (now < sunrise || now > sunset || sunset <= sunrise) return null
  return Math.round(((now - sunrise) / (sunset - sunrise)) * (cols - 1))
}

/**
 * Sunrise and sunset of the solar day nearest `day`, by the sunrise equation
 * (about a minute off; latitude south and longitude west negative).
 */
export function solarTimes(lat: number, lon: number, day: number): { sunrise: number; sunset: number } {
  // Days since J2000 (2000-01-01 12:00 UTC), at the mean solar noon nearest `day`.
  const n = Math.round(day / DAY + 2440587.5 - 2451545 + lon / 360)
  const jStar = n - lon / 360
  const m = (357.5291 + 0.98560028 * jStar) % 360
  const c = 1.9148 * Math.sin(m * RAD) + 0.02 * Math.sin(2 * m * RAD) + 0.0003 * Math.sin(3 * m * RAD)
  const lambda = (m + c + 180 + 102.9372) % 360
  const transit = 2451545 + jStar + 0.0053 * Math.sin(m * RAD) - 0.0069 * Math.sin(2 * lambda * RAD)
  const decl = Math.asin(Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD))
  const cosH = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * Math.sin(decl)) / (Math.cos(lat * RAD) * Math.cos(decl))
  // Polar night: no day at all; midnight sun: day all round.
  const h = cosH >= 1 ? 0 : cosH <= -1 ? 180 : Math.acos(cosH) / RAD
  const toMs = (julian: number): number => Math.round((julian - 2440587.5) * DAY)
  return { sunrise: toMs(transit - h / 360), sunset: toMs(transit + h / 360) }
}

/** The moon's column: it crosses the yard from sunset to the next sunrise. */
function moonColumn(sky: SkyProps, cols: number): number {
  const start = sky.now >= sky.sunset ? sky.sunset : sky.sunset - DAY
  const end = sky.now < sky.sunrise ? sky.sunrise : sky.sunrise + DAY
  const share = end > start ? (sky.now - start) / (end - start) : 0.5
  return Math.round(Math.min(1, Math.max(0, share)) * (cols - 1))
}

/** Fixed places for stars, so they twinkle where they stand. */
const isStar = (col: number): boolean => (col * 37 + 11) % 13 === 0 || (col * 53 + 5) % 29 === 0

// Clouds: the widget's $CloudShapes as they are, its pixels half a cell wide
// and a quarter of a row tall, as Clawd's are. Every column of a shape is
// filled from its flat base up, so a cell is drawn as a block rising from the
// bottom in eighths (▃▆█): two eighths a pixel, its two columns' mean. Quadrants
// would keep two of the four steps; your font has no finer pixel glyphs.
const CLOUD_ART = [
  ['....###.....', '..#######...', '.##########.', '############'],
  ['........', '..###...', '.######.', '########'],
  ['..........', '...##.##..', '.########.', '##########'],
]
const EIGHTHS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
/** Each shape as the height of each cell, in eighths of a row. */
const CLOUD_SHAPES: number[][] = CLOUD_ART.map(rows => {
  const column = (x: number): number => rows.filter(row => row[x] === '#').length
  return Array.from({ length: (rows[0] ?? '').length / 2 }, (_, c) => column(2 * c) + column(2 * c + 1))
})
const WIDEST_CLOUD = Math.max(...CLOUD_SHAPES.map(shape => shape.length))
/** The widget keeps nine clouds, and shows as many as the cover asks for. */
const CLOUD_POOL = 9
/** How much of the sky each weather covers, from the widget's weather table. */
const COVER: Partial<Record<SkyKind, number>> = { cloudy: 0.5, overcast: 0.85, fog: 0.7, drizzle: 0.8, rain: 0.9, snow: 0.85, storm: 1 }
// The widget's colors, and its clouds' 65% opacity laid over a dark terminal.
const CLOUD_DAY = [0xB4, 0xB4, 0xBC]
const CLOUD_NIGHT = [0x5E, 0x5E, 0x68]
const CLOUD_RAIN = [0x52, 0x52, 0x5B]
const TERMINAL_BG = [0x1E, 0x1E, 0x1E]
const CLOUD_OPACITY = 0.65
const TWILIGHT = 3_600_000

const mix = (a: number[], b: number[], k: number): number[] => a.map((v, i) => v + ((b[i] ?? v) - v) * Math.min(1, Math.max(0, k)))
const hex = (rgb: number[]): string => `#${rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`
/** A fixed fraction for the pair, so a cloud keeps its speed and its height for a lap. */
const hash = (a: number, b: number): number => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** Daylight, 0 at night to 1 by day, over an hour around sunrise and sunset. */
function daylight(sky: SkyProps): number {
  const fromRise = (sky.now - sky.sunrise) / TWILIGHT + 0.5
  const toSet = (sky.sunset - sky.now) / TWILIGHT + 0.5
  return Math.min(1, Math.max(0, Math.min(fromRise, toSet)))
}

/** The clouds' color: light grey by day, dark at night, darker in rain. */
export function cloudColor(sky: SkyProps): string {
  const wet = sky.kind === 'rain' || sky.kind === 'storm' || sky.kind === 'drizzle'
  const lit = mix(CLOUD_NIGHT, CLOUD_DAY, daylight(sky))
  return hex(mix(TERMINAL_BG, wet ? mix(lit, CLOUD_RAIN, 0.55) : lit, CLOUD_OPACITY))
}

/**
 * The clouds as two rows of cell heights in eighths, the sky row and the row
 * under it: as many as the weather covers (the widget's count, one more for
 * each 35 columns), each at its own speed with the wind, and each lap at its
 * own height, a third of them a row lower, behind Clawd.
 */
function cloudHeights(sky: SkyProps, cols: number, tick: number): number[][] {
  const heights = [0, 1].map(() => Array.from({ length: cols }, () => 0))
  const cover = sky.kind ? COVER[sky.kind] ?? 0 : 0
  const count = Math.min(CLOUD_POOL, Math.round(cover * 5 * Math.max(1, cols / 35)))
  // Blowing from the east (0°–180°) moves them left; the widget's drift grows with the wind.
  const from = sky.windFromDeg ?? 270
  const dir = from > 0 && from < 180 ? -1 : 1
  const pace = 0.04 + (sky.windKmh ?? 10) / 350
  const span = cols + WIDEST_CLOUD
  for (let i = 0; i < count; i += 1) {
    const shape = CLOUD_SHAPES[i % CLOUD_SHAPES.length] ?? []
    // The widget moves a cloud pace * speed of its two-unit pixels a frame; a cell is two pixels.
    const moved = Math.floor((tick * pace * (0.7 + 0.6 * hash(i, 0))) / 4)
    const travel = Math.floor(((i + 0.6 * hash(i, 1)) * span) / count) + moved
    const lap = Math.floor(travel / span)
    const along = travel - lap * span
    const x = (dir > 0 ? along : span - along) - shape.length
    const row = heights[hash(i, lap + 2) < 2 / 3 ? 0 : 1] ?? []
    // Two clouds that drift into each other merge: the taller column shows.
    shape.forEach((h, k) => {
      if (x + k >= 0 && x + k < cols) row[x + k] = Math.max(row[x + k] ?? 0, h)
    })
  }
  return heights
}

/** Heavy weather hides the sun and the moon. */
const isHidden = (kind: SkyKind | null): boolean =>
  kind === 'overcast' || kind === 'rain' || kind === 'storm' || kind === 'fog' || kind === 'snow'

/** The sky row, `cols` cells; the columns in `avoid` (what stands over Clawd's head) stay empty. */
export function skyCells(sky: SkyProps, cols: number, tick: number, avoid: readonly number[]): Cell[] {
  return skyRows(sky, cols, tick, avoid)[0] ?? []
}

/**
 * The sky row and the row under it, where Clawd stands: clouds drift in front
 * of the sun, the moon and the stars, as in the widget, and a cloud flying
 * low drifts through his row (he is drawn over it).
 */
export function skyRows(sky: SkyProps, cols: number, tick: number, avoid: readonly number[]): Cell[][] {
  const row: Cell[] = Array.from({ length: cols }, () => ({ ch: ' ' }))
  const put = (col: number, cell: Cell): void => {
    if (col >= 0 && col < cols && !avoid.includes(col)) row[col] = cell
  }
  const sun = sunColumn(sky.now, sky.sunrise, sky.sunset, cols)
  const isClear = sky.kind === null || sky.kind === 'clear'

  if (sun === null && isClear) {
    for (let col = 0; col < cols; col += 1) {
      if (isStar(col)) put(col, { ch: (Math.floor(tick / 15) + col) % 9 === 0 ? '+' : '·', fg: STAR, dim: true })
    }
  }
  if (sky.kind === 'fog') {
    for (let col = (Math.floor(tick / 50) % 3); col < cols; col += 3) put(col, { ch: '~', dim: true })
  }
  if (!isHidden(sky.kind)) {
    const at = sun ?? moonColumn(sky, cols)
    const cell = sun !== null ? SUN : { ch: moonGlyph(moonPhase(sky.now)), fg: MOON }
    // Steps aside from what stands overhead rather than hiding.
    const free = [at, at + 1, at - 1, at + 2, at - 2].find(col => col >= 0 && col < cols && !avoid.includes(col))
    if (free !== undefined) put(free, cell)
  }
  const low: Cell[] = Array.from({ length: cols }, () => ({ ch: ' ' }))
  const fg = cloudColor(sky)
  const [high = [], under = []] = cloudHeights(sky, cols, tick)
  high.forEach((h, col) => h && put(col, { ch: EIGHTHS[h] ?? '█', fg }))
  under.forEach((h, col) => {
    if (h) low[col] = { ch: EIGHTHS[h] ?? '█', fg }
  })
  return [row, low]
}

// ---------------------------------------------------------------- weather ----

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function objectOf(json: string): Record<string, unknown> | null {
  try {
    const raw: unknown = JSON.parse(json)
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const field = (v: unknown, key: string): unknown => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>)[key] : undefined)

/** WMO weather codes, as Open-Meteo gives them. */
export function kindOfCode(wmo: number): SkyKind {
  if (wmo <= 1) return 'clear'
  if (wmo === 2) return 'cloudy'
  if (wmo === 3) return 'overcast'
  if (wmo === 45 || wmo === 48) return 'fog'
  if (wmo >= 51 && wmo <= 57) return 'drizzle'
  if ((wmo >= 61 && wmo <= 67) || (wmo >= 80 && wmo <= 82)) return 'rain'
  if ((wmo >= 71 && wmo <= 77) || wmo === 85 || wmo === 86) return 'snow'
  if (wmo >= 95) return 'storm'
  return 'cloudy'
}

/** met.no's symbol codes: "lightrainshowers_night", "partlycloudy_day", ... */
function kindOfSymbol(symbol: string): SkyKind {
  if (symbol.includes('thunder')) return 'storm'
  if (symbol.includes('snow') || symbol.includes('sleet')) return 'snow'
  if (symbol.includes('rain')) return symbol.startsWith('light') ? 'drizzle' : 'rain'
  if (symbol.startsWith('fog')) return 'fog'
  if (symbol.startsWith('partlycloudy')) return 'cloudy'
  if (symbol.startsWith('cloudy')) return 'overcast'
  return 'clear'
}

/** "2026-10-23T05:28" in the place's own time, `offsetSec` east of UTC, as epoch ms. */
function localToEpoch(text: unknown, offsetSec: number): number | null {
  const m = typeof text === 'string' ? /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(text) : null
  if (!m) return null
  const [, y, mo, d, h, mi] = m.map(Number) as number[]
  return Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0) - offsetSec * 1000
}

export function parseOpenMeteo(json: string, place: Place): Weather | null {
  const r = objectOf(json)
  const now = field(r, 'current')
  const daily = field(r, 'daily')
  const offset = field(r, 'utc_offset_seconds')
  const temp = field(now, 'temperature_2m')
  const code = field(now, 'weather_code')
  const wind = field(now, 'wind_speed_10m')
  const from = field(now, 'wind_direction_10m')
  const sunrise = localToEpoch((field(daily, 'sunrise') as unknown[] | undefined)?.[0], isNum(offset) ? offset : 0)
  const sunset = localToEpoch((field(daily, 'sunset') as unknown[] | undefined)?.[0], isNum(offset) ? offset : 0)
  const at = localToEpoch(field(now, 'time'), isNum(offset) ? offset : 0)
  if (!isNum(offset) || !isNum(temp) || !isNum(code) || !isNum(wind) || !isNum(from) || sunrise === null || sunset === null || at === null) {
    return null
  }
  return { city: place.city, tempC: temp, kind: kindOfCode(code), windKmh: wind, windFromDeg: from, isDay: field(now, 'is_day') === 1, sunrise, sunset, at }
}

export function parseMetNo(json: string, place: Place, now: number): Weather | null {
  const first = (field(field(objectOf(json), 'properties'), 'timeseries') as unknown[] | undefined)?.[0]
  const data = field(first, 'data')
  const details = field(field(data, 'instant'), 'details')
  const temp = field(details, 'air_temperature')
  const wind = field(details, 'wind_speed')
  const from = field(details, 'wind_from_direction')
  const symbol = ['next_1_hours', 'next_6_hours', 'next_12_hours']
    .map(span => field(field(field(data, span), 'summary'), 'symbol_code'))
    .find((code): code is string => typeof code === 'string')
  const at = Date.parse(String(field(first, 'time')))
  if (!isNum(temp) || !isNum(wind) || !isNum(from) || symbol === undefined || !Number.isFinite(at)) return null
  const { sunrise, sunset } = solarTimes(place.lat, place.lon, now)
  return {
    city: place.city,
    tempC: temp,
    kind: kindOfSymbol(symbol),
    windKmh: Math.round(wind * 36) / 10,
    windFromDeg: from,
    isDay: now >= sunrise && now <= sunset,
    sunrise,
    sunset,
    at,
  }
}

/** ipwho.is: where this machine's internet address is. */
export function parseIpWho(json: string): Place | null {
  const r = objectOf(json)
  const city = field(r, 'city')
  const lat = field(r, 'latitude')
  const lon = field(r, 'longitude')
  if (field(r, 'success') !== true || typeof city !== 'string' || !isNum(lat) || !isNum(lon)) return null
  return { city, lat, lon }
}

/** Open-Meteo's geocoding: the first place of that name. */
export function parseGeocode(json: string): Place | null {
  const first = (field(objectOf(json), 'results') as unknown[] | undefined)?.[0]
  const city = field(first, 'name')
  const lat = field(first, 'latitude')
  const lon = field(first, 'longitude')
  if (typeof city !== 'string' || !isNum(lat) || !isNum(lon)) return null
  return { city, lat, lon }
}
