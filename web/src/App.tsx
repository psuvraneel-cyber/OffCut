import { useEffect } from 'react'
import { startSmoothScroll } from './lib/smoothScroll'
import { NavPill } from './components/NavPill'
import { PointerEffects } from './components/PointerEffects'
import { Hero } from './hero/Hero'
import { HowItWorks } from './sections/HowItWorks'
import { Roadmap } from './sections/Roadmap'
import { Faq } from './sections/Faq'
import { EarlyAccess } from './sections/EarlyAccess'
import { Footer } from './components/Footer'

export default function App() {
  useEffect(() => startSmoothScroll(), [])

  return (
    <>
      {/* Keyboard order: skip link, menu, page, footer. The menu floats at the bottom but comes first here. */}
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <NavPill />
      <main id="main" tabIndex={-1}>
        <Hero />
        <HowItWorks />
        <Roadmap />
        <Faq />
        <EarlyAccess />
      </main>
      <Footer />
      <PointerEffects />
    </>
  )
}
