/**
 * GET /api/backup - the whole library as one file.
 *
 * The count is written from the listing BEFORE any body is read, and the
 * client refuses a file whose records do not match it. A truncated backup
 * that looks complete is worse than no backup at all.
 */

import type { Config, Context } from '@netlify/functions'
import { KEY, parseChangedKey, type ExerciseRecord } from '../../src/sync/wire.ts'
import { json, now, openStore } from '../lib/store.mts'

export default async (_req: Request, _context: Context) => {
  const store = openStore()
  const { blobs } = await store.list({ prefix: 'changed/' })
  const ids = [...new Set(blobs.map((b) => parseChangedKey(b.key)?.id).filter((v): v is string => !!v))]
  const records = (
    await Promise.all(ids.map((id) => store.get(KEY.exercise(id), { type: 'json' })))
  ).filter((r): r is ExerciseRecord => !!r)
  return json({ exportedAt: now(), count: ids.length, records })
}

export const config: Config = { path: '/api/backup', region: 'fra' }
