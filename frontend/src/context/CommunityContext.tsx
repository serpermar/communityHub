import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
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

function pickCommunity(
  communities: CommunitySummary[],
  detail: Community | null,
  communityId?: string,
): Community | null {
  if (!communityId) return null
  if (detail && detail.id === communityId) return detail
  return communities.find((item) => item.id === communityId) ?? null
}

/**
 * Lista las comunidades del usuario (selector) y resuelve la activa.
 *
 * El rol de la activa sale del backend (`memberRole`); nunca se deduce ni se
 * reutiliza entre comunidades.
 */
export function CommunityProvider({
  communityId,
  children,
}: {
  communityId?: string
  children: ReactNode
}) {
  const [communities, setCommunities] = useState<CommunitySummary[]>([])
  const [detail, setDetail] = useState<Community | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api.get<CommunitySummary[]>('/communities')
      setCommunities(list)
      setError(null)
    } catch (caught) {
      setError(ApiError.from(caught))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    setDetail(null)
    if (!communityId) return
    if (communities.some((item) => item.id === communityId)) return

    let activeRequest = true
    api
      .get<Community>(`/communities/${communityId}`)
      .then((value) => {
        if (activeRequest) setDetail(value)
      })
      .catch(() => {
        if (activeRequest) setDetail(null)
      })
    return () => {
      activeRequest = false
    }
  }, [communityId, communities])

  const active = useMemo(
    () => pickCommunity(communities, detail, communityId),
    [communities, detail, communityId],
  )

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
