import type { EngineInterface, Register, Timer } from 'claude-code'

import { FRAME_MS, FRAMES } from './frames'
import { CLAUDE_ORANGE, cellsOf, claudeIn, elapsedOf, frameAt, saidOf, themeFile } from './strip'

// The raster the strip is drawn in, by the name a repaint finds it under.
const STRIP = 'strip'

const COLUMNS = FRAMES[0]?.length ?? 0

// How long after a second is full the line is drawn again, to be sure it is.
const SLACK_MS = 15

// What the line says when the person set no wording of their own.
const WORDING = 'Iwan will get {}...'

let wording = WORDING

// The color of the strip. A raster takes a number, not a theme key, so the
// strip cannot follow the theme by itself: the theme's file is read for it.
let color = CLAUDE_ORANGE

// When the main turn began, while one runs.
let turnAt: number | undefined

// When the turn each line counts began, by the line's id.
const since = new Map<string, number>()

// The lines whose strip is on screen, to be moved.
const moving = new Set<string>()

let mover: Timer | null = null

let isMoving = false

// The redraw waiting for the second to turn, while one waits.
let second: Timer | null = null

async function tint($: EngineInterface) {
  try {
    const file = themeFile((await $.config.list()).find(row => row.key === 'theme')?.value)

    if (file === undefined) {
      color = CLAUDE_ORANGE

      return
    }

    const folder =
      (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))}/.claude`
    const theme = await $.fs.read(`${folder}/themes/${file}`)
    color = (typeof theme === 'string' ? claudeIn(theme) : undefined) ?? CLAUDE_ORANGE
  } catch {
    color = CLAUDE_ORANGE
  }
}

// Moves every strip on screen to the frame of now. One that is no longer there
// (the turn ended, a dialog took the line's place) is left alone until its line
// is drawn again.
async function move($: EngineInterface) {
  if (isMoving) {
    return
  }

  isMoving = true

  try {
    const now = await $.clock.now()

    for (const line of [...moving]) {
      const cells = cellsOf(frameAt(FRAMES, now - (since.get(line) ?? now), FRAME_MS), color)
      let isGone = false

      try {
        isGone = (await $.ui.blit({ requestId: line, key: STRIP, columns: COLUMNS, rows: 1, cells })).deny !== undefined
      } catch {
        isGone = true
      }

      if (isGone) {
        moving.delete(line)
      }
    }

    if (moving.size === 0) {
      mover?.cancel()
      mover = null
    }
  } finally {
    isMoving = false
  }
}

export const register: Register = (on, options) => {
  wording = typeof options.format === 'string' && options.format.trim() !== '' ? options.format : WORDING

  on('session.start', ($, e, next) => {
    $.clock.after(0, () => void tint($))

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    // A turn that starts while a line shows is not the one the line counts: it is a subagent's.
    if (moving.size === 0) {
      turnAt = await $.clock.now()
      since.clear()
    }

    // The theme may have been changed since the last turn.
    $.clock.after(0, () => void tint($))

    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) {
      turnAt = undefined
      moving.clear()
    }

    return next(e)
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    // Only the terminal has a raster, and before a turn has its verb the line says nothing.
    if (e.surface !== 'terminal' || (e.props.word === '' && e.props.message === null)) {
      return next(e)
    }

    const now = await $.clock.now()
    const began = since.get(e.requestId) ?? turnAt ?? now
    since.set(e.requestId, began)
    moving.add(e.requestId)
    mover ??= $.clock.every(FRAME_MS, () => void move($))
    // The strip moves without a redraw, the time does not: the line is drawn
    // again each time a second is full, for as long as that draws it.
    second ??= $.clock.after(1000 - ((now - began) % 1000) + SLACK_MS, () => {
      second = null
      $.ui.invalidate('ui.render')
    })

    const { Box, Text, Raster } = $.ui.resolve(e)
    const note = e.props.mode === 'thinking' ? ' · thinking' : ''

    // Claude Code's own line stands a row below the transcript.
    return (
      <Box marginTop={1}>
        <Raster key={STRIP} columns={COLUMNS} rows={1} cells={cellsOf(frameAt(FRAMES, now - began, FRAME_MS), color)} />
        <Text color="claude">{` ${saidOf(wording, e.props)}`}</Text>
        <Text dimColor>{` (${elapsedOf(now - began)}${note})`}</Text>
      </Box>
    )
  })
}
