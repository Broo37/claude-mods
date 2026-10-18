import { expect, test } from 'claude-code/testing'

import { IDLE, REASONS, actionEnded, actionStarted, endTurn, needsYou, planSteps, reportProgress, startJob, stuck } from '../hooks/checklist'
import { BUTTON, DOCK_TAB, TAB_MARKS, bandStepsOf, durationOf, headerOf, paneLinesOf, rowsOf, stripOf } from '../hooks/rows'
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
    `${'✓ 📖 Read your brand notes'.padEnd(32)}██████████  Done`,
    `${'▶ 🔨 Build the pricing section'.padEnd(32)}██████░░░░  60%`,
    `${'○ 🔨 Add the contact form'.padEnd(32)}░░░░░░░░░░  Next`,
    `${'○ 🎨 Polish the footer'.padEnd(32)}░░░░░░░░░░  Up next`,
  ])
})

test('colors a done step green and dim, the current one bold, the rest dim', () => {
  const [doneRow = [], currentRow = [], nextRow = []] = rowsOf(halfway(), 0, 120)

  expect(doneRow[0]).toMatchObject({ text: '✓ ', color: 'success' })
  expect(doneRow[1]).toMatchObject({ text: '📖 ' })
  expect(doneRow[2]?.isDim).toBe(true)
  // A full meter a row would stack into a bright slab: a done step's is dim.
  expect(doneRow[3]).toEqual({ text: '██████████', color: 'success', isDim: true })
  expect(currentRow[2]?.isBold).toBe(true)
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

  expect(current).toBe(`${'‖ 🔨 Build the pricing section'.padEnd(32)}██████░░░░  60%`)
})

test('says Paused, with no sweep, for a step nothing was reported for while the job waits or is stuck', () => {
  const paused = `${'‖ 📖 Read your brand notes'.padEnd(32)}░░░░░░░░░░  Paused`

  expect(linesOf(needsYou(planned(), REASONS.ok), 4)[0]).toBe(paused)
  expect(linesOf(stuck(planned(), REASONS.saidNo), 4)[0]).toBe(paused)
})

test('says Stopped for the step the person interrupted', () => {
  const stopped = endTurn(planned(), { reason: 'aborted', answer: '' }, NOW + 9000)

  expect(linesOf(stopped, 4)[0]).toBe(`${'■ 📖 Read your brand notes'.padEnd(32)}░░░░░░░░░░  Stopped`)
})

test('pulses the Needs you badge slowly, a second lit and a second plain', () => {
  const waiting = needsYou(planned(), REASONS.ok)
  const badgeAt = (tick: number) => headerOf(waiting, NOW, 100, tick)[0]

  expect(badgeAt(0)?.isInverse).toBe(true)
  expect(badgeAt(3)?.isInverse).toBe(true)
  expect(badgeAt(4)).toEqual({ text: ' Needs you ', color: 'warning', isBold: true })
  expect(badgeAt(8)?.isInverse).toBe(true)
})

test('draws every step of a finished job, and no rows while no job has run', () => {
  expect(linesOf(finished())).toHaveLength(4)
  expect(linesOf(IDLE)).toEqual([])
})

test('sizes the name column to the room, so that no row is wider than it', () => {
  for (const columns of [31, 34, 50]) {
    const lines = linesOf(halfway(), 0, columns)

    expect(lines.every(line => line.length <= columns)).toBe(true)
    // The meter is ten cells at any width.
    expect(lines[1]).toMatch(/█{6}░{4} {2}60%$/)
  }

  // Thirty-four columns leave the name eight.
  expect(linesOf(halfway(), 0, 34)[1]).toBe(`${'▶ 🔨 Build t…'.padEnd(15)}██████░░░░  60%`)
})

test('keeps the name column no wider than its longest name needs, and never under twenty', () => {
  const short = planSteps(startJob('Say hello', NOW), ['Say hello', 'Wave'], NOW)

  expect(linesOf(short)[1]).toBe(`${'○ 🔹 Wave'.padEnd(27)}░░░░░░░░░░  Next`)
})

// The Checklist tab of the dock and the strip over the Waterfall tab: thirty
// columns, what the dock leaves once the lines stand two off its edge.
const NARROW = 30

const paneOf = (list: CleanViewChecklist, now = NOW + 72_000, columns = NARROW, tick = 0) => paneLinesOf(list, now, columns, tick).map(textOf)

const stripLinesOf = (list: CleanViewChecklist, now = NOW + 72_000, columns = NARROW, tick = 0) => stripOf(list, now, columns, tick).map(textOf)

test('stacks the checklist in a narrow tab: the job, its state, then a line a step', () => {
  expect(paneOf(halfway())).toEqual([
    'Build my landing page',
    '▶ Working · 1m 12s',
    ' ',
    '✓ 📖 Read your brand notes',
    '▶ 🔨 Build the pricing section',
    '     ██████░░░░  60%',
    '○ 🔨 Add the contact form',
    '○ 🎨 Polish the footer',
  ])
})

test('gives only the step at work a meter in a narrow tab, as it would in the band', () => {
  const lines = paneLinesOf(planned(), NOW, NARROW, 0)

  // Nothing reported yet: the meter sweeps.
  expect(lines.map(textOf).slice(3, 5)).toEqual(['▶ 📖 Read your brand notes', '     ███░░░░░░░  Working'])
  expect(lines[4]?.[1]).toMatchObject({ text: '███', color: 'claude' })
  expect(lines[5]?.[2]).toMatchObject({ text: 'Build the pricing section', isDim: true })
})

test('wraps a long step name under itself in a narrow tab, and the job and the reason it waits', () => {
  const long = planSteps(startJob('Move the checklist of Clean View into the dock', NOW), ['Write the tests for the stacked layout'], NOW)
  const lines = paneOf(needsYou(long, REASONS.ok), NOW, 24)

  expect(lines).toEqual([
    'Move the checklist of',
    'Clean View into the dock',
    ' Needs you ',
    'Claude needs your OK to',
    'continue',
    ' ',
    '‖ 🧪 Write the tests for',
    '     the stacked layout',
    '     ░░░░░░░░░░  Paused',
  ])
  expect(lines.every(line => line.length <= 24)).toBe(true)
})

test('says in a narrow tab how a job ended', () => {
  expect(paneOf(finished(), NOW + 200_000).slice(0, 2)).toEqual(['Build my landing page', '✓ All done · took 2m 14s'])
  expect(paneOf(endTurn(planned(), { reason: 'aborted', answer: '' }, NOW + 9000)).slice(0, 2)).toEqual([
    'Build my landing page',
    '■ Stopped · you pressed Esc',
  ])
  expect(paneOf(stuck(planned(), REASONS.saidNo)).slice(1, 3)).toEqual(['⚠ Stuck', 'you said no to a step, so'])
})

test('keeps every step of a finished job in the tab', () => {
  expect(paneOf(finished(), NOW + 200_000)).toHaveLength(7)
})

test('draws the checklist one row a step where the tab is wide enough for it', () => {
  const wide = paneLinesOf(halfway(), NOW + 72_000, 60, 0)

  expect(wide).toEqual([headerOf(halfway(), NOW + 72_000, 60, 0), ...rowsOf(halfway(), 0, 60)])
})

test('says in the tab that no job has run yet', () => {
  expect(paneOf(IDLE)).toEqual(['No job yet: your next request', 'shows here as a checklist.'])
})

test('sums up a working job over the waterfall in two lines: the step it is on, then its meter', () => {
  const strip = stripOf(halfway(), NOW + 72_000, NARROW, 0)

  expect(strip.map(textOf)).toEqual(['▶ 2/4 🔨 Build the pricing se…', '  ██████░░░░  60% · 1m 12s'])
  expect(strip[0]?.[0]).toMatchObject({ text: '▶ ', color: 'claude' })
  expect(strip[0]?.[1]).toMatchObject({ text: '2/4 ', isDim: true })
  expect(strip[0]?.[2]).toMatchObject({ text: '🔨 ' })
  expect(strip[0]?.[3]).toMatchObject({ isBold: true })
})

test('sums up a job before its plan by the step it starts with, as the band does', () => {
  expect(stripLinesOf(startJob('Build my landing page', NOW), NOW + 3000)).toEqual(['▶ 1/2 🤔 Understand your requ…', '  ███░░░░░░░  Working · 3s'])
})

test('sums up a held or ended job over the waterfall by what holds or ended it', () => {
  expect(stripLinesOf(needsYou(halfway(), REASONS.ok))).toEqual([' Needs you  2/4', '  Claude needs your OK to con…'])
  expect(stripLinesOf(stuck(halfway(), REASONS.failing))).toEqual(['⚠ Stuck · 2/4', '  a step keeps failing, Claud…'])
  expect(stripLinesOf(endTurn(halfway(), { reason: 'aborted', answer: '' }, NOW + 9000))).toEqual(['■ Stopped · 2/4', '  you pressed Esc'])
  expect(stripLinesOf(finished(), NOW + 200_000)).toEqual(['✓ All done · 4/4', '  took 2m 14s'])
})

test('puts nothing over the waterfall while no job has run', () => {
  expect(stripOf(IDLE, NOW, NARROW, 0)).toEqual([])
})

test("puts the emoji Claude picked before its step, in the band, the tab and the strip", () => {
  const picked = planSteps(startJob('Ship it', NOW), ['🧹 Read your brand notes', 'Build the pricing section'], NOW)

  expect(linesOf(picked)[0]?.startsWith('▶ 🧹 Read your brand notes')).toBe(true)
  expect(paneOf(picked)[3]).toBe('▶ 🧹 Read your brand notes')
  expect(stripLinesOf(picked)[0]).toBe('▶ 1/2 🧹 Read your brand notes')
  // Where Claude picked none, one is guessed from the name.
  expect(paneOf(picked)[5]).toBe('○ 🔨 Build the pricing section')
})

// A half of an emoji: what a cut through the middle of one leaves.
const HALF = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

test('never cuts an emoji in half, however narrow the room', () => {
  for (let columns = 1; columns <= 12; columns += 1) {
    for (const line of [...stripLinesOf(halfway(), NOW, columns), ...linesOf(halfway(), 0, columns)]) {
      expect(line).not.toMatch(HALF)
    }
  }
})

// ── The band's steps, each one opened to what Claude did in it ──────────────

// The step at work read a file, then ran the tests, which failed after four seconds.
const busy = () => {
  const read = actionEnded(actionStarted(halfway(), 'c1', 'Read pricing.md', NOW), 'c1', { isOk: true }, NOW + 200)

  return actionEnded(actionStarted(read, 'c2', 'Ran: Run the tests', NOW + 300), 'c2', { isOk: false, why: 'missing script: test' }, NOW + 4500)
}

const bandLinesOf = (list: CleanViewChecklist, opened: readonly string[] = [], columns = 120, tick = 0) =>
  bandStepsOf(list, opened, tick, columns).flatMap(step => [textOf(step.row), ...step.details.map(textOf)])

// The rows of the steps in the band, each after the room its arrow takes.
const BAND_ROWS = [
  `  ${'✓ 📖 Read your brand notes'.padEnd(32)}██████████  Done`,
  `▸ ${'▶ 🔨 Build the pricing section'.padEnd(32)}██████░░░░  60%`,
  `  ${'○ 🔨 Add the contact form'.padEnd(32)}░░░░░░░░░░  Next`,
  `  ${'○ 🎨 Polish the footer'.padEnd(32)}░░░░░░░░░░  Up next`,
]

// Where what a step did starts: under its name, past its arrow, mark and emoji.
const UNDER = ' '.repeat(7)

test('puts an arrow before a step with something to show, and keeps the room for one before the rest', () => {
  const steps = bandStepsOf(busy(), [], 0, 120)

  expect(bandLinesOf(busy())).toEqual(BAND_ROWS)
  expect(steps.map(step => step.id)).toEqual(['step-1', 'step-2', 'step-3', 'step-4'])
  expect(steps.map(step => step.canOpen)).toEqual([false, true, false, false])
  expect(steps.every(step => !step.isOpen && step.details.length === 0)).toBe(true)
})

test('opens a step to how each thing Claude did in it went, and why one failed', () => {
  expect(bandLinesOf(busy(), ['step-2'])).toEqual([
    BAND_ROWS[0],
    `▾ ${'▶ 🔨 Build the pricing section'.padEnd(32)}██████░░░░  60%`,
    `${UNDER}✓ Read pricing.md`,
    `${UNDER}✗ Ran: Run the tests · failed: missing script: test`,
    BAND_ROWS[2],
    BAND_ROWS[3],
  ])
})

test('marks what went well in green and dims it, and what failed in red', () => {
  const opened = bandStepsOf(busy(), ['step-2'], 0, 120)[1]

  expect(opened?.details[0]?.[1]).toEqual({ text: '✓ ', color: 'success' })
  expect(opened?.details[0]?.[2]).toMatchObject({ text: 'Read pricing.md', isDim: true })
  expect(opened?.details[1]?.[1]).toEqual({ text: '✗ ', color: 'error' })
  expect(opened?.details[1]?.at(-1)).toMatchObject({ text: ' · failed: missing script: test', color: 'error' })
})

test("leads an opened step with Claude's note on it", () => {
  const noted = reportProgress(busy(), 'Build the pricing section', 80, NOW, 'Prices come from the menu file.')

  expect(bandLinesOf(noted, ['step-2']).slice(2, 4)).toEqual([`${UNDER}Prices come from the menu file.`, `${UNDER}✓ Read pricing.md`])
  // A note alone is something to show.
  expect(bandStepsOf(reportProgress(planned(), 'Read your brand notes', 100, NOW, 'Warm and friendly.'), [], 0, 120)[0]?.canOpen).toBe(true)
})

test('says how long a slow action took, and that one still runs', () => {
  const slow = actionEnded(actionStarted(halfway(), 'c1', 'Ran: Build the site', NOW), 'c1', { isOk: true }, NOW + 12_400)
  const running = actionStarted(slow, 'c2', 'Read pricing.md', NOW + 13_000)

  expect(bandLinesOf(running, ['step-2']).slice(2, 4)).toEqual([`${UNDER}✓ Ran: Build the site · 12s`, `${UNDER}◌ Read pricing.md · running`])
})

test('counts the actions let go before the five it shows', () => {
  let job = halfway()

  for (let i = 1; i <= 7; i += 1) {
    job = actionEnded(actionStarted(job, `c${i}`, `Read file${i}.ts`, NOW), `c${i}`, { isOk: true }, NOW)
  }

  expect(bandLinesOf(job, ['step-2']).slice(2, 4)).toEqual([`${UNDER}… 2 earlier`, `${UNDER}✓ Read file3.ts`])
})

test('opens a finished step as well, and nothing for a step with nothing to show', () => {
  const done = reportProgress(busy(), 'Build the pricing section', 100, NOW)

  expect(bandLinesOf(done, ['step-2', 'step-3'])).toHaveLength(6)
  expect(bandLinesOf(done, ['step-2'])[1]?.startsWith('▾ ✓ 🔨 Build the pricing section')).toBe(true)
  expect(bandStepsOf(done, ['step-3'], 0, 120)[2]).toMatchObject({ canOpen: false, isOpen: false, details: [] })
})

test('wraps a long note under itself, and keeps every line of an opened step within the room', () => {
  const noted = reportProgress(busy(), 'Build the pricing section', 80, NOW, 'Prices come from the menu file, which the shop updates every Monday morning.')

  for (const columns of [34, 50, 80]) {
    expect(bandLinesOf(noted, ['step-2'], columns).every(line => line.length <= columns)).toBe(true)
  }

  expect(bandLinesOf(noted, ['step-2'], 50).slice(2, 4)).toEqual([`${UNDER}Prices come from the menu file, which the`, `${UNDER}shop updates every Monday morning.`])
})

test('never cuts an emoji in half in the band, however narrow the room', () => {
  for (let columns = 1; columns <= 14; columns += 1) {
    for (const line of bandLinesOf(busy(), ['step-2'], columns)) {
      expect(line).not.toMatch(HALF)
    }
  }
})

test('keeps the tab a plain list: no arrows and nothing of what a step did', () => {
  expect(paneOf(busy())).toEqual(paneOf(halfway()))
  expect(paneLinesOf(busy(), NOW, 60, 0).map(textOf)).toEqual(paneLinesOf(halfway(), NOW, 60, 0).map(textOf))
})

// The columns the engine's tab row of the dock keeps for tabs from the one in
// front leftward: each its title and a cell each side, 12 at most, and a gap.
const tabRowOf = (titles: string[]) => titles.reduce((sum, title) => sum + Math.min(title.length + 2, 12) + 1, -1)

// A dock 47 columns wide (the one this was seen in) has a tab row of 43.
const TAB_ROW = 43

test("names the dock's tab short enough to stay beside Waterfall, Sessions and Status, whatever its mark", () => {
  for (const mark of Object.values(TAB_MARKS)) {
    expect(tabRowOf([`${DOCK_TAB}${mark}`, 'Waterfall', 'Sessions', 'Status'])).toBeLessThanOrEqual(TAB_ROW)
  }

  // The name it had fell off the left.
  expect(tabRowOf(['Checklist ▶', 'Waterfall', 'Sessions', 'Status'])).toBeGreaterThan(TAB_ROW)
})
