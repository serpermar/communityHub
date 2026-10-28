import { useState, forwardRef } from 'react'
import { Input } from '@/components/ui'
import type { InputProps } from '@/components/ui/Form'
import styles from './PasswordField.module.css'

export interface PasswordFieldProps extends Omit<InputProps, 'type'> {
  showLabel?: string
  hideLabel?: string
}

export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  function PasswordField(
    { showLabel = 'Mostrar contraseña', hideLabel = 'Ocultar contraseña', ...props },
    ref,
  ) {
    const [visible, setVisible] = useState(false)

    return (
      <div className={styles.wrapper}>
        <Input {...props} ref={ref} type={visible ? 'text' : 'password'} />
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? hideLabel : showLabel}
          aria-pressed={visible}
        >
          {visible ? (
            <svg aria-hidden="true" viewBox="0 0 24 24" className={styles.icon}>
              <path
                d="M3 3l18 18M10.58 10.58A2 2 0 0012 14a2 2 0 001.42-3.42M9.88 5.08A10.94 10.94 0 0112 5c7 0 11 7 11 7a18.45 18.45 0 01-2.16 3.19M6.61 6.61A18.34 18.34 0 001 12s4 7 11 7a10.74 10.74 0 005.39-1.39"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg aria-hidden="true" viewBox="0 0 24 24" className={styles.icon}>
              <path
                d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          )}
        </button>
      </div>
    )
  },
)
