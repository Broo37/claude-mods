import { lit } from './strip'
import type { Look } from './strip'

// The strip as a comet: a bright head that runs from one end to the other and
// back, with a tail that fades behind it and folds over at the ends.

const COLUMNS = 12

// The head, and behind it the tail from its nearest part to its farthest.
const TRAIL = '█▓▒░'

// How brightly each of those is drawn, as a part of the strip's color.
const FADE = [1, 0.8, 0.6, 0.45]

// How many frames the head takes there and back.
const ROUND = 2 * (COLUMNS - 1)

// The column the head is in, in a frame.
export const headAt = (frame: number) => {
  const step = ((frame % ROUND) + ROUND) % ROUND

  return step < COLUMNS ? step : ROUND - step
}

export const COMET: Look = {
  frames: Array.from({ length: ROUND }, (_, frame) => {
    const cells = Array<string>(COLUMNS).fill(' ')

    // The farthest part first, so that a nearer one is drawn over it where the tail folds.
    for (let part = TRAIL.length - 1; part >= 0; part--) {
      cells[headAt(frame - part)] = TRAIL[part] ?? ' '
    }

    return cells.join('')
  }),
  frameMs: 80,
  ink: (color, codePoint) => lit(color, FADE[TRAIL.indexOf(String.fromCodePoint(codePoint))] ?? 1),
}
