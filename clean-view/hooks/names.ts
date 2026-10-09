// The one cleaner every name on the checklist passes through: what a person
// reads there is plain words, never code, a path or a file's name.

// The longest a name may be, its ellipsis included.
const LONGEST = 40

// A job title's most words.
const TITLE_WORDS = 6

// What a name is when nothing is left of it.
const NAMELESS = 'Working on it'

const CODE = /`[^`]*`/g

// A word that is a file's name: it ends in an extension code is kept in.
const FILE =
  /\.(?:[cm]?[jt]sx?|json[c5]?|py|rb|go|rs|java|kt|swift|cs?|h|cpp|hpp|php|html?|s?css|less|vue|svelte|ya?ml|toml|ini|env|lock|mdx?|txt|sh|bash|zsh|ps1|bat|cmd|sql|xml|csv|ipynb)$/i

// What may cling to a word's end without being part of it.
const TRAILING = /[.,;:!?)\]}'"]+$/

const isPlain = (word: string) => !/[\\/]/.test(word) && !FILE.test(word.replace(TRAILING, ''))

const fitted = (name: string) => {
  if (name.length <= LONGEST) {
    return name
  }

  const room = name.slice(0, LONGEST - 1)
  // Where the last whole word ends, unless the word after the cut began there.
  const end = name[LONGEST - 1] === ' ' ? room.length : room.lastIndexOf(' ')

  return `${(end > 0 ? room.slice(0, end) : room).trimEnd()}…`
}

const capitalised = (name: string) => name.charAt(0).toUpperCase() + name.slice(1)

const wordsOf = (raw: string) => raw.replace(CODE, ' ').split(/\s+/).filter(word => word !== '' && isPlain(word))

export const cleanName = (raw: string): string => {
  const name = wordsOf(raw).join(' ')

  return name === '' ? NAMELESS : fitted(capitalised(name))
}

// The title a model was asked for: it may come quoted, labelled, with a full
// stop, or longer than asked.
export const cleanTitle = (raw: string): string => {
  const [line = ''] = raw.trim().split('\n')
  const bare = line
    .replace(/^(?:title|name)\s*:\s*/i, '')
    .replace(/["“”'‘’*]/g, '')
    .replace(/[.!?]+$/, '')

  return cleanName(wordsOf(bare).slice(0, TITLE_WORDS).join(' '))
}
