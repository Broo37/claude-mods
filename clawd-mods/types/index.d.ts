/** One limit window: percent used and when it resets (epoch ms; null = not started). */
export type LimitWindow = { pct: number; resetsAt: number | null }

/** A "Last 24h" / "Last 7d" block of `/usage`, its lines kept as printed. */
export type Period = { header: string; requests: number; sessions: number; lines: string[] }

export type Limits = {
  session: LimitWindow | null
  week: LimitWindow | null
  /** Absent when `/usage` prints no Fable line. */
  fable: LimitWindow | null
  day: Period | null
  week7: Period | null
  /** When the 5-hour and weekly figures were read, and from where. */
  at: number
  source: 'probe' | 'builtin'
  /** When `claude -p /usage` last answered (Fable row and breakdown); 0 = never. */
  probedAt: number
  isStale: boolean
}

export type SessionStatus = 'busy' | 'waiting' | 'idle'

export type SessionRow = {
  pid: number
  name: string
  cwd: string
  status: SessionStatus
  waitingFor: string
}

export type Mood = 'idle' | 'work' | 'wait' | 'dead'

/** Something Clawd reacts to once: a session finished (he hops), the 5-hour reset (confetti), a reminder rang (he hops). */
export type ClawdEvent = { id: number; kind: 'finished' | 'reset' | 'bell' }

export type SkyKind = 'clear' | 'cloudy' | 'overcast' | 'fog' | 'drizzle' | 'rain' | 'storm' | 'snow'

export type Place = { city: string; lat: number; lon: number }

/** The weather now, from Open-Meteo or met.no; sunrise and sunset are that day's. */
export type Weather = {
  city: string
  tempC: number
  kind: SkyKind
  windKmh: number
  windFromDeg: number
  isDay: boolean
  sunrise: number
  sunset: number
  at: number
}

export type Repeat = 'daily' | 'weekly' | 'monthly' | 'yearly'

/** A reminder (machine-wide). `firedAt`/`firedBy`: rung, and by which session, until Done or a snooze. */
export type Reminder = {
  id: string
  at: number
  text: string
  repeat: Repeat | null
  firedAt: number | null
  firedBy: string | null
  /** It fell due while no session with this mod was open, and rang late. */
  isLate: boolean
  /** +15m / +1h: rings then instead; its own time (and a repeat's schedule) stays. */
  snoozeUntil: number | null
}

/** A project of the week: its folder's name, its share of the weighted tokens in percent. */
export type ProjectShare = { name: string; share: number }

/** One limits reading: when, the 5-hour percent, the week percent. */
export type Sample = { at: number; s: number | null; w: number | null }

/** An incident on status.claude.com: its level, the newest unresolved incident's name, the parts hit. */
export type ServiceAlert = { level: 'minor' | 'major'; title: string; parts: string[]; since: number }

/** /clawd play, demo or auto: what Clawd is told to do; `id` tells one request from the next. */
export type Control = { kind: 'auto' } | { kind: 'play'; act: string; id: number } | { kind: 'demo'; id: number }

/** One cell of a surface module's grid, and a run of cells drawn alike. */
export type Cell = { ch: string; fg?: string; bg?: string; dim?: true }
export type Run = { text: string; fg?: string; bg?: string; dim?: true }

/** A PC tip (hooks/pc.ts): red ones make Clawd worried; Not now hides it for `snoozeMs`. */
export type Tip = { id: string; level: 'red' | 'yellow'; title: string; detail: string; snoozeMs: number }

export type ClawdView = {
  limits: Limits | null
  /** Other live sessions of this account (this one and the mod's probes left out). */
  sessions: SessionRow[]
  mood: Mood
  halves: number | null
  isCrit: boolean
  event: ClawdEvent | null
  /** The minute this was drawn for, so countdowns redraw once a minute. */
  minute: number
  /** PC tips, red first; empty off Windows. */
  tips: Tip[]
  /** The last PC check failed: the tips may be old. */
  pcStale: boolean
  /** Where the sky is: the `city` option, or found from the internet address; null until known. */
  place: Place | null
  weather: Weather | null
  /** The last weather fetch failed: `weather` is the last reading. */
  weatherStale: boolean
  control: Control
  /** An incident on status.claude.com; null while all is operational. */
  alert: ServiceAlert | null
  /** When the status page last answered; stale: too long ago, so the ! is down and the pane says so. */
  alertAt: number
  alertStale: boolean
  /** The 7-day limits history, the most of each hour, oldest first. */
  history: Sample[]
  /** This week's top projects on this PC; null until the first count (or off Windows). */
  projects: ProjectShare[] | null
  /** Ringing ones (until Done or a snooze), then up to three coming up. */
  reminders: { due: Reminder[]; next: Reminder[] }
}

declare module 'claude-code' {
  interface PluginState {
    'clawd-mods': { view: ClawdView | null }
  }
}
