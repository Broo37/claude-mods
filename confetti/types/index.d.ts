// What Confetti keeps for the session: the burst on screen, while one plays.
// It starts at `startedAt` and throws the bits its `seed` picks.

export type ConfettiBurst = { startedAt: number; seed: number } | null

declare module 'claude-code' {
  interface PluginState {
    confetti: { burst: ConfettiBurst }
  }
}
