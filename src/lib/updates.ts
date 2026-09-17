/**
 * Keeping the app on the current build.
 *
 * The registration script vite-plugin-pwa generates does exactly one thing -
 * `navigator.serviceWorker.register('/sw.js')` - and nothing else. Its
 * `autoUpdate` mode names what the WORKER does (skip waiting, claim clients),
 * not what the PAGE does, and the page keeps running the bundle it already
 * loaded. A device can therefore sit on a build from days ago while every fix
 * ships past it, which is exactly what happened here: two releases of
 * diagnostics never reached the coach, and the exported file still had the
 * old shape.
 *
 * So the app checks for itself: on start, whenever it comes back to the
 * foreground, and every few minutes. When a new worker takes over, the page
 * reloads once - and only if there was an older worker to replace, because
 * the very first install also fires that event and must not bounce a fresh
 * visitor.
 */

const CHECK_EVERY_MS = 5 * 60_000

export function keepAppFresh(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  const hadController = Boolean(navigator.serviceWorker.controller)
  let reloading = false

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // first ever install: there is nothing stale on screen to replace
    if (!hadController || reloading) return
    reloading = true
    window.location.reload()
  })

  void navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((reg) => {
      const check = () => void reg.update().catch(() => {})
      check()
      setInterval(check, CHECK_EVERY_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
    })
    .catch(() => {
      // no worker means no offline shell; the app still runs from the network
    })
}
