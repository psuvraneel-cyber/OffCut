import { useEffect } from 'react'
import { startSmoothScroll } from './lib/smoothScroll'
import { NavPill } from './components/NavPill'
import { PointerEffects } from './components/PointerEffects'
import { Hero } from './hero/Hero'
import './App.css'

export default function App() {
  useEffect(() => startSmoothScroll(), [])

  return (
    <>
      <main>
        <Hero />
        {/* Placeholder until the "How it works" section is built */}
        <section id="how-it-works" className="next-placeholder">
          <p className="mono">Next up: how it works</p>
        </section>
      </main>
      <NavPill />
      <PointerEffects />
    </>
  )
}
