import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error no controlado en la interfaz', error, info.componentStack)
  }

  private handleReset = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10 dark:bg-slate-950">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            Algo ha ido mal
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Se ha producido un error inesperado en la aplicación. Puedes reintentar; si el problema
            persiste, recarga la página.
          </p>
          <p className="mt-3 break-words rounded-md bg-slate-100 px-3 py-2 text-left text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {error.message}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button
              type="button"
              onClick={this.handleReset}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Reintentar
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Recargar página
            </button>
          </div>
        </div>
      </div>
    )
  }
}
