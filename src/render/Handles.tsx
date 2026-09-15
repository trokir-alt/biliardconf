/**
 * The grab points of the selected object: ends and the bend point of an arrow,
 * corners of a zone, the rotation lever of a caption.
 *
 * They are sized in screen pixels, not millimetres: a handle has to be the
 * same size under a finger whether the table is filling a monitor or a phone.
 */

import { Circle, Group, Line } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Item } from '../model/types'
import { itemHandles } from '../model/item'
import type { Handle } from '../model/item'
import { SELECTION } from '../model/theme'

export type HandlesProps = {
  item: Item
  /** px per mm of the hosting layer */
  scale: number
  onDragStart: (h: Handle, e: KonvaEventObject<DragEvent>) => void
  onDragMove: (h: Handle, e: KonvaEventObject<DragEvent>) => void
  onDragEnd: (h: Handle, e: KonvaEventObject<DragEvent>) => void
}

const HANDLE_PX = 9

export function Handles({ item, scale, onDragStart, onDragMove, onDragEnd }: HandlesProps) {
  const handles = itemHandles(item)
  if (handles.length === 0) return null
  const r = HANDLE_PX / scale
  const stroke = 2 / scale
  return (
    <Group>
      {item.type === 'text' && (
        // the lever from the caption to its rotation handle
        <Line
          points={[item.x, item.y, handles[0].at.x, handles[0].at.y]}
          stroke={SELECTION}
          strokeWidth={stroke}
          dash={[6 / scale, 5 / scale]}
          listening={false}
        />
      )}
      {handles.map((h) => (
        <Circle
          key={h.id}
          name="handle"
          x={h.at.x}
          y={h.at.y}
          radius={h.kind === 'bend' ? r * 0.85 : r}
          fill={h.kind === 'bend' ? SELECTION : '#FFFFFF'}
          stroke={h.kind === 'bend' ? '#FFFFFF' : SELECTION}
          strokeWidth={stroke}
          hitStrokeWidth={r * 2}
          draggable
          onDragStart={(e) => onDragStart(h, e)}
          onDragMove={(e) => onDragMove(h, e)}
          onDragEnd={(e) => onDragEnd(h, e)}
          onMouseDown={(e) => {
            e.cancelBubble = true
          }}
          onTouchStart={(e) => {
            e.cancelBubble = true
          }}
        />
      ))}
    </Group>
  )
}
