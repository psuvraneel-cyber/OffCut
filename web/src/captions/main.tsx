import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/instrument-serif/400.css'
import '@fontsource/instrument-serif/400-italic.css'
import '@fontsource-variable/inter'
import '@fontsource/jetbrains-mono/400.css'
import '../styles/tokens.css'
import '../styles/base.css'
import { CaptionsPage } from './CaptionsPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CaptionsPage />
  </StrictMode>,
)
