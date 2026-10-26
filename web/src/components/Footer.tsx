import { GITHUB_URL, INSTAGRAM_URL } from '../lib/site'
import { Logo } from './Logo'
import './Footer.css'

// Phones hide the NavPill's section links, so the footer repeats them.
const sections = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#roadmap', label: 'Roadmap' },
  { href: '#faq', label: 'FAQ' },
  { href: '#early-access', label: 'Early access' },
  { href: '/captions', label: 'Free captions file' },
]

const social = [
  { label: 'GitHub', href: GITHUB_URL },
  { label: 'Instagram', href: INSTAGRAM_URL },
]

// Read once at load, so the copyright year doesn't depend on render timing.
const YEAR = new Date().getFullYear()

export function Footer() {
  return (
    <footer className="footer" data-cursor="dark">
      <div className="footer__inner">
        <div className="footer__brand">
          <a className="footer__logo" href="#top" aria-label="Offcut, back to top">
            <Logo />
          </a>
          <p className="footer__tagline">Free AI clips, made in your browser. Built in public, one step at a time.</p>
        </div>

        <nav className="footer__nav" aria-label="Footer">
          <ul className="footer__links">
            {sections.map(({ href, label }) => (
              <li key={href}>
                <a href={href}>{label}</a>
              </li>
            ))}
          </ul>
          <ul className="footer__links">
            {social.map(({ label, href }) => (
              <li key={label}>
                {/* Until the owner adds the real URLs (src/lib/site.ts), show the name without a dead link. */}
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {label}
                  </a>
                ) : (
                  <span className="footer__soon">
                    {label} <span className="mono">soon</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <ul className="footer__links">
            <li>
              <a href="/privacy">Privacy</a>
            </li>
            <li>
              <a href="/terms">Terms</a>
            </li>
          </ul>
        </nav>

        <div className="footer__base">
          <p className="mono">Built in public · open source</p>
          <p>© {YEAR} Offcut</p>
        </div>
      </div>
    </footer>
  )
}
