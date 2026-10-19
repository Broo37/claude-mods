import { expect, test } from 'claude-code/testing'

import {
  CREATURES,
  DIG_MS,
  HOPS_MS,
  PET_COLUMNS,
  PET_FRAME_MS,
  PET_ROWS,
  SAND,
  isHot,
  isSpent,
  petFrame,
  petOf,
  petSettlesAt,
} from '../hooks/pet'
import type { Creature } from '../hooks/pet'

// What a raster cell reads as "the terminal's own color".
const DEFAULT_COLOR = 0x01000000

const UPPER = '▀'.codePointAt(0)
const LOWER = '▄'.codePointAt(0)
const SPACE = 0x20
const CROSS = '×'.codePointAt(0)

const YELLOW = 0xf9e2af

// The crab as the pet was first drawn, sixteen pixels wide: walking, hopping,
// sweating and sleeping on the ground are pinned against it, whatever the
// creatures of the mod are drawn as.
const PEACH: Creature = {
  colors: { o: 0xfab387, p: 0xf38ba8, k: 0x1e1e2e, b: 0x89b4fa },
  body: [
    '...oo......oo...',
    '..oooooooooooo..',
    '..oooooooooooo..',
    'oooEEooooooEEooo',
    'oooEEooooooEEooo',
    '..opoooooooopo..',
    '..oooooooooooo..',
  ],
  feet: {
    stand: ['..oo.oo..oo.oo..', '..oo.oo..oo.oo..'],
    stepA: ['..oo.oo..oo.oo..', '..oo.....oo.....'],
    stepB: ['..oo.oo..oo.oo..', '.....oo.....oo..'],
    tuck: ['..oooooooooooo..', '................'],
  },
}

const { o: PEACHY, k: DARK, p: BLUSH } = PEACH.colors

const CLAWD = CREATURES.crab

const STILL = { isHot: false, x: 4 }

type Cell = [glyph: number, foreground: number, background: number]

// The cells of a raster as they were packed, three numbers a cell.
const cellsIn = (cells: string): Cell[] => {
  const base64 = Uint8Array as unknown as { fromBase64(text: string): Uint8Array<ArrayBuffer> }
  const words = [...new Uint32Array(base64.fromBase64(cells).buffer)]

  return Array.from({ length: words.length / 3 }, (_, cell) => [
    words[cell * 3] ?? 0,
    words[cell * 3 + 1] ?? 0,
    words[cell * 3 + 2] ?? 0,
  ])
}

const cellAt = (cells: string, row: number, column: number) => cellsIn(cells)[row * PET_COLUMNS + column]

// The picture a frame draws: a letter a pixel, as the creature's colors name
// them, and '.' where nothing is drawn. A row of cells is two rows of pixels.
const pixelsOf = (cells: string, colors: Record<string, number> = PEACH.colors) => {
  const letter = (color: number) => Object.keys(colors).find(key => colors[key] === color) ?? '?'
  const all = cellsIn(cells)
  const rows: string[] = []

  for (let row = 0; row < PET_ROWS; row++) {
    let upper = ''
    let lower = ''

    for (let column = 0; column < PET_COLUMNS; column++) {
      const [glyph, foreground, background] = all[row * PET_COLUMNS + column] ?? [SPACE, 0, 0]
      upper += glyph === UPPER ? letter(foreground) : '.'
      lower += glyph === LOWER ? letter(foreground) : glyph === UPPER && background !== DEFAULT_COLOR ? letter(background) : '.'
    }

    rows.push(upper, lower)
  }

  return rows
}

// Clawd's picture, with the sand he digs into as `s`.
const clawdPixels = (cells: string) => pixelsOf(cells, { o: CLAWD.colors.o, k: CLAWD.colors.k, b: CLAWD.colors.b, s: SAND })

// The letters a frame writes beside the pet, each with the cell it stands in.
const lettersOf = (cells: string) =>
  cellsIn(cells).flatMap(([glyph], cell) =>
    glyph === UPPER || glyph === LOWER || glyph === SPACE
      ? []
      : [{ letter: String.fromCodePoint(glyph), row: Math.floor(cell / PET_COLUMNS), column: cell % PET_COLUMNS }],
  )

const EMPTY = '.'.repeat(24)

// A row of a picture standing `x` pixels in, the rest of the raster empty.
const at = (x: number, row: string) => '.'.repeat(x) + row + '.'.repeat(PET_COLUMNS - x - row.length)

test('fills a raster of 24 columns and 8 rows', () => {
  expect(PET_COLUMNS).toBe(24)
  expect(PET_ROWS).toBe(8)
  expect(cellsIn(petFrame(PEACH, 'asleep', 0, STILL).cells)).toHaveLength(24 * 8)
})

test('sleeps on the ground with its eyes closed and its legs tucked', () => {
  expect(pixelsOf(petFrame(PEACH, 'asleep', 0, STILL).cells)).toEqual([
    EMPTY,
    EMPTY,
    EMPTY,
    EMPTY,
    EMPTY,
    EMPTY,
    EMPTY,
    EMPTY,
    '.......oo......oo.......',
    '......oooooooooooo......',
    '......oooooooooooo......',
    '....oooooooooooooooo....',
    '....oookkooooookkooo....',
    '......opoooooooopo......',
    '......oooooooooooo......',
    '......oooooooooooo......',
  ])
})

test('writes a small and a large z above a sleeping pet', () => {
  expect(lettersOf(petFrame(PEACH, 'asleep', 0, STILL).cells)).toEqual([
    { letter: 'Z', row: 1, column: 22 },
    { letter: 'z', row: 2, column: 21 },
  ])
})

test('sleeps the same however long it has slept: nothing moves while idle', () => {
  expect(petFrame(PEACH, 'asleep', 60_000, STILL).cells).toBe(petFrame(PEACH, 'asleep', 0, STILL).cells)
})

test('packs two pixels to a cell: the upper is the block, the lower its background', () => {
  const { cells } = petFrame(PEACH, 'asleep', 0, STILL)

  // Nothing, a lower pixel alone, both the same, and an eye above a cheek.
  expect(cellAt(cells, 0, 0)).toEqual([SPACE, DEFAULT_COLOR, DEFAULT_COLOR])
  expect(cellAt(cells, 4, 6)).toEqual([LOWER, PEACHY, DEFAULT_COLOR])
  expect(cellAt(cells, 4, 7)).toEqual([UPPER, PEACHY, PEACHY])
  expect(cellAt(cells, 6, 7)).toEqual([UPPER, DARK, BLUSH])
})

test('leaves the terminal background under an upper pixel that has none below it', () => {
  // A foot lifted in the walk: its upper pixel is drawn, the one under it is not.
  const { cells, x } = petFrame(PEACH, 'working', 0, STILL)

  expect(cellAt(cells, 7, x + 2)).toEqual([UPPER, PEACHY, DEFAULT_COLOR])
})

test('paints thirty frames a second, which a pane was seen to show one by one', () => {
  expect(PET_FRAME_MS).toBe(33)
})

// A step of the walk is six frames long: a pixel every fifth of a second.
const stepAt = (step: number) => step * 6 * PET_FRAME_MS

test('starts its walk where it slept and goes a pixel a step, there and back', () => {
  const xs = Array.from({ length: 17 }, (_, step) => petFrame(PEACH, 'working', stepAt(step), STILL).x)

  expect(xs).toEqual([4, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4])
})

test('starts a walk from wherever it stood, going right first', () => {
  const xs = [0, 1, 2, 3].map(step => petFrame(PEACH, 'working', stepAt(step), { isHot: false, x: 7 }).x)

  expect(xs).toEqual([7, 8, 7, 6])
})

test('walks a step in two halves: two feet down, then the feet together', () => {
  const [down, together, next] = [0, 3, 6].map(frame => pixelsOf(petFrame(PEACH, 'working', frame * PET_FRAME_MS, STILL).cells))

  expect(down?.slice(10, 12)).toEqual(['....oookkooooookkooo....', '....oookkooooookkooo....'])
  expect(down?.slice(14)).toEqual(['......oo.oo..oo.oo......', '.........oo.....oo......'])
  expect(together?.slice(14)).toEqual(['......oo.oo..oo.oo......', '......oo.oo..oo.oo......'])
  // The next step sets the other two feet down, a pixel further on.
  expect(next?.slice(14)).toEqual(['.......oo.oo..oo.oo.....', '.......oo.....oo........'])
})

test('holds each half of a step for three frames, a tenth of a second: a calm walk', () => {
  // Ten jumps a second, each half a row of text high, read as shaking on a real screen.
  const frames = Array.from({ length: 7 }, (_, frame) => petFrame(PEACH, 'working', frame * PET_FRAME_MS, STILL).cells)

  expect(frames[1]).toBe(frames[0])
  expect(frames[2]).toBe(frames[0])
  expect(frames[3]).not.toBe(frames[2])
  expect(frames[4]).toBe(frames[3])
  expect(frames[5]).toBe(frames[3])
  expect(frames[6]).not.toBe(frames[5])
})

// The pixel row a creature's head begins on.
const topOf = (creature: Creature, frame: number) =>
  pixelsOf(petFrame(creature, 'working', frame * PET_FRAME_MS, STILL).cells, creature.colors).findIndex(row => row !== EMPTY)

test('keeps a creature with legs level as it walks', () => {
  for (const creature of [PEACH, CREATURES.crab, CREATURES.cat, CREATURES.smiley]) {
    const tops = Array.from({ length: 40 }, (_, frame) => topOf(creature, frame))

    expect(new Set(tops).size).toBe(1)
  }
})

test('lets the ghost rise a pixel and sink again as it floats along, slowly', () => {
  const tops = Array.from({ length: 37 }, (_, frame) => topOf(CREATURES.ghost, frame))

  // Up for eighteen frames, down for eighteen: a rise and a fall take a good second.
  expect(tops.slice(0, 18)).toEqual(Array<number>(18).fill(5))
  expect(tops.slice(18, 36)).toEqual(Array<number>(18).fill(6))
  expect(tops[36]).toBe(5)
})

test('ripples the hem of the ghost through three shapes as it floats', () => {
  // The shape of its lowest row, wherever it stands.
  const hemAt = (frame: number) =>
    pixelsOf(petFrame(CREATURES.ghost, 'working', frame * PET_FRAME_MS, STILL).cells, CREATURES.ghost.colors)
      .findLast(row => row !== EMPTY)
      ?.replace(/^\.+|\.+$/g, '')

  expect(new Set([hemAt(0), hemAt(3), hemAt(6)]).size).toBe(3)
})

test('crouches and hops twice when a turn ends, with happy eyes, where it stood', () => {
  const there = { isHot: false, x: 6 }
  const frameAt = (frame: number) => pixelsOf(petFrame(PEACH, 'done', frame * PET_FRAME_MS, there).cells)
  const tops = Array.from({ length: 24 }, (_, frame) => frameAt(frame).findIndex(row => row !== EMPTY))

  // Its ears stand on pixel row 7 on the ground, and on row 8 when it crouches.
  expect(tops).toEqual([8, 8, 7, 5, 4, 3, 2, 2, 2, 2, 3, 4, 5, 7, 8, 7, 6, 5, 4, 4, 4, 5, 6, 7])
  expect(HOPS_MS).toBe(24 * PET_FRAME_MS)
  // Crouched, its legs are tucked under it.
  expect(frameAt(0)[15]).toBe('........oooooooooooo....')
  expect(frameAt(6)[2]).toBe('.........oo......oo.....')
  expect(frameAt(6).slice(5, 7)).toEqual(['......oookkooooookkooo..', '......oooooooooooooooo..'])
  expect(petFrame(PEACH, 'done', 6 * PET_FRAME_MS, there).x).toBe(6)
})

test('stands awake with a drop of sweat when the limit is nearly spent, still while idle', () => {
  const hot = { isHot: true, x: 4 }
  const frame = pixelsOf(petFrame(PEACH, 'asleep', 0, hot).cells)

  // The drop stands over its right shoulder, where it is always inside the picture.
  expect(frame.slice(3, 5)).toEqual(['...................b....', '...................b....'])
  expect(frame.slice(10, 12)).toEqual(['....oookkooooookkooo....', '....oookkooooookkooo....'])
  expect(frame.slice(14)).toEqual(['......oo.oo..oo.oo......', '......oo.oo..oo.oo......'])
  expect(lettersOf(petFrame(PEACH, 'asleep', 0, hot).cells)).toEqual([])
  expect(petFrame(PEACH, 'asleep', 60_000, hot).cells).toBe(petFrame(PEACH, 'asleep', 0, hot).cells)
})

test('drips as it walks when the limit is nearly spent, the drop beside its head', () => {
  const dropAt = (frame: number) => {
    const { cells, x } = petFrame(PEACH, 'working', frame * PET_FRAME_MS, { isHot: true, x: 4 })
    const rows = pixelsOf(cells)
    const row = rows.findIndex(line => line.includes('b'))

    return { row, column: (rows[row] ?? '').indexOf('b') - x }
  }

  // It falls a pixel every four frames, four pixels down, and starts again.
  expect([0, 4, 8, 12, 16].map(frame => dropAt(frame).row)).toEqual([3, 4, 5, 6, 3])
  expect(dropAt(0).column).toBe(15)
  // At the far right of its walk, four steps on, the drop is still in the picture.
  expect(dropAt(24).column).toBe(15)
})

test('says the five-hour limit is nearly spent from 90%', () => {
  const limit = (kind: string, percentUsed: number) => ({ kind, percentUsed, resetsAt: null })

  expect(isHot([limit('five_hour', 89), limit('seven_day', 99)])).toBe(false)
  expect(isHot([limit('five_hour', 90)])).toBe(true)
  expect(isHot([])).toBe(false)
})

test('says the five-hour limit is spent from 100%', () => {
  const limit = (kind: string, percentUsed: number) => ({ kind, percentUsed, resetsAt: null })

  expect(isSpent([limit('five_hour', 99), limit('seven_day', 100)])).toBe(false)
  expect(isSpent([limit('five_hour', 100)])).toBe(true)
  expect(isSpent([])).toBe(false)
})

test('finds the creature the person chose, the crab when they chose none, and none when it is off', () => {
  expect(petOf('cat')).toBe(CREATURES.cat)
  expect(petOf('ghost')).toBe(CREATURES.ghost)
  expect(petOf('smiley')).toBe(CREATURES.smiley)
  expect(petOf(undefined)).toBe(CREATURES.crab)
  expect(petOf('dragon')).toBe(CREATURES.crab)
  expect(petOf('off')).toBe(null)
})

test('turns a creature round so that its tail is behind it both ways', () => {
  const cat = CREATURES.cat
  const there = pixelsOf(petFrame(cat, 'working', 0, STILL).cells, cat.colors)
  const back = pixelsOf(petFrame(cat, 'working', stepAt(4), STILL).cells, cat.colors)

  // Going right the tail is at the left of its head; coming back, at the right.
  expect(there[9]).toBe('....oo...oooooooooo.....')
  expect(back[9]).toBe('.........oooooooooo...oo')
})

test('draws every creature in rows of one width, no wider than Clawd, with two rows of eyes, low enough to hop', () => {
  for (const creature of Object.values(CREATURES) as Creature[]) {
    const bodies = [creature.body, ...(creature.waves ?? [])]
    const feet = Object.values(creature.feet)
    const width = creature.body[0]?.length ?? 0

    expect(width).toBeLessThanOrEqual(18)
    expect([...bodies.flat(), ...feet.flat()].every(row => row.length === width)).toBe(true)
    expect(feet.every(pair => pair.length === 2)).toBe(true)
    expect(bodies.every(body => body.length === creature.body.length)).toBe(true)
    expect(bodies.every(body => body.filter(row => row.includes('E')).length === 2)).toBe(true)
    // Five pixels of air above it when it stands, which is how high it hops.
    expect(creature.body.length + 2).toBeLessThanOrEqual(PET_ROWS * 2 - 5)
  }
})

// ── Clawd ──────────────────────────────────────────────────────────────────

// Clawd as Claude Code draws him on its welcome screen, in quarter blocks.
const WELCOME = [' ▐▛███▜▌ ', '▝▜█████▛▘', '  ▘▘ ▝▝  ']

// Which quarters of its cell a block glyph fills: 1 top left, 2 top right, 4 bottom left, 8 bottom right.
const QUARTERS: Record<string, number> = { ' ': 0, '█': 15, '▐': 10, '▌': 5, '▛': 7, '▜': 11, '▝': 2, '▘': 1 }

test("draws the crab as Clawd: Claude Code's own crab, each quarter of a block one pixel wide and two tall", () => {
  const quarters = WELCOME.flatMap(line =>
    [
      [1, 2],
      [4, 8],
    ].map(([left = 0, right = 0]) =>
      [...line].map(glyph => ((QUARTERS[glyph] ?? 0) & left ? 'o' : '.') + ((QUARTERS[glyph] ?? 0) & right ? 'o' : '.')).join(''),
    ),
  )
  // His eyes are the two quarters Claude Code leaves empty; the lower half of his legs' row is empty too.
  const picture = [...CLAWD.body.map(row => row.replaceAll('E', '.')), ...CLAWD.feet.stand]

  expect(quarters[5]).toBe('.'.repeat(18))
  expect(picture).toEqual(quarters.slice(0, 5).flatMap(row => [row, row]))
})

test('paints Clawd in his own orange with dark eyes', () => {
  expect(CLAWD.colors.o).toBe(0xd77757)
  expect(CLAWD.colors.k).toBe(DARK)
})

test('stands Clawd on the ground, his eyes open, two of his legs set down at a time as he walks', () => {
  const frameAt = (frame: number) => clawdPixels(petFrame(CLAWD, 'working', frame * PET_FRAME_MS, STILL).cells)

  expect(frameAt(3)).toEqual([
    ...Array<string>(6).fill(EMPTY),
    at(4, '...oooooooooooo...'),
    at(4, '...oooooooooooo...'),
    at(4, '...ookooooookoo...'),
    at(4, '...ookooooookoo...'),
    at(4, '.oooooooooooooooo.'),
    at(4, '.oooooooooooooooo.'),
    at(4, '...oooooooooooo...'),
    at(4, '...oooooooooooo...'),
    at(4, '....o.o....o.o....'),
    at(4, '....o.o....o.o....'),
  ])
  expect(frameAt(0).slice(14)).toEqual([at(4, '....o.o....o.o....'), at(4, '......o......o....')])
  expect(frameAt(6).slice(14)).toEqual([at(5, '....o.o....o.o....'), at(5, '....o......o......')])
})

test('walks Clawd edge to edge of the raster, which leaves him two pixels less room', () => {
  const xs = Array.from({ length: 17 }, (_, step) => petFrame(CLAWD, 'working', stepAt(step), STILL).x)

  expect(xs).toEqual([4, 5, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6, 5, 4])
})

test('keeps a pet that stood further right than it can reach inside the raster', () => {
  expect(petFrame(CLAWD, 'asleep', 0, { isHot: true, x: 8 }).x).toBe(6)
  expect(petFrame(CLAWD, 'working', 0, { isHot: false, x: 8 }).x).toBe(6)
})

test('hops Clawd twice with happy eyes when a turn ends', () => {
  const frame = clawdPixels(petFrame(CLAWD, 'done', 6 * PET_FRAME_MS, STILL).cells)

  // Five pixels up at the top of the first hop, his eyes narrowed.
  expect(frame.findIndex(row => row !== EMPTY)).toBe(1)
  expect(frame.slice(3, 5)).toEqual([at(4, '...ookooooookoo...'), at(4, '...oooooooooooo...')])
})

test('digs Clawd into a pile of sand to sleep, a pixel at a time, in about a second', () => {
  const frameAt = (ms: number) => clawdPixels(petFrame(CLAWD, 'asleep', ms, STILL).cells)
  const stages = [0, 10, 20, 30].map(frame => frameAt(frame * PET_FRAME_MS))

  expect(DIG_MS).toBe(30 * PET_FRAME_MS)
  // His head sinks from pixel row 6 to row 8 as the pile grows from one row to four.
  expect(stages.map(rows => rows.findIndex(row => row !== EMPTY))).toEqual([6, 7, 8, 8])
  expect(stages.map(rows => rows.filter(row => row.includes('s')).length)).toEqual([1, 2, 3, 4])
  // He keeps his eyes open while he digs, and is not asleep until he lies still.
  expect(stages[1]?.[9]).toBe(at(4, '...ookooooookoo...'))
  expect(lettersOf(petFrame(CLAWD, 'asleep', 20 * PET_FRAME_MS, STILL).cells)).toEqual([])
})

test('sleeps Clawd in the sand with only his head and closed eyes above it, still, under his z', () => {
  const asleep = petFrame(CLAWD, 'asleep', DIG_MS, STILL).cells

  expect(clawdPixels(asleep)).toEqual([
    ...Array<string>(8).fill(EMPTY),
    at(4, '...oooooooooooo...'),
    at(4, '...oooooooooooo...'),
    at(4, '...oooooooooooo...'),
    at(4, '...ookooooookoo...'),
    at(4, '.ssssssssssssssss.'),
    at(4, 'ssssssssssssssssss'),
    at(4, 'ssssssssssssssssss'),
    at(4, 'ssssssssssssssssss'),
  ])
  expect(lettersOf(asleep)).toEqual([
    { letter: 'Z', row: 1, column: 22 },
    { letter: 'z', row: 2, column: 21 },
  ])
  expect(petFrame(CLAWD, 'asleep', 600_000, STILL).cells).toBe(asleep)
})

test('keeps Clawd awake on the ground, sweating, when the limit is nearly spent: no digging', () => {
  const hot = { isHot: true, x: 4 }
  const frame = clawdPixels(petFrame(CLAWD, 'asleep', DIG_MS, hot).cells)

  expect(frame.some(row => row.includes('s'))).toBe(false)
  expect(frame.findIndex(row => row !== EMPTY && !row.includes('b'))).toBe(6)
  expect(frame.join('')).toContain('b')
})

test('stands Clawd under a yellow question mark while something waits for the person', () => {
  const { cells } = petFrame(CLAWD, 'waiting', 0, STILL)

  // Above the middle of him, a row of air between.
  expect(lettersOf(cells)).toEqual([{ letter: '?', row: 1, column: 13 }])
  expect(cellAt(cells, 1, 13)).toEqual(['?'.codePointAt(0), YELLOW, DEFAULT_COLOR])
})

test('waves a claw while he waits, a beat of twelve frames to each pose', () => {
  const frameAt = (frame: number) => clawdPixels(petFrame(CLAWD, 'waiting', frame * PET_FRAME_MS, STILL).cells)

  // Raised beside his head, then up and out, and back.
  expect(frameAt(0).slice(6, 12)).toEqual([
    at(4, '...oooooooooooo...'),
    at(4, '...oooooooooooo...'),
    at(4, '...ookooooookoo.o.'),
    at(4, '...ookooooookoo.o.'),
    at(4, '.ooooooooooooooo..'),
    at(4, '.ooooooooooooooo..'),
  ])
  expect(frameAt(12).slice(6, 12)).toEqual([
    at(4, '...oooooooooooo...'),
    at(4, '...oooooooooooo..o'),
    at(4, '...ookooooookoo..o'),
    at(4, '...ookooooookoo...'),
    at(4, '.ooooooooooooooo..'),
    at(4, '.ooooooooooooooo..'),
  ])
  expect(frameAt(11)).toEqual(frameAt(0))
  expect(frameAt(24)).toEqual(frameAt(0))
})

test('stands a creature that cannot wave still under the question mark', () => {
  const waiting = petFrame(PEACH, 'waiting', 0, STILL).cells

  expect(petFrame(PEACH, 'waiting', 60_000, STILL).cells).toBe(waiting)
  expect(lettersOf(waiting)).toEqual([{ letter: '?', row: 1, column: 12 }])
  expect(pixelsOf(waiting).slice(10, 12)).toEqual(['....oookkooooookkooo....', '....oookkooooookkooo....'])
})

test('lays Clawd on his back, legs up and crosses for eyes, once the limit is spent, whatever the session does', () => {
  const spent = { isHot: true, isSpent: true, x: 4 }
  const { cells } = petFrame(CLAWD, 'asleep', 0, spent)
  const ORANGE = CLAWD.colors.o

  expect(clawdPixels(cells)).toEqual([
    ...Array<string>(6).fill(EMPTY),
    at(4, '....o.o....o.o....'),
    at(4, '....o.o....o.o....'),
    at(4, '...oooooooooooo...'),
    at(4, '...oooooooooooo...'),
    at(4, '.oooooooooooooooo.'),
    at(4, '.oooooooooooooooo.'),
    at(4, '...oo.oooooo.oo...'),
    at(4, '...oo.oooooo.oo...'),
    at(4, '...oooooooooooo...'),
    at(4, '...oooooooooooo...'),
  ])
  // Each eye is a cell of its own, which holds a dark cross on his orange.
  expect(lettersOf(cells)).toEqual([
    { letter: '×', row: 6, column: 9 },
    { letter: '×', row: 6, column: 16 },
  ])
  expect(cellAt(cells, 6, 9)).toEqual([CROSS, DARK, ORANGE])

  for (const mood of ['working', 'done', 'waiting'] as const) {
    expect(petFrame(CLAWD, mood, 5000, spent).cells).toBe(cells)
  }
})

test('leaves a creature that cannot lie on its back sweating when the limit is spent', () => {
  const spent = { isHot: true, isSpent: true, x: 4 }

  expect(petFrame(PEACH, 'asleep', 0, spent).cells).toBe(petFrame(PEACH, 'asleep', 0, { isHot: true, x: 4 }).cells)
})

test('says from when on a frame no longer changes, so that nothing is painted in vain', () => {
  const cool = { isHot: false, x: 4 }
  const hot = { isHot: true, x: 4 }
  const spent = { isHot: true, isSpent: true, x: 4 }

  expect(petSettlesAt(CLAWD, 'working', cool)).toBe(Number.POSITIVE_INFINITY)
  expect(petSettlesAt(CLAWD, 'done', cool)).toBe(HOPS_MS)
  expect(petSettlesAt(CLAWD, 'asleep', cool)).toBe(DIG_MS)
  expect(petSettlesAt(CLAWD, 'asleep', hot)).toBe(0)
  expect(petSettlesAt(CLAWD, 'waiting', cool)).toBe(Number.POSITIVE_INFINITY)
  expect(petSettlesAt(CLAWD, 'working', spent)).toBe(0)
  expect(petSettlesAt(PEACH, 'asleep', cool)).toBe(0)
  expect(petSettlesAt(PEACH, 'waiting', cool)).toBe(0)
  expect(petSettlesAt(PEACH, 'working', spent)).toBe(Number.POSITIVE_INFINITY)
})
