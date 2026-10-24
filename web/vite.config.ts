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
})
