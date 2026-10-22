import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { ToolWaterfallHost, ToolWaterfallPanel } from '../types'

import { labelOf, linesOf } from './chart'
import type { Call, Run } from './chart'
import { timelinePanelOf } from './panel'

// How far the chart stands off the pane's left edge: as far as the lines of the
// Sessions pane do.
const GUTTER = 2

// The pane the chart is drawn in, and the width asked for it: that of the
// Sessions pane. The dock keeps one width for all its tabs, so asking for more
// would widen it for that pane too; a person who wants a wide chart drags it.
const PANE = { id: 'waterfall', title: 'Waterfall', columns: 30 + GUTTER }

// Under what name it is kept, between sessions, that the person wants the pane.
const KEPT = 'kept'

// How often a running turn is drawn again, for the bars of its running calls
// to grow.
const TICK_MS = 500

// A turn's calls are kept up to this many: the chart shows the newest anyway.
const CALLS = 2000

// The main turn being charted: when it began, its calls, how long it lasted
// once it has ended, and whether it was seen to begin (one that was not is
// timed from its first call).
type Charted = { startedAt: number; calls: Call[]; lasted: number | null; isWhole: boolean }

let turn: Charted | null = null

let ticking: Timer | null = null

const isRunning = (charted: Charted | null): charted is Charted => charted !== null && charted.lasted === null

// The mod that hosts the chart (the Deck), if one does: then the pane stands
// aside. Kept in the session's state, which outlasts a reload, and here, which
// outlasts a /clear that empties the state.
const hostAtom = atom({ plugin: 'tool-waterfall', key: 'host' } as const, null as ToolWaterfallHost | null)

let hosted: ToolWaterfallHost | null = null

async function hostOf($: EngineInterface) {
  hosted ??= await read($, hostAtom)

  return hosted
}

// The panel a lent method answers where no hook of this mod does: no rows, so a host hides it.
const UNLENT: ToolWaterfallPanel = { id: 'timeline', title: 'timeline', right: '', label: [], rows: [], isLive: false }

const lookOf = (run: Run) => ({
  wrap: 'truncate-end' as const,
  ...(run.color !== undefined && { color: run.color }),
  ...(run.isBold === true && { bold: true }),
  ...(run.isDim === true && { dimColor: true }),
})

export const register: Register = on => {
  // What the Waterfall lends another mod, the Deck: the chart as a panel, and a
  // way to host it. The methods here stand at the bottom of their events; the
  // hooks below answer them, holding `$` as a method cannot.
  on('engine.create', async ($, e, next) => {
    const built = await next(e)

    return { ...built, toolWaterfall: { panel: async () => UNLENT, host: async () => false } }
  })

  on('toolWaterfall.panel', async ($, e) => {
    const charted = turn
    const elapsed = isRunning(charted) ? (await $.clock.now()) - charted.startedAt : 0

    return { value: timelinePanelOf(charted, elapsed, e.columns, e.rows) }
  })

  // Hosted, the pane closes and stays closed: the chart is the host's panel.
  on('toolWaterfall.host', async ($, e) => {
    hosted = { by: e.by, isDocked: e.isDocked }
    await update($, hostAtom, () => hosted)

    if ((await $.ui.panes()).some(pane => pane.id === PANE.id)) {
      await $.ui.close({ id: PANE.id })
    }

    return { value: true }
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'waterfall',
      description: 'Show or hide a chart of the tool calls of the turn',
    })

    // A person who asked for the pane keeps it as a tab of the dock. It is
    // opened here, first of all, because the pane opened last is the tab in
    // front: the Sessions pane, which opens once it has looked around, is.
    try {
      if ((await hostOf($)) === null && (await $.store.get(KEPT)) === true) {
        await $.ui.open(PANE)
      }
    } catch {
      // A session starts without the pane rather than not at all.
    }

    return next(e)
  })

  on('command.run', { command: 'waterfall' }, async $ => {
    if ((await hostOf($)) !== null) {
      return { text: 'Waterfall is in the Deck: /deck timeline' }
    }

    const mine = (await $.ui.panes()).find(pane => pane.id === PANE.id)

    if (mine?.isShown === true) {
      await $.store.set(KEPT, false)
      await $.ui.close({ id: PANE.id })

      return { text: 'Waterfall closed.' }
    }

    // A tab behind another pane is asked for to be seen, not to be closed. The
    // pane opened last is the tab in front (opening an open pane again changes
    // nothing), so it is closed and opened again.
    if (mine !== undefined) {
      await $.ui.close({ id: PANE.id })
      await $.ui.open(PANE)

      return { text: 'Waterfall in front.' }
    }

    await $.store.set(KEPT, true)
    const opened = await $.ui.open(PANE)

    return { text: opened.isPlaced ? 'Waterfall opened.' : 'Waterfall: widen the terminal to see it.' }
  })

  // Closed by the person with its close mark or key, the pane is theirs to ask
  // for again, like one closed with the command. Should noting that fail, the
  // pane closes all the same.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE.id && e.origin.kind === 'person') {
      await $.store.set(KEPT, false)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()

    // A turn that starts while one runs is a subagent's: the chart is the main turn's.
    if (!isRunning(turn)) {
      turn = { startedAt: now, calls: [], lasted: null, isWhole: true }
      ticking ??= $.clock.every(TICK_MS, () => $.ui.invalidate('ui.render'))
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && isRunning(turn)) {
      const ended = turn
      ended.lasted = ended.isWhole ? e.durationMs : (await $.clock.now()) - ended.startedAt
      ticking?.cancel()
      ticking = null
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  // Notes when each call of the main turn begins and ends, and hands its answer
  // on as it came. Charting a call must never stand in its way: should this
  // hook fail, the call goes on, or its answer stands, as if it were not there.
  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }

    const began = await $.clock.now()

    if (!isRunning(turn)) {
      turn = { startedAt: began, calls: [], lasted: null, isWhole: false }
      ticking ??= $.clock.every(TICK_MS, () => $.ui.invalidate('ui.render'))
    }

    const mine = turn
    const call: Call = {
      id: e.tool_use_id,
      tool: e.tool,
      label: labelOf(e.tool, e as unknown as Record<string, unknown>),
      start: began - mine.startedAt,
      end: null,
      isError: false,
    }
    mine.calls.push(call)

    if (mine.calls.length > CALLS) {
      mine.calls.shift()
    }

    $.ui.invalidate('ui.render')

    try {
      const answer = await next(e)
      call.isError = answer.isError === true || answer.deny !== undefined

      return answer
    } catch (error) {
      call.isError = true

      throw error
    } finally {
      call.end = (await $.clock.now()) - mine.startedAt
      $.ui.invalidate('ui.render')
    }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE.id }, async ($, e) => {
    const charted = turn
    const elapsed = isRunning(charted) ? (await $.clock.now()) - charted.startedAt : 0
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" paddingLeft={GUTTER}>
        {linesOf(charted, elapsed, e.props.bodyColumns - GUTTER, e.props.scroll.bodyRows).map(line => (
          <Box>
            {line.map(run => (
              <Text {...lookOf(run)}>{run.text}</Text>
            ))}
          </Box>
        ))}
      </Box>
    )
  })
}
