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

export type BallShapeProps = {
  item: BallItem
  /** ball diameter in mm, from scene.table.ballMm */
  ballMm: number
  selected: boolean
  draggable: boolean
  onSelect: (e: KonvaEventObject<MouseEvent | TouchEvent>) => void
  onDragStart: (e: KonvaEventObject<DragEvent>) => void
  onDragMove: (e: KonvaEventObject<DragEvent>) => void
  onDragEnd: (e: KonvaEventObject<DragEvent>) => void
}

const FONT_STACK = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

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
  const { item, ballMm, selected, draggable, onSelect, onDragStart, onDragMove, onDragEnd } = props

  const r = ballMm / 2
  const pal = BALL[item.kind]

  // Light comes from the upper left, so the gradient starts as a small bright
  // spot there and runs into the shade colour past the lower-right rim.
  const bodyStops = [
    0,
    mix(pal.base, '#FFFFFF', 0.62),
    0.35,
    pal.base,
    0.8,
    mix(pal.base, pal.shade, 0.7),
    1,
    pal.shade,
  ]

  // Alpha is all but gone well before the rim, so the shadow reads as contact
  // softness rather than a disc - the gradient is circular while the shape is
  // an ellipse, and the vertical rim sits at ~0.7 of the gradient radius.
  const shadowStops = [
    0,
    'rgba(0,0,0,0.38)',
    0.45,
    'rgba(0,0,0,0.2)',
    0.72,
    'rgba(0,0,0,0.05)',
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
      <Ellipse
        x={r * 0.18}
        y={r * 0.3}
        radiusX={r * 1.02}
        radiusY={r * 0.72}
        fillRadialGradientStartPoint={{ x: 0, y: 0 }}
        fillRadialGradientStartRadius={0}
        fillRadialGradientEndPoint={{ x: 0, y: 0 }}
        fillRadialGradientEndRadius={r * 1.02}
        fillRadialGradientColorStops={shadowStops}
        listening={false}
      />

      {/* the hit target. Konva reports the hit SHAPE as event.target, never the
          group, so the body carries the item id too - the parent reads it back
          with e.target.id() on both select and drag. */}
      <Circle
        id={item.id}
        radius={r}
        fillRadialGradientStartPoint={{ x: -r * 0.34, y: -r * 0.38 }}
        fillRadialGradientStartRadius={r * 0.08}
        fillRadialGradientEndPoint={{ x: r * 0.1, y: r * 0.14 }}
        fillRadialGradientEndRadius={r * 1.22}
        fillRadialGradientColorStops={bodyStops}
        shadowColor={SELECTION}
        shadowBlur={28}
        shadowOpacity={0.55}
        shadowEnabled={selected}
      />

      {/* rim kept on its own shape: Konva has no strokeOpacity, and fading the
          body would fade its fill too */}
      <Circle radius={r} stroke={pal.rim} strokeWidth={1.2} opacity={0.45} listening={false} />

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
          fontFamily={FONT_STACK}
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
