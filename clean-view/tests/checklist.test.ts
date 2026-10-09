import { expect, test } from 'claude-code/testing'

import {
  IDLE,
  REASONS,
  addTask,
  changeTask,
  collapse,
  endTurn,
  errorSentence,
  failTurn,
  fromTodos,
  hasPlan,
  isUnderway,
  isWaitingForReply,
  needsYou,
  planSteps,
  rename,
  reportProgress,
  resumeJob,
  sentenceFor,
  startJob,
  stuck,
  toolStarted,
  toolSucceeded,
} from '../hooks/checklist'
import type { CleanViewChecklist } from '../types'

const NOW = 1_000_000

const PLAN = ['Read your brand notes', 'Build the pricing section', 'Add the contact form', 'Polish the footer']

const planned = () => planSteps(startJob('Build my landing page', NOW), PLAN, NOW)

// The steps as "name:status:percent", to read a whole checklist at a glance.
const steps = (list: CleanViewChecklist) => list.tasks.map(task => `${task.name}:${task.status}:${task.percent}`)

const statuses = (list: CleanViewChecklist) => list.tasks.map(task => task.status)

const ANSWERED = { reason: 'answer', answer: 'Here you go.' } as const

test('starts a job working, with two placeholder steps until the plan arrives', () => {
  const job = startJob('Build my landing page', NOW)

  expect(job).toMatchObject({ title: 'Build my landing page', phase: 'working', startedAt: NOW, finishedAt: null, isCollapsed: false })
  expect(steps(job)).toEqual(['Understand your request:active:0', 'Plan the steps:upcoming:0'])
  expect(isUnderway(job)).toBe(true)
  expect(isUnderway(IDLE)).toBe(false)
})

test('does not take the placeholder steps for a plan', () => {
  expect(hasPlan(IDLE)).toBe(false)
  expect(hasPlan(startJob('Build my landing page', NOW))).toBe(false)
  expect(hasPlan(planned())).toBe(true)
})

test('lays out the planned steps in order, the first one started', () => {
  const job = planned()

  expect(statuses(job)).toEqual(['active', 'upcoming', 'upcoming', 'upcoming'])
  expect(job.tasks.map(task => task.name)).toEqual(PLAN)
  expect(job.tasks.every(task => !task.hasReported)).toBe(true)
  expect(job.title).toBe('Build my landing page')
})

test('passes every planned name through the cleaner, and keeps eight steps at most', () => {
  const job = planSteps(startJob('Tidy up', NOW), ['fix `src/a.ts`', ...Array.from({ length: 9 }, (unused, i) => `Do part ${i + 1}`)], NOW)

  expect(job.tasks).toHaveLength(8)
  expect(job.tasks[0]?.name).toBe('Fix')
})

test('starts a job of its own for a plan that arrives while nothing is underway', () => {
  const job = planSteps(IDLE, PLAN, NOW)

  expect(job).toMatchObject({ title: 'Working on it', phase: 'working', startedAt: NOW })
  expect(statuses(job)).toEqual(['active', 'upcoming', 'upcoming', 'upcoming'])
})

test('notes the reported percent on the current step', () => {
  const job = reportProgress(planned(), 'Read your brand notes', 40, NOW)

  expect(steps(job)[0]).toBe('Read your brand notes:active:40')
  expect(job.tasks[0]?.hasReported).toBe(true)
})

test('clamps a reported percent to 0 to 100', () => {
  expect(steps(reportProgress(planned(), 'Read your brand notes', -20, NOW))[0]).toBe('Read your brand notes:active:0')
  expect(steps(reportProgress(planned(), 'Read your brand notes', 61.4, NOW))[0]).toBe('Read your brand notes:active:61')
  expect(steps(reportProgress(planned(), 'Read your brand notes', Number.NaN, NOW))[0]).toBe('Read your brand notes:active:0')
  expect(statuses(reportProgress(planned(), 'Read your brand notes', 250, NOW))[0]).toBe('done')
})

test('checks off every step before the one reported', () => {
  const job = reportProgress(planned(), 'Add the contact form', 30, NOW)

  expect(steps(job)).toEqual([
    'Read your brand notes:done:100',
    'Build the pricing section:done:100',
    'Add the contact form:active:30',
    'Polish the footer:upcoming:0',
  ])
})

test('checks a step off at 100 and starts the next one', () => {
  const job = reportProgress(planned(), 'Read your brand notes', 100, NOW)

  expect(steps(job)).toEqual([
    'Read your brand notes:done:100',
    'Build the pricing section:active:0',
    'Add the contact form:upcoming:0',
    'Polish the footer:upcoming:0',
  ])
  expect(job.tasks[1]?.hasReported).toBe(false)
})

test('has every step done once the last one reaches 100', () => {
  const job = reportProgress(planned(), 'Polish the footer', 100, NOW)

  expect(statuses(job)).toEqual(['done', 'done', 'done', 'done'])
})

test('finds a reported step whatever its case, and through the cleaner', () => {
  const job = reportProgress(planned(), 'build the PRICING section `src/Pricing.tsx`', 60, NOW)

  expect(steps(job)[1]).toBe('Build the pricing section:active:60')
  expect(job.tasks).toHaveLength(4)
})

test('makes a new step of a name that is not in the plan, after the current one', () => {
  const job = reportProgress(reportProgress(planned(), 'Build the pricing section', 50, NOW), 'Fix a broken link', 20, NOW)

  expect(steps(job)).toEqual([
    'Read your brand notes:done:100',
    'Build the pricing section:done:100',
    'Fix a broken link:active:20',
    'Add the contact form:upcoming:0',
    'Polish the footer:upcoming:0',
  ])
})

test('makes the reported step the only one when there is no plan yet', () => {
  const job = reportProgress(startJob('Build my landing page', NOW), 'Read your brand notes', 10, NOW)

  expect(steps(job)).toEqual(['Read your brand notes:active:10'])
  expect(hasPlan(job)).toBe(true)
})

test('turns a to-do list into the checklist', () => {
  const job = fromTodos(
    startJob('Build my landing page', NOW),
    [
      { content: 'Read your brand notes', status: 'completed' },
      { content: 'Build the pricing section in `src/Pricing.tsx`', status: 'in_progress' },
      { content: 'Add the contact form', status: 'pending' },
    ],
    NOW,
  )

  expect(steps(job)).toEqual(['Read your brand notes:done:100', 'Build the pricing section in:active:0', 'Add the contact form:upcoming:0'])
  expect(hasPlan(job)).toBe(true)
})

test('keeps what was reported for a step when the to-do list is written again', () => {
  const todos = [
    { content: 'Read your brand notes', status: 'completed' },
    { content: 'Build the pricing section', status: 'in_progress' },
  ] as const
  const reported = reportProgress(fromTodos(startJob('Build my landing page', NOW), todos, NOW), 'Build the pricing section', 60, NOW)
  const again = fromTodos(reported, [...todos, { content: 'Add the contact form', status: 'pending' }], NOW)

  expect(steps(again)).toEqual(['Read your brand notes:done:100', 'Build the pricing section:active:60', 'Add the contact form:upcoming:0'])
  expect(again.tasks[1]?.hasReported).toBe(true)
})

test('leaves the checklist alone when an empty to-do list is written', () => {
  expect(fromTodos(planned(), [], NOW)).toEqual(planned())
})

test('adds a created task as an upcoming step in place of the placeholders', () => {
  const job = addTask(addTask(startJob('Build my landing page', NOW), '1', 'Read your brand notes', NOW), '2', 'Add the contact form', NOW)

  expect(steps(job)).toEqual(['Read your brand notes:upcoming:0', 'Add the contact form:upcoming:0'])
  expect(job.tasks.map(task => task.id)).toEqual(['task-1', 'task-2'])
})

test('follows a task as it is started, finished, renamed and deleted', () => {
  const created = addTask(addTask(startJob('Build my landing page', NOW), '1', 'Read your brand notes', NOW), '2', 'Add the contact form', NOW)
  const started = changeTask(created, '1', { status: 'in_progress' })
  const finished = changeTask(started, '1', { status: 'completed' })
  const renamed = changeTask(finished, '2', { subject: 'Add the `contact.tsx` booking form' })
  const deleted = changeTask(renamed, '1', { status: 'deleted' })

  expect(steps(started)[0]).toBe('Read your brand notes:active:0')
  expect(steps(finished)[0]).toBe('Read your brand notes:done:100')
  expect(steps(renamed)[1]).toBe('Add the booking form:upcoming:0')
  expect(steps(deleted)).toEqual(['Add the booking form:upcoming:0'])
  expect(changeTask(created, '9', { status: 'completed' })).toEqual(created)
})

test('waits on the person with a reason, until the next tool runs', () => {
  const waiting = needsYou(planned(), REASONS.ok)

  expect(waiting).toMatchObject({ phase: 'needs-you', needsYouReason: 'Claude needs your OK to continue' })
  expect(toolStarted(waiting)).toMatchObject({ phase: 'working', needsYouReason: null })
  expect(isUnderway(waiting)).toBe(true)
})

test('waits on nobody while no job is underway', () => {
  expect(needsYou(IDLE, REASONS.ok)).toEqual(IDLE)
})

test('is stuck with a reason until a tool succeeds', () => {
  const held = stuck(planned(), REASONS.failing)

  expect(held).toMatchObject({ phase: 'stuck', stuckReason: 'a step keeps failing, Claude is trying another way' })
  // A tool that starts has not succeeded yet.
  expect(toolStarted(held).phase).toBe('stuck')
  expect(toolSucceeded(held)).toMatchObject({ phase: 'working', stuckReason: null })
})

test('is all done when the turn ends with every step checked off', () => {
  const job = endTurn(reportProgress(planned(), 'Polish the footer', 100, NOW), ANSWERED, NOW + 134_000)

  expect(job).toMatchObject({ phase: 'done', finishedAt: NOW + 134_000, isCollapsed: false })
  expect(isUnderway(job)).toBe(false)
})

test('is all done when the turn ends without a plan ever having arrived', () => {
  const job = endTurn(startJob('Say hello', NOW), ANSWERED, NOW + 2000)

  expect(job.phase).toBe('done')
  expect(statuses(job)).toEqual(['done', 'done'])
})

test('waits for a reply when the turn ends with steps left unfinished', () => {
  const job = endTurn(reportProgress(planned(), 'Build the pricing section', 60, NOW), ANSWERED, NOW + 5000)

  expect(job).toMatchObject({ phase: 'needs-you', needsYouReason: 'Claude is waiting for your reply', finishedAt: null })
  expect(isWaitingForReply(job)).toBe(true)
  expect(isWaitingForReply(needsYou(planned(), REASONS.ok))).toBe(false)
})

test('goes on with the same checklist when the person replies', () => {
  const waiting = endTurn(reportProgress(planned(), 'Build the pricing section', 60, NOW), ANSWERED, NOW + 5000)
  const job = resumeJob(waiting)

  expect(job).toMatchObject({ phase: 'working', needsYouReason: null, title: 'Build my landing page', startedAt: NOW })
  expect(steps(job)).toEqual(steps(waiting))
})

test('is stopped when the person interrupts the turn', () => {
  const job = endTurn(planned(), { reason: 'aborted', answer: '' }, NOW + 9000)

  expect(job).toMatchObject({ phase: 'stopped', finishedAt: NOW + 9000 })
  expect(isUnderway(job)).toBe(false)
})

test('is stuck when Claude refuses the request', () => {
  const job = endTurn(planned(), { reason: 'refusal', answer: '' }, NOW + 9000)

  expect(job).toMatchObject({ phase: 'stuck', stuckReason: "Claude couldn't help with that request", finishedAt: NOW + 9000 })
})

test('says an API error that ended the turn in one calm sentence', () => {
  const job = endTurn(planned(), { reason: 'error', answer: 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' }, NOW + 9000)

  expect(job).toMatchObject({ phase: 'stuck', stuckReason: "Claude's servers are busy, try again in a minute", finishedAt: NOW + 9000 })
})

test('knows the kinds of API error by their text', () => {
  expect(errorSentence('API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}')).toBe('you hit your usage limit, try again a little later')
  expect(errorSentence("You've hit your session limit · resets 7pm")).toBe('you hit your usage limit, try again a little later')
  expect(errorSentence('API Error: Repeated 529 Overloaded errors')).toBe("Claude's servers are busy, try again in a minute")
  expect(errorSentence('Prompt is too long')).toBe('type /compact and try again')
  expect(errorSentence('API Error: Connection error.')).toBe('the internet connection dropped')
  expect(errorSentence('API Error: 401 {"type":"error","error":{"type":"authentication_error"}} · Please run /login')).toBe('type /login')
  expect(errorSentence('API Error: 500 Internal server error')).toBe('something went wrong on the way, try again')
  expect(errorSentence('')).toBe('something went wrong on the way, try again')
})

test('stays stuck on a step the person said no to, when the turn ends after it', () => {
  const refused = stuck(planned(), REASONS.saidNo)

  expect(endTurn(refused, { reason: 'aborted', answer: '' }, NOW + 9000)).toMatchObject({
    phase: 'stuck',
    stuckReason: 'you said no to a step, so Claude paused',
    finishedAt: NOW + 9000,
  })
  expect(endTurn(refused, ANSWERED, NOW + 9000).phase).toBe('stuck')
})

test('leaves a checklist alone when a turn ends that was no job', () => {
  const finished = endTurn(reportProgress(planned(), 'Polish the footer', 100, NOW), ANSWERED, NOW + 1000)

  expect(endTurn(IDLE, ANSWERED, NOW)).toEqual(IDLE)
  expect(endTurn(finished, { reason: 'aborted', answer: '' }, NOW + 5000)).toEqual(finished)
})

test('shrinks only a job that is all done', () => {
  const finished = endTurn(reportProgress(planned(), 'Polish the footer', 100, NOW), ANSWERED, NOW + 1000)

  expect(collapse(finished).isCollapsed).toBe(true)
  expect(collapse(planned()).isCollapsed).toBe(false)
})

test('gives a job a new title and nothing else', () => {
  expect(rename(planned(), 'Build bakery landing page')).toEqual({ ...planned(), title: 'Build bakery landing page' })
})

// ── An API error by the kind the engine names ───────────────────────────────

test('knows an API error by the kind Claude Code names, and by its text where the kind says little', () => {
  expect(sentenceFor('rate_limit', '')).toBe('you hit your usage limit, try again a little later')
  expect(sentenceFor('overloaded', '')).toBe("Claude's servers are busy, try again in a minute")
  expect(sentenceFor('server_error', '')).toBe("Claude's servers are busy, try again in a minute")
  expect(sentenceFor('authentication_failed', '')).toBe('type /login')
  expect(sentenceFor('oauth_org_not_allowed', '')).toBe('type /login')
  expect(sentenceFor('invalid_request', 'Prompt is too long')).toBe('type /compact and try again')
  expect(sentenceFor('unknown', 'Connection error.')).toBe('the internet connection dropped')
  expect(sentenceFor('billing_error', '')).toBe('something went wrong on the way, try again')
})

test('is stuck on an API error the moment it is named, before the turn has ended', () => {
  const job = failTurn(planned(), 'you hit your usage limit, try again a little later', NOW + 3000)

  expect(job).toMatchObject({ phase: 'stuck', stuckReason: 'you hit your usage limit, try again a little later', finishedAt: NOW + 3000 })
  // The end of the turn, which says less, changes nothing after it.
  expect(endTurn(job, { reason: 'error', answer: '' }, NOW + 3100)).toEqual(job)
})

test('says an API error better once its kind is named after the turn has ended', () => {
  const ended = endTurn(planned(), { reason: 'error', answer: '' }, NOW + 3000)

  expect(ended.stuckReason).toBe('something went wrong on the way, try again')
  expect(failTurn(ended, 'you hit your usage limit, try again a little later', NOW + 3100)).toMatchObject({
    phase: 'stuck',
    stuckReason: 'you hit your usage limit, try again a little later',
    finishedAt: NOW + 3000,
  })
})

test('lets no API error speak over a job that was not ended by one', () => {
  const sentence = 'you hit your usage limit, try again a little later'
  const finished = endTurn(reportProgress(planned(), 'Polish the footer', 100, NOW), ANSWERED, NOW + 1000)
  const refused = endTurn(planned(), { reason: 'refusal', answer: '' }, NOW + 1000)
  const turnedDown = endTurn(stuck(planned(), REASONS.saidNo), { reason: 'aborted', answer: '' }, NOW + 1000)

  expect(failTurn(IDLE, sentence, NOW)).toEqual(IDLE)
  expect(failTurn(finished, sentence, NOW + 2000)).toEqual(finished)
  expect(failTurn(refused, sentence, NOW + 2000)).toEqual(refused)
  expect(failTurn(turnedDown, sentence, NOW + 2000)).toEqual(turnedDown)
})
