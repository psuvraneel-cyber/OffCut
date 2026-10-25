import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { prefersReducedMotion } from '../lib/motion'
import { CursorTrail } from './CursorTrail'
import { INTRO, introPlayedThisSession, markIntroPlayed } from './choreography/intro'
import type { LiteParticleField } from './LiteParticleField'
import { DebugOverlay } from './engine/debug'
import type { HeroEngine } from './engine/HeroEngine'
import { WIDE_LAYOUT_MIN } from './engine/layout'
import {
  GPU_TIERS,
  capTier,
  detectTier,
  isGpuTier,
  lowerTier,
  probeGpu,
  readFlags,
  rememberTierCap,
  type GpuSupport,
  type GpuTierName,
  type TierName,
} from './engine/quality'
import { HERO_PAUSE, HERO_RESUME } from './heroControl'
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
    let support: GpuSupport | null = null
    const debug = flags.debug ? new DebugOverlay() : null
    let disposed = false
    let paused = false
    // Bumped by every tier start, so a slow, superseded load can't attach itself afterwards.
    let startGeneration = 0

    // The lite tier's sparkle trail is for mouse and pen users; touch screens skip it.
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

      // The intro text waits for its cue (the end of the intro, or a fallback below).
      if (!reducedMotion) gsap.set('.hero__intro', { autoAlpha: 0, y: 24 })
    }, section)

    let textShown = reducedMotion
    const revealText = (delay = 0) => {
      if (textShown) return
      textShown = true
      ctx.add(() => gsap.to('.hero__intro', { autoAlpha: 1, y: 0, duration: 1, ease: 'power3.out', stagger: 0.08, delay }))
    }
    // Never make anyone wait for Three.js to download before they can read the hero.
    const textFallback = window.setTimeout(() => revealText(), 1500)

    const getIntro = () => intro.value
    const getScroll = () => scroll.value
    const getTextTop = () => {
      const copy = stage.querySelector('.hero__copy > :first-child')
      return copy ? copy.getBoundingClientRect().top - canvas.getBoundingClientRect().top : canvas.clientHeight * 0.5
    }
    // Lite and static: v1's gentle gather, with the text straight away.
    const playLiteIntro = () => {
      window.clearTimeout(textFallback)
      revealText(0.2)
      if (!reducedMotion) ctx.add(() => gsap.to(intro, { value: 1, duration: 2.6, ease: 'power2.inOut' }))
    }

    // GPU tiers: spark, burst, rise, gather, then the text (choreography/intro.ts). Full once per
    // session, shortened after. Scrolling is never blocked: the first scroll fast-forwards it.
    let fastForward: (() => void) | null = null
    const playIntro = () => {
      if (reducedMotion) return
      window.clearTimeout(textFallback)
      const duration = introPlayedThisSession() ? INTRO.short : INTRO.full
      markIntroPlayed()
      ctx.add(() => {
        const timeline = gsap.timeline()
        timeline.to(intro, { value: 1, duration, ease: 'none' })
        timeline.call(() => revealText(), undefined, duration * INTRO.textAt)
        fastForward = () => {
          timeline.timeScale(6)
          if (fastForward) window.removeEventListener('scroll', fastForward)
        }
        window.addEventListener('scroll', fastForward, { passive: true })
      })
    }

    // The bottom of the fallback ladder: the CSS gradient behind the text.
    const showStatic = () => {
      section.classList.add('hero--static')
      debug?.set('static')
      window.clearTimeout(textFallback)
      revealText(0.2)
    }

    // v1's particle field, for GPUs that can't run the simulation (or ?tier=lite).
    const startLite = async () => {
      // The page may have gone away, or swapped tiers again, while this was loading.
      const generation = ++startGeneration
      const [{ LiteParticleField }, { buildShapes }] = await Promise.all([import('./LiteParticleField'), import('./particles/shapes')])
      const lowPower = window.innerWidth < WIDE_LAYOUT_MIN || (navigator.hardwareConcurrency ?? 8) <= 4
      const shapes = await buildShapes(lowPower ? 5000 : 9000)
      if (disposed || generation !== startGeneration) return
      try {
        lite = new LiteParticleField(canvas, shapes, { getIntro, getScroll, getTextTop, reducedMotion })
        lite.setPaused(paused)
      } catch (error) {
        console.warn('Particle hero disabled: WebGL is unavailable.', error)
        showStatic()
        return
      }
      startTrail()
      // The hero draws its own pointer effects, so the site-wide trail steps aside here.
      stage.dataset.pointerFx = 'own'
      debug?.set(`lite · ${shapes.count.toLocaleString()} particles`)
      playLiteIntro()
    }

    // `resume`: rebuilt mid-session after a step down, so skip the intro and start on the shape.
    const startGpu = async (tier: GpuTierName, gpu: GpuSupport, resume = false) => {
      const generation = ++startGeneration
      const { createHeroEngine } = await import('./engine/HeroEngine')
      if (disposed || generation !== startGeneration) return
      let created: HeroEngine
      try {
        created = await createHeroEngine(canvas, {
          tier: GPU_TIERS[tier],
          support: gpu,
          reducedMotion,
          resume,
          slow: flags.slow,
          onSlow: () => stepDown(tier),
          getIntro,
          getScroll,
          getTextTop,
        })
      } catch (error) {
        console.warn('GPU hero unavailable, falling back to the lite particles.', error)
        if (!disposed && generation === startGeneration) await startLite()
        return
      }
      if (disposed || generation !== startGeneration) {
        created.dispose()
        return
      }
      engine = created
      created.setPaused(paused)
      // The GPU tiers stir a fluid instead of the sparkle trail, so the site-wide trail steps aside here.
      stage.dataset.pointerFx = 'own'
      debug?.set(created.describe())
      // ?debug exposes the engine for measuring from the console.
      if (debug) Object.assign(window, { offcutHero: created })
      if (!resume) playIntro()
    }

    // Tear down whatever is running and start another tier in its place.
    const switchTo = (tier: TierName, resume: boolean) => {
      engine?.dispose()
      engine = null
      lite?.dispose()
      lite = null
      trail?.dispose()
      trail = null
      delete stage.dataset.pointerFx
      section.classList.remove('hero--static')
      if (tier === 'static') showStatic()
      else if (isGpuTier(tier) && support) void startGpu(tier, support, resume)
      else void startLite()
    }

    // The watchdog saw frames running long: drop one tier, for the rest of the session.
    const stepDown = (from: TierName) => {
      const next = lowerTier(from)
      console.info(`Hero: frames are running long on the ${from} tier, stepping down to ${next}.`)
      rememberTierCap(next)
      switchTo(next, true)
    }
    if (debug) Object.assign(window, { offcutHeroSwitch: (tier: TierName) => switchTo(tier, true) })

    // pauseHero() / resumeHero() (heroControl.ts) stop and restart rendering on any tier.
    const setPaused = (value: boolean) => {
      paused = value
      engine?.setPaused(value)
      lite?.setPaused(value)
    }
    const onPause = () => setPaused(true)
    const onResume = () => setPaused(false)
    window.addEventListener(HERO_PAUSE, onPause)
    window.addEventListener(HERO_RESUME, onResume)

    // Three.js is big, so load it after the text has painted. Probing the GPU creates a WebGL
    // context too, so that waits as well.
    // A forced ?tier= wins; otherwise detection, capped by any step down earlier this session.
    const startTimer = window.setTimeout(() => {
      support = flags.tier === 'lite' || flags.tier === 'static' ? null : probeGpu()
      const tier = flags.tier ?? capTier(detectTier(support))
      if (tier === 'static') showStatic()
      else if (isGpuTier(tier) && support) void startGpu(tier, support)
      else void startLite()
    })

    return () => {
      disposed = true
      window.clearTimeout(startTimer)
      window.clearTimeout(textFallback)
      if (fastForward) window.removeEventListener('scroll', fastForward)
      window.removeEventListener(HERO_PAUSE, onPause)
      window.removeEventListener(HERO_RESUME, onResume)
      ctx.revert()
      engine?.dispose()
      lite?.dispose()
      trail?.dispose()
      debug?.dispose()
      if (debug) {
        Reflect.deleteProperty(window, 'offcutHero')
        Reflect.deleteProperty(window, 'offcutHeroSwitch')
      }
      section.classList.remove('hero--static')
      delete stage.dataset.pointerFx
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
            <a className="button button--primary" href="#early-access" data-magnetic>
              Join early access
            </a>
            <a className="button button--ghost" href="#how-it-works" data-magnetic>
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
