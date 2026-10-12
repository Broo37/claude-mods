import { expect, test } from 'claude-code/testing'

import { CREATURES, HOPS_MS, PET_COLUMNS, PET_FRAME_MS, PET_ROWS, isHot, petFrame, petOf } from '../hooks/pet'

// What a raster cell reads as "the terminal's own color".
const DEFAULT_COLOR = 0x01000000

const UPPER = '▀'.codePointAt(0)
const LOWER = '▄'.codePointAt(0)
const SPACE = 0x20

const CRAB = CREATURES.crab
const { o: PEACH, k: DARK, p: BLUSH } = CRAB.colors

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
const pixelsOf = (cells: string, colors: Record<string, number> = CRAB.colors) => {
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

// The letters a frame writes beside the pet, each with the cell it stands in.
const lettersOf = (cells: string) =>
  cellsIn(cells).flatMap(([glyph], cell) =>
    glyph === UPPER || glyph === LOWER || glyph === SPACE
      ? []
      : [{ letter: String.fromCodePoint(glyph), row: Math.floor(cell / PET_COLUMNS), column: cell % PET_COLUMNS }],
  )

const EMPTY = '.'.repeat(24)

test('fills a raster of 24 columns and 8 rows', () => {
  expect(PET_COLUMNS).toBe(24)
  expect(PET_ROWS).toBe(8)
  expect(cellsIn(petFrame(CRAB, 'asleep', 0, STILL).cells)).toHaveLength(24 * 8)
})

test('sleeps on the ground with its eyes closed and its legs tucked', () => {
  expect(pixelsOf(petFrame(CRAB, 'asleep', 0, STILL).cells)).toEqual([
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
  expect(lettersOf(petFrame(CRAB, 'asleep', 0, STILL).cells)).toEqual([
    { letter: 'Z', row: 1, column: 22 },
    { letter: 'z', row: 2, column: 21 },
  ])
})

test('sleeps the same however long it has slept: nothing moves while idle', () => {
  expect(petFrame(CRAB, 'asleep', 60_000, STILL).cells).toBe(petFrame(CRAB, 'asleep', 0, STILL).cells)
})

test('packs two pixels to a cell: the upper is the block, the lower its background', () => {
  const { cells } = petFrame(CRAB, 'asleep', 0, STILL)

  // Nothing, a lower pixel alone, both the same, and an eye above a cheek.
  expect(cellAt(cells, 0, 0)).toEqual([SPACE, DEFAULT_COLOR, DEFAULT_COLOR])
  expect(cellAt(cells, 4, 6)).toEqual([LOWER, PEACH, DEFAULT_COLOR])
  expect(cellAt(cells, 4, 7)).toEqual([UPPER, PEACH, PEACH])
  expect(cellAt(cells, 6, 7)).toEqual([UPPER, DARK, BLUSH])
})

test('leaves the terminal background under an upper pixel that has none below it', () => {
  // A foot lifted in the walk: its upper pixel is drawn, the one under it is not.
  const { cells, x } = petFrame(CRAB, 'working', 0, STILL)

  expect(cellAt(cells, 7, x + 2)).toEqual([UPPER, PEACH, DEFAULT_COLOR])
})

test('paints thirty frames a second, which a pane was seen to show one by one', () => {
  expect(PET_FRAME_MS).toBe(33)
})

// A step of the walk is six frames long: a pixel every fifth of a second.
const stepAt = (step: number) => step * 6 * PET_FRAME_MS

test('starts its walk where it slept and goes a pixel a step, there and back', () => {
  const xs = Array.from({ length: 17 }, (_, step) => petFrame(CRAB, 'working', stepAt(step), STILL).x)

  expect(xs).toEqual([4, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4])
})

test('starts a walk from wherever it stood, going right first', () => {
  const xs = [0, 1, 2, 3].map(step => petFrame(CRAB, 'working', stepAt(step), { isHot: false, x: 7 }).x)

  expect(xs).toEqual([7, 8, 7, 6])
})

test('walks a step in two halves: two feet down, then the feet together', () => {
  const [down, together, next] = [0, 3, 6].map(frame => pixelsOf(petFrame(CRAB, 'working', frame * PET_FRAME_MS, STILL).cells))

  expect(down?.slice(10, 12)).toEqual(['....oookkooooookkooo....', '....oookkooooookkooo....'])
  expect(down?.slice(14)).toEqual(['......oo.oo..oo.oo......', '.........oo.....oo......'])
  expect(together?.slice(14)).toEqual(['......oo.oo..oo.oo......', '......oo.oo..oo.oo......'])
  // The next step sets the other two feet down, a pixel further on.
  expect(next?.slice(14)).toEqual(['.......oo.oo..oo.oo.....', '.......oo.....oo........'])
})

test('holds each half of a step for three frames, a tenth of a second: a calm walk', () => {
  // Ten jumps a second, each half a row of text high, read as shaking on a real screen.
  const frames = Array.from({ length: 7 }, (_, frame) => petFrame(CRAB, 'working', frame * PET_FRAME_MS, STILL).cells)

  expect(frames[1]).toBe(frames[0])
  expect(frames[2]).toBe(frames[0])
  expect(frames[3]).not.toBe(frames[2])
  expect(frames[4]).toBe(frames[3])
  expect(frames[5]).toBe(frames[3])
  expect(frames[6]).not.toBe(frames[5])
})

// The pixel row a creature's head begins on.
const topOf = (creature: (typeof CREATURES)[keyof typeof CREATURES], frame: number) =>
  pixelsOf(petFrame(creature, 'working', frame * PET_FRAME_MS, STILL).cells, creature.colors).findIndex(row => row !== EMPTY)

test('keeps a creature with legs level as it walks', () => {
  for (const creature of [CREATURES.crab, CREATURES.cat, CREATURES.smiley]) {
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
  const frameAt = (frame: number) => pixelsOf(petFrame(CRAB, 'done', frame * PET_FRAME_MS, there).cells)
  const tops = Array.from({ length: 24 }, (_, frame) => frameAt(frame).findIndex(row => row !== EMPTY))

  // Its ears stand on pixel row 7 on the ground, and on row 8 when it crouches.
  expect(tops).toEqual([8, 8, 7, 5, 4, 3, 2, 2, 2, 2, 3, 4, 5, 7, 8, 7, 6, 5, 4, 4, 4, 5, 6, 7])
  expect(HOPS_MS).toBe(24 * PET_FRAME_MS)
  // Crouched, its legs are tucked under it.
  expect(frameAt(0)[15]).toBe('........oooooooooooo....')
  expect(frameAt(6)[2]).toBe('.........oo......oo.....')
  expect(frameAt(6).slice(5, 7)).toEqual(['......oookkooooookkooo..', '......oooooooooooooooo..'])
  expect(petFrame(CRAB, 'done', 6 * PET_FRAME_MS, there).x).toBe(6)
})

test('stands awake with a drop of sweat when the limit is nearly spent, still while idle', () => {
  const hot = { isHot: true, x: 4 }
  const frame = pixelsOf(petFrame(CRAB, 'asleep', 0, hot).cells)

  // The drop stands over its right shoulder, where it is always inside the picture.
  expect(frame.slice(3, 5)).toEqual(['...................b....', '...................b....'])
  expect(frame.slice(10, 12)).toEqual(['....oookkooooookkooo....', '....oookkooooookkooo....'])
  expect(frame.slice(14)).toEqual(['......oo.oo..oo.oo......', '......oo.oo..oo.oo......'])
  expect(lettersOf(petFrame(CRAB, 'asleep', 0, hot).cells)).toEqual([])
  expect(petFrame(CRAB, 'asleep', 60_000, hot).cells).toBe(petFrame(CRAB, 'asleep', 0, hot).cells)
})

test('drips as it walks when the limit is nearly spent, the drop beside its head', () => {
  const dropAt = (frame: number) => {
    const { cells, x } = petFrame(CRAB, 'working', frame * PET_FRAME_MS, { isHot: true, x: 4 })
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

test('draws every creature sixteen pixels wide and low enough to hop', () => {
  for (const creature of Object.values(CREATURES)) {
    const feet = Object.values(creature.feet)
    const rows = [...creature.body, ...feet.flat()]

    expect(rows.every(row => row.length === 16)).toBe(true)
    expect(feet.every(pair => pair.length === 2)).toBe(true)
    expect(creature.body.filter(row => row.includes('EE'))).toHaveLength(2)
    // Five pixels of air above it when it stands, which is how high it hops.
    expect(creature.body.length + 2).toBeLessThanOrEqual(PET_ROWS * 2 - 5)
  }
})
