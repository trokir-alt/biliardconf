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


/** brass castings live on the wood: between the cloth edge and the outer lip */
const BRASS_IN_MM = CUSHION_MM + 0.5
const BRASS_OUT_MM = CUSHION_MM + 38
/** how far the corner angle piece runs along each rail from the corner */
const BRASS_ARM_MM = 186
const BRASS_OUTER_ROUND_MM = 34
const SCREW_R_MM = 6

/** middle-pocket plates, laid along the rail on either side of the mouth */
const PLATE_LEN_MM = 74

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



/* ------------------------------------------------------------------ pockets */

/**
 * How far the visible black opening bulges out of the mouth chord, towards the
 * rail. It has to stay inside the rubber band (CUSHION_MM): black must never
 * reach past the outer contour of the cushion, or the pocket reads as a hole
 * chewed out of the rail instead of a mouth between two jaws.
 */
/*
 * Measured from the mouth chord, not from the pocket point. At a corner the
 * chord sits 36 mm inside the field corner, so anything under that never
 * reaches the rubber at all; the band corner is 78 mm out, which is the ceiling.
 * In the middle the chord is already on the boundary, so the 55 mm of rubber is
 * the whole budget.
 */
const MOUTH_DEPTH_CORNER_MM = 62
const MOUTH_DEPTH_MIDDLE_MM = 40
/** chamfer of rubber visible on each jaw face, so the jaw is not a cliff */
const CHAMFER_MM = 8
const CHAMFER_LEN_MM = 26

/**
 * Control point of the quadratic that closes a pocket mouth.
 *
 * A quadratic from j0 to j1 passes through `mid + out * depth` at t = 0.5 when
 * its control point is `mid + out * 2 * depth`, so this is the whole shape of
 * the opening: the mouth chord itself, bulged out by `depth`.
 */
function mouthCtrl(p: Pocket, depth: number): Vec {
  return addv(mid(p.jaws[0], p.jaws[1]), p.out, depth * 2)
}

function mouthDepth(p: Pocket): number {
  return p.kind === 'corner' ? MOUTH_DEPTH_CORNER_MM : MOUTH_DEPTH_MIDDLE_MM
}

/** the mouth as a closed path: chord + bulge, nothing else */
function mouthPath(ctx: Context, p: Pocket): void {
  const c = mouthCtrl(p, mouthDepth(p))
  ctx.beginPath()
  ctx.moveTo(p.jaws[0].x, p.jaws[0].y)
  ctx.quadraticCurveTo(c.x, c.y, p.jaws[1].x, p.jaws[1].y)
  ctx.closePath()
}

/**
 * The pocket opening.
 *
 * This is the ONLY black that touches the play field, and it touches it across
 * exactly the mouth: 72 mm at a corner, 82 mm in the middle. Everything behind
 * it is covered by the brass casting, which is what a real pocket looks like
 * from above - the throat does widen with depth, you just cannot see it.
 */
function PocketMouth({ p }: { p: Pocket }) {
  const d = mouthDepth(p)
  const c = mid(p.jaws[0], p.jaws[1])
  return (
    <Shape
      sceneFunc={(ctx: Context, shape: KonvaShape) => {
        mouthPath(ctx, p)
        ctx.fillStrokeShape(shape)
      }}
      // two stops only: every extra gradient layer costs export weight
      fillLinearGradientStartPoint={c}
      fillLinearGradientEndPoint={addv(c, p.out, d)}
      fillLinearGradientColorStops={[0, '#000000', 1, mix(POCKET_THROAT, WOOD.dark, 0.35)]}
      stroke={rgba(POCKET_THROAT, 0.9)}
      strokeWidth={1.5}
    />
  )
}

/**
 * The bevel of rubber along a jaw face. Without it the cushion ends in a cliff
 * and the jaw reads as a cut rather than as a rounded nose.
 */
function JawChamfers({ p, felt }: { p: Pocket; felt: ClothPalette }) {
  return (
    <Group>
      {([0, 1] as const).map((i) => {
        const nose = p.jaws[i]
        const dir = p.jawDirs[i]
        // sideways, into the cushion this jaw belongs to
        const nrm = unit(reject(sub(mid(p.jaws[0], p.jaws[1]), nose), dir))
        const a = addv(nose, dir, 2)
        const b = addv(a, dir, CHAMFER_LEN_MM)
        return (
          <Line
            key={i}
            points={[
              a.x,
              a.y,
              b.x,
              b.y,
              b.x - nrm.x * CHAMFER_MM,
              b.y - nrm.y * CHAMFER_MM,
              a.x - nrm.x * CHAMFER_MM,
              a.y - nrm.y * CHAMFER_MM,
            ]}
            closed
            fill={shift(felt.cushion, 0.14)}
          />
        )
      })}
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
 * Corner casting: a narrow L-shaped angle piece hugging both rails, whose inner
 * edge follows the contour of the mouth.
 *
 * That inner edge is the point of the whole thing. The throat really does flare
 * out to ~206 mm between the jaw backs - two rails meeting at a right angle can
 * do nothing else - and if the brass stops short of it, all of that flare
 * renders as black and the corner reads as a hole rather than a pocket. So the
 * casting runs right up to the jaw faces and closes across the mouth on the
 * same quadratic the opening is drawn with.
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
  const b0 = p.jawBacks[0]
  const b1 = p.jawBacks[1]
  const ctrl = mouthCtrl(p, mouthDepth(p))
  const mid2 = (i + o) / 2
  const screws = [at(n - 40, -mid2), at(-mid2, n - 40), at(-mid2 * 0.9, -mid2 * 0.9)]
  return (
    <Group>
      <Shape
        sceneFunc={(ctx: Context, shape: KonvaShape) => {
          ctx.beginPath()
          ctx.moveTo(at(n, -i).x, at(n, -i).y)
          // inner edge: along the back of cushion A, down its jaw face, across
          // the mouth, then back out the mirror image on rail B
          ctx.lineTo(b0.x, b0.y)
          ctx.lineTo(p.jaws[0].x, p.jaws[0].y)
          ctx.quadraticCurveTo(ctrl.x, ctrl.y, p.jaws[1].x, p.jaws[1].y)
          ctx.lineTo(b1.x, b1.y)
          ctx.lineTo(at(-i, n).x, at(-i, n).y)
          // outer edge, with the table's own rounded corner
          ctx.lineTo(at(-o, n).x, at(-o, n).y)
          ctx.arcTo(at(-o, -o).x, at(-o, -o).y, at(n, -o).x, at(n, -o).y, BRASS_OUTER_ROUND_MM)
          ctx.lineTo(at(n, -o).x, at(n, -o).y)
          ctx.closePath()
          ctx.fillStrokeShape(shape)
        }}
        {...metalStops(LIGHT, BRASS_ARM_MM * 0.55, at(-mid2, -mid2))}
        stroke={rgba(METAL.dark, 0.85)}
        strokeWidth={1.6}
      />
      {/* the inner edge is a lip: a dark line hugging the mouth and jaw faces,
          with a lit bevel just outside it, so the casting reads as a rim round
          the opening and not as a flat plate */}
      <Shape
        sceneFunc={(ctx: Context, shape: KonvaShape) => {
          ctx.beginPath()
          ctx.moveTo(at(n - 8, -i).x, at(n - 8, -i).y)
          ctx.lineTo(b0.x, b0.y)
          ctx.lineTo(p.jaws[0].x, p.jaws[0].y)
          ctx.quadraticCurveTo(ctrl.x, ctrl.y, p.jaws[1].x, p.jaws[1].y)
          ctx.lineTo(b1.x, b1.y)
          ctx.lineTo(at(-i, n - 8).x, at(-i, n - 8).y)
          ctx.strokeShape(shape)
        }}
        stroke={rgba(METAL.dark, 0.7)}
        strokeWidth={3}
        lineCap="round"
        lineJoin="round"
      />
      <Line
        points={[at(n - 8, -i - 4).x, at(n - 8, -i - 4).y, at(-i - 4, -i - 4).x, at(-i - 4, -i - 4).y, at(-i - 4, n - 8).x, at(-i - 4, n - 8).y]}
        stroke={rgba(METAL.light, 0.4)}
        strokeWidth={2}
        lineCap="round"
        lineJoin="round"
      />
      {screws.map((sc, k) => (
        <Screw key={k} at={sc} />
      ))}
    </Group>
  )
}

/**
 * Middle casting: a plate along the rail on each side of the mouth, joined
 * behind it. The join is not decoration - it is what stops the throat's flare
 * from showing as black between the two plates.
 */
function MiddleCasting({ p }: { p: Pocket }) {
  const tan: Vec = { x: -p.out.y, y: p.out.x }
  const at = (s: number, d: number): Vec => ({
    x: p.at.x + tan.x * s + p.out.x * d,
    y: p.at.y + tan.y * s + p.out.y * d,
  })
  const i = BRASS_IN_MM
  const o = BRASS_OUT_MM
  const half = p.mouthMm / 2
  const span = half + PLATE_LEN_MM
  const ctrl = mouthCtrl(p, mouthDepth(p))
  const mid2 = (i + o) / 2
  const screws = [-1, 1].flatMap((sg) => [
    at((half + 20) * sg, mid2),
    at((span - 18) * sg, mid2),
  ])
  return (
    <Group>
      <Shape
        sceneFunc={(ctx: Context, shape: KonvaShape) => {
          ctx.beginPath()
          ctx.moveTo(at(-span, i).x, at(-span, i).y)
          ctx.lineTo(p.jawBacks[0].x, p.jawBacks[0].y)
          ctx.lineTo(p.jaws[0].x, p.jaws[0].y)
          ctx.quadraticCurveTo(ctrl.x, ctrl.y, p.jaws[1].x, p.jaws[1].y)
          ctx.lineTo(p.jawBacks[1].x, p.jawBacks[1].y)
          ctx.lineTo(at(span, i).x, at(span, i).y)
          ctx.lineTo(at(span, o).x, at(span, o).y)
          ctx.lineTo(at(-span, o).x, at(-span, o).y)
          ctx.closePath()
          ctx.fillStrokeShape(shape)
        }}
        {...metalStops(LIGHT, span, at(0, mid2))}
        stroke={rgba(METAL.dark, 0.85)}
        strokeWidth={1.6}
      />
      <Shape
        sceneFunc={(ctx: Context, shape: KonvaShape) => {
          ctx.beginPath()
          ctx.moveTo(at(-span + 8, i).x, at(-span + 8, i).y)
          ctx.lineTo(p.jawBacks[0].x, p.jawBacks[0].y)
          ctx.lineTo(p.jaws[0].x, p.jaws[0].y)
          ctx.quadraticCurveTo(ctrl.x, ctrl.y, p.jaws[1].x, p.jaws[1].y)
          ctx.lineTo(p.jawBacks[1].x, p.jawBacks[1].y)
          ctx.lineTo(at(span - 8, i).x, at(span - 8, i).y)
          ctx.strokeShape(shape)
        }}
        stroke={rgba(METAL.dark, 0.7)}
        strokeWidth={3}
        lineCap="round"
        lineJoin="round"
      />
      {/* the seam between the two plates, right behind the mouth */}
      <Line
        points={[at(0, mouthDepth(p) + 6).x, at(0, mouthDepth(p) + 6).y, at(0, o - 4).x, at(0, o - 4).y]}
        stroke={rgba(METAL.dark, 0.5)}
        strokeWidth={1.6}
      />
      {screws.map((sc, k) => (
        <Screw key={k} at={sc} />
      ))}
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

      {/* 9. the pocket mouths - the only black that touches the bed */}
      {g.pockets.map((p) => (
        <PocketMouth key={p.id} p={p} />
      ))}

      {/* 10. the cushion band: the step between the wood and the bed */}
      {g.cushions.map((poly, i) => (
        <Cushion key={i} poly={poly} felt={felt} />
      ))}
      {g.cushions.map((poly, i) => (
        <CushionShadow key={i} poly={poly} felt={felt} />
      ))}

      {/* 11. the rubber bevel on each jaw, so a jaw is a nose and not a cliff */}
      {g.pockets.map((p) => (
        <JawChamfers key={p.id} p={p} felt={felt} />
      ))}
    </Group>
  )
}
