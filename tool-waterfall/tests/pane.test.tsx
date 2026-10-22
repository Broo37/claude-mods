import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock, Plugin } from 'claude-code/testing'
import type { On, ToolCallResult } from 'claude-code'

import { linesOf } from '../hooks/chart'
import type { Call } from '../hooks/chart'

const NOW = new Date(2026, 9, 8, 8, 45).getTime()

const TURN = { answer: 'done', isAborted: false, turnId: 't1', reason: 'answer' } as const

type Drawn = { type: string; props?: Record<string, unknown>; children?: unknown[] }

const PANE = {
  plugin: 'tool-waterfall',
  component: 'Pane',
  requestId: 'waterfall',
  props: {
    title: 'Waterfall',
    isFocused: false,
    // Two columns of gutter and a chart of 64.
    bodyColumns: 66,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

// The stubs beneath the mod: they answer in Claude Code's place, from a world the test may change.
const boot = (on: On) => {
  const world = {
    // How long the next tool call takes, what it answers, and a gate it waits at when one is set.
    takes: 0,
    answer: { result: 'ok' } as ToolCallResult,
    gate: null as Promise<void> | null,
    redraws: 0,
    commands: [] as string[],
    opened: [] as { id: string; title?: string; columns?: number }[],
    closed: [] as string[],
    panes: [] as string[],
    // The pane the dock shows; the others are tabs behind it.
    front: '',
    store: {} as Record<string, unknown>,
  }
  const clock = mock.clock(on, { now: NOW })

  on('store.get', ($, e) => ({ value: world.store[e.key] }))
  on('store.set', ($, e) => {
    world.store[e.key] = e.value

    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', async () => {
    await clock.advance(world.takes)

    if (world.gate !== null) {
      await world.gate
    }

    return world.answer
  })
  on('command.register', ($, e) => {
    world.commands.push(e.name)

    return { value: { command: e.name } }
  })
  on('command.run', () => ({ text: 'no such command' }))
  on('ui.open', ($, e) => {
    world.opened.push({ id: e.id, title: e.title, columns: e.columns })
    world.panes = [...new Set([...world.panes, e.id])]
    world.front = e.id

    return { value: { isPlaced: true as const } }
  })
  on('ui.close', ($, e) => {
    world.closed.push(e.id)
    world.panes = world.panes.filter(id => id !== e.id)

    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: world.panes.map(id => ({ id, title: 'Waterfall', isShown: id === world.front, isFocused: false, isPlaced: true })),
  }))
  on('ui.invalidate', () => {
    world.redraws += 1

    return { value: undefined }
  })
  on('ui.render', { component: 'Pane' }, () => ({ type: 'Text', props: {}, children: ['engine pane'] }))

  return { world, clock }
}

type World = ReturnType<typeof boot>['world']

const start = async ($: Engine, clock: MockClock) => {
  await $.session.start({ cwd: 'C:\\work', surface: 'terminal', isInteractive: true })
  await clock.settle()
}

const ask = ($: Engine) =>
  $.command.run({
    command: 'waterfall',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 150 },
  })

const begin = async ($: Engine, clock: MockClock, turnId = 't1') => {
  await $.turn.start({ text: 'hi', turnId })
  await clock.settle()
}

const finish = async ($: Engine, clock: MockClock, durationMs: number, more: Record<string, unknown> = {}) => {
  await $.turn.complete({ ...TURN, durationMs, ...more })
  await clock.settle()
}

// Has Claude call a tool that takes so long and answers so.
const call = async (
  $: Engine,
  world: World,
  args: Record<string, unknown> & { tool: string; tool_use_id: string },
  takes: number,
  answer: ToolCallResult = { result: 'ok' },
) => {
  world.takes = takes
  world.answer = answer
  await $.tool.call(args as Parameters<Engine['tool']['call']>[0])
}

// The pane as lines of text.
const paneOf = async ($: Engine, bodyColumns = 66, bodyRows = 20) => {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns, scroll: { offset: 0, bodyRows } }, surface: 'terminal' })
  const tree = (await ui.drawn()) as Drawn
  await ui.unmount()

  return tree
}

const linesIn = (tree: Drawn) =>
  (tree.children ?? []).map(row => ((row as Drawn).children ?? []).map(run => ((run as Drawn).children ?? []).join('')).join(''))

const textsOf = (calls: Call[], lasted: number | null, elapsed = 0, columns = 64, rows = 20) =>
  linesOf({ calls, lasted }, elapsed, columns, rows).map(line => line.map(run => run.text).join(''))

test('offers the command /waterfall', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)

  expect(world.commands).toEqual(['waterfall'])
})

test('opens its pane when the person asks for it, as wide as the Sessions pane it shares the dock with', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)

  expect(await ask($)).toEqual({ text: 'Waterfall opened.' })
  // The dock keeps one width for its tabs: asking for more would widen it for the Sessions pane too.
  expect(world.opened).toEqual([{ id: 'waterfall', title: 'Waterfall', columns: 32 }])
})

test('brings its pane to the front when the person asks for it while it is a tab behind another pane', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await ask($)
  // The Sessions pane opened after it and is the one shown.
  world.front = 'sessions'

  expect(await ask($)).toEqual({ text: 'Waterfall in front.' })
  // The pane opened last is the tab in front: it is closed and opened again.
  expect(world.closed).toEqual(['waterfall'])
  expect(world.opened).toHaveLength(2)
  expect(world.front).toBe('waterfall')
  expect(world.store).toEqual({ kept: true })
})

test('opens nothing by itself for a person who never asked for the pane', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)

  expect(world.opened).toEqual([])
})

test('keeps the pane as a tab once the person asked for it: the next session opens it by itself', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await ask($)

  expect(world.store).toEqual({ kept: true })

  // The next session starts with what the last one kept.
  world.opened = []
  world.panes = []
  await start($, clock)

  expect(world.opened).toEqual([{ id: 'waterfall', title: 'Waterfall', columns: 32 }])
})

test('forgets the pane once the person closes it: the next session opens nothing', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await ask($)
  await ask($)

  expect(world.store).toEqual({ kept: false })

  world.opened = []
  await start($, clock)

  expect(world.opened).toEqual([])
})

test('starts a session all the same when what it kept cannot be read', async ($, on) => {
  const { world, clock } = boot(on)
  world.store = { kept: 'yes' }
  await start($, clock)

  expect(world.opened).toEqual([])
  expect(world.commands).toEqual(['waterfall'])
})

test("keeps its lines two columns off the pane's left edge, as the Sessions pane stands", async ($, on) => {
  boot(on)

  expect((await paneOf($)).props?.paddingLeft).toBe(2)
})

test('closes its pane when the person asks again', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await ask($)

  expect(await ask($)).toEqual({ text: 'Waterfall closed.' })
  expect(world.closed).toEqual(['waterfall'])
  expect(world.opened).toHaveLength(1)
})

test('says so in its pane before any turn has run', async ($, on) => {
  boot(on)

  expect(linesIn(await paneOf($))).toEqual(['No turn yet. Tool calls show here as Claude works.'])
})

test('charts each call of the turn where it began and as long as it took, with what it was about', async ($, on) => {
  const { world, clock } = boot(on)
  await begin($, clock)
  await call($, world, { tool: 'Bash', command: 'npm test', tool_use_id: 'c1' }, 4200)
  await clock.advance(800)
  await call($, world, { tool: 'Read', file_path: 'C:\\work\\src\\orders.ts', tool_use_id: 'c2' }, 100)
  await clock.advance(2900)
  await call($, world, { tool: 'Bash', command: 'git push', tool_use_id: 'c3' }, 1300, { result: 'rejected', isError: true })
  await finish($, clock, 10_000)

  expect(linesIn(await paneOf($))).toEqual(
    textsOf(
      [
        { id: 'c1', tool: 'Bash', label: 'npm test', start: 0, end: 4200, isError: false },
        { id: 'c2', tool: 'Read', label: 'orders.ts', start: 5000, end: 5100, isError: false },
        { id: 'c3', tool: 'Bash', label: 'git push', start: 8000, end: 9300, isError: true },
      ],
      10_000,
    ),
  )
})

test('draws its runs in their colors, bold and dim as the chart names them', async ($, on) => {
  const { world, clock } = boot(on)
  await begin($, clock)
  await call($, world, { tool: 'Bash', command: 'git push', tool_use_id: 'c1' }, 1300, { result: 'rejected', isError: true })
  await finish($, clock, 2000)
  const [heading, , row] = ((await paneOf($)).children ?? []) as Drawn[]
  const looks = (line?: Drawn) => (line?.children ?? []).map(run => (run as Drawn).props ?? {})

  expect(looks(heading)).toEqual([
    { dimColor: true, wrap: 'truncate-end' },
    { bold: true, wrap: 'truncate-end' },
    { dimColor: true, wrap: 'truncate-end' },
    { color: 'error', wrap: 'truncate-end' },
  ])
  expect(looks(row)[0]).toEqual({ color: 'claude', wrap: 'truncate-end' })
  expect(looks(row).at(-1)).toEqual({ color: 'error', wrap: 'truncate-end' })
})

test('fits its chart to the width and height the pane has', async ($, on) => {
  const { world, clock } = boot(on)
  await begin($, clock)
  await call($, world, { tool: 'Bash', command: 'npm test', tool_use_id: 'c1' }, 1000)
  await call($, world, { tool: 'Bash', command: 'npm run lint', tool_use_id: 'c2' }, 1000)
  await call($, world, { tool: 'Bash', command: 'npm run build', tool_use_id: 'c3' }, 1000)
  await finish($, clock, 3000)
  const lines = linesIn(await paneOf($, 32, 6))

  // Thirty columns of chart stack a call in two rows, and six rows have room for one.
  expect(lines).toHaveLength(5)
  expect(lines[2]).toBe('+2 earlier')
  expect(lines[3]).toBe('Bash   npm run build')
  expect(lines[4]?.length).toBe(30)
})

test('grows the bar of a call that still runs, as far as the turn has come', async ($, on) => {
  const { world, clock } = boot(on)
  let open = () => {}
  world.gate = new Promise<void>(resolve => {
    open = resolve
  })
  await begin($, clock)
  await clock.advance(2000)
  const running = $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'c1' })
  // The call has begun and waits at the gate before the clock moves on.
  await clock.settle()
  await clock.advance(4000)

  expect(linesIn(await paneOf($))).toEqual(
    textsOf([{ id: 'c1', tool: 'Bash', label: 'npm test', start: 2000, end: null, isError: false }], null, 6000),
  )

  open()
  await running
})

test('has its pane drawn again when a call begins and when it ends', async ($, on) => {
  const { world, clock } = boot(on)
  await begin($, clock)
  const before = world.redraws
  await call($, world, { tool: 'Bash', command: 'ls', tool_use_id: 'c1' }, 0)

  expect(world.redraws).toBe(before + 2)
})

test('has it drawn again twice a second while a turn runs, and no more once the turn has ended', async ($, on) => {
  const { world, clock } = boot(on)
  await begin($, clock)
  const before = world.redraws
  await clock.advance(2000)

  expect(world.redraws).toBe(before + 4)

  await finish($, clock, 2000)
  const after = world.redraws
  await clock.advance(5000)

  expect(world.redraws).toBe(after)
})

test("leaves a subagent's calls out of the chart", async ($, on) => {
  const { world, clock } = boot(on)
  await begin($, clock)
  await call($, world, { tool: 'Agent', description: 'look', prompt: 'look', subagent_type: 'Explore', tool_use_id: 'c1' }, 1000)
  await call($, world, { tool: 'Read', file_path: 'a.ts', tool_use_id: 'c2', agentId: 'a1' }, 1000)
  await finish($, clock, 2000)

  expect(linesIn(await paneOf($))).toEqual(
    textsOf([{ id: 'c1', tool: 'Agent', label: 'Explore', start: 0, end: 1000, isError: false }], 2000),
  )
})

test('charts a question put to the person by what it was about', async ($, on) => {
  const { world, clock } = boot(on)
  await begin($, clock)
  await call(
    $,
    world,
    {
      tool: 'AskUserQuestion',
      tool_use_id: 'q1',
      questions: [{ question: 'Run it?', header: 'Risky', multiSelect: false, options: [{ label: 'Run it', description: '' }, { label: 'Block it', description: '' }] }],
    },
    3000,
  )
  await finish($, clock, 4000)

  expect(linesIn(await paneOf($))).toEqual(
    textsOf([{ id: 'q1', tool: 'AskUserQuestion', label: 'Risky', start: 0, end: 3000, isError: false }], 4000),
  )
  expect(linesIn(await paneOf($))[0]).toBe('Turn 4s · no tools')
})

test("keeps charting the main turn when a subagent's turn starts or ends", async ($, on) => {
  const { world, clock } = boot(on)
  await begin($, clock)
  await call($, world, { tool: 'Bash', command: 'ls', tool_use_id: 'c1' }, 1000)
  await begin($, clock, 't2')
  await finish($, clock, 500, { turnId: 't2', agentId: 'a1' })
  await call($, world, { tool: 'Bash', command: 'pwd', tool_use_id: 'c2' }, 1000)
  await finish($, clock, 2000)

  expect(linesIn(await paneOf($))[0]).toBe('Turn 2s · 2 tools')
})

test('starts its chart over with the next turn', async ($, on) => {
  const { world, clock } = boot(on)
  await begin($, clock)
  await call($, world, { tool: 'Bash', command: 'ls', tool_use_id: 'c1' }, 1000)
  await finish($, clock, 1000)
  await begin($, clock, 't2')

  expect(linesIn(await paneOf($))).toEqual(['Turn 0s… · no tools'])
})

test('charts a call another mod refused as failed', async ($, on) => {
  const { world, clock } = boot(on)
  await begin($, clock)
  await call($, world, { tool: 'Bash', command: 'rm -rf build', tool_use_id: 'c1' }, 0, { deny: 'held for approval' })
  await finish($, clock, 1000)

  expect(linesIn(await paneOf($))[0]).toBe('Turn 1s · 1 tool · 1 failed')
})

test('hands the answer of a call on as it came', async ($, on) => {
  const { world, clock } = boot(on)
  await begin($, clock)
  world.answer = { result: { stdout: 'hello' } }

  expect(await $.tool.call({ tool: 'Bash', command: 'echo hello', tool_use_id: 'c1' })).toMatchObject({
    result: { stdout: 'hello' },
  })
})

test('charts the calls of a turn that began before the mod was there', async ($, on) => {
  const { world, clock } = boot(on)
  await call($, world, { tool: 'Bash', command: 'ls', tool_use_id: 'c1' }, 1000)

  expect(linesIn(await paneOf($))[0]).toBe('Turn 1s… · 1 tool')
})

// ── Lent to the Deck ────────────────────────────────────────────────────────

// A stand-in for the Deck: it asks for the timeline on a command, and hosts
// the Waterfall on another, answering with what it got back.
const DECK: Plugin = {
  name: 'deck',
  register(on) {
    on('command.run', { command: 'deck-timeline' }, async $ => ({
      text: JSON.stringify(await $.toolWaterfall.panel({ id: 'timeline', columns: 43, rows: 10 })),
    }))
    on('command.run', { command: 'deck-host' }, async ($, e) => ({
      text: String(await $.toolWaterfall.host({ by: 'deck', isDocked: e.args === 'docked' })),
    }))
  },
}

const deck = async ($: Engine, clock: MockClock, command: string, args = '') => {
  const answer = (await $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 150 } })) as {
    text: string
  }
  await clock.settle()

  return answer
}

test('lends the timeline of the turn through $.toolWaterfall.panel', { plugins: [DECK] }, async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await begin($, clock)
  await call($, world, { tool: 'Read', tool_use_id: 'r1', file_path: 'a.ts' }, 1200)
  const panel = JSON.parse((await deck($, clock, 'deck-timeline')).text) as { title: string; isLive: boolean; rows: unknown[] }

  expect(panel.title).toBe('this turn')
  expect(panel.isLive).toBe(true)
  expect(panel.rows.length).toBeGreaterThan(1)
})

test('a host keeps the pane from opening at the start of a session, even one the person kept', { plugins: [DECK] }, async ($, on) => {
  const { world, clock } = boot(on)
  world.store = { kept: true }
  await deck($, clock, 'deck-host', 'docked')
  await start($, clock)

  expect(world.opened).toEqual([])
})

test('a host closes the pane that is open', { plugins: [DECK] }, async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await ask($)

  expect(world.panes).toEqual(['waterfall'])

  await deck($, clock, 'deck-host', 'docked')

  expect(world.panes).toEqual([])
})

test('/waterfall says where the chart is while a host has it, and opens nothing', { plugins: [DECK] }, async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await deck($, clock, 'deck-host', 'docked')

  expect(await ask($)).toEqual({ text: 'Waterfall is in the Deck: /deck timeline' })
  expect(world.opened).toEqual([])
})
