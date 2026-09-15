/**
 * Dispatches one scene item to its renderer.
 *
 * This is the only place that has to grow when a stage adds an object type:
 * add a branch here and a component next to the others. Every non-ball item
 * lives in a Group at (0,0) whose drag offset the parent reads as a delta and
 * folds back into the item's millimetres.
 */

import { Group } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Item } from '../model/types'
import { BallShape } from './BallShape'
import { ArrowShape, GhostTrailShape, LineShape, TextShape, ZoneShape } from './shapes'

export type ItemViewProps = {
  item: Item
  ballMm: number
  selected: boolean
  draggable: boolean
  onSelect: (e: KonvaEventObject<MouseEvent | TouchEvent>) => void
  onDragStart: (e: KonvaEventObject<DragEvent>) => void
  onDragMove: (e: KonvaEventObject<DragEvent>) => void
  onDragEnd: (e: KonvaEventObject<DragEvent>) => void
  onEdit?: (e: KonvaEventObject<MouseEvent | TouchEvent>) => void
}

function inner(item: Item, ballMm: number) {
  switch (item.type) {
    case 'arrow':
      return <ArrowShape item={item} />
    case 'ghostTrail':
      return <GhostTrailShape item={item} ballMm={ballMm} />
    case 'zone':
      return <ZoneShape item={item} />
    case 'line':
      return <LineShape item={item} />
    case 'text':
      return <TextShape item={item} />
    // stage 3: 'strike'
    default:
      return null
  }
}

export function ItemView({ item, ballMm, onEdit, ...rest }: ItemViewProps) {
  if (item.type === 'ball') return <BallShape item={item} ballMm={ballMm} {...rest} />
  const { selected: _selected, ...handlers } = rest
  return (
    <Group
      id={item.id}
      name={item.type}
      draggable={handlers.draggable}
      onMouseDown={handlers.onSelect}
      onTouchStart={handlers.onSelect}
      onDragStart={handlers.onDragStart}
      onDragMove={handlers.onDragMove}
      onDragEnd={handlers.onDragEnd}
      onDblClick={onEdit}
      onDblTap={onEdit}
    >
      {inner(item, ballMm)}
    </Group>
  )
}
