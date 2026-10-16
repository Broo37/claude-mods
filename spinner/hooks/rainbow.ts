import { HEIGHTS } from './strip'
import type { Look } from './strip'

// The strip as a wave in the colors of the rainbow: twelve bars under a wave
// that rolls to the left, every column in a color of its own, and the colors
// drifting the same way at a third of the pace. The strip's own color is not
// used.

const COLUMNS = 12

// How many frames the wave takes to roll a column on.
const ROLL = 2

// How many frames the colors take to drift a column on.
const DRIFT = 6

// How much of a color is color and not white, 0 to 1: in full they glare beside a theme's.
const DEPTH = 0.7

// How high the wave stands over a column in a frame, 1 to 8. Counted in whole
// steps of the wave, so that it is the same each time round, and half a step
// off, so that no height falls on the edge between two bars.
const heightOf = (column: number, frame: number) => {
  const steps = COLUMNS * ROLL

  return Math.round(4.5 + 3.5 * Math.sin((2 * Math.PI * (((column * ROLL + frame) % steps) + 0.5)) / steps))
}

// A color of the rainbow by its place on the color wheel, in degrees from red.
export const hueOf = (degrees: number) => {
  const channel = (offset: number) => {
    const place = (offset + (((degrees % 360) + 360) % 360) / 60) % 6

    return Math.round(255 * (1 - DEPTH * Math.max(0, Math.min(place, 4 - place, 1))))
  }

  return (channel(5) << 16) | (channel(3) << 8) | channel(1)
}

// The wave is back where it began after COLUMNS * ROLL frames, the colors after
// COLUMNS * DRIFT, which is the round.
export const RAINBOW: Look = {
  frames: Array.from({ length: COLUMNS * DRIFT }, (_, frame) =>
    Array.from({ length: COLUMNS }, (_, column) => HEIGHTS[heightOf(column, frame) - 1] ?? ' ').join(''),
  ),
  frameMs: 80,
  ink: (_color, _codePoint, column, frame) => hueOf((360 * (column * DRIFT + frame)) / (COLUMNS * DRIFT)),
}
