import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import './CustomCursor.css'

// Where the custom cursor shows, and what the ring wraps itself around.
const ZONES = '.hero__stage, .nav-pill'
const TARGETS = 'a, button'
const RING_SIZE = 36
const SNAP_PADDING = 8
// Magnetic buttons ([data-magnetic]) lean up to MAGNET_PULL px towards a cursor within MAGNET_RANGE px.
const MAGNET_RANGE = 60
const MAGNET_PULL = 8

// A lilac ring and dot that trail the pointer over the hero and the nav. The ring snaps around links
// and buttons. The native cursor is hidden over the hero only; over the nav the dot steps aside so
// there's never a double cursor. Mounted only for mouse/pen users on the GPU tiers.
export function CustomCursor() {
  const rootRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const dotRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    const ring = ringRef.current
    const dot = dotRef.current
    if (!root || !ring || !dot) return

    const hero = document.querySelector('.hero__stage')
    hero?.classList.add('has-custom-cursor')
    gsap.set([ring, dot], { xPercent: -50, yPercent: -50 })
    const ringX = gsap.quickTo(ring, 'x', { duration: 0.35, ease: 'power3.out' })
    const ringY = gsap.quickTo(ring, 'y', { duration: 0.35, ease: 'power3.out' })
    const dotX = gsap.quickTo(dot, 'x', { duration: 0.1, ease: 'power3.out' })
    const dotY = gsap.quickTo(dot, 'y', { duration: 0.1, ease: 'power3.out' })
    const magnets = Array.from(document.querySelectorAll<HTMLElement>('[data-magnetic]'), (element) => ({
      element,
      x: gsap.quickTo(element, 'x', { duration: 0.5, ease: 'power3.out' }),
      y: gsap.quickTo(element, 'y', { duration: 0.5, ease: 'power3.out' }),
    }))
    let snapped: Element | null = null
    let visible = false

    const show = (on: boolean) => {
      if (on === visible) return
      visible = on
      gsap.to([ring, dot], { autoAlpha: on ? 1 : 0, duration: 0.25, overwrite: 'auto' })
    }

    const snapTo = (target: Element | null) => {
      if (target === snapped) return
      snapped = target
      if (target) {
        const rect = target.getBoundingClientRect()
        gsap.to(ring, {
          width: rect.width + SNAP_PADDING * 2,
          height: rect.height + SNAP_PADDING * 2,
          borderRadius: `${rect.height / 2 + SNAP_PADDING}px`,
          duration: 0.3,
          ease: 'power3.out',
        })
      } else {
        gsap.to(ring, { width: RING_SIZE, height: RING_SIZE, borderRadius: `${RING_SIZE / 2}px`, duration: 0.3, ease: 'power3.out' })
      }
    }

    // Lean each magnet towards the pointer, measured from where it sits without the lean.
    const pullMagnets = (x: number, y: number) => {
      for (const magnet of magnets) {
        const rect = magnet.element.getBoundingClientRect()
        const halfWidth = rect.width / 2
        const halfHeight = rect.height / 2
        const dx = x - (rect.left + halfWidth - Number(gsap.getProperty(magnet.element, 'x')))
        const dy = y - (rect.top + halfHeight - Number(gsap.getProperty(magnet.element, 'y')))
        const gap = Math.hypot(Math.max(Math.abs(dx) - halfWidth, 0), Math.max(Math.abs(dy) - halfHeight, 0))
        const strength = Math.max(0, 1 - gap / MAGNET_RANGE)
        magnet.x(gsap.utils.clamp(-1, 1, dx / halfWidth) * MAGNET_PULL * strength)
        magnet.y(gsap.utils.clamp(-1, 1, dy / halfHeight) * MAGNET_PULL * strength)
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      const target = event.target instanceof Element ? event.target : null
      const zone = target?.closest(ZONES) ?? null
      show(zone !== null)
      root.classList.toggle('custom-cursor--native', zone?.matches('.nav-pill') ?? false)
      pullMagnets(event.clientX, event.clientY)
      dotX(event.clientX)
      dotY(event.clientY)

      const snapTarget = zone ? (target?.closest(TARGETS) ?? null) : null
      snapTo(snapTarget)
      if (snapTarget) {
        const rect = snapTarget.getBoundingClientRect()
        ringX(rect.left + rect.width / 2)
        ringY(rect.top + rect.height / 2)
      } else {
        ringX(event.clientX)
        ringY(event.clientY)
      }
    }
    const onPointerDown = () => gsap.to(ring, { scale: 0.85, duration: 0.15 })
    const onPointerUp = () => gsap.to(ring, { scale: 1, duration: 0.3, ease: 'back.out(3)' })
    const onPointerLeave = () => {
      show(false)
      pullMagnets(-1e4, -1e4)
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    window.addEventListener('pointerup', onPointerUp, { passive: true })
    document.documentElement.addEventListener('pointerleave', onPointerLeave)

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      document.documentElement.removeEventListener('pointerleave', onPointerLeave)
      hero?.classList.remove('has-custom-cursor')
      gsap.killTweensOf([ring, dot])
      for (const { element } of magnets) {
        gsap.killTweensOf(element)
        gsap.set(element, { clearProps: 'transform' })
      }
    }
  }, [])

  return (
    <div ref={rootRef} className="custom-cursor" aria-hidden="true">
      <div ref={ringRef} className="custom-cursor__ring" />
      <div ref={dotRef} className="custom-cursor__dot" />
    </div>
  )
}
