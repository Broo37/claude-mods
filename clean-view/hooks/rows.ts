import { iconOf } from './icons'
import type { CleanViewAction as Action, CleanViewChecklist as Checklist, CleanViewTask as Task } from '../types'

// What the band shows of a checklist, as runs of text with a theme color, bold,
// dim or inverse: the header's line, a row a step, and under a step the person
// opened, what Claude did in it. Pure, so that it reads the same on every surface.

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

// A step's emoji and the space after it: an emoji is two columns wide.
const ICON = 3

// What a row holds beside the name: its mark, its emoji, the gaps, the meter
// and the longest label ("Up next", "Working").
const BESIDE = 2 + ICON + 2 + METER + 2 + 7

// Where a step's name starts in a stacked tab: after its mark and its emoji.
const INDENT = 2 + ICON

// A step's arrow in the band: open, closed, or the room of one where the step
// has nothing to show.
const ARROWS = { open: '▾ ', closed: '▸ ', none: '  ' } as const
const ARROW = 2

// Where what an opened step did starts: under its name, past its arrow, mark and emoji.
const UNDER = ARROW + INDENT

// The name column: as wide as the longest name needs, within these.
const NARROWEST = 20
const WIDEST = 40

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

// From this long an action is slow, and says how long it took.
const SLOW = 3 * SECOND

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

// The start of a text in the room, short of an emoji the end would cut in half.
const startOf = (text: string, room: number) => {
  const part = text.slice(0, Math.max(0, room))

  return /[\uD800-\uDBFF]$/.test(part) ? part.slice(0, -1) : part
}

const cut = (text: string, room: number) => {
  if (text.length <= room) {
    return text
  }

  return room < 1 ? '' : `${startOf(text, room - 1).trimEnd()}…`
}

// The runs within the room: the one that gives way is cut first, and whatever
// still does not fit is left out from the end.
const fitted = (runs: readonly Run[], flexible: number, columns: number): Run[] => {
  const others = runs.reduce((sum, run, i) => (i === flexible ? sum : sum + run.text.length), 0)
  let room = columns

  return runs
    .map((run, i) => (i === flexible ? { ...run, text: cut(run.text, columns - others) } : run))
    .map(run => {
      const text = startOf(run.text, room)
      room -= text.length

      return { ...run, text }
    })
    .filter(run => run.text !== '')
}

// The words of a text, a line as many as the room holds; a word longer than
// the room is cut.
const wrapped = (text: string, columns: number): string[] => {
  const lines: string[] = []
  let line = ''

  for (const word of text.split(/\s+/).filter(part => part !== '')) {
    const longer = line === '' ? word : `${line} ${word}`

    if (longer.length <= columns) {
      line = longer
    } else {
      if (line !== '') {
        lines.push(line)
      }

      line = cut(word, columns)
    }
  }

  return line === '' ? lines : [...lines, line]
}

// The badge of a job that waits on the person. It pulses slowly, to be seen
// without shouting.
const badgeOf = (tick: number): Run => ({
  text: ' Needs you ',
  color: 'warning',
  isBold: true,
  ...(tick % PULSE < PULSE / 2 && { isInverse: true }),
})

export const headerOf = (list: Checklist, now: number, columns: number, tick = 0): Run[] => {
  const started = list.startedAt ?? now

  switch (list.phase) {
    case 'idle':
      return []
    case 'working':
      return fitted([{ text: list.title, isBold: true }, { text: ` · ${durationOf(now - started)}`, isDim: true }], 0, columns)
    case 'needs-you':
      return fitted([badgeOf(tick), { text: ` ${list.needsYouReason ?? ''}` }], 1, columns)
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

// A meter that sweeps: a step at work that has reported nothing yet.
const sweepOf = (tick: number): Run[] => meterOf(cell => (((cell - tick) % METER) + METER) % METER < SWEEP, 'claude')

// The meter of the step at work and what follows it: its percent once
// reported; else a sweep while the job works, and an empty meter while it is
// held, where a sweep would say it still moved.
const gaugeOf = (task: Task, phase: Checklist['phase'], tick: number): Run[] => {
  if (task.hasReported) {
    return [...meterOf(cell => cell < Math.round((task.percent * METER) / 100), 'claude'), { text: `  ${task.percent}%`, isBold: true }]
  }

  return phase === 'working'
    ? [...sweepOf(tick), { text: '  Working' }]
    : [{ text: '░'.repeat(METER), isDim: true }, { text: phase === 'stopped' ? '  Stopped' : '  Paused' }]
}

const rowOf = (task: Task, name: string, phase: Checklist['phase'], isNext: boolean, tick: number): Run[] => {
  const icon = `${iconOf(task)} `

  if (task.status === 'done') {
    return [
      { text: '✓ ', color: 'success' },
      { text: icon, isDim: true },
      { text: name, isDim: true },
      // Full meters a row apart read as one bright slab: a done step's is dim.
      { text: '█'.repeat(METER), color: 'success', isDim: true },
      { text: '  Done', isDim: true },
    ]
  }

  if (task.status === 'active') {
    return [markOf(phase), { text: icon }, { text: name, isBold: true }, ...gaugeOf(task, phase, tick)]
  }

  return [
    { text: '○ ', isDim: true },
    { text: icon, isDim: true },
    { text: name, isDim: true },
    { text: '░'.repeat(METER), isDim: true },
    { text: isNext ? '  Next' : '  Up next', isDim: true },
  ]
}

export const rowsOf = (list: Checklist, tick: number, columns: number): Run[][] => {
  if (list.phase === 'idle') {
    return []
  }

  const longest = Math.max(0, ...list.tasks.map(task => task.name.length))
  const width = Math.max(4, Math.min(Math.max(longest, NARROWEST), WIDEST, columns - BESIDE))
  const next = list.tasks.findIndex(task => task.status === 'upcoming')

  return list.tasks.map((task, i) => rowOf(task, `${cut(task.name, width).padEnd(width)}  `, list.phase, i === next, tick))
}

// A step of the band: its row, with the arrow that opens it, and, opened, what
// Claude did in it.
export type BandStep = { id: string; canOpen: boolean; isOpen: boolean; row: Run[]; details: Run[][] }

// A step has something to show once Claude did something in it, or noted it.
const hasShown = (task: Task) => task.note !== undefined || (task.actions?.length ?? 0) > 0

// An action as a line: how it went, and why it failed or how long it took
// where that is worth saying. What went well is dim; what failed is not.
const actionLineOf = (action: Action, columns: number): Run[] => {
  const under: Run = { text: ' '.repeat(UNDER) }

  switch (action.status) {
    case 'ok':
      return fitted(
        [
          under,
          { text: '✓ ', color: 'success' },
          { text: action.text, isDim: true },
          ...((action.ms ?? 0) >= SLOW ? [{ text: ` · ${durationOf(action.ms ?? 0)}`, isDim: true }] : []),
        ],
        2,
        columns,
      )
    case 'failed':
      return fitted(
        [under, { text: '✗ ', color: 'error' }, { text: action.text }, { text: action.why === undefined ? ' · failed' : ` · failed: ${action.why}`, color: 'error' }],
        2,
        columns,
      )
    case 'running':
      return fitted([under, { text: '◌ ', color: 'claude' }, { text: action.text }, { text: ' · running', isDim: true }], 2, columns)
  }
}

// What an opened step shows: Claude's note on it, wrapped under itself, how
// many older actions were let go, then the actions it keeps, oldest first.
const detailsOf = (task: Task, columns: number): Run[][] => {
  const under: Run = { text: ' '.repeat(UNDER) }
  const note = task.note === undefined ? [] : wrapped(task.note, Math.max(1, columns - UNDER)).map(line => fitted([under, { text: line }], -1, columns))
  const earlier = (task.earlier ?? 0) > 0 ? [fitted([under, { text: `… ${task.earlier} earlier`, isDim: true }], -1, columns)] : []

  return [...note, ...earlier, ...(task.actions ?? []).map(action => actionLineOf(action, columns))]
}

// The steps as the band draws them: a row a step after the room of its arrow,
// and under each step the person opened, what Claude did in it.
export const bandStepsOf = (list: Checklist, opened: readonly string[], tick: number, columns: number): BandStep[] => {
  const rows = rowsOf(list, tick, columns - ARROW)

  return list.tasks.map((task, i) => {
    const canOpen = hasShown(task)
    const isOpen = canOpen && opened.includes(task.id)
    const arrow: Run = canOpen ? { text: isOpen ? ARROWS.open : ARROWS.closed, color: 'claude' } : { text: ARROWS.none }

    return { id: task.id, canOpen, isOpen, row: fitted([arrow, ...(rows[i] ?? [])], -1, columns), details: isOpen ? detailsOf(task, columns) : [] }
  })
}

// Under this width a step's row has no room for its name beside the meter, as
// in the dock's Checklist tab: there a step is a line of its own, and the step
// at work has its meter on the line under it.
const ONE_ROW = NARROWEST + BESIDE

// What the job is doing, under its name in a narrow tab, and why it waits or
// is stuck, in as many lines as that takes.
const stateOf = (list: Checklist, now: number, columns: number, tick: number): Run[][] => {
  const started = list.startedAt ?? now
  const said = (text: string) => wrapped(text, columns).map((line): Run[] => [{ text: line }])

  switch (list.phase) {
    case 'idle':
      return []
    case 'working':
      return [fitted([{ text: '▶ ', color: 'claude' }, { text: 'Working' }, { text: ` · ${durationOf(now - started)}`, isDim: true }], -1, columns)]
    case 'needs-you':
      return [[badgeOf(tick)], ...said(list.needsYouReason ?? '')]
    case 'stuck':
      return [[{ text: '⚠ Stuck', color: 'warning' }], ...said(list.stuckReason ?? '')]
    case 'stopped':
      return [fitted([{ text: '■ Stopped', color: 'error', isBold: true }, { text: ' · you pressed Esc', isDim: true }], -1, columns)]
    case 'done':
      return [
        fitted(
          [{ text: '✓ All done', color: 'success', isBold: true }, { text: ` · took ${durationOf((list.finishedAt ?? now) - started)}`, isDim: true }],
          -1,
          columns,
        ),
      ]
  }
}

// The steps a line each, a long name wrapped under itself, and the one at work
// with its meter under it.
const stackedOf = (list: Checklist, columns: number, tick: number): Run[][] => {
  const room = Math.max(1, columns - INDENT)
  const under: Run = { text: ' '.repeat(INDENT) }

  return list.tasks.flatMap((task): Run[][] => {
    const [first = '', ...more] = wrapped(task.name, room)
    const isActive = task.status === 'active'
    const look = isActive ? { isBold: true } : { isDim: true }
    const mark = task.status === 'done' ? { text: '✓ ', color: 'success' } : isActive ? markOf(list.phase) : { text: '○ ', isDim: true }
    const lines: Run[][] = [
      [mark, { text: `${iconOf(task)} `, ...(!isActive && { isDim: true }) }, { text: first, ...look }],
      ...more.map((line): Run[] => [under, { text: line, ...look }]),
    ]

    return isActive ? [...lines, [under, ...gaugeOf(task, list.phase, tick)]] : lines
  })
}

// The Checklist tab of the dock, a plain list: no step opens there. Narrow, as
// the dock is, it stacks: the job's name, what it is doing, then the steps.
// Wide enough, it is the band's layout without the arrows.
export const paneLinesOf = (list: Checklist, now: number, columns: number, tick: number): Run[][] => {
  if (list.phase === 'idle') {
    return wrapped(NO_JOB, columns).map(line => [{ text: line, isDim: true }])
  }

  if (columns >= ONE_ROW) {
    return [headerOf(list, now, columns, tick), ...rowsOf(list, tick, columns)]
  }

  return [
    ...wrapped(list.title, columns).map((line): Run[] => [{ text: line, isBold: true }]),
    ...stateOf(list, now, columns, tick),
    [{ text: ' ' }],
    ...stackedOf(list, columns, tick),
  ]
}

// What stands over the waterfall while a job runs, in two lines: the step it
// is on, of how many, and then how far it is; or what holds or ended the job.
export const stripOf = (list: Checklist, now: number, columns: number, tick: number): Run[][] => {
  if (list.phase === 'idle') {
    return []
  }

  const started = list.startedAt ?? now
  const at = list.tasks.findIndex(task => task.status === 'active')
  const task = list.tasks[at]
  const done = list.tasks.filter(step => step.status === 'done').length
  const count = list.tasks.length === 0 ? '' : `${at >= 0 ? at + 1 : done}/${list.tasks.length}`
  const after = (text: string): Run[] => (count === '' ? [] : [{ text: `${text}${count}`, isDim: true }])
  const under = (text: string): Run[] => [{ text: `  ${cut(text, columns - 2)}`, isDim: true }]

  switch (list.phase) {
    case 'working': {
      const lead = count === '' ? [] : [{ text: `${count} `, isDim: true }]
      const named: Run[] = task === undefined ? [{ text: list.title, isBold: true }] : [{ text: `${iconOf(task)} ` }, { text: task.name, isBold: true }]

      return [
        fitted([markOf(list.phase), ...lead, ...named], lead.length + named.length, columns),
        fitted(
          [{ text: '  ' }, ...(task === undefined ? [...sweepOf(tick), { text: '  Working' }] : gaugeOf(task, list.phase, tick)), { text: ` · ${durationOf(now - started)}`, isDim: true }],
          -1,
          columns,
        ),
      ]
    }
    case 'needs-you':
      return [fitted([badgeOf(tick), ...after(' ')], -1, columns), under(list.needsYouReason ?? '')]
    case 'stuck':
      return [fitted([{ text: '⚠ Stuck', color: 'warning' }, ...after(' · ')], -1, columns), under(list.stuckReason ?? '')]
    case 'stopped':
      return [fitted([{ text: '■ Stopped', color: 'error', isBold: true }, ...after(' · ')], -1, columns), under('you pressed Esc')]
    case 'done':
      return [
        fitted([{ text: '✓ All done', color: 'success', isBold: true }, ...after(' · ')], -1, columns),
        under(`took ${durationOf((list.finishedAt ?? now) - started)}`),
      ]
  }
}
