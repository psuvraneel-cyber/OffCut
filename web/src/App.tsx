import { useEffect } from 'react'
import { startSmoothScroll } from './lib/smoothScroll'
import { NavPill } from './components/NavPill'
import './App.css'

export default function App() {
  useEffect(() => startSmoothScroll(), [])

  return (
    <>
      <main>
        {/* Placeholder until the particle hero is built */}
        <section className="hero" aria-labelledby="hero-title">
          <p className="mono hero__eyebrow">Free · Private · Runs in your browser</p>
          <h1 id="hero-title" className="hero__title">
            Long videos in.
            <br />
            <em>Reels</em> out.
          </h1>
          <p className="hero__lede">
            Drop in a podcast, vlog or lecture. Get back captioned vertical clips. Your video never
            leaves your computer.
          </p>
        </section>
      </main>
      <NavPill />
    </>
  )
}
