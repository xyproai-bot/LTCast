import React from 'react'
import { useStore } from '../store'
import { t } from '../i18n'

interface Props {
  children: React.ReactNode
  onUpgrade?: () => void
}

/**
 * Wraps Pro-only UI. Shows content if Pro or trial active.
 * Otherwise dims the content and shows an upgrade badge.
 */
export function ProGate({ children, onUpgrade }: Props): React.JSX.Element {
  const { lang, licenseStatus, trialDaysLeft } = useStore()
  const isPro = useStore.getState().isPro()

  if (isPro) {
    // Show trial banner if on trial (not licensed)
    if (licenseStatus !== 'valid' && trialDaysLeft !== null && trialDaysLeft > 0) {
      return (
        <>
          <div className="trial-banner">
            {t(lang, 'trialDaysLeft').replace('{days}', String(trialDaysLeft))}
            <a href="#" onClick={(e) => { e.preventDefault(); onUpgrade?.() }} className="trial-buy-link">
              {t(lang, 'licenseBuyPro')}
            </a>
          </div>
          {children}
        </>
      )
    }
    return <>{children}</>
  }

  return (
    <div className="pro-gate">
      {children}
      <div className="pro-gate-badge" onClick={onUpgrade}>
        {trialDaysLeft === 0
          ? t(lang, 'trialExpired')
          : t(lang, 'upgradeToPro')}
      </div>
    </div>
  )
}
