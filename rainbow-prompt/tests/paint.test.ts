import { expect, test } from 'claude-code/testing'

import { DARK, LIGHT, LIMIT, SECRET, decorationsOf, paletteFor, wordsIn } from '../hooks/paint'

const WORDS = ['ultrathink']

// What a text is painted as: each painted stretch with the name of its paint,
// in the order the paints are laid on.
const marks = (text: string, words: readonly string[] = WORDS) =>
  decorationsOf(text, words, DARK).map(run => {
    const part = text.slice(run.start, run.end)

    if (run.backgroundColor === SECRET.backgroundColor) {
      return [part, 'secret']
    }

    // A link and a path are underlined; a ticket and a rainbow letter are bold,
    // and a rainbow letter is painted alone.
    if (run.underline === true) {
      return [part, run.color === DARK.link ? 'link' : 'path']
    }

    return part.length > 1 ? [part, 'ticket'] : [part, `rainbow ${DARK.rainbow.indexOf(run.color ?? '')}`]
  })

// A key nobody was ever given, long enough to look like one.
const FAKE_KEY = 'sk-ant-api03-9fK2xQ7LmN4pR8sT1vW3yZ5aB6cD'

test('paints nothing in a text that holds none of what it looks for', () => {
  expect(decorationsOf('please make the tests pass', WORDS, DARK)).toEqual([])
  expect(decorationsOf('', WORDS, DARK)).toEqual([])
})

test('paints a ticket id bold in the ticket color', () => {
  expect(decorationsOf('fix UAT2-07 now', WORDS, DARK)).toEqual([{ start: 4, end: 11, color: DARK.ticket, bold: true }])
  expect(marks('UAT2-07 and JIRA-123')).toEqual([
    ['UAT2-07', 'ticket'],
    ['JIRA-123', 'ticket'],
  ])
})

test('takes no ordinary hyphenated word for a ticket', () => {
  expect(marks('utf-8, gpt-4, top-10, A-1 and x-2')).toEqual([])
})

test('takes no name of a standard for a ticket, though it is shaped like one', () => {
  expect(marks('UTF-8, SHA-256, GPT-4, ISO-8601, GMT-5 and RFC-822')).toEqual([])
})

test('paints a path underlined in the path color', () => {
  expect(decorationsOf('open src/api/orders.ts', WORDS, DARK)).toEqual([
    { start: 5, end: 22, color: DARK.path, underline: true },
  ])
})

test('knows a path by its root, by its file ending or by its depth', () => {
  expect(marks('C:\\Users\\admin\\mods')).toEqual([['C:\\Users\\admin\\mods', 'path']])
  expect(marks('run ./build.sh in ../lib or ~/notes or /etc/hosts')).toEqual([
    ['./build.sh', 'path'],
    ['../lib', 'path'],
    ['~/notes', 'path'],
    ['/etc/hosts', 'path'],
  ])
  expect(marks('see docs/setup.md')).toEqual([['docs/setup.md', 'path']])
  expect(marks('under src/api/orders')).toEqual([['src/api/orders', 'path']])
})

test('paints a file named without its folder when its ending is a known one', () => {
  expect(marks('edit README.md and package.json')).toEqual([
    ['README.md', 'path'],
    ['package.json', 'path'],
  ])
})

test('takes no slash between two words, date, version or site name for a path', () => {
  expect(marks('yes/no and/or 10/08/2026 v2.1.293 e.g. example.com 3.14')).toEqual([])
})

test('paints a link whole, as a link and not as the path inside it', () => {
  expect(marks('see https://github.com/Piebald-AI/tweakcc now')).toEqual([['https://github.com/Piebald-AI/tweakcc', 'link']])
  expect(decorationsOf('http://localhost:3000/a', WORDS, DARK)).toEqual([
    { start: 0, end: 23, color: DARK.link, underline: true },
  ])
})

test('leaves the mark that ends a sentence out of a link', () => {
  expect(marks('read https://example.com/docs/page.html.')).toEqual([['https://example.com/docs/page.html', 'link']])
  expect(marks('(https://example.com/a)')).toEqual([['https://example.com/a', 'link']])
})

test('paints each letter of a rainbow word in the next color of the rainbow, bold', () => {
  const runs = decorationsOf('now ultrathink', WORDS, DARK)

  expect(runs).toHaveLength(10)
  expect(runs[0]).toEqual({ start: 4, end: 5, color: DARK.rainbow[0], bold: true })
  expect(runs[6]).toEqual({ start: 10, end: 11, color: DARK.rainbow[6], bold: true })
  // After the seventh color the rainbow starts over.
  expect(runs[7]).toEqual({ start: 11, end: 12, color: DARK.rainbow[0], bold: true })
})

test('finds a rainbow word in any case, but not inside a longer word', () => {
  expect(marks('ULTRATHINK')).toHaveLength(10)
  expect(marks('ultrathinking and megaultrathink')).toEqual([])
})

test('paints the words the person named, a word of several too', () => {
  expect(marks('go deep now', ['deep'])).toEqual([
    ['d', 'rainbow 0'],
    ['e', 'rainbow 1'],
    ['e', 'rainbow 2'],
    ['p', 'rainbow 3'],
  ])
  expect(marks('ultrathink', ['deep'])).toEqual([])
  expect(marks('a.b', ['a.b'])).toHaveLength(3)
  expect(marks('axb', ['a.b'])).toEqual([])
})

test('paints what looks like a key white on red, bold', () => {
  expect(decorationsOf(`use ${FAKE_KEY}`, WORDS, DARK)).toEqual([{ start: 4, end: 4 + FAKE_KEY.length, ...SECRET }])
  expect(SECRET).toEqual({ color: '#ffffff', backgroundColor: '#d20f39', bold: true })
})

test('knows the keys of the usual services by their shape', () => {
  const github = `ghp_${'a1B2'.repeat(9)}`
  const fine = `github_pat_${'a1B2_'.repeat(8)}`
  const slack = 'xoxb-123456789012-abcdefghijkl'
  const jwt = `eyJ${'a'.repeat(12)}.eyJ${'b'.repeat(12)}.${'c'.repeat(12)}`

  expect(marks(`a ${github} b`)).toEqual([[github, 'secret']])
  expect(marks(fine)).toEqual([[fine, 'secret']])
  expect(marks('AKIAIOSFODNN7EXAMPLE')).toEqual([['AKIAIOSFODNN7EXAMPLE', 'secret']])
  expect(marks(slack)).toEqual([[slack, 'secret']])
  expect(marks(jwt)).toEqual([[jwt, 'secret']])
  expect(marks('-----BEGIN RSA PRIVATE KEY-----')).toEqual([['-----BEGIN RSA PRIVATE KEY-----', 'secret']])
})

test('paints what is given as a password or a token, the value alone', () => {
  expect(marks('password = hunter2secret ok')).toEqual([['hunter2secret', 'secret']])
  expect(marks('API_KEY: abc123def456')).toEqual([['abc123def456', 'secret']])
  expect(marks('the token is short')).toEqual([])
})

test('takes no short or ordinary word for a key', () => {
  expect(marks('sk-short and ghp_abc and the AKIA team')).toEqual([])
})

test('paints a secret as a secret only, whatever else it looks like', () => {
  expect(marks('token=src/api/UAT2-07/keys.pem')).toEqual([['src/api/UAT2-07/keys.pem', 'secret']])
})

test('lays the paints on in one order: tickets, links, paths, rainbow, secrets', () => {
  expect(marks(`${FAKE_KEY} ultrathink a/b/c https://x.dev/y UAT2-07`).map(([, paint]) => paint)).toEqual([
    'ticket',
    'link',
    'path',
    ...Array.from({ length: 10 }, (_, letter) => `rainbow ${letter % 7}`),
    'secret',
  ])
})

test('counts in the units a prompt box counts in, so that a character of two is two', () => {
  expect(decorationsOf('😍 UAT2-07', WORDS, DARK)).toEqual([{ start: 3, end: 10, color: DARK.ticket, bold: true }])
})

test('paints nothing in a text too long to look through at every key', () => {
  const long = `UAT2-07 ${'word '.repeat(LIMIT / 5)}`

  expect(long.length).toBeGreaterThan(LIMIT)
  expect(decorationsOf(long, WORDS, DARK)).toEqual([])
})

test('takes the darker paints for a light theme', () => {
  expect(paletteFor('light')).toBe(LIGHT)
  expect(paletteFor('custom:maple-light')).toBe(LIGHT)
  expect(paletteFor('light-daltonized')).toBe(LIGHT)
  expect(paletteFor('dark')).toBe(DARK)
  expect(paletteFor('custom:maple')).toBe(DARK)
  expect(paletteFor(undefined)).toBe(DARK)
  expect(LIGHT.rainbow).toHaveLength(7)
  expect(DARK.rainbow).toHaveLength(7)
})

test('reads the rainbow words from what the person wrote, commas between them', () => {
  expect(wordsIn('ultrathink, deep ,  megathink')).toEqual(['ultrathink', 'deep', 'megathink'])
  expect(wordsIn('')).toEqual([])
  expect(wordsIn(undefined)).toEqual(['ultrathink'])
  expect(wordsIn(' , ')).toEqual([])
})
