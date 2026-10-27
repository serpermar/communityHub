import { Outlet } from 'react-router-dom'
import { ThemeToggle } from '@/components/ui'
import { Logo } from '@/components/brand/Logo'
import { AnimatedBackground } from '@/components/layout/AnimatedBackground'
import styles from './AuthLayout.module.css'

export function AuthLayout() {
  return (
    <div className={styles.root}>
      <AnimatedBackground variant="all" />
      <div className={styles.wrapper}>
        <div className={styles.header}>
          <span className={styles.spacer} aria-hidden="true" />
          <Logo className={styles.logo} />
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
