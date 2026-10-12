import type { EngineInterface, Register } from 'claude-code'

import { badgeOf, partsOf } from './format'
import type { Call, Receipt } from './format'

// How many tool calls and how many turns are remembered: a session's last few
// thousand, which is more than its transcript shows at once.
const KEPT = 3000

// What each tool call came to, by the id its row is drawn under.
const calls = new Map<string, Call>()

// What the session had cost and how much of the five-hour limit was used.
type Reading = { costUsd: number | null; fiveHour: number | null }

// The main turn that is running: its tools so far, and the reading it began at.
let turn: { tools: number; failed: number; began: Reading | null } | null = null

// The receipts no line has taken yet, by how long their turn lasted, which is
// all a line says of its turn; and the receipt of each line that took one.
const waiting = new Map<number, Receipt[]>()

const receipts = new Map<string, Receipt>()

// Keeps the newest entries of a map that would otherwise grow with the session.
function trim(map: Map<unknown, unknown>) {
  for (const key of map.keys()) {
    if (map.size <= KEPT) {
      break
    }

    map.delete(key)
  }
}

async function reading($: EngineInterface): Promise<Reading | null> {
  try {
    const { cost, rateLimits } = await $.session.usage()

    return {
      costUsd: cost?.usd ?? null,
      fiveHour: rateLimits.find(limit => limit.kind === 'five_hour')?.percentUsed ?? null,
    }
  } catch {
    return null
  }
}

// Notes where a turn begins. One that begins while another runs is a
// subagent's, and its tools are not the main turn's.
async function begin($: EngineInterface) {
  if (turn !== null) {
    return
  }

  const mine = { tools: 0, failed: 0, began: null as Reading | null }
  turn = mine
  mine.began = await reading($)
}

const added = (from: number | null | undefined, to: number | null | undefined) =>
  from === null || from === undefined || to === null || to === undefined ? null : Math.max(0, to - from)

// Writes the receipt of the main turn that just ended, for its line to take.
async function settle($: EngineInterface, durationMs: number) {
  const ended = turn
  turn = null
  const [doneAt, now] = await Promise.all([$.clock.now(), reading($)])
  const receipt: Receipt = {
    durationMs,
    tools: ended?.tools ?? 0,
    failed: ended?.failed ?? 0,
    costUsd: added(ended?.began?.costUsd, now?.costUsd),
    fiveHour: added(ended?.began?.fiveHour, now?.fiveHour),
    doneAt,
  }

  waiting.set(durationMs, [...(waiting.get(durationMs) ?? []), receipt])
  trim(waiting)
  // The line may have been drawn before its receipt was written.
  $.ui.invalidate('ui.render')
}

export const register: Register = on => {
  on('turn.start', async ($, e, next) => {
    await begin($)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await settle($, e.durationMs)
    }

    return next(e)
  })

  // Times every tool call and hands its answer on as it came. Timing a call
  // must never stand in its way: should this hook fail, the call goes on, or
  // its answer stands, as if the hook were not there.
  on('tool.call', async ($, e, next) => {
    const began = await $.clock.now()
    const answer = await next(e)
    const isError = answer.isError === true || answer.deny !== undefined
    calls.set(e.tool_use_id, { ms: (await $.clock.now()) - began, isError })
    trim(calls)

    // A question put to the person is no work of the turn's, whoever asks it:
    // Claude, or a mod that holds a risky command until the person approves it.
    if (e.agentId === undefined && turn !== null && e.tool !== 'AskUserQuestion') {
      turn.tools += 1
      turn.failed += isError ? 1 : 0
    }

    return answer
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    // Only the terminal's row is laid out the way the badge is placed for.
    const badge = e.surface === 'terminal' ? badgeOf(calls.get(e.props.tool_use_id), e.props) : null

    if (badge === null) {
      return next(e)
    }

    const row = await next(e)
    const { Box, Text } = $.ui.resolve(e)

    // The row Claude Code draws begins with an empty line, so the badge stands
    // a row down, at the right of the line that names the tool.
    return (
      <Box alignItems="flex-start">
        {row}
        <Box flexGrow={1} />
        <Box marginTop={1} flexShrink={0}>
          <Text color={badge.color}>{badge.text}</Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    let receipt = receipts.get(e.requestId)

    if (receipt === undefined) {
      const queue = waiting.get(e.props.durationMs) ?? []
      receipt = queue.shift()

      // A turn this mod did not see end keeps the line Claude Code draws.
      if (receipt === undefined) {
        return next(e)
      }

      if (queue.length === 0) {
        waiting.delete(e.props.durationMs)
      }

      receipts.set(e.requestId, receipt)
      trim(receipts)
    }

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box marginTop={1}>
        <Text dimColor>{'✻ '}</Text>
        {partsOf(receipt).flatMap((part, at) => [
          ...(at > 0 ? [<Text dimColor>{' · '}</Text>] : []),
          <Text
            {...(part.color !== undefined && { color: part.color })}
            {...(part.isBold === true && { bold: true })}
            {...(part.isDim === true && { dimColor: true })}
          >
            {part.text}
          </Text>,
        ])}
      </Box>
    )
  })
}
