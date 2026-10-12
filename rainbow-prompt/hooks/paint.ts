// A painted stretch of the prompt: `[start, end)` in UTF-16 code units, which
// is how the prompt box counts, and the styles laid on it.
export type Decoration = {
  start: number
  end: number
  color?: string
  backgroundColor?: string
  bold?: boolean
  underline?: boolean
}

type Range = { start: number; end: number }

// The colors of everything but a secret. They are raw colors, so there is one
// set for a dark theme and a darker one that can be read on a light theme.
export type Palette = { ticket: string; path: string; link: string; rainbow: readonly string[] }

export const DARK: Palette = {
  ticket: '#89dceb',
  path: '#a6e3a1',
  link: '#89b4fa',
  rainbow: ['#f38ba8', '#fab387', '#f9e2af', '#a6e3a1', '#89dceb', '#89b4fa', '#cba6f7'],
}

export const LIGHT: Palette = {
  ticket: '#0b7285',
  path: '#2f7d1f',
  link: '#1e66f5',
  rainbow: ['#d20f39', '#e05d00', '#b8860b', '#2f8f2f', '#0b8fa8', '#1e66f5', '#8839ef'],
}

// A secret is a warning, and reads the same on every theme.
export const SECRET = { color: '#ffffff', backgroundColor: '#d20f39', bold: true } as const

// A prompt is looked through again at every key, so one longer than this (a
// pasted file) is left unpainted.
export const LIMIT = 20_000

export const paletteFor = (theme: unknown) => (typeof theme === 'string' && /light/i.test(theme) ? LIGHT : DARK)

// The rainbow words as the person wrote them in /config, commas between them.
export const wordsIn = (option: unknown) =>
  typeof option === 'string'
    ? option
        .split(',')
        .map(word => word.trim())
        .filter(word => word !== '')
    : ['ultrathink']

const TICKET = /\b([A-Z][A-Z0-9]+)-\d+\b/g

// Names of standards that are shaped like a ticket id and are none.
const NOT_TICKETS = new Set([
  'AES', 'BASE', 'CP', 'ES', 'GMT', 'GPT', 'HTTP', 'IPV', 'ISO', 'MD', 'MP', 'RFC', 'RSA', 'SHA', 'SSL', 'TLS', 'TOP',
  'UTC', 'UTF', 'WINDOWS',
])

const LINK = /https?:\/\/[^\s<>"']+/g

// What ends a sentence or closes a bracket after a link, and is not part of it.
const CLOSING = /[.,;:!?)\]}]+$/

// A root, if any, and names with slashes between them. Whether that is a path
// is decided from its parts, below.
const PATH = /(?<![\w\\/.~@+-])((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|~[\\/]|[\\/])?)([\w@+-][\w.@+-]*(?:[\\/][\w.@+-]+)*)/g

// The endings by which a file named without its folder is known for a file.
const ENDINGS = new Set([
  'bash', 'bat', 'c', 'cfg', 'cjs', 'cmd', 'conf', 'cpp', 'cs', 'cshtml', 'csproj', 'css', 'csv', 'dll', 'docx', 'env',
  'exe', 'gif', 'go', 'gz', 'h', 'hpp', 'htm', 'html', 'ico', 'ini', 'java', 'jpeg', 'jpg', 'js', 'json', 'jsonc',
  'jsx', 'kt', 'less', 'lock', 'log', 'md', 'mdx', 'mjs', 'pdf', 'png', 'pptx', 'props', 'ps1', 'psm1', 'py', 'razor',
  'rb', 'rs', 'scss', 'sh', 'sln', 'slnx', 'sql', 'svg', 'swift', 'tar', 'targets', 'toml', 'ts', 'tsv', 'tsx', 'txt',
  'vue', 'webp', 'xlsx', 'xml', 'yaml', 'yml', 'zip', 'zsh',
])

// Keys of the usual services, known by their shape.
const KEYS = [
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{30,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{35}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
]

// What is given as a password or a token: the value after the name.
const NAMED =
  /(?<![A-Za-z0-9])(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)[\w-]*\s*[:=]\s*(\S{8,})/gi

const overlaps = (ranges: readonly Range[], { start, end }: Range) =>
  ranges.some(range => start < range.end && end > range.start)

const rangesOf = (text: string, pattern: RegExp): Range[] =>
  [...text.matchAll(pattern)].map(match => ({ start: match.index, end: match.index + match[0].length }))

// What looks like a secret, each stretch once however many ways it was found.
const secretsIn = (text: string) => {
  const found = KEYS.flatMap(pattern => rangesOf(text, pattern))

  for (const match of text.matchAll(NAMED)) {
    const value = match[1] ?? ''

    // A value of letters alone is a word of the sentence, not a password.
    if (/\d/.test(value) && /[A-Za-z]/.test(value)) {
      const end = match.index + match[0].length
      found.push({ start: end - value.length, end })
    }
  }

  const merged: Range[] = []

  for (const range of found.sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1)

    if (last !== undefined && range.start <= last.end) {
      last.end = Math.max(last.end, range.end)
    } else {
      merged.push({ ...range })
    }
  }

  return merged
}

const linksIn = (text: string) =>
  rangesOf(text, LINK).map(({ start, end }) => ({
    start,
    end: end - (CLOSING.exec(text.slice(start, end))?.[0].length ?? 0),
  }))

const ticketsIn = (text: string): Range[] =>
  [...text.matchAll(TICKET)]
    .filter(match => !NOT_TICKETS.has(match[1] ?? ''))
    .map(match => ({ start: match.index, end: match.index + match[0].length }))

const pathsIn = (text: string) => {
  const paths: Range[] = []

  for (const match of text.matchAll(PATH)) {
    const root = match[1] ?? ''
    // A full stop after a path ends the sentence, not the path.
    const names = (match[2] ?? '').replace(/\.+$/, '')
    const parts = names.split(/[\\/]/)
    const ending = /\.([A-Za-z0-9]{1,8})$/.exec(parts.at(-1) ?? '')?.[1]
    const isNamed = parts.some(part => /[A-Za-z]/.test(part))
    let isPath: boolean

    if (root === '/' || root === '\\') {
      // A slash and one name is a command (`/help`), not a path.
      isPath = parts.length > 1
    } else if (root !== '') {
      isPath = names !== ''
    } else if (parts.length === 1) {
      isPath = ending !== undefined && ENDINGS.has(ending.toLowerCase())
    } else {
      // `and/or` and a date have a slash too: a path has a file ending or is three names deep.
      isPath = isNamed && (ending !== undefined || parts.length > 2)
    }

    if (isPath) {
      paths.push({ start: match.index, end: match.index + root.length + names.length })
    }
  }

  return paths
}

const patterns = new Map<string, RegExp>()

// A rainbow word wherever it stands by itself, in any case.
const patternOf = (word: string) => {
  let pattern = patterns.get(word)

  if (pattern === undefined) {
    pattern = new RegExp(`(?<!\\w)${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\w)`, 'gi')
    patterns.set(word, pattern)
  }

  return pattern
}

// What to paint over a prompt, in the order the paints are laid on: a later
// one wins where two meet. A secret is painted as a secret alone, and a link
// as a link alone.
export const decorationsOf = (text: string, words: readonly string[], palette: Palette): Decoration[] => {
  if (text.length > LIMIT) {
    return []
  }

  const secrets = secretsIn(text)
  const links = linksIn(text).filter(link => !overlaps(secrets, link))
  const taken = [...secrets, ...links]
  const free = (range: Range) => !overlaps(taken, range)

  return [
    ...ticketsIn(text)
      .filter(free)
      .map(range => ({ ...range, color: palette.ticket, bold: true })),
    ...links.map(range => ({ ...range, color: palette.link, underline: true })),
    ...pathsIn(text)
      .filter(free)
      .map(range => ({ ...range, color: palette.path, underline: true })),
    ...words
      .flatMap(word => rangesOf(text, patternOf(word)))
      .filter(free)
      .flatMap(({ start, end }) =>
        Array.from({ length: end - start }, (_, letter) => ({
          start: start + letter,
          end: start + letter + 1,
          color: palette.rainbow[letter % palette.rainbow.length] ?? palette.ticket,
          bold: true,
        })),
      ),
    ...secrets.map(range => ({ ...range, ...SECRET })),
  ]
}
