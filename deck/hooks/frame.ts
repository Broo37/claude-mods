// The Deck's frame, pure: which panels show and in what order, and the header
// over them. Each panel is lent by the mod whose data it holds; the Deck only
// frames them.

// One run of a row: its text and how it is drawn. A color is a theme key or `rgb(r,g,b)`.
export type DeckRun = { text: string; color?: string; backgroundColor?: string; isBold?: boolean; isDim?: boolean; isInverse?: boolean }

// A lent panel: its title and what stands at its right, a label for the header,
// rows, whether it moves on its own (a job or a turn that runs), and the panel
// in one line for the mini summary.
export type DeckPanel = {
  id: string
  title: string
  right: string
  label: DeckRun[]
  rows: DeckRun[][]
  isLive?: boolean
  summary?: DeckRun[]
  // A plan lent as a route: the job's name, its phase, its steps as stops.
  name?: string
  phase?: string
  stops?: DeckStop[]
}

// The panels, in their own order.
export const PANELS = ['plan', 'limits', 'timeline', 'sessions'] as const

export type DeckPanelId = (typeof PANELS)[number]

// Each panel's border, a color of the person's theme (as Flightdeck takes them),
// so the boxes read apart; a panel that rests has it dimmed.
export const BORDERS: Record<DeckPanelId, string> = { plan: 'claude', limits: 'suggestion', timeline: 'success', sessions: 'merged' }

// The mini summary's rows: the header and a line a panel.
const MINI = 4

// Whose label comes first in the header: what the session runs on, then the job.
const LABELS = ['limits', 'plan'] as const

const SEPARATOR: DeckRun = { text: ' · ', isDim: true }

const isPanelId = (id: string): id is DeckPanelId => (PANELS as readonly string[]).includes(id)

// The panels the setting names, a comma between two, in its order; every
// panel in its own order where it names none the Deck knows.
export const panelsFrom = (setting: unknown): DeckPanelId[] => {
  const named = (typeof setting === 'string' ? setting.split(',') : [])
    .map(id => id.trim().toLowerCase())
    .filter(isPanelId)
  const once = [...new Set(named)]

  return once.length > 0 ? once : [...PANELS]
}

export const orderOf = (ids: readonly string[], top: string | null): string[] =>
  top !== null && ids.includes(top) ? [top, ...ids.filter(id => id !== top)] : [...ids]

export const visible = (panels: readonly DeckPanel[]): DeckPanel[] => panels.filter(panel => panel.rows.length > 0)

// Runs cut to `columns`, the last one shown ending in an ellipsis.
const cut = (runs: readonly DeckRun[], columns: number): DeckRun[] => {
  const kept: DeckRun[] = []
  let room = columns

  for (const run of runs) {
    if (run.text.length <= room) {
      kept.push(run)
      room -= run.text.length
      continue
    }

    // With no room left the ellipsis takes the last cell of the run before.
    const last = kept.at(-1)

    if (room > 0) {
      kept.push({ ...run, text: `${run.text.slice(0, room - 1)}…` })
    } else if (last !== undefined) {
      kept[kept.length - 1] = { ...last, text: `${last.text.slice(0, -1)}…` }
    }

    break
  }

  return kept
}

export const headerOf = (panels: readonly DeckPanel[], columns: number): DeckRun[] => {
  const labels = LABELS.flatMap(id => panels.filter(panel => panel.id === id && panel.label.length > 0).map(panel => panel.label))

  return cut([{ text: 'DECK', isBold: true }, ...labels.flatMap(label => [SEPARATOR, ...label])], columns)
}

// The Deck in a few rows, where it stands inline above the prompt: the header,
// then each panel's line in the panels' own order, as many as there is room for.
export const miniOf = (panels: readonly DeckPanel[], columns: number): DeckRun[][] => {
  const lines = PANELS.flatMap(id =>
    panels.filter(panel => panel.id === id && (panel.summary?.length ?? 0) > 0).map(panel => cut(panel.summary ?? [], columns)),
  )

  return [headerOf(panels, columns), ...lines].slice(0, MINI)
}

// ── The train line ───────────────────────────────────────────────────────────
// The plan is a route: its steps are stations down one line, the one at work
// has a spur under it where the train runs while Claude works, and every
// section of the Deck sits under a track, a heavy rule with its name.

// The Deck's inks, theme keys, so light and dark themes both read: the route
// (its line and every track), the train, the station at work, the stations
// ahead, and what holds a job.
export const INK = {
  route: 'suggestion',
  train: 'warning',
  here: 'text',
  ahead: 'inactive',
  held: 'warning',
  fault: 'error',
} as const

// A step as a stop on the route.
export type DeckStop = { name: string; icon: string; status: 'done' | 'active' | 'upcoming'; percent: number; hasReported: boolean }

// A row of the route: a station, the line between two, or the spur the train runs on.
export type RouteRow = { kind: 'station'; runs: DeckRun[] } | { kind: 'link' } | { kind: 'spur' }

// The meter of the station at work: so many cells, and its percent.
const METER = 6

// The station at work, by what holds the job: at work, waiting on the person, failing, stopped.
const HERE: Record<string, DeckRun> = {
  'needs-you': { text: '‖', color: INK.held, isBold: true },
  stuck: { text: '!', color: INK.fault, isBold: true },
  stopped: { text: '■', color: INK.fault, isBold: true },
}

const glyphOf = (stop: DeckStop, phase: string): DeckRun => {
  if (stop.status === 'done') {
    return { text: '✓', color: INK.route }
  }

  if (stop.status === 'upcoming') {
    return { text: '○', color: INK.ahead }
  }

  return HERE[phase] ?? { text: '◉', color: INK.here, isBold: true }
}

// Until the step reports how far it is, the station has no meter: a mark alone
// would read as text cut short.
const meterOf = (stop: DeckStop): DeckRun[] => {
  if (!stop.hasReported) {
    return []
  }

  const lit = Math.round((Math.min(100, Math.max(0, stop.percent)) * METER) / 100)

  return [
    { text: '█'.repeat(lit), color: INK.route },
    { text: '░'.repeat(METER - lit), color: INK.ahead },
    { text: ` ${stop.percent}%`, color: INK.here },
  ]
}

const stationOf = (stop: DeckStop, phase: string, columns: number): DeckRun[] => {
  const isHere = stop.status === 'active'
  const right = isHere ? meterOf(stop) : []
  const rightWidth = right.reduce((sum, run) => sum + run.text.length, 0)
  const lead = 1 + 2 + stop.icon.length + 1
  const room = Math.max(1, columns - lead - (rightWidth > 0 ? rightWidth + 2 : 0))
  const name = stop.name.length > room ? `${stop.name.slice(0, Math.max(0, room - 1))}…` : stop.name
  const gap = columns - lead - name.length - rightWidth

  return [
    glyphOf(stop, phase),
    { text: `  ${stop.icon} ` },
    { text: name, ...(isHere ? { isBold: true } : { color: stop.status === 'upcoming' ? INK.ahead : INK.here }) },
    ...(rightWidth > 0 ? [{ text: ' '.repeat(Math.max(2, gap)) }, ...right] : []),
  ]
}

export const routeOf = (stops: readonly DeckStop[], phase: string, columns: number): RouteRow[] =>
  stops.flatMap((stop, at): RouteRow[] => [
    { kind: 'station', runs: stationOf(stop, phase, columns) },
    ...(at === stops.length - 1 ? [] : [stop.status === 'active' ? ({ kind: 'spur' } as const) : ({ kind: 'link' } as const)]),
  ])

// One leg of the train's trip: a track or the spur, by its key, and how many
// steps the train takes to pass along it.
export type Leg = { key: string; lap: number }

// The train's trip down the Deck, one leg after another in reading order: when
// each leg starts, and how long the whole trip takes before it starts again.
export const tripOf = (legs: readonly Leg[]) =>
  legs.reduce<{ cycle: number; starts: Record<string, number> }>(
    (trip, leg) => ({ cycle: trip.cycle + leg.lap, starts: { ...trip.starts, [leg.key]: trip.cycle } }),
    { cycle: 0, starts: {} },
  )

// A track: a heavy rule, its label at the left, its figure at the right, as wide as asked.
export const trackOf = (label: string, right: string, width: number, ink: Omit<DeckRun, 'text'> = { color: INK.here, isBold: true }): DeckRun[] => {
  const tail = right === '' ? '' : ` ${right} ━━`
  const room = Math.max(1, width - 3 - 1 - tail.length - 2)
  const named = label.length > room ? `${label.slice(0, Math.max(0, room - 1))}…` : label
  const rule = Math.max(2, width - 3 - named.length - 1 - tail.length)

  return [
    { text: '━━ ', color: INK.route },
    { text: named, ...ink },
    { text: ` ${'━'.repeat(rule)}`, color: INK.route },
    ...(tail === '' ? [] : [{ text: ` ${right} `, color: INK.ahead }, { text: '━━', color: INK.route }]),
  ]
}
