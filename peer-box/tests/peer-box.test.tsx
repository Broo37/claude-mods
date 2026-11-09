import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

type Drawn = { type: string; props?: Record<string, unknown>; children?: unknown[] }
type Kind = 'composer' | 'peer' | 'peer-send-message' | 'task-notification'

// The stub beneath the mod: it draws the row in Claude Code's place.
const boot = (on: On) => {
  on('ui.render', { component: 'UserMessage' }, ($, e) => ({ type: 'Text', props: {}, children: [`> ${e.props.text}`] }))
}

const rowOf = async ($: Engine, text: string, kind: Kind) => {
  const ui = await $.ui.mount({
    plugin: 'peer-box',
    component: 'UserMessage',
    requestId: `row-${kind}`,
    props: { text, origin: { kind }, isExpanded: false },
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

test('boxes a message from another session in a light blue square frame', async ($, on) => {
  boot(on)
  const tree = await rowOf($, 'TA release starting now', 'peer')

  expect(tree.type).toBe('Box')
  expect(tree.props?.borderStyle).toBe('single')
  expect(tree.props?.borderColor).toBe('#8BE9FD')
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
