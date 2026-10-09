import { expect, test } from 'claude-code/testing'

import { IDLE, REASONS, collapse, endTurn, needsYou, planSteps, reportProgress, startJob, stuck } from '../hooks/checklist'
import { BUTTON, durationOf, headerOf, rowsOf } from '../hooks/rows'
import type { Run } from '../hooks/rows'
import type { CleanViewChecklist } from '../types'

const NOW = 1_000_000

const PLAN = ['Read your brand notes', 'Build the pricing section', 'Add the contact form', 'Polish the footer']

const planned = () => planSteps(startJob('Build my landing page', NOW), PLAN, NOW)

const halfway = () => reportProgress(planned(), 'Build the pricing section', 60, NOW)

const finished = () => endTurn(reportProgress(planned(), 'Polish the footer', 100, NOW), { reason: 'answer', answer: 'Done.' }, NOW + 134_000)

const textOf = (runs: Run[]) => runs.map(run => run.text).join('')

const linesOf = (list: CleanViewChecklist, tick = 0, columns = 120) => rowsOf(list, tick, columns).map(textOf)

test('says how long something took in a few plain units', () => {
  expect(durationOf(0)).toBe('0s')
  expect(durationOf(12_400)).toBe('12s')
  expect(durationOf(72_000)).toBe('1m 12s')
  expect(durationOf(134_000)).toBe('2m 14s')
  expect(durationOf(3_840_000)).toBe('1h 4m')
  expect(durationOf(-5)).toBe('0s')
})

test('labels its button with what Clean View is now', () => {
  expect(BUTTON).toEqual({ on: '● Clean View: ON', off: '○ Clean View: OFF' })
})

test("heads a working job with its name and how long it has run", () => {
  const header = headerOf(planned(), NOW + 72_000, 100)

  expect(textOf(header)).toBe('Build my landing page · 1m 12s')
  expect(header[0]).toMatchObject({ text: 'Build my landing page', isBold: true })
})

test('heads a job that waits on the person with a highlighted badge and the reason', () => {
  const header = headerOf(needsYou(planned(), REASONS.ok), NOW + 72_000, 100)

  expect(textOf(header)).toBe(' Needs you  Claude needs your OK to continue')
  expect(header[0]).toMatchObject({ text: ' Needs you ', isInverse: true, isBold: true, color: 'warning' })
})

test('heads a stuck job with the reason in one sentence', () => {
  const header = headerOf(stuck(planned(), REASONS.failing), NOW, 100)

  expect(textOf(header)).toBe('⚠ Stuck: a step keeps failing, Claude is trying another way')
  expect(header[0]?.color).toBe('warning')
})

test('heads a stopped job with what stopped it', () => {
  const header = headerOf(endTurn(planned(), { reason: 'aborted', answer: '' }, NOW + 9000), NOW + 20_000, 100)

  expect(textOf(header)).toBe('■ Stopped · Build my landing page · you pressed Esc')
})

test('heads a finished job with how long it took', () => {
  const header = headerOf(finished(), NOW + 500_000, 100)

  expect(textOf(header)).toBe('✓ All done · Build my landing page · took 2m 14s')
  expect(header[0]).toMatchObject({ text: '✓ All done', color: 'success' })
})

test('heads nothing while no job has run', () => {
  expect(headerOf(IDLE, NOW, 100)).toEqual([])
})

test('cuts the name, never the time, where the header has little room', () => {
  const header = textOf(headerOf(planned(), NOW + 72_000, 20))

  expect(header).toBe('Build my l… · 1m 12s')
  expect(header).toHaveLength(20)
})

test('never draws a header wider than its room', () => {
  for (const list of [needsYou(planned(), REASONS.ok), stuck(planned(), REASONS.failing), finished()]) {
    for (const columns of [8, 15, 30]) {
      expect(textOf(headerOf(list, NOW, columns)).length).toBeLessThanOrEqual(columns)
    }
  }
})

test('draws a done, a current, a next and a later step each its own way', () => {
  expect(linesOf(halfway())).toEqual([
    `${'✓ Read your brand notes'.padEnd(29)}██████████  Done`,
    `${'▶ Build the pricing section'.padEnd(29)}██████░░░░  60%`,
    `${'○ Add the contact form'.padEnd(29)}░░░░░░░░░░  Next`,
    `${'○ Polish the footer'.padEnd(29)}░░░░░░░░░░  Up next`,
  ])
})

test('colors a done step green and dim, the current one bold, the rest dim', () => {
  const [doneRow = [], currentRow = [], nextRow = []] = rowsOf(halfway(), 0, 120)

  expect(doneRow[0]).toMatchObject({ text: '✓ ', color: 'success' })
  expect(doneRow[1]?.isDim).toBe(true)
  // A full meter a row would stack into a bright slab: a done step's is dim.
  expect(doneRow[2]).toEqual({ text: '██████████', color: 'success', isDim: true })
  expect(currentRow[1]?.isBold).toBe(true)
  expect(nextRow.every(run => run.isDim === true)).toBe(true)
})

test('sweeps the meter of a step nothing was reported for yet, and calls it Working', () => {
  const [first = ''] = linesOf(planned(), 0)
  const [later = ''] = linesOf(planned(), 4)

  expect(first.endsWith('███░░░░░░░  Working')).toBe(true)
  expect(later.endsWith('░░░░███░░░  Working')).toBe(true)
  // The sweep comes round: its meter is ten cells whatever the frame.
  expect(linesOf(planned(), 9)[0]?.endsWith('██░░░░░░░█  Working')).toBe(true)
})

test('pauses the current step while the job waits on the person', () => {
  const [, current = ''] = linesOf(needsYou(halfway(), REASONS.ok))

  expect(current).toBe(`${'‖ Build the pricing section'.padEnd(29)}██████░░░░  60%`)
})

test('says Paused, with no sweep, for a step nothing was reported for while the job waits or is stuck', () => {
  const paused = `${'‖ Read your brand notes'.padEnd(29)}░░░░░░░░░░  Paused`

  expect(linesOf(needsYou(planned(), REASONS.ok), 4)[0]).toBe(paused)
  expect(linesOf(stuck(planned(), REASONS.saidNo), 4)[0]).toBe(paused)
})

test('says Stopped for the step the person interrupted', () => {
  const stopped = endTurn(planned(), { reason: 'aborted', answer: '' }, NOW + 9000)

  expect(linesOf(stopped, 4)[0]).toBe(`${'■ Read your brand notes'.padEnd(29)}░░░░░░░░░░  Stopped`)
})

test('pulses the Needs you badge slowly, a second lit and a second plain', () => {
  const waiting = needsYou(planned(), REASONS.ok)
  const badgeAt = (tick: number) => headerOf(waiting, NOW, 100, tick)[0]

  expect(badgeAt(0)?.isInverse).toBe(true)
  expect(badgeAt(3)?.isInverse).toBe(true)
  expect(badgeAt(4)).toEqual({ text: ' Needs you ', color: 'warning', isBold: true })
  expect(badgeAt(8)?.isInverse).toBe(true)
})

test('draws no rows for a job that shrank to one line, or while no job has run', () => {
  expect(linesOf(collapse(finished()))).toEqual([])
  expect(linesOf(finished())).toHaveLength(4)
  expect(linesOf(IDLE)).toEqual([])
})

test('sizes the name column to the room, so that no row is wider than it', () => {
  for (const columns of [28, 34, 50]) {
    const lines = linesOf(halfway(), 0, columns)

    expect(lines.every(line => line.length <= columns)).toBe(true)
    // The meter is ten cells at any width.
    expect(lines[1]).toMatch(/█{6}░{4} {2}60%$/)
  }

  // Thirty-four columns leave the name eleven.
  expect(linesOf(halfway(), 0, 34)[1]).toBe(`${'▶ Build the…'.padEnd(15)}██████░░░░  60%`)
})

test('keeps the name column no wider than its longest name needs, and never under twenty', () => {
  const short = planSteps(startJob('Say hello', NOW), ['Say hello', 'Wave'], NOW)

  expect(linesOf(short)[1]).toBe(`${'○ Wave'.padEnd(24)}░░░░░░░░░░  Next`)
})
