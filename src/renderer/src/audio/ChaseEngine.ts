/**
 * ChaseEngine — D3-style "follow external timecode" mode.
 *
 * When enabled, the engine takes raw LTC frames coming in from the existing
 * LTC AudioWorklet decoder (or, in this build, from a typed event the UI
 * forwards from `AudioEngine.onTimecode`) and:
 *
 *   1. Maps the incoming TC to a setlist song using a pre-built sorted
 *      index of all scanned LtcSegment intervals.
 *   2. Notifies the host (App.tsx) when the song changes so the UI can
 *      open the new file.
 *   3. Streams a "virtual chase time" in seconds to the host every LTC
 *      frame so the waveform cursor can follow the programmer's TC even
 *      when audio isn't playing.
 *   4. Watches for cue points on the active song and fires them at the
 *      same one-frame resolution the normal scheduler uses.
 *   5. Continues running on its own clock when LTC drops out briefly
 *      (freewheel) and reports 'lost' when it's been silent too long.
 *
 * Performance: the per-frame hot path is binary-search over the segment
 * index, an integer comparison, and at most one event callback. No React
 * state writes happen in the hot path — UI updates ride the callbacks
 * and are throttled by the host.
 *
 * The engine does NOT itself control audio output. Whether audio plays
 * during chase is a separate concern handled by the host: when
 * `chaseOutputAudio` is enabled in settings, App.tsx still pumps the
 * music playback context normally; otherwise it stays paused (default
 * "visual + MIDI cues only" behaviour).
 */

import type { LtcSegment, ChaseStatus } from '../store'
import { tcToFrames } from './timecodeConvert'

export interface ChaseTimecode {
  hours: number
  minutes: number
  seconds: number
  frames: number
  fps: number
  dropFrame: boolean
}

/** All segment intervals laid out in chase-time (real-seconds) space. */
interface IndexEntry {
  setlistIdx: number
  segmentIdx: number
  startSec: number      // chase-time = seconds since the start of the segment's TC
  endSec: number
  audioOffsetSec: number  // audio file position at startSec
  fps: number
  /** Source segment, retained so we can map back to TC for cue firing. */
  seg: LtcSegment
}

export interface ChaseEngineCallbacks {
  /** Fires when chase decides the incoming TC belongs to a different song. */
  onSongChange: (setlistIdx: number, audioOffsetSec: number) => void
  /** Fires on chase status transitions (idle ↔ chasing ↔ freewheeling ↔ lost). */
  onStatusChange: (status: ChaseStatus) => void
  /** Fires every frame with the engine's current "virtual chase seconds"
   *  inside the matched segment — used to drive the waveform cursor. */
  onTcUpdate: (chaseSecondsInSong: number) => void
  /** Fires when a MIDI cue should be triggered. */
  onFireCue: (cueId: string) => void
}

/** Setlist cue spec we use internally — minimal contract from MidiCuePoint. */
export interface ChaseCue {
  id: string
  enabled: boolean
  triggerTimecode: string  // HH:MM:SS:FF (absolute TC, same format as MidiCuePoint)
  offsetFrames?: number
}

export class ChaseEngine {
  // ── Config ───────────────────────────────────────────────
  private enabled = false
  // Fixed 500 ms grace before we consider LTC "stopped". Below this,
  // status stays "chasing" (filters single-frame dropouts).
  private static readonly FREEWHEEL_GRACE_MS = 500
  private freewheelEnabled = true
  private lostThresholdMs = 5000
  private callbacks: ChaseEngineCallbacks | null = null

  // ── Index over all setlist segments ──────────────────────
  // Sorted by startSec. Built when start() is called and rebuilt on
  // updateSegmentIndex(). A binary search picks the matching entry on
  // every incoming TC frame.
  private index: IndexEntry[] = []

  // ── Active song / cues ───────────────────────────────────
  private activeIdx: number | null = null
  private activeCues: ChaseCue[] = []
  private firedCueIds = new Set<string>()
  /** Last incoming SMPTE frame count (seconds-since-midnight). Used to
   *  build a "between last and current frame" range for cue firing —
   *  cues fire on `prev < cueFrames ≤ current`, mirroring the playback
   *  path's `if cueFrames <= currentFrames` behaviour. */
  private lastIncomingFrames = -Infinity

  // ── Status tracking ──────────────────────────────────────
  private status: ChaseStatus = 'idle'
  private lastLtcAtMs = 0
  private statusTicker: ReturnType<typeof setInterval> | null = null

  /** Build (or rebuild) the segment index from current setlist state.
   *  Expected input: list of { setlistIdx, segments } pairs. */
  updateSegmentIndex(songs: Array<{ setlistIdx: number; segments: LtcSegment[] }>): void {
    const entries: IndexEntry[] = []
    for (const { setlistIdx, segments } of songs) {
      for (let segmentIdx = 0; segmentIdx < segments.length; segmentIdx++) {
        const seg = segments[segmentIdx]
        const segStartSec = seg.tcAtStartFrames / seg.fps
        const segEndSec = seg.tcAtEndFrames / seg.fps
        if (!isFinite(segStartSec) || !isFinite(segEndSec) || segEndSec < segStartSec) continue
        entries.push({
          setlistIdx,
          segmentIdx,
          startSec: segStartSec,
          endSec: segEndSec,
          audioOffsetSec: seg.audioStartSec,
          fps: seg.fps,
          seg,
        })
      }
    }
    // Stable sort by startSec; ties are broken by setlistIdx so consistent
    // matches happen across rebuilds.
    entries.sort((a, b) => (a.startSec - b.startSec) || (a.setlistIdx - b.setlistIdx))
    this.index = entries
  }

  /** Update the active song's cue list (App.tsx calls this on song change). */
  setActiveSongCues(cues: ChaseCue[]): void {
    this.activeCues = cues
    this.firedCueIds = new Set()
    this.lastIncomingFrames = -Infinity
  }

  /** Per-install freewheel toggle from Settings → Chase. When ON, LTC
   *  drop transitions to "freewheeling" (internal clock keeps running).
   *  When OFF, LTC drop transitions directly to "lost". */
  setFreewheelEnabled(enabled: boolean): void {
    this.freewheelEnabled = enabled
  }

  /** Start the engine. Spawns the freewheel/lost ticker. */
  start(callbacks: ChaseEngineCallbacks): void {
    if (this.enabled) return
    this.enabled = true
    this.callbacks = callbacks
    this.activeIdx = null
    this.firedCueIds = new Set()
    this.lastIncomingFrames = -Infinity
    // No LTC received yet, so we boot into 'lost' (per spec).
    this._setStatus('lost')
    // Tick at 100ms — coarse enough to be cheap, fast enough to react
    // to a 500ms freewheel threshold in good time.
    this.statusTicker = setInterval(() => this._checkStatus(), 100)
  }

  /** Stop the engine — release the ticker, reset state. */
  stop(): void {
    if (!this.enabled) return
    this.enabled = false
    if (this.statusTicker) {
      clearInterval(this.statusTicker)
      this.statusTicker = null
    }
    this.callbacks?.onStatusChange('idle')
    this.callbacks = null
    this.status = 'idle'
    this.activeIdx = null
    this.activeCues = []
    this.firedCueIds = new Set()
    this.lastIncomingFrames = -Infinity
  }

  /** Is the engine currently running? */
  isEnabled(): boolean { return this.enabled }

  /** Current status (for the UI badge / SetlistPanel lock check). */
  getStatus(): ChaseStatus { return this.status }

  /**
   * Hot path — called once per incoming LTC frame.
   *
   * The conversion to "seconds since midnight" is intentional: it lets us
   * compare incoming TC against scanned segments even when fps differs,
   * without integer-math gymnastics. The seconds value is rounded to the
   * nearest 1 ms before comparison so 25fps vs 29.97 DF rounding noise
   * doesn't bounce us out of a segment.
   */
  onIncomingTc(tc: ChaseTimecode): void {
    if (!this.enabled || !this.callbacks) return

    // Mark "we heard from LTC now" before any return paths so the
    // freewheel/lost ticker sees the fresh timestamp.
    this.lastLtcAtMs = Date.now()
    if (this.status !== 'chasing') this._setStatus('chasing')

    const fps = tc.fps
    if (!fps || fps <= 0 || !isFinite(fps)) return
    const tcStr = [tc.hours, tc.minutes, tc.seconds, tc.frames]
      .map(n => String(n).padStart(2, '0'))
      .join(tc.dropFrame ? ';' : ':')
    const incomingFrames = tcToFrames(tcStr, fps)
    // Round to ms for cross-fps comparison stability.
    const incomingSec = Math.round((incomingFrames / fps) * 1000) / 1000

    // Binary search for the segment whose [startSec, endSec] contains incomingSec.
    const hit = this._findSegment(incomingSec)

    if (hit === null) {
      // Outside every scanned segment. Don't change active song; just
      // notify the cursor stream so the UI knows "no match" (lastIncomingFrames
      // reset prevents stale cue firing on the next frame inside a song).
      this.lastIncomingFrames = -Infinity
      this.callbacks.onTcUpdate(NaN)
      return
    }

    // Compute the in-song seconds — relative to the segment's TC start —
    // and add the segment's audio-start offset to give a true "audio file
    // playhead position".
    const inSegmentSec = incomingSec - hit.startSec
    const chaseSecondsInSong = hit.audioOffsetSec + inSegmentSec

    // Song change?
    const songChanged = hit.setlistIdx !== this.activeIdx
    if (songChanged) {
      this.activeIdx = hit.setlistIdx
      this.firedCueIds = new Set()
      // Mark any cue with cueFrames <= incomingFrames as already-fired so
      // entering a song mid-way doesn't dump every earlier cue at once.
      // (Mirrors the seek-time logic in App's handleSeek which back-fills
      // triggeredCueIds for cues before the new playhead.)
      for (const cue of this.activeCues) {
        const cueFrames = tcToFrames(cue.triggerTimecode, fps) + (cue.offsetFrames ?? 0)
        if (cueFrames <= incomingFrames) this.firedCueIds.add(cue.id)
      }
      this.lastIncomingFrames = incomingFrames  // start cue-range window here
      this.callbacks.onSongChange(hit.setlistIdx, hit.audioOffsetSec)
      // Leave cue list update to the host — it will call setActiveSongCues
      // synchronously after onSongChange (we already cleared firedCueIds).
    } else {
      // Cue firing — cue triggerTimecode is an absolute SMPTE TC, compare it
      // against the incoming SMPTE frame count, not the audio-file position.
      // A cue fires when (lastIncomingFrames, incomingFrames] crosses cueFrames.
      if (this.activeCues.length > 0 && fps > 0) {
        const fromF = this.lastIncomingFrames
        const toF = incomingFrames
        for (const cue of this.activeCues) {
          if (!cue.enabled) continue
          if (this.firedCueIds.has(cue.id)) continue
          const cueFrames = tcToFrames(cue.triggerTimecode, fps) + (cue.offsetFrames ?? 0)
          if (cueFrames > fromF && cueFrames <= toF) {
            this.firedCueIds.add(cue.id)
            this.callbacks.onFireCue(cue.id)
          }
        }
      }
      this.lastIncomingFrames = incomingFrames
    }

    this.callbacks.onTcUpdate(chaseSecondsInSong)
  }

  /**
   * Binary search the sorted index for a segment whose [startSec, endSec]
   * contains `sec`. Returns the IndexEntry or null.
   *
   * The index can have overlapping intervals (two songs that share TC),
   * but for the chase use case "first match wins" matches operator
   * expectations: if two songs claim the same TC, the lower-numbered one
   * is the operator's authoritative pick.
   */
  private _findSegment(sec: number): IndexEntry | null {
    if (this.index.length === 0) return null
    // Find the last entry whose startSec <= sec; check if it contains sec.
    let lo = 0
    let hi = this.index.length - 1
    let candidate = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (this.index[mid].startSec <= sec) {
        candidate = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    if (candidate === -1) return null
    // Scan backward through any tied / overlapping entries to find the
    // first one that contains sec — keeps "lower setlistIdx wins" tie-break
    // consistent.
    for (let i = candidate; i >= 0; i--) {
      const e = this.index[i]
      if (sec >= e.startSec && sec <= e.endSec) {
        // also walk forward to a possibly earlier-setlistIdx tie:
        let best = e
        for (let j = i - 1; j >= 0 && this.index[j].startSec === e.startSec; j--) {
          if (sec <= this.index[j].endSec && this.index[j].setlistIdx < best.setlistIdx) {
            best = this.index[j]
          }
        }
        return best
      }
      // If this candidate's endSec is already before sec, no earlier entry
      // can contain sec (they have startSec ≤ this one's startSec).
      if (e.endSec < sec) break
    }
    return null
  }

  /** Status ticker — runs every 100ms while engine is enabled. */
  private _checkStatus(): void {
    if (!this.enabled || !this.callbacks) return
    if (this.lastLtcAtMs === 0) {
      // never received an LTC frame; status stays 'lost'
      if (this.status !== 'lost') this._setStatus('lost')
      return
    }
    const since = Date.now() - this.lastLtcAtMs
    if (since > this.lostThresholdMs) {
      if (this.status !== 'lost') this._setStatus('lost')
    } else if (since > ChaseEngine.FREEWHEEL_GRACE_MS) {
      // LTC dropped past the grace window. If freewheel is enabled we hold
      // "freewheeling" until lostThreshold; otherwise we go straight to lost.
      const nextStatus = this.freewheelEnabled ? 'freewheeling' : 'lost'
      if (this.status !== nextStatus) this._setStatus(nextStatus)
    } else {
      if (this.status !== 'chasing') this._setStatus('chasing')
    }
  }

  private _setStatus(s: ChaseStatus): void {
    if (this.status === s) return
    this.status = s
    this.callbacks?.onStatusChange(s)
  }

  // ── Test hooks ───────────────────────────────────────────
  /** Returns the index size; tests use this to verify rebuilds. */
  _indexSize(): number { return this.index.length }
  /** Returns the active setlist index; tests use this for song-change assertions. */
  _activeIdx(): number | null { return this.activeIdx }
}
