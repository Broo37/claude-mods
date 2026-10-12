import { expect, test } from 'claude-code/testing'

import { FRAME_MS, FRAMES } from '../hooks/frames'
import { cellsOf, claudeIn, elapsedOf, frameAt, saidOf, themeFile } from '../hooks/strip'

// What a raster cell reads as "the terminal's own color".
const DEFAULT_COLOR = 0x01000000

const PEACH = 0xf0c0a8

// The cells of a raster as the numbers they were packed from.
const wordsIn = (cells: string) => {
  const base64 = Uint8Array as unknown as { fromBase64(text: string): Uint8Array<ArrayBuffer> }

  return [...new Uint32Array(base64.fromBase64(cells).buffer)]
}

test('holds the 133 frames of the old spinner, each twelve characters a raster cell can hold', () => {
  expect(FRAMES.length).toBe(133)
  expect(FRAME_MS).toBe(80)
  // A character outside the basic plane would be two code units and no single cell.
  expect(FRAMES.every(frame => frame.length === 12 && [...frame].length === 12)).toBe(true)
})

test('shows each frame for 80 ms and starts over after the last', () => {
  expect(frameAt(FRAMES, 0, 80)).toBe(FRAMES[0])
  expect(frameAt(FRAMES, 79, 80)).toBe(FRAMES[0])
  expect(frameAt(FRAMES, 80, 80)).toBe(FRAMES[1])
  expect(frameAt(FRAMES, 133 * 80, 80)).toBe(FRAMES[0])
  expect(frameAt(FRAMES, 133 * 80 + 240, 80)).toBe(FRAMES[3])
})

test('shows the first frame for a time before the start', () => {
  expect(frameAt(FRAMES, -500, 80)).toBe(FRAMES[0])
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
  expect(saidOf('Iwan will get {}...', { word: 'Baking', message: null, suffix: '…' })).toBe('Iwan will get Baking...')
})

test('says a wording without {} as it is', () => {
  expect(saidOf('Working', { word: 'Baking', message: null, suffix: '…' })).toBe('Working')
})

test('says a message that overrides the verb, with the mark that the turn goes on', () => {
  expect(saidOf('Iwan will get {}...', { word: 'Baking', message: 'Compacting conversation', suffix: '…' })).toBe(
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
