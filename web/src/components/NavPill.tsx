import { Logo } from './Logo'
import './NavPill.css'

const links = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#roadmap', label: 'Roadmap' },
  { href: '#faq', label: 'FAQ' },
]

// Floating glass menu pinned to the bottom of the screen.
export function NavPill() {
  return (
    <nav className="nav-pill" aria-label="Main">
      <a className="nav-pill__brand" href="#top" aria-label="Offcut, back to top">
        <Logo />
      </a>
      <ul className="nav-pill__links">
        {links.map((link) => (
          <li key={link.href}>
            <a href={link.href}>{link.label}</a>
          </li>
        ))}
      </ul>
      <a className="nav-pill__cta" href="#early-access" data-magnetic>
        Early access
      </a>
    </nav>
  )
}
