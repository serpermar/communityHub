import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, ErrorState, LoadingState } from '@/components/ui'
import { useCommunity } from '@/context/CommunityContext'
import { useResource } from '@/hooks/useResource'
import { t } from '@/i18n'
import { formatDateTime } from '@/utils/format'
import { CATEGORY_LABELS } from '@/features/incidents/types'
import { getDashboard } from '../api'

export function DashboardPage() {
  const { active } = useCommunity()
  const dashboard = useResource(() => getDashboard(active!.id), [active?.id])

  if (dashboard.loading) return <LoadingState />
  if (dashboard.error) return <ErrorState error={dashboard.error} onRetry={dashboard.reload} />
  if (!dashboard.data) return null

  const data = dashboard.data
  const categoryData = data.incidents.byCategory.map((item) => ({
    name: CATEGORY_LABELS[item.category],
    total: item.count,
  }))
  const reservationData = data.reservations.byMonth.map((item) => ({
    name: item.month,
    total: item.count,
  }))
  const expenseData = (data.finance?.expensesByMonth ?? []).map((item) => ({
    name: item.month,
    total: item.total,
  }))

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">
          {data.community.name}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {data.community.city} · {data.community.memberCount} miembros (
          {data.community.neighborCount} vecinos)
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Incidencias abiertas" value={data.incidents.open} />
        <Stat label="En progreso" value={data.incidents.inProgress} />
        <Stat
          label="Críticas"
          value={data.incidents.critical}
          tone="text-red-600 dark:text-red-400"
        />
        <Stat label="Reservas próximas" value={data.reservations.upcomingCount} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Incidencias por categoría">
          {categoryData.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="total" fill="#2563eb" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">Sin datos de incidencias.</p>
          )}
        </Card>

        <Card title="Reservas por mes">
          {reservationData.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={reservationData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="total" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">Sin datos de reservas.</p>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Últimos avisos">
          {data.announcements.latest.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {data.announcements.latest.map((item) => (
                <li key={item.id} className="text-slate-700 dark:text-slate-200">
                  {item.title}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">No hay avisos.</p>
          )}
        </Card>

        <Card title="Votaciones abiertas">
          {data.votes.open.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {data.votes.open.map((vote) => (
                <li key={vote.id} className="text-slate-700 dark:text-slate-200">
                  {vote.title}
                  <span className="block text-xs text-slate-400 dark:text-slate-500">
                    Cierra {formatDateTime(vote.endsAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No hay votaciones abiertas.
            </p>
          )}
        </Card>

        <Card title="Próximas reservas">
          {data.reservations.upcoming.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {data.reservations.upcoming.map((item) => (
                <li key={item.id} className="text-slate-700 dark:text-slate-200">
                  {item.commonAreaName ?? 'Zona'}
                  <span className="block text-xs text-slate-400 dark:text-slate-500">
                    {formatDateTime(item.startsAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">No hay reservas próximas.</p>
          )}
        </Card>
      </div>

      {data.finance && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Gasto total" value={`${data.finance.expenseTotal.toFixed(2)} €`} />
            <Stat
              label="Pendiente de pago"
              value={`${data.finance.invoiceOpenAmount.toFixed(2)} €`}
            />
            <Stat
              label="Facturas vencidas"
              value={data.finance.invoiceOverdueCount}
              tone="text-red-600 dark:text-red-400"
            />
          </div>

          <Card title={t('dashboard.expenseTrend')}>
            {expenseData.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={expenseData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="total"
                      stroke="#7c3aed"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Sin datos de gastos todavía.
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <Card>
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone ?? 'text-slate-800 dark:text-slate-100'}`}>
        {value}
      </p>
    </Card>
  )
}
