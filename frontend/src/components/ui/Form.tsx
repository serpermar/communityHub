import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { cn } from '@/utils/cn'
import styles from './Form.module.css'

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
}: {
  label: ReactNode
  htmlFor?: string
  error?: string
  hint?: string
  required?: boolean
  children: ReactNode
}) {
  const errorId = useId()
  const describedBy = error || hint ? errorId : undefined
  const control = isValidElement(children)
    ? cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        invalid: error ? true : undefined,
      })
    : children

  return (
    <div className={styles.field}>
      <label htmlFor={htmlFor} className={styles.label}>
        {label}
        {required && <span className={styles.required}>*</span>}
      </label>
      {control}
      {error ? (
        <p id={errorId} role="alert" className={styles.error}>
          {error}
        </p>
      ) : (
        hint && (
          <p id={errorId} className={styles.hint}>
            {hint}
          </p>
        )
      )}
    </div>
  )
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || rest['aria-invalid'] === 'true' ? true : undefined}
      className={cn(styles.controlBase, invalid ? styles.invalid : styles.valid, className)}
      {...rest}
    />
  )
})

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className, invalid, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || rest['aria-invalid'] === 'true' ? true : undefined}
      className={cn(styles.controlBase, invalid ? styles.invalid : styles.valid, className)}
      {...rest}
    />
  )
})

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }
>(function Select({ className, children, invalid, ...rest }, ref) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || rest['aria-invalid'] === 'true' ? true : undefined}
      className={cn(styles.controlBase, invalid ? styles.invalid : styles.valid, className)}
      {...rest}
    >
      {children}
    </select>
  )
})
