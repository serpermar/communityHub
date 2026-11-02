import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/utils/cn'
import styles from './Toast.module.css'

type ToastVariant = 'info' | 'success' | 'error'

interface Toast {
  id: number
  message: string
  variant: ToastVariant
}

interface ToastContextValue {
  notify: (message: string, variant?: ToastVariant) => void
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  info: styles.toastInfo,
  success: styles.toastSuccess,
  error: styles.toastError,
}

const DEFAULT_DURATION_MS = 4000
let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const notify = useCallback((message: string, variant: ToastVariant = 'info') => {
    const id = nextId++
    setToasts((current) => [...current, { id, message, variant }])
  }, [])

  const value = useMemo<ToastContextValue>(() => ({ notify, dismiss }), [notify, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" aria-atomic="false" className={styles.viewport}>
        <AnimatePresence>
          {toasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const shouldReduceMotion = useReducedMotion()
  const [paused, setPaused] = useState(false)
  const remaining = useRef(DEFAULT_DURATION_MS)
  const startedAt = useRef(Date.now())

  useEffect(() => {
    if (paused) return
    startedAt.current = Date.now()
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current)
    return () => {
      window.clearTimeout(timer)
      remaining.current -= Date.now() - startedAt.current
    }
  }, [paused, onDismiss, toast.id])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: shouldReduceMotion ? 0 : 50, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: shouldReduceMotion ? 0 : 50, scale: 0.95 }}
      transition={{ type: 'spring', duration: 0.4, bounce: 0.3 }}
      role={toast.variant === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(styles.toast, VARIANT_CLASSES[toast.variant])}
    >
      <span className={styles.message}>{toast.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Cerrar aviso"
        className={styles.dismissButton}
      >
        ✕
      </button>
    </motion.div>
  )
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast debe usarse dentro de <ToastProvider>')
  return context
}
