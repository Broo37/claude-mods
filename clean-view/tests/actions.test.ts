import { expect, test } from 'claude-code/testing'

import { actionOf, noteOf, whyOf } from '../hooks/actions'

test('says a command Claude ran by the description it gave, or plainly where it gave none', () => {
  expect(actionOf({ tool: 'Bash', command: 'ls -la', description: 'List the files' })).toBe('Ran: List the files')
  expect(actionOf({ tool: 'PowerShell', command: 'Get-ChildItem', description: 'List the files' })).toBe('Ran: List the files')
  expect(actionOf({ tool: 'Bash', command: 'ls -la' })).toBe('Ran a command')
  expect(actionOf({ tool: 'Bash', command: 'ls', description: '   ' })).toBe('Ran a command')
})

test("names a file Claude read, edited or wrote by its name alone, whichever way its path leans", () => {
  expect(actionOf({ tool: 'Read', file_path: 'C:/work/site/index.html' })).toBe('Read index.html')
  expect(actionOf({ tool: 'Read', file_path: 'C:\\work\\site\\index.html' })).toBe('Read index.html')
  expect(actionOf({ tool: 'Edit', file_path: '/home/me/rows.ts' })).toBe('Edited rows.ts')
  expect(actionOf({ tool: 'MultiEdit', file_path: '/home/me/rows.ts' })).toBe('Edited rows.ts')
  expect(actionOf({ tool: 'Write', file_path: '/home/me/notes.md' })).toBe('Wrote notes.md')
  expect(actionOf({ tool: 'NotebookEdit', notebook_path: '/home/me/plot.ipynb' })).toBe('Edited plot.ipynb')
  expect(actionOf({ tool: 'Read' })).toBe('Read a file')
})

test('says what Claude searched for, looked up or asked', () => {
  expect(actionOf({ tool: 'Grep', pattern: 'TODO' })).toBe('Searched for "TODO"')
  expect(actionOf({ tool: 'Glob', pattern: '**/*.ts' })).toBe('Looked for files: **/*.ts')
  expect(actionOf({ tool: 'WebSearch', query: 'bakery opening hours' })).toBe('Searched the web: bakery opening hours')
  expect(actionOf({ tool: 'WebFetch', url: 'https://www.example.com/menu?x=1' })).toBe('Read a web page: www.example.com')
  expect(actionOf({ tool: 'WebFetch', url: 'not a url' })).toBe('Read a web page')
  expect(actionOf({ tool: 'AskUserQuestion', questions: [] })).toBe('Asked you a question')
})

test('says a helper was started by what it was asked to do, and a skill by its own name', () => {
  expect(actionOf({ tool: 'Agent', description: 'Review the code', prompt: 'Review it' })).toBe('Started a helper: Review the code')
  expect(actionOf({ tool: 'Task', description: 'Review the code' })).toBe('Started a helper: Review the code')
  expect(actionOf({ tool: 'Agent', prompt: 'Review it' })).toBe('Started a helper')
  expect(actionOf({ tool: 'Skill', skill: 'superpowers:brainstorming' })).toBe('Used the brainstorming skill')
})

test("says a connected tool's call by its server and its tool, in words", () => {
  expect(actionOf({ tool: 'mcp__docs-search__search_code', query: 'x' })).toBe('Used docs-search: search code')
  expect(actionOf({ tool: 'mcp__claude_ai_Gmail__list_messages' })).toBe('Used claude_ai_Gmail: list messages')
})

test('keeps no action for the checklist itself, the to-do tools or the tool search', () => {
  for (const tool of [
    'mcp__clean-view__plan_steps',
    'mcp__clean-view__report_progress',
    'ToolSearch',
    'TodoWrite',
    'TaskCreate',
    'TaskUpdate',
    'TaskList',
    'TaskGet',
  ]) {
    expect(actionOf({ tool })).toBe(null)
  }
})

test('says any other tool by its name', () => {
  expect(actionOf({ tool: 'Monitor' })).toBe('Used Monitor')
})

test('keeps an action to one line of a sensible length', () => {
  const long = actionOf({ tool: 'Bash', description: `List ${'every '.repeat(40)}file\nand more` }) ?? ''

  expect(long).not.toMatch(/\n/)
  expect(long.length).toBeLessThanOrEqual(100)
  expect(long.endsWith('…')).toBe(true)
})

test('says why a call failed by the first line that says something', () => {
  expect(whyOf('Exit code 1\nnpm ERR! missing script: test\nmore')).toBe('npm ERR! missing script: test')
  expect(whyOf('<tool_use_error>File does not exist.</tool_use_error>')).toBe('File does not exist.')
  expect(whyOf('Error: ENOENT: no such file')).toBe('ENOENT: no such file')
  expect(whyOf('Exit code 2')).toBe('Exit code 2')
  expect(whyOf('')).toBe('')
  expect(whyOf(`${'x'.repeat(200)}`).length).toBeLessThanOrEqual(70)
})

test("keeps Claude's note on a step as one tidy line", () => {
  expect(noteOf('  Found   the band\ncan scroll. ')).toBe('Found the band can scroll.')
  expect(noteOf('   ')).toBe(null)
  expect(noteOf(42)).toBe(null)
  expect(noteOf(undefined)).toBe(null)
  expect((noteOf('word '.repeat(80)) ?? '').length).toBeLessThanOrEqual(160)
})
