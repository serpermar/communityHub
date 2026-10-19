import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api } from '@/services/http'
import { refreshSession, setAccessToken, subscribeAccessToken } from '@/services/session'
import type { AuthUser } from '@/types/auth'

type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

export interface LoginCredentials {
  email: string
  password: string
}

export interface RegisterInput {
  email: string
  password: string
  fullName: string
  phone?: string
}

interface AuthContextValue {
  status: AuthStatus
  user: AuthUser | null
  isAuthenticated: boolean
  isPlatformAdmin: boolean
  login: (credentials: LoginCredentials) => Promise<AuthUser>
  register: (input: RegisterInput) => Promise<{ message: string }>
  logout: () => Promise<void>
  reload: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)

  const loadMe = useCallback(async () => {
    const me = await api.get<AuthUser>('/auth/me')
    setUser(me)
    setStatus('authenticated')
    return me
  }, [])

  // Al montar: intenta recuperar la sesion con la cookie de refresh (FE-2bis).
  useEffect(() => {
    let active = true
    void (async () => {
      const token = await refreshSession()
      if (!active) return
      if (!token) {
        setStatus('anonymous')
        return
      }
      try {
        await loadMe()
      } catch {
        if (active) {
          setAccessToken(null)
          setStatus('anonymous')
        }
      }
    })()
    return () => {
      active = false
    }
  }, [loadMe])

  // Si el interceptor pierde la sesion (refresh fallido), el token pasa a `null`.
  useEffect(
    () =>
      subscribeAccessToken((token) => {
        if (!token) {
          setUser(null)
          setStatus('anonymous')
        }
      }),
    [],
  )

  const login = useCallback(async (credentials: LoginCredentials) => {
    const result = await api.post<{ accessToken: string; user: AuthUser }>(
      '/auth/login',
      credentials,
    )
    setAccessToken(result.accessToken)
    setUser(result.user)
    setStatus('authenticated')
    return result.user
  }, [])

  const register = useCallback(async (input: RegisterInput) => {
    return api.post<{ user: AuthUser; message: string }>('/auth/register', input)
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout')
    } catch {
      // Cerrar la sesion local no debe depender de que el servidor responda.
    }
    setAccessToken(null)
    setUser(null)
    setStatus('anonymous')
  }, [])

  const reload = useCallback(async () => {
    await loadMe()
  }, [loadMe])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      isAuthenticated: status === 'authenticated',
      isPlatformAdmin: user?.globalRole === 'ADMIN_SA',
      login,
      register,
      logout,
      reload,
    }),
    [status, user, login, register, logout, reload],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return context
}
