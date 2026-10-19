import type { ReactNode } from 'react'
import { RouterProvider } from 'react-router-dom'
import { AuthProvider } from '@/context/AuthContext'
import { ToastProvider } from '@/components/ui'
import { router } from '@/routes/router'

export function AppProviders({ children }: { children?: ReactNode }) {
  return (
    <AuthProvider>
      <ToastProvider>{children ?? <RouterProvider router={router} />}</ToastProvider>
    </AuthProvider>
  )
}
