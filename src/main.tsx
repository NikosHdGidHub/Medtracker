import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const base = import.meta.env.BASE_URL
    void navigator.serviceWorker.register(base + 'sw.js', { scope: base, updateViaCache: 'none' })
      .catch(() => { /* The online application works without the static cache. */ })
  })
}
