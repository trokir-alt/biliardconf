/**
 * Colours, all drawn by code. Nothing is loaded from a CDN or an image file:
 * a tainted canvas would break `stage.toDataURL`, which is the whole point of
 * the app.
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
    cushion: '#1B6398',
    cushionShade: '#14527F',
    vignette: '#0B3557',
  },
  green: {
    clothLight: '#2E8B57',
    clothDark: '#1F6B41',
    cushion: '#1C5F3A',
    cushionShade: '#154C2E',
    vignette: '#093021',
  },
}

export const WOOD = {
  dark: '#5A2E19',
  mid: '#6B3820',
  light: '#7A4326',
  /** lighter frame sitting on top of the rail */
  frame: '#8C5230',
  frameHighlight: '#A9683F',
  edgeShadow: '#3A1C0E',
}

export const METAL = {
  light: '#F0C972',
  mid: '#D9A443',
  dark: '#9C6F22',
}

export const MARKING = 'rgba(255,255,255,0.42)'
export const MARKING_SPOT = 'rgba(255,255,255,0.75)'
export const SIGHT = '#F2EDE4'
export const POCKET_THROAT = '#120C08'

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
