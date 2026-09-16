/**
 * The drawing objects of stage 2, all in table millimetres.
 *
 * Each is a pure presentational component: the parent owns selection, dragging
 * and history. Adding a stage 3 object means another component here and another
 * branch in ItemView.
 */

import { Circle, Ellipse, Group, Image as KImage, Line as KLine, Rect, Shape, Text } from 'react-konva'
import type { Context } from 'konva/lib/Context'
import type { Shape as KonvaShape } from 'konva/lib/Shape'
import type { KonvaEventObject } from 'konva/lib/Node'
import type {
  ArrowItem,
  GhostBallItem,
  GhostTrailItem,
  LineItem,
  PowerItem,
  StrikePointItem,
  TextItem,
  Vec,
  ZoneItem,
} from '../model/types'
import { POWER_VALUES } from '../model/types'
import { arrowCurve, powerButtonReach, powerSize, settleCompanionAngle, settleDot } from '../model/item'
import { BRAND, POWER_ARTBOARD, POWER_SVGS } from '../brand/assets'
import { svgImage, useSvgImages } from '../brand/svgImage'
import { CANVAS_FONT } from '../model/fonts'
import { BALL } from '../model/theme'

/** dashes scale with the stroke, so a thin dashed line never looks like a rash */
const dashFor = (w: number, style: string): number[] | undefined =>
  style === 'dashed' ? [w * 2.2, w * 1.7] : undefined

/** anything thinner than this is miserable to grab on a tablet */
const hitWidth = (w: number) => Math.max(w * 2, 60)

/** an arrowhead as a filled triangle pointing along `dir` */
function head(ctx: Context, tip: Vec, dir: Vec, w: number): void {
  const len = Math.hypot(dir.x, dir.y) || 1
  const ux = dir.x / len
  const uy = dir.y / len
  const back = w * 2.6
  const half = w * 1.5
  ctx.moveTo(tip.x, tip.y)
  ctx.lineTo(tip.x - ux * back + -uy * half, tip.y - uy * back + ux * half)
  ctx.lineTo(tip.x - ux * back - -uy * half, tip.y - uy * back - ux * half)
  ctx.closePath()
}

export function ArrowShape({ item }: { item: ArrowItem }) {
  const { a, c, b } = arrowCurve(item.points)
  // tangents of the quadratic at its ends; for a straight arrow that is the chord
  const dirEnd = c ? { x: b.x - c.x, y: b.y - c.y } : { x: b.x - a.x, y: b.y - a.y }
  const dirStart = c ? { x: a.x - c.x, y: a.y - c.y } : { x: a.x - b.x, y: a.y - b.y }
  return (
    <Group>
      <Shape
        sceneFunc={(ctx: Context, shape: KonvaShape) => {
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          if (c) ctx.quadraticCurveTo(c.x, c.y, b.x, b.y)
          else ctx.lineTo(b.x, b.y)
          ctx.strokeShape(shape)
        }}
        stroke={item.color}
        strokeWidth={item.width}
        dash={dashFor(item.width, item.style)}
        lineCap="round"
        lineJoin="round"
        hitStrokeWidth={hitWidth(item.width)}
      />
      {item.head !== 'none' && (
        <Shape
          sceneFunc={(ctx: Context, shape: KonvaShape) => {
            ctx.beginPath()
            head(ctx, b, dirEnd, item.width)
            if (item.head === 'both') head(ctx, a, dirStart, item.width)
            ctx.fillShape(shape)
          }}
          fill={item.color}
          listening={false}
        />
      )}
    </Group>
  )
}

export function LineShape({ item }: { item: LineItem }) {
  return (
    <KLine
      points={[item.from.x, item.from.y, item.to.x, item.to.y]}
      stroke={item.color}
      strokeWidth={item.width}
      dash={dashFor(item.width, item.style)}
      lineCap="round"
      hitStrokeWidth={hitWidth(item.width)}
    />
  )
}

/**
 * The ghost trail: the element that actually makes a diagram readable.
 *
 * The ghosts are real balls, at the table's own ball diameter - decorative
 * circles of some other size would quietly lie about whether a shot fits.
 */
export function GhostTrailShape({ item, ballMm }: { item: GhostTrailItem; ballMm: number }) {
  const n = Math.max(2, item.count)
  const dx = item.to.x - item.from.x
  const dy = item.to.y - item.from.y
  const r = ballMm / 2
  const ghosts = Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1)
    return {
      x: item.from.x + dx * t,
      y: item.from.y + dy * t,
      // fades along the run, 0.75 down to 0.15
      o: 0.75 - (0.75 - 0.15) * t,
    }
  })
  return (
    <Group>
      {/* the gaps between ghosts are most of the trail; without this a finger
          landing between two balls would grab nothing */}
      <KLine
        points={[item.from.x, item.from.y, item.to.x, item.to.y]}
        stroke="rgba(0,0,0,0)"
        strokeWidth={1}
        hitStrokeWidth={ballMm}
      />
      {ghosts.map((g, i) => (
        <Circle
          key={i}
          x={g.x}
          y={g.y}
          radius={r}
          fill={item.color}
          opacity={g.o}
          stroke={item.color}
          strokeWidth={1.5}
          hitStrokeWidth={0}
        />
      ))}
      {item.head && (
        <Shape
          sceneFunc={(ctx: Context, shape: KonvaShape) => {
            ctx.beginPath()
            head(ctx, item.to, { x: dx, y: dy }, r * 0.55)
            ctx.fillShape(shape)
          }}
          fill={item.color}
          opacity={0.85}
          listening={false}
        />
      )}
    </Group>
  )
}

export function ZoneShape({ item }: { item: ZoneItem }) {
  const common = {
    fill: item.color,
    opacity: item.opacity,
    stroke: item.color,
    strokeWidth: 5,
  }
  if (item.shape === 'ellipse') {
    return (
      <Ellipse
        x={item.x + item.w / 2}
        y={item.y + item.h / 2}
        radiusX={Math.max(item.w / 2, 1)}
        radiusY={Math.max(item.h / 2, 1)}
        {...common}
      />
    )
  }
  return <Rect x={item.x} y={item.y} width={item.w} height={item.h} cornerRadius={12} {...common} />
}

/**
 * Text on the cloth. The dark halo is not decoration: a caption has to survive
 * landing on a pale ball or on the bright middle of the bed.
 */
export function TextShape({ item }: { item: TextItem }) {
  return (
    <Text
      x={item.x}
      y={item.y}
      text={item.text}
      fontSize={item.size}
      fontFamily={CANVAS_FONT}
      fontStyle="bold"
      fill={item.color}
      rotation={item.angle}
      offsetY={item.size / 2}
      shadowColor="rgba(0,0,0,0.55)"
      shadowBlur={item.size * 0.22}
      shadowForStrokeEnabled={false}
    />
  )
}

/* ---------------------------------------------------------------- stage 3 */

const ORANGE = '#F5A623'
const DOT_RED = '#E5322D'

export type StrikePointProps = {
  item: StrikePointItem
  /** px per mm, so the dot's grab area can be sized in screen pixels */
  scale: number
  /** live while dragging, final on release */
  onDot: (dot: { u: number; v: number }, final: boolean) => void
  onDotStart: () => void
  /** the swing of the second ball, in degrees; final on release */
  onCompanion: (angleDeg: number, final: boolean) => void
  onCompanionStart: () => void
  /** whether the angle settles onto the 15-degree grid */
  magnet: boolean
}

/**
 * The cue ball from behind with the contact point on it. The dot is its own
 * draggable node: dragging it moves only the dot, and its drag events are
 * stopped here so the widget underneath does not also start moving.
 */
export function StrikePointShape({ item, scale, onDot, onDotStart, onCompanion, onCompanionStart, magnet }: StrikePointProps) {
  const r = item.sizeMm / 2
  const angle = (item.companion ? item.companion.angleDeg : 0) * (Math.PI / 180)
  // the second ball's centre in the host's own frame: one diameter out, so the
  // two rims meet exactly, whatever the size
  const cc = { x: 2 * r * Math.cos(angle), y: 2 * r * Math.sin(angle) }
  const dotR = item.sizeMm / 16
  // a grab area of at least 44 screen px, however small the dot is drawn
  const grabR = Math.max(dotR, 22 / Math.max(scale, 1e-6))
  const stop = (e: KonvaEventObject<Event>) => {
    e.cancelBubble = true
  }
  const move = (e: KonvaEventObject<DragEvent>, final: boolean) => {
    e.cancelBubble = true
    const node = e.target
    const dot = settleDot({ x: node.x(), y: node.y() }, r)
    node.position({ x: dot.u * r, y: dot.v * r })
    onDot(dot, final)
  }
  const swing = (e: KonvaEventObject<DragEvent>, final: boolean) => {
    e.cancelBubble = true
    const node = e.target
    const deg = (Math.atan2(node.y(), node.x()) * 180) / Math.PI
    const settled = settleCompanionAngle(deg, magnet)
    const a = settled * (Math.PI / 180)
    // straight back onto its circle, so the magnet is visible while swinging
    // rather than only on release
    node.position({ x: 2 * r * Math.cos(a), y: 2 * r * Math.sin(a) })
    onCompanion(settled, final)
  }
  const ring = (k: number) => (
    <Circle key={k} radius={r * k} stroke="rgba(0,0,0,0.55)" strokeWidth={1.6} listening={false} />
  )
  return (
    <Group x={item.x} y={item.y}>
      {/* Both shadows go down before either body: a shadow drawn after the
          white ball would smear grey across it. The second ball's shadow also
          leans OUTWARD along the bearing, so the seam where the two rims meet -
          the one line in this picture that carries the physics - stays clean
          whichever side the ball is on. */}
      {item.companion && (
        <Ellipse
          x={cc.x + r * 0.3 + r * 0.28 * Math.cos(angle)}
          y={cc.y + r * 0.38 + r * 0.28 * Math.sin(angle)}
          radiusX={r * 0.94}
          radiusY={r * 0.68}
          fillRadialGradientStartPoint={{ x: 0, y: 0 }}
          fillRadialGradientStartRadius={0}
          fillRadialGradientEndPoint={{ x: 0, y: 0 }}
          fillRadialGradientEndRadius={r * 0.94}
          fillRadialGradientColorStops={[0, 'rgba(0,0,0,0.34)', 0.55, 'rgba(0,0,0,0.14)', 1, 'rgba(0,0,0,0)']}
          listening={false}
        />
      )}
      {/* the same soft contact shadow a ball has */}
      <Ellipse
        x={r * 0.3}
        y={r * 0.38}
        radiusX={r * 0.94}
        radiusY={r * 0.68}
        fillRadialGradientStartPoint={{ x: 0, y: 0 }}
        fillRadialGradientStartRadius={0}
        fillRadialGradientEndPoint={{ x: 0, y: 0 }}
        fillRadialGradientEndRadius={r * 0.94}
        fillRadialGradientColorStops={[0, 'rgba(0,0,0,0.34)', 0.55, 'rgba(0,0,0,0.14)', 1, 'rgba(0,0,0,0)']}
        listening={false}
      />
      {/* The object ball: flat white and bare, with no rings, no dot and no
          modelling. Shaded like the host it would read as a second cue ball and
          the point - this is the ball being HIT, not the one being struck -
          would be lost. It is drawn before the host, so the host's own rim
          draws the seam as one line. Dragging it swings it; it cannot come
          off, and it cannot end up a hair short of contact. */}
      {item.companion && (
        <Group
          name="companion"
          x={cc.x}
          y={cc.y}
          draggable
          onMouseDown={stop}
          onTouchStart={stop}
          onDragStart={(e) => {
            e.cancelBubble = true
            onCompanionStart()
          }}
          onDragMove={(e) => swing(e, false)}
          onDragEnd={(e) => swing(e, true)}
        >
          <Circle radius={r} fill={BALL.white.base} stroke="rgba(0,0,0,0.6)" strokeWidth={2} />
        </Group>
      )}
      <Circle
        radius={r}
        fillRadialGradientStartPoint={{ x: -r * 0.2, y: -r * 0.22 }}
        fillRadialGradientStartRadius={r * 0.06}
        fillRadialGradientEndPoint={{ x: 0, y: 0 }}
        fillRadialGradientEndRadius={r * 1.06}
        fillRadialGradientColorStops={[0, '#FFD98A', 0.4, BALL.cue.base, 1, BALL.cue.shade]}
        stroke="rgba(0,0,0,0.6)"
        strokeWidth={2}
      />
      {[0.25, 0.5, 0.75].map(ring)}
      <KLine points={[-r, 0, r, 0]} stroke="rgba(0,0,0,0.55)" strokeWidth={1.6} listening={false} />
      <KLine points={[0, -r, 0, r]} stroke="rgba(0,0,0,0.55)" strokeWidth={1.6} listening={false} />
      <Group
        name="dot"
        x={item.dot.u * r}
        y={item.dot.v * r}
        draggable
        onMouseDown={stop}
        onTouchStart={stop}
        onDragStart={(e) => {
          e.cancelBubble = true
          onDotStart()
        }}
        onDragMove={(e) => move(e, false)}
        onDragEnd={(e) => move(e, true)}
      >
        <Circle radius={grabR} fill="rgba(0,0,0,0)" />
        <Circle radius={dotR} fill={DOT_RED} stroke="#FFFFFF" strokeWidth={Math.max(1.2, dotR * 0.14)} listening={false} />
      </Group>
    </Group>
  )
}

/**
 * The designer's segment geometry, in artboard units: nine boxes at
 * x = 12 + 13i, y = 56, 10 wide. Only the tap targets are rebuilt here - the
 * picture itself is the SVG the package ships.
 */
const SEG_X0 = 12
const SEG_PITCH = 13
const SEG_W = 10
/** the band the segments live in; the digits sit above it and stay tappable
    only as "select the plate", not as "set a value" */
const SEG_BAND_TOP = 48
const SEG_BAND_BOTTOM = 88

export type PowerProps = {
  item: PowerItem
  selected: boolean
  onValue: (value: (typeof POWER_VALUES)[number]) => void
  onStep: (steps: number) => void
}

/**
 * The strength indicator: the designer's own artboard, drawn as an image.
 *
 * Nine states ship as nine SVG documents, so the picture is never redrawn by
 * hand here - `2 * value` filled segments and the digits with a comma are
 * baked into the asset. What this component adds is the things an asset
 * cannot carry: the tap targets over the segments and the +/- buttons that
 * appear when the plate is selected.
 */
export function PowerShape({ item, selected, onValue, onStep }: PowerProps) {
  useSvgImages() // re-render once the SVGs have decoded
  const { w, h } = powerSize(item)
  const sx = w / POWER_ARTBOARD.w
  const sy = h / POWER_ARTBOARD.h
  const img = svgImage(POWER_SVGS[POWER_VALUES.indexOf(item.value)] ?? POWER_SVGS[4])
  const reach = powerButtonReach(w)
  const btnR = reach * 0.4
  const stop = (e: KonvaEventObject<Event>) => {
    e.cancelBubble = true
  }
  const btn = (sign: -1 | 1) => (
    <Group
      x={sign * (w / 2 + reach * 0.6)}
      y={0}
      onClick={(e) => {
        stop(e)
        onStep(sign)
      }}
      onTap={(e) => {
        stop(e)
        onStep(sign)
      }}
    >
      <Circle radius={btnR} fill={BRAND.navy} stroke="rgba(255,255,255,0.7)" strokeWidth={btnR * 0.07} />
      <Text
        text={sign > 0 ? '+' : '−'}
        fontSize={btnR * 1.3}
        fontFamily={CANVAS_FONT}
        fontStyle="bold"
        fill="#FFFFFF"
        width={btnR * 2}
        height={btnR * 2}
        offsetX={btnR}
        offsetY={btnR}
        align="center"
        verticalAlign="middle"
        listening={false}
      />
    </Group>
  )
  return (
    <Group x={item.x} y={item.y}>
      {img && <KImage image={img} x={-w / 2} y={-h / 2} width={w} height={h} />}
      {/* the plate is one flat picture, so the segments get their own
          invisible targets, one pitch wide so a finger has something to hit */}
      {POWER_VALUES.map((v, i) => (
        <Rect
          key={v}
          x={-w / 2 + (SEG_X0 + i * SEG_PITCH - (SEG_PITCH - SEG_W) / 2) * sx}
          y={-h / 2 + SEG_BAND_TOP * sy}
          width={SEG_PITCH * sx}
          height={(SEG_BAND_BOTTOM - SEG_BAND_TOP) * sy}
          fill="rgba(0,0,0,0)"
          onClick={(e) => {
            stop(e)
            onValue(v)
          }}
          onTap={(e) => {
            stop(e)
            onValue(v)
          }}
        />
      ))}
      {selected && btn(-1)}
      {selected && btn(1)}
    </Group>
  )
}

/**
 * The wireframe ball: where a ball should be at the moment of contact. Drawn
 * at the table's own ball diameter, because the point of it is that the
 * distance between two centres is exactly one diameter.
 */
export function GhostBallShape({ item, ballMm }: { item: GhostBallItem; ballMm: number }) {
  const r = ballMm / 2
  return (
    <Group x={item.x} y={item.y}>
      {/* a faint fill is the grab area; the wire alone is too thin for a finger */}
      <Circle radius={r} fill="rgba(245,166,35,0.12)" stroke={ORANGE} strokeWidth={4} />
      <Ellipse radiusX={r} radiusY={r * 0.42} stroke={ORANGE} strokeWidth={2.2} opacity={0.9} listening={false} />
      <Ellipse radiusX={r * 0.42} radiusY={r} stroke={ORANGE} strokeWidth={2.2} opacity={0.9} listening={false} />
      <KLine points={[-r * 0.2, 0, r * 0.2, 0]} stroke={ORANGE} strokeWidth={2.2} listening={false} />
      <KLine points={[0, -r * 0.2, 0, r * 0.2]} stroke={ORANGE} strokeWidth={2.2} listening={false} />
    </Group>
  )
}
