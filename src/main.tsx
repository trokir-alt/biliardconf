import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { keepAppFresh } from './lib/updates'

keepAppFresh()

const host = document.getElementById('root')
if (!host) throw new Error('#root not found')

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
