import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const page = (file: string) => fileURLToPath(new URL(file, import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // The legal pages are their own static HTML entries rather than client-side routes: they read with
    // JavaScript off, need no router, and Cloudflare Pages serves privacy.html at /privacy by itself.
    rolldownOptions: {
      input: {
        main: page('./index.html'),
        privacy: page('./privacy.html'),
        terms: page('./terms.html'),
      },
    },
  },
  css: {
    // Inline (empty) PostCSS config stops Vite from picking up stray postcss.config files
    // in parent folders (there is one at C:\ on the dev machine).
    postcss: {},
  },
  server: {
    // The API runs separately (`npm run dev:api`, port 8788). Proxying keeps calls same-origin;
    // the browser's Origin stays http://localhost:5173, which ALLOWED_ORIGINS already lists.
    proxy: { '/api': 'http://localhost:8788' },
  },
})
