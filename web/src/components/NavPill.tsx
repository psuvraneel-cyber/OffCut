import { useEffect, useState } from 'react'
import { Logo } from './Logo'
import './NavPill.css'

const links = [
  { href: '#how-it-works', id: 'how-it-works', label: 'How it works' },
  { href: '#roadmap', id: 'roadmap', label: 'Roadmap' },
  { href: '#faq', id: 'faq', label: 'FAQ' },
  { href: '/captions', id: 'captions', label: 'Captions' },
]

// Sticky glass header pinned to the top of the viewport.
export function NavPill() {
  const [activeSection, setActiveSection] = useState<string>('')

  useEffect(() => {
    const sectionIds = ['how-it-works', 'roadmap', 'faq', 'early-access']
    const elements = sectionIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null)

    if (elements.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
        if (visible.length > 0) {
          visible.sort((a, b) => Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top))
          setActiveSection(visible[0].target.id)
        } else if (window.scrollY < 200) {
          setActiveSection('')
        }
      },
      { rootMargin: '-20% 0px -40% 0px', threshold: [0, 0.2, 0.5] }
    )

    elements.forEach((el) => observer.observe(el))

    const handleScroll = () => {
      if (window.scrollY < 200) {
        setActiveSection('')
      }
    }
    window.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', handleScroll)
    }
  }, [])

  return (
    <header className="nav-pill" aria-label="Main">
      <div className="nav-pill__inner">
        <a className="nav-pill__brand" href="#top" aria-label="Offcut, back to top">
          <Logo />
        </a>
        <ul className="nav-pill__links">
          {links.map((link) => {
            const isActive = activeSection === link.id
            return (
              <li key={link.href}>
                <a
                  href={link.href}
                  className={isActive ? 'is-active' : undefined}
                  aria-current={isActive ? 'true' : undefined}
                >
                  {link.label}
                </a>
              </li>
            )
          })}
        </ul>
        <a
          className={`nav-pill__cta${activeSection === 'early-access' ? ' is-active' : ''}`}
          href="#early-access"
          aria-current={activeSection === 'early-access' ? 'true' : undefined}
        >
          Early access
        </a>
      </div>
    </header>
  )
}
