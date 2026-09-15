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
 */

import { Arc, Circle, Group, Line, Rect } from 'react-konva'
import type { Pocket, TableGeometry } from '../model/table'
import { CUSHION_MM, FRAME_LIP_MM, RAIL_MM, TABLE_CORNER_RADIUS_MM } from '../model/table'
import type { Vec } from '../model/types'
import { CLOTH, MARKING, MARKING_SPOT, METAL, POCKET_THROAT, SIGHT, WOOD } from '../model/theme'

/* ------------------------------------------------------------ mm constants */

/** the stage is padded by PAD_MM (see render/layout.ts), so the body shadow
    has to fade out well inside that or export clips it */
const BODY_SHADOW_BLUR_MM = 34
const BODY_SHADOW_OFFSET_MM = 12

/** mother-of-pearl sight dots on the wooden rail */
const SIGHT_R_MM = 13
const SIGHT_RIM_MM = 1.5

/** cloth is rounded just enough to kill the hard corner under the castings */
const CLOTH_CORNER_MM = 12
/** how far the edge darkening reaches into the felt, and how strong it gets */
const VIGNETTE_MM = 300
const VIGNETTE_ALPHA = 0.38

const MARKING_W_MM = 4
const SPOT_R_MM = 9

/** throat centres are pushed out of the field so the hole eats into the wood */
const CORNER_THROAT_OUT_MM = 34
const CORNER_THROAT_R_MM = 82
const MIDDLE_THROAT_OUT_MM = 20
const MIDDLE_THROAT_R_MM = 54

/** brass angle bracket hugging a corner throat */
const BRACKET_INNER_MM = 86
const BRACKET_OUTER_MM = 112
const BRACKET_ANGLE_DEG = 150
const SCREW_R_MM = 7
/** screws sit on the mid-line of the bracket, symmetric about the out vector */
const SCREW_SPREAD_DEG = 55

/** middle-pocket plates, laid along the rail on either side of the throat */
const PLATE_LEN_MM = 90
const PLATE_W_MM = 34
const PLATE_CORNER_MM = 12
const PLATE_SIDE_MM = 88
/** deep enough into the wood that the plate never touches the cloth */
const PLATE_DEPTH_MM = CUSHION_MM + RAIL_MM * 0.22
const MIDDLE_ARC_INNER_MM = 58
const MIDDLE_ARC_OUTER_MM = 66
const MIDDLE_ARC_ANGLE_DEG = 100

/* ------------------------------------------------------------------ helpers */

/** derive a translucent tone from a palette hex - never invent a new colour */
function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

/** Konva angles are degrees, 0 along +x, positive clockwise in screen space */
function degOf(v: Vec): number {
  return (Math.atan2(v.y, v.x) * 180) / Math.PI
}

const metalStops = [0, METAL.light, 0.45, METAL.mid, 1, METAL.dark]

/* ------------------------------------------------------------------ pockets */

function throatOf(p: Pocket): { c: Vec; r: number } {
  const out = p.kind === 'corner' ? CORNER_THROAT_OUT_MM : MIDDLE_THROAT_OUT_MM
  const r = p.kind === 'corner' ? CORNER_THROAT_R_MM : MIDDLE_THROAT_R_MM
  return { c: { x: p.at.x + p.out.x * out, y: p.at.y + p.out.y * out }, r }
}

function Throat(p: Pocket) {
  const { c, r } = throatOf(p)
  return (
    <Circle
      key={p.id}
      x={c.x}
      y={c.y}
      radius={r}
      // dead black in the middle, barely lifted at the rim so it reads as depth
      fillRadialGradientStartPoint={{ x: 0, y: 0 }}
      fillRadialGradientStartRadius={0}
      fillRadialGradientEndPoint={{ x: 0, y: 0 }}
      fillRadialGradientEndRadius={r}
      fillRadialGradientColorStops={[0, POCKET_THROAT, 0.62, POCKET_THROAT, 1, rgba(WOOD.edgeShadow, 0.92)]}
      stroke={rgba(POCKET_THROAT, 0.9)}
      strokeWidth={4}
    />
  )
}

/** corner casting: an open bracket whose mouth faces the play field */
function CornerCasting(p: Pocket) {
  const { c } = throatOf(p)
  const outDeg = degOf(p.out)
  const mid = (BRACKET_INNER_MM + BRACKET_OUTER_MM) / 2
  const screwAt = (deg: number): Vec => {
    const a = (deg * Math.PI) / 180
    return { x: c.x + Math.cos(a) * mid, y: c.y + Math.sin(a) * mid }
  }
  const s1 = screwAt(outDeg - SCREW_SPREAD_DEG)
  const s2 = screwAt(outDeg + SCREW_SPREAD_DEG)
  return (
    <Group key={p.id}>
      <Arc
        x={c.x}
        y={c.y}
        innerRadius={BRACKET_INNER_MM}
        outerRadius={BRACKET_OUTER_MM}
        angle={BRACKET_ANGLE_DEG}
        rotation={outDeg - BRACKET_ANGLE_DEG / 2}
        fillLinearGradientStartPoint={{ x: -BRACKET_OUTER_MM, y: -BRACKET_OUTER_MM }}
        fillLinearGradientEndPoint={{ x: BRACKET_OUTER_MM, y: BRACKET_OUTER_MM }}
        fillLinearGradientColorStops={metalStops}
        stroke={rgba(METAL.dark, 0.85)}
        strokeWidth={2.5}
      />
      <Circle x={s1.x} y={s1.y} radius={SCREW_R_MM} fill={METAL.dark} />
      <Circle x={s2.x} y={s2.y} radius={SCREW_R_MM} fill={METAL.dark} />
    </Group>
  )
}

/** middle casting: two rail plates plus a thin arc on the outer side */
function MiddleCasting(p: Pocket) {
  const { c } = throatOf(p)
  const outDeg = degOf(p.out)
  // tangent along the rail, so the plates work for any pocket orientation
  const t: Vec = { x: -p.out.y, y: p.out.x }
  const plate = (sign: number) => ({
    x: p.at.x + p.out.x * PLATE_DEPTH_MM + t.x * PLATE_SIDE_MM * sign,
    y: p.at.y + p.out.y * PLATE_DEPTH_MM + t.y * PLATE_SIDE_MM * sign,
  })
  const plates = [plate(-1), plate(1)]
  return (
    <Group key={p.id}>
      <Arc
        x={c.x}
        y={c.y}
        innerRadius={MIDDLE_ARC_INNER_MM}
        outerRadius={MIDDLE_ARC_OUTER_MM}
        angle={MIDDLE_ARC_ANGLE_DEG}
        rotation={outDeg - MIDDLE_ARC_ANGLE_DEG / 2}
        fillLinearGradientStartPoint={{ x: -MIDDLE_ARC_OUTER_MM, y: -MIDDLE_ARC_OUTER_MM }}
        fillLinearGradientEndPoint={{ x: MIDDLE_ARC_OUTER_MM, y: MIDDLE_ARC_OUTER_MM }}
        fillLinearGradientColorStops={metalStops}
        stroke={rgba(METAL.dark, 0.85)}
        strokeWidth={2}
      />
      {plates.map((q, i) => (
        <Group key={i}>
          <Rect
            x={q.x}
            y={q.y}
            width={PLATE_LEN_MM}
            height={PLATE_W_MM}
            offsetX={PLATE_LEN_MM / 2}
            offsetY={PLATE_W_MM / 2}
            rotation={degOf(t)}
            cornerRadius={PLATE_CORNER_MM}
            fillLinearGradientStartPoint={{ x: 0, y: 0 }}
            fillLinearGradientEndPoint={{ x: 0, y: PLATE_W_MM }}
            fillLinearGradientColorStops={metalStops}
            stroke={rgba(METAL.dark, 0.85)}
            strokeWidth={2}
          />
          <Circle x={q.x} y={q.y} radius={SCREW_R_MM} fill={METAL.dark} />
        </Group>
      ))}
    </Group>
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

  const vigStrong = rgba(felt.vignette, VIGNETTE_ALPHA)
  const vigClear = rgba(felt.vignette, 0)

  return (
    // listening=false: the table must never steal a pointer event from a ball
    <Group listening={false}>
      {/* 1. wooden body */}
      <Rect
        x={g.outerX}
        y={g.outerY}
        width={g.outerWidthMm}
        height={g.outerHeightMm}
        cornerRadius={TABLE_CORNER_RADIUS_MM}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: g.outerWidthMm, y: g.outerHeightMm }}
        fillLinearGradientColorStops={[0, WOOD.frameHighlight, 0.5, WOOD.frame, 1, WOOD.light]}
        stroke={WOOD.frameHighlight}
        strokeWidth={3}
        shadowColor="rgba(0,0,0,0.45)"
        shadowBlur={BODY_SHADOW_BLUR_MM}
        shadowOffsetY={BODY_SHADOW_OFFSET_MM}
      />

      {/* 2. the rail proper, darker than the lip left showing around it */}
      <Rect
        x={g.outerX + FRAME_LIP_MM}
        y={g.outerY + FRAME_LIP_MM}
        width={g.outerWidthMm - 2 * FRAME_LIP_MM}
        height={g.outerHeightMm - 2 * FRAME_LIP_MM}
        cornerRadius={TABLE_CORNER_RADIUS_MM - FRAME_LIP_MM}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: 0, y: g.outerHeightMm - 2 * FRAME_LIP_MM }}
        fillLinearGradientColorStops={[0, WOOD.light, 0.55, WOOD.mid, 1, WOOD.dark]}
      />
      {/* seam where the wood meets the cloth; the cloth covers its inner half */}
      <Rect
        x={cx}
        y={cy}
        width={cw}
        height={ch}
        cornerRadius={CLOTH_CORNER_MM}
        stroke={WOOD.edgeShadow}
        strokeWidth={3}
      />

      {/* 3. diamond sights, inset into the rail */}
      {g.sights.map((s, i) => (
        <Circle
          key={i}
          x={s.x}
          y={s.y}
          radius={SIGHT_R_MM}
          fill={SIGHT}
          stroke={rgba(WOOD.edgeShadow, 0.55)}
          strokeWidth={SIGHT_RIM_MM}
          shadowColor={rgba(WOOD.edgeShadow, 0.6)}
          shadowBlur={6}
          shadowOffsetY={2}
        />
      ))}

      {/* 4. cloth */}
      <Rect
        x={cx}
        y={cy}
        width={cw}
        height={ch}
        cornerRadius={CLOTH_CORNER_MM}
        fillRadialGradientStartPoint={{ x: cw / 2, y: ch / 2 }}
        fillRadialGradientStartRadius={0}
        fillRadialGradientEndPoint={{ x: cw / 2, y: ch / 2 }}
        fillRadialGradientEndRadius={Math.hypot(cw, ch) / 2}
        fillRadialGradientColorStops={[0, felt.clothLight, 1, felt.clothDark]}
      />

      {/* 5. vignette: four bands fading inwards from each edge of the felt */}
      <Rect
        x={cx}
        y={cy}
        width={cw}
        height={VIGNETTE_MM}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: 0, y: VIGNETTE_MM }}
        fillLinearGradientColorStops={[0, vigStrong, 1, vigClear]}
      />
      <Rect
        x={cx}
        y={cy + ch - VIGNETTE_MM}
        width={cw}
        height={VIGNETTE_MM}
        fillLinearGradientStartPoint={{ x: 0, y: VIGNETTE_MM }}
        fillLinearGradientEndPoint={{ x: 0, y: 0 }}
        fillLinearGradientColorStops={[0, vigStrong, 1, vigClear]}
      />
      <Rect
        x={cx}
        y={cy}
        width={VIGNETTE_MM}
        height={ch}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: VIGNETTE_MM, y: 0 }}
        fillLinearGradientColorStops={[0, vigStrong, 1, vigClear]}
      />
      <Rect
        x={cx + cw - VIGNETTE_MM}
        y={cy}
        width={VIGNETTE_MM}
        height={ch}
        fillLinearGradientStartPoint={{ x: VIGNETTE_MM, y: 0 }}
        fillLinearGradientEndPoint={{ x: 0, y: 0 }}
        fillLinearGradientColorStops={[0, vigStrong, 1, vigClear]}
      />

      {/* 6. house line, quarter / half / three-quarter lines and the spots */}
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

      {/* 7. pocket throats - they legitimately straddle cloth and wood */}
      {g.pockets.map((p) => Throat(p))}

      {/* 8. cushions, with a lit nose edge */}
      {g.cushions.map((poly, i) => (
        <Group key={i}>
          <Line
            points={poly}
            closed
            fill={felt.cushion}
            stroke={felt.cushionShade}
            strokeWidth={3}
            lineJoin="round"
          />
          {/* points 0..1 are the nose line on the play-field boundary */}
          <Line
            points={[poly[0], poly[1], poly[2], poly[3]]}
            stroke="rgba(255,255,255,0.12)"
            strokeWidth={5}
            lineCap="round"
          />
        </Group>
      ))}

      {/* 9. brass castings, on the wood and clear of the cloth */}
      {g.pockets.map((p) => (p.kind === 'corner' ? CornerCasting(p) : MiddleCasting(p)))}
    </Group>
  )
}
