import { useMemo } from 'react'
import styles from './PasswordStrength.module.css'

function scorePassword(password: string) {
  let score = 0
  if (password.length >= 8) score += 1
  if (password.length >= 12) score += 1
  if (/[A-Z]/.test(password)) score += 1
  if (/[0-9]/.test(password)) score += 1
  if (/[^A-Za-z0-9]/.test(password)) score += 1
  return score
}

export function PasswordStrength({ password }: { password: string }) {
  const score = useMemo(() => scorePassword(password), [password])

  const level = score <= 1 ? 'weak' : score <= 3 ? 'medium' : 'strong'
  const label = level === 'weak' ? 'Débil' : level === 'medium' ? 'Media' : 'Fuerte'
  const width = password.length === 0 ? 0 : level === 'weak' ? 33 : level === 'medium' ? 66 : 100

  const checks = [
    { ok: password.length >= 8, text: 'Mínimo 8 caracteres' },
    { ok: /[A-Z]/.test(password), text: 'Al menos una mayúscula' },
    { ok: /[0-9]/.test(password), text: 'Al menos un número' },
    { ok: /[^A-Za-z0-9]/.test(password), text: 'Al menos un símbolo' },
  ]

  if (password.length === 0) return null

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.label}>Seguridad: {label}</span>
      </div>
      <div className={styles.bar}>
        <div
          className={`${styles.fill} ${styles[level]}`}
          style={{ width: `${width}%` }}
          aria-hidden="true"
        />
      </div>
      <ul className={styles.list}>
        {checks.map((check) => (
          <li key={check.text} className={`${styles.item} ${check.ok ? styles.ok : ''}`}>
            <span className={styles.dot} aria-hidden="true" />
            <span>{check.text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
