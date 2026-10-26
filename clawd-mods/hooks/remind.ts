// Reminders, set by /remind or by asking Claude (who calls the mod's remind
// tool with an exact time). They are machine-wide: whichever session with
// this mod is open rings them, once, for all of them. Times here are this PC's.

import type { Reminder, Repeat } from '../types'

export type { Reminder, Repeat }

export const PARSE_ERROR =
  "Can't read the time. Try: /remind 20m check the deploy · /remind tomorrow 9 standup · /remind fri 14:00 call · or ask Claude."

const MINUTE = 60_000
const DAY = 1440 * MINUTE
const REPEATS: readonly Repeat[] = ['daily', 'weekly', 'monthly', 'yearly']
const UNIT: Record<string, number> = { m: MINUTE, min: MINUTE, minute: MINUTE, h: 60 * MINUTE, hour: 60 * MINUTE, d: DAY, day: DAY, week: 7 * DAY }
// Whole words only: "monitor the build" is no Monday.
const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DEFAULT_HOUR = 9 // "tomorrow" or "fri" alone: 9 in the morning

/** "18:30", "9pm", "9:30am", and after a day word also "9": hours and minutes, or null. */
function timeOf(word: string | undefined, isBareHourOk: boolean): { h: number; m: number } | null {
  const t = /^(\d{1,2})(?::(\d\d))?(am|pm)?$/i.exec(word ?? '')
  if (!t || (!t[2] && !t[3] && !isBareHourOk)) return null
  let h = Number(t[1])
  const m = Number(t[2] ?? 0)
  const half = t[3]?.toLowerCase()
  if (half && (h < 1 || h > 12)) return null
  if (half === 'pm' && h < 12) h += 12
  if (half === 'am' && h === 12) h = 0
  return h < 24 && m < 60 ? { h, m } : null
}

/** That local day (`day` any moment in it) at h:m. */
function on(day: number, h: number, m: number): number {
  const d = new Date(day)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

/** A day word's own time if the next word is one, else 9:00; and how many words it took. */
function dayTime(next: string | undefined): { h: number; m: number; used: number } {
  const t = timeOf(next, true)
  return t ? { ...t, used: 2 } : { h: DEFAULT_HOUR, m: 0, used: 1 }
}

/** When the words at the start say, and how many words that took; null when they say no time. */
function whenOf(words: readonly string[], now: number): { at: number; used: number } | null {
  const [first = '', second, third] = words.map(word => word.toLowerCase())
  const rel = /^(\d+)(m|min|h|d)$/.exec(first)
  if (rel) return { at: now + Number(rel[1]) * (UNIT[rel[2] ?? 'm'] ?? MINUTE), used: 1 }
  if (first === 'in' && second && third) {
    const count = second === 'a' || second === 'an' ? 1 : Number(second)
    const unit = UNIT[third.replace(/s$/, '')]
    if (Number.isInteger(count) && count > 0 && unit) return { at: now + count * unit, used: 3 }
  }
  if (first === 'tomorrow') {
    const t = dayTime(words[1])
    return { at: on(now + DAY, t.h, t.m), used: t.used }
  }
  const weekday = WEEKDAYS[first] ?? -1
  if (weekday >= 0) {
    const t = dayTime(words[1])
    const today = new Date(now).getDay()
    let at = on(now + ((weekday - today + 7) % 7) * DAY, t.h, t.m)
    if (at <= now) at = on(now + (((weekday - today + 7) % 7) + 7) * DAY, t.h, t.m)
    return { at, used: t.used }
  }
  const date = /^(\d{1,2})[./](\d{1,2})$/.exec(first)
  if (date) {
    const day = Number(date[1])
    const month = Number(date[2]) - 1
    if (month >= 0 && month < 12 && day >= 1 && day <= 31) {
      const t = dayTime(words[1])
      const year = new Date(now).getFullYear()
      let at = new Date(year, month, day, t.h, t.m).getTime()
      if (at <= now) at = new Date(year + 1, month, day, t.h, t.m).getTime()
      return { at, used: t.used }
    }
  }
  const t = timeOf(first, false)
  if (t) {
    const today = on(now, t.h, t.m)
    return { at: today > now ? today : on(now + DAY, t.h, t.m), used: 1 }
  }
  return null
}

/**
 * `/remind`'s words: an optional repeat word, a time (20m, 2h, 3d, 18:30, 9pm,
 * tomorrow 10, mon 9:00, in a week, 19.10 14:00), then what to remind of.
 */
export function parseWhen(input: string, now: number): { at: number; repeat: Repeat | null; text: string } | { error: string } {
  const words = input.trim().split(/\s+/).filter(Boolean)
  const repeat = REPEATS.find(word => word === words[0]?.toLowerCase()) ?? null
  const rest = repeat ? words.slice(1) : words
  const when = whenOf(rest, now)
  if (when === null) return { error: PARSE_ERROR }
  return { at: when.at, repeat, text: rest.slice(when.used).join(' ') || 'Reminder' }
}

/** `at` moved by k repeats, the day clamped to the month's last (Jan 31 monthly: Feb 28). */
function shifted(at: number, repeat: Repeat, k: number): number {
  const d = new Date(at)
  if (repeat === 'daily' || repeat === 'weekly') {
    d.setDate(d.getDate() + k * (repeat === 'daily' ? 1 : 7))
    return d.getTime()
  }
  const months = repeat === 'monthly' ? k : 12 * k
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1, d.getHours(), d.getMinutes())
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(d.getDate(), last))
  return target.getTime()
}

/** How many repeats after `at` the last one at or before `now` is (0 when `at` itself is later). */
function lastStep(at: number, repeat: Repeat, now: number): number {
  // Jump close first, so a reminder missed for months does not walk day by day.
  // The longest month and year, so the jump never passes the answer; the loop walks the rest.
  const step = { daily: DAY, weekly: 7 * DAY, monthly: 31 * DAY, yearly: 366 * DAY }[repeat]
  let k = Math.max(0, Math.floor((now - at) / step) - 1)
  while (shifted(at, repeat, k + 1) <= now) k += 1
  return k
}

/** The first time of a repeating reminder after `now` (missed ones are skipped); null for a one-off. */
export function nextAt(r: Pick<Reminder, 'at' | 'repeat'>, now: number): number | null {
  if (r.repeat === null) return null
  if (r.at > now) return r.at
  return shifted(r.at, r.repeat, lastStep(r.at, r.repeat, now) + 1)
}

/** The last time of a repeat at or before `now` (its own time when that is later); a one-off's own time. */
export function latestAt(r: Pick<Reminder, 'at' | 'repeat'>, now: number): number {
  return r.repeat === null || r.at > now ? r.at : shifted(r.at, r.repeat, lastStep(r.at, r.repeat, now))
}

/** When it rings next: the end of a snooze, else its own time. */
export const whenDue = (r: Reminder): number => r.snoozeUntil ?? r.at

/**
 * The reminders to ring now: due and not rung yet, and a repeat still ringing
 * from an earlier time whose next time has come (nobody pressed Done).
 */
export function dueOf(list: readonly Reminder[], now: number): Reminder[] {
  return list.filter(r =>
    r.firedAt === null ? whenDue(r) <= now : r.repeat !== null && (nextAt(r, r.at) ?? Number.POSITIVE_INFINITY) <= now,
  )
}

const two = (n: number): string => String(n).padStart(2, '0')

/** "Fri 23 Oct 09:00", this PC's time. */
export function fullStamp(at: number): string {
  const d = new Date(at)
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${two(d.getHours())}:${two(d.getMinutes())}`
}

/** "09:00" today, "Fri 09:00" this week, else "23 Oct 09:00". */
export function whenText(at: number, now: number): string {
  const d = new Date(at)
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`
  if (d.toDateString() === new Date(now).toDateString()) return time
  if (Math.abs(at - now) < 6 * DAY) return `${DAYS[d.getDay()]} ${time}`
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${time}`
}

export const REPEAT_WORDS: Record<Repeat, string> = { daily: 'every day', weekly: 'every week', monthly: 'every month', yearly: 'every year' }

/** What /remind and the tool answer: "Reminder set for Fri 23 Oct 09:00, every day: pills." */
export function setText(r: { at: number; repeat: Repeat | null; text: string }): string {
  return `Reminder set for ${fullStamp(r.at)}${r.repeat ? `, ${REPEAT_WORDS[r.repeat]}` : ''}: ${r.text}.`
}
