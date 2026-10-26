import styles from './AnimatedBackground.module.css'

type Variant = 'blobs' | 'mesh' | 'grid' | 'all'

export function AnimatedBackground({ variant = 'all' }: { variant?: Variant }) {
  return (
    <div className={styles.container} aria-hidden="true">
      {(variant === 'blobs' || variant === 'all') && (
        <>
          <div className={`${styles.blob} ${styles.blob1}`} />
          <div className={`${styles.blob} ${styles.blob2}`} />
          <div className={`${styles.blob} ${styles.blob3}`} />
        </>
      )}
      {(variant === 'mesh' || variant === 'all') && <div className={styles.mesh} />}
      {(variant === 'grid' || variant === 'all') && <div className={styles.grid} />}
    </div>
  )
}
