// One tool call of a turn: what it was, and when it began and ended, in
// milliseconds from the turn's start. A call that still runs has no end.
export type Call = { id: string; tool: string; label: string; start: number; end: number | null; isError: boolean }

// A turn as the chart draws it: its calls in the order they began, and how
// long it lasted once it has ended.
export type Turn = { calls: readonly Call[]; lasted: number | null }

// One stretch of a line as it is drawn: a theme color, bold, or dim.
export type Run = { text: string; color?: string; isBold?: boolean; isDim?: boolean }

// How wide the name of a tool and the time of a call are written, and how wide
// a label is in a pane of at least so many columns.
const NAME = 7

const TIME = 7

const LABELS = [
  { from: 60, width: 18 },
  { from: 46, width: 10 },
]

// A question put to the person, by Claude or by a mod that holds a risky
// command until they approve it. It is charted, because the turn waited for the
// answer, but it is no tool of the turn's.
const ASK = 'AskUserQuestion'

const SHORT: Record<string, string> = { PowerShell: 'PwSh', WebFetch: 'Fetch', WebSearch: 'Search', [ASK]: 'Ask' }

// A tool's name in six letters at most; a tool of an MCP server is one of many.
export const nameOf = (tool: string) => (tool.startsWith('mcp__') ? 'MCP' : (SHORT[tool] ?? tool.slice(0, 6)))

const text = (value: unknown) => (typeof value === 'string' ? value : '')

const lastOf = (path: string) => path.split(/[\\/]/).at(-1) ?? ''

// What a call was about, from its arguments: the command, the file, the
// pattern, the kind of agent, the site.
export const labelOf = (tool: string, args: Record<string, unknown>) => {
  if (tool.startsWith('mcp__')) {
    return tool.slice('mcp__'.length).replace('__', ':')
  }

  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return text(args.command).replace(/\s+/g, ' ').trim()
    case 'Read':
    case 'Edit':
    case 'Write':
      return lastOf(text(args.file_path))
    case 'NotebookEdit':
      return lastOf(text(args.notebook_path))
    case 'Grep':
    case 'Glob':
      return text(args.pattern)
    case 'Agent':
      return text(args.subagent_type) || text(args.description)
    case 'WebFetch':
      return /^[a-z]+:\/\/([^/?#]+)/i.exec(text(args.url))?.[1] ?? text(args.url)
    case 'WebSearch':
    case 'ToolSearch':
      return text(args.query)
    case 'Skill':
      return text(args.skill)
    case ASK: {
      const [first] = Array.isArray(args.questions) ? (args.questions as { header?: unknown; question?: unknown }[]) : []

      return text(first?.header) || text(first?.question)
    }
    default:
      return ''
  }
}

const COLORS: Record<string, string> = {
  Bash: 'claude',
  PowerShell: 'claude',
  Read: 'suggestion',
  Edit: 'success',
  Write: 'success',
  NotebookEdit: 'success',
  Grep: 'planMode',
  Glob: 'planMode',
  Agent: 'permission',
  WebFetch: 'warning',
  WebSearch: 'warning',
}

// The theme color of a tool's kind: the shell, reading, writing, searching,
// agents, the web, MCP servers, and the rest.
export const colorOf = (tool: string) => (tool.startsWith('mcp__') ? 'bashBorder' : (COLORS[tool] ?? 'inactive'))

const whole = (seconds: number) => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }

  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`
}

// How long a call took, in tenths of a second under ten seconds.
const tookOf = (ms: number) => {
  const tenths = Math.round(ms / 100)

  return tenths < 100 ? `${(tenths / 10).toFixed(1)}s` : whole(Math.round(ms / 1000))
}

const lastedOf = (ms: number) => whole(Math.round(ms / 1000))

// A label no wider than a width, cut with a mark when it is longer.
const cut = (label: string, width: number) => (label.length > width ? `${label.slice(0, Math.max(0, width - 1))}…` : label)

// A label in exactly its width.
const fitted = (label: string, width: number) => cut(label, width).padEnd(width)

// The lines of the chart for a pane of that many columns and rows: a heading,
// the span of time, and a bar a call. `elapsed` is how far into the turn it is
// now, which is what a turn that still runs is charted against.
// `nameColor` is the ink a call's tool name is drawn in, where it is not the
// tool's own: the Deck keeps its names quiet and lets the bars carry the color.
export const linesOf = (turn: Turn | null, elapsed: number, columns: number, rows: number, nameColor?: string): Run[][] => {
  if (turn === null) {
    return [[{ text: 'No turn yet. Tool calls show here as Claude works.', isDim: true }]]
  }

  const { calls, lasted } = turn
  const total = Math.max(1, lasted ?? elapsed)
  const tools = calls.filter(call => call.tool !== ASK)
  const failed = tools.filter(call => call.isError).length
  const count = tools.length === 0 ? 'no tools' : `${tools.length} ${tools.length === 1 ? 'tool' : 'tools'}`
  const heading: Run[] = [
    { text: 'Turn ', isDim: true },
    { text: `${lastedOf(total)}${lasted === null ? '…' : ''}`, isBold: true },
    { text: ` · ${count}`, isDim: true },
    ...(failed > 0 ? [{ text: ` · ${failed} failed`, color: 'error' }] : []),
  ]

  if (calls.length === 0) {
    return [heading]
  }

  // A pane too narrow for a label beside the bar stacks a call in two lines:
  // what it was, then its bar the whole width. A dock that already holds
  // another pane keeps that pane's width, so this is the usual case there.
  const label = LABELS.find(({ from }) => columns >= from)?.width ?? 0
  const isStacked = label === 0
  const lead = isStacked ? 0 : NAME + label + 1
  const width = Math.max(1, columns - lead - 1 - TIME)
  const end = lastedOf(total)
  const span: Run[] = [
    ...(lead > 0 ? [{ text: ' '.repeat(lead) }] : []),
    { text: `0s${'─'.repeat(Math.max(0, width - 2 - end.length))}${end}`, isDim: true },
  ]
  // What does not fit is the oldest: the newest calls are the ones being watched.
  const each = isStacked ? 2 : 1
  const room = Math.max(0, rows - 2)
  const shown = calls.length * each > room ? calls.slice(calls.length - Math.max(0, Math.floor((room - 1) / each))) : calls
  const hidden = calls.length - shown.length

  return [
    heading,
    span,
    ...(hidden > 0 ? [[{ text: `+${hidden} earlier`, isDim: true }]] : []),
    ...shown.flatMap((call): Run[][] => {
      const until = call.end ?? Math.max(call.start, elapsed)
      const from = Math.min(width - 1, Math.floor((call.start / total) * width))
      const to = Math.min(width, Math.max(from + 1, Math.ceil((until / total) * width)))
      const color = call.isError ? 'error' : colorOf(call.tool)
      const took = tookOf(until - call.start)
      const name: Run = { text: nameOf(call.tool).padEnd(NAME), color: nameColor ?? colorOf(call.tool) }
      const bar: Run[] = [
        ...(from > 0 ? [{ text: ' '.repeat(from) }] : []),
        { text: '█'.repeat(to - from), color },
        { text: ' '.repeat(width - to + 1) },
        call.isError
          ? { text: `✗ ${took}`.padStart(TIME), color: 'error' }
          : { text: `${took}${call.end === null ? '…' : ''}`.padStart(TIME), isDim: true },
      ]

      if (!isStacked) {
        return [[name, { text: `${fitted(call.label, label)} `, isDim: true }, ...bar]]
      }

      const about = columns - NAME

      return [
        [name, ...(call.label === '' ? [] : [{ text: cut(call.label, about), isDim: true }])],
        bar,
      ]
    }),
  ]
}
