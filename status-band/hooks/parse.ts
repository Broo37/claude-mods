import type { Codex, Git, Peer } from '../types'

// One rate-limit window of a Codex token_count event. The weekly one sits in
// `primary` on a team plan and in `secondary` on plus/pro, so it is told by
// its length, never by its slot.
const WINDOW =
  /"used_percent"\s*:\s*([0-9.]+)\s*,\s*"window_minutes"\s*:\s*(\d+)\s*,\s*"resets_at"\s*:\s*(\d+)/g

const STAMP = /"timestamp"\s*:\s*"([^"]+)"/

const DAY_IN_MINUTES = 1440

export const parseGit = (stdout: string): Git => {
  const git: Git = { branch: '', ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0 }

  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('# branch.head ')) {
      const head = line.slice(14)
      git.branch = head === '(detached)' ? '' : head
    } else if (line.startsWith('# branch.ab ')) {
      const [ahead, behind] = line.slice(12).trim().split(/\s+/)
      git.ahead = Math.abs(Number(ahead)) || 0
      git.behind = Math.abs(Number(behind)) || 0
    } else if (line.startsWith('? ')) {
      git.untracked += 1
    } else if (/^[12u] /.test(line)) {
      // "<1|2|u> <X><Y> ...": X is the index side, Y the work tree's, "." unchanged.
      git.staged += line[2] === '.' ? 0 : 1
      git.unstaged += line[3] === '.' ? 0 : 1
    }
  }

  return git
}

export const parseCodex = (text: string): Codex | null => {
  let end = text.length

  while (end > 0) {
    const at = text.lastIndexOf('"rate_limits"', end - 1)

    if (at < 0) {
      return null
    }

    const start = text.lastIndexOf('\n', at) + 1
    const stop = text.indexOf('\n', at)
    const line = text.slice(start, stop < 0 ? text.length : stop)
    const weekly = [...line.matchAll(WINDOW)]
      .filter(hit => Number(hit[2]) >= DAY_IN_MINUTES)
      .at(-1)

    if (weekly !== undefined) {
      const readAt = Date.parse(STAMP.exec(line)?.[1] ?? '')

      return {
        percent: Number(weekly[1]),
        resetsAt: Number(weekly[3]) * 1000,
        readAt: Number.isNaN(readAt) ? 0 : readAt,
      }
    }

    end = start
  }

  return null
}

const recordOf = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? { ...value } : {}

const stringOf = (value: unknown) => (typeof value === 'string' ? value : '')

// The effort a setting names for this model, else the one it names for every model.
export const effortIn = (settings: Record<string, unknown>, model: string) => {
  const own = recordOf(recordOf(settings.modelSettings)[model.replace(/\[1m\]$/i, '')])

  return stringOf(own.effortLevel) || stringOf(settings.effortLevel)
}

export const styleIn = (settings: Record<string, unknown>) => stringOf(settings.outputStyle)

// PowerShell that writes the last `bytes` of a file to standard output, sharing
// it with a Codex that may still hold it open.
export const tailScript = (path: string, bytes: number) =>
  [
    `$s=[System.IO.File]::Open('${path.replace(/'/g, "''")}',[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::ReadWrite)`,
    `$n=[int][Math]::Min(${bytes},$s.Length)`,
    '$null=$s.Seek(-$n,[System.IO.SeekOrigin]::End)',
    '$b=New-Object byte[] $n',
    '$o=0',
    'while($o -lt $n){$r=$s.Read($b,$o,$n-$o);if($r -le 0){break};$o+=$r}',
    '$s.Dispose()',
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
    '[Console]::Out.Write([Text.Encoding]::UTF8.GetString($b,0,$o))',
  ].join(';')

// A profile launched with its own config directory is named by that
// directory's suffix (".claude-personal" is "personal"); the default one has none.
export const profileIn = (configDir: string) =>
  /(?:^|[\\/])\.claude-([^\\/]+)[\\/]?$/.exec(configDir)?.[1] ?? ''

// The plan an account file names: "claude_pro" reads "Pro".
export const planIn = (accountFile: string) => {
  try {
    const account = recordOf(recordOf(JSON.parse(accountFile)).oauthAccount)

    return stringOf(account.organizationType)
      .replace(/^claude_/, '')
      .split('_')
      .filter(word => word !== '')
      .map(word => word.slice(0, 1).toUpperCase() + word.slice(1))
      .join(' ')
  } catch {
    return ''
  }
}

// An account reads as its plan, "Pro"; a profile that names none reads as itself.
export const accountIn = (profile: string, plan: string) => (plan === '' ? profile : plan)

// Another session, out of the file Claude Code keeps for each one that runs. A
// session nobody sits at (a headless run, a spare one kept warm) is left out,
// and one without a name goes by the folder it works in.
export const parsePeer = (presence: string): Peer | null => {
  try {
    const file = recordOf(JSON.parse(presence))
    const id = stringOf(file.sessionId)

    if (id === '' || file.kind !== 'interactive' || file.spare === true) {
      return null
    }

    const folder = stringOf(file.cwd).split(/[\\/]/).filter(part => part !== '').at(-1) ?? ''

    return {
      id,
      name: stringOf(file.name) || folder,
      status: stringOf(file.status),
      since: typeof file.statusUpdatedAt === 'number' ? file.statusUpdatedAt : 0,
      needs: stringOf(file.waitingFor) || stringOf(file.needs),
    }
  } catch {
    return null
  }
}
