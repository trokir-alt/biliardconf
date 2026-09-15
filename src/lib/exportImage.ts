/**
 * Export: the picture a coach sends to a student.
 *
 * The stage is composed onto a fresh canvas with the exercise title above and
 * the note below. JPEG at 0.92 is the default - a PNG of smooth gradients
 * carries tens of thousands of unique colours and compresses to 4 MB, while
 * the same picture as JPEG is a tenth of that and messengers recompress it
 * anyway. PNG stays as the option for anyone who needs transparency.
 *
 * Everything drawn here comes from our own origin (the font included), so the
 * canvas is never tainted and `toBlob` never throws a SecurityError.
 */

import type Konva from 'konva'
import { CANVAS_FONT } from '../model/fonts'
import { fontsReady } from '../model/fonts'

export type ExportFormat = 'png' | 'jpeg'

export type ExportOptions = {
  pixelRatio: number
  format: ExportFormat
  title?: string
  note?: string
}

/** Cyrillic -> latin, spec section 8 */
const TRANSLIT_MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
}

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

function truncateSlug(slug: string): string {
  if (slug.length <= MAX_SLUG) return slug
  const cut = slug.slice(0, MAX_SLUG)
  const lastDash = cut.lastIndexOf('-')
  return (lastDash > 0 ? cut.slice(0, lastDash) : cut).replace(/-+$/, '')
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** uprazhnenie-<translit title>-<YYYY-MM-DD>.<ext> */
export function exportFileName(title: string | undefined, date: Date, format: ExportFormat): string {
  const slug = truncateSlug(translit(title ?? ''))
  // local date parts on purpose: toISOString() shifts the day across midnight UTC
  const stamp = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  return `uprazhnenie${slug ? `-${slug}` : ''}-${stamp}.${format === 'jpeg' ? 'jpg' : 'png'}`
}

/** iOS Safari silently produces a blank canvas past these limits */
const MAX_PIXELS = 16_000_000
const MAX_SIDE = 8192

/**
 * Do NOT clamp this to the 1..3 of the UI labels: "1x" means a fixed reference
 * width (App.tsx), so on a phone the ratio asked for is legitimately 6 or 7.
 * Only the canvas limits may lower it.
 */
function safePixelRatio(stage: Konva.Stage, wanted: number): number {
  let ratio = Math.min(16, Math.max(0.25, Number.isFinite(wanted) && wanted > 0 ? wanted : 1))
  const w = stage.width()
  const h = stage.height()
  while (
    ratio > 0.25 &&
    (w * ratio * h * ratio > MAX_PIXELS || w * ratio > MAX_SIDE || h * ratio > MAX_SIDE)
  ) {
    ratio = Math.max(0.25, ratio - 0.25)
  }
  return ratio
}

/** background behind a JPEG, and behind the caption block of either format */
const PAPER = '#16191D'
const INK = '#E8ECF1'
const INK_DIM = '#B9C2CC'

/** greedy word wrap against a measuring context */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = []
  for (const para of text.split(/\r?\n/)) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const probe = line ? `${line} ${word}` : word
      if (ctx.measureText(probe).width <= maxWidth || !line) line = probe
      else {
        lines.push(line)
        line = word
      }
    }
    lines.push(line)
    if (lines.length >= maxLines) break
  }
  return lines.slice(0, maxLines)
}

/**
 * Renders the stage plus the title and note into one canvas.
 *
 * Waits for the font first: Konva measures text the moment it draws it, so an
 * export that starts before the woff2 is in bakes fallback metrics into the
 * picture and the caption lands a few pixels off from what the coach saw.
 */
export async function renderExport(stage: Konva.Stage, opts: ExportOptions): Promise<HTMLCanvasElement> {
  await fontsReady()
  // the caller has just dropped the selection and the pinch zoom; give React
  // two frames to push those into the Konva nodes, or the picture would carry
  // the selection ring or come out as a zoomed-in crop
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  // the name on the table is part of every picture: anything that hid it
  // from the devtools console is undone before the layers are read
  stage.find('.watermark, .watermark-rail, .watermarks').forEach((n) => n.show())
  stage.batchDraw()

  const pixelRatio = safePixelRatio(stage, opts.pixelRatio)
  const table = stage.toCanvas({ pixelRatio }) as HTMLCanvasElement
  const W = table.width
  const title = opts.title?.trim() ?? ''
  const note = opts.note?.trim() ?? ''

  // typography scales with the picture, not with the screen it was made on
  const margin = Math.round(W * 0.03)
  const titleSize = Math.round(W * 0.03)
  const noteSize = Math.round(W * 0.019)
  const lineGap = 1.3

  const measure = document.createElement('canvas').getContext('2d')
  if (!measure) return table
  measure.font = `400 ${noteSize}px "${CANVAS_FONT}"`
  const noteLines = note ? wrap(measure, note, W - 2 * margin, 3) : []

  const titleBlock = title ? Math.round(titleSize * lineGap) + margin * 0.5 : 0
  const noteBlock = noteLines.length ? Math.round(noteLines.length * noteSize * lineGap) + margin * 0.5 : 0
  const H = table.height + titleBlock + noteBlock

  const out = document.createElement('canvas')
  out.width = W
  out.height = H
  const ctx = out.getContext('2d')
  if (!ctx) return table

  if (opts.format === 'jpeg') {
    ctx.fillStyle = PAPER
    ctx.fillRect(0, 0, W, H)
  }

  ctx.drawImage(table, 0, titleBlock)

  // a halo under the captions, so a transparent PNG still reads on white
  ctx.shadowColor = 'rgba(0,0,0,0.85)'
  ctx.shadowBlur = Math.max(2, titleSize * 0.18)
  ctx.textBaseline = 'alphabetic'

  if (title) {
    ctx.font = `700 ${titleSize}px "${CANVAS_FONT}"`
    ctx.fillStyle = INK
    ctx.textAlign = 'left'
    ctx.fillText(title, margin, margin * 0.5 + titleSize, W - 2 * margin)
  }
  if (noteLines.length) {
    ctx.font = `400 ${noteSize}px "${CANVAS_FONT}"`
    ctx.fillStyle = INK_DIM
    ctx.textAlign = 'left'
    const top = titleBlock + table.height + margin * 0.35
    noteLines.forEach((line, i) => {
      ctx.fillText(line, margin, top + noteSize + i * noteSize * lineGap, W - 2 * margin)
    })
  }
  return out
}

function toBlob(canvas: HTMLCanvasElement, format: ExportFormat): Promise<Blob | null> {
  if (typeof canvas.toBlob !== 'function') return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      if (format === 'jpeg') canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92)
      else canvas.toBlob((b) => resolve(b), 'image/png')
    } catch {
      resolve(null)
    }
  })
}

/** click a temporary anchor; detached anchors do not fire in Firefox */
function clickDownload(url: string, fileName: string): void {
  const a = document.createElement('a')
  if (typeof a.download === 'undefined') {
    // old iOS: no download attribute, the best we can do is open the image
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

/** renders and downloads; resolves once the download is handed to the browser */
export async function downloadExport(
  stage: Konva.Stage,
  opts: ExportOptions & { fileName: string },
): Promise<{ bytes: number }> {
  try {
    const canvas = await renderExport(stage, opts)
    const blob = await toBlob(canvas, opts.format)
    if (blob) {
      const url = URL.createObjectURL(blob)
      clickDownload(url, opts.fileName)
      // Safari aborts a download whose object URL is revoked right away
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      return { bytes: blob.size }
    }
    const dataUrl = canvas.toDataURL(opts.format === 'jpeg' ? 'image/jpeg' : 'image/png', 0.92)
    clickDownload(dataUrl, opts.fileName)
    return { bytes: Math.round((dataUrl.length * 3) / 4) }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(`Не удалось сохранить картинку: ${reason}`)
  }
}

/**
 * Copies the picture to the clipboard, always as PNG - that is the only image
 * type the Clipboard API accepts everywhere.
 *
 * MUST be called synchronously from the click handler: Safari only honours
 * `clipboard.write` inside the user gesture. The rendering itself is async, so
 * the ClipboardItem is handed a Promise of the blob, which Safari and Chrome
 * both resolve after the gesture has already been accepted.
 */
export function copyExportToClipboard(stage: Konva.Stage, opts: Omit<ExportOptions, 'format'>): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    return Promise.reject(new Error('Буфер обмена недоступен в этом браузере'))
  }
  const blobPromise = renderExport(stage, { ...opts, format: 'png' }).then(async (canvas) => {
    const blob = await toBlob(canvas, 'png')
    if (!blob) throw new Error('Не удалось получить PNG')
    return blob
  })
  const item = new ClipboardItem({ 'image/png': blobPromise })
  return navigator.clipboard.write([item]).catch((err: unknown) => {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(`Не удалось скопировать: ${reason}`)
  })
}
