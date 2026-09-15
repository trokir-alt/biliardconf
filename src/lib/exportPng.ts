/**
 * PNG export.
 *
 * The Blob path (`toCanvas` + `canvas.toBlob`) is preferred over `toDataURL`
 * for two reasons. A data URL is a base64 string that must be held in memory in
 * full; on iOS Safari a big diagram easily exceeds the string/canvas limits and
 * the export silently yields an empty image. A Blob stays out of JS memory and
 * downloads as a file. `toDataURL` is kept only as a fallback for engines
 * without `toBlob`. Both paths only work because the scene is drawn entirely in
 * code - a single remote image or web font would taint the canvas and make both
 * of them throw a SecurityError.
 */

import type Konva from 'konva'

/** Cyrillic -> latin, spec section 8 */
const TRANSLIT_MAP: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'c',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
}

/** Cyrillic -> latin, spec section 8 */
export function translit(input: string): string {
  let out = ''
  for (const ch of input.toLowerCase()) {
    const mapped = TRANSLIT_MAP[ch]
    if (mapped !== undefined) out += mapped
    else if (/[a-z0-9]/.test(ch)) out += ch
    else out += '-'
  }
  return out.replace(/-+/g, '-').replace(/^-|-$/g, '')
}

const MAX_SLUG = 60

/** cut a slug to `MAX_SLUG` characters without leaving half a word behind */
function truncateSlug(slug: string): string {
  if (slug.length <= MAX_SLUG) return slug
  const cut = slug.slice(0, MAX_SLUG)
  const lastDash = cut.lastIndexOf('-')
  return (lastDash > 0 ? cut.slice(0, lastDash) : cut).replace(/-+$/, '')
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** uprazhnenie-<translit title>-<YYYY-MM-DD>.png */
export function exportFileName(title: string | undefined, date: Date): string {
  const slug = truncateSlug(translit(title ?? ''))
  // Local date parts on purpose: toISOString() would shift the day for anyone
  // whose offset crosses midnight UTC.
  const stamp = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  return `uprazhnenie${slug ? `-${slug}` : ''}-${stamp}.png`
}

/** iOS Safari silently produces a blank canvas past these limits */
const MAX_PIXELS = 16_000_000
const MAX_SIDE = 8192

/**
 * 1x..3x is the whole range the UI offers; anything outside it is a caller bug
 * or a NaN, so it is clamped rather than trusted. The canvas limits may lower
 * the ratio further, but never below 1 - a picture smaller than the stage is
 * worse than no export at all.
 */
function safePixelRatio(stage: Konva.Stage, wanted: number): number {
  let ratio = Math.min(3, Math.max(1, Number.isFinite(wanted) && wanted > 0 ? wanted : 1))
  const w = stage.width()
  const h = stage.height()
  while (
    ratio > 1 &&
    (w * ratio * h * ratio > MAX_PIXELS || w * ratio > MAX_SIDE || h * ratio > MAX_SIDE)
  ) {
    ratio = Math.max(1, ratio - 0.25)
  }
  return ratio
}

/** click a temporary anchor; detached anchors do not fire in Firefox */
function clickDownload(url: string, fileName: string): void {
  const a = document.createElement('a')
  if (!('download' in a)) {
    // Old iOS: no download attribute, the best we can do is open the image.
    window.open(url, '_blank')
    return
  }
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  if (typeof canvas.toBlob !== 'function') return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/png')
    } catch {
      resolve(null)
    }
  })
}

/** renders the stage and triggers a download; resolves when the download has been handed to the browser */
export async function downloadStagePng(
  stage: Konva.Stage,
  opts: { pixelRatio: number; fileName: string },
): Promise<void> {
  try {
    // inside the try: reading the stage size can itself throw on a disposed stage
    const pixelRatio = safePixelRatio(stage, opts.pixelRatio)
    const canvas = stage.toCanvas({ pixelRatio })
    const blob = await canvasToBlob(canvas)
    if (blob) {
      const url = URL.createObjectURL(blob)
      clickDownload(url, opts.fileName)
      // Safari aborts a download whose object URL is revoked right away.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      return
    }
    const dataUrl = stage.toDataURL({ pixelRatio, mimeType: 'image/png' })
    clickDownload(dataUrl, opts.fileName)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(`Не удалось сохранить PNG: ${reason}`)
  }
}
