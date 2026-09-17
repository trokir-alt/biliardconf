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
  /**
   * Where .stage-wrap itself is on the page.
   *
   * The panels that float over the canvas are `position: absolute` with no
   * positioned ancestor, so the browser measures them from the document.
   * Without this origin they were placed as if the canvas area started at the
   * left edge of the window - on a tablet that put the properties panel on
   * top of the toolbar, over buttons that then could not be pressed.
   */
  wrap: { left: number; top: number; width: number; height: number }
  /** the caption currently open in the text editor */
  editingId: string | null
  /** pinch zoom and pan, screen state only - never part of the scene */
  viewport: Viewport
  setView: (
    layout: StageLayout,
    stageLeft: number,
    stageTop: number,
    wrap: { left: number; top: number; width: number; height: number },
  ) => void
  setEditing: (id: string | null) => void
  setViewport: (v: Viewport) => void
  resetViewport: () => void
}

export const useView = create<ViewState>()((set) => ({
  layout: null,
  stageLeft: 0,
  stageTop: 0,
  wrap: { left: 0, top: 0, width: 0, height: 0 },
  editingId: null,
  viewport: VIEWPORT_HOME,
  setView: (layout, stageLeft, stageTop, wrap) => set({ layout, stageLeft, stageTop, wrap }),
  setEditing: (id) => set({ editingId: id }),
  setViewport: (viewport) => set({ viewport }),
  resetViewport: () => set({ viewport: VIEWPORT_HOME }),
}))

/** table mm -> css px on the PAGE, which is what the floating panels need */
export function mmToCss(v: ViewState, p: { x: number; y: number }): { x: number; y: number } {
  const l = v.layout
  if (!l) return { x: 0, y: 0 }
  const ox = v.wrap.left + v.stageLeft
  const oy = v.wrap.top + v.stageTop
  if (l.rotation === 90) {
    return { x: ox + (-p.y * l.scale + l.x), y: oy + (p.x * l.scale + l.y) }
  }
  return { x: ox + (p.x * l.scale + l.x), y: oy + (p.y * l.scale + l.y) }
}
