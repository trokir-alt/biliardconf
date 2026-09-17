/**
 * GET  /api/exercises?since=<ms> - what changed since that mark.
 * POST /api/exercises?since=<ms> - the same answer, after healing the
 *                                  catalogue with the ids the device offers.
 *
 * The brief asks for this to come from one list() by prefix "with metadata".
 * It cannot, for two separate reasons.
 *
 * The first is cost: list() answers with { key, etag } and nothing else, so
 * reading metadata that way would be one request per exercise on every poll -
 * a hundred round trips every thirty seconds on a hundred-exercise library.
 *
 * The second is that on the live site list() did not work at all. It answered
 * "empty" for a store whose writes returned 200 and whose keyed reads returned
 * the bodies, for every prefix, without an error. Two devices saved into one
 * store and neither ever saw the other. Nothing in a client can tell that
 * apart from a library that is genuinely empty, so this feed does not ask.
 *
 * It reads the catalogue - one key, one strongly consistent read - and answers
 * from it. A quiet poll is one request that transfers nothing but the rows
 * that changed, and the answer cannot be silently emptied by a call that
 * shrugs.
 */

import type { Config, Context } from '@netlify/functions'
import { ID_RE, KEY, LIST_PAGE, type ExerciseMeta, type ExerciseRecord, type HealBody } from '../../src/sync/wire.ts'
import { catalogAdd, catalogItems } from '../lib/catalog.mts'
import { STRONG, json, now, openStore, type BlobStore } from '../lib/store.mts'

/** the most ids one heal will look up, so the call always fits in its time */
const HEAL_MAX = 300

export default async (req: Request, _context: Context) => {
  const store = openStore()
  const since = Number(new URL(req.url).searchParams.get('since') ?? 0) || 0
  if (req.method === 'POST') return heal(req, store, since)
  if (req.method !== 'GET') return json({ error: 'method' }, 405)
  return feed(store, since)
}

async function feed(store: BlobStore, since: number): Promise<Response> {
  const fresh = (await catalogItems(store))
    .filter((m) => m.updatedAt > since)
    .sort((a, b) => a.updatedAt - b.updatedAt)

  const page = fresh.slice(0, LIST_PAGE)
  // the cursor is the newest mark actually returned, so nothing is skipped
  // when the page cuts the list short
  const cursor = page.length ? page[page.length - 1].updatedAt : since
  return json({ now: now(), cursor, items: page, more: fresh.length > page.length })
}

/**
 * Take the ids a device says it holds and put back any the catalogue lost.
 *
 * This is the repair path, and it is the reason the catalogue can be rebuilt
 * without a working list(). The record itself is always readable by key; what
 * can go missing is the knowledge that the key exists. A device that has the
 * exercise cached knows exactly that, so it offers its ids on the first
 * exchange after it starts.
 *
 * It creates nothing. An id with no body behind it - swept, or never ours - is
 * ignored, so a device cannot resurrect anything through this door.
 */
async function heal(req: Request, store: BlobStore, since: number): Promise<Response> {
  let body: HealBody | null = null
  try {
    body = (await req.json()) as HealBody
  } catch {
    body = null
  }
  const offered = Array.isArray(body?.ids) ? body.ids.filter((id) => typeof id === 'string' && ID_RE.test(id)) : []
  const known = new Set((await catalogItems(store)).map((m) => m.id))
  const unknown = [...new Set(offered.filter((id) => !known.has(id)))].slice(0, HEAL_MAX)

  let restored = 0
  if (unknown.length) {
    const found = (
      await Promise.all(
        unknown.map(async (id) => {
          const hit = await store.getWithMetadata(KEY.exercise(id), { type: 'json', ...STRONG })
          const record = (hit?.data ?? null) as ExerciseRecord | null
          if (!record || typeof record.id !== 'string') return null
          const { scene: _scene, ...meta } = record
          return meta as ExerciseMeta
        }),
      )
    ).filter((m): m is ExerciseMeta => m !== null)
    if (found.length) restored = await catalogAdd(store, found)
  }

  const res = await feed(store, since)
  const answer = (await res.json()) as Record<string, unknown>
  return json({ ...answer, restored })
}

export const config: Config = { path: '/api/exercises', region: 'fra' }
