/**
 * GET /api/backup - the whole library as one file.
 *
 * The count is written from the catalogue BEFORE any body is read, and the
 * client refuses a file whose records do not match it. A truncated backup that
 * looks complete is worse than no backup at all.
 *
 * It reads the catalogue rather than listing the store, for the reason set out
 * in netlify/lib/catalog.mts: a listing on the live site answered "empty" for
 * a store that was not, and this endpoint is exactly where that answer does
 * the most damage - the coach presses "выгрузить", is handed a file with zero
 * records, and has no way to know it is a lie.
 */

import type { Config, Context } from '@netlify/functions'
import { KEY, type ExerciseRecord } from '../../src/sync/wire.ts'
import { catalogItems } from '../lib/catalog.mts'
import { STRONG, json, now, openStore } from '../lib/store.mts'

export default async (_req: Request, _context: Context) => {
  const store = openStore()
  const ids = [...new Set((await catalogItems(store)).map((m) => m.id))]
  const records = (
    await Promise.all(ids.map((id) => store.get(KEY.exercise(id), { type: 'json', ...STRONG })))
  ).filter((r): r is ExerciseRecord => !!r)
  return json({ exportedAt: now(), count: ids.length, records })
}

export const config: Config = { path: '/api/backup', region: 'fra' }
