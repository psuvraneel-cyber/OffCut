import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../lib/motion'
import { CursorTrail } from '../hero/CursorTrail'
import { CustomCursor } from './CustomCursor'
import './PointerEffects.css'

// Areas that run their own pointer effects (the hero's fluid or v1 trail) mark themselves with this,
// so the site-wide trail doesn't double up there.
export const OWN_POINTER_FX = '[data-pointer-fx="own"]'

// The mouse effects for the whole site: the ring cursor with magnetic buttons, and a sparkle trail.
// Mouse and pen only (on touch screens swipes are for scrolling), and nothing with reduced motion.
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
  return (
    <>
      <canvas ref={trailRef} className="page-trail" aria-hidden="true" />
      <CustomCursor />
    </>
  )
}
