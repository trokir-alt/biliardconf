/**
 * GET /api/health - what the server itself can and cannot do.
 *
 * It exists because the failure it diagnoses is invisible from the outside: a
 * library that looks saved on every device while the server holds nothing.
 * The interesting part is not whether the function runs - if you are reading
 * this answer, it ran - but WHICH store it opened and whether a write to that
 * store actually lands.
 *
 * It writes one key, reads it back, and deletes it. Nothing here is secret:
 * the deploy context, the store scope and the region are all visible in the
 * site's own settings.
 */

import type { Config, Context } from '@netlify/functions'
import { STRONG, json, now, openStore, storeScope } from '../lib/store.mts'

export default async (_req: Request, _context: Context) => {
  const scope = storeScope()
  const probe = `health/probe-${now()}`
  const out: Record<string, unknown> = { now: now(), ...scope }

  let store: ReturnType<typeof openStore>
  try {
    store = openStore()
  } catch (e) {
    out.open = String(e instanceof Error ? e.message : e)
    return json(out, 200)
  }
  out.open = 'ok'

  // the listing is the thing that was lying: it answered "empty" for a store
  // with nine exercises in it, because a store-level strong consistency sends
  // listings to an endpoint that does not serve them and returns 404, which
  // this client reports as an empty result. Both prefixes, so the answer is
  // not open to interpretation.
  for (const [label, prefix] of [
    ['changed', 'changed/'],
    ['exercises', 'exercises/'],
  ] as const) {
    try {
      const { blobs } = await store.list({ prefix })
      out[`list_${label}`] = blobs.length
    } catch (e) {
      out[`list_${label}`] = String(e instanceof Error ? e.message : e)
    }
  }

  try {
    const { blobs } = await store.list()
    out.listEverything = blobs.length
  } catch (e) {
    out.listEverything = String(e instanceof Error ? e.message : e)
  }

  try {
    await store.setJSON(probe, { at: now() })
    out.write = 'ok'
  } catch (e) {
    out.write = String(e instanceof Error ? e.message : e)
  }

  try {
    const back = await store.get(probe, { type: 'json', ...STRONG })
    out.readBack = back ? 'ok' : 'missing'
  } catch (e) {
    out.readBack = String(e instanceof Error ? e.message : e)
  }

  try {
    await store.delete(probe)
    out.cleanup = 'ok'
  } catch (e) {
    out.cleanup = String(e instanceof Error ? e.message : e)
  }

  return json(out, 200)
}

export const config: Config = { path: '/api/health', region: 'fra' }
