// The world beneath the mod in the engine tests: a config dir in memory,
// `tasklist`, the /usage probe and a clock. Shared by the test files.

import type { FsEntry, On } from 'claude-code'
import { type Engine, mock } from 'claude-code/testing'

export const MIN = 60_000
export const NOW = new Date(2026, 9, 22, 23, 30).getTime()
export const at = (month: number, day: number, hour: number, minute = 0, year = 2026): number =>
  new Date(year, month, day, hour, minute).getTime()

// What `claude -p /usage --output-format text` printed on this machine, 2026-10-22.
export const SAMPLE = [
  'You are currently using your subscription to power your Claude Code usage',
  '',
  'Current session: 18% used · resets Oct 23, 1:29am (Asia/Bangkok)',
  'Current week (all models): 57% used · resets Oct 23, 12:59am (Asia/Bangkok)',
  'Current week (Fable): 69% used · resets Oct 23, 12:59am (Asia/Bangkok)',
  '',
  "What's contributing to your limits usage?",
  'Approximate · sessions on this machine only · shares overlap',
  '',
  'Last 24h · 360 requests · 5 sessions',
  '  86%  Give "general-purpose" subagents a cheaper model',
  '  76%  Start fresh when you switch tasks · run /clear',
  '  Top skills: /superpowers:writing-plans 13%, /plugin-authoring 3%',
  '  Top plugins: superpowers 39%',
  '',
  'Last 7d · 4558 requests · 83 sessions',
  '  78% of your usage was at >150k context',
  '  Top subagents: general-purpose 20%',
  '',
].join('\r\n')

export const CFG = 'C:/cfg'
export const BAND = {
  plugin: 'clawd-mods',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const
export const PANE = {
  plugin: 'clawd-mods',
  component: 'Pane',
  requestId: 'clawd',
  props: { title: 'Clawd', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

export type Session = { pid: number; sessionId?: string; name?: string; cwd?: string; status?: string; waitingFor?: string; entrypoint?: string; startedAt?: number }
/** What scripts/pc-check.ps1 prints for each `-Kind`; one that throws makes the run fail. */
export type Scripts = { fast: () => string; slow: () => string; projects: () => string }

/** A fast check's output at `usedPct` of 16 GB, with these processes. */
export function fastJson(usedPct: number, procs: { name: string; pid: number; ppid: number; memMb: number; cpuSec: number }[] = []): string {
  return JSON.stringify({ totalMb: 16_000, freeMb: Math.round(16_000 * (1 - usedPct / 100)), cores: 8, procs })
}

export const QUIET_SLOW = JSON.stringify({ rebootPending: false, bootAt: NOW - 3600_000, startup: ['OneDrive'], apps: [] })

/** The web as the tests see it: a URL prefix and its answer; anything else is offline. One that throws fails. */
export type Web = Record<string, () => string>

export type World = {
  files: Map<string, { text: string; mtimeMs: number }>
  runs: string[][]
  scripts: Scripts
  web: Web
  fetches: { url: string; headers: Record<string, string> }[]
  statuses: (string | undefined)[]
  toasts: string[]
  opened: string[]
  clock: ReturnType<typeof mock.clock>
  setSession: (s: Session, mtimeMs?: number) => void
}

/** The engine hands fs hooks a normalized path (backslashes on Windows): keys use slashes. */
export const norm = (path: string): string => path.replace(/\\/g, '/')

/** A map of files keyed by normalized path. */
class Files extends Map<string, { text: string; mtimeMs: number }> {
  override get(path: string) {
    return super.get(norm(path))
  }
  override set(path: string, file: { text: string; mtimeMs: number }) {
    return super.set(norm(path), file)
  }
}

/** Everything beneath the mod: a config dir in memory, `tasklist`, the probe, a clock. */
export function world(on: On, probeText: () => string, live: number[], opts: { os?: string } = {}): World {
  const files = new Files()
  const runs: string[][] = []
  const statuses: (string | undefined)[] = []
  const toasts: string[] = []
  const opened: string[] = []
  const scripts: Scripts = { fast: () => fastJson(50), slow: () => QUIET_SLOW, projects: () => '{"projects":[]}' }
  const web: Web = {}
  const fetches: World['fetches'] = []
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { CLAUDE_CONFIG_DIR: CFG, OS: opts.os ?? 'Windows_NT', LOCALAPPDATA: 'C:/L' })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // What lies beneath the band (the checklist, or the engine's own row): an empty row.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="beneath" />
  })
  on('session.id', () => ({ value: 'me' }))
  on('command.register', () => ({ value: { command: 'clawd' } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('fs.read', (_, e) => {
    const file = files.get(e.path)
    return file ? { value: file.text } : { deny: `ENOENT: ${e.path}` }
  })
  on('fs.write', (_, e) => {
    files.set(e.path, { text: e.text, mtimeMs: clock.now() })
    return { value: undefined }
  })
  on('fs.list', (_, e) => {
    const value: FsEntry[] = []
    const dir = norm(e.path)
    for (const [path, file] of files) {
      const name = path.slice(dir.length + 1)
      if (path.startsWith(`${dir}/`) && !name.includes('/')) {
        value.push({ name, kind: 'file', size: file.text.length, mtimeMs: file.mtimeMs, isLink: false })
      }
    }
    return { value }
  })
  on('http.fetch', (_, e) => {
    fetches.push({ url: e.url, headers: { ...e.init?.headers } })
    const answer = Object.entries(web).find(([prefix]) => e.url.startsWith(prefix))?.[1]
    if (!answer) return { deny: `offline: ${e.url}` }
    try {
      return { value: { status: 200, ok: true, headers: {}, text: answer() } }
    } catch (error) {
      return { deny: String(error) }
    }
  })
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    if (e.argv[0] === 'powershell.exe') {
      try {
        const stdout = e.argv.some(arg => arg.endsWith('projects.ps1'))
          ? scripts.projects()
          : e.argv.includes('slow')
            ? scripts.slow()
            : scripts.fast()
        return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      } catch (error) {
        return { deny: String(error) }
      }
    }
    const stdout = e.argv[0] === 'tasklist'
      ? live.map(pid => `"claude.exe","${pid}","Console","1","100 K"`).join('\r\n')
      : probeText()
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const setSession = (s: Session, mtimeMs = NOW - 20 * MIN): void => {
    files.set(`${CFG}/sessions/${s.pid}.json`, {
      text: JSON.stringify({ sessionId: `s${s.pid}`, cwd: `C:\\work\\p${s.pid}`, status: 'idle', entrypoint: 'cli', startedAt: NOW - 30 * MIN, ...s }),
      mtimeMs,
    })
  }
  return { files, runs, scripts, web, fetches, statuses, toasts, opened, clock, setSession }
}

export const probes = (w: World): string[][] => w.runs.filter(argv => argv[0] === 'claude')
export const pcRuns = (w: World, kind: 'fast' | 'slow'): number => w.runs.filter(argv => argv[0] === 'powershell.exe' && argv.includes(kind)).length
export const START = { cwd: 'C:/work', surface: 'terminal', isInteractive: true } as const

/** The /clawd pane on the terminal, mounted for one look and unmounted. */
export async function inPane($: Engine, text: RegExp): Promise<boolean> {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const found = await ui.find({ type: 'Text', text })
  await ui.unmount()
  return found !== undefined
}
