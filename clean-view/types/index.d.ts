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

declare module 'claude-code' {
  interface PluginState {
    'clean-view': { cleanViewEnabled: boolean; checklist: CleanViewChecklist; tick: number; tab: CleanViewTab; opened: string[] }
  }
}
