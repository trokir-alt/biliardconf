/**
 * The catalogue: the library's metadata in one blob, changed under a lock.
 *
 * Why this exists at all
 * ---------------------
 * The change feed used to be a listing. Every write dropped a marker under
 * `changed/<time>-<id>`, and a poll listed that prefix. On the live site the
 * listing answered "empty" for a store that was demonstrably not empty: the
 * PUTs came back 200, a keyed read returned the body it had just written, the
 * probe key written and read back by /api/health worked - and every listing,
 * of every prefix, reported nothing. Two devices therefore saved into the same
 * store and neither could see the other's work.
 *
 * The cause was never established from the outside, and that is the point:
 * list() can answer "nothing here" for a store that holds everything, without
 * an error, and no client can tell that apart from an empty library. So the
 * feed no longer asks it. Everything that enumerates - the feed, the export,
 * the nightly snapshot - reads THIS key, and a keyed read is the one call the
 * live site has been shown to answer correctly.
 *
 * Why a read-check-write loop
 * ---------------------------
 * One blob with two devices writing it is a lost-update waiting to happen, so
 * every change is a compare-and-swap against the ETag. Two things then need
 * care:
 *
 * - A 412 means somebody else got there first. Re-read, re-apply, retry.
 * - A conditional write reports `modified: true` for ANY answer that is not a
 *   412 - a 500 included. So the loop never trusts that report: it re-reads
 *   and checks the change is actually there. A write that quietly failed is
 *   exactly the failure this file exists because of; it is not going to be
 *   taken on trust here.
 */

import { KEY, type Catalog, type ExerciseMeta } from '../../src/sync/wire.ts'
import { STRONG, type BlobStore } from './store.mts'

/** how many times a contended change is re-tried before it is an error */
const ATTEMPTS = 6

function isMeta(v: unknown): v is ExerciseMeta {
  const m = v as ExerciseMeta
  return !!m && typeof m === 'object' && typeof m.id === 'string' && typeof m.rev === 'number'
}

/** the whole library's metadata, and the tag the next write must match */
export async function readCatalog(store: BlobStore): Promise<{ items: ExerciseMeta[]; etag: string | null }> {
  const hit = await store.getWithMetadata(KEY.catalog, { type: 'json', ...STRONG })
  const data = (hit?.data ?? null) as Catalog | null
  const items = Array.isArray(data?.items) ? data.items.filter(isMeta) : []
  return { items, etag: hit?.etag ?? null }
}

/** just the rows, for the readers that have nothing to write */
export async function catalogItems(store: BlobStore): Promise<ExerciseMeta[]> {
  return (await readCatalog(store)).items
}

/**
 * Apply a change to the catalogue and prove it landed.
 *
 * `edit` must be pure and idempotent - it is called again on every retry -
 * and `satisfied` says what "landed" means, so the loop can stop the moment
 * the goal is true, whether this call or a competing one got it there.
 */
async function change(
  store: BlobStore,
  edit: (items: ExerciseMeta[]) => ExerciseMeta[],
  satisfied: (items: ExerciseMeta[]) => boolean,
): Promise<ExerciseMeta[]> {
  let last: ExerciseMeta[] = []
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const { items, etag } = await readCatalog(store)
    last = items
    // the read is the verification of the previous pass's write, and the
    // shortcut when another writer already made the same change
    if (satisfied(items)) return items
    const next = edit(items)
    const body: Catalog = { version: 1, updatedAt: Date.now(), items: next }
    try {
      await (etag
        ? store.setJSON(KEY.catalog, body, { onlyIfMatch: etag })
        : store.setJSON(KEY.catalog, body, { onlyIfNew: true }))
    } catch {
      // a refused write is a reason to re-read, not to give up: the next pass
      // decides from what the store actually holds
    }
    if (attempt > 0) await pause(40 * attempt)
  }

  /**
   * The conditional write would not take. Write it plainly instead.
   *
   * Six refusals in a row is not contention between two devices in a billiard
   * hall; it is a platform that does not honour `if-match` at all. If that is
   * what this is, insisting would mean the coach cannot save anything to the
   * server - a worse failure than the one being fixed, and a silent one. So
   * availability wins: the row goes in unconditionally, and the protection
   * that is given up here is the protection the heal path restores anyway,
   * because every device offers the ids it holds on its next start.
   */
  const { items } = await readCatalog(store)
  if (satisfied(items)) return items
  const next = edit(items)
  await store.setJSON(KEY.catalog, { version: 1, updatedAt: Date.now(), items: next })
  const after = await readCatalog(store)
  if (satisfied(after.items)) return after.items
  // the record itself is written and readable by key; only the catalogue is
  // behind, and the next write or the next heal puts it right
  throw new CatalogBusy(last.length)
}

export class CatalogBusy extends Error {
  readonly held: number
  constructor(held: number) {
    super(`catalog busy after ${ATTEMPTS} attempts`)
    this.held = held
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** put this revision in the catalogue, replacing any older one for its id */
export async function catalogPut(store: BlobStore, meta: ExerciseMeta): Promise<void> {
  await change(
    store,
    (items) => [...items.filter((m) => m.id !== meta.id), meta],
    // `>=` and not `===`: a newer revision from another device is already a
    // better answer than ours, and rewriting it backwards would lose it
    (items) => items.some((m) => m.id === meta.id && m.rev >= meta.rev),
  )
}

/** fold records the catalogue never heard of back into it */
export async function catalogAdd(store: BlobStore, metas: ExerciseMeta[]): Promise<number> {
  const missing = metas.filter((m) => isMeta(m))
  if (!missing.length) return 0
  const before = (await catalogItems(store)).length
  await change(
    store,
    (items) => {
      const by = new Map(items.map((m) => [m.id, m]))
      for (const m of missing) {
        const cur = by.get(m.id)
        if (!cur || cur.rev < m.rev) by.set(m.id, m)
      }
      return [...by.values()]
    },
    (items) => {
      const by = new Map(items.map((m) => [m.id, m.rev]))
      return missing.every((m) => (by.get(m.id) ?? -1) >= m.rev)
    },
  )
  return Math.max(0, (await catalogItems(store)).length - before)
}

/** take ids out, for the sweeper that has just taken their bodies */
export async function catalogDrop(store: BlobStore, ids: string[]): Promise<void> {
  if (!ids.length) return
  const gone = new Set(ids)
  await change(
    store,
    (items) => items.filter((m) => !gone.has(m.id)),
    (items) => !items.some((m) => gone.has(m.id)),
  )
}

/* ------------------------------------------------------- snapshot days */

/**
 * Which days have a snapshot.
 *
 * Same reason as the catalogue: this used to be `list({ prefix: 'snapshots/' })`,
 * and a restore screen that lists nothing is indistinguishable from a site
 * that has never taken a backup. Only the nightly job writes it.
 */
export async function readDays(store: BlobStore): Promise<string[]> {
  const hit = await store.get(KEY.days, { type: 'json', ...STRONG })
  const days = (hit as { days?: unknown } | null)?.days
  return Array.isArray(days) ? days.filter((d): d is string => typeof d === 'string').sort() : []
}

export async function writeDays(store: BlobStore, days: string[]): Promise<void> {
  await store.setJSON(KEY.days, { days: [...new Set(days)].sort() })
}
