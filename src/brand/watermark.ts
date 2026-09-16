/**
 * The distributed watermark: one signature repeated across the cloth.
 *
 * The single place where density is configured. The package ships two
 * densities; the third, `medium`, is the light grid at a lower opacity, for a
 * coach who wants the name present but nearly invisible under the diagram.
 *
 * Coordinates come from the package's own artboard (1200 x 660, cloth at
 * 40,40, 1120 x 560) and are converted to table millimetres by one scale
 * factor, exactly as its README specifies.
 */

import { WATERMARK_ARTBOARD as ART } from './assets'

export type Density = 'light' | 'medium' | 'dense'

export type DensityPreset = {
  /** row baselines on the designer's artboard */
  rows: readonly number[]
  opacity: number
  /** what the setting is called in the interface */
  label: string
}

/** four columns per row, so the count is columns x rows */
export const DENSITY: Record<Density, DensityPreset> = {
  light: { rows: [132, 298, 464], opacity: 0.18, label: 'Обычная' },
  medium: { rows: [132, 298, 464], opacity: 0.12, label: 'Тихая' },
  dense: { rows: [98, 228, 358, 488], opacity: 0.26, label: 'Плотная' },
}

export const DENSITY_ORDER: readonly Density[] = ['medium', 'light', 'dense']

export const DEFAULT_DENSITY: Density = 'light'

export function isDensity(v: unknown): v is Density {
  return v === 'light' || v === 'medium' || v === 'dense'
}

export function stampCount(d: Density): number {
  return DENSITY[d].rows.length * ART.columns
}

export type Stamp = { x: number; y: number; w: number; h: number }

/**
 * Where every signature goes, in table millimetres.
 *
 * `x = 64 + column * 272 + (row odd ? 24 : 0)` on the artboard; the odd-row
 * offset is what stops the columns reading as a rigid grid.
 */
export function stampLayout(d: Density, lengthMm: number): Stamp[] {
  const s = lengthMm / ART.cloth.w
  const mm = (v: number, axis: 'x' | 'y') => (v - (axis === 'x' ? ART.cloth.x : ART.cloth.y)) * s
  const out: Stamp[] = []
  DENSITY[d].rows.forEach((rowY, r) => {
    for (let c = 0; c < ART.columns; c++) {
      out.push({
        x: mm(64 + c * 272 + (r % 2 ? 24 : 0), 'x'),
        y: mm(rowY, 'y'),
        w: ART.stampW * s,
        h: ART.stampH * s,
      })
    }
  })
  return out
}
