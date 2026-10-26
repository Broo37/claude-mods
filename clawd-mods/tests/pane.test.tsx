import type { On } from 'claude-code'
import { type Engine, expect, test } from 'claude-code/testing'

import { LEVEL_COLOR } from '../hooks/usage'
import { PANE, SAMPLE, START, type World, world } from './world'

type Found = { type: string; props: Record<string, unknown>; text: string; children: unknown[] }

/** The pane on the terminal at a width, with the two sessions of the SAMPLE world. */
async function pane($: Engine, bodyColumns = 42) {
  return $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface: 'terminal' })
}

async function texts($: Engine, bodyColumns = 42): Promise<Found[]> {
  const ui = await pane($, bodyColumns)
  const all = (await ui.findAll({ type: 'Text' })) as Found[]
  await ui.unmount()
  return all
}

/** The SAMPLE world with this session and two others: one busy, one waiting. */
function withSessions(on: On): World {
  const w = world(on, () => SAMPLE, [100, 200, 300])
  w.setSession({ pid: 100, sessionId: 'me' })
  w.setSession({ pid: 200, name: 'shopapp', status: 'busy' })
  w.setSession({ pid: 300, name: 'docs', status: 'waiting', waitingFor: 'permission' })
  return w
}

test('sections are a colored bar and a capital title, an empty line apart', async ($, on) => {
  const w = world(on, () => SAMPLE, [200])
  w.setSession({ pid: 200, name: 'shopapp', status: 'busy' })
  await $.session.start(START)
  await w.clock.advance(400)
  const all = await texts($)
  const title = (name: string) => all.find(t => t.text === `▌ ${name}`)
  expect(title('LIMITS')?.props).toMatchObject({ color: '#D77757', weight: 'bold' })
  expect(title('SESSIONS')?.props).toMatchObject({ color: '#4ADE80', weight: 'bold' })
  expect(title('LAST 24 HOURS')).toBeDefined()
  expect(title('LAST 7 DAYS')).toBeDefined()
  const ui = await pane($)
  expect((await ui.find({ key: 'limits' }))?.props.marginTop ?? 0).toBe(0)
  expect((await ui.find({ key: 'sessions' }))?.props).toMatchObject({ marginTop: 1 })
  await ui.unmount()
})

test('one line per limit, its reset indented under it', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  await $.session.start(START)
  await w.clock.advance(400)
  const all = await texts($)
  const i = all.findIndex(t => /^5-hour\s+█/.test(t.text))
  expect(i).toBeGreaterThanOrEqual(0)
  const after = all.slice(i + 1).find(t => !/^[█░]+$/.test(t.text))
  expect(after?.text).toMatch(/^\s+resets .* · in /)
  expect(after?.props.dimColor).toBe(true)
  expect(all.some(t => /^Week\s+█/.test(t.text))).toBe(true)
  expect(all.some(t => /^Fable\s+█/.test(t.text))).toBe(true)
})

test('no Fable line from /usage, no Fable row', async ($, on) => {
  const w = world(on, () => 'Current session: 1% used · resets Oct 23, 1am\nCurrent week (all models): 3% used · resets Oct 29, 6am\n', [])
  await $.session.start(START)
  await w.clock.advance(400)
  const all = await texts($)
  expect(all.some(t => /^Week\s/.test(t.text))).toBe(true)
  expect(all.some(t => /^Fable\s/.test(t.text))).toBe(false)
})

test('one line per session', async ($, on) => {
  const w = withSessions(on)
  await $.session.start(START)
  await w.clock.advance(400)
  const all = await texts($)
  expect(all.filter(t => /^[▶?○] /.test(t.text))).toHaveLength(2)
  expect(all.some(t => t.text.includes('C:\\work\\p200'))).toBe(false)
  expect(all.some(t => /^\? docs\s+waits for permission/.test(t.text))).toBe(true)
})

test('breakdown lines colored by their percent', async ($, on) => {
  const text = SAMPLE.replace('  Top plugins: superpowers 39%', '  Top plugins: superpowers 39%\r\n  A brand-new metric')
  const w = world(on, () => text, [])
  await $.session.start(START)
  await w.clock.advance(400)
  const all = await texts($)
  expect(all.find(t => t.text === '86%')?.props.color).toBe(LEVEL_COLOR.crit)
  expect(all.find(t => t.text === '39%')?.props.color).toBe(LEVEL_COLOR.ok)
  const unknown = all.find(t => t.text === 'A brand-new metric')
  expect(unknown?.props.dimColor).toBe(true)
})

test('narrow pane: no line wraps, every row truncates', async ($, on) => {
  const w = withSessions(on)
  await $.session.start(START)
  await w.clock.advance(400)
  const ui = await pane($, 30)
  const root = (await ui.findAll({ type: 'Box' }))[0] as Found
  // Nested descriptions are plain elements: their children sit in `children` or `props.children`.
  const kids = (el: Found): unknown[] => [el.children ?? el.props?.children ?? []].flat(Infinity)
  const shown = (node: unknown): string =>
    typeof node === 'string' ? node : typeof node === 'object' && node !== null ? kids(node as Found).map(shown).join('') : ''
  const rows: Found[] = []
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return
    const el = node as Found
    if (el.type === 'Text') rows.push(el)
    else kids(el).forEach(walk)
  }
  walk(root)
  await ui.unmount()
  expect(rows.length).toBeGreaterThan(10)
  for (const row of rows) expect([shown(row), row.props.wrap]).toEqual([shown(row), expect.stringMatching(/^truncate-(end|start)$/)])
})

test('empty sections vanish', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  await $.session.start(START)
  await w.clock.advance(400)
  const all = await texts($)
  expect(all.some(t => t.text === '▌ SESSIONS')).toBe(false)
  expect(all.some(t => t.text === '▌ LIMITS')).toBe(true)
})
