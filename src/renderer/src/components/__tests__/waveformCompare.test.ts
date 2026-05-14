/**
 * Sprint D — F12: WaveformCompare pure-function unit tests.
 * Tests peaksToBars downsample logic and drawWaveform / drawMarkerDots.
 */

import { describe, it, expect, vi } from 'vitest'
import { peaksToBars, drawWaveform, drawMarkerDots } from '../../audio/waveformCompareUtils'

describe('peaksToBars', () => {
  it('returns correct barCount length', () => {
    const peaks = new Float32Array(6000).fill(0.5)
    const bars = peaksToBars(peaks, 100)
    expect(bars.length).toBe(100)
  })

  it('returns 0 for silent input', () => {
    const peaks = new Float32Array(1000).fill(0)
    const bars = peaksToBars(peaks, 100)
    expect(Array.from(bars).every(v => v === 0)).toBe(true)
  })

  it('returns max value from each bin', () => {
    const peaks = new Float32Array(100)
    // Set last sample of first 50-sample bin very high
    peaks[49] = 0.99
    const bars = peaksToBars(peaks, 2) // 2 bars, each 50 samples
    expect(bars[0]).toBeCloseTo(0.99)
    expect(bars[1]).toBe(0)
  })

  it('handles edge case barCount=1', () => {
    const peaks = new Float32Array([0.1, 0.9, 0.5])
    const bars = peaksToBars(peaks, 1)
    expect(bars.length).toBe(1)
    expect(bars[0]).toBeCloseTo(0.9)
  })

  it('handles barCount > peaks.length gracefully', () => {
    const peaks = new Float32Array(3).fill(0.3)
    const bars = peaksToBars(peaks, 10)
    expect(bars.length).toBe(10)
    // Each bin maps to 0 or fewer samples; still returns valid floats
    expect(Array.from(bars).every(v => isFinite(v))).toBe(true)
  })

  it('downsamples large peaks array correctly', () => {
    const POINTS = 6000
    const barCount = 700
    const peaks = new Float32Array(POINTS)
    // Fill with sine-like values
    for (let i = 0; i < POINTS; i++) peaks[i] = Math.abs(Math.sin(i * 0.01))
    const bars = peaksToBars(peaks, barCount)
    expect(bars.length).toBe(barCount)
    // All bars should be > 0
    expect(Array.from(bars).every(v => v > 0)).toBe(true)
    // All bars should be <= 1
    expect(Array.from(bars).every(v => v <= 1.001)).toBe(true)
  })
})

describe('drawWaveform', () => {
  function makeMockCtx() {
    const calls: Array<{ method: string; args: unknown[] }> = []
    const ctx = new Proxy({} as CanvasRenderingContext2D, {
      get(_, prop: string) {
        if (prop === 'fillStyle') return ''
        return (...args: unknown[]) => { calls.push({ method: prop, args }); return undefined }
      },
      set(_, _prop: string, _val: unknown) { return true }
    })
    return { ctx, calls }
  }

  it('calls fillRect for each visible bar', () => {
    const { ctx, calls } = makeMockCtx()
    const peaks = new Float32Array(100).fill(0.5)
    // Should produce 700 fillRect calls (one per CANVAS_WIDTH bar)
    drawWaveform(ctx, peaks, 0, 0, 700, 80, '#00d4ff')
    const rects = calls.filter(c => c.method === 'fillRect')
    expect(rects.length).toBe(700)
  })

  it('skips bars that are off-screen (x0 negative offset)', () => {
    const { ctx, calls } = makeMockCtx()
    const peaks = new Float32Array(100).fill(0.5)
    // x0 = -1400 means waveform starts far left, many bars will be clipped
    drawWaveform(ctx, peaks, -1400, 0, 700, 80, '#4a6a7a')
    const rects = calls.filter(c => c.method === 'fillRect')
    // Should have fewer than 700 rects
    expect(rects.length).toBeLessThan(700)
  })
})

describe('drawMarkerDots', () => {
  function makeMockCtx2() {
    let currentFillStyle = ''
    const arcs: Array<{ x: number; y: number }> = []
    const ctx = {
      beginPath: vi.fn(),
      arc: vi.fn((...args: unknown[]) => arcs.push({ x: args[0] as number, y: args[1] as number })),
      fill: vi.fn(),
      stroke: vi.fn(),
      get fillStyle() { return currentFillStyle },
      set fillStyle(v: string) { currentFillStyle = v },
      strokeStyle: '',
      lineWidth: 1,
      globalAlpha: 1
    } as unknown as CanvasRenderingContext2D
    return { ctx, arcs }
  }

  it('draws one arc (2 arcs = dot + ring) per visible marker', () => {
    const { ctx } = makeMockCtx2()
    const markers = [
      { id: 'm1', time: 1.0, label: 'Verse', type: 'verse' as const },
      { id: 'm2', time: 3.0, label: 'Chorus', type: 'chorus' as const }
    ]
    const colors = { verse: '#66bb6a', chorus: '#ef5350' }
    // pxPerSec = 100, canvas 700px wide, both markers visible (100px, 300px)
    drawMarkerDots(ctx as CanvasRenderingContext2D, markers, 100, 0, 80, colors)
    // 2 markers × 2 arcs (dot + ring) = 4
    expect((ctx.arc as ReturnType<typeof vi.fn>).mock.calls.length).toBe(4)
  })

  it('skips markers beyond canvas width', () => {
    const { ctx } = makeMockCtx2()
    const markers = [
      { id: 'm1', time: 10.0, label: 'Out of view' }  // 10 * 100 = 1000px > 700
    ]
    drawMarkerDots(ctx as CanvasRenderingContext2D, markers, 100, 0, 80, {})
    expect((ctx.arc as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
  })

  it('skips markers at negative time', () => {
    const { ctx } = makeMockCtx2()
    const markers = [
      { id: 'm1', time: -1.0, label: 'Negative' }  // -1 * 100 = -100px < 0
    ]
    drawMarkerDots(ctx as CanvasRenderingContext2D, markers, 100, 0, 80, {})
    expect((ctx.arc as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
  })
})
