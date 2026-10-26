import { describe, expect, test } from 'claude-code/testing'

import { BAND, CFG, MIN, NOW, PANE, SAMPLE, START, at, inPane, probes, world } from './world'

import { clawdCells } from '../hooks/clawd'
import {
  type ProbeCache,
  bar,
  countdown,
  heartHalves,
  heartsText,
  isProbeDue,
  isProbeEntry,
  levelOf,
  mergeLimits,
  moodOf,
  parseRegistryEntry,
  parseResetStamp,
  parseTasklist,
  parseUsage,
} from '../hooks/usage'

describe('parsing /usage', () => {
  test('reads the three limit lines and both breakdown blocks', () => {
    const u = parseUsage(SAMPLE, NOW)
    expect(u?.session).toEqual({ pct: 18, resetsAt: at(9, 23, 1, 29) })
    expect(u?.week).toEqual({ pct: 57, resetsAt: at(9, 23, 0, 59) })
    expect(u?.fable).toEqual({ pct: 69, resetsAt: at(9, 23, 0, 59) })
    expect(u?.day).toMatchObject({ header: 'Last 24h · 360 requests · 5 sessions', requests: 360, sessions: 5 })
    expect(u?.day?.lines).toEqual([
      '86%  Give "general-purpose" subagents a cheaper model',
      '76%  Start fresh when you switch tasks · run /clear',
      'Top skills: /superpowers:writing-plans 13%, /plugin-authoring 3%',
      'Top plugins: superpowers 39%',
    ])
    expect(u?.week7).toMatchObject({ requests: 4558, sessions: 83 })
    expect(u?.week7?.lines).toHaveLength(2)
  })

  test('no "resets" is 0% and not started; no Fable line is no Fable row', () => {
    const u = parseUsage('Current session: 0% used\nCurrent week (all models): 3% used · resets Oct 29, 6am\n', NOW)
    expect(u?.session).toEqual({ pct: 0, resetsAt: null })
    expect(u?.week).toEqual({ pct: 3, resetsAt: at(9, 29, 6) })
    expect(u?.fable).toBeNull()
    expect(u?.day).toBeNull()
  })

  test('reset stamps: minutes optional, the "at" form, next year past New Year', () => {
    expect(parseResetStamp('Oct 23, 6am (Asia/Bangkok)', NOW)).toBe(at(9, 23, 6))
    expect(parseResetStamp('Oct 23 at 2:29pm', NOW)).toBe(at(9, 23, 14, 29))
    expect(parseResetStamp('Oct 23, 12:05am', NOW)).toBe(at(9, 23, 0, 5))
    expect(parseResetStamp('Oct 23, 12pm', NOW)).toBe(at(9, 23, 12))
    const newYearsEve = at(11, 31, 22)
    expect(parseResetStamp('Jan 1, 3am', newYearsEve)).toBe(at(0, 1, 3, 0, 2027))
    expect(parseResetStamp('soon', NOW)).toBeNull()
  })

  test('a quiet day says "1 request" and "1 session"; lines it does not know are kept', () => {
    const u = parseUsage('Current session: 1% used · resets Oct 23, 1am\n\nLast 24h · 1 request · 1 session\n  A brand-new metric: 12%\n', NOW)
    expect(u?.day).toEqual({ header: 'Last 24h · 1 request · 1 session', requests: 1, sessions: 1, lines: ['A brand-new metric: 12%'] })
    expect(u?.week).toBeNull()
  })

  test('text with neither limit line is no reading', () => {
    expect(parseUsage('/usage is only available for subscription plans.', NOW)).toBeNull()
    expect(parseUsage('', NOW)).toBeNull()
  })
})

describe('hearts, bars and moods', () => {
  test('hearts are halves of the session limit left', () => {
    expect(heartHalves(36)).toBe(4)
    expect(heartsText(4)).toBe('♥♥♡')
    expect(heartHalves(18)).toBe(5)
    expect(heartsText(5)).toBe('♥♥❥')
    expect(heartHalves(0)).toBe(6)
    expect(heartHalves(99)).toBe(1)
    expect(heartHalves(100)).toBe(0)
    expect(heartsText(0)).toBe('♡♡♡')
    expect(heartHalves(null)).toBeNull()
  })

  test('green below 60%, yellow from 60%, red from 85%', () => {
    expect(levelOf(59)).toBe('ok')
    expect(levelOf(60)).toBe('warn')
    expect(levelOf(84.9)).toBe('warn')
    expect(levelOf(85)).toBe('crit')
    expect(bar(36, 10)).toBe('████░░░░░░')
    expect(countdown(134 * MIN)).toBe('2h 14m')
    expect(countdown(3 * 1440 * MIN + 4 * 60 * MIN)).toBe('3d 4h')
  })

  test('moods, top to bottom: dead, wait, work, idle', () => {
    expect(moodOf(100, 3, 2)).toBe('dead')
    expect(moodOf(50, 3, 1)).toBe('wait')
    expect(moodOf(50, 1, 0)).toBe('work')
    expect(moodOf(50, 0, 0)).toBe('idle')
    expect(moodOf(null, 0, 0)).toBe('idle')
  })

  test('Clawd is the welcome-screen crab, eyes drawn black on his body colour', () => {
    const pose = { eyes: 'open', arms: 'down', feet: 'both', look: 0, flip: false, off: 0, x: 0, facing: '', poof: '' }
    const cells = clawdCells(pose)
    expect(cells.map(row => row.map(cell => cell.ch).join(''))).toEqual([' ▐▗███▗█ ', '▝▜██████▀', ' ▝▝   ▝▝ '])
    expect(cells[0]?.[2]).toEqual({ ch: '▗', fg: '#000000', bg: '#D77757' })
    const dead = clawdCells({ ...pose, eyes: 'x', flip: true })
    expect(dead.flat().filter(cell => cell.ch === '×')).toHaveLength(2)
    const shut = clawdCells({ ...pose, eyes: 'closed' })
    expect(shut[0]?.map(cell => cell.ch).join('')).toBe(' ▐▂███▂█ ')
  })
})

describe('sessions and the probe policy', () => {
  test('a registry file, the probe it may be, and the live PIDs', () => {
    const entry = parseRegistryEntry(JSON.stringify({ pid: 72344, cwd: 'D:\\work\\Blog.Api', status: 'waiting', waitingFor: 'permission', entrypoint: 'cli', startedAt: NOW }))
    expect(entry).toMatchObject({ pid: 72344, name: 'Blog.Api', status: 'waiting', waitingFor: 'permission' })
    expect(parseRegistryEntry('{"pid":"x"}')).toBeNull()
    expect(parseRegistryEntry('not json')).toBeNull()
    const probe = parseRegistryEntry(JSON.stringify({ pid: 5, cwd: 'C:\\', status: 'busy', entrypoint: 'sdk-cli', startedAt: NOW + 500 }))
    if (probe === null) throw new Error('no entry')
    expect(isProbeEntry(probe, [{ from: NOW, to: NOW + 3000 }])).toBe(true)
    expect(isProbeEntry(probe, [{ from: NOW - 10 * MIN, to: NOW - 9 * MIN }])).toBe(false)
    expect(isProbeEntry({ ...probe, entrypoint: 'cli' }, [{ from: NOW, to: NOW + 3000 }])).toBe(false)
    expect([...parseTasklist('"claude.exe","49940","Console","1","182,708 K"\r\n"claude.exe","23036","Console","1","5 K"\r\n')]).toEqual([49940, 23036])
  })

  test('probe due: each minute, five when relaxed, at once past a reset, never hammering a failure', () => {
    const cache = (age: number, extra: Partial<ProbeCache> = {}): ProbeCache => ({
      at: NOW - age, triedAt: NOW - age, isFailed: false, probes: [], usage: null, ...extra,
    })
    expect(isProbeDue(null, false, NOW)).toBe(true)
    expect(isProbeDue(cache(30_000), false, NOW)).toBe(false)
    expect(isProbeDue(cache(61_000), false, NOW)).toBe(true)
    expect(isProbeDue(cache(61_000), true, NOW)).toBe(false)
    expect(isProbeDue(cache(301_000), true, NOW)).toBe(true)
    expect(isProbeDue(cache(10 * MIN, { triedAt: NOW - 90_000, isFailed: true }), false, NOW)).toBe(false)
    expect(isProbeDue(cache(10 * MIN, { triedAt: NOW - 130_000, isFailed: true }), false, NOW)).toBe(true)
    const passed = { session: { pct: 90, resetsAt: NOW - 1000 }, week: null, fable: null, day: null, week7: null }
    expect(isProbeDue(cache(70_000, { usage: passed }), true, NOW)).toBe(true)
  })

  test('merging: the newer source wins the 5h and week rows, a passed reset reads 0%, a failed probe is stale', () => {
    const usage = parseUsage(SAMPLE, NOW - 5 * MIN)
    const probe: ProbeCache = { at: NOW - 5 * MIN, triedAt: NOW - 5 * MIN, isFailed: false, probes: [], usage }
    const builtin = { at: NOW - MIN, session: { pct: 21.5, resetsAt: at(9, 23, 1, 29) }, week: { pct: 58, resetsAt: at(9, 23, 0, 59) } }
    const both = mergeLimits(probe, builtin, NOW)
    expect(both).toMatchObject({ source: 'builtin', session: { pct: 21.5 }, fable: { pct: 69 }, isStale: false })
    const later = mergeLimits(probe, null, at(9, 23, 1, 0))
    expect(later?.week).toEqual({ pct: 0, resetsAt: null })
    expect(later?.session?.pct).toBe(18)
    const failed = mergeLimits({ ...probe, isFailed: true, triedAt: NOW }, null, NOW)
    expect(failed?.isStale).toBe(true)
    expect(mergeLimits({ ...probe, isFailed: true, triedAt: NOW - 2 * MIN }, builtin, NOW)?.isStale).toBe(false)
  })
})

// --------------------------------------------------------------- engine ----

test('one probe for all: claude -p /usage in safe mode, once, into the shared cache; Clawd alone above the prompt', async ($, on) => {
  const w = world(on, () => SAMPLE, [100, 200, 300])
  w.setSession({ pid: 100, sessionId: 'me', status: 'busy' })
  w.setSession({ pid: 200, name: 'shopapp', status: 'busy' })
  w.setSession({ pid: 300, name: 'docs', status: 'idle' })
  w.setSession({ pid: 400, name: 'crashed', status: 'busy' }) // its process is gone

  await $.session.start(START)
  await w.clock.advance(400) // the lock settles; the probe runs
  expect(probes(w)).toEqual([['claude', '-p', '/usage', '--output-format', 'text', '--no-session-persistence', '--safe-mode']])
  const cache = JSON.parse(w.files.get(`${CFG}/clawd-mods/cache.json`)?.text ?? '{}') as ProbeCache
  expect(cache.usage?.session?.pct).toBe(18)
  expect(await inPane($, /5-hour.*18%/)).toBe(true)
  // No status line entry: only the clearing of one an earlier version pinned.
  expect(w.statuses).toEqual([undefined])

  // The probe's own registry file shows up while it runs: it is not a session.
  w.setSession({ pid: 500, status: 'busy', entrypoint: 'sdk-cli', startedAt: NOW + 100 }, NOW + 200)
  await w.clock.advance(15_000)
  expect(probes(w)).toHaveLength(1)
  expect(await inPane($, /2 open · 1 busy$/)).toBe(true)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    // The numbers live in /clawd; above the prompt there is Clawd alone.
    expect(await ui.find({ type: 'Text', text: /5h|wk|running|♥/ })).toBeUndefined()
    const clawd = await ui.find({ type: 'Client' })
    // The whole band is his yard, four rows: the sky, then Clawd.
    expect(clawd?.props).toMatchObject({ key: 'clawd', module: 'hooks/clawd.tsx', width: 100, height: 4, props: { mood: 'work', halves: 5 } })
    // The sky row is the gap between the chat and his head.
    expect((await ui.find({ key: 'yard' }))?.props.marginTop).toBeUndefined()
    // Clawd stands on top of what is beneath him, so the checklist's tabs never swallow him.
    const order = (await ui.findAll({ type: 'Box' })).map(box => box.key).filter(key => key === 'yard' || key === 'beneath')
    expect(order).toEqual(['yard', 'beneath'])
    await ui.advance(3000) // the entrance may start off-frame (drop, peekaboo, waddle)
    expect(JSON.stringify(await ui.drawn({ in: 'clawd' }))).toContain('#D77757')
    await ui.unmount()
  }
})

test('another session holding a fresh lock probes; this one only reads the cache', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  w.files.set(`${CFG}/clawd-mods/lock.json`, { text: JSON.stringify({ owner: 'other', at: NOW - 5000 }), mtimeMs: NOW })
  await $.session.start(START)
  await w.clock.advance(20_000)
  expect(probes(w)).toEqual([])

  // The other copy's answer lands in the shared cache; this one picks it up.
  const usage = parseUsage(SAMPLE, NOW)
  w.files.set(`${CFG}/clawd-mods/cache.json`, { text: JSON.stringify({ at: NOW + 20_000, triedAt: NOW + 20_000, isFailed: false, probes: [], usage }), mtimeMs: NOW })
  await w.clock.advance(15_000)
  expect(probes(w)).toEqual([])
  expect(await inPane($, /5-hour.*18%/)).toBe(true)
})

test('a failed probe keeps the last numbers, marked stale', async ($, on) => {
  const w = world(on, () => 'Error: something went wrong', [])
  // Six minutes old: due even on a quiet machine, where the probe waits five.
  const usage = parseUsage(SAMPLE, NOW - 6 * MIN)
  w.files.set(`${CFG}/clawd-mods/cache.json`, { text: JSON.stringify({ at: NOW - 6 * MIN, triedAt: NOW - 6 * MIN, isFailed: false, probes: [], usage }), mtimeMs: NOW })
  await $.session.start(START)
  await w.clock.advance(400)
  expect(probes(w)).toHaveLength(1)
  const cache = JSON.parse(w.files.get(`${CFG}/clawd-mods/cache.json`)?.text ?? '{}') as ProbeCache
  expect(cache).toMatchObject({ isFailed: true, at: NOW - 6 * MIN, usage: { session: { pct: 18 } } })
  // Retried no sooner than two minutes after a failure.
  await w.clock.advance(60_000)
  expect(probes(w)).toHaveLength(1)
  expect(await inPane($, /5-hour.*18%/)).toBe(true)
  expect(await inPane($, /Stale: the last \/usage probe failed/)).toBe(true)
})

test('/clawd opens the pane: exact reset times, the session list, the breakdown', async ($, on) => {
  const w = world(on, () => SAMPLE, [100, 200, 300])
  w.setSession({ pid: 100, sessionId: 'me' })
  w.setSession({ pid: 200, name: 'shopapp', status: 'busy' })
  w.setSession({ pid: 300, name: 'docs', status: 'waiting', waitingFor: 'permission' })
  await $.session.start(START)
  await w.clock.advance(400)

  const ran = await $.command.run({
    command: 'clawd',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  expect(ran.text).toBe('Clawd pane opened.')
  expect(w.opened).toEqual(['clawd'])
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /resets Fri 1:29am · in 1h 59m/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Fable\s/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▶ shopapp/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\? docs\s+waits for permission/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2 open · 1 busy · 1 waiting/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /4558 requests · 83 sessions/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Give "general-purpose" subagents a cheaper model/ })).toBeDefined()
    await ui.unmount()
  }
})

test('Clawd: a click plays an animation with a heart; a finished session makes him jump', async ($, on) => {
  const w = world(on, () => SAMPLE, [100, 200])
  w.setSession({ pid: 100, sessionId: 'me' })
  w.setSession({ pid: 200, name: 'shopapp', status: 'busy' })
  await $.session.start(START)
  await w.clock.advance(400)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.advance(3000) // let the entrance play out
  await ui.pointer({ type: 'down', x: 12, y: 1, button: 'left', in: 'clawd' })
  await ui.advance(60)
  expect(JSON.stringify(await ui.drawn({ in: 'clawd' }))).toContain('♥')

  w.setSession({ pid: 200, name: 'shopapp', status: 'idle' }, NOW + 1000)
  await w.clock.advance(3000)
  const clawd = await ui.find({ type: 'Client' })
  expect(clawd?.props).toMatchObject({ props: { mood: 'idle', event: { kind: 'finished' } } })
  await ui.unmount()
})

test('this session’s own figures win while fresh, and are shared with the other copies', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start(START)
  await w.clock.advance(400)
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 41.5, resetsAt: new Date(at(9, 23, 1, 29)).toISOString() },
      { kind: 'seven_day', percentUsed: 58, resetsAt: new Date(at(9, 23, 0, 59)).toISOString() },
    ],
    changed: ['rateLimits'],
  })
  expect(await inPane($, /5-hour.*42%/)).toBe(true)
  expect(await inPane($, /Week .*58%/)).toBe(true)
  const shared = JSON.parse(w.files.get(`${CFG}/clawd-mods/builtin.json`)?.text ?? '{}') as { session: { pct: number } }
  expect(shared.session.pct).toBe(41.5)
})

test('with the band off, nothing is drawn above the prompt; /clawd stays', { options: { band: false } }, async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  await $.session.start(START)
  await w.clock.advance(400)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /5h/ })).toBeUndefined()
    await ui.unmount()
  }
  const ran = await $.command.run({ command: 'clawd', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  expect(ran.text).toBe('Clawd pane opened.')
})

test('/clawd band on|off flips the /config row', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  let band = true
  const sets: unknown[] = []
  on('config.list', () => ({
    value: [
      { key: 'theme', label: 'Theme', kind: 'choice', value: 'dark', provider: { plugin: 'engine', tier: 'core' }, isLocked: false },
      { key: 'clawd-mods.band', label: 'Clawd band above the prompt', kind: 'boolean', value: band, provider: { plugin: 'clawd-mods', tier: 'user' }, isLocked: false },
    ],
  }))
  on('config.set', (_, e) => {
    sets.push(e.value)
    band = e.value === true
    return { value: e.value }
  })
  await $.session.start(START)
  const run = (args: string) =>
    $.command.run({ command: 'clawd', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  expect((await run('band off')).text).toBe('The band is off. /clawd stays either way.')
  expect((await run('band off')).text).toBe('The band is already off.')
  expect((await run('band')).text).toMatch(/^The band is on\./)
  expect(sets).toEqual([false, true])
  expect(w.opened).toEqual([])
})

test('first start copies the old shared cache over', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  const cache = JSON.stringify({ at: NOW - 30_000, triedAt: NOW - 30_000, isFailed: false, probes: [], usage: parseUsage(SAMPLE, NOW) })
  const builtin = JSON.stringify({ at: NOW - 20_000, session: { pct: 21.5, resetsAt: null }, week: null })
  w.files.set(`${CFG}/clawd-usage/cache.json`, { text: cache, mtimeMs: NOW })
  w.files.set(`${CFG}/clawd-usage/builtin.json`, { text: builtin, mtimeMs: NOW })
  await $.session.start(START)
  expect(w.files.get(`${CFG}/clawd-mods/cache.json`)?.text).toBe(cache)
  expect(w.files.get(`${CFG}/clawd-mods/builtin.json`)?.text).toBe(builtin)
})

test('a clawd-mods cache already there is not overwritten by the old one', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  const mine = JSON.stringify({ at: NOW - 10_000, triedAt: NOW - 10_000, isFailed: false, probes: [], usage: parseUsage(SAMPLE, NOW) })
  w.files.set(`${CFG}/clawd-usage/cache.json`, { text: '{"old":true}', mtimeMs: NOW })
  w.files.set(`${CFG}/clawd-mods/cache.json`, { text: mine, mtimeMs: NOW })
  await $.session.start(START)
  expect(w.files.get(`${CFG}/clawd-mods/cache.json`)?.text).toBe(mine)
})

test('Clawd walks the whole band, under his sky', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  await $.session.start(START)
  await w.clock.advance(400)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const clawd = await ui.find({ type: 'Client' })
  expect(clawd?.props).toMatchObject({ width: 100, height: 4 })
  const sky = (clawd?.props.props as { sky: { sunrise: number; sunset: number } | null }).sky
  expect(sky?.sunrise).toBeLessThan(sky?.sunset ?? 0)
  const drawn = (await ui.drawn({ in: 'clawd' })) as { children?: unknown[] }
  expect(drawn.children).toHaveLength(4)
  await ui.unmount()
})

test('narrow band: no Clawd below 12 columns', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  await $.session.start(START)
  await w.clock.advance(400)
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 11 }, surface: 'terminal' })
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  await ui.unmount()
})

test('with the sky off, the row above Clawd stays empty', { options: { sky: false } }, async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  await $.session.start(START)
  await w.clock.advance(400)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Client' }))?.props).toMatchObject({ height: 4, props: { sky: null } })
  await ui.unmount()
})

test('a headless run (the probe itself) gets nothing', async ($, on) => {
  const w = world(on, () => SAMPLE, [])
  await $.session.start({ ...START, isInteractive: false })
  await w.clock.advance(60_000)
  expect(w.runs).toEqual([])
  expect(w.statuses).toEqual([])
})
