/**
 * GET /api/exercises?since=<ms> - what changed since that mark.
 *
 * The brief asks for this to come from one list() by prefix "with metadata".
 * It cannot: list() answers with { key, etag } and nothing else, so reading
 * metadata would cost one request per exercise on every poll - a hundred round
 * trips every thirty seconds on a hundred-exercise library.
 *
 * Instead every write also drops a marker under changed/<serverTime>-<id>
 * whose BODY is that revision's metadata. The server time is in the key, so
 * "what changed since" is decided from the key names alone, and only the
 * markers actually in range are read. A quiet poll is one request.
 */

import type { Config, Context } from '@netlify/functions'
import { LIST_PAGE, parseChangedKey, type ExerciseMeta } from '../../src/sync/wire.ts'
import { json, now, openStore } from '../lib/store.mts'

export default async (req: Request, _context: Context) => {
  if (req.method !== 'GET') return json({ error: 'method' }, 405)
  const since = Number(new URL(req.url).searchParams.get('since') ?? 0) || 0
  const store = openStore()

  const { blobs } = await store.list({ prefix: 'changed/' })
  const fresh = blobs
    .map((b) => ({ key: b.key, at: parseChangedKey(b.key) }))
    .filter((b): b is { key: string; at: { updatedAt: number; id: string } } => b.at !== null && b.at.updatedAt > since)
    .sort((a, b) => a.at.updatedAt - b.at.updatedAt)

  const page = fresh.slice(0, LIST_PAGE)
  const items = (await Promise.all(page.map((b) => store.get(b.key, { type: 'json' })))).filter(
    (m): m is ExerciseMeta => !!m && typeof m === 'object' && typeof (m as ExerciseMeta).id === 'string',
  )

  // the cursor is the newest mark actually returned, so nothing is skipped
  // when the page cuts the list short
  const cursor = page.length ? page[page.length - 1].at.updatedAt : since
  return json({ now: now(), cursor, items, more: fresh.length > page.length })
}

export const config: Config = { path: '/api/exercises', region: 'fra' }
