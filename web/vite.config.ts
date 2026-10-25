import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
