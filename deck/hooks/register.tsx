import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { DeckTop } from '../types'

import { INK, miniOf, orderOf, panelsFrom, routeOf, trackOf, tripOf } from './frame'
import type { DeckPanel, DeckPanelId, DeckRun } from './frame'

// The Deck: one tab of the side pane in place of Steps, Status, Waterfall and
// Sessions. Clean View lends the plan, status-band the limits and the other
// sessions, the Waterfall the timeline of the turn, each drawn by the mod that
// holds the data; the Deck frames them, heads them, and orders them. Hosting
// them tells those mods to stand aside: their own tabs close, and status-band's
// band gives way too while the Deck is in the dock.

const PANE = { id: 'deck', title: 'Deck', columns: 32 }

// The narrowest a panel's rows are asked for, however narrow the pane.
const NARROWEST = 10

// How many rows the timeline and the sessions may take: the newest calls, the
// first sessions, and a line for the rest.
const TIMELINE_ROWS = 10

const SESSIONS_ROWS = 8

// How many rows of route the spur under the station at work takes.
const SPUR_ROWS = 2

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

// The pet (status-band's Clawd) stands under the sessions, in a raster of the
// Deck's own: only that raster is repainted, by blit, never the whole pane, as
// Flightdeck redraws only the region that moves. A timer started with the
// session asks status-band for the pet's frame while one is drawn; a still pet
// is looked at again only now and then. A refused blit (the raster is gone)
// stops it until the next drawing.
const PET_TICK_MS = 50

const PET_REST_MS = 500

// The drawing the raster stands in, its cells now, when to look at it next.
let petAt: string | null = null

let petCells = ''

let petLookAt = 0

let isPetStepping = false

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

async function stepPet($: EngineInterface) {
  if (petAt === null || isPetStepping) {
    return
  }

  const now = await $.clock.now()

  if (now < petLookAt) {
    return
  }

  isPetStepping = true

  try {
    const frame = await $.statusBand.pet()

    if (frame === null) {
      petAt = null

      return
    }

    petLookAt = frame.isStill ? now + PET_REST_MS : 0

    if (frame.cells === petCells) {
      return
    }

    const painted = await $.ui.blit({ requestId: petAt, key: 'pet', columns: frame.columns, rows: frame.rows, cells: frame.cells })

    if (painted.deny !== undefined) {
      petAt = null

      return
    }

    petCells = frame.cells
  } catch {
    petAt = null
  } finally {
    isPetStepping = false
  }
}

// Opens the Deck with a panel on top, or closes it when it is in front and
// none is asked for: what /deck and the commands it took over do. Where there
// is no side pane, it stands inline above the prompt as its mini summary.
async function show($: EngineInterface, wanted: DeckPanelId | '') {
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
  const isMotion = options.motion !== false

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
    $.clock.every(PET_TICK_MS, () => void stepPet($))

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

    return show($, wanted)
  })

  // The commands of the tabs the Deck took over bring their panel to the top of it.
  on('command.run', { command: 'band' }, async $ => show($, SHORTCUTS.band))

  on('command.run', { command: 'sessions' }, async $ => show($, SHORTCUTS.sessions))

  on('command.run', { command: 'waterfall' }, async $ => show($, SHORTCUTS.waterfall))

  on('ui.render', { component: 'Pane', requestId: PANE.id }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const textsOf = (runs: readonly DeckRun[]) => runs.map(run => <Text {...lookOf(run)}>{run.text}</Text>)
    // Shown, the Deck has the status: status-band's band gives way, docked or inline.
    seen = true

    // Inline above the prompt, where no side pane is: the mini summary, a few rows.
    if (e.props.placement !== 'dock') {
      petAt = null
      const lent = await panelsOf($, panels, Math.max(NARROWEST, e.props.bodyColumns))

      return (
        <Box flexDirection="column">
          {miniOf(lent, e.props.bodyColumns).map(row => (
            <Box>{textsOf(row)}</Box>
          ))}
        </Box>
      )
    }

    const width = Math.max(NARROWEST, e.props.bodyColumns)
    const lent = await panelsOf($, panels, width)
    const order = orderOf(panels, await read($, top))
    // The pet, where the surface draws rasters and the sessions are shown.
    const PetRaster = e.surface === 'terminal' ? $.ui.resolve(e).Raster : undefined
    const Client = e.surface === 'terminal' && isMotion ? $.ui.resolve(e).Client : undefined
    const pet = PetRaster !== undefined && panels.includes('sessions') ? await $.statusBand.pet().catch(() => null) : null
    petAt = pet === null ? null : e.requestId

    if (pet !== null) {
      petCells = pet.cells
      petLookAt = pet.isStill ? (await $.clock.now()) + PET_REST_MS : 0
    }

    // The trains run while any panel moves on its own: Claude is working.
    const isMoving = lent.some(panel => panel.isLive === true)
    const plan = lent.find(panel => panel.id === 'plan')
    const model = lent.find(panel => panel.id === 'limits')?.label ?? []
    const isShown = (panel: DeckPanel) =>
      panel.rows.length > 0 || (panel.stops?.length ?? 0) > 0 || (panel.id === 'sessions' && pet !== null)
    const shown = order.flatMap(id => lent.filter(panel => panel.id === id && isShown(panel)))
    keepTime($, lent)

    // A track: the track module where the surface runs one and motion is on, else a still rule.
    // The train's trip, in reading order: each track, and the spur after the
    // route's track when a station is at work. A track's leg runs in at its
    // left and out past its right; the spur's down its rows.
    const routeRows = (panel: DeckPanel) => routeOf(panel.stops ?? [], panel.phase ?? 'working', width)
    const trip = tripOf(
      shown.flatMap(panel => [
        { key: `track-${panel.id}`, lap: width + 2 },
        ...(routeRows(panel).some(row => row.kind === 'spur') ? [{ key: 'spur', lap: SPUR_ROWS + 2 }] : []),
      ]),
    )
    const legOf = (key: string, lap: number) => ({ start: trip.starts[key] ?? 0, lap, cycle: trip.cycle })

    const trackFor = (panel: DeckPanel) => {
      const isRoute = (panel.stops?.length ?? 0) > 0
      const label = isRoute ? (panel.name ?? panel.title) : panel.title
      const right = isRoute ? '' : panel.right
      const ink = isRoute ? INK.route : INK.here

      return Client === undefined ? (
        <Box>{textsOf(trackOf(label, right, width, { color: ink, isBold: true }))}</Box>
      ) : (
        <Client
          key={`track-${panel.id}`}
          module="./track.tsx"
          width={width}
          height={1}
          props={{ label, right, width, active: isMoving, line: INK.route, train: INK.train, ink, dim: INK.ahead, ...legOf(`track-${panel.id}`, width + 2) }}
        />
      )
    }

    const spur =
      Client === undefined ? (
        <Box flexDirection="column">
          <Text color={INK.route}>┃</Text>
          <Text color={INK.route}>┃</Text>
        </Box>
      ) : (
        <Client
          key="spur"
          module="./spur.tsx"
          width={2}
          height={SPUR_ROWS}
          props={{ rows: SPUR_ROWS, active: isMoving, line: INK.route, train: INK.train, ...legOf('spur', SPUR_ROWS + 2) }}
        />
      )

    const bodyOf = (panel: DeckPanel) => {
      if ((panel.stops?.length ?? 0) > 0) {
        return routeRows(panel).map(row =>
          row.kind === 'station' ? <Box>{textsOf(row.runs)}</Box> : row.kind === 'link' ? <Text color={INK.route}>┃</Text> : spur,
        )
      }

      return panel.rows.map(row => <Box>{textsOf(row)}</Box>)
    }

    return (
      <Box flexDirection="column">
        <Box>
          <Text bold>DECK</Text>
          <Text> </Text>
          {textsOf(plan?.label ?? [])}
          <Box flexGrow={1} />
          {textsOf(model)}
        </Box>
        {shown.map(panel => (
          <Box flexDirection="column" marginTop={1}>
            {trackFor(panel)}
            {bodyOf(panel)}
            {panel.id === 'sessions' && pet !== null && PetRaster !== undefined ? (
              <Box marginTop={panel.rows.length > 0 ? 1 : 0}>
                <PetRaster key="pet" columns={pet.columns} rows={pet.rows} cells={pet.cells} />
              </Box>
            ) : null}
          </Box>
        ))}
      </Box>
    )
  })
}
