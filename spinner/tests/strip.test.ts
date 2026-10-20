import { expect, test } from 'claude-code/testing'

import { COMET, headAt } from '../hooks/comet'
import { BARS, BARS_MS, EQUALIZER, glowOf } from '../hooks/equalizer'
import { FRAME_MS, FRAMES } from '../hooks/frames'
import { LOOKS, SMILEY, lookOf } from '../hooks/looks'
import { PONG, ballAt } from '../hooks/pong'
import { RAINBOW, hueOf } from '../hooks/rainbow'
import { HEIGHTS, cellsAt, cellsOf, claudeIn, elapsedOf, frameNo, lit, saidOf, themeFile } from '../hooks/strip'
import type { Look } from '../hooks/strip'

// What a raster cell reads as "the terminal's own color".
const DEFAULT_COLOR = 0x01000000

const PEACH = 0xf0c0a8

// The cells of a raster as the numbers they were packed from.
const wordsIn = (cells: string) => {
  const base64 = Uint8Array as unknown as { fromBase64(text: string): Uint8Array<ArrayBuffer> }

  return [...new Uint32Array(base64.fromBase64(cells).buffer)]
}

// The colors of a strip's cells, a column after the other.
const inksIn = (cells: string) => wordsIn(cells).filter((_, at) => at % 3 === 1)

// The colors a look is drawn in, in a frame of its round, from the peach.
const inksOf = (look: Look, frame: number) => inksIn(cellsAt(look, frame * look.frameMs, PEACH))

// How high each bar of a frame stands, 1 to 8, and 0 for what is no bar.
const heightsIn = (frame: string) => [...frame].map(bar => HEIGHTS.indexOf(bar) + 1)

// Every frame of a round of bars beside the one that follows it, the first following the last.
const stepsIn = (frames: readonly string[]) =>
  frames.map((frame, at) => [heightsIn(frame), heightsIn(frames[(at + 1) % frames.length] ?? '')] as const)

const steps = stepsIn(BARS)

// The columns a round takes there and back between two ends, a column a frame.
const thereAndBack = (from: number, to: number) => [
  ...Array.from({ length: to - from + 1 }, (_, at) => from + at),
  ...Array.from({ length: to - from - 1 }, (_, at) => to - 1 - at),
]

test('has five strips to pick from, each twelve cells wide in every frame and 80 ms a frame', () => {
  expect([...LOOKS.keys()]).toEqual(['equalizer', 'rainbow', 'comet', 'pong', 'smiley'])
  expect(
    [...LOOKS.values()].every(
      look => look.frameMs === 80 && look.frames.every(frame => frame.length === 12 && [...frame].length === 12),
    ),
  ).toBe(true)
})

test('draws the strip a pick stands for, and the equalizer for none or one there is no strip of', () => {
  expect(lookOf('equalizer')).toBe(EQUALIZER)
  expect(lookOf('rainbow')).toBe(RAINBOW)
  expect(lookOf('comet')).toBe(COMET)
  expect(lookOf('pong')).toBe(PONG)
  expect(lookOf('smiley')).toBe(SMILEY)
  expect(lookOf(undefined)).toBe(EQUALIZER)
  expect(lookOf('disco')).toBe(EQUALIZER)
  expect(lookOf('constructor')).toBe(EQUALIZER)
  expect(lookOf(7)).toBe(EQUALIZER)
})

test('holds an equalizer of 96 frames, each twelve bars a raster cell can hold', () => {
  expect(BARS.length).toBe(96)
  expect(BARS_MS).toBe(80)
  expect(BARS.every(frame => frame.length === 12 && heightsIn(frame).every(height => height > 0))).toBe(true)
})

test('lets a bar of the equalizer fall a level a frame at most, from the last frame into the first too', () => {
  const falls = steps.flatMap(([now, then]) => now.map((height, bar) => height - (then[bar] ?? 0)))

  expect(Math.max(...falls)).toBe(1)
})

test('moves the equalizer with every frame', () => {
  expect(steps.every(([now, then]) => now.join() !== then.join())).toBe(true)
})

test('sends every bar of the equalizer high and lets it fall to the bottom', () => {
  const bars = Array.from({ length: 12 }, (_, bar) => BARS.map(frame => heightsIn(frame)[bar] ?? 0))

  expect(bars.every(bar => Math.max(...bar) >= 7 && Math.min(...bar) === 1)).toBe(true)
})

test('lights a bar of the equalizer the more the taller it is, and what is no bar in full', () => {
  const glows = [...HEIGHTS].map(bar => glowOf(bar.codePointAt(0) ?? 0))

  expect(glows[0]).toBe(0.45)
  expect(glows[7]).toBe(1)
  expect(glows.every((glow, at) => at === 0 || glow > (glows[at - 1] ?? 1))).toBe(true)
  expect(glowOf(0x20)).toBe(1)
})

test('dims a color channel by channel, and never past black or its own brightness', () => {
  expect(lit(PEACH, 1)).toBe(PEACH)
  expect(lit(PEACH, 0.5)).toBe(0x786054)
  expect(lit(PEACH, 0)).toBe(0)
  expect(lit(PEACH, 2)).toBe(PEACH)
  expect(lit(PEACH, -1)).toBe(0)
})

test('draws the equalizer with each bar as bright as it is tall', () => {
  expect(inksOf(EQUALIZER, 0)).toEqual(
    heightsIn(BARS[0] ?? '').map(height => lit(PEACH, glowOf(HEIGHTS.codePointAt(height - 1) ?? 0))),
  )
  expect(lit(PEACH, glowOf(0x2581))).toBe(0x6c564c)
})

test('rolls the rainbow wave a column to the left every two frames, round and round', () => {
  const { frames } = RAINBOW

  expect(frames.length).toBe(72)
  expect(frames[0]).toBe('▅▇██▇▆▄▂▁▁▂▃')
  expect(frames.every((frame, at) => frames[(at + 2) % frames.length] === frame.slice(1) + frame.slice(0, 1))).toBe(true)
})

test('lets a bar of the rainbow wave rise or fall a level a frame at most', () => {
  const moves = stepsIn(RAINBOW.frames).flatMap(([now, then]) => now.map((height, bar) => Math.abs(height - (then[bar] ?? 0))))

  expect(Math.max(...moves)).toBe(1)
})

test('gives every column of the rainbow wave a color of its own, drifting a column to the left every six frames', () => {
  const first = inksOf(RAINBOW, 0)

  expect(first).toEqual(Array.from({ length: 12 }, (_, column) => hueOf(column * 30)))
  expect(new Set(first).size).toBe(12)
  expect(inksOf(RAINBOW, 6)).toEqual([...first.slice(1), ...first.slice(0, 1)])
  expect(inksOf(RAINBOW, 72)).toEqual(first)
})

test('names a color of the rainbow by its place on the wheel, softened', () => {
  expect(hueOf(0)).toBe(0xff4d4d)
  expect(hueOf(60)).toBe(0xffff4d)
  expect(hueOf(120)).toBe(0x4dff4d)
  expect(hueOf(240)).toBe(0x4d4dff)
  expect(hueOf(360)).toBe(0xff4d4d)
  expect(hueOf(-120)).toBe(0x4d4dff)
})

test('runs the head of the comet from end to end and back, a column a frame', () => {
  expect(COMET.frames.map(frame => frame.indexOf('█'))).toEqual(thereAndBack(0, 11))
  expect(COMET.frames.every(frame => frame.indexOf('█') === frame.lastIndexOf('█'))).toBe(true)
  expect(headAt(22)).toBe(0)
  expect(headAt(-1)).toBe(1)
})

test('draws the tail of the comet behind its head, and folded over where the head turns', () => {
  expect(COMET.frames[5]).toBe('  ░▒▓█      ')
  expect(COMET.frames[16]).toBe('      █▓▒░  ')
  expect(COMET.frames[12]).toBe('         ░█▓')
  expect(COMET.frames[1]).toBe('▓█░         ')
})

test('fades the tail of the comet the farther from its head', () => {
  expect(inksOf(COMET, 5).slice(2, 6)).toEqual([lit(PEACH, 0.45), lit(PEACH, 0.6), lit(PEACH, 0.8), PEACH])
})

test('runs the ball of the pong from paddle to paddle and back, a column a frame', () => {
  expect(PONG.frames.map(frame => frame.indexOf('●'))).toEqual(thereAndBack(1, 10))
  expect(PONG.frames.every(frame => frame.startsWith('▌') && frame.endsWith('▐'))).toBe(true)
  expect(ballAt(18)).toBe(1)
  expect(ballAt(-1)).toBe(2)
})

test('lights a paddle of the pong while the ball is within two columns of it', () => {
  const paddles = (frame: number) => [inksOf(PONG, frame)[0], inksOf(PONG, frame)[11]]
  const resting = lit(PEACH, 0.5)

  expect(paddles(0)).toEqual([PEACH, resting])
  expect(paddles(1)).toEqual([PEACH, resting])
  expect(paddles(2)).toEqual([resting, resting])
  expect(paddles(7)).toEqual([resting, resting])
  expect(paddles(8)).toEqual([resting, PEACH])
  expect(paddles(9)).toEqual([resting, PEACH])
  expect(paddles(17)).toEqual([PEACH, resting])
  // The ball is drawn in full wherever it is.
  expect(inksOf(PONG, 5)[6]).toBe(PEACH)
})

test('packs a frame with each cell in the color an ink has for its character and its column', () => {
  expect(wordsIn(cellsOf('ab', PEACH, (codePoint, column) => codePoint * 16 + column))).toEqual([
    0x61,
    0x610,
    DEFAULT_COLOR,
    0x62,
    0x621,
    DEFAULT_COLOR,
  ])
})

test('draws a look in its ink, told the color, the column and the frame of the round', () => {
  const look: Look = {
    frames: ['ab', 'cd'],
    frameMs: 80,
    ink: (color, codePoint, column, frame) => color + codePoint + column * 0x100 + frame * 0x10000,
  }

  expect(wordsIn(cellsAt(look, 80, 1))).toEqual([0x63, 0x10064, DEFAULT_COLOR, 0x64, 0x10165, DEFAULT_COLOR])
  expect(cellsAt(look, 160, 1)).toBe(cellsAt(look, 0, 1))
})

test('draws a look that has no ink all in the one color', () => {
  expect(wordsIn(cellsAt({ frames: ['ab'], frameMs: 80 }, 0, PEACH))).toEqual([
    0x61,
    PEACH,
    DEFAULT_COLOR,
    0x62,
    PEACH,
    DEFAULT_COLOR,
  ])
})

test('holds the 133 frames of the old spinner, each twelve characters a raster cell can hold', () => {
  expect(FRAMES.length).toBe(133)
  expect(FRAME_MS).toBe(80)
  // A character outside the basic plane would be two code units and no single cell.
  expect(FRAMES.every(frame => frame.length === 12 && [...frame].length === 12)).toBe(true)
})

test('shows each frame for 80 ms and starts over after the last', () => {
  expect(frameNo(133, 0, 80)).toBe(0)
  expect(frameNo(133, 79, 80)).toBe(0)
  expect(frameNo(133, 80, 80)).toBe(1)
  expect(frameNo(133, 133 * 80, 80)).toBe(0)
  expect(frameNo(133, 133 * 80 + 240, 80)).toBe(3)
})

test('shows the first frame for a time before the start', () => {
  expect(frameNo(133, -500, 80)).toBe(0)
})

test('packs a frame as raster cells, each its character in the given color on the terminal background', () => {
  expect(wordsIn(cellsOf('☺█ ', PEACH))).toEqual([
    0x263a,
    PEACH,
    DEFAULT_COLOR,
    0x2588,
    PEACH,
    DEFAULT_COLOR,
    0x20,
    PEACH,
    DEFAULT_COLOR,
  ])
})

test('puts the verb where the wording has {}', () => {
  expect(saidOf('Claude will get {}...', { word: 'Baking', message: null, suffix: '…' })).toBe('Claude will get Baking...')
})

test('says a wording without {} as it is', () => {
  expect(saidOf('Working', { word: 'Baking', message: null, suffix: '…' })).toBe('Working')
})

test('says a message that overrides the verb, with the mark that the turn goes on', () => {
  expect(saidOf('Claude will get {}...', { word: 'Baking', message: 'Compacting conversation', suffix: '…' })).toBe(
    'Compacting conversation…',
  )
})

test('adds no second ellipsis to a message that ends in one', () => {
  expect(saidOf('{}', { word: 'Baking', message: 'Waiting…', suffix: '…' })).toBe('Waiting…')
  expect(saidOf('{}', { word: 'Baking', message: 'Waiting...', suffix: '…' })).toBe('Waiting...')
})

test('writes how long a turn has taken the way Claude Code does', () => {
  expect(elapsedOf(0)).toBe('0s')
  expect(elapsedOf(12_400)).toBe('12s')
  expect(elapsedOf(64_000)).toBe('1m 4s')
  expect(elapsedOf(3_725_000)).toBe('1h 2m 5s')
  expect(elapsedOf(-300)).toBe('0s')
})

test('names the file of a custom theme, and none for a built-in one', () => {
  expect(themeFile('custom:maple')).toBe('maple.json')
  expect(themeFile('custom:maple-light')).toBe('maple-light.json')
  expect(themeFile('dark')).toBe(undefined)
  expect(themeFile(undefined)).toBe(undefined)
})

test('names no file for a theme whose name would leave the themes folder', () => {
  expect(themeFile('custom:../settings')).toBe(undefined)
  expect(themeFile('custom:a/b')).toBe(undefined)
  expect(themeFile('custom:a\\b')).toBe(undefined)
  expect(themeFile('custom:')).toBe(undefined)
})

test("reads a theme's claude color as a raster takes it", () => {
  expect(claudeIn('{"overrides":{"claude":"#f0c0a8"}}')).toBe(PEACH)
  expect(claudeIn('{"overrides":{"claude":"#fc8"}}')).toBe(0xffcc88)
  expect(claudeIn('{"overrides":{"claude":"rgb(215, 119, 87)"}}')).toBe(0xd77757)
})

test('has no color for a theme that names none a raster can hold', () => {
  expect(claudeIn('{"overrides":{"claude":"ansi:red"}}')).toBe(undefined)
  expect(claudeIn('{"overrides":{"claude":"rgb(300,0,0)"}}')).toBe(undefined)
  expect(claudeIn('{"overrides":{}}')).toBe(undefined)
  expect(claudeIn('{"name":"plain"}')).toBe(undefined)
  expect(claudeIn('not a theme')).toBe(undefined)
})
