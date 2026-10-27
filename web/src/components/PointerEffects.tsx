import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../lib/motion'
import { CursorTrail } from '../hero/CursorTrail'
import './PointerEffects.css'

// Areas that run their own pointer effects (the hero's fluid or v1 trail) mark themselves with this,
// so the site-wide trail doesn't double up there.
export const OWN_POINTER_FX = '[data-pointer-fx="own"]'

// Mouse effects for the site: canvas sparkle trail for fine pointers.
// Mouse and pen only (touch screens skip it), and nothing with reduced motion.
export function PointerEffects() {
  const [enabled] = useState(
    () => window.matchMedia('(pointer: fine) and (hover: hover)').matches && !prefersReducedMotion(),
  )
  const trailRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!enabled || !trailRef.current) return
    let trail: CursorTrail
    try {
      trail = new CursorTrail(trailRef.current, OWN_POINTER_FX)
    } catch {
      return
    }
    return () => trail.dispose()
  }, [enabled])

  if (!enabled) return null
  return <canvas ref={trailRef} className="page-trail" aria-hidden="true" />
}
