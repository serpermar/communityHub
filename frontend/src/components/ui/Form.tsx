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

// Clase base comun de los controles de formulario: una sola fuente para el
// borde, el fondo, el texto y el foco (coherente con el focus global de `index.css`).
const CONTROL_BASE =
  'block w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500'
const CONTROL_VALID = 'border-slate-300 focus-visible:border-brand-500 dark:border-slate-600'
const CONTROL_INVALID =
  'border-danger-400 focus-visible:border-danger-500 focus-visible:ring-danger-200 dark:border-danger-500'

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
  // Vincula el mensaje (error o ayuda) al control con `aria-describedby` y marca
  // el control como invalido, para que un lector de pantalla anuncie el motivo.
  const describedBy = error || hint ? errorId : undefined
  const control = isValidElement(children)
    ? cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        invalid: error ? true : undefined,
      })
    : children

  return (
    <div className="space-y-1">
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-slate-700 dark:text-slate-300"
      >
        {label}
        {required && <span className="ml-0.5 text-danger-600 dark:text-danger-400">*</span>}
      </label>
      {control}
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-danger-600 dark:text-danger-400">
          {error}
        </p>
      ) : (
        hint && (
          <p id={errorId} className="text-xs text-slate-500 dark:text-slate-400">
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
      className={cn(CONTROL_BASE, invalid ? CONTROL_INVALID : CONTROL_VALID, className)}
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
      className={cn(CONTROL_BASE, invalid ? CONTROL_INVALID : CONTROL_VALID, className)}
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
      className={cn(CONTROL_BASE, invalid ? CONTROL_INVALID : CONTROL_VALID, className)}
      {...rest}
    >
      {children}
    </select>
  )
})
