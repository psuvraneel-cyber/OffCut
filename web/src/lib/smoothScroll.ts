import Lenis from 'lenis'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { prefersReducedMotion } from './motion'

gsap.registerPlugin(ScrollTrigger)

// Smooth scrolling driven by GSAP's ticker, so scroll-linked animations stay in sync.
// Returns a cleanup function. Skipped entirely for people who prefer reduced motion.
export function startSmoothScroll(): () => void {
  if (prefersReducedMotion()) {
    return () => {}
  }

  const lenis = new Lenis({ lerp: 0.1 })
  lenis.on('scroll', ScrollTrigger.update)

  const tick = (time: number) => lenis.raf(time * 1000)
  gsap.ticker.add(tick)
  gsap.ticker.lagSmoothing(0)

  return () => {
    gsap.ticker.remove(tick)
    lenis.destroy()
  }
}
