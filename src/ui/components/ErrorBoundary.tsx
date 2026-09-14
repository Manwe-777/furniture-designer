import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Changing this resets the boundary — e.g. switching tabs after a crash. */
  resetKey?: string
}

interface State {
  error: Error | null
}

/**
 * Keeps one broken panel from taking the whole app — and, more importantly, from
 * making it look like your design is gone. The design itself lives in the store and
 * in localStorage, so recovering is just a re-render.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Panel crashed:', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="error-panel">
        <h2>Something in this panel broke</h2>
        <p className="muted">
          Your design is safe — it is still in the store and saved in this browser.
          Switch tabs or reload to carry on.
        </p>
        <pre className="mono">{error.message}</pre>
        <div className="button-row">
          <button type="button" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    )
  }
}
