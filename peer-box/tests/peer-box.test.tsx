import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

type Drawn = { type: string; props?: Record<string, unknown>; children?: unknown[] }
type Kind = 'composer' | 'peer' | 'peer-send-message' | 'task-notification'

// Rows as the layers beneath the mod draw them.
// Claude Code's own row opens with a blank spacer line: a top margin.
const SPACED = (text: string) => ({ type: 'Box', props: { marginTop: 1, flexDirection: 'column' }, children: [{ type: 'Text', props: {}, children: [text] }] })
// A row like prismantis draws: right-aligned, no spacer.
const TIGHT = (text: string) => ({ type: 'Box', props: { flexDirection: 'row' }, children: [{ type: 'Box', props: { flexDirection: 'row' }, children: [{ type: 'Text', props: {}, children: [text] }] }] })
const HIDDEN = { type: 'Box', props: {}, children: [] }

// The stubs beneath the mod: they draw each row in Claude Code's place.
const boot = (on: On, tool: (text: string) => unknown = SPACED) => {
  on('ui.render', { component: 'UserMessage' }, ($, e) => SPACED(`> ${e.props.text}`) as never)
  on('ui.render', { component: 'ToolUse' }, ($, e) => tool(`Ran ${e.props.tool}`) as never)
  on('ui.render', { component: 'ToolGroup' }, () => SPACED('Read 2 files') as never)
}

const mount = async ($: Engine, component: 'UserMessage' | 'AssistantMessage' | 'ToolUse' | 'ToolGroup', requestId: string, props: Record<string, unknown>) => {
  const ui = await $.ui.mount({ plugin: 'peer-box', component, requestId, props, surface: 'terminal' } as never)
  const tree = (await ui.drawn()) as Drawn
  await ui.unmount()

  return tree
}

const message = ($: Engine, text: string, kind: Kind, from?: string) =>
  mount($, 'UserMessage', `m-${kind}-${from ?? 'none'}`, { text, origin: { kind }, isExpanded: false, ...(from ? { from: { name: from } } : {}) })

const toolRow = ($: Engine) =>
  mount($, 'ToolUse', 'tu1', { tool_use_id: 'tu1', tool: 'Bash', input: { command: 'ls' }, isRunning: false, isErrored: false, isInterrupted: false })

const groupRow = ($: Engine, isExpanded: boolean) => mount($, 'ToolGroup', `g-${isExpanded}`, { calls: [], isActive: false, isExpanded })

// The test engine tags a tree it drew itself with a `part`: the rest is what has to be left alone.
const untagged = (tree?: unknown): unknown => {
  if (typeof tree !== 'object' || tree === null) return tree
  const { part, ...rest } = tree as Drawn & { part?: unknown }

  return rest.children ? { ...rest, children: rest.children.map(untagged) } : rest
}

const kidsOf = (tree: Drawn) => (tree.children ?? []) as Drawn[]

test("pulls a row's opening blank line under the top border and puts the space above the frame", async ($, on) => {
  boot(on)
  const tree = await toolRow($)
  const [lift] = kidsOf(tree)

  expect(tree.props?.borderStyle).toBe('single')
  expect(tree.props?.borderColor).toBe('#6272A4')
  expect(tree.props?.marginTop).toBe(1)
  expect(lift?.props?.marginTop).toBe(-1)
  expect(untagged(kidsOf(lift!)[0])).toEqual(untagged(SPACED('Ran Bash')))
})

test('leaves a row that opens on its text, like prismantis draws, where it is', async ($, on) => {
  boot(on, TIGHT)
  const tree = await toolRow($)

  expect(tree.props?.borderStyle).toBe('single')
  expect(untagged(kidsOf(tree)[0])).toEqual(untagged(TIGHT('Ran Bash')))
})

test('draws no empty frame around a row another mod hid', async ($, on) => {
  boot(on, () => HIDDEN)

  expect(untagged(await toolRow($))).toEqual(HIDDEN)
})

const DONE = { isRunning: false, isErrored: false, isInterrupted: false }

// A call drawn in full (verbose, ctrl+o), which prismantis hands back to Claude Code.
const callRow = ($: Engine, tool: string, state: Partial<typeof DONE> = {}, id = `c-${tool}-${JSON.stringify(state)}`) =>
  mount($, 'ToolUse', id, { tool_use_id: id, tool, input: {}, ...DONE, ...state, isExpanded: true })

test('draws no frame around a call Claude Code shows as nothing, such as the tool search', async $ => {
  for (const tool of ['ToolSearch', 'TodoWrite', 'TaskUpdate', 'AskUserQuestion', 'ScheduleWakeup']) {
    expect((await callRow($, tool)).props?.borderStyle).toBeUndefined()
  }
})

test("frames a standalone call's row where it stands: Claude Code keeps its spacing outside the row", async $ => {
  const tree = await callRow($, 'Bash')

  expect(tree.props?.borderStyle).toBe('single')
  expect(tree.props?.marginTop).toBeUndefined()
  expect(kidsOf(tree)[0]?.props?.marginTop).not.toBe(-1)
})

test("pulls up Claude Code's row for a call in an unfolded group, which opens with a blank line", async $ => {
  await mount($, 'ToolGroup', 'g-open', { calls: [{ tool_use_id: 'g1', tool: 'Read', input: {}, ...DONE }], isActive: false, isExpanded: true })
  const tree = await callRow($, 'Read', {}, 'g1')

  expect(tree.props?.marginTop).toBe(1)
  expect(kidsOf(tree)[0]?.props?.marginTop).toBe(-1)
})

test('colors a tool box by how its call went: yellow while it runs, red when it failed or was cut short', async $ => {
  expect((await callRow($, 'Bash')).props?.borderColor).toBe('#6272A4')
  expect((await callRow($, 'Bash', { isRunning: true })).props?.borderColor).toBe('#F1FA8C')
  expect((await callRow($, 'Bash', { isErrored: true })).props?.borderColor).toBe('#FF5555')
  expect((await callRow($, 'Bash', { isInterrupted: true })).props?.borderColor).toBe('#FF5555')
})

test('colors a folded group red when any of its calls failed', async ($, on) => {
  boot(on)
  const calls = [{ tool_use_id: 'f1', tool: 'Read', input: {}, ...DONE }, { tool_use_id: 'f2', tool: 'Read', input: {}, ...DONE, isErrored: true }]

  expect((await mount($, 'ToolGroup', 'g-failed', { calls, isActive: false, isExpanded: false })).props?.borderColor).toBe('#FF5555')
})

test('frames a quiet tool after all when a mod draws a row for it', async ($, on) => {
  boot(on)

  expect((await callRow($, 'ToolSearch')).props?.borderStyle).toBe('single')
})

test('frames a folded group line the same way, and leaves an unfolded group to its framed rows', async ($, on) => {
  boot(on)
  const folded = await groupRow($, false)

  expect(folded.props?.borderStyle).toBe('single')
  expect(kidsOf(folded)[0]?.props?.marginTop).toBe(-1)
  expect(untagged(await groupRow($, true))).toEqual(untagged(SPACED('Read 2 files')))
})

test('boxes a message from another session: sender then text, on a dark blue fill, no blank line inside', async ($, on) => {
  boot(on)
  const tree = await message($, 'TA is free', 'peer', 'ta-geisa-prep')
  const box = kidsOf(tree)[0]!
  const [from, text] = kidsOf(box)

  expect(box.props?.borderColor).toBe('#8BE9FD')
  expect(box.props?.backgroundColor).toBe('#1E3A47')
  expect(tree.props?.marginTop).toBe(1)
  expect(box.props?.marginTop).toBeUndefined()
  expect(kidsOf(box)).toHaveLength(2)
  expect(from?.children).toEqual(['@ ta-geisa-prep›'])
  expect(text?.children).toEqual(['TA is free'])
})

test("paints the border's own cells with the fill too, so no dark strip shows inside the line", async ($, on) => {
  boot(on)
  const tree = await message($, 'TA is free', 'peer', 'ta-geisa-prep')

  expect(tree.props?.backgroundColor).toBe('#1E3A47')
  expect(tree.props?.borderStyle).toBeUndefined()
  expect(kidsOf(tree)).toHaveLength(1)
  expect(kidsOf(tree)[0]?.props?.borderStyle).toBe('single')
})

test('leaves a tool box, which has no fill, without the outer layer', async ($, on) => {
  boot(on)

  expect((await toolRow($)).props?.borderStyle).toBe('single')
})

test("frames Claude Code's row when a peer message names no sender, pulling its blank line up", async ($, on) => {
  boot(on)
  const box = kidsOf(await message($, 'TA release starting now', 'peer'))[0]!

  expect(box.props?.borderStyle).toBe('single')
  expect(kidsOf(box)[0]?.props?.marginTop).toBe(-1)
})

test("pulls up Claude Code's own row for a peer message, which opens with a blank line", async $ => {
  const tree = await message($, 'TA release starting now', 'peer')

  expect(tree.props?.marginTop).toBe(1)
  expect(kidsOf(kidsOf(tree)[0]!)[0]?.props?.marginTop).toBe(-1)
})

test("boxes another session's SendMessage delivery too", async ($, on) => {
  boot(on)
  const tree = await message($, 'free', 'peer-send-message', 'ta-geisa-prep')

  expect(kidsOf(tree)[0]?.props?.borderStyle).toBe('single')
})

// A bubble as prismantis draws one: its label, then a rounded frame on a fill.
const BUBBLE = (text: string, place: Record<string, unknown> = {}, fill: Record<string, unknown> = { backgroundColor: '#1d2335' }) => ({
  type: 'Box',
  props: { flexDirection: 'column' },
  children: [
    { type: 'Text', props: { bold: true }, children: ['⬤ Claude'] },
    {
      type: 'Box',
      props: { flexDirection: 'column', flexGrow: 1, paddingX: 1, borderStyle: 'round', borderColor: '#cc785c', ...fill, ...place },
      children: [{ type: 'Text', props: {}, children: [text] }],
    },
  ],
})

test("fills the border cells of a reply bubble another mod drew, and the bubble keeps its place", async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => BUBBLE(e.props.text) as never)
  const [label, layer] = kidsOf(await mount($, 'AssistantMessage', 'a1', { text: 'hi', isFirstOfReply: true }))
  const bubble = kidsOf(layer!)[0]

  expect(label?.children).toEqual(['⬤ Claude'])
  expect(layer?.props?.backgroundColor).toBe('#1d2335')
  expect(layer?.props?.flexGrow).toBe(1)
  expect(layer?.props?.borderStyle).toBeUndefined()
  expect(bubble?.props?.borderStyle).toBe('round')
  expect(bubble?.props?.backgroundColor).toBe('#1d2335')
  expect(bubble?.props?.flexGrow).toBeUndefined()
  expect(kidsOf(bubble!)[0]?.children).toEqual(['hi'])
})

test("moves a prompt bubble's side and spacing onto its fill layer", async ($, on) => {
  on('ui.render', { component: 'UserMessage' }, ($, e) => BUBBLE(e.props.text, { alignSelf: 'flex-end', marginTop: 1 }) as never)
  const layer = kidsOf(await message($, 'test it here bro', 'composer'))[1]!

  expect(layer.props?.alignSelf).toBe('flex-end')
  expect(layer.props?.marginTop).toBe(1)
  expect(kidsOf(layer)[0]?.props?.alignSelf).toBeUndefined()
  expect(kidsOf(layer)[0]?.props?.marginTop).toBeUndefined()
})

test('leaves a reply with no filled frame as it was drawn', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => (e.props.text === 'plain' ? SPACED('plain') : BUBBLE('framed', {}, {})) as never)

  expect(untagged(await mount($, 'AssistantMessage', 'a-plain', { text: 'plain', isFirstOfReply: true }))).toEqual(untagged(SPACED('plain')))
  expect(untagged(await mount($, 'AssistantMessage', 'a-framed', { text: 'framed', isFirstOfReply: true }))).toEqual(untagged(BUBBLE('framed', {}, {})))
})

test('leaves your own prompt and notifications as they are drawn', async ($, on) => {
  boot(on)

  expect(untagged(await message($, 'hi', 'composer'))).toEqual(untagged(SPACED('> hi')))
  expect(untagged(await message($, 'build finished', 'task-notification'))).toEqual(untagged(SPACED('> build finished')))
})
