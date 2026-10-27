import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, searchForWorkspaceRoot, type Plugin } from 'vite'

// ▼▼▼ OWNER: Cloudflare Web Analytics token (free, cookie-less). Empty = no analytics script at all.
// Get it from Cloudflare dashboard → Analytics & Logs → Web Analytics → Add a site. See docs/launch.md.
// It is public (it ships in the page), so committing it is fine. VITE_CF_ANALYTICS_TOKEN overrides it.
const CF_ANALYTICS_TOKEN = '7ef7c08bf32e4af6ad23a785b8269fd0'
// ▲▲▲

const page = (file: string) => fileURLToPath(new URL(file, import.meta.url))

// Adds Cloudflare's beacon to every HTML page in production builds, only when a token is set.
function cloudflareWebAnalytics(token: string): Plugin {
  if (token && !/^[0-9a-f]{32}$/i.test(token)) {
    throw new Error('CF_ANALYTICS_TOKEN should be the 32-character token from the Web Analytics snippet.')
  }
  return {
    name: 'offcut:cloudflare-web-analytics',
    apply: 'build',
    transformIndexHtml: () =>
      token
        ? [
            {
              tag: 'script',
              attrs: {
                defer: true,
                src: 'https://static.cloudflareinsights.com/beacon.min.js',
                'data-cf-beacon': JSON.stringify({ token }),
              },
              injectTo: 'body',
            },
          ]
        : [],
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    cloudflareWebAnalytics(loadEnv(mode, page('.')).VITE_CF_ANALYTICS_TOKEN || CF_ANALYTICS_TOKEN),
  ],
  resolve: {
    alias: {
      '@offcut/engine': fileURLToPath(new URL('../engine/src/index.ts', import.meta.url)),
      '@offcut/runtime': fileURLToPath(new URL('../runtime/src/index.ts', import.meta.url)),
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
  build: {
    // The legal pages are their own static HTML entries rather than client-side routes: they read with
    // JavaScript off, need no router, and Cloudflare Pages serves privacy.html at /privacy by itself.
    // 404.html is what Pages serves (with a 404 status) for any path that has no file.
    rolldownOptions: {
      input: {
        main: page('./index.html'),
        captions: page('./captions.html'),
        privacy: page('./privacy.html'),
        terms: page('./terms.html'),
        notFound: page('./404.html'),
      },
    },
  },
  css: {
    // Inline (empty) PostCSS config stops Vite from picking up stray postcss.config files
    // in parent folders (there is one at C:\ on the dev machine).
    postcss: {},
  },
  server: {
    fs: {
      allow: [
        searchForWorkspaceRoot(process.cwd()),
        fileURLToPath(new URL('../engine', import.meta.url)),
        fileURLToPath(new URL('../runtime', import.meta.url)),
      ],
    },
    // The API runs separately (`npm run dev:api`, port 8788). Proxying keeps calls same-origin;
    // the browser's Origin stays http://localhost:5173, which ALLOWED_ORIGINS already lists.
    proxy: { '/api': 'http://localhost:8788' },
  },
}))
