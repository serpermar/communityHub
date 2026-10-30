import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '@/services/ApiError'
import { api } from '@/services/http'
import type { Community, CommunitySummary } from '@/types/community'
import type { MemberRole } from '@/types/roles'

interface CommunityContextValue {
  communities: CommunitySummary[]
  active: Community | null
  role: MemberRole | null
  loading: boolean
  error: ApiError | null
  reload: () => Promise<void>
}

const CommunityContext = createContext<CommunityContextValue | null>(null)

export function CommunityProvider({
  communitySlug,
  children,
}: {
  communitySlug?: string
  children: ReactNode
}) {
  const navigate = useNavigate()
  const [communities, setCommunities] = useState<CommunitySummary[]>([])
  const [detail, setDetail] = useState<Community | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api.get<CommunitySummary[]>('/communities')
      setCommunities(list)

      if (communitySlug) {
        // Comprobamos si es un UUID antiguo para redirigir a la URL con slug
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          communitySlug,
        )

        if (isUuid) {
          const foundById = list.find((c) => c.id === communitySlug)
          if (foundById) {
            // Redirigimos a la URL amigable
            navigate(`/c/${foundById.slug}/dashboard`, { replace: true })
            return
          }
        }

        // Buscamos la comunidad por slug en la lista
        const found = list.find((c) => c.slug === communitySlug)
        if (found) {
          // Necesitamos el detalle completo (con memberRole)
          const fullDetail = await api.get<Community>(`/communities/${found.id}`)
          setDetail(fullDetail)
        } else {
          // CORRECCIÓN: Pasamos el status numérico Y el ApiErrorBody
          setError(
            new ApiError(404, {
              code: 'NOT_FOUND',
              message: 'No tienes acceso a esta comunidad o no existe.',
            }),
          )
          setDetail(null)
        }
      } else {
        setDetail(null)
      }
      setError(null)
    } catch (caught) {
      setError(ApiError.from(caught))
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }, [communitySlug, navigate])

  useEffect(() => {
    void reload()
  }, [reload])

  const active = useMemo(() => {
    if (detail) return detail
    if (!communitySlug) return null
    return communities.find((item) => item.slug === communitySlug) ?? null
  }, [communities, detail, communitySlug])

  const value = useMemo<CommunityContextValue>(
    () => ({
      communities,
      active,
      role: active?.memberRole ?? null,
      loading,
      error,
      reload,
    }),
    [communities, active, loading, error, reload],
  )

  return <CommunityContext.Provider value={value}>{children}</CommunityContext.Provider>
}

export function useCommunity(): CommunityContextValue {
  const context = useContext(CommunityContext)
  if (!context) throw new Error('useCommunity debe usarse dentro de <CommunityProvider>')
  return context
}
