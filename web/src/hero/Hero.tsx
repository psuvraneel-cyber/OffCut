import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { prefersReducedMotion } from '../lib/motion'
import { CursorTrail } from './CursorTrail'
import type { LiteParticleField } from './LiteParticleField'
import { DebugOverlay } from './engine/debug'
import type { HeroEngine } from './engine/HeroEngine'
import { WIDE_LAYOUT_MIN } from './engine/layout'
import { GPU_TIERS, detectTier, isGpuTier, probeGpu, readFlags, type GpuSupport, type GpuTierName } from './engine/quality'
import './Hero.css'

gsap.registerPlugin(ScrollTrigger)

// One step per particle shape, in the same order as the morphs (see particles/ParticleSim.ts).
const steps = [
  { label: '01', title: 'Long videos in.', body: 'Drop in a podcast, vlog or lecture. Any length.' },
  { label: '02', title: 'Reels out.', body: 'AI finds the best moments and reframes them for vertical.' },
  { label: '03', title: 'Captions that pop.', body: 'Word-by-word captions in your style. No watermark.' },
  { label: '04', title: 'Nothing leaves your device.', body: 'It all runs in your browser. Free, private, offline-ready.' },
]

// Timeline time spent resting on a shape before the next morph starts (and after the last one).
const HOLD = 0.3

export function Hero() {
  const sectionRef = useRef<HTMLElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const trailRef = useRef<HTMLCanvasElement>(null)
  const [active, setActive] = useState(0)

  useEffect(() => {
    const section = sectionRef.current
    const stage = stageRef.current
    const canvas = canvasRef.current
    if (!section || !stage || !canvas) return

    const reducedMotion = prefersReducedMotion()
    const flags = readFlags()
    const intro = { value: reducedMotion ? 1 : 0 }
    const scroll = { value: 0 }
    let engine: HeroEngine | null = null
    let lite: LiteParticleField | null = null
    let trail: CursorTrail | null = null
    const debug = flags.debug ? new DebugOverlay() : null
    let disposed = false

    // The sparkle trail is for mouse and pen users; touch screens skip it.
    const startTrail = () => {
      if (!trailRef.current || reducedMotion || !window.matchMedia('(pointer: fine)').matches) return
      try {
        trail = new CursorTrail(trailRef.current)
      } catch {
        trail = null
      }
    }

    const ctx = gsap.context(() => {
      const lines = gsap.utils.toArray<HTMLElement>('.hero__step')
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          end: '+=300%',
          pin: stage,
          scrub: reducedMotion ? true : 0.8,
          // Settle on a finished shape when the visitor stops scrolling mid-morph.
          snap: { snapTo: 'labels', duration: { min: 0.3, max: 0.9 }, delay: 0.15, ease: 'power2.inOut' },
        },
        onUpdate: () => setActive(Math.round(scroll.value)),
      })

      tl.to(scroll, { value: steps.length - 1, duration: steps.length - 1, ease: 'none' }, HOLD)
      lines.forEach((line, i) => {
        tl.addLabel(`step-${i}`, HOLD + i)
        if (i === 0) return
        const at = HOLD + i - 0.65
        tl.to(lines[i - 1], { autoAlpha: 0, yPercent: -25, duration: 0.3, ease: 'power2.in' }, at)
        tl.fromTo(line, { autoAlpha: 0, yPercent: 25 }, { autoAlpha: 1, yPercent: 0, duration: 0.3, ease: 'power2.out' }, at + 0.3)
      })
      tl.to({}, { duration: HOLD })

      if (!reducedMotion) {
        gsap.from('.hero__intro', { autoAlpha: 0, y: 24, duration: 1, ease: 'power3.out', stagger: 0.08, delay: 0.2 })
      }
    }, section)

    const getIntro = () => intro.value
    const getScroll = () => scroll.value
    const getTextTop = () => {
      const copy = stage.querySelector('.hero__copy > :first-child')
      return copy ? copy.getBoundingClientRect().top - canvas.getBoundingClientRect().top : canvas.clientHeight * 0.5
    }
    const playIntro = () => {
      if (!reducedMotion) ctx.add(() => gsap.to(intro, { value: 1, duration: 2.6, ease: 'power2.inOut' }))
    }

    // The bottom of the fallback ladder: the CSS gradient behind the text.
    const showStatic = () => {
      section.classList.add('hero--static')
      debug?.set('static')
    }

    // v1's particle field, for GPUs that can't run the simulation (or ?tier=lite).
    const startLite = async () => {
      const [{ LiteParticleField }, { buildShapes }] = await Promise.all([import('./LiteParticleField'), import('./particles/shapes')])
      const lowPower = window.innerWidth < WIDE_LAYOUT_MIN || (navigator.hardwareConcurrency ?? 8) <= 4
      const shapes = await buildShapes(lowPower ? 5000 : 9000)
      if (disposed) return
      try {
        lite = new LiteParticleField(canvas, shapes, { getIntro, getScroll, getTextTop, reducedMotion })
      } catch (error) {
        console.warn('Particle hero disabled: WebGL is unavailable.', error)
        showStatic()
        return
      }
      startTrail()
      debug?.set(`lite · ${shapes.count.toLocaleString()} particles`)
      playIntro()
    }

    const startGpu = async (tier: GpuTierName, support: GpuSupport) => {
      const { createHeroEngine } = await import('./engine/HeroEngine')
      if (disposed) return
      let created: HeroEngine
      try {
        created = await createHeroEngine(canvas, { tier: GPU_TIERS[tier], support, reducedMotion, getIntro, getScroll, getTextTop })
      } catch (error) {
        console.warn('GPU hero unavailable, falling back to the lite particles.', error)
        if (!disposed) await startLite()
        return
      }
      if (disposed) {
        created.dispose()
        return
      }
      engine = created
      startTrail()
      debug?.set(created.describe())
      // ?debug exposes the engine for measuring from the console.
      if (debug) Object.assign(window, { offcutHero: created })
      playIntro()
    }

    // Three.js is big, so load it after the text has painted. Probing the GPU creates a WebGL
    // context too, so that waits as well.
    const startTimer = window.setTimeout(() => {
      const support = flags.tier === 'lite' || flags.tier === 'static' ? null : probeGpu()
      const tier = flags.tier ?? detectTier(support)
      if (tier === 'static') showStatic()
      else if (isGpuTier(tier) && support) void startGpu(tier, support)
      else void startLite()
    })

    return () => {
      disposed = true
      window.clearTimeout(startTimer)
      ctx.revert()
      engine?.dispose()
      lite?.dispose()
      trail?.dispose()
      debug?.dispose()
      if (debug) Reflect.deleteProperty(window, 'offcutHero')
      section.classList.remove('hero--static')
    }
  }, [])

  return (
    <section ref={sectionRef} className="hero" id="top" aria-labelledby="hero-title">
      <div ref={stageRef} className="hero__stage">
        <canvas ref={canvasRef} className="hero__canvas" aria-hidden="true" />
        <canvas ref={trailRef} className="hero__trail" aria-hidden="true" />

        <div className="hero__copy">
          <p className="mono hero__eyebrow hero__intro">Free · Private · Runs in your browser</p>
          <h1 id="hero-title" className="visually-hidden">
            Offcut turns long videos into captioned Reels for free, right in your browser
          </h1>
          <ol className="hero__steps">
            {steps.map((step, i) => (
              <li key={step.label} className="hero__step">
                <span className={`mono hero__step-label${i === 0 ? ' hero__intro' : ''}`}>{step.label}</span>
                <p className={`hero__step-title${i === 0 ? ' hero__intro' : ''}`}>{step.title}</p>
                <p className={`hero__step-body${i === 0 ? ' hero__intro' : ''}`}>{step.body}</p>
              </li>
            ))}
          </ol>
          <div className="hero__actions hero__intro">
            <a className="button button--primary" href="#early-access">
              Join early access
            </a>
            <a className="button button--ghost" href="#how-it-works">
              How it works
            </a>
          </div>
        </div>

        <div className="hero__progress hero__intro" aria-hidden="true">
          {steps.map((step, i) => (
            <span key={step.label} className={i === active ? 'is-active' : undefined}>
              {step.label}
            </span>
          ))}
        </div>
        <p className="mono hero__hint hero__intro" aria-hidden="true">
          Scroll
        </p>
      </div>
    </section>
  )
}
