// A bar stood upright, for the Status tab: the box plot of the band turned on
// its end. What is used is a box that fills from the bottom, what remains a
// thin whisker up to a cap, and the pace a heavy stroke across the row it falls
// on. Pure, so that it reads the same on every surface.

import { GLINT, MARKER_LUMA, TICK_SHADE, WHISKER_LUMA, clampPercent, gradient, lit, shaded, toned } from './format'
import type { BarKind, BarSpan, Rgb } from './format'

export type Column = { kind: BarKind; percent: number; height: number; width: number; pace?: number }

// A row of the box: its lower half in one color, over a ground that shows as
// its upper half in the next, so the box shades twice as finely as its rows.
const BLOCK = '▄'

// The top of the box where it ends inside a row, by eighths of the row.
const PARTS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇']

const WHISKER = '│'

// The line across the cap on top and, under an empty bar, across its base.
const RULE = '─'

const CAP = '┬'

const BASE = '┴'

// The pace: a heavy stroke across the row, through the whisker where it falls there.
const STROKE = '━'

const MARKER = '╋'

// How many eighths of a row the box fills, all rows counted.
const eighthsOf = (percent: number, height: number) => Math.round((clampPercent(percent) * height * 8) / 100)

// How many rows the box reaches into, a part-filled one counted: how far a glint travels.
export const boxHeight = (percent: number, height: number) => Math.ceil(eighthsOf(percent, height) / 8)

// A glyph at the middle of a row, with another either side of it.
const centered = (middle: string, side: string, width: number) => {
  const before = Math.floor((width - 1) / 2)

  return `${side.repeat(before)}${middle}${side.repeat(width - 1 - before)}`
}

// The rows of an upright bar, the cap first and then its body from top to
// bottom, each one run of `width` columns. `glint` is the row, counted from the
// bottom, that a passing glint lights most; `null` while none passes.
export const columnRows = ({ kind, percent, height, width, pace }: Column, glint: number | null): BarSpan[][] => {
  const eighths = eighthsOf(percent, height)
  const full = Math.floor(eighths / 8)
  const part = eighths % 8
  const rest = gradient(kind, clampPercent(percent))
  const whisker = toned(rest, WHISKER_LUMA)
  const marked = pace === undefined ? -1 : Math.min(height - 1, Math.floor((clampPercent(pace) * height) / 100))

  // A row of the box in its colors, lightened where a glint passes over it.
  const shade = (color: Rgb, row: number) => {
    const share = glint === null ? undefined : GLINT[Math.abs(row - glint)]

    return share === undefined ? color : lit(color, share)
  }

  const rowOf = (row: number): BarSpan => {
    const isBox = row < full || (row === full && part > 0)
    const lower = shade(gradient(kind, (row * 100) / height), row)

    if (row === marked) {
      return isBox
        ? { text: STROKE.repeat(width), color: shaded(lower, TICK_SHADE), backgroundColor: lower }
        : { text: centered(MARKER, STROKE, width), color: toned(rest, MARKER_LUMA) }
    }

    if (row < full) {
      return { text: BLOCK.repeat(width), color: lower, backgroundColor: shade(gradient(kind, ((row + 0.5) * 100) / height), row) }
    }

    if (isBox) {
      return { text: (PARTS[part - 1] ?? BLOCK).repeat(width), color: lower }
    }

    return { text: row === 0 ? centered(BASE, RULE, width) : centered(WHISKER, ' ', width), color: whisker }
  }

  const body = Array.from({ length: height }, (_, i) => [rowOf(height - 1 - i)])

  return [[{ text: centered(CAP, RULE, width), color: whisker }], ...body]
}
