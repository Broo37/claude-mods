// A track of the Deck, drawn on the surface's own frame clock: a heavy rule with
// its label at the left and its figure at the right. While Claude works one
// train makes its trip down the Deck, a bright head and a dot behind: along
// this track when its leg comes, passing under the label, then on to the next.
// At rest it is a still rule. Only this region redraws, never the pane (as
// Flightdeck's rails do).
import type { ClientModule } from 'claude-code'

type Props = {
  label: string
  right: string
  width: number
  active: boolean
  // Theme keys: the rule, the train, the label, the figure.
  line: string
  train: string
  ink: string
  dim: string
  // This track's leg of the trip: the step it starts on, how many steps it
  // lasts, and how many the whole trip takes.
  start: number
  lap: number
  cycle: number
}

type Ref = { phase: number; active: boolean }

type State = { ref: Ref }

type Cell = { ch: string; part: 'line' | 'label' | 'right' }

const STEP_MS = 70

const cellsOf = ({ label, right, width }: Props, columns: number): Cell[] => {
  const tail = right === '' ? '' : ` ${right} `
  const room = Math.max(1, columns - 3 - 1 - (tail === '' ? 0 : tail.length + 2) - 2)
  const named = label.length > room ? `${label.slice(0, Math.max(0, room - 1))}…` : label
  const rule = Math.max(2, columns - 3 - named.length - 1 - (tail === '' ? 0 : tail.length + 2))
  const line = (text: string): Cell[] => [...text].map((ch): Cell => ({ ch, part: 'line' }))
  const gap: Cell = { ch: ' ', part: 'label' }
  const cells: Cell[] = [
    ...line('━━'),
    gap,
    ...[...named].map((ch): Cell => ({ ch, part: 'label' })),
    gap,
    ...line('━'.repeat(rule)),
    ...(tail === '' ? [] : [...[...tail].map((ch): Cell => ({ ch, part: 'right' })), ...line('━━')]),
  ]

  return cells.slice(0, Math.max(columns, width))
}

const Track: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const ref = surface.state?.ref ?? { phase: 0, active: props.active }

  // Every leg starts its count again when Claude starts working, so the
  // tracks and the spur agree on where the train is.
  if (props.active && !ref.active) {
    ref.phase = 0
  }

  ref.active = props.active

  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(STEP_MS, () => {
      if (ref.active) {
        ref.phase += 1
        surface.setState({ ref })
      }
    })
  }

  const cells = cellsOf(props, Math.max(1, surface.columns || props.width))
  const lit = new Map<number, string>()

  if (props.active) {
    // In at the left, and out past the right with its tail.
    const head = (ref.phase % Math.max(1, props.cycle)) - props.start

    if (head >= 0 && head < props.lap) {
      lit.set(head, '●')
      lit.set(head - 1, '•')
    }
  }

  // Runs, not cells: neighbours of one kind share a Text.
  const runs: { text: string; color: string; isBold: boolean }[] = []
  cells.forEach((cell, at) => {
    const train = cell.part === 'line' ? lit.get(at) : undefined
    const color = train !== undefined ? props.train : cell.part === 'label' ? props.ink : cell.part === 'right' ? props.dim : props.line
    const isBold = train !== undefined || cell.part === 'label'
    const last = runs[runs.length - 1]

    if (last !== undefined && last.color === color && last.isBold === isBold) {
      last.text += train ?? cell.ch
    } else {
      runs.push({ text: train ?? cell.ch, color, isBold })
    }
  })

  return (
    <Box>
      {runs.map(run => (
        <Text color={run.color} bold={run.isBold}>
          {run.text}
        </Text>
      ))}
    </Box>
  )
}

export default Track
