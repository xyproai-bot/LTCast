import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ChaseEngine, ChaseCue, ChaseEngineCallbacks } from '../ChaseEngine'
import type { LtcSegment } from '../../store'

// Helpers ---------------------------------------------------------------

/** Build a single 25fps LtcSegment from human-readable inputs. */
function seg(opts: {
  setlistIdx: number   // unused — passed via updateSegmentIndex below
  audioStartSec: number
  audioEndSec: number
  tcStartFrames: number
  tcEndFrames: number
  fps?: number
  dropFrame?: boolean
}): LtcSegment {
  return {
    audioStartSec: opts.audioStartSec,
    audioEndSec: opts.audioEndSec,
    tcAtStartFrames: opts.tcStartFrames,
    tcAtEndFrames: opts.tcEndFrames,
    fps: opts.fps ?? 25,
    dropFrame: opts.dropFrame ?? false,
  }
}

// Strongly-typed mock factory — declaring the signatures stops vi.fn()
// from collapsing to the union of overloaded vi.fn types which strict
// tsc considers incompatible with the ChaseEngineCallbacks interface.
type CB = {
  onSongChange: ReturnType<typeof vi.fn<(setlistIdx: number, audioOffsetSec: number) => void>>
  onStatusChange: ReturnType<typeof vi.fn<(s: import('../../store').ChaseStatus) => void>>
  onTcUpdate: ReturnType<typeof vi.fn<(chaseSec: number) => void>>
  onFireCue: ReturnType<typeof vi.fn<(cueId: string) => void>>
}
function makeCallbacks(): CB {
  return {
    onSongChange: vi.fn<(setlistIdx: number, audioOffsetSec: number) => void>(),
    onStatusChange: vi.fn<(s: import('../../store').ChaseStatus) => void>(),
    onTcUpdate: vi.fn<(chaseSec: number) => void>(),
    onFireCue: vi.fn<(cueId: string) => void>(),
  }
}
// Helper to satisfy `ChaseEngineCallbacks` parameter typing while keeping the
// mocks available for assertions.
function asCallbacks(cb: CB): ChaseEngineCallbacks { return cb as unknown as ChaseEngineCallbacks }

describe('ChaseEngine — segment index + song matching', () => {
  let engine: ChaseEngine
  let cb: ReturnType<typeof makeCallbacks>

  beforeEach(() => {
    engine = new ChaseEngine()
    cb = makeCallbacks()
  })

  it('boots into "lost" status when no LTC has been received', () => {
    engine.start(asCallbacks(cb))
    expect(cb.onStatusChange).toHaveBeenCalledWith('lost')
    engine.stop()
  })

  it('emits song change when incoming TC enters a different segment', () => {
    // Song 0: TC 01:00:00:00 – 01:00:10:00 (25fps)
    // Song 1: TC 02:00:00:00 – 02:00:10:00 (25fps)
    engine.updateSegmentIndex([
      {
        setlistIdx: 0, segments: [seg({
          setlistIdx: 0, audioStartSec: 0, audioEndSec: 10,
          tcStartFrames: 90000, tcEndFrames: 90250,
        })]
      },
      {
        setlistIdx: 1, segments: [seg({
          setlistIdx: 1, audioStartSec: 0, audioEndSec: 10,
          tcStartFrames: 180000, tcEndFrames: 180250,
        })]
      },
    ])
    engine.start(asCallbacks(cb))

    // Fire a TC in song 0
    engine.onIncomingTc({ hours: 1, minutes: 0, seconds: 5, frames: 0, fps: 25, dropFrame: false })
    expect(cb.onSongChange).toHaveBeenCalledWith(0, 0)
    expect(cb.onSongChange).toHaveBeenCalledTimes(1)

    // Fire a TC in song 1
    engine.onIncomingTc({ hours: 2, minutes: 0, seconds: 2, frames: 0, fps: 25, dropFrame: false })
    expect(cb.onSongChange).toHaveBeenCalledWith(1, 0)
    expect(cb.onSongChange).toHaveBeenCalledTimes(2)

    engine.stop()
  })

  it('does NOT fire song change for a second frame in the same segment', () => {
    engine.updateSegmentIndex([
      {
        setlistIdx: 0, segments: [seg({
          setlistIdx: 0, audioStartSec: 0, audioEndSec: 10,
          tcStartFrames: 90000, tcEndFrames: 90250,
        })]
      },
    ])
    engine.start(asCallbacks(cb))
    engine.onIncomingTc({ hours: 1, minutes: 0, seconds: 1, frames: 0, fps: 25, dropFrame: false })
    engine.onIncomingTc({ hours: 1, minutes: 0, seconds: 2, frames: 0, fps: 25, dropFrame: false })
    engine.onIncomingTc({ hours: 1, minutes: 0, seconds: 3, frames: 0, fps: 25, dropFrame: false })
    expect(cb.onSongChange).toHaveBeenCalledTimes(1)
    engine.stop()
  })

  it('emits NaN onTcUpdate when TC falls outside all segments', () => {
    engine.updateSegmentIndex([
      {
        setlistIdx: 0, segments: [seg({
          setlistIdx: 0, audioStartSec: 0, audioEndSec: 10,
          tcStartFrames: 90000, tcEndFrames: 90250,
        })]
      },
    ])
    engine.start(asCallbacks(cb))
    engine.onIncomingTc({ hours: 5, minutes: 0, seconds: 0, frames: 0, fps: 25, dropFrame: false })
    const last = cb.onTcUpdate.mock.calls[cb.onTcUpdate.mock.calls.length - 1][0]
    expect(Number.isNaN(last)).toBe(true)
    expect(cb.onSongChange).not.toHaveBeenCalled()
    engine.stop()
  })

  it('transitions status: lost → chasing on first frame', () => {
    engine.start(asCallbacks(cb))
    cb.onStatusChange.mockClear()
    engine.updateSegmentIndex([
      {
        setlistIdx: 0, segments: [seg({
          setlistIdx: 0, audioStartSec: 0, audioEndSec: 10,
          tcStartFrames: 90000, tcEndFrames: 90250,
        })]
      },
    ])
    engine.onIncomingTc({ hours: 1, minutes: 0, seconds: 1, frames: 0, fps: 25, dropFrame: false })
    expect(cb.onStatusChange).toHaveBeenCalledWith('chasing')
    engine.stop()
  })

  it('fires cues whose triggerTimecode falls between previous and current frame', () => {
    engine.updateSegmentIndex([
      {
        setlistIdx: 0, segments: [seg({
          setlistIdx: 0, audioStartSec: 0, audioEndSec: 10,
          tcStartFrames: 90000, tcEndFrames: 90250,
        })]
      },
    ])
    // Cue at exactly 01:00:02:00 — should fire when we cross that point.
    const cues: ChaseCue[] = [
      { id: 'cue-1', enabled: true, triggerTimecode: '01:00:02:00' },
      { id: 'cue-2', enabled: false, triggerTimecode: '01:00:03:00' },
    ]
    engine.start(asCallbacks(cb))
    engine.setActiveSongCues(cues)
    // First frame at 01:00:01:00 — well before cue-1
    engine.onIncomingTc({ hours: 1, minutes: 0, seconds: 1, frames: 0, fps: 25, dropFrame: false })
    expect(cb.onFireCue).not.toHaveBeenCalled()
    // Cross the cue
    engine.onIncomingTc({ hours: 1, minutes: 0, seconds: 3, frames: 0, fps: 25, dropFrame: false })
    expect(cb.onFireCue).toHaveBeenCalledWith('cue-1')
    // Disabled cue must not fire
    expect(cb.onFireCue).not.toHaveBeenCalledWith('cue-2')
    // Subsequent frames don't re-fire the same cue
    engine.onIncomingTc({ hours: 1, minutes: 0, seconds: 4, frames: 0, fps: 25, dropFrame: false })
    expect(cb.onFireCue).toHaveBeenCalledTimes(1)
    engine.stop()
  })

  it('entering a song mid-way does NOT dump every earlier cue at once', () => {
    engine.updateSegmentIndex([
      {
        setlistIdx: 0, segments: [seg({
          setlistIdx: 0, audioStartSec: 0, audioEndSec: 30,
          tcStartFrames: 90000, tcEndFrames: 90750,  // 01:00:00:00 – 01:00:30:00 @ 25fps
        })]
      },
    ])
    // Two cues — one at 01:00:05:00, one at 01:00:20:00
    const cues: ChaseCue[] = [
      { id: 'cue-early', enabled: true, triggerTimecode: '01:00:05:00' },
      { id: 'cue-late',  enabled: true, triggerTimecode: '01:00:20:00' },
    ]
    engine.start(asCallbacks(cb))
    engine.setActiveSongCues(cues)
    // Operator joins at 01:00:15:00 — past cue-early, before cue-late.
    engine.onIncomingTc({ hours: 1, minutes: 0, seconds: 15, frames: 0, fps: 25, dropFrame: false })
    // cue-early must NOT fire (we joined past it)
    expect(cb.onFireCue).not.toHaveBeenCalledWith('cue-early')
    // Now advance past cue-late
    engine.onIncomingTc({ hours: 1, minutes: 0, seconds: 21, frames: 0, fps: 25, dropFrame: false })
    expect(cb.onFireCue).toHaveBeenCalledWith('cue-late')
    expect(cb.onFireCue).not.toHaveBeenCalledWith('cue-early')
    engine.stop()
  })

  it('resets fired cues on song change', () => {
    engine.updateSegmentIndex([
      {
        setlistIdx: 0, segments: [seg({
          setlistIdx: 0, audioStartSec: 0, audioEndSec: 10,
          tcStartFrames: 90000, tcEndFrames: 90250,
        })]
      },
      {
        setlistIdx: 1, segments: [seg({
          setlistIdx: 1, audioStartSec: 0, audioEndSec: 10,
          tcStartFrames: 180000, tcEndFrames: 180250,
        })]
      },
    ])
    engine.start(asCallbacks(cb))
    engine.setActiveSongCues([
      { id: 'song0-cue', enabled: true, triggerTimecode: '01:00:02:00' },
    ])
    // In song 0 — fire it
    engine.onIncomingTc({ hours: 1, minutes: 0, seconds: 1, frames: 0, fps: 25, dropFrame: false })
    engine.onIncomingTc({ hours: 1, minutes: 0, seconds: 3, frames: 0, fps: 25, dropFrame: false })
    expect(cb.onFireCue).toHaveBeenCalledWith('song0-cue')
    cb.onFireCue.mockClear()
    // Switch to song 1; host calls setActiveSongCues with a fresh cue list
    engine.onIncomingTc({ hours: 2, minutes: 0, seconds: 1, frames: 0, fps: 25, dropFrame: false })
    engine.setActiveSongCues([
      { id: 'song1-cue', enabled: true, triggerTimecode: '02:00:02:00' },
    ])
    engine.onIncomingTc({ hours: 2, minutes: 0, seconds: 3, frames: 0, fps: 25, dropFrame: false })
    expect(cb.onFireCue).toHaveBeenCalledWith('song1-cue')
    engine.stop()
  })

  it('binary lookup over 100 segments stays fast (sanity perf check)', () => {
    // Build 100 non-overlapping segments at 1-second TC offsets.
    const songs: Array<{ setlistIdx: number; segments: LtcSegment[] }> = []
    for (let i = 0; i < 100; i++) {
      songs.push({
        setlistIdx: i,
        segments: [seg({
          setlistIdx: i,
          audioStartSec: 0, audioEndSec: 10,
          tcStartFrames: i * 1000, tcEndFrames: i * 1000 + 250,
        })],
      })
    }
    engine.updateSegmentIndex(songs)
    expect(engine._indexSize()).toBe(100)
    engine.start(asCallbacks(cb))
    // Drive 1000 incoming TC frames spread across the index — should be quick
    // (no assertion on time; this exists to catch O(N) regressions in CI).
    const start = performance.now()
    for (let i = 0; i < 1000; i++) {
      const idx = i % 100
      // Hits segment[idx] (tcStartFrames = idx*1000) at frame +50 → 2sec in
      engine.onIncomingTc({
        hours: 0, minutes: 0, seconds: Math.floor((idx * 1000 + 50) / 25),
        frames: (idx * 1000 + 50) % 25, fps: 25, dropFrame: false,
      })
    }
    const elapsedMs = performance.now() - start
    // Generous bound — vitest containers can be slow. The intent is a regression
    // detector, not a benchmark: O(N) traversal here would be ~10×.
    expect(elapsedMs).toBeLessThan(200)
    engine.stop()
  })
})

describe('ChaseEngine — start/stop lifecycle', () => {
  it('stop() emits idle and disposes ticker', () => {
    const engine = new ChaseEngine()
    const cb = makeCallbacks()
    engine.start(asCallbacks(cb))
    engine.stop()
    expect(cb.onStatusChange).toHaveBeenCalledWith('idle')
    expect(engine.isEnabled()).toBe(false)
  })

  it('idempotent start — second start is a no-op', () => {
    const engine = new ChaseEngine()
    const cb1 = makeCallbacks()
    const cb2 = makeCallbacks()
    engine.start(asCallbacks(cb1))
    engine.start(asCallbacks(cb2))  // ignored
    engine.onIncomingTc({ hours: 0, minutes: 0, seconds: 0, frames: 0, fps: 25, dropFrame: false })
    // Original callbacks should have been used
    expect(cb1.onStatusChange).toHaveBeenCalled()
    expect(cb2.onStatusChange).not.toHaveBeenCalled()
    engine.stop()
  })
})
