// The emoji before each step of the checklist: one Claude picks from a set,
// or one guessed from the step's name where it picked none.

// The set, each emoji with what it stands for, as Claude is shown it, and the
// words a name is guessed from: the verb a step starts with, and the nouns
// that say more where that verb says little. Each emoji is one code point
// beyond the first plane that draws as a picture by default: two columns
// wide in every terminal, and two in a string's length, so rows line up.
export const ICONS = [
  {
    icon: '🔍',
    means: 'look into',
    verbs: ['look', 'check', 'find', 'search', 'scan', 'review', 'inspect', 'explore', 'investigate', 'verify', 'audit', 'compare', 'trace', 'locate'],
    nouns: [],
  },
  { icon: '📖', means: 'read', verbs: ['read', 'study', 'open', 'load', 'learn', 'skim'], nouns: [] },
  { icon: '🤔', means: 'think it over', verbs: ['think', 'understand', 'decide', 'figure', 'consider', 'choose', 'pick', 'weigh'], nouns: [] },
  { icon: '📋', means: 'plan', verbs: ['plan', 'list', 'outline', 'organize', 'organise', 'sort', 'gather', 'collect', 'prepare'], nouns: ['plan'] },
  { icon: '🔨', means: 'build', verbs: ['build', 'make', 'create', 'add', 'implement', 'write', 'code', 'generate'], nouns: [] },
  {
    icon: '🔧',
    means: 'change',
    verbs: ['change', 'edit', 'update', 'set', 'configure', 'adjust', 'tweak', 'move', 'rename', 'wire', 'connect', 'replace', 'convert', 'migrate', 'upgrade'],
    nouns: ['settings', 'config'],
  },
  { icon: '🐛', means: 'fix', verbs: ['fix', 'debug', 'repair', 'patch', 'solve', 'resolve'], nouns: ['bug', 'bugs', 'error', 'errors', 'crash'] },
  { icon: '🧪', means: 'test', verbs: ['test', 'try', 'validate'], nouns: ['test', 'tests'] },
  { icon: '🎨', means: 'design or polish', verbs: ['design', 'style', 'polish', 'draw', 'color', 'colour', 'theme'], nouns: ['colors', 'colours', 'theme', 'layout'] },
  { icon: '🧹', means: 'clean up', verbs: ['clean', 'remove', 'delete', 'tidy', 'simplify', 'refactor', 'drop', 'prune', 'trim'], nouns: [] },
  {
    icon: '📝',
    means: 'write notes',
    verbs: ['note', 'document', 'summarize', 'summarise', 'describe', 'draft', 'record', 'log', 'report'],
    nouns: ['note', 'notes', 'docs', 'readme', 'changelog', 'summary', 'message'],
  },
  { icon: '💾', means: 'save', verbs: ['save', 'commit', 'back', 'store', 'keep', 'stash'], nouns: ['backup'] },
  { icon: '🚀', means: 'ship', verbs: ['push', 'ship', 'deploy', 'publish', 'release', 'launch', 'send', 'upload'], nouns: ['github', 'release'] },
  { icon: '📦', means: 'install', verbs: ['install', 'package', 'bundle'], nouns: ['dependencies', 'dependency', 'packages', 'package'] },
  { icon: '🌐', means: 'go online', verbs: ['fetch', 'download', 'browse', 'google'], nouns: ['web', 'website', 'site', 'internet', 'online'] },
  { icon: '📊', means: 'measure', verbs: ['measure', 'count', 'analyze', 'analyse', 'chart', 'benchmark', 'profile'], nouns: ['chart', 'stats', 'numbers'] },
  {
    icon: '🔒',
    means: 'keep safe',
    verbs: ['secure', 'protect', 'lock', 'encrypt', 'guard'],
    nouns: ['secret', 'secrets', 'password', 'passwords', 'permissions', 'security', 'private'],
  },
  { icon: '💬', means: 'ask or explain', verbs: ['ask', 'answer', 'explain', 'tell', 'reply', 'discuss', 'confirm', 'teach', 'show', 'say'], nouns: ['question', 'questions'] },
  { icon: '👀', means: 'watch', verbs: ['watch', 'wait', 'monitor', 'observe', 'follow'], nouns: [] },
  { icon: '🏃', means: 'run', verbs: ['run', 'start', 'execute'], nouns: [] },
  { icon: '🔄', means: 'redo', verbs: ['retry', 'repeat', 'redo', 'rerun', 'refresh', 'restart', 'reload', 'sync'], nouns: [] },
  { icon: '🎉', means: 'wrap up', verbs: ['finish', 'wrap', 'finalize', 'finalise', 'complete', 'celebrate'], nouns: [] },
] as const

// The mark of a step nothing fits.
export const FALLBACK = '🔹'

// Verbs that say little of a step by themselves: the nouns after them say more.
const VAGUE = new Set(['add', 'make', 'create', 'write', 'update', 'change', 'edit', 'set', 'run', 'start', 'try', 'keep', 'show', 'prepare'])

const lookup = (pick: (entry: (typeof ICONS)[number]) => readonly string[]) =>
  new Map(ICONS.flatMap(entry => pick(entry).map(word => [word, entry.icon] as const)))

const BY_VERB = lookup(entry => entry.verbs)
const BY_NOUN = lookup(entry => entry.nouns)

const SET: ReadonlySet<string> = new Set(ICONS.map(entry => entry.icon))

// The emoji for a name: by its verb, unless that verb is vague and a noun
// after it says more; else by any verb later in it; else the plain mark.
export const iconFor = (name: string): string => {
  const [first = '', ...rest] = name.toLowerCase().split(/[^a-z]+/).filter(word => word !== '')
  const verb = BY_VERB.get(first)

  if (verb !== undefined && !VAGUE.has(first)) {
    return verb
  }

  const noun = rest.map(word => BY_NOUN.get(word)).find(icon => icon !== undefined)

  return noun ?? verb ?? rest.map(word => BY_VERB.get(word)).find(icon => icon !== undefined) ?? FALLBACK
}

// The emoji a step shows: Claude's pick, else the guess.
export const iconOf = (task: { name: string; icon?: string }): string => task.icon ?? iconFor(task.name)

// What a name may start with that is an emoji or a part of one: a picture
// beyond the first plane, a symbol, a variation selector, a joiner, a keycap.
const LEADING = /^\s*(?:[\uD83C-\uD83E][\uDC00-\uDFFF]|[←-⯿️‍⃣])+\s*/

// The emoji a raw step name starts with, where it is one of the set, and the
// name without it. Any other emoji there is dropped all the same: a step's
// emoji is the set's or a guess, never one whose width a terminal may doubt.
export const pickedIcon = (raw: string): { icon: string | null; rest: string } => {
  const [lead = ''] = LEADING.exec(raw) ?? []
  const icon = lead.replace(/️/g, '').trim()

  return { icon: SET.has(icon) ? icon : null, rest: raw.slice(lead.length) }
}

// The set as Claude is shown it: "🔍 look into, 📖 read, …".
export const SET_WORDS = ICONS.map(({ icon, means }) => `${icon} ${means}`).join(', ')
