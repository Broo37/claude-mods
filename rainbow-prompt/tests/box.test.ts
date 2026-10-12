import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, PromptEditInput, PromptEditResult } from 'claude-code'

import { DARK, LIGHT, SECRET } from '../hooks/paint'

type Run = { start: number; end: number; color?: string }

// The stubs beneath the mod: they answer in Claude Code's place, from a world the test may change.
const boot = (on: On) => {
  const world = { theme: 'dark', isConfigDown: false, editorRuns: [] as Run[] }
  const clock = mock.clock(on, { now: 0 })

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('config.list', () => {
    if (world.isConfigDown) {
      return { deny: 'the settings cannot be read' }
    }

    return {
      value: [
      {
        key: 'theme',
        label: 'Theme',
        kind: 'choice',
        value: world.theme,
          provider: { plugin: 'engine', tier: 'core' },
          isLocked: false,
        },
      ],
    }
  })
  // The editor's own answer: the draft with the edit made, and what it paints itself.
  on('prompt.edit', ($, e) => ({
    text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
    cursor: e.start + e.inputText.length,
    ...(world.editorRuns.length > 0 && { decorations: world.editorRuns }),
  }))

  return { world, clock }
}

const start = async ($: Engine, clock: MockClock) => {
  await $.session.start({ cwd: 'C:\\work', surface: 'terminal', isInteractive: true })
  await clock.settle()
}

// The test kit raises an edit as the editor does, though its typings do not name it.
type Editing = { edit(e: PromptEditInput): Promise<PromptEditResult> }

// Types at the end of a draft, as the person does.
const typed = ($: Engine, inputText: string, text = '') =>
  ($.prompt as unknown as Editing).edit({
    origin: { kind: 'composer' },
    text,
    cursor: text.length,
    start: text.length,
    end: text.length,
    inputText,
  })

test('paints the prompt as it stands once the edit is made', async ($, on) => {
  boot(on)

  expect(await typed($, 'UAT2-07', 'fix ')).toEqual({
    text: 'fix UAT2-07',
    cursor: 11,
    decorations: [{ start: 4, end: 11, color: DARK.ticket, bold: true }],
  })
})

test('hands the box on as the editor answered it when there is nothing to paint', async ($, on) => {
  boot(on)

  expect(await typed($, 'hello there')).toEqual({ text: 'hello there', cursor: 11 })
})

test('keeps what the editor paints itself, and lays its own paints over it', async ($, on) => {
  const { world } = boot(on)
  world.editorRuns = [{ start: 0, end: 3, color: 'suggestion' }]

  expect((await typed($, 'UAT2-07', 'fix ')).decorations).toEqual([
    { start: 0, end: 3, color: 'suggestion' },
    { start: 4, end: 11, color: DARK.ticket, bold: true },
  ])
})

test('paints what looks like a key red before it is sent', async ($, on) => {
  boot(on)
  const key = 'sk-ant-api03-9fK2xQ7LmN4pR8sT1vW3yZ5aB6cD'

  expect((await typed($, key, 'use ')).decorations).toEqual([{ start: 4, end: 4 + key.length, ...SECRET }])
})

test('paints the rainbow words the person named', { options: { words: 'deep, wide' } }, async ($, on) => {
  boot(on)

  expect((await typed($, 'go deep')).decorations).toHaveLength(4)
  expect((await typed($, 'go wide')).decorations).toHaveLength(4)
  expect((await typed($, 'ultrathink')).decorations).toBeUndefined()
})

test('paints with the darker colors under a light theme', async ($, on) => {
  const { world, clock } = boot(on)
  world.theme = 'custom:maple-light'
  await start($, clock)

  expect((await typed($, 'UAT2-07')).decorations).toEqual([{ start: 0, end: 7, color: LIGHT.ticket, bold: true }])
})

test('takes up a change of theme with the next turn', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  world.theme = 'light'
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.settle()

  expect((await typed($, 'UAT2-07')).decorations).toEqual([{ start: 0, end: 7, color: LIGHT.ticket, bold: true }])
})

test('paints for a dark theme when the theme cannot be read', async ($, on) => {
  const { world, clock } = boot(on)
  world.theme = 'light'
  world.isConfigDown = true
  await start($, clock)

  expect((await typed($, 'UAT2-07')).decorations).toEqual([{ start: 0, end: 7, color: DARK.ticket, bold: true }])
})
