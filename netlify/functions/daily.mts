/**
 * The nightly job: one snapshot of the library, then the sweep.
 *
 * It runs on a schedule rather than on the first request of the day, for two
 * reasons. A user-facing request has thirty seconds; listing every exercise,
 * reading every body and writing a snapshot does not reliably fit, and a
 * coach opening the app should never be the one who pays for it. And "first
 * request of the day" is a race the moment two devices open at once.
 *
 * Order matters and is enforced, not assumed: the sweeper only takes bodies
 * that are inside the snapshot it has just written. Anything the snapshot
 * missed survives to the next night rather than disappearing between them.
 */

import type { Config } from '@netlify/functions'
import { KEY, SNAPSHOT_KEEP, TOMBSTONE_DAYS, dayKey, parseChangedKey, type ExerciseRecord } from '../../src/sync/wire.ts'
import { STRONG, openStore } from '../lib/store.mts'

export default async () => {
  const store = openStore()
  const at = Date.now()

  const { blobs } = await store.list({ prefix: 'changed/' })
  const ids = [...new Set(blobs.map((b) => parseChangedKey(b.key)?.id).filter((v): v is string => !!v))]
  const records = (
    await Promise.all(ids.map((id) => store.get(KEY.exercise(id), { type: 'json', ...STRONG })))
  ).filter((r): r is ExerciseRecord => !!r)

  const day = dayKey(at)
  await store.setJSON(KEY.snapshot(day), { day, takenAt: at, count: records.length, records })

  // keep thirty days; the library weighs kilobytes, so this is cheap insurance
  const snaps = (await store.list({ prefix: 'snapshots/' })).blobs
    .map((b) => b.key.slice('snapshots/'.length))
    .sort()
  for (const old of snaps.slice(0, Math.max(0, snaps.length - SNAPSHOT_KEEP))) {
    await store.delete(KEY.snapshot(old))
  }

  // the sweep: a tombstone older than thirty days loses its body, but only if
  // this night's snapshot actually holds a copy of it
  const cutoff = at - TOMBSTONE_DAYS * 24 * 60 * 60 * 1000
  const inSnapshot = new Set(records.map((r) => r.id))
  let swept = 0
  for (const r of records) {
    if (r.deletedAt === null || r.deletedAt > cutoff) continue
    if (!inSnapshot.has(r.id)) continue
    await store.setJSON(KEY.grave(r.id), { id: r.id, sweptAt: at }, { metadata: { sweptAt: at } })
    await store.delete(KEY.exercise(r.id))
    await store.delete(KEY.preview(r.id))
    const marker = blobs.find((b) => parseChangedKey(b.key)?.id === r.id)
    if (marker) await store.delete(marker.key)
    swept++
  }
  console.log(`snapshot ${day}: ${records.length} exercises, swept ${swept}`)
}

export const config: Config = { schedule: '17 3 * * *' }
