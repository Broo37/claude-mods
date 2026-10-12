// Palette, gradients and wording ported from Awesome Statusline by AwesomeJun (MIT).

export type Rgb = readonly [number, number, number]

export type BarKind = 'context' | 'fiveHour' | 'sevenDay' | 'codex'

// One block of a bar, drawn as a box plot draws a spread: what is used is a
// solid box, what remains a thin whisker. The block the pace falls on is marked.
// A block of the box carries a color for each of its halves, so the box shades
// twice as finely as its blocks and reads as one surface, not as squares.
export type BarCell = { isFilled: boolean; color: Rgb; rightColor?: Rgb; isMarked?: true }

// A run of a bar's glyphs in one ink, over one ground where it has one.
export type BarSpan = { text: string; color: Rgb; backgroundColor?: Rgb }

export const PALETTE = {
  teal: [148, 226, 213],
  pink: [245, 194, 231],
  peach: [250, 179, 135],
  green: [166, 227, 161],
  subtext: [166, 173, 200],
  lavender: [180, 190, 254],
  yellow: [249, 226, 175],
  overlay: [108, 112, 134],
  latteGreen: [64, 160, 43],
  latteYellow: [223, 142, 29],
  codexGreen: [16, 163, 127],
} as const satisfies Record<string, Rgb>

const LATTE_RED: Rgb = [210, 15, 57]

const STOPS: Record<BarKind, readonly (readonly [number, Rgb])[]> = {
  context: [
    [0, PALETTE.pink],
    [30, [230, 69, 83]],
    [70, LATTE_RED],
  ],
  fiveHour: [
    [0, PALETTE.lavender],
    [50, [30, 102, 245]],
    [100, LATTE_RED],
  ],
  sevenDay: [
    [0, PALETTE.yellow],
    [50, [254, 100, 11]],
    [100, LATTE_RED],
  ],
  codex: [
    [0, PALETTE.teal],
    [50, PALETTE.codexGreen],
    [100, LATTE_RED],
  ],
}

// A block of the box: its left half in one color, over a ground that shows as
// its right half in the next.
const BLOCK = '▌'

// What remains of a bar: a thin line, capped where the bar starts and where it ends.
const WHISKER = '─'

const CAP_START = '├'

const CAP_END = '┤'

// How bright the whisker reads, from 0 to 255, whatever the hue of its bar: at a
// plain share of its color a navy line sinks into the terminal where an orange one stands.
const WHISKER_LUMA = 80

// The pace on the whisker: a heavy stroke across the thin line, which runs on
// through it, brighter than the line.
const MARKER = '╂'

const MARKER_LUMA = 150

// The pace in the box: the same heavy stroke, cut into the block in a dark shade of it.
const TICK = '┃'

const TICK_SHADE = 0.3

const WHITE: Rgb = [255, 255, 255]

const BLACK: Rgb = [0, 0, 0]

// How much a filled block is lightened, by its distance from the glint's head.
const GLINT = [0.6, 0.35, 0.15]

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const MINUTE = 60_000

const pad = (n: number) => String(n).padStart(2, '0')

const minutesIn = (ms: number) => Math.max(0, Math.floor(ms / MINUTE))

export const rgb = ([r, g, b]: Rgb) => `rgb(${r},${g},${b})`

export const clampPercent = (percent: number) => Math.min(100, Math.max(0, Math.round(percent)))

const mixed = (from: Rgb, to: Rgb, share: number): Rgb => [
  Math.round(from[0] + (to[0] - from[0]) * share),
  Math.round(from[1] + (to[1] - from[1]) * share),
  Math.round(from[2] + (to[2] - from[2]) * share),
]

export const gradient = (kind: BarKind, percent: number): Rgb => {
  const stops = STOPS[kind]
  const next = stops.findIndex(([at]) => at > percent)
  const above = stops[next]
  const below = stops[next - 1]

  // Outside the stops there is nothing to mix: the nearest end stands.
  if (above === undefined || below === undefined) {
    return (above ?? stops.at(-1))?.[1] ?? LATTE_RED
  }

  const [from, low] = below
  const [to, high] = above

  return mixed(low, high, (percent - from) / (to - from))
}

// A bar's blocks. `pace` is how much of the bar's window has passed, in
// percent: the block it falls on is marked, in the box or on the whisker.
export const barCells = (percent: number, width: number, kind: BarKind, pace?: number): BarCell[] => {
  const reading = clampPercent(percent)
  const filled = Math.round((reading * width) / 100)
  const rest = gradient(kind, reading)
  const marked =
    pace === undefined ? -1 : Math.min(width - 1, Math.floor((clampPercent(pace) * width) / 100))

  return Array.from({ length: width }, (_, i) => {
    const cell: BarCell =
      i < filled
        ? {
            isFilled: true,
            color: gradient(kind, (i * 100) / width),
            rightColor: gradient(kind, ((i + 0.5) * 100) / width),
          }
        : { isFilled: false, color: rest }

    return i === marked ? { ...cell, isMarked: true } : cell
  })
}

const lit = (color: Rgb, share: number) => mixed(color, WHITE, share)

// A bar with a glint passing over it: the filled blocks near `head` lightened.
export const glintCells = (cells: BarCell[], head: number): BarCell[] =>
  cells.map((cell, i) => {
    const share = GLINT[Math.abs(i - head)]

    if (!cell.isFilled || share === undefined) {
      return cell
    }

    return {
      ...cell,
      color: lit(cell.color, share),
      ...(cell.rightColor !== undefined && { rightColor: lit(cell.rightColor, share) }),
    }
  })

const shaded = (color: Rgb, share: number) => mixed(BLACK, color, share)

// How bright a color reads, from 0 to 255.
const luma = ([r, g, b]: Rgb) => 0.299 * r + 0.587 * g + 0.114 * b

// A color brought to a brightness, keeping its hue: darkened, or lightened toward white.
const toned = (color: Rgb, target: number) => {
  const now = luma(color)

  return now >= target
    ? shaded(color, target / now)
    : mixed(color, WHITE, (target - now) / (255 - now))
}

// The run a block is written as, by what it is and where it stands in its bar.
const spanOf = ({ isFilled, isMarked, color, rightColor }: BarCell, i: number, cells: BarCell[]): BarSpan => {
  if (isFilled) {
    return isMarked === true
      ? { text: TICK, color: shaded(color, TICK_SHADE), backgroundColor: color }
      : { text: BLOCK, color, backgroundColor: rightColor ?? color }
  }

  if (isMarked === true) {
    return { text: MARKER, color: toned(color, MARKER_LUMA) }
  }

  const glyph = i === cells.length - 1 ? CAP_END : i === 0 ? CAP_START : WHISKER

  return { text: glyph, color: toned(color, WHISKER_LUMA) }
}

const isSameInk = (a: Rgb | undefined, b: Rgb | undefined) =>
  a === b || (a !== undefined && b !== undefined && a.every((part, i) => part === b[i]))

// The bar as runs of text. A text draws the colors it names exactly, where a
// raster rounds each channel to one of 16 levels, which shows as bands across a
// gradient. Neighbours in the same colors, as a whisker's are, make one run.
export const barSpans = (cells: BarCell[]) =>
  cells.map(spanOf).reduce<BarSpan[]>((spans, span) => {
    const last = spans.at(-1)
    const isSame =
      last !== undefined &&
      isSameInk(last.color, span.color) &&
      isSameInk(last.backgroundColor, span.backgroundColor)

    return isSame ? [...spans.slice(0, -1), { ...last, text: last.text + span.text }] : [...spans, span]
  }, [])

export const modelName = (id: string) => {
  const isWide = /\[1m\]$/i.test(id)
  const parts = id
    .replace(/\[1m\]$/i, '')
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .split('-')
    .filter(part => part !== '')
  const words = parts
    .filter(part => !/^\d+$/.test(part))
    .map(word => word.slice(0, 1).toUpperCase() + word.slice(1))
  const version = parts.filter(part => /^\d+$/.test(part)).join('.')
  const name = [words.join(' '), version].filter(part => part !== '').join(' ')

  if (name === '') {
    return 'Unknown'
  }

  return isWide ? `${name} (1M context)` : name
}

export const shortModel = (name: string) => name.split(' ')[0] ?? name

export const shortPath = (path: string, home: string) =>
  home !== '' && path.toLowerCase().startsWith(home.toLowerCase())
    ? `~${path.slice(home.length)}`
    : path

export const duration = (ms: number) => {
  const seconds = Math.floor(ms / 1000)

  if (seconds >= 3600) {
    return `${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)}m`
  }

  return seconds >= 60 ? `${Math.floor(seconds / 60)}m` : `${seconds}s`
}

export const remaining = (ms: number) => {
  const minutes = minutesIn(ms)

  return `${Math.floor(minutes / 60)}h${minutes % 60}m`
}

export const remainingLong = (ms: number) => {
  const minutes = minutesIn(ms)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)

  if (days > 0) {
    return `${days}d${hours}h${minutes % 60}m`
  }

  return hours > 0 ? `${hours}h${minutes % 60}m` : `${minutes % 60}m`
}

export const resetClock = (at: number) => {
  const date = new Date(at)

  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export const resetDate = (at: number) => `${DAYS[new Date(at).getDay()]} ${resetClock(at)}`

export const cost = (usd: number) => `$ ${usd.toFixed(2)}`

// The frames of the mark that spins beside a session at work.
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

// What a raster cell reads as "the terminal's own color".
const DEFAULT_COLOR = 0x01000000

// One frame of that mark as the one cell of a Raster, [code point, foreground,
// background] of u32 each. A raster is repainted in place, where a text would
// have the whole pane drawn again ten times a second; its coarse colors do not
// matter for one glyph in one color. Only a glyph one column wide fits a cell,
// which is why the emoji of the other states are not moved this way.
export const spinnerCell = (frame: number) => {
  const glyph = SPINNER[frame % SPINNER.length] ?? ' '
  const [r, g, b] = PALETTE.peach
  const words = Uint32Array.of(glyph.codePointAt(0) ?? 0x20, (r << 16) | (g << 8) | b, DEFAULT_COLOR)

  // A mod's environment has Uint8Array's base64 methods; the es2023 lib does not name them.
  return (new Uint8Array(words.buffer) as Uint8Array & { toBase64(): string }).toBase64()
}
