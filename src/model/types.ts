/**
 * Scene model.
 *
 * Every coordinate in this file is in TABLE MILLIMETRES, origin at the top-left
 * corner of the play field (the area between the cushion noses). Pixels only
 * ever appear at render time, produced by a single scale factor.
 *
 * `Item` is an open union: stages 2-4 of the spec add new members here and a
 * matching branch in the renderer; nothing else has to change.
 */

export type Vec = { x: number; y: number }

export type ClothColor = 'blue' | 'green'

export type TableConfig = {
  lengthMm: number
  widthMm: number
  ballMm: number
  markings: boolean
  cloth: ClothColor
}

export type ItemBase = { id: string }

/* ---------------------------------------------------------------- stage 1 */

export type BallKind = 'white' | 'cue' | 'target'

export type BallItem = ItemBase & {
  type: 'ball'
  x: number
  y: number
  kind: BallKind
  /** optional digit or letter drawn on the ball */
  label?: string
}

/* ---------------------------------------------------------------- stage 2 */

export type StrokeStyle = 'solid' | 'dashed'
export type ArrowHead = 'end' | 'both' | 'none'

export type ArrowItem = ItemBase & {
  type: 'arrow'
  points: Vec[]
  style: StrokeStyle
  color: string
  /** stroke width in mm */
  width: number
  head: ArrowHead
  curved: boolean
}

export type GhostTrailItem = ItemBase & {
  type: 'ghostTrail'
  from: Vec
  to: Vec
  /** number of ghost balls, 3..8 */
  count: number
}

export type ZoneItem = ItemBase & {
  type: 'zone'
  x: number
  y: number
  w: number
  h: number
  shape: 'rect' | 'ellipse'
  color: string
  opacity: number
}

export type LineItem = ItemBase & {
  type: 'line'
  from: Vec
  to: Vec
  style: StrokeStyle
  color: string
  width: number
}

export type TextItem = ItemBase & {
  type: 'text'
  x: number
  y: number
  text: string
  /** cap height in mm */
  size: number
  color: string
  /** degrees */
  angle: number
}

/* ---------------------------------------------------------------- stage 3 */

export type StrikePower = 1 | 2 | 3 | 4 | 5

export type StrikeItem = ItemBase & {
  type: 'strike'
  x: number
  y: number
  /** contact point inside the unit circle, u right+, v down+ */
  spot: { u: number; v: number }
  power: StrikePower
}

/* ------------------------------------------------------------------ union */

export type Item =
  | BallItem
  | ArrowItem
  | GhostTrailItem
  | ZoneItem
  | LineItem
  | TextItem
  | StrikeItem

export type ItemType = Item['type']

export type Scene = {
  version: 1
  table: TableConfig
  /** exercise title, printed above the table on export */
  title?: string
  /** 1-3 lines printed under the table on export */
  note?: string
  /** draw order == z-order, last item is on top */
  items: Item[]
}

export type Orientation = 'horizontal' | 'vertical'
