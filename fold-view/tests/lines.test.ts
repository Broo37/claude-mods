import { expect, test } from 'claude-code/testing'

import { durationOf, lineOf, wordsOf } from '../hooks/lines'
import type { Call, Run } from '../hooks/lines'

const textOf = (runs: Run[]) => runs.map(run => run.text).join('')

const ended = (tool: string, input: unknown = {}): Call => ({ tool, input, isRunning: false, isErrored: false, isInterrupted: false })

test('says a command Claude ran by the description it gave, or plainly where it gave none', () => {
  expect(wordsOf('Bash', { command: 'ls -la', description: 'List the files' })).toBe('Ran: List the files')
  expect(wordsOf('PowerShell', { command: 'Get-ChildItem', description: 'List the files' })).toBe('Ran: List the files')
  expect(wordsOf('Bash', { command: 'ls -la' })).toBe('Ran a command')
})

test('names a file Claude read, edited or wrote by its name alone, whichever way its path leans', () => {
  expect(wordsOf('Read', { file_path: 'C:\\work\\site\\index.html' })).toBe('Read index.html')
  expect(wordsOf('Edit', { file_path: '/home/me/rows.ts' })).toBe('Edited rows.ts')
  expect(wordsOf('Write', { file_path: '/home/me/notes.md' })).toBe('Wrote notes.md')
  expect(wordsOf('NotebookEdit', { notebook_path: '/home/me/plot.ipynb' })).toBe('Edited plot.ipynb')
  expect(wordsOf('Read', {})).toBe('Read a file')
})

test('says what Claude searched for, looked up, asked or started', () => {
  expect(wordsOf('Grep', { pattern: 'TODO' })).toBe('Searched for "TODO"')
  expect(wordsOf('Glob', { pattern: '**/*.ts' })).toBe('Looked for files: **/*.ts')
  expect(wordsOf('WebSearch', { query: 'bakery opening hours' })).toBe('Searched the web: bakery opening hours')
  expect(wordsOf('WebFetch', { url: 'https://www.example.com/menu?x=1' })).toBe('Read a web page: www.example.com')
  expect(wordsOf('AskUserQuestion', { questions: [] })).toBe('Asked you a question')
  expect(wordsOf('Agent', { description: 'Review the code' })).toBe('Started a helper: Review the code')
  expect(wordsOf('Skill', { skill: 'superpowers:brainstorming' })).toBe('Used the brainstorming skill')
})

test('gives the making of a plan its words too: each call is a row', () => {
  expect(wordsOf('mcp__clean-view__plan_steps', { steps: [] })).toBe('Laid out the steps')
  expect(wordsOf('mcp__clean-view__report_progress', { task: 'x', percent: 100 })).toBe('Reported progress')
  expect(wordsOf('ToolSearch', { query: 'select:Monitor' })).toBe('Loaded tools')
  expect(wordsOf('TodoWrite', { todos: [] })).toBe('Updated the to-do list')
  expect(wordsOf('TaskCreate', { subject: 'Write the menu' })).toBe('Added a task: Write the menu')
  expect(wordsOf('TaskUpdate', { taskId: '1' })).toBe('Updated a task')
  expect(wordsOf('TaskList', {})).toBe('Checked the tasks')
})

test("says a connected tool's call by its server and its tool, and any other tool by its name", () => {
  expect(wordsOf('mcp__docs-search__search_code', { query: 'x' })).toBe('Used docs-search: search code')
  expect(wordsOf('Monitor', {})).toBe('Used Monitor')
  expect(wordsOf('Bash', null)).toBe('Ran a command')
})

test('says how long something took in a few plain units', () => {
  expect(durationOf(0)).toBe('0s')
  expect(durationOf(12_400)).toBe('12s')
  expect(durationOf(72_000)).toBe('1m 12s')
  expect(durationOf(3_840_000)).toBe('1h 4m')
})

test('draws a folded row as its arrow, a check and its words, and an opened one with the arrow down', () => {
  const call = ended('Bash', { description: 'List the files' })

  expect(textOf(lineOf(call, 400, false))).toBe('▸ ✓ Ran: List the files')
  expect(textOf(lineOf(call, 400, true))).toBe('▾ ✓ Ran: List the files')
  expect(lineOf(call, 400, false)[0]).toEqual({ text: '▸ ', color: 'claude' })
  expect(lineOf(call, 400, false)[1]).toEqual({ text: '✓ ', color: 'success' })
})

test('says how long a call took from three seconds, and nothing where that is not known', () => {
  const call = ended('Bash', { description: 'Run the tests' })

  expect(textOf(lineOf(call, 2_999, false))).toBe('▸ ✓ Ran: Run the tests')
  expect(textOf(lineOf(call, 3_000, false))).toBe('▸ ✓ Ran: Run the tests · 3s')
  expect(textOf(lineOf(call, 72_000, false))).toBe('▸ ✓ Ran: Run the tests · 1m 12s')
  expect(textOf(lineOf(call, null, false))).toBe('▸ ✓ Ran: Run the tests')
})

test('marks a call that runs, one that failed and one that was stopped', () => {
  const call = ended('Bash', { description: 'Run the tests' })

  expect(textOf(lineOf({ ...call, isRunning: true }, null, false))).toBe('▸ ◌ Ran: Run the tests · running')
  expect(textOf(lineOf({ ...call, isErrored: true }, 4_000, false))).toBe('▸ ✗ Ran: Run the tests · failed · 4s')
  expect(lineOf({ ...call, isErrored: true }, null, false)).toContainEqual({ text: ' · failed', color: 'error' })
  // An abort marks the call errored as well.
  expect(textOf(lineOf({ ...call, isErrored: true, isInterrupted: true }, null, false))).toBe('▸ ■ Ran: Run the tests · stopped')
})

test('keeps the words to one line of a sensible length', () => {
  const line = textOf(lineOf(ended('Bash', { description: `List ${'every '.repeat(40)}file\nand more` }), null, false))

  expect(line).not.toMatch(/\n/)
  expect(line.length).toBeLessThanOrEqual(104)
  expect(line.endsWith('…')).toBe(true)
})
