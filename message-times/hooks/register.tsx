import type { EngineInterface, Register } from 'claude-code'

import { claimed, newest, stampOf } from './times'
import type { Pending } from './times'

// What Claude Code calls the row of a prompt it has drawn but not stored yet.
const PLACEHOLDER = 'placeholder'

// Under what name a session's times are kept, before its id.
const KEY = 'times:'

// How many times a session keeps, how often they are written down while a
// turn runs, and after how long without a prompt a session is forgotten.
const KEPT = 2000

const SAVE_MS = 10_000

const FORGET_MS = 30 * 24 * 3_600_000

// When each row of this session was sent, by the id Claude Code gave the row.
const times = new Map<string, number>()

// The prompts sent whose rows have not been drawn yet, oldest first.
let pending: Pending[] = []

// The name this session's times are kept under, once its id is known.
let key: string | undefined

let isUnsaved = false

const timesIn = (kept: unknown): [string, number][] =>
  typeof kept === 'object' && kept !== null
    ? Object.entries(kept).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    : []

async function save($: EngineInterface) {
  if (!isUnsaved || key === undefined) {
    return
  }

  isUnsaved = false
  await $.store.set(key, newest(Object.fromEntries(times), KEPT))
}

// A session nobody has sent a prompt in for a month is not opened again.
async function forget($: EngineInterface, now: number) {
  for (const name of await $.store.keys()) {
    if (!name.startsWith(KEY) || name === key) {
      continue
    }

    const last = Math.max(0, ...timesIn(await $.store.get(name)).map(([, at]) => at))

    if (now - last > FORGET_MS) {
      await $.store.delete(name)
    }
  }
}

// Reads back the times kept for this session, and has the rows that were drawn
// without them drawn again.
async function recall($: EngineInterface) {
  try {
    const [id, now] = await Promise.all([$.session.id(), $.clock.now()])
    key = `${KEY}${id}`

    for (const [row, at] of timesIn(await $.store.get(key))) {
      times.set(row, at)
    }

    $.ui.invalidate('ui.render')
    await forget($, now)
  } catch (error) {
    $.ui.log(`message-times: reading the kept times failed: ${error instanceof Error ? error.message : String(error)}`, {
      to: 'debug',
    })
  }
}

export const register: Register = on => {
  on('session.start', ($, e, next) => {
    $.clock.after(0, () => void recall($))
    $.clock.every(SAVE_MS, () => void save($))

    return next(e)
  })

  // /clear, /resume and /branch change which rows the session holds.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, ($, e, next) => {
    times.clear()
    $.clock.after(0, () => void recall($))

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer') {
      pending = [...pending, { text: e.text, at: await $.clock.now() }]
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await save($)

    return next(e)
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const row = await next(e)

    if (e.props.origin.kind !== 'composer') {
      return row
    }

    const now = await $.clock.now()
    let at = e.requestId === PLACEHOLDER ? now : times.get(e.requestId)

    if (at === undefined) {
      const claim = claimed(pending, e.props.text, now)
      pending = claim.rest

      // A row no prompt is waiting for was sent before this mod was there to see it.
      if (claim.at === undefined) {
        return row
      }

      at = claim.at
      times.set(e.requestId, at)
      isUnsaved = true
    }

    const { Box, Text } = $.ui.resolve(e)

    // The row Claude Code draws starts with an empty line, so the time is put
    // on its last one, at the right edge.
    return (
      <Box alignItems="flex-end">
        {row}
        <Box flexGrow={1} />
        <Text dimColor>{stampOf(at, now)}</Text>
      </Box>
    )
  })
}
