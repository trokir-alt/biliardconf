/**
 * Dispatches one scene item to its renderer.
 *
 * This is the only place that has to grow when stages 2-4 add arrows, ghost
 * trails, zones, lines, text and the strike widget: add a branch here and a
 * component next to BallShape. Nothing else in the render path changes.
 */

import type { KonvaEventObject } from 'konva/lib/Node'
import type { Item } from '../model/types'
import { BallShape } from './BallShape'

export type ItemViewProps = {
  item: Item
  ballMm: number
  selected: boolean
  draggable: boolean
  onSelect: (e: KonvaEventObject<MouseEvent | TouchEvent>) => void
  onDragStart: (e: KonvaEventObject<DragEvent>) => void
  onDragMove: (e: KonvaEventObject<DragEvent>) => void
  onDragEnd: (e: KonvaEventObject<DragEvent>) => void
}

export function ItemView({ item, ...rest }: ItemViewProps) {
  switch (item.type) {
    case 'ball':
      return <BallShape item={item} {...rest} />
    // stage 2: 'arrow' | 'ghostTrail' | 'zone' | 'line' | 'text'
    // stage 3: 'strike'
    default:
      return null
  }
}
