// The /clawd pane, Roomy style: per section a colored ▌ bar and a capital
// title, an empty line between sections, items indented under their title.
// Nothing wraps: the dock is about 42 columns, so every row truncates.

import type { BoxProps, ButtonProps, ElementConstructor, RenderElement, RenderNode, TextProps } from 'claude-code'

import type { ClawdView, Limits, LimitWindow, Period, SessionRow, SkyKind, Tip } from '../types'
import { SUN_GLYPH, moonGlyph, moonLit, moonPhase } from './sky'
import { BELL } from './clawd'
import { buckets, sparkline } from './history'
import { REPEAT_WORDS, whenDue, whenText } from './remind'
import { HEART_GLYPH, LEVEL_COLOR, MINUTE, bar, countSessions, countdown, hearts, levelOf, pctText, shortStamp } from './usage'

/** Top to bottom, the order the sections are drawn in. */
export const SECTION_COLOR = {
  tips: '#F87171',
  status: '#FBBF24',
  reminders: '#22D3EE',
  weather: '#60A5FA',
  limits: '#D77757',
  sessions: '#4ADE80',
  projects: '#C084FC',
  usage: '#E5E7EB',
} as const

export type SectionId = keyof typeof SECTION_COLOR

export const HEART_COLOR = { full: '#F87171', half: '#F9A8A8', empty: '#52525B' } as const

/** The elements of `$.ui.resolve(e)` the pane draws with. */
export type PaneElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
}

/** What the pane's buttons do; each gets the id of the tip or reminder. */
export type PaneHandlers = {
  fix: (id: string) => void
  snooze: (id: string) => void
  done: (id: string) => void
  later: (id: string, ms: number) => void
}

const TIP_COLOR: Record<Tip['level'], string> = { red: LEVEL_COLOR.crit, yellow: LEVEL_COLOR.warn }

const KIND_WORD: Record<SkyKind, string> = {
  clear: 'clear',
  cloudy: 'cloudy',
  overcast: 'overcast',
  fog: 'fog',
  drizzle: 'drizzle',
  rain: 'rain',
  storm: 'thunderstorm',
  snow: 'snow',
}

/** "5:28", "17:45": this PC's own clock. */
const hm = (at: number): string => {
  const d = new Date(at)
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

const LABEL = 8 // "5-hour  ", the reset lines indent to the bar
const BAR = 10
const PERCENT = /(\d+(?:\.\d+)?%)/

/**
 * One section, or null when it has nothing to show. `extra` follows the title,
 * dim when it is text; `color` stands in for the section's own (a major outage is red).
 */
export function section(
  el: PaneElements,
  id: SectionId,
  title: string,
  extra: RenderNode,
  body: RenderNode[],
  isFirst: boolean,
  color?: string,
): RenderElement | null {
  if (body.length === 0) return null
  const { Box, Text } = el
  return (
    <Box key={title.toLowerCase().replace(/\s+/g, '-')} flexDirection="column" marginTop={isFirst ? 0 : 1}>
      <Text wrap="truncate-end">
        <Text color={color ?? SECTION_COLOR[id]} weight="bold">
          ▌ {title}
        </Text>
        {extra !== '' && '  '}
        {typeof extra === 'string' && extra !== '' ? <Text dimColor>{extra}</Text> : extra}
      </Text>
      <Box flexDirection="column" paddingLeft={2}>
        {body}
      </Box>
    </Box>
  )
}

/**
 * One line of the /usage breakdown: a leading percent colored by its level,
 * a "Top …:" line with each percent colored, anything else dim, as printed.
 */
export function usageLine(el: PaneElements, line: string): RenderElement {
  const { Text } = el
  const tint = (part: string) => <Text color={LEVEL_COLOR[levelOf(Number.parseFloat(part))]}>{part}</Text>
  const lead = /^(\d+(?:\.\d+)?%)(.*)$/.exec(line)
  if (lead) {
    return (
      <Text wrap="truncate-end">
        {tint(lead[1] ?? '')}
        {lead[2]}
      </Text>
    )
  }
  if (/^Top [^:]+:/.test(line)) {
    return <Text wrap="truncate-end">{line.split(PERCENT).map(part => (PERCENT.test(part) ? tint(part) : part))}</Text>
  }
  return (
    <Text dimColor wrap="truncate-end">
      {line}
    </Text>
  )
}

/** Each tip: its title, a dim line of detail, then Fix it and Not now. */
function tipRows(el: PaneElements, v: ClawdView, handlers: PaneHandlers): RenderNode[] {
  const { Box, Text, Button } = el
  const rows = v.tips.flatMap(tip => [
    <Text wrap="truncate-end">
      <Text color={TIP_COLOR[tip.level]}>●</Text> {tip.title}
    </Text>,
    <Text dimColor wrap="truncate-end">
      {'  '}
      {tip.detail}
    </Text>,
    <Box paddingLeft={2} gap={2}>
      <Button key={`fix:${tip.id}`} label="Fix it" variant="primary" onPress={() => handlers.fix(tip.id)} />
      <Button key={`snooze:${tip.id}`} label="Not now" dimColor onPress={() => handlers.snooze(tip.id)} />
    </Box>,
  ])
  if (rows.length > 0 && v.pcStale) {
    rows.push(
      <Text color={LEVEL_COLOR.warn} wrap="truncate-end">
        Last check failed: these may be out of date.
      </Text>,
    )
  }
  return rows
}

/** Ringing reminders first, each with Done, +15m and +1h; then the next few, dim. */
function reminderRows(el: PaneElements, v: ClawdView, now: number, handlers: PaneHandlers): RenderNode[] {
  const { Box, Text, Button } = el
  const cyan = SECTION_COLOR.reminders
  return [
    ...v.reminders.due.flatMap(r => [
      <Text wrap="truncate-end">
        <Text color={cyan}>{BELL}</Text>
        {` ${whenText(r.at, now)}  ${r.text}`}
        {r.isLate && <Text color={LEVEL_COLOR.warn}> · late</Text>}
      </Text>,
      <Box paddingLeft={2} gap={2}>
        <Button key={`done:${r.id}`} label="Done" variant="primary" onPress={() => handlers.done(r.id)} />
        <Button key={`later15:${r.id}`} label="+15m" dimColor onPress={() => handlers.later(r.id, 15 * MINUTE)} />
        <Button key={`later60:${r.id}`} label="+1h" dimColor onPress={() => handlers.later(r.id, 60 * MINUTE)} />
      </Box>,
    ]),
    ...v.reminders.next.map(r => (
      <Text wrap="truncate-end">
        <Text color={cyan}>{whenText(whenDue(r), now)}</Text>
        {`  ${r.text}`}
        <Text dimColor>{`  in ${countdown(whenDue(r) - now)}${r.repeat ? ` · ${REPEAT_WORDS[r.repeat]}` : ''}`}</Text>
      </Text>
    )),
  ]
}

/** During an incident: its name, then a dim line of since when and what it hits. */
function statusRows(el: PaneElements, v: ClawdView): RenderNode[] {
  const { Text } = el
  const a = v.alert
  if (a === null) return []
  return [
    <Text wrap="truncate-end">
      <Text color={a.level === 'major' ? LEVEL_COLOR.crit : LEVEL_COLOR.warn} weight="bold">
        !
      </Text>{' '}
      {a.title}
    </Text>,
    <Text dimColor wrap="truncate-end">
      {`since ${hm(a.since)}${a.parts.length > 0 ? ` · ${a.parts.join(', ')}` : ''}`}
    </Text>,
    ...(v.alertStale
      ? [
          <Text dimColor wrap="truncate-end">
            {`as of ${hm(v.alertAt)} · status page unreachable`}
          </Text>,
        ]
      : []),
  ]
}

/** One line of now, one dim line of the sun and the moon; a note when it is an old reading. */
function weatherRows(el: PaneElements, v: ClawdView, now: number): RenderNode[] {
  const { Text } = el
  const w = v.weather
  if (w === null) return []
  const isDay = now >= w.sunrise && now <= w.sunset
  const phase = moonPhase(now)
  const rows: RenderNode[] = [
    <Text wrap="truncate-end">
      <Text color={isDay ? '#FDE047' : '#E5E7EB'}>{isDay ? SUN_GLYPH : moonGlyph(phase)}</Text>
      {` ${Math.round(w.tempC)}°C · ${KIND_WORD[w.kind]} · wind ${Math.round(w.windKmh)} km/h`}
    </Text>,
    <Text dimColor wrap="truncate-end">
      {`↑ ${hm(w.sunrise)}  ↓ ${hm(w.sunset)} · moon ${moonGlyph(phase)} ${moonLit(phase)}% lit`}
    </Text>,
  ]
  if (v.weatherStale) {
    rows.push(
      <Text color={LEVEL_COLOR.warn} wrap="truncate-end">
        No connection: read {countdown(now - w.at)} ago.
      </Text>,
    )
  }
  return rows
}

function limitsExtra(el: PaneElements, v: ClawdView): RenderNode {
  const { Text } = el
  if (v.halves === null) return ''
  return (
    <Text>
      {hearts(v.halves).map(kind => (
        <Text color={HEART_COLOR[kind]}>{HEART_GLYPH[kind]}</Text>
      ))}
      <Text dimColor> {Math.round(100 - (v.limits?.session?.pct ?? 0))}% left</Text>
    </Text>
  )
}

/**
 * The 7-day chart under the limits: the 5-hour figure in its level's color,
 * the week's in blue beneath; nothing until there is a reading.
 */
function chartRows(el: PaneElements, v: ClawdView, cols: number, now: number): RenderNode[] {
  const { Text } = el
  if (v.history.length === 0) return []
  const width = Math.max(8, cols - 12)
  const week = buckets(v.history, now, width, 'w')
  return [
    <Text wrap="truncate-end">
      {'7 days'.padEnd(LABEL)}
      <Text color={LEVEL_COLOR[levelOf(v.limits?.session?.pct ?? 0)]}>{sparkline(buckets(v.history, now, width, 's'))}</Text>
    </Text>,
    ...(week.some(value => value !== null)
      ? [
          <Text wrap="truncate-end">
            {' '.repeat(LABEL)}
            <Text color="#60A5FA">{sparkline(week)}</Text>
          </Text>,
        ]
      : []),
  ]
}

function limitsBody(el: PaneElements, lim: Limits | null, now: number, chart: RenderNode[]): RenderNode[] {
  const { Text } = el
  if (lim === null) {
    return [
      <Text dimColor wrap="truncate-end">
        No figures yet: waiting for /usage or a reply.
      </Text>,
    ]
  }
  const age = (at: number): string => (at === 0 ? 'never' : `${countdown(now - at + MINUTE / 2)} ago`)
  const row = (label: string, w: LimitWindow | null): RenderNode[] =>
    w === null
      ? []
      : [
          <Text wrap="truncate-end">
            {label.padEnd(LABEL)}
            <Text color={LEVEL_COLOR[levelOf(w.pct)]}>{bar(w.pct, BAR)}</Text>
            {pctText(w.pct).padStart(5)}
          </Text>,
          <Text dimColor wrap="truncate-end">
            {' '.repeat(LABEL)}
            {w.resetsAt === null ? 'not started yet' : `resets ${shortStamp(w.resetsAt, now)} · in ${countdown(w.resetsAt - now)}`}
          </Text>,
        ]
  return [
    ...row('5-hour', lim.session),
    ...row('Week', lim.week),
    ...row('Fable', lim.fable),
    ...chart,
    <Text dimColor wrap="truncate-end">
      read {age(lim.at)} {lim.source === 'builtin' ? 'from replies' : 'from /usage'}
      {lim.source === 'builtin' && ` · /usage ${age(lim.probedAt)}`}
    </Text>,
    ...(lim.isStale
      ? [
          <Text color={LEVEL_COLOR.warn} wrap="truncate-end">
            Stale: the last /usage probe failed or is old.
          </Text>,
        ]
      : []),
  ]
}

function sessionRow(el: PaneElements, row: SessionRow, nameWidth: number): RenderElement {
  const { Text } = el
  const [glyph, state, color] =
    row.status === 'busy'
      ? ['▶', 'working', LEVEL_COLOR.ok]
      : row.status === 'waiting'
        ? ['?', row.waitingFor === '' ? 'waiting' : `waits for ${row.waitingFor}`, LEVEL_COLOR.warn]
        : ['○', 'idle', undefined]
  return (
    <Text wrap="truncate-end">
      <Text color={color} dimColor={color === undefined}>
        {glyph}
      </Text>{' '}
      {row.name.padEnd(nameWidth)}{' '}
      <Text color={color} dimColor={color === undefined}>
        {state}
      </Text>
    </Text>
  )
}

/** A row a project, its share in purple, and a dim line that it is an estimate. */
function projectRows(el: PaneElements, v: ClawdView, cols: number): RenderNode[] {
  const { Text } = el
  const rows = v.projects ?? []
  if (rows.length === 0) return []
  const width = Math.min(Math.max(...rows.map(row => row.name.length)), Math.max(8, cols - 10))
  return [
    ...rows.map(row => (
      <Text wrap="truncate-end">
        {`${row.name.padEnd(width)}  `}
        <Text color={SECTION_COLOR.projects}>{`${row.share}%`}</Text>
      </Text>
    )),
    <Text dimColor wrap="truncate-end">
      estimated from this PC's logs
    </Text>,
  ]
}

function sessionsExtra(rows: readonly SessionRow[]): string {
  const c = countSessions(rows)
  return `${c.running} open · ${c.working} busy${c.waiting > 0 ? ` · ${c.waiting} waiting` : ''}`
}

/** "Last 24h · 360 requests · 5 sessions" → its counts, as printed. */
function periodExtra(period: Period): string {
  return period.header.split(' · ').slice(1).join(' · ')
}

/** The whole pane, top to bottom; a section with nothing to show is left out. */
export function renderPane(el: PaneElements, v: ClawdView, cols: number, now: number, handlers: PaneHandlers): RenderElement {
  const { Box } = el
  const lim = v.limits
  // Names line up while they fit: indent, glyph and the state get the rest.
  const nameWidth = Math.min(Math.max(0, ...v.sessions.map(row => row.name.length)), Math.max(6, cols - 16))
  const specs: [SectionId, string, RenderNode, RenderNode[], string?][] = [
    ['tips', 'TIPS', String(v.tips.length), tipRows(el, v, handlers)],
    ['status', 'CLAUDE STATUS', '', statusRows(el, v), v.alert?.level === 'major' ? LEVEL_COLOR.crit : undefined],
    ['reminders', 'REMINDERS', '', reminderRows(el, v, now, handlers)],
    ['weather', 'WEATHER', v.weather?.city ?? '', weatherRows(el, v, now)],
    ['limits', 'LIMITS', limitsExtra(el, v), limitsBody(el, lim, now, chartRows(el, v, cols, now))],
    ['sessions', 'SESSIONS', sessionsExtra(v.sessions), v.sessions.map(row => sessionRow(el, row, nameWidth))],
    ['projects', 'PROJECTS', 'this week', projectRows(el, v, cols)],
    ...([
      ['LAST 24 HOURS', lim?.day],
      ['LAST 7 DAYS', lim?.week7],
    ] as const).map(([title, period]): [SectionId, string, RenderNode, RenderNode[]] => [
      'usage',
      title,
      period ? periodExtra(period) : '',
      period ? period.lines.map(line => usageLine(el, line)) : [],
    ]),
  ]
  const shown = specs.filter(spec => spec[3].length > 0)
  return (
    <Box flexDirection="column">
      {shown.map(([id, title, extra, body, color], i) => section(el, id, title, extra, body, i === 0, color))}
    </Box>
  )
}
