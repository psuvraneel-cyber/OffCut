import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import type { ApiResult, Feature, FeatureStatus, FeaturesResponse, VoteRequest, VoteResponse } from '../../../shared/api-types'
import { prefersReducedMotion } from '../lib/motion'
import { TURNSTILE_SITE_KEY, loadTurnstile, type TurnstileApi } from '../lib/turnstile'
import { getVoterId, readVotes, saveVotes, votedRecently } from '../lib/voter'
import './Roadmap.css'

gsap.registerPlugin(ScrollTrigger)

type ListState = 'loading' | 'ready' | 'error'
type Tone = 'info' | 'error'

const STATUS_LABELS: Record<FeatureStatus, string> = {
  idea: 'Idea',
  planned: 'Planned',
  building: 'Building now',
  shipped: 'Shipped',
}

// A vote waits this long for a bot-check token before giving up.
const TOKEN_TIMEOUT_MS = 15_000

const FALLBACK_FEATURES: Feature[] = [
  {
    id: 'hindi-captions',
    title: 'Hindi & Hinglish captions',
    description: 'Accurate captions for Hindi and Hinglish speech.',
    status: 'building',
    votes: 42,
  },
  {
    id: 'caption-styles',
    title: 'More caption styles',
    description: 'New fonts, colours, emoji and animation presets.',
    status: 'planned',
    votes: 29,
  },
  {
    id: 'batch-export',
    title: 'Export all clips at once',
    description: 'Render every selected clip in one go.',
    status: 'idea',
    votes: 18,
  },
  {
    id: 'auto-broll',
    title: 'Auto B-roll suggestions',
    description: 'Suggest cut-aways and zooms to keep viewers watching.',
    status: 'idea',
    votes: 14,
  },
  {
    id: 'desktop-app',
    title: 'Desktop app',
    description: 'A faster installable app for long podcasts.',
    status: 'planned',
    votes: 35,
  },
]

export function Roadmap() {
  const sectionRef = useRef<HTMLElement>(null)
  const widgetRef = useRef<HTMLDivElement>(null)
  const turnstileRef = useRef<{ api: TurnstileApi; id: string } | null>(null)
  const tokenRef = useRef('')
  const checkFailedRef = useRef(false)
  // Votes that arrive before a token is ready queue here and get the next one.
  const waitersRef = useRef<((token: string) => void)[]>([])
  const pendingRef = useRef(new Set<string>())

  const [features, setFeatures] = useState<Feature[]>([])
  const [list, setList] = useState<ListState>('loading')
  const [refresh, setRefresh] = useState(0)
  const [voted, setVoted] = useState(readVotes)
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const [message, setMessage] = useState('')
  const [tone, setTone] = useState<Tone>('info')
  const [checkFailed, setCheckFailed] = useState(false)

  // Scroll reveal for the heading and board (the cards themselves arrive after the fetch).
  useEffect(() => {
    const section = sectionRef.current
    if (!section || prefersReducedMotion()) return
    const ctx = gsap.context(() => {
      gsap.from('.roadmap__reveal', {
        y: 32,
        opacity: 0,
        duration: 0.9,
        ease: 'power3.out',
        stagger: 0.08,
        scrollTrigger: { trigger: section, start: 'top 75%', once: true },
      })
    }, section)
    return () => ctx.revert()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    // The list is cached for a minute; a refresh after a 404/409, or a reload just after voting, needs the current one.
    const fresh = refresh > 0 || votedRecently()
    fetch('/api/features', { signal: controller.signal, cache: fresh ? 'no-cache' : 'default' })
      .then((response) => response.json() as Promise<ApiResult<FeaturesResponse>>)
      .then((result) => {
        if (!result.ok) throw new Error(result.error.code)
        setFeatures(result.features)
        setList('ready')
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFeatures(FALLBACK_FEATURES)
          setList('error')
        }
      })
    return () => controller.abort()
  }, [refresh])

  // Same lazy Turnstile as the early-access form, but invisible unless Cloudflare wants a click.
  useEffect(() => {
    const section = sectionRef.current
    const container = widgetRef.current
    if (!section || !container) return
    let cancelled = false
    const waiters = waitersRef.current

    const giveUp = () => {
      tokenRef.current = ''
      checkFailedRef.current = true
      setCheckFailed(true)
      waiters.splice(0).forEach((resolve) => resolve(''))
    }

    const start = () => {
      observer.disconnect()
      loadTurnstile()
        .then((api) => {
          if (cancelled) return
          const id = api.render(container, {
            sitekey: TURNSTILE_SITE_KEY,
            action: 'vote',
            theme: 'light',
            size: 'flexible',
            appearance: 'interaction-only',
            callback: (token) => {
              checkFailedRef.current = false
              setCheckFailed(false)
              const next = waiters.shift()
              if (next) {
                // Tokens are single-use: hand this one over and start on the next.
                api.reset(id)
                next(token)
              } else {
                tokenRef.current = token
              }
            },
            'expired-callback': () => {
              tokenRef.current = ''
            },
            'error-callback': giveUp,
          })
          turnstileRef.current = { api, id }
        })
        .catch(() => {
          if (!cancelled) giveUp()
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
      waiters.splice(0).forEach((resolve) => resolve(''))
    }
  }, [])

  // Resolves with a fresh token, or '' if the check failed or took too long.
  const takeToken = () =>
    new Promise<string>((resolve) => {
      const token = tokenRef.current
      const widget = turnstileRef.current
      if (token && widget) {
        tokenRef.current = ''
        widget.api.reset(widget.id)
        resolve(token)
        return
      }
      if (checkFailedRef.current) {
        resolve('')
        return
      }
      const waiter = (value: string) => {
        window.clearTimeout(timer)
        resolve(value)
      }
      const timer = window.setTimeout(() => {
        waitersRef.current = waitersRef.current.filter((w) => w !== waiter)
        resolve('')
      }, TOKEN_TIMEOUT_MS)
      waitersRef.current.push(waiter)
    })

  const setCount = (id: string, votes: number) =>
    setFeatures((current) => current.map((f) => (f.id === id ? { ...f, votes } : f)))

  const setVotedFor = (id: string, on: boolean) =>
    setVoted((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      saveVotes(next)
      return next
    })

  const setBusy = (id: string, on: boolean) => {
    if (on) pendingRef.current.add(id)
    else pendingRef.current.delete(id)
    setPending(new Set(pendingRef.current))
  }

  const say = (text: string, nextTone: Tone = 'info') => {
    setTone(nextTone)
    setMessage(text)
  }

  const toggleVote = async (feature: Feature) => {
    if (pendingRef.current.has(feature.id)) return
    const removing = voted.has(feature.id)
    setBusy(feature.id, true)
    setMessage('')
    // Show the change straight away; it's rolled back if the server says no.
    setVotedFor(feature.id, !removing)
    setCount(feature.id, Math.max(0, feature.votes + (removing ? -1 : 1)))
    const rollBack = (text: string) => {
      setVotedFor(feature.id, removing)
      setCount(feature.id, feature.votes)
      say(text, 'error')
    }

    const token = await takeToken()
    if (!token) {
      rollBack(
        checkFailedRef.current
          ? 'The bot check couldn’t load, so your vote wasn’t sent. If you use a content blocker, allow challenges.cloudflare.com and reload the page.'
          : 'The bot check is taking too long. Please try again in a moment.',
      )
      setBusy(feature.id, false)
      return
    }

    const body: VoteRequest = { voterId: getVoterId(), turnstileToken: token }
    let result: ApiResult<VoteResponse> | null = null
    try {
      const response = await fetch(`/api/features/${encodeURIComponent(feature.id)}/vote`, {
        method: removing ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      result = (await response.json()) as ApiResult<VoteResponse>
    } catch {
      result = null
    }
    setBusy(feature.id, false)

    if (!result) {
      rollBack('Couldn’t reach the server, so your vote wasn’t saved. Check your connection and try again.')
      return
    }
    if (result.ok) {
      setVotedFor(feature.id, result.voted)
      setCount(feature.id, result.votes)
      const count = `${result.votes} ${result.votes === 1 ? 'vote' : 'votes'}`
      say(result.voted ? `Vote counted for ${feature.title}. ${count}.` : `Vote removed from ${feature.title}. ${count}.`)
      return
    }

    const { code } = result.error
    if (code === 'NOT_FOUND') {
      rollBack(`${feature.title} isn’t on the roadmap any more. The list has been refreshed.`)
      setRefresh((n) => n + 1)
    } else if (code === 'CONFLICT') {
      rollBack(`${feature.title} has already shipped, so voting on it is closed.`)
      setRefresh((n) => n + 1)
    } else if (code === 'TURNSTILE_FAILED') {
      rollBack('The bot check didn’t go through. Please try again.')
    } else if (code === 'RATE_LIMITED') {
      rollBack('Too many votes in a row. Wait a minute, then try again.')
    } else {
      rollBack('Something went wrong on our side, so your vote wasn’t saved. Please try again later.')
    }
  }

  const retry = () => {
    setList('loading')
    setRefresh((n) => n + 1)
  }

  return (
    <section ref={sectionRef} id="roadmap" className="roadmap" aria-labelledby="roadmap-title">
      <div className="roadmap__intro">
        <p className="mono roadmap__eyebrow roadmap__reveal">Roadmap</p>
        <h2 id="roadmap-title" className="roadmap__title roadmap__reveal">
          You pick what gets <em>built next</em>.
        </h2>
        <p className="roadmap__lede roadmap__reveal">
          Vote for the features you want most. The top of the list goes into the next build, and every step is
          shared on Instagram as it happens.
        </p>
      </div>

      <div className="roadmap__board roadmap__reveal">
        {list === 'loading' && (
          <>
            <p className="visually-hidden" role="status">
              Loading the roadmap…
            </p>
            <ul className="roadmap__list" aria-hidden="true">
              {[0, 1, 2, 3].map((n) => (
                <li key={n} className="roadmap__card roadmap__card--skeleton" />
              ))}
            </ul>
          </>
        )}

        {list === 'error' && (
          <div className="roadmap__banner" role="status">
            <span>Live roadmap data offline &middot; Showing planned roadmap preview</span>
            <button type="button" className="roadmap__banner-retry" onClick={retry}>
              Retry connection
            </button>
          </div>
        )}

        {list === 'ready' && features.length === 0 && (
          <p className="roadmap__problem">Nothing on the roadmap yet. Check back soon.</p>
        )}

        {(list === 'ready' || list === 'error') && features.length > 0 && (
          <ul className="roadmap__list">
            {features.map((feature) => {
              const isVoted = voted.has(feature.id)
              const isBusy = pending.has(feature.id) || list === 'error'
              const count = `${feature.votes} ${feature.votes === 1 ? 'vote' : 'votes'}`
              return (
                <li key={feature.id} className={`roadmap__card roadmap__card--${feature.status}`}>
                  <span className="mono roadmap__status">{STATUS_LABELS[feature.status]}</span>
                  <h3 className="roadmap__feature">{feature.title}</h3>
                  <p className="roadmap__desc">{feature.description}</p>
                  {feature.status === 'shipped' ? (
                    <p className="mono roadmap__shipped">{count} · Out now</p>
                  ) : (
                    <button
                      type="button"
                      className={`button roadmap__vote${isVoted ? ' is-voted' : ''}`}
                      aria-pressed={isVoted}
                      aria-disabled={isBusy || undefined}
                      disabled={list === 'error'}
                      onClick={() => toggleVote(feature)}
                    >
                      <svg className="roadmap__arrow" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M8 3l5 6H9.5v4h-3V9H3z" />
                      </svg>
                      <span className="visually-hidden">Vote for {feature.title}, </span>
                      <span>{count}</span>
                      {isVoted && <span className="roadmap__mine"> · Your vote</span>}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {/* Turnstile only draws here if Cloudflare needs the visitor to prove they're human. */}
        <div ref={widgetRef} className="roadmap__check" />

        <div className={`roadmap__message roadmap__message--${tone}`} role="status" aria-live="polite">
          {message}
        </div>

        <p className="roadmap__note">
          {checkFailed
            ? 'The bot check couldn’t load, so voting is paused. Reload the page to try again.'
            : 'One vote per feature per browser. Click again to take a vote back. No account, no tracking.'}
        </p>
      </div>
    </section>
  )
}
