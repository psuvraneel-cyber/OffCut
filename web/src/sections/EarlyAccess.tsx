import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import type { ApiResult, WaitlistRequest, WaitlistResponse } from '../../../shared/api-types'
import { prefersReducedMotion } from '../lib/motion'
import { TURNSTILE_SITE_KEY, loadTurnstile, type TurnstileApi } from '../lib/turnstile'
import './EarlyAccess.css'

gsap.registerPlugin(ScrollTrigger)

type Status = 'idle' | 'submitting' | 'joined' | 'already' | 'error'
type CheckState = 'loading' | 'ready' | 'failed'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Lets Instagram links (?ref=instagram) say where a signup came from, without any tracking.
function signupSource(): string {
  const ref = new URLSearchParams(window.location.search).get('ref')
  const clean = ref?.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 50)
  return clean || 'site'
}

export function EarlyAccess() {
  const sectionRef = useRef<HTMLElement>(null)
  const widgetRef = useRef<HTMLDivElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const consentRef = useRef<HTMLInputElement>(null)
  const resetRef = useRef<HTMLButtonElement>(null)
  const turnstileRef = useRef<{ api: TurnstileApi; id: string } | null>(null)
  const tokenRef = useRef('')
  const ids = useId()

  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')
  const [emailError, setEmailError] = useState('')
  const [consentError, setConsentError] = useState('')
  const [check, setCheck] = useState<CheckState>('loading')

  // Scroll reveal for the card.
  useEffect(() => {
    const section = sectionRef.current
    if (!section || prefersReducedMotion()) return
    const ctx = gsap.context(() => {
      gsap.from('.early__reveal', {
        y: 40,
        opacity: 0,
        duration: 1,
        ease: 'power3.out',
        stagger: 0.1,
        scrollTrigger: { trigger: section, start: 'top 75%', once: true },
      })
    }, section)
    return () => ctx.revert()
  }, [])

  // The Turnstile script only loads when the form is close to the screen, so the hero doesn't pay for it.
  useEffect(() => {
    const section = sectionRef.current
    const container = widgetRef.current
    if (!section || !container) return
    let cancelled = false

    const start = () => {
      observer.disconnect()
      loadTurnstile()
        .then((api) => {
          if (cancelled) return
          const id = api.render(container, {
            sitekey: TURNSTILE_SITE_KEY,
            action: 'waitlist',
            theme: 'dark',
            size: 'flexible',
            callback: (token) => {
              tokenRef.current = token
              setCheck('ready')
            },
            'expired-callback': () => {
              tokenRef.current = ''
              setCheck('loading')
            },
            'error-callback': () => {
              tokenRef.current = ''
              setCheck('failed')
            },
          })
          turnstileRef.current = { api, id }
        })
        .catch(() => {
          if (!cancelled) setCheck('failed')
        })
    }

    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && start(), {
      rootMargin: '600px 0px',
    })
    observer.observe(section)

    return () => {
      cancelled = true
      observer.disconnect()
      const widget = turnstileRef.current
      if (widget) widget.api.remove(widget.id)
      turnstileRef.current = null
      tokenRef.current = ''
    }
  }, [])

  // Tokens are single-use, so every attempt gets a fresh one.
  const resetCheck = () => {
    tokenRef.current = ''
    const widget = turnstileRef.current
    if (widget) {
      setCheck('loading')
      widget.api.reset(widget.id)
    }
  }

  const fail = (text: string) => {
    setStatus('error')
    setMessage(text)
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (status === 'submitting') return

    const trimmed = email.trim().toLowerCase()
    const badEmail = !trimmed
      ? 'Enter your email address.'
      : trimmed.length > 254 || !EMAIL_PATTERN.test(trimmed)
        ? 'That doesn’t look like an email address. Check for typos.'
        : ''
    const badConsent = consent ? '' : 'Tick the box so we’re allowed to email you.'
    setEmailError(badEmail)
    setConsentError(badConsent)
    if (badEmail || badConsent) {
      setStatus('idle')
      setMessage('')
      const firstBad = badEmail ? emailRef.current : consentRef.current
      firstBad?.focus()
      return
    }

    const token = tokenRef.current
    if (!token) {
      fail(
        check === 'failed'
          ? 'The bot check couldn’t load. If you use a content blocker, allow challenges.cloudflare.com and reload the page.'
          : 'One moment: the bot check above is still running. Try again in a few seconds.',
      )
      return
    }

    setStatus('submitting')
    setMessage('Adding you to the list…')

    const body: WaitlistRequest = { email: trimmed, consent: true, source: signupSource(), turnstileToken: token }
    let result: ApiResult<WaitlistResponse> | null = null
    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      result = (await response.json()) as ApiResult<WaitlistResponse>
    } catch {
      result = null
    }
    resetCheck()

    if (!result) {
      fail('Couldn’t reach the server. Check your connection and try again.')
      return
    }
    if (result.ok) {
      setStatus(result.alreadyJoined ? 'already' : 'joined')
      setMessage(
        result.alreadyJoined
          ? 'You’re already on the list. We’ll email you when Offcut is ready.'
          : 'You’re on the list! We’ll send one email when Offcut is ready to try.',
      )
      return
    }

    const { code, fields } = result.error
    if (code === 'VALIDATION_ERROR' && (fields?.email || fields?.consent)) {
      setEmailError(fields.email ? 'That email address wasn’t accepted. Check for typos.' : '')
      setConsentError(fields.consent ? 'Tick the box so we’re allowed to email you.' : '')
      setStatus('idle')
      setMessage('')
      const firstBad = fields.email ? emailRef.current : consentRef.current
      firstBad?.focus()
    } else if (code === 'TURNSTILE_FAILED') {
      fail('The bot check didn’t go through. Please try again.')
    } else if (code === 'RATE_LIMITED') {
      fail('Too many tries in a row. Wait a minute, then try again.')
    } else {
      fail('Something went wrong on our side. Please try again in a little while.')
    }
  }

  const done = status === 'joined' || status === 'already'
  // Focus would otherwise fall to the page when the form swaps out for the confirmation.
  useEffect(() => {
    if (done) resetRef.current?.focus({ preventScroll: true })
  }, [done])

  const startOver = () => {
    setStatus('idle')
    setMessage('')
    setEmail('')
    setConsent(false)
    requestAnimationFrame(() => emailRef.current?.focus())
  }

  const emailHint = `${ids}-email-hint`
  const emailErrorId = `${ids}-email-error`
  const consentErrorId = `${ids}-consent-error`

  return (
    <section ref={sectionRef} id="early-access" className="early" aria-labelledby="early-title">
      <div className="early__card early__reveal">
        <div className="early__copy">
          <p className="mono early__eyebrow">Early access</p>
          <h2 id="early-title" className="early__title">
            Be first to <em>cut</em>.
          </h2>
          <p className="early__lede">
            Offcut is being built in public, one step at a time. Leave your email and we’ll send a single message
            when the first version is ready to try. No newsletter, no spam.
          </p>
          <ul className="mono early__points">
            <li>Free</li>
            <li>No watermark</li>
            <li>Open source</li>
          </ul>
        </div>

        <div className="early__panel early__reveal">
          {/* Keep the form mounted (just hidden) so the Turnstile widget inside it survives the success state. */}
          <form className="early__form" onSubmit={onSubmit} noValidate hidden={done}>
            <div className="early__field">
              <label htmlFor={`${ids}-email`}>Email address</label>
              <input
                ref={emailRef}
                id={`${ids}-email`}
                type="email"
                name="email"
                inputMode="email"
                autoComplete="email"
                spellCheck={false}
                maxLength={254}
                placeholder="you@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (emailError) setEmailError('')
                }}
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? `${emailErrorId} ${emailHint}` : emailHint}
              />
              <p id={emailHint} className="early__hint">
                Only used to tell you when Offcut launches. See the <a href="/privacy">privacy policy</a>.
              </p>
              {emailError && (
                <p id={emailErrorId} className="early__error">
                  {emailError}
                </p>
              )}
            </div>

            <div className="early__field">
              <label className="early__consent">
                <input
                  ref={consentRef}
                  type="checkbox"
                  name="consent"
                  checked={consent}
                  onChange={(e) => {
                    setConsent(e.target.checked)
                    if (consentError) setConsentError('')
                  }}
                  aria-invalid={consentError ? true : undefined}
                  aria-describedby={consentError ? consentErrorId : undefined}
                />
                <span>Yes, email me when Offcut is ready. I can ask to be removed at any time.</span>
              </label>
              {consentError && (
                <p id={consentErrorId} className="early__error">
                  {consentError}
                </p>
              )}
            </div>

            <div className="early__check">
              <div ref={widgetRef} />
              {check === 'failed' && (
                <p className="early__hint">The bot check couldn’t load. Reload the page to try again.</p>
              )}
            </div>

            <button
              className="button button--primary early__submit"
              type="submit"
              aria-disabled={status === 'submitting' || undefined}
            >
              {status === 'submitting' ? 'Joining…' : 'Join early access'}
            </button>
          </form>

          <div
            id={`${ids}-status`}
            className={`early__status early__status--${status}`}
            role="status"
            aria-live="polite"
          >
            {message}
          </div>

          {done && (
            <button ref={resetRef} type="button" className="early__again" onClick={startOver}>
              Use a different email
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
