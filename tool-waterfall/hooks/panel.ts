import type { ToolWaterfallPanel } from '../types'

import { linesOf } from './chart'
import type { Turn } from './chart'

// The chart as a panel of the Deck: its heading becomes the panel's title and
// what stands at its right, and its lines the panel's rows, within the rows
// asked for. No turn, or one with no calls yet, lends no rows: the Deck leaves
// the panel out.
export const timelinePanelOf = (turn: Turn | null, elapsed: number, columns: number, rows: number): ToolWaterfallPanel => {
  const isLive = turn !== null && turn.lasted === null
  const title = isLive ? 'this turn' : 'last turn'

  if (turn === null || turn.calls.length === 0) {
    return { id: 'timeline', title, right: '', label: [], rows: [], isLive, summary: [] }
  }

  // The chart counts its heading among its rows.
  const [heading = [], ...body] = linesOf(turn, elapsed, columns, rows + 1)
  const right = heading.map(run => run.text).join('').replace(/^Turn /, '')

  return { id: 'timeline', title, right, label: [], rows: body, isLive, summary: [{ text: `turn ${right}` }] }
}
