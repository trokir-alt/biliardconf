/**
 * GET /api/health - what the server itself can and cannot do.
 *
 * It exists because the failure it diagnoses is invisible from the outside: a
 * library that looks saved on every device while every listing says the server
 * holds nothing. The interesting part is not whether the function runs - if you
 * are reading this answer, it ran - but which store it opened, whether a write
 * to that store lands, whether a conditional write is honoured, and whether the
 * store's own listing agrees with the catalogue.
 *
 * That last comparison is the point. `catalog` and `list_changed` are two
 * independent records of the same writes, kept by two different calls. When
 * they disagree, the number that is wrong is the listing - and now that nothing
 * depends on the listing, the disagreement is a curiosity rather than an
 * outage.
 *
 * It writes two keys, reads them back, and deletes them. Nothing here is
 * secret: the deploy context, the store scope and the region are all visible in
 * the site's own settings.
 */

import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { catalogItems } from '../lib/catalog.mts'
import { STORE_NAME, STRONG, json, now, openStore, storeScope } from '../lib/store.mts'

const say = (e: unknown) => String(e instanceof Error ? e.message : e)

export default async (_req: Request, _context: Context) => {
  const scope = storeScope()
  const probe = `health/probe-${now()}`
  const out: Record<string, unknown> = { now: now(), ...scope }

  let store: ReturnType<typeof openStore>
  try {
    store = openStore()
  } catch (e) {
    out.open = say(e)
    return json(out, 200)
  }
  out.open = 'ok'

  // the catalogue: what the app actually answers from
  try {
    const items = await catalogItems(store)
    out.catalog = items.length
    out.catalogAlive = items.filter((m) => m.deletedAt === null).length
    out.catalogNewest = items.reduce((max, m) => Math.max(max, m.updatedAt), 0)
  } catch (e) {
    out.catalog = say(e)
  }

  // the listing: kept only as a second opinion, and known to have been wrong
  for (const [label, prefix] of [
    ['changed', 'changed/'],
    ['exercises', 'exercises/'],
  ] as const) {
    try {
      const { blobs } = await store.list({ prefix })
      out[`list_${label}`] = blobs.length
    } catch (e) {
      out[`list_${label}`] = say(e)
    }
  }
  try {
    const { blobs } = await store.list()
    out.listEverything = blobs.length
  } catch (e) {
    out.listEverything = say(e)
  }

  try {
    await store.setJSON(probe, { at: now() })
    out.write = 'ok'
  } catch (e) {
    out.write = say(e)
  }

  try {
    const back = await store.get(probe, { type: 'json', ...STRONG })
    out.readBack = back ? 'ok' : 'missing'
  } catch (e) {
    out.readBack = say(e)
  }

  /**
   * Is a conditional write honoured?
   *
   * The catalogue is one blob two devices write, and it is safe only because a
   * write that does not match the ETag it was based on is refused. If the
   * platform ignored `if-match`, two writes landing together would silently
   * lose one - the failure this whole rework exists to end. So it is measured
   * rather than assumed: a write against a deliberately wrong tag must NOT be
   * applied, and one against the right tag must be.
   */
  try {
    const hit = await store.getWithMetadata(probe, { type: 'json', ...STRONG })
    const stale = await store.setJSON(probe, { at: 'stale' }, { onlyIfMatch: '"definitely-not-the-tag"' })
    const fresh = await store.setJSON(probe, { at: 'fresh' }, { onlyIfMatch: hit?.etag ?? '"none"' })
    const after = (await store.get(probe, { type: 'json', ...STRONG })) as { at?: unknown } | null
    out.cas =
      stale.modified === false && fresh.modified === true && after?.at === 'fresh'
        ? 'ok'
        : `stale=${stale.modified} fresh=${fresh.modified} value=${String(after?.at)}`
  } catch (e) {
    out.cas = say(e)
  }

  /**
   * Can a store find, by listing, a key it has just written itself?
   *
   * This is the experiment that settles what went wrong, and it is here
   * because it could not be run from the outside. The store this app opens is
   * pinned to a region. The site's own blobs region, which the deploy record
   * reports, is a DIFFERENT one - so every read and write has been going to
   * `/region:<ours>/...` while the site's store lives elsewhere. Reads and
   * writes by key are consistent with each other and work; a listing appears
   * to be answered per site rather than per that path, finds nothing, and the
   * client turns the 404 into an empty result with no error.
   *
   * So both are measured: the pinned store lists its own probe, and a store
   * opened with no region at all lists its own. If the pinned one finds
   * nothing and the plain one finds its key, the region is the answer, and it
   * is measured rather than argued about.
   *
   * Nothing depends on the outcome any more - the catalogue is read by key -
   * but the next person to wonder should not have to spend a day on it.
   */
  try {
    const { blobs } = await store.list({ prefix: 'health/' })
    out.listsOwnWrite = blobs.some((b) => b.key === probe) ? 'ok' : `no (${blobs.length} rows)`
  } catch (e) {
    out.listsOwnWrite = say(e)
  }

  try {
    const plain = getStore({ name: STORE_NAME })
    const key = `health/noregion-${now()}`
    await plain.setJSON(key, { at: now() })
    const { blobs } = await plain.list({ prefix: 'health/' })
    out.listsOwnWriteWithoutRegion = blobs.some((b) => b.key === key) ? 'ok' : `no (${blobs.length} rows)`
    await plain.delete(key)
  } catch (e) {
    out.listsOwnWriteWithoutRegion = say(e)
  }

  try {
    await store.delete(probe)
    out.cleanup = 'ok'
  } catch (e) {
    out.cleanup = say(e)
  }

  return json(out, 200)
}

export const config: Config = { path: '/api/health', region: 'fra' }
