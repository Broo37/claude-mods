// What Clean View keeps for the session, for itself and for any mod that wants
// to read the checklist: whether it is on, the job's checklist, the frame
// counter its animation runs on, and which steps the person opened in the band.

export type CleanViewStatus = 'done' | 'active' | 'upcoming'

// One thing Claude did in a step, in plain words, and how it went.
export type CleanViewAction = {
  // The tool call's id, by which its end finds it.
  id: string
  text: string
  status: 'running' | 'ok' | 'failed'
  startedAt: number
  // How long it took, once it ended.
  ms?: number
  // Why it failed, in a line.
  why?: string
}

export type CleanViewTask = {
  id: string
  name: string
  // The emoji Claude started the step's name with, one of the set; where it
  // picked none, the checklist guesses one from the name as it draws.
  icon?: string
  status: CleanViewStatus
  // 0 to 100, as last reported for the step.
  percent: number
  // False until progress was reported for the step: its meter sweeps till then.
  hasReported: boolean
  // Claude's one-line note on what it found or did in the step.
  note?: string
  // What Claude did in the step, the newest few, oldest first, and how many
  // older ones were let go.
  actions?: CleanViewAction[]
  earlier?: number
}

export type CleanViewPhase = 'idle' | 'working' | 'needs-you' | 'stuck' | 'stopped' | 'done'

export type CleanViewChecklist = {
  title: string
  phase: CleanViewPhase
  tasks: CleanViewTask[]
  needsYouReason: string | null
  stuckReason: string | null
  startedAt: number | null
  finishedAt: number | null
}

// Which of the band's two tabs is in front, where another mod draws in the
// band too: the checklist, or that mod's band.
export type CleanViewTab = 'checklist' | 'status'

// One run of a lent panel's row: its text, and its color as a theme key.
export type CleanViewRun = { text: string; color?: string; isBold?: boolean; isDim?: boolean; isInverse?: boolean }

// The checklist as a panel another mod draws in a box of its own (the Deck): a
// title and what stands at its right, a label for that mod's header, and rows.
export type CleanViewPanel = {
  id: 'plan'
  title: string
  right: string
  label: CleanViewRun[]
  rows: CleanViewRun[][]
  // Whether the panel moves on its own: a job that runs, or waits on the person.
  isLive?: boolean
  // The panel in one line, for a host's mini summary.
  summary?: CleanViewRun[]
}

// The mod that hosts the checklist, and whether its pane is in the dock now.
export type CleanViewHost = { by: string; isDocked: boolean }

// What Clean View lends another mod: its checklist as a panel, and a way to
// host it, so the Steps tab stands aside.
export type CleanView = {
  panel(args: { id: 'plan'; columns: number }): Promise<CleanViewPanel>
  host(args: CleanViewHost): Promise<boolean>
}

declare module 'claude-code' {
  interface EngineInterface {
    cleanView: CleanView
  }

  interface PluginState {
    'clean-view': {
      cleanViewEnabled: boolean
      checklist: CleanViewChecklist
      tick: number
      tab: CleanViewTab
      opened: string[]
      host: CleanViewHost | null
    }
  }
}
