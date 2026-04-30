import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastContainer } from './components/Toast'
import { UpdateProgressOverlay } from './components/UpdateProgressOverlay'
import './globals.css'

if (window.api?.platform === 'darwin') {
  document.body.classList.add('platform-darwin')
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <ToastContainer />
    <UpdateProgressOverlay />
  </React.StrictMode>
)
