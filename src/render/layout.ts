/**
 * The one and only place where millimetres become pixels.
 *
 * The scene is drawn into Konva Layers whose transform is computed here, so
 * every shape in the tree can be written in plain table millimetres. Changing
 * the screen size, flipping the table upright or zooming in with two fingers
 * only changes this transform - no scene data is ever touched.
 */

import type { Orientation, Vec } from '../model/types'
import type { TableGeometry } from '../model/table'

/** breathing room around the table, in mm, so the drop shadow is not clipped */
export const PAD_MM = 56

/** pinch zoom range: 1 is "the whole table", 4 is enough to place a ball to a
    millimetre on a phone */
export const ZOOM_MIN = 1
export const ZOOM_MAX = 4

export type Viewport = {
  zoom: number
  /** css px, how far the zoomed picture has been dragged from centred */
  panX: number
  panY: number
}

export const VIEWPORT_HOME: Viewport = { zoom: 1, panX: 0, panY: 0 }

export type StageLayout = {
  /** css pixel size of the Konva stage - it hugs the table at zoom 1 */
  stageW: number
  stageH: number
  /** transform for the scene layers, zoom and pan already folded in */
  scale: number
  x: number
  y: number
  rotation: number
  zoom: number
}

/** Content box in table millimetres: the table plus padding on every side. */
export function contentBox(g: TableGeometry) {
  return {
    left: g.outerX - PAD_MM,
    top: g.outerY - PAD_MM,
    width: g.outerWidthMm + 2 * PAD_MM,
    height: g.outerHeightMm + 2 * PAD_MM,
  }
}

/**
 * Fits the table into `availW` x `availH` css pixels.
 *
 * Horizontal keeps the table as it is. Vertical rotates the layer a quarter
 * turn clockwise, which is what makes a phone useful: (mx, my) lands at
 * (-my, mx) before translation, so the long rail runs down the screen.
 *
 * Zoom scales the picture about the centre of the stage and pan slides it;
 * the stage itself keeps its zoom-1 size and clips what overflows.
 */
export function computeLayout(
  g: TableGeometry,
  orientation: Orientation,
  availW: number,
  availH: number,
  view: Viewport = VIEWPORT_HOME,
): StageLayout {
  const box = contentBox(g)
  const upright = orientation === 'vertical'
  const boxW = upright ? box.height : box.width
  const boxH = upright ? box.width : box.height

  const fit = Math.max(Math.min(availW / boxW, availH / boxH), 0.0001)
  const stageW = boxW * fit
  const stageH = boxH * fit

  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.zoom))
  const scale = fit * zoom
  // the unzoomed offset, then zoom about the stage centre, then pan
  const cx = stageW / 2
  const cy = stageH / 2
  const fold = (x0: number, y0: number) => ({
    x: cx + (x0 - cx) * zoom + view.panX,
    y: cy + (y0 - cy) * zoom + view.panY,
  })

  if (!upright) {
    const o = fold(-box.left * fit, -box.top * fit)
    return { stageW, stageH, scale, x: o.x, y: o.y, rotation: 0, zoom }
  }
  const bottom = box.top + box.height
  const o = fold(bottom * fit, -box.left * fit)
  return { stageW, stageH, scale, x: o.x, y: o.y, rotation: 90, zoom }
}

/** Inverse of the layer transform, for turning a pointer position into mm. */
export function pxToMm(layout: StageLayout, px: Vec): Vec {
  const { scale, x, y, rotation } = layout
  const dx = px.x - x
  const dy = px.y - y
  if (rotation === 90) {
    // forward was (mx, my) -> (-my * s + x, mx * s + y)
    return { x: dy / scale, y: -dx / scale }
  }
  return { x: dx / scale, y: dy / scale }
}

/** Forward transform, mm -> stage css px. */
export function mmToPx(layout: StageLayout, p: Vec): Vec {
  const { scale, x, y, rotation } = layout
  if (rotation === 90) return { x: -p.y * scale + x, y: p.x * scale + y }
  return { x: p.x * scale + x, y: p.y * scale + y }
}

/**
 * Keeps a pan inside sensible bounds: at zoom z the picture is z times the
 * stage, so it may slide by at most (z - 1)/2 of the stage each way.
 */
export function clampPan(view: Viewport, stageW: number, stageH: number): Viewport {
  const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.zoom))
  if (z <= 1.0001) return VIEWPORT_HOME
  const mx = ((z - 1) * stageW) / 2
  const my = ((z - 1) * stageH) / 2
  return {
    zoom: z,
    panX: Math.min(mx, Math.max(-mx, view.panX)),
    panY: Math.min(my, Math.max(-my, view.panY)),
  }
}
