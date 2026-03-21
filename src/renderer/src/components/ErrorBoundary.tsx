import React, { Component, ErrorInfo } from 'react'
import { useStore } from '../store'
import { t } from '../i18n'

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * React Error Boundary — prevents child component crashes from
 * causing a full white screen. Shows a recovery UI instead.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('LTCast error boundary caught:', error, info.componentStack)
  }

  handleReload = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      const lang = useStore.getState().lang
      return (
        <div className="error-boundary">
          <div className="error-boundary-content">
            <h2>{t(lang, 'errorTitle')}</h2>
            <p className="error-boundary-msg">{this.state.error?.message}</p>
            <button className="btn-open" onClick={this.handleReload}>
              {t(lang, 'reload')}
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
