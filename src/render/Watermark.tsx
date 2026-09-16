/**
 * The distributed watermark: the coach's signature repeated across the cloth,
 * plus one on the wooden rail.
 *
 * Two things about it are deliberate and both differ from the package.
 *
 * It sits directly above the cloth and below every object. The package puts it
 * above the trajectories, and on a real export that erases them: a ghost trail
 * fades along its run, and its last two ghosts clear the cloth by 63 and 30
 * levels of red while the white mark adds 55 at 26 per cent. A mark laid over
 * them is the brighter of the two and wipes out the tail - which is the part
 * of the diagram that says where the ball ends up. Underneath, the same mark
 * reads just as well and is no easier to crop away.
 *
 * Density is a setting rather than a constant, because the right amount of it
 * depends on how busy the coach's own diagrams are. All three presets live in
 * src/brand/watermark.ts.
 *
 * It has its own Konva layer: it never changes while an object is dragged, so
 * it should not be repainted sixty times a second either.
 */

import { Group, Image as KImage } from 'react-konva'
import type { TableGeometry } from '../model/table'
import { CUSHION_MM, RAIL_MM } from '../model/table'
import { STAMP_SVG, WATERMARK_ARTBOARD } from '../brand/assets'
import { svgImage, useSvgImages } from '../brand/svgImage'
import { DENSITY, stampLayout, type Density } from '../brand/watermark'

/** height of the rail signature, in mm; the rail band itself is 125 mm */
const RAIL_STAMP_H = 62
/** where along the long rail it sits, as a fraction of the table length */
const RAIL_AT = 5.5 / 8
/** white on dark wood: present, not shouting */
const RAIL_OPACITY = 0.5

export function Watermark({ g, density }: { g: TableGeometry; density: Density }) {
  useSvgImages() // redraw once the SVG has decoded
  const img = svgImage(STAMP_SVG)
  if (!img) return null

  const preset = DENSITY[density]
  const stamps = stampLayout(density, g.lengthMm)

  // the rail copy: same artwork, scaled to the rail band
  const railScale = RAIL_STAMP_H / WATERMARK_ARTBOARD.stampH
  const railW = WATERMARK_ARTBOARD.stampW * railScale
  const railX = g.lengthMm * RAIL_AT - railW / 2
  const railY = g.widthMm + CUSHION_MM + (RAIL_MM - RAIL_STAMP_H) / 2

  return (
    <Group name="watermarks" listening={false}>
      {/* one opacity for the whole grid, as the package specifies */}
      <Group name="watermark-grid" opacity={preset.opacity} listening={false}>
        {stamps.map((s, i) => (
          <KImage key={i} name="watermark" image={img} x={s.x} y={s.y} width={s.w} height={s.h} listening={false} />
        ))}
      </Group>
      <KImage
        name="watermark-rail"
        image={img}
        x={railX}
        y={railY}
        width={railW}
        height={RAIL_STAMP_H}
        opacity={RAIL_OPACITY}
        listening={false}
      />
    </Group>
  )
}
