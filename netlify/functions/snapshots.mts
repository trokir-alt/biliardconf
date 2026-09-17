/**
 * The daily snapshots: what dates exist, and what is inside one of them.
 *
 * Restoring is done by the client, one exercise at a time through the normal
 * write path, so a restore is an ordinary revision with an ordinary rev bump
 * and cannot smuggle a body past the conflict rules.
 */

import type { Config, Context } from '@netlify/functions'
import { KEY } from '../../src/sync/wire.ts'
import { STRONG, fail, json, openStore } from '../lib/store.mts'

export default async (req: Request, context: Context) => {
  if (req.method !== 'GET') return fail(405, 'method')
  const store = openStore()
  const day = String(context.params?.day ?? '')

  if (!day) {
    const { blobs } = await store.list({ prefix: 'snapshots/' })
    const days = blobs.map((b) => b.key.slice('snapshots/'.length)).sort().reverse()
    return json({ days })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return fail(400, 'bad-day')
  const snap = await store.get(KEY.snapshot(day), { type: 'json', ...STRONG })
  if (!snap) return fail(404, 'not-found')
  return json(snap)
}

export const config: Config = { path: ['/api/snapshots', '/api/snapshots/:day'], region: 'fra' }
