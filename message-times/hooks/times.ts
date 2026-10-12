// A prompt the person has sent whose row has not been drawn yet.
export type Pending = { text: string; at: number }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// A prompt that draws no row (a slash command) would wait for one forever.
const WAIT_MS = 10 * 60_000

const pad = (n: number) => String(n).padStart(2, '0')

const dayOf = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`

// The time a prompt was sent, as its row shows it: the clock alone for one sent
// today, the day before the clock for any other.
export const stampOf = (at: number, now: number) => {
  const sent = new Date(at)
  const clock = `${pad(sent.getHours())}:${pad(sent.getMinutes())}`

  return dayOf(sent) === dayOf(new Date(now)) ? clock : `${sent.getDate()} ${MONTHS[sent.getMonth()]} ${clock}`
}

// A row that has just been drawn takes the time of the oldest waiting prompt
// with its words: Claude Code names the row only once it is stored, and tells
// nobody which prompt it was. A prompt that has waited too long is dropped.
export const claimed = (pending: Pending[], text: string, now: number): { at?: number; rest: Pending[] } => {
  const waiting = pending.filter(one => now - one.at <= WAIT_MS)
  const found = waiting.findIndex(one => one.text.trim() === text.trim())

  return found < 0
    ? { rest: waiting }
    : { at: waiting[found]?.at, rest: waiting.filter((_, i) => i !== found) }
}

// The newest `max` of the times kept for a session.
export const newest = (times: Record<string, number>, max: number) =>
  Object.fromEntries(
    Object.entries(times)
      .sort(([, a], [, b]) => b - a)
      .slice(0, max),
  )
