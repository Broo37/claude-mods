import type { Peer, View } from '../types'

import { clampPercent, remaining, resetDate } from './format'

// A reading is called out once as it climbs past each of these.
const MARKS = [80, 90]

const ALARM = 90

const limitOf = (view: View, kind: string) => view.limits.find(limit => limit.kind === kind)

// The warning for a reading that climbed past a mark, or none: one line even
// when it passed both, and nothing while it stays between two marks or falls.
const climbOf = (label: string, before: number, after: number, detail: string) => {
  const from = clampPercent(before)
  const to = clampPercent(after)

  if (!MARKS.some(mark => from < mark && to >= mark)) {
    return []
  }

  return [`${to >= ALARM ? '🚨' : '⚠️'} ${label} at ${to}%${detail === '' ? '' : ` · ${detail}`}`]
}

// What to tell the person as the view moves from one reading to the next.
export const warningsOf = (before: View, after: View): string[] => {
  const fiveHour = limitOf(after, 'five_hour')
  const sevenDay = limitOf(after, 'seven_day')

  return [
    ...(fiveHour === undefined
      ? []
      : climbOf(
          '5H limit',
          limitOf(before, 'five_hour')?.percentUsed ?? 0,
          fiveHour.percentUsed,
          fiveHour.resetsAt === null ? '' : `resets in ${remaining(fiveHour.resetsAt - after.now)}`,
        )),
    ...(sevenDay === undefined
      ? []
      : climbOf(
          '7D limit',
          limitOf(before, 'seven_day')?.percentUsed ?? 0,
          sevenDay.percentUsed,
          sevenDay.resetsAt === null ? '' : `resets ${resetDate(sevenDay.resetsAt)}`,
        )),
    ...climbOf('Context', before.contextPercent, after.contextPercent, '/compact frees room'),
  ]
}

// What the person should hear about the other sessions: one that has started
// to need an answer, one that was working and now waits for them. A session
// seen for the first time is no news, whatever it is doing.
export const peerNews = (before: Peer[], after: Peer[]) =>
  after.flatMap(peer => {
    const was = before.find(other => other.id === peer.id)

    if (was === undefined) {
      return []
    }

    if (peer.needs !== '') {
      return was.needs === '' ? [`🙋 ${peer.name} needs you`] : []
    }

    return was.status === 'busy' && peer.status === 'idle' ? [`🕐 ${peer.name} is waiting for you`] : []
  })
