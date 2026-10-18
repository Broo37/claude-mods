// What a folded row shows: the tool call in a few plain words, a mark for how
// it went, and how long a slow one took, as runs of text with a theme color or
// dim. Pure, so that it reads the same on every surface.

export type Run = { text: string; color?: string; isDim?: boolean }

// A tool call as its row knows it.
export type Call = {
  tool: string
  input: unknown
  isRunning: boolean
  isErrored: boolean
  isInterrupted: boolean
}

// From how long a call is said to have taken.
export const SLOW_MS = 3000

// The longest the words may be, the ellipsis included.
const LONGEST = 100

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

// Clean View's own tools, which make and keep its checklist.
const PLAN_STEPS = 'mcp__clean-view__plan_steps'
const REPORT_PROGRESS = 'mcp__clean-view__report_progress'

const oneLine = (text: string, longest: number) => {
  const line = text.replace(/\s+/g, ' ').trim()

  return line.length <= longest ? line : `${line.slice(0, longest - 1).trimEnd()}…`
}

const textOf = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')

// A path's last part, whichever way its separators lean.
const fileOf = (path: unknown) => textOf(path).split(/[\\/]/).filter(part => part !== '').at(-1) ?? ''

const hostOf = (url: unknown) => {
  const [, host = ''] = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(textOf(url)) ?? []

  return host
}

const said = (lead: string, what: string, bare: string) => (what === '' ? bare : `${lead}${what}`)

// The call in a few plain words, as Clean View words what Claude did in a step.
// Here every call has its words, the making of a plan too: each is a row.
export const wordsOf = (tool: string, input: unknown): string => {
  const call = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}

  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return said('Ran: ', textOf(call.description), 'Ran a command')
    case 'Read':
      return said('Read ', fileOf(call.file_path), 'Read a file')
    case 'Edit':
    case 'MultiEdit':
      return said('Edited ', fileOf(call.file_path), 'Edited a file')
    case 'Write':
      return said('Wrote ', fileOf(call.file_path), 'Wrote a file')
    case 'NotebookEdit':
      return said('Edited ', fileOf(call.notebook_path), 'Edited a notebook')
    case 'Grep': {
      const pattern = textOf(call.pattern)

      return pattern === '' ? 'Searched the files' : `Searched for "${pattern}"`
    }
    case 'Glob':
      return said('Looked for files: ', textOf(call.pattern), 'Looked for files')
    case 'WebSearch':
      return said('Searched the web: ', textOf(call.query), 'Searched the web')
    case 'WebFetch':
      return said('Read a web page: ', hostOf(call.url), 'Read a web page')
    case 'Agent':
    case 'Task':
      return said('Started a helper: ', textOf(call.description), 'Started a helper')
    case 'AskUserQuestion':
      return 'Asked you a question'
    case 'Skill': {
      // A plugin's skill goes by its own name, without the plugin's.
      const skill = textOf(call.skill).split(':').at(-1) ?? ''

      return skill === '' ? 'Used a skill' : `Used the ${skill} skill`
    }
    case PLAN_STEPS:
      return 'Laid out the steps'
    case REPORT_PROGRESS:
      return 'Reported progress'
    case 'ToolSearch':
      return 'Loaded tools'
    case 'TodoWrite':
      return 'Updated the to-do list'
    case 'TaskCreate':
      return said('Added a task: ', textOf(call.subject), 'Added a task')
    case 'TaskUpdate':
      return 'Updated a task'
    case 'TaskList':
    case 'TaskGet':
      return 'Checked the tasks'
  }

  // A connected tool: mcp__<server>__<tool>.
  const [, server = '', name = ''] = /^mcp__(.+?)__(.+)$/.exec(tool) ?? []

  if (server !== '') {
    return `Used ${server}: ${name.replace(/_/g, ' ')}`
  }

  return `Used ${tool}`
}

// How long something took, in a few plain units.
export const durationOf = (ms: number): string => {
  const whole = Math.max(0, ms)

  if (whole >= HOUR) {
    return `${Math.floor(whole / HOUR)}h ${Math.floor((whole % HOUR) / MINUTE)}m`
  }

  if (whole >= MINUTE) {
    return `${Math.floor(whole / MINUTE)}m ${Math.floor((whole % MINUTE) / SECOND)}s`
  }

  return `${Math.floor(whole / SECOND)}s`
}

// The row's one line: the arrow that says it opens, the mark of how it went,
// the words, and after them what is worth knowing of how it went. `ms` is how
// long it took, where that is known.
export const lineOf = (call: Call, ms: number | null, isOpen: boolean): Run[] => {
  const arrow: Run = { text: isOpen ? '▾ ' : '▸ ', color: 'claude' }
  const words: Run = { text: oneLine(wordsOf(call.tool, call.input), LONGEST) }
  const took: Run[] = ms !== null && ms >= SLOW_MS ? [{ text: ` · ${durationOf(ms)}`, isDim: true }] : []

  if (call.isRunning) {
    return [arrow, { text: '◌ ', isDim: true }, words, { text: ' · running', isDim: true }]
  }

  // An abort marks the call errored too: it is told as stopped, not failed.
  if (call.isInterrupted) {
    return [arrow, { text: '■ ', color: 'warning' }, words, { text: ' · stopped', isDim: true }, ...took]
  }

  if (call.isErrored) {
    return [arrow, { text: '✗ ', color: 'error' }, words, { text: ' · failed', color: 'error' }, ...took]
  }

  return [arrow, { text: '✓ ', color: 'success' }, words, ...took]
}
