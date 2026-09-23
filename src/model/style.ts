/**
 * The fixed choices a coach picks from. Deliberately small sets, no colour
 * picker: a schema is read in two seconds on a phone, and that only works if
 * every diagram uses the same handful of strongly separated colours.
 */

import type { ArrowHead, StrokeStyle } from './types'
import { scaledPreset } from './game'

/** six colours that all stay legible on both blue and green cloth */
export const INK = [
  { id: 'white', value: '#FFFFFF', label: 'Белый' },
  { id: 'amber', value: '#F5A623', label: 'Оранжевый' },
  { id: 'red', value: '#FF5A4E', label: 'Красный' },
  { id: 'lime', value: '#7BE04F', label: 'Зелёный' },
  { id: 'sky', value: '#4FC3F7', label: 'Голубой' },
  { id: 'ink', value: '#1B2430', label: 'Чёрный' },
] as const

export const DEFAULT_INK = INK[0].value

/**
 * Stroke widths in table millimetres, per the stage 2 spec - on the pyramid
 * table. These are REFERENCE values: the coach's choice is remembered as one
 * of them, and what lands on a given table is `scaledPreset(w, table)`, so
 * the thin/medium/thick choice looks the same on a pool table as it does on
 * the pyramid it was tuned on. On the pyramid the two are identical.
 */
export const STROKE_WIDTHS = [8, 14, 22] as const
export const DEFAULT_STROKE_WIDTH = 14

/** cap height in table millimetres; reference values, like the widths */
export const TEXT_SIZES = [60, 90, 130] as const
export const DEFAULT_TEXT_SIZE = 90

/** the stroke width a reference width comes to on this table */
export const strokeOn = (referenceMm: number, table: { game?: unknown }): number => scaledPreset(referenceMm, table)
/** the cap height a reference size comes to on this table */
export const textOn = (referenceMm: number, table: { game?: unknown }): number => scaledPreset(referenceMm, table)

/**
 * The reference value an item's actual size came from, or null if it matches
 * none - the Properties panel lights the button that produced what is drawn.
 */
export function referenceOf(actualMm: number, refs: readonly number[], table: { game?: unknown }): number | null {
  return refs.find((r) => scaledPreset(r, table) === actualMm) ?? null
}

export const DEFAULT_STYLE: StrokeStyle = 'solid'
export const DEFAULT_HEAD: ArrowHead = 'end'

export const ZONE_OPACITY = 0.25
export const DEFAULT_ZONE_COLOR = '#F5A623'

/** ghost trails: count follows the length until the coach overrides it */
export const GHOST_MIN = 3
export const GHOST_MAX = 8

export function ghostCount(lengthMm: number, ballMm: number): number {
  const n = Math.round(lengthMm / (1.6 * ballMm))
  return Math.min(GHOST_MAX, Math.max(GHOST_MIN, n))
}

/**
 * Control point of the quadratic that passes THROUGH `p` at t = 0.5.
 * B(0.5) = (a + 2c + b) / 4, so c = 2p - (a + b) / 2.
 */
export function quadControl(a: { x: number; y: number }, p: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: 2 * p.x - (a.x + b.x) / 2, y: 2 * p.y - (a.y + b.y) / 2 }
}
