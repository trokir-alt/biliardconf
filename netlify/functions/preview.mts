/**
 * The thumbnail for one exercise.
 *
 * The URL carries the stamp it was captured at, so a fetched thumbnail can be
 * cached for a year by the CDN and the browser: a library of a hundred rows
 * then costs a hundred function calls ONCE, and nothing on every repaint.
 */

import type { Config, Context } from '@netlify/functions'
import { ID_RE, KEY, MAX_BODY_BYTES } from '../../src/sync/wire.ts'
import { fail, json, openStore } from '../lib/store.mts'

export default async (req: Request, context: Context) => {
  const id = String(context.params?.id ?? '')
  if (!ID_RE.test(id)) return fail(400, 'bad-id')
  const store = openStore()
  const key = KEY.preview(id)

  if (req.method === 'GET') {
    const hit = await store.get(key, { type: 'arrayBuffer' })
    if (!hit) return fail(404, 'not-found')
    return new Response(hit, {
      headers: {
        'content-type': 'image/jpeg',
        // keyed by the stamp in the query, so a new capture is a new URL
        'cache-control': 'public, max-age=31536000, immutable',
      },
    })
  }

  if (req.method !== 'PUT') return fail(405, 'method')
  const body = await req.arrayBuffer()
  if (body.byteLength > MAX_BODY_BYTES) return fail(413, 'too-large', { limit: MAX_BODY_BYTES })
  await store.set(key, body)
  return json({ ok: true })
}

export const config: Config = { path: '/api/previews/:id', region: 'fra' }
