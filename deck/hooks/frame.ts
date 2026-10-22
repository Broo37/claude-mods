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
