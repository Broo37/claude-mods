// PC tips: the facts scripts/pc-check.ps1 reads on Windows, and the rules that
// turn them into tips. The checks are read-only and offline and spend no
// tokens; one session runs them for the whole machine (see shared.ts). Only
// the person's own Fix it sends a tip to Claude, who asks before each command.

import type { Tip } from '../types'

export const DAY = 86_400_000

/** One process in a fast check: memory in MB, CPU seconds used since it started. */
export type ProcUse = { name: string; pid: number; ppid: number; memMb: number; cpuSec: number }

/** Every 2 minutes: memory and the processes. */
export type FastFacts = { at: number; totalMb: number; freeMb: number; cores: number; procs: ProcUse[] }

/** Every 30 minutes: restart, startup list, installed apps and when each last ran. */
export type SlowFacts = {
  at: number
  rebootPending: boolean
  bootAt: number
  startup: string[]
  apps: { name: string; lastRun: number | null; isUsed: boolean }[]
}

/** What the tips are made from: the last 3 fast checks, the last slow one, and the person's answers. */
export type PcState = { fast: FastFacts[]; slow: SlowFacts | null; knownStartup: string[] | null; snoozes: Record<string, number> }

export type { Tip }

// This PC sits near 80% with six sessions open (measured 2026-10-23): 90% is unusual.
const MEMORY_RED_PCT = 90
const CPU_SHARE = 0.5 // of all cores, through two checks in a row
const UPTIME_DAYS = 7
const UNUSED_DAYS = 90
const CLAUDE = /^claude(\.exe)?$/i
const IDLE = /^(idle|system idle process)$/i

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** PowerShell 5.1 prints a one-item list as the item itself. */
const listOf = (v: unknown): unknown[] | null => (Array.isArray(v) ? v : v === null || v === undefined ? null : [v])

function objectOf(stdout: string): Record<string, unknown> | null {
  try {
    const raw: unknown = JSON.parse(stdout.trim())
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function parseFast(stdout: string, at: number): FastFacts | null {
  const r = objectOf(stdout)
  const list = listOf(r?.procs) ?? (r?.procs === undefined ? null : [])
  if (r === null || !isNum(r.totalMb) || !isNum(r.freeMb) || !isNum(r.cores) || list === null || r.totalMb <= 0) return null
  const procs: ProcUse[] = []
  for (const item of list) {
    const p = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
    if (typeof p.name !== 'string' || !isNum(p.pid) || !isNum(p.ppid) || !isNum(p.memMb) || !isNum(p.cpuSec)) continue
    procs.push({ name: p.name, pid: p.pid, ppid: p.ppid, memMb: p.memMb, cpuSec: p.cpuSec })
  }
  return { at, totalMb: r.totalMb, freeMb: r.freeMb, cores: Math.max(1, r.cores), procs }
}

export function parseSlow(stdout: string, at: number): SlowFacts | null {
  const r = objectOf(stdout)
  if (r === null || typeof r.rebootPending !== 'boolean' || !isNum(r.bootAt)) return null
  const startup = (listOf(r.startup) ?? []).filter((name): name is string => typeof name === 'string')
  const apps: SlowFacts['apps'] = []
  for (const item of listOf(r.apps) ?? []) {
    const a = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
    if (typeof a.name !== 'string' || typeof a.isUsed !== 'boolean' || !(a.lastRun === null || isNum(a.lastRun))) continue
    apps.push({ name: a.name, lastRun: a.lastRun, isUsed: a.isUsed })
  }
  return { at, rebootPending: r.rebootPending, bootAt: r.bootAt, startup, apps }
}

/** Claude's processes and every process they started (MCP servers and their children). */
function claudePids(procs: readonly ProcUse[]): Set<number> {
  const pids = new Set(procs.filter(p => CLAUDE.test(p.name)).map(p => p.pid))
  for (let grew = true; grew; ) {
    grew = false
    for (const p of procs) {
      if (!pids.has(p.pid) && pids.has(p.ppid)) {
        pids.add(p.pid)
        grew = true
      }
    }
  }
  return pids
}

export function claudeGroup(procs: readonly ProcUse[]): { count: number; memMb: number } {
  const pids = claudePids(procs)
  return {
    count: procs.filter(p => CLAUDE.test(p.name)).length,
    memMb: procs.filter(p => pids.has(p.pid)).reduce((sum, p) => sum + p.memMb, 0),
  }
}

const gb = (mb: number): string => `${(mb / 1024).toFixed(1)} GB`
const usedPct = (f: FastFacts): number => 100 * (1 - f.freeMb / f.totalMb)

/** "Claude ×5 6.4 GB · chrome 2.1 GB · Code 0.9 GB": Claude first, then the two biggest others. */
function memoryDetail(procs: readonly ProcUse[]): string {
  const pids = claudePids(procs)
  const byName = new Map<string, number>()
  for (const p of procs) if (!pids.has(p.pid)) byName.set(p.name, (byName.get(p.name) ?? 0) + p.memMb)
  const others = [...byName].sort((a, b) => b[1] - a[1]).slice(0, 2)
  const claude = claudeGroup(procs)
  return [
    ...(claude.count > 0 ? [`Claude ×${claude.count} ${gb(claude.memMb)}`] : []),
    ...others.map(([name, mb]) => `${name} ${gb(mb)}`),
  ].join(' · ')
}

/** CPU share of all cores per process name between two checks. */
function cpuShares(a: FastFacts, b: FastFacts): Map<string, number> {
  const seconds = (b.at - a.at) / 1000
  const before = new Map(a.procs.map(p => [p.pid, p]))
  const used = new Map<string, number>()
  if (seconds <= 0) return used
  for (const p of b.procs) {
    const was = before.get(p.pid)
    if (!was || was.name !== p.name || IDLE.test(p.name) || p.pid === 0) continue
    used.set(p.name, (used.get(p.name) ?? 0) + Math.max(0, p.cpuSec - was.cpuSec))
  }
  return new Map([...used].map(([name, sec]) => [name, sec / (seconds * b.cores)]))
}

function memoryTip(fast: readonly FastFacts[]): Tip[] {
  const [before, latest] = fast.slice(-2)
  if (!before || !latest || usedPct(before) < MEMORY_RED_PCT || usedPct(latest) < MEMORY_RED_PCT) return []
  return [{ id: 'memory', level: 'red', title: `Memory ${Math.round(usedPct(latest))}% full`, detail: memoryDetail(latest.procs), snoozeMs: DAY }]
}

function cpuTips(fast: readonly FastFacts[]): Tip[] {
  const [s0, s1, s2] = fast.slice(-3)
  if (!s0 || !s1 || !s2) return []
  const first = cpuShares(s0, s1)
  const second = cpuShares(s1, s2)
  const tips: Tip[] = []
  for (const [name, share] of second) {
    const earlier = first.get(name) ?? 0
    if (share < CPU_SHARE || earlier < CPU_SHARE) continue
    const minutes = Math.round((s2.at - s0.at) / 60_000)
    tips.push({
      id: `cpu:${name}`,
      level: 'red',
      title: `${name} keeps the CPU busy`,
      detail: `About ${Math.round(100 * Math.min(share, earlier))}% of all ${s2.cores} cores for ${minutes} min`,
      snoozeMs: DAY,
    })
  }
  return tips
}

function restartTip(slow: SlowFacts, now: number): Tip[] {
  if (slow.rebootPending) {
    return [{ id: 'restart', level: 'yellow', title: 'Windows Update is waiting for a restart', detail: 'Updates finish installing when Windows restarts', snoozeMs: DAY }]
  }
  const days = Math.floor((now - slow.bootAt) / DAY)
  if (days < UPTIME_DAYS) return []
  return [{ id: 'restart', level: 'yellow', title: `Running ${days} days without a restart`, detail: 'A restart gives back memory that programs never freed', snoozeMs: DAY }]
}

function startupTips(slow: SlowFacts, known: readonly string[] | null): Tip[] {
  if (known === null) return []
  return slow.startup
    .filter(name => !known.includes(name))
    .map(name => ({
      id: `startup:${name}`,
      level: 'yellow' as const,
      title: `New at startup: ${name}`,
      detail: 'It now starts with Windows; if you did not add it, Task Manager can switch it off',
      snoozeMs: DAY,
    }))
}

function unusedTip(slow: SlowFacts, now: number): Tip[] {
  // No launch record says nothing about an app: only a record 90+ days old counts.
  const old = slow.apps.filter(app => !app.isUsed && app.lastRun !== null && now - app.lastRun >= UNUSED_DAYS * DAY)
  if (old.length === 0) return []
  const names = old.slice(0, 4).map(app => app.name)
  return [
    {
      id: 'unused-apps',
      level: 'yellow',
      title: `${old.length} app${old.length === 1 ? '' : 's'} not opened in ${UNUSED_DAYS}+ days`,
      detail: `${names.join(', ')}${old.length > names.length ? ` and ${old.length - names.length} more` : ''}`,
      snoozeMs: 30 * DAY,
    },
  ]
}

/** The tips now, red first; one the person snoozed stays hidden until its time. */
export function tipsOf(state: PcState, now: number): Tip[] {
  const slow = state.slow
  const all = [
    ...memoryTip(state.fast),
    ...cpuTips(state.fast),
    ...(slow ? [...restartTip(slow, now), ...startupTips(slow, state.knownStartup), ...unusedTip(slow, now)] : []),
  ]
  const shown = all.filter(tip => (state.snoozes[tip.id] ?? 0) <= now)
  return [...shown.filter(tip => tip.level === 'red'), ...shown.filter(tip => tip.level === 'yellow')]
}

/** What Fix it sends to Claude: the tip, and the rule that nothing runs without the person's yes. */
export function fixPrompt(tip: Tip): string {
  return [
    `A PC tip from Clawd: ${tip.title}.`,
    `Details: ${tip.detail}.`,
    'This is Windows. Look into it with read-only commands first.',
    'Propose the commands to fix this and wait for my approval before running each one.',
  ].join('\n')
}
