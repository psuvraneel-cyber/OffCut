// Cloudflare Turnstile, the free bot check in front of every write endpoint.
// Cloudflare requires the script to load from its own domain (it can't be self-hosted).

// Cloudflare's published test key: always passes, and pairs with the test secret in .dev.vars.
const TEST_SITE_KEY = '1x00000000000000000000AA'

// ▼▼▼ REAL SITE KEY GOES HERE before going live (Cloudflare dashboard → Turnstile → your widget).
// It is public, so committing it is fine. The matching secret goes in `wrangler pages secret put`.
const PRODUCTION_SITE_KEY = '0x4AAAAAAFlSUPGEQA5xITXn'
// ▲▲▲

const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)

// Local builds (Vite on :5173 and `npm run dev:api` on :8788) always use the test key.
// VITE_TURNSTILE_SITE_KEY overrides both, e.g. for a preview deployment with its own widget.
export const TURNSTILE_SITE_KEY: string =
  import.meta.env.VITE_TURNSTILE_SITE_KEY ||
  (isLocalHost || !PRODUCTION_SITE_KEY ? TEST_SITE_KEY : PRODUCTION_SITE_KEY)

if (!isLocalHost && TURNSTILE_SITE_KEY === TEST_SITE_KEY) {
  console.warn('Turnstile: using the test site key. Set PRODUCTION_SITE_KEY in src/lib/turnstile.ts.')
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

export interface TurnstileOptions {
  sitekey: string
  theme?: 'light' | 'dark' | 'auto'
  size?: 'normal' | 'flexible' | 'compact'
  action?: string
  // 'interaction-only' keeps the widget hidden unless Cloudflare needs the visitor to click it.
  appearance?: 'always' | 'execute' | 'interaction-only'
  callback?: (token: string) => void
  'expired-callback'?: () => void
  'error-callback'?: () => void
}

export interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileOptions) => string
  reset: (widgetId: string) => void
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let loading: Promise<TurnstileApi> | null = null

// Loads the script once, however many widgets ask for it.
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile missing')))
    script.onerror = () => {
      // Let a later attempt try again (flaky network, blocker turned off).
      loading = null
      script.remove()
      reject(new Error('Turnstile failed to load'))
    }
    document.head.append(script)
  })
  return loading
}
