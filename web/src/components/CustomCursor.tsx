import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import './CustomCursor.css'

// What the ring wraps itself around, and which elements lean towards the cursor.
const TARGETS = 'a, button, [role="button"], summary, label[for]'
const MAGNETS = '.button, .nav-pill__cta, [data-magnetic]'
// Text fields keep the native I-beam (you need to see where the caret goes), so the ring steps aside.
const TEXT_FIELDS = 'input, textarea, select, [contenteditable="true"]'
// Dark areas get the lilac ring; everywhere else (the light mist sections) gets violet.
const DARK_AREAS = '.hero__stage, .nav-pill, [data-cursor="dark"]'
const RING_SIZE = 36
const SNAP_PADDING = 8
// Magnets lean up to MAGNET_PULL px towards a cursor within MAGNET_RANGE px.
const MAGNET_RANGE = 60
const MAGNET_PULL = 8

interface Magnet {
  element: HTMLElement
  x: gsap.QuickToFunc
  y: gsap.QuickToFunc
}

// A ring and dot that trail the pointer across the whole site, replacing the native cursor. The ring
// snaps around links and buttons, and buttons lean towards it. Mounted only for mouse/pen users who
// haven't asked for reduced motion (see PointerEffects).
export function CustomCursor() {
  const rootRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const dotRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    const ring = ringRef.current
    const dot = dotRef.current
    if (!root || !ring || !dot) return

    document.documentElement.classList.add('has-custom-cursor')
    gsap.set([ring, dot], { xPercent: -50, yPercent: -50 })
    const ringX = gsap.quickTo(ring, 'x', { duration: 0.35, ease: 'power3.out' })
    const ringY = gsap.quickTo(ring, 'y', { duration: 0.35, ease: 'power3.out' })
    const dotX = gsap.quickTo(dot, 'x', { duration: 0.1, ease: 'power3.out' })
    const dotY = gsap.quickTo(dot, 'y', { duration: 0.1, ease: 'power3.out' })

    // Sections can appear later (lazy content, forms swapping states), so magnets are found as they come.
    const magnets = new Map<HTMLElement, Magnet>()
    const findMagnets = () => {
      for (const element of document.querySelectorAll<HTMLElement>(MAGNETS)) {
        if (magnets.has(element)) continue
        magnets.set(element, {
          element,
          x: gsap.quickTo(element, 'x', { duration: 0.5, ease: 'power3.out' }),
          y: gsap.quickTo(element, 'y', { duration: 0.5, ease: 'power3.out' }),
        })
      }
      for (const element of magnets.keys()) if (!element.isConnected) magnets.delete(element)
    }
    findMagnets()
    const observer = new MutationObserver(findMagnets)
    observer.observe(document.body, { childList: true, subtree: true })

    let snapped: Element | null = null
    let visible = false
    const pointer = { x: -1, y: -1, active: false }

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
          borderRadius: `${Math.min(rect.height / 2 + SNAP_PADDING, 24)}px`,
          duration: 0.3,
          ease: 'power3.out',
        })
      } else {
        gsap.to(ring, { width: RING_SIZE, height: RING_SIZE, borderRadius: `${RING_SIZE / 2}px`, duration: 0.3, ease: 'power3.out' })
      }
    }

    // Lean each magnet towards the pointer, measured from where it sits without the lean.
    const pullMagnets = (x: number, y: number) => {
      for (const magnet of magnets.values()) {
        const rect = magnet.element.getBoundingClientRect()
        const halfWidth = rect.width / 2
        const halfHeight = rect.height / 2
        if (!halfWidth || !halfHeight) continue
        const dx = x - (rect.left + halfWidth - Number(gsap.getProperty(magnet.element, 'x')))
        const dy = y - (rect.top + halfHeight - Number(gsap.getProperty(magnet.element, 'y')))
        const gap = Math.hypot(Math.max(Math.abs(dx) - halfWidth, 0), Math.max(Math.abs(dy) - halfHeight, 0))
        const strength = Math.max(0, 1 - gap / MAGNET_RANGE)
        magnet.x(gsap.utils.clamp(-1, 1, dx / halfWidth) * MAGNET_PULL * strength)
        magnet.y(gsap.utils.clamp(-1, 1, dy / halfHeight) * MAGNET_PULL * strength)
      }
    }

    // Everything follows from what's under the pointer: colour, snapping, and whether to show at all.
    const place = (target: Element | null) => {
      const { x, y } = pointer
      // An iframe (e.g. the Turnstile widget) swallows pointer events; let the native cursor take over.
      show(target !== null && target.tagName !== 'IFRAME' && !target.closest(TEXT_FIELDS))
      root.classList.toggle('custom-cursor--light', !target?.closest(DARK_AREAS))
      pullMagnets(x, y)
      dotX(x)
      dotY(y)

      const snapTarget = target?.closest(TARGETS) ?? null
      snapTo(snapTarget)
      if (snapTarget) {
        const rect = snapTarget.getBoundingClientRect()
        ringX(rect.left + rect.width / 2)
        ringY(rect.top + rect.height / 2)
      } else {
        ringX(x)
        ringY(y)
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      pointer.x = event.clientX
      pointer.y = event.clientY
      pointer.active = true
      place(event.target instanceof Element ? event.target : null)
    }
    // The page scrolls under a still mouse: re-check what's under it so snapping and colour keep up.
    const onScroll = () => {
      if (pointer.active) place(document.elementFromPoint(pointer.x, pointer.y))
    }
    const onPointerDown = () => gsap.to(ring, { scale: 0.85, duration: 0.15 })
    const onPointerUp = () => gsap.to(ring, { scale: 1, duration: 0.3, ease: 'back.out(3)' })
    const onPointerLeave = () => {
      pointer.active = false
      show(false)
      pullMagnets(-1e4, -1e4)
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    window.addEventListener('pointerup', onPointerUp, { passive: true })
    document.documentElement.addEventListener('pointerleave', onPointerLeave)

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      document.documentElement.removeEventListener('pointerleave', onPointerLeave)
      observer.disconnect()
      document.documentElement.classList.remove('has-custom-cursor')
      gsap.killTweensOf([ring, dot])
      for (const { element } of magnets.values()) {
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
