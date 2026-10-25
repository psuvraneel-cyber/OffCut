import { useEffect, useRef, type ReactNode } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { prefersReducedMotion } from '../lib/motion'
import './Faq.css'

gsap.registerPlugin(ScrollTrigger)

// Answers describe the plan for launch; Offcut isn't out yet, so they avoid promising exact numbers.
const questions: { q: string; a: ReactNode }[] = [
  {
    q: 'Is it really free?',
    a: (
      <p>
        Yes. No subscription, no credit card, no account and no watermark. It can stay free because your own
        device does the heavy lifting, so there are no servers crunching video for us to pay for.
      </p>
    ),
  },
  {
    q: 'Does my video get uploaded anywhere?',
    a: (
      <>
        <p>
          No. Offcut opens the file straight from your disk, and the transcription, clip picking, reframing,
          captions and export all run inside your browser tab. Not a single byte of your video is sent to us.
        </p>
        <p>
          The first time you use it, your browser downloads the AI models (from Hugging Face’s public CDN) and
          keeps them, so later runs start faster and can even work offline.
        </p>
      </>
    ),
  },
  {
    q: 'Which browsers and devices work?',
    a: (
      <>
        <p>
          A recent version of Chrome or Edge on a laptop or desktop works best, because they support WebGPU,
          which makes the AI much faster. Firefox and Safari will work too, just more slowly.
        </p>
        <p>
          Phones and tablets can handle short videos, but long podcasts need more memory than most phones have,
          so a computer is the better choice for those.
        </p>
      </>
    ),
  },
  {
    q: 'Is there a watermark?',
    a: <p>Never. Your clips are yours, exported clean, with no logo and no “made with” sticker.</p>,
  },
  {
    q: 'Is it open source?',
    a: (
      <p>
        Yes. The code will be public on GitHub, so anyone can check that videos stay on the device, suggest
        fixes or run their own copy. It’s being built in public on Instagram, one step at a time.
      </p>
    ),
  },
  {
    q: 'So how do you make money?',
    a: (
      <>
        <p>
          Later on, there will be a small display ad on the processing screen, the part where you’d be waiting
          anyway. There may also be an optional “watch an ad to unlock an extra” offer.
        </p>
        <p>
          Ads will never be forced, never block a download and never get a copy of your video. Before any ads go
          live, you’ll be asked about ad cookies where the law requires it.
        </p>
      </>
    ),
  },
]

export function Faq() {
  const sectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const section = sectionRef.current
    if (!section || prefersReducedMotion()) return
    const ctx = gsap.context(() => {
      gsap.from('.faq__reveal', {
        y: 32,
        opacity: 0,
        duration: 0.9,
        ease: 'power3.out',
        stagger: 0.06,
        scrollTrigger: { trigger: section, start: 'top 75%', once: true },
      })
    }, section)
    return () => ctx.revert()
  }, [])

  return (
    <section ref={sectionRef} id="faq" className="faq" aria-labelledby="faq-title">
      <div className="faq__intro">
        <p className="mono faq__eyebrow faq__reveal">FAQ</p>
        <h2 id="faq-title" className="faq__title faq__reveal">
          Fair <em>questions</em>.
        </h2>
        <p className="faq__lede faq__reveal">
          Something else on your mind? Ask in the comments on Instagram. The best questions end up here.
        </p>
      </div>

      {/* Native <details>: keyboard, screen-reader and find-in-page support for free. */}
      <div className="faq__list">
        {questions.map(({ q, a }) => (
          <details key={q} className="faq__item faq__reveal">
            <summary className="faq__question">
              <span>{q}</span>
              <span className="faq__icon" aria-hidden="true" />
            </summary>
            <div className="faq__answer">{a}</div>
          </details>
        ))}
      </div>
    </section>
  )
}
