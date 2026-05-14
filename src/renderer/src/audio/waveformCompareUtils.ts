/**
 * Pure functions for WaveformCompare canvas rendering.
 * Extracted for testability (no JSX dependency).
 */

import { WaveformMarker } from '../store'

export const WAVEFORM_COMPARE_CANVAS_WIDTH = 700

/** Downsample peaks to barCount bars by max-bin */
export function peaksToBars(peaks: Float32Array, barCount: number): Float32Array {
  const out = new Float32Array(barCount)
  const total = peaks.length
  for (let i = 0; i < barCount; i++) {
    const start = Math.floor((i / barCount) * total)
    const end = Math.floor(((i + 1) / barCount) * total)
    let max = 0
    for (let j = start; j < end; j++) {
      if (peaks[j] > max) max = peaks[j]
    }
    out[i] = max
  }
  return out
}

/**
 * Draw a waveform on a canvas context.
 * x0 = horizontal pixel offset (can be negative for shifted waveform).
 * y0 = top of the waveform area in the canvas.
 * w  = width to render (in pixels, aligned to peaks).
 * h  = height of the waveform area.
 */
export function drawWaveform(
  ctx: CanvasRenderingContext2D,
  peaks: Float32Array,
  x0: number,
  y0: number,
  w: number,
  h: number,
  color: string
): void {
  const bars = peaksToBars(peaks, WAVEFORM_COMPARE_CANVAS_WIDTH)
  ctx.fillStyle = color
  const midY = y0 + h / 2
  const barW = w / WAVEFORM_COMPARE_CANVAS_WIDTH
  for (let i = 0; i < WAVEFORM_COMPARE_CANVAS_WIDTH; i++) {
    const x = x0 + i * barW
    if (x + barW < 0 || x > w + Math.abs(x0)) continue
    const amp = bars[i] * (h / 2)
    ctx.fillRect(x, midY - amp, Math.max(1, barW - 0.5), amp * 2)
  }
}

/**
 * Draw marker dots on the canvas.
 * markerTime in seconds, pxPerSec converts to x.
 */
export function drawMarkerDots(
  ctx: CanvasRenderingContext2D,
  markers: WaveformMarker[],
  pxPerSec: number,
  y0: number,
  h: number,
  colors: Partial<Record<string, string>>,
  radius: number = 4,
  alpha: number = 1
): void {
  const midY = y0 + h / 2
  ctx.globalAlpha = alpha
  for (const m of markers) {
    const x = m.time * pxPerSec
    if (x < 0 || x > WAVEFORM_COMPARE_CANVAS_WIDTH) continue
    const color = m.color ?? colors[m.type ?? 'custom'] ?? '#00d4ff'
    ctx.beginPath()
    ctx.arc(x, midY, radius, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    // White ring
    ctx.beginPath()
    ctx.arc(x, midY, radius, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'
    ctx.lineWidth = 1
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}
