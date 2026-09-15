/**
 * One ball, drawn in table millimetres.
 *
 * Presentational only: it never reads or writes the store, the parent owns
 * hit-testing, selection and dragging and passes the handlers in. Every number
 * below is in millimetres because the hosting Layer carries the mm->px scale.
 */

import { Circle, Ellipse, Group, Text } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { BallItem } from '../model/types'
import { BALL, SELECTION } from '../model/theme'
import { CANVAS_FONT } from '../model/fonts'

export type BallShapeProps = {
  item: BallItem
  /** ball diameter in mm, from scene.table.ballMm */
  ballMm: number
  selected: boolean
  draggable: boolean
  /** px per mm; lets the grab area stay at least 44 screen px across */
  scale?: number
  onSelect: (e: KonvaEventObject<MouseEvent | TouchEvent>) => void
  onDragStart: (e: KonvaEventObject<DragEvent>) => void
  onDragMove: (e: KonvaEventObject<DragEvent>) => void
  onDragEnd: (e: KonvaEventObject<DragEvent>) => void
}

const hex = (c: string): [number, number, number] => [
  parseInt(c.slice(1, 3), 16),
  parseInt(c.slice(3, 5), 16),
  parseInt(c.slice(5, 7), 16),
]

/** blend two #rrggbb colours, t=0 keeps `a`, t=1 keeps `b` */
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hex(a)
  const [br, bg, bb] = hex(b)
  const ch = (x: number, y: number) => Math.round(x + (y - x) * t)
  return `rgb(${ch(ar, br)},${ch(ag, bg)},${ch(ab, bb)})`
}

export function BallShape(props: BallShapeProps) {
  const { item, ballMm, selected, draggable, scale, onSelect, onDragStart, onDragMove, onDragEnd } = props

  const r = ballMm / 2
  // on a phone a ball is ten pixels across; a finger is forty
  const grabR = scale ? Math.max(r, 22 / scale) : r
  const pal = BALL[item.kind]

  // Light comes from the upper left. The shading is deliberately shallow: the
  // rim may only be ~20% darker than the middle, because anything stronger eats
  // the outer edge of the ball and a 67 mm ball starts reading as 55 mm on the
  // exported picture. The ball stays at its base colour out to 0.82 of the
  // gradient and only turns over after that.
  const bodyStops = [
    0,
    mix(pal.base, '#FFFFFF', 0.45),
    0.34,
    pal.base,
    0.82,
    pal.base,
    1,
    mix(pal.base, pal.shade, 0.45),
  ]

  // The contact shadow is offset down-right and kept small enough that it never
  // closes into a ring round the ball: a ring is exactly what made the ball look
  // smaller than it is.
  const shadowStops = [
    0,
    'rgba(0,0,0,0.34)',
    0.55,
    'rgba(0,0,0,0.14)',
    1,
    'rgba(0,0,0,0)',
  ]

  return (
    <Group
      id={item.id}
      name="ball"
      x={item.x}
      y={item.y}
      draggable={draggable}
      onMouseDown={onSelect}
      onTouchStart={onSelect}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
    >
      <Circle radius={grabR} fill="rgba(0,0,0,0)" />
      <Ellipse
        x={r * 0.3}
        y={r * 0.38}
        radiusX={r * 0.94}
        radiusY={r * 0.68}
        fillRadialGradientStartPoint={{ x: 0, y: 0 }}
        fillRadialGradientStartRadius={0}
        fillRadialGradientEndPoint={{ x: 0, y: 0 }}
        fillRadialGradientEndRadius={r * 0.94}
        fillRadialGradientColorStops={shadowStops}
        listening={false}
      />

      {/* the hit target. Konva reports the hit SHAPE as event.target, never the
          group, so the body carries the item id too - the parent reads it back
          with e.target.id() on both select and drag. */}
      <Circle
        id={item.id}
        radius={r}
        fillRadialGradientStartPoint={{ x: -r * 0.2, y: -r * 0.22 }}
        fillRadialGradientStartRadius={r * 0.06}
        fillRadialGradientEndPoint={{ x: r * 0.04, y: r * 0.06 }}
        fillRadialGradientEndRadius={r * 1.06}
        fillRadialGradientColorStops={bodyStops}
        shadowColor={SELECTION}
        shadowBlur={28}
        shadowOpacity={0.55}
        shadowEnabled={selected}
      />

      {/* A thin rim, so the ball keeps its edge against both pale cloth and the
          dark of a pocket. Kept on its own shape: Konva has no strokeOpacity and
          fading the body would fade its fill too. */}
      <Circle radius={r} stroke={pal.rim} strokeWidth={1.6} opacity={0.5} listening={false} />

      <Ellipse
        x={-r * 0.36}
        y={-r * 0.42}
        radiusX={r * 0.3}
        radiusY={r * 0.2}
        rotation={-28}
        fillRadialGradientStartPoint={{ x: 0, y: 0 }}
        fillRadialGradientStartRadius={0}
        fillRadialGradientEndPoint={{ x: 0, y: 0 }}
        fillRadialGradientEndRadius={r * 0.3}
        fillRadialGradientColorStops={[
          0,
          'rgba(255,255,255,0.85)',
          0.4,
          'rgba(255,255,255,0.45)',
          0.7,
          'rgba(255,255,255,0.08)',
          1,
          'rgba(255,255,255,0)',
        ]}
        listening={false}
      />

      {item.label ? (
        <Text
          text={item.label}
          width={2 * r}
          height={2 * r}
          offsetX={r}
          offsetY={r}
          align="center"
          verticalAlign="middle"
          fontSize={r * 0.95}
          fontStyle="bold"
          fontFamily={CANVAS_FONT}
          fill={pal.text}
          listening={false}
        />
      ) : null}

      {selected ? (
        <Circle radius={r + 9} stroke={SELECTION} strokeWidth={5} dash={[22, 14]} listening={false} />
      ) : null}
    </Group>
  )
}
