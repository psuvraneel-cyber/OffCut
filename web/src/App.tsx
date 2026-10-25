import { useEffect } from 'react'
import { startSmoothScroll } from './lib/smoothScroll'
import { NavPill } from './components/NavPill'
import { PointerEffects } from './components/PointerEffects'
import { Hero } from './hero/Hero'
import { HowItWorks } from './sections/HowItWorks'
import { EarlyAccess } from './sections/EarlyAccess'

export default function App() {
  useEffect(() => startSmoothScroll(), [])

  return (
    <>
      <main>
        <Hero />
        <HowItWorks />
        <EarlyAccess />
      </main>
      <NavPill />
      <PointerEffects />
    </>
  )
}
