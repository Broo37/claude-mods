import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'

const NOW = new Date(2026, 9, 22, 12, 0).getTime()

type Drawn = { type: string; props?: Record<string, unknown>; children?: unknown[] }

type Host = { plugin: string; by: string; isDocked: boolean }

// Stand-ins for Clean View and status-band. Each runs in a sandbox of its own,
// so it holds its panel itself, reads from the environment which way to answer
// ('idle', 'failing'), and reports each host it is asked for as a toast.
const CLEAN_VIEW: Plugin = {
  name: 'clean-view',
  register(on) {
    const plan = {
      id: 'plan' as const,
      title: 'plan',
      right: '',
      label: [{ text: '▶ 2/4 · 1m 12s' }],
      rows: [[{ text: '▶ 🔨 Build the pricing section' }]],
      isLive: true,
    }

    on('engine.create', async ($, e, next) => ({
      ...(await next(e)),
      cleanView: { panel: async () => plan, host: async () => false },
    }))
    on('cleanView.panel', async $ => {
      const way = await $.env.get('DECK_PLAN')

      if (way === 'failing') {
        return { deny: 'reloading' }
      }

      return { value: way === 'idle' ? { ...plan, label: [{ text: 'idle' }], rows: [], isLive: false } : plan }
    })
    on('command.run', { command: 'touch-plan' }, async $ => {
      await $.state.set({ plugin: 'clean-view', key: 'checklist' }, { phase: 'working' } as never)

      return { text: 'touched' }
    })
    // Like the real mod, it keeps its host in its state: a write a drawing may not make.
    on('cleanView.host', async ($, e) => {
      await $.state.set({ plugin: 'clean-view', key: 'host' }, { by: e.by, isDocked: e.isDocked })
      await $.ui.toast(`host clean-view ${e.by} ${e.isDocked ? 'docked' : 'undocked'}`)

      return { value: true }
    })
  },
}

const STATUS_BAND: Plugin = {
  name: 'status-band',
  register(on) {
    const limits = {
      id: 'limits' as const,
      title: 'limits',
      right: '$ 0.42 · 3m',
      label: [{ text: 'Opus 5.5', isBold: true }, { text: ' xhigh' }],
      rows: [[{ text: '5H  ████ 66%' }], [{ text: 'master !1', isDim: true }]],
    }
    const sessions = {
      id: 'sessions' as const,
      title: 'sessions',
      right: '2 open',
      label: [],
      rows: [[{ text: '○ geisa-pk  waiting 29m' }], [{ text: '● claude-mods  working 4m' }]],
    }

    on('engine.create', async ($, e, next) => ({
      ...(await next(e)),
      statusBand: { panel: async () => limits, host: async () => false },
    }))
    on('statusBand.panel', async ($, e) => {
      if (e.id === 'sessions') {
        return { value: (await $.env.get('DECK_SESSIONS')) === 'none' ? { ...sessions, rows: [] } : sessions }
      }

      // A hook that throws is skipped and the method beneath answers; a refusal reaches the caller.
      if ((await $.env.get('DECK_LIMITS')) === 'failing') {
        return { deny: 'reloading' }
      }

      return { value: limits }
    })
    on('command.run', { command: 'touch-view' }, async $ => {
      await $.state.set({ plugin: 'status-band', key: 'view' }, { now: 1 } as never)

      return { text: 'touched' }
    })
    on('statusBand.host', async ($, e) => {
      await $.state.set({ plugin: 'status-band', key: 'host' }, { by: e.by, isDocked: e.isDocked })
      await $.ui.toast(`host status-band ${e.by} ${e.isDocked ? 'docked' : 'undocked'}`)

      return { value: true }
    })
  },
}

const TOOL_WATERFALL: Plugin = {
  name: 'tool-waterfall',
  register(on) {
    const timeline = {
      id: 'timeline' as const,
      title: 'this turn',
      right: '41s… · 2 tools',
      label: [],
      rows: [[{ text: '0s─────41s' }], [{ text: 'Read  ██' }]],
      isLive: true,
    }

    on('engine.create', async ($, e, next) => ({
      ...(await next(e)),
      toolWaterfall: { panel: async () => timeline, host: async () => false },
    }))
    on('toolWaterfall.panel', async $ => {
      const way = await $.env.get('DECK_TIMELINE')

      return {
        value: way === 'none' ? { ...timeline, rows: [], isLive: false } : way === 'still' ? { ...timeline, isLive: false } : timeline,
      }
    })
    on('toolWaterfall.host', async ($, e) => {
      await $.state.set({ plugin: 'tool-waterfall', key: 'host' }, { by: e.by, isDocked: e.isDocked })
      await $.ui.toast(`host tool-waterfall ${e.by} ${e.isDocked ? 'docked' : 'undocked'}`)

      return { value: true }
    })
  },
}

const OWNERS = { plugins: [CLEAN_VIEW, STATUS_BAND, TOOL_WATERFALL] }

const ALL = ['clean-view', 'status-band', 'tool-waterfall']

// The stubs beneath the mods: they answer in Claude Code's place.
const boot = (on: On, env: Record<string, string> = {}) => {
  const world = {
    opened: [] as string[],
    closed: [] as string[],
    panes: [] as string[],
    commands: [] as string[],
    toasts: [] as string[],
    redraws: 0,
  }
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, env)

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('command.register', ($, e) => {
    world.commands.push(e.name)

    return { value: { command: e.name } }
  })
  on('command.run', () => ({ text: 'no such command' }))
  on('ui.toast', ($, e) => {
    world.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.invalidate', () => {
    world.redraws += 1

    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    world.opened.push(e.id)
    world.panes = [...world.panes.filter(id => id !== e.id), e.id]

    return { value: { isPlaced: true as const } }
  })
  on('ui.close', ($, e) => {
    world.closed.push(e.id)
    world.panes = world.panes.filter(id => id !== e.id)

    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: world.panes.map(id => ({ id, title: id, isShown: id === world.panes.at(-1), isFocused: false, isPlaced: true })),
  }))
  on('ui.render', { component: 'Pane' }, () => ({ type: 'Text', props: {}, children: ['engine pane'] }))

  return { world, clock }
}

type World = ReturnType<typeof boot>['world']

// The hosts the two mods were asked for, as they reported them.
const hostsOf = (world: World): Host[] =>
  world.toasts.flatMap(text => {
    const [word, plugin = '', by = '', where = ''] = text.split(' ')

    return word === 'host' ? [{ plugin, by, isDocked: where === 'docked' }] : []
  })

// How long after the start of a session the Deck opens: after the other tabs.
const OPEN_AFTER_MS = 2000

// How long the Deck takes to tell both mods where it was last drawn.
const SYNC_MS = 250

const start = async ($: Engine, clock: MockClock) => {
  await $.session.start({ cwd: 'C:\\work', surface: 'terminal', isInteractive: true })
  await clock.settle()
}

const deck = async ($: Engine, clock: MockClock, args = '', isFullscreen = true, command = 'deck') => {
  const answer = await $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen, columns: 150 } })
  await clock.settle()

  return answer
}

const textOf = (node: unknown): string => {
  if (typeof node === 'string') {
    return node
  }

  return typeof node === 'object' && node !== null ? ((node as Drawn).children ?? []).map(textOf).join('') : ''
}

// The Deck as the lines it draws: the header, then each box's lines.
const linesOf = (node: unknown): string[] => {
  const drawn = node as Drawn

  if (drawn.type === 'Text') {
    return [textOf(drawn)]
  }

  const children = drawn.children ?? []
  const isRow = drawn.props?.flexDirection !== 'column'

  return isRow ? [children.map(textOf).join('')] : children.flatMap(linesOf)
}

const mountDeck = async ($: Engine, surface: 'terminal' | 'desktop' = 'terminal', placement: 'dock' | 'inline' = 'dock') => {
  const ui = await $.ui.mount({
    plugin: 'deck',
    component: 'Pane',
    requestId: 'deck',
    surface,
    props: { title: 'Deck', isFocused: false, bodyColumns: 47, placement, scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as Parameters<Engine['ui']['mount']>[0])
  const tree = (await ui.drawn()) as Drawn
  await ui.unmount()

  return tree
}

const docks = (world: World, isDocked: boolean) =>
  hostsOf(world).filter(host => host.isDocked === isDocked).map(host => host.plugin).sort()

test('opens at the start of a session, after the other tabs so that it is in front, and hosts both mods, not yet docked', OWNERS, async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)

  expect(world.opened).toEqual([])

  await clock.advance(OPEN_AFTER_MS)

  expect(world.opened).toEqual(['deck'])
  expect(world.commands).toEqual(['deck'])
  expect(docks(world, false)).toEqual(ALL)
  expect(hostsOf(world).every(host => host.by === 'deck')).toBe(true)
})

test('stays closed at the start of a session while Open at start is off', { ...OWNERS, options: { openOnStart: false } }, async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await clock.advance(OPEN_AFTER_MS)

  expect(world.opened).toEqual([])
  expect(docks(world, false)).toEqual(ALL)
})

test('tells both mods once that it is docked, when it is first drawn in the dock', OWNERS, async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await mountDeck($)
  await mountDeck($)
  await clock.advance(SYNC_MS * 4)

  expect(docks(world, true)).toEqual(ALL)
})

test('draws its header, then the plan box, then the limits box', OWNERS, async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const lines = linesOf(await mountDeck($))

  expect(lines).toEqual([
    'DECK · Opus 5.5 xhigh · ▶ 2/4 · 1m 12s',
    'plan',
    '▶ 🔨 Build the pricing section',
    'limits$ 0.42 · 3m',
    '5H  ████ 66%',
    'master !1',
    'this turn41s… · 2 tools',
    '0s─────41s',
    'Read  ██',
    'sessions2 open',
    '○ geisa-pk  waiting 29m',
    '● claude-mods  working 4m',
  ])
})

test('draws each panel in a round box with a cell of room each side', OWNERS, async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const boxes = ((await mountDeck($)).children ?? []).slice(1) as Drawn[]

  expect(boxes).toHaveLength(4)
  expect(boxes.every(box => box.props?.borderStyle === 'round' && box.props?.paddingX === 1)).toBe(true)
})

test('leaves out a panel with no rows, and keeps its label in the header', OWNERS, async ($, on) => {
  const { clock } = boot(on, { DECK_PLAN: 'idle' })
  await start($, clock)
  const lines = linesOf(await mountDeck($))

  expect(lines[0]).toBe('DECK · Opus 5.5 xhigh · idle')
  expect(lines).not.toContain('plan')
})

test('puts the limits on top with /deck limits', OWNERS, async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)

  expect(await deck($, clock, 'limits')).toEqual({ text: 'Deck: limits on top.' })
  expect(linesOf(await mountDeck($)).slice(1, 2)).toEqual(['limits$ 0.42 · 3m'])
})

test('closes with /deck while in front, and opens again with the next /deck', OWNERS, async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await clock.advance(OPEN_AFTER_MS)
  await mountDeck($)

  expect(await deck($, clock)).toEqual({ text: 'Deck closed.' })
  expect(world.panes).toEqual([])
  expect(hostsOf(world).at(-1)?.isDocked).toBe(false)

  expect(await deck($, clock)).toEqual({ text: 'Deck opened.' })
  expect(world.panes).toEqual(['deck'])
})

test('brings itself to the front with /deck while behind another tab', OWNERS, async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  world.panes = ['deck', 'status']

  expect(await deck($, clock)).toEqual({ text: 'Deck opened.' })
  expect(world.closed).toEqual(['deck'])
  expect(world.panes.at(-1)).toBe('deck')
})

test('says how to use /deck when asked for something else', OWNERS, async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)

  expect(await deck($, clock, 'everything')).toEqual({ text: 'Usage: /deck [plan|limits|timeline|sessions]' })
})

test('says what /deck needs where the side pane cannot dock', OWNERS, async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  world.opened = []

  expect(await deck($, clock, '', false)).toEqual({
    text: 'Deck: the side pane needs a fullscreen terminal at least 110 columns wide.',
  })
  expect(world.opened).toEqual([])
})

test('draws the other panel and says which one is not available when its mod throws', OWNERS, async ($, on) => {
  const { clock } = boot(on, { DECK_LIMITS: 'failing' })
  await start($, clock)
  const lines = linesOf(await mountDeck($))

  expect(lines).toContain('▶ 🔨 Build the pricing section')
  expect(lines).toContain('limits: not available')
})

test('seated inline above the prompt, closes itself and tells both mods it is not docked', OWNERS, async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await clock.advance(OPEN_AFTER_MS)
  await mountDeck($)
  await clock.advance(SYNC_MS)
  world.toasts = []
  await mountDeck($, 'terminal', 'inline')
  await clock.advance(SYNC_MS)

  expect(world.panes).toEqual([])
  expect(docks(world, false)).toEqual(ALL)
})

test('hosts both mods again after /clear, as docked as it was', OWNERS, async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await mountDeck($)
  await clock.advance(SYNC_MS)
  world.toasts = []
  await $.classic.SessionStart({ source: 'clear' })
  await clock.settle()

  expect(docks(world, true)).toEqual(ALL)
})

test('redraws when the checklist or the status changes', OWNERS, async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  const before = world.redraws
  await deck($, clock, '', true, 'touch-plan')
  await deck($, clock, '', true, 'touch-view')

  expect(world.redraws).toBe(before + 2)
})

test('draws the same on a surface that is not a terminal', OWNERS, async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)

  for (const surface of ['terminal', 'desktop'] as const) {
    expect(linesOf(await mountDeck($, surface))[0]).toBe('DECK · Opus 5.5 xhigh · ▶ 2/4 · 1m 12s')
  }
})

const panelTitles = (lines: string[]) =>
  lines.filter(line => /^(plan|limits|this turn|last turn|sessions)/.test(line)).map(line => line.split(/[0-9$]/)[0])

test('shows the panels the panels setting names, in its order', { ...OWNERS, options: { panels: 'sessions, limits, nope' } }, async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)

  expect(panelTitles(linesOf(await mountDeck($)))).toEqual(['sessions', 'limits'])
})

test('leaves out the timeline before any tool call, and the sessions when none is open', OWNERS, async ($, on) => {
  const { clock } = boot(on, { DECK_TIMELINE: 'none', DECK_SESSIONS: 'none' })
  await start($, clock)

  expect(panelTitles(linesOf(await mountDeck($)))).toEqual(['plan', 'limits'])
})

const SHORTCUTS = [
  ['band', 'limits', 'limits'],
  ['sessions', 'sessions', 'sessions'],
  ['waterfall', 'timeline', 'this turn'],
] as const

for (const [command, panel, title] of SHORTCUTS) {
  test(`/${command} puts the ${panel} panel on top of the Deck`, OWNERS, async ($, on) => {
    const { clock } = boot(on)
    await start($, clock)

    expect(await deck($, clock, '', true, command)).toEqual({ text: `Deck: ${panel} on top.` })
    expect(panelTitles(linesOf(await mountDeck($)))[0]).toBe(title)
  })
}

test('/deck timeline and /deck sessions put those panels on top', OWNERS, async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)

  expect(await deck($, clock, 'timeline')).toEqual({ text: 'Deck: timeline on top.' })
  expect(await deck($, clock, 'sessions')).toEqual({ text: 'Deck: sessions on top.' })
})

test('redraws on its own while a panel is live', OWNERS, async ($, on) => {
  const { world, clock } = boot(on, { DECK_PLAN: 'idle', DECK_TIMELINE: 'live' })
  await start($, clock)
  await mountDeck($)
  const before = world.redraws
  await clock.advance(3000)

  expect(world.redraws).toBeGreaterThan(before)
})

test('keeps still while no panel is live', OWNERS, async ($, on) => {
  const { world, clock } = boot(on, { DECK_PLAN: 'idle', DECK_TIMELINE: 'still' })
  await start($, clock)
  await mountDeck($)
  const before = world.redraws
  await clock.advance(3000)

  expect(world.redraws).toBe(before)
})
