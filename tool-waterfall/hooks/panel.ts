import type { ToolWaterfallPanel } from '../types'

import { linesOf } from './chart'
import type { Turn } from './chart'

// The chart as a panel of the Deck: its heading becomes the panel's title and
// what stands at its right, and its lines the panel's rows, within the rows
// asked for. A running turn shows from its start, saying when no tool has been
// called yet; no turn, or an ended one that called none, lends no rows: the
// Deck leaves the panel out.
export const timelinePanelOf = (turn: Turn | null, elapsed: number, columns: number, rows: number): ToolWaterfallPanel => {
  const isLive = turn !== null && turn.lasted === null
  const title = isLive ? 'this turn' : 'last turn'

  if (turn === null || (turn.calls.length === 0 && !isLive)) {
    return { id: 'timeline', title, right: '', label: [], rows: [], isLive, summary: [] }
  }

  // The chart counts its heading among its rows. Its '…' says the turn runs on,
  // which the Deck says in words.
  const [heading = [], ...body] = linesOf(turn, elapsed, columns, rows + 1, 'inactive')
  const right = heading
    .map(run => run.text)
    .join('')
    .replace(/^Turn /, '')
    .replace('…', ' running')
    .replace(/ · no tools$/, '')
  const shown = turn.calls.length === 0 ? [[{ text: 'no tool calls yet', color: 'inactive' }]] : body

  return { id: 'timeline', title, right, label: [], rows: shown, isLive, summary: [{ text: `turn ${right}` }] }
}
