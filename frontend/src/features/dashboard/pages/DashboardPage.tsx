import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
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
import { Card, ErrorState, PageHeader, SkeletonDashboard } from '@/components/ui'
import { useCommunity } from '@/context/CommunityContext'
import { useResource } from '@/hooks/useResource'
import { t } from '@/i18n'
import { formatDate, formatDateTime } from '@/utils/format'
import { CATEGORY_LABELS } from '@/features/incidents/types'
import { useChartColors } from '@/hooks/useChartColors'
import { getDashboard, getWeather } from '../api'
import { useEffect, useState } from 'react'
import type { CurrentWeather } from '../types'

export function DashboardPage() {
  const { active } = useCommunity()
  const colors = useChartColors()
  const dashboard = useResource(() => getDashboard(active!.id), [active?.id])
  const [weather, setWeather] = useState<CurrentWeather | null>(null)

  useEffect(() => {
    if (!active?.id) return
    // Coordenadas opcionales - se puede extender con datos de comunidad
    getWeather(active.id, { lat: 40.4168, lon: -3.7038 })
      .then(setWeather)
      .catch(() => setWeather(null))
  }, [active?.id])

  if (dashboard.loading) return <SkeletonDashboard />
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
      <PageHeader
        title={data.community.name}
        description={`${data.community.city} · ${data.community.memberCount} miembros (${data.community.neighborCount} vecinos)`}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Incidencias abiertas" value={data.incidents.open} />
        <Stat label="En progreso" value={data.incidents.inProgress} />
        <Stat
          label="Críticas"
          value={data.incidents.critical}
          tone="text-red-600 dark:text-red-400"
        />
        <Stat label="Reservas próximas" value={data.reservations.upcomingCount} />
        <Card>
          <p className="text-sm text-slate-500 dark:text-slate-400">Clima</p>
          {weather ? (
            <p className="mt-1 text-lg font-semibold text-slate-800 dark:text-slate-100">
              {Math.round(weather.temperature)}°C
              <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">
                (sensación {Math.round(weather.apparentTemperature)}°C)
              </span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-400 dark:text-slate-500">No disponible</p>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Incidencias por categoría">
          {categoryData.length > 0 ? (
            <ChartFigure caption="Incidencias por categoría" data={categoryData}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.grid} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: colors.axis }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: colors.axis }} />
                  <Tooltip
                    contentStyle={{
                      background: colors.tooltipBg,
                      border: `1px solid ${colors.tooltipBorder}`,
                      borderRadius: 8,
                      color: colors.tooltipText,
                    }}
                    labelStyle={{ color: colors.tooltipText }}
                  />
                  <Bar dataKey="total" fill={colors.bars.incidents} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartFigure>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">Sin datos de incidencias.</p>
          )}
        </Card>

        <Card title="Reservas por mes">
          {reservationData.length > 0 ? (
            <ChartFigure caption="Reservas por mes" data={reservationData}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={reservationData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.grid} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: colors.axis }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: colors.axis }} />
                  <Tooltip
                    contentStyle={{
                      background: colors.tooltipBg,
                      border: `1px solid ${colors.tooltipBorder}`,
                      borderRadius: 8,
                      color: colors.tooltipText,
                    }}
                    labelStyle={{ color: colors.tooltipText }}
                  />
                  <Bar dataKey="total" fill={colors.bars.reservations} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartFigure>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">Sin datos de reservas.</p>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          title="Últimos avisos"
          actions={
            <Link
              to={`/c/${active!.id}/announcements`}
              className="text-sm text-brand-600 hover:underline dark:text-brand-400"
            >
              Ver todos
            </Link>
          }
        >
          {data.announcements.latest.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {data.announcements.latest.map((item) => (
                <li key={item.id}>
                  <Link
                    to={`/c/${active!.id}/announcements`}
                    className="text-slate-700 hover:underline dark:text-slate-200"
                  >
                    {item.title}
                  </Link>
                  <span className="block text-xs text-slate-400 dark:text-slate-500">
                    {formatDate(item.publishAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">No hay avisos.</p>
          )}
        </Card>

        <Card
          title="Votaciones abiertas"
          actions={
            <Link
              to={`/c/${active!.id}/votes`}
              className="text-sm text-brand-600 hover:underline dark:text-brand-400"
            >
              Ver todas
            </Link>
          }
        >
          {data.votes.open.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {data.votes.open.map((vote) => (
                <li key={vote.id}>
                  <Link
                    to={`/c/${active!.id}/votes/${vote.id}`}
                    className="text-slate-700 hover:underline dark:text-slate-200"
                  >
                    {vote.title}
                  </Link>
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

        <Card
          title="Próximas reservas"
          actions={
            <Link
              to={`/c/${active!.id}/reservations`}
              className="text-sm text-brand-600 hover:underline dark:text-brand-400"
            >
              Ver todas
            </Link>
          }
        >
          {data.reservations.upcoming.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {data.reservations.upcoming.map((item) => (
                <li key={item.id}>
                  <span className="text-slate-700 dark:text-slate-200">
                    {item.commonAreaName ?? 'Zona'}
                  </span>
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
              <ChartFigure caption={t('dashboard.expenseTrend')} data={expenseData}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={expenseData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.grid} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: colors.axis }} />
                    <YAxis tick={{ fontSize: 11, fill: colors.axis }} />
                    <Tooltip
                      contentStyle={{
                        background: colors.tooltipBg,
                        border: `1px solid ${colors.tooltipBorder}`,
                        borderRadius: 8,
                        color: colors.tooltipText,
                      }}
                      labelStyle={{ color: colors.tooltipText }}
                    />
                    <Line
                      type="monotone"
                      dataKey="total"
                      stroke={colors.line}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartFigure>
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

/**
 * Envuelve un gráfico de Recharts en una `<figure>` con altura fija y una tabla
 * de datos visualmente oculta (`sr-only`). Recharts renderiza `<svg>` sin texto
 * accesible, así que un lector de pantalla no obtiene nada del gráfico; la tabla
 * da las mismas cifras en formato lineal.
 */
function ChartFigure({
  caption,
  data,
  children,
}: {
  caption: string
  data: { name: string; total: number }[]
  children: ReactNode
}) {
  return (
    <figure className="m-0">
      <div className="h-64">{children}</div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Categoría</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.name}>
              <th scope="row">{row.name}</th>
              <td>{row.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
