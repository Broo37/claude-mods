import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { EQUALIZER } from '../hooks/equalizer'
import { FRAMES } from '../hooks/frames'
import { RAINBOW } from '../hooks/rainbow'
import { CLAUDE_ORANGE, cellsAt, cellsOf } from '../hooks/strip'

const NOW = new Date(2026, 9, 7, 8, 45).getTime()

const TURN = { answer: 'done', isAborted: false, turnId: 't1', reason: 'answer', durationMs: 5000 } as const

// The id Claude Code gives the line of the main conversation.
const LINE = 'main'

const PEACH = 0xf0c0a8

const MAPLE = '{"name":"Maple","base":"dark","overrides":{"claude":"#f0c0a8"}}'

type Drawn = { type: string; props?: Record<string, unknown>; children?: unknown[] }

type Blit = { requestId: string; key: string; columns?: number; rows?: number; cells?: string }

type Props = { word: string; message: string | null; suffix: string; mode: 'responding' | 'thinking' }

type Line = { drawn(): Promise<unknown>; unmount(): Promise<unknown> }

const fresh = () => ({
  redraws: 0,
  blits: [] as Blit[],
  blitDeny: '',
  theme: 'dark',
  env: {} as Record<string, string>,
  files: {} as Record<string, string>,
  // The line on screen, once a test has drawn it.
  line: undefined as Line | undefined,
})

// What the stubs answer from; each test starts with a fresh one.
let world = fresh()

// The stubs beneath the mod: they answer in Claude Code's place, from a world the test may change.
const boot = (on: On) => {
  world = fresh()
  const clock = mock.clock(on, { now: NOW })

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('config.list', () => ({
    value: [
      {
        key: 'theme',
        label: 'Theme',
        kind: 'choice',
        value: world.theme,
        provider: { plugin: 'engine', tier: 'core' },
        isLocked: false,
      },
    ],
  }))
  on('env.get', ($, e) => ({ value: world.env[e.name] }))
  on('fs.read', ($, e) => {
    const file = world.files[e.path.replaceAll('\\', '/')]

    return file === undefined ? { deny: 'ENOENT' } : { value: file }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', () => {
    world.redraws += 1

    return { value: undefined }
  })
  on('ui.blit', ($, e) => {
    world.blits.push(e as Blit)

    return { value: world.blitDeny === '' ? {} : { deny: world.blitDeny } }
  })
  on('ui.render', { component: 'Spinner' }, ($, e) => ({ type: 'Text', props: {}, children: [`* ${e.props.word}`] }))

  return { world, clock }
}

// Matched, not equaled: since 2.1.301 the test engine tags its own tree with the plugin that passed it on
const ENGINE_LINE = (word: string) => ({ type: 'Text', props: {}, children: [`* ${word}`] })

const start = async ($: Engine, clock: MockClock) => {
  await $.session.start({ cwd: 'C:\\work', surface: 'terminal', isInteractive: true })
  await clock.settle()
}

const begin = async ($: Engine, clock: MockClock, turnId = 't1') => {
  await $.turn.start({ text: 'hi', turnId })
  await clock.settle()
}

// Draws the line, in place of the one drawn before, and leaves it on screen as
// it is for the length of a turn.
const show = async ($: Engine, props: Partial<Props> = {}, surface: 'terminal' | 'desktop' = 'terminal') => {
  await world.line?.unmount()
  world.line = await $.ui.mount({
    plugin: 'spinner',
    component: 'Spinner',
    requestId: LINE,
    props: { word: 'Baking', message: null, suffix: '…', mode: 'responding', ...props },
    surface,
  })

  return (await world.line.drawn()) as Drawn
}

const partsOf = (tree: Drawn) => (tree.children ?? []) as [Drawn?, Drawn?, Drawn?]

const timeOf = (tree: Drawn) => partsOf(tree)[2]?.children?.[0]

const stripOf = (tree: Drawn) => partsOf(tree)[0]?.props?.cells

// The cells of a frame of the equalizer, the strip drawn when no other is picked.
const barsAt = (frame: number, color = CLAUDE_ORANGE) => cellsAt(EQUALIZER, frame * 80, color)

test('draws the strip, the wording and the time in place of the line', async ($, on) => {
  const { clock } = boot(on)
  await begin($, clock)
  const tree = await show($)
  const [strip, words, time] = partsOf(tree)

  expect(tree.type).toBe('Box')
  expect(strip?.type).toBe('Raster')
  expect(strip?.props?.key).toBe('strip')
  expect(strip?.props?.columns).toBe(12)
  expect(strip?.props?.rows).toBe(1)
  expect(strip?.props?.cells).toBe(barsAt(0))
  expect(words?.children).toEqual([' Iwan will get Baking...'])
  expect(words?.props?.color).toBe('claude')
  expect(time?.children).toEqual([' (0s)'])
  expect(time?.props?.dimColor).toBe(true)
})

test('leaves an empty row above the line, as Claude Code does', async ($, on) => {
  const { clock } = boot(on)
  await begin($, clock)

  expect((await show($)).props?.marginTop).toBe(1)
})

test('counts the time from the start of the turn', async ($, on) => {
  const { clock } = boot(on)
  await begin($, clock)
  await clock.advance(12_400)
  const tree = await show($)

  expect(timeOf(tree)).toBe(' (12s)')
  // 12.4 s is frame 155, which is the 60th of the second round.
  expect(stripOf(tree)).toBe(barsAt(59))
})

test('counts from when the line first showed, when no turn was seen to start', async ($, on) => {
  const { clock } = boot(on)
  await clock.advance(60_000)

  expect(timeOf(await show($))).toBe(' (0s)')

  await clock.advance(3000)

  expect(timeOf(await show($))).toBe(' (3s)')
})

test('keeps counting when a turn starts while the line shows, as one of a subagent does', async ($, on) => {
  const { clock } = boot(on)
  await begin($, clock)
  await show($)
  await clock.advance(5000)
  await begin($, clock, 't2')
  await clock.advance(1000)

  expect(timeOf(await show($))).toBe(' (6s)')
})

test('starts the time over with the next turn', async ($, on) => {
  const { clock } = boot(on)
  await begin($, clock)
  await show($)
  await clock.advance(5000)
  await $.turn.complete(TURN)
  await begin($, clock, 't2')
  await clock.advance(2000)

  expect(timeOf(await show($))).toBe(' (2s)')
})

test("keeps the main turn's time when a subagent's turn ends", async ($, on) => {
  const { clock } = boot(on)
  await begin($, clock)
  await show($)
  await clock.advance(5000)
  await $.turn.complete({ ...TURN, turnId: 't2', agentId: 'a1' })
  await clock.advance(1000)

  expect(timeOf(await show($))).toBe(' (6s)')
})

test('says when Claude is thinking', async ($, on) => {
  const { clock } = boot(on)
  await begin($, clock)

  expect(timeOf(await show($, { mode: 'thinking' }))).toBe(' (0s · thinking)')
})

test('draws a message that overrides the verb in its place', async ($, on) => {
  const { clock } = boot(on)
  await begin($, clock)

  expect(partsOf(await show($, { message: 'Compacting conversation' }))[1]?.children).toEqual([' Compacting conversation…'])
})

test('leaves the line as Claude Code draws it before the turn has a verb', async ($, on) => {
  const { clock } = boot(on)
  await begin($, clock)

  expect(await show($, { word: '' })).toMatchObject(ENGINE_LINE(''))
})

test('leaves the line as Claude Code draws it where there is no raster', async ($, on) => {
  const { clock } = boot(on)
  await begin($, clock)

  expect(await show($, {}, 'desktop')).toMatchObject(ENGINE_LINE('Baking'))
})

test('moves the strip every 80 ms without the line being drawn again', async ($, on) => {
  const { world, clock } = boot(on)
  await begin($, clock)
  await show($)
  await clock.advance(80)

  expect(world.blits).toEqual([{ requestId: LINE, key: 'strip', columns: 12, rows: 1, cells: barsAt(1) }])

  await clock.advance(160)

  expect(world.blits.map(blit => blit.cells)).toEqual([1, 2, 3].map(frame => barsAt(frame)))
  expect(world.redraws).toBe(0)
})

test('draws the smiley strip when the person picked it', { options: { style: 'smiley' } }, async ($, on) => {
  const { world, clock } = boot(on)
  await begin($, clock)

  expect(stripOf(await show($))).toBe(cellsOf(FRAMES[0] ?? '', CLAUDE_ORANGE))

  await clock.advance(80)

  expect(world.blits.map(blit => blit.cells)).toEqual([cellsOf(FRAMES[1] ?? '', CLAUDE_ORANGE)])
})

test('draws and moves the strip the person picked, in its own colors', { options: { style: 'rainbow' } }, async ($, on) => {
  const { world, clock } = boot(on)
  await begin($, clock)

  expect(stripOf(await show($))).toBe(cellsAt(RAINBOW, 0, CLAUDE_ORANGE))

  await clock.advance(160)

  expect(world.blits.map(blit => blit.cells)).toEqual([80, 160].map(elapsed => cellsAt(RAINBOW, elapsed, CLAUDE_ORANGE)))
})

test('draws the equalizer for a pick it does not know', { options: { style: 'disco' } }, async ($, on) => {
  const { clock } = boot(on)
  await begin($, clock)

  expect(stripOf(await show($))).toBe(barsAt(0))
})

test('has the line drawn again when the second turns', async ($, on) => {
  const { world, clock } = boot(on)
  await begin($, clock)
  await show($)
  await clock.advance(900)

  expect(world.redraws).toBe(0)

  await clock.advance(200)

  expect(world.redraws).toBe(1)
})

test('has it drawn again every second for as long as it is drawn', async ($, on) => {
  const { world, clock } = boot(on)
  await begin($, clock)
  await show($)
  await clock.advance(1100)
  await show($)
  await clock.advance(1000)

  expect(world.redraws).toBe(2)

  // Nobody drew it after that: the turn is over, and nothing more is asked.
  await clock.advance(5000)

  expect(world.redraws).toBe(2)
})

test('stops moving the strip once the line is gone', async ($, on) => {
  const { world, clock } = boot(on)
  await begin($, clock)
  await show($)
  world.blitDeny = 'no Raster of its own is mounted under that key'
  await clock.advance(80)
  await clock.advance(800)

  expect(world.blits.length).toBe(1)
})

test('moves the strip again when the line is back', async ($, on) => {
  const { world, clock } = boot(on)
  await begin($, clock)
  await show($)
  world.blitDeny = 'no Raster of its own is mounted under that key'
  await clock.advance(400)
  world.blitDeny = ''
  await show($)
  await clock.advance(80)

  expect(world.blits.length).toBe(2)
})

test('says the wording the person set', { options: { format: 'Hold on, {}!' } }, async ($, on) => {
  const { clock } = boot(on)
  await begin($, clock)

  expect(partsOf(await show($))[1]?.children).toEqual([' Hold on, Baking!'])
})

test("draws the strip in the claude color of the person's custom theme", async ($, on) => {
  const { world, clock } = boot(on)
  world.theme = 'custom:maple'
  world.env = { CLAUDE_CONFIG_DIR: 'C:/cfg' }
  world.files = { 'C:/cfg/themes/maple.json': MAPLE }
  await start($, clock)
  await begin($, clock)

  expect(stripOf(await show($))).toBe(barsAt(0, PEACH))
})

test('looks for the theme under the home folder when no config folder is set', async ($, on) => {
  const { world, clock } = boot(on)
  world.theme = 'custom:maple'
  world.env = { USERPROFILE: 'C:/Users/me' }
  world.files = { 'C:/Users/me/.claude/themes/maple.json': MAPLE }
  await start($, clock)
  await begin($, clock)

  expect(stripOf(await show($))).toBe(barsAt(0, PEACH))
})

test("draws the strip in Claude Code's orange when the theme cannot be read", async ($, on) => {
  const { world, clock } = boot(on)
  world.theme = 'custom:gone'
  world.env = { CLAUDE_CONFIG_DIR: 'C:/cfg' }
  await start($, clock)
  await begin($, clock)

  expect(stripOf(await show($))).toBe(barsAt(0))
})

test('takes up a change of theme with the next turn', async ($, on) => {
  const { world, clock } = boot(on)
  world.env = { CLAUDE_CONFIG_DIR: 'C:/cfg' }
  world.files = { 'C:/cfg/themes/maple.json': MAPLE }
  await start($, clock)
  world.theme = 'custom:maple'
  await begin($, clock)

  expect(stripOf(await show($))).toBe(barsAt(0, PEACH))
})
