/**
 * The one and only place where millimetres become pixels.
 *
 * The scene is drawn into a Konva Layer whose transform is computed here, so
 * every shape in the tree can be written in plain table millimetres. Changing
 * the screen size or flipping the table upright only changes this transform -
 * no scene data is ever touched.
 */

import type { Orientation, Vec } from '../model/types'
import type { TableGeometry } from '../model/table'

/** breathing room around the table, in mm, so the drop shadow is not clipped */
export const PAD_MM = 56

export type StageLayout = {
  /** css pixel size of the Konva stage - it hugs the table exactly */
  stageW: number
  stageH: number
  /** transform for the scene layer */
  scale: number
  x: number
  y: number
  rotation: number
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
 */
export function computeLayout(
  g: TableGeometry,
  orientation: Orientation,
  availW: number,
  availH: number,
): StageLayout {
  const box = contentBox(g)
  const upright = orientation === 'vertical'
  const boxW = upright ? box.height : box.width
  const boxH = upright ? box.width : box.height

  const scale = Math.max(Math.min(availW / boxW, availH / boxH), 0.0001)

  if (!upright) {
    return {
      stageW: boxW * scale,
      stageH: boxH * scale,
      scale,
      x: -box.left * scale,
      y: -box.top * scale,
      rotation: 0,
    }
  }

  const bottom = box.top + box.height
  return {
    stageW: boxW * scale,
    stageH: boxH * scale,
    scale,
    x: bottom * scale,
    y: -box.left * scale,
    rotation: 90,
  }
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
