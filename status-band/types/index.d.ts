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
  // Whether the person closed the Status tab: the band stands in for it until they ask again.
  isStatusClosed: boolean
  mode: string
  peers: Peer[]
  startedAt: number
  git: Git | null
  codex: Codex | null
  turn: Turn | null
}

// One run of a lent panel's row: its text and how it is drawn, colors as `rgb(r,g,b)`.
export type StatusBandRun = { text: string; color?: string; backgroundColor?: string; isBold?: boolean; isDim?: boolean }

// The limits, or the other sessions, as a panel another mod draws in a box of
// its own (the Deck): a title and what stands at its right, a label for that
// mod's header, and rows.
export type StatusBandPanel = {
  id: 'limits' | 'sessions'
  title: string
  right: string
  label: StatusBandRun[]
  rows: StatusBandRun[][]
  isLive?: boolean
  // The panel in one line, for a host's mini summary.
  summary?: StatusBandRun[]
}

// The mod that hosts the status, and whether its pane is in the dock now.
export type StatusBandHost = { by: string; isDocked: boolean }

// What status-band lends another mod: its panel, and a way to host it, so the
// Status tab stands aside, and the band too while the host is docked.
export type StatusBand = {
  panel(args: { id: 'limits' | 'sessions'; columns: number; rows?: number }): Promise<StatusBandPanel>
  host(args: StatusBandHost): Promise<boolean>
}

declare module 'claude-code' {
  interface EngineInterface {
    statusBand: StatusBand
  }

  interface PluginState {
    'status-band': { view: Shaped<View>; host: StatusBandHost | null }
  }
}
