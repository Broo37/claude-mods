import { lit } from './strip'
import type { Look } from './strip'

// The strip as a game of pong: a ball that runs between two paddles, each of
// which lights up while the ball is at it.

const COLUMNS = 12

const LEFT = '▌'

const RIGHT = '▐'

const BALL = '●'

// How brightly a paddle is drawn while the ball is away, as a part of the strip's color.
const RESTING = 0.5

// How many columns from a paddle the ball may be for the paddle to light up.
const REACH = 2

// How many frames the ball takes there and back between the paddles.
const ROUND = 2 * (COLUMNS - 3)

// The column the ball is in, in a frame: from beside the left paddle to beside the right, and back.
export const ballAt = (frame: number) => {
  const step = ((frame % ROUND) + ROUND) % ROUND

  return 1 + (step <= ROUND / 2 ? step : ROUND - step)
}

// Whether the ball is too far from the paddle in that column for it to light up; a column without a paddle has none.
const isResting = (column: number, ball: number) =>
  (column === 0 && ball > REACH) || (column === COLUMNS - 1 && ball < COLUMNS - 1 - REACH)

export const PONG: Look = {
  frames: Array.from({ length: ROUND }, (_, frame) => {
    const ball = ballAt(frame)

    return `${LEFT}${' '.repeat(ball - 1)}${BALL}${' '.repeat(COLUMNS - 2 - ball)}${RIGHT}`
  }),
  frameMs: 80,
  ink: (color, _codePoint, column, frame) => (isResting(column, ballAt(frame)) ? lit(color, RESTING) : color),
}
