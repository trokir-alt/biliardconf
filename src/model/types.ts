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

/**
 * `points` is [A, B] for a straight arrow and [A, P, B] for a curved one, where
 * P is a point the curve passes THROUGH - not a Bezier control point. Storing
 * the through-point is what lets the middle handle behave the way a hand
 * expects: the curve follows the finger instead of leading it. The control
 * point is derived at draw time, see `quadControl`.
 */
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
  /** recompute `count` from the length until the coach sets it by hand */
  autoCount: boolean
  /** the trail can run into an arrowhead, as it does on the reference */
  head: boolean
  color: string
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

/**
 * The cue ball seen from behind, with the contact point on it. `dot` is in the
 * unit circle, u right+, v down+, and never further out than 0.9 - a real cue
 * tip that far out miscues.
 */
export type StrikePointItem = ItemBase & {
  type: 'strikePoint'
  x: number
  y: number
  /** diameter in table mm, 200..500 */
  sizeMm: number
  dot: { u: number; v: number }
}

/** the nine values the strength scale can take; nothing in between */
export const POWER_VALUES = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5] as const
export type PowerValue = (typeof POWER_VALUES)[number]

export type PowerItem = ItemBase & {
  type: 'power'
  x: number
  y: number
  value: PowerValue
  /** plate width in table mm; the height follows from the artboard ratio */
  widthMm: number
}

/**
 * A wireframe ball, the table's own diameter: where a ball should BE at the
 * moment of contact. It deliberately takes no part in the push-apart, because
 * touching another ball is its whole purpose.
 */
export type GhostBallItem = ItemBase & {
  type: 'ghostBall'
  x: number
  y: number
}

/* ------------------------------------------------------------------ union */

export type Item =
  | BallItem
  | ArrowItem
  | GhostTrailItem
  | ZoneItem
  | LineItem
  | TextItem
  | StrikePointItem
  | PowerItem
  | GhostBallItem

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
