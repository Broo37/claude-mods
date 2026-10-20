import { expect, test } from 'claude-code/testing'

import { COLORS, LASTS_MS, ROWS, bitsOf, cellsOf, pixelsAt } from '../hooks/burst'
import type { Bit } from '../hooks/burst'

const DEFAULT = 0x01000000
const UPPER = 0x2580
const LOWER = 0x2584
const SPACE = 0x20

// The cells a Raster takes, back as [codePoint, foreground, background] triplets.
const decode = (cells: string) => {
  const bytes = (Uint8Array as unknown as { fromBase64(text: string): Uint8Array }).fromBase64(cells)
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)

  return Array.from({ length: words.length / 3 }, (_, i) => [words[i * 3], words[i * 3 + 1], words[i * 3 + 2]])
}

const litAt = (bits: Bit[], columns: number, ms: number) =>
  pixelsAt(bits, columns, ms)
    .flat()
    .filter(pixel => pixel !== null).length

// One bit, where a test needs to follow it.
const bit = (more: Partial<Bit> = {}): Bit => ({ x: 10, y: 0, bornMs: 0, diesMs: 1400, fall: 3, drift: 0, color: COLORS[0], ...more })

test('throws the same confetti for the same seed, and other confetti for another', () => {
  expect(bitsOf(7, 80)).toEqual(bitsOf(7, 80))
  expect(bitsOf(8, 80)).not.toEqual(bitsOf(7, 80))
})

test('throws more bits across a wider band, and a few even across a narrow one', () => {
  expect(bitsOf(1, 120).length).toBeGreaterThan(bitsOf(1, 40).length)
  expect(bitsOf(1, 4).length).toBeGreaterThanOrEqual(3)
})

test('paints every bit pink, yellow, cyan, green or orange', () => {
  expect(COLORS).toHaveLength(5)

  for (const one of bitsOf(3, 150)) {
    expect(COLORS).toContain(one.color)
  }
})

test('pops the bits out in the first fifth of a second and has them gone by a second and a half', () => {
  const bits = bitsOf(5, 100)

  for (const one of bits) {
    expect(one.bornMs).toBeLessThan(200)
    expect(one.diesMs).toBeLessThanOrEqual(LASTS_MS)
    expect(one.diesMs).toBeGreaterThan(one.bornMs)
  }

  expect(litAt(bits, 100, 250)).toBeGreaterThan(0)
  expect(litAt(bits, 100, LASTS_MS)).toBe(0)
})

test('lets the bits drop away one by one rather than all at once', () => {
  const bits = bitsOf(9, 100)

  expect(litAt(bits, 100, 300)).toBeGreaterThan(litAt(bits, 100, 1200))
  expect(litAt(bits, 100, 1200)).toBeGreaterThan(0)
})

test('has a bit fall as time goes on', () => {
  const rowAt = (ms: number) => pixelsAt([bit()], 20, ms).findIndex(row => row[10] !== null)

  expect(rowAt(0)).toBe(0)
  expect(rowAt(400)).toBe(1)
  expect(rowAt(700)).toBe(2)
})

test('draws a bit only between its birth and its end', () => {
  expect(litAt([bit({ bornMs: 100, diesMs: 500 })], 20, 50)).toBe(0)
  expect(litAt([bit({ bornMs: 100, diesMs: 500 })], 20, 300)).toBe(1)
  expect(litAt([bit({ bornMs: 100, diesMs: 500 })], 20, 600)).toBe(0)
})

test('keeps every pixel inside the band: a bit that drifts or falls out of it is not drawn', () => {
  const pixels = pixelsAt(bitsOf(2, 30), 30, 600)

  expect(pixels).toHaveLength(ROWS * 2)
  expect(pixels.every(row => row.length === 30)).toBe(true)
  expect(litAt([bit({ x: 29, drift: 20 })], 30, 500)).toBe(0)
  expect(litAt([bit({ fall: 20 })], 30, 500)).toBe(0)
})

test('packs two pixels a cell: an upper half, a lower half, both, or none', () => {
  const pink = COLORS[0]
  const cyan = COLORS[2]
  const cells = decode(
    cellsOf(
      [
        [pink, null, cyan, null],
        [null, cyan, pink, null],
      ],
      4,
    ),
  )

  expect(cells).toEqual([
    [UPPER, pink, DEFAULT],
    [LOWER, cyan, DEFAULT],
    [UPPER, cyan, pink],
    [SPACE, DEFAULT, DEFAULT],
  ])
})

test('lays out every cell of the band, two rows of it', () => {
  expect(decode(cellsOf(pixelsAt(bitsOf(4, 50), 50, 300), 50))).toHaveLength(50 * ROWS)
})
