import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'

import { FRAME_MS, LASTS_MS, ROWS } from '../hooks/burst'

const NOW = new Date(2026, 9, 20, 16, 0).getTime()

// What the stub draws in the band in the engine's place, and the band's id.
const ENGINE_BAND = 'engine band'
const BAND_ID = 'above-prompt'

type Drawn = { type: string; props?: Record<string, unknown>; children?: unknown[] }

type Blit = { requestId: string; key: string; cells?: string }

const fresh = () => ({ commands: [] as string[], blits: [] as Blit[] })

let world = fresh()

// The stubs beneath the mod: they answer in Claude Code's place.
const boot = (on: On) => {
  world = fresh()
  const clock = mock.clock(on, { now: NOW })

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => {
    world.commands.push(e.name)

    return { value: { command: e.name } }
  })
  on('command.run', () => ({ text: 'no such command' }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.blit', ($, e) => {
    world.blits.push(e as Blit)

    return { value: {} }
  })
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: [ENGINE_BAND] }))

  return { clock }
}

// A stand-in for Clean View: it writes its checklist in the phase a command names.
const CLEAN_VIEW: Plugin = {
  name: 'clean-view',
  register(on) {
    on('command.run', { command: 'phase' }, async ($, e) => {
      const phase = e.args as 'working' | 'done' | 'stopped' | 'stuck' | 'needs-you'
      await $.state.set(
        { plugin: 'clean-view', key: 'checklist' },
        { title: 'Build the page', phase, tasks: [], needsYouReason: null, stuckReason: null, startedAt: 0, finishedAt: null },
      )

      return { text: phase }
    })
  },
}

const start = async ($: Engine, clock: MockClock) => {
  await $.session.start({ cwd: 'C:\\work', surface: 'terminal', isInteractive: true })
  await clock.settle()
}

const run = async ($: Engine, clock: MockClock, command: string, args = '') => {
  await $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 150 } })
  await clock.settle()
}

const BAND = {
  plugin: 'confetti',
  component: 'AbovePrompt',
  requestId: BAND_ID,
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 60, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

const mountBand = ($: Engine, surface: 'terminal' | 'desktop' = 'terminal', props: Record<string, unknown> = {}) =>
  $.ui.mount({ ...BAND, props: { ...BAND.props, ...props }, surface })

// Since 2.1.301 the test engine tags a tree it drew itself with a `part`: the rest is what has to be left alone.
const untagged = (tree?: Drawn) => {
  const { part, ...rest } = (tree ?? {}) as Drawn & { part?: unknown }

  return rest
}

const rastersIn = (tree: Drawn): Drawn[] => [
  ...(tree.type === 'Raster' ? [tree] : []),
  ...(tree.children ?? []).flatMap(child => (typeof child === 'object' && child !== null ? rastersIn(child as Drawn) : [])),
]

const textOf = (tree: unknown): string =>
  typeof tree === 'string' ? tree : ((tree as Drawn | null)?.children ?? []).map(textOf).join('')

const ENGINE_TREE = { type: 'Text', props: {}, children: [ENGINE_BAND] }

test('adds /confetti to the commands', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)

  expect(world.commands).toContain('confetti')
})

test('leaves the band as it is while no burst plays', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const band = await mountBand($)

  expect(untagged((await band.drawn()) as Drawn)).toEqual(ENGINE_TREE)
})

test('/confetti draws a burst over the band, two rows of pixels as wide as it, and the band under it', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const band = await mountBand($)
  await run($, clock, 'confetti')
  const tree = (await band.drawn()) as Drawn
  const [burst, rest] = (tree.children ?? []) as [Drawn, Drawn]

  expect(tree.type).toBe('Box')
  expect(tree.props?.flexDirection).toBe('column')
  expect(burst.type).toBe('Raster')
  expect(burst.props).toMatchObject({ key: 'confetti', columns: 60, rows: ROWS })
  expect(textOf(rest)).toBe(ENGINE_BAND)
})

test('moves the burst on frame by frame, without drawing the band again', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const band = await mountBand($)
  await run($, clock, 'confetti')
  await band.drawn()
  await clock.advance(FRAME_MS * 6)

  expect(world.blits.length).toBeGreaterThanOrEqual(4)
  expect(world.blits.every(blit => blit.requestId === BAND_ID && blit.key === 'confetti')).toBe(true)
  expect(new Set(world.blits.map(blit => blit.cells)).size).toBeGreaterThan(1)
})

test('is gone after a second and a half, leaving the band as it was', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const band = await mountBand($)
  await run($, clock, 'confetti')
  await band.drawn()
  await clock.advance(LASTS_MS + FRAME_MS * 2)

  expect(untagged((await band.drawn()) as Drawn)).toEqual(ENGINE_TREE)

  const moved = world.blits.length
  await clock.advance(FRAME_MS * 10)

  expect(world.blits.length).toBe(moved)
})

test('starts over when /confetti comes again while a burst plays', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const band = await mountBand($)
  await run($, clock, 'confetti')
  await clock.advance(1000)
  await run($, clock, 'confetti')
  await clock.advance(1000)

  expect(rastersIn((await band.drawn()) as Drawn)).toHaveLength(1)
})

test('plays when a Clean View job ends as All done', { plugins: [CLEAN_VIEW] }, async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const band = await mountBand($)
  await run($, clock, 'phase', 'working')

  expect(rastersIn((await band.drawn()) as Drawn)).toHaveLength(0)

  await run($, clock, 'phase', 'done')

  expect(rastersIn((await band.drawn()) as Drawn)).toHaveLength(1)
})

test('stays still when a job is stopped, stuck or waiting for you', { plugins: [CLEAN_VIEW] }, async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const band = await mountBand($)

  for (const phase of ['stopped', 'stuck', 'needs-you']) {
    await run($, clock, 'phase', 'working')
    await run($, clock, 'phase', phase)

    expect(rastersIn((await band.drawn()) as Drawn)).toHaveLength(0)
  }
})

test('plays once a job: Clean View writing its finished checklist again does not play it again', { plugins: [CLEAN_VIEW] }, async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const band = await mountBand($)
  await run($, clock, 'phase', 'working')
  await run($, clock, 'phase', 'done')
  await clock.advance(LASTS_MS + FRAME_MS * 2)
  await run($, clock, 'phase', 'done')

  expect(rastersIn((await band.drawn()) as Drawn)).toHaveLength(0)
})

test('leaves the band alone on the desktop and while a survey holds it', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const desktop = await mountBand($, 'desktop')
  await run($, clock, 'confetti')

  expect(untagged((await desktop.drawn()) as Drawn)).toEqual(ENGINE_TREE)

  await desktop.unmount()
  const surveyed = await mountBand($, 'terminal', { hasSurvey: true })

  expect(untagged((await surveyed.drawn()) as Drawn)).toEqual(ENGINE_TREE)
})
