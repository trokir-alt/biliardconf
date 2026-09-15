/**
 * The drawing objects of stage 2, all in table millimetres.
 *
 * Each is a pure presentational component: the parent owns selection, dragging
 * and history. Adding a stage 3 object means another component here and another
 * branch in ItemView.
 */

import { Circle, Ellipse, Group, Line as KLine, Rect, Shape, Text } from 'react-konva'
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
import { POWER_H, POWER_W, arrowCurve, formatPower, settleDot } from '../model/item'
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
}

/**
 * The cue ball from behind with the contact point on it. The dot is its own
 * draggable node: dragging it moves only the dot, and its drag events are
 * stopped here so the widget underneath does not also start moving.
 */
export function StrikePointShape({ item, scale, onDot, onDotStart }: StrikePointProps) {
  const r = item.sizeMm / 2
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
  const ring = (k: number) => (
    <Circle key={k} radius={r * k} stroke="rgba(0,0,0,0.55)" strokeWidth={1.6} listening={false} />
  )
  return (
    <Group x={item.x} y={item.y}>
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

const SEG_W = 22
const SEG_H = 46
const SEG_GAP = 6

export type PowerProps = {
  item: PowerItem
  selected: boolean
  onValue: (value: (typeof POWER_VALUES)[number]) => void
  onStep: (steps: number) => void
}

/**
 * The strength plate. Nine segments, no colour semantics - it is the coach's
 * scale, not ours - and the value written the way a coach writes it, "2,5".
 */
export function PowerShape({ item, selected, onValue, onStep }: PowerProps) {
  const w = POWER_W
  const h = POWER_H
  const segsW = POWER_VALUES.length * SEG_W + (POWER_VALUES.length - 1) * SEG_GAP
  // label | nine segments | value, laid out so "2,5" never wraps
  const segX0 = -w / 2 + 74
  const valX = segX0 + segsW + 8
  const valW = w / 2 - valX - 12
  const stop = (e: KonvaEventObject<Event>) => {
    e.cancelBubble = true
  }
  const btn = (sign: -1 | 1) => (
    <Group
      x={sign * (w / 2 + 40)}
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
      <Circle radius={26} fill="rgba(20,25,32,0.9)" stroke={ORANGE} strokeWidth={2} />
      <Text
        text={sign > 0 ? '+' : '−'}
        fontSize={34}
        fontFamily={CANVAS_FONT}
        fontStyle="bold"
        fill="#FFFFFF"
        width={52}
        height={52}
        offsetX={26}
        offsetY={26}
        align="center"
        verticalAlign="middle"
        listening={false}
      />
    </Group>
  )
  return (
    <Group x={item.x} y={item.y}>
      <Rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        cornerRadius={22}
        fill="rgba(20,25,32,0.78)"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth={1.5}
      />
      <Text
        x={-w / 2 + 18}
        y={-h / 2}
        height={h}
        verticalAlign="middle"
        text="Сила"
        fontSize={22}
        fontFamily={CANVAS_FONT}
        fill="#C8D0D8"
        listening={false}
      />
      {POWER_VALUES.map((v, i) => (
        <Rect
          key={v}
          x={segX0 + i * (SEG_W + SEG_GAP)}
          y={-SEG_H / 2}
          width={SEG_W}
          height={SEG_H}
          cornerRadius={4}
          fill={item.value >= v ? ORANGE : 'rgba(0,0,0,0)'}
          stroke={item.value >= v ? ORANGE : 'rgba(255,255,255,0.55)'}
          strokeWidth={2}
          hitStrokeWidth={SEG_GAP}
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
      <Text
        x={valX}
        y={-h / 2}
        width={valW}
        height={h}
        align="right"
        verticalAlign="middle"
        wrap="none"
        text={formatPower(item.value)}
        fontSize={40}
        fontFamily={CANVAS_FONT}
        fontStyle="bold"
        fill="#FFFFFF"
        listening={false}
      />
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
