// Work one copy of the mod does for all of them. Every open session loads its
// own copy; each periodic job (a PC check, the weather, the service status)
// has a cache file and a lock file, and only the copy holding the lock runs it.
// The file system has no atomic create, so a lock is taken by writing it,
// waiting a moment and reading it back.

import type { EngineInterface } from 'claude-code'

/** A job's last answer: when it last worked, when it was last tried, and whether that try failed. */
export type Cached<T> = { at: number; triedAt: number; isFailed: boolean; value: T | null }

/**
 * A job's files are `${dir}/${name}.json` and `${dir}/${name}.lock.json`.
 * `retryMs`: how soon a failed try is tried again (default `everyMs`), so a
 * daily job that met no network is not left empty for a day.
 */
export type JobSpec = { dir: string; name: string; everyMs: number; retryMs?: number; lockMs?: number }

type Lock = { owner: string; at: number }

const LOCK_MS = 60_000 // a copy that died holding a job's lock gives it up after this
const SETTLE_MS = 400
const SHORT_LOCK_MS = 5000 // withLock: one read-change-write

/**
 * Work left running in the background. A reload (a save, a /config change)
 * unloads the environment under it and its next `$` call rejects: let it go.
 */
export function background(work: Promise<unknown>): void {
  work.catch(() => undefined)
}

export async function readJson<T>($: EngineInterface, path: string): Promise<T | null> {
  try {
    return JSON.parse(await $.fs.read(path)) as T
  } catch {
    return null
  }
}

/** Writes this copy's lock, waits, and reads it back: true while it is still ours. */
async function takeLock($: EngineInterface, me: string, path: string, now: number): Promise<boolean> {
  await $.fs.write(path, JSON.stringify({ owner: me, at: now }))
  await $.clock.sleep(SETTLE_MS)
  const held = await readJson<Lock>($, path)
  return held?.owner === me && held.at === now
}

/**
 * The newest answer of a shared job, running it first when the cache is older
 * than `everyMs` and no other copy holds a fresh lock. `work` gets the last
 * value; returning null or throwing keeps that value, marked failed. A failed
 * try is not repeated before `retryMs` (or `everyMs`): no hammering.
 */
export async function runShared<T>(
  $: EngineInterface,
  me: string,
  job: JobSpec,
  work: (last: T | null) => Promise<T | null>,
): Promise<Cached<T> | null> {
  const file = `${job.dir}/${job.name}.json`
  const lockFile = `${job.dir}/${job.name}.lock.json`
  const cached = await readJson<Cached<T>>($, file)
  const now = await $.clock.now()
  if (cached && now - cached.triedAt < (cached.isFailed ? (job.retryMs ?? job.everyMs) : job.everyMs)) return cached

  const lock = await readJson<Lock>($, lockFile)
  if (lock && lock.owner !== me && now - lock.at < (job.lockMs ?? LOCK_MS)) return cached
  if (!(await takeLock($, me, lockFile, now))) return cached

  // Another copy may have finished it while this one waited.
  const latest = (await readJson<Cached<T>>($, file)) ?? cached
  if (latest && latest.triedAt > (cached?.triedAt ?? 0)) return latest

  let value: T | null = null
  try {
    value = await work(latest?.value ?? null)
  } catch {
    value = null
  }
  const done = await $.clock.now()
  const next: Cached<T> =
    value === null
      ? { at: latest?.at ?? 0, triedAt: done, isFailed: true, value: latest?.value ?? null }
      : { at: done, triedAt: done, isFailed: false, value }
  await $.fs.write(file, JSON.stringify(next))
  return next
}

/**
 * Runs `fn` holding a short lock, for a read-change-write of a shared file
 * (the reminders). Null, without running it, while another copy holds a fresh one.
 */
export async function withLock<T>($: EngineInterface, me: string, path: string, fn: () => Promise<T>): Promise<T | null> {
  const now = await $.clock.now()
  const lock = await readJson<Lock>($, path)
  if (lock && lock.owner !== me && now - lock.at < SHORT_LOCK_MS) return null
  if (!(await takeLock($, me, path, now))) return null
  try {
    return await fn()
  } finally {
    // Free it at once for the next writer.
    await $.fs.write(path, JSON.stringify({ owner: me, at: 0 })).catch(() => undefined)
  }
}

/** Where facts about this PC live, shared by every account: weather, PC checks, reminders. */
export function machineDirOf(env: { localAppData: string | undefined; home: string | undefined }, configDir: string): string {
  if (env.localAppData) return `${env.localAppData}/clawd-mods`
  if (env.home) return `${env.home}/.local/share/clawd-mods`
  return `${configDir}/clawd-mods/machine`
}
