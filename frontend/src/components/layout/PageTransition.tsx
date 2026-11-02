import { motion, useReducedMotion } from 'framer-motion'
import type { Variants } from 'framer-motion'
import type { ReactNode } from 'react'

export function PageTransition({ children }: { children: ReactNode }) {
  const shouldReduceMotion = useReducedMotion()

  const variants: Variants = {
    initial: { opacity: 0, y: shouldReduceMotion ? 0 : 16 },
    animate: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.3, ease: 'easeOut' },
    },
    exit: {
      opacity: 0,
      y: shouldReduceMotion ? 0 : -16,
      transition: { duration: 0.2, ease: 'easeIn' },
    },
  }

  return (
    <motion.div
      initial="initial"
      animate="animate"
      exit="exit"
      variants={variants}
      className="h-full"
    >
      {children}
    </motion.div>
  )
}
