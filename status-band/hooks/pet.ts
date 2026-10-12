import type { Limit } from '../types'

import { PALETTE } from './format'

// What a raster cell reads as "the terminal's own color".
const DEFAULT_COLOR = 0x01000000

// A cell holds two pixels, one above the other: the upper half block drawn in
// the upper pixel's color, on a background of the lower one's.
const UPPER = 0x2580

const LOWER = 0x2584

const SPACE = 0x20

// The raster the pet is drawn in, and how many rows of pixels that makes.
export const PET_COLUMNS = 24

export const PET_ROWS = 8

const HEIGHT = PET_ROWS * 2

// How long one frame of a moving pet stands: thirty a second. A raster in a
// docked pane was seen to show each of 55 repaints a second on its own
// (photographed 82 times a second on 2.1.293), so every one of these is seen.
export const PET_FRAME_MS = 33

// A step of its walk is six frames, a fifth of a second, in two halves: two
// feet are set down, then the feet come together. A step takes it one pixel
// on, and its walk goes as far as a picture 16 pixels wide can in a raster of
// 24. A pixel is half a row of text, so a walk that changed with every frame
// (tried on 2026-10-08: a pixel up and down ten times a second) shook.
const STEP_FRAMES = 6

// How long a creature that floats stays a pixel up, and then down again.
const BOB_FRAMES = 18

const REACH = PET_COLUMNS - 16

// Where it stands before it has walked: the middle of its walk.
export const PET_HOME = REACH / 2

// How high it is in each frame of the two hops it makes when a turn ends, the
// second one lower. Below the ground it crouches, to jump or as it lands.
const HOPS = [-1, -1, 0, 2, 3, 4, 5, 5, 5, 5, 4, 3, 2, 0, -1, 0, 1, 2, 3, 3, 3, 2, 1, 0]

export const HOPS_MS = HOPS.length * PET_FRAME_MS

// How many frames a drop of sweat takes to fall a pixel, and over which
// shoulder it stands: a column that is inside the raster wherever the pet walks.
const DRIP_FRAMES = 4

const DROP_COLUMN = 15

const DARK = 0x1e1e2e

const BLUE = 0x89b4fa

const hue = ([red = 0, green = 0, blue = 0]: readonly number[]) => (red << 16) | (green << 8) | blue

// What each letter of a creature's picture is painted in: its body, its blush,
// its eyes, and the sweat on it.
type Paint = { o: number; p: number; k: number; b: number }

export type Creature = {
  colors: Paint
  // Its picture without its feet, a letter a pixel, `EE` where an eye goes.
  body: readonly string[]
  // The two rows under it: standing, each step of its walk, and tucked in to sleep.
  feet: Record<'stand' | 'stepA' | 'stepB' | 'tuck', readonly [string, string]>
  // Whether it has no legs to stand on, and so rises and sinks as it goes.
  floats?: boolean
}

// The two rows of an eye, open, closed in sleep, and narrowed with joy.
const EYES = { open: ['kk', 'kk'], closed: ['oo', 'kk'], happy: ['kk', 'oo'] } as const

export const CREATURES = {
  crab: {
    colors: { o: hue(PALETTE.peach), p: 0xf38ba8, k: DARK, b: BLUE },
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
  },
  cat: {
    colors: { o: 0xbac2de, p: hue(PALETTE.pink), k: DARK, b: BLUE },
    body: [
      '.oo......oo.....',
      '.opo....opo.....',
      '.oooooooooo...o.',
      '.oooooooooo...oo',
      '.oEEooooEEo...oo',
      '.oEEooooEEo..oo.',
      '.ooooppoooo.oo..',
      '.oooooooooooo...',
    ],
    feet: {
      stand: ['.oo.oo.oo.oo....', '.oo.oo.oo.oo....'],
      stepA: ['.oo.oo.oo.oo....', '.oo....oo.......'],
      stepB: ['.oo.oo.oo.oo....', '....oo....oo....'],
      tuck: ['.oooooooooooo...', '................'],
    },
  },
  ghost: {
    colors: { o: 0xcdd6f4, p: hue(PALETTE.pink), k: DARK, b: BLUE },
    body: [
      '....oooooooo....',
      '..oooooooooooo..',
      '.oooooooooooooo.',
      '.ooEEooooooEEoo.',
      '.ooEEooooooEEoo.',
      '.oooooooooooooo.',
      '.oopoooooooopoo.',
      '.oooooooooooooo.',
    ],
    // It has a hem for feet, which ripples as it floats along: three shapes,
    // so that each frame of its walk is unlike the one before.
    feet: {
      stand: ['.oooooooooooooo.', '.oooo.o..o.oooo.'],
      stepA: ['.oooooooooooooo.', '.oo.ooo..ooo.oo.'],
      stepB: ['.oooooooooooooo.', '.ooo.oo..oo.ooo.'],
      tuck: ['.oooooooooooooo.', '..oooooooooooo..'],
    },
    floats: true,
  },
  smiley: {
    colors: { o: hue(PALETTE.yellow), p: hue(PALETTE.peach), k: DARK, b: BLUE },
    body: [
      '.....oooooo.....',
      '...oooooooooo...',
      '..oooooooooooo..',
      '..ooEEooooEEoo..',
      '..ooEEooooEEoo..',
      '..oooooooooooo..',
      '..ookooooookoo..',
      '...ookkkkkkoo...',
      '.....oooooo.....',
    ],
    feet: {
      stand: ['.....oo..oo.....', '.....oo..oo.....'],
      stepA: ['.....oo..oo.....', '.....oo.........'],
      stepB: ['.....oo..oo.....', '.........oo.....'],
      tuck: ['......oooo......', '................'],
    },
  },
} satisfies Record<string, Creature>

// The creature the person chose in /config: none when they switched it off,
// and the crab for anything else that names no creature.
export const petOf = (option: unknown): Creature | null => {
  if (option === 'off') {
    return null
  }

  return typeof option === 'string' && Object.hasOwn(CREATURES, option)
    ? CREATURES[option as keyof typeof CREATURES]
    : CREATURES.crab
}

// Whether the five-hour limit is nearly spent, which is what the pet sweats over.
export const isHot = (limits: readonly Limit[]) =>
  limits.some(limit => limit.kind === 'five_hour' && limit.percentUsed >= 90)

// What the session is doing, as the pet shows it: nothing, a turn, or a turn
// that has just ended.
export type Mood = 'asleep' | 'working' | 'done'

// What a frame cannot tell from the mood and the time: whether the limit is
// nearly spent, and where the pet stands, which for a walk is where it set out.
export type Standing = { isHot: boolean; x: number }

type Pose = {
  eyes: keyof typeof EYES
  feet: keyof Creature['feet']
  x: number
  // How many pixels off the ground; a sleeping pet sits one lower than its feet stood.
  lift: number
  // Drawn the other way round, so that what trails it is behind it.
  isTurned: boolean
  // How far the drop of sweat has fallen, where there is one.
  drop: number | null
  isSnoring: boolean
}

const poseOf = (mood: Mood, ms: number, { isHot: isSweating, x }: Standing, floats: boolean): Pose => {
  const frame = Math.floor(ms / PET_FRAME_MS)

  if (mood === 'working') {
    const step = Math.floor(frame / STEP_FRAMES)
    // The walk sets out to the right from where the pet stood and turns at either end.
    const at = (step + x) % (REACH * 2)
    const down = step % 2 === 0 ? 'stepA' : 'stepB'

    return {
      eyes: 'open',
      feet: frame % STEP_FRAMES < STEP_FRAMES / 2 ? down : 'stand',
      x: at < REACH ? at : REACH * 2 - at,
      lift: floats && Math.floor(frame / BOB_FRAMES) % 2 === 0 ? 1 : 0,
      isTurned: at < REACH,
      drop: isSweating ? Math.floor(frame / DRIP_FRAMES) % 4 : null,
      isSnoring: false,
    }
  }

  if (mood === 'done') {
    const lift = HOPS[Math.min(HOPS.length - 1, frame)] ?? 0

    return { eyes: 'happy', feet: lift < 0 ? 'tuck' : 'stand', x, lift, isTurned: false, drop: null, isSnoring: false }
  }

  // Idle, nothing moves: the pet sleeps, or stands awake when the limit is nearly spent.
  return isSweating
    ? { eyes: 'open', feet: 'stand', x, lift: 0, isTurned: false, drop: 0, isSnoring: false }
    : { eyes: 'closed', feet: 'tuck', x, lift: -1, isTurned: false, drop: null, isSnoring: true }
}

const pictureOf = (creature: Creature, { eyes, feet, isTurned }: Pose) => {
  let eye = 0
  const rows = [
    ...creature.body.map(row => (row.includes('EE') ? row.replaceAll('EE', EYES[eyes][eye++] ?? 'oo') : row)),
    ...creature.feet[feet],
  ]

  return isTurned ? rows.map(row => [...row].reverse().join('')) : rows
}

// The letters of sleep, over the pet's shoulder and inside the raster wherever it lies.
const snoreAt = (x: number) => {
  const column = Math.min(x + 17, PET_COLUMNS - 3)

  return [
    { letter: 'z', row: 2, column },
    { letter: 'Z', row: 1, column: column + 1 },
  ]
}

// One frame of the pet, `ms` into its mood, as the cells of its raster, and
// where it stands in that frame: a walk leaves it somewhere, and there it hops
// and sleeps.
export const petFrame = (creature: Creature, mood: Mood, ms: number, standing: Standing) => {
  const pose = poseOf(mood, ms, standing, creature.floats === true)
  const rows = pictureOf(creature, pose)
  const top = HEIGHT - rows.length - pose.lift
  const pixels = Array.from({ length: HEIGHT }, () => Array<string>(PET_COLUMNS).fill('.'))

  const paint = (x: number, y: number, letter: string) => {
    const line = pixels[y]

    if (line !== undefined && x >= 0 && x < PET_COLUMNS && line[x] === '.') {
      line[x] = letter
    }
  }

  rows.forEach((row, y) =>
    [...row].forEach((letter, x) => {
      if (letter !== '.') {
        paint(pose.x + x, top + y, letter)
      }
    }),
  )

  if (pose.drop !== null) {
    paint(pose.x + DROP_COLUMN, 3 + pose.drop, 'b')
    paint(pose.x + DROP_COLUMN, 4 + pose.drop, 'b')
  }

  const letters = pose.isSnoring ? snoreAt(pose.x) : []
  const colorOf = (letter: string) => creature.colors[letter as keyof Paint] ?? DEFAULT_COLOR
  const words = new Uint32Array(PET_COLUMNS * PET_ROWS * 3)

  for (let row = 0; row < PET_ROWS; row++) {
    for (let column = 0; column < PET_COLUMNS; column++) {
      const upper = pixels[row * 2]?.[column] ?? '.'
      const lower = pixels[row * 2 + 1]?.[column] ?? '.'
      const at = (row * PET_COLUMNS + column) * 3

      if (upper === '.' && lower === '.') {
        const written = letters.find(one => one.row === row && one.column === column)
        words[at] = written?.letter.codePointAt(0) ?? SPACE
        words[at + 1] = written === undefined ? DEFAULT_COLOR : BLUE
        words[at + 2] = DEFAULT_COLOR
      } else if (upper === '.') {
        words[at] = LOWER
        words[at + 1] = colorOf(lower)
        words[at + 2] = DEFAULT_COLOR
      } else {
        words[at] = UPPER
        words[at + 1] = colorOf(upper)
        words[at + 2] = lower === '.' ? DEFAULT_COLOR : colorOf(lower)
      }
    }
  }

  // A mod's environment has Uint8Array's base64 methods; the es2023 lib does not name them.
  return { cells: (new Uint8Array(words.buffer) as Uint8Array & { toBase64(): string }).toBase64(), x: pose.x }
}
