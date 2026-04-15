import React, { useState } from 'react'
import { useStore } from '../store'
import { t } from '../i18n'
import { CHECKOUT_URL_ANNUAL, CHECKOUT_URL_WEEKLY } from '../constants'
import { toast } from './Toast'

interface Props {
  onClose: () => void
}

export function LicenseDialog({ onClose }: Props): React.JSX.Element {
  const { lang, licenseKey, licenseStatus, licenseExpiresAt, setLicenseKey, setLicenseStatus, setLicenseValidatedAt, setLicenseExpiresAt } = useStore()
  const [inputKey, setInputKey] = useState(licenseKey ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [promoCode, setPromoCode] = useState('')
  const [promoEmail, setPromoEmail] = useState('')
  const [promoLoading, setPromoLoading] = useState(false)
  const [promoMsg, setPromoMsg] = useState<{ text: string; ok: boolean } | null>(null)

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
    // Promo keys bypass LemonSqueezy — just clear local state
    if (licenseKey.startsWith('PROMO-')) {
      setLicenseKey(null)
      setLicenseStatus('none')
      setLicenseValidatedAt(null)
      setLicenseExpiresAt(null)
      setInputKey('')
      setSuccess(t(lang, 'licenseDeactivated'))
      return
    }
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await window.api.licenseDeactivate(licenseKey)
      if (result.valid) {
        setLicenseKey(null)
        setLicenseStatus('none')
        setLicenseValidatedAt(null)
        setLicenseExpiresAt(null)
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

  const handlePromoRedeem = async (): Promise<void> => {
    const code = promoCode.trim()
    const email = promoEmail.trim()
    if (!code) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setPromoMsg({ text: t(lang, 'promoInvalidEmail'), ok: false })
      return
    }
    setPromoLoading(true)
    setPromoMsg(null)
    try {
      const result = await window.api.promoRedeem(code, email)
      if (result.ok && result.licenseKey) {
        setLicenseKey(result.licenseKey)
        setLicenseStatus('valid')
        setLicenseValidatedAt(Date.now())
        setLicenseExpiresAt(result.expiresAt || null)
        setPromoMsg({ text: result.alreadyRedeemed ? t(lang, 'promoAlready') : t(lang, 'promoSuccess'), ok: true })
      } else {
        setPromoMsg({ text: result.error || t(lang, 'promoError'), ok: false })
      }
    } catch {
      setPromoMsg({ text: t(lang, 'promoError'), ok: false })
    }
    setPromoLoading(false)
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

        {licenseExpiresAt && licenseStatus === 'valid' && (() => {
          const daysLeft = Math.max(0, Math.ceil((new Date(licenseExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
          const expDate = new Date(licenseExpiresAt).toLocaleDateString()
          return (
            <div className="license-expiry">
              {t(lang, 'licenseExpires')}: {expDate} ({daysLeft} {t(lang, 'licenseDaysLeft')})
            </div>
          )
        })()}

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
            <div
              className="license-plan"
              style={{ cursor: 'pointer' }}
              onClick={() => {
                window.api.copyToClipboard('xypro.ai@gmail.com')
                toast.success('Email copied — xypro.ai@gmail.com')
              }}
            >
              <div className="license-plan-name">VOLUME</div>
              <div className="license-plan-price">10+</div>
              <div className="license-plan-note">Rental houses &amp; teams — click to copy email</div>
            </div>
          </div>
        )}

        {/* Promo code redemption */}
        {licenseStatus !== 'valid' && (
          <div className="promo-section">
            <div className="promo-title">{t(lang, 'promoTitle')}</div>
            <div className="promo-row">
              <input
                type="text"
                className="promo-input"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                placeholder={t(lang, 'promoCodePlaceholder')}
                disabled={promoLoading}
                spellCheck={false}
              />
              <input
                type="email"
                className="promo-input promo-email"
                value={promoEmail}
                onChange={(e) => setPromoEmail(e.target.value)}
                placeholder={t(lang, 'promoEmailPlaceholder')}
                disabled={promoLoading}
                onKeyDown={(e) => { if (e.key === 'Enter') handlePromoRedeem() }}
                spellCheck={false}
              />
              <button
                className="license-btn license-btn--primary"
                onClick={handlePromoRedeem}
                disabled={promoLoading || !promoCode.trim() || !promoEmail.trim()}
              >
                {promoLoading ? '...' : t(lang, 'promoRedeem')}
              </button>
            </div>
            {promoMsg && (
              <div className={promoMsg.ok ? 'license-success' : 'license-error'}>{promoMsg.text}</div>
            )}
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
