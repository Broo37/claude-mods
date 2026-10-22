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
      label: [{ text: '▶ stop 2 of 4 · 1m 12s' }],
      rows: [[{ text: '▶ 🔨 Build the pricing section' }]],
      isLive: true,
      summary: [{ text: '▶ 2/4 ' }, { text: 'Build the pricing section', isBold: true }],
      name: 'Build my landing page',
      phase: 'working' as const,
      stops: [
        { name: 'Read your brand notes', icon: '📖', status: 'done' as const, percent: 100, hasReported: false },
        { name: 'Build the pricing section', icon: '🔨', status: 'active' as const, percent: 60, hasReported: true },
        { name: 'Add the contact form', icon: '🔨', status: 'upcoming' as const, percent: 0, hasReported: false },
      ],
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

      return {
        value:
          way === 'idle'
            ? { ...plan, label: [{ text: 'idle' }], rows: [], isLive: false, stops: [], phase: 'idle' as const }
            : way === 'still'
              ? { ...plan, isLive: false }
              : plan,
      }
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
      summary: [{ text: '5H 66% · 7D 8% · ctx 6%' }],
    }
    const sessions = {
      id: 'sessions' as const,
      title: 'sessions',
      right: '2 open',
      label: [],
      rows: [[{ text: '○ geisa-pk  waiting 29m' }], [{ text: '● claude-mods  working 4m' }]],
      summary: [{ text: '2 open' }],
    }
    // A frame of the pet: spaces whose ink tells one frame from the next, as a Raster takes them.
    const cellsOf = (n: number) => {
      const words = new Uint32Array(24 * 8 * 3)

      for (let i = 0; i < 24 * 8; i += 1) {
        words[i * 3] = 0x20
        words[i * 3 + 1] = n & 0xffffff
        words[i * 3 + 2] = 0x01000000
      }

      return (new Uint8Array(words.buffer) as Uint8Array & { toBase64(): string }).toBase64()
    }
    let frames = 0

    on('engine.create', async ($, e, next) => ({
      ...(await next(e)),
      statusBand: { panel: async () => limits, host: async () => false, pet: async () => null },
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
    on('statusBand.pet', async $ => {
      const way = await $.env.get('DECK_PET')

      if (way === 'off') {
        return { value: null }
      }

      frames += 1

      return { value: { columns: 24, rows: 8, cells: cellsOf(way === 'still' ? 1 : frames), isStill: way === 'still' } }
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
      summary: [{ text: 'turn 41s… · 2 tools' }],
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
    blits: [] as { requestId: string; key: string; cells?: string }[],
    blitDeny: '',
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
  on('ui.blit', ($, e) => {
    world.blits.push(e)

    return { value: world.blitDeny === '' ? {} : { deny: world.blitDeny } }
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

const nodesOf = (node: unknown): Drawn[] => {
  if (typeof node !== 'object' || node === null) {
    return []
  }

  const drawn = node as Drawn

  return [drawn, ...(drawn.children ?? []).flatMap(nodesOf)]
}

type TrackProps = { label: string; right: string; active: boolean; line: string; train: string; start: number; lap: number; cycle: number }

const clientsOf = (tree: unknown, module: string) =>
  nodesOf(tree).filter(node => node.type === 'Client' && String(node.props?.module ?? '').endsWith(module.slice(1)))

// The tracks of the Deck by their labels: the track module's, or a drawn rule's.
const tracksOf = (tree: unknown) => {
  const modules = clientsOf(tree, './track.tsx').map(node => (node.props?.props as TrackProps).label)

  return modules.length > 0 ? modules : linesOf(tree).flatMap(line => (line.startsWith('━━ ') ? [line.slice(3).split(' ━')[0] ?? ''] : []))
}

type ClientUi = {
  drawn: (scope?: { in: string }) => Promise<unknown>
  advance: (ms: number) => Promise<void>
  resize: (size: { columns: number; rows: number; in: string }) => Promise<void>
  unmount: () => Promise<void>
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

test('draws the header, the route under the line name, then a track for each section', { ...OWNERS, options: { motion: false } }, async ($, on) => {
  const { clock } = boot(on, { DECK_PET: 'off' })
  await start($, clock)
  const lines = linesOf(await mountDeck($))

  expect(lines[0]).toBe('DECK ▶ stop 2 of 4 · 1m 12sOpus 5.5 xhigh')
  expect(lines[1]?.startsWith('━━ Build my landing page ━')).toBe(true)
  expect(lines.slice(2, 8).map(line => line.trimEnd())).toEqual([
    '✓  📖 Read your brand notes',
    '┃',
    '◉  🔨 Build the pricing section      ████░░ 60%',
    '┃',
    '┃',
    '○  🔨 Add the contact form',
  ])
  expect(tracksOf(await mountDeck($))).toEqual(['Build my landing page', 'limits', 'this turn', 'sessions'])
  expect(lines).toContain('5H  ████ 66%')
  expect(lines).toContain('● claude-mods  working 4m')
})

test('draws no boxes: every section sits under a track', OWNERS, async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)

  expect(nodesOf(await mountDeck($)).some(node => node.props?.borderStyle !== undefined)).toBe(false)
})

test('leaves out a panel with no rows, and keeps its label in the header', OWNERS, async ($, on) => {
  const { clock } = boot(on, { DECK_PLAN: 'idle' })
  await start($, clock)
  const lines = linesOf(await mountDeck($))

  expect(lines[0]).toBe('DECK idleOpus 5.5 xhigh')
  expect(tracksOf(await mountDeck($))).not.toContain('Build my landing page')
})

test('puts the limits on top with /deck limits', OWNERS, async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)

  expect(await deck($, clock, 'limits')).toEqual({ text: 'Deck: limits on top.' })
  expect(tracksOf(await mountDeck($))[0]).toBe('limits')
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

test('opens with /deck outside fullscreen too, where it stands inline', OWNERS, async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  world.opened = []

  expect(await deck($, clock, '', false)).toEqual({ text: 'Deck opened.' })
  expect(world.opened).toEqual(['deck'])
})

test('draws the other panel and says which one is not available when its mod throws', OWNERS, async ($, on) => {
  const { clock } = boot(on, { DECK_LIMITS: 'failing' })
  await start($, clock)
  const lines = linesOf(await mountDeck($))

  expect(lines.some(line => line.includes('Build the pricing section'))).toBe(true)
  expect(lines).toContain('limits: not available')
})

test('inline above the prompt it draws the mini summary and stays open', OWNERS, async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await clock.advance(OPEN_AFTER_MS)

  expect(linesOf(await mountDeck($, 'terminal', 'inline'))).toEqual([
    'DECK · Opus 5.5 xhigh · ▶ stop 2 of 4 · 1m 12s',
    '▶ 2/4 Build the pricing section',
    '5H 66% · 7D 8% · ctx 6%',
    'turn 41s… · 2 tools',
  ])

  await clock.advance(SYNC_MS)

  expect(world.panes).toEqual(['deck'])
})

test('inline it tells the mods it is shown, so the band gives way to it', OWNERS, async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  world.toasts = []
  await mountDeck($, 'terminal', 'inline')
  await clock.advance(SYNC_MS)

  expect(docks(world, true)).toEqual(ALL)
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
    expect(linesOf(await mountDeck($, surface))[0]).toBe('DECK ▶ stop 2 of 4 · 1m 12sOpus 5.5 xhigh')
  }
})

const panelTitles = (tree: unknown) => tracksOf(tree)

test('shows the panels the panels setting names, in its order', { ...OWNERS, options: { panels: 'sessions, limits, nope' } }, async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)

  expect(panelTitles(await mountDeck($))).toEqual(['sessions', 'limits'])
})

test('leaves out the timeline before any tool call, and the sessions when none is open', OWNERS, async ($, on) => {
  const { clock } = boot(on, { DECK_TIMELINE: 'none', DECK_SESSIONS: 'none', DECK_PET: 'off' })
  await start($, clock)

  expect(panelTitles(await mountDeck($))).toEqual(['Build my landing page', 'limits'])
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
    expect(panelTitles(await mountDeck($))[0]).toBe(title)
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

// ── Borders and Clawd ───────────────────────────────────────────────────────


const find = (node: unknown, type: string): Drawn | undefined => {
  if (typeof node !== 'object' || node === null) {
    return undefined
  }

  const drawn = node as Drawn

  return drawn.type === type ? drawn : (drawn.children ?? []).map(child => find(child, type)).find(Boolean)
}

const petBlits = (world: World) => world.blits.filter(blit => blit.key === 'pet')

// How often the train moves a cell, on a track or down the spur.
const TRACK_STEP_MS = 70

test('runs the trains on every track and on the spur while a panel is live', OWNERS, async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const tree = await mountDeck($)

  expect(clientsOf(tree, './track.tsx').map(node => (node.props?.props as TrackProps).active)).toEqual([true, true, true, true])
  expect(clientsOf(tree, './track.tsx').map(node => (node.props?.props as TrackProps).line)).toEqual(['suggestion', 'suggestion', 'suggestion', 'suggestion'])
  expect(clientsOf(tree, './spur.tsx').map(node => node.props?.props)).toEqual([
    { rows: 2, active: true, line: 'suggestion', train: 'warning', start: 49, lap: 4, cycle: 200 },
  ])
})

test('keeps the trains still while nothing moves', OWNERS, async ($, on) => {
  const { clock } = boot(on, { DECK_PLAN: 'still', DECK_TIMELINE: 'still' })
  await start($, clock)
  const tree = await mountDeck($)

  expect([...clientsOf(tree, './track.tsx'), ...clientsOf(tree, './spur.tsx')].every(node => (node.props?.props as TrackProps).active === false)).toBe(true)
})

test('moves the train down the spur on its own clock, without drawing the Deck again', OWNERS, async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  const ui = (await $.ui.mount({
    plugin: 'deck',
    component: 'Pane',
    requestId: 'deck',
    surface: 'terminal',
    props: { title: 'Deck', isFocused: false, bodyColumns: 47, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as Parameters<Engine['ui']['mount']>[0])) as unknown as ClientUi
  // The train reaches the spur once it has run the route's track.
  await ui.advance(TRACK_STEP_MS * 49)
  const drawnAt = world.redraws
  const before = textOf(await ui.drawn({ in: 'spur' }))
  await ui.advance(TRACK_STEP_MS)
  const after = textOf(await ui.drawn({ in: 'spur' }))
  await ui.unmount()

  expect(before).not.toBe(after)
  expect(`${before}${after}`).toContain('●')
  expect(world.redraws).toBe(drawnAt)
})

test('keeps the line whole down the spur, the train running beside it', OWNERS, async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const ui = (await $.ui.mount({
    plugin: 'deck',
    component: 'Pane',
    requestId: 'deck',
    surface: 'terminal',
    props: { title: 'Deck', isFocused: false, bodyColumns: 47, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as Parameters<Engine['ui']['mount']>[0])) as unknown as ClientUi
  const frames: string[][] = []
  await ui.advance(TRACK_STEP_MS * 49)

  for (let step = 0; step < 4; step += 1) {
    frames.push(linesOf(await ui.drawn({ in: 'spur' })))
    await ui.advance(TRACK_STEP_MS)
  }

  await ui.unmount()

  expect(frames.every(rows => rows.length === 2 && rows.every(row => row.startsWith('┃')))).toBe(true)
  expect(frames.some(rows => rows.some(row => row === '┃●'))).toBe(true)
})

test('gives every track its leg of one trip: the route, its spur, then the other tracks in turn', OWNERS, async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const tracks = clientsOf(await mountDeck($), './track.tsx').map(node => node.props?.props as TrackProps)

  // 47 columns: a track is a lap of 49 steps, the spur of 4.
  expect(tracks.map(track => track.start)).toEqual([0, 53, 102, 151])
  expect(tracks.every(track => track.lap === 49 && track.cycle === 200)).toBe(true)
})

test('runs one train at a time, down the spur and from track to track, the labels kept', OWNERS, async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const ui = (await $.ui.mount({
    plugin: 'deck',
    component: 'Pane',
    requestId: 'deck',
    surface: 'terminal',
    props: { title: 'Deck', isFocused: false, bodyColumns: 47, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as Parameters<Engine['ui']['mount']>[0])) as unknown as ClientUi
  const keys = ['track-plan', 'spur', 'track-limits', 'track-timeline', 'track-sessions']

  for (const key of keys.filter(key => key !== 'spur')) {
    await ui.resize({ columns: 47, rows: 1, in: key })
  }

  const visited = new Set<string>()
  let isOne = true

  // One whole trip, looked at every step.
  for (let step = 0; step < 200; step += 1) {
    const frames = await Promise.all(keys.map(async key => textOf(await ui.drawn({ in: key }))))
    const lit = keys.filter((_, at) => frames[at]?.includes('●') === true)
    isOne = isOne && lit.length <= 1
    lit.forEach(key => visited.add(key))
    expect(frames[2]).toContain(' limits ')
    await ui.advance(TRACK_STEP_MS)
  }

  await ui.unmount()

  expect(isOne).toBe(true)
  expect([...visited].sort()).toEqual([...keys].sort())
})

test('draws the tracks as still rules with motion off', { ...OWNERS, options: { motion: false } }, async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const tree = await mountDeck($)

  expect(clientsOf(tree, './track.tsx')).toEqual([])
  expect(tracksOf(tree)).toEqual(['Build my landing page', 'limits', 'this turn', 'sessions'])
})

test('draws the pet under the sessions on the terminal', OWNERS, async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)
  const pet = find(await mountDeck($), 'Raster')

  expect(pet?.props).toMatchObject({ key: 'pet', columns: 24, rows: 8 })
})

test('draws no pet on a surface that has no raster', OWNERS, async ($, on) => {
  const { clock } = boot(on)
  await start($, clock)

  expect(find(await mountDeck($, 'desktop'), 'Raster')).toBeUndefined()
})

test('keeps the sessions panel for the pet alone when no other session is open', OWNERS, async ($, on) => {
  const { clock } = boot(on, { DECK_SESSIONS: 'none' })
  await start($, clock)
  const tree = await mountDeck($)

  expect(tracksOf(tree)).toContain('sessions')
  expect(find(tree, 'Raster')?.props?.key).toBe('pet')
})

test('leaves the sessions panel out with the pet off and no other session open', OWNERS, async ($, on) => {
  const { clock } = boot(on, { DECK_PET: 'off', DECK_SESSIONS: 'none' })
  await start($, clock)

  expect(tracksOf(await mountDeck($))).not.toContain('sessions')
})

test('repaints the pet alone, by blit, while it moves', OWNERS, async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await mountDeck($)
  const drawn = world.redraws
  await clock.advance(500)

  expect(petBlits(world).length).toBeGreaterThan(3)
  expect(petBlits(world).every(blit => blit.requestId === 'deck')).toBe(true)
  expect(world.redraws - drawn).toBeLessThan(petBlits(world).length)
})

test('paints nothing while the pet keeps still', OWNERS, async ($, on) => {
  const { world, clock } = boot(on, { DECK_PET: 'still' })
  await start($, clock)
  await mountDeck($)
  await clock.advance(2000)

  expect(petBlits(world)).toEqual([])
})

test('stops repainting the pet once a blit is denied', OWNERS, async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await mountDeck($)
  world.blitDeny = 'not mounted'
  await clock.advance(500)
  const tried = petBlits(world).length
  await clock.advance(500)

  expect(tried).toBe(1)
  expect(petBlits(world)).toHaveLength(1)
})
