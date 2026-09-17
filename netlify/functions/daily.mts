/**
 * The nightly job: one snapshot of the library, then the sweep.
 *
 * It runs on a schedule rather than on the first request of the day, for two
 * reasons. A user-facing request has thirty seconds; reading every exercise
 * and writing a snapshot does not reliably fit, and a coach opening the app
 * should never be the one who pays for it. And "first request of the day" is a
 * race the moment two devices open at once.
 *
 * Order matters and is enforced, not assumed: the sweeper only takes bodies
 * that are inside the snapshot it has just written. Anything the snapshot
 * missed survives to the next night rather than disappearing between them.
 *
 * What it photographs comes from the catalogue. It used to come from a listing,
 * and on the live site that listing answered "empty" - which would have meant a
 * nightly snapshot of nothing, every night, while the coach believed there was
 * thirty days of cover. A snapshot that is quietly empty is worse than no
 * snapshot at all, so the count is logged and an empty catalogue writes no
 * snapshot and sweeps nothing.
 */

import type { Config } from '@netlify/functions'
import { KEY, SNAPSHOT_KEEP, TOMBSTONE_DAYS, dayKey, type ExerciseRecord } from '../../src/sync/wire.ts'
import { catalogDrop, catalogItems, readDays, writeDays } from '../lib/catalog.mts'
import { STRONG, openStore } from '../lib/store.mts'

export default async () => {
  const store = openStore()
  const at = Date.now()

  const ids = [...new Set((await catalogItems(store)).map((m) => m.id))]
  const records = (
    await Promise.all(ids.map((id) => store.get(KEY.exercise(id), { type: 'json', ...STRONG })))
  ).filter((r): r is ExerciseRecord => !!r)

  if (!records.length) {
    // nothing to photograph, and - decisively - nothing to sweep against an
    // empty snapshot. Silence here is what let an empty catalogue look healthy.
    console.log(`snapshot skipped: catalogue holds ${ids.length} ids, ${records.length} bodies`)
    return
  }

  const day = dayKey(at)
  await store.setJSON(KEY.snapshot(day), { day, takenAt: at, count: records.length, records })
  const days = [...new Set([...(await readDays(store)), day])].sort()

  // keep thirty days; the library weighs kilobytes, so this is cheap insurance
  const drop = days.slice(0, Math.max(0, days.length - SNAPSHOT_KEEP))
  for (const old of drop) await store.delete(KEY.snapshot(old))
  await writeDays(store, days.slice(drop.length))

  // the sweep: a tombstone older than thirty days loses its body, but only if
  // this night's snapshot actually holds a copy of it
  const cutoff = at - TOMBSTONE_DAYS * 24 * 60 * 60 * 1000
  const inSnapshot = new Set(records.map((r) => r.id))
  const swept: string[] = []
  for (const r of records) {
    if (r.deletedAt === null || r.deletedAt > cutoff) continue
    if (!inSnapshot.has(r.id)) continue
    await store.setJSON(KEY.grave(r.id), { id: r.id, sweptAt: at }, { metadata: { sweptAt: at } })
    await store.delete(KEY.exercise(r.id))
    await store.delete(KEY.preview(r.id))
    await store.delete(KEY.changed(r.updatedAt, r.id))
    swept.push(r.id)
  }
  if (swept.length) await catalogDrop(store, swept)
  console.log(`snapshot ${day}: ${records.length} exercises, swept ${swept.length}`)
}

export const config: Config = { schedule: '17 3 * * *' }
