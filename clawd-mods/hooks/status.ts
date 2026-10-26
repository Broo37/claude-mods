// Claude's own status page (status.claude.com, a Statuspage site): read every
// 2 minutes by one session for the machine. Nothing shows while all is
// operational; during an incident a ! stands over Clawd and the pane names it.

import type { ServiceAlert } from '../types'

export type { ServiceAlert }

type Incident = { name: string; status: string; created_at: string }
type Component = { name: string; status: string; group?: boolean }
type Summary = {
  page?: { updated_at?: string }
  status?: { indicator?: string; description?: string }
  components?: Component[]
  incidents?: Incident[]
}

const DONE = new Set(['resolved', 'postmortem', 'completed'])

/** "Claude API (api.anthropic.com)" → "Claude API": the host is noise in a narrow pane. */
const shortName = (name: string): string => name.replace(/\s*\([^)]*\)\s*$/, '')

/** The summary as an alert: null while the indicator says none (or the page is unreadable). */
export function parseSummary(json: string): ServiceAlert | null {
  let s: Summary
  try {
    s = JSON.parse(json) as Summary
  } catch {
    return null
  }
  const indicator = s?.status?.indicator
  if (typeof indicator !== 'string' || indicator === 'none') return null
  const open = (s.incidents ?? [])
    .filter(one => typeof one?.name === 'string' && !DONE.has(one.status))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  const newest = open[0]
  const since = Date.parse(newest?.created_at ?? s.page?.updated_at ?? '')
  return {
    level: indicator === 'major' || indicator === 'critical' ? 'major' : 'minor',
    title: newest?.name ?? s.status?.description ?? 'Claude has a problem',
    parts: (s.components ?? []).filter(c => !c.group && c.status !== 'operational').map(c => shortName(c.name)),
    since: Number.isFinite(since) ? since : 0,
  }
}
