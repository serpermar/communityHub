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
import { axisTickStyle, tooltipContentStyle, tooltipLabelStyle } from './dashboardChartStyles'
import styles from './DashboardPage.module.css'

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

  const tickStyle = axisTickStyle(colors)
  const tooltipContent = tooltipContentStyle(colors)
  const tooltipLabel = tooltipLabelStyle(colors)

  return (
    <div className={styles.page}>
      <PageHeader
        title={data.community.name}
        description={`${data.community.city} · ${data.community.memberCount} miembros (${data.community.neighborCount} vecinos)`}
      />

      <div className={styles.statsGrid}>
        <Stat label="Incidencias abiertas" value={data.incidents.open} />
        <Stat label="En progreso" value={data.incidents.inProgress} />
        <Stat label="Críticas" value={data.incidents.critical} tone="danger" />
        <Stat label="Reservas próximas" value={data.reservations.upcomingCount} />
        <Card>
          <p className={styles.statLabel}>Clima</p>
          {weather ? (
            <p className={styles.weatherValue}>
              {Math.round(weather.temperature)}°C
              <span className={styles.weatherFeels}>
                (sensación {Math.round(weather.apparentTemperature)}°C)
              </span>
            </p>
          ) : (
            <p className={styles.weatherEmpty}>No disponible</p>
          )}
        </Card>
      </div>

      <div className={styles.chartsGrid}>
        <Card title="Incidencias por categoría">
          {categoryData.length > 0 ? (
            <ChartFigure caption="Incidencias por categoría" data={categoryData}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.grid} />
                  <XAxis dataKey="name" tick={tickStyle} />
                  <YAxis allowDecimals={false} tick={tickStyle} />
                  <Tooltip contentStyle={tooltipContent} labelStyle={tooltipLabel} />
                  <Bar dataKey="total" fill={colors.bars.incidents} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartFigure>
          ) : (
            <p className={styles.emptyText}>Sin datos de incidencias.</p>
          )}
        </Card>

        <Card title="Reservas por mes">
          {reservationData.length > 0 ? (
            <ChartFigure caption="Reservas por mes" data={reservationData}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={reservationData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.grid} />
                  <XAxis dataKey="name" tick={tickStyle} />
                  <YAxis allowDecimals={false} tick={tickStyle} />
                  <Tooltip contentStyle={tooltipContent} labelStyle={tooltipLabel} />
                  <Bar dataKey="total" fill={colors.bars.reservations} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartFigure>
          ) : (
            <p className={styles.emptyText}>Sin datos de reservas.</p>
          )}
        </Card>
      </div>

      <div className={styles.listsGrid}>
        <Card
          title="Últimos avisos"
          actions={
            <Link to={`/c/${active!.id}/announcements`} className={styles.viewAllLink}>
              Ver todos
            </Link>
          }
        >
          {data.announcements.latest.length > 0 ? (
            <ul className={styles.list}>
              {data.announcements.latest.map((item) => (
                <li key={item.id}>
                  <Link to={`/c/${active!.id}/announcements`} className={styles.listLink}>
                    {item.title}
                  </Link>
                  <span className={styles.listMeta}>{formatDate(item.publishAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.emptyText}>No hay avisos.</p>
          )}
        </Card>

        <Card
          title="Votaciones abiertas"
          actions={
            <Link to={`/c/${active!.id}/votes`} className={styles.viewAllLink}>
              Ver todas
            </Link>
          }
        >
          {data.votes.open.length > 0 ? (
            <ul className={styles.list}>
              {data.votes.open.map((vote) => (
                <li key={vote.id}>
                  <Link to={`/c/${active!.id}/votes/${vote.id}`} className={styles.listLink}>
                    {vote.title}
                  </Link>
                  <span className={styles.listMeta}>Cierra {formatDateTime(vote.endsAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.emptyText}>No hay votaciones abiertas.</p>
          )}
        </Card>

        <Card
          title="Próximas reservas"
          actions={
            <Link to={`/c/${active!.id}/reservations`} className={styles.viewAllLink}>
              Ver todas
            </Link>
          }
        >
          {data.reservations.upcoming.length > 0 ? (
            <ul className={styles.list}>
              {data.reservations.upcoming.map((item) => (
                <li key={item.id}>
                  <span className={styles.listText}>{item.commonAreaName ?? 'Zona'}</span>
                  <span className={styles.listMeta}>{formatDateTime(item.startsAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.emptyText}>No hay reservas próximas.</p>
          )}
        </Card>
      </div>

      {data.finance && (
        <>
          <div className={styles.financeGrid}>
            <Stat label="Gasto total" value={`${data.finance.expenseTotal.toFixed(2)} €`} />
            <Stat
              label="Pendiente de pago"
              value={`${data.finance.invoiceOpenAmount.toFixed(2)} €`}
            />
            <Stat
              label="Facturas vencidas"
              value={data.finance.invoiceOverdueCount}
              tone="danger"
            />
          </div>

          <Card title={t('dashboard.expenseTrend')}>
            {expenseData.length > 0 ? (
              <ChartFigure caption={t('dashboard.expenseTrend')} data={expenseData}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={expenseData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.grid} />
                    <XAxis dataKey="name" tick={tickStyle} />
                    <YAxis tick={tickStyle} />
                    <Tooltip contentStyle={tooltipContent} labelStyle={tooltipLabel} />
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
              <p className={styles.emptyText}>Sin datos de gastos todavía.</p>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'danger' }) {
  return (
    <Card>
      <p className={styles.statLabel}>{label}</p>
      <p className={`${styles.statValue} ${tone === 'danger' ? styles.statValueDanger : ''}`}>
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
    <figure className={styles.figure}>
      <div className={styles.chartContainer}>{children}</div>
      <table className={styles.srOnly}>
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
