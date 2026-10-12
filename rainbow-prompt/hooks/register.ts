import type { EngineInterface, Register } from 'claude-code'

import { DARK, decorationsOf, paletteFor, wordsIn } from './paint'
import type { Palette } from './paint'

// The rainbow words the person named, and the paints that suit their theme.
let words: readonly string[] = []

let palette: Palette = DARK

// Reads which theme is on. The paints are raw colors, so a light theme needs
// the darker set.
async function suit($: EngineInterface) {
  try {
    palette = paletteFor((await $.config.list()).find(row => row.key === 'theme')?.value)
  } catch {
    palette = DARK
  }
}

export const register: Register = (on, options) => {
  words = wordsIn(options.words)

  on('session.start', ($, e, next) => {
    $.clock.after(0, () => void suit($))

    return next(e)
  })

  // The theme may have been changed since the last turn.
  on('turn.start', ($, e, next) => {
    $.clock.after(0, () => void suit($))

    return next(e)
  })

  // Every key waits for this hook, and a hook that takes 50 ms of its own is
  // skipped: nothing is asked of the engine here but the edit itself.
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    const paints = decorationsOf(box.text, words, palette)

    return paints.length === 0 ? box : { ...box, decorations: [...(box.decorations ?? []), ...paints] }
  })
}
