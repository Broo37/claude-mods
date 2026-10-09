import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { ModelCompleteInput, On, ToolCallResult } from 'claude-code'

// A Thursday morning, local time.
const NOW = new Date(2026, 9, 8, 9, 30).getTime()

const PLAN_STEPS = 'mcp__clean-view__plan_steps'
const REPORT_PROGRESS = 'mcp__clean-view__report_progress'

const REQUEST = 'Build me a landing page for my bakery'

const PLAN = ['Read your brand notes', 'Build the pricing section', 'Add the contact form', 'Polish the footer']

const ON = '⟦● Clean View: ON⟧'
const OFF = '⟦○ Clean View: OFF⟧'

// What the stubs draw in the engine's place. The band's is the engine's own
// drawing, as it is where no other mod draws there; a test of the tabs puts
// another mod's band in its place.
const ENGINE_BAND = 'engine band'
const ENGINE_ROW = (tool: string) => `● ${tool}`
const OWN_BAND = { type: 'engine', ref: 1 }
const STATUS_BAND = { type: 'Text', props: {}, children: ['status band'] }

const NO_TOKENS = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

type Drawn = { type: string; props?: Record<string, unknown>; children?: unknown[] }

type Surface = 'terminal' | 'desktop'

const SURFACES = ['terminal', 'desktop'] as const

// The stubs beneath the mod: they answer in Claude Code's place, from a world the test may change.
const boot = (on: On) => {
  const world = {
    // What a tool answers, by its name, and what any other answers.
    answers: {} as Record<string, ToolCallResult>,
    answer: { result: 'ok' } as ToolCallResult,
    // A gate the next tool call waits at, when one is set.
    gate: null as Promise<void> | null,
    // The tools that ran, in order: one the mod refused never gets here.
    ran: [] as string[],
    tools: [] as { name: string; isDeferred?: boolean; inputSchema?: Record<string, unknown> }[],
    commands: [] as string[],
    store: {} as Record<string, unknown>,
    toasts: [] as string[],
    // What the naming model was asked, the titles it answers in turn, and gates its answers wait at.
    naming: [] as ModelCompleteInput[],
    titles: ['Build bakery landing page'],
    namerGates: [] as (Promise<void> | null)[],
    isNamerDown: false,
    // How often the frame counter was written.
    ticks: 0,
    // What is in the band beneath the mod.
    band: OWN_BAND as Drawn | typeof OWN_BAND,
    // Where the session draws: nowhere in a plain `claude -p` run.
    surfaces: ['terminal'] as ('terminal' | 'desktop')[],
  }
  const clock = mock.clock(on, { now: NOW })

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.surfaces', () => ({ value: world.surfaces }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', async ($, e) => {
    world.ran.push(e.tool)

    if (world.gate !== null) {
      await world.gate
    }

    return world.answers[e.tool] ?? world.answer
  })
  on('tool.register', ($, e) => {
    world.tools.push(e)

    return { value: { tool: `mcp__clean-view__${e.name}` } }
  })
  on('command.register', ($, e) => {
    world.commands.push(e.name)

    return { value: { command: e.name } }
  })
  on('command.run', () => ({ text: 'no such command' }))
  on('store.get', ($, e) => ({ value: world.store[e.key] }))
  on('store.set', ($, e) => {
    world.store[e.key] = e.value

    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    world.toasts.push(e.text)

    return { value: undefined }
  })
  on('model.complete', async ($, e) => {
    const asked = world.naming.push(e) - 1
    const gate = world.namerGates[asked]

    if (gate !== undefined && gate !== null) {
      await gate
    }

    return world.isNamerDown
      ? { value: { isAnswered: false as const, reason: 'api-error' as const, status: 529, error: 'overloaded' as const, usage: NO_TOKENS } }
      : { value: { isAnswered: true as const, text: world.titles[asked] ?? world.titles.at(-1) ?? '', usage: NO_TOKENS } }
  })
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude.', scope: 'shared' }] }))
  on('classic.Notification', () => ({}))
  on('classic.PermissionRequest', () => ({}))
  on('classic.StopFailure', () => ({}))
  on('state.set', ($, e, next) => {
    if (e.key === 'tick') {
      world.ticks += 1
    }

    return next(e)
  })
  on('ui.render', { component: 'AbovePrompt' }, () => world.band as never)
  on('ui.render', { component: 'ToolUse' }, ($, e) => ({ type: 'Text', props: {}, children: [ENGINE_ROW(e.props.tool)] }))
  on('ui.render', { component: 'ToolResult' }, () => ({ type: 'Text', props: {}, children: ['⎿ result'] }))
  on('ui.render', { component: 'ToolGroup' }, () => ({ type: 'Text', props: {}, children: ['Read 3 files'] }))
  on('ui.render', { component: 'ToolProgress' }, ($, e) => ({ type: 'Text', props: {}, children: [e.props.hint] }))

  return { world, clock }
}

type World = ReturnType<typeof boot>['world']

const start = async ($: Engine, clock: MockClock) => {
  await $.session.start({ cwd: 'C:\\work', surface: 'terminal', isInteractive: true })
  await clock.settle()
}

// The person sends a prompt: a turn starts.
const ask = async ($: Engine, clock: MockClock, text = REQUEST, turnId = 't1') => {
  await $.turn.start({ text, turnId })
  await clock.settle()
}

const finish = async ($: Engine, clock: MockClock, more: Record<string, unknown> = {}) => {
  await $.turn.complete({ answer: 'Here you go.', isAborted: false, turnId: 't1', reason: 'answer', durationMs: 1000, ...more } as Parameters<
    Engine['turn']['complete']
  >[0])
  await clock.settle()
}

// Has Claude call a tool.
const call = ($: Engine, args: Record<string, unknown> & { tool: string }) =>
  $.tool.call({ tool_use_id: `id-${args.tool}`, ...args } as Parameters<Engine['tool']['call']>[0])

const plan = ($: Engine, steps: unknown = PLAN) => call($, { tool: PLAN_STEPS, steps })

const report = ($: Engine, task: string, percent: number) => call($, { tool: REPORT_PROGRESS, task, percent })

const bash = ($: Engine, more: Record<string, unknown> = {}) => call($, { tool: 'Bash', command: 'ls', ...more })

const simple = ($: Engine, args = '') =>
  $.command.run({ command: 'simple', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 150 } })

const isDrawn = (node: unknown): node is Drawn => typeof node === 'object' && node !== null

// What a tree shows: a Button written between ⟦ and ⟧, a plain one between ‹ and ›,
// and the engine's own drawing by name.
const textOf = (node: unknown): string => {
  if (!isDrawn(node)) {
    return typeof node === 'string' ? node : ''
  }

  if (node.type === 'engine') {
    return ENGINE_BAND
  }

  if (node.type === 'Button') {
    return node.props?.plain === true ? `‹${String(node.props.label)}›` : `⟦${String(node.props?.label)}⟧`
  }

  return (node.children ?? []).map(textOf).join('')
}

const BAND = {
  plugin: 'clean-view',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

const bandTree = async ($: Engine, surface: Surface = 'terminal', props: Record<string, unknown> = {}) => {
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, ...props }, surface })
  const tree = (await ui.drawn()) as Drawn
  await ui.unmount()

  return tree
}

// The band as lines of text, without what the engine draws beneath the mod's own.
const bandOf = async ($: Engine, surface: Surface = 'terminal', props: Record<string, unknown> = {}) => {
  const lines = ((await bandTree($, surface, props)).children ?? []).map(textOf)

  expect(lines.at(-1)).toBe(ENGINE_BAND)

  return lines.slice(0, -1)
}

const headerOf = async ($: Engine) => (await bandOf($))[0]

const rowOf = async ($: Engine, component: 'ToolUse' | 'ToolResult' | 'ToolGroup', surface: Surface = 'terminal') => {
  const props = {
    ToolUse: { tool_use_id: 'c1', tool: 'Bash', input: { command: 'ls' }, isRunning: false, isErrored: false, isInterrupted: false },
    ToolResult: { tool_use_id: 'c1', tool: 'Bash', output: { stdout: 'a.txt' }, isErrored: false },
    ToolGroup: { calls: [], isActive: false, isExpanded: false },
  }[component]
  const ui = await $.ui.mount({ plugin: 'clean-view', component, requestId: 'c1', props, surface } as Parameters<Engine['ui']['mount']>[0])
  const tree = (await ui.drawn()) as Drawn
  await ui.unmount()

  return textOf(tree)
}

const ROWS = {
  planned: [
    `${'▶ Read your brand notes'.padEnd(29)}███░░░░░░░  Working`,
    `${'○ Build the pricing section'.padEnd(29)}░░░░░░░░░░  Next`,
    `${'○ Add the contact form'.padEnd(29)}░░░░░░░░░░  Up next`,
    `${'○ Polish the footer'.padEnd(29)}░░░░░░░░░░  Up next`,
  ],
  placeholders: [`${'▶ Understand your request'.padEnd(27)}███░░░░░░░  Working`, `${'○ Plan the steps'.padEnd(27)}░░░░░░░░░░  Next`],
}

// A gate and what opens it.
const gated = () => {
  let open = () => {}
  const gate = new Promise<void>(resolve => {
    open = resolve
  })

  return { gate, open }
}

// ── The two tools ───────────────────────────────────────────────────────────

test('offers Claude its two tools from the start of the session, their schemas in the prompt', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)

  expect(world.tools.map(tool => tool.name)).toEqual(['plan_steps', 'report_progress'])
  expect(world.tools.every(tool => tool.isDeferred === false)).toBe(true)
  expect(world.tools[0]?.inputSchema).toMatchObject({ type: 'object', required: ['steps'] })
  expect(world.tools[1]?.inputSchema).toMatchObject({ type: 'object', required: ['task', 'percent'] })
})

test('lays out the plan Claude gives, the first step started, and says so', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await ask($, clock)

  expect(await plan($)).toMatchObject({ result: 'Planned 4 steps. The first one has started.' })
  expect(await bandOf($)).toEqual([`Build bakery landing page · 0s${ON}`, ...ROWS.planned])
})

test('checks off step one and starts step two when progress reaches 100', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  await plan($)

  expect(await report($, 'Read your brand notes', 100)).toMatchObject({ result: 'Progress noted: 100%.' })
  expect((await bandOf($)).slice(1, 3)).toEqual([
    `${'✓ Read your brand notes'.padEnd(29)}██████████  Done`,
    `${'▶ Build the pricing section'.padEnd(29)}███░░░░░░░  Working`,
  ])
})

test('says back the percent it noted, within 0 to 100', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  await plan($)

  expect(await report($, 'Read your brand notes', 61.4)).toMatchObject({ result: 'Progress noted: 61%.' })
  expect(await report($, 'Read your brand notes', 250)).toMatchObject({ result: 'Progress noted: 100%.' })
})

test('asks for the steps again when a plan names none', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await ask($, clock)

  expect(await plan($, 'everything')).toMatchObject({ result: 'Give the steps as a list of 2 to 8 short names.' })
  expect((await bandOf($)).slice(1)).toEqual(ROWS.placeholders)
})

test("answers a subagent's plan without touching the checklist", async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  await plan($)
  await call($, { tool: PLAN_STEPS, steps: ['Look around', 'Report back'], agentId: 'a1' })

  expect((await bandOf($)).slice(1)).toEqual(ROWS.planned)
})

// ── Plan first ──────────────────────────────────────────────────────────────

test('refuses any other tool until a plan exists, and lets it through after', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  const refused = await bash($)

  expect(refused.deny).toMatch(/mcp__clean-view__plan_steps/)
  expect(world.ran).toEqual([])

  await plan($)

  expect(await bash($)).toMatchObject({ result: 'ok' })
  expect(world.ran).toEqual(['Bash'])
})

test('lets the to-do tools, the tool search and a question through before a plan', async ($, on) => {
  const { world, clock } = boot(on)
  world.answers.TaskCreate = { result: { task: { id: '1', subject: 'Read your brand notes' } } }
  await start($, clock)
  await ask($, clock)

  for (const tool of ['ToolSearch', 'AskUserQuestion', 'TaskCreate', 'TaskUpdate', 'TodoWrite']) {
    expect((await call($, { tool, todos: [], questions: [], subject: 'Read your brand notes', taskId: '1' })).deny).toBeUndefined()
  }
})

test('takes a to-do list for the plan', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  await call($, { tool: 'TodoWrite', todos: [{ content: 'Read your brand notes', status: 'in_progress', activeForm: 'Reading' }] })

  expect(await bash($)).toMatchObject({ result: 'ok' })
})

test("never refuses a subagent's tool", async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await ask($, clock)

  expect(await bash($, { agentId: 'a1' })).toMatchObject({ result: 'ok' })
})

test('refuses nothing while Clean View is off', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await simple($, 'off')
  await ask($, clock)

  expect(await bash($)).toMatchObject({ result: 'ok' })
})

// ── What Claude is told ─────────────────────────────────────────────────────

const compose = ($: Engine, surfaces: ('terminal' | 'desktop')[] = ['terminal']) =>
  $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces, tools: [], outputStyle: null, traits: [] })

test('tells Claude how to name and report its steps while Clean View is on', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const { sections } = await compose($)
  const added = sections.at(-1)

  expect(sections).toHaveLength(2)
  expect(added).toMatchObject({ id: 'clean-view:steps', scope: 'session' })
  expect(added?.text).toMatch(/mcp__clean-view__plan_steps/)
  expect(added?.text).toMatch(/mcp__clean-view__report_progress/)
  expect(added?.text).toMatch(/under 40 characters/)
  expect(added?.text).toMatch(/ToolSearch/)
  expect(added?.text).toMatch(/TodoWrite or TaskCreate/)
})

test('tells Claude nothing while Clean View is off', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await simple($, 'off')

  expect((await compose($)).sections.map(section => section.id)).toEqual(['intro'])
})

// ── A job from what Claude already does ─────────────────────────────────────

test('starts a job with placeholder steps the moment a prompt is sent', async ($, on) => {
  const { world, clock } = boot(on)
  const namer = gated()
  world.namerGates = [namer.gate]
  await start($, clock)
  await ask($, clock)

  // The name has not come back yet: the header says the request in the person's own words.
  expect(await bandOf($)).toEqual([`Build me a landing page for my bakery · 0s${ON}`, ...ROWS.placeholders])

  namer.open()
  await clock.settle()
})

test('asks a small model for a short name, with low effort, and swaps it into the header', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await ask($, clock)

  expect(world.naming).toHaveLength(1)
  expect(world.naming[0]).toMatchObject({ model: 'haiku', effort: 'low' })
  expect(world.naming[0]?.prompt).toMatch(/Build me a landing page for my bakery/)
  expect(await headerOf($)).toBe(`Build bakery landing page · 0s${ON}`)
})

test('ignores a name that comes back after a newer job has started', async ($, on) => {
  const { world, clock } = boot(on)
  const slow = gated()
  world.namerGates = [slow.gate, null]
  world.titles = ['Build bakery landing page', 'Write the menu']
  await start($, clock)
  await ask($, clock)
  await clock.advance(3000)
  await ask($, clock, 'Now write the menu for it', 't2')
  slow.open()
  await clock.settle()

  expect(await headerOf($)).toBe(`Write the menu · 0s${ON}`)
})

test('keeps the header it had when the naming model does not answer', async ($, on) => {
  const { world, clock } = boot(on)
  world.isNamerDown = true
  await start($, clock)
  await ask($, clock)

  expect(await headerOf($)).toBe(`Build me a landing page for my bakery · 0s${ON}`)
})

test('starts no job for a slash command, or for a turn nobody typed', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await ask($, clock, '/compact')
  await ask($, clock, '', 't2')

  expect(await bandOf($)).toEqual([ON])
  expect(world.naming).toEqual([])
})

test('says how long the job has been running', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  await clock.advance(72_000)

  expect(await headerOf($)).toBe(`Build bakery landing page · 1m 12s${ON}`)
})

for (const surface of SURFACES) {
  test(`draws a to-do list and a 60% report as done, current, next and later rows on the ${surface}`, async ($, on) => {
    const { clock } = boot(on)
    await start($, clock)
    await ask($, clock)
    await call($, {
      tool: 'TodoWrite',
      todos: [
        { content: 'Read your brand notes', status: 'completed', activeForm: 'Reading' },
        { content: 'Build the pricing section', status: 'in_progress', activeForm: 'Building' },
        { content: 'Add the contact form', status: 'pending', activeForm: 'Adding' },
        { content: 'Polish the footer', status: 'pending', activeForm: 'Polishing' },
      ],
    })
    await report($, 'Build the pricing section', 60)

    expect((await bandOf($, surface)).slice(1)).toEqual([
      `${'✓ Read your brand notes'.padEnd(29)}██████████  Done`,
      `${'▶ Build the pricing section'.padEnd(29)}██████░░░░  60%`,
      `${'○ Add the contact form'.padEnd(29)}░░░░░░░░░░  Next`,
      `${'○ Polish the footer'.padEnd(29)}░░░░░░░░░░  Up next`,
    ])
  })
}

test('follows tasks as Claude creates, starts and finishes them', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  world.answers.TaskCreate = { result: { task: { id: '1', subject: 'Read your brand notes' } } }
  await call($, { tool: 'TaskCreate', subject: 'Read your brand notes', description: 'Read them' })
  world.answers.TaskCreate = { result: { task: { id: '2', subject: 'Add the contact form' } } }
  await call($, { tool: 'TaskCreate', subject: 'Add the contact form', description: 'Add it' })
  await call($, { tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  await call($, { tool: 'TaskUpdate', taskId: '2', status: 'in_progress' })

  expect((await bandOf($)).slice(1)).toEqual([
    `${'✓ Read your brand notes'.padEnd(25)}██████████  Done`,
    `${'▶ Add the contact form'.padEnd(25)}███░░░░░░░  Working`,
  ])
})

test('leaves the checklist as it was when a to-do tool fails', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  world.answers.TodoWrite = { isError: true, result: 'bad input', text: 'bad input' }
  await call($, { tool: 'TodoWrite', todos: [{ content: 'Read your brand notes', status: 'pending', activeForm: 'Reading' }] })

  expect((await bandOf($)).slice(1)).toEqual(ROWS.placeholders)
})

// ── Needs you ───────────────────────────────────────────────────────────────

test('shows Needs you when a permission prompt opens, and pauses the current step', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  await plan($)
  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })
  const [header, current] = await bandOf($)

  expect(header).toBe(` Needs you  Claude needs your OK to continue${ON}`)
  expect(current?.startsWith('‖ Read your brand notes')).toBe(true)
})

test('shows Needs you the moment permission is asked for', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  await plan($)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'npm install' } })

  expect(await headerOf($)).toBe(` Needs you  Claude needs your OK to continue${ON}`)
})

test('says a question waits, not a permission, when the dialog that opens is a question', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  await plan($)
  // Claude Code asks permission for the question tool itself as its dialog opens.
  await $.classic.PermissionRequest({ tool_name: 'AskUserQuestion', tool_input: { questions: [] } })

  expect(await headerOf($)).toBe(` Needs you  Claude has a question for you${ON}`)
})

test('takes no other notice for a call on the person', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  await plan($)
  await $.classic.Notification({ message: 'Claude is waiting for your input', notification_type: 'idle_prompt' })

  expect(await headerOf($)).toBe(`Build bakery landing page · 0s${ON}`)
})

test('goes back to work once the next tool runs', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  await plan($)
  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })
  await bash($)

  expect(await headerOf($)).toBe(`Build bakery landing page · 0s${ON}`)
})

test('shows Needs you while a question waits for its answer, and goes on after it', async ($, on) => {
  const { world, clock } = boot(on)
  const question = gated()
  await start($, clock)
  await ask($, clock)
  await plan($)
  world.gate = question.gate
  const asking = call($, { tool: 'AskUserQuestion', questions: [] })
  await clock.settle()

  expect(await headerOf($)).toBe(` Needs you  Claude has a question for you${ON}`)

  question.open()
  await asking

  expect(await headerOf($)).toBe(`Build bakery landing page · 0s${ON}`)
})

// ── Stuck ───────────────────────────────────────────────────────────────────

test('is stuck when the person said no to a step', async ($, on) => {
  const { world, clock } = boot(on)
  const dialog = gated()
  await start($, clock)
  await ask($, clock)
  await plan($)
  world.gate = dialog.gate
  world.answer = { isError: true, result: 'rejected', text: 'rejected' }
  const running = bash($)
  await clock.settle()
  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })
  dialog.open()
  await running

  expect(await headerOf($)).toBe(`⚠ Stuck: you said no to a step, so Claude paused${ON}`)
})

test("is stuck when the tool's answer says the person turned it down", async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  await plan($)
  world.answer = { isError: true, result: 'no', text: "The user doesn't want to proceed with this tool use. The tool use was rejected." }
  await bash($)

  expect(await headerOf($)).toBe(`⚠ Stuck: you said no to a step, so Claude paused${ON}`)
})

test('is stuck when a question a step raised was answered with a refusal of the step', async ($, on) => {
  const { world, clock } = boot(on)
  const held = gated()
  await start($, clock)
  await ask($, clock)
  await plan($)
  // A guard holds the command, asks the person, and refuses it on their word.
  world.gate = held.gate
  world.answers.Bash = { deny: 'blocked on your word' }
  const running = bash($)
  await clock.settle()
  world.gate = null
  await call($, { tool: 'AskUserQuestion', questions: [] })
  held.open()
  await running

  expect(await headerOf($)).toBe(`⚠ Stuck: you said no to a step, so Claude paused${ON}`)
})

test('is stuck after three failed tool calls in a row, and moves again on a success', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  await plan($)
  world.answer = { isError: true, result: 'exit 1', text: 'exit 1' }
  await bash($)
  await bash($)

  expect(await headerOf($)).toBe(`Build bakery landing page · 0s${ON}`)

  await bash($)

  expect(await headerOf($)).toBe(`⚠ Stuck: a step keeps failing, Claude is trying another way${ON}`)

  world.answer = { result: 'ok' }
  await bash($)

  expect(await headerOf($)).toBe(`Build bakery landing page · 0s${ON}`)
})

test('counts only failures in a row', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  await plan($)

  for (const answer of [{ isError: true, result: 'x' }, { isError: true, result: 'x' }, { result: 'ok' }, { isError: true, result: 'x' }] as ToolCallResult[]) {
    world.answer = answer
    await bash($)
  }

  expect(await headerOf($)).toBe(`Build bakery landing page · 0s${ON}`)
})

// ── The end of a turn ───────────────────────────────────────────────────────

test('says an API error that ended the turn in one calm sentence', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  await plan($)
  await finish($, clock, { reason: 'error', answer: 'API Error: Repeated 529 Overloaded errors' })

  expect(await headerOf($)).toBe(`⚠ Stuck: Claude's servers are busy, try again in a minute${ON}`)
})

test('says plainly that Claude could not help when it refuses', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  await finish($, clock, { reason: 'refusal', answer: '', refusal: { category: null, explanation: null } })

  expect(await headerOf($)).toBe(`⚠ Stuck: Claude couldn't help with that request${ON}`)
})

test('shows Stopped when the person presses Esc', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  await plan($)
  await finish($, clock, { reason: 'aborted', isAborted: true, answer: '' })

  expect(await headerOf($)).toBe(`■ Stopped · Build bakery landing page · you pressed Esc${ON}`)
})

test('waits for a reply when the turn ends with steps left', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  await plan($)
  await report($, 'Read your brand notes', 100)
  await finish($, clock)

  expect(await headerOf($)).toBe(` Needs you  Claude is waiting for your reply${ON}`)
})

test('names the job after what went before when the person replies to a job that waits', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  await plan($)
  await finish($, clock)
  await ask($, clock, 'yes', 't2')

  expect(world.naming[1]?.prompt).toMatch(/Build bakery landing page/)
  expect(world.naming[1]?.prompt).toMatch(/yes/)
})

test('shows All done with how long it took, then shrinks to one line after five seconds', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  await plan($)
  await report($, 'Polish the footer', 100)
  await clock.advance(134_000)
  await finish($, clock)

  expect(await bandOf($)).toHaveLength(5)
  expect(await headerOf($)).toBe(`✓ All done · Build bakery landing page · took 2m 14s${ON}`)

  await clock.advance(4900)

  expect(await bandOf($)).toHaveLength(5)

  await clock.advance(200)

  expect(await bandOf($)).toEqual([`✓ All done · Build bakery landing page · took 2m 14s${ON}`])
})

test('is all done after a quick answer that needed no plan', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await ask($, clock, 'What is a landing page?')
  await finish($, clock)

  expect(await headerOf($)).toMatch(/^✓ All done · /)
})

test("leaves the job alone when a subagent's turn ends", async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  await plan($)
  await finish($, clock, { agentId: 'a1' })

  expect(await headerOf($)).toBe(`Build bakery landing page · 0s${ON}`)
})

// ── The technical rows ──────────────────────────────────────────────────────

for (const surface of SURFACES) {
  test(`hides tool calls, their results and their groups on the ${surface} while it is on`, async ($, on) => {
    const { clock } = boot(on)
    await start($, clock)

    expect(await rowOf($, 'ToolUse', surface)).toBe('')
    expect(await rowOf($, 'ToolResult', surface)).toBe('')
    expect(await rowOf($, 'ToolGroup', surface)).toBe('')
  })
}

test('draws them as the engine does while it is off', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await simple($, 'off')

  expect(await rowOf($, 'ToolUse')).toBe(ENGINE_ROW('Bash'))
  expect(await rowOf($, 'ToolResult')).toBe('⎿ result')
  expect(await rowOf($, 'ToolGroup')).toBe('Read 3 files')
})

const hintOf = async ($: Engine) => {
  const ui = await $.ui.mount({
    plugin: 'clean-view',
    component: 'ToolProgress',
    requestId: 'c1',
    props: { tool_use_id: 'c1', kind: 'background_hint', hint: '(ctrl+b to run in background)' },
    surface: 'terminal',
  })
  const tree = (await ui.drawn()) as Drawn
  await ui.unmount()

  return textOf(tree)
}

test('blanks the run-in-background hint while it is on, and leaves it while off', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)

  expect(await hintOf($)).toBe('')

  await simple($, 'off')

  expect(await hintOf($)).toBe('(ctrl+b to run in background)')
})

// ── On and off ──────────────────────────────────────────────────────────────

test('offers the command /simple', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)

  expect(world.commands).toEqual(['simple'])
})

test('hides the band at /simple off: only its button stays', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  await plan($)

  expect(await simple($, 'off')).toEqual({ text: 'Clean View is off. Tool calls and their output show again.' })
  expect(await bandOf($)).toEqual([OFF])
})

test('comes back at /simple on, with no job until the next prompt', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  await plan($)
  await simple($, 'off')

  expect(await simple($, 'on')).toEqual({ text: 'Clean View is on. Tool calls are hidden; the checklist shows the plan.' })
  expect(await bandOf($)).toEqual([ON])
})

test('flips the setting at /simple with no argument', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await simple($)

  expect(await bandOf($)).toEqual([OFF])

  await simple($, '  ')

  expect(await bandOf($)).toEqual([ON])
})

test('changes nothing at an argument it does not know, and says what it takes', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)

  expect(await simple($, 'maybe')).toEqual({ text: 'Use /simple on or /simple off; /simple alone flips it.' })
  expect(await bandOf($)).toEqual([ON])
})

test('starts on, and remembers the choice for the next session', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)

  expect(await bandOf($)).toEqual([ON])

  await simple($, 'off')

  expect(world.store).toEqual({ enabled: false })

  // The next session starts with what the last one kept.
  await start($, clock)

  expect(await bandOf($)).toEqual([OFF])
})

test('turns off and on at a press of its button, with a short toast each time', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'clean-view' })

  expect(textOf(await ui.drawn())).toMatch(/Clean View: OFF/)
  expect(world.toasts).toEqual(['Clean View is off'])
  expect(world.store).toEqual({ enabled: false })

  await ui.press({ key: 'clean-view' })

  expect(textOf(await ui.drawn())).toMatch(/Clean View: ON/)
  expect(world.toasts).toEqual(['Clean View is off', 'Clean View is on'])

  await ui.unmount()
})

// ── Details ─────────────────────────────────────────────────────────────────

test('advances its frame counter four times a second, only while a job works or waits on the person', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await clock.advance(2000)

  expect(world.ticks).toBe(0)

  await ask($, clock)
  await plan($)
  await clock.advance(1000)

  expect(world.ticks).toBe(4)

  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })
  await clock.advance(1000)

  expect(world.ticks).toBe(8)

  await report($, 'Polish the footer', 100)
  await finish($, clock)
  await clock.advance(10_000)

  expect(world.ticks).toBe(8)
})

test('moves the sweep of a step nothing was reported for with the frame counter', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  await plan($)
  await clock.advance(1000)

  expect((await bandOf($))[1]).toBe(`${'▶ Read your brand notes'.padEnd(29)}░░░░███░░░  Working`)
})

test('runs no timer once it is turned off in the middle of a job', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  await simple($, 'off')
  await clock.advance(2000)

  expect(world.ticks).toBe(0)
})

test('stays out of the way of a survey', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await ask($, clock)

  expect(textOf(await bandTree($, 'terminal', { hasSurvey: true }))).toBe(ENGINE_BAND)
})

test('sizes its rows to the band, so that none is wider than it', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  await plan($)
  const [header = '', ...rows] = await bandOf($, 'terminal', { bodyColumns: 40 })

  expect(rows).toHaveLength(4)
  expect(rows.every(row => row.length <= 40)).toBe(true)
  // The button's brackets are the terminal's: four cells more than its label.
  expect(header.length - '⟦⟧'.length + 4).toBeLessThanOrEqual(40)
})

// ── Tabs, where another mod draws in the band too ───────────────────────────

const TABS = {
  checklist: '⟦Checklist⟧‹Status›',
  status: (mark = '') => `‹Checklist${mark}›⟦Status⟧`,
}

// The band as lines of text, all of them.
const allLines = async ($: Engine, surface: Surface = 'terminal', props: Record<string, unknown> = {}) =>
  ((await bandTree($, surface, props)).children ?? []).map(textOf)

for (const surface of SURFACES) {
  test(`shares the band with another mod's as two tabs on the ${surface}, the checklist in front`, async ($, on) => {
    const { world, clock } = boot(on)
    world.band = STATUS_BAND
    await start($, clock)
    await ask($, clock)
    await plan($)

    expect(await allLines($, surface)).toEqual([`${TABS.checklist}${ON}`, 'Build bakery landing page · 0s', ...ROWS.planned])
  })
}

test("shows the other mod's band in place of the checklist at a press of its tab, and the checklist again at a press of its own", async ($, on) => {
  const { world, clock } = boot(on)
  world.band = STATUS_BAND
  await start($, clock)
  await ask($, clock)
  await plan($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const drawn = async () => (((await ui.drawn()) as Drawn).children ?? []).map(textOf)
  await ui.press({ key: 'tab-status' })

  expect(await drawn()).toEqual([`${TABS.status(' ▶')}${ON}`, 'status band'])

  await ui.press({ key: 'tab-checklist' })

  expect(await drawn()).toEqual([`${TABS.checklist}${ON}`, 'Build bakery landing page · 0s', ...ROWS.planned])

  await ui.unmount()
})

test('marks the checklist tab with what the job is doing while the other tab is in front', async ($, on) => {
  const { world, clock } = boot(on)
  world.band = STATUS_BAND
  world.store = { tab: 'status' }
  await start($, clock)
  const tabs = async () => (await allLines($))[0]

  expect(await tabs()).toBe(`${TABS.status()}${ON}`)

  await ask($, clock)
  await plan($)

  expect(await tabs()).toBe(`${TABS.status(' ▶')}${ON}`)

  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })

  expect(await tabs()).toBe(`${TABS.status(' ‖')}${ON}`)

  await report($, 'Polish the footer', 100)
  await finish($, clock)

  expect(await tabs()).toBe(`${TABS.status(' ✓')}${ON}`)

  await ask($, clock, 'Now write the menu for it', 't2')
  await finish($, clock, { reason: 'aborted', isAborted: true, answer: '' })

  expect(await tabs()).toBe(`${TABS.status(' ■')}${ON}`)

  await ask($, clock, 'And the opening hours', 't3')
  await finish($, clock, { reason: 'refusal', answer: '', refusal: { category: null, explanation: null } })

  expect(await tabs()).toBe(`${TABS.status(' ⚠')}${ON}`)
})

test('remembers which tab is in front for the next session', async ($, on) => {
  const { world, clock } = boot(on)
  world.band = STATUS_BAND
  await start($, clock)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'tab-status' })
  await ui.unmount()

  expect(world.store).toMatchObject({ tab: 'status' })

  await start($, clock)

  expect(await allLines($)).toEqual([`${TABS.status()}${ON}`, 'status band'])
})

test('says on the checklist tab that no job has run yet', async ($, on) => {
  const { world, clock } = boot(on)
  world.band = STATUS_BAND
  await start($, clock)

  expect(await allLines($)).toEqual([`${TABS.checklist}${ON}`, 'No job yet: your next request shows here as a checklist.'])
})

test('gives the line of the job the whole width under the tabs', async ($, on) => {
  const { world, clock } = boot(on)
  world.band = STATUS_BAND
  await start($, clock)
  await ask($, clock)

  // Beside the button there would be room for twenty-three characters of it.
  expect((await allLines($, 'terminal', { bodyColumns: 44 }))[1]).toBe('Build bakery landing page · 0s')
})

test('draws no tabs where nothing else is in the band', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await ui.find({ key: 'tab-status' })).toBeUndefined()
  expect(await ui.find({ key: 'tab-checklist' })).toBeUndefined()

  await ui.unmount()
})

test("draws no tabs while Clean View is off: its button, and the other mod's band as it is", async ($, on) => {
  const { world, clock } = boot(on)
  world.band = STATUS_BAND
  await start($, clock)
  await simple($, 'off')

  expect(await allLines($)).toEqual([OFF, 'status band'])
})

// ── A real API error: the engine names its kind apart from the turn's end ───

test('says a usage limit calmly when the kind of the error is named before the turn ends', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  await $.classic.StopFailure({ error: 'rate_limit' })
  // The turn's own end carries no text of the error.
  await finish($, clock, { reason: 'error', answer: '' })

  expect(await headerOf($)).toBe(`⚠ Stuck: you hit your usage limit, try again a little later${ON}`)
})

test('says it as calmly when the kind is named after the turn has ended', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  await finish($, clock, { reason: 'error', answer: '' })

  expect(await headerOf($)).toBe(`⚠ Stuck: something went wrong on the way, try again${ON}`)

  await $.classic.StopFailure({ error: 'overloaded', error_details: '529 Overloaded' })

  expect(await headerOf($)).toBe(`⚠ Stuck: Claude's servers are busy, try again in a minute${ON}`)
})

test("leaves the job alone when it is a subagent's request that failed", async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await ask($, clock)
  await plan($)
  await $.classic.StopFailure({ error: 'rate_limit', agent_id: 'a1' })

  expect(await headerOf($)).toBe(`Build bakery landing page · 0s${ON}`)
})

// ── Where nobody watches: a session that draws nowhere (a plain `claude -p` run) ──

test('stands aside in a session that draws nowhere: no tools offered, Claude told nothing, no tool refused, no job started', async ($, on) => {
  const { world, clock } = boot(on)
  world.surfaces = []
  await start($, clock)

  expect(world.tools).toEqual([])
  expect((await compose($, [])).sections.map(section => section.id)).toEqual(['intro'])

  await ask($, clock)

  expect(await bash($)).toMatchObject({ result: 'ok' })
  expect(world.naming).toEqual([])
})

test('runs no timer there, and notes no end of a turn', async ($, on) => {
  const { world, clock } = boot(on)
  world.surfaces = []
  await start($, clock)
  await ask($, clock)
  await clock.advance(2000)
  await finish($, clock)
  await clock.advance(6000)

  expect(world.ticks).toBe(0)
})

test('answers its tools there all the same, should Claude call one, and keeps no checklist', async ($, on) => {
  const { world, clock } = boot(on)
  world.surfaces = []
  await start($, clock)
  await ask($, clock)

  expect(await plan($)).toMatchObject({ result: 'Nobody is watching this session: no checklist is kept. Carry on without it.' })
  expect(await report($, 'Read your brand notes', 50)).toMatchObject({
    result: 'Nobody is watching this session: no checklist is kept. Carry on without it.',
  })
  expect(world.ticks).toBe(0)
})

test('still offers /simple there, and keeps the choice it is given', async ($, on) => {
  const { world, clock } = boot(on)
  world.surfaces = []
  await start($, clock)
  await simple($, 'off')

  expect(world.commands).toEqual(['simple'])
  expect(world.store).toEqual({ enabled: false })
})

test('comes to work as soon as the session draws somewhere', async ($, on) => {
  const { world, clock } = boot(on)
  world.surfaces = []
  await start($, clock)
  world.surfaces = ['desktop']
  await ask($, clock)

  expect((await bash($)).deny).toMatch(/mcp__clean-view__plan_steps/)
  expect((await compose($, ['desktop'])).sections.at(-1)?.id).toBe('clean-view:steps')
})
