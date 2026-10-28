import { useEffect, useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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
import { format, formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  Sun,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudLightning,
  CloudFog,
  CloudDrizzle,
  Plus,
  AlertTriangle,
  Megaphone,
  Vote,
} from 'lucide-react'
import { Card, ErrorState, PageHeader, SkeletonDashboard, Button } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import { useCommunity } from '@/context/CommunityContext'
import { useResource } from '@/hooks/useResource'
import { t } from '@/i18n'
import { CATEGORY_LABELS } from '@/features/incidents/types'
import { useChartColors } from '@/hooks/useChartColors'
import { isManager } from '@/types/roles'
import { getDashboard, getWeather } from '../api'
import type { CurrentWeather } from '../types'
import { axisTickStyle } from './dashboardChartStyles'
import styles from './DashboardPage.module.css'

// --- Tipos para evitar el `any` y pasar la regla de ESLint ---
interface CustomTooltipProps {
  active?: boolean
  payload?: Array<{ value: number | string }>
  label?: string
}

interface CategoryClickEvent {
  activePayload?: Array<{ payload: { id: string } }>
}

function getWeatherIcon(condition?: string) {
  switch (condition) {
    case 'CLEAR':
    case 'MAINLY_CLEAR':
      return <Sun className={styles.weatherIcon} />
    case 'PARTLY_CLOUDY':
    case 'OVERCAST':
      return <Cloud className={styles.weatherIcon} />
    case 'FOG':
      return <CloudFog className={styles.weatherIcon} />
    case 'DRIZZLE':
      return <CloudDrizzle className={styles.weatherIcon} />
    case 'RAIN':
    case 'RAIN_SHOWERS':
    case 'FREEZING_RAIN':
      return <CloudRain className={styles.weatherIcon} />
    case 'SNOW':
    case 'SNOW_SHOWERS':
      return <CloudSnow className={styles.weatherIcon} />
    case 'THUNDERSTORM':
      return <CloudLightning className={styles.weatherIcon} />
    default:
      return <Sun className={styles.weatherIcon} />
  }
}

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Buenos días'
  if (hour < 20) return 'Buenas tardes'
  return 'Buenas noches'
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || !payload.length) return null
  return (
    <div className={styles.customTooltip}>
      <p className={styles.tooltipLabel}>{label}</p>
      <p className={styles.tooltipValue}>
        Total: <strong>{payload[0].value}</strong>
      </p>
    </div>
  )
}

export function DashboardPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { active, role } = useCommunity()
  const colors = useChartColors()
  const dashboard = useResource(() => getDashboard(active!.id), [active?.id])
  const [weather, setWeather] = useState<CurrentWeather | null>(null)

  const isAdmin = isManager(role)

  const [isActionsOpen, setIsActionsOpen] = useState(false)
  const actionsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!active?.id) return
    getWeather(active.id, { lat: 40.4168, lon: -3.7038 })
      .then(setWeather)
      .catch(() => setWeather(null))
  }, [active?.id])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(event.target as Node)) {
        setIsActionsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (dashboard.loading) return <SkeletonDashboard />
  if (dashboard.error) return <ErrorState error={dashboard.error} onRetry={dashboard.reload} />
  if (!dashboard.data) return null

  const data = dashboard.data

  const categoryData = data.incidents.byCategory.map((item) => ({
    id: item.category,
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

  const handleCategoryClick = (entry: CategoryClickEvent) => {
    if (entry && entry.activePayload && entry.activePayload.length > 0) {
      const catId = entry.activePayload[0].payload.id
      navigate(`/c/${active!.id}/incidents?category=${catId}`)
    }
  }

  return (
    <div className={styles.page}>
      <div className={`${styles.greeting} ${styles.animateIn}`} style={{ animationDelay: '0ms' }}>
        {getGreeting()},{' '}
        <span className={styles.greetingName}>{user?.fullName?.split(' ')[0] ?? 'vecino'}</span>.
        Hoy es {format(new Date(), "d 'de' MMMM", { locale: es })}.
      </div>

      <div className={styles.animateIn} style={{ animationDelay: '50ms' }}>
        <PageHeader
          title={data.community.name}
          description={`${data.community.city} · ${data.community.memberCount} miembros (${data.community.neighborCount} vecinos)`}
          actions={
            <div className={styles.quickActions} ref={actionsRef}>
              <Button
                className={styles.actionButton}
                onClick={() => setIsActionsOpen(!isActionsOpen)}
              >
                <Plus size={16} /> Nueva acción
              </Button>
              {isActionsOpen && (
                <div className={styles.dropdown}>
                  <button
                    className={styles.dropdownItem}
                    onClick={() => {
                      setIsActionsOpen(false)
                      navigate(`/c/${active!.id}/incidents/new`)
                    }}
                  >
                    <AlertTriangle size={16} /> Reportar incidencia
                  </button>

                  {isAdmin && (
                    <>
                      <button
                        className={styles.dropdownItem}
                        onClick={() => {
                          setIsActionsOpen(false)
                          navigate(`/c/${active!.id}/announcements`)
                        }}
                      >
                        <Megaphone size={16} /> Publicar aviso
                      </button>
                      <button
                        className={styles.dropdownItem}
                        onClick={() => {
                          setIsActionsOpen(false)
                          navigate(`/c/${active!.id}/votes/new`)
                        }}
                      >
                        <Vote size={16} /> Crear votación
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          }
        />
      </div>

      <div
        className={`${styles.statsGrid} ${styles.animateIn}`}
        style={{ animationDelay: '100ms' }}
      >
        <Stat
          label="Incidencias abiertas"
          value={data.incidents.open}
          onClick={() => navigate(`/c/${active!.id}/incidents?status=OPEN`)}
        />
        <Stat
          label="En progreso"
          value={data.incidents.inProgress}
          onClick={() => navigate(`/c/${active!.id}/incidents?status=IN_PROGRESS`)}
        />
        <Stat
          label="Críticas"
          value={data.incidents.critical}
          tone="danger"
          onClick={() => navigate(`/c/${active!.id}/incidents?priority=CRITICAL`)}
        />
        <Stat
          label="Reservas próximas"
          value={data.reservations.upcomingCount}
          onClick={() => navigate(`/c/${active!.id}/reservations`)}
        />

        <Card>
          <p className={styles.statLabel}>Clima</p>
          {weather && typeof weather.current?.temperatureC === 'number' ? (
            <div className={styles.weatherContainer}>
              <div>
                <p className={styles.weatherValue}>
                  {Math.round(weather.current.temperatureC)}°C
                  {weather.current.apparentTemperatureC !== null && (
                    <span className={styles.weatherFeels}>
                      ({Math.round(weather.current.apparentTemperatureC)}°C)
                    </span>
                  )}
                </p>
              </div>
              {getWeatherIcon(weather.current.condition)}
            </div>
          ) : (
            <p className={styles.weatherEmpty}>No disponible</p>
          )}
        </Card>
      </div>

      <div
        className={`${styles.chartsGrid} ${styles.animateIn}`}
        style={{ animationDelay: '150ms' }}
      >
        <Card title="Incidencias por categoría">
          {categoryData.length > 0 ? (
            <ChartFigure caption="Incidencias por categoría" data={categoryData}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={categoryData}
                  onClick={handleCategoryClick}
                  style={{ cursor: 'pointer' }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.grid} />
                  <XAxis dataKey="name" tick={tickStyle} />
                  <YAxis allowDecimals={false} tick={tickStyle} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'transparent' }} />
                  <Bar
                    dataKey="total"
                    fill={colors.bars.incidents}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={64}
                  />
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
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'transparent' }} />
                  <Bar
                    dataKey="total"
                    fill={colors.bars.reservations}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={64}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartFigure>
          ) : (
            <p className={styles.emptyText}>Sin datos de reservas.</p>
          )}
        </Card>
      </div>

      <div
        className={`${styles.listsGrid} ${styles.animateIn}`}
        style={{ animationDelay: '200ms' }}
      >
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
                  <span className={styles.listMeta}>
                    {formatDistanceToNow(new Date(item.publishAt), {
                      addSuffix: true,
                      locale: es,
                    })}
                  </span>
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
                  <span className={styles.listMeta}>
                    Cierra{' '}
                    {formatDistanceToNow(new Date(vote.endsAt), { addSuffix: true, locale: es })}
                  </span>
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
                  <span className={styles.listMeta}>
                    {formatDistanceToNow(new Date(item.startsAt), {
                      addSuffix: true,
                      locale: es,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className={styles.emptyList}>
              <p className={styles.emptyListText}>No hay reservas próximas.</p>
              <Link to={`/c/${active!.id}/common-areas`} className={styles.inlineLink}>
                + Reservar zona común
              </Link>
            </div>
          )}
        </Card>
      </div>

      {data.finance && (
        <div
          className={styles.animateIn}
          style={{ animationDelay: '250ms', display: 'flex', flexDirection: 'column', gap: '1rem' }}
        >
          <div className={styles.financeGrid}>
            <Stat
              label="Gasto total"
              value={`${data.finance.expenseTotal.toFixed(2)} €`}
              trend={{ value: -12, isPositive: false }}
              onClick={() => navigate(`/c/${active!.id}/finance?tab=expenses`)}
            />
            <Stat
              label="Pendiente de pago"
              value={`${data.finance.invoiceOpenAmount.toFixed(2)} €`}
              onClick={() => navigate(`/c/${active!.id}/finance?tab=invoices`)}
            />
            <Stat
              label="Facturas vencidas"
              value={data.finance.invoiceOverdueCount}
              tone="danger"
              onClick={() => navigate(`/c/${active!.id}/finance?tab=invoices&status=OVERDUE`)}
            />
          </div>

          <Card title={t('dashboard.expenseTrend')}>
            {expenseData.length >= 3 ? (
              <ChartFigure caption={t('dashboard.expenseTrend')} data={expenseData}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={expenseData}
                    onClick={() => navigate(`/c/${active!.id}/finance?tab=expenses`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.grid} />
                    <XAxis dataKey="name" tick={tickStyle} />
                    <YAxis tick={tickStyle} />
                    <Tooltip content={<CustomTooltip />} />
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
              <div className={styles.chartEmpty}>
                <p>Aún no hay suficiente historial para mostrar una tendencia.</p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate(`/c/${active!.id}/finance?tab=expenses`)}
                >
                  Ir a Finanzas
                </Button>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
  trend,
  onClick,
}: {
  label: string
  value: number | string
  tone?: 'danger'
  trend?: { value: number; isPositive: boolean }
  onClick?: () => void
}) {
  const inner = (
    <Card>
      <p className={styles.statLabel}>{label}</p>
      <p className={`${styles.statValue} ${tone === 'danger' ? styles.statValueDanger : ''}`}>
        {value}
      </p>
      {trend && (
        <div
          className={`${styles.statTrend} ${trend.isPositive ? styles.trendUp : styles.trendDown}`}
        >
          {trend.isPositive ? '↑' : '↓'} {Math.abs(trend.value)}% vs mes anterior
        </div>
      )}
    </Card>
  )

  if (!onClick) return inner

  return (
    <div
      className={styles.statClickableWrapper}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {inner}
    </div>
  )
}

function ChartFigure({
  caption,
  data,
  children,
}: {
  caption: string
  data: { name: string; total: number }[]
  children: React.ReactNode
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
