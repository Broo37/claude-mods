import type { Register } from 'claude-code'

// Messages another Claude session sent into this one.
const PEER_KINDS = new Set(['peer', 'peer-send-message'])

export const register: Register = on => {
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (!PEER_KINDS.has(e.props.origin.kind)) return next(e)
    const row = await next(e)
    const { Box } = $.ui.resolve(e)
    return (
      <Box borderStyle="single" borderColor="#8BE9FD" paddingX={1} flexDirection="column">
        {row}
      </Box>
    )
  })
}
