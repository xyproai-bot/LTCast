import { describe, it, expect } from 'vitest'
import { tcToFrames, framesToTc, tcToString, framesPerBeat, nudgeOffsetByBeats, findNthMarker, findAdjacentMarker } from '../timecodeConvert'

// ════════════════════════════════════════════════════════════════════
//  Helper
// ════════════════════════════════════════════════════════════════════

/** Round-trip: TC string → frames → TC string. Must be identity. */
function roundTrip(tc: string, fps: number): string {
  const frames = tcToFrames(tc, fps)
  const back = framesToTc(frames, fps)
  return tcToString(back)
}

/** Reverse round-trip: frame number → TC → frame number. Must be identity. */
function reverseRoundTrip(frame: number, fps: number): number {
  const tc = framesToTc(frame, fps)
  return tcToFrames(tcToString(tc), fps)
}

// ════════════════════════════════════════════════════════════════════
//  29.97 fps Drop-Frame
// ════════════════════════════════════════════════════════════════════

describe('29.97 DF — tcToFrames', () => {
  const fps = 29.97

  it('00:00:00:00 → 0', () => {
    expect(tcToFrames('00:00:00:00', fps)).toBe(0)
  })

  it('00:00:00:29 → 29', () => {
    expect(tcToFrames('00:00:00:29', fps)).toBe(29)
  })

  it('00:00:59:29 → last frame before minute 1', () => {
    // Minute 0 has 30*60 = 1800 frames (no drop at minute 0)
    expect(tcToFrames('00:00:59:29', fps)).toBe(1799)
  })

  it('00:01:00:02 → first valid frame of minute 1 (frames 00,01 skipped)', () => {
    // After minute 0 (1800 frames), DF skips labels 00 and 01
    expect(tcToFrames('00:01:00:02', fps)).toBe(1800)
  })

  it('00:10:00:00 → 17982 (10-minute boundary, no skip)', () => {
    expect(tcToFrames('00:10:00:00', fps)).toBe(17982)
  })

  it('01:00:00:00 → 107892', () => {
    expect(tcToFrames('01:00:00:00', fps)).toBe(107892)
  })

  it('23:59:59:29 → last frame of the day', () => {
    // 24 * 107892 - 1 = 2589407
    expect(tcToFrames('23:59:59:29', fps)).toBe(2589407)
  })
})

describe('29.97 DF — framesToTc', () => {
  const fps = 29.97

  it('0 → 00:00:00:00', () => {
    expect(tcToString(framesToTc(0, fps))).toBe('00:00:00:00')
  })

  it('1799 → 00:00:59:29', () => {
    expect(tcToString(framesToTc(1799, fps))).toBe('00:00:59:29')
  })

  it('1800 → 00:01:00:02 (DF skip)', () => {
    expect(tcToString(framesToTc(1800, fps))).toBe('00:01:00:02')
  })

  it('17982 → 00:10:00:00', () => {
    expect(tcToString(framesToTc(17982, fps))).toBe('00:10:00:00')
  })

  it('107892 → 01:00:00:00', () => {
    expect(tcToString(framesToTc(107892, fps))).toBe('01:00:00:00')
  })

  it('2589407 → 23:59:59:29', () => {
    expect(tcToString(framesToTc(2589407, fps))).toBe('23:59:59:29')
  })

  it('negative frames clamp to 00:00:00:00', () => {
    expect(tcToString(framesToTc(-100, fps))).toBe('00:00:00:00')
  })
})

describe('29.97 DF — round-trip (TC → frames → TC)', () => {
  const fps = 29.97

  const cases = [
    '00:00:00:00',
    '00:00:00:15',
    '00:00:59:29',
    '00:01:00:02',   // first valid DF frame
    '00:01:00:03',
    '00:01:00:29',
    '00:01:59:29',
    '00:02:00:02',
    '00:09:00:02',
    '00:09:59:29',
    '00:10:00:00',   // 10th minute — no skip
    '00:10:00:01',
    '00:11:00:02',
    '00:20:00:00',
    '00:59:59:29',
    '01:00:00:00',
    '01:01:00:02',
    '10:00:00:00',
    '12:34:56:12',
    '23:59:59:29',
  ]

  for (const tc of cases) {
    it(`${tc} survives round-trip`, () => {
      expect(roundTrip(tc, fps)).toBe(tc)
    })
  }
})

describe('29.97 DF — reverse round-trip (frames → TC → frames)', () => {
  const fps = 29.97

  // Test key boundary frame numbers
  const frames = [
    0, 1, 28, 29,
    1799, 1800, 1801,          // minute boundary
    3598, 3599, 3600,          // minute 2
    17981, 17982, 17983,       // 10-minute boundary
    107891, 107892, 107893,    // hour boundary
    2589406, 2589407,          // end of day
  ]

  for (const f of frames) {
    it(`frame ${f} survives reverse round-trip`, () => {
      expect(reverseRoundTrip(f, fps)).toBe(f)
    })
  }
})

describe('29.97 DF — exhaustive first-hour sweep', () => {
  const fps = 29.97

  it('all 107892 frames in hour 0 survive reverse round-trip', () => {
    for (let f = 0; f < 107892; f++) {
      const rt = reverseRoundTrip(f, fps)
      if (rt !== f) {
        // Provide a useful error message on first failure
        const tc = tcToString(framesToTc(f, fps))
        expect.fail(`frame ${f} → TC ${tc} → frame ${rt} (expected ${f})`)
      }
    }
  })
})

// ════════════════════════════════════════════════════════════════════
//  25 fps (non-drop)
// ════════════════════════════════════════════════════════════════════

describe('25 fps — tcToFrames', () => {
  const fps = 25

  it('00:00:00:00 → 0', () => {
    expect(tcToFrames('00:00:00:00', fps)).toBe(0)
  })

  it('00:00:01:00 → 25', () => {
    expect(tcToFrames('00:00:01:00', fps)).toBe(25)
  })

  it('00:01:00:00 → 1500', () => {
    expect(tcToFrames('00:01:00:00', fps)).toBe(1500)
  })

  it('01:00:00:00 → 90000', () => {
    expect(tcToFrames('01:00:00:00', fps)).toBe(90000)
  })

  it('23:59:59:24 → last frame of the day', () => {
    expect(tcToFrames('23:59:59:24', fps)).toBe(24 * 90000 - 1)
  })
})

describe('25 fps — round-trip', () => {
  const fps = 25

  const cases = [
    '00:00:00:00', '00:00:00:24', '00:00:59:24',
    '00:01:00:00', '00:59:59:24', '01:00:00:00',
    '12:30:15:12', '23:59:59:24',
  ]

  for (const tc of cases) {
    it(`${tc} survives round-trip`, () => {
      expect(roundTrip(tc, fps)).toBe(tc)
    })
  }
})

// ════════════════════════════════════════════════════════════════════
//  30 fps (non-drop)
// ════════════════════════════════════════════════════════════════════

describe('30 fps — tcToFrames', () => {
  const fps = 30

  it('00:00:00:00 → 0', () => {
    expect(tcToFrames('00:00:00:00', fps)).toBe(0)
  })

  it('00:01:00:00 → 1800', () => {
    expect(tcToFrames('00:01:00:00', fps)).toBe(1800)
  })

  it('01:00:00:00 → 108000', () => {
    expect(tcToFrames('01:00:00:00', fps)).toBe(108000)
  })

  it('23:59:59:29 → last frame', () => {
    expect(tcToFrames('23:59:59:29', fps)).toBe(24 * 108000 - 1)
  })
})

describe('30 fps — round-trip', () => {
  const fps = 30

  const cases = [
    '00:00:00:00', '00:00:00:29', '00:01:00:00',
    '00:01:00:01', '00:10:00:00', '01:00:00:00',
    '12:34:56:12', '23:59:59:29',
  ]

  for (const tc of cases) {
    it(`${tc} survives round-trip`, () => {
      expect(roundTrip(tc, fps)).toBe(tc)
    })
  }
})

// ════════════════════════════════════════════════════════════════════
//  Edge cases
// ════════════════════════════════════════════════════════════════════

describe('edge cases', () => {
  it('invalid TC string returns 0 frames', () => {
    expect(tcToFrames('garbage', 25)).toBe(0)
    expect(tcToFrames('12:34', 25)).toBe(0)
    expect(tcToFrames('', 25)).toBe(0)
  })

  it('29.97 DF: invalid labels 00 and 01 at non-10th minutes collapse to same frame as 02', () => {
    // In DF, frame labels 00 and 01 at second 0 of non-10th minutes don't exist.
    // Our tcToFrames clamps them via Math.max(0, ...), so :00 and :01 map to
    // the same frame count as :02 (the first real frame of that minute).
    for (let m = 1; m <= 59; m++) {
      if (m % 10 === 0) continue
      const mm = String(m).padStart(2, '0')
      const f02 = tcToFrames(`00:${mm}:00:02`, 29.97)
      const f00 = tcToFrames(`00:${mm}:00:00`, 29.97)
      const f01 = tcToFrames(`00:${mm}:00:01`, 29.97)
      expect(f00).toBe(f02)  // :00 collapses to :02
      expect(f01).toBe(f02)  // :01 collapses to :02
    }
  })

  it('framesToTc never outputs invalid DF labels (00 or 01 at non-10th minute, second 0)', () => {
    // Scan all frames in the first hour
    const fps = 29.97
    for (let frame = 0; frame < 107892; frame++) {
      const tc = framesToTc(frame, fps)
      if (tc.m % 10 !== 0 && tc.s === 0) {
        expect(tc.f).toBeGreaterThanOrEqual(2)
      }
    }
  })
})

// ════════════════════════════════════════════════════════════════════
//  F3 — framesPerBeat
// ════════════════════════════════════════════════════════════════════

describe('framesPerBeat', () => {
  it('120 BPM @ 25 fps = round(12.5) = 13', () => {
    expect(framesPerBeat(120, 25)).toBe(13)
  })

  it('120 BPM @ 30 fps = round(15) = 15', () => {
    expect(framesPerBeat(120, 30)).toBe(15)
  })

  it('120 BPM @ 29.97 fps = round(14.985) = 15', () => {
    expect(framesPerBeat(120, 29.97)).toBe(15)
  })

  it('60 BPM @ 25 fps = round(25) = 25', () => {
    expect(framesPerBeat(60, 25)).toBe(25)
  })

  it('60 BPM @ 30 fps = round(30) = 30', () => {
    expect(framesPerBeat(60, 30)).toBe(30)
  })

  it('140 BPM @ 25 fps = round(10.71) = 11', () => {
    expect(framesPerBeat(140, 25)).toBe(11)
  })

  it('bpm=0 returns 0', () => {
    expect(framesPerBeat(0, 25)).toBe(0)
  })

  it('fps=0 returns 0', () => {
    expect(framesPerBeat(120, 0)).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════════
//  F3 — nudgeOffsetByBeats
// ════════════════════════════════════════════════════════════════════

describe('nudgeOffsetByBeats', () => {
  it('+1 beat at 120 BPM / 25 fps adds 13 frames', () => {
    // (60/120)*25 = 12.5 → round(12.5) = 13 but nudge uses raw float internally
    // 0 + 1 * 12.5 = 12.5 → round = 13
    expect(nudgeOffsetByBeats(0, 1, 120, 25)).toBe(13)
  })

  it('-1 beat at 120 BPM / 25 fps subtracts 13 frames', () => {
    expect(nudgeOffsetByBeats(0, -1, 120, 25)).toBe(-13)
  })

  it('+0.5 beat at 120 BPM / 30 fps adds round(7.5)=8 frames', () => {
    // (60/120)*30=15 * 0.5 = 7.5 → round = 8
    expect(nudgeOffsetByBeats(0, 0.5, 120, 30)).toBe(8)
  })

  it('-0.5 beat at 120 BPM / 30 fps subtracts 8 frames', () => {
    expect(nudgeOffsetByBeats(0, -0.5, 120, 30)).toBe(-8)
  })

  it('bpm=null returns currentFrames unchanged', () => {
    expect(nudgeOffsetByBeats(42, 1, null, 25)).toBe(42)
  })

  it('bpm=0 returns currentFrames unchanged', () => {
    expect(nudgeOffsetByBeats(42, 1, 0, 25)).toBe(42)
  })

  it('accumulates correctly from non-zero start', () => {
    expect(nudgeOffsetByBeats(10, 1, 60, 30)).toBe(40)
  })

  it('handles 29.97 DF: result is integer', () => {
    const result = nudgeOffsetByBeats(0, 1, 120, 29.97)
    expect(Number.isInteger(result)).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════════
//  F4 — findNthMarker
// ════════════════════════════════════════════════════════════════════

describe('findNthMarker', () => {
  const markers = [
    { id: 'b', time: 20 },
    { id: 'a', time: 5 },
    { id: 'c', time: 45 },
  ]

  it('finds 1st marker (sorted by time)', () => {
    expect(findNthMarker(markers, 1)?.id).toBe('a')
  })

  it('finds 2nd marker', () => {
    expect(findNthMarker(markers, 2)?.id).toBe('b')
  })

  it('finds 3rd marker', () => {
    expect(findNthMarker(markers, 3)?.id).toBe('c')
  })

  it('returns null when n > markers.length', () => {
    expect(findNthMarker(markers, 4)).toBeNull()
  })

  it('returns null when n < 1', () => {
    expect(findNthMarker(markers, 0)).toBeNull()
  })

  it('returns null for empty array', () => {
    expect(findNthMarker([], 1)).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════
//  F4 — findAdjacentMarker
// ════════════════════════════════════════════════════════════════════

describe('findAdjacentMarker', () => {
  const markers = [
    { id: 'a', time: 5 },
    { id: 'b', time: 20 },
    { id: 'c', time: 45 },
  ]

  it('prev: returns closest marker before currentTime - threshold', () => {
    // currentTime=21, threshold=0.5 → cutoff=20.5 → markers <20.5: a(5), b(20) → return b
    expect(findAdjacentMarker(markers, 21, 'prev')?.id).toBe('b')
  })

  it('next: returns closest marker after currentTime + threshold', () => {
    // currentTime=19, threshold=0.5 → cutoff=19.5 → markers >19.5: b(20), c(45) → return b
    expect(findAdjacentMarker(markers, 19, 'next')?.id).toBe('b')
  })

  it('prev: returns null when no marker before threshold', () => {
    expect(findAdjacentMarker(markers, 5.3, 'prev')).toBeNull()
  })

  it('next: returns null when no marker after threshold', () => {
    expect(findAdjacentMarker(markers, 44.6, 'next')).toBeNull()
  })

  it('prev: respects 0.5s threshold (marker exactly 0.5s before = excluded)', () => {
    // currentTime = 5.5, threshold = 0.5 → must be < 5.0 → marker at 5.0 excluded
    expect(findAdjacentMarker(markers, 5.5, 'prev', 0.5)).toBeNull()
  })

  it('prev: marker at exactly threshold distance is excluded', () => {
    // currentTime=20.5, threshold=0.5 → cutoff=20.0 → b(20) excluded (not strictly <)
    // → only a(5) qualifies → return a
    expect(findAdjacentMarker(markers, 20.5, 'prev', 0.5)?.id).toBe('a')
  })

  it('returns null for empty markers', () => {
    expect(findAdjacentMarker([], 10, 'next')).toBeNull()
  })
})
