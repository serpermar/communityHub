import { Link, Outlet } from 'react-router-dom'
import { ThemeToggle } from '@/components/ui'
import { Logo } from '@/components/brand/Logo'
import { InteractiveBackground } from '@/components/layout/InteractiveBackground'
import styles from './AuthLayout.module.css'

export function AuthLayout() {
  return (
    <div className={styles.root}>
      <InteractiveBackground />
      <div className={styles.wrapper}>
        <div className={styles.header}>
          <span className={styles.spacer} aria-hidden="true" />
          <Link to="/" aria-label="Ir al inicio">
            <Logo className={styles.logo} />
          </Link>
          <div className={styles.themeToggleWrapper}>
            <ThemeToggle />
          </div>
        </div>
        <div className={styles.card}>
          <Outlet />
        </div>
      </div>
    </div>
  )
}
