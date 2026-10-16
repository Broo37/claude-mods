import { HEIGHTS, lit } from './strip'
import type { Look } from './strip'

// The strip as an equalizer: twelve bars, each struck up to a height of its own
// and then falling a level a frame until it is struck again, as the bars of a
// music player do. The heights follow a rule and no chance, so the strip moves
// the same way every turn, and its last frame leads into its first.

// How long each frame stays, in milliseconds.
export const BARS_MS = 80

const COLUMNS = 12

// How many frames pass between two strikes of a bar.
const BEAT = 6

// How many strikes a bar takes before the strip starts over.
const STRIKES = 16

// How many frames into the beat each bar is struck, so that they do not all jump together.
const LAGS = [0, 3, 1, 4, 2, 5, 3, 0, 4, 1, 5, 2]

// How high a strike sends a bar, 3 to 8: scattered over the bars and the strikes, and the same every time.
const peakOf = (bar: number, strike: number) => {
  let mix = Math.imul(bar + 1, 0x9e3779b1) ^ Math.imul(strike + 1, 0x85ebca6b)
  mix = Math.imul(mix ^ (mix >>> 15), 0x2c1b3c6d)

  return 3 + (((mix ^ (mix >>> 12)) >>> 0) % 6)
}

// How high a bar stands in a frame: where its last strike sent it for two
// frames, then a level lower with each frame.
const heightOf = (bar: number, frame: number) => {
  const round = BEAT * STRIKES
  const struck = (((frame - (LAGS[bar] ?? 0)) % round) + round) % round

  return Math.max(1, peakOf(bar, Math.floor(struck / BEAT)) - Math.max(0, (struck % BEAT) - 1))
}

export const BARS: readonly string[] = Array.from({ length: BEAT * STRIKES }, (_, frame) =>
  Array.from({ length: COLUMNS }, (_, bar) => HEIGHTS[heightOf(bar, frame) - 1] ?? ' ').join(''),
)

// The least a bar is lit, as a part of the strip's color.
const DIMMEST = 0.45

// How brightly a character of the strip is drawn, as a part of its color: the
// taller the bar, the brighter. A character that is no bar is drawn in full.
export const glowOf = (codePoint: number) => {
  const height = HEIGHTS.indexOf(String.fromCodePoint(codePoint)) + 1

  return height === 0 ? 1 : DIMMEST + ((1 - DIMMEST) * (height - 1)) / (HEIGHTS.length - 1)
}

export const EQUALIZER: Look = {
  frames: BARS,
  frameMs: BARS_MS,
  ink: (color, codePoint) => lit(color, glowOf(codePoint)),
}
