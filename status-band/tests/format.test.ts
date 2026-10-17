import { expect, test } from 'claude-code/testing'

import {
  barCells,
  barSpans,
  cost,
  duration,
  glintCells,
  gradient,
  modelName,
  remaining,
  remainingLong,
  remainingShort,
  resetClock,
  resetDate,
  rgb,
  shortModel,
  shortPath,
  spinnerCell,
} from '../hooks/format'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

test('names a model from its id', () => {
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-sonnet-5')).toBe('Sonnet 5')
  expect(modelName('opus')).toBe('Opus')
})

test('drops the release date from a model id', () => {
  expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(modelName('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5')
})

test('says when a model runs with the 1M context window', () => {
  expect(modelName('claude-opus-5-5[1m]')).toBe('Opus 5.5 (1M context)')
})

test('names a missing model Unknown', () => {
  expect(modelName('')).toBe('Unknown')
})

test('shortens a model name to its family', () => {
  expect(shortModel('Opus 5.5 (1M context)')).toBe('Opus')
})

test('shortens the home directory to a tilde, whatever its case', () => {
  expect(shortPath('C:\\Users\\admin\\project', 'C:\\Users\\admin')).toBe('~\\project')
  expect(shortPath('c:\\users\\ADMIN\\project', 'C:\\Users\\admin')).toBe('~\\project')
  expect(shortPath('D:\\work', 'C:\\Users\\admin')).toBe('D:\\work')
  expect(shortPath('D:\\work', '')).toBe('D:\\work')
})

test('writes a session length in its largest two units', () => {
  expect(duration(42_000)).toBe('42s')
  expect(duration(125_000)).toBe('2m')
  expect(duration(HOUR + 2 * MINUTE + 5000)).toBe('1h2m')
})

test('writes the time left in a short window as hours and minutes', () => {
  expect(remaining(2 * HOUR + 15 * MINUTE)).toBe('2h15m')
  expect(remaining(45 * MINUTE)).toBe('0h45m')
  expect(remaining(-5000)).toBe('0h0m')
})

test('writes the time left in a long window from its largest unit down', () => {
  expect(remainingLong(6 * DAY + 23 * HOUR + 45 * MINUTE)).toBe('6d23h45m')
  expect(remainingLong(2 * HOUR + 15 * MINUTE)).toBe('2h15m')
  expect(remainingLong(45 * MINUTE)).toBe('45m')
  expect(remainingLong(-5000)).toBe('0m')
})

test('writes the time left in a few characters, its largest two units', () => {
  expect(remainingShort(4 * DAY + 8 * HOUR + 45 * MINUTE)).toBe('4d8h')
  expect(remainingShort(HOUR + 45 * MINUTE)).toBe('1h45m')
  expect(remainingShort(7 * MINUTE)).toBe('7m')
  expect(remainingShort(-MINUTE)).toBe('0m')
})

test('writes a reset time in local time', () => {
  const thursdayEvening = new Date(2026, 9, 8, 19, 5).getTime()

  expect(resetClock(thursdayEvening)).toBe('19:05')
  expect(resetDate(thursdayEvening)).toBe('Thu 19:05')
})

test('writes a cost to the cent', () => {
  expect(cost(1.234)).toBe('$ 1.23')
  expect(cost(0)).toBe('$ 0.00')
})

test('writes a color the way a Text takes it', () => {
  expect(rgb([148, 226, 213])).toBe('rgb(148,226,213)')
})

test('runs each gradient between its Catppuccin stops', () => {
  expect(gradient('context', 0)).toEqual([245, 194, 231])
  expect(gradient('context', 30)).toEqual([230, 69, 83])
  expect(gradient('context', 85)).toEqual([210, 15, 57])
  expect(gradient('fiveHour', 0)).toEqual([180, 190, 254])
  expect(gradient('fiveHour', 50)).toEqual([30, 102, 245])
  expect(gradient('fiveHour', 100)).toEqual([210, 15, 57])
  expect(gradient('sevenDay', 0)).toEqual([249, 226, 175])
  expect(gradient('sevenDay', 50)).toEqual([254, 100, 11])
  expect(gradient('codex', 0)).toEqual([148, 226, 213])
  expect(gradient('codex', 50)).toEqual([16, 163, 127])
})

test('fills a bar in proportion to its percentage', () => {
  const cells = barCells(43, 40, 'context')

  expect(cells).toHaveLength(40)
  expect(cells.filter(cell => cell.isFilled)).toHaveLength(17)
})

test('colors each half of a filled block by its place, and the empty blocks by the reading', () => {
  const cells = barCells(50, 10, 'fiveHour')

  expect(cells[0]?.color).toEqual(gradient('fiveHour', 0))
  expect(cells[0]?.rightColor).toEqual(gradient('fiveHour', 5))
  expect(cells[4]?.color).toEqual(gradient('fiveHour', 40))
  expect(cells[4]?.rightColor).toEqual(gradient('fiveHour', 45))
  expect(cells[5]).toEqual({ isFilled: false, color: gradient('fiveHour', 50) })
})

test('steps the color of a box evenly, half a block at a time', () => {
  // With 40 blocks a block is 2.5% wide: no rounding to whole percents, which
  // made the steps 2%, 3%, 2%, 3%.
  const cells = barCells(100, 40, 'sevenDay')

  expect(cells[1]?.color).toEqual(gradient('sevenDay', 2.5))
  expect(cells[1]?.rightColor).toEqual(gradient('sevenDay', 3.75))
  expect(cells[3]?.color).toEqual(gradient('sevenDay', 7.5))
})

test('keeps a bar inside its width when the reading is out of range', () => {
  expect(barCells(150, 10, 'codex').filter(cell => cell.isFilled)).toHaveLength(10)
  expect(barCells(-5, 10, 'codex').filter(cell => cell.isFilled)).toHaveLength(0)
})

test('writes a bar as runs of text, each in its exact colors', () => {
  // A box of two blocks, each a left half in one color over a ground in the next.
  // Then the whisker and its cap as one run, in the bar's color at its reading
  // brought to the whisker's brightness: (30, 102, 245) becomes (25, 84, 203).
  expect(barSpans(barCells(50, 4, 'fiveHour'))).toEqual([
    { text: '▌', color: [180, 190, 254], backgroundColor: [143, 168, 252] },
    { text: '▌', color: [105, 146, 250], backgroundColor: [68, 124, 247] },
    { text: '─┤', color: [25, 84, 203] },
  ])
})

test('lightens the filled blocks under a glint, most at its head', () => {
  const cells = barCells(100, 10, 'codex')
  const lit = glintCells(cells, 4)
  const towardWhite = (color: readonly number[], share: number) => color.map(part => Math.round(part + (255 - part) * share))

  expect(lit[4]?.color).toEqual(towardWhite(cells[4]?.color ?? [], 0.6))
  expect(lit[4]?.rightColor).toEqual(towardWhite(cells[4]?.rightColor ?? [], 0.6))
  expect(lit[3]?.color).toEqual(towardWhite(cells[3]?.color ?? [], 0.35))
  expect(lit[6]?.color).toEqual(towardWhite(cells[6]?.color ?? [], 0.15))
  expect(lit[7]).toEqual(cells[7])
  expect(lit[0]).toEqual(cells[0])
  expect(lit.every(cell => cell.isFilled)).toBe(true)
})

test('leaves the empty part of a bar alone under a glint', () => {
  const cells = barCells(30, 10, 'fiveHour')

  expect(glintCells(cells, 4).slice(3)).toEqual(cells.slice(3))
  expect(glintCells(cells, 4)[2]?.color).not.toEqual(cells[2]?.color)
})

test('changes nothing while the glint is off the bar', () => {
  const cells = barCells(50, 10, 'context')

  expect(glintCells(cells, -3)).toEqual(cells)
  expect(glintCells(cells, 13)).toEqual(cells)
})

const glyphsOf = (cells: ReturnType<typeof barCells>) =>
  barSpans(cells)
    .map(span => span.text)
    .join('')

test('marks the block where the pace falls, in the box or on the whisker', () => {
  expect(barCells(50, 10, 'fiveHour', 75).findIndex(cell => cell.isMarked)).toBe(7)
  expect(barCells(50, 10, 'fiveHour', 25).findIndex(cell => cell.isMarked)).toBe(2)
  expect(barCells(50, 10, 'fiveHour', 0).findIndex(cell => cell.isMarked)).toBe(0)
  expect(barCells(50, 10, 'fiveHour', 100).findIndex(cell => cell.isMarked)).toBe(9)
})

test('marks one block only', () => {
  expect(barCells(50, 10, 'fiveHour', 75).filter(cell => cell.isMarked)).toHaveLength(1)
})

test('marks nothing on a bar that has no pace', () => {
  expect(barCells(50, 10, 'fiveHour').some(cell => cell.isMarked)).toBe(false)
})

test('writes the pace in the box as a heavy stroke cut into the block, in a dark shade of it', () => {
  // Lavender (180, 190, 254) at three tenths of its brightness is (54, 57, 76).
  expect(barSpans(barCells(100, 2, 'fiveHour', 0))).toEqual([
    { text: '┃', color: [54, 57, 76], backgroundColor: [180, 190, 254] },
    { text: '▌', color: [30, 102, 245], backgroundColor: [120, 59, 151] },
  ])
})

test('writes the pace on the whisker as a heavy stroke across it, brighter than the whisker', () => {
  // Nothing is used, so the whisker starts at a cap too. Lavender is (74, 78, 105)
  // at the whisker's brightness and (139, 147, 196) at the pace's.
  expect(barSpans(barCells(0, 3, 'fiveHour', 50))).toEqual([
    { text: '├', color: [74, 78, 105] },
    { text: '╂', color: [139, 147, 196] },
    { text: '┤', color: [74, 78, 105] },
  ])
})

test('draws every whisker at one brightness, whatever the hue of its bar', () => {
  const brightness = ([r = 0, g = 0, b = 0]: readonly number[]) => 0.299 * r + 0.587 * g + 0.114 * b
  // The last run of a bar is its whisker: a pale bar, a navy one, a dark red one.
  const whiskers = [barCells(0, 4, 'sevenDay'), barCells(62, 4, 'fiveHour'), barCells(96, 40, 'context')].map(
    cells => barSpans(cells).at(-1)?.color ?? [],
  )

  expect(whiskers.map(ink => Math.round(brightness(ink) / 2))).toEqual([40, 40, 40])
})

test('lets the pace stand in place of a cap', () => {
  expect(glyphsOf(barCells(0, 2, 'fiveHour', 100))).toBe('├╂')
  expect(glyphsOf(barCells(0, 2, 'fiveHour', 0))).toBe('╂┤')
})

test('writes a box, a whisker, a cap and the pace, whichever a bar has', () => {
  expect(glyphsOf(barCells(50, 6, 'fiveHour', 70))).toBe('▌▌▌─╂┤')
  expect(glyphsOf(barCells(50, 6, 'fiveHour', 20))).toBe('▌┃▌──┤')
  expect(glyphsOf(barCells(0, 4, 'context'))).toBe('├──┤')
  expect(glyphsOf(barCells(100, 4, 'context'))).toBe('▌▌▌▌')
})

test('keeps a pace mark through a glint', () => {
  const cells = barCells(50, 10, 'fiveHour', 45)

  expect(glintCells(cells, 4)[4]?.isMarked).toBe(true)
})

const cellOf = (cells: string) => {
  const base64 = Uint8Array as unknown as { fromBase64(text: string): Uint8Array<ArrayBuffer> }

  return [...new Uint32Array(base64.fromBase64(cells).buffer)]
}

test('packs a frame of the spinning mark as the one cell of a raster, in the color of work', () => {
  // A braille dot pattern in peach (250, 179, 135) over the terminal's own background.
  expect(cellOf(spinnerCell(0))).toEqual([0x280b, 0xfab387, 0x01000000])
  expect(cellOf(spinnerCell(1))).toEqual([0x2819, 0xfab387, 0x01000000])
})

test('starts the spinning mark over after its ten frames', () => {
  expect(spinnerCell(10)).toBe(spinnerCell(0))
  expect(new Set(Array.from({ length: 10 }, (_, frame) => spinnerCell(frame))).size).toBe(10)
})
