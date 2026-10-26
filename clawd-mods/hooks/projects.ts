// Top projects this week: scripts/projects.ps1 sums each project's weighted
// tokens from this account's session logs (once an hour, one session per
// account); this turns its answer into the pane's rows. An estimate: it sees
// only this PC's logs.

import type { ProjectShare } from '../types'

export type { ProjectShare }

const TOP = 5

/** The top five, each a rounded percent of all projects; null when the answer is not the script's. */
export function parseProjects(stdout: string): ProjectShare[] | null {
  let raw: unknown
  try {
    raw = JSON.parse(stdout.trim())
  } catch {
    return null
  }
  const list = (raw as { projects?: unknown } | null)?.projects
  // PowerShell 5.1 prints a one-item list as the item itself.
  const items = Array.isArray(list) ? list : typeof list === 'object' && list !== null ? [list] : null
  if (items === null) return null
  const rows = items
    .map(item => item as { cwd?: unknown; weight?: unknown })
    .filter((item): item is { cwd: string; weight: number } => typeof item.cwd === 'string' && typeof item.weight === 'number' && item.weight > 0)
  const total = rows.reduce((sum, row) => sum + row.weight, 0)
  const top = [...rows].sort((a, b) => b.weight - a.weight).slice(0, TOP)
  const parts = top.map(row => row.cwd.split(/[\\/]+/).filter(Boolean))
  const leaf = (p: string[]): string => p[p.length - 1] ?? '?'
  return top.map((row, i) => {
    const p = parts[i] ?? []
    // Two folders of one name keep their parent: blog/api, shop/api.
    const isTwin = parts.some((other, j) => j !== i && leaf(other).toLowerCase() === leaf(p).toLowerCase())
    const name = isTwin && p.length > 1 ? `${p[p.length - 2]}/${leaf(p)}` : leaf(p)
    return { name, share: Math.round((100 * row.weight) / total) }
  })
}
