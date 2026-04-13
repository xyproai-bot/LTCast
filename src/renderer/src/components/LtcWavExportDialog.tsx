import React, { useState, useCallback } from 'react'
import { useStore } from '../store'
import { t } from '../i18n'
import { toast } from './Toast'
import { generateLtcWav } from '../audio/ltcWavGenerator'

const FPS_OPTIONS = [
  { value: 24,    label: '24 fps NDF' },
  { value: 25,    label: '25 fps NDF' },
  { value: 29.97, label: '29.97 DF' },
  { value: 30,    label: '30 fps NDF' },
]

interface Props {
  onClose: () => void
}

export function LtcWavExportDialog({ onClose }: Props): React.JSX.Element {
  const { lang, generatorStartTC, generatorFps } = useStore()

  const [startTC, setStartTC]               = useState(generatorStartTC || '00:00:00:00')
  const [durationSeconds, setDurationSeconds] = useState(3600)
  const [fps, setFps]                       = useState<number>(generatorFps || 25)
  const [sampleRate, setSampleRate]         = useState<number>(48000)
  const [amplitude, setAmplitude]           = useState(0.5)
  const [exporting, setExporting]           = useState(false)
  const [progress, setProgress]             = useState(0)

  const handleExport = useCallback(async (): Promise<void> => {
    setExporting(true)
    setProgress(0)
    try {
      const buffer = await generateLtcWav({
        startTC, durationSeconds, fps, sampleRate, amplitude,
        onProgress: (p) => setProgress(p)
      })
      const safeFps = fps === 29.97 ? '29df' : String(fps)
      const startLabel = startTC.replace(/[:;]/g, '-')
      const defaultName = `ltc_${startLabel}_${safeFps}fps_${durationSeconds}s.wav`
      const savedPath = await window.api.saveWavDialog(buffer, defaultName)
      if (savedPath) {
        toast.success(t(lang, 'ltcWavSuccess'))
        onClose()
      }
    } catch (e) {
      console.error('LTC WAV export failed:', e)
    } finally {
      setExporting(false)
      setProgress(0)
    }
  }, [startTC, durationSeconds, fps, sampleRate, amplitude, lang, onClose])

  const formatDuration = (s: number): string => {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    if (h > 0) return `${h}h ${m}m`
    if (m > 0) return `${m}m ${sec}s`
    return `${sec}s`
  }

  return (
    <div className="ltc-wav-dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ltc-wav-dialog">

        {/* Header */}
        <div className="ltc-wav-dialog-header">
          <div>
            <div className="ltc-wav-dialog-title">{t(lang, 'exportLtcWav')}</div>
            <div className="ltc-wav-dialog-sub">Generate a standalone LTC audio file</div>
          </div>
          <button className="ltc-wav-dialog-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.5">
              <line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/>
            </svg>
          </button>
        </div>

        {/* Fields */}
        <div className="ltc-wav-fields">

          {/* Row 1: Start TC + Duration */}
          <div className="ltc-wav-row">
            <div className="ltc-wav-field">
              <label className="ltc-wav-label">{t(lang, 'ltcWavStartTC')}</label>
              <input
                className="ltc-wav-input ltc-wav-input--mono"
                type="text"
                value={startTC}
                onChange={(e) => setStartTC(e.target.value)}
                placeholder="00:00:00:00"
                disabled={exporting}
              />
            </div>
            <div className="ltc-wav-field">
              <label className="ltc-wav-label">{t(lang, 'ltcWavDuration')} <span className="ltc-wav-hint">({formatDuration(durationSeconds)})</span></label>
              <input
                className="ltc-wav-input"
                type="number"
                min={1}
                max={86400}
                value={durationSeconds}
                onChange={(e) => setDurationSeconds(Math.max(1, Math.min(86400, Number(e.target.value))))}
                disabled={exporting}
              />
            </div>
          </div>

          {/* Row 2: FPS + Sample Rate */}
          <div className="ltc-wav-row">
            <div className="ltc-wav-field">
              <label className="ltc-wav-label">{t(lang, 'ltcWavFps')}</label>
              <div className="ltc-wav-fps-buttons">
                {FPS_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    className={`ltc-wav-fps-btn${fps === opt.value ? ' active' : ''}`}
                    onClick={() => setFps(opt.value)}
                    disabled={exporting}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="ltc-wav-field">
              <label className="ltc-wav-label">{t(lang, 'ltcWavSampleRate')}</label>
              <div className="ltc-wav-fps-buttons">
                {[44100, 48000].map(sr => (
                  <button
                    key={sr}
                    className={`ltc-wav-fps-btn${sampleRate === sr ? ' active' : ''}`}
                    onClick={() => setSampleRate(sr)}
                    disabled={exporting}
                  >
                    {sr === 44100 ? '44.1 kHz' : '48 kHz'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Row 3: Amplitude */}
          <div className="ltc-wav-field">
            <label className="ltc-wav-label">
              {t(lang, 'ltcWavAmplitude')}
              <span className="ltc-wav-hint">{Math.round(amplitude * 100)}%</span>
            </label>
            <div className="ltc-wav-amplitude-row">
              <input
                className="ltc-wav-slider"
                type="range"
                min={0.1}
                max={1.0}
                step={0.05}
                value={amplitude}
                onChange={(e) => setAmplitude(Number(e.target.value))}
                disabled={exporting}
              />
            </div>
          </div>
        </div>

        {/* Progress */}
        {exporting && (
          <div className="ltc-wav-progress-wrap">
            <div className="ltc-wav-progress-header">
              <span className="ltc-wav-progress-label">{t(lang, 'ltcWavExporting')}</span>
              <span className="ltc-wav-progress-pct">{Math.round(progress * 100)}%</span>
            </div>
            <div className="ltc-wav-progress-bar">
              <div className="ltc-wav-progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="ltc-wav-footer">
          <button className="ltc-wav-btn" onClick={onClose} disabled={exporting}>
            {t(lang, 'ltcWavCancel')}
          </button>
          <button
            className="ltc-wav-btn ltc-wav-btn--primary"
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting
              ? <><span className="ltc-wav-spinner" /> {t(lang, 'ltcWavExporting')}</>
              : t(lang, 'ltcWavExport')
            }
          </button>
        </div>
      </div>
    </div>
  )
}
