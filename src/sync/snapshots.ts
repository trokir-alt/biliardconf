/**
 * Daily snapshots, and getting the library back out of one.
 *
 * Restoring is deliberately not a server operation. Each exercise goes back
 * through the ordinary write path, which means it gets an ordinary revision,
 * obeys the same conflict rules, and reaches the other devices by the same
 * sync as any edit. A special server-side "restore everything" would be a
 * second way to write the library, and the second way is always the one that
 * turns out to have a hole in it.
 *
 * Nothing is overwritten blind either: whatever an exercise holds now is
 * parked beside it as «копия перед восстановлением» before the older version
 * takes its place. A restore is meant to end an argument, not start one.
 */

import type { ExerciseRecord } from './wire'
import { beforeRestoreTitle } from './wire'
import { commitLocal, createLocal, listMeta, now, readRecord } from './local'

const CALL_TIMEOUT_MS = 10_000

async function api<T>(path: string): Promise<T> {
  const res = await fetch(path, { signal: AbortSignal.timeout(CALL_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return (await res.json()) as T
}

export type SnapshotBody = {
  day: string
  takenAt: number
  count: number
  records: ExerciseRecord[]
}

export async function snapshotDays(): Promise<string[]> {
  const body = await api<{ days: string[] }>('/api/snapshots')
  return body.days ?? []
}

export async function readSnapshot(day: string): Promise<SnapshotBody> {
  return api<SnapshotBody>(`/api/snapshots/${day}`)
}

export type RestoreResult = { restored: number; parked: number }

/**
 * Put the chosen exercises back as they were on that day.
 *
 * @param ids the exercises to take, or 'all' for the whole snapshot.
 */
export async function restoreFromSnapshot(
  snap: SnapshotBody,
  ids: string[] | 'all',
): Promise<RestoreResult> {
  const want = ids === 'all' ? null : new Set(ids)
  let restored = 0
  let parked = 0
  for (const rec of snap.records) {
    if (want && !want.has(rec.id)) continue
    if (!rec.scene) continue
    const current = await readRecord(rec.id)
    const same = current && JSON.stringify(current.scene) === JSON.stringify(rec.scene)
    if (current && !same) {
      const title = beforeRestoreTitle(current.meta.title, now())
      await createLocal({ ...current.scene, title }, title)
      parked++
    }
    if (same && current.meta.deletedAt === null) continue
    await commitLocal({ id: rec.id, scene: rec.scene, title: rec.title })
    restored++
  }
  return { restored, parked }
}

/* --------------------------------------------------------------- backup */

/**
 * The whole library as one file.
 *
 * From the server when it answers, because that is the copy every device
 * shares; from this device when it does not, because a backup that refuses to
 * be made without a network is not a backup.
 */
export async function buildBackup(): Promise<{ body: unknown; source: 'server' | 'device' }> {
  try {
    const body = await api<{ count: number; records: unknown[] }>('/api/backup')
    // a file that claims more records than it carries is a broken backup and
    // must not be handed over as if it were whole
    if (Array.isArray(body.records) && body.records.length >= body.count) {
      return { body, source: 'server' }
    }
  } catch {
    // fall through to the local copy
  }
  const metas = await listMeta()
  const records: ExerciseRecord[] = []
  for (const m of metas) {
    const rec = await readRecord(m.id)
    if (rec) records.push({ ...m, scene: rec.scene })
  }
  return { body: { exportedAt: now(), count: records.length, records }, source: 'device' }
}

export function downloadJson(body: unknown, name: string): void {
  const blob = new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
