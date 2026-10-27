import { Component, type ErrorInfo, type ReactNode } from 'react'
import styles from './ErrorBoundary.module.css'

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
      <div className={styles.root}>
        <div className={styles.card}>
          <h1 className={styles.title}>Algo ha ido mal</h1>
          <p className={styles.message}>
            Se ha producido un error inesperado en la aplicación. Puedes reintentar; si el problema
            persiste, recarga la página.
          </p>
          <p className={styles.errorBox}>{error.message}</p>
          <div className={styles.actions}>
            <button type="button" onClick={this.handleReset} className={styles.retry}>
              Reintentar
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className={styles.reload}
            >
              Recargar página
            </button>
          </div>
        </div>
      </div>
    )
  }
}
