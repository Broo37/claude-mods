export type Shell = 'bash' | 'powershell'

export type Risk = {
  kind: 'delete' | 'discard' | 'force-push' | 'branch-delete' | 'disk' | 'power' | 'sql'
  reason: string
}

const REASONS: Record<Risk['kind'], string> = {
  delete: 'deletes folders and everything in them',
  discard: 'throws away uncommitted work',
  'force-push': 'overwrites or deletes work on the remote',
  'branch-delete': 'deletes a branch even if it is unmerged',
  disk: 'wipes or formats a disk',
  power: 'shuts down or restarts the computer',
  sql: 'drops or empties database tables',
}

// A command line inside a command line is read at most this deep.
const DEPTH = 4

// Folders a build or a tool recreates, so deleting one is routine.
const DISPOSABLE = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.cache',
  '__pycache__',
  '.pytest_cache',
  '.next',
  '.turbo',
  '.parcel-cache',
  'bin',
  'obj',
  'target',
  'testresults',
])

const TEMP = [
  /^\/tmp\/.+/,
  /^\/var\/tmp\/.+/,
  /(^|\/)appdata\/local\/temp\/.+/,
  /^\$env:te?mp\/.+/,
  /^\$\{?tmpdir\}?\/.+/,
  /^\$\{?te?mp\}?\/.+/,
  /^%te?mp%\/.+/,
]

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash'])

const POWERSHELLS = new Set(['powershell', 'pwsh'])

// Words that come before the real command without changing what it does.
const PREFIXES = new Set(['command', 'builtin', 'exec', 'env', 'nohup', 'time', 'then', 'do', 'else', '!'])

// sudo and xargs options that take a value, so the value is not read as the command.
const SUDO_VALUES = new Set(['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-T', '-U'])

const XARGS_VALUES = new Set(['-I', '-n', '-P', '-L', '-d', '-s', '-E'])

const REMOVERS = new Set(['remove-item', 'rm', 'ri', 'del', 'erase', 'rd', 'rmdir'])

// Remove-Item parameters whose value is not something to delete.
const VALUE_PARAMS = [
  'erroraction',
  'warningaction',
  'informationaction',
  'errorvariable',
  'outvariable',
  'pipelinevariable',
  'include',
  'exclude',
  'filter',
  'stream',
  'credential',
]

const PARAM_ALIASES = new Set(['-ea', '-wa', '-ev', '-ov', '-pv'])

const DISK_COMMANDS = new Set(['diskpart', 'format-volume', 'clear-disk', 'initialize-disk', 'remove-partition'])

const POWER_COMMANDS = new Set(['shutdown', 'reboot', 'halt', 'poweroff', 'stop-computer', 'restart-computer'])

// Commands that only read or print, so SQL among their words is text, not a statement.
const READERS = new Set([
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'cat',
  'echo',
  'printf',
  'find',
  'less',
  'more',
  'head',
  'tail',
  'ls',
  'dir',
  'type',
  'findstr',
  'select-string',
  'sls',
  'get-content',
  'gc',
  'git',
])

const SQL = /\b(drop\s+(table|database|schema)|truncate\s+table)\b/i

const HEREDOC = /<<-?[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*(?=\n|$)/g

const HERE_STRING = /@(['"])[ \t]*\n[\s\S]*?\n\1@/g

const SUBSTITUTION = /\$\(([^()]*)\)|`([^`]*)`/g

const riskOfKind = (kind: Risk['kind']): Risk => ({ kind, reason: REASONS[kind] })

// The command's own name: no path, no .exe, no leading backslash, lower case.
const nameOf = (word: string) =>
  (word.replace(/^\\/, '').split(/[\\/]/).at(-1) ?? '').replace(/\.exe$/i, '').toLowerCase()

const isShortFlag = (word: string) => /^-[^-]/.test(word)

// Whether a PowerShell word is the parameter `name`, written whole or shortened.
const isParam = (word: string, name: string) => {
  const given = (word.slice(1).split(':')[0] ?? '').toLowerCase()

  return word.startsWith('-') && given !== '' && name.startsWith(given)
}

const isDisposable = (target: string) => {
  const path = target.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const parts = path.split('/')

  if (path === '' || parts.includes('..')) {
    return false
  }

  if (TEMP.some(folder => folder.test(path))) {
    return true
  }

  const isRelative = !/^(\/|~|[a-z]:|\$|%)/.test(path)

  return isRelative && !/[*?[]/.test(path) && DISPOSABLE.has(parts.at(-1) ?? '')
}

// A recursive delete is routine only when everything it names is disposable.
const deleteOf = (targets: string[]) =>
  targets.length > 0 && targets.every(isDisposable) ? null : riskOfKind('delete')

// Splits a command line into commands, each a list of words with its quotes
// removed. Separators inside quotes are text.
const commandsIn = (line: string, shell: Shell) => {
  const escape = shell === 'bash' ? '\\' : '`'
  const commands: string[][] = []
  let words: string[] = []
  let word = ''
  let isWord = false
  let quote = ''

  const endWord = () => {
    if (isWord) {
      words.push(word)
    }

    word = ''
    isWord = false
  }

  const endCommand = () => {
    endWord()

    if (words.length > 0) {
      commands.push(words)
    }

    words = []
  }

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i] ?? ''

    if (quote !== '') {
      if (char === quote) {
        quote = ''
      } else if (char === escape && quote === '"' && i + 1 < line.length) {
        i += 1
        word += line[i] ?? ''
      } else {
        word += char
      }
    } else if (char === '"' || char === "'") {
      quote = char
      isWord = true
    } else if (char === escape && i + 1 < line.length) {
      i += 1
      word += line[i] ?? ''
      isWord = true
    } else if (/\s/.test(char) && char !== '\n') {
      endWord()
    } else if ('\n;|&()'.includes(char) || ((char === '{' || char === '}') && !isWord)) {
      endCommand()
    } else {
      word += char
      isWord = true
    }
  }

  endCommand()

  return commands
}

// Drops what comes before the real command: assignments, sudo, env, xargs.
const bare = (words: string[]): string[] => {
  const rest = [...words]
  const isAssignment = (value: string | undefined) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(value ?? '')

  while (rest.length > 0) {
    const first = rest[0] ?? ''

    if (isAssignment(first) || PREFIXES.has(first)) {
      rest.shift()
    } else if (first === 'sudo' || first === 'xargs') {
      const values = first === 'sudo' ? SUDO_VALUES : XARGS_VALUES
      rest.shift()

      while ((rest[0] ?? '').startsWith('-')) {
        if (values.has(rest.shift() ?? '')) {
          rest.shift()
        }
      }
    } else {
      break
    }
  }

  return rest
}

const gitRisk = (args: string[]) => {
  let at = 0

  // Git's own options come before the subcommand.
  while ((args[at] ?? '').startsWith('-')) {
    at += ['-C', '-c', '--git-dir', '--work-tree', '--namespace'].includes(args[at] ?? '') ? 2 : 1
  }

  const sub = (args[at] ?? '').toLowerCase()
  const rest = args.slice(at + 1)
  const has = (...flags: string[]) => rest.some(arg => flags.includes(arg))
  const hasShort = (letter: string) => rest.some(arg => isShortFlag(arg) && arg.includes(letter))

  if (sub === 'reset' && has('--hard')) {
    return riskOfKind('discard')
  }

  if (sub === 'clean') {
    const isForced = has('--force') || hasShort('f')
    const isDryRun = has('--dry-run') || hasShort('n')

    return isForced && !isDryRun ? riskOfKind('discard') : null
  }

  if (sub === 'checkout' && (has('.', '--force') || hasShort('f'))) {
    return riskOfKind('discard')
  }

  if (sub === 'restore' && has('.', ':/')) {
    const isStagedOnly = has('--staged', '-S') && !has('--worktree', '-W')

    return isStagedOnly ? null : riskOfKind('discard')
  }

  if (sub === 'stash' && (rest[0] === 'clear' || rest[0] === 'drop')) {
    return riskOfKind('discard')
  }

  if (sub === 'push') {
    const isForced =
      has('--force', '--force-if-includes', '--delete', '--mirror') ||
      hasShort('f') ||
      hasShort('d') ||
      rest.some(arg => arg.startsWith('--force-with-lease') || /^\+/.test(arg) || /^:[^:]/.test(arg))

    return isForced ? riskOfKind('force-push') : null
  }

  if (sub === 'branch' && (has('-D') || (has('--delete', '-d') && has('--force', '-f')))) {
    return riskOfKind('branch-delete')
  }

  return null
}

const bashDelete = (name: string, args: string[]) => {
  if (name === 'find') {
    const runsRm = args.some((arg, i) => ['-exec', '-execdir', '-ok'].includes(arg) && nameOf(args[i + 1] ?? '') === 'rm')

    return args.includes('-delete') || runsRm ? riskOfKind('delete') : null
  }

  if (name !== 'rm') {
    return null
  }

  const end = args.indexOf('--')
  const options = end < 0 ? args : args.slice(0, end)
  const flags = options.filter(arg => arg.startsWith('-') && arg.length > 1)
  const isRecursive = flags.some(flag => flag === '--recursive' || (isShortFlag(flag) && /[rR]/.test(flag)))
  const targets = [...options.filter(arg => !flags.includes(arg)), ...(end < 0 ? [] : args.slice(end + 1))]

  return isRecursive ? deleteOf(targets) : null
}

const powershellDelete = (name: string, args: string[]) => {
  if (!REMOVERS.has(name)) {
    return null
  }

  // `rd /s` and `del /s` are the old command prompt's recursive forms.
  const isSwitch = (arg: string) => /^\/[a-z]$/i.test(arg)
  const isRecursive = args.some(arg => isParam(arg, 'recurse') || /^\/s$/i.test(arg))
  const targets: string[] = []

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? ''

    if (PARAM_ALIASES.has(arg.toLowerCase()) || VALUE_PARAMS.some(param => isParam(arg, param) && arg.length > 2)) {
      i += 1
    } else if (!arg.startsWith('-') && !isSwitch(arg)) {
      targets.push(...arg.split(',').filter(target => target !== ''))
    }
  }

  return isRecursive ? deleteOf(targets) : null
}

const commandRisk = (words: string[], shell: Shell, depth: number): Risk | null => {
  const [first, ...args] = bare(words)

  if (first === undefined) {
    return null
  }

  const name = nameOf(first)

  // A command line handed to another shell is read as that shell would.
  // `-c` may ride with other letters, as in `bash -lc`.
  const script = args.findIndex(arg => isShortFlag(arg) && arg.endsWith('c'))

  if (SHELLS.has(name) && script >= 0) {
    return riskIn(args[script + 1] ?? '', 'bash', depth + 1)
  }

  if (POWERSHELLS.has(name)) {
    const at = args.findIndex(arg => isParam(arg, 'command'))

    return at < 0 ? null : riskIn(args.slice(at + 1).join(' '), 'powershell', depth + 1)
  }

  if (name === 'cmd' && args.some(arg => /^\/[ck]$/i.test(arg))) {
    return riskIn(args.slice(args.findIndex(arg => /^\/[ck]$/i.test(arg)) + 1).join(' '), 'powershell', depth + 1)
  }

  if (name === 'eval') {
    return riskIn(args.join(' '), shell, depth + 1)
  }

  if (name === 'git') {
    return gitRisk(args)
  }

  if (/^dotnet(-| )ef database drop\b/i.test([name, ...args].join(' '))) {
    return riskOfKind('sql')
  }

  const deletion = shell === 'bash' ? bashDelete(name, args) : powershellDelete(name, args)

  if (deletion !== null) {
    return deletion
  }

  const formatsDrive = name === 'format' && args.some(arg => /^[a-z]:$/i.test(arg))
  const writesDevice = name === 'dd' && args.some(arg => arg.startsWith('of=/dev/'))

  if (DISK_COMMANDS.has(name) || name.startsWith('mkfs') || formatsDrive || writesDevice) {
    return riskOfKind('disk')
  }

  return POWER_COMMANDS.has(name) ? riskOfKind('power') : null
}

function riskIn(line: string, shell: Shell, depth: number): Risk | null {
  if (depth > DEPTH) {
    return null
  }

  // A heredoc is text for the command that reads it, unless that command is a shell.
  const scripts: string[] = []
  const withoutHeredocs = line.replace(HEREDOC, (whole: string, _quote: string, _tag: string, body: string, at: number) => {
    const before = line.slice(line.lastIndexOf('\n', at) + 1, at)
    const [reader] = bare(commandsIn(before, shell).at(-1) ?? [])

    if (SHELLS.has(nameOf(reader ?? ''))) {
      scripts.push(body)
    }

    return whole.slice(0, whole.indexOf('\n'))
  })
  const text = shell === 'powershell' ? withoutHeredocs.replace(HERE_STRING, "''") : withoutHeredocs
  const inner = [...text.matchAll(SUBSTITUTION)].map(hit => hit[1] ?? hit[2] ?? '')
  const commands = commandsIn(text, shell)

  for (const words of commands) {
    const risk = commandRisk(words, shell, depth)

    if (risk !== null) {
      return risk
    }
  }

  for (const script of [...scripts, ...inner]) {
    const risk = riskIn(script, shell === 'powershell' && !scripts.includes(script) ? 'powershell' : 'bash', depth + 1)

    if (risk !== null) {
      return risk
    }
  }

  const onlyReads = commands.every(words => READERS.has(nameOf(bare(words)[0] ?? '')))

  return SQL.test(line) && !onlyReads ? riskOfKind('sql') : null
}

// What makes a command worth holding, or null for one that is not.
export const riskOf = (command: string, shell: Shell): Risk | null => riskIn(command, shell, 0)
