// The 7-day chart: every limits reading (from /usage or this session's own
// figures) is kept per account for 7 days, and the LIMITS section draws the
// 5-hour and week figures over them as sparklines. It starts empty and fills up.

import type { Sample } from '../types'

export type { Sample }

const HOUR = 3_600_000
const SPAN = 7 * 24 * HOUR
// One reading every 5 minutes at most: a week of them stays under the cap, and
// a chart column spans hours anyway.
const REPLACE_MS = 5 * 60_000
const CAP = 2100
const BARS = '▁▂▃▄▅▆▇█'

/** The list with the new reading: older than 7 days dropped, one within 5 minutes of it replaced, capped. */
export function addSample(list: readonly Sample[], sample: Sample, now: number): Sample[] {
  const kept = list.filter(one => now - one.at < SPAN && Math.abs(one.at - sample.at) >= REPLACE_MS)
  return [...kept, sample].sort((a, b) => a.at - b.at).slice(-CAP)
}

const most = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.max(a, b))

/** The 7 days in `width` equal slices, oldest first: the most of `pick` in each, null where none. */
export function buckets(list: readonly Sample[], now: number, width: number, pick: 's' | 'w'): (number | null)[] {
  const out: (number | null)[] = Array.from({ length: Math.max(0, width) }, () => null)
  const slice = SPAN / Math.max(1, width)
  for (const one of list) {
    const age = now - one.at
    if (age < 0 || age >= SPAN) continue
    const i = Math.min(width - 1, Math.floor((SPAN - age) / slice))
    out[i] = most(out[i] ?? null, one[pick])
  }
  return out
}

/** `▁▂▃▄▅▆▇█` over 0–100; a gap where there was no reading. */
export function sparkline(values: readonly (number | null)[]): string {
  return values
    .map(v => (v === null ? ' ' : (BARS[Math.round((Math.min(100, Math.max(0, v)) / 100) * 7)] ?? ' ')))
    .join('')
}

/** One sample an hour, the most of each figure: what the view carries (168 at most). */
export function compact(list: readonly Sample[], now: number): Sample[] {
  const hours = new Map<number, Sample>()
  for (const one of list) {
    const hour = Math.floor((now - one.at) / HOUR)
    const was = hours.get(hour)
    hours.set(hour, was ? { at: Math.max(was.at, one.at), s: most(was.s, one.s), w: most(was.w, one.w) } : { ...one })
  }
  return [...hours.values()].sort((a, b) => a.at - b.at)
}
