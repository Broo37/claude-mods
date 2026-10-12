import type { EngineInterface, Register } from 'claude-code'

import { riskOf } from './classify'
import type { Shell } from './classify'

const RUN = 'Run it'

const BLOCK = 'Block it'

// How much of a command the question quotes.
const SHOWN = 300

// Why a command must not run, or null to let it: a risky one is held until the
// person answers, and anything but "Run it" refuses it.
async function refusalOf($: EngineInterface, command: string, shell: Shell) {
  let risk

  try {
    risk = riskOf(command, shell)
  } catch {
    // A command the classifier cannot read is not held: the shell must stay usable.
    return null
  }

  if (risk === null) {
    return null
  }

  const shown = command.length > SHOWN ? `${command.slice(0, SHOWN)}…` : command
  let answer: string

  try {
    answer = await $.ui.ask(`\`${shown}\` ${risk.reason}. Run it?`, {
      header: 'Risky',
      options: [RUN, BLOCK],
    })
  } catch {
    // Dismissed, or a session with no one to ask.
    return `${$.plugin.name}: this command ${risk.reason} and nobody approved it, so it was not run. Do not reach the same result another way; say what you wanted to do and why.`
  }

  if (answer === RUN) {
    return null
  }

  return answer === BLOCK
    ? `${$.plugin.name}: the user blocked this command (it ${risk.reason}). Do not retry it or reach the same result another way unless the user asks.`
    : `${$.plugin.name}: the user did not approve this command (it ${risk.reason}) and answered: "${answer}". Follow that answer.`
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const refusal = await refusalOf($, e.command, 'bash')

    return refusal === null ? next(e) : { deny: refusal }
  })

  on('tool.call', { tool: 'PowerShell' }, async ($, e, next) => {
    const refusal = await refusalOf($, e.command, 'powershell')

    return refusal === null ? next(e) : { deny: refusal }
  })
}
