export type Limit = { kind: string; percentUsed: number; resetsAt: number | null }

export type Git = {
  branch: string
  ahead: number
  behind: number
  staged: number
  unstaged: number
  untracked: number
}

export type Codex = { percent: number; resetsAt: number; readAt: number }

export type Turn = { seconds: number; tools: number }

// Another Claude Code session running on this machine, as the presence file
// Claude Code keeps for it says: what it is doing, since when, and what it is
// waiting on the person for, if anything.
export type Peer = { id: string; name: string; status: string; since: number; needs: string }

export type View = {
  now: number
  model: string
  effort: string
  style: string
  cwd: string
  home: string
  env: string
  account: string
  contextTokens: number
  contextWindow: number
  contextPercent: number
  limits: Limit[]
  costUsd: number
  isBoardClosed: boolean
  mode: string
  peers: Peer[]
  startedAt: number
  git: Git | null
  codex: Codex | null
  turn: Turn | null
}

declare module 'claude-code' {
  interface PluginState {
    'status-band': { view: Shaped<View> }
  }
}
