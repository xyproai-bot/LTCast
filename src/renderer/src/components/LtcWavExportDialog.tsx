import React, { useState, useCallback } from 'react'
import { useStore } from '../store'
import { t } from '../i18n'
import { toast } from './Toast'
import { generateLtcWav } from '../audio/ltcWavGenerator'

interface Props {
  onClose: () => void
}

export function LtcWavExportDialog({ onClose }: Props): React.JSX.Element {
  const { lang, generatorStartTC, generatorFps } = useStore()

  const [startTC, setStartTC] = useState(generatorStartTC || '00:00:00:00')
  const [durationSeconds, setDurationSeconds] = useState(3600)
  const [fps, setFps] = useState<number>(generatorFps || 25)
  const [sampleRate, setSampleRate] = useState<number>(48000)
  const [amplitude, setAmplitude] = useState(0.5)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState(0)

  const handleExport = useCallback(async (): Promise<void> => {
    setExporting(true)
    setProgress(0)

    try {
      const buffer = await generateLtcWav({
        startTC,
        durationSeconds,
        fps,
        sampleRate,
        amplitude,
        onProgress: (p) => setProgress(p)
      })

      const safeFps = fps === 29.97 ? '29df' : String(fps)
      const startLabel = startTC.replace(/:/g, '-').replace(/;/g, '-')
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

  return (
    <div className="ltc-wav-dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ltc-wav-dialog">
        <div className="ltc-wav-dialog-title">{t(lang, 'exportLtcWav')}</div>

        <div className="ltc-wav-field">
          <label className="ltc-wav-label">{t(lang, 'ltcWavStartTC')}</label>
          <input
            className="ltc-wav-input"
            type="text"
            value={startTC}
            onChange={(e) => setStartTC(e.target.value)}
            placeholder="00:00:00:00"
            disabled={exporting}
          />
        </div>

        <div className="ltc-wav-field">
          <label className="ltc-wav-label">{t(lang, 'ltcWavDuration')}</label>
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

        <div className="ltc-wav-field">
          <label className="ltc-wav-label">{t(lang, 'ltcWavFps')}</label>
          <select
            className="ltc-wav-select"
            value={fps}
            onChange={(e) => setFps(Number(e.target.value))}
            disabled={exporting}
          >
            <option value={24}>24 fps</option>
            <option value={25}>25 fps</option>
            <option value={29.97}>29.97 DF</option>
            <option value={30}>30 fps</option>
          </select>
        </div>

        <div className="ltc-wav-field">
          <label className="ltc-wav-label">{t(lang, 'ltcWavSampleRate')}</label>
          <select
            className="ltc-wav-select"
            value={sampleRate}
            onChange={(e) => setSampleRate(Number(e.target.value))}
            disabled={exporting}
          >
            <option value={44100}>44100 Hz</option>
            <option value={48000}>48000 Hz</option>
          </select>
        </div>

        <div className="ltc-wav-field">
          <label className="ltc-wav-label">{t(lang, 'ltcWavAmplitude')} ({amplitude.toFixed(2)})</label>
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

        {exporting && (
          <div className="ltc-wav-progress-wrap">
            <div className="ltc-wav-progress-label">{t(lang, 'ltcWavExporting')}</div>
            <div className="ltc-wav-progress-bar">
              <div className="ltc-wav-progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <div className="ltc-wav-progress-pct">{Math.round(progress * 100)}%</div>
          </div>
        )}

        <div className="ltc-wav-buttons">
          <button
            className="ltc-wav-btn ltc-wav-btn-cancel"
            onClick={onClose}
            disabled={exporting}
          >
            {t(lang, 'ltcWavCancel')}
          </button>
          <button
            className="ltc-wav-btn ltc-wav-btn-export"
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? t(lang, 'ltcWavExporting') : t(lang, 'ltcWavExport')}
          </button>
        </div>
      </div>
    </div>
  )
}
