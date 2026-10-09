import type { CleanViewChecklist as Checklist, CleanViewTask as Task } from '../types'

// What the band shows of a checklist, as runs of text with a theme color, bold,
// dim or inverse: the header's line and a row a step. Pure, so that it reads
// the same on every surface.

export type Run = { text: string; color?: string; isBold?: boolean; isDim?: boolean; isInverse?: boolean }

export const BUTTON = { on: '● Clean View: ON', off: '○ Clean View: OFF' } as const

// The band's two tabs, where the checklist shares it with another mod's band.
export const TABS = { checklist: 'Checklist', status: 'Status' } as const

// What the checklist's tab says of the job while the other tab is in front.
export const TAB_MARKS: Record<Checklist['phase'], string> = {
  idle: '',
  working: ' ▶',
  'needs-you': ' ‖',
  stuck: ' ⚠',
  stopped: ' ■',
  done: ' ✓',
}

// What the checklist's tab holds before any job has run.
export const NO_JOB = 'No job yet: your next request shows here as a checklist.'

// A meter's cells, at any width.
const METER = 10

// How many cells of a meter are lit while nothing was reported for its step.
const SWEEP = 3

// The frames of one pulse of the Needs you badge: half of them lit.
const PULSE = 8

// What a row holds beside the name: its mark, the gaps, the meter and the
// longest label ("Up next", "Working").
const BESIDE = 2 + 2 + METER + 2 + 7

// The name column: as wide as the longest name needs, within these.
const NARROWEST = 20
const WIDEST = 40

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

export const durationOf = (ms: number): string => {
  const whole = Math.max(0, ms)

  if (whole >= HOUR) {
    return `${Math.floor(whole / HOUR)}h ${Math.floor((whole % HOUR) / MINUTE)}m`
  }

  if (whole >= MINUTE) {
    return `${Math.floor(whole / MINUTE)}m ${Math.floor((whole % MINUTE) / SECOND)}s`
  }

  return `${Math.floor(whole / SECOND)}s`
}

const cut = (text: string, room: number) => {
  if (text.length <= room) {
    return text
  }

  return room < 1 ? '' : `${text.slice(0, room - 1).trimEnd()}…`
}

// The runs within the room: the one that gives way is cut first, and whatever
// still does not fit is left out from the end.
const fitted = (runs: readonly Run[], flexible: number, columns: number): Run[] => {
  const others = runs.reduce((sum, run, i) => (i === flexible ? sum : sum + run.text.length), 0)
  let room = columns

  return runs
    .map((run, i) => (i === flexible ? { ...run, text: cut(run.text, columns - others) } : run))
    .map(run => {
      const text = run.text.slice(0, Math.max(0, room))
      room -= text.length

      return { ...run, text }
    })
    .filter(run => run.text !== '')
}

export const headerOf = (list: Checklist, now: number, columns: number, tick = 0): Run[] => {
  const started = list.startedAt ?? now

  switch (list.phase) {
    case 'idle':
      return []
    case 'working':
      return fitted([{ text: list.title, isBold: true }, { text: ` · ${durationOf(now - started)}`, isDim: true }], 0, columns)
    case 'needs-you':
      return fitted(
        [
          // The badge pulses slowly, to be seen without shouting.
          { text: ' Needs you ', color: 'warning', isBold: true, ...(tick % PULSE < PULSE / 2 && { isInverse: true }) },
          { text: ` ${list.needsYouReason ?? ''}` },
        ],
        1,
        columns,
      )
    case 'stuck':
      return fitted([{ text: `⚠ Stuck: ${list.stuckReason ?? ''}`, color: 'warning' }], 0, columns)
    case 'stopped':
      return fitted(
        [{ text: '■ Stopped', color: 'error', isBold: true }, { text: ' · ' }, { text: list.title }, { text: ' · you pressed Esc', isDim: true }],
        2,
        columns,
      )
    case 'done':
      return fitted(
        [
          { text: '✓ All done', color: 'success', isBold: true },
          { text: ' · ' },
          { text: list.title },
          { text: ` · took ${durationOf((list.finishedAt ?? now) - started)}`, isDim: true },
        ],
        2,
        columns,
      )
  }
}

// A meter as runs: the lit cells in a color, the rest dim.
const meterOf = (isLit: (cell: number) => boolean, color: string): Run[] => {
  const runs: Run[] = []

  for (let cell = 0; cell < METER; cell += 1) {
    const lit = isLit(cell)
    const last = runs.at(-1)

    if (last !== undefined && (last.color !== undefined) === lit) {
      last.text += lit ? '█' : '░'
    } else {
      runs.push(lit ? { text: '█', color } : { text: '░', isDim: true })
    }
  }

  return runs
}

// The current step's mark, by what the job is doing: at work, held, or stopped.
const markOf = (phase: Checklist['phase']): Run => {
  if (phase === 'stopped') {
    return { text: '■ ', color: 'error' }
  }

  return phase === 'needs-you' || phase === 'stuck' ? { text: '‖ ', color: 'warning' } : { text: '▶ ', color: 'claude' }
}

const rowOf = (task: Task, name: string, phase: Checklist['phase'], isNext: boolean, tick: number): Run[] => {
  if (task.status === 'done') {
    return [
      { text: '✓ ', color: 'success' },
      { text: name, isDim: true },
      // Full meters a row apart read as one bright slab: a done step's is dim.
      { text: '█'.repeat(METER), color: 'success', isDim: true },
      { text: '  Done', isDim: true },
    ]
  }

  if (task.status === 'active') {
    const mark = markOf(phase)

    if (task.hasReported) {
      return [
        mark,
        { text: name, isBold: true },
        ...meterOf(cell => cell < Math.round((task.percent * METER) / 100), 'claude'),
        { text: `  ${task.percent}%`, isBold: true },
      ]
    }

    // Nothing was reported yet: the meter sweeps while the job works, and
    // stands empty while it is held, where a sweep would say it still moved.
    return phase === 'working'
      ? [mark, { text: name, isBold: true }, ...meterOf(cell => (((cell - tick) % METER) + METER) % METER < SWEEP, 'claude'), { text: '  Working' }]
      : [mark, { text: name, isBold: true }, { text: '░'.repeat(METER), isDim: true }, { text: phase === 'stopped' ? '  Stopped' : '  Paused' }]
  }

  return [
    { text: '○ ', isDim: true },
    { text: name, isDim: true },
    { text: '░'.repeat(METER), isDim: true },
    { text: isNext ? '  Next' : '  Up next', isDim: true },
  ]
}

export const rowsOf = (list: Checklist, tick: number, columns: number): Run[][] => {
  if (list.phase === 'idle' || list.isCollapsed) {
    return []
  }

  const longest = Math.max(0, ...list.tasks.map(task => task.name.length))
  const width = Math.max(4, Math.min(Math.max(longest, NARROWEST), WIDEST, columns - BESIDE))
  const next = list.tasks.findIndex(task => task.status === 'upcoming')

  return list.tasks.map((task, i) => rowOf(task, `${cut(task.name, width).padEnd(width)}  `, list.phase, i === next, tick))
}
