import type { ReactNode } from 'react'
import { RouterProvider } from 'react-router-dom'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AuthProvider } from '@/context/AuthContext'
import { ThemeProvider } from '@/context/ThemeContext'
import { ToastProvider } from '@/components/ui'
import { AuthTransition } from '@/components/auth/AuthTransition'
import { useAuth } from '@/context/AuthContext'
import { router } from '@/routes/router'
import { useEffect, useRef, useState } from 'react'

function AuthTransitionGate() {
  const { status } = useAuth()
  const prev = useRef(status)
  const [trigger, setTrigger] = useState(false)

  useEffect(() => {
    if (prev.current !== 'authenticated' && status === 'authenticated') {
      setTrigger(true)
      window.setTimeout(() => setTrigger(false), 1100)
    }
    prev.current = status
  }, [status])

  return <AuthTransition trigger={trigger} />
}

export function AppProviders({ children }: { children?: ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <ErrorBoundary>
            <AuthTransitionGate />
            {children ?? <RouterProvider router={router} />}
          </ErrorBoundary>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
