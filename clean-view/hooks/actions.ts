import { PLAN_STEPS, REPORT_PROGRESS } from './words'

// What Claude does in a step, as the person reads it once the step is opened:
// a tool call in a few plain words, why one failed, and Claude's own note.
// Unlike a step's name, an action may name a file: it is the detail under it.

// The longest an action, a reason or a note may be, the ellipsis included.
const ACTION = 100
const WHY = 70
const NOTE = 160

// The tools that are the checklist itself, or the making of a plan: no action.
const QUIET = new Set([PLAN_STEPS, REPORT_PROGRESS, 'ToolSearch', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'])

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

const wordsOf = (call: Record<string, unknown>): string | null => {
  const tool = textOf(call.tool)

  if (QUIET.has(tool)) {
    return null
  }

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
  }

  // A connected tool: mcp__<server>__<tool>.
  const [, server = '', name = ''] = /^mcp__(.+?)__(.+)$/.exec(tool) ?? []

  if (server !== '') {
    return `Used ${server}: ${name.replace(/_/g, ' ')}`
  }

  return `Used ${tool}`
}

export const actionOf = (call: Record<string, unknown>): string | null => {
  const words = wordsOf(call)

  return words === null ? null : oneLine(words, ACTION)
}

// Lines that only frame an error: a bare exit code, a bare "Error".
const FRAME = /^(?:exit code -?\d+|error:?)$/i

// Why a call failed: its text's first line that says something, in a line.
export const whyOf = (text: string): string => {
  const lines = text
    .replace(/<\/?[a-z_]+>/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
  const telling = lines.find(line => !FRAME.test(line)) ?? lines[0] ?? ''

  return oneLine(telling.replace(/^error:\s*/i, ''), WHY)
}

// Claude's note on a step, where it gave one: a line of plain words.
export const noteOf = (note: unknown): string | null => {
  const line = typeof note === 'string' ? oneLine(note, NOTE) : ''

  return line === '' ? null : line
}
