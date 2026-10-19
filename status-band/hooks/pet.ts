import type { Limit } from '../types'

import { PALETTE } from './format'

// What a raster cell reads as "the terminal's own color".
const DEFAULT_COLOR = 0x01000000

// A cell holds two pixels, one above the other: the upper half block drawn in
// the upper pixel's color, on a background of the lower one's.
const UPPER = 0x2580

const LOWER = 0x2584

const SPACE = 0x20

// An eye crossed out: a whole cell, its letter dark on the body's color.
const CROSS = 0xd7

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
// on, and its walk goes as far as its picture leaves room for in a raster of
// 24. A pixel is half a row of text, so a walk that changed with every frame
// (tried on 2026-10-08: a pixel up and down ten times a second) shook.
const STEP_FRAMES = 6

// How long a creature that floats stays a pixel up, and then down again.
const BOB_FRAMES = 18

// Where it stands before it has walked: the middle of a sixteen-pixel creature's walk.
export const PET_HOME = 4

// How high it is in each frame of the two hops it makes when a turn ends, the
// second one lower. Below the ground it crouches, to jump or as it lands.
const HOPS = [-1, -1, 0, 2, 3, 4, 5, 5, 5, 5, 4, 3, 2, 0, -1, 0, 1, 2, 3, 3, 3, 2, 1, 0]

export const HOPS_MS = HOPS.length * PET_FRAME_MS

// A creature that burrows digs in three stages of ten frames, a pixel deeper
// as its pile of sand grows a row, and then lies still, two pixels down under
// four rows of sand: about a second, as Clawd burrows in the YASB widget.
const DIG_STAGE_FRAMES = 10

const DIG_STAGES = 3

const DIG_DEPTH = 2

export const DIG_MS = DIG_STAGES * DIG_STAGE_FRAMES * PET_FRAME_MS

// The sand it digs into.
export const SAND = 0xd8b07a

// How many frames a claw stays in each pose of a wave: about two and a half a second.
const WAVE_FRAMES = 12

// How many frames a drop of sweat takes to fall a pixel.
const DRIP_FRAMES = 4

const DARK = 0x1e1e2e

const BLUE = 0x89b4fa

const hue = ([red = 0, green = 0, blue = 0]: readonly number[]) => (red << 16) | (green << 8) | blue

const YELLOW = hue(PALETTE.yellow)

// What each letter of a creature's picture is painted in: its body, its blush,
// its eyes, and the sweat on it.
type Paint = { o: number; p: number; k: number; b: number }

export type Creature = {
  colors: Paint
  // Its picture without its feet, a letter a pixel, `E` where an eye goes.
  body: readonly string[]
  // The two rows under it: standing, each step of its walk, and tucked in to sleep.
  feet: Record<'stand' | 'stepA' | 'stepB' | 'tuck', readonly [string, string]>
  // Whether it has no legs to stand on, and so rises and sinks as it goes.
  floats?: boolean
  // Its picture with a claw raised, in the two poses of a wave, for one that
  // waves while something waits for the person.
  waves?: readonly [readonly string[], readonly string[]]
  // Whether it digs into sand to sleep, its eyes above the sand.
  burrows?: boolean
  // Whether it lies on its back, legs up and crosses for eyes, once the limit is spent.
  liesOnBack?: boolean
}

// The two rows of an eye, open, closed in sleep, narrowed with joy, and crossed out.
const EYES = { open: ['k', 'k'], closed: ['o', 'k'], happy: ['k', 'o'], crossed: ['x', 'x'] } as const

export const CREATURES = {
  // Clawd, the crab of Claude Code's welcome screen: each quarter of its
  // blocks is a pixel here, one wide and two tall, so he keeps his shape.
  crab: {
    colors: { o: 0xd77757, p: 0xd77757, k: DARK, b: BLUE },
    body: [
      '...oooooooooooo...',
      '...oooooooooooo...',
      '...ooEooooooEoo...',
      '...ooEooooooEoo...',
      '.oooooooooooooooo.',
      '.oooooooooooooooo.',
      '...oooooooooooo...',
      '...oooooooooooo...',
    ],
    feet: {
      stand: ['....o.o....o.o....', '....o.o....o.o....'],
      stepA: ['....o.o....o.o....', '....o......o......'],
      stepB: ['....o.o....o.o....', '......o......o....'],
      tuck: ['....o.o....o.o....', '..................'],
    },
    waves: [
      [
        '...oooooooooooo...',
        '...oooooooooooo...',
        '...ooEooooooEoo.o.',
        '...ooEooooooEoo.o.',
        '.ooooooooooooooo..',
        '.ooooooooooooooo..',
        '...oooooooooooo...',
        '...oooooooooooo...',
      ],
      [
        '...oooooooooooo...',
        '...oooooooooooo..o',
        '...ooEooooooEoo..o',
        '...ooEooooooEoo...',
        '.ooooooooooooooo..',
        '.ooooooooooooooo..',
        '...oooooooooooo...',
        '...oooooooooooo...',
      ],
    ],
    burrows: true,
    liesOnBack: true,
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

// Whether the five-hour limit is spent, which lays a pet that can lie on its back down.
export const isSpent = (limits: readonly Limit[]) =>
  limits.some(limit => limit.kind === 'five_hour' && limit.percentUsed >= 100)

// What the session is doing, as the pet shows it: nothing, a turn, a turn
// that has just ended, or a question or a permission put to the person.
export type Mood = 'asleep' | 'working' | 'done' | 'waiting'

// What a frame cannot tell from the mood and the time: whether the limit is
// nearly spent or spent, and where the pet stands, which for a walk is where it set out.
export type Standing = { isHot: boolean; isSpent?: boolean; x: number }

type Pose = {
  eyes: keyof typeof EYES
  feet: keyof Creature['feet']
  // Which pose of its wave it is drawn in, if it is waving.
  wave: 0 | 1 | null
  x: number
  // How many pixels off the ground; a sleeping pet sits one lower than its feet stood.
  lift: number
  // Drawn the other way round, so that what trails it is behind it.
  isTurned: boolean
  // Drawn upside down, on its back.
  isFlipped: boolean
  // How far the drop of sweat has fallen, where there is one.
  drop: number | null
  isSnoring: boolean
  // Whether a question mark stands over it.
  isAsking: boolean
  // How many rows of sand are piled up around it.
  sand: number
}

const widthOf = (creature: Creature) => creature.body[0]?.length ?? 0

// How far it can walk: the room its picture leaves in the raster.
const reachOf = (creature: Creature) => PET_COLUMNS - widthOf(creature)

const liesSpent = (creature: Creature, standing: Standing) => standing.isSpent === true && creature.liesOnBack === true

const poseOf = (creature: Creature, mood: Mood, ms: number, standing: Standing): Pose => {
  const frame = Math.floor(ms / PET_FRAME_MS)
  const reach = reachOf(creature)
  const x = Math.min(Math.max(standing.x, 0), reach)
  const standingStill: Pose = {
    eyes: 'open',
    feet: 'stand',
    wave: null,
    x,
    lift: 0,
    isTurned: false,
    isFlipped: false,
    drop: null,
    isSnoring: false,
    isAsking: false,
    sand: 0,
  }

  if (liesSpent(creature, standing)) {
    return { ...standingStill, eyes: 'crossed', isFlipped: true }
  }

  if (mood === 'working') {
    const step = Math.floor(frame / STEP_FRAMES)
    // The walk sets out to the right from where the pet stood and turns at either end.
    const along = (step + x) % (reach * 2)
    const down = step % 2 === 0 ? 'stepA' : 'stepB'

    return {
      ...standingStill,
      feet: frame % STEP_FRAMES < STEP_FRAMES / 2 ? down : 'stand',
      x: along < reach ? along : reach * 2 - along,
      lift: creature.floats === true && Math.floor(frame / BOB_FRAMES) % 2 === 0 ? 1 : 0,
      isTurned: along < reach,
      drop: standing.isHot ? Math.floor(frame / DRIP_FRAMES) % 4 : null,
    }
  }

  if (mood === 'done') {
    const lift = HOPS[Math.min(HOPS.length - 1, frame)] ?? 0

    return { ...standingStill, eyes: 'happy', feet: lift < 0 ? 'tuck' : 'stand', lift }
  }

  if (mood === 'waiting') {
    return {
      ...standingStill,
      wave: creature.waves === undefined ? null : Math.floor(frame / WAVE_FRAMES) % 2 === 0 ? 0 : 1,
      isAsking: true,
    }
  }

  // Idle, nothing moves once it lies still: it sleeps, or stands awake when the limit is nearly spent.
  if (standing.isHot) {
    return { ...standingStill, drop: 0 }
  }

  if (creature.burrows === true) {
    const stage = Math.min(DIG_STAGES, Math.floor(frame / DIG_STAGE_FRAMES))
    const isDug = stage === DIG_STAGES

    return {
      ...standingStill,
      eyes: isDug ? 'closed' : 'open',
      lift: -Math.min(stage, DIG_DEPTH),
      isSnoring: isDug,
      sand: stage + 1,
    }
  }

  return { ...standingStill, eyes: 'closed', feet: 'tuck', lift: -1, isSnoring: true }
}

// From how far into a mood its frames no longer change: a walk and a wave go
// on, the hops end, a burrow is dug in a second, and anything else stands still.
export const petSettlesAt = (creature: Creature, mood: Mood, standing: Standing) => {
  if (liesSpent(creature, standing)) {
    return 0
  }

  if (mood === 'working') {
    return Number.POSITIVE_INFINITY
  }

  if (mood === 'done') {
    return HOPS_MS
  }

  if (mood === 'waiting') {
    return creature.waves === undefined ? 0 : Number.POSITIVE_INFINITY
  }

  return !standing.isHot && creature.burrows === true ? DIG_MS : 0
}

const pictureOf = (creature: Creature, { eyes, feet, wave, isTurned, isFlipped }: Pose) => {
  let eye = 0
  const body = wave === null ? creature.body : (creature.waves?.[wave] ?? creature.body)
  const rows = [
    ...body.map(row => (row.includes('E') ? row.replaceAll('E', EYES[eyes][eye++] ?? 'o') : row)),
    ...creature.feet[feet],
  ]
  const facing = isTurned ? rows.map(row => [...row].reverse().join('')) : rows

  return isFlipped ? facing.toReversed() : facing
}

// The letters of sleep, over the pet's shoulder and inside the raster wherever it lies.
const snoreAt = (x: number) => {
  const column = Math.min(x + 17, PET_COLUMNS - 3)

  return [
    { letter: 'z', row: 2, column, color: BLUE },
    { letter: 'Z', row: 1, column: column + 1, color: BLUE },
  ]
}

// One frame of the pet, `ms` into its mood, as the cells of its raster, and
// where it stands in that frame: a walk leaves it somewhere, and there it hops
// and sleeps.
export const petFrame = (creature: Creature, mood: Mood, ms: number, standing: Standing) => {
  const pose = poseOf(creature, mood, ms, standing)
  const rows = pictureOf(creature, pose)
  const width = widthOf(creature)
  const top = HEIGHT - rows.length - pose.lift
  const pixels = Array.from({ length: HEIGHT }, () => Array<string>(PET_COLUMNS).fill('.'))

  // What is painted first stays: the sand goes before the pet it covers.
  const paint = (x: number, y: number, letter: string) => {
    const line = pixels[y]

    if (line !== undefined && x >= 0 && x < PET_COLUMNS && line[x] === '.') {
      line[x] = letter
    }
  }

  // The pile's top row stands a pixel in from either side of the pet.
  for (let depth = 0; depth < pose.sand; depth++) {
    const inset = depth === 0 ? 1 : 0

    for (let x = inset; x < width - inset; x++) {
      paint(pose.x + x, HEIGHT - pose.sand + depth, 's')
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
    paint(pose.x + width - 1, 3 + pose.drop, 'b')
    paint(pose.x + width - 1, 4 + pose.drop, 'b')
  }

  const letters = [
    ...(pose.isSnoring ? snoreAt(pose.x) : []),
    ...(pose.isAsking ? [{ letter: '?', row: 1, column: pose.x + Math.floor(width / 2), color: YELLOW }] : []),
  ]
  const colors: Record<string, number> = { ...creature.colors, x: creature.colors.k, s: SAND }
  const colorOf = (letter: string) => colors[letter] ?? DEFAULT_COLOR
  const words = new Uint32Array(PET_COLUMNS * PET_ROWS * 3)

  for (let row = 0; row < PET_ROWS; row++) {
    for (let column = 0; column < PET_COLUMNS; column++) {
      const upper = pixels[row * 2]?.[column] ?? '.'
      const lower = pixels[row * 2 + 1]?.[column] ?? '.'
      const at = (row * PET_COLUMNS + column) * 3

      if (upper === 'x' && lower === 'x') {
        words[at] = CROSS
        words[at + 1] = colorOf('x')
        words[at + 2] = creature.colors.o
      } else if (upper === '.' && lower === '.') {
        const written = letters.find(one => one.row === row && one.column === column)
        words[at] = written?.letter.codePointAt(0) ?? SPACE
        words[at + 1] = written?.color ?? DEFAULT_COLOR
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
