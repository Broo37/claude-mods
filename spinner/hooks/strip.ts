// What a raster cell reads as "the terminal's own color".
const DEFAULT_COLOR = 0x01000000

// The orange Claude Code's own themes draw its mark in.
export const CLAUDE_ORANGE = 0xd77757

// A bar at each of its eight heights, the lowest first. Every one is a single
// column wide, which is what a raster cell holds.
export const HEIGHTS = '▁▂▃▄▅▆▇█'

// Which of a round of frames shows that long into a turn, counted from 0; the
// frames go round for as long as it lasts.
export const frameNo = (count: number, elapsedMs: number, frameMs: number) =>
  Math.floor(Math.max(0, elapsedMs) / frameMs) % Math.max(1, count)

// The color of one cell of a frame, for a strip that is not all of one color:
// from the strip's color, the cell's character, its column and the number of
// the frame in the round.
export type Ink = (color: number, codePoint: number, column: number, frame: number) => number

// A strip that can be drawn: its frames, how long each stays in milliseconds,
// and its ink, where its cells are not all drawn in the strip's color.
export type Look = { frames: readonly string[]; frameMs: number; ink?: Ink }

// A color at a part of its brightness, 0 to 1.
export const lit = (color: number, part: number) => {
  const share = Math.min(1, Math.max(0, part))
  const channel = (shift: number) => Math.round(((color >> shift) & 0xff) * share) << shift

  return channel(16) | channel(8) | channel(0)
}

// A frame as the cells of a one-row Raster, [code point, foreground, background]
// of u32 each. A raster is repainted in place, where a text would have the whole
// line drawn again, and that no more than ten times a second. With an ink, each
// cell is drawn in the color the ink has for its character and its column.
export const cellsOf = (frame: string, color: number, ink?: (codePoint: number, column: number) => number) => {
  const words = new Uint32Array(frame.length * 3)

  for (let cell = 0; cell < frame.length; cell++) {
    const codePoint = frame.codePointAt(cell) ?? 0x20
    words[cell * 3] = codePoint
    words[cell * 3 + 1] = ink === undefined ? color : ink(codePoint, cell)
    words[cell * 3 + 2] = DEFAULT_COLOR
  }

  // A mod's environment has Uint8Array's base64 methods; the es2023 lib does not name them.
  return (new Uint8Array(words.buffer) as Uint8Array & { toBase64(): string }).toBase64()
}

// The strip of a look as a raster takes it, that long into a turn.
export const cellsAt = ({ frames, frameMs, ink }: Look, elapsedMs: number, color: number) => {
  const frame = frameNo(frames.length, elapsedMs, frameMs)

  return cellsOf(frames[frame] ?? '', color, ink && ((codePoint, column) => ink(color, codePoint, column, frame)))
}

type Said = { word: string; message: string | null; suffix: string }

// What the line says: the person's wording around the verb, or the message
// Claude Code puts in the verb's place, ended the way it ends it.
export const saidOf = (format: string, { word, message, suffix }: Said) => {
  if (message === null) {
    return format.replace('{}', word)
  }

  return /(…|\.\.\.)$/.test(message) ? message : `${message}${suffix}`
}

// How long a turn has taken, written as Claude Code writes it (`12s`, `1m 4s`).
export const elapsedOf = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`
  }

  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

// The file a theme setting names in the themes folder; a built-in theme has none.
export const themeFile = (theme: unknown) => {
  const name = typeof theme === 'string' && theme.startsWith('custom:') ? theme.slice('custom:'.length) : ''

  return name === '' || /[\\/]|\.\./.test(name) ? undefined : `${name}.json`
}

// A theme color as a raster cell holds one; a named terminal color has no such number.
const rgbOf = (color: unknown) => {
  if (typeof color !== 'string') {
    return undefined
  }

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1]

  if (hex !== undefined) {
    return parseInt(hex.length === 3 ? [...hex].map(digit => digit + digit).join('') : hex, 16)
  }

  const [red, green, blue] = (/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(color.trim()) ?? [])
    .slice(1)
    .map(Number)

  if (red === undefined || green === undefined || blue === undefined || Math.max(red, green, blue) > 255) {
    return undefined
  }

  return (red << 16) | (green << 8) | blue
}

// The color a custom theme gives Claude's mark, read from the theme file's text.
export const claudeIn = (themeText: string) => {
  try {
    const theme: unknown = JSON.parse(themeText)
    const overrides = typeof theme === 'object' && theme !== null ? (theme as { overrides?: unknown }).overrides : undefined

    return typeof overrides === 'object' && overrides !== null ? rgbOf((overrides as { claude?: unknown }).claude) : undefined
  } catch {
    return undefined
  }
}
