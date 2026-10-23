import { Outlet } from 'react-router-dom'
import { ThemeToggle } from '@/components/ui'
import { Logo } from '@/components/brand/Logo'

export function AuthLayout() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10 dark:bg-slate-950">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <span className="w-9" aria-hidden="true" />
          <Logo className="text-brand-600 dark:text-brand-400" />
          <ThemeToggle />
        </div>
        <div className="rounded-xl border border-slate-200 bg-surface p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
