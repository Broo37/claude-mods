import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { lineOf } from './lines'
import type { Run } from './lines'

// Fold View: every tool call's row in the transcript is one line in plain
// words, folded, that a click opens to the row Claude Code draws (the command,
// its output, the diff) and the next click folds again. Claude's written
// replies are left as they are.
//
// Loaded after clean-view, it shows only while Clean View is off: Clean View
// on draws no tool rows at all, so these hooks are never asked to.

const opened = atom({ plugin: 'fold-view', key: 'opened' } as const, [] as string[])

// When each call started and, once it ended, how long it took. Kept in the
// module, not the session's state: a row redraws on its own when its call
// ends, and a write to the state would redraw every row in the transcript.
const timings = new Map<string, { startedAt: number; ms?: number }>()

const lookOf = (run: Run) => ({
  wrap: 'truncate-end' as const,
  ...(run.color !== undefined && { color: run.color }),
  ...(run.isDim === true && { dimColor: true }),
})

async function flip($: EngineInterface, id: string) {
  await update($, opened, ids => (ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id]))
}

// How long a call took, where it was seen to start. A row that draws its ended
// call before the call's hook has measured it measures it then.
async function spentOn($: EngineInterface, id: string, isRunning: boolean) {
  const timing = timings.get(id)

  if (timing === undefined) {
    return null
  }

  if (timing.ms === undefined && !isRunning) {
    timing.ms = (await $.clock.now()) - timing.startedAt
  }

  return timing.ms ?? null
}

export function registerFoldView(on: On) {
  // Times every call. It only watches: what `next` answers is what it answers.
  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id

    if (id !== undefined) {
      timings.set(id, { startedAt: await $.clock.now() })
    }

    const result = await next(e)
    const timing = id === undefined ? undefined : timings.get(id)

    if (timing !== undefined && timing.ms === undefined) {
      timing.ms = (await $.clock.now()) - timing.startedAt
    }

    return result
  })

  // A run of reads and searches the transcript would fold into one count line
  // is unfolded, so that each call is a row of its own, folded here in turn.
  on('ui.render', { component: 'ToolGroup' }, ($, e, next) => next({ ...e, props: { ...e.props, isExpanded: true } }))

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const id = e.props.tool_use_id
    const isOpen = (await read($, opened)).includes(id)
    const ms = await spentOn($, id, e.props.isRunning)
    const { Box, Button, Text } = $.ui.resolve(e)
    const line = (
      <Button key={`fold-${id}`} plain onPress={() => flip($, id)}>
        {lineOf(e.props, ms, isOpen).map(run => (
          <Text {...lookOf(run)}>{run.text}</Text>
        ))}
      </Button>
    )

    if (!isOpen) {
      return <Box>{line}</Box>
    }

    const row = await next(e)

    // A blank line after it, as before it, so the next folded line stands apart.
    return (
      <Box flexDirection="column" marginBottom={1}>
        {line}
        {row}
      </Box>
    )
  })

  // The result under a call's own row shows with the row opened, and not before.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if ((await read($, opened)).includes(e.props.tool_use_id)) {
      return next(e)
    }

    const { Box } = $.ui.resolve(e)

    return <Box />
  })
}
