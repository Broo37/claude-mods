import { COMET } from './comet'
import { EQUALIZER } from './equalizer'
import { FRAME_MS, FRAMES } from './frames'
import { PONG } from './pong'
import { RAINBOW } from './rainbow'
import type { Look } from './strip'

// The face eating a bar of blocks, as the person had it in tweakcc.
export const SMILEY: Look = { frames: FRAMES, frameMs: FRAME_MS }

// The strips there are to pick from, by the name the option "Animation" has for each.
export const LOOKS: ReadonlyMap<string, Look> = new Map([
  ['equalizer', EQUALIZER],
  ['rainbow', RAINBOW],
  ['comet', COMET],
  ['pong', PONG],
  ['smiley', SMILEY],
])

// The strip a pick stands for: the equalizer where none was made, or one there is no strip of.
export const lookOf = (style: unknown) => (typeof style === 'string' ? LOOKS.get(style) : undefined) ?? EQUALIZER
