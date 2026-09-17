/**
 * The daily snapshots: what dates exist, and what is inside one of them.
 *
 * Restoring is done by the client, one exercise at a time through the normal
 * write path, so a restore is an ordinary revision with an ordinary rev bump
 * and cannot smuggle a body past the conflict rules.
 *
 * The list of days is a blob the nightly job keeps, not a listing of the
 * `snapshots/` prefix. A restore screen that shows no dates is indistinguishable
 * from a site that has never taken a backup, and on the live site a listing
 * could answer exactly that for a store full of snapshots.
 */

import type { Config, Context } from '@netlify/functions'
import { KEY } from '../../src/sync/wire.ts'
import { readDays } from '../lib/catalog.mts'
import { STRONG, fail, json, openStore } from '../lib/store.mts'

export default async (req: Request, context: Context) => {
  if (req.method !== 'GET') return fail(405, 'method')
  const store = openStore()
  const day = String(context.params?.day ?? '')

  if (!day) {
    const days = (await readDays(store)).slice().reverse()
    return json({ days })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return fail(400, 'bad-day')
  const snap = await store.get(KEY.snapshot(day), { type: 'json', ...STRONG })
  if (!snap) return fail(404, 'not-found')
  return json(snap)
}

export const config: Config = { path: ['/api/snapshots', '/api/snapshots/:day'], region: 'fra' }
