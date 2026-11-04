import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

const DENSITY_KEY = 'communityhub.density'

type Density = 'comfortable' | 'compact'

interface DensityContextValue {
  density: Density
  setDensity: (density: Density) => void
  toggleDensity: () => void
  isCompact: boolean
}

const DensityContext = createContext<DensityContextValue | null>(null)

export function DensityProvider({ children }: { children: ReactNode }) {
  const [density, setDensityState] = useState<Density>(() => {
    if (typeof window === 'undefined') return 'comfortable'
    const stored = window.localStorage.getItem(DENSITY_KEY)
    return stored === 'compact' ? 'compact' : 'comfortable'
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(DENSITY_KEY, density)
  }, [density])

  const setDensity = (next: Density) => {
    setDensityState(next)
  }

  const toggleDensity = () => {
    setDensityState((current) => (current === 'comfortable' ? 'compact' : 'comfortable'))
  }

  const value: DensityContextValue = {
    density,
    setDensity,
    toggleDensity,
    isCompact: density === 'compact',
  }

  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>
}

export function useDensity() {
  const context = useContext(DensityContext)
  if (!context) {
    throw new Error('useDensity must be used within a DensityProvider')
  }
  return context
}
