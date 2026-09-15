/**
 * Inspection hook.
 *
 * With it the browser test suite can read the real scene instead of guessing at
 * pixels, and anyone can pull a scene out of the devtools console. It is off in
 * a production build unless the url asks for it, so the shipped page stays
 * clean: `https://.../?debug=1`.
 */

let cached: boolean | null = null

export function debugEnabled(): boolean {
  if (cached !== null) return cached
  let on = import.meta.env.DEV
  try {
    on = on || new URLSearchParams(window.location.search).has('debug')
  } catch {
    // no window (SSR, a worker): stay off
  }
  cached = on
  return on
}

export function publishDebug(key: string, value: unknown): void {
  if (!debugEnabled()) return
  ;(window as unknown as Record<string, unknown>)[key] = value
}
