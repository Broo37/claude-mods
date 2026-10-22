import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock, Plugin } from 'claude-code/testing'
import type { FsEntry, On, SessionUsage } from 'claude-code'

import type { StatusBandPanel } from '../types'
import { CREATURES, DIG_MS, HOPS_MS, petFrame } from '../hooks/pet'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

// A Monday afternoon, local time, so the reset wording does not depend on the time zone.
const NOW = new Date(2026, 9, 5, 16, 45).getTime()
const FRIDAY = new Date(2026, 9, 9, 8, 30).getTime()

const HOME = 'C:\\Users\\admin'
const CWD = `${HOME}\\project`
const SESSIONS = 'C:/Users/admin/.codex/sessions'
const ARCHIVED = 'C:/Users/admin/.codex/archived_sessions'

const CLEAN = ['# branch.oid 340fff1', '# branch.head main', '# branch.ab +0 -0', ''].join('\n')
const DIRTY = [CLEAN, '1 .M N... 100644 100644 100644 a1 b1 edited.txt', ''].join('\n')

const BAND = {
  plugin: 'status-band',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const TURN = { answer: 'done', isAborted: false, turnId: 't1', reason: 'answer' } as const

type Rollout = { text: string; mtimeMs: number; size?: number }

type Drawn = { type: string; props?: Record<string, unknown>; children?: unknown[] }

const usage = (): SessionUsage => ({
  startedAt: NOW - HOUR - 2 * MINUTE,
  context: { tokens: 86_400, window: 200_000, percent: 43 },
  rateLimits: [
    {
      kind: 'five_hour',
      percentUsed: 42,
      resetsAt: new Date(NOW + 2 * HOUR + 15 * MINUTE).toISOString(),
    },
    { kind: 'seven_day', percentUsed: 18, resetsAt: new Date(2026, 9, 8, 19, 0).toISOString() },
  ],
  cost: { usd: 1.234 },
})

const reading = (percent: number, readAt: number, resetsAt = FRIDAY) =>
  `{"timestamp":"${new Date(readAt).toISOString()}","payload":{"rate_limits":{"primary":{"used_percent":${percent},"window_minutes":10080,"resets_at":${Math.floor(resetsAt / 1000)}}}}}\n`

const slashed = (path: string) => path.replace(/\\/g, '/')

// Whether the dock places a pane: the Sessions pane always, the Status tab where the dock has room.
const isPlacedIn = (world: { canDock: boolean }, id: string) => id !== 'status' || world.canDock

// The stubs beneath the mod: they answer in Claude Code's place, from a world the test may change.
const boot = (on: On, env: Record<string, string> = {}) => {
  const world = {
    usage: usage(),
    isUsageDown: false,
    model: 'claude-opus-5-5',
    settings: { outputStyle: 'Explanatory', effortLevel: 'xhigh' } as Record<string, unknown>,
    git: { exitCode: 0, stdout: CLEAN },
    files: {} as Record<string, Rollout>,
    tail: '',
    reads: [] as string[],
    allReads: [] as string[],
    toasts: [] as string[],
    redraws: 0,
    blits: [] as { requestId: string; key: string; cells?: string; columns?: number; rows?: number }[],
    blitDeny: '',
    opened: [] as { id: string; title?: string; columns?: number }[],
    closed: [] as string[],
    panes: [] as string[],
    // Whether the pane is a tab behind another pane of the dock.
    isBehind: false,
    // Whether the dock has the room to place the Status tab: off, the band stands in for it.
    canDock: false,
    commands: [] as string[],
    store: {} as Record<string, unknown>,
    runs: [] as { argv: readonly string[]; env?: Record<string, string> }[],
    logs: [] as string[],
    // What a Bash call waits on before it is done, as one the person must approve does.
    held: Promise.resolve(),
    // What the hooks beneath answer a permission request with: nothing, so a dialog opens.
    permission: {} as Record<string, unknown>,
  }
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { USERPROFILE: HOME, OS: 'Windows_NT', ...env })

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('classic.Stop', () => ({}))
  on('classic.UserPromptSubmit', () => ({}))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', async ($, e) => {
    if (e.tool === 'Bash') {
      await world.held
    }

    return { result: 'ok' }
  })
  on('classic.PermissionRequest', () => world.permission)
  on('session.usage', () => (world.isUsageDown ? { deny: 'usage is offline' } : { value: world.usage }))
  on('session.model', () => ({ value: world.model }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.id', () => ({ value: 'me' }))
  on('settings.read', () => ({ value: world.settings }))
  on('ui.log', ($, e) => {
    world.logs.push(e.text)

    return { value: undefined }
  })
  on('ui.blit', ($, e) => {
    world.blits.push(e)

    return { value: world.blitDeny === '' ? {} : { deny: world.blitDeny } }
  })
  on('ui.invalidate', () => {
    world.redraws += 1

    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    world.toasts.push(e.text)

    return { value: undefined }
  })
  on('process.run', ($, e) => {
    world.runs.push({ argv: e.argv, env: e.init?.env })

    return {
      value: {
        exitCode: e.argv[0] === 'git' ? world.git.exitCode : 0,
        stdout: e.argv[0] === 'git' ? world.git.stdout : world.tail,
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('fs.list', ($, e) => {
    const under = `${slashed(e.path)}/`
    const entries = new Map<string, FsEntry>()

    for (const [path, file] of Object.entries(world.files)) {
      if (path.startsWith(under)) {
        const [name = '', ...deeper] = path.slice(under.length).split('/')
        entries.set(
          name,
          deeper.length > 0
            ? { name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false }
            : { name, kind: 'file', size: file.size ?? file.text.length, mtimeMs: file.mtimeMs, isLink: false },
        )
      }
    }

    return entries.size > 0 ? { value: [...entries.values()] } : { deny: 'ENOENT' }
  })
  on('fs.read', ($, e) => {
    const path = slashed(e.path)
    const file = world.files[path]
    world.allReads.push(path)

    if (path.includes('/.codex/')) {
      world.reads.push(path)
    }

    return file === undefined ? { deny: 'ENOENT' } : { value: file.text }
  })
  on('store.get', ($, e) => ({ value: world.store[e.key] }))
  on('store.set', ($, e) => {
    world.store[e.key] = e.value

    return { value: undefined }
  })
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['engine'] }))
  on('ui.render', { component: 'PromptHint' }, () => ({ type: 'Text', props: {}, children: ['engine hint'] }))
  on('ui.render', { component: 'Pane' }, () => ({ type: 'Text', props: {}, children: ['engine pane'] }))
  on('ui.open', ($, e) => {
    world.opened.push({ id: e.id, title: e.title, columns: e.columns })
    world.panes = [...new Set([...world.panes, e.id])]

    return {
      value: isPlacedIn(world, e.id) ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'the terminal is too narrow' },
    }
  })
  on('ui.panes', () => ({
    value: world.panes.map(id => ({
      id,
      title: id === 'status' ? 'Status' : 'Sessions',
      isShown: !world.isBehind,
      isFocused: false,
      isPlaced: isPlacedIn(world, id),
    })),
  }))
  on('ui.close', ($, e) => {
    world.closed.push(e.id)
    world.panes = world.panes.filter(id => id !== e.id)

    return { value: undefined }
  })
  on('command.register', ($, e) => {
    world.commands.push(e.name)

    return { value: { command: e.name } }
  })
  on('command.run', () => ({ text: 'no such command' }))

  return { world, clock }
}

const start = async ($: Engine, clock: MockClock) => {
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await clock.settle()
}

type Run = { text: string; color: string; backgroundColor?: string }

const isDrawn = (node: unknown): node is Drawn => typeof node === 'object' && node !== null

// A bar is the part of a row that holds runs of text, not text itself.
const runsOf = (part: unknown): Run[] | undefined => {
  const { children = [] } = part as Drawn

  return children.some(isDrawn)
    ? children.filter(isDrawn).map(run => ({
        text: (run.children ?? []).join(''),
        color: String(run.props?.color),
        ...(run.props?.backgroundColor !== undefined && { backgroundColor: String(run.props.backgroundColor) }),
      }))
    : undefined
}

const glyphsOf = (runs: Run[] = []) => runs.map(run => run.text).join('')

const written = (part: unknown) => {
  if ((part as Drawn).type === 'Raster') {
    return (part as Drawn).props?.key === 'pet' ? '[pet]' : '[spin]'
  }

  const runs = runsOf(part)

  return runs === undefined ? ((part as Drawn).children ?? []).join('') : `[bar ${glyphsOf(runs).length}]`
}

const drawnBy = async ($: Engine, surface: 'terminal' | 'desktop') => {
  const ui = await $.ui.mount({ ...BAND, surface })
  const tree = (await ui.drawn()) as Drawn
  await ui.unmount()

  return (tree.children ?? []).map(row => (row as Drawn).children ?? [])
}

// The band as rows of text, each bar written as its width.
const rowsOf = async ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') =>
  (await drawnBy($, surface)).map(row => row.map(written).join(''))

// The bars the band draws, top to bottom, each as its runs.
const barsOf = async ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') =>
  (await drawnBy($, surface)).flat().flatMap(part => {
    const runs = runsOf(part)

    return runs === undefined ? [] : [runs]
  })

test('draws nothing of its own before its first reading', async ($, on) => {
  boot(on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: 'engine' }))?.type).toBe('Text')
  expect(await ui.find({ type: 'Text', text: /Context/ })).toBeUndefined()
})

test('draws the seven rows from what the session reports', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)

  expect(await rowsOf($)).toEqual([
    '🤖 Opus 5.5 ⚡xhigh │ 🎨 Explanatory',
    '📂 C:\\Users\\admin\\project 🌿(main) │ ✅ clean │ 🐍 no env',
    '💰 $ 1.23 │ ⏰ 1h2m',
    '🧠 Context  [bar 40] 43% used (86k/200k)',
    '🚀 5H Limit [bar 40] 42% ⏳ Resets in 2h15m, 🕐 19:00',
    '🌟 7D Limit [bar 40] 18% ⏳ Resets in 3d2h15m, 📅 Thu 19:00',
    '🌀 Codex 7D [bar 40] 0% no codex data',
  ])
})

test('leaves an empty row between the transcript and its first row', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const tree = (await ui.drawn()) as Drawn

  expect(tree.props?.paddingTop).toBe(1)
})

test('draws each bar as one text of colored runs, 40 blocks wide', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const bars = await barsOf($)

  expect(bars.map(bar => glyphsOf(bar).length)).toEqual([40, 40, 40, 40])
})

test('names each half of a block of a box its own exact color', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const [context = []] = await barsOf($)

  // A raster would round each channel to one of 16 levels and band the gradient.
  expect(context[0]).toEqual({ text: '▌', color: 'rgb(245,194,231)', backgroundColor: 'rgb(244,189,225)' })
})

test('draws a bar the same way on a surface that is not a terminal', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)

  expect(await barsOf($, 'desktop')).toEqual(await barsOf($, 'terminal'))
})

test('colors a part the way the layout names it', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const model = await ui.find({ type: 'Text', text: 'Opus 5.5' })

  expect(model?.props.color).toBe('rgb(148,226,213)')
  expect(model?.props.bold).toBe(true)
})

test('draws the size the option names', { options: { size: 'small' } }, async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)

  expect(await rowsOf($)).toEqual([
    '🤖 Opus 5.5 ⚡xhigh │ 🎨 Explanatory │ 📂 ~\\project 🌿(main)',
    '🧠 Context [bar 10] 43% │ 5H [bar 10] 42% │ 7D [bar 10] 18% │ CX [bar 10] 0%',
  ])
})

test('stays drawn while a survey shows', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const ui = await $.ui.mount({
    ...BAND,
    props: { ...BAND.props, hasSurvey: true },
    surface: 'terminal',
  })

  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: 'Opus 5.5' }))?.type).toBe('Text')
  expect(await ui.find({ type: 'Text', text: /Context/ })).not.toBeUndefined()
})

test('asks git once, with a status that takes no lock', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)

  expect(world.runs).toEqual([
    {
      argv: ['git', '-C', CWD, 'status', '--porcelain=v2', '--branch', '-uall'],
      env: { GIT_OPTIONAL_LOCKS: '0' },
    },
  ])
})

test('says so outside a git repository', async ($, on) => {
  const { world, clock } = boot(on)
  world.git = { exitCode: 128, stdout: '' }
  await start($, clock)
  const [first, second] = await rowsOf($)

  expect(first).toBe('🤖 Opus 5.5 ⚡xhigh │ 🎨 Explanatory')
  expect(second).toBe('📂 C:\\Users\\admin\\project │ 🌿 no git │ 🐍 no env')
})

test('names the active conda environment', async ($, on) => {
  const { clock } = boot(on, { CONDA_DEFAULT_ENV: 'base', VIRTUAL_ENV: 'C:\\venvs\\app' })
  await start($, clock)

  expect((await rowsOf($))[1]).toBe('📂 C:\\Users\\admin\\project 🌿(main) │ ✅ clean │ 🐍 base')
})

test('names a virtualenv when no conda environment is active', async ($, on) => {
  const { clock } = boot(on, { VIRTUAL_ENV: 'C:\\venvs\\app' })
  await start($, clock)

  expect((await rowsOf($))[1]).toBe('📂 C:\\Users\\admin\\project 🌿(main) │ ✅ clean │ 🐍 venv')
})

test('shows a new measurement as soon as the session reports it', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await $.session.measure({
    context: { tokens: 120_000, window: 200_000, percent: 60 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 55 }],
    cost: { usd: 2 },
    changed: ['context', 'rateLimits', 'cost'],
  })
  const rows = await rowsOf($)

  expect(rows[2]).toBe('💰 $ 2.00 │ ⏰ 1h2m')
  expect(rows[3]).toBe('🧠 Context  [bar 40] 60% used (120k/200k)')
  expect(rows[4]).toBe('🚀 5H Limit [bar 40] 55% ⏳ Resets in N/A, 🕐 N/A')
})

test('reads git and the clock again every half minute', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  world.git = { exitCode: 0, stdout: DIRTY }
  await clock.advance(30_000)
  const rows = await rowsOf($)

  expect(rows[1]).toBe('📂 C:\\Users\\admin\\project 🌿(main) │ 📝!1 │ 🐍 no env')
  expect(rows[4]).toBe('🚀 5H Limit [bar 40] 42% ⏳ Resets in 2h14m, 🕐 19:00')
})

test('adds the finished turn and its tool calls', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.turn.complete({ ...TURN, durationMs: 42_400 })
  await clock.settle()

  expect((await rowsOf($))[2]).toBe(
    '💰 $ 1.23 │ ⏰ 1h2m │ ⌛ last 42s │ 🔧 2 tools',
  )
})

test('does not count a question put to the person among the tools of the turn', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  // Asked by Claude, or by a mod such as one that holds a risky command until the person approves it.
  await $.tool.call({
    tool: 'AskUserQuestion',
    questions: [{ question: 'Run it?', header: 'Risky', multiSelect: false, options: [{ label: 'Run it', description: '' }, { label: 'Block it', description: '' }] }],
  })
  await $.turn.complete({ ...TURN, durationMs: 42_400 })
  await clock.settle()

  // Seen on a real turn: a held command's question made three calls read "4 tools".
  expect((await rowsOf($))[2]).toBe('💰 $ 1.23 │ ⏰ 1h2m │ ⌛ last 42s │ 🔧 1 tool')
})

test("keeps the main turn's figures when a subagent's turn ends", async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({ ...TURN, durationMs: 42_000 })
  await $.turn.complete({ ...TURN, turnId: 't2', agentId: 'a1', durationMs: 9000 })
  await clock.settle()

  expect((await rowsOf($))[2]).toBe(
    '💰 $ 1.23 │ ⏰ 1h2m │ ⌛ last 42s │ 🔧 0 tools',
  )
})

test('reads git again when a turn ends', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  world.git = { exitCode: 0, stdout: DIRTY }
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({ ...TURN, durationMs: 1000 })
  await clock.settle()

  expect((await rowsOf($))[1]).toBe('📂 C:\\Users\\admin\\project 🌿(main) │ 📝!1 │ 🐍 no env')
})

test('takes the effort the settings give the model', async ($, on) => {
  const { world, clock } = boot(on)
  world.model = 'claude-opus-5-5[1m]'
  world.settings = {
    effortLevel: 'low',
    modelSettings: { 'claude-opus-5-5': { effortLevel: 'high' } },
  }
  await start($, clock)

  expect((await rowsOf($))[0]).toBe('🤖 Opus 5.5 (1M context) ⚡high')
})

test('shows the effort the last turn ran with', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await $.classic.Stop({ stop_hook_active: false, effort: { level: 'high' } })

  expect((await rowsOf($))[0]).toBe('🤖 Opus 5.5 ⚡high │ 🎨 Explanatory')
})

test("keeps the turn's effort until the setting changes", async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await $.classic.Stop({ stop_hook_active: false, effort: { level: 'high' } })
  await clock.advance(30_000)

  expect((await rowsOf($))[0]).toBe('🤖 Opus 5.5 ⚡high │ 🎨 Explanatory')

  world.settings = { outputStyle: 'Explanatory', effortLevel: 'max' }
  await clock.advance(30_000)

  expect((await rowsOf($))[0]).toBe('🤖 Opus 5.5 ⚡max │ 🎨 Explanatory')
})

test('drops the effort after a turn on a model that takes none', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  await $.classic.Stop({ stop_hook_active: false })

  expect((await rowsOf($))[0]).toBe('🤖 Opus 5.5 │ 🎨 Explanatory')
})

test('shows the newest Codex reading among the rollouts', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = {
    [`${SESSIONS}/2026/10/03/rollout-old.jsonl`]: { text: reading(12, NOW - 5 * HOUR), mtimeMs: NOW - 5 * HOUR },
    [`${SESSIONS}/2026/10/05/rollout-new.jsonl`]: { text: reading(26, NOW - HOUR), mtimeMs: NOW - HOUR },
    [`${SESSIONS}/2026/10/05/notes.txt`]: { text: reading(99, NOW), mtimeMs: NOW },
  }
  await start($, clock)

  expect((await rowsOf($))[6]).toBe('🌀 Codex 7D [bar 40] 26% ⏳ Resets in 3d15h45m, 📅 Fri 08:30')
})

test('looks at archived rollouts too', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = {
    [`${ARCHIVED}/rollout-archived.jsonl`]: { text: reading(31, NOW - HOUR), mtimeMs: NOW - HOUR },
  }
  await start($, clock)

  expect((await rowsOf($))[6]).toBe('🌀 Codex 7D [bar 40] 31% ⏳ Resets in 3d15h45m, 📅 Fri 08:30')
})

test('reads a rollout again only once it has changed', async ($, on) => {
  const { world, clock } = boot(on)
  const path = `${SESSIONS}/2026/10/05/rollout-live.jsonl`
  world.files = { [path]: { text: reading(26, NOW - HOUR), mtimeMs: NOW - HOUR } }
  await start($, clock)
  await clock.advance(30_000)

  expect(world.reads).toEqual([path])

  world.files = { [path]: { text: reading(27, NOW), mtimeMs: NOW } }
  await clock.advance(30_000)

  expect(world.reads).toEqual([path, path])
  expect((await rowsOf($))[6]).toBe('🌀 Codex 7D [bar 40] 27% ⏳ Resets in 3d15h44m, 📅 Fri 08:30')
})

test('tails a rollout too large to read whole', async ($, on) => {
  const { world, clock } = boot(on)
  const path = `${SESSIONS}/2026/07/16/rollout-huge.jsonl`
  world.files = { [path]: { text: '', mtimeMs: NOW - HOUR, size: 82_818_487 } }
  world.tail = `t in half"}\n${reading(64, NOW - HOUR)}`
  await start($, clock)
  const tail = world.runs.find(run => run.argv[0] === 'powershell')

  expect(world.reads).toEqual([])
  expect(tail?.argv.at(-1)).toMatch(/rollout-huge\.jsonl/)
  expect((await rowsOf($))[6]).toBe('🌀 Codex 7D [bar 40] 64% ⏳ Resets in 3d15h45m, 📅 Fri 08:30')
})

test('does not trust the line a tail cut in half', async ($, on) => {
  const { world, clock } = boot(on)
  const path = `${SESSIONS}/2026/07/16/rollout-huge.jsonl`
  world.files = { [path]: { text: '', mtimeMs: NOW - HOUR, size: 82_818_487 } }
  world.tail = reading(64, NOW - HOUR).trimEnd()
  await start($, clock)

  expect((await rowsOf($))[6]).toBe('🌀 Codex 7D [bar 40] 0% no codex data')
})

test('reads everything again after /clear', async ($, on) => {
  const { clock } = boot(on)
  await $.classic.SessionStart({ source: 'clear' })
  await clock.settle()

  expect((await rowsOf($))[3]).toBe('🧠 Context  [bar 40] 43% used (86k/200k)')
})

test('keeps the last view when a reading fails, and says why in the debug log', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  world.isUsageDown = true
  world.git = { exitCode: 0, stdout: DIRTY }
  await clock.advance(30_000)

  expect((await rowsOf($))[1]).toBe('📂 C:\\Users\\admin\\project 🌿(main) │ ✅ clean │ 🐍 no env')
  expect(world.logs).toHaveLength(1)
  expect(world.logs[0]).toMatch(/usage is offline/)
})

const PERSONAL = 'C:/Users/admin/.claude-personal/.claude.json'
const DEFAULT = 'C:/Users/admin/.claude.json'

const accountFile = (organizationType: string) => ({
  text: JSON.stringify({ oauthAccount: { organizationType } }),
  mtimeMs: NOW,
})

const measured = (fiveHour: number) => ({
  context: { tokens: 86_400, window: 200_000, percent: 43 },
  rateLimits: [
    {
      kind: 'five_hour',
      percentUsed: fiveHour,
      resetsAt: new Date(NOW + 2 * HOUR + 15 * MINUTE).toISOString(),
    },
  ],
  cost: { usd: 1.234 },
  changed: ['rateLimits' as const],
})

test('names the plan the session runs on', async ($, on) => {
  const { world, clock } = boot(on, { CLAUDE_CONFIG_DIR: 'C:\\Users\\admin\\.claude-personal' })
  world.files = { [PERSONAL]: accountFile('claude_pro') }
  await start($, clock)

  expect((await rowsOf($))[0]).toBe(
    '🤖 Opus 5.5 ⚡xhigh 💎 Pro │ 🎨 Explanatory',
  )
})

test('names the plan alone on the default profile', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = { [DEFAULT]: accountFile('claude_team') }
  await start($, clock)

  expect((await rowsOf($))[0]).toBe('🤖 Opus 5.5 ⚡xhigh 💎 Team │ 🎨 Explanatory')
})

test('names the profile alone when its account file cannot be read', async ($, on) => {
  const { clock } = boot(on, { CLAUDE_CONFIG_DIR: 'C:\\Users\\admin\\.claude-personal' })
  await start($, clock)

  expect((await rowsOf($))[0]).toBe('🤖 Opus 5.5 ⚡xhigh 💎 personal │ 🎨 Explanatory')
})

test('reads the account file once, not on every tick', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = { [DEFAULT]: accountFile('claude_team') }
  await start($, clock)
  await clock.advance(60_000)

  expect(world.allReads.filter(path => path === DEFAULT)).toHaveLength(1)
})

test('warns in a toast when a limit climbs past a mark', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)

  expect(world.toasts).toEqual([])

  await $.session.measure(measured(82))

  expect(world.toasts).toEqual(['⚠️ 5H limit at 82% · resets in 2h15m'])
})

test('does not warn twice for the same mark', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await $.session.measure(measured(82))
  await $.session.measure(measured(85))
  await clock.advance(30_000)

  expect(world.toasts).toHaveLength(1)
})

test('warns from the half-minute reading too', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  world.usage = { ...world.usage, context: { tokens: 182_000, window: 200_000, percent: 91 } }
  await clock.advance(30_000)

  expect(world.toasts).toEqual(['🚨 Context at 91% · /compact frees room'])
})

test('warns at the start of a session that is already near a limit', async ($, on) => {
  const { world, clock } = boot(on)
  world.usage = {
    ...world.usage,
    rateLimits: [{ kind: 'seven_day', percentUsed: 93, resetsAt: new Date(2026, 9, 8, 19, 0).toISOString() }],
  }
  await start($, clock)

  expect(world.toasts).toEqual(['🚨 7D limit at 93% · resets Thu 19:00'])
})

test('holds a measurement that arrives before the first reading, so it is judged once', async ($, on) => {
  const { world, clock } = boot(on)
  world.usage = { ...world.usage, rateLimits: measured(85).rateLimits }
  await $.session.measure(measured(85))

  expect(world.toasts).toEqual([])

  await start($, clock)

  expect(world.toasts).toEqual(['⚠️ 5H limit at 85% · resets in 2h15m'])
})

const FRAME = 50
const SETTLE = 150

test('sweeps a glint across the boxes once a reading has changed', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  const plain = await barsOf($)
  await clock.advance(SETTLE)

  expect(world.redraws).toBe(0)

  await clock.advance(FRAME)
  const lit = await barsOf($)

  // The glint starts on the first block: the three boxes are lighter there, and
  // the Codex bar, which has no box, is as it was.
  expect(world.redraws).toBe(1)
  expect([0, 1, 2].every(bar => lit[bar]?.[0]?.color !== plain[bar]?.[0]?.color)).toBe(true)
  expect(lit[3]).toEqual(plain[3])
})

test('ends a sweep by drawing each bar as it was, then rests', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  const plain = await barsOf($)
  await clock.advance(SETTLE + FRAME * 11)
  const redraws = world.redraws

  // The longest box has 17 blocks: frames with the head at 0, 2 ... 18, then one that restores.
  expect(redraws).toBe(11)
  expect(await barsOf($)).toEqual(plain)

  await clock.advance(10_000)

  expect(world.redraws).toBe(redraws)
})

test('does not sweep when the animation is switched off', { options: { animate: false } }, async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await barsOf($)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.advance(10_000)

  expect(world.redraws).toBe(0)
})

test('does not sweep before the band has been drawn', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await clock.advance(SETTLE + FRAME * 20)

  expect(world.redraws).toBe(0)
})

test('keeps sweeping while Claude works, and rests when the turn ends', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await barsOf($)
  await clock.advance(SETTLE + FRAME * 11)
  const afterFirst = world.redraws
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.advance(FRAME * 11)
  const afterStart = world.redraws
  await clock.advance(3500 + FRAME * 11)
  const whileWorking = world.redraws
  await $.turn.complete({ ...TURN, durationMs: 5000 })
  await clock.advance(20_000)

  // Every sweep draws the same frames, so each adds what the first one did.
  expect(afterFirst).toBeGreaterThan(0)
  expect(afterStart).toBe(afterFirst * 2)
  expect(whileWorking).toBe(afterFirst * 3)
  expect(world.redraws).toBe(whileWorking)
})

test('shows the newest reading when it changes in the middle of a sweep', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await barsOf($)
  await clock.advance(SETTLE + FRAME * 2)
  await $.session.measure({
    context: { tokens: 150_000, window: 200_000, percent: 75 },
    rateLimits: world.usage.rateLimits,
    cost: { usd: 1.234 },
    changed: ['context'],
  })
  await barsOf($)
  await clock.advance(FRAME * 40)
  const settled = await barsOf($)
  await clock.advance(10_000)

  // The glint runs on over the longer box, and leaves no light on it.
  expect(glyphsOf(settled[0])).toBe(`${'▌'.repeat(30)}${'─'.repeat(9)}┤`)
  expect(await barsOf($)).toEqual(settled)
})

test('marks the pace on the whisker of the limit bars where the time of their window stands', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const [context, fiveHour, sevenDay] = (await barsOf($)).map(glyphsOf)

  // 55% of the 5H window and 56% of the 7D one have passed: block 22 of 40 on both.
  expect(fiveHour?.indexOf('╂')).toBe(22)
  expect(sevenDay?.indexOf('╂')).toBe(22)
  expect(context?.includes('╂')).toBe(false)
  expect([context, fiveHour, sevenDay].some(bar => bar?.includes('┃'))).toBe(false)
})

test('draws what remains of a bar as a whisker that ends in a cap', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const [context] = (await barsOf($)).map(glyphsOf)

  // 17 of the 40 blocks of the context bar are its box.
  expect(context).toBe(`${'▌'.repeat(17)}${'─'.repeat(22)}┤`)
})

test('cuts a tick into the box of a limit bar that is ahead of its time', async ($, on) => {
  const { world, clock } = boot(on)
  world.usage = {
    ...world.usage,
    rateLimits: world.usage.rateLimits.map(limit =>
      limit.kind === 'five_hour' ? { ...limit, percentUsed: 80 } : limit,
    ),
  }
  await start($, clock)
  const [, fiveHour] = (await barsOf($)).map(glyphsOf)

  expect(fiveHour?.indexOf('┃')).toBe(22)
  expect(fiveHour?.includes('╂')).toBe(false)
})

test('leaves a bar that is nearly full as still as the others once a sweep is over', async ($, on) => {
  const { world, clock } = boot(on)
  world.usage = { ...world.usage, context: { tokens: 184_000, window: 200_000, percent: 92 } }
  await start($, clock)
  await barsOf($)
  await clock.advance(SETTLE + FRAME * 30)
  const afterSweep = world.redraws
  await clock.advance(20_000)

  expect(afterSweep).toBeGreaterThan(0)
  expect(world.redraws).toBe(afterSweep)
})

const HINT = {
  plugin: 'status-band',
  component: 'PromptHint',
  props: { isDraft: false, isWorking: false, hint: '(shift+tab to cycle)' },
} as const

const BELOW = { options: { position: 'below' } }

// What stands in the hint's place under the prompt.
const underPrompt = async ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') => {
  const ui = await $.ui.mount({ ...HINT, surface })
  const tree = (await ui.drawn()) as Drawn
  await ui.unmount()

  return tree
}

// Since 2.1.301 the test engine tags a tree it drew itself with a `part`: the rest is what has to be left alone.
const untagged = (tree?: Drawn) => {
  const { part, ...rest } = (tree ?? {}) as Drawn & { part?: unknown }

  return rest
}

test('leaves the line under the prompt to Claude Code while it stands above', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)

  expect(untagged(await underPrompt($))).toEqual({ type: 'Text', props: {}, children: ['engine hint'] })
  expect((await rowsOf($))[3]).toBe('🧠 Context  [bar 40] 43% used (86k/200k)')
})

test('draws nothing above the prompt once it is set below', BELOW, async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: 'engine' }))?.type).toBe('Text')
  expect(await ui.find({ type: 'Text', text: /Context/ })).toBeUndefined()
})

const rowText = (row: unknown) => ((row as Drawn).children ?? []).map(written).join('')

test('draws its first row on the line of the mode pill and the rest under it, once it is set below', BELOW, async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const tree = await underPrompt($)
  const [first, rest] = (tree.children ?? []) as Drawn[]

  // Claude Code keeps its mode pill on that line whatever is drawn after it, so
  // the pill leads the band, and the hint that only says how to cycle modes is left out.
  expect(tree.props?.flexDirection).toBe('column')
  expect(rowText(first)).toBe('🤖 Opus 5.5 ⚡xhigh │ 🎨 Explanatory')
  expect((rest?.children ?? []).map(rowText)).toEqual([
    '📂 C:\\Users\\admin\\project 🌿(main) │ ✅ clean │ 🐍 no env',
    '💰 $ 1.23 │ ⏰ 1h2m',
    '🧠 Context  [bar 40] 43% used (86k/200k)',
    '🚀 5H Limit [bar 40] 42% ⏳ Resets in 2h15m, 🕐 19:00',
    '🌟 7D Limit [bar 40] 18% ⏳ Resets in 3d2h15m, 📅 Thu 19:00',
    '🌀 Codex 7D [bar 40] 0% no codex data',
  ])
})

const shiftOf = async ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') =>
  (((await underPrompt($, surface)).children ?? [])[1] as Drawn | undefined)?.props?.marginLeft

test('pulls the rows under the prompt back to stand under the mode pill', BELOW, async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)

  // No mode has been told yet: the default one's pill is taken.
  expect(await shiftOf($)).toBe(-19)

  await $.classic.Stop({ stop_hook_active: false, permission_mode: 'bypassPermissions' })

  expect(await shiftOf($)).toBe(-27)

  await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'plan' })

  expect(await shiftOf($)).toBe(-17)
})

test('remembers the mode a session ran in for the next one', BELOW, async ($, on) => {
  const { world, clock } = boot(on)
  world.store = { mode: 'bypassPermissions' }
  await start($, clock)

  expect(await shiftOf($)).toBe(-27)

  await $.classic.Stop({ stop_hook_active: false, permission_mode: 'acceptEdits' })

  expect(world.store).toEqual({ mode: 'acceptEdits' })
})

test('keeps a hint that says more than how to cycle modes, dim, after its first row', BELOW, async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const ui = await $.ui.mount({ ...HINT, props: { ...HINT.props, hint: '(shift+tab to cycle) · ← for agents' }, surface: 'terminal' })
  const tree = (await ui.drawn()) as Drawn
  const [first] = (tree.children ?? []) as Drawn[]
  const last = (first?.children ?? []).at(-1) as Drawn | undefined

  expect(rowText(first)).toBe('🤖 Opus 5.5 ⚡xhigh │ 🎨 Explanatory · ← for agents')
  expect(last?.children).toEqual([' · ← for agents'])
  expect(last?.props?.dimColor).toBe(true)
})

test('pulls nothing back on a surface that draws no pill before the hint', BELOW, async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)

  expect(await shiftOf($, 'desktop')).toBeUndefined()
})

test('leaves the line under the prompt alone before its first reading', BELOW, async ($, on) => {
  boot(on)

  expect(untagged(await underPrompt($))).toEqual({ type: 'Text', props: {}, children: ['engine hint'] })
})

test('sweeps its glint under the prompt too', BELOW, async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await underPrompt($)
  await clock.advance(SETTLE + FRAME * 11)

  expect(world.redraws).toBe(11)
})

const TEAM_SESSIONS = 'C:/Users/admin/.claude/sessions'
const OWN_SESSIONS = 'C:/Users/admin/.claude-personal/sessions'
const ON_PERSONAL = { CLAUDE_CONFIG_DIR: 'C:\\Users\\admin\\.claude-personal' }

// The file Claude Code keeps for a running session. A change of it shows in its mtime.
const presence = (id: string, name: string, status: string, since: number, more: Record<string, unknown> = {}) => ({
  text: JSON.stringify({ pid: 1, sessionId: id, cwd: 'D:\\work', kind: 'interactive', name, status, statusUpdatedAt: since, ...more }),
  mtimeMs: since,
})

const POLL = 5000

const BOARD = {
  plugin: 'status-band',
  component: 'Pane',
  requestId: 'sessions',
  props: {
    title: 'Sessions',
    isFocused: false,
    bodyColumns: 30,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

// The lines of the pane the other sessions are listed in, without the empty
// ones and without the pet under them.
const boardOf = async ($: Engine) => {
  const ui = await $.ui.mount({ ...BOARD, surface: 'terminal' })
  const tree = (await ui.drawn()) as Drawn
  await ui.unmount()

  return (tree.children ?? [])
    .map(row => ((row as Drawn).children ?? []).map(written).join(''))
    .filter(line => line.trim() !== '' && line !== '[pet]')
}

test('lists the sessions of both profiles in a pane of its own, but not itself', async ($, on) => {
  const { world, clock } = boot(on, ON_PERSONAL)
  world.files = {
    [`${TEAM_SESSIONS}/1.json`]: presence('s1', 'uat2-07', 'idle', NOW - 97 * MINUTE),
    [`${OWN_SESSIONS}/2.json`]: presence('me', 'claude-mods', 'busy', NOW),
    [`${OWN_SESSIONS}/3.json`]: presence('s3', 'other', 'busy', NOW - 2 * MINUTE),
    [`${OWN_SESSIONS}/3.abc.key`]: { text: 'not a presence file', mtimeMs: NOW },
  }
  await start($, clock)

  expect(await boardOf($)).toEqual(['🕐 uat2-07', '   waiting 1h37m', '[spin]  other', '   working 2m'])
  expect(await rowsOf($)).toHaveLength(7)
})

test('opens the pane once another session is seen, wide enough for thirty columns and its gutter', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)

  // Alone, there is nothing to list and the chat keeps its whole width.
  expect(world.opened.filter(pane => pane.id === 'sessions')).toEqual([])

  world.files = { [`${TEAM_SESSIONS}/1.json`]: presence('s1', 'uat2-07', 'idle', NOW - MINUTE) }
  await clock.advance(POLL * 3)

  expect(world.opened.filter(pane => pane.id === 'sessions')).toEqual([{ id: 'sessions', title: 'Sessions', columns: 32 }])
})

test('leaves the pane closed once the person has closed it, until they ask for it', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = { [`${TEAM_SESSIONS}/1.json`]: presence('s1', 'uat2-07', 'busy', NOW - MINUTE) }
  await start($, clock)

  // The person closes it: Claude Code no longer lists it among the open panes.
  world.panes = []
  await clock.advance(POLL)
  world.files = { [`${TEAM_SESSIONS}/1.json`]: presence('s1', 'uat2-07', 'idle', NOW) }
  await clock.advance(POLL * 3)

  expect(world.opened.filter(pane => pane.id === 'sessions')).toHaveLength(1)
  expect(world.commands).toEqual(['sessions', 'band'])

  const ran = await $.command.run({
    command: 'sessions',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 150 },
  })

  expect(ran).toEqual({ text: 'Sessions pane opened.' })
  expect(world.opened.filter(pane => pane.id === 'sessions')).toHaveLength(2)
})

test('brings the pane to the front when the person asks for it while it is a tab behind another pane', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = { [`${TEAM_SESSIONS}/1.json`]: presence('s1', 'uat2-07', 'busy', NOW - MINUTE) }
  await start($, clock)
  // Another pane was opened after it and is the one the dock shows.
  world.isBehind = true

  const ran = await $.command.run({
    command: 'sessions',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 150 },
  })

  // The pane opened last is the tab in front: it is closed and opened again.
  expect(ran).toEqual({ text: 'Sessions pane opened.' })
  expect(world.closed).toEqual(['sessions'])
  expect(world.opened.filter(pane => pane.id === 'sessions')).toHaveLength(2)
})

test('does not take the pane it is bringing to the front for one the person closed', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = { [`${TEAM_SESSIONS}/1.json`]: presence('s1', 'uat2-07', 'busy', NOW - MINUTE) }
  await start($, clock)
  world.isBehind = true
  await $.command.run({
    command: 'sessions',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 150 },
  })
  world.isBehind = false
  await clock.advance(POLL * 2)

  // It stays up, and stays asked for: nothing closes it again or opens it a third time.
  expect(world.panes.filter(id => id === 'sessions')).toEqual(['sessions'])
  expect(world.opened.filter(pane => pane.id === 'sessions')).toHaveLength(2)
})

test('leaves the pane as it is when the person asks for it while it is the one shown', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = { [`${TEAM_SESSIONS}/1.json`]: presence('s1', 'uat2-07', 'busy', NOW - MINUTE) }
  await start($, clock)
  await $.command.run({
    command: 'sessions',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 150 },
  })

  expect(world.closed).toEqual([])
})

test('looks at the default profile once when the session runs on it', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = { [`${TEAM_SESSIONS}/1.json`]: presence('s1', 'uat2-07', 'idle', NOW - MINUTE) }
  await start($, clock)

  expect(await boardOf($)).toEqual(['🕐 uat2-07', '   waiting 1m'])
})

test('notices within seconds that another session has changed, or gone', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = { [`${TEAM_SESSIONS}/1.json`]: presence('s1', 'uat2-07', 'busy', NOW - MINUTE) }
  await start($, clock)

  expect(await boardOf($)).toEqual(['[spin]  uat2-07', '   working 1m'])

  world.files = { [`${TEAM_SESSIONS}/1.json`]: presence('s1', 'uat2-07', 'idle', NOW) }
  await clock.advance(POLL)

  expect(await boardOf($)).toEqual(['🕐 uat2-07', '   waiting 0s'])

  world.files = {}
  await clock.advance(POLL)

  expect(await boardOf($)).toEqual(['No other sessions open.'])
})

test('tells the person when another session stops working and waits for them', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = { [`${TEAM_SESSIONS}/1.json`]: presence('s1', 'uat2-07', 'busy', NOW - MINUTE) }
  await start($, clock)

  // What a session was doing before this one first looked is no news.
  expect(world.toasts).toEqual([])

  world.files = { [`${TEAM_SESSIONS}/1.json`]: presence('s1', 'uat2-07', 'idle', NOW) }
  await clock.advance(POLL)
  await clock.advance(POLL)

  expect(world.toasts).toEqual(['🕐 uat2-07 is waiting for you'])
})

test('tells the person when another session needs an answer', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = { [`${TEAM_SESSIONS}/1.json`]: presence('s1', 'uat2-07', 'busy', NOW - MINUTE) }
  await start($, clock)
  world.files = {
    [`${TEAM_SESSIONS}/1.json`]: presence('s1', 'uat2-07', 'busy', NOW, { waitingFor: 'permission' }),
  }
  await clock.advance(POLL)

  expect(world.toasts).toEqual(['🙋 uat2-07 needs you'])
})

test('says nothing when a session that was waiting already is seen for the first time', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  world.files = { [`${TEAM_SESSIONS}/1.json`]: presence('s1', 'uat2-07', 'idle', NOW) }
  await clock.advance(POLL)

  expect(world.toasts).toEqual([])
  expect(await boardOf($)).toEqual(['🕐 uat2-07', '   waiting 0s'])
})

test('reads a presence file again only once it has changed', async ($, on) => {
  const { world, clock } = boot(on)
  const path = `${TEAM_SESSIONS}/1.json`
  world.files = { [path]: presence('s1', 'uat2-07', 'busy', NOW - MINUTE) }
  await start($, clock)
  await clock.advance(POLL * 3)

  expect(world.allReads.filter(read => read === path)).toHaveLength(1)

  world.files = { [path]: presence('s1', 'uat2-07', 'idle', NOW) }
  await clock.advance(POLL)

  expect(world.allReads.filter(read => read === path)).toHaveLength(2)
})

const SPIN = 100
const BEAT = 600

const peerIn = (status: string, since = NOW - MINUTE) => ({
  [`${TEAM_SESSIONS}/1.json`]: presence('s1', 'uat2-07', status, since),
})

test('spins a mark beside a working session, repainting it in place', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = peerIn('busy')
  await start($, clock)

  expect((await boardOf($))[0]).toBe('[spin]  uat2-07')

  await clock.advance(SPIN)
  await clock.advance(SPIN)
  const [first, second] = world.blits

  // One cell under the session's own key, a new frame each time, and no redraw.
  expect(world.blits).toHaveLength(2)
  expect(first).toMatchObject({ requestId: 'sessions', key: 'spin-s1', columns: 1, rows: 1 })
  expect(second?.key).toBe('spin-s1')
  expect(second?.cells).not.toBe(first?.cells)
  expect(world.redraws).toBe(0)
})

test('moves the clock of a waiting session an hour on with every beat, a redraw a beat', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = peerIn('idle')
  await start($, clock)

  expect((await boardOf($))[0]).toBe('🕐 uat2-07')

  await clock.advance(BEAT * 4)

  // An emoji cannot be repainted in place, so each beat draws the pane again.
  expect(world.redraws).toBe(4)
  expect(world.blits).toEqual([])
  expect((await boardOf($))[0]).toBe('🕔 uat2-07')

  await clock.advance(BEAT * 8)

  // Twelve beats bring the hand round to where it began.
  expect((await boardOf($))[0]).toBe('🕐 uat2-07')
})

test('washes a wave over the shell of a session in shell mode every fifth beat', async ($, on) => {
  const { clock, world } = boot(on)
  world.files = peerIn('shell')
  await start($, clock)

  expect((await boardOf($))[0]).toBe('🐚 uat2-07')

  await clock.advance(BEAT * 4)

  expect((await boardOf($))[0]).toBe('🌊 uat2-07')
})

test('keeps a session in a state it has no motion for still', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = peerIn('parked')
  await start($, clock)

  expect((await boardOf($))[0]).toBe('uat2-07')

  await clock.advance(BEAT * 10)

  expect(world.blits).toEqual([])
  expect(world.redraws).toBe(0)
})

test('asks for no redraw while only working sessions are listed', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = peerIn('busy')
  await start($, clock)
  await boardOf($)
  await clock.advance(BEAT * 5)

  expect(world.redraws).toBe(0)
})

test('keeps every icon still when the animation is switched off', { options: { animate: false } }, async ($, on) => {
  const { world, clock } = boot(on)
  world.files = {
    ...peerIn('busy'),
    [`${TEAM_SESSIONS}/2.json`]: presence('s2', 'done', 'idle', NOW),
  }
  await start($, clock)
  await clock.advance(BEAT * 4)

  expect((await boardOf($)).filter(line => !line.startsWith('   '))).toEqual(['🕐 done', '⏳ uat2-07'])
  expect(world.blits).toEqual([])
  expect(world.redraws).toBe(0)
})

test('draws a still hourglass on a surface that has no raster', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = peerIn('busy')
  await start($, clock)
  const ui = await $.ui.mount({ ...BOARD, surface: 'desktop' })
  const tree = (await ui.drawn()) as Drawn
  await ui.unmount()
  await clock.advance(SPIN * 5)

  expect(((tree.children ?? [])[0] as Drawn).children?.map(written).join('')).toBe('⏳ uat2-07')
  expect(world.blits).toEqual([])
})

test('stops all motion once the person has closed the pane', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = {
    ...peerIn('busy'),
    [`${TEAM_SESSIONS}/2.json`]: presence('s2', 'done', 'idle', NOW),
  }
  await start($, clock)
  await boardOf($)
  world.panes = []
  await clock.advance(POLL)
  const [spun, beaten] = [world.blits.length, world.redraws]
  await clock.advance(BEAT * 10)

  expect(world.blits).toHaveLength(spun)
  expect(world.redraws).toBe(beaten)
})

test('stops repainting a mark that is no longer on screen', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = peerIn('busy')
  world.blitDeny = 'no Raster of its own is mounted under that key'
  await start($, clock)
  await boardOf($)
  await clock.advance(SPIN * 10)

  // The first repaint is refused, so the mark is left alone until it is drawn again.
  expect(world.blits).toHaveLength(1)
})

test('keeps the lines of the pane two columns off its left edge, as the band stands', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = peerIn('idle')
  await start($, clock)
  const ui = await $.ui.mount({ ...BOARD, surface: 'terminal' })
  const tree = (await ui.drawn()) as Drawn
  await ui.unmount()

  expect(tree.props?.paddingLeft).toBe(2)
})

// One frame of a moving pet: thirty a second.
const PET = 33

const CRAB = CREATURES.crab

// Where the pet stands before it has walked: the middle of its raster.
const AT_HOME = { isHot: false, x: 4 }

// A session in a state the pane has no motion for, so that only the pet may move.
const STILL_PEER = () => peerIn('parked')

// The pet the pane draws under its list, if it draws one: its row and its raster.
const petIn = async ($: Engine, surface: 'terminal' | 'desktop' = 'terminal', bodyRows = 30) => {
  const ui = await $.ui.mount({ ...BOARD, props: { ...BOARD.props, scroll: { offset: 0, bodyRows } }, surface })
  const tree = (await ui.drawn()) as Drawn
  await ui.unmount()
  const row = (tree.children ?? []).at(-1) as Drawn | undefined
  const raster = (row?.children ?? [])[0] as Drawn | undefined

  return row !== undefined && raster?.type === 'Raster' && raster.props?.key === 'pet' ? { row, raster } : undefined
}

const petBlits = (world: { blits: { key: string; cells?: string }[] }) => world.blits.filter(blit => blit.key === 'pet')

const work = async ($: Engine, clock: MockClock, turnId = 't1') => {
  await $.turn.start({ text: 'hi', turnId })
  await clock.settle()
}

test('draws the pet asleep under the list of the pane, a row apart, dug in long since', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = STILL_PEER()
  await start($, clock)
  const pet = await petIn($)

  expect(pet?.row.props?.marginTop).toBe(1)
  expect(pet?.raster.props).toMatchObject({
    key: 'pet',
    columns: 24,
    rows: 8,
    cells: petFrame(CRAB, 'asleep', DIG_MS, AT_HOME).cells,
  })
})

test('draws the pet only where the pane has rows for the list, an empty row and the pet', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = STILL_PEER()
  await start($, clock)

  // One session is two rows; the pet is eight and stands a row apart.
  expect(await petIn($, 'terminal', 10)).toBeUndefined()
  expect(await petIn($, 'terminal', 11)).toBeDefined()
})

test('gives the list every row of a pane that has no room for the pet', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = {
    ...peerIn('parked'),
    [`${TEAM_SESSIONS}/2.json`]: presence('s2', 'second', 'parked', NOW),
    [`${TEAM_SESSIONS}/3.json`]: presence('s3', 'third', 'parked', NOW),
  }
  await start($, clock)
  const ui = await $.ui.mount({ ...BOARD, props: { ...BOARD.props, scroll: { offset: 0, bodyRows: 8 } }, surface: 'terminal' })
  const tree = (await ui.drawn()) as Drawn
  await ui.unmount()

  // Three sessions are eight rows, and all three are named.
  expect((tree.children ?? []).map(row => ((row as Drawn).children ?? []).map(written).join('')).join('|')).not.toContain('more')
  expect(tree.children ?? []).toHaveLength(8)
})

test('leaves the pet out when the person switched it off', { options: { pet: 'off' } }, async ($, on) => {
  const { world, clock } = boot(on)
  world.files = STILL_PEER()
  await start($, clock)
  await work($, clock)
  await clock.advance(PET * 5)

  expect(await petIn($)).toBeUndefined()
  expect(petBlits(world)).toEqual([])
})

test('draws the creature the person chose', { options: { pet: 'cat' } }, async ($, on) => {
  const { world, clock } = boot(on)
  world.files = STILL_PEER()
  await start($, clock)

  expect((await petIn($))?.raster.props?.cells).toBe(petFrame(CREATURES.cat, 'asleep', 0, AT_HOME).cells)
})

test('leaves the pet out on a surface that has no raster', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = STILL_PEER()
  await start($, clock)

  expect(await petIn($, 'desktop')).toBeUndefined()
})

test('paints nothing of the pet while the session is idle', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = STILL_PEER()
  await start($, clock)
  await petIn($)
  await clock.advance(10_000)

  expect(petBlits(world)).toEqual([])
})

test('walks the pet while Claude works, repainting it in place', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = STILL_PEER()
  await start($, clock)
  await petIn($)
  await work($, clock)
  await clock.advance(PET)
  await clock.advance(PET)

  expect(petBlits(world)).toHaveLength(2)
  expect(petBlits(world)[0]).toMatchObject({ requestId: 'sessions', key: 'pet', columns: 24, rows: 8 })
  expect(petBlits(world).map(blit => blit.cells)).toEqual([
    petFrame(CRAB, 'working', PET, AT_HOME).cells,
    petFrame(CRAB, 'working', PET * 2, AT_HOME).cells,
  ])
})

test('draws the pet in the middle of its walk when the pane is drawn while Claude works', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = STILL_PEER()
  await start($, clock)
  await work($, clock)
  await clock.advance(800)

  expect((await petIn($))?.raster.props?.cells).toBe(petFrame(CRAB, 'working', 800, AT_HOME).cells)
})

test("keeps the pet's walk going when a subagent's turn starts", async ($, on) => {
  const { world, clock } = boot(on)
  world.files = STILL_PEER()
  await start($, clock)
  await petIn($)
  await work($, clock)
  await clock.advance(PET * 24)
  await work($, clock, 't2')
  await clock.advance(PET)

  expect(petBlits(world).at(-1)?.cells).toBe(petFrame(CRAB, 'working', PET * 25, AT_HOME).cells)
})

test('hops when the turn ends, digs in where it stopped, and is painted no more once it sleeps', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = STILL_PEER()
  await start($, clock)
  await petIn($)
  await work($, clock)
  await clock.advance(PET * 12)
  await $.turn.complete({ ...TURN, durationMs: 396 })
  await clock.settle()
  await clock.advance(PET)
  // Twelve frames of walking are two steps, which took it two pixels on.
  const there = { isHot: false, x: 6 }

  expect(petBlits(world).at(-1)?.cells).toBe(petFrame(CRAB, 'done', PET, there).cells)

  await clock.advance(HOPS_MS)

  expect(petBlits(world).at(-1)?.cells).toBe(petFrame(CRAB, 'asleep', 0, there).cells)

  await clock.advance(DIG_MS)

  expect(petBlits(world).at(-1)?.cells).toBe(petFrame(CRAB, 'asleep', DIG_MS, there).cells)

  const painted = petBlits(world).length
  await clock.advance(10_000)

  expect(petBlits(world)).toHaveLength(painted)
})

test('starts the next walk from where the pet fell asleep', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = STILL_PEER()
  await start($, clock)
  await petIn($)
  await work($, clock)
  await clock.advance(PET * 12)
  await $.turn.complete({ ...TURN, durationMs: 396 })
  await clock.settle()
  await clock.advance(HOPS_MS + PET)
  await work($, clock, 't2')
  await clock.advance(PET)

  expect(petBlits(world).at(-1)?.cells).toBe(petFrame(CRAB, 'working', PET, { isHot: false, x: 6 }).cells)
})

test("does not hop when a subagent's turn ends", async ($, on) => {
  const { world, clock } = boot(on)
  world.files = STILL_PEER()
  await start($, clock)
  await petIn($)
  await work($, clock)
  await clock.advance(PET * 2)
  await $.turn.complete({ ...TURN, turnId: 't2', agentId: 'a1', durationMs: 100 })
  await clock.settle()
  await clock.advance(PET)

  expect(petBlits(world).at(-1)?.cells).toBe(petFrame(CRAB, 'working', PET * 3, AT_HOME).cells)
})

test('stands the pet awake and sweating when the five-hour limit is nearly spent', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = STILL_PEER()
  world.usage = {
    ...world.usage,
    rateLimits: world.usage.rateLimits.map(limit => (limit.kind === 'five_hour' ? { ...limit, percentUsed: 91 } : limit)),
  }
  await start($, clock)

  expect((await petIn($))?.raster.props?.cells).toBe(petFrame(CRAB, 'asleep', 0, { isHot: true, x: 4 }).cells)
})

test('stops walking the pet once its pane is gone, and walks it again when the pane is back', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = STILL_PEER()
  await start($, clock)
  await petIn($)
  world.blitDeny = 'no Raster of its own is mounted under that key'
  await work($, clock)
  await clock.advance(PET * 5)

  // The first repaint is refused, so the pet is left alone until it is drawn again.
  expect(petBlits(world)).toHaveLength(1)

  world.blitDeny = ''
  await petIn($)
  await clock.advance(PET)

  expect(petBlits(world)).toHaveLength(2)
})

test(
  'shows the pet awake but still while Claude works when the animation is switched off',
  { options: { animate: false } },
  async ($, on) => {
    const { world, clock } = boot(on)
    world.files = STILL_PEER()
    await start($, clock)
    await petIn($)
    const drawn = world.redraws
    await work($, clock)
    await clock.advance(PET * 10)

    // No frame is painted: the pane is drawn again once, with the pet awake.
    expect(petBlits(world)).toEqual([])
    expect(world.redraws).toBe(drawn + 1)
    expect((await petIn($))?.raster.props?.cells).toBe(petFrame(CRAB, 'working', 0, AT_HOME).cells)

    await $.turn.complete({ ...TURN, durationMs: 800 })
    await clock.settle()

    // Without animation there is no digging to show: it lies dug in at once.
    expect((await petIn($))?.raster.props?.cells).toBe(petFrame(CRAB, 'asleep', DIG_MS, AT_HOME).cells)
  },
)

// Starts a Bash call that waits for the person's answer, and opens its prompt.
const askPerson = async ($: Engine, clock: MockClock, world: { held: Promise<void> }) => {
  let answer = () => {}
  world.held = new Promise<void>(done => {
    answer = done
  })
  const call = $.tool.call({ tool: 'Bash', command: 'rm -r build' })
  await clock.settle()
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -r build' } })
  await clock.settle()

  return async () => {
    answer()
    await call
    await clock.settle()
  }
}

// Six frames of walking are a step, which took it a pixel on from home.
const A_STEP_ON = { isHot: false, x: 5 }

test('waves the pet under a question mark while a prompt waits for the person, and walks on once it is answered', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = STILL_PEER()
  await start($, clock)
  await petIn($)
  await work($, clock)
  await clock.advance(PET * 6)
  const answer = await askPerson($, clock, world)
  await clock.advance(PET)

  expect(petBlits(world).at(-1)?.cells).toBe(petFrame(CRAB, 'waiting', PET, A_STEP_ON).cells)

  await clock.advance(PET * 12)

  // It goes on waving while nobody answers.
  expect(petBlits(world).at(-1)?.cells).toBe(petFrame(CRAB, 'waiting', PET * 13, A_STEP_ON).cells)

  await answer()
  await clock.advance(PET)

  expect(petBlits(world).at(-1)?.cells).toBe(petFrame(CRAB, 'working', PET, A_STEP_ON).cells)
})

test('keeps the pet waiting when some other call ends before the prompt is answered', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = STILL_PEER()
  await start($, clock)
  await petIn($)
  await work($, clock)
  await clock.advance(PET * 6)
  await askPerson($, clock, world)
  await $.tool.call({ tool: 'Read', file_path: 'notes.md' })
  await clock.settle()
  await clock.advance(PET)

  expect(petBlits(world).at(-1)?.cells).toBe(petFrame(CRAB, 'waiting', PET, A_STEP_ON).cells)
})

test("keeps the pet waiting when a subagent's turn starts", async ($, on) => {
  const { world, clock } = boot(on)
  world.files = STILL_PEER()
  await start($, clock)
  await petIn($)
  await work($, clock)
  await clock.advance(PET * 6)
  await askPerson($, clock, world)
  await work($, clock, 't2')
  await clock.advance(PET)

  expect(petBlits(world).at(-1)?.cells).toBe(petFrame(CRAB, 'waiting', PET, A_STEP_ON).cells)
})

test('hops when the turn ends while a prompt waits, as when the person turns it down', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = STILL_PEER()
  await start($, clock)
  await petIn($)
  await work($, clock)
  await clock.advance(PET * 6)
  await askPerson($, clock, world)
  await $.turn.complete({ ...TURN, durationMs: 400 })
  await clock.settle()
  await clock.advance(PET)

  expect(petBlits(world).at(-1)?.cells).toBe(petFrame(CRAB, 'done', PET, A_STEP_ON).cells)
})

test('does not wait when a hook beneath answered the permission request, so no prompt opened', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = STILL_PEER()
  world.permission = { decision: { behavior: 'allow' } }
  await start($, clock)
  await petIn($)
  await work($, clock)
  await clock.advance(PET * 6)
  await askPerson($, clock, world)
  await clock.advance(PET)

  expect(petBlits(world).at(-1)?.cells).toBe(petFrame(CRAB, 'working', PET * 7, AT_HOME).cells)
})

test('lays the pet on its back once the five-hour limit is spent, and paints it no more', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = STILL_PEER()
  world.usage = {
    ...world.usage,
    rateLimits: world.usage.rateLimits.map(limit => (limit.kind === 'five_hour' ? { ...limit, percentUsed: 100 } : limit)),
  }
  await start($, clock)
  const spent = { isHot: true, isSpent: true, x: 4 }

  expect((await petIn($))?.raster.props?.cells).toBe(petFrame(CRAB, 'asleep', 0, spent).cells)

  await work($, clock)
  await clock.advance(PET * 10)

  expect(petBlits(world)).toEqual([])
  expect((await petIn($))?.raster.props?.cells).toBe(petFrame(CRAB, 'working', 0, spent).cells)
})

// ── The Status tab ──────────────────────────────────────────────────────────

const STATUS_TAB = {
  ...BOARD,
  requestId: 'status',
  props: { ...BOARD.props, title: 'Status', bodyColumns: 32, scroll: { offset: 0, bodyRows: 40 } },
} as const

const BAND_CMD = {
  command: 'band',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 150 },
} as const

// The lines of the Status tab, each slice of an upright bar written as its width.
const tabOf = async ($: Engine) => {
  const ui = await $.ui.mount({ ...STATUS_TAB, surface: 'terminal' })
  const tree = (await ui.drawn()) as Drawn
  await ui.unmount()

  return { tree, lines: (tree.children ?? []).map(row => ((row as Drawn).children ?? []).map(written).join('')) }
}

const openedIds = (world: { opened: { id: string }[] }) => world.opened.map(pane => pane.id)

test('opens a Status tab at the start of a session, 32 columns wide', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)

  expect(world.opened).toEqual([{ id: 'status', title: 'Status', columns: 32 }])
})

test('opens the Status tab after the Sessions pane, so that it is the tab in front', async ($, on) => {
  const { world, clock } = boot(on)
  world.files = { [`${TEAM_SESSIONS}/1.json`]: presence('s1', 'uat2-07', 'idle', NOW - MINUTE) }
  await start($, clock)

  expect(openedIds(world)).toEqual(['sessions', 'status'])
})

test('opens no Status tab while the option is off', { options: { tab: false } }, async ($, on) => {
  const { world, clock } = boot(on)
  world.canDock = true
  await start($, clock)

  expect(openedIds(world)).toEqual([])
  expect(await rowsOf($)).toHaveLength(7)
})

test('draws the status in its tab, two columns off its left edge', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const { tree, lines } = await tabOf($)

  expect(lines.slice(0, 5)).toEqual([
    '🤖 Opus 5.5 ⚡xhigh',
    '🎨 Explanatory',
    '📂 ~\\project',
    '🌿 main · ✅ clean · 🐍 no env',
    '💰 $ 1.23 · ⏰ 1h2m',
  ])
  expect(lines.filter(line => line === '[bar 5]   [bar 5]   [bar 5]   [bar 5]')).toHaveLength(11)
  expect(lines.at(-1)).toBe('🧠 86k / 200k tokens')
  expect(tree.props?.paddingLeft).toBe(2)
})

test('says the Status tab is loading before the first reading', async ($, on) => {
  boot(on)

  expect((await tabOf($)).lines).toEqual(['(loading..)'])
})

test('registers /band, and opens the Status tab again with it once the person closed it', async ($, on) => {
  const { world, clock } = boot(on)
  world.canDock = true
  await start($, clock)

  // The person closes it: Claude Code no longer lists it among the open panes.
  world.panes = world.panes.filter(id => id !== 'status')
  await clock.advance(POLL * 3)

  expect(openedIds(world)).toEqual(['status'])
  expect(world.commands).toContain('band')

  expect(await $.command.run(BAND_CMD)).toEqual({ text: 'Status tab opened.' })
  expect(openedIds(world)).toEqual(['status', 'status'])
})

test('says to widen the terminal when /band cannot place the Status tab', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)

  expect(await $.command.run(BAND_CMD)).toEqual({ text: 'Status tab: widen the terminal to see it.' })
})

test('brings the Status tab to the front with /band when it is behind another pane', async ($, on) => {
  const { world, clock } = boot(on)
  world.canDock = true
  await start($, clock)
  world.isBehind = true

  await $.command.run(BAND_CMD)

  expect(world.closed).toEqual(['status'])
  expect(openedIds(world)).toEqual(['status', 'status'])
})

// The bottom row of the 5H bar in the Status tab: the first bar of the last line that has bars.
const bottomOf5H = async ($: Engine) => {
  const ui = await $.ui.mount({ ...STATUS_TAB, surface: 'terminal' })
  const tree = (await ui.drawn()) as Drawn
  await ui.unmount()
  const bars = (tree.children ?? [])
    .map(row => ((row as Drawn).children ?? []).map(runsOf).find(runs => runs !== undefined))
    .filter(runs => runs !== undefined)

  return bars.at(-1)?.[0]
}

test('leaves the band to Claude Code while the Status tab is on screen', async ($, on) => {
  const { world, clock } = boot(on)
  world.canDock = true
  await start($, clock)
  await tabOf($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: 'engine' }))?.type).toBe('Text')
  expect(await ui.find({ type: 'Text', text: /Context/ })).toBeUndefined()
})

test('leaves the line under the prompt to Claude Code while the Status tab is on screen', BELOW, async ($, on) => {
  const { world, clock } = boot(on)
  world.canDock = true
  await start($, clock)
  await tabOf($)
  const ui = await $.ui.mount({ ...HINT, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: 'engine hint' }))?.type).toBe('Text')
})

test('keeps the band until the Status tab has been drawn in the dock', async ($, on) => {
  const { world, clock } = boot(on)
  world.canDock = true
  await start($, clock)

  expect(await rowsOf($)).toHaveLength(7)
})

const INLINE_TAB = { ...STATUS_TAB, props: { ...STATUS_TAB.props, placement: 'inline' } } as const

test('closes the Status pane and keeps the band where the pane is seated inline above the prompt', async ($, on) => {
  const { world, clock } = boot(on)
  world.canDock = true
  await start($, clock)
  const ui = await $.ui.mount({ ...INLINE_TAB, surface: 'terminal' })
  await ui.drawn()
  await ui.unmount()
  await clock.advance(POLL * 3)

  expect(world.closed).toEqual(['status'])
  expect(await rowsOf($)).toHaveLength(7)
  // Not taken for the person's close, and not opened again into the same place.
  expect(openedIds(world)).toEqual(['status'])
})

test('says what /band needs where the side pane cannot dock, and opens nothing', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  const needs = { text: 'Status tab: the side pane needs a fullscreen terminal at least 110 columns wide.' }

  expect(await $.command.run({ ...BAND_CMD, presentation: { isFullscreen: false, columns: 150 } })).toEqual(needs)
  expect(await $.command.run({ ...BAND_CMD, presentation: { isFullscreen: true, columns: 100 } })).toEqual(needs)
  expect(openedIds(world)).toEqual(['status'])
})

test('closes a Status tab left open once the option is turned off', { options: { tab: false } }, async ($, on) => {
  const { world, clock } = boot(on)
  world.canDock = true
  // A reload keeps the panes: the tab opened before the option was turned off is still up.
  world.panes = ['status']
  await start($, clock)

  expect(world.closed).toEqual(['status'])
  expect(await rowsOf($)).toHaveLength(7)
})

test('says the Status tab is off when /band is asked for while the option is off', { options: { tab: false } }, async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)

  expect(await $.command.run(BAND_CMD)).toEqual({ text: 'Status tab is off: switch "Status tab" on in /config.' })
  expect(openedIds(world)).toEqual([])
})

test('draws the band as before where the Status tab cannot be placed', async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)

  expect(await rowsOf($)).toHaveLength(7)
})

test('brings the band back for the session once the person closes the Status tab', async ($, on) => {
  const { world, clock } = boot(on)
  world.canDock = true
  await start($, clock)
  await tabOf($)
  await clock.settle()
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect((await band.find({ type: 'Text', text: 'engine' }))?.type).toBe('Text')

  await band.unmount()
  const drawn = world.redraws
  world.panes = world.panes.filter(id => id !== 'status')
  await clock.advance(POLL)

  expect(await rowsOf($)).toHaveLength(7)
  expect(world.redraws).toBeGreaterThan(drawn)
})

test('sweeps a glint up the bars of the tab once a reading has changed, then rests', async ($, on) => {
  const { world, clock } = boot(on)
  world.canDock = true
  await start($, clock)
  const plain = await bottomOf5H($)
  await clock.advance(SETTLE + FRAME)

  expect((await bottomOf5H($))?.color).not.toBe(plain?.color)

  await clock.advance(FRAME * 20)

  expect(await bottomOf5H($)).toEqual(plain)
})

// ── Lent to the Deck ────────────────────────────────────────────────────────

const plainRows = (rows: readonly (readonly { text: string }[])[]) => rows.map(row => row.map(run => run.text).join(''))

// A stand-in for the Deck: it asks for the limits panel on a command, and hosts
// status-band on another, answering with what it got back.
const DECK: Plugin = {
  name: 'deck',
  register(on) {
    on('command.run', { command: 'limits' }, async ($, e) => ({
      text: JSON.stringify(await $.statusBand.panel({ id: 'limits', columns: Number(e.args) })),
    }))
    on('command.run', { command: 'deck-sessions' }, async ($, e) => ({
      text: JSON.stringify(await $.statusBand.panel({ id: 'sessions', columns: Number(e.args), rows: 8 })),
    }))
    on('command.run', { command: 'host' }, async ($, e) => ({
      text: String(await $.statusBand.host({ by: 'deck', isDocked: e.args === 'docked' })),
    }))
  },
}

const ask = async ($: Engine, command: string, args: string) =>
  (await $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 150 } })) as { text: string }

const lent = async ($: Engine, columns: number) => JSON.parse((await ask($, 'limits', String(columns))).text) as StatusBandPanel

test('lends its limits panel to another mod through $.statusBand.panel', { plugins: [DECK] }, async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const panel = await lent($, 43)

  expect(panel.title).toBe('limits')
  expect(panel.right).toBe('$ 1.23 · 1h2m')
  expect(plainRows(panel.rows).at(-1)).toBe('~\\project · main')
})

test('lends a loading panel before its first reading', { plugins: [DECK] }, async ($, on) => {
  boot(on)

  expect(plainRows((await lent($, 43)).rows)).toEqual(['(loading..)'])
})

const engineBand = async ($: Engine) => {
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const found = await band.find({ type: 'Text', text: 'engine' })
  await band.unmount()

  return found !== undefined
}

test('answers a host with true', { plugins: [DECK] }, async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)

  expect((await ask($, 'host', 'docked')).text).toBe('true')
})

test('a host keeps the Status tab from opening at the start of a session', { plugins: [DECK] }, async ($, on) => {
  const { world, clock } = boot(on)
  world.canDock = true
  await ask($, 'host', 'docked')
  await start($, clock)
  await clock.advance(POLL * 3)

  expect(openedIds(world)).not.toContain('status')
})

test('a host closes a Status tab that is open, and it stays closed', { plugins: [DECK] }, async ($, on) => {
  const { world, clock } = boot(on)
  world.canDock = true
  await start($, clock)

  expect(world.panes).toContain('status')

  await ask($, 'host', 'docked')
  await clock.advance(POLL * 3)

  expect(world.closed).toContain('status')
  expect(world.panes).not.toContain('status')
  expect(openedIds(world)).toEqual(['status'])
})

test('while the host is docked the band gives its place back', { plugins: [DECK] }, async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)

  expect(await rowsOf($)).toHaveLength(7)

  await ask($, 'host', 'docked')

  expect(await engineBand($)).toBe(true)
})

test('while the host is not docked the band stands, and the Status tab stays closed', { plugins: [DECK] }, async ($, on) => {
  const { world, clock } = boot(on)
  world.canDock = true
  await start($, clock)
  await ask($, 'host', 'docked')
  await ask($, 'host', 'undocked')
  await clock.advance(POLL * 3)

  expect(await rowsOf($)).toHaveLength(7)
  expect(world.panes).not.toContain('status')
})

test('a host outlasts /clear', { plugins: [DECK] }, async ($, on) => {
  const { world, clock } = boot(on)
  world.canDock = true
  await start($, clock)
  await ask($, 'host', 'docked')
  await $.classic.SessionStart({ source: 'clear' })
  await clock.advance(POLL * 3)

  expect(world.panes).not.toContain('status')
  expect(await engineBand($)).toBe(true)
})

test('/band says where the status is while a host has it', { plugins: [DECK] }, async ($, on) => {
  const { world, clock } = boot(on)
  world.canDock = true
  await start($, clock)
  await ask($, 'host', 'docked')

  expect(await $.command.run(BAND_CMD)).toEqual({ text: 'Status is in the Deck: /deck limits' })
  expect(world.panes).not.toContain('status')
})

const SESSIONS_CMD = { ...BAND_CMD, command: 'sessions' } as const

test('lends the sessions panel through $.statusBand.panel', { plugins: [DECK] }, async ($, on) => {
  const { world, clock } = boot(on)
  world.files = { [`${TEAM_SESSIONS}/1.json`]: presence('s1', 'uat2-07', 'idle', NOW - MINUTE) }
  await start($, clock)
  await clock.advance(POLL)
  const panel = JSON.parse((await ask($, 'deck-sessions', '43')).text) as StatusBandPanel

  expect(panel.title).toBe('sessions')
  expect(plainRows(panel.rows)[0]?.startsWith('○ uat2-07')).toBe(true)
})

test('a host keeps the Sessions pane from opening while other sessions are open', { plugins: [DECK] }, async ($, on) => {
  const { world, clock } = boot(on)
  world.files = { [`${TEAM_SESSIONS}/1.json`]: presence('s1', 'uat2-07', 'idle', NOW - MINUTE) }
  await ask($, 'host', 'docked')
  await start($, clock)
  await clock.advance(POLL * 3)

  expect(openedIds(world)).not.toContain('sessions')
})

test('a host closes the Sessions pane that is open', { plugins: [DECK] }, async ($, on) => {
  const { world, clock } = boot(on)
  world.files = { [`${TEAM_SESSIONS}/1.json`]: presence('s1', 'uat2-07', 'idle', NOW - MINUTE) }
  await start($, clock)
  await clock.advance(POLL)

  expect(world.panes).toContain('sessions')

  await ask($, 'host', 'docked')
  await clock.advance(POLL * 3)

  expect(world.panes).not.toContain('sessions')
})

test('/sessions says where the sessions are while a host has them', { plugins: [DECK] }, async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await ask($, 'host', 'docked')

  expect(await $.command.run(SESSIONS_CMD)).toEqual({ text: 'Sessions are in the Deck: /deck sessions' })
  expect(world.panes).not.toContain('sessions')
})
