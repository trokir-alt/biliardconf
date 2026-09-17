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
 * Which deploy context this is.
 *
 * The CONTEXT environment variable first, and that order matters: the
 * request context is null in a scheduled function, so reading it alone would
 * send the nightly snapshot and sweep to a deploy-scoped store while the
 * library lives in the site-wide one - a job that quietly works on nothing.
 */
function deployContext(): string {
  const g = (globalThis as { Netlify?: NetlifyGlobal }).Netlify
  return g?.env?.get?.('CONTEXT') ?? g?.context?.deploy?.context ?? ''
}

export function openStore() {
  const options = { name: STORE_NAME, consistency: 'strong' as const, region: REGION }
  return deployContext() === 'production' ? getStore(options) : getDeployStore(options)
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
