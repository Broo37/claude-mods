import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, SessionUsage, ToolCallResult } from 'claude-code'

const MINUTE = 60_000

// A Wednesday morning, local time, so the wording does not depend on the time zone.
const NOW = new Date(2026, 9, 8, 8, 45).getTime()

const TURN = { answer: 'done', isAborted: false, turnId: 't1', reason: 'answer' } as const

type Drawn = { type: string; props?: Record<string, unknown>; children?: unknown[] }

const usage = (usd: number, fiveHour: number): SessionUsage => ({
  startedAt: NOW,
  context: { tokens: 1000, window: 200_000, percent: 1 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: fiveHour },
    { kind: 'seven_day', percentUsed: 10 },
  ],
  cost: { usd },
})

// The stubs beneath the mod: they answer in Claude Code's place, from a world the test may change.
const boot = (on: On) => {
  const world = {
    usage: usage(1, 40),
    isUsageDown: false,
    // How long the next tool call takes, and what it answers.
    takes: 0,
    answer: { result: 'ok' } as ToolCallResult,
    redraws: 0,
  }
  const clock = mock.clock(on, { now: NOW })

  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', async () => {
    await clock.advance(world.takes)

    return world.answer
  })
  on('session.usage', () => (world.isUsageDown ? { deny: 'usage is offline' } : { value: world.usage }))
  on('ui.invalidate', () => {
    world.redraws += 1

    return { value: undefined }
  })
  on('ui.render', { component: 'ToolUse' }, ($, e) => ({ type: 'Text', props: {}, children: [`● ${e.props.tool}`] }))
  on('ui.render', { component: 'TurnDuration' }, ($, e) => ({
    type: 'Text',
    props: {},
    children: [`✻ ${e.props.word} for ${e.props.durationMs}`],
  }))

  return { world, clock }
}

const ENGINE_ROW = (tool: string) => ({ type: 'Text', props: {}, children: [`● ${tool}`] })

type World = ReturnType<typeof boot>['world']

// Has Claude call a tool that takes so long and answers so.
const call = async ($: Engine, world: World, id: string, takes: number, answer: ToolCallResult = { result: 'ok' }, agentId?: string) => {
  world.takes = takes
  world.answer = answer
  await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: id, ...(agentId !== undefined && { agentId }) })
}

const rowOf = async ($: Engine, id: string, props: Record<string, unknown> = {}, surface: 'terminal' | 'desktop' = 'terminal') => {
  const ui = await $.ui.mount({
    plugin: 'transcript-makeover',
    component: 'ToolUse',
    requestId: id,
    props: { tool_use_id: id, tool: 'Bash', input: { command: 'ls' }, isRunning: false, isErrored: false, isInterrupted: false, ...props },
    surface,
  })
  const tree = (await ui.drawn()) as Drawn
  await ui.unmount()

  return tree
}

// The badge at the end of a row, if it has one.
const badgeIn = (tree: Drawn) => {
  const holder = tree.type === 'Box' ? ((tree.children ?? []).at(-1) as Drawn | undefined) : undefined
  const badge = (holder?.children ?? [])[0] as Drawn | undefined

  return badge === undefined ? undefined : { text: (badge.children ?? []).join(''), color: badge.props?.color }
}

const lineOf = async ($: Engine, id: string, durationMs: number) => {
  const ui = await $.ui.mount({
    plugin: 'transcript-makeover',
    component: 'TurnDuration',
    requestId: id,
    props: { word: 'Baked', durationMs },
    surface: 'terminal',
  })
  const tree = (await ui.drawn()) as Drawn
  await ui.unmount()

  return tree
}

// A receipt as its texts, in order.
const textsOf = (tree: Drawn) => (tree.children ?? []).map(part => ((part as Drawn).children ?? []).join(''))

const ENGINE_LINE = (durationMs: number) => ({ type: 'Text', props: {}, children: [`✻ Baked for ${durationMs}`] })

// Since 2.1.301 the test engine tags a tree it drew itself with a `part`: the rest is what has to be left alone.
const untagged = (tree?: Drawn) => {
  const { part, ...rest } = (tree ?? {}) as Drawn & { part?: unknown }

  return rest
}

const finish = async ($: Engine, clock: MockClock, durationMs: number, more: Record<string, unknown> = {}) => {
  await $.turn.complete({ ...TURN, durationMs, ...more })
  await clock.settle()
}

test('ends the row of a call that went well with a green check and how long it took', async ($, on) => {
  const { world } = boot(on)
  await call($, world, 'c1', 2238)
  const tree = await rowOf($, 'c1')
  const [row, gap, holder] = (tree.children ?? []) as Drawn[]

  expect(untagged(row)).toEqual(ENGINE_ROW('Bash'))
  expect(gap?.props?.flexGrow).toBe(1)
  expect(badgeIn(tree)).toEqual({ text: '✓ 2.2s', color: 'success' })
  // The row Claude Code draws begins with an empty line: the badge stands on the next, which names the tool.
  expect(tree.props?.alignItems).toBe('flex-start')
  expect(holder?.props?.marginTop).toBe(1)
  expect(holder?.props?.flexShrink).toBe(0)
})

test('ends the row of a call that failed with a red cross', async ($, on) => {
  const { world } = boot(on)
  await call($, world, 'c1', 162, { result: 'no such file', isError: true })

  expect(badgeIn(await rowOf($, 'c1', { isErrored: true }))).toEqual({ text: '✗ 0.2s', color: 'error' })
})

test('counts a call another mod refused as failed', async ($, on) => {
  const { world } = boot(on)
  await call($, world, 'c1', 0, { deny: 'held for approval' })

  expect(badgeIn(await rowOf($, 'c1', { isErrored: true }))).toEqual({ text: '✗ 0.0s', color: 'error' })
})

test('hands the answer of a call on as it came', async ($, on) => {
  const { world } = boot(on)
  world.answer = { result: { stdout: 'hello' } }

  expect(await $.tool.call({ tool: 'Bash', command: 'echo hello', tool_use_id: 'c1' })).toMatchObject({
    result: { stdout: 'hello' },
  })
})

test('leaves a row alone while its call has not ended', async ($, on) => {
  boot(on)

  expect(untagged(await rowOf($, 'c1', { isRunning: true }))).toEqual(ENGINE_ROW('Bash'))
  expect(untagged(await rowOf($, 'c1'))).toEqual(ENGINE_ROW('Bash'))
})

test('marks a failed call it did not time with a cross alone', async ($, on) => {
  boot(on)

  expect(badgeIn(await rowOf($, 'old', { isErrored: true }))).toEqual({ text: '✗', color: 'error' })
})

test('leaves a row alone off the terminal, where it is not laid out the same', async ($, on) => {
  const { world } = boot(on)
  await call($, world, 'c1', 2238)

  expect(untagged(await rowOf($, 'c1', {}, 'desktop'))).toEqual(ENGINE_ROW('Bash'))
})

test('ends a turn with its receipt: time, tools, failures, cost, share of the limit, and when it ended', async ($, on) => {
  const { world, clock } = boot(on)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.settle()
  await call($, world, 'c1', MINUTE)
  await call($, world, 'c2', MINUTE, { result: 'boom', isError: true })
  world.usage = usage(1.42, 43)
  await finish($, clock, 134_000)
  const tree = await lineOf($, 'd1', 134_000)

  expect(textsOf(tree)).toEqual([
    '✻ ',
    '2m 14s',
    ' · ',
    '2 tools',
    ' · ',
    '1 failed',
    ' · ',
    '$ 0.42',
    ' · ',
    '5H +3%',
    ' · ',
    'done 08:47',
  ])
  // An empty row above it, as above the line it stands for.
  expect(tree.props?.marginTop).toBe(1)
})

test('draws each part of the receipt in its own color, the marks between them dim', async ($, on) => {
  const { world, clock } = boot(on)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.settle()
  await call($, world, 'c1', 1000, { result: 'boom', isError: true })
  world.usage = usage(1.42, 43)
  await finish($, clock, 6000)
  const parts = ((await lineOf($, 'd1', 6000)).children ?? []) as Drawn[]
  const looks = parts.map(part => part.props ?? {})

  expect(looks).toEqual([
    { dimColor: true },
    { bold: true },
    { dimColor: true },
    { color: 'suggestion' },
    { dimColor: true },
    { color: 'error' },
    { dimColor: true },
    { color: 'warning' },
    { dimColor: true },
    { color: 'claude' },
    { dimColor: true },
    { dimColor: true },
  ])
})

test('leaves out of the receipt what the turn did not have', async ($, on) => {
  const { clock } = boot(on)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.settle()
  await finish($, clock, 6453)

  expect(textsOf(await lineOf($, 'd1', 6453))).toEqual(['✻ ', '6s', ' · ', 'done 08:45'])
})

test('leaves the line of a turn it did not see as Claude Code draws it', async ($, on) => {
  boot(on)

  expect(untagged(await lineOf($, 'old', 5000))).toEqual(ENGINE_LINE(5000))
})

test('keeps each turn its own receipt, however often its line is drawn', async ($, on) => {
  const { world, clock } = boot(on)
  await $.turn.start({ text: 'one', turnId: 't1' })
  await clock.settle()
  await call($, world, 'c1', 1000)
  await finish($, clock, 3000)
  await $.turn.start({ text: 'two', turnId: 't2' })
  await clock.settle()
  await finish($, clock, 9000, { turnId: 't2' })

  expect(textsOf(await lineOf($, 'd1', 3000))[3]).toBe('1 tool')
  expect(textsOf(await lineOf($, 'd2', 9000))).toEqual(['✻ ', '9s', ' · ', 'done 08:45'])
  expect(textsOf(await lineOf($, 'd1', 3000))[3]).toBe('1 tool')
})

test('gives two turns that lasted as long each its own receipt', async ($, on) => {
  const { world, clock } = boot(on)
  await $.turn.start({ text: 'one', turnId: 't1' })
  await clock.settle()
  await call($, world, 'c1', 1000)
  await finish($, clock, 3000)
  await $.turn.start({ text: 'two', turnId: 't2' })
  await clock.settle()
  await finish($, clock, 3000, { turnId: 't2' })

  expect(textsOf(await lineOf($, 'd1', 3000))[3]).toBe('1 tool')
  expect(textsOf(await lineOf($, 'd2', 3000))[3]).toBe('done 08:45')
})

test("counts neither a subagent's calls nor the end of a subagent's turn", async ($, on) => {
  const { world, clock } = boot(on)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.settle()
  await call($, world, 'c1', 1000)
  await call($, world, 'c2', 1000, { result: 'ok' }, 'a1')
  await finish($, clock, 2000, { turnId: 't9', agentId: 'a1' })

  // The subagent's turn ended; the main one has no receipt yet.
  expect(untagged(await lineOf($, 'sub', 2000))).toEqual(ENGINE_LINE(2000))

  await finish($, clock, 8000)

  expect(textsOf(await lineOf($, 'd1', 8000))[3]).toBe('1 tool')
})

// A question put to the person, by Claude or by a mod such as one that holds risky commands.
const question = ($: Engine, world: World, id: string, takes: number, answer: ToolCallResult = { result: 'ok' }) => {
  world.takes = takes
  world.answer = answer

  return $.tool.call({
    tool: 'AskUserQuestion',
    tool_use_id: id,
    questions: [{ question: 'Run it?', header: 'Risky', multiSelect: false, options: [{ label: 'Run it', description: '' }, { label: 'Block it', description: '' }] }],
  })
}

test('does not count a question put to the person among the tools of the turn, nor a dismissed one as a failure', async ($, on) => {
  const { world, clock } = boot(on)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.settle()
  await call($, world, 'c1', 1000)
  await question($, world, 'q1', 3000)
  await question($, world, 'q2', 3000, { result: 'dismissed', isError: true })
  await finish($, clock, 8000)

  // Seen on a real turn: a held command's question made three calls read "4 tools".
  expect(textsOf(await lineOf($, 'd1', 8000))).toEqual(['✻ ', '8s', ' · ', '1 tool', ' · ', 'done 08:45'])
})

test('has the line drawn again once the receipt is ready', async ($, on) => {
  const { world, clock } = boot(on)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.settle()
  const before = world.redraws
  await finish($, clock, 3000)

  expect(world.redraws).toBe(before + 1)
})

test('still writes the time and the tools when the usage cannot be read', async ($, on) => {
  const { world, clock } = boot(on)
  world.isUsageDown = true
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.settle()
  await call($, world, 'c1', 1000)
  await finish($, clock, 3000)

  expect(textsOf(await lineOf($, 'd1', 3000))).toEqual(['✻ ', '3s', ' · ', '1 tool', ' · ', 'done 08:45'])
})

test('writes a receipt for a turn that began before the mod was there, without what it cannot know', async ($, on) => {
  const { clock } = boot(on)
  await finish($, clock, 3000)

  expect(textsOf(await lineOf($, 'd1', 3000))).toEqual(['✻ ', '3s', ' · ', 'done 08:45'])
})

// ── After a background helper reports back ──────────────────────────────────

test("takes the receipt of the turn that just ended when its line counts from the prompt, as after a helper's report", async ($, on) => {
  const { world, clock } = boot(on)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.settle()
  await finish($, clock, 8133)
  await lineOf($, 'd1', 8133)
  await clock.advance(12_000)
  await $.turn.start({ text: '<task-notification>', turnId: 't2' })
  await clock.settle()
  await call($, world, 'c1', 1000)
  await finish($, clock, 4920, { turnId: 't2' })
  const tree = await lineOf($, 'd2', 25_292)

  expect(untagged(tree)).not.toEqual(ENGINE_LINE(25_292))
  expect(textsOf(tree)[3]).toBe('1 tool')
})

test('leaves a line the engine draws long after a turn ended as it is, when its time matches no receipt', async ($, on) => {
  const { clock } = boot(on)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.settle()
  await finish($, clock, 4920)
  await clock.advance(MINUTE)

  expect(untagged(await lineOf($, 'old', 25_292))).toEqual(ENGINE_LINE(25_292))
})

test("does not take a helper's turn that starts after the main turn ended for a main turn", async ($, on) => {
  const { world, clock } = boot(on)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.settle()
  await finish($, clock, 8000)
  await lineOf($, 'd1', 8000)
  // A helper still at work once the main turn has ended, spending as it goes.
  world.usage = usage(1, 40)
  await $.turn.start({ text: 'look', turnId: 'h1', agentId: 'a1' })
  await clock.settle()
  world.usage = usage(2, 45)
  await finish($, clock, 5000, { turnId: 'h1', agentId: 'a1' })
  // Its report wakes the main loop for one more turn.
  await $.turn.start({ text: '<task-notification>', turnId: 't2' })
  await clock.settle()
  world.usage = usage(2.5, 46)
  await finish($, clock, 3000, { turnId: 't2' })

  expect(textsOf(await lineOf($, 'd2', 3000))[3]).toBe('$ 0.50')
})
