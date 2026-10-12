import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// A Wednesday morning, local time, so the wording does not depend on the time zone.
const NOW = new Date(2026, 9, 7, 8, 45).getTime()

const TURN = { answer: 'done', isAborted: false, turnId: 't1', reason: 'answer', durationMs: 5000 } as const

type Drawn = { type: string; props?: Record<string, unknown>; children?: unknown[] }

// The stubs beneath the mod: they answer in Claude Code's place, from a world the test may change.
const boot = (on: On) => {
  const world = { store: {} as Record<string, unknown>, redraws: 0 }
  const clock = mock.clock(on, { now: NOW })

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.id', () => ({ value: 'me' }))
  on('store.get', ($, e) => ({ value: world.store[e.key] }))
  on('store.set', ($, e) => {
    world.store[e.key] = e.value

    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    world.store = Object.fromEntries(Object.entries(world.store).filter(([key]) => key !== e.key))

    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(world.store) }))
  on('ui.invalidate', () => {
    world.redraws += 1

    return { value: undefined }
  })
  on('ui.render', { component: 'UserMessage' }, ($, e) => ({ type: 'Text', props: {}, children: [`> ${e.props.text}`] }))

  return { world, clock }
}

const start = async ($: Engine, clock: MockClock) => {
  await $.session.start({ cwd: 'C:\\work', surface: 'terminal', isInteractive: true })
  await clock.settle()
}

const send = ($: Engine, text: string) => $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })

const rowOf = async ($: Engine, id: string, text: string, origin: { kind: 'composer' | 'task-notification' } = { kind: 'composer' }) => {
  const ui = await $.ui.mount({
    plugin: 'message-times',
    component: 'UserMessage',
    requestId: id,
    props: { text, origin, isExpanded: true },
    surface: 'terminal',
  })
  const tree = (await ui.drawn()) as Drawn
  await ui.unmount()

  return tree
}

// The time a row shows at its right, if it shows one.
const stampOf = (tree: Drawn) =>
  tree.type === 'Box' ? ((tree.children ?? []).at(-1) as Drawn | undefined)?.children?.[0] : undefined

const ENGINE_ROW = (text: string) => ({ type: 'Text', props: {}, children: [`> ${text}`] })

test('shows a prompt the time it was sent at, dim, at the right of its row', async ($, on) => {
  boot(on)
  await send($, 'hi there')
  const tree = await rowOf($, 'm1', 'hi there')
  const [row, gap, stamp] = (tree.children ?? []) as Drawn[]

  // The time stands on the last line of the row Claude Code draws, which starts with an empty one.
  expect(tree.props?.alignItems).toBe('flex-end')
  expect(row).toEqual(ENGINE_ROW('hi there'))
  expect(gap?.props?.flexGrow).toBe(1)
  expect(stamp?.children).toEqual(['08:45'])
  expect(stamp?.props?.dimColor).toBe(true)
})

test('keeps showing that time, however long ago it was', async ($, on) => {
  const { clock } = boot(on)
  await send($, 'hi there')
  await rowOf($, 'm1', 'hi there')
  await clock.advance(2 * HOUR)

  expect(stampOf(await rowOf($, 'm1', 'hi there'))).toBe('08:45')
})

test('shows the row of a prompt still on its way the time it is', async ($, on) => {
  const { clock } = boot(on)
  await clock.advance(5 * MINUTE)

  expect(stampOf(await rowOf($, 'placeholder', 'hi there'))).toBe('08:50')
})

test('leaves a row sent before it was there as Claude Code draws it', async ($, on) => {
  boot(on)

  expect(await rowOf($, 'old', 'from last week')).toEqual(ENGINE_ROW('from last week'))
})

test('leaves a row that is not the prompt of the person alone', async ($, on) => {
  boot(on)
  await send($, 'build finished')

  expect(await rowOf($, 'n1', 'build finished', { kind: 'task-notification' })).toEqual(ENGINE_ROW('build finished'))
})

test('gives two prompts of the same words each its own time', async ($, on) => {
  const { clock } = boot(on)
  await send($, 'again')
  await clock.advance(MINUTE)
  await send($, 'again')

  expect(stampOf(await rowOf($, 'm1', 'again'))).toBe('08:45')
  expect(stampOf(await rowOf($, 'm2', 'again'))).toBe('08:46')
})

test('keeps the times of a session once a turn has ended', async ($, on) => {
  const { world, clock } = boot(on)
  await start($, clock)
  await send($, 'hi there')
  await rowOf($, 'm1', 'hi there')
  await $.turn.complete(TURN)

  expect(world.store).toEqual({ 'times:me': { m1: NOW } })
})

test('shows the times it kept when the session is opened again', async ($, on) => {
  const { world, clock } = boot(on)
  world.store = { 'times:me': { m1: NOW - HOUR } }
  await start($, clock)

  expect(stampOf(await rowOf($, 'm1', 'hi there'))).toBe('07:45')
  // Rows drawn before the times were read back are drawn again.
  expect(world.redraws).toBe(1)
})

test('forgets the sessions nobody has sent a prompt in for a month', async ($, on) => {
  const { world, clock } = boot(on)
  world.store = {
    'times:old': { a: NOW - 40 * DAY, b: NOW - 31 * DAY },
    'times:recent': { c: NOW - 40 * DAY, d: NOW - 2 * DAY },
    'something else': 'kept',
  }
  await start($, clock)

  expect(Object.keys(world.store).sort()).toEqual(['something else', 'times:recent'])
})
