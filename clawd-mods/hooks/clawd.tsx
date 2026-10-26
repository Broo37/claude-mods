// Clawd, the crab from the Claude Code welcome screen, drawn on the surface's
// own frame clock. Ported from lib/mascot.ps1 and lib/mascot-step.ps1 of
// clawd-usage-winwidget: the same glyphs, eye shapes and Claude Code animations
// (60 ms a frame). The widget splits a cell into 2x4 pixels; a terminal cell
// shows 2x2 quadrants, so each cell is drawn back from that grid.
//
// Four rows: his sky on top (sky.ts), Clawd in the three under it.

import type { ClientSurface, RenderElement } from 'claude-code'

import type { Cell, ClawdEvent, Control, Mood, Run } from '../types'
import { type SkyProps, skyRows } from './sky'

export type ClawdProps = {
  mood: Mood
  halves: number | null
  isCrit: boolean
  /** A red PC tip waits: the same nervous look as near the limit. */
  worried: boolean
  event: ClawdEvent | null
  /** The sky row; null with the sky off, which leaves the row empty. */
  sky: SkyProps | null
  /** /clawd play, demo or auto. */
  control: Control
  /** What stands over his head besides a waiting session's ?: a due reminder's bell, a service alert. */
  overhead: 'bell' | 'alert-minor' | 'alert-major' | null
  /** The region's width before the surface has laid it out. */
  width: number
}

export type { Control }

const FRAME_MS = 60
const BODY = '#D77757'
const EYE = '#000000'
const COLS = 9
const W = 2 * COLS
const H = 12

// Glyph quadrants as bits: 1 top-left, 2 top-right, 4 bottom-left, 8 bottom-right.
const QUAD: Record<string, number> = {
  ' ': 0, '█': 15, '▀': 3, '▄': 12, '▌': 5, '▐': 10, '▘': 1, '▝': 2, '▖': 4, '▗': 8,
  '▛': 7, '▜': 11, '▙': 13, '▟': 14,
}
const GLYPH = [' ', '▘', '▝', '▀', '▖', '▌', '▞', '▛', '▗', '▚', '▐', '▜', '▄', '▙', '▟', '█']
// Eye pixels a quadrant can't hold: the lid line and the wide-open eye.
const EYE_GLYPH: Record<number, string> = { 192: '▂', 252: '▆' }

// Arms: what sits left and right of the eyes (row 0) and of the chest (row 1).
const ARMS: Record<string, { r1L: string; r1R: string; r2L: string; r2R: string }> = {
  down: { r1L: ' ▐', r1R: '', r2L: '▝▜', r2R: '█▀' },
  up: { r1L: '▗▟', r1R: '▄', r2L: ' ▜', r2R: '█▘' },
  right: { r1L: ' ▐', r1R: '▄', r2L: '▝▜', r2R: '█▘' },
  left: { r1L: '▗▟', r1R: '', r2L: ' ▜', r2R: '█▀' },
}
const FEET: Record<string, string> = {
  both: ' ▝▝   ▝▝ ',
  left: ' ▝▝      ',
  right: '      ▝▝ ',
}
// Turns in place: glyph rows, and columns from..to where the black face shows.
type FacingRow = readonly [string, number, number]
const FACING: Record<string, readonly [FacingRow, FacingRow, FacingRow]> = {
  'right-12': [[' ▐█▜██▛█ ', 2, 8], ['▝▜██████▀', 2, 7], [' ▝▝   ▝▝ ', 0, 0]],
  'right-30': [['  █▛██▛▌ ', 2, 7], [' ▝█████▛ ', 2, 7], ['  ▘▘  ▘▘ ', 0, 0]],
  'right-55': [['  ▐█▛█▜  ', 3, 7], ['  ▐████  ', 3, 7], ['  ▝▝ ▝▝  ', 0, 0]],
  'right-75': [['   ██▛▌  ', 3, 6], ['   ███▌  ', 3, 6], ['   ▘  ▘  ', 0, 0]],
  edge: [['   ▐██   ', 4, 6], ['   ▐██   ', 4, 6], ['   ▝ ▝   ', 0, 0]],
  'back-105': [['   ███▌  ', 3, 6], ['   ███▌  ', 3, 6], ['   ▘  ▘  ', 0, 0]],
  'back-125': [['  ▐████  ', 3, 7], ['  ▐████  ', 3, 7], ['  ▝▝ ▝▝  ', 0, 0]],
  'back-150': [['  █████▌ ', 2, 7], [' ▝█████▛ ', 2, 7], ['  ▘▘  ▘▘ ', 0, 0]],
  back: [[' ▐██████ ', 2, 8], ['▝▜██████▀', 2, 7], [' ▝▝   ▝▝ ', 0, 0]],
  'left-75': [['   ▛██▌  ', 3, 6], ['   ███▌  ', 3, 6], ['   ▘  ▘  ', 0, 0]],
  'left-55': [['  ▐▜▛██  ', 3, 7], ['  ▐████  ', 3, 7], ['  ▝▝ ▝▝  ', 0, 0]],
  'left-30': [['  ▛██▛█▌ ', 2, 7], [' ▝█████▛ ', 2, 7], ['  ▘▘  ▘▘ ', 0, 0]],
  'left-12': [[' ▐▛███▜█ ', 2, 8], ['▝▜██████▀', 2, 7], [' ▝▝   ▝▝ ', 0, 0]],
}

// Eyes: black pixels "dx,dy" from the top-left of each eye cell; ";" splits left and right.
const EYES: Record<string, string> = {
  open: '1,2 1,3',
  left: '0,0 0,1',
  right: '2,0 2,1',
  closed: '0,3 1,3',
  blink: '0,3 1,3',
  wink: '1,2 1,3;0,3 1,3',
  focus: '1,3',
  wide: '0,1 1,1 0,2 1,2 0,3 1,3',
  yawn: '0,3 1,3',
}
// Shapes two cells can't draw in pixels are drawn as one character per eye.
const EYE_CHARS: Record<string, string> = { x: '×', gasp: '×', happy: '^' }

type Frame = { eyes: string; arms: string; feet: string; off: number; x: number; facing: string; poof: string }
type Pose = Frame & { look: number; flip: boolean }

const POSES: Record<string, string> = {
  default: 'open/down/both',
  'arms-up': 'open/up/both',
  'look-left': 'left/down/both',
  'look-right': 'right/down/both',
}

/** Frames of one pose: `off` rows lower (negative: above), `x` cells over, `poof` dust. */
function F(pose: string, n = 1, off = 0, x = 0, poof = ''): Frame[] {
  let frame: Frame
  if (pose.startsWith('face:')) {
    frame = { eyes: 'open', arms: 'down', feet: 'both', off, x, poof, facing: pose.slice(5) }
  } else {
    const [eyes = 'open', arms = 'down', feet = 'both'] = (POSES[pose] ?? pose).split('/')
    frame = { eyes, arms, feet, off, x, poof, facing: '' }
  }
  return Array.from({ length: n }, () => frame)
}

const turnTo = (list: string[]): Frame[] => list.flatMap(p => F(`face:${p}`))
const cr = [...F('default', 1, 1, 0, 'dot'), ...F('default', 1, 1, 0, 'wave')] // crouch before the jump
const bo = F('default') // rest
const ts = [...F('closed/down/both'), ...bo] // blink at the end
const jumpSeq = [...cr, ...F('arms-up', 3), ...bo, ...cr, ...F('arms-up', 3), ...bo]
const waddle = F('look-right', 1, 0, -9)
for (let u = -6; u <= -1; u++) waddle.push(...F(`right/down/${u % 2 === 0 ? 'left' : 'right'}`, 2, 0, u))

// The animations Claude Code plays, frame for frame.
const SEQS: Record<string, Frame[]> = {
  jump: jumpSeq,
  look: [...F('look-right', 5), ...F('look-left', 5), ...bo],
  celebrate: [...jumpSeq, ...F('default', 3, 1)],
  skip: [
    ...F('default', 1, 1, -9), ...F('arms-up', 2, 0, -6), ...F('default', 1, 0, -6),
    ...F('default', 1, 1, -6), ...F('arms-up', 2, 0, -3), ...F('default', 1, 0, -3),
    ...F('default', 1, 1, -3), ...F('arms-up', 2), ...cr, ...bo,
  ],
  spin: [...F('look-left', 2), ...F('look-right', 2), ...F('look-left', 2), ...F('arms-up', 3), ...bo],
  peekaboo: [
    ...F('default', 1, 3), ...F('default', 3, 2), ...F('look-right', 3, 2),
    ...F('look-left', 3, 2), ...F('default', 2, 2), ...F('default', 1, 1),
    ...F('arms-up', 4), ...F('default', 2), ...ts,
  ],
  drop: [
    ...F('arms-up', 1, -3), ...F('arms-up', 2, -2), ...F('arms-up', 2, -1),
    ...F('arms-up', 1), ...cr, ...F('default', 3), ...ts,
  ],
  waddle: [...waddle, ...F('look-right', 2), ...F('default', 2), ...ts],
  peek: [
    ...F('look-right', 1, 0, -9), ...F('look-right', 5, 0, -6), ...F('look-right', 3, 0, -9),
    ...F('look-right', 4, 0, -5), ...F('arms-up', 2, 0, -3), ...F('arms-up', 2), ...cr, ...bo,
  ],
  wink: [...F('wink/down/both', 5), ...bo],
  boop: [
    ...F('closed/down/both', 1, 1, 0, 'dot'), ...F('closed/down/both', 2, 1, 0, 'wave'),
    ...F('look-left', 4), ...F('default', 2), ...ts,
  ],
  tap: [
    ...F('open/down/left', 2), ...F('open/down/right', 2), ...F('open/down/left', 2),
    ...F('open/down/right', 2), ...F('open/down/left', 1), ...F('open/down/right', 1),
    ...F('arms-up', 3), ...bo,
  ],
  sneeze: [
    ...F('closed/up/both', 4), ...F('closed/down/both', 2, 1, 0, 'wave'),
    ...F('closed/down/both', 2), ...F('default', 2), ...ts,
  ],
  turn: [
    ...turnTo(['right-12', 'right-30', 'right-55', 'right-75', 'edge']),
    ...turnTo(['back-105', 'back-125', 'back-150', 'back', 'back']),
    ...turnTo(['back-150', 'back-125', 'back-105', 'edge']),
    ...turnTo(['left-75', 'left-55', 'left-30', 'left-12']), ...bo,
  ],
  'coin-hop': [
    ...F('default', 2, 1), ...F('arms-up', 1),
    ...turnTo(['right-55', 'edge', 'back-125', 'back']),
    ...turnTo(['back-125', 'edge', 'left-55']),
    ...F('arms-up', 1), ...cr, ...bo,
  ],
}
// The widget's own acts, in its 90 ms frames (played at 60 ms, each frame held 1.5 ticks).
const CUSTOM_LEN: Record<string, number> = { wave: 24, stretch: 22, yawn: 22, stumble: 20, twitch: 12, soul: 44 }

/** Every animation /clawd play knows, and the moods /clawd demo shows after them. */
export const ACTS: readonly string[] = [...Object.keys(SEQS), ...Object.keys(CUSTOM_LEN)]
export const MOODS = ['idle', 'work', 'wait', 'dead', 'doze'] as const

/** His soul, pale, on a string: what a click on him belly-up lets out (Material Design ghost-outline). */
export const SOUL = '\u{F0A00}'
const SOUL_COLOR = '#E5E7EB'
/** A storm's lightning in the sky row (Material Design flash; the user's font has no ↯). */
export const FLASH = '\u{F0241}'
/** A due reminder over his head (Material Design bell, in the user's font). */
export const BELL = '\u{F009A}'

/**
 * The one thing that stands in the sky row over his head, first that applies:
 * a due reminder's bell, a waiting session's ?, a service alert's ! (red when major).
 */
export function overheadMark(overhead: ClawdProps['overhead'], isWaiting: boolean): Cell | null {
  if (overhead === 'bell') return { ch: BELL, fg: '#22D3EE' }
  if (isWaiting) return { ch: '?', fg: '#FBBF24' }
  if (overhead === 'alert-minor') return { ch: '!', fg: '#FBBF24' }
  if (overhead === 'alert-major') return { ch: '!', fg: '#F87171' }
  return null
}
const DEMO_TICKS = 50 // 3 s an animation or a mood
// On click, as in Claude Code: everything that starts in place.
const CLICK_ACTS = Object.keys(SEQS).filter(id => SEQS[id]?.[0]?.x === 0 && id !== 'celebrate')
const ENTRANCE_ACTS = Object.keys(SEQS).filter(id => id !== 'celebrate')

// Health by heart halves: speed, yawns, tired eyes, sweat, stumbling. Chances are per 60 ms tick.
type Tier = { speed: number; hop?: number; yawn?: number; eyes?: string; sweat?: boolean; stumble?: number }
const TIERS: Record<number, Tier> = {
  6: { speed: 1.25, hop: 450 },
  5: { speed: 1.0 },
  4: { speed: 0.9, yawn: 525 },
  3: { speed: 0.75, yawn: 300, eyes: 'focus' },
  2: { speed: 0.55, yawn: 240, eyes: 'focus', sweat: true },
  1: { speed: 0.35, eyes: 'blink', sweat: true, stumble: 330 },
  0: { speed: 0 },
}
const DOZE_TICKS = Math.round((10 * 60_000) / FRAME_MS)
const CONFETTI = ['#F87171', '#FBBF24', '#4ADE80', '#60A5FA', '#A78BFA', BODY]

type Particle = { x: number; y: number; v: number; d: number; color: string }

export type Mz = {
  props: ClawdProps
  tick: number
  /** Column of Clawd's left edge in the region. */
  x: number
  dir: number
  target: number | null
  look: number
  blinkAt: number
  act: string | null
  actT: number
  loveT: number
  noteT: number
  confT: number
  confetti: Particle[]
  /** The mood last applied, and the tick it began (doze after ten quiet minutes). */
  mood: Mood
  idleSince: number
  /** The pointer's column while it is over the region. */
  hover: number | null
  lastEvent: number
  /** A storm: the tick of the next lightning, the flash's age (-1: none) and its column. */
  flashAt: number
  flashT: number
  flashCol: number
  /** The last /clawd play or demo applied, and where a demo is. */
  controlId: number
  demo: { start: number; index: number } | null
  rows: Run[][]
  key: string
}

const chance = (n: number): boolean => Math.random() * n < 1
const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)] as T

// ------------------------------------------------------------- drawing ----

function paint(g: number[], glyphs: string, col: number, row: number, isFace: boolean): void {
  for (let i = 0; i < glyphs.length; i++) {
    const q = QUAD[glyphs[i] ?? ' '] ?? 0
    for (let sy = 0; sy < 4; sy++) {
      for (let sx = 0; sx < 2; sx++) {
        const bit = (sy < 2 ? 1 : 4) * (sx ? 2 : 1)
        // 0 empty, 1 body, 2 black (eyes and face).
        const v = q & bit ? 1 : isFace ? 2 : 0
        if (v) g[(4 * row + sy) * W + 2 * (col + i) + sx] = v
      }
    }
  }
}

/** Clawd's 9x3 cells for one pose, eyes and face included. */
export function clawdCells(f: Pose): Cell[][] {
  const g: number[] = new Array<number>(W * H).fill(0)
  const marks: { x: number; y: number; ch: string }[] = []
  if (f.facing) {
    const rows = FACING[f.facing] ?? FACING.back!
    rows.forEach(([s, from, to], r) => {
      paint(g, s.slice(0, from), 0, r, false)
      paint(g, s.slice(from, to), from, r, true)
      paint(g, s.slice(to), to, r, false)
    })
  } else {
    const a = ARMS[f.arms] ?? ARMS.down!
    paint(g, a.r1L, 0, 0, false)
    paint(g, '██████', 2, 0, true)
    paint(g, a.r1R, 8, 0, false)
    paint(g, a.r2L, 0, 1, false)
    paint(g, '█████', 2, 1, true)
    paint(g, a.r2R, 7, 1, false)
    paint(g, FEET[f.feet] ?? FEET.both!, 0, 2, false)

    // Looking sideways with normal eyes: Claude Code's own poses; other eyes shift.
    let eyes = f.eyes
    let shift = 0
    if (eyes === 'open' && f.look < 0) eyes = 'left'
    else if (eyes === 'open' && f.look > 0) eyes = 'right'
    else if (!['open', 'left', 'right', 'wink'].includes(eyes)) shift = f.look
    const eyeX = [4, 12]
    const char = EYE_CHARS[eyes]
    if (char !== undefined) {
      for (const ex of eyeX) marks.push({ x: ex + shift + 1, y: 2, ch: char })
    } else {
      const shape = (EYES[eyes] ?? EYES.open!).split(';')
      eyeX.forEach((ex, k) => {
        for (const pt of (shape[Math.min(k, shape.length - 1)] ?? '').split(' ')) {
          const [dx = 0, dy = 0] = pt.split(',').map(Number)
          const x = ex + dx + shift
          if (x >= 0 && x < W) g[dy * W + x] = 2
        }
      })
    }
    // Yawning and gasping: an open mouth under the eyes.
    if (eyes === 'yawn' || eyes === 'gasp') {
      for (let x = 8; x <= 10; x++) {
        g[4 * W + x] = 2
        g[5 * W + x] = 2
      }
    }
  }

  // Lowered by `off` rows, moved `x` cells; anything outside the frame is clipped.
  // Flipped: on his back, legs up (the empty lower half of the legs row left out).
  const out: number[] = new Array<number>(W * H).fill(0)
  const oy = 4 * f.off
  const ox = 2 * f.x
  const place = (y: number): number | null => {
    if (f.flip && y >= H - 2) return null
    const yy = (f.flip ? H - 3 - y : y) + oy
    return yy < 0 || yy >= H ? null : yy
  }
  for (let y = 0; y < H; y++) {
    const yy = place(y)
    if (yy === null) continue
    for (let x = 0; x < W; x++) {
      const v = g[y * W + x] ?? 0
      const xx = x + ox
      if (v && xx >= 0 && xx < W) out[yy * W + xx] = v
    }
  }

  const cells: Cell[][] = []
  for (let cy = 0; cy < 3; cy++) {
    const row: Cell[] = []
    for (let cx = 0; cx < COLS; cx++) {
      let body = 0
      let eye = 0
      let eyePixels = 0
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const v = out[(4 * cy + sy) * W + 2 * cx + sx] ?? 0
          const bit = (sy < 2 ? 1 : 4) * (sx ? 2 : 1)
          if (v === 1) body |= bit
          if (v === 2) {
            eye |= bit
            eyePixels |= 1 << (sy * 2 + sx)
          }
        }
      }
      // A cell with an eye in it is body-coloured, the eye drawn over it in black.
      if (eye) row.push({ ch: EYE_GLYPH[eyePixels] ?? GLYPH[eye] ?? '█', fg: EYE, bg: BODY })
      else row.push(body ? { ch: GLYPH[body] ?? '█', fg: BODY } : { ch: ' ' })
    }
    cells.push(row)
  }
  for (const mark of marks) {
    const yy = place(mark.y)
    const cx = Math.floor((mark.x + ox) / 2)
    const cell = yy === null ? undefined : cells[Math.floor(yy / 4)]?.[cx]
    if (cell?.fg === BODY) Object.assign(cell, { ch: mark.ch, fg: EYE, bg: BODY })
  }
  return cells
}

function toRuns(cells: Cell[]): Run[] {
  const runs: Run[] = []
  for (const cell of cells) {
    const last = runs[runs.length - 1]
    if (last && last.fg === cell.fg && last.bg === cell.bg && last.dim === cell.dim) last.text += cell.ch
    else runs.push({ text: cell.ch, ...(cell.fg && { fg: cell.fg }), ...(cell.bg && { bg: cell.bg }), ...(cell.dim && { dim: true }) })
  }
  return runs
}

// ------------------------------------------------------------ behaviour ----

function startAct(m: Mz, name: string, cols: number): void {
  m.act = name
  m.actT = 0
  if (name === 'celebrate') {
    m.confT = 0
    m.confetti = Array.from({ length: 14 }, (_, i) => ({
      x: Math.random() * cols,
      y: -Math.random() * 2,
      v: 0.05 + Math.random() * 0.06,
      d: (Math.random() - 0.5) * 0.15,
      color: CONFETTI[i % CONFETTI.length] ?? BODY,
    }))
  }
}

/** A click: a random Claude Code animation and a heart. Lying belly-up, his soul floats out. */
export function click(m: Mz, cols: number): void {
  if (m.mood === 'dead') {
    if (!m.act) startAct(m, 'soul', cols)
    return
  }
  m.loveT = 0
  if (!m.act) startAct(m, pick(CLICK_ACTS), cols)
}

/** One frame of a one-shot act; returns the bubble above the head. */
function stepAct(m: Mz, f: Pose): string {
  const act = m.act ?? ''
  const seq = SEQS[act]
  if (seq) {
    Object.assign(f, seq[m.actT] ?? seq[seq.length - 1])
    f.look = 0
    m.actT++
    if (m.actT >= seq.length) m.act = null
    return act === 'celebrate' ? '!' : ''
  }
  const t = Math.floor((m.actT * 2) / 3)
  switch (act) {
    case 'wave':
      f.look = 0
      f.eyes = 'happy'
      f.arms = Math.floor(t / 4) % 2 ? 'down' : 'right'
      break
    case 'stretch':
      if (t >= 4 && t < 18) {
        f.arms = 'up'
        f.eyes = 'closed'
      }
      break
    case 'yawn':
      f.look = 0
      f.eyes = t >= 3 && t < 17 ? 'yawn' : 'closed'
      break
    case 'stumble':
      // Flops down, then gets up and stares, stunned.
      if (t < 12) {
        f.off = 1
        f.eyes = 'closed'
      } else {
        f.eyes = 'wide'
      }
      f.look = 0
      break
    case 'twitch':
      f.flip = true
      f.look = 0
      f.eyes = 'x'
      f.feet = t % 2 ? 'left' : 'right'
      break
    case 'soul':
      // He lies as he lay (or dozes, played while alive); the soul is drawn in step().
      f.look = 0
      if (m.mood === 'dead') {
        f.flip = true
        f.eyes = 'x'
      } else {
        f.eyes = 'closed'
      }
      break
  }
  m.actT++
  if (m.actT >= Math.ceil((CUSTOM_LEN[act] ?? 0) * 1.5)) m.act = null
  return ''
}

/** Where to look while the pointer is over the region: -1, 0 or 1; null when it isn't. */
function lookAt(m: Mz): number | null {
  if (m.hover === null) return null
  const center = m.x + COLS / 2
  return m.hover > center + 2 ? 1 : m.hover < center - 2 ? -1 : 0
}

/** Advances one frame; true when what is drawn changed. */
export function step(m: Mz, cols: number): boolean {
  m.tick++
  const p = m.props
  // /clawd play starts an animation once; /clawd demo plays each, then each mood; auto ends a demo.
  const c = p.control
  if (c.kind !== 'auto' && c.id !== m.controlId) {
    m.controlId = c.id
    if (c.kind === 'play') startAct(m, c.act, cols)
    else m.demo = { start: m.tick, index: -1 }
  }
  if (c.kind === 'auto') m.demo = null
  let demoMood: (typeof MOODS)[number] | null = null
  if (m.demo) {
    const i = Math.floor((m.tick - m.demo.start) / DEMO_TICKS)
    if (i < ACTS.length) {
      if (i !== m.demo.index) {
        m.demo.index = i
        startAct(m, ACTS[i] ?? 'jump', cols)
      }
    } else if (i < ACTS.length + MOODS.length) {
      demoMood = MOODS[i - ACTS.length] ?? null
    } else {
      m.demo = null
    }
  }
  const pMood: Mood = demoMood === null ? p.mood : demoMood === 'doze' ? 'idle' : demoMood
  const span = Math.max(0, cols - COLS - 1)
  if (m.x > span) m.x = span
  // The region may have narrowed since the target was picked.
  if (m.target !== null && m.target > span) m.target = span

  if (p.event && p.event.id !== m.lastEvent) {
    m.lastEvent = p.event.id
    if (p.event.kind === 'reset') startAct(m, 'celebrate', cols)
    else if (!m.act && pMood !== 'dead') startAct(m, 'jump', cols)
  }
  const kind = p.sky?.kind ?? null
  const isWet = kind === 'rain' || kind === 'storm' || kind === 'drizzle'
  // Thunder: a flash in the sky, and he hops.
  if (kind === 'storm' && m.tick >= m.flashAt) {
    m.flashT = 0
    m.flashCol = (m.tick * 13) % Math.max(1, cols)
    m.flashAt = m.tick + 300 + ((m.tick * 7919) % 300)
    // The thunder startles him out of whatever he was doing.
    if (pMood !== 'dead') startAct(m, 'jump', cols)
  }
  if (pMood !== m.mood) {
    // Work is over: the edge he was running to is no reason to walk there.
    if (m.mood === 'work') m.target = null
    m.mood = pMood
    m.idleSince = m.tick
  }
  if (m.hover !== null) m.idleSince = m.tick
  const mood: Mood | 'doze' = demoMood === 'doze' || (pMood === 'idle' && m.tick - m.idleSince >= DOZE_TICKS) ? 'doze' : pMood
  const tier = TIERS[p.halves ?? 5] ?? { speed: 1 }
  const isPerky = tier.speed >= 0.9

  const f: Pose = { eyes: 'open', arms: 'down', feet: 'both', look: m.look, flip: false, off: 0, x: 0, facing: '', poof: '' }
  let bubble = ''
  let canBlink = true
  let zzz = false
  let dust = false

  if (m.act) {
    bubble = stepAct(m, f)
    canBlink = false
  } else if (mood === 'doze') {
    // Nods off, and now and then startles and goggles.
    f.look = 0
    if (m.tick % 105 < 9) f.eyes = 'wide'
    else {
      f.eyes = 'blink'
      zzz = true
    }
  } else if (mood === 'dead') {
    f.flip = true
    f.eyes = 'x'
    f.look = 0
    const q = m.tick % 75
    if (q < 9) f.feet = q % 2 ? 'left' : 'right'
  } else if (mood === 'wait') {
    // Hops and waves: hey, someone is waiting for you.
    bubble = '?'
    f.eyes = 'wide'
    f.look = lookAt(m) ?? 0
    const q = m.tick % 60
    if (q < 3) f.off = 1
    else if (q < 12) f.arms = 'right'
  } else {
    let speed: number
    if (mood === 'work') {
      // Runs from edge to edge.
      speed = 0.27 * tier.speed
      if (m.target === null) m.target = m.dir > 0 ? span : 0
    } else {
      speed = 0.1 * tier.speed
      if (m.target === null) {
        if (chance(105)) m.target = Math.random() * span
        else if (chance(68)) m.look = Math.floor(Math.random() * 3) - 1
        else if (chance(600)) startAct(m, pick(['wave', 'stretch', 'look']), cols)
      }
    }
    let isWalking = false
    if (m.target !== null && speed > 0) {
      const d = m.target - m.x
      if (Math.abs(d) <= speed) {
        m.x = m.target
        m.target = null
        if (mood === 'work') m.dir = -m.dir
      } else {
        m.dir = Math.sign(d)
        m.x += speed * m.dir
        m.look = m.dir
        isWalking = true
      }
    }
    if (isWalking) {
      // The less energy, the slower the steps.
      let every = mood === 'work' ? 3 : 4
      if (tier.speed < 0.8) every++
      if (tier.speed < 0.5) every++
      f.feet = Math.floor(m.tick / every) % 2 ? 'left' : 'right'
      if (mood === 'work') {
        dust = true
        if (isPerky && chance(225)) startAct(m, 'jump', cols)
      } else if (isPerky && m.noteT < 0 && chance(120)) {
        m.noteT = 0 // whistles while walking
      }
      if (tier.stumble && chance(tier.stumble)) startAct(m, 'stumble', cols)
    } else if (p.isCrit || p.worried) {
      // Limit running out, or the PC in trouble: eyes dart nervously.
      m.look = Math.floor(m.tick / 7) % 2 ? -1 : 1
    } else {
      m.look = lookAt(m) ?? m.look
    }
    f.look = m.look
    // Squints in the rain while he stands; working, he squints anyway.
    if (mood === 'work' || (isWet && !isWalking)) f.eyes = 'focus'
    if (!m.act) {
      if (tier.hop && chance(tier.hop)) startAct(m, 'jump', cols)
      if (tier.yawn && chance(tier.yawn)) startAct(m, 'yawn', cols)
    }
  }

  // Tired eyes over the normal and working ones; petted, pleased.
  if (tier.eyes && !m.act && (f.eyes === 'open' || f.eyes === 'focus')) f.eyes = tier.eyes
  if (m.loveT >= 0 && !m.act && f.eyes === 'open') f.eyes = 'happy'
  if (canBlink && f.eyes === 'open' && m.tick >= m.blinkAt) {
    f.eyes = 'blink'
    if (m.tick >= m.blinkAt + 1) m.blinkAt = m.tick + 37 + Math.floor(Math.random() * 68)
  }

  // Bubble beside the head: "!" celebration, a heart when clicked, z, a note.
  // A waiting session's "?" stands over his head instead (overheadMark).
  let mark: Cell | null = bubble === '!' ? { ch: '!', fg: '#4ADE80' } : null
  if (m.loveT >= 0) {
    mark ??= { ch: '♥', fg: '#F87171' }
    if (++m.loveT >= 30) m.loveT = -1
  }
  if (zzz) mark ??= { ch: m.tick % 30 < 15 ? 'z' : 'Z', dim: true }
  if (m.noteT >= 0) {
    if (mood === 'idle') mark ??= { ch: '♪', fg: '#93C5FD' }
    if (++m.noteT >= 45) m.noteT = -1
  }

  const grid: Cell[][] = [0, 1, 2, 3].map(() => Array.from({ length: cols }, () => ({ ch: ' ' })))
  const x = Math.round(m.x)
  const put = (col: number, row: number, cell: Cell): void => {
    const line = grid[row]
    if (line && col >= 0 && col < cols) line[col] = cell
  }
  // Over his head, in the sky row: the bell, a ?, or an alert's !; the sky steps aside.
  const over = overheadMark(p.overhead, bubble === '?')
  const overCol = x + 4
  // A low cloud hangs into his row; he is drawn over it.
  if (p.sky) {
    skyRows(p.sky, cols, m.tick, over ? [overCol] : []).forEach((line, row) =>
      line.forEach((cell, col) => cell.ch !== ' ' && put(col, row, cell)))
  }
  if (m.flashT >= 0) {
    put(m.flashCol, 0, { ch: FLASH, fg: '#FDE047' })
    if (++m.flashT >= 4) m.flashT = -1
  }
  if (over) put(overCol, 0, over)
  // Clawd stands in rows 1 to 3, under his sky.
  clawdCells(f).forEach((line, row) => line.forEach((cell, col) => {
    if (cell.ch !== ' ' || cell.bg) put(x + col, row + 1, cell)
  }))
  if (m.act === 'soul') {
    // Up from his belly on a string, a while overhead, and back.
    const t = m.actT
    const isUp = t >= 10 && t < Math.ceil((CUSTOM_LEN.soul ?? 44) * 1.5) - 10
    const col = x + 4
    if (m.mood !== 'dead') {
      if (isUp) put(col, 0, { ch: SOUL, fg: SOUL_COLOR })
    } else if (isUp) {
      put(col, 0, { ch: SOUL, fg: SOUL_COLOR })
      put(col, 1, { ch: '│', fg: SOUL_COLOR, dim: true })
    } else {
      put(col, 1, { ch: SOUL, fg: SOUL_COLOR })
    }
  }
  const bubbleCol = x + COLS < cols ? x + COLS : x - 1
  if (mark) put(bubbleCol, 1, mark)
  // Limit nearly used up, or the PC in trouble: sweats.
  if ((p.isCrit || p.worried || tier.sweat) && mood !== 'dead') {
    put(bubbleCol === x - 1 ? x + COLS : x - 1, m.tick % 30 < 15 ? 1 : 2, { ch: '•', fg: '#67E8F9' })
  }
  if (f.poof && f.off > 0) {
    const ch = f.poof === 'dot' ? '·' : '~'
    put(x - 1, 3, { ch, dim: true })
    put(x + COLS, 3, { ch, dim: true })
  }
  if (dust) put(m.dir > 0 ? x - 1 : x + COLS, 3, { ch: m.tick % 4 < 2 ? '·' : '.', dim: true })
  // Rain, drizzle or snow falls through the yard around him: about one drop
  // in `every` columns a row, each falling one row every `pace` ticks.
  const fall = kind === 'rain' || kind === 'storm'
    ? { ch: '│', fg: '#60A5FA', every: 8, pace: 2 }
    : kind === 'drizzle'
      ? { ch: '╎', fg: '#93C5FD', every: 12, pace: 3 }
      : kind === 'snow'
        ? { ch: '*', fg: '#F4F4F5', every: 10, pace: 5 }
        : null
  if (fall) {
    const t = Math.floor(m.tick / fall.pace)
    for (let row = 1; row <= 3; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const k = (((col + 3 * (row - t)) % fall.every) + fall.every) % fall.every
        if (k === 0 && grid[row]?.[col]?.ch === ' ') put(col, row, { ch: fall.ch, fg: fall.fg, dim: true })
      }
    }
  }
  if (m.confT >= 0) {
    m.confetti.forEach((c, i) => {
      c.y += c.v
      c.x += c.d
      const row = Math.floor(c.y)
      const col = Math.round(c.x)
      if (grid[row]?.[col]?.ch === ' ') put(col, row, { ch: (m.tick + i) % 4 < 2 ? '*' : '·', fg: c.color })
    })
    if (++m.confT >= 68) m.confT = -1
  }

  const rows = grid.map(toRuns)
  const key = rows.map(r => r.map(run => `${run.fg ?? ''}|${run.bg ?? ''}|${run.dim ? 1 : 0}|${run.text}`).join('§')).join('¶')
  if (key === m.key) return false
  m.rows = rows
  m.key = key
  return true
}

export function create(props: ClawdProps): Mz {
  const m: Mz = {
    props,
    tick: 0,
    x: Math.max(0, Math.floor((props.width - COLS) / 2)),
    dir: 1,
    target: null,
    look: 0,
    blinkAt: 30,
    act: null,
    actT: 0,
    loveT: -1,
    noteT: -1,
    confT: -1,
    confetti: [],
    mood: props.mood,
    idleSince: 0,
    hover: null,
    // Don't replay an event that happened before he was drawn.
    lastEvent: props.event?.id ?? 0,
    flashAt: 200,
    flashT: -1,
    flashCol: 0,
    // A request made before he was drawn is not played again.
    controlId: props.control.kind === 'auto' ? 0 : props.control.id,
    demo: null,
    rows: [],
    key: '',
  }
  // An entrance, as on the first launch of a new version.
  startAct(m, pick(ENTRANCE_ACTS), props.width)
  step(m, props.width)
  return m
}

export default function Clawd(props: ClawdProps, surface: ClientSurface<Mz>): RenderElement {
  const { Box, Text } = surface.elements
  const cols = (): number => surface.columns || surface.state?.props.width || props.width
  let m = surface.state
  if (m === undefined) {
    m = create(props)
    surface.every(FRAME_MS, () => {
      const s = surface.state
      if (s && step(s, cols())) surface.setState(s)
    })
    surface.onPointer(event => {
      const s = surface.state
      if (!s) return
      s.hover = event.type === 'leave' ? null : event.x
      if (event.type === 'down') click(s, cols())
    })
    surface.setState(m)
  }
  m.props = props
  return (
    <Box flexDirection="column">
      {m.rows.map(row => (
        <Text wrap="truncate-end">
          {row.map(run =>
            run.fg || run.bg || run.dim ? (
              <Text
                {...(run.fg && { color: run.fg })}
                {...(run.bg && { backgroundColor: run.bg })}
                {...(run.dim && { dimColor: true })}
              >
                {run.text}
              </Text>
            ) : (
              run.text
            ),
          )}
        </Text>
      ))}
    </Box>
  )
}
