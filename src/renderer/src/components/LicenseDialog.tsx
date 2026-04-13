import React, { useState } from 'react'
import { useStore } from '../store'
import { t } from '../i18n'
import { CHECKOUT_URL_ANNUAL, CHECKOUT_URL_WEEKLY, CHECKOUT_URL_VOLUME } from '../constants'

interface Props {
  onClose: () => void
}

export function LicenseDialog({ onClose }: Props): React.JSX.Element {
  const { lang, licenseKey, licenseStatus, setLicenseKey, setLicenseStatus, setLicenseValidatedAt } = useStore()
  const [inputKey, setInputKey] = useState(licenseKey ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleActivate = async (): Promise<void> => {
    const key = inputKey.trim()
    if (!key) return
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await window.api.licenseActivate(key)
      if (result.valid) {
        setLicenseKey(key)
        setLicenseStatus('valid')
        setLicenseValidatedAt(Date.now())
        setSuccess(t(lang, 'licenseActivated'))
      } else {
        setError(result.error ?? t(lang, 'licenseInvalid'))
        setLicenseStatus('invalid')
      }
    } catch {
      setError(t(lang, 'licenseNetworkError'))
    }
    setLoading(false)
  }

  const handleDeactivate = async (): Promise<void> => {
    if (!licenseKey) return
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await window.api.licenseDeactivate(licenseKey)
      if (result.valid) {
        setLicenseKey(null)
        setLicenseStatus('none')
        setLicenseValidatedAt(null)
        setInputKey('')
        setSuccess(t(lang, 'licenseDeactivated'))
      } else {
        setError(result.error ?? 'Failed to deactivate')
      }
    } catch {
      setError(t(lang, 'licenseNetworkError'))
    }
    setLoading(false)
  }

  const statusLabel = licenseStatus === 'valid'
    ? '✅ Pro'
    : licenseStatus === 'expired'
      ? '⚠️ Expired'
      : licenseStatus === 'invalid'
        ? '❌ Invalid'
        : 'Free'

  return (
    <div className="license-overlay" onClick={onClose}>
      <div className="license-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="license-header">
          <h3>{t(lang, 'licenseTitle')}</h3>
          <button className="license-close" onClick={onClose}>×</button>
        </div>

        <div className="license-status">
          <span>{t(lang, 'licenseCurrentStatus')}:</span>
          <span className={`license-badge license-badge--${licenseStatus}`}>{statusLabel}</span>
        </div>

        {licenseStatus !== 'valid' && (
          <div className="license-input-row">
            <input
              type="text"
              className="license-input"
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              placeholder={t(lang, 'licenseKeyPlaceholder')}
              disabled={loading}
              onKeyDown={(e) => { if (e.key === 'Enter') handleActivate() }}
            />
            <button
              className="license-btn license-btn--primary"
              onClick={handleActivate}
              disabled={loading || !inputKey.trim()}
            >
              {loading ? '...' : t(lang, 'licenseActivate')}
            </button>
          </div>
        )}

        {licenseStatus === 'valid' && (
          <div className="license-input-row">
            <span className="license-key-display">{licenseKey?.slice(0, 8)}...{licenseKey?.slice(-4)}</span>
            <button
              className="license-btn license-btn--danger"
              onClick={handleDeactivate}
              disabled={loading}
            >
              {loading ? '...' : t(lang, 'licenseDeactivate')}
            </button>
          </div>
        )}

        {error && <div className="license-error">{error}</div>}
        {success && <div className="license-success">{success}</div>}

        {/* Pricing cards */}
        {licenseStatus !== 'valid' && (
          <div className="license-pricing">
            <a
              className="license-plan license-plan--highlight"
              href={CHECKOUT_URL_ANNUAL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <div className="license-plan-name">ANNUAL</div>
              <div className="license-plan-price">$49<span className="license-plan-per">/year</span></div>
              <div className="license-plan-note">Best value for professionals</div>
            </a>
            <a
              className="license-plan"
              href={CHECKOUT_URL_WEEKLY}
              target="_blank"
              rel="noopener noreferrer"
            >
              <div className="license-plan-name">7-DAY PASS</div>
              <div className="license-plan-price">$15</div>
              <div className="license-plan-note">Perfect for single events</div>
            </a>
            <a
              className="license-plan"
              href={CHECKOUT_URL_VOLUME}
              target="_blank"
              rel="noopener noreferrer"
            >
              <div className="license-plan-name">VOLUME</div>
              <div className="license-plan-price">10+</div>
              <div className="license-plan-note">Rental houses &amp; teams — contact us</div>
            </a>
          </div>
        )}

        <div className="license-footer">
          <a
            href={CHECKOUT_URL_ANNUAL}
            target="_blank"
            rel="noopener noreferrer"
            className="license-buy-link"
          >
            {t(lang, 'licenseBuyPro')}
          </a>
          <div className="license-powered">Powered by LemonSqueezy</div>
        </div>
      </div>
    </div>
  )
}
