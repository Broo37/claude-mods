// What a tool call came to: how long it took, and whether it failed.
export type Call = { ms: number; isError: boolean }

// What a turn came to. The cost and the share of the five-hour limit are what
// the turn added; either is null when it could not be read.
export type Receipt = {
  durationMs: number
  tools: number
  failed: number
  costUsd: number | null
  fiveHour: number | null
  doneAt: number
}

// One part of a receipt as it is drawn: a theme color, bold, or dim.
export type Part = { text: string; color?: string; isBold?: boolean; isDim?: boolean }

const whole = (seconds: number) => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }

  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`
}

// How long a tool call took: most take a second or two, where a tenth tells
// one from another.
export const tookOf = (ms: number) => {
  const tenths = Math.round(ms / 100)

  return tenths < 100 ? `${(tenths / 10).toFixed(1)}s` : whole(Math.round(ms / 1000))
}

// How long a turn lasted, in whole seconds as Claude Code writes it.
export const lastedOf = (ms: number) => whole(Math.round(ms / 1000))

const two = (value: number) => String(value).padStart(2, '0')

// The time of day, local, as hours and minutes.
export const clockOf = (at: number) => {
  const date = new Date(at)

  return `${two(date.getHours())}:${two(date.getMinutes())}`
}

type Row = { isRunning: boolean; isErrored: boolean; isInterrupted: boolean }

// What stands at the end of a tool row: a check or a cross and how long the
// call took. A call that was not timed (it ran before this mod was there, or
// another mod refused it first) gets a cross alone when it failed, and nothing
// when it did not: a row with no mark is not a claim that it went well.
export const badgeOf = (call: Call | undefined, row: Row) => {
  if (call === undefined) {
    return row.isErrored && !row.isRunning ? { text: '✗', color: 'error' } : null
  }

  if (row.isInterrupted) {
    return { text: `✗ ${tookOf(call.ms)}`, color: 'warning' }
  }

  return call.isError || row.isErrored
    ? { text: `✗ ${tookOf(call.ms)}`, color: 'error' }
    : { text: `✓ ${tookOf(call.ms)}`, color: 'success' }
}

// A share of the limit with its tenth only where it has one.
const share = (points: number) => String(Math.round(points * 10) / 10)

// The parts of a turn's receipt, in the order they are drawn, without what the
// turn did not have: no tools, nothing failed, no cost worth a cent, no share
// of the limit worth half a point.
export const partsOf = ({ durationMs, tools, failed, costUsd, fiveHour, doneAt }: Receipt): Part[] => [
  { text: lastedOf(durationMs), isBold: true },
  ...(tools > 0 ? [{ text: `${tools} ${tools === 1 ? 'tool' : 'tools'}`, color: 'suggestion' }] : []),
  ...(failed > 0 ? [{ text: `${failed} failed`, color: 'error' }] : []),
  ...(costUsd !== null && costUsd >= 0.005 ? [{ text: `$ ${costUsd.toFixed(2)}`, color: 'warning' }] : []),
  ...(fiveHour !== null && fiveHour >= 0.5 ? [{ text: `5H +${share(fiveHour)}%`, color: 'claude' }] : []),
  { text: `done ${clockOf(doneAt)}`, isDim: true },
]
