import { Outlet } from 'react-router-dom'
import { t } from '@/i18n'

export function AuthLayout() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10 dark:bg-slate-950">
      <div className="w-full max-w-md">
        <h1 className="mb-6 text-center text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100">
          {t('app.name')}
        </h1>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
