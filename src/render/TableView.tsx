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

import { Circle, Group, Line, Rect, Ring, Shape, Text } from 'react-konva'
import type { Context } from 'konva/lib/Context'
import type { Shape as KonvaShape } from 'konva/lib/Shape'
import type { Pocket, TableGeometry } from '../model/table'
import {
  CUSHION_MM,
  FRAME_LIP_MM,
  TABLE_CORNER_RADIUS_MM,
  RIM_MM,
} from '../model/table'
import type { Vec } from '../model/types'
import type { ClothPalette } from '../model/theme'
import { CLOTH, MARKING, MARKING_SPOT, POCKET_THROAT, SIGHT, WATERMARK, WOOD } from '../model/theme'
import { WATERMARK_FONT } from '../model/fonts'
import { useStore } from '../state/store'

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



/* ------------------------------------------------------------------ pockets */

/** the cream ring round a hole, lit from the same corner as everything else */
const RIM = '#E8E2D0'
const RIM_SHADE = '#CBC3AE'
/** near-black, on purpose: it must read as black on the wood but stay above
    the "black past the rubber" threshold the picture check enforces */
const CAP = '#221F1C'
const CAP_W_MM = 132
const CAP_DEPTH_MM = 42
const CAP_ROUND_MM = 20
/** rounding of a cushion end where it meets the rim */
const CUSHION_END_R_MM = 10

/** The hole itself. Black in the middle, barely lifted at the far wall. */
function PocketHole({ p }: { p: Pocket }) {
  const { c, r } = p.hole
  return (
    <Circle
      x={c.x}
      y={c.y}
      radius={r}
      fillRadialGradientStartPoint={{ x: -r * 0.3, y: -r * 0.3 }}
      fillRadialGradientStartRadius={0}
      fillRadialGradientEndPoint={{ x: 0, y: 0 }}
      fillRadialGradientEndRadius={r}
      fillRadialGradientColorStops={[0, '#000000', 0.7, POCKET_THROAT, 1, mix(POCKET_THROAT, WOOD.dark, 0.25)]}
    />
  )
}

/**
 * The rim: a light ring round the hole, sitting on the wood and the rubber
 * both. Drawn before the cushions, so their rounded ends lie over it.
 */
function PocketRim({ p }: { p: Pocket }) {
  const { c, r } = p.hole
  return (
    <Group>
      <Ring
        x={c.x}
        y={c.y}
        innerRadius={r}
        outerRadius={r + RIM_MM}
        fillRadialGradientStartPoint={{ x: 0, y: 0 }}
        fillRadialGradientStartRadius={r}
        fillRadialGradientEndPoint={{ x: 0, y: 0 }}
        fillRadialGradientEndRadius={r + RIM_MM}
        fillRadialGradientColorStops={[0, RIM_SHADE, 0.45, RIM, 1, RIM]}
        stroke={rgba(WOOD.edgeShadow, 0.45)}
        strokeWidth={1.2}
      />
      {/* the inward shadow: the hole's edge, darker where the light does not reach */}
      <Circle
        x={c.x}
        y={c.y}
        radius={r + 1}
        stroke="rgba(0,0,0,0.35)"
        strokeWidth={2.4}
      />
    </Group>
  )
}

/** The black cap over the outer half of a middle pocket, on the frame. */
function MiddleCap({ p }: { p: Pocket }) {
  const tan: Vec = { x: -p.out.y, y: p.out.x }
  const at = (s: number, d: number): Vec => ({
    x: p.at.x + tan.x * s + p.out.x * d,
    y: p.at.y + tan.y * s + p.out.y * d,
  })
  const half = CAP_W_MM / 2
  const i = CUSHION_MM - 0.5
  const o = CUSHION_MM + CAP_DEPTH_MM
  const rr = CAP_ROUND_MM
  return (
    <Shape
      sceneFunc={(ctx: Context, shape: KonvaShape) => {
        // a rounded slab from the back of the rubber out onto the wood
        const p0 = at(-half, i), p1 = at(half, i), p2 = at(half, o), p3 = at(-half, o)
        ctx.beginPath()
        ctx.moveTo(p0.x, p0.y)
        ctx.lineTo(p1.x, p1.y)
        ctx.arcTo(p2.x, p2.y, p3.x, p3.y, rr)
        ctx.arcTo(p3.x, p3.y, p0.x, p0.y, rr)
        ctx.closePath()
        ctx.fillStrokeShape(shape)
      }}
      fill={CAP}
      stroke={rgba(WOOD.edgeShadow, 0.6)}
      strokeWidth={1.5}
      shadowColor="rgba(0,0,0,0.45)"
      shadowBlur={6}
      shadowOffsetY={2}
      shadowForStrokeEnabled={false}
    />
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
      <Shape
        sceneFunc={(ctx: Context, shape: KonvaShape) => {
          // the four corners rounded, so an end that lies over the rim reads
          // as the round of a rubber nose, not a saw cut
          const pts = [a, b, bBack, aBack]
          const r = CUSHION_END_R_MM
          const m0 = mid(pts[3], pts[0])
          ctx.beginPath()
          ctx.moveTo(m0.x, m0.y)
          for (let i = 0; i < 4; i++) {
            const c = pts[i]
            const n2 = pts[(i + 1) % 4]
            ctx.arcTo(c.x, c.y, n2.x, n2.y, r)
          }
          ctx.closePath()
          ctx.fillStrokeShape(shape)
        }}
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

/**
 * The coach's name along the diagonal of the cloth, big and faint. It reads
 * from the lower left up to the upper right of the screen: on the flat table
 * that is the diagonal from (0, W) to (L, 0); on the upright table the layer
 * turns a quarter clockwise, so the same screen reading takes the other
 * diagonal, from (L, W) to (0, 0).
 */
function Watermark({ g }: { g: TableGeometry }) {
  const upright = useStore((s) => s.orientation) === 'vertical'
  const L = g.lengthMm
  const W = g.widthMm
  const diag = Math.hypot(L, W)
  const tilt = (Math.atan2(W, L) * 180) / Math.PI // 26.6 degrees on a 2:1 table
  const rotation = upright ? tilt - 180 : -tilt
  return (
    <Group x={L / 2} y={W / 2} rotation={rotation} listening={false}>
      <Text
        name="watermark"
        x={-diag / 2}
        y={-WATERMARK.sizeMm / 2}
        width={diag}
        align="center"
        text={WATERMARK.text}
        fontFamily={WATERMARK_FONT}
        fontSize={WATERMARK.sizeMm}
        fontStyle="italic 800"
        letterSpacing={WATERMARK.letterSpacingMm}
        fill={WATERMARK.fill}
        opacity={WATERMARK.opacity}
        listening={false}
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

      {/* 7b. the watermark runs along the diagonal, over the markings and
          under everything on the scene layer */}
      <Watermark g={g} />

      {/* 8. corner pockets go under the cushions: the rounded rubber ends lie
          over the ring, which is how the corner reads on a broadcast */}
      {g.pockets.filter((p) => p.kind === 'corner').map((p) => (
        <PocketHole key={p.id} p={p} />
      ))}
      {g.pockets.filter((p) => p.kind === 'corner').map((p) => (
        <PocketRim key={p.id} p={p} />
      ))}

      {/* 9. the cushion band: the step between the wood and the bed */}
      {g.cushions.map((poly, i) => (
        <Cushion key={i} poly={poly} felt={felt} />
      ))}
      {g.cushions.map((poly, i) => (
        <CushionShadow key={i} poly={poly} felt={felt} />
      ))}

      {/* 10. middle pockets go over the cushions: the whole ring stays visible
          between the two rubber ends, then the black cap covers its outer half */}
      {g.pockets.filter((p) => p.kind === 'middle').map((p) => (
        <PocketHole key={p.id} p={p} />
      ))}
      {g.pockets.filter((p) => p.kind === 'middle').map((p) => (
        <PocketRim key={p.id} p={p} />
      ))}
      {g.pockets.filter((p) => p.kind === 'middle').map((p) => (
        <MiddleCap key={p.id} p={p} />
      ))}
    </Group>
  )
}
