import React, { useCallback, useEffect, useRef } from 'react'
import { useStore } from '../store'
import { t } from '../i18n'

/** Maximum number of tap timestamps to keep for averaging */
const MAX_TAPS = 12
/** If no tap within this many ms, reset the tap history */
const RESET_TIMEOUT_MS = 2500

/**
 * BPM display — shows auto-detected BPM and manual tap BPM.
 */
export function TapBpm(): React.JSX.Element {
  const { tappedBpm, detectedBpm, setTappedBpm, lang } = useStore()
  const tapsRef = useRef<number[]>([])
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear timer on unmount
  useEffect(() => {
    return () => { if (resetTimerRef.current) clearTimeout(resetTimerRef.current) }
  }, [])

  const handleTap = useCallback(() => {
    const now = performance.now()
    const taps = tapsRef.current

    // Reset if too long since last tap
    if (taps.length > 0 && now - taps[taps.length - 1] > RESET_TIMEOUT_MS) {
      taps.length = 0
    }

    taps.push(now)
    if (taps.length > MAX_TAPS) taps.shift()

    // Need at least 2 taps to compute BPM
    if (taps.length >= 2) {
      const totalTime = taps[taps.length - 1] - taps[0]
      const intervals = taps.length - 1
      const avgMs = totalTime / intervals
      const bpm = 60000 / avgMs
      setTappedBpm(Math.round(bpm * 100) / 100) // 2 decimal places
    }

    // Reset timer
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    resetTimerRef.current = setTimeout(() => {
      tapsRef.current = []
    }, RESET_TIMEOUT_MS)
  }, [setTappedBpm])

  const handleReset = useCallback(() => {
    tapsRef.current = []
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    setTappedBpm(null)
  }, [setTappedBpm])

  const displayDetected = detectedBpm !== null ? detectedBpm.toFixed(1) : '—'
  const displayTapped = tappedBpm !== null ? tappedBpm.toFixed(2) : '—'

  return (
    <div className="tap-bpm-bar">
      <span className="tap-bpm-label">{t(lang, 'bpmAuto')}</span>
      <span className="tap-bpm-value">{displayDetected}</span>
      <span className="tap-bpm-sep">|</span>
      <span className="tap-bpm-label">{t(lang, 'bpmTap')}</span>
      <span className="tap-bpm-value">{displayTapped}</span>
      <button className="tap-bpm-btn tap-bpm-btn--tap" onClick={handleTap}>TAP</button>
      <button className="tap-bpm-btn tap-bpm-btn--reset" onClick={handleReset}>{t(lang, 'bpmReset')}</button>
    </div>
  )
}
