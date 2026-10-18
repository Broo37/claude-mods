import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, ToolCallResult } from 'claude-code'

const NOW = new Date(2026, 9, 18, 9, 30).getTime()

// What the stubs draw in the engine's place.
const ENGINE_ROW = (tool: string) => `● ${tool}`
const ENGINE_RESULT = '⎿ result'

const SURFACES = ['terminal', 'desktop'] as const

type Surface = (typeof SURFACES)[number]

type Drawn = { type: string; props?: Record<string, unknown>; children?: unknown[] }

// The stubs beneath the mod: they answer in Claude Code's place.
const boot = (on: On) => {
  const world = {
    answer: { result: 'a.txt' } as ToolCallResult,
    // A gate the next tool call waits at, when one is set.
    gate: null as Promise<void> | null,
  }
  const clock = mock.clock(on, { now: NOW })

  on('tool.call', async () => {
    if (world.gate !== null) {
      await world.gate
    }

    return world.answer
  })
  on('ui.render', { component: 'ToolUse' }, ($, e) => ({ type: 'Text', props: {}, children: [ENGINE_ROW(e.props.tool)] }))
  on('ui.render', { component: 'ToolResult' }, () => ({ type: 'Text', props: {}, children: [ENGINE_RESULT] }))
  on('ui.render', { component: 'ToolGroup' }, ($, e) => ({ type: 'Text', props: {}, children: [`group expanded: ${e.props.isExpanded}`] }))

  return { world, clock }
}

const gated = () => {
  let open = () => {}
  const gate = new Promise<void>(resolve => {
    open = resolve
  })

  return { gate, open }
}

const isDrawn = (node: unknown): node is Drawn => typeof node === 'object' && node !== null

// What a tree shows: a plain Button written between ‹ and ›.
const textOf = (node: unknown): string => {
  if (!isDrawn(node)) {
    return typeof node === 'string' ? node : ''
  }

  if (node.type === 'Button') {
    const label = node.props?.label === undefined ? (node.children ?? []).map(textOf).join('') : String(node.props.label)

    return node.props?.plain === true ? `‹${label}›` : `⟦${label}⟧`
  }

  return (node.children ?? []).map(textOf).join('')
}

// A column's lines, or the one line a tree is.
const linesOf = (tree: Drawn) =>
  tree.type === 'Box' && tree.props?.flexDirection === 'column' ? (tree.children ?? []).map(textOf) : [textOf(tree)].filter(line => line !== '')

const LISTED = { tool: 'Bash', input: { command: 'ls -la', description: 'List the files' }, isRunning: false, isErrored: false, isInterrupted: false }

const mounted = ($: Engine, component: 'ToolUse' | 'ToolResult' | 'ToolGroup', id: string, props: Record<string, unknown>, surface: Surface) =>
  $.ui.mount({ plugin: 'fold-view', component, requestId: id, props, surface } as Parameters<Engine['ui']['mount']>[0])

// The lines a call's row draws.
const rowOf = async ($: Engine, id = 'c1', more: Record<string, unknown> = {}, surface: Surface = 'terminal') => {
  const ui = await mounted($, 'ToolUse', id, { tool_use_id: id, ...LISTED, ...more }, surface)
  const tree = (await ui.drawn()) as Drawn
  await ui.unmount()

  return linesOf(tree)
}

const resultOf = async ($: Engine, id = 'c1', surface: Surface = 'terminal') => {
  const ui = await mounted($, 'ToolResult', id, { tool_use_id: id, tool: 'Bash', output: { stdout: 'a.txt' }, isErrored: false }, surface)
  const tree = (await ui.drawn()) as Drawn
  await ui.unmount()

  return textOf(tree)
}

// The person clicks a call's line.
const press = async ($: Engine, id = 'c1', surface: Surface = 'terminal') => {
  const ui = await mounted($, 'ToolUse', id, { tool_use_id: id, ...LISTED }, surface)
  await ui.press({ key: `fold-${id}` })
  await ui.unmount()
}

// Has Claude call a tool, which waits at the world's gate when one is set.
const call = ($: Engine, id = 'c1') =>
  $.tool.call({ tool_use_id: id, tool: 'Bash', command: 'ls -la', description: 'List the files' } as Parameters<Engine['tool']['call']>[0])

for (const surface of SURFACES) {
  test(`folds a tool call's row to one line in plain words on the ${surface}`, async ($, on) => {
    boot(on)

    expect(await rowOf($, 'c1', {}, surface)).toEqual(['‹▸ ✓ Ran: List the files›'])
  })

  test(`opens a row at a click to the row Claude Code draws, and folds it at the next, on the ${surface}`, async ($, on) => {
    boot(on)
    await press($, 'c1', surface)

    expect(await rowOf($, 'c1', {}, surface)).toEqual(['‹▾ ✓ Ran: List the files›', ENGINE_ROW('Bash')])

    await press($, 'c1', surface)

    expect(await rowOf($, 'c1', {}, surface)).toEqual(['‹▸ ✓ Ran: List the files›'])
  })
}

test('leaves a blank line after an opened row, so the next folded line stands apart', async ($, on) => {
  boot(on)
  await press($)
  const ui = await mounted($, 'ToolUse', 'c1', { tool_use_id: 'c1', ...LISTED }, 'terminal')
  const tree = (await ui.drawn()) as Drawn
  await ui.unmount()

  expect(tree.props?.marginBottom).toBe(1)
})

test('shows the result under a row only while the row is open', async ($, on) => {
  boot(on)

  expect(await resultOf($)).toBe('')

  await press($)

  expect(await resultOf($)).toBe(ENGINE_RESULT)

  await press($)

  expect(await resultOf($)).toBe('')
})

test('opens one row and leaves the others folded', async ($, on) => {
  boot(on)
  await press($, 'c1')

  expect(await rowOf($, 'c1')).toHaveLength(2)
  expect(await rowOf($, 'c2')).toEqual(['‹▸ ✓ Ran: List the files›'])
  expect(await resultOf($, 'c2')).toBe('')
})

test("unfolds the transcript's count line, so that each call is a row of its own", async ($, on) => {
  boot(on)
  const ui = await mounted($, 'ToolGroup', 'g1', { calls: [], isActive: false, isExpanded: false }, 'terminal')
  const tree = await ui.drawn()
  await ui.unmount()

  expect(textOf(tree)).toBe('group expanded: true')
})

test('says how long a slow call took', async ($, on) => {
  const { world, clock } = boot(on)
  const { gate, open } = gated()
  world.gate = gate
  const pending = call($)
  await clock.advance(4_000)
  open()
  await pending

  expect(await rowOf($)).toEqual(['‹▸ ✓ Ran: List the files · 4s›'])
})

test('says nothing of the time of a quick call', async ($, on) => {
  const { world, clock } = boot(on)
  const { gate, open } = gated()
  world.gate = gate
  const pending = call($)
  await clock.advance(1_000)
  open()
  await pending

  expect(await rowOf($)).toEqual(['‹▸ ✓ Ran: List the files›'])
})

test('times a call whose row shows it ended before its hook heard back, and keeps that time', async ($, on) => {
  const { world, clock } = boot(on)
  const { gate, open } = gated()
  world.gate = gate
  const pending = call($)
  await clock.advance(5_000)

  expect(await rowOf($, 'c1', { isRunning: true })).toEqual(['‹▸ ◌ Ran: List the files · running›'])
  expect(await rowOf($)).toEqual(['‹▸ ✓ Ran: List the files · 5s›'])

  await clock.advance(2_000)
  open()
  await pending

  expect(await rowOf($)).toEqual(['‹▸ ✓ Ran: List the files · 5s›'])
})

test('marks a call that failed, and one that was stopped', async ($, on) => {
  boot(on)

  expect(await rowOf($, 'c1', { isErrored: true })).toEqual(['‹▸ ✗ Ran: List the files · failed›'])
  expect(await rowOf($, 'c1', { isErrored: true, isInterrupted: true })).toEqual(['‹▸ ■ Ran: List the files · stopped›'])
})

test('leaves what a tool answers as it was', async ($, on) => {
  const { world } = boot(on)

  expect(await call($)).toEqual(world.answer)
})
