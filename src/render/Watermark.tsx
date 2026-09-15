/**
 * The coach's name, twice: big and faint along the diagonal of the cloth, and
 * small and engraved on the wooden rail.
 *
 * It is not scene data and there is no switch for it. It is drawn on the
 * scene layer AFTER every object, so no zone, caption or ball can cover it,
 * and it goes into every export and clipboard copy because those read the
 * same layers. The rail plate sits where no object can be placed at all.
 */

import { Group, Text } from 'react-konva'
import type { TableGeometry } from '../model/table'
import { CUSHION_MM, RAIL_MM } from '../model/table'
import { WATERMARK_FONT } from '../model/fonts'
import { WATERMARK } from '../model/theme'
import { useStore } from '../state/store'

/**
 * Along the diagonal, reading from the lower left up to the upper right of
 * the screen: on the flat table that is the diagonal from (0, W) to (L, 0);
 * on the upright table the layer turns a quarter clockwise, so the same
 * screen reading takes the other diagonal, from (L, W) to (0, 0).
 */
function Diagonal({ g }: { g: TableGeometry }) {
  const upright = useStore((s) => s.orientation) === 'vertical'
  const L = g.lengthMm
  const W = g.widthMm
  const diag = Math.hypot(L, W)
  const tilt = (Math.atan2(W, L) * 180) / Math.PI // 26.6 degrees on a 2:1 table
  const rotation = upright ? tilt - 180 : -tilt
  return (
    <Group x={L / 2} y={W / 2} rotation={rotation} listening={false}>
      <Text
        name="watermark"
        x={-diag / 2}
        y={-WATERMARK.sizeMm / 2}
        width={diag}
        align="center"
        text={WATERMARK.text}
        fontFamily={WATERMARK_FONT}
        fontSize={WATERMARK.sizeMm}
        fontStyle="italic 800"
        letterSpacing={WATERMARK.letterSpacingMm}
        fill={WATERMARK.fill}
        opacity={WATERMARK.opacity}
        listening={false}
      />
    </Group>
  )
}

/** The maker's plate on the near long rail, between two sights. */
function RailPlate({ g }: { g: TableGeometry }) {
  const r = WATERMARK.rail
  const cx = g.lengthMm * r.at
  const cy = g.widthMm + CUSHION_MM + RAIL_MM / 2
  const w = g.lengthMm / 8 // one sight interval; the text is centred in it
  const text = (fill: string, dx: number, dy: number, name?: string) => (
    <Text
      name={name}
      x={cx - w / 2 + dx}
      y={cy - r.sizeMm / 2 + dy}
      width={w}
      align="center"
      text={WATERMARK.text}
      fontFamily={WATERMARK_FONT}
      fontSize={r.sizeMm}
      fontStyle="italic 800"
      letterSpacing={r.letterSpacingMm}
      fill={fill}
      listening={false}
    />
  )
  return (
    <Group listening={false}>
      {text(r.highlight, 1.4, 1.4)}
      {text(r.ink, 0, 0, 'watermark-rail')}
    </Group>
  )
}

export function Watermarks({ g }: { g: TableGeometry }) {
  return (
    <Group name="watermarks" listening={false}>
      <Diagonal g={g} />
      <RailPlate g={g} />
    </Group>
  )
}
