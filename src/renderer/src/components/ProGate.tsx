import React from 'react'
import { useStore } from '../store'
import { t } from '../i18n'

interface Props {
  children: React.ReactNode
  onUpgrade?: () => void
}

/**
 * Wraps Pro-only UI. If not Pro, dims the content and shows an upgrade badge.
 * Click the badge to open the license dialog.
 */
export function ProGate({ children, onUpgrade }: Props): React.JSX.Element {
  const { lang } = useStore()
  const isPro = useStore.getState().isPro()

  if (isPro) return <>{children}</>

  return (
    <div className="pro-gate">
      {children}
      <div className="pro-gate-badge" onClick={onUpgrade}>
        {t(lang, 'upgradeToPro')}
      </div>
    </div>
  )
}
