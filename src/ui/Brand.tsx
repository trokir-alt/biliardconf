/**
 * The identity in the interface: the horizontal lockup where there is room for
 * it, the monogram alone where there is not.
 *
 * Both are the designer's SVG, inlined as a `data:` URI - the same rule the
 * canvas follows, so there is one asset pipeline and no request to fail.
 */

import { LOGO_HORIZONTAL_WHITE_SVG, SIGN_WHITE_SVG } from '../brand/assets'
import { svgDataUri } from '../brand/svgImage'

const HORIZONTAL = svgDataUri(LOGO_HORIZONTAL_WHITE_SVG)
const SIGN = svgDataUri(SIGN_WHITE_SVG)

/** the lockup with the name; the package asks for at least 245 px of width */
export function BrandLockup() {
  return <img className="brand__lockup" src={HORIZONTAL} alt="Алексей Соць" width={244} height={57} />
}

/** the monogram alone; the package asks for at least 32 px */
export function BrandSign({ size = 32 }: { size?: number }) {
  return <img className="brand__sign" src={SIGN} alt="Алексей Соць" width={size} height={size} />
}
