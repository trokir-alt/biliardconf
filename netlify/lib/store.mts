/**
 * The one place a blob store is opened.
 *
 * Three things here are deliberate and easy to get wrong elsewhere:
 *
 * - **Strong consistency is per read, never on the store.** Blobs are
 *   eventually consistent by default, and a write followed by a read of the
 *   same key needs better than that. But setting it on the STORE poisons
 *   list(): a listing then goes to the uncached edge endpoint, which does not
 *   serve listings, answers 404 - and the client turns a 404 into an EMPTY
 *   RESULT with no error at all. Writes kept working, reads by key kept
 *   working, and every listing said the library was empty. Measured on the
 *   live site: PUT 200, readBack ok, list 0, with nine exercises in the store.
 *   So: eventual by default, and STRONG passed to the keyed reads that need it.
 * - **Region.** A site-wide store does NOT inherit the site's function region;
 *   omitting it lands the data wherever the API defaults to, and a store's
 *   data does not move if the value changes later. The app is Russian, so
 *   Frankfurt, chosen once.
 * - **Scope.** Production uses the site-wide store; anything else uses the
 *   deploy-scoped one, so a deploy preview or a test run can never write into
 *   the coach's library.
 */

import { getDeployStore, getStore } from '@netlify/blobs'

export const STORE_NAME = 'exercises'
const REGION = 'eu-central-1' as const

type NetlifyGlobal = {
  env?: { get?: (key: string) => string | undefined }
  context?: { deploy?: { context?: string } } | null
}

/**
 * Which deploy context this is, or '' when nothing says.
 *
 * Measured on the live site through /api/health: CONTEXT is NOT set in the
 * function runtime (it is a build variable), and the request context carries
 * it instead. A scheduled function has no request, so for the nightly job
 * BOTH are empty.
 */
function deployContext(): string {
  const g = (globalThis as { Netlify?: NetlifyGlobal }).Netlify
  return g?.env?.get?.('CONTEXT') ?? g?.context?.deploy?.context ?? ''
}

/** pass to a KEYED read that must not see a stale value */
export const STRONG = { consistency: 'strong' } as const

export function openStore() {
  const options = { name: STORE_NAME, region: REGION }
  const context = deployContext()
  /**
   * Unknown context means the SITE-WIDE store, not the deploy one.
   *
   * The deploy store is a fresh empty store per release, which is right for a
   * preview and catastrophic for the library. The one place the context is
   * unknowable is the scheduled job - it has no request - and that job runs
   * only on published production deploys. Guessing "per-deploy" there meant
   * the nightly snapshot photographed an empty store every night, and the
   * coach's real library was never in any snapshot.
   *
   * A preview or branch deploy still identifies itself through its request
   * context, so it keeps its own store as intended.
   */
  const isPreview = context !== '' && context !== 'production'
  return isPreview ? getDeployStore(options) : getStore(options)
}

/**
 * Which store this runtime would open, in plain words.
 *
 * The distinction matters more than it looks: a deploy-scoped store is a NEW
 * empty store for every deploy, so picking it in production would quietly
 * empty the library on every release. /api/health reports this so the answer
 * is a fact rather than a reading of the code.
 */
export function storeScope() {
  const g = (globalThis as { Netlify?: NetlifyGlobal }).Netlify
  const context = deployContext()
  return {
    context: context || '(none)',
    contextFromEnv: g?.env?.get?.('CONTEXT') ?? null,
    contextFromRequest: g?.context?.deploy?.context ?? null,
    scope: context !== '' && context !== 'production' ? 'per-deploy' : 'site-wide',
    region: REGION,
    store: STORE_NAME,
  }
}

/** JSON out, with the headers every answer here needs */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  })
}

export function fail(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return json({ error, ...extra }, status)
}

/** the server's clock, the only one two devices can compare against */
export function now(): number {
  return Date.now()
}
