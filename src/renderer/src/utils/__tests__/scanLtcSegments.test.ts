import { describe, it, expect } from 'vitest'
import { segmentsFromLookup } from '../scanLtcSegments'
import type { TimecodeLookupEntry } from '../../audio/LtcDecoder'
import type { TimecodeFrame } from '../../store'

// Helper: build a TimecodeLookupEntry with the audio time + a TC built
// from frames/fps. dropFrame defaults to false (NDF) which is the common
// case for the synthetic fixtures below.
function entry(
  timeSec: number,
  hours: number, minutes: number, seconds: number, frames: number,
  fps: number, dropFrame = false
): TimecodeLookupEntry {
  const tc: TimecodeFrame = { hours, minutes, seconds, frames, fps, dropFrame }
  return { time: timeSec, tc }
}

describe('segmentsFromLookup', () => {
  it('returns [] for empty input', () => {
    expect(segmentsFromLookup([])).toEqual([])
  })

  it('builds a single segment from continuous frames', () => {
    // 25 fps, 4 seconds (100 frames) — continuous, no gaps.
    const entries: TimecodeLookupEntry[] = []
    for (let f = 0; f < 100; f++) {
      const sec = Math.floor(f / 25)
      const fr = f % 25
      entries.push(entry(f / 25, 1, 0, sec, fr, 25))
    }
    const segs = segmentsFromLookup(entries)
    expect(segs).toHaveLength(1)
    expect(segs[0].fps).toBe(25)
    expect(segs[0].dropFrame).toBe(false)
    expect(segs[0].audioStartSec).toBeCloseTo(0)
    // last entry at index 99 → audioEndSec close to 99/25
    expect(segs[0].audioEndSec).toBeCloseTo(99 / 25)
    // 1 hour at 25 fps = 90000 frames as the segment-start frame count
    expect(segs[0].tcAtStartFrames).toBe(90000)
    expect(segs[0].tcAtEndFrames).toBe(90099)
  })

  it('splits when there is a long time gap', () => {
    // Two batches separated by 2 seconds of audio silence — should split.
    const entries: TimecodeLookupEntry[] = []
    for (let f = 0; f < 30; f++) {
      entries.push(entry(f / 25, 1, 0, Math.floor(f / 25), f % 25, 25))
    }
    // Gap: next entry is 3 seconds later (well over SEGMENT_TIME_GAP_SEC).
    // Time gap alone forces a split.
    const base = 30 + 3 * 25
    for (let f = 0; f < 30; f++) {
      const absF = base + f
      entries.push(entry(absF / 25, 1, 0, Math.floor(absF / 25), absF % 25, 25))
    }
    const segs = segmentsFromLookup(entries)
    expect(segs.length).toBe(2)
    expect(segs[0].audioEndSec).toBeLessThan(segs[1].audioStartSec)
  })

  it('splits when TC jumps backward significantly', () => {
    // First chunk: 25fps from 01:00:00:00 onwards
    const entries: TimecodeLookupEntry[] = []
    for (let f = 0; f < 30; f++) {
      entries.push(entry(f / 25, 1, 0, Math.floor(f / 25), f % 25, 25))
    }
    // Second chunk: TC jumps backward to 00:30:00:00 but at the next audio sec
    const baseAudio = 30 / 25 + 0.02  // ~1.22 sec — within gap tolerance
    for (let f = 0; f < 30; f++) {
      entries.push(entry(baseAudio + f / 25, 0, 30, Math.floor(f / 25), f % 25, 25))
    }
    const segs = segmentsFromLookup(entries)
    expect(segs.length).toBeGreaterThanOrEqual(2)
  })

  it('drops segments shorter than MIN_SEGMENT_SEC (~0.5s)', () => {
    // Make a 0.2s segment then a long one. The first should be discarded.
    const entries: TimecodeLookupEntry[] = []
    for (let f = 0; f < 5; f++) {
      entries.push(entry(f / 25, 1, 0, 0, f, 25))
    }
    // Long gap, then a real segment
    for (let f = 0; f < 30; f++) {
      entries.push(entry(5 + f / 25, 1, 1, Math.floor(f / 25), f % 25, 25))
    }
    const segs = segmentsFromLookup(entries)
    // We expect exactly 1 segment because the first batch (0.2s) is below the
    // 0.5s minimum and gets dropped.
    expect(segs).toHaveLength(1)
    expect(segs[0].tcAtStartFrames).toBeGreaterThan(0)
  })
})
