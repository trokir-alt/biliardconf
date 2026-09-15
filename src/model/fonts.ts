/**
 * The one font the canvas is allowed to use.
 *
 * It is served from our own origin (public/fonts), never from a CDN: a remote
 * font taints the canvas and `toDataURL` starts throwing, which would kill the
 * only thing this app produces. A system font stack would be safe too, but it
 * measures differently on iOS and on Windows, so the same scene would export
 * with different line widths on a coach's iPad and on their laptop.
 *
 * Liberation Sans, subset to Latin + Cyrillic. Licence in public/fonts.
 */
export const CANVAS_FONT = 'Exercise Sans'

/** what to fall back to while the woff2 is still in flight */
export const CANVAS_FONT_STACK =
  "'Exercise Sans', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"

/**
 * Konva measures text the moment it draws it, so an export that starts before
 * the font is ready bakes fallback metrics into the picture.
 */
export async function fontsReady(): Promise<void> {
  try {
    await document.fonts.ready
    // `ready` resolves for fonts already requested; make sure ours is one of them
    await Promise.all([
      document.fonts.load(`16px "${CANVAS_FONT}"`),
      document.fonts.load(`bold 16px "${CANVAS_FONT}"`),
    ])
  } catch {
    // no font API, or loading refused: fall through and draw with the fallback
  }
}
