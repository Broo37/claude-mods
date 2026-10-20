import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { FRAME_MS, LASTS_MS, ROWS, bitsOf, cellsAt } from './burst'
import type { Bit } from './burst'
import type { ConfettiBurst } from '../types'

// Confetti: a second and a half of colored pixel bits over the checklist above
// the prompt, each time a Clean View job ends as All done, and on /confetti.
//
// Listed before clean-view, it wraps the band Clean View draws: the burst on
// top, everything Clean View drew under it. It reads Clean View's checklist and
// never writes it.

// The Raster the burst is drawn in, by the name a repaint finds it under.
const KEY = 'confetti'

const burst = atom({ plugin: 'confetti', key: 'burst' } as const, null as ConfettiBurst)

const checklist = { plugin: 'clean-view', key: 'checklist' } as const

// The band the burst was last drawn in, which the frames are painted into: a
// resize draws it again at its new width.
let band: { requestId: string; columns: number } | null = null

// The bits of the burst on screen, thrown once for its seed and width.
let thrown: { seed: number; columns: number; bits: Bit[] } | null = null

let mover: Timer | null = null

let isMoving = false

const bitsFor = (seed: number, columns: number) => {
  if (thrown?.seed !== seed || thrown.columns !== columns) {
    thrown = { seed, columns, bits: bitsOf(seed, columns) }
  }

  return thrown.bits
}

function stop() {
  mover?.cancel()
  mover = null
}

// Paints the burst at the moment it is at, and lets it go once it is over.
async function move($: EngineInterface) {
  if (isMoving) {
    return
  }

  isMoving = true

  try {
    const playing = await read($, burst)

    if (playing === null) {
      stop()

      return
    }

    const ms = (await $.clock.now()) - playing.startedAt

    if (ms >= LASTS_MS) {
      stop()
      await update($, burst, now => (now?.startedAt === playing.startedAt ? null : now))

      return
    }

    // Until the band has drawn the burst there is nothing to paint; a frame the
    // band refuses (it was drawn again meanwhile) is simply missed.
    if (band !== null) {
      await $.ui.blit({ requestId: band.requestId, key: KEY, cells: cellsAt(bitsFor(playing.seed, band.columns), band.columns, ms) })
    }
  } catch {
    // A missed frame is not worth a word.
  } finally {
    isMoving = false
  }
}

async function play($: EngineInterface) {
  const startedAt = await $.clock.now()

  await update($, burst, () => ({ startedAt, seed: startedAt >>> 0 }))
  stop()
  mover = $.clock.every(FRAME_MS, () => void move($))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'confetti', description: 'Play the confetti' })

    return next(e)
  })

  on('command.run', { command: 'confetti' }, async $ => {
    await play($)

    return { text: '🎉' }
  })

  // Watches Clean View's checklist as it is written: the write that turns a
  // job to All done sets the burst off. It only watches, so a slip here never
  // keeps Clean View's write from landing.
  on('state.set', { plugin: 'clean-view', key: 'checklist' }, async ($, e, next) => {
    const before = (await $.state.get(checklist)).value?.phase
    const result = await next(e)

    if (before !== 'done' && e.value.phase === 'done') {
      await play($)
    }

    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const playing = await read($, burst)
    const rest = await next(e)

    // Only the terminal has a Raster, and a survey has the band to itself.
    if (playing === null || e.surface !== 'terminal' || e.props.hasSurvey) {
      return rest
    }

    const ms = (await $.clock.now()) - playing.startedAt

    if (ms >= LASTS_MS) {
      return rest
    }

    const columns = Math.max(1, Math.min(512, e.props.bodyColumns))
    band = { requestId: e.requestId, columns }
    const { Box, Raster } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Raster key={KEY} columns={columns} rows={ROWS} cells={cellsAt(bitsFor(playing.seed, columns), columns, ms)} />
        {rest}
      </Box>
    )
  })
}
