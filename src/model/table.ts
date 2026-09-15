/**
 * Table geometry. Everything here is pure maths in table millimetres; nothing
 * in this file knows about pixels, Konva or React.
 *
 * Origin (0,0) is the top-left corner of the play field. +x runs along the long
 * rail, +y across the short rail. The rail band (cushion + wood) lives at
 * negative coordinates and beyond lengthMm / widthMm.
 */

import type { TableConfig, Vec } from './types'

export const DEFAULT_TABLE: TableConfig = {
  lengthMm: 3550,
  widthMm: 1775,
  ballMm: 67,
  markings: true,
  cloth: 'blue',
}

/** ball diameters offered in the settings, spec section 4 */
export const BALL_SIZES = [60, 64, 67, 68] as const

/**
 * Rail band. The spec quotes rubber ~125 mm and a wooden frame ~55 mm over it,
 * i.e. a 180 mm band between the play field and the outer edge of the table.
 * On the reference screenshot the cloth-covered cushion is the narrow strip and
 * the wood is the wide one, so the 180 mm splits 55 / 125 that way round.
 */
export const CUSHION_MM = 55
export const RAIL_MM = 125
export const RAIL_BAND_MM = CUSHION_MM + RAIL_MM
/** lighter wooden lip drawn along the outer edge of the rail */
export const FRAME_LIP_MM = 28

/** pocket mouths, measured between the two cushion noses, spec section 4 */
export const CORNER_MOUTH_MM = 72
export const MIDDLE_MOUTH_MM = 82

/**
 * How the back of a cushion sits relative to its nose at a pocket. Negative:
 * the rubber overhangs TOWARDS the hole, so its rounded end lies over the rim
 * ring the way it does on a broadcast table, instead of flaring away and
 * leaving a wedge of cloth beside the pocket.
 */
export const CORNER_JAW_MM = -14
/** the middle ring lies over the rubber ends, so they can simply be square */
export const MIDDLE_JAW_MM = 0

/**
 * The pocket is a round hole with a light rim, as on TV. The radius is chosen
 * so the chord through the two cushion noses is exactly the mouth - 72 or 82 mm
 * - and the black stays inside the rubber band on the corner diagonal.
 */
export const CORNER_HOLE_R_MM = 52
export const MIDDLE_HOLE_R_MM = 50
export const RIM_MM = 14

/** rounding of the outer wooden frame */
export const TABLE_CORNER_RADIUS_MM = 120

export type PocketKind = 'corner' | 'middle'

export type Pocket = {
  id: string
  kind: PocketKind
  /** nominal drop point, on the play-field boundary */
  at: Vec
  /** unit vector pointing out of the play field, into the rail */
  out: Vec
  mouthMm: number
  /** the two cushion noses bounding the mouth */
  jaws: [Vec, Vec]
  /**
   * Where each jaw face ends, at the back of the cushion. Nose -> back is the
   * cut face of the jaw, and it is what a pocket opening is actually shaped by:
   * the throat widens with depth instead of being a circle stuck on the rail.
   */
  jawBacks: [Vec, Vec]
  /** unit direction of each jaw face, nose -> back */
  jawDirs: [Vec, Vec]
  /** the round hole: centre and radius; its chord through `jaws` is the mouth */
  hole: { c: Vec; r: number }
}

/** flat [x0,y0,x1,y1,...] polygon in mm */
export type Polygon = number[]

export type TableGeometry = {
  cfg: TableConfig
  /** play field size */
  lengthMm: number
  widthMm: number
  /** full outer size of the table including the rail band */
  outerWidthMm: number
  outerHeightMm: number
  /** top-left of the outer table in play-field coordinates (negative) */
  outerX: number
  outerY: number
  pockets: Pocket[]
  cushions: Polygon[]
  /** diamond sights on the wooden rail */
  sights: Vec[]
  /** transverse markings at 1/4, 1/2, 3/4 of the length */
  crossLines: { from: Vec; to: Vec }[]
  /** single longitudinal centre line */
  longLine: { from: Vec; to: Vec }
  /** front centre, table centre, back centre */
  spots: Vec[]
  /** x of the house line (1/4 of the length) */
  houseLineX: number
}

const v = (x: number, y: number): Vec => ({ x, y })

/**
 * Builds every derived measurement for a table config. Cheap and pure, so the
 * renderer can memoise it on `cfg` alone.
 */
export function buildGeometry(cfg: TableConfig): TableGeometry {
  const L = cfg.lengthMm
  const W = cfg.widthMm
  const B = RAIL_BAND_MM

  // half the mouth projected onto the rail it sits on
  const cornerNose = CORNER_MOUTH_MM / Math.SQRT2 // 50.9 mm from the corner
  const middleHalf = MIDDLE_MOUTH_MM / 2

  /**
   * A jaw: the cushion nose, plus where that cushion's cut face ends at the
   * back of the rubber. `railOut` is the normal of the rail the nose sits on and
   * `away` the along-rail direction pointing away from this pocket, so the face
   * always leans outwards and the throat opens up with depth.
   */
  const jaw = (nose: Vec, railOut: Vec, away: Vec, jawMm: number) => {
    const back = v(
      nose.x + railOut.x * CUSHION_MM + away.x * jawMm,
      nose.y + railOut.y * CUSHION_MM + away.y * jawMm,
    )
    const len = Math.hypot(back.x - nose.x, back.y - nose.y)
    return { nose, back, dir: v((back.x - nose.x) / len, (back.y - nose.y) / len) }
  }

  const UP = v(0, -1)
  const DOWN = v(0, 1)
  const LEFT = v(-1, 0)
  const RIGHT = v(1, 0)
  const CJ = CORNER_JAW_MM
  const MJ = MIDDLE_JAW_MM

  const pocket = (
    id: string,
    kind: PocketKind,
    at: Vec,
    out: Vec,
    mouthMm: number,
    a: ReturnType<typeof jaw>,
    b: ReturnType<typeof jaw>,
  ): Pocket => {
    // a circle of radius r through both noses: its centre is on the pocket's
    // out-axis, sqrt(r^2 - (mouth/2)^2) behind the midpoint of the mouth chord
    const r = kind === 'corner' ? CORNER_HOLE_R_MM : MIDDLE_HOLE_R_MM
    const mx = (a.nose.x + b.nose.x) / 2
    const my = (a.nose.y + b.nose.y) / 2
    const back = Math.sqrt(Math.max(0, r * r - (mouthMm / 2) * (mouthMm / 2)))
    return {
      id,
      kind,
      at,
      out,
      mouthMm,
      jaws: [a.nose, b.nose],
      jawBacks: [a.back, b.back],
      jawDirs: [a.dir, b.dir],
      hole: { c: v(mx + out.x * back, my + out.y * back), r },
    }
  }

  const pockets: Pocket[] = [
    pocket(
      'p-tl',
      'corner',
      v(0, 0),
      v(-Math.SQRT1_2, -Math.SQRT1_2),
      CORNER_MOUTH_MM,
      jaw(v(cornerNose, 0), UP, RIGHT, CJ),
      jaw(v(0, cornerNose), LEFT, DOWN, CJ),
    ),
    pocket(
      'p-tm',
      'middle',
      v(L / 2, 0),
      UP,
      MIDDLE_MOUTH_MM,
      jaw(v(L / 2 - middleHalf, 0), UP, LEFT, MJ),
      jaw(v(L / 2 + middleHalf, 0), UP, RIGHT, MJ),
    ),
    pocket(
      'p-tr',
      'corner',
      v(L, 0),
      v(Math.SQRT1_2, -Math.SQRT1_2),
      CORNER_MOUTH_MM,
      jaw(v(L - cornerNose, 0), UP, LEFT, CJ),
      jaw(v(L, cornerNose), RIGHT, DOWN, CJ),
    ),
    pocket(
      'p-bl',
      'corner',
      v(0, W),
      v(-Math.SQRT1_2, Math.SQRT1_2),
      CORNER_MOUTH_MM,
      jaw(v(cornerNose, W), DOWN, RIGHT, CJ),
      jaw(v(0, W - cornerNose), LEFT, UP, CJ),
    ),
    pocket(
      'p-bm',
      'middle',
      v(L / 2, W),
      DOWN,
      MIDDLE_MOUTH_MM,
      jaw(v(L / 2 - middleHalf, W), DOWN, LEFT, MJ),
      jaw(v(L / 2 + middleHalf, W), DOWN, RIGHT, MJ),
    ),
    pocket(
      'p-br',
      'corner',
      v(L, W),
      v(Math.SQRT1_2, Math.SQRT1_2),
      CORNER_MOUTH_MM,
      jaw(v(L - cornerNose, W), DOWN, LEFT, CJ),
      jaw(v(L, W - cornerNose), RIGHT, UP, CJ),
    ),
  ]

  /**
   * One cushion segment. `a`..`b` is the nose line on the play-field boundary,
   * `n` the inward-facing normal. Each end tapers back towards its own pocket so
   * the throat gets wider with depth, which is what a real jaw looks like.
   */
  const cushion = (a: Vec, b: Vec, jawA: number, jawB: number): Polygon => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    const ux = dx / len
    const uy = dy / len
    // outward normal: rotate the direction so it points away from the field
    const ox = uy
    const oy = -ux
    return [
      a.x,
      a.y,
      b.x,
      b.y,
      b.x - ux * jawB + ox * CUSHION_MM,
      b.y - uy * jawB + oy * CUSHION_MM,
      a.x + ux * jawA + ox * CUSHION_MM,
      a.y + uy * jawA + oy * CUSHION_MM,
    ]
  }

  const cushions: Polygon[] = [
    // top rail, left half then right half (split by the middle pocket)
    cushion(v(cornerNose, 0), v(L / 2 - middleHalf, 0), CORNER_JAW_MM, MIDDLE_JAW_MM),
    cushion(v(L / 2 + middleHalf, 0), v(L - cornerNose, 0), MIDDLE_JAW_MM, CORNER_JAW_MM),
    // bottom rail, right half then left half (kept clockwise)
    cushion(v(L - cornerNose, W), v(L / 2 + middleHalf, W), CORNER_JAW_MM, MIDDLE_JAW_MM),
    cushion(v(L / 2 - middleHalf, W), v(cornerNose, W), MIDDLE_JAW_MM, CORNER_JAW_MM),
    // short rails (kept clockwise too, so the outward normal comes out right)
    cushion(v(L, cornerNose), v(L, W - cornerNose), CORNER_JAW_MM, CORNER_JAW_MM),
    cushion(v(0, W - cornerNose), v(0, cornerNose), CORNER_JAW_MM, CORNER_JAW_MM),
  ]

  // Diamond sights, standard system: long rails at k/8 of the length with the
  // 4th one dropped (that is where the middle pocket is), short rails at k/4.
  const sightOut = CUSHION_MM + RAIL_MM / 2
  const sights: Vec[] = []
  for (let k = 1; k <= 7; k++) {
    if (k === 4) continue
    const x = (L * k) / 8
    sights.push(v(x, -sightOut), v(x, W + sightOut))
  }
  for (let k = 1; k <= 3; k++) {
    const y = (W * k) / 4
    sights.push(v(-sightOut, y), v(L + sightOut, y))
  }

  const crossLines = [0.25, 0.5, 0.75].map((f) => ({
    from: v(L * f, 0),
    to: v(L * f, W),
  }))

  return {
    cfg,
    lengthMm: L,
    widthMm: W,
    outerWidthMm: L + 2 * B,
    outerHeightMm: W + 2 * B,
    outerX: -B,
    outerY: -B,
    pockets,
    cushions,
    sights,
    crossLines,
    longLine: { from: v(0, W / 2), to: v(L, W / 2) },
    // front centre (house line x centre line), table centre, back centre
    spots: [v(L * 0.25, W / 2), v(L * 0.5, W / 2), v(L * 0.75, W / 2)],
    houseLineX: L * 0.25,
  }
}

/** The house: the quarter of the table behind the house line. */
export function houseRect(g: TableGeometry) {
  return { x: 0, y: 0, w: g.houseLineX, h: g.widthMm }
}

/**
 * Clamp a ball centre so the ball stays on the play field - with one exception.
 *
 * Over a pocket mouth the ball is allowed off the bed: "шар в лузе" is a normal
 * element of an exercise, and a coach has to be able to draw it. So the legal
 * region is the field inset by one radius, UNION a disc of one radius around
 * each pocket's drop point. Everywhere else the limit is hard, which is what
 * stops a ball being buried in the rubber.
 */
export function clampToField(g: TableGeometry, p: Vec, ballMm: number): Vec {
  const r = ballMm / 2
  const hard = {
    x: Math.min(Math.max(p.x, r), g.lengthMm - r),
    y: Math.min(Math.max(p.y, r), g.widthMm - r),
  }
  if (hard.x === p.x && hard.y === p.y) return p

  // outside the bed: fall back to whichever is nearer, the bed or a pocket
  let best = hard
  let bestD = Math.hypot(p.x - hard.x, p.y - hard.y)
  for (const pocket of g.pockets) {
    const dx = p.x - pocket.at.x
    const dy = p.y - pocket.at.y
    const d = Math.hypot(dx, dy)
    if (d <= r) return p
    const q = { x: pocket.at.x + (dx / d) * r, y: pocket.at.y + (dy / d) * r }
    const dq = Math.hypot(p.x - q.x, p.y - q.y)
    if (dq < bestD) {
      best = q
      bestD = dq
    }
  }
  return best
}

/** True when a ball centre sits in a pocket rather than on the bed. */
export function inPocket(g: TableGeometry, p: Vec, ballMm: number): boolean {
  const r = ballMm / 2
  return g.pockets.some((pk) => Math.hypot(p.x - pk.at.x, p.y - pk.at.y) <= r + 0.01)
}
