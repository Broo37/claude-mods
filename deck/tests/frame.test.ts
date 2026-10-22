import { expect, test } from 'claude-code/testing'

import { INK, PANELS, headerOf, miniOf, orderOf, panelsFrom, routeOf, trackOf, tripOf, visible } from '../hooks/frame'
import type { DeckPanel, DeckRun, DeckStop, RouteRow } from '../hooks/frame'

const plain = (runs: readonly DeckRun[]) => runs.map(run => run.text).join('')

const PLAN: DeckPanel = {
  id: 'plan',
  title: 'plan',
  right: '',
  label: [{ text: '▶ stop 2 of 4 · 1m 12s' }],
  rows: [[{ text: '▶ 🔨 Build the pricing section' }]],
}

const LIMITS: DeckPanel = {
  id: 'limits',
  title: 'limits',
  right: '$ 0.42 · 3m',
  label: [{ text: 'Opus 5.5', isBold: true }, { text: ' xhigh' }],
  rows: [[{ text: '5H  ████ 66%' }]],
}

test('keeps the panels in their own order', () => {
  expect(orderOf(['plan', 'limits'], null)).toEqual(['plan', 'limits'])
})

test('puts the panel asked for on top', () => {
  expect(orderOf(['plan', 'limits'], 'limits')).toEqual(['limits', 'plan'])
  expect(orderOf(['plan', 'limits'], 'plan')).toEqual(['plan', 'limits'])
})

test('ignores a top that is no panel', () => {
  expect(orderOf(['plan', 'limits'], 'sessions')).toEqual(['plan', 'limits'])
})

test('heads the Deck with its name, the model, then the job', () => {
  expect(plain(headerOf([PLAN, LIMITS], 60))).toBe('DECK · Opus 5.5 xhigh · ▶ stop 2 of 4 · 1m 12s')
  expect(headerOf([PLAN, LIMITS], 60)[0]).toEqual({ text: 'DECK', isBold: true })
})

test('leaves out a label a panel does not have', () => {
  expect(plain(headerOf([PLAN, { ...LIMITS, label: [] }], 60))).toBe('DECK · ▶ stop 2 of 4 · 1m 12s')
})

test('cuts the header to the width, ending in an ellipsis', () => {
  const header = plain(headerOf([PLAN, LIMITS], 30))

  expect(header).toHaveLength(30)
  expect(header.endsWith('…')).toBe(true)
})

test('shows only the panels with rows', () => {
  expect(visible([{ ...PLAN, rows: [] }, LIMITS]).map(panel => panel.id)).toEqual(['limits'])
})

test('reads the panels setting: known panels in its order, the rest dropped', () => {
  expect(panelsFrom('sessions, limits')).toEqual(['sessions', 'limits'])
  expect(panelsFrom('plan,nope,timeline,plan')).toEqual(['plan', 'timeline'])
})

test('falls back to every panel in its own order when the setting names none', () => {
  expect(panelsFrom('')).toEqual([...PANELS])
  expect(panelsFrom('nope')).toEqual([...PANELS])
  expect(panelsFrom(undefined)).toEqual(['plan', 'limits', 'timeline', 'sessions'])
})

const TIMELINE: DeckPanel = { id: 'timeline', title: 'this turn', right: '41s', label: [], rows: [[{ text: 'Read ██' }]], summary: [{ text: 'turn 41s running · 2 tools' }] }

const SESSIONS: DeckPanel = { id: 'sessions', title: 'sessions', right: '2 open', label: [], rows: [[{ text: '○ a' }]], summary: [{ text: '2 open' }] }

const SUMMED = [
  { ...PLAN, summary: [{ text: '▶ 2/4 Build the pricing section' }] },
  { ...LIMITS, summary: [{ text: '5H 66% · 7D 8% · ctx 6%' }] },
  TIMELINE,
  SESSIONS,
]

test('sums the Deck up in four rows at most: the header, then a line a panel', () => {
  expect(miniOf(SUMMED, 60).map(plain)).toEqual([
    'DECK · Opus 5.5 xhigh · ▶ stop 2 of 4 · 1m 12s',
    '▶ 2/4 Build the pricing section',
    '5H 66% · 7D 8% · ctx 6%',
    'turn 41s running · 2 tools',
  ])
})

test('sums up the sessions where there is no turn to sum up', () => {
  expect(miniOf([SUMMED[0], SUMMED[1], { ...TIMELINE, summary: [] }, SESSIONS] as DeckPanel[], 60).map(plain).at(-1)).toBe('2 open')
})

test('cuts every row of the mini summary to the width', () => {
  for (const row of miniOf(SUMMED, 30).map(plain)) {
    expect(row.length).toBeLessThanOrEqual(30)
  }
})

// ── The route and the tracks ────────────────────────────────────────────────

const STOPS: DeckStop[] = [
  { name: 'Read your brand notes', icon: '📖', status: 'done', percent: 100, hasReported: false },
  { name: 'Build the pricing section', icon: '🔨', status: 'active', percent: 60, hasReported: true },
  { name: 'Add the contact form', icon: '🔨', status: 'upcoming', percent: 0, hasReported: false },
]

const stationsOf = (rows: RouteRow[]) => rows.flatMap(row => (row.kind === 'station' ? [plain(row.runs)] : []))

test('lays the plan out as a route: stations joined by links, a spur under the one at work', () => {
  expect(routeOf(STOPS, 'working', 43).map(row => row.kind)).toEqual(['station', 'link', 'station', 'spur', 'station'])
})

test('marks each station by where it stands: passed, here, ahead', () => {
  expect(stationsOf(routeOf(STOPS, 'working', 43)).map(row => row[0])).toEqual(['✓', '◉', '○'])
})

test('marks the station at work by what holds the job', () => {
  const here = (phase: string) => stationsOf(routeOf(STOPS, phase, 43))[1]?.[0]

  expect(here('needs-you')).toBe('‖')
  expect(here('stuck')).toBe('!')
  expect(here('stopped')).toBe('■')
})

test('ends the station at work with its meter once it reports, and with its name until then', () => {
  expect(stationsOf(routeOf(STOPS, 'working', 43))[1]?.endsWith('████░░ 60%')).toBe(true)
  expect(stationsOf(routeOf([{ ...STOPS[1]!, hasReported: false }], 'working', 43))[0]).toBe('◉  🔨 Build the pricing section')
})

test('keeps every station within the width, a long name cut', () => {
  for (const row of stationsOf(routeOf(STOPS, 'working', 30))) {
    expect(row.length).toBeLessThanOrEqual(30)
  }

  expect(stationsOf(routeOf(STOPS, 'working', 30))[1]).toContain('…')
})

test('draws the route line and the station glyphs in the route and station colors', () => {
  const [passed, , here, , ahead] = routeOf(STOPS, 'working', 43)

  expect(passed?.kind === 'station' && passed.runs[0]?.color).toBe(INK.route)
  expect(here?.kind === 'station' && here.runs[0]).toMatchObject({ color: INK.here, isBold: true })
  expect(ahead?.kind === 'station' && ahead.runs[0]?.color).toBe(INK.ahead)
})

test('lays a track out as a heavy rule with its label at the left and its figure at the right, as wide as asked', () => {
  const track = plain(trackOf('limits', '$ 0.42 · 3m', 40))

  expect(track).toHaveLength(40)
  expect(track.startsWith('━━ limits ━')).toBe(true)
  expect(track.endsWith('━ $ 0.42 · 3m ━━')).toBe(true)
})

test('draws a track in the route ink, so the tracks and the route read as one line', () => {
  const rule = trackOf('limits', '$ 0.42 · 3m', 40).filter(run => /^ ?━+ ?$/.test(run.text))

  expect(rule.length).toBeGreaterThan(0)
  expect(rule.every(run => run.color === INK.route)).toBe(true)
})

test("plans the train's trip: each leg starts where the one before it ends", () => {
  expect(tripOf([{ key: 'track-plan', lap: 49 }, { key: 'spur', lap: 4 }, { key: 'track-limits', lap: 49 }])).toEqual({
    cycle: 102,
    starts: { 'track-plan': 0, spur: 49, 'track-limits': 53 },
  })
  expect(tripOf([])).toEqual({ cycle: 0, starts: {} })
})

test('cuts a track label that would not leave the rule room', () => {
  const track = plain(trackOf('Build my landing page for the bakery downtown', '', 30))

  expect(track).toHaveLength(30)
  expect(track).toContain('…')
})
