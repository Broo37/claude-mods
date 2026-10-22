// The stretch of the route under the station at work, drawn on the surface's
// own frame clock. The line stays whole; while Claude works the train runs down
// beside it, a bright head and a dot behind, when its leg of the trip down the
// Deck comes. Only this region redraws.
import type { ClientModule } from 'claude-code'

// `start`, `lap` and `cycle`: the spur's leg of the trip, as a track has its own.
type Props = { rows: number; active: boolean; line: string; train: string; start: number; lap: number; cycle: number }

type Ref = { phase: number; active: boolean }

type State = { ref: Ref }

// The tracks' step, so the train keeps one pace.
const STEP_MS = 70

const Spur: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const ref = surface.state?.ref ?? { phase: 0, active: props.active }

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

  const rows = Math.max(1, props.rows)
  // The head comes down a row a step, its tail following it out at the bottom.
  const head = props.active ? (ref.phase % Math.max(1, props.cycle)) - props.start : -2

  return (
    <Box flexDirection="column">
      {Array.from({ length: rows }, (_, row) => (
        <Box>
          <Text color={props.line}>┃</Text>
          {row === head ? (
            <Text color={props.train} bold>
              ●
            </Text>
          ) : row === head - 1 ? (
            <Text color={props.train}>•</Text>
          ) : (
            <Text> </Text>
          )}
        </Box>
      ))}
    </Box>
  )
}

export default Spur
