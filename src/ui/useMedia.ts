/** One breakpoint for the whole app: under it the phone shell is used. */

import { useEffect, useState } from 'react'

export const MOBILE_QUERY = '(max-width: 860px)'

export function useIsMobile(): boolean {
  const get = () => {
    try {
      return window.matchMedia(MOBILE_QUERY).matches
    } catch {
      return false
    }
  }
  const [mobile, setMobile] = useState(get)
  useEffect(() => {
    let mq: MediaQueryList
    try {
      mq = window.matchMedia(MOBILE_QUERY)
    } catch {
      return
    }
    const on = () => setMobile(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return mobile
}
