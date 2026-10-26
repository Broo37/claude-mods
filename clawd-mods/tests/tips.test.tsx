import { type Engine, expect, test } from 'claude-code/testing'

import { DAY, fixPrompt, parseFast, tipsOf } from '../hooks/pc'
import { BAND, NOW, PANE, SAMPLE, START, type World, fastJson, pcRuns, world } from './world'

const MACHINE = 'C:/L/clawd-mods'
const CLAUDE = [
  { name: 'claude', pid: 10, ppid: 1, memMb: 900, cpuSec: 5 },
  { name: 'node', pid: 11, ppid: 10, memMb: 300, cpuSec: 1 },
  { name: 'chrome', pid: 20, ppid: 1, memMb: 2100, cpuSec: 9 },
]
const HOT = fastJson(93, CLAUDE)

type Found = { type: string; props: Record<string, unknown>; text: string }

async function paneTexts($: Engine): Promise<{ texts: Found[]; buttons: Found[] }> {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 42 }, surface: 'terminal' })
  const texts = (await ui.findAll({ type: 'Text' })) as Found[]
  const buttons = (await ui.findAll({ type: 'Button' })) as Found[]
  await ui.unmount()
  return { texts, buttons }
}

/** Two fast checks at 93%: the first at the start, the second once it is due again. */
async function twoHotChecks($: Engine, w: World): Promise<void> {
  w.scripts.fast = () => HOT
  await $.session.start(START)
  await w.clock.advance(140_000)
}

/** Presses a Button of the pane, mounted for the press. */
async function press($: Engine, key: string): Promise<void> {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 42 }, surface: 'terminal' })
  await $.ui.press({ plugin: 'clawd-mods', key })
  await ui.unmount()
}

test('a red tip: in the pane with Fix it and Not now, and Clawd is worried', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  await twoHotChecks($, w)
  const { texts, buttons } = await paneTexts($)
  expect(texts.find(t => t.text === '▌ TIPS')?.props.color).toBe('#F87171')
  expect(texts.some(t => /^● Memory 93% full/.test(t.text))).toBe(true)
  expect(texts.some(t => /Claude ×1 1\.2 GB · chrome 2\.1 GB/.test(t.text))).toBe(true)
  expect(buttons.map(b => b.text)).toEqual(['Fix it', 'Not now'])
  // TIPS stands on top of the pane.
  expect(texts.findIndex(t => t.text === '▌ TIPS')).toBeLessThan(texts.findIndex(t => t.text === '▌ LIMITS'))
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Client' }))?.props).toMatchObject({ props: { worried: true } })
  await band.unmount()
})

test('Fix it submits the tip to Claude', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  const sent: string[] = []
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  await twoHotChecks($, w)
  await press($, 'fix:memory')
  const facts = parseFast(HOT, NOW)
  if (!facts) throw new Error('fixture')
  const tip = tipsOf({ fast: [facts, facts], slow: null, knownStartup: null, snoozes: {} }, NOW)[0]
  if (!tip) throw new Error('no tip')
  expect(sent).toEqual([fixPrompt(tip)])
  expect(w.toasts).toEqual([])
})

test('Not now hides the tip for a day, for every session', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  await twoHotChecks($, w)
  const at = w.clock.now()
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 42 }, surface: 'terminal' })
  const pressed = $.ui.press({ plugin: 'clawd-mods', key: 'snooze:memory' })
  await w.clock.advance(400) // the lock on the shared state settles
  await pressed
  await ui.unmount()
  const state = JSON.parse(w.files.get(`${MACHINE}/pc-state.json`)?.text ?? '{}') as { snoozes?: Record<string, number> }
  expect(state.snoozes?.memory).toBe(at + DAY)
  expect((await paneTexts($)).texts.some(t => t.text === '▌ TIPS')).toBe(false)
})

test('one session runs the checks for every session', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  await $.session.start(START)
  await w.clock.advance(300_000)
  expect(pcRuns(w, 'fast')).toBe(3)
  expect(pcRuns(w, 'slow')).toBe(1)
})

test('another session holding the lock runs them; this one reads its answer', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  const facts = parseFast(HOT, NOW)
  w.files.set(`${MACHINE}/pc-fast.json`, { text: JSON.stringify({ at: NOW, triedAt: NOW, isFailed: false, value: [facts, facts] }), mtimeMs: NOW })
  const hold = () => w.files.set(`${MACHINE}/pc-fast.lock.json`, { text: JSON.stringify({ owner: 'other', at: w.clock.now() }), mtimeMs: NOW })
  hold()
  await $.session.start(START)
  for (let i = 0; i < 10; i += 1) {
    await w.clock.advance(30_000)
    hold()
  }
  expect(pcRuns(w, 'fast')).toBe(0)
  expect((await paneTexts($)).texts.some(t => /^● Memory 93% full/.test(t.text))).toBe(true)
})

test('script failure: the last tips stay, marked stale', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  const facts = parseFast(HOT, NOW - 10 * 60_000)
  w.files.set(`${MACHINE}/pc-fast.json`, {
    text: JSON.stringify({ at: NOW - 600_000, triedAt: NOW - 600_000, isFailed: false, value: [facts, facts] }),
    mtimeMs: NOW,
  })
  w.scripts.fast = () => {
    throw new Error('powershell.exe timed out')
  }
  await $.session.start(START)
  await w.clock.advance(2000)
  expect(pcRuns(w, 'fast')).toBe(1)
  const { texts } = await paneTexts($)
  expect(texts.some(t => /^● Memory 93% full/.test(t.text))).toBe(true)
  expect(texts.some(t => /Last check failed/.test(t.text))).toBe(true)
})

test('not Windows: no PC checks, no tips', async ($, on) => {
  const w = world(on, () => SAMPLE, [], { os: 'Linux' })
  w.scripts.fast = () => HOT
  await $.session.start(START)
  await w.clock.advance(300_000)
  expect(pcRuns(w, 'fast') + pcRuns(w, 'slow')).toBe(0)
  expect((await paneTexts($)).texts.some(t => t.text === '▌ TIPS')).toBe(false)
})
