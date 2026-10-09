import { cleanName } from './names'
import type { CleanViewChecklist as Checklist, CleanViewTask as Task } from '../types'

// The rules of the checklist, as plain functions from one checklist to the
// next: what a plan, a progress report, a to-do list, a question, a failure
// and the end of a turn each make of it.

export type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed' }

export type TaskChange = { status?: 'pending' | 'in_progress' | 'completed' | 'deleted'; subject?: string }

export type TurnEnd = { reason: 'answer' | 'aborted' | 'refusal' | 'error'; answer: string }

// Why the job waits on the person, or is stuck, each in one plain sentence.
export const REASONS = {
  ok: 'Claude needs your OK to continue',
  question: 'Claude has a question for you',
  reply: 'Claude is waiting for your reply',
  saidNo: 'you said no to a step, so Claude paused',
  failing: 'a step keeps failing, Claude is trying another way',
  refused: "Claude couldn't help with that request",
} as const

// A plan's most steps.
const STEPS = 8

// The title of a job nobody named.
const UNTITLED = 'Working on it'

// What stands on the checklist until the plan arrives.
const PLACEHOLDER = 'placeholder-'
const PLACEHOLDERS = ['Understand your request', 'Plan the steps']

export const IDLE: Checklist = {
  title: '',
  phase: 'idle',
  tasks: [],
  needsYouReason: null,
  stuckReason: null,
  startedAt: null,
  finishedAt: null,
  isCollapsed: false,
}

const stepOf = (id: string, name: string, status: Task['status'] = 'upcoming'): Task => ({
  id,
  name: cleanName(name),
  status,
  percent: status === 'done' ? 100 : 0,
  hasReported: false,
})

const done = (task: Task): Task => ({ ...task, status: 'done', percent: 100 })

const isPlaceholder = (task: Task) => task.id.startsWith(PLACEHOLDER)

const planned = (list: Checklist) => list.tasks.filter(task => !isPlaceholder(task))

const working = (list: Checklist): Checklist => ({ ...list, phase: 'working', needsYouReason: null, stuckReason: null })

// A job is underway from its start until its turn ends for good: done, stopped
// or stuck on what ended it. One waiting for a reply is still underway.
export const isUnderway = (list: Checklist): boolean =>
  list.phase === 'working' || list.phase === 'needs-you' || (list.phase === 'stuck' && list.finishedAt === null)

// The placeholders are no plan: a plan is steps Claude laid out.
export const hasPlan = (list: Checklist): boolean => list.tasks.length > 0 && !list.tasks.some(isPlaceholder)

export const isWaitingForReply = (list: Checklist): boolean => list.phase === 'needs-you' && list.needsYouReason === REASONS.reply

// An API error that ended a turn, by what its text says. The engine names no
// kind, so the text is all there is; one that fits none gets a sentence too.
const SENTENCES = {
  compact: 'type /compact and try again',
  login: 'type /login',
  busy: "Claude's servers are busy, try again in a minute",
  limit: 'you hit your usage limit, try again a little later',
  network: 'the internet connection dropped',
  other: 'something went wrong on the way, try again',
} as const

export const errorSentence = (answer: string): string => {
  if (/prompt is too long|context (?:window|length|limit)|too many tokens/i.test(answer)) {
    return SENTENCES.compact
  }

  if (/\b401\b|\b403\b|authenticat|unauthori[sz]ed|api key|\/login/i.test(answer)) {
    return SENTENCES.login
  }

  if (/\b529\b|overloaded/i.test(answer)) {
    return SENTENCES.busy
  }

  if (/\b429\b|rate.?limit|(?:usage|session|weekly|hour) limit|limit reached|quota/i.test(answer)) {
    return SENTENCES.limit
  }

  if (/connection|network|offline|fetch failed|timed? ?out|ECONN|ENOTFOUND|EAI_AGAIN/i.test(answer)) {
    return SENTENCES.network
  }

  return SENTENCES.other
}

// The kinds Claude Code sorts API errors into, where the kind alone says which
// sentence fits; any other kind is told by the error's text.
const KINDS: Record<string, string> = {
  rate_limit: SENTENCES.limit,
  overloaded: SENTENCES.busy,
  server_error: SENTENCES.busy,
  authentication_failed: SENTENCES.login,
  oauth_org_not_allowed: SENTENCES.login,
  cloud_credential_error: SENTENCES.login,
}

export const sentenceFor = (kind: string, text: string): string => KINDS[kind] ?? errorSentence(text)

const API_SENTENCES: readonly string[] = Object.values(SENTENCES)

// An API error ended the turn, and Claude Code named its kind: an event of its
// own, which may come before the turn's end or after it. Before, the job is
// stuck there and then; after, the sentence the turn's end made do with gives
// way to this one. A job that ended any other way is left as it is.
export const failTurn = (list: Checklist, sentence: string, now: number): Checklist => {
  const hasEndedOnOne =
    list.phase === 'stuck' && list.finishedAt !== null && list.stuckReason !== null && API_SENTENCES.includes(list.stuckReason)

  return isUnderway(list) || hasEndedOnOne
    ? { ...list, phase: 'stuck', stuckReason: sentence, needsYouReason: null, finishedAt: list.finishedAt ?? now }
    : list
}

const jobOf = (title: string, now: number, tasks: Task[]): Checklist => ({ ...IDLE, title, phase: 'working', tasks, startedAt: now })

export const startJob = (title: string, now: number): Checklist =>
  jobOf(
    title,
    now,
    PLACEHOLDERS.map((name, i) => stepOf(`${PLACEHOLDER}${i + 1}`, name, i === 0 ? 'active' : 'upcoming')),
  )

// The job a step belongs to: the one underway, or a new one where a step
// arrives with none (a turn a command started, or one begun before the mod).
const underway = (list: Checklist, now: number) => (isUnderway(list) ? list : jobOf(UNTITLED, now, []))

export const resumeJob = (list: Checklist): Checklist => working(list)

export const rename = (list: Checklist, title: string): Checklist => ({ ...list, title })

export const planSteps = (list: Checklist, names: readonly string[], now: number): Checklist => ({
  ...underway(list, now),
  tasks: names.slice(0, STEPS).map((name, i) => stepOf(`step-${i + 1}`, name, i === 0 ? 'active' : 'upcoming')),
})

// A reported percent as the checklist keeps it: whole, 0 to 100.
export const percentOf = (percent: number): number => (Number.isFinite(percent) ? Math.round(Math.min(100, Math.max(0, percent))) : 0)

// Where a step that is not in the plan goes: after the one Claude is on.
const afterCurrent = (tasks: readonly Task[]) => {
  let at = 0

  tasks.forEach((task, i) => {
    if (task.status !== 'upcoming') {
      at = i + 1
    }
  })

  return at
}

export const reportProgress = (list: Checklist, name: string, percent: number, now: number): Checklist => {
  const job = underway(list, now)
  const amount = percentOf(percent)
  const wanted = cleanName(name).toLowerCase()
  const tasks = planned(job)
  const found = tasks.findIndex(task => task.name.toLowerCase() === wanted)
  const at = found < 0 ? afterCurrent(tasks) : found

  if (found < 0) {
    tasks.splice(at, 0, stepOf(`added-${tasks.length + 1}`, name))
  }

  return {
    ...job,
    tasks: tasks.map((task, i) => {
      if (i < at) {
        return done(task)
      }

      if (i === at) {
        return amount === 100 ? done(task) : { ...task, status: 'active', percent: amount, hasReported: true }
      }

      // The step after one just finished starts; no other step is the current one.
      if (i === at + 1 && amount === 100 && task.status !== 'done') {
        return { ...task, status: 'active' }
      }

      return task.status === 'active' ? { ...task, status: 'upcoming' } : task
    }),
  }
}

const STATUS = { pending: 'upcoming', in_progress: 'active', completed: 'done' } as const

export const fromTodos = (list: Checklist, todos: readonly Todo[], now: number): Checklist => {
  if (todos.length === 0) {
    return list
  }

  const job = underway(list, now)

  return {
    ...job,
    tasks: todos.map((todo, i) => {
      const step = stepOf(`todo-${i + 1}`, todo.content, STATUS[todo.status])
      // What was reported for the step stands when the list is written again.
      const before = job.tasks.find(task => task.name === step.name)

      return before === undefined || step.status === 'upcoming'
        ? step
        : { ...step, percent: step.status === 'done' ? 100 : before.percent, hasReported: before.hasReported }
    }),
  }
}

const taskId = (id: string) => `task-${id}`

export const addTask = (list: Checklist, id: string, subject: string, now: number): Checklist => {
  const job = underway(list, now)

  return { ...job, tasks: [...planned(job).filter(task => task.id !== taskId(id)), stepOf(taskId(id), subject)] }
}

export const changeTask = (list: Checklist, id: string, change: TaskChange): Checklist => {
  if (!list.tasks.some(task => task.id === taskId(id))) {
    return list
  }

  if (change.status === 'deleted') {
    return { ...list, tasks: list.tasks.filter(task => task.id !== taskId(id)) }
  }

  const status = change.status === undefined ? undefined : STATUS[change.status]

  return {
    ...list,
    tasks: list.tasks.map(task => {
      if (task.id !== taskId(id)) {
        return task
      }

      const named = change.subject === undefined ? task : { ...task, name: cleanName(change.subject) }

      return status === undefined ? named : status === 'done' ? done(named) : { ...named, status }
    }),
  }
}

export const needsYou = (list: Checklist, reason: string): Checklist =>
  isUnderway(list) ? { ...list, phase: 'needs-you', needsYouReason: reason, stuckReason: null } : list

// The next tool running means the person answered what the job waited on.
export const toolStarted = (list: Checklist): Checklist => (list.phase === 'needs-you' ? working(list) : list)

// A tool that succeeds means the job is moving again, whatever held it.
export const toolSucceeded = (list: Checklist): Checklist => (isUnderway(list) && list.phase !== 'working' ? working(list) : list)

export const stuck = (list: Checklist, reason: string): Checklist =>
  isUnderway(list) ? { ...list, phase: 'stuck', stuckReason: reason, needsYouReason: null } : list

export const endTurn = (list: Checklist, end: TurnEnd, now: number): Checklist => {
  if (!isUnderway(list)) {
    return list
  }

  const ended = { ...list, finishedAt: now, needsYouReason: null }

  if (end.reason === 'error') {
    return { ...ended, phase: 'stuck', stuckReason: errorSentence(end.answer) }
  }

  if (end.reason === 'refusal') {
    return { ...ended, phase: 'stuck', stuckReason: REASONS.refused }
  }

  // A step the person said no to is why the turn ended, however it ended.
  if (list.phase === 'stuck' && list.stuckReason === REASONS.saidNo) {
    return ended
  }

  if (end.reason === 'aborted') {
    return { ...ended, phase: 'stopped', stuckReason: null }
  }

  // With no plan there is nothing left to do: the placeholders are checked off.
  const tasks = hasPlan(list) ? list.tasks : list.tasks.map(done)

  return tasks.every(task => task.status === 'done')
    ? { ...ended, tasks, phase: 'done', stuckReason: null }
    : { ...list, phase: 'needs-you', needsYouReason: REASONS.reply, stuckReason: null, finishedAt: null }
}

export const collapse = (list: Checklist): Checklist => (list.phase === 'done' ? { ...list, isCollapsed: true } : list)
