/**
 * SVG source -> a decoded <img> the canvas can draw.
 *
 * Everything the brand package gives us is a whole SVG document, which cannot
 * go into a single `Konva.Path`, so it is drawn as an image. The URI is a
 * `data:` one: a same-origin file would work too, but a `data:` URI cannot
 * 404 halfway through an export and cannot taint the canvas, and this app has
 * exactly one job that a tainted canvas would kill.
 *
 * Images start decoding on import, and `brandImagesReady()` is awaited before
 * an export, the same way the font is.
 */

import { useEffect, useState } from 'react'

const cache = new Map<string, HTMLImageElement>()
const loading = new Set<Promise<unknown>>()
const listeners = new Set<() => void>()

/** percent-encoded, not base64: a third smaller and still a valid URI */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/**
 * The element for this SVG, decoding if it is new. Returns it straight away;
 * until `complete` is true Konva simply draws nothing, and the hook below
 * re-renders when it becomes ready.
 */
export function svgImage(svg: string): HTMLImageElement | null {
  if (typeof window === 'undefined') return null
  const hit = cache.get(svg)
  if (hit) return hit
  const img = new Image()
  cache.set(svg, img)
  const done = new Promise<void>((resolve) => {
    img.onload = () => {
      listeners.forEach((f) => f())
      resolve()
    }
    // a broken asset must not hang the export: resolve and draw nothing
    img.onerror = () => resolve()
  })
  loading.add(done)
  void done.then(() => loading.delete(done))
  img.src = svgDataUri(svg)
  return img
}

/** Kick off decoding without drawing anything yet. */
export function preloadSvgImages(svgs: readonly string[]): void {
  svgs.forEach((s) => svgImage(s))
}

/** Resolves when every image asked for so far has decoded (or failed). */
export async function brandImagesReady(): Promise<void> {
  // a late image can start while we wait, so drain until the set is empty
  while (loading.size) await Promise.all([...loading])
}

/**
 * Re-renders the caller each time an image finishes decoding. Konva draws
 * from the element, so the component itself needs no image state.
 */
export function useSvgImages(): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick((t) => t + 1)
    listeners.add(bump)
    return () => {
      listeners.delete(bump)
    }
  }, [])
  return tick
}
