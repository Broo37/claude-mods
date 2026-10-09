// What Clean View keeps for the session, for itself and for any mod that wants
// to read the checklist: whether it is on, the job's checklist, and the frame
// counter its animation runs on.

export type CleanViewStatus = 'done' | 'active' | 'upcoming'

export type CleanViewTask = {
  id: string
  name: string
  status: CleanViewStatus
  // 0 to 100, as last reported for the step.
  percent: number
  // False until progress was reported for the step: its meter sweeps till then.
  hasReported: boolean
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
  isCollapsed: boolean
}

// Which of the band's two tabs is in front, where another mod draws in the
// band too: the checklist, or that mod's band.
export type CleanViewTab = 'checklist' | 'status'

declare module 'claude-code' {
  interface PluginState {
    'clean-view': { cleanViewEnabled: boolean; checklist: CleanViewChecklist; tick: number; tab: CleanViewTab }
  }
}
