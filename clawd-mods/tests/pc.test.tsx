import { expect, test } from 'claude-code/testing'

import {
  DAY,
  type FastFacts,
  type PcState,
  type ProcUse,
  type SlowFacts,
  claudeGroup,
  fixPrompt,
  parseFast,
  parseSlow,
  tipsOf,
} from '../hooks/pc'
import { MIN, NOW } from './world'

const TOTAL = 16_000

/** A fast check at `usedPct` of memory, `minutesAgo` before NOW. */
function fast(usedPct: number, minutesAgo: number, procs: ProcUse[] = [], cores = 8): FastFacts {
  return { at: NOW - minutesAgo * MIN, totalMb: TOTAL, freeMb: Math.round(TOTAL * (1 - usedPct / 100)), cores, procs }
}

function slow(extra: Partial<SlowFacts> = {}): SlowFacts {
  return { at: NOW, rebootPending: false, bootAt: NOW - DAY, startup: [], apps: [], ...extra }
}

function state(extra: Partial<PcState> = {}): PcState {
  return { fast: [], slow: null, knownStartup: null, snoozes: {}, ...extra }
}

const proc = (name: string, pid: number, ppid: number, memMb: number, cpuSec = 0): ProcUse => ({ name, pid, ppid, memMb, cpuSec })

const CLAUDE_TREE = [
  proc('claude', 10, 1, 500),
  proc('node', 11, 10, 300), // an MCP server Claude started
  proc('uvx', 12, 11, 200), // and its child
  proc('chrome', 20, 1, 2100),
  proc('chrome', 21, 20, 400),
  proc('Code', 30, 1, 900),
  proc('node', 40, 1, 50), // not Claude's
]

test('memory: red after two checks at 90% or more, Claude summed with its children', () => {
  const tips = tipsOf(state({ fast: [fast(91, 2, CLAUDE_TREE), fast(92, 0, CLAUDE_TREE)] }), NOW)
  expect(tips[0]).toMatchObject({ id: 'memory', level: 'red', title: 'Memory 92% full', snoozeMs: DAY })
  expect(tips[0]?.detail.startsWith('Claude ×1 ')).toBe(true)
  // 500 + 300 + 200 MB: the children count as Claude.
  expect(tips[0]?.detail).toContain('Claude ×1 1.0 GB')
  expect(tips[0]?.detail).toContain('chrome 2.4 GB')
  expect(claudeGroup(CLAUDE_TREE)).toEqual({ count: 1, memMb: 1000 })
  // One high reading after a normal one is not a tip yet.
  expect(tipsOf(state({ fast: [fast(80, 2), fast(95, 0)] }), NOW)).toEqual([])
})

test('CPU hog: busy two intervals in a row', () => {
  const hog = (cpuSec: number) => [proc('MsMpEng', 7, 1, 300, cpuSec), proc('explorer', 8, 1, 200, 10)]
  const busy = [fast(50, 4, hog(1000), 2), fast(50, 2, hog(1130), 2), fast(50, 0, hog(1260), 2)]
  const tips = tipsOf(state({ fast: busy }), NOW)
  expect(tips).toHaveLength(1)
  expect(tips[0]).toMatchObject({ id: 'cpu:MsMpEng', level: 'red' })
  expect(tips[0]?.title).toContain('MsMpEng')
  // Busy in the last interval only.
  const once = [fast(50, 4, hog(1000), 2), fast(50, 2, hog(1010), 2), fast(50, 0, hog(1140), 2)]
  expect(tipsOf(state({ fast: once }), NOW)).toEqual([])
})

test('restart due', () => {
  expect(tipsOf(state({ slow: slow({ rebootPending: true }) }), NOW)[0]).toMatchObject({
    id: 'restart',
    level: 'yellow',
    title: 'Windows Update is waiting for a restart',
  })
  expect(tipsOf(state({ slow: slow({ bootAt: NOW - 8 * DAY - MIN }) }), NOW)[0]?.title).toBe('Running 8 days without a restart')
  expect(tipsOf(state({ slow: slow({ bootAt: NOW - 6 * DAY }) }), NOW)).toEqual([])
})

test('startup: the first list is known, new entries are tips', () => {
  const now = slow({ startup: ['OneDrive', 'Discord'] })
  expect(tipsOf(state({ slow: now, knownStartup: null }), NOW)).toEqual([])
  const tips = tipsOf(state({ slow: now, knownStartup: ['OneDrive'] }), NOW)
  expect(tips).toHaveLength(1)
  expect(tips[0]).toMatchObject({ id: 'startup:Discord', level: 'yellow', title: 'New at startup: Discord' })
})

test('unused apps: one tip for all of them', () => {
  const apps = [
    { name: 'Old Game', lastRun: NOW - 120 * DAY, isUsed: false },
    { name: 'Old Editor', lastRun: NOW - 120 * DAY, isUsed: false },
    { name: 'Fresh App', lastRun: NOW - 10 * DAY, isUsed: false },
    { name: 'Some CLI', lastRun: NOW - 200 * DAY, isUsed: true },
  ]
  const tips = tipsOf(state({ slow: slow({ apps }) }), NOW)
  expect(tips).toHaveLength(1)
  expect(tips[0]).toMatchObject({ id: 'unused-apps', level: 'yellow', title: '2 apps not opened in 90+ days', snoozeMs: 30 * DAY })
  expect(tips[0]?.detail).toContain('Old Game')
})

test('red tips come first', () => {
  const tips = tipsOf(
    state({ fast: [fast(91, 2, CLAUDE_TREE), fast(92, 0, CLAUDE_TREE)], slow: slow({ rebootPending: true }) }),
    NOW,
  )
  expect(tips.map(tip => tip.level)).toEqual(['red', 'yellow'])
})

test('not now hides a tip until its snooze ends', () => {
  const two = [fast(91, 2, CLAUDE_TREE), fast(92, 0, CLAUDE_TREE)]
  expect(tipsOf(state({ fast: two, snoozes: { memory: NOW + DAY } }), NOW)).toEqual([])
  expect(tipsOf(state({ fast: two, snoozes: { memory: NOW + DAY } }), NOW + DAY + 1)[0]?.id).toBe('memory')
})

test('fix prompt', () => {
  const tip = tipsOf(state({ fast: [fast(91, 2, CLAUDE_TREE), fast(92, 0, CLAUDE_TREE)] }), NOW)[0]
  if (!tip) throw new Error('no tip')
  const text = fixPrompt(tip)
  expect(text).toContain(tip.title)
  expect(text).toContain(tip.detail)
  expect(text).toContain('Propose the commands to fix this and wait for my approval before running each one.')
})

test('the script output: parsed when whole, null when junk', () => {
  const out = JSON.stringify({ totalMb: TOTAL, freeMb: 1000, cores: 8, procs: [{ name: 'claude', pid: 10, ppid: 1, memMb: 500, cpuSec: 3 }] })
  expect(parseFast(out, NOW)).toEqual({ at: NOW, totalMb: TOTAL, freeMb: 1000, cores: 8, procs: [proc('claude', 10, 1, 500, 3)] })
  expect(parseFast('Get-CimInstance : Access denied', NOW)).toBeNull()
  expect(parseFast(JSON.stringify({ totalMb: 'x' }), NOW)).toBeNull()
  const s = JSON.stringify({ rebootPending: false, bootAt: NOW - DAY, startup: ['OneDrive'], apps: [{ name: 'A', lastRun: null, isUsed: false }] })
  expect(parseSlow(s, NOW)).toEqual({ at: NOW, rebootPending: false, bootAt: NOW - DAY, startup: ['OneDrive'], apps: [{ name: 'A', lastRun: null, isUsed: false }] })
  expect(parseSlow('', NOW)).toBeNull()
})
