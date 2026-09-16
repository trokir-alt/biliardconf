/**
 * How much of the coach's name the cloth carries.
 *
 * It cannot be switched off - that is the point of it - but how loud it is
 * depends on how busy the diagrams are, and that is the coach's call, not a
 * number baked into a release.
 */

import { useStore } from '../state/store'
import { DENSITY, DENSITY_ORDER, stampCount } from '../brand/watermark'

export function DensityPicker({ id = 'density' }: { id?: string }) {
  const density = useStore((s) => s.watermarkDensity)
  const setDensity = useStore((s) => s.setWatermarkDensity)
  return (
    <div className="row row--stack">
      <span className="row__label" id={`${id}-label`}>
        Вотермарка
      </span>
      <span className="seg seg--wide" role="group" aria-labelledby={`${id}-label`}>
        {DENSITY_ORDER.map((d) => (
          <button
            key={d}
            type="button"
            className="btn seg__btn"
            aria-pressed={density === d}
            title={`${DENSITY[d].label}: ${stampCount(d)} подписей`}
            onClick={() => setDensity(d)}
          >
            {DENSITY[d].label}
          </button>
        ))}
      </span>
    </div>
  )
}
