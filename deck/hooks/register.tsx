import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { DeckTop } from '../types'

import { headerOf, orderOf, panelsFrom, visible } from './frame'
import type { DeckPanel, DeckPanelId, DeckRun } from './frame'

// The Deck: one tab of the side pane in place of Steps, Status, Waterfall and
// Sessions. Clean View lends the plan, status-band the limits and the other
// sessions, the Waterfall the timeline of the turn, each drawn by the mod that
// holds the data; the Deck frames them, heads them, and orders them. Hosting
// them tells those mods to stand aside: their own tabs close, and status-band's
// band gives way too while the Deck is in the dock.

const PANE = { id: 'deck', title: 'Deck', columns: 32 }

// A panel's round border and a cell of room each side of its rows.
const FRAME = 4

// The narrowest a panel's rows are asked for, however narrow the pane.
const NARROWEST = 10

// How many rows the timeline and the sessions may take: the newest calls, the
// first sessions, and a line for the rest.
const TIMELINE_ROWS = 10

const SESSIONS_ROWS = 8

// The width of terminal from which the side pane docks a pane asked for, in fullscreen.
const DOCK_COLUMNS = 110

// How often the Deck redraws while a panel moves on its own, so its clocks and bars move.
const TICK_MS = 1000

// How long after the start of a session the Deck opens: after the other mods'
// tabs, since the tab opened last is the one in front.
const OPEN_AFTER_MS = 2000

const USAGE = 'Usage: /deck [plan|limits|timeline|sessions]'

// The commands of the tabs the Deck takes over, and the panel each now shows.
const SHORTCUTS = { band: 'limits', sessions: 'sessions', waterfall: 'timeline' } as const

const top = atom({ plugin: 'deck', key: 'top' } as const, null as DeckTop)

// Whether the mods were last told the Deck is in the dock; null before the first word.
let docked: boolean | null = null

// Whether the Deck's last drawing was in the dock. A drawing may not tell the
// mods itself: they keep it in their state, which a drawing may not write, and
// the engine counts all a drawing starts, its timers too, as the drawing. So a
// timer started with the session tells them, whenever this differs from `docked`.
let seen = false

// How often that timer looks.
const SYNC_MS = 250

let ticking: Timer | null = null

type Presentation = { isFullscreen: boolean; columns: number }

// Tells the mods the Deck hosts them, and whether it is in the dock now. One
// that cannot be told (it reloads) is told again at the next change.
async function hostAll($: EngineInterface, isDocked: boolean) {
  docked = isDocked
  await Promise.allSettled([
    $.cleanView.host({ by: 'deck', isDocked }),
    $.statusBand.host({ by: 'deck', isDocked }),
    $.toolWaterfall.host({ by: 'deck', isDocked }),
  ])
}

const unavailable = (id: string): DeckPanel => ({
  id,
  title: id,
  right: '',
  label: [],
  rows: [[{ text: `${id}: not available`, isDim: true }]],
})

async function panelOf($: EngineInterface, id: DeckPanelId, columns: number): Promise<DeckPanel> {
  switch (id) {
    case 'plan':
      return $.cleanView.panel({ id: 'plan', columns })
    case 'limits':
      return $.statusBand.panel({ id: 'limits', columns })
    case 'timeline':
      return $.toolWaterfall.panel({ id: 'timeline', columns, rows: TIMELINE_ROWS })
    case 'sessions':
      return $.statusBand.panel({ id: 'sessions', columns, rows: SESSIONS_ROWS })
  }
}

// The panels asked for, at this width; one whose mod fails stands as a line saying so.
async function panelsOf($: EngineInterface, ids: readonly DeckPanelId[], columns: number): Promise<DeckPanel[]> {
  const asked = await Promise.allSettled(ids.map(id => panelOf($, id, columns)))

  return asked.map((answer, i) => (answer.status === 'fulfilled' ? answer.value : unavailable(ids[i] ?? 'panel')))
}

// The clock runs only while a panel moves on its own: a job or a turn that runs.
function keepTime($: EngineInterface, panels: readonly DeckPanel[]) {
  if (panels.some(panel => panel.isLive === true)) {
    ticking ??= $.clock.every(TICK_MS, () => $.ui.invalidate('ui.render'))
  } else {
    ticking?.cancel()
    ticking = null
  }
}

// Opens the Deck with a panel on top, or closes it when it is in front and
// none is asked for: what /deck and the commands it took over do.
async function show($: EngineInterface, wanted: DeckPanelId | '', presentation: Presentation) {
  // Outside a docking side pane it would stand inline above the prompt, where the band is.
  if (!presentation.isFullscreen || presentation.columns < DOCK_COLUMNS) {
    return { text: `Deck: the side pane needs a fullscreen terminal at least ${DOCK_COLUMNS} columns wide.` }
  }

  const pane = (await $.ui.panes()).find(one => one.id === PANE.id)

  if (wanted === '' && pane?.isShown === true) {
    await $.ui.close({ id: PANE.id })
    seen = false
    await hostAll($, false)

    return { text: 'Deck closed.' }
  }

  if (wanted !== '') {
    await update($, top, () => wanted)
  }

  // The pane opened last is the tab in front, and opening an open pane again
  // changes nothing: one behind another tab is closed and opened again.
  if (pane !== undefined) {
    await $.ui.close({ id: PANE.id })
  }

  await $.ui.open(PANE)
  $.ui.invalidate('ui.render')

  return { text: wanted === '' ? 'Deck opened.' : `Deck: ${wanted} on top.` }
}

const lookOf = (run: DeckRun) => ({
  wrap: 'truncate-end' as const,
  ...(run.color !== undefined && { color: run.color }),
  ...(run.backgroundColor !== undefined && { backgroundColor: run.backgroundColor }),
  ...(run.isBold === true && { bold: true }),
  ...(run.isDim === true && { dimColor: true }),
  ...(run.isInverse === true && { inverse: true }),
})

export const register: Register = (on, options) => {
  const isOpenAtStart = options.openOnStart !== false
  const panels = panelsFrom(options.panels)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'deck',
      description: 'Open or close the Deck: the plan, your limits, the turn and your sessions in one tab of the side pane',
      argumentHint: '[plan|limits|timeline|sessions]',
    })
    seen = false
    await hostAll($, false)
    $.clock.every(SYNC_MS, () => {
      if (docked !== seen) {
        void hostAll($, seen)
      }
    })

    if (isOpenAtStart) {
      $.clock.after(OPEN_AFTER_MS, () => void $.ui.open(PANE))
    }

    return next(e)
  })

  // /clear, /resume and /branch empty the session's state, where the mods keep their host.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await hostAll($, docked ?? false)

    return next(e)
  })

  // Closed by the person, the Deck shows nothing: status-band's band comes back.
  // Its own closes (/deck) say so themselves.
  on('ui.close', async ($, e, next) => {
    const answer = await next(e)

    if (e.id === PANE.id && e.origin.kind === 'person') {
      seen = false
      await hostAll($, false)
    }

    return answer
  }).catch(($, e, next) => next(e))

  // What the Deck shows has changed in the mod that holds it.
  on('state.set', { plugin: 'clean-view', key: 'checklist' }, async ($, e, next) => {
    const answer = await next(e)
    $.ui.invalidate('ui.render')

    return answer
  }).catch(($, e, next) => next(e))

  on('state.set', { plugin: 'status-band', key: 'view' }, async ($, e, next) => {
    const answer = await next(e)
    $.ui.invalidate('ui.render')

    return answer
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'deck' }, async ($, e) => {
    const wanted = e.args.trim().toLowerCase()

    if (wanted !== '' && wanted !== 'plan' && wanted !== 'limits' && wanted !== 'timeline' && wanted !== 'sessions') {
      return { text: USAGE }
    }

    return show($, wanted, e.presentation)
  })

  // The commands of the tabs the Deck took over bring their panel to the top of it.
  on('command.run', { command: 'band' }, async ($, e) => show($, SHORTCUTS.band, e.presentation))

  on('command.run', { command: 'sessions' }, async ($, e) => show($, SHORTCUTS.sessions, e.presentation))

  on('command.run', { command: 'waterfall' }, async ($, e) => show($, SHORTCUTS.waterfall, e.presentation))

  on('ui.render', { component: 'Pane', requestId: PANE.id }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)

    // Seated inline above the prompt, it is no tab of the side pane: it closes
    // again, and the band keeps its place.
    if (e.props.placement !== 'dock') {
      seen = false
      $.clock.after(0, () => void $.ui.close({ id: PANE.id }))

      return <Box />
    }

    seen = true
    const lent = await panelsOf($, panels, Math.max(NARROWEST, e.props.bodyColumns - FRAME))
    const order = orderOf(panels, await read($, top))
    const shown = order.flatMap(id => visible(lent).filter(panel => panel.id === id))
    const textsOf = (runs: readonly DeckRun[]) => runs.map(run => <Text {...lookOf(run)}>{run.text}</Text>)
    keepTime($, lent)

    return (
      <Box flexDirection="column">
        <Box>{textsOf(headerOf(lent, e.props.bodyColumns))}</Box>
        {shown.map(panel => (
          <Box borderStyle="round" flexDirection="column" paddingX={1}>
            <Box>
              <Text bold>{panel.title}</Text>
              <Box flexGrow={1} />
              <Text dimColor>{panel.right}</Text>
            </Box>
            {panel.rows.map(row => (
              <Box>{textsOf(row)}</Box>
            ))}
          </Box>
        ))}
      </Box>
    )
  })
}
