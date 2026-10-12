import { expect, test } from 'claude-code/testing'

import { colorOf, labelOf, linesOf, nameOf } from '../hooks/chart'
import type { Call, Run, Turn } from '../hooks/chart'

const call = (tool: string, label: string, start: number, end: number | null, isError = false): Call => ({
  id: `${tool}-${start}`,
  tool,
  label,
  start,
  end,
  isError,
})

// A turn of ten seconds: tests, a read, and a push that failed.
const TURN: Turn = {
  lasted: 10_000,
  calls: [call('Bash', 'npm test', 0, 4200), call('Read', 'orders.ts', 5000, 5100), call('Bash', 'git push', 8000, 9300, true)],
}

const textOf = (line: readonly Run[] = []) => line.map(run => run.text).join('')

const textsOf = (lines: readonly (readonly Run[])[]) => lines.map(textOf)

test('names a tool in six letters at most', () => {
  expect(nameOf('Bash')).toBe('Bash')
  expect(nameOf('PowerShell')).toBe('PwSh')
  expect(nameOf('WebFetch')).toBe('Fetch')
  expect(nameOf('WebSearch')).toBe('Search')
  expect(nameOf('NotebookEdit')).toBe('Notebo')
  expect(nameOf('mcp__github__create_issue')).toBe('MCP')
})

test('labels a call with what it was about', () => {
  expect(labelOf('Bash', { command: 'npm   test\n  --watch' })).toBe('npm test --watch')
  expect(labelOf('PowerShell', { command: 'Get-ChildItem' })).toBe('Get-ChildItem')
  expect(labelOf('Read', { file_path: 'C:\\work\\src\\api\\orders.ts' })).toBe('orders.ts')
  expect(labelOf('Edit', { file_path: 'src/api/orders.ts' })).toBe('orders.ts')
  expect(labelOf('Grep', { pattern: 'TODO' })).toBe('TODO')
  expect(labelOf('Agent', { subagent_type: 'Explore', description: 'find the routes' })).toBe('Explore')
  expect(labelOf('Agent', { description: 'find the routes' })).toBe('find the routes')
  expect(labelOf('WebFetch', { url: 'https://github.com/Piebald-AI/tweakcc' })).toBe('github.com')
  expect(labelOf('WebSearch', { query: 'claude code mods' })).toBe('claude code mods')
  expect(labelOf('mcp__github__create_issue', {})).toBe('github:create_issue')
})

test('names a question put to the person and labels it with what it was about', () => {
  const asked = { questions: [{ question: '`git stash drop` throws away uncommitted work. Run it?', header: 'Risky' }] }

  expect(nameOf('AskUserQuestion')).toBe('Ask')
  expect(labelOf('AskUserQuestion', asked)).toBe('Risky')
  expect(labelOf('AskUserQuestion', { questions: [{ question: 'Which one?' }] })).toBe('Which one?')
  expect(labelOf('AskUserQuestion', {})).toBe('')
})

test('charts the wait for an answer as a bar, but counts it neither as a tool nor as a failure', () => {
  const turn: Turn = {
    lasted: 10_000,
    calls: [call('Bash', 'npm test', 0, 2000), call('AskUserQuestion', 'Risky', 3000, 6000, true), call('Bash', 'git stash drop', 6000, 6200)],
  }
  const texts = textsOf(linesOf(turn, 0, 64, 20))

  // Seen on a real turn: a held command's question made three calls read "4 tools".
  expect(texts[0]).toBe('Turn 10s · 2 tools')
  expect(texts[3]?.startsWith('Ask    Risky')).toBe(true)
  expect(texts).toHaveLength(5)
})

test('labels a call it knows nothing about with nothing', () => {
  expect(labelOf('Mystery', { anything: 1 })).toBe('')
  expect(labelOf('Read', {})).toBe('')
  expect(labelOf('WebFetch', { url: 'not a url' })).toBe('not a url')
})

test('colors a tool by its kind', () => {
  expect(colorOf('Bash')).toBe('claude')
  expect(colorOf('PowerShell')).toBe('claude')
  expect(colorOf('Read')).toBe('suggestion')
  expect(colorOf('Edit')).toBe('success')
  expect(colorOf('Write')).toBe('success')
  expect(colorOf('Grep')).toBe('planMode')
  expect(colorOf('Glob')).toBe('planMode')
  expect(colorOf('Agent')).toBe('permission')
  expect(colorOf('WebSearch')).toBe('warning')
  expect(colorOf('mcp__github__create_issue')).toBe('bashBorder')
  expect(colorOf('Mystery')).toBe('inactive')
})

test('says so when no turn has run', () => {
  expect(textsOf(linesOf(null, 0, 64, 20))).toEqual(['No turn yet. Tool calls show here as Claude works.'])
})

test('charts a turn: a heading, the span of time, and a bar a call, where and as long as it ran', () => {
  expect(textsOf(linesOf(TURN, 0, 64, 20))).toEqual([
    'Turn 10s · 3 tools · 1 failed',
    `${' '.repeat(26)}0s${'─'.repeat(25)}10s`,
    `Bash   npm test${' '.repeat(11)}${'█'.repeat(13)}${' '.repeat(18)}   4.2s`,
    `Read   orders.ts${' '.repeat(10)}${' '.repeat(15)}█${' '.repeat(15)}   0.1s`,
    `Bash   git push${' '.repeat(11)}${' '.repeat(24)}${'█'.repeat(4)}${' '.repeat(3)} ✗ 1.3s`,
  ])
})

test('makes every row of a call exactly as wide as the pane', () => {
  for (const columns of [46, 64, 90]) {
    expect(linesOf(TURN, 0, columns, 20).slice(2).map(line => textOf(line).length)).toEqual([columns, columns, columns])
  }
})

test('stacks a call in two lines in a narrow pane: what it was, then its bar the whole width', () => {
  // A dock that already holds another pane keeps its width, about 34 columns of chart.
  expect(textsOf(linesOf(TURN, 0, 34, 20))).toEqual([
    'Turn 10s · 3 tools · 1 failed',
    `0s${'─'.repeat(21)}10s`,
    'Bash   npm test',
    `${'█'.repeat(11)}${' '.repeat(16)}   4.2s`,
    'Read   orders.ts',
    `${' '.repeat(13)}█${' '.repeat(13)}   0.1s`,
    'Bash   git push',
    `${' '.repeat(20)}${'█'.repeat(5)}${' '.repeat(2)} ✗ 1.3s`,
  ])
})

test('draws the name of a stacked call in the color of its tool and what it was about dim', () => {
  const lines = linesOf(TURN, 0, 34, 20)

  expect(lines[2]).toEqual([
    { text: 'Bash   ', color: 'claude' },
    { text: 'npm test', isDim: true },
  ])
  expect(lines[3]?.map(run => textOf([run]).length).reduce((sum, length) => sum + length, 0)).toBe(34)
  expect(lines[7]?.find(run => run.text.includes('█'))?.color).toBe('error')
})

test('cuts what a stacked call was about to the width of the pane', () => {
  const turn: Turn = { lasted: 1000, calls: [call('Bash', 'git log --oneline --graph --decorate --all', 0, 1000)] }

  expect(textOf(linesOf(turn, 0, 34, 20)[2])).toBe('Bash   git log --oneline --graph …')
  expect(textOf(linesOf(turn, 0, 34, 20)[2]).length).toBe(34)
})

test('names a stacked call alone when it has nothing to say what it was about', () => {
  const turn: Turn = { lasted: 1000, calls: [call('Mystery', '', 0, 1000)] }

  expect(linesOf(turn, 0, 34, 20)[2]).toEqual([{ text: 'Myster ', color: 'inactive' }])
})

test('counts two rows a call when it shows the newest of too many stacked calls', () => {
  const turn: Turn = {
    lasted: 5000,
    calls: Array.from({ length: 5 }, (_, at) => call('Read', `file${at}.ts`, at * 1000, at * 1000 + 500)),
  }
  const texts = textsOf(linesOf(turn, 0, 34, 7))

  // Seven rows: the heading, the span, a count, and the last two calls of two rows each.
  expect(texts).toHaveLength(7)
  expect(texts[2]).toBe('+3 earlier')
  expect(texts[3]).toBe('Read   file3.ts')
  expect(texts[5]).toBe('Read   file4.ts')
})

test('draws a bar in the color of its tool, and a failed one red with a cross', () => {
  const [, , tests, , push] = linesOf(TURN, 0, 64, 20)

  expect(tests?.find(run => run.text.includes('█'))?.color).toBe('claude')
  expect(tests?.[0]).toEqual({ text: 'Bash   ', color: 'claude' })
  expect(tests?.at(-1)).toEqual({ text: '   4.2s', isDim: true })
  expect(push?.find(run => run.text.includes('█'))?.color).toBe('error')
  expect(push?.at(-1)).toEqual({ text: ' ✗ 1.3s', color: 'error' })
})

test('draws the heading with the time bold and a failure red', () => {
  expect(linesOf(TURN, 0, 64, 20)[0]).toEqual([
    { text: 'Turn ', isDim: true },
    { text: '10s', isBold: true },
    { text: ' · 3 tools', isDim: true },
    { text: ' · 1 failed', color: 'error' },
  ])
})

test('gives the shortest call a bar of one cell, and never draws past the chart', () => {
  const turn: Turn = { lasted: 600_000, calls: [call('Read', 'a.ts', 0, 10), call('Read', 'b.ts', 599_990, 600_000)] }
  const rows = textsOf(linesOf(turn, 0, 64, 20)).slice(2)

  expect(rows[0]).toBe(`Read   a.ts${' '.repeat(15)}█${' '.repeat(30)}   0.0s`)
  expect(rows[1]).toBe(`Read   b.ts${' '.repeat(15)}${' '.repeat(29)}█ ${'   0.0s'}`)
})

test('grows the bar of a call that still runs up to now, and says so', () => {
  const turn: Turn = { lasted: null, calls: [call('Bash', 'npm test', 2000, null)] }
  const lines = linesOf(turn, 6000, 64, 20)

  // Two of six seconds in, it began a third of the way along and reaches the end.
  expect(textsOf(lines)).toEqual([
    'Turn 6s… · 1 tool',
    `${' '.repeat(26)}0s${'─'.repeat(26)}6s`,
    `Bash   npm test${' '.repeat(11)}${' '.repeat(10)}${'█'.repeat(20)}  ${' 4.0s…'}`,
  ])
})

test('shortens the labels in a pane of middling width', () => {
  expect(textOf(linesOf(TURN, 0, 46, 20)[2])).toBe(`Bash   npm test   ${'█'.repeat(9)}${' '.repeat(12)}   4.2s`)
})

test('cuts a label that is too long, with a mark that it was cut', () => {
  const turn: Turn = { lasted: 1000, calls: [call('Bash', 'git log --oneline --graph --decorate', 0, 1000)] }

  expect(textOf(linesOf(turn, 0, 64, 20)[2]).slice(7, 26)).toBe('git log --oneline… ')
})

test('shows the newest calls and counts the earlier ones when there are too many', () => {
  const turn: Turn = {
    lasted: 5000,
    calls: Array.from({ length: 5 }, (_, at) => call('Read', `file${at}.ts`, at * 1000, at * 1000 + 500)),
  }
  const texts = textsOf(linesOf(turn, 0, 64, 5))

  // Five rows: the heading, the span, a count, and the last two calls.
  expect(texts).toHaveLength(5)
  expect(texts[2]).toBe('+3 earlier')
  expect(texts[3]?.startsWith('Read   file3.ts')).toBe(true)
  expect(texts[4]?.startsWith('Read   file4.ts')).toBe(true)
})

test('charts a turn without calls as its heading alone', () => {
  expect(textsOf(linesOf({ lasted: 3000, calls: [] }, 0, 64, 20))).toEqual(['Turn 3s · no tools'])
})
