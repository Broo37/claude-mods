import type { EngineInterface } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { type Cached, type JobSpec, machineDirOf, runShared, withLock } from '../hooks/shared'
import { CFG, MIN, NOW } from './world'

const JOB: JobSpec = { dir: 'C:/L/clawd-mods', name: 'answer', everyMs: 2 * MIN }
const FILE = `${JOB.dir}/answer.json`
const LOCK = `${JOB.dir}/answer.lock.json`

/**
 * The four calls the runner makes, on files in memory and a clock the test
 * moves: a test's own hooks may not call `$`, so the runner is tested alone.
 */
function machine() {
  const files = new Map<string, string>()
  let now = NOW
  let sleepers: { at: number; wake: () => void }[] = []
  const $ = {
    fs: {
      read: async (path: string) => {
        const text = files.get(path)
        if (text === undefined) throw new Error(`ENOENT: ${path}`)
        return text
      },
      write: async (path: string, text: string) => {
        files.set(path, text)
      },
    },
    clock: {
      now: async () => now,
      sleep: (ms: number) => new Promise<void>(wake => sleepers.push({ at: now + ms, wake })),
    },
  } as unknown as EngineInterface
  const settle = async () => {
    for (let i = 0; i < 50; i += 1) await Promise.resolve()
  }
  const advance = async (ms: number) => {
    await settle()
    now += ms
    const due = sleepers.filter(one => one.at <= now)
    sleepers = sleepers.filter(one => one.at > now)
    for (const one of due) one.wake()
    await settle()
  }
  return { $, files, advance }
}

/** Runs the job as copy `me`, letting its lock settle. */
async function run(m: ReturnType<typeof machine>, me: string, work: () => Promise<number | null>) {
  const got = runShared<number>(m.$, me, JOB, work)
  await m.advance(400)
  return got
}

test('one copy runs the job, the other reads its cache', async () => {
  const m = machine()
  let runs = 0
  const work = async () => {
    runs += 1
    return 42
  }
  const a = runShared<number>(m.$, 'a', JOB, work)
  const b = runShared<number>(m.$, 'b', JOB, work)
  await m.advance(400)
  await Promise.all([a, b])
  expect(runs).toBe(1)
  expect((await runShared<number>(m.$, 'a', JOB, work))?.value).toBe(42)
  expect((await runShared<number>(m.$, 'b', JOB, work))?.value).toBe(42)
  expect(runs).toBe(1)
})

test('a fresh cache is not redone', async () => {
  const m = machine()
  let runs = 0
  const work = async () => {
    runs += 1
    return 42
  }
  await run(m, 'a', work)
  await m.advance(MIN)
  expect((await run(m, 'a', work))?.value).toBe(42)
  expect(runs).toBe(1)
  await m.advance(MIN) // now older than everyMs
  await run(m, 'a', work)
  expect(runs).toBe(2)
})

test('a failure keeps the last value, marked failed, and is not retried at once', async () => {
  const m = machine()
  const old: Cached<number> = { at: NOW - 10 * MIN, triedAt: NOW - 10 * MIN, isFailed: false, value: 7 }
  m.files.set(FILE, JSON.stringify(old))
  let runs = 0
  const dies = async (): Promise<number | null> => {
    runs += 1
    throw new Error('the script died')
  }
  expect(await run(m, 'a', dies)).toMatchObject({ value: 7, isFailed: true, at: NOW - 10 * MIN })
  expect(await run(m, 'a', dies)).toMatchObject({ value: 7, isFailed: true })
  expect(runs).toBe(1)
})

test('a failed long job is tried again after retryMs, not a whole everyMs', async () => {
  const m = machine()
  const daily: JobSpec = { dir: JOB.dir, name: 'answer', everyMs: 1440 * MIN, retryMs: 10 * MIN }
  m.files.set(FILE, JSON.stringify({ at: 0, triedAt: NOW - 11 * MIN, isFailed: true, value: null }))
  let runs = 0
  const got = runShared<number>(m.$, 'a', daily, async () => {
    runs += 1
    return 5
  })
  await m.advance(400)
  expect((await got)?.value).toBe(5)
  expect(runs).toBe(1)
  // A good answer waits the whole day.
  expect(await runShared<number>(m.$, 'a', daily, async () => 6)).toMatchObject({ value: 5 })
})

test('stale lock: a copy that died holding it does not block the job', async () => {
  const m = machine()
  m.files.set(LOCK, JSON.stringify({ owner: 'dead', at: NOW - 61_000 }))
  expect((await run(m, 'a', async () => 42))?.value).toBe(42)
})

test('a fresh lock of another copy: this one only reads', async () => {
  const m = machine()
  m.files.set(LOCK, JSON.stringify({ owner: 'other', at: NOW - 5000 }))
  let runs = 0
  const got = await run(m, 'a', async () => {
    runs += 1
    return 42
  })
  expect(got).toBeNull()
  expect(runs).toBe(0)
})

test('withLock runs while the lock is free, and refuses while another copy holds it', async () => {
  const m = machine()
  const path = 'C:/L/clawd-mods/reminders.lock.json'
  const free = withLock(m.$, 'a', path, async () => 'ran')
  await m.advance(400)
  expect(await free).toBe('ran')
  // Freed at once for the next writer.
  expect(JSON.parse(m.files.get(path) ?? '{}')).toMatchObject({ at: 0 })
  m.files.set(path, JSON.stringify({ owner: 'other', at: NOW + 400 }))
  const held = withLock(m.$, 'a', path, async () => 'ran')
  await m.advance(400)
  expect(await held).toBeNull()
})

test('machine dir', () => {
  expect(machineDirOf({ localAppData: 'C:/L', home: undefined }, CFG)).toBe('C:/L/clawd-mods')
  expect(machineDirOf({ localAppData: undefined, home: '/home/u' }, CFG)).toBe('/home/u/.local/share/clawd-mods')
  expect(machineDirOf({ localAppData: undefined, home: undefined }, CFG)).toBe(`${CFG}/clawd-mods/machine`)
})
