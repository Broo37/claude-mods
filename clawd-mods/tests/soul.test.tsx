import { type Engine, expect, test } from 'claude-code/testing'

import { ACTS, type ClawdProps, MOODS, SOUL, click, create, step } from '../hooks/clawd'
import { BAND, SAMPLE, START, world } from './world'

const COLS = 30
const DEAD: ClawdProps = {
  mood: 'dead',
  halves: 0,
  isCrit: true,
  worried: false,
  event: null,
  sky: null,
  control: { kind: 'auto' },
  overhead: null,
  width: COLS,
}
const text = (row: { text: string }[] | undefined): string => (row ?? []).map(run => run.text).join('')

test('clicked while belly-up, his soul floats out on a string, then goes back', () => {
  expect(SOUL).toBe('\u{F0A00}') // a ghost, in the user's font
  const m = create(DEAD)
  m.act = null // past the entrance
  click(m, COLS)
  let isUp = false
  for (let i = 0; i < 40; i += 1) {
    step(m, COLS)
    if (text(m.rows[0]).includes(SOUL) && text(m.rows[1]).includes('│')) isUp = true
  }
  expect(isUp).toBe(true)
  for (let i = 0; i < 35; i += 1) step(m, COLS)
  expect(m.rows.some(row => text(row).includes(SOUL))).toBe(false)
  expect(text(m.rows[1]).includes('│')).toBe(false)
})

test('every animation and mood is listed for play and demo', () => {
  for (const act of ['jump', 'look', 'peekaboo', 'wave', 'stretch', 'yawn', 'stumble', 'twitch', 'soul']) expect(ACTS).toContain(act)
  expect([...MOODS]).toEqual(['idle', 'work', 'wait', 'dead', 'doze'])
})

test('play: the asked animation starts once', () => {
  // Working, he never waves by chance, so a second wave could only be a replay.
  const m = create({ ...DEAD, mood: 'work', halves: 6, isCrit: false })
  m.act = null
  m.props = { ...m.props, control: { kind: 'play', act: 'wave', id: 7 } }
  step(m, COLS)
  expect(m.act).toBe('wave')
  for (let i = 0; i < 60; i += 1) step(m, COLS)
  expect(m.act).not.toBe('wave') // done, and not started again for the same id
})

test('demo: every animation, then every mood, then live again', () => {
  const m = create({ ...DEAD, mood: 'idle', halves: 6, isCrit: false })
  m.act = null
  m.props = { ...m.props, control: { kind: 'demo', id: 3 } }
  const seen = new Set<string>()
  for (let i = 0; i < (ACTS.length + MOODS.length) * 50 + 10; i += 1) {
    step(m, COLS)
    if (m.act) seen.add(m.act)
  }
  for (const act of ACTS) expect([act, seen.has(act)]).toEqual([act, true])
  expect(m.demo).toBeNull()
})

const run = async ($: Engine, args: string) =>
  (await $.command.run({ command: 'clawd', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })).text

async function control($: Engine) {
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const props = (await ui.find({ type: 'Client' }))?.props.props as { control: { kind: string; act?: string } }
  await ui.unmount()
  return props.control
}

test('/clawd play lists the animations', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  await $.session.start(START)
  await w.clock.advance(400)
  const said = await run($, 'play')
  expect(said?.startsWith('Animations:')).toBe(true)
  expect(said).toContain('jump')
  expect(said).toContain('soul')
})

test('/clawd play jump plays it once; an unknown name is said so', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  await $.session.start(START)
  await w.clock.advance(400)
  expect(await run($, 'play jump')).toBe('Playing jump.')
  expect(await control($)).toMatchObject({ kind: 'play', act: 'jump' })
  expect(await run($, 'play x')).toBe('No animation called "x".')
})

test('/clawd demo, then /clawd auto', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  await $.session.start(START)
  await w.clock.advance(400)
  await run($, 'demo')
  expect((await control($)).kind).toBe('demo')
  await run($, 'auto')
  expect((await control($)).kind).toBe('auto')
})
