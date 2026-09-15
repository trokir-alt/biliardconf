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
import type {
  ArrowItem,
  GhostTrailItem,
  LineItem,
  TextItem,
  Vec,
  ZoneItem,
} from '../model/types'
import { arrowCurve } from '../model/item'
import { CANVAS_FONT } from '../model/fonts'

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
