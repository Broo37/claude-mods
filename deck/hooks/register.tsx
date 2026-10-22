import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { DeckTop } from '../types'

import { PANELS, headerOf, orderOf, visible } from './frame'
import type { DeckPanel, DeckRun } from './frame'

// The Deck: one tab of the side pane in place of Steps and Status. Clean View
// lends the plan and status-band the limits, each drawn by the mod that holds
// the data; the Deck frames them, heads them, and orders them. Hosting them
// tells both mods to stand aside: Clean View's Steps tab closes, and so does
// status-band's Status tab, its band too while the Deck is in the dock.

const PANE = { id: 'deck', title: 'Deck', columns: 32 }

// A panel's round border and a cell of room each side of its rows.
const FRAME = 4

// The narrowest a panel's rows are asked for, however narrow the pane.
const NARROWEST = 10

// The width of terminal from which the side pane docks a pane asked for, in fullscreen.
const DOCK_COLUMNS = 110

// How often the Deck redraws while a job runs, so its clock moves.
const TICK_MS = 1000

// How long after the start of a session the Deck opens: after the other mods'
// tabs, since the tab opened last is the one in front.
const OPEN_AFTER_MS = 2000

const USAGE = 'Usage: /deck [plan|limits]'

const top = atom({ plugin: 'deck', key: 'top' } as const, null as DeckTop)

// Whether both mods were last told the Deck is in the dock; null before the first word.
let docked: boolean | null = null

// Whether the Deck's last drawing was in the dock. A drawing may not tell the
// mods itself: they keep it in their state, which a drawing may not write, and
// the engine counts all a drawing starts, its timers too, as the drawing. So a
// timer started with the session tells them, whenever this differs from `docked`.
let seen = false

// How often that timer looks.
const SYNC_MS = 250

let ticking: Timer | null = null

// Tells both mods the Deck hosts them, and whether it is in the dock now. One
// that cannot be told (it reloads) is told again at the next change.
async function hostBoth($: EngineInterface, isDocked: boolean) {
  docked = isDocked
  await Promise.allSettled([
    $.cleanView.host({ by: 'deck', isDocked }),
    $.statusBand.host({ by: 'deck', isDocked }),
  ])
}

const unavailable = (id: string): DeckPanel => ({
  id,
  title: id,
  right: '',
  label: [],
  rows: [[{ text: `${id}: not available`, isDim: true }]],
})

// Each mod's panel at this width; one that fails stands as a line saying so.
async function panelsOf($: EngineInterface, columns: number): Promise<DeckPanel[]> {
  const asked = await Promise.allSettled([
    $.cleanView.panel({ id: 'plan', columns }),
    $.statusBand.panel({ id: 'limits', columns }),
  ])

  return asked.map((answer, i) => (answer.status === 'fulfilled' ? answer.value : unavailable(PANELS[i] ?? 'panel')))
}

// The clock runs only while the job does: its time moves in the header.
function keepTime($: EngineInterface, panels: readonly DeckPanel[]) {
  const job = panels.find(panel => panel.id === 'plan')?.label[0]?.text ?? ''
  const isRunning = job.startsWith('▶') || job.startsWith('?')

  if (isRunning) {
    ticking ??= $.clock.every(TICK_MS, () => $.ui.invalidate('ui.render'))
  } else {
    ticking?.cancel()
    ticking = null
  }
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

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'deck',
      description: 'Open or close the Deck: the plan and your limits in one tab of the side pane',
      argumentHint: '[plan|limits]',
    })
    seen = false
    await hostBoth($, false)
    $.clock.every(SYNC_MS, () => {
      if (docked !== seen) {
        void hostBoth($, seen)
      }
    })

    if (isOpenAtStart) {
      $.clock.after(OPEN_AFTER_MS, () => void $.ui.open(PANE))
    }

    return next(e)
  })

  // /clear, /resume and /branch empty the session's state, where both mods keep their host.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await hostBoth($, docked ?? false)

    return next(e)
  })

  // Closed by the person, the Deck shows nothing: status-band's band comes back.
  // Its own closes (/deck) say so themselves.
  on('ui.close', async ($, e, next) => {
    const answer = await next(e)

    if (e.id === PANE.id && e.origin.kind === 'person') {
      seen = false
      await hostBoth($, false)
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

    if (wanted !== '' && wanted !== 'plan' && wanted !== 'limits') {
      return { text: USAGE }
    }

    // Outside a docking side pane it would stand inline above the prompt, where the band is.
    if (!e.presentation.isFullscreen || e.presentation.columns < DOCK_COLUMNS) {
      return { text: `Deck: the side pane needs a fullscreen terminal at least ${DOCK_COLUMNS} columns wide.` }
    }

    const pane = (await $.ui.panes()).find(one => one.id === PANE.id)

    if (wanted === '' && pane?.isShown === true) {
      await $.ui.close({ id: PANE.id })
      seen = false
      await hostBoth($, false)

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
  })

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
    const panels = await panelsOf($, Math.max(NARROWEST, e.props.bodyColumns - FRAME))
    const order = orderOf(PANELS, await read($, top))
    const shown = order.flatMap(id => visible(panels).filter(panel => panel.id === id))
    const textsOf = (runs: readonly DeckRun[]) => runs.map(run => <Text {...lookOf(run)}>{run.text}</Text>)
    keepTime($, panels)

    return (
      <Box flexDirection="column">
        <Box>{textsOf(headerOf(panels, e.props.bodyColumns))}</Box>
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
