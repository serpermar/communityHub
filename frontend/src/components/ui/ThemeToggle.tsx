import { useTheme } from '@/context/ThemeContext'
import { t } from '@/i18n'
import { cn } from '@/utils/cn'
import { Tooltip } from './Tooltip'
import styles from './ThemeToggle.module.css'

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme()
  const label = theme === 'dark' ? t('app.themeLight') : t('app.themeDark')

  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        className={cn(styles.button, className)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className={styles.icon}>
          {theme === 'dark' ? (
            <path
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 3v2m0 14v2M5.2 5.2l1.4 1.4m10.8 10.8 1.4 1.4M3 12h2m14 0h2M5.2 18.8l1.4-1.4M17.4 6.6l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"
            />
          ) : (
            <path
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"
            />
          )}
        </svg>
      </button>
    </Tooltip>
  )
}
