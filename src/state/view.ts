/**
 * Where the canvas is on screen. The properties panel needs it to float next to
 * the selected object, and the text editor needs it to sit over the caption
 * being edited. Nothing in here is scene data.
 */

import { create } from 'zustand'
import type { StageLayout, Viewport } from '../render/layout'
import { VIEWPORT_HOME } from '../render/layout'

export type ViewState = {
  layout: StageLayout | null
  /** css-pixel offset of the stage inside .stage-wrap */
  stageLeft: number
  stageTop: number
  /** the caption currently open in the text editor */
  editingId: string | null
  /** pinch zoom and pan, screen state only - never part of the scene */
  viewport: Viewport
  setView: (layout: StageLayout, stageLeft: number, stageTop: number) => void
  setEditing: (id: string | null) => void
  setViewport: (v: Viewport) => void
  resetViewport: () => void
}

export const useView = create<ViewState>()((set) => ({
  layout: null,
  stageLeft: 0,
  stageTop: 0,
  editingId: null,
  viewport: VIEWPORT_HOME,
  setView: (layout, stageLeft, stageTop) => set({ layout, stageLeft, stageTop }),
  setEditing: (id) => set({ editingId: id }),
  setViewport: (viewport) => set({ viewport }),
  resetViewport: () => set({ viewport: VIEWPORT_HOME }),
}))

/** table mm -> css px inside .stage-wrap */
export function mmToCss(v: ViewState, p: { x: number; y: number }): { x: number; y: number } {
  const l = v.layout
  if (!l) return { x: 0, y: 0 }
  if (l.rotation === 90) {
    return { x: v.stageLeft + (-p.y * l.scale + l.x), y: v.stageTop + (p.x * l.scale + l.y) }
  }
  return { x: v.stageLeft + (p.x * l.scale + l.x), y: v.stageTop + (p.y * l.scale + l.y) }
}
