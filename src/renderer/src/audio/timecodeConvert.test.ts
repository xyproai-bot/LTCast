import { describe, it, expect } from 'vitest'
import { tcToFrames, framesToTC } from './timecodeConvert'

// ── Helper ──────────────────────────────────────────────────
function roundTrip(h: number, m: number, s: number, f: number, fps: number): void {
  const frames = tcToFrames(h, m, s, f, fps)
  const back = framesToTC(frames, fps)
  expect(back, `RT ${h}:${m}:${s}:${f} @ ${fps}fps → ${frames} → ${JSON.stringify(back)}`).toEqual({
    h, m, s, f
  })
}

// ═════════════════════════════════════════════════════════════
//  29.97 DF round-trip
// ═════════════════════════════════════════════════════════════
describe('29.97 DF round-trip', () => {
  const fps = 29.97

  it('00:00:00:00', () => roundTrip(0, 0, 0, 0, fps))
  it('00:00:00:29', () => roundTrip(0, 0, 0, 29, fps))
  it('00:00:59:29', () => roundTrip(0, 0, 59, 29, fps))

  // Minute boundary — first frame after drop at non-10th minute
  it('00:01:00:02 (first valid frame after drop)', () => roundTrip(0, 1, 0, 2, fps))
  it('00:01:00:03', () => roundTrip(0, 1, 0, 3, fps))
  it('00:01:00:29', () => roundTrip(0, 1, 0, 29, fps))
  it('00:01:01:00', () => roundTrip(0, 1, 1, 0, fps))

  // 10th minute — no drop
  it('00:10:00:00 (10th minute, no drop)', () => roundTrip(0, 10, 0, 0, fps))
  it('00:10:00:01', () => roundTrip(0, 10, 0, 1, fps))
  it('00:20:00:00', () => roundTrip(0, 20, 0, 0, fps))

  // Various non-10th minutes
  it('00:02:00:02', () => roundTrip(0, 2, 0, 2, fps))
  it('00:09:00:02', () => roundTrip(0, 9, 0, 2, fps))
  it('00:11:00:02', () => roundTrip(0, 11, 0, 2, fps))
  it('00:19:00:02', () => roundTrip(0, 19, 0, 2, fps))
  it('00:59:00:02', () => roundTrip(0, 59, 0, 2, fps))

  // Hour boundaries
  it('01:00:00:00', () => roundTrip(1, 0, 0, 0, fps))
  it('12:00:00:00', () => roundTrip(12, 0, 0, 0, fps))
  it('23:00:00:00', () => roundTrip(23, 0, 0, 0, fps))

  // Max timecode
  it('23:59:59:29', () => roundTrip(23, 59, 59, 29, fps))

  // Mid-range values
  it('01:23:45:15', () => roundTrip(1, 23, 45, 15, fps))
  it('10:10:10:10', () => roundTrip(10, 10, 10, 10, fps))
})

// ═════════════════════════════════════════════════════════════
//  29.97 DF — invalid frame labels must NOT appear
// ═════════════════════════════════════════════════════════════
describe('29.97 DF — dropped frames never appear in output', () => {
  const fps = 29.97

  it('frame labels 00 and 01 never appear at second 0 of non-10th minutes', () => {
    // Total frames in 24 hours of 29.97 DF = 107892 * 24 = 2589408
    // We won't iterate all, but check every minute boundary
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m++) {
        const isDropMinute = m % 10 !== 0
        // Get the frame count for this minute start
        const startFrame = tcToFrames(h, m, 0, isDropMinute ? 2 : 0, fps)
        const tc = framesToTC(startFrame, fps)
        expect(tc.h).toBe(h)
        expect(tc.m).toBe(m)
        expect(tc.s).toBe(0)
        if (isDropMinute) {
          expect(tc.f).toBe(2)
        } else {
          expect(tc.f).toBe(0)
        }
      }
    }
  })
})

// ═════════════════════════════════════════════════════════════
//  29.97 DF — sequential frame counting
// ═════════════════════════════════════════════════════════════
describe('29.97 DF — sequential frames around minute boundaries', () => {
  const fps = 29.97

  it('frames across 00:00:59:29 → 00:01:00:02 are consecutive', () => {
    const a = tcToFrames(0, 0, 59, 29, fps)
    const b = tcToFrames(0, 1, 0, 2, fps)
    expect(b - a).toBe(1)
  })

  it('frames across 00:09:59:29 → 00:10:00:00 are consecutive', () => {
    const a = tcToFrames(0, 9, 59, 29, fps)
    const b = tcToFrames(0, 10, 0, 0, fps)
    expect(b - a).toBe(1)
  })

  it('frames across 00:10:59:29 → 00:11:00:02 are consecutive', () => {
    const a = tcToFrames(0, 10, 59, 29, fps)
    const b = tcToFrames(0, 11, 0, 2, fps)
    expect(b - a).toBe(1)
  })
})

// ═════════════════════════════════════════════════════════════
//  25 fps round-trip
// ═════════════════════════════════════════════════════════════
describe('25 fps round-trip', () => {
  const fps = 25

  it('00:00:00:00', () => roundTrip(0, 0, 0, 0, fps))
  it('00:00:00:24', () => roundTrip(0, 0, 0, 24, fps))
  it('00:01:00:00', () => roundTrip(0, 1, 0, 0, fps))
  it('00:59:59:24', () => roundTrip(0, 59, 59, 24, fps))
  it('01:00:00:00', () => roundTrip(1, 0, 0, 0, fps))
  it('23:59:59:24', () => roundTrip(23, 59, 59, 24, fps))
  it('12:34:56:12', () => roundTrip(12, 34, 56, 12, fps))

  it('total frames at 01:00:00:00 = 90000', () => {
    expect(tcToFrames(1, 0, 0, 0, 25)).toBe(90000)
  })
})

// ═════════════════════════════════════════════════════════════
//  30 fps (non-drop) round-trip
// ═════════════════════════════════════════════════════════════
describe('30 fps round-trip', () => {
  const fps = 30

  it('00:00:00:00', () => roundTrip(0, 0, 0, 0, fps))
  it('00:00:00:29', () => roundTrip(0, 0, 0, 29, fps))
  it('00:01:00:00', () => roundTrip(0, 1, 0, 0, fps))
  it('00:01:00:01 (no drop at 30fps)', () => roundTrip(0, 1, 0, 1, fps))
  it('01:00:00:00', () => roundTrip(1, 0, 0, 0, fps))
  it('23:59:59:29', () => roundTrip(23, 59, 59, 29, fps))
  it('10:10:10:15', () => roundTrip(10, 10, 10, 15, fps))

  it('total frames at 01:00:00:00 = 108000', () => {
    expect(tcToFrames(1, 0, 0, 0, 30)).toBe(108000)
  })
})

// ═════════════════════════════════════════════════════════════
//  Exhaustive brute-force: first 10 minutes of 29.97 DF
// ═════════════════════════════════════════════════════════════
describe('29.97 DF exhaustive — first 10 minutes', () => {
  const fps = 29.97
  const framesPer10Min = 17982

  it('every frame in 0–10 min round-trips correctly', () => {
    for (let frame = 0; frame < framesPer10Min; frame++) {
      const tc = framesToTC(frame, fps)
      const back = tcToFrames(tc.h, tc.m, tc.s, tc.f, fps)
      expect(back).toBe(frame)
    }
  })
})
