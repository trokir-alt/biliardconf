/**
 * Dispatches one scene item to its renderer.
 *
 * This is the only place that has to grow when a stage adds an object type:
 * add a branch here and a component next to the others. Every non-ball item
 * lives in a Group at (0,0) whose drag offset the parent reads as a delta and
 * folds back into the item's millimetres.
 */

import { Circle, Group } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Item } from '../model/types'
import { BallShape } from './BallShape'
import {
  ArrowShape,
  GhostBallShape,
  GhostTrailShape,
  LineShape,
  PowerShape,
  StrikePointShape,
  TextShape,
  ZoneShape,
} from './shapes'
import { useStore } from '../state/store'
import { useView } from '../state/view'

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

function inner(item: Item, ballMm: number, selected: boolean, scale: number) {
  const st = useStore.getState
  switch (item.type) {
    case 'strikePoint':
      return (
        <StrikePointShape
          item={item}
          scale={scale}
          magnet={st().snap}
          onDotStart={() => st().beginHistory()}
          onDot={(dot) => st().updateItemLive(item.id, { dot })}
          onCompanionStart={() => st().beginHistory()}
          onCompanion={(side, fullness) => st().updateItemLive(item.id, { companion: { side, fullness } })}
        />
      )
    case 'power':
      return (
        <PowerShape
          item={item}
          selected={selected}
          onValue={(value) => st().setPower(item.id, value)}
          onStep={(steps) => st().adjustPower(item.id, steps)}
        />
      )
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
    default:
      return null
  }
}

export function ItemView({ item, ballMm, onEdit, ...rest }: ItemViewProps) {
  const scale = useView((s) => s.layout?.scale ?? 0.3)
  if (item.type === 'ball') return <BallShape item={item} ballMm={ballMm} scale={scale} {...rest} />
  const { selected, ...handlers } = rest
  // the wireframe ball is positioned like a real ball, so the stage can clamp
  // and contact-snap it from the node's own coordinates
  if (item.type === 'ghostBall') {
    return (
      <Group
        id={item.id}
        name="ghostBall"
        x={item.x}
        y={item.y}
        draggable={handlers.draggable}
        onMouseDown={handlers.onSelect}
        onTouchStart={handlers.onSelect}
        onDragStart={handlers.onDragStart}
        onDragMove={handlers.onDragMove}
        onDragEnd={handlers.onDragEnd}
      >
        <Circle radius={Math.max(ballMm / 2, 22 / scale)} fill="rgba(0,0,0,0)" />
        <GhostBallShape item={{ ...item, x: 0, y: 0 }} ballMm={ballMm} />
        {selected && (
          <Circle radius={ballMm / 2 + 9} stroke="#FFD166" strokeWidth={5} dash={[22, 14]} listening={false} />
        )}
      </Group>
    )
  }
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
      {inner(item, ballMm, selected, scale)}
    </Group>
  )
}
