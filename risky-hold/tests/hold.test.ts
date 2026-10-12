import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

type Asked = { question: string; header: string; options: string[] }

// The stub beneath the mod: it runs the shell tools in Claude Code's place and
// answers the question the hold raises (null dismisses it).
const boot = (on: On, answer: string | null = 'Run it') => {
  const world = { ran: [] as string[], asked: [] as Asked[] }

  on('tool.call', ($, e) => {
    if (e.tool === 'AskUserQuestion') {
      const [first] = e.questions
      const question = first?.question ?? ''
      world.asked.push({
        question,
        header: first?.header ?? '',
        options: (first?.options ?? []).map(option => option.label),
      })

      return answer === null ? { deny: 'dismissed' } : { result: { answers: { [question]: answer } } }
    }

    if (e.tool === 'Bash' || e.tool === 'PowerShell') {
      world.ran.push(e.command)
    }

    return { result: 'ok' }
  })

  return world
}

test('runs an ordinary command without a question', async ($, on) => {
  const world = boot(on)
  const out = await $.tool.call({ tool: 'Bash', command: 'npm test' })

  expect(world.asked).toEqual([])
  expect(world.ran).toEqual(['npm test'])
  expect(out.result).toBe('ok')
})

test('asks before a risky command, naming it and what it does', async ($, on) => {
  const world = boot(on)
  await $.tool.call({ tool: 'Bash', command: 'rm -rf src' })

  expect(world.asked).toEqual([
    {
      question: '`rm -rf src` deletes folders and everything in them. Run it?',
      header: 'Risky',
      options: ['Run it', 'Block it'],
    },
  ])
})

test('runs the command once the person says so', async ($, on) => {
  const world = boot(on, 'Run it')
  const out = await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })

  expect(world.ran).toEqual(['git reset --hard'])
  expect(out.result).toBe('ok')
})

test('does not run a blocked command, and tells Claude not to work around it', async ($, on) => {
  const world = boot(on, 'Block it')
  const out = await $.tool.call({ tool: 'Bash', command: 'git push --force' })

  expect(world.ran).toEqual([])
  expect(out.deny).toMatch(/blocked this command/)
  expect(out.deny).toMatch(/overwrites or deletes work on the remote/)
  expect(out.deny).toMatch(/another way/)
})

test('passes on what the person typed instead of choosing', async ($, on) => {
  const world = boot(on, 'move it to the temp folder instead')
  const out = await $.tool.call({ tool: 'Bash', command: 'rm -rf src' })

  expect(world.ran).toEqual([])
  expect(out.deny).toMatch(/move it to the temp folder instead/)
})

test('does not run it when nobody answers', async ($, on) => {
  const world = boot(on, null)
  const out = await $.tool.call({ tool: 'Bash', command: 'rm -rf src' })

  expect(world.ran).toEqual([])
  expect(out.deny).toMatch(/nobody approved it/)
})

test('holds a PowerShell command too', async ($, on) => {
  const world = boot(on, 'Block it')
  const out = await $.tool.call({ tool: 'PowerShell', command: 'Remove-Item src -Recurse -Force' })

  expect(world.asked).toHaveLength(1)
  expect(world.ran).toEqual([])
  expect(out.deny).toMatch(/blocked this command/)
})

test('lets PowerShell run what is not risky', async ($, on) => {
  const world = boot(on)
  await $.tool.call({ tool: 'PowerShell', command: 'Get-ChildItem' })

  expect(world.asked).toEqual([])
  expect(world.ran).toEqual(['Get-ChildItem'])
})

test('shortens a very long command in the question', async ($, on) => {
  const world = boot(on)
  const command = `rm -rf src ${'x'.repeat(600)}`
  await $.tool.call({ tool: 'Bash', command })
  const [asked] = world.asked

  expect(asked?.question.length).toBeLessThan(420)
  expect(asked?.question).toMatch(/^`rm -rf src x+…` deletes folders/)
})

test('asks about each risky command on its own', async ($, on) => {
  const world = boot(on)
  await $.tool.call({ tool: 'Bash', command: 'rm -rf src' })
  await $.tool.call({ tool: 'Bash', command: 'git clean -fd' })

  expect(world.asked).toHaveLength(2)
  expect(world.ran).toEqual(['rm -rf src', 'git clean -fd'])
})
