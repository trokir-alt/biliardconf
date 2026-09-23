/**
 * Table geometry. Everything here is pure maths in table millimetres; nothing
 * in this file knows about pixels, Konva or React.
 *
 * Origin (0,0) is the top-left corner of the play field. +x runs along the long
 * rail, +y across the short rail. The rail band (cushion + wood) lives at
 * negative coordinates and beyond lengthMm / widthMm.
 */

import type { Game, TableConfig, Vec } from './types'
import { gameOf } from './game'

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

/**
 * Everything about a table that differs between the games. The constants
 * above are the pyramid's own and stay exported under their old names.
 */
export type TableSpec = {
  cushionMm: number
  railMm: number
  cornerMouthMm: number
  middleMouthMm: number
  /** see CORNER_JAW_MM: negative leans the jaw face towards the hole */
  cornerJawMm: number
  middleJawMm: number
  cornerHoleRMm: number
  middleHoleRMm: number
  /**
   * How far behind the mouth the drop begins. The pyramid's hole starts right
   * at the noses; a pool table has a shelf of slate, covered in cloth, between
   * the jaws before the hole - WPA: 1 to 2.25 in at a corner, up to 3/8 at a
   * side.
   */
  cornerShelfMm: number
  middleShelfMm: number
  /** the ring round a hole: the pyramid's cream cup, or pool's black leather */
  rimMm: number
  pocketLook: 'cup' | 'leather'
  /** round inlays, or the diamonds a pool table is named for */
  sights: 'dot' | 'diamond'
  /** where the middle pockets go in the draw order; see TableView */
  middleOverCushions: boolean
}

/**
 * Pool pockets, WPA. The mouth is measured between the cushion noses: 4.5 in
 * at a corner, 5 in at a side. The faces are cut at a fixed angle to the nose
 * line - 142 degrees at a corner, 104 at a side - so each face leans towards
 * the hole, and the opening narrows with depth: the funnel that makes a pool
 * pocket reject a ball hit at it too steeply. A face leaning (angle - 90)
 * degrees off square travels cushion * tan(angle - 90) along the rail on its
 * way to the back of the rubber.
 */
const POOL_CUSHION_MM = 50
const leanMm = (facingDeg: number) => -POOL_CUSHION_MM * Math.tan(((facingDeg - 90) * Math.PI) / 180)

export const TABLE_SPEC: Record<Game, TableSpec> = {
  pyramid: {
    cushionMm: CUSHION_MM,
    railMm: RAIL_MM,
    cornerMouthMm: CORNER_MOUTH_MM,
    middleMouthMm: MIDDLE_MOUTH_MM,
    cornerJawMm: CORNER_JAW_MM,
    middleJawMm: MIDDLE_JAW_MM,
    cornerHoleRMm: CORNER_HOLE_R_MM,
    middleHoleRMm: MIDDLE_HOLE_R_MM,
    cornerShelfMm: 0,
    middleShelfMm: 0,
    rimMm: RIM_MM,
    pocketLook: 'cup',
    sights: 'dot',
    middleOverCushions: true,
  },
  pool: {
    cushionMm: POOL_CUSHION_MM,
    railMm: 115,
    cornerMouthMm: 114,
    middleMouthMm: 127,
    cornerJawMm: leanMm(142),
    middleJawMm: leanMm(104),
    // unused: a pool hole is shaped by its jaws, see Pocket.drop
    cornerHoleRMm: 0,
    middleHoleRMm: 0,
    // the low end of the WPA range: at the scale of a whole-table diagram a
    // deeper shelf reads as a pocket that is closed, and the mouth is what
    // the coach needs to see
    cornerShelfMm: 14,
    middleShelfMm: 4,
    rimMm: 10,
    pocketLook: 'leather',
    sights: 'diamond',
    // the side faces lean in, and the hole under them is what shows it
    middleOverCushions: false,
  },
}

export function tableSpec(cfg: { game?: unknown }): TableSpec {
  return TABLE_SPEC[gameOf(cfg)]
}

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
  /**
   * The round hole: centre and radius. On the pyramid its chord through `jaws`
   * is the mouth; on pool it is the round back of `drop`.
   */
  hole: { c: Vec; r: number }
  /**
   * A pool pocket's opening, seen from above: the black begins on a line
   * `front` a shelf behind the mouth, runs back between the two jaw faces to
   * the backs of the cushions, and closes in a half circle behind them. The
   * faces lean in, so it is a funnel - which a circle stuck on the rail, the
   * pyramid's shape, cannot draw: it bulged onto the bed in front of the mouth.
   */
  drop?: { front: [Vec, Vec]; backs: [Vec, Vec] }
}

/** flat [x0,y0,x1,y1,...] polygon in mm */
export type Polygon = number[]

export type TableGeometry = {
  cfg: TableConfig
  game: Game
  spec: TableSpec
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
  /**
   * Transverse markings, drawn and snapped to: 1/4, 1/2 and 3/4 of the length
   * on a pyramid table, the head string alone on a pool one.
   */
  crossLines: { from: Vec; to: Vec }[]
  /** single longitudinal centre line; always a snap axis */
  longLine: { from: Vec; to: Vec }
  /** a pool table has no centre line on the cloth, only the spots on it */
  drawLongLine: boolean
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
  const game = gameOf(cfg)
  const spec = TABLE_SPEC[game]
  const L = cfg.lengthMm
  const W = cfg.widthMm
  const B = spec.cushionMm + spec.railMm
  const C = spec.cushionMm

  // half the mouth projected onto the rail it sits on
  const cornerNose = spec.cornerMouthMm / Math.SQRT2 // 50.9 mm from the corner on a pyramid
  const middleHalf = spec.middleMouthMm / 2

  /**
   * A jaw: the cushion nose, plus where that cushion's cut face ends at the
   * back of the rubber. `railOut` is the normal of the rail the nose sits on and
   * `away` the along-rail direction pointing away from this pocket, so the face
   * always leans outwards and the throat opens up with depth.
   */
  const jaw = (nose: Vec, railOut: Vec, away: Vec, jawMm: number) => {
    const back = v(
      nose.x + railOut.x * C + away.x * jawMm,
      nose.y + railOut.y * C + away.y * jawMm,
    )
    const len = Math.hypot(back.x - nose.x, back.y - nose.y)
    return { nose, back, dir: v((back.x - nose.x) / len, (back.y - nose.y) / len) }
  }

  const UP = v(0, -1)
  const DOWN = v(0, 1)
  const LEFT = v(-1, 0)
  const RIGHT = v(1, 0)
  const CJ = spec.cornerJawMm
  const MJ = spec.middleJawMm

  const pocket = (
    id: string,
    kind: PocketKind,
    at: Vec,
    out: Vec,
    mouthMm: number,
    a: ReturnType<typeof jaw>,
    b: ReturnType<typeof jaw>,
  ): Pocket => {
    const mx = (a.nose.x + b.nose.x) / 2
    const my = (a.nose.y + b.nose.y) / 2
    if (spec.pocketLook === 'leather') {
      // each face, followed back to the shelf depth: the depth of a point is
      // its distance behind the mouth along `out`, and a face gains
      // dot(dir, out) of depth per millimetre of its length
      const shelf = kind === 'corner' ? spec.cornerShelfMm : spec.middleShelfMm
      const onFace = (j: ReturnType<typeof jaw>) => {
        const t = shelf / (j.dir.x * out.x + j.dir.y * out.y)
        return v(j.nose.x + j.dir.x * t, j.nose.y + j.dir.y * t)
      }
      // the backs are level with each other, so the half circle through them
      // is centred between them
      const c = v((a.back.x + b.back.x) / 2, (a.back.y + b.back.y) / 2)
      return {
        id,
        kind,
        at,
        out,
        mouthMm,
        jaws: [a.nose, b.nose],
        jawBacks: [a.back, b.back],
        jawDirs: [a.dir, b.dir],
        hole: { c, r: Math.hypot(a.back.x - c.x, a.back.y - c.y) },
        drop: { front: [onFace(a), onFace(b)], backs: [a.back, b.back] },
      }
    }
    // a circle of radius r through both noses: its centre is on the pocket's
    // out-axis, sqrt(r^2 - (mouth/2)^2) behind the midpoint of the mouth chord
    const r = kind === 'corner' ? spec.cornerHoleRMm : spec.middleHoleRMm
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
      spec.cornerMouthMm,
      jaw(v(cornerNose, 0), UP, RIGHT, CJ),
      jaw(v(0, cornerNose), LEFT, DOWN, CJ),
    ),
    pocket(
      'p-tm',
      'middle',
      v(L / 2, 0),
      UP,
      spec.middleMouthMm,
      jaw(v(L / 2 - middleHalf, 0), UP, LEFT, MJ),
      jaw(v(L / 2 + middleHalf, 0), UP, RIGHT, MJ),
    ),
    pocket(
      'p-tr',
      'corner',
      v(L, 0),
      v(Math.SQRT1_2, -Math.SQRT1_2),
      spec.cornerMouthMm,
      jaw(v(L - cornerNose, 0), UP, LEFT, CJ),
      jaw(v(L, cornerNose), RIGHT, DOWN, CJ),
    ),
    pocket(
      'p-bl',
      'corner',
      v(0, W),
      v(-Math.SQRT1_2, Math.SQRT1_2),
      spec.cornerMouthMm,
      jaw(v(cornerNose, W), DOWN, RIGHT, CJ),
      jaw(v(0, W - cornerNose), LEFT, UP, CJ),
    ),
    pocket(
      'p-bm',
      'middle',
      v(L / 2, W),
      DOWN,
      spec.middleMouthMm,
      jaw(v(L / 2 - middleHalf, W), DOWN, LEFT, MJ),
      jaw(v(L / 2 + middleHalf, W), DOWN, RIGHT, MJ),
    ),
    pocket(
      'p-br',
      'corner',
      v(L, W),
      v(Math.SQRT1_2, Math.SQRT1_2),
      spec.cornerMouthMm,
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
      b.x - ux * jawB + ox * C,
      b.y - uy * jawB + oy * C,
      a.x + ux * jawA + ox * C,
      a.y + uy * jawA + oy * C,
    ]
  }

  const cushions: Polygon[] = [
    // top rail, left half then right half (split by the middle pocket)
    cushion(v(cornerNose, 0), v(L / 2 - middleHalf, 0), CJ, MJ),
    cushion(v(L / 2 + middleHalf, 0), v(L - cornerNose, 0), MJ, CJ),
    // bottom rail, right half then left half (kept clockwise)
    cushion(v(L - cornerNose, W), v(L / 2 + middleHalf, W), CJ, MJ),
    cushion(v(L / 2 - middleHalf, W), v(cornerNose, W), MJ, CJ),
    // short rails (kept clockwise too, so the outward normal comes out right)
    cushion(v(L, cornerNose), v(L, W - cornerNose), CJ, CJ),
    cushion(v(0, W - cornerNose), v(0, cornerNose), CJ, CJ),
  ]

  // Diamond sights, standard system - the same on both tables: long rails at
  // k/8 of the length with the 4th one dropped (that is where the middle
  // pocket is), short rails at k/4.
  const sightOut = spec.cushionMm + spec.railMm / 2
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

  // Pool marks the head string - the line the cue ball is broken from behind,
  // the same quarter the pyramid calls the house - and the three spots on the
  // long axis. The pyramid adds the half and three-quarter lines and draws the
  // centre line itself.
  const crossLines = (game === 'pool' ? [0.25] : [0.25, 0.5, 0.75]).map((f) => ({
    from: v(L * f, 0),
    to: v(L * f, W),
  }))

  return {
    cfg,
    game,
    spec,
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
    drawLongLine: game !== 'pool',
    // front centre (house line x centre line), table centre, back centre;
    // on pool the head spot, the centre spot and the foot spot the rack is
    // built on
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
