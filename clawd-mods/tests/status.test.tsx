import { type Engine, expect, test } from 'claude-code/testing'

import { BELL, type ClawdProps, create, overheadMark, step } from '../hooks/clawd'
import { parseSummary } from '../hooks/status'
import { BAND, NOW, PANE, SAMPLE, START, world } from './world'

// The shape of https://status.claude.com/api/v2/summary.json, 2026-10-23 (all operational), trimmed.
const component = (name: string, status = 'operational') => ({ id: name, name, status, group: false, group_id: null, only_show_if_degraded: false })
const COMPONENTS = ['claude.ai', 'Claude Console (platform.claude.com)', 'Claude API (api.anthropic.com)', 'Claude Code'].map(name => component(name))
const summary = (indicator: string, description: string, incidents: unknown[], components = COMPONENTS) =>
  JSON.stringify({
    page: { id: 'tymt9n04zgry', name: 'Claude', url: 'https://status.claude.com', time_zone: 'Etc/UTC', updated_at: '2026-10-23T12:49:34.844Z' },
    components,
    incidents,
    scheduled_maintenances: [],
    status: { indicator, description },
  })
const OPERATIONAL = summary('none', 'All Systems Operational', [])
const incident = (name: string, createdAt: string, status = 'investigating') => ({ id: name, name, status, impact: 'minor', created_at: createdAt, updated_at: createdAt })
const DEGRADED = COMPONENTS.map(c => (c.name.startsWith('Claude API') ? { ...c, status: 'degraded_performance' } : c))
const MINOR = summary(
  'minor',
  'Partially Degraded Service',
  [incident('Older trouble', '2026-10-23T07:00:00.000Z', 'monitoring'), incident('Elevated errors on Claude Opus', '2026-10-23T08:05:00.000Z')],
  DEGRADED,
)
const CRITICAL = summary('critical', 'Major System Outage', [incident('Claude is down', '2026-10-23T09:00:00.000Z')], DEGRADED)

test('the status summary: nothing while all is operational, the newest incident when not', () => {
  expect(parseSummary(OPERATIONAL)).toBeNull()
  expect(parseSummary(MINOR)).toEqual({
    level: 'minor',
    title: 'Elevated errors on Claude Opus',
    parts: ['Claude API'],
    since: Date.parse('2026-10-23T08:05:00.000Z'),
  })
  expect(parseSummary(CRITICAL)).toMatchObject({ level: 'major', title: 'Claude is down' })
  expect(parseSummary('<html>Bad gateway</html>')).toBeNull()
})

test('what stands over his head: the bell, then ?, then !', () => {
  expect(overheadMark('bell', true)?.ch).toBe(BELL)
  expect(overheadMark('alert-minor', true)?.ch).toBe('?')
  expect(overheadMark('alert-minor', false)).toEqual({ ch: '!', fg: '#FBBF24' })
  expect(overheadMark('alert-major', false)).toEqual({ ch: '!', fg: '#F87171' })
  expect(overheadMark(null, true)?.ch).toBe('?')
  expect(overheadMark(null, false)).toBeNull()
})

test('the ! stands in the sky row right over his head, the sky stepping aside', () => {
  const props: ClawdProps = {
    mood: 'idle',
    halves: 6,
    isCrit: false,
    worried: false,
    event: null,
    sky: null,
    control: { kind: 'auto' },
    overhead: 'alert-minor',
    width: 30,
  }
  const m = create(props)
  m.act = null
  step(m, 30)
  const row0 = m.rows[0]?.map(run => run.text).join('') ?? ''
  expect(row0[Math.round(m.x) + 4]).toBe('!')
})

async function paneTexts($: Engine) {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 42 }, surface: 'terminal' })
  const texts = (await ui.findAll({ type: 'Text' })) as { text: string; props: Record<string, unknown> }[]
  await ui.unmount()
  return texts
}

test('during an incident: CLAUDE STATUS in the pane, and a ! over Clawd', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  w.web['https://status.claude.com/'] = () => MINOR
  await $.session.start(START)
  await w.clock.advance(2000)
  const texts = await paneTexts($)
  expect(texts.find(t => t.text === '▌ CLAUDE STATUS' && t.props.weight === 'bold')?.props.color).toBe('#FBBF24')
  expect(texts.some(t => /^! Elevated errors on Claude Opus$/.test(t.text))).toBe(true)
  const since = texts.find(t => /^since \d\d?:\d\d · Claude API$/.test(t.text))
  expect(since?.props.dimColor).toBe(true)
  // Above TIPS' neighbours, below TIPS: second in the pane.
  expect(texts.findIndex(t => t.text === '▌ CLAUDE STATUS')).toBeLessThan(texts.findIndex(t => t.text === '▌ LIMITS'))
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Client' }))?.props).toMatchObject({ props: { overhead: 'alert-minor' } })
  await band.unmount()
})

test('offline for hours: the incident stays named but marked, and the ! comes down', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  const ago = NOW - 2 * 3_600_000
  const alert = parseSummary(MINOR)
  w.files.set('C:/L/clawd-mods/status.json', { text: JSON.stringify({ at: ago, triedAt: ago, isFailed: false, value: { alert } }), mtimeMs: NOW })
  await $.session.start(START)
  await w.clock.advance(2000)
  const texts = await paneTexts($)
  expect(texts.some(t => /^! Elevated errors on Claude Opus$/.test(t.text))).toBe(true)
  expect(texts.find(t => /status page unreachable/.test(t.text))?.props.dimColor).toBe(true)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Client' }))?.props).toMatchObject({ props: { overhead: null } })
  await band.unmount()
})

test('a major outage is red; all operational again, it all goes away', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  let answer = CRITICAL
  w.web['https://status.claude.com/'] = () => answer
  await $.session.start(START)
  await w.clock.advance(2000)
  expect((await paneTexts($)).find(t => t.text === '▌ CLAUDE STATUS' && t.props.weight === 'bold')?.props.color).toBe('#F87171')
  answer = OPERATIONAL
  await w.clock.advance(150_000)
  expect((await paneTexts($)).some(t => t.text === '▌ CLAUDE STATUS')).toBe(false)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Client' }))?.props).toMatchObject({ props: { overhead: null } })
  await band.unmount()
})
