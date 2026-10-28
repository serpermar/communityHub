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
  Bot,
  AlertCircle,
  FileText,
  Sparkles,
  Clock,
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

  // Lógica para Action Center (Requiere tu atención)
  const hasUrgentInvoices = data.finance && data.finance.invoiceOverdueCount > 0
  const hasCriticalIncidents = data.incidents.critical > 0
  const needsAttention = hasUrgentInvoices || hasCriticalIncidents

  // Lógica para Activity Feed (Simulada combinando datos existentes)
  const activityFeed = [
    ...data.announcements.latest.map((a) => ({
      id: a.id,
      type: 'announcement',
      icon: <Megaphone size={12} />,
      text: (
        <>
          Nuevo aviso: <strong>{a.title}</strong>
        </>
      ),
      date: new Date(a.publishAt),
      link: `/c/${active!.id}/announcements`,
    })),
    ...data.votes.open.map((v) => ({
      id: v.id,
      type: 'vote',
      icon: <Vote size={12} />,
      text: (
        <>
          Votación abierta: <strong>{v.title}</strong>
        </>
      ),
      date: new Date(v.endsAt),
      link: `/c/${active!.id}/votes/${v.id}`,
    })),
  ]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 4)

  const handleCategoryClick = (entry: CategoryClickEvent) => {
    if (entry && entry.activePayload && entry.activePayload.length > 0) {
      const catId = entry.activePayload[0].payload.id
      navigate(`/c/${active!.id}/incidents?category=${catId}`)
    }
  }

  const openAiWithPrompt = (prompt: string) => {
    window.dispatchEvent(
      new CustomEvent('open-ai-assistant', { detail: { initialMessage: prompt } }),
    )
  }

  return (
    <div className={styles.page}>
      <div className={`${styles.greeting} ${styles.animateIn}`} style={{ animationDelay: '0ms' }}>
        {getGreeting()},{' '}
        <span className={styles.greetingName}>{user?.fullName?.split(' ')[0] ?? 'vecino'}</span>.
        Hoy es {format(new Date(), "d 'de' MMMM", { locale: es })}.
      </div>

      {/* 1. ACTION CENTER (Requiere tu atención) */}
      {needsAttention && (
        <div
          className={`${styles.actionCenter} ${styles.animateIn}`}
          style={{ animationDelay: '40ms' }}
        >
          <h3 className={styles.actionCenterTitle}>
            <AlertCircle size={18} /> Requiere tu atención
          </h3>
          <ul className={styles.actionList}>
            {hasUrgentInvoices && (
              <li className={styles.actionItem}>
                <span>Tienes {data.finance!.invoiceOverdueCount} facturas vencidas.</span>
                <Link
                  to={`/c/${active!.id}/finance?tab=invoices&status=OVERDUE`}
                  className={styles.actionLink}
                >
                  Revisar
                </Link>
              </li>
            )}
            {hasCriticalIncidents && (
              <li className={styles.actionItem}>
                <span>Hay {data.incidents.critical} incidencias críticas sin resolver.</span>
                <Link
                  to={`/c/${active!.id}/incidents?priority=CRITICAL`}
                  className={styles.actionLink}
                >
                  Atender
                </Link>
              </li>
            )}
          </ul>
        </div>
      )}

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

      {/* 2. KPIs CON COLORES SEMÁNTICOS */}
      <div
        className={`${styles.statsGrid} ${styles.animateIn}`}
        style={{ animationDelay: '100ms' }}
      >
        <Stat
          label="Incidencias abiertas"
          value={data.incidents.open}
          accentClass={styles.accentIncidents}
          onClick={() => navigate(`/c/${active!.id}/incidents?status=OPEN`)}
        />
        <Stat
          label="En progreso"
          value={data.incidents.inProgress}
          accentClass={styles.accentIncidents}
          onClick={() => navigate(`/c/${active!.id}/incidents?status=IN_PROGRESS`)}
        />
        <Stat
          label="Críticas"
          value={data.incidents.critical}
          tone="danger"
          accentClass={styles.accentIncidents}
          onClick={() => navigate(`/c/${active!.id}/incidents?priority=CRITICAL`)}
        />
        <Stat
          label="Reservas próximas"
          value={data.reservations.upcomingCount}
          accentClass={styles.accentReservations}
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
                  {/* Color Rose para incidencias */}
                  <Bar dataKey="total" fill="#f43f5e" radius={[4, 4, 0, 0]} maxBarSize={64} />
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
                  {/* Color Sky para reservas */}
                  <Bar dataKey="total" fill="#0ea5e9" radius={[4, 4, 0, 0]} maxBarSize={64} />
                </BarChart>
              </ResponsiveContainer>
            </ChartFigure>
          ) : (
            <p className={styles.emptyText}>Sin datos de reservas.</p>
          )}
        </Card>
      </div>

      {/* 3. ACTIVITY FEED Y ASISTENTE IA */}
      <div
        className={`${styles.listsGrid} ${styles.animateIn}`}
        style={{ animationDelay: '200ms' }}
      >
        {/* Activity Feed */}
        <Card title="Actividad reciente">
          {activityFeed.length > 0 ? (
            <ul className={styles.activityList}>
              {activityFeed.map((item) => (
                <li key={item.id} className={styles.activityItem}>
                  <div className={styles.activityIconWrapper}>{item.icon}</div>
                  <div className={styles.activityContent}>
                    <p className={styles.activityText}>{item.text}</p>
                    <span className={styles.activityTime}>
                      <Clock size={10} style={{ display: 'inline', marginRight: 4 }} />
                      {formatDistanceToNow(item.date, { addSuffix: true, locale: es })}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.emptyText}>No hay actividad reciente.</p>
          )}
        </Card>

        {/* Próximas reservas */}
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

        {/* 4. ACCESOS RÁPIDOS IA */}
        <Card title="Asistente IA" className={styles.aiCard}>
          <p className={styles.emptyText} style={{ marginBottom: '0.5rem' }}>
            ¿En qué te puedo ayudar hoy?
          </p>
          <div className={styles.aiButtons}>
            <button
              className={styles.aiButton}
              onClick={() => openAiWithPrompt('Resume las últimas incidencias de la comunidad.')}
            >
              <Sparkles size={14} /> Resumir incidencias
            </button>
            <button
              className={styles.aiButton}
              onClick={() =>
                openAiWithPrompt(
                  'Redacta un borrador de aviso para la comunidad sobre el mantenimiento del ascensor.',
                )
              }
            >
              <FileText size={14} /> Redactar aviso
            </button>
            <button
              className={styles.aiButton}
              onClick={() =>
                openAiWithPrompt('¿Cuál es el estado actual de las finanzas de la comunidad?')
              }
            >
              <Bot size={14} /> Consultar finanzas
            </button>
          </div>
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
              accentClass={styles.accentFinance}
              onClick={() => navigate(`/c/${active!.id}/finance?tab=expenses`)}
            />
            <Stat
              label="Pendiente de pago"
              value={`${data.finance.invoiceOpenAmount.toFixed(2)} €`}
              accentClass={styles.accentFinance}
              onClick={() => navigate(`/c/${active!.id}/finance?tab=invoices`)}
            />
            <Stat
              label="Facturas vencidas"
              value={data.finance.invoiceOverdueCount}
              tone="danger"
              accentClass={styles.accentFinance}
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
                    {/* Color Emerald para finanzas */}
                    <Line
                      type="monotone"
                      dataKey="total"
                      stroke="#10b981"
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
  accentClass,
}: {
  label: string
  value: number | string
  tone?: 'danger'
  trend?: { value: number; isPositive: boolean }
  onClick?: () => void
  accentClass?: string
}) {
  const inner = (
    <Card className={accentClass}>
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
