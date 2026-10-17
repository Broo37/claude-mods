import { expect, test } from 'claude-code/testing'

import type { View } from '../types'
import { PALETTE, gradient } from '../hooks/format'
import { boardOf, hintRest, hintShift, linesOf, positionOf, sizeOf } from '../hooks/layout'
import type { Segment } from '../hooks/layout'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

// A Monday afternoon, local time, so the reset wording does not depend on the time zone.
const NOW = new Date(2026, 9, 5, 16, 45).getTime()

const VIEW: View = {
  now: NOW,
  model: 'claude-opus-5-5',
  effort: 'high',
  style: 'default',
  cwd: 'C:\\Users\\admin\\project',
  home: 'C:\\Users\\admin',
  env: '',
  account: '',
  contextTokens: 86_400,
  contextWindow: 200_000,
  contextPercent: 43,
  limits: [
    { kind: 'five_hour', percentUsed: 42, resetsAt: NOW + 2 * HOUR + 15 * MINUTE },
    { kind: 'seven_day', percentUsed: 18, resetsAt: new Date(2026, 9, 8, 19, 0).getTime() },
  ],
  costUsd: 1.234,
  isBoardClosed: false,
  isStatusClosed: false,
  mode: '',
  peers: [],
  startedAt: NOW - HOUR - 2 * MINUTE,
  git: { branch: 'main', ahead: 0, behind: 0, staged: 5, unstaged: 12, untracked: 0 },
  codex: { percent: 26, resetsAt: new Date(2026, 9, 9, 8, 30).getTime(), readAt: NOW - HOUR },
  turn: null,
}

const written = (segment: Segment) => {
  if ('bar' in segment) {
    return `[${segment.bar} ${segment.percent}/${segment.width}]`
  }

  if ('column' in segment) {
    return `[${segment.column} ${segment.row}]`
  }

  return 'spin' in segment ? `[spin ${segment.spin}]` : segment.text
}

const plain = (lines: Segment[][]) => lines.map(line => line.map(written).join(''))

const segmentOf = (lines: Segment[][], text: string) =>
  lines.flat().find(segment => 'text' in segment && segment.text === text)

test('lays out the seven rows of the xlarge size', () => {
  expect(plain(linesOf(VIEW, 'xlarge'))).toEqual([
    '🤖 Opus 5.5 ⚡high │ 🎨 default',
    '📂 C:\\Users\\admin\\project 🌿(main) │ 📝+5!12 │ 🐍 no env',
    '💰 $ 1.23 │ ⏰ 1h2m',
    '🧠 Context  [context 43/40] 43% used (86k/200k)',
    '🚀 5H Limit [fiveHour 42/40] 42% ⏳ Resets in 2h15m, 🕐 19:00',
    '🌟 7D Limit [sevenDay 18/40] 18% ⏳ Resets in 3d2h15m, 📅 Thu 19:00',
    '🌀 Codex 7D [codex 26/40] 26% ⏳ Resets in 3d15h45m, 📅 Fri 08:30',
  ])
})

test('lays out the large size with shorter bars and its own wording', () => {
  expect(plain(linesOf(VIEW, 'large'))).toEqual([
    '🤖 Opus 5.5 ⚡high │ 🎨 default',
    '📂 C:\\Users\\admin\\project 🌿(main) │ 📝+5!12 │ 🐍 no env',
    '💰 $ 1.23 │ ⏰ 1h2m',
    '🧠 Context  [context 43/20] 43% used (86k/200k)',
    '🚀 Usage 5H [fiveHour 42/20] 42% ⏳ Reset in 2h15m, 🕐 19:00',
    '⭐ Usage 7D [sevenDay 18/20] 18% ⏳ Reset in 3d2h15m, 📅 Thu 19:00',
    '🌀 Codex 7D [codex 26/20] 26% ⏳ Resets in 3d15h45m, 📅 Fri 08:30',
  ])
})

test('lays out the four rows of the medium size', () => {
  expect(plain(linesOf(VIEW, 'medium'))).toEqual([
    '🤖 Opus 5.5 ⚡high │ 🎨 default',
    '📂 C:\\Users\\admin\\project 🌿(main) │ 📝+5!12 │ 🐍 no env',
    '📝 Context [context 43/40] 43% used',
    '🚀 Usage 5H [fiveHour 42/10] 42% │ 7D [sevenDay 18/10] 18% │ CX [codex 26/10] 26%',
  ])
})

test('lays out the two rows of the small size with the home directory shortened', () => {
  expect(plain(linesOf(VIEW, 'small'))).toEqual([
    '🤖 Opus 5.5 ⚡high │ 🎨 default │ 📂 ~\\project 🌿(main)',
    '🧠 Context [context 43/10] 43% │ 5H [fiveHour 42/10] 42% │ 7D [sevenDay 18/10] 18% │ CX [codex 26/10] 26%',
  ])
})

test('lays out the two rows of the xsmall size around the model family', () => {
  expect(plain(linesOf(VIEW, 'xsmall'))).toEqual([
    '🤖 Opus ⚡high 📂 ~\\project 🌿(main)📝',
    '🧠 [context 43/10] 5H[fiveHour 42/10] 7D[sevenDay 18/10] CX[codex 26/10]',
  ])
})

test('says a repository is clean, and how far its branch has moved', () => {
  const git = { branch: 'main', ahead: 2, behind: 1, staged: 0, unstaged: 0, untracked: 0 }
  const [first, second] = plain(linesOf({ ...VIEW, git }, 'xlarge'))

  expect(first).toBe('🤖 Opus 5.5 ⚡high │ 🎨 default')
  expect(second).toBe('📂 C:\\Users\\admin\\project 🌿(main) ↑2 ↓1 │ ✅ clean │ 🐍 no env')
  expect(plain(linesOf({ ...VIEW, git }, 'xsmall'))[0]).toBe('🤖 Opus ⚡high 📂 ~\\project 🌿(main) ↑2 ↓1✅')
})

test('counts untracked files in the git status', () => {
  const git = { branch: 'main', ahead: 0, behind: 0, staged: 0, unstaged: 1, untracked: 3 }

  expect(plain(linesOf({ ...VIEW, git }, 'xlarge'))[1]).toBe(
    '📂 C:\\Users\\admin\\project 🌿(main) │ 📝!1?3 │ 🐍 no env',
  )
})

test('says so outside a git repository and names no branch', () => {
  const [first, second] = plain(linesOf({ ...VIEW, git: null }, 'xlarge'))

  expect(first).toBe('🤖 Opus 5.5 ⚡high │ 🎨 default')
  expect(second).toBe('📂 C:\\Users\\admin\\project │ 🌿 no git │ 🐍 no env')
  expect(plain(linesOf({ ...VIEW, git: null }, 'xsmall'))[0]).toBe('🤖 Opus ⚡high 📂 ~\\project')
})

test('names the active Python environment', () => {
  expect(plain(linesOf({ ...VIEW, env: 'base' }, 'xlarge'))[1]).toBe(
    '📂 C:\\Users\\admin\\project 🌿(main) │ 📝+5!12 │ 🐍 base',
  )
})

test('leaves out the effort and the output style a session has none of', () => {
  expect(plain(linesOf({ ...VIEW, effort: '', style: '' }, 'xlarge'))[0]).toBe('🤖 Opus 5.5')
})

test('shows empty limit bars while no reading has arrived', () => {
  const lines = plain(linesOf({ ...VIEW, limits: [] }, 'xlarge'))

  expect(lines[4]).toBe('🚀 5H Limit [fiveHour 0/40] 0% (loading..)')
  expect(lines[5]).toBe('🌟 7D Limit [sevenDay 0/40] 0% (loading..)')
  expect(plain(linesOf({ ...VIEW, limits: [] }, 'medium'))[3]).toBe(
    '🚀 Usage 5H [fiveHour 0/10] 0% │ 7D [sevenDay 0/10] 0% (loading..) │ CX [codex 26/10] 26%',
  )
  expect(plain(linesOf({ ...VIEW, limits: [] }, 'small'))[1]).toBe(
    '🧠 Context [context 43/10] 43% │ 5H [fiveHour 0/10] 0% │ 7D [sevenDay 0/10] 0% │ CX [codex 26/10] 26% (loading..)',
  )
  expect(plain(linesOf({ ...VIEW, limits: [] }, 'xsmall'))[1]).toBe(
    '🧠 [context 43/10] 5H[fiveHour 0/10] 7D[sevenDay 0/10] CX[codex 26/10] (loading..)',
  )
})

test('says when Codex has left no reading', () => {
  expect(plain(linesOf({ ...VIEW, codex: null }, 'xlarge'))[6]).toBe('🌀 Codex 7D [codex 0/40] 0% no codex data')
})

test('does not show a Codex reading from a window that has rolled over', () => {
  const codex = { percent: 43, resetsAt: NOW - HOUR, readAt: NOW - 5 * HOUR }

  expect(plain(linesOf({ ...VIEW, codex }, 'xlarge'))[6]).toBe(
    '🌀 Codex 7D [codex 0/40] 0% window reset — run codex to refresh',
  )
  expect(plain(linesOf({ ...VIEW, codex }, 'medium'))[3]).toBe(
    '🚀 Usage 5H [fiveHour 42/10] 42% │ 7D [sevenDay 18/10] 18% │ CX [codex 0/10] 0%',
  )
})

test('says how old a Codex reading is once it is hours stale', () => {
  const codex = { percent: 26, resetsAt: new Date(2026, 9, 9, 8, 30).getTime(), readAt: NOW - 7 * HOUR }

  expect(plain(linesOf({ ...VIEW, codex }, 'xlarge'))[6]).toBe(
    '🌀 Codex 7D [codex 26/40] 26% ⏳ Resets in 3d15h45m, 📅 Fri 08:30 (read 7h ago)',
  )
})

test('adds the last turn to the money row of the two largest sizes', () => {
  const turn = { seconds: 42, tools: 7 }

  expect(plain(linesOf({ ...VIEW, turn }, 'xlarge'))[2]).toBe(
    '💰 $ 1.23 │ ⏰ 1h2m │ ⌛ last 42s │ 🔧 7 tools',
  )
  expect(plain(linesOf({ ...VIEW, turn: { seconds: 125, tools: 1 } }, 'large'))[2]).toBe(
    '💰 $ 1.23 │ ⏰ 1h2m │ ⌛ last 2m │ 🔧 1 tool',
  )
  expect(plain(linesOf({ ...VIEW, turn }, 'medium'))[1]).toBe(
    '📂 C:\\Users\\admin\\project 🌿(main) │ 📝+5!12 │ 🐍 no env',
  )
})

test('rounds a reading and keeps it inside the bar', () => {
  const limits = [{ kind: 'five_hour', percentUsed: 104.6, resetsAt: null }]
  const line = plain(linesOf({ ...VIEW, limits }, 'xlarge'))[4]

  expect(line).toBe('🚀 5H Limit [fiveHour 100/40] 100% ⏳ Resets in N/A, 🕐 N/A')
})

test('colors each part from the Catppuccin palette', () => {
  const lines = linesOf(VIEW, 'xlarge')

  expect(segmentOf(lines, 'Opus 5.5')).toEqual({ text: 'Opus 5.5', color: PALETTE.teal, isBold: true })
  expect(segmentOf(lines, ' ⚡high')).toEqual({ text: ' ⚡high', color: PALETTE.peach })
  expect(segmentOf(lines, '43% used')).toEqual({ text: '43% used', color: PALETTE.pink, isBold: true })
  expect(segmentOf(lines, 'no env')).toEqual({ text: 'no env', color: PALETTE.overlay })
  expect(segmentOf(lines, ' │ ')).toEqual({ text: ' │ ' })
})

test('colors a small reading by where its bar ends', () => {
  const lines = linesOf(VIEW, 'small')

  expect(segmentOf(lines, '42%')).toEqual({ text: '42%', color: gradient('fiveHour', 42), isBold: true })
})

test('falls back to the xlarge size for a value that names none', () => {
  expect(sizeOf('medium')).toBe('medium')
  expect(sizeOf('huge')).toBe('xlarge')
  expect(sizeOf(undefined)).toBe('xlarge')
})

test('names the plan beside the effort on the roomier sizes', () => {
  const view = { ...VIEW, account: 'Pro' }

  expect(plain(linesOf(view, 'xlarge'))[0]).toBe(
    '🤖 Opus 5.5 ⚡high 💎 Pro │ 🎨 default',
  )
  expect(plain(linesOf(view, 'large'))[0]).toBe(
    '🤖 Opus 5.5 ⚡high 💎 Pro │ 🎨 default',
  )
  expect(plain(linesOf(view, 'medium'))[0]).toBe(
    '🤖 Opus 5.5 ⚡high 💎 Pro │ 🎨 default',
  )
  expect(segmentOf(linesOf(view, 'xlarge'), 'Pro')).toEqual({
    text: 'Pro',
    color: PALETTE.lavender,
  })
})

test('keeps the account off the two compact sizes', () => {
  const view = { ...VIEW, account: 'Pro' }

  expect(plain(linesOf(view, 'small'))).toEqual(plain(linesOf(VIEW, 'small')))
  expect(plain(linesOf(view, 'xsmall'))).toEqual(plain(linesOf(VIEW, 'xsmall')))
})

const barOf = (lines: Segment[][], kind: string) =>
  lines.flat().find(segment => 'bar' in segment && segment.bar === kind)

const paceOf = (lines: Segment[][], kind: string) => (barOf(lines, kind) as { pace?: number } | undefined)?.pace

test('marks how far through its window each limit is', () => {
  const lines = linesOf(VIEW, 'xlarge')

  expect(barOf(lines, 'fiveHour')).toEqual({ bar: 'fiveHour', percent: 42, width: 40, pace: 55 })
  expect(barOf(lines, 'sevenDay')).toEqual({ bar: 'sevenDay', percent: 18, width: 40, pace: 56 })
  expect(barOf(lines, 'codex')).toEqual({ bar: 'codex', percent: 26, width: 40, pace: 48 })
})

test('marks no pace on the context bar', () => {
  expect(barOf(linesOf(VIEW, 'xlarge'), 'context')).toEqual({ bar: 'context', percent: 43, width: 40 })
})

test('marks no pace without a reset time, or for a Codex window that has rolled over', () => {
  const limits = [{ kind: 'five_hour', percentUsed: 50, resetsAt: null }]
  const codex = { percent: 43, resetsAt: NOW - HOUR, readAt: NOW - 5 * HOUR }
  const lines = linesOf({ ...VIEW, limits, codex }, 'xlarge')

  expect(barOf(lines, 'fiveHour')).toEqual({ bar: 'fiveHour', percent: 50, width: 40 })
  expect(barOf(lines, 'codex')).toEqual({ bar: 'codex', percent: 0, width: 40 })
})

test('carries the pace on every size', () => {
  for (const size of ['xsmall', 'small', 'medium', 'large'] as const) {
    const lines = linesOf(VIEW, size)

    expect(paceOf(lines, 'fiveHour')).toBe(55)
    expect(paceOf(lines, 'sevenDay')).toBe(56)
    expect(paceOf(lines, 'codex')).toBe(48)
  }
})

test('keeps the pace inside the bar when a reset time is out of range', () => {
  const far = [{ kind: 'five_hour', percentUsed: 10, resetsAt: NOW + 9 * HOUR }]
  const past = [{ kind: 'five_hour', percentUsed: 10, resetsAt: NOW - HOUR }]

  expect(paceOf(linesOf({ ...VIEW, limits: far }, 'xlarge'), 'fiveHour')).toBe(0)
  expect(paceOf(linesOf({ ...VIEW, limits: past }, 'xlarge'), 'fiveHour')).toBe(100)
})

test('keeps the band above the prompt unless it is told below', () => {
  expect(positionOf('below')).toBe('below')
  expect(positionOf('above')).toBe('above')
  expect(positionOf('sideways')).toBe('above')
  expect(positionOf(undefined)).toBe('above')
})

test('pulls a row under the prompt back to where the mode pill before it starts', () => {
  // Measured in real sessions: Claude Code draws its pill, then a separator of
  // three columns, then what a hook returns. The rows stand under the pill.
  expect(hintShift('bypassPermissions')).toBe(27)
  expect(hintShift('acceptEdits')).toBe(21)
  expect(hintShift('default')).toBe(19)
  expect(hintShift('plan')).toBe(17)
})

test('takes a mode it has not been told, or does not know, for the default one', () => {
  expect(hintShift('')).toBe(19)
  expect(hintShift('something new')).toBe(19)
})

test('keeps of a hint only what says more than how to change mode or find the shortcuts', () => {
  expect(hintRest('(shift+tab to cycle)')).toBe('')
  expect(hintRest('? for shortcuts')).toBe('')
  expect(hintRest('(shift+tab to cycle) · ← for agents')).toBe('← for agents')
  expect(hintRest('esc to interrupt')).toBe('esc to interrupt')
  expect(hintRest('')).toBe('')
})

test('names the plan right after the model when no effort is known', () => {
  const view = { ...VIEW, account: 'Pro', effort: '' }

  expect(plain(linesOf(view, 'xlarge'))[0]).toBe('🤖 Opus 5.5 💎 Pro │ 🎨 default')
})

const WAITING = { id: 'a', name: 'uat2-07', status: 'idle', since: NOW - (HOUR + 37 * MINUTE), needs: '' }
const WORKING = { id: 'b', name: 'geisa-exp-productmappingexport-analysis', status: 'busy', since: NOW - 2 * MINUTE, needs: '' }
const IN_SHELL = { id: 'c', name: 'a10-w25-p31-open-debt', status: 'shell', since: NOW - 42 * MINUTE, needs: '' }

const board = (peers: View['peers'], rows?: number) => plain(boardOf({ ...VIEW, peers }, rows))

test('lists each other session on two lines of its pane, the ones waiting for the person first', () => {
  expect(board([WORKING, IN_SHELL, WAITING])).toEqual([
    '🕐 uat2-07',
    '   waiting 1h37m',
    ' ',
    '🐚 a10-w25-p31-open-debt',
    '   shell 42m',
    ' ',
    '⏳ geisa-exp-productmappingexport-analysis',
    '   working 2m',
  ])
})

test('puts a session that needs an answer before every other', () => {
  const asking = { ...WORKING, name: 'review', needs: 'permission' }

  expect(board([WAITING, asking]).filter(line => line.trim() !== '')).toEqual([
    '🙋 review',
    '   needs you 2m',
    '🕐 uat2-07',
    '   waiting 1h37m',
  ])
})

test('puts the session that stopped last first among those waiting', () => {
  const justDone = { ...WAITING, id: 'd', name: 'fresh', since: NOW - MINUTE }

  expect(board([WAITING, justDone])[0]).toBe('🕐 fresh')
})

test('names a session in its full length, and colors what it is doing', () => {
  const lines = boardOf({ ...VIEW, peers: [WORKING] })

  expect(segmentOf(lines, 'geisa-exp-productmappingexport-analysis')).toEqual({
    text: 'geisa-exp-productmappingexport-analysis',
    color: PALETTE.subtext,
    isBold: true,
  })
  expect(segmentOf(lines, 'working 2m')).toEqual({ text: 'working 2m', color: PALETTE.peach })
})

test('counts the sessions its pane has no room to name', () => {
  const many = Array.from({ length: 6 }, (_, i) => ({ ...WAITING, id: `s${i}`, name: `s${i}`, since: NOW - (i + 1) * MINUTE }))

  // Eleven rows hold four sessions, or three and the count of the rest.
  expect(board(many, 11)).toEqual([
    '🕐 s0', '   waiting 1m', ' ',
    '🕐 s1', '   waiting 2m', ' ',
    '🕐 s2', '   waiting 3m', ' ',
    '+3 more',
  ])
  expect(board(many.slice(0, 4), 11)).toHaveLength(11)
})

test('says so in the pane when no other session is open', () => {
  expect(board([])).toEqual(['No other sessions open.'])
})

test('writes a status it does not know as it is', () => {
  expect(board([{ ...WAITING, status: 'parked' }])).toEqual(['uat2-07', '   parked 1h37m'])
})

test('keeps the other sessions out of the band itself', () => {
  expect(plain(linesOf({ ...VIEW, peers: [WAITING] }, 'xlarge'))).toEqual(plain(linesOf(VIEW, 'xlarge')))
  expect(plain(linesOf({ ...VIEW, peers: [WAITING] }, 'medium'))).toEqual(plain(linesOf(VIEW, 'medium')))
})

const namesIn = (lines: string[]) => lines.filter(line => line.trim() !== '' && !line.startsWith('   '))

const THREE = [WORKING, IN_SHELL, WAITING]

test('keeps the icons of the sessions still where nothing may move', () => {
  expect(namesIn(plain(boardOf({ ...VIEW, peers: THREE })))).toEqual([
    '🕐 uat2-07',
    '🐚 a10-w25-p31-open-debt',
    '⏳ geisa-exp-productmappingexport-analysis',
  ])
})

test('marks a working session with a spinner where its pane can spin one', () => {
  const lines = namesIn(plain(boardOf({ ...VIEW, peers: THREE }, undefined, { canSpin: true, beat: 0 })))

  // The spinner is one column and two spaces: as wide as an icon and the space after it.
  expect(lines.at(-1)).toBe('[spin b]  geisa-exp-productmappingexport-analysis')
  expect(namesIn(plain(boardOf({ ...VIEW, peers: [WORKING] }, undefined, { canSpin: false, beat: 0 })))).toEqual([
    '⏳ geisa-exp-productmappingexport-analysis',
  ])
})

test('moves the clock of a waiting session an hour on with every beat, and round again', () => {
  const firstAt = (beat: number) => namesIn(plain(boardOf({ ...VIEW, peers: [WAITING] }, undefined, { canSpin: true, beat })))[0]

  // Twelve faces, so the thirteenth beat shows the first again.
  expect([0, 1, 2, 11, 12].map(firstAt)).toEqual([
    '🕐 uat2-07', '🕑 uat2-07', '🕒 uat2-07', '🕛 uat2-07', '🕐 uat2-07',
  ])
})

test('washes a wave over the shell of a session in shell mode on every fifth beat', () => {
  const firstAt = (beat: number) => namesIn(plain(boardOf({ ...VIEW, peers: [IN_SHELL] }, undefined, { canSpin: false, beat })))[0]

  expect([3, 4, 5].map(firstAt)).toEqual([
    '🐚 a10-w25-p31-open-debt',
    '🌊 a10-w25-p31-open-debt',
    '🐚 a10-w25-p31-open-debt',
  ])
})

test('lets the sessions move one after another, not all alike', () => {
  const second = (peer: typeof WAITING) => ({ ...peer, id: 'd', name: 'second', since: NOW - 2 * HOUR })
  const at = (peers: View['peers'], beat: number) =>
    namesIn(plain(boardOf({ ...VIEW, peers }, undefined, { canSpin: true, beat })))

  // Two shells are not under the wave together, and two clocks do not show the same hour.
  expect(at([IN_SHELL, second(IN_SHELL)], 4)).toEqual(['🌊 a10-w25-p31-open-debt', '🐚 second'])
  expect(at([IN_SHELL, second(IN_SHELL)], 3)).toEqual(['🐚 a10-w25-p31-open-debt', '🌊 second'])
  expect(at([WAITING, second(WAITING)], 0)).toEqual(['🕐 uat2-07', '🕑 second'])
})

test('gives no motion to a session that needs an answer, or is in a state it does not know', () => {
  const asking = { ...WORKING, name: 'review', needs: 'permission' }
  const parked = { ...WAITING, status: 'parked' }
  const at = (beat: number) => namesIn(plain(boardOf({ ...VIEW, peers: [asking, parked] }, undefined, { canSpin: true, beat })))

  expect(at(4)).toEqual(['🙋 review', 'uat2-07'])
  expect(at(3)).toEqual(['🙋 review', 'uat2-07'])
})
