import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import type { ParticleField } from './ParticleField'
import { CursorTrail } from './CursorTrail'
import { WIDE_LAYOUT_MIN } from './layout'
import './Hero.css'

gsap.registerPlugin(ScrollTrigger)

// One step per particle shape, in the same order as the morphs in shaders.ts.
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

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const intro = { value: reducedMotion ? 1 : 0 }
    const scroll = { value: 0 }
    let field: ParticleField | null = null
    let trail: CursorTrail | null = null
    let disposed = false

    // The sparkle trail is for mouse and pen users; touch screens skip it.
    if (trailRef.current && !reducedMotion && window.matchMedia('(pointer: fine)').matches) {
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

    // Three.js is big, so load it after the text has painted.
    const lowPower = window.innerWidth < WIDE_LAYOUT_MIN || (navigator.hardwareConcurrency ?? 8) <= 4
    Promise.all([import('./ParticleField'), import('./shapes')]).then(async ([{ ParticleField }, { buildShapes }]) => {
      const shapes = await buildShapes(lowPower ? 5000 : 9000)
      if (disposed) return
      try {
        field = new ParticleField(canvas, shapes, {
          getIntro: () => intro.value,
          getScroll: () => scroll.value,
          getTextTop: () => {
            const copy = stage.querySelector('.hero__copy > :first-child')
            return copy ? copy.getBoundingClientRect().top - canvas.getBoundingClientRect().top : canvas.clientHeight * 0.5
          },
          reducedMotion,
        })
      } catch (error) {
        console.warn('Particle hero disabled: WebGL is unavailable.', error)
        section.classList.add('hero--static')
        return
      }
      if (!reducedMotion) {
        ctx.add(() => gsap.to(intro, { value: 1, duration: 2.6, ease: 'power2.inOut' }))
      }
    })

    return () => {
      disposed = true
      ctx.revert()
      field?.dispose()
      trail?.dispose()
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
