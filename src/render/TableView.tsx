/**
 * The table itself: wood, cloth, cushions, markings, pockets and brass.
 *
 * Pure function of `TableGeometry` - no store, no state, no effects - so the
 * export renderer can mount it on an offscreen stage and get a pixel-identical
 * result. Every number below is TABLE MILLIMETRES: the hosting Konva Layer
 * carries the single mm -> px scale, so radii, stroke widths, dashes, shadow
 * blurs and gradient stops are all in mm too.
 *
 * Nothing is loaded from outside the bundle; a remote image would taint the
 * canvas and kill `stage.toDataURL`.
 *
 * Lighting model: one soft source in the upper left. Every highlight and every
 * cast shadow in this file is derived from LIGHT, so the four rails are lit
 * differently and the table reads as a photograph rather than a diagram.
 */

import { Circle, Group, Line, Rect, Shape } from 'react-konva'
import type { Context } from 'konva/lib/Context'
import type { Shape as KonvaShape } from 'konva/lib/Shape'
import type { Pocket, TableGeometry } from '../model/table'
import {
  CUSHION_MM,
  FRAME_LIP_MM,
  RAIL_BAND_MM,
  TABLE_CORNER_RADIUS_MM,
} from '../model/table'
import type { Vec } from '../model/types'
import type { ClothPalette } from '../model/theme'
import { CLOTH, MARKING, MARKING_SPOT, METAL, POCKET_THROAT, SIGHT, WOOD } from '../model/theme'

/* ------------------------------------------------------------ mm constants */

/** the stage is padded by PAD_MM (see render/layout.ts), so the body shadow
    has to fade out well inside that or export clips it */
const BODY_SHADOW_BLUR_MM = 30
const BODY_SHADOW_OFFSET_MM = 11

/** mother-of-pearl sight dots on the wooden rail */
const SIGHT_R_MM = 11
const SIGHT_RIM_MM = 1.2

/** cloth is rounded just enough to kill the hard corner under the castings */
const CLOTH_CORNER_MM = 10

const MARKING_W_MM = 3.6
const SPOT_R_MM = 8

/** unit vector pointing at the light, i.e. towards the upper left */
const LIGHT: Vec = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 }

/** pocket walls slide sideways under each cushion so no hairline of felt shows */
const WALL_BIAS_MM = 2.5
/** extra depth past the jaw backs before the walls close over */
const SHELF_EXT_CORNER_MM = 6
const SHELF_EXT_MIDDLE_MM = 14
/** the hole itself only follows the first part of each cut face */
const HOLE_FRAC_CORNER = 0.52
const HOLE_FRAC_MIDDLE = 0.5
/** and starts just inside the mouth, so a rim of wall survives all round */
const HOLE_INSET_MM = 3

/** brass castings live on the wood: between the cloth edge and the outer lip */
const BRASS_IN_MM = CUSHION_MM + 1
const BRASS_OUT_MM = RAIL_BAND_MM - 52
/** how far the corner angle piece runs along each rail from the corner */
const BRASS_ARM_MM = 186
const BRASS_OUTER_ROUND_MM = 34
const BRASS_INNER_ROUND_MM = 9
const SCREW_R_MM = 6

/** middle-pocket plates, laid along the rail on either side of the mouth */
const PLATE_LEN_MM = 74
const PLATE_ROUND_MM = 11
/** gap between the throat edge and the near end of the plate */
const PLATE_GAP_MM = 9

/** cushion nose: lit edge, dark edge and the shadow it drops on the bed */
const NOSE_EDGE_MM = 4.5
const NOSE_SHADOW_MM = 26

/* ------------------------------------------------------------------ helpers */

/** derive a translucent tone from a palette hex - never invent a new colour */
function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

/** lighten (amt > 0) or darken (amt < 0) a palette hex, staying on its hue */
function shift(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16)
  const f = (c: number) => Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt))
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`
}

/** blend two palette hexes, t = 0 gives a, t = 1 gives b */
function mix(a: string, b: string, t: number): string {
  const na = parseInt(a.slice(1), 16)
  const nb = parseInt(b.slice(1), 16)
  const f = (s: number) =>
    Math.round(((na >> s) & 255) * (1 - t) + ((nb >> s) & 255) * t)
  return `rgb(${f(16)},${f(8)},${f(0)})`
}

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
const addv = (a: Vec, b: Vec, k = 1): Vec => ({ x: a.x + b.x * k, y: a.y + b.y * k })
const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y
const unit = (a: Vec): Vec => {
  const l = Math.hypot(a.x, a.y) || 1
  return { x: a.x / l, y: a.y / l }
}
/** component of `v` left over once everything along `axis` is removed */
const reject = (v: Vec, axis: Vec): Vec => unit(sub(v, { x: axis.x * dot(v, axis), y: axis.y * dot(v, axis) }))

/** deterministic 0..1 noise - the view must stay a pure function of `g` */
function noise(i: number): number {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

const TAU = Math.PI * 2
const wrap = (a: number): number => ((a % TAU) + TAU) % TAU

/** closed polygon with a rounded corner at every vertex */
function roundedPath(ctx: Context, pts: Vec[], radii: number[]): void {
  const n = pts.length
  const start = mid(pts[0], pts[1])
  ctx.moveTo(start.x, start.y)
  for (let i = 1; i <= n; i++) {
    const cur = pts[i % n]
    const nxt = pts[(i + 1) % n]
    ctx.arcTo(cur.x, cur.y, nxt.x, nxt.y, radii[i % n])
  }
  ctx.closePath()
}

/* ------------------------------------------------------------------ pockets */

type Opening = {
  /** mouth ends, on the play-field boundary */
  m0: Vec
  m1: Vec
  /** where each jaw face stops and the rounded back takes over */
  t0: Vec
  t1: Vec
  /** the back of the opening is an arc about the pocket's nominal point */
  r: number
  a0: number
  a1: number
  /** true when the arc has to be swept anticlockwise to pass through `out` */
  ccw: boolean
}

/**
 * The real shape of a pocket opening, built from the jaws rather than from a
 * circle stuck on the rail: the mouth chord between the two noses, the cut face
 * of each cushion, and a rounded back.
 *
 * `faceFrac` says how far down each cut face to travel before rounding over, so
 * the same construction gives both the wide cloth-covered shelf (the whole face)
 * and the modest black hole sunk into it (the first part of it). `side` slides
 * the walls sideways: outwards for the shelf, so the cushion drawn on top hides
 * the seam, inwards for the hole, so a rim of wall survives at the mouth.
 */
function openingOf(p: Pocket, faceFrac: number, ext: number, side: number): Opening {
  const ends = ([0, 1] as const).map((i) => {
    const nose = p.jaws[i]
    const back = p.jawBacks[i]
    const dir = p.jawDirs[i]
    // sideways normal of this cut face, pointing into the cushion it belongs to
    const nrm = reject(sub(mid(nose, back), p.at), dir)
    const faceLen = Math.hypot(back.x - nose.x, back.y - nose.y)
    const m = addv(nose, nrm, side)
    const t = addv(m, dir, faceLen * faceFrac + ext)
    return { m, t }
  })
  const t0 = ends[0].t
  const t1 = ends[1].t
  const r =
    (Math.hypot(t0.x - p.at.x, t0.y - p.at.y) + Math.hypot(t1.x - p.at.x, t1.y - p.at.y)) / 2
  const a0 = Math.atan2(t0.y - p.at.y, t0.x - p.at.x)
  const a1 = Math.atan2(t1.y - p.at.y, t1.x - p.at.x)
  const aOut = Math.atan2(p.out.y, p.out.x)
  // sweep whichever way passes through `out`, i.e. around the back of the pocket
  const ccw = wrap(aOut - a0) > wrap(a1 - a0)
  return { m0: ends[0].m, m1: ends[1].m, t0, t1, r, a0, a1, ccw }
}

function openingPath(ctx: Context, p: Pocket, o: Opening): void {
  ctx.beginPath()
  ctx.moveTo(o.m0.x, o.m0.y)
  ctx.lineTo(o.t0.x, o.t0.y)
  ctx.arc(p.at.x, p.at.y, o.r, o.a0, o.a1, o.ccw)
  ctx.lineTo(o.m1.x, o.m1.y)
  ctx.closePath()
}

/**
 * A pocket: cloth-covered walls falling away behind the jaws, and the hole
 * itself sunk into them. Two layers, because a single black patch as wide as
 * the jaw backs is what made the old render look like a sticker.
 */
function PocketThroat({ p, felt }: { p: Pocket; felt: ClothPalette }) {
  const corner = p.kind === 'corner'
  const shelf = openingOf(p, 1, corner ? SHELF_EXT_CORNER_MM : SHELF_EXT_MIDDLE_MM, WALL_BIAS_MM)
  const hole = openingOf(p, corner ? HOLE_FRAC_CORNER : HOLE_FRAC_MIDDLE, 0, -HOLE_INSET_MM)
  // the walls fall away from the mouth, so they darken with depth, not sideways
  const rim = addv(p.at, p.out, -CUSHION_MM * 0.8)
  const deep = addv(p.at, p.out, shelf.r)
  return (
    <Group>
      {/* cloth-covered pocket walls */}
      <Shape
        sceneFunc={(ctx: Context, shape: KonvaShape) => {
          openingPath(ctx, p, shelf)
          ctx.fillStrokeShape(shape)
        }}
        fillLinearGradientStartPoint={rim}
        fillLinearGradientEndPoint={deep}
        fillLinearGradientColorStops={[
          0,
          felt.cushion,
          0.2,
          felt.cushionShade,
          0.46,
          mix(felt.cushionShade, POCKET_THROAT, 0.75),
          1,
          POCKET_THROAT,
        ]}
        stroke={rgba(felt.vignette, 0.85)}
        strokeWidth={2}
      />
      {/* brass lip where the walls meet the casting at the back of the opening */}
      <Shape
        sceneFunc={(ctx: Context, shape: KonvaShape) => {
          ctx.beginPath()
          ctx.arc(p.at.x, p.at.y, shelf.r - 1, shelf.a0, shelf.a1, shelf.ccw)
          ctx.fillStrokeShape(shape)
        }}
        stroke={rgba(METAL.mid, 0.22)}
        strokeWidth={2}
      />
      {/* the hole, with the far wall barely catching the light */}
      <Shape
        sceneFunc={(ctx: Context, shape: KonvaShape) => {
          openingPath(ctx, p, hole)
          ctx.fillStrokeShape(shape)
        }}
        fillLinearGradientStartPoint={addv(p.at, LIGHT, hole.r)}
        fillLinearGradientEndPoint={addv(p.at, LIGHT, -hole.r)}
        fillLinearGradientColorStops={[
          0,
          '#000000',
          0.6,
          POCKET_THROAT,
          1,
          mix(POCKET_THROAT, WOOD.mid, 0.3),
        ]}
        shadowColor={rgba(felt.vignette, 0.75)}
        shadowBlur={7}
      />
    </Group>
  )
}

/* -------------------------------------------------------------------- brass */

function metalStops(dir: Vec, span: number, at: Vec) {
  return {
    fillLinearGradientStartPoint: addv(at, dir, -span),
    fillLinearGradientEndPoint: addv(at, dir, span),
    fillLinearGradientColorStops: [
      0,
      mix(METAL.light, METAL.mid, 0.42),
      0.42,
      METAL.mid,
      1,
      METAL.dark,
    ],
  }
}

/** a small domed screw head with a slot */
function Screw({ at }: { at: Vec }) {
  return (
    <Group>
      <Circle
        x={at.x}
        y={at.y}
        radius={SCREW_R_MM}
        fillRadialGradientStartPoint={{ x: -SCREW_R_MM * 0.4, y: -SCREW_R_MM * 0.4 }}
        fillRadialGradientStartRadius={0}
        fillRadialGradientEndPoint={{ x: 0, y: 0 }}
        fillRadialGradientEndRadius={SCREW_R_MM}
        fillRadialGradientColorStops={[0, METAL.light, 1, METAL.dark]}
        stroke={rgba(WOOD.edgeShadow, 0.55)}
        strokeWidth={1}
      />
      <Line
        points={[at.x - SCREW_R_MM * 0.55, at.y + SCREW_R_MM * 0.55, at.x + SCREW_R_MM * 0.55, at.y - SCREW_R_MM * 0.55]}
        stroke={rgba(WOOD.edgeShadow, 0.7)}
        strokeWidth={1.6}
        lineCap="round"
      />
    </Group>
  )
}

/**
 * Corner casting: one L-shaped angle piece hugging both rails, its inner step
 * sitting exactly where the cloth ends and its outer edge stopping short of the
 * lighter lip that runs round the table.
 */
function CornerCasting({ p }: { p: Pocket }) {
  // the two rail directions leaving this corner
  const uA = unit(sub(p.jaws[0], p.at))
  const uB = unit(sub(p.jaws[1], p.at))
  const at = (s: number, q: number): Vec => ({
    x: p.at.x + uA.x * s + uB.x * q,
    y: p.at.y + uA.y * s + uB.y * q,
  })
  const i = BRASS_IN_MM
  const o = BRASS_OUT_MM
  const n = BRASS_ARM_MM
  const pts = [at(n, -i), at(n, -o), at(-o, -o), at(-o, n), at(-i, n), at(-i, -i)]
  const radii = [
    BRASS_INNER_ROUND_MM,
    BRASS_INNER_ROUND_MM,
    BRASS_OUTER_ROUND_MM,
    BRASS_INNER_ROUND_MM,
    BRASS_INNER_ROUND_MM,
    BRASS_INNER_ROUND_MM,
  ]
  const mid2 = (i + o) / 2
  const screws = [at(n - 42, -mid2), at(-mid2, n - 42), at(-o * 0.7, -o * 0.7)]
  return (
    <Group>
      <Shape
        sceneFunc={(ctx: Context, shape: KonvaShape) => {
          ctx.beginPath()
          roundedPath(ctx, pts, radii)
          ctx.fillStrokeShape(shape)
        }}
        {...metalStops(LIGHT, BRASS_ARM_MM * 0.55, at(-o * 0.4, -o * 0.4))}
        stroke={rgba(METAL.dark, 0.85)}
        strokeWidth={1.8}
        shadowColor={rgba(WOOD.edgeShadow, 0.55)}
        shadowBlur={7}
        shadowOffsetX={2}
        shadowOffsetY={2}
      />
      {/* bright bevel along the two inner steps, where the light rakes across */}
      <Line
        points={[at(n - 6, -i).x, at(n - 6, -i).y, at(-i, -i).x, at(-i, -i).y, at(-i, n - 6).x, at(-i, n - 6).y]}
        stroke={rgba(METAL.light, 0.55)}
        strokeWidth={2.4}
        lineJoin="round"
        lineCap="round"
      />
      {screws.map((s, k) => (
        <Screw key={k} at={s} />
      ))}
    </Group>
  )
}

/** Middle casting: a small plate lying along the rail on each side of the mouth. */
function MiddleCasting({ p }: { p: Pocket }) {
  const th = openingOf(p, 1, SHELF_EXT_MIDDLE_MM, WALL_BIAS_MM)
  const tan: Vec = { x: -p.out.y, y: p.out.x }
  const i = BRASS_IN_MM
  const o = BRASS_OUT_MM
  // half-width of the opening where it leaves the cushion, so the plate can hug it
  const half = Math.sqrt(Math.max(th.r * th.r - i * i, 1))
  const near = half + PLATE_GAP_MM
  const at = (s: number, d: number): Vec => ({
    x: p.at.x + tan.x * s + p.out.x * d,
    y: p.at.y + tan.y * s + p.out.y * d,
  })
  const plate = (sign: number) => {
    const s0 = near * sign
    const s1 = (near + PLATE_LEN_MM) * sign
    const pts = [at(s0, i + 10), at(s1, i + 10), at(s1, o - 12), at(s0, o - 12)]
    const radii = [PLATE_ROUND_MM, PLATE_ROUND_MM, PLATE_ROUND_MM, PLATE_ROUND_MM]
    const c = at((near + PLATE_LEN_MM / 2) * sign, (i + o) / 2)
    return {
      pts,
      radii,
      c,
      screws: [
        at((near + 17) * sign, (i + o) / 2 + 2),
        at((near + PLATE_LEN_MM - 17) * sign, (i + o) / 2 + 2),
      ],
    }
  }
  return (
    <Group>
      {[-1, 1].map((sign) => {
        const pl = plate(sign)
        return (
          <Group key={sign}>
            <Shape
              sceneFunc={(ctx: Context, shape: KonvaShape) => {
                ctx.beginPath()
                roundedPath(ctx, pl.pts, pl.radii)
                ctx.fillStrokeShape(shape)
              }}
              {...metalStops(LIGHT, PLATE_LEN_MM * 0.5, pl.c)}
              stroke={rgba(METAL.dark, 0.85)}
              strokeWidth={1.8}
              shadowColor={rgba(WOOD.edgeShadow, 0.55)}
              shadowBlur={6}
              shadowOffsetX={2}
              shadowOffsetY={2}
            />
            {pl.screws.map((s, k) => (
              <Screw key={k} at={s} />
            ))}
          </Group>
        )
      })}
    </Group>
  )
}

/* ----------------------------------------------------------------- cushions */

/**
 * One cloth-covered cushion. The band is the single most important step in the
 * picture, so it gets: a dark contact line against the wood, a body that is
 * clearly darker than the felt, a nose edge lit according to which way it faces
 * and a soft shadow dropped onto the bed by the noses that face away from the
 * light.
 */
function Cushion({ poly, felt }: { poly: number[]; felt: ClothPalette }) {
  const a: Vec = { x: poly[0], y: poly[1] }
  const b: Vec = { x: poly[2], y: poly[3] }
  const bBack: Vec = { x: poly[4], y: poly[5] }
  const aBack: Vec = { x: poly[6], y: poly[7] }
  const noseMid = mid(a, b)
  const backMid = mid(aBack, bBack)
  // inward normal: from the back of the cushion towards its nose, into the field
  const n = unit(sub(noseMid, backMid))
  const lit = Math.max(0, dot(n, LIGHT))
  const shade = Math.max(0, -dot(n, LIGHT))

  const nose = shift(felt.cushion, 0.01 + 0.08 * lit)
  // the rubber is a ramp: darkest against the wood, lifting towards the nose
  const contact = CUSHION_MM * 0.42
  return (
    <Group>
      <Line
        points={poly}
        closed
        fillLinearGradientStartPoint={backMid}
        fillLinearGradientEndPoint={noseMid}
        fillLinearGradientColorStops={[
          0,
          felt.cushionShade,
          0.5,
          mix(felt.cushionShade, felt.cushion, 0.8),
          1,
          nose,
        ]}
        lineJoin="round"
      />
      {/* the wood steps down onto the cushion, so it drops a shadow on it */}
      <Line
        points={[
          aBack.x,
          aBack.y,
          bBack.x,
          bBack.y,
          bBack.x + n.x * contact,
          bBack.y + n.y * contact,
          aBack.x + n.x * contact,
          aBack.y + n.y * contact,
        ]}
        closed
        fillLinearGradientStartPoint={backMid}
        fillLinearGradientEndPoint={addv(backMid, n, contact)}
        fillLinearGradientColorStops={[
          0,
          rgba(felt.vignette, 0.62),
          1,
          rgba(felt.vignette, 0),
        ]}
      />
      {/* the rubber nose: a crisp edge, with the round of it catching the light
          only on the two rails that actually face the lamp */}
      <Line
        points={[a.x, a.y, b.x, b.y]}
        stroke={rgba(felt.vignette, 0.3 + 0.28 * shade)}
        strokeWidth={NOSE_EDGE_MM * 0.8}
      />
      <Line
        points={[
          a.x - n.x * NOSE_EDGE_MM,
          a.y - n.y * NOSE_EDGE_MM,
          b.x - n.x * NOSE_EDGE_MM,
          b.y - n.y * NOSE_EDGE_MM,
        ]}
        stroke={`rgba(255,255,255,${(0.03 + 0.13 * lit).toFixed(3)})`}
        strokeWidth={NOSE_EDGE_MM}
      />
    </Group>
  )
}

/** the shadow a cushion nose drops onto the bed - drawn over the markings */
function CushionShadow({ poly, felt }: { poly: number[]; felt: ClothPalette }) {
  const a: Vec = { x: poly[0], y: poly[1] }
  const b: Vec = { x: poly[2], y: poly[3] }
  const bBack: Vec = { x: poly[4], y: poly[5] }
  const aBack: Vec = { x: poly[6], y: poly[7] }
  const noseMid = mid(a, b)
  const n = unit(sub(noseMid, mid(aBack, bBack)))
  const shade = Math.max(0, -dot(n, LIGHT))
  const alpha = 0.05 + 0.22 * shade
  const d = NOSE_SHADOW_MM * (0.45 + 0.55 * shade)
  return (
    <Line
      points={[a.x, a.y, b.x, b.y, b.x + n.x * d, b.y + n.y * d, a.x + n.x * d, a.y + n.y * d]}
      closed
      fillLinearGradientStartPoint={noseMid}
      fillLinearGradientEndPoint={addv(noseMid, n, d)}
      fillLinearGradientColorStops={[0, rgba(felt.vignette, alpha), 1, rgba(felt.vignette, 0)]}
    />
  )
}

/* --------------------------------------------------------------------- wood */

/** very low contrast grain running the length of each rail */
function WoodGrain({ g }: { g: TableGeometry }) {
  const x0 = g.outerX
  const y0 = g.outerY
  const x1 = x0 + g.outerWidthMm
  const y1 = y0 + g.outerHeightMm
  const lines = 24
  return (
    <Shape
      sceneFunc={(ctx: Context, shape: KonvaShape) => {
        ctx.beginPath()
        // each rail keeps its own grain direction, mitred at the corners
        for (let i = 0; i < lines; i++) {
          const f = (i + 0.5) / lines
          const off = 6 + f * (RAIL_BAND_MM - 12)
          const j = (noise(i) - 0.5) * 6
          const k = (noise(i + 41) - 0.5) * 6
          ctx.moveTo(x0 + off, y0 + off + j)
          ctx.lineTo(x1 - off, y0 + off + k)
          ctx.moveTo(x0 + off, y1 - off + j)
          ctx.lineTo(x1 - off, y1 - off + k)
          ctx.moveTo(x0 + off + j, y0 + off)
          ctx.lineTo(x0 + off + k, y1 - off)
          ctx.moveTo(x1 - off + j, y0 + off)
          ctx.lineTo(x1 - off + k, y1 - off)
        }
        ctx.fillStrokeShape(shape)
      }}
      stroke={rgba(WOOD.edgeShadow, 0.05)}
      strokeWidth={1.4}
    />
  )
}

/* --------------------------------------------------------------------- view */

export function TableView({ g }: { g: TableGeometry }): JSX.Element {
  const felt = CLOTH[g.cfg.cloth]

  // cloth footprint: the play field plus the cushion band it wraps
  const cx = -CUSHION_MM
  const cy = -CUSHION_MM
  const cw = g.lengthMm + 2 * CUSHION_MM
  const ch = g.widthMm + 2 * CUSHION_MM
  const fx = cx + cw / 2
  const fy = cy + ch / 2

  const railW = g.outerWidthMm - 2 * FRAME_LIP_MM
  const railH = g.outerHeightMm - 2 * FRAME_LIP_MM

  return (
    // listening=false: the table must never steal a pointer event from a ball
    <Group listening={false}>
      {/* 1. body: the lighter lip that runs round the very outside of the table */}
      <Rect
        x={g.outerX}
        y={g.outerY}
        width={g.outerWidthMm}
        height={g.outerHeightMm}
        cornerRadius={TABLE_CORNER_RADIUS_MM}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: g.outerWidthMm, y: g.outerHeightMm }}
        fillLinearGradientColorStops={[0, WOOD.frameHighlight, 0.55, WOOD.frame, 1, WOOD.light]}
        shadowColor="rgba(0,0,0,0.55)"
        shadowBlur={BODY_SHADOW_BLUR_MM}
        shadowOffsetY={BODY_SHADOW_OFFSET_MM}
      />

      {/* 1b. the very outer edge catches the light all the way round */}
      <Rect
        x={g.outerX + 1.2}
        y={g.outerY + 1.2}
        width={g.outerWidthMm - 2.4}
        height={g.outerHeightMm - 2.4}
        cornerRadius={TABLE_CORNER_RADIUS_MM - 1.2}
        stroke={rgba(WOOD.frameHighlight, 0.75)}
        strokeWidth={2.4}
      />

      {/* 2. the rail proper: warm brown, matte, only a whisper of gradient */}
      <Rect
        x={g.outerX + FRAME_LIP_MM}
        y={g.outerY + FRAME_LIP_MM}
        width={railW}
        height={railH}
        cornerRadius={TABLE_CORNER_RADIUS_MM - FRAME_LIP_MM}
        fillLinearGradientStartPoint={{ x: g.outerX, y: g.outerY }}
        fillLinearGradientEndPoint={{ x: g.outerX + railW, y: g.outerY + railH }}
        fillLinearGradientColorStops={[
          0,
          mix(WOOD.light, WOOD.frame, 0.45),
          0.5,
          WOOD.mid,
          1,
          mix(WOOD.mid, WOOD.dark, 0.5),
        ]}
        stroke={rgba(WOOD.edgeShadow, 0.5)}
        strokeWidth={2}
      />

      <WoodGrain g={g} />

      {/* 3. varnish sheen: a single broad diagonal band, nothing more */}
      <Rect
        x={g.outerX + FRAME_LIP_MM}
        y={g.outerY + FRAME_LIP_MM}
        width={railW}
        height={railH}
        cornerRadius={TABLE_CORNER_RADIUS_MM - FRAME_LIP_MM}
        fillLinearGradientStartPoint={{ x: g.outerX, y: g.outerY - railH * 0.4 }}
        fillLinearGradientEndPoint={{ x: g.outerX + railW * 0.85, y: g.outerY + railH }}
        fillLinearGradientColorStops={[
          0,
          'rgba(255,255,255,0.085)',
          0.42,
          'rgba(255,255,255,0.012)',
          0.62,
          'rgba(0,0,0,0.02)',
          1,
          'rgba(0,0,0,0.075)',
        ]}
      />

      {/* 4. sight dots, set flush into the wood */}
      {g.sights.map((s, i) => (
        <Circle
          key={i}
          x={s.x}
          y={s.y}
          radius={SIGHT_R_MM}
          fillRadialGradientStartPoint={{ x: -SIGHT_R_MM * 0.3, y: -SIGHT_R_MM * 0.3 }}
          fillRadialGradientStartRadius={0}
          fillRadialGradientEndPoint={{ x: 0, y: 0 }}
          fillRadialGradientEndRadius={SIGHT_R_MM}
          fillRadialGradientColorStops={[0, '#FFFFFF', 0.7, SIGHT, 1, shift(SIGHT, -0.12)]}
          stroke={rgba(WOOD.edgeShadow, 0.45)}
          strokeWidth={SIGHT_RIM_MM}
          shadowColor={rgba(WOOD.edgeShadow, 0.5)}
          shadowBlur={3}
          shadowOffsetX={0.8}
          shadowOffsetY={0.8}
        />
      ))}

      {/* 5. cloth: bright under the lamp, only slightly cooler towards the ends */}
      <Rect
        x={cx}
        y={cy}
        width={cw}
        height={ch}
        cornerRadius={CLOTH_CORNER_MM}
        fillRadialGradientStartPoint={{ x: fx, y: fy }}
        fillRadialGradientStartRadius={0}
        fillRadialGradientEndPoint={{ x: fx, y: fy }}
        fillRadialGradientEndRadius={ch * 0.95}
        fillRadialGradientColorStops={[
          0,
          shift(felt.clothLight, 0.05),
          0.45,
          felt.clothLight,
          1,
          felt.clothDark,
        ]}
        stroke={rgba(WOOD.edgeShadow, 0.75)}
        strokeWidth={4}
      />

      {/* 6. directional wash across the nap, upper left towards lower right */}
      <Rect
        x={cx}
        y={cy}
        width={cw}
        height={ch}
        cornerRadius={CLOTH_CORNER_MM}
        fillLinearGradientStartPoint={{ x: cx, y: cy }}
        fillLinearGradientEndPoint={{ x: cx + cw * 0.6, y: cy + ch }}
        fillLinearGradientColorStops={[
          0,
          'rgba(255,255,255,0.05)',
          0.45,
          'rgba(255,255,255,0)',
          0.6,
          'rgba(0,0,0,0)',
          1,
          'rgba(0,0,0,0.055)',
        ]}
      />

      {/* 6b. the lamp itself, an off-centre bloom towards the upper left */}
      <Rect
        x={cx}
        y={cy}
        width={cw}
        height={ch}
        cornerRadius={CLOTH_CORNER_MM}
        fillRadialGradientStartPoint={{ x: cx + cw * 0.42, y: cy + ch * 0.4 }}
        fillRadialGradientStartRadius={0}
        fillRadialGradientEndPoint={{ x: cx + cw * 0.42, y: cy + ch * 0.4 }}
        fillRadialGradientEndRadius={ch * 0.8}
        fillRadialGradientColorStops={[
          0,
          'rgba(255,255,255,0.055)',
          0.6,
          'rgba(255,255,255,0.016)',
          1,
          'rgba(255,255,255,0)',
        ]}
      />

      {/* 7. house line, quarter / half / three-quarter lines and the spots */}
      {g.cfg.markings && (
        <Group>
          {g.crossLines.map((l, i) => (
            <Line
              key={i}
              points={[l.from.x, l.from.y, l.to.x, l.to.y]}
              stroke={MARKING}
              strokeWidth={MARKING_W_MM}
              lineCap="round"
            />
          ))}
          <Line
            points={[g.longLine.from.x, g.longLine.from.y, g.longLine.to.x, g.longLine.to.y]}
            stroke={MARKING}
            strokeWidth={MARKING_W_MM}
            lineCap="round"
          />
          {g.spots.map((s, i) => (
            <Circle key={i} x={s.x} y={s.y} radius={SPOT_R_MM} fill={MARKING_SPOT} />
          ))}
        </Group>
      )}

      {/* 8. brass castings, on the wood - the throats punch through them next */}
      {g.pockets.map((p) =>
        p.kind === 'corner' ? <CornerCasting key={p.id} p={p} /> : <MiddleCasting key={p.id} p={p} />,
      )}

      {/* 9. pocket openings, shaped by the jaws */}
      {g.pockets.map((p) => (
        <PocketThroat key={p.id} p={p} felt={felt} />
      ))}

      {/* 10. the cushion band: the step between the wood and the bed */}
      {g.cushions.map((poly, i) => (
        <Cushion key={i} poly={poly} felt={felt} />
      ))}
      {g.cushions.map((poly, i) => (
        <CushionShadow key={i} poly={poly} felt={felt} />
      ))}
    </Group>
  )
}
