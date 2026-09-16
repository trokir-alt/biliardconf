/**
 * Colours, all drawn by code. Nothing is loaded from a CDN or an image file:
 * a tainted canvas would break `stage.toDataURL`, which is the whole point of
 * the app.
 *
 * The values are tuned for a photographic top-down look: a single soft light
 * from the upper left, matte varnished wood, napped cloth and cloth-covered
 * rubber cushions that sit a clear step below the wood and above the bed.
 */

import type { ClothColor } from './types'

export type ClothPalette = {
  /** felt gradient, light centre to darker edge */
  clothLight: string
  clothDark: string
  /** cushion top, a shade darker than the felt */
  cushion: string
  cushionShade: string
  /** vignette colour painted along the edges of the felt */
  vignette: string
}

export const CLOTH: Record<ClothColor, ClothPalette> = {
  blue: {
    clothLight: '#2A82C4',
    clothDark: '#1D6FA8',
    // the cushion band has to read as a clear step down from the felt
    cushion: '#104168',
    cushionShade: '#092C49',
    vignette: '#06263E',
  },
  green: {
    clothLight: '#2F8D59',
    clothDark: '#20713F',
    cushion: '#12452E',
    cushionShade: '#0A2D1E',
    vignette: '#052318',
  },
}

export const WOOD = {
  // spec section 5 names this range for the rail outright
  dark: '#5A2E19',
  mid: '#6B3820',
  light: '#7A4326',
  /** lighter frame sitting on top of the rail */
  frame: '#8A6040',
  frameHighlight: '#A0764F',
  edgeShadow: '#2A1810',
}

export const METAL = {
  light: '#F6DCA0',
  mid: '#D2A852',
  dark: '#8A6526',
}

export const MARKING = 'rgba(255,255,255,0.38)'
export const MARKING_SPOT = 'rgba(255,255,255,0.72)'
export const SIGHT = '#F4F0E7'
export const POCKET_THROAT = '#0A0705'

export const BALL = {
  white: { base: '#FFFFFF', shade: '#BFC3C7', rim: '#8E9498', text: '#22262A' },
  cue: { base: '#FFC65A', shade: '#E08A12', rim: '#A9630A', text: '#3A2400' },
  target: { base: '#FF6B5A', shade: '#C63A28', rim: '#8E2418', text: '#FFFFFF' },
} as const

export const SELECTION = '#FFD166'

/** app chrome, kept in sync with styles.css */
export const UI = {
  bg: '#16191D',
  panel: '#1F242A',
  panelEdge: '#2E353D',
  text: '#E8ECF1',
  textDim: '#9BA5B0',
  accent: '#F5A623',
}
