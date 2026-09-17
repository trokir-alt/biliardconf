/**
 * The one place a blob store is opened.
 *
 * Three things here are deliberate and easy to get wrong elsewhere:
 *
 * - **Strong consistency.** Blobs are eventually consistent by default, with
 *   up to sixty seconds of propagation. A sync engine that writes and then
 *   lists would miss its own write for a minute, which is exactly the bug the
 *   coach would report as "it did not save".
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

export function openStore() {
  const options = { name: STORE_NAME, consistency: 'strong' as const, region: REGION }
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
