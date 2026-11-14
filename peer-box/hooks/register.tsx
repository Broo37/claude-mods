import type { EngineInterface, Register, RenderChildren } from 'claude-code'

type Elements = ReturnType<EngineInterface['ui']['resolve']>

// Messages another Claude session sent into this one.
const PEER_KINDS = new Set(['peer', 'peer-send-message'])
const PEER_COLOR = '#8BE9FD' // Dracula cyan
const PEER_FILL = '#1E3A47' // the same blue, dark enough that white text and the cyan name read on it

// A tool box's border says how its call went (Dracula colors).
const TOOL_COLOR = '#6272A4' // done: quiet, so tool rows stay behind the chat
const RUNNING_COLOR = '#F1FA8C' // yellow while it runs
const FAILED_COLOR = '#FF5555' // red when it errored or an abort cut it short

// Tools whose call row Claude Code draws as nothing (their renderToolUseMessage returns
// null, as of Claude Code 2.1.323). Framing that row leaves an empty box in the chat.
const QUIET_TOOLS = new Set([
  'AskUserQuestion',
  'EndConversation',
  'EnterPlanMode',
  'ExitPlanMode',
  'ListAgents',
  'ScheduleWakeup',
  'ShowOnboardingRolePicker',
  'SubagentHandback',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskUpdate',
  'TestingPermission',
  'TodoWrite',
  'ToolSearch',
  'WrapUp',
])

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown }
type Call = { isRunning: boolean; isErrored: boolean; isInterrupted: boolean }
type Look = { borderStyle: string; borderColor: string; backgroundColor?: string }

const kids = (node: Node): Node[] => {
  const c = node.children
  return (Array.isArray(c) ? c : c === undefined || c === null ? [] : [c]).filter(
    (k): k is Node => typeof k === 'object' && k !== null,
  )
}

const spaced = (value: unknown) => typeof value === 'number' && value >= 1

// Claude Code's own drawing, passed through untouched by every mod beneath this one.
const isEngine = (node: unknown) => typeof node === 'object' && node !== null && (node as Node).type === 'engine'

// Whether a drawn row opens with a blank line. Claude Code's own row is sealed, so the
// caller says whether it does (`engine`). A plugin's row does when its top Box has a top
// margin, or when every way down to its first line does.
const startsBlank = (node: unknown, engine: boolean): boolean => {
  if (typeof node !== 'object' || node === null) return false
  const n = node as Node
  if (isEngine(n)) return engine
  if (n.type !== 'Box') return false
  if (spaced(n.props?.marginTop) || spaced(n.props?.marginY) || spaced(n.props?.margin)) return true
  const children = kids(n)
  if (children.length === 0) return false
  return n.props?.flexDirection === 'row' ? children.every(k => startsBlank(k, engine)) : startsBlank(children[0], engine)
}

// A row that draws nothing, such as one another mod hid: boxing it would leave an empty frame.
const isEmpty = (node: unknown): boolean =>
  node === null || node === undefined || (typeof node === 'object' && (node as Node).type === 'Box' && kids(node as Node).length === 0)

const callColor = (calls: readonly Call[]) =>
  calls.some(c => c.isErrored || c.isInterrupted) ? FAILED_COLOR : calls.some(c => c.isRunning) ? RUNNING_COLOR : TOOL_COLOR

// Frames a row. One that opens with a blank line (`lift`) has it pulled up under the top
// border, and that line of space goes above the frame instead, so the box hugs the text.
// One that opens on its text is framed where it stands: its spacing is already outside.
//
// A fill paints the cells inside the border only. The border's own cells keep the
// terminal's background, and its line runs through their middle, so a strip half a cell
// wide shows between the line and the fill. A Box of the same fill around the frame
// paints those cells as well.
const frame = ({ Box }: Elements, row: RenderChildren, look: Look, lift: boolean, spaceAbove = lift) => {
  const space = spaceAbove ? { marginTop: 1 } : {}
  const framed = (
    <Box {...(look.backgroundColor ? {} : space)} paddingX={1} flexDirection="column" {...look}>
      {lift ? (
        <Box marginTop={-1} flexDirection="column">
          {row}
        </Box>
      ) : (
        row
      )}
    </Box>
  )
  if (!look.backgroundColor) return framed
  return (
    <Box {...space} flexDirection="column" backgroundColor={look.backgroundColor}>
      {framed}
    </Box>
  )
}

// What places a Box among its siblings. The fill layer added around a frame takes these
// over, so the frame keeps its place and size.
const PLACING = new Set([
  'margin', 'marginX', 'marginY', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
  'alignSelf', 'flexGrow', 'flexShrink', 'flexBasis', 'width', 'minWidth', 'maxWidth',
  'position', 'top', 'right', 'bottom', 'left',
])

// Puts a layer of the same fill around every filled frame in a tree another mod drew
// (prismantis's reply and prompt bubbles), as `frame` does for this mod's own, so no dark
// strip shows between the line and the fill. Claude Code's own drawing is left alone, and
// a tree with no filled frame comes back as it was.
const fillEdges = ({ Box }: Elements, node: unknown): unknown => {
  if (Array.isArray(node)) {
    const out = node.map(n => fillEdges({ Box } as Elements, n))
    return out.some((n, i) => n !== node[i]) ? out : node
  }
  if (typeof node !== 'object' || node === null || (node as Node).type !== 'Box') return node
  const n = node as Node
  const children = n.children === undefined ? undefined : fillEdges({ Box } as Elements, n.children)
  const kept = children === n.children ? n : { ...n, children }
  const props = n.props ?? {}
  if (!props.borderStyle || props.backgroundColor === undefined) return kept
  const outer: Record<string, unknown> = {}
  const inner: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(props)) (PLACING.has(k) ? outer : inner)[k] = v
  return (
    <Box {...(outer as object)} flexDirection="column" backgroundColor={props.backgroundColor as string}>
      {{ ...kept, props: inner } as never}
    </Box>
  )
}

export const register: Register = on => {
  // Calls drawn as rows of an unfolded group. Claude Code opens each of those rows with a
  // blank line (its result drawn inline under it); a standalone call's row opens on its
  // text, with its spacing outside the row. Bounded: the oldest goes first.
  const groupRows = new Set<string>()
  const rememberRow = (id: string) => {
    groupRows.delete(id)
    groupRows.add(id)
    if (groupRows.size > 500) groupRows.delete(groupRows.values().next().value!)
  }

  // Claude's reply, as prismantis draws it in a bubble: fill the bubble's border cells.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => fillEdges($.ui.resolve(e), await next(e)) as never)

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const el = $.ui.resolve(e)
    // Your own prompt and the rest: fill the border cells of a bubble a mod drew.
    if (!PEER_KINDS.has(e.props.origin.kind)) return fillEdges(el, await next(e)) as never
    const name = e.props.from?.name
    const look = { borderStyle: 'single', borderColor: PEER_COLOR, backgroundColor: PEER_FILL }
    // Without a sender name Claude Code's row is framed: it opens with a blank line.
    if (!name) {
      const row = await next(e)
      return frame(el, row, look, startsBlank(row, true))
    }
    // With one the row is drawn here, label then text, with the line of space above.
    const { Text } = el
    return frame(el, [<Text key="from" bold color={PEER_COLOR}>{`@ ${name}›`}</Text>, <Text key="text">{e.props.text}</Text>], look, false, true)
  })

  // One tool call's row: frame whatever draws it (Claude Code or prismantis). A quiet
  // tool's row is framed only when a mod drew it, since Claude Code's own is empty.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const row = await next(e)
    if (isEmpty(row) || (QUIET_TOOLS.has(e.props.tool) && isEngine(row))) return row
    const lift = startsBlank(row, groupRows.has(e.props.tool_use_id))
    return frame($.ui.resolve(e), row, { borderStyle: 'single', borderColor: callColor([e.props]) }, lift)
  })

  // A folded run of calls ("Read 3 files"): frame its one line. Unfolded, each call is a
  // ToolUse row framed above, so the group is left alone to avoid a box inside a box.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.props.isExpanded) {
      for (const call of e.props.calls) if (call.tool_use_id) rememberRow(call.tool_use_id)
      return next(e)
    }
    const row = await next(e)
    if (isEmpty(row)) return row
    return frame($.ui.resolve(e), row, { borderStyle: 'single', borderColor: callColor(e.props.calls) }, startsBlank(row, false))
  })
}
