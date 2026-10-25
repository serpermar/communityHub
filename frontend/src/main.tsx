import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppProviders } from '@/app/providers'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('No se encontró el elemento #root')

createRoot(container).render(
  <StrictMode>
    <AppProviders />
  </StrictMode>,
)
