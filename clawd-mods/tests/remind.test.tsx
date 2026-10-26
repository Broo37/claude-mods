import type { On } from 'claude-code'
import { type Engine, expect, test } from 'claude-code/testing'

import { type Reminder, PARSE_ERROR, dueOf, nextAt, parseWhen } from '../hooks/remind'
import { BAND, MIN, NOW, PANE, SAMPLE, START, type World, at, world } from './world'

const FILE = 'C:/L/clawd-mods/reminders.json'
const DAY = 1440 * MIN

const reminder = (extra: Partial<Reminder>): Reminder => ({
  id: 'r1',
  at: NOW + MIN,
  text: 'check the deploy',
  repeat: null,
  firedAt: null,
  firedBy: null,
  isLate: false,
  snoozeUntil: null,
  ...extra,
})

// NOW is Thursday 2026-10-22, 23:30 here.
test('reading when: relative, a time, tomorrow, a weekday, a repeat, a date', () => {
  expect(parseWhen('20m check', NOW)).toEqual({ at: NOW + 20 * MIN, repeat: null, text: 'check' })
  expect(parseWhen('2h stretch', NOW)).toEqual({ at: NOW + 120 * MIN, repeat: null, text: 'stretch' })
  expect(parseWhen('18:30 call', NOW)).toEqual({ at: at(9, 23, 18, 30), repeat: null, text: 'call' })
  expect(parseWhen('9pm call', NOW)).toEqual({ at: at(9, 23, 21), repeat: null, text: 'call' })
  expect(parseWhen('tomorrow 9 standup', NOW)).toEqual({ at: at(9, 23, 9), repeat: null, text: 'standup' })
  expect(parseWhen('tomorrow 10:30 standup', NOW)).toEqual({ at: at(9, 23, 10, 30), repeat: null, text: 'standup' })
  expect(parseWhen('fri 14:00 x', NOW)).toEqual({ at: at(9, 23, 14), repeat: null, text: 'x' })
  expect(parseWhen('thu 9:00 x', NOW)).toEqual({ at: at(9, 29, 9), repeat: null, text: 'x' })
  expect(parseWhen('daily 9:00 pills', NOW)).toEqual({ at: at(9, 23, 9), repeat: 'daily', text: 'pills' })
  expect(parseWhen('weekly mon 9:00 plan the week', NOW)).toEqual({ at: at(9, 26, 9), repeat: 'weekly', text: 'plan the week' })
  expect(parseWhen('in a week review', NOW)).toEqual({ at: NOW + 7 * DAY, repeat: null, text: 'review' })
  expect(parseWhen('19.10 14:00 tax', NOW)).toEqual({ at: at(9, 19, 14, 0, 2027), repeat: null, text: 'tax' })
  expect(parseWhen('next blue moon', NOW)).toEqual({ error: PARSE_ERROR })
  // A weekday is a whole word: "monitor", "wedding" or "month" are no Monday or Wednesday.
  expect(parseWhen('monitor the build', NOW)).toEqual({ error: PARSE_ERROR })
  expect(parseWhen('wedding gift', NOW)).toEqual({ error: PARSE_ERROR })
  expect(parseWhen('monday 9 plan', NOW)).toEqual({ at: at(9, 26, 9), repeat: null, text: 'plan' })
  expect(parseWhen('thursday 9:00 x', NOW)).toEqual({ at: at(9, 29, 9), repeat: null, text: 'x' })
  expect(PARSE_ERROR).toBe(
    "Can't read the time. Try: /remind 20m check the deploy · /remind tomorrow 9 standup · /remind fri 14:00 call · or ask Claude.",
  )
})

test('the next time of a repeat comes after now; a one-off has none', () => {
  expect(nextAt(reminder({ at: at(9, 19, 9), repeat: 'daily' }), NOW)).toBe(at(9, 23, 9))
  expect(nextAt(reminder({ at: at(9, 19, 9), repeat: 'weekly' }), NOW)).toBe(at(9, 26, 9))
  expect(nextAt(reminder({ at: at(0, 31, 9), repeat: 'monthly' }), at(1, 1, 0))).toBe(at(1, 28, 9))
  expect(nextAt(reminder({ at: at(9, 19, 9, 0, 2025), repeat: 'yearly' }), NOW)).toBe(at(9, 19, 9, 0, 2027))
  expect(nextAt(reminder({}), NOW)).toBeNull()
  expect(dueOf([reminder({ at: NOW - 1 }), reminder({ id: 'r2', at: NOW + 1 }), reminder({ id: 'r3', at: NOW - 1, firedAt: NOW })], NOW).map(r => r.id)).toEqual(['r1'])
})

test('due: a snooze rings at its end; a repeat left ringing rings again at its next time', () => {
  const snoozed = reminder({ id: 's', at: NOW - 30 * MIN, snoozeUntil: NOW + MIN })
  expect(dueOf([snoozed], NOW)).toEqual([])
  expect(dueOf([snoozed], NOW + MIN).map(r => r.id)).toEqual(['s'])
  const yesterday = at(9, 21, 23, 0)
  const ringing = reminder({ id: 'p', at: yesterday, repeat: 'daily', firedAt: yesterday, firedBy: 'other' })
  expect(dueOf([ringing], at(9, 22, 22, 59)).map(r => r.id)).toEqual([])
  expect(dueOf([ringing], NOW).map(r => r.id)).toEqual(['p'])
  // A one-off left ringing stays as it is.
  expect(dueOf([reminder({ at: yesterday, firedAt: yesterday })], NOW)).toEqual([])
})

// ---------------------------------------------------------------- engine ----

/** The mod's own tools are not in the engine's tool list the types were made from. */
const callTool = ($: Engine, input: Record<string, unknown>) => $.tool.call(input as Parameters<Engine['tool']['call']>[0])

function withNotes(on: On): { w: World; notes: string[] } {
  const w = world(on, () => SAMPLE, [])
  const notes: string[] = []
  on('ui.notify', (_, e) => {
    notes.push(e.text)
    return { value: { isSent: true, channel: 'terminal_bell' } }
  })
  on('tool.register', (_, e) => ({ value: { tool: `mcp__clawd-mods__${e.name}` } }))
  return { w, notes }
}

const saved = (w: World): Reminder[] => JSON.parse(w.files.get(FILE)?.text ?? '[]') as Reminder[]

async function pane($: Engine) {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 42 }, surface: 'terminal' })
  const texts = (await ui.findAll({ type: 'Text' })) as { text: string; props: Record<string, unknown> }[]
  const buttons = (await ui.findAll({ type: 'Button' })).map(b => b.text)
  return { ui, texts, buttons }
}

test('/remind adds one, and the tool adds one', async ($, on) => {
  const { w } = withNotes(on)
  await $.session.start(START)
  const ran = $.command.run({ command: 'remind', args: 'tomorrow 9 standup', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  await w.clock.advance(400)
  expect((await ran).text).toBe('Reminder set for Fri 23 Oct 09:00: standup.')
  const called = callTool($, { tool: 'mcp__clawd-mods__remind', at: new Date(at(9, 23, 10)).toISOString(), text: 'deploy', repeat: 'daily' })
  await w.clock.advance(400)
  expect((await called).result).toBe('Reminder set for Fri 23 Oct 10:00, every day: deploy.')
  expect(saved(w).map(r => [r.text, r.at, r.repeat])).toEqual([
    ['standup', at(9, 23, 9), null],
    ['deploy', at(9, 23, 10), 'daily'],
  ])
  expect((await $.command.run({ command: 'remind', args: 'next blue moon', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })).text).toContain("Can't read the time")
})

test('the tools list and cancel', async ($, on) => {
  const { w } = withNotes(on)
  w.files.set(FILE, { text: JSON.stringify([reminder({ id: 'abc', at: at(9, 23, 9) })]), mtimeMs: NOW })
  await $.session.start(START)
  const list = await callTool($, { tool: 'mcp__clawd-mods__reminders' })
  expect(list.result).toContain('abc · Fri 23 Oct 09:00 · check the deploy')
  const cancelled = callTool($, { tool: 'mcp__clawd-mods__cancel_reminder', id: 'abc' })
  await w.clock.advance(400)
  expect((await cancelled).result).toBe('Cancelled: check the deploy.')
  expect(saved(w)).toEqual([])
})

test('due: it fires once for the machine, with a bell over Clawd and its buttons', async ($, on) => {
  const { w, notes } = withNotes(on)
  w.files.set(FILE, { text: JSON.stringify([reminder({})]), mtimeMs: NOW })
  await $.session.start(START)
  await w.clock.advance(3 * MIN)
  expect(notes).toEqual(['check the deploy'])
  expect(saved(w)[0]).toMatchObject({ firedBy: 'me', isLate: false })
  const { ui, texts, buttons } = await pane($)
  await ui.unmount()
  expect(texts.find(t => t.text === '▌ REMINDERS' && t.props.weight === 'bold')?.props.color).toBe('#22D3EE')
  expect(texts.some(t => /check the deploy/.test(t.text))).toBe(true)
  expect(buttons).toEqual(['Done', '+15m', '+1h'])
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Client' }))?.props).toMatchObject({ props: { overhead: 'bell' } })
  await band.unmount()
})

test('fired by another session: no second notification, but the bell and buttons here too', async ($, on) => {
  const { w, notes } = withNotes(on)
  w.files.set(FILE, { text: JSON.stringify([reminder({ at: NOW - MIN, firedAt: NOW - MIN, firedBy: 'other' })]), mtimeMs: NOW })
  await $.session.start(START)
  await w.clock.advance(MIN)
  expect(notes).toEqual([])
  const { ui, buttons } = await pane($)
  await ui.unmount()
  expect(buttons).toEqual(['Done', '+15m', '+1h'])
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Client' }))?.props).toMatchObject({ props: { overhead: 'bell' } })
  await band.unmount()
})

async function press($: Engine, w: World, key: string): Promise<void> {
  const { ui } = await pane($)
  const pressed = $.ui.press({ plugin: 'clawd-mods', key })
  await w.clock.advance(400)
  await pressed
  await ui.unmount()
}

test('Done ends a one-off and moves a repeat on; +15m snoozes', async ($, on) => {
  const { w } = withNotes(on)
  const fired = { at: NOW - MIN, firedAt: NOW - MIN, firedBy: 'other' }
  w.files.set(FILE, {
    text: JSON.stringify([reminder({ ...fired, id: 'once' }), reminder({ ...fired, id: 'pills', repeat: 'daily', at: at(9, 22, 23, 29) }), reminder({ ...fired, id: 'tea' })]),
    mtimeMs: NOW,
  })
  await $.session.start(START)
  await w.clock.advance(MIN)
  await press($, w, 'done:once')
  await press($, w, 'done:pills')
  const now = w.clock.now()
  await press($, w, 'later15:tea')
  const after = saved(w)
  expect(after.map(r => r.id)).toEqual(['pills', 'tea'])
  expect(after[0]).toMatchObject({ at: at(9, 23, 23, 29), firedAt: null, firedBy: null })
  // A snooze leaves the reminder's own time alone.
  expect(after[1]).toMatchObject({ at: NOW - MIN, firedAt: null, firedBy: null })
  expect(after[1]?.snoozeUntil).toBeGreaterThanOrEqual(now + 15 * MIN)
  expect(after[1]?.snoozeUntil).toBeLessThanOrEqual(now + 15 * MIN + 1000)
})

test('a snoozed daily keeps its time: after +15m and Done it is due tomorrow at the same minute', async ($, on) => {
  const { w, notes } = withNotes(on)
  const pills = reminder({ id: 'pills', text: 'pills', repeat: 'daily', at: at(9, 22, 23, 29), firedAt: at(9, 22, 23, 29), firedBy: 'other' })
  w.files.set(FILE, { text: JSON.stringify([pills]), mtimeMs: NOW })
  await $.session.start(START)
  await w.clock.advance(MIN)
  await press($, w, 'later15:pills')
  await w.clock.advance(16 * MIN)
  expect(notes).toEqual(['pills'])
  await press($, w, 'done:pills')
  expect(saved(w)[0]).toMatchObject({ at: at(9, 23, 23, 29), snoozeUntil: null, firedAt: null })
})

test('a daily left ringing rings again at its next time', async ($, on) => {
  const { w, notes } = withNotes(on)
  const yesterday = at(9, 21, 23, 0)
  w.files.set(FILE, {
    text: JSON.stringify([reminder({ id: 'pills', text: 'pills', repeat: 'daily', at: yesterday, firedAt: yesterday, firedBy: 'other' })]),
    mtimeMs: NOW,
  })
  await $.session.start(START)
  await w.clock.advance(MIN)
  expect(notes).toEqual(['pills (late: it fell due while Claude Code was closed)'])
  expect(saved(w)[0]).toMatchObject({ at: at(9, 22, 23, 0), firedBy: 'me' })
})

test('Claude asks for a daily whose time today has passed: it starts tomorrow, no ring now', async ($, on) => {
  const { w, notes } = withNotes(on)
  await $.session.start(START)
  const called = callTool($, { tool: 'mcp__clawd-mods__remind', at: new Date(at(9, 22, 9)).toISOString(), text: 'pills', repeat: 'daily' })
  await w.clock.advance(400)
  expect((await called).result).toBe('Reminder set for Fri 23 Oct 09:00, every day: pills.')
  await w.clock.advance(MIN)
  expect(notes).toEqual([])
  expect(saved(w)[0]?.at).toBe(at(9, 23, 9))
})

test('missed repeats fire once, marked late, and Done moves on past now', async ($, on) => {
  const { w, notes } = withNotes(on)
  w.files.set(FILE, { text: JSON.stringify([reminder({ id: 'pills', text: 'pills', at: at(9, 19, 9), repeat: 'daily' })]), mtimeMs: NOW })
  await $.session.start(START)
  await w.clock.advance(3 * MIN)
  expect(notes).toHaveLength(1)
  expect(saved(w)[0]?.isLate).toBe(true)
  const { ui, texts } = await pane($)
  await ui.unmount()
  expect(texts.some(t => /pills.*late/.test(t.text))).toBe(true)
  await press($, w, 'done:pills')
  expect(saved(w)[0]).toMatchObject({ at: at(9, 23, 9), firedAt: null, isLate: false })
})
