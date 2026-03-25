import { describe, it, expect } from 'vitest'
import { tcToFrames, framesToTc, tcToString } from '../timecodeConvert'

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
