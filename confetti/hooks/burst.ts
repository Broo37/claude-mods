// The confetti itself: bits of color thrown from a seed, where each one is at a
// moment of the burst, and the band's cells that draw them. Two pixels a cell,
// as the status-band pet draws them: `▀` paints the upper pixel in the
// foreground and the lower in the background, `▄` the lower pixel alone.

// How many rows of the band the confetti takes, so four pixels tall.
export const ROWS = 2

// How long a burst plays, and how often it moves.
export const LASTS_MS = 1500
export const FRAME_MS = 33

const PINK = 0xff6ec7
const YELLOW = 0xffd93d
const CYAN = 0x4dd9ff
const GREEN = 0x6bff8a
const ORANGE = 0xff9f43

export const COLORS = [PINK, YELLOW, CYAN, GREEN, ORANGE] as const

// A color of 0x01000000 is the terminal's own, behind and in front.
const DEFAULT = 0x01000000
const UPPER = 0x2580
const LOWER = 0x2584
const SPACE = 0x20

// One bit: the column and pixel row it pops out at, when it pops out and when
// it drops away, how many pixel rows a second it falls and how many columns a
// second it drifts.
export type Bit = { x: number; y: number; bornMs: number; diesMs: number; fall: number; drift: number; color: number }

// A pixel of the band: the color lit there, or nothing.
export type Pixel = number | null

// A small generator that gives the same numbers for the same seed, so a burst
// is drawn alike every frame and in tests.
const randomOf = (seed: number) => {
  let state = seed >>> 0

  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)

    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

// The bits a burst throws across a band so many columns wide: about one for
// every two columns, all popping out in the first fifth of a second near the
// top, each dropping away at its own moment before the burst ends.
export function bitsOf(seed: number, columns: number): Bit[] {
  const random = randomOf(seed)

  return Array.from({ length: Math.max(3, Math.ceil(columns * 0.45)) }, () => ({
    x: Math.floor(random() * columns),
    y: random() * 1.5,
    bornMs: random() * 180,
    diesMs: 650 + random() * 850,
    fall: 1.5 + random() * 2.5,
    drift: (random() - 0.5) * 6,
    color: COLORS[Math.floor(random() * COLORS.length)] ?? PINK,
  }))
}

// The band's pixels at a moment of the burst, top row first.
export function pixelsAt(bits: Bit[], columns: number, ms: number): Pixel[][] {
  const pixels: Pixel[][] = Array.from({ length: ROWS * 2 }, () => Array<Pixel>(columns).fill(null))

  if (ms >= LASTS_MS) {
    return pixels
  }

  for (const bit of bits) {
    if (ms < bit.bornMs || ms >= bit.diesMs) {
      continue
    }

    const seconds = (ms - bit.bornMs) / 1000
    const x = Math.round(bit.x + bit.drift * seconds)
    const y = Math.floor(bit.y + bit.fall * seconds)
    const row = pixels[y]

    if (row !== undefined && x >= 0 && x < columns) {
      row[x] = bit.color
    }
  }

  return pixels
}

// The cells of a Raster so many columns wide that draw the pixels.
export function cellsOf(pixels: Pixel[][], columns: number): string {
  const rows = Math.floor(pixels.length / 2)
  const words = new Uint32Array(columns * rows * 3)

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const upper = pixels[row * 2]?.[column] ?? null
      const lower = pixels[row * 2 + 1]?.[column] ?? null
      const at = (row * columns + column) * 3

      if (upper !== null) {
        words[at] = UPPER
        words[at + 1] = upper
        words[at + 2] = lower ?? DEFAULT
      } else if (lower !== null) {
        words[at] = LOWER
        words[at + 1] = lower
        words[at + 2] = DEFAULT
      } else {
        words[at] = SPACE
        words[at + 1] = DEFAULT
        words[at + 2] = DEFAULT
      }
    }
  }

  // A mod's environment has Uint8Array's base64 methods; the es2023 lib does not name them.
  return (new Uint8Array(words.buffer) as Uint8Array & { toBase64(): string }).toBase64()
}

// The cells of the burst at a moment.
export const cellsAt = (bits: Bit[], columns: number, ms: number) => cellsOf(pixelsAt(bits, columns, ms), columns)
