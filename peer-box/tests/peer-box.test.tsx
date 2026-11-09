import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

type Drawn = { type: string; props?: Record<string, unknown>; children?: unknown[] }
type Kind = 'composer' | 'peer' | 'peer-send-message' | 'task-notification'

// The stub beneath the mod: it draws the row in Claude Code's place.
const boot = (on: On) => {
  on('ui.render', { component: 'UserMessage' }, ($, e) => ({ type: 'Text', props: {}, children: [`> ${e.props.text}`] }))
  on('ui.render', { component: 'ToolUse' }, ($, e) => ({ type: 'Text', props: {}, children: [`Ran ${e.props.tool}`] }))
  on('ui.render', { component: 'ToolGroup' }, () => ({ type: 'Text', props: {}, children: ['Read 2 files'] }))
}

const toolRow = async ($: Engine) => {
  const ui = await $.ui.mount({
    plugin: 'peer-box',
    component: 'ToolUse',
    requestId: 'tu1',
    props: { tool_use_id: 'tu1', tool: 'Bash', input: { command: 'ls' }, isRunning: false, isErrored: false, isInterrupted: false },
    surface: 'terminal',
  })
  const tree = (await ui.drawn()) as Drawn
  await ui.unmount()

  return tree
}

const groupRow = async ($: Engine, isExpanded: boolean) => {
  const ui = await $.ui.mount({
    plugin: 'peer-box',
    component: 'ToolGroup',
    requestId: `g-${isExpanded}`,
    props: { calls: [], isActive: false, isExpanded },
    surface: 'terminal',
  })
  const tree = (await ui.drawn()) as Drawn
  await ui.unmount()

  return tree
}

test('frames a tool call row in the quiet comment color, keeping the row inside', async ($, on) => {
  boot(on)
  const tree = await toolRow($)

  expect(tree.props?.borderStyle).toBe('single')
  expect(tree.props?.borderColor).toBe('#6272A4')
  expect(untagged((tree.children ?? [])[0] as Drawn)).toEqual({ type: 'Text', props: {}, children: ['Ran Bash'] })
})

test('frames a folded group line, and leaves an unfolded group to its framed rows', async ($, on) => {
  boot(on)

  expect((await groupRow($, false)).props?.borderStyle).toBe('single')
  expect(untagged(await groupRow($, true))).toEqual({ type: 'Text', props: {}, children: ['Read 2 files'] })
})

const rowOf = async ($: Engine, text: string, kind: Kind, from?: string) => {
  const ui = await $.ui.mount({
    plugin: 'peer-box',
    component: 'UserMessage',
    requestId: `row-${kind}-${from ?? 'none'}`,
    props: { text, origin: { kind }, isExpanded: false, ...(from ? { from: { name: from } } : {}) },
    surface: 'terminal',
  })
  const tree = (await ui.drawn()) as Drawn
  await ui.unmount()

  return tree
}

const ENGINE_ROW = (text: string) => ({ type: 'Text', props: {}, children: [`> ${text}`] })

// The test engine tags a tree it drew itself with a `part`: the rest is what has to be left alone.
const untagged = (tree?: Drawn) => {
  const { part, ...rest } = (tree ?? {}) as Drawn & { part?: unknown }

  return rest
}

test('boxes a message from another session: sender then text, no blank line inside', async ($, on) => {
  boot(on)
  const tree = await rowOf($, 'TA is free', 'peer', 'ta-geisa-prep')
  const [from, text] = (tree.children ?? []) as Drawn[]

  expect(tree.type).toBe('Box')
  expect(tree.props?.borderStyle).toBe('single')
  expect(tree.props?.borderColor).toBe('#8BE9FD')
  expect(tree.props?.backgroundColor).toBe('#1E3A47')
  expect(tree.props?.marginTop).toBe(1)
  expect(tree.children).toHaveLength(2)
  expect(from?.children).toEqual(['@ ta-geisa-prep›'])
  expect(text?.children).toEqual(['TA is free'])
})

test("frames Claude Code's row when the message names no sender", async ($, on) => {
  boot(on)
  const tree = await rowOf($, 'TA release starting now', 'peer')

  expect(tree.props?.borderStyle).toBe('single')
  expect(untagged((tree.children ?? [])[0] as Drawn)).toEqual(ENGINE_ROW('TA release starting now'))
})

test("boxes another session's SendMessage delivery too", async ($, on) => {
  boot(on)

  expect((await rowOf($, 'free', 'peer-send-message')).props?.borderStyle).toBe('single')
})

test('leaves your own prompt and notifications as they are drawn', async ($, on) => {
  boot(on)

  expect(untagged(await rowOf($, 'hi', 'composer'))).toEqual(ENGINE_ROW('hi'))
  expect(untagged(await rowOf($, 'build finished', 'task-notification'))).toEqual(ENGINE_ROW('build finished'))
})
