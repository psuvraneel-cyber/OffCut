import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { prefersReducedMotion } from '../lib/motion'
import './HowItWorks.css'

gsap.registerPlugin(ScrollTrigger)

// The pipeline, in the order the tool runs it. Tags name the tech for the curious.
const stations = [
  {
    title: 'Drop in a long video',
    body: 'A podcast, vlog, lecture or stream. Offcut reads the file straight from your disk, so nothing is uploaded.',
    tag: 'MP4 · MOV · WebM',
  },
  {
    title: 'Audio split out',
    body: 'The soundtrack is pulled out of the video, so the AI has something to listen to.',
    tag: 'Demux',
  },
  {
    title: 'Transcribed on your device',
    body: 'Whisper runs inside your browser tab and writes down every word, with the exact time it was said.',
    tag: 'Whisper · WebGPU',
  },
  {
    title: 'Best moments picked',
    body: 'The transcript is scored for hooks, punchlines and complete thoughts, and the strongest 15 to 60 seconds are lined up as clips.',
    tag: 'Clip scoring',
  },
  {
    title: 'Reframed to vertical',
    body: 'Face tracking keeps the speaker in shot as the wide frame becomes a 9:16 Reel.',
    tag: 'Face tracking · 9:16',
  },
  {
    title: 'Word-by-word captions',
    body: 'Captions light up as each word is spoken, in the font and colours you pick.',
    tag: 'Captions',
  },
  {
    title: 'Exported',
    body: 'Each clip is encoded right there in the browser and saved to your downloads. No watermark, no account.',
    tag: 'WebCodecs',
  },
]

export function HowItWorks() {
  const sectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const section = sectionRef.current
    // Reduced motion: everything is visible and the line is drawn from the start (see CSS defaults).
    if (!section || prefersReducedMotion()) return

    // Unlit nodes only exist while the scroll animation runs.
    section.classList.add('how--animated')
    const ctx = gsap.context(() => {
      gsap.from('.how__reveal', {
        y: 32,
        opacity: 0,
        duration: 0.9,
        ease: 'power3.out',
        stagger: 0.08,
        scrollTrigger: { trigger: section, start: 'top 75%', once: true },
      })

      // The progress line draws with the scroll, and each station lights up as the line reaches it.
      const track = section.querySelector('.how__track')
      gsap.fromTo(
        '.how__line-fill',
        { scaleY: 0 },
        {
          scaleY: 1,
          ease: 'none',
          scrollTrigger: { trigger: track, start: 'top 65%', end: 'bottom 65%', scrub: 0.4 },
        },
      )

      gsap.utils.toArray<HTMLElement>('.how__station').forEach((station) => {
        gsap.from(station.querySelector('.how__station-copy'), {
          x: 24,
          opacity: 0,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: { trigger: station, start: 'top 85%', once: true },
        })
        ScrollTrigger.create({
          trigger: station,
          start: 'top 65%',
          toggleClass: { targets: station, className: 'is-lit' },
          // Stays lit once passed; scrolling back above it dims it again.
          end: 'max',
        })
      })
    }, section)

    return () => {
      ctx.revert()
      section.classList.remove('how--animated')
    }
  }, [])

  return (
    <section ref={sectionRef} id="how-it-works" className="how" aria-labelledby="how-title">
      <div className="how__intro">
        <p className="mono how__eyebrow how__reveal">How it works</p>
        <h2 id="how-title" className="how__title how__reveal">
          One long video in. <em>A week of Reels</em> out.
        </h2>
        <p className="how__lede how__reveal">
          Seven steps, and every one of them happens inside your browser tab. Your video never touches a server.
        </p>
      </div>

      <div className="how__frame how__reveal">
        <div className="how__frame-bar" aria-hidden="true">
          <span className="how__dots">
            <i />
            <i />
            <i />
          </span>
          <span className="mono">Runs in this tab</span>
        </div>

        <div className="how__track">
          <span className="how__line" aria-hidden="true">
            <span className="how__line-fill" />
          </span>
          <ol className="how__stations">
            {stations.map((station, i) => (
              <li key={station.title} className="how__station">
                <span className="mono how__node" aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="how__station-copy">
                  <h3 className="how__station-title">{station.title}</h3>
                  <p className="how__station-body">{station.body}</p>
                  <span className="mono how__tag">{station.tag}</span>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <p className="mono how__footnote">
          Bytes of video uploaded: <strong>0</strong>
        </p>
      </div>
    </section>
  )
}
