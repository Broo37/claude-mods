import { expect, test } from 'claude-code/testing'

import {
  accountIn,
  parsePeer,
  effortIn,
  parseCodex,
  parseGit,
  planIn,
  profileIn,
  styleIn,
  tailScript,
} from '../hooks/parse'

const HEADER = ['# branch.oid 340fff1', '# branch.head main', '# branch.upstream origin/main']

const tokenCount = (timestamp: string, limits: string) =>
  `{"timestamp":"${timestamp}","type":"event_msg","payload":{"type":"token_count","rate_limits":${limits}}}`

const TEAM = '{"limit_id":"codex","primary":{"used_percent":43.0,"window_minutes":10080,"resets_at":1791193506},"secondary":null}'
const PLUS =
  '{"limit_id":"codex","primary":{"used_percent":80.0,"window_minutes":300,"resets_at":1791100000},"secondary":{"used_percent":12.5,"window_minutes":10080,"resets_at":1791600000}}'
const PREMIUM = '{"limit_id":"premium","primary":null,"secondary":null}'

test('reads the branch and how far it is from its upstream', () => {
  const git = parseGit([...HEADER, '# branch.ab +2 -1', ''].join('\n'))

  expect(git).toEqual({ branch: 'main', ahead: 2, behind: 1, staged: 0, unstaged: 0, untracked: 0 })
})

test('counts a file once on each side it changed', () => {
  const git = parseGit(
    [
      ...HEADER,
      '1 M. N... 100644 100644 100644 a1 b1 staged.txt',
      '1 .M N... 100644 100644 100644 a1 b1 unstaged.txt',
      '1 MM N... 100644 100644 100644 a1 b1 both.txt',
      '2 R. N... 100644 100644 100644 a1 b1 R100 new.txt\told.txt',
      'u UU N... 100644 100644 100644 100644 a1 b1 c1 conflict.txt',
      '? untracked.txt',
      '? another.txt',
    ].join('\n'),
  )

  expect(git).toEqual({ branch: 'main', ahead: 0, behind: 0, staged: 4, unstaged: 3, untracked: 2 })
})

test('names no branch on a detached head', () => {
  expect(parseGit('# branch.oid 340fff1\n# branch.head (detached)\n').branch).toBe('')
})

test('reads git output that ends its lines the Windows way', () => {
  const git = parseGit([...HEADER, '# branch.ab +0 -3', '? new.txt', ''].join('\r\n'))

  expect(git).toEqual({ branch: 'main', ahead: 0, behind: 3, staged: 0, unstaged: 0, untracked: 1 })
})

test('reads the weekly Codex window from a team rollout', () => {
  const codex = parseCodex(['{"type":"session_meta"}', tokenCount('2026-10-05T03:05:09.525Z', TEAM), ''].join('\n'))

  expect(codex).toEqual({
    percent: 43,
    resetsAt: 1791193506000,
    readAt: Date.parse('2026-10-05T03:05:09.525Z'),
  })
})

test('finds the weekly window in whichever slot holds it', () => {
  const codex = parseCodex(tokenCount('2026-10-05T03:05:09.525Z', PLUS))

  expect(codex?.percent).toBe(12.5)
  expect(codex?.resetsAt).toBe(1791600000000)
})

test('takes the most recent reading in a rollout', () => {
  const older = tokenCount('2026-10-05T01:00:00.000Z', TEAM.replace('43.0', '40.0'))
  const newer = tokenCount('2026-10-05T03:00:00.000Z', TEAM)

  expect(parseCodex([older, newer, '{"type":"other"}'].join('\n'))?.percent).toBe(43)
})

test('walks back past a reading that names no weekly window', () => {
  const real = tokenCount('2026-10-05T01:00:00.000Z', TEAM)
  const empty = tokenCount('2026-10-05T03:00:00.000Z', PREMIUM)

  expect(parseCodex([real, empty].join('\n'))?.percent).toBe(43)
})

test('reads nothing from a rollout with no rate limits', () => {
  expect(parseCodex('{"type":"session_meta"}\n{"type":"other"}\n')).toBe(null)
  expect(parseCodex('')).toBe(null)
})

test('reads the effort a setting gives the model before the one for every model', () => {
  const settings = { effortLevel: 'low', modelSettings: { 'claude-opus-5-5': { effortLevel: 'high' } } }

  expect(effortIn(settings, 'claude-opus-5-5')).toBe('high')
  expect(effortIn(settings, 'claude-opus-5-5[1m]')).toBe('high')
  expect(effortIn(settings, 'claude-sonnet-5')).toBe('low')
  expect(effortIn({}, 'claude-sonnet-5')).toBe('')
})

test('reads the output style, or none', () => {
  expect(styleIn({ outputStyle: 'Explanatory' })).toBe('Explanatory')
  expect(styleIn({})).toBe('')
})

test('quotes a path into the script that tails it', () => {
  const script = tailScript("C:/Users/o'brien/rollout.jsonl", 65536)

  expect(script).toContain("Open('C:/Users/o''brien/rollout.jsonl'")
  expect(script).toContain('Min(65536,')
})

test('names a profile after the suffix of its config directory', () => {
  expect(profileIn('C:/Users/admin/.claude-personal')).toBe('personal')
  expect(profileIn('C:/Users/admin/.claude-personal/')).toBe('personal')
  expect(profileIn('/home/me/.claude-work')).toBe('work')
})

test('gives the default profile no name', () => {
  expect(profileIn('C:/Users/admin/.claude')).toBe('')
  expect(profileIn('')).toBe('')
})

test('reads the plan from the account file', () => {
  expect(planIn('{"oauthAccount":{"organizationType":"claude_pro"}}')).toBe('Pro')
  expect(planIn('{"oauthAccount":{"organizationType":"claude_team"}}')).toBe('Team')
  expect(planIn('{"oauthAccount":{"organizationType":"claude_max"}}')).toBe('Max')
})

test('reads no plan from an account file that names none', () => {
  expect(planIn('{"oauthAccount":{}}')).toBe('')
  expect(planIn('{}')).toBe('')
  expect(planIn('not json')).toBe('')
})

test('labels an account by its plan, or by its profile when it names no plan', () => {
  expect(accountIn('personal', 'Pro')).toBe('Pro')
  expect(accountIn('', 'Team')).toBe('Team')
  expect(accountIn('personal', '')).toBe('personal')
  expect(accountIn('', '')).toBe('')
})

const presenceOf = (fields: Record<string, unknown>) =>
  JSON.stringify({ pid: 1, sessionId: 's1', cwd: 'D:\\work\\repo', kind: 'interactive', status: 'idle', statusUpdatedAt: 1000, ...fields })

test('reads another session out of the presence file Claude Code keeps for it', () => {
  expect(parsePeer(presenceOf({ name: 'uat2-07' }))).toEqual({
    id: 's1',
    name: 'uat2-07',
    status: 'idle',
    since: 1000,
    needs: '',
  })
})

test('names a session that has no name after the folder it works in', () => {
  expect(parsePeer(presenceOf({}))?.name).toBe('repo')
  expect(parsePeer(presenceOf({ name: '' }))?.name).toBe('repo')
})

test('carries what a session is waiting on the person for', () => {
  expect(parsePeer(presenceOf({ name: 'a', waitingFor: 'permission' }))?.needs).toBe('permission')
  expect(parsePeer(presenceOf({ name: 'a', needs: 'an answer' }))?.needs).toBe('an answer')
})

test('leaves out a session nobody sits at', () => {
  expect(parsePeer(presenceOf({ name: 'a', kind: 'print' }))).toBeNull()
  expect(parsePeer(presenceOf({ name: 'a', spare: true }))).toBeNull()
})

test('reads no session from a file that is not a presence file', () => {
  expect(parsePeer('not json')).toBeNull()
  expect(parsePeer('{}')).toBeNull()
  expect(parsePeer(presenceOf({ sessionId: 7 }))).toBeNull()
})
