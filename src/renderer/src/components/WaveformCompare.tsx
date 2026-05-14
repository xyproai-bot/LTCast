import React, { useRef, useEffect, useCallback, useState } from 'react'
import { WaveformMarker, MARKER_TYPE_COLORS } from '../store'
import { t } from '../i18n'
import { useStore } from '../store'
import {
  peaksToBars as _peaksToBars,
  drawWaveform as _drawWaveform,
  drawMarkerDots as _drawMarkerDots,
  WAVEFORM_COMPARE_CANVAS_WIDTH
} from '../audio/waveformCompareUtils'

// Re-export pure functions for backward compatibility and direct use
export { peaksToBars, drawWaveform, drawMarkerDots } from '../audio/waveformCompareUtils'

export interface WaveformCompareProps {
  oldPeaks: Float32Array
  newPeaks: Float32Array
  oldDuration: number
  newDuration: number
  offsetSec: number
  onOffsetChange?: (newOffset: number) => void
  markers?: WaveformMarker[]
}

const CANVAS_WIDTH = WAVEFORM_COMPARE_CANVAS_WIDTH
const CANVAS_HEIGHT = 80

export function WaveformCompare({
  oldPeaks,
  newPeaks,
  oldDuration,
  newDuration,
  offsetSec,
  onOffsetChange,
  markers = []
}: WaveformCompareProps): React.JSX.Element {
  const lang = useStore(s => s.lang)
  const markerTypeColorOverrides = useStore(s => s.markerTypeColorOverrides)

  const oldCanvasRef = useRef<HTMLCanvasElement>(null)
  const newCanvasRef = useRef<HTMLCanvasElement>(null)

  // Offset slider state (local, reflects external offsetSec initially)
  const [localOffset, setLocalOffset] = useState(offsetSec)
  const containerRef = useRef<HTMLDivElement>(null)

  // Sync external offset changes in
  useEffect(() => {
    setLocalOffset(offsetSec)
  }, [offsetSec])

  const mergedColors: Partial<Record<string, string>> = {
    ...MARKER_TYPE_COLORS,
    ...markerTypeColorOverrides
  }

  const redraw = useCallback(() => {
    const off = localOffset
    const maxDuration = Math.max(oldDuration, newDuration + Math.abs(off))
    const pxPerSec = CANVAS_WIDTH / Math.max(maxDuration, 0.1)

    // Draw OLD waveform (top canvas)
    const oldCtx = oldCanvasRef.current?.getContext('2d')
    if (oldCtx) {
      oldCtx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
      // Background
      oldCtx.fillStyle = '#0d0d0d'
      oldCtx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
      // Waveform
      _drawWaveform(oldCtx, oldPeaks, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, '#4a6a7a')
      // Marker dots on old waveform
      _drawMarkerDots(oldCtx, markers, pxPerSec, 0, CANVAS_HEIGHT, mergedColors)
      // Alignment reference line (where old's x=0 maps)
      oldCtx.strokeStyle = 'rgba(255,200,0,0.7)'
      oldCtx.lineWidth = 1.5
      oldCtx.setLineDash([4, 3])
      oldCtx.beginPath()
      oldCtx.moveTo(0, 0)
      oldCtx.lineTo(0, CANVAS_HEIGHT)
      oldCtx.stroke()
      oldCtx.setLineDash([])
    }

    // Draw NEW waveform (bottom canvas)
    const newCtx = newCanvasRef.current?.getContext('2d')
    if (newCtx) {
      newCtx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
      newCtx.fillStyle = '#0d0d0d'
      newCtx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
      // new waveform starts at offsetSec * pxPerSec (if off > 0, new starts later)
      const newX0 = off * pxPerSec
      _drawWaveform(newCtx, newPeaks, newX0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, '#00d4ff')
      // Projected marker dots on new canvas (shifted positions, faded)
      const shiftedMarkers = markers.map(m => ({ ...m, time: m.time + off }))
      _drawMarkerDots(newCtx, shiftedMarkers, pxPerSec, 0, CANVAS_HEIGHT, mergedColors, 4, 0.5)
      // Alignment line showing where new waveform starts
      const lineX = Math.min(Math.max(newX0, 0), CANVAS_WIDTH - 1)
      newCtx.strokeStyle = 'rgba(255,200,0,0.7)'
      newCtx.lineWidth = 1.5
      newCtx.setLineDash([4, 3])
      newCtx.beginPath()
      newCtx.moveTo(lineX, 0)
      newCtx.lineTo(lineX, CANVAS_HEIGHT)
      newCtx.stroke()
      newCtx.setLineDash([])
    }
  }, [oldPeaks, newPeaks, oldDuration, newDuration, localOffset, markers, mergedColors])

  useEffect(() => { redraw() }, [redraw])

  // Keyboard nudge handler — only when container is focused
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault()
      const step = e.shiftKey ? 0.100 : 0.010
      const delta = e.code === 'ArrowLeft' ? -step : step
      const clamped = Math.max(localOffset - 5, Math.min(localOffset + 5, localOffset + delta))
      setLocalOffset(clamped)
      onOffsetChange?.(clamped)
    }
  }, [localOffset, onOffsetChange])

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value)
    setLocalOffset(val)
    onOffsetChange?.(val)
  }

  const offsetDisplay = localOffset >= 0 ? `+${localOffset.toFixed(3)}s` : `${localOffset.toFixed(3)}s`
  const sliderMin = offsetSec - 5
  const sliderMax = offsetSec + 5

  return (
    <div
      ref={containerRef}
      style={{ outline: 'none' }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Old waveform */}
      <div style={{ marginBottom: 4 }}>
        <div style={{ fontSize: '10px', color: '#4a8a9a', marginBottom: 2 }}>
          {t(lang, 'replaceAudioOldFile')} <span style={{ color: '#666', marginLeft: 4 }}>({oldDuration.toFixed(2)}s)</span>
        </div>
        <canvas
          ref={oldCanvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          style={{ display: 'block', width: '100%', height: CANVAS_HEIGHT, borderRadius: 4, border: '1px solid #1e2e38' }}
        />
      </div>
      {/* New waveform */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: '10px', color: '#00d4ff', marginBottom: 2 }}>
          {t(lang, 'replaceAudioNewFile')} <span style={{ color: '#666', marginLeft: 4 }}>({newDuration.toFixed(2)}s)</span>
        </div>
        <canvas
          ref={newCanvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          style={{ display: 'block', width: '100%', height: CANVAS_HEIGHT, borderRadius: 4, border: '1px solid #003344' }}
        />
      </div>
      {/* Manual offset slider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '11px' }}>
        <span style={{ color: '#aaa', minWidth: 120 }}>{t(lang, 'manualOffsetAdjust')}</span>
        <input
          type="range"
          min={sliderMin}
          max={sliderMax}
          step={0.010}
          value={localOffset}
          onChange={handleSliderChange}
          style={{ flex: 1 }}
        />
        <span style={{ fontFamily: 'Consolas, monospace', color: '#00d4ff', minWidth: 72, textAlign: 'right' }}>
          {offsetDisplay}
        </span>
      </div>
      <div style={{ fontSize: '10px', color: '#555', marginTop: 4 }}>
        {t(lang, 'useArrowsToNudge')}
      </div>
    </div>
  )
}
