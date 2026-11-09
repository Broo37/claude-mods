import type { Register } from 'claude-code'

// Messages another Claude session sent into this one.
const PEER_KINDS = new Set(['peer', 'peer-send-message'])
const PEER_COLOR = '#8BE9FD' // Dracula cyan
const PEER_FILL = '#1E3A47' // the same blue, dark enough that white text and the cyan name read on it
const TOOL_COLOR = '#6272A4' // Dracula comment: quiet, so tool rows stay behind the chat

export const register: Register = on => {
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (!PEER_KINDS.has(e.props.origin.kind)) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const name = e.props.from?.name
    // Claude Code's own row starts with a blank spacer line; drawing the row here keeps
    // that spacing outside the frame. Without a sender name, frame the engine's row.
    const body = name
      ? [
          <Text key="from" bold color={PEER_COLOR}>{`@ ${name}›`}</Text>,
          <Text key="text">{e.props.text}</Text>,
        ]
      : [await next(e)]
    return (
      <Box marginTop={1} borderStyle="single" borderColor={PEER_COLOR} backgroundColor={PEER_FILL} paddingX={1} flexDirection="column">
        {body}
      </Box>
    )
  })

  // One tool call's row: frame whatever draws it (Claude Code or prismantis).
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const row = await next(e)
    const { Box } = $.ui.resolve(e)
    return (
      <Box borderStyle="single" borderColor={TOOL_COLOR} paddingX={1} flexDirection="column">
        {row}
      </Box>
    )
  })

  // A folded run of calls ("Read 3 files"): frame its one line. Unfolded, each call is a
  // ToolUse row framed above, so the group is left alone to avoid a box inside a box.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    const row = await next(e)
    const { Box } = $.ui.resolve(e)
    return (
      <Box borderStyle="single" borderColor={TOOL_COLOR} paddingX={1} flexDirection="column">
        {row}
      </Box>
    )
  })
}
