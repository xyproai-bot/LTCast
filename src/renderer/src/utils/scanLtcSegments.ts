/**
 * scanLtcSegments — offline scan an AudioBuffer for runs of LTC.
 *
 * A "segment" is a continuous stretch of LTC frames inside an audio file.
 * One file may produce several segments if the operator paused LTC mid-song.
 * For each segment we record the audio file position (in seconds) it spans
 * plus the LTC TC at the segment's first and last decoded frame, expressed
 * as integer total-frame counts (via tcToFrames) so the chase hot path can
 * binary-search numerically instead of parsing TC strings.
 *
 * Reuses the same `buildTimecodeLookup` decoder that the existing offline
 * timecode display already runs on every loaded file (see LtcDecoder.ts) —
 * so a song that already shows a TC also yields chase-mode segments without
 * touching any worklet code.
 *
 * Performance note: this runs on the main thread. For a 5-minute 48kHz
 * stereo WAV the decoder is ~80–200 ms in practice; the scan manager limits
 * parallelism to keep the UI responsive.
 */
import { buildTimecodeLookup, TimecodeLookupEntry } from '../audio/LtcDecoder'
import { detectLtcChannel } from '../audio/LtcDetector'
import { LTC_CONFIDENCE_THRESHOLD } from '../constants'
import { tcToFrames } from '../audio/timecodeConvert'
import type { LtcSegment } from '../store'

export interface ScanProgress {
  progress: number  // 0..1
  status: 'scanning' | 'done' | 'error' | 'no-ltc'
}

/** Minimum duration (seconds) for a segment to survive filtering. */
const MIN_SEGMENT_SEC = 0.5
/** Frame-distance tolerance for "consecutive" frames within a segment. */
const CONSECUTIVE_FRAME_TOLERANCE = 2
/** Frame-distance threshold beyond which we consider it a new segment. */
const SEGMENT_BREAK_FRAMES = 5
/** Seconds without any decoded TC entry → close current segment. */
const SEGMENT_TIME_GAP_SEC = 0.5

/**
 * Build LtcSegment[] from a TimecodeLookupEntry[] produced by buildTimecodeLookup.
 *
 * Algorithm:
 *   - walk entries in order
 *   - within an open segment, accept the next entry as a continuation when:
 *       * the frame delta is small (≤ SEGMENT_BREAK_FRAMES at the segment fps)
 *       * AND the wall-time gap is < SEGMENT_TIME_GAP_SEC
 *     otherwise close the current segment and start a new one.
 *   - drop segments < MIN_SEGMENT_SEC long (treat as decoder noise / spurious sync).
 *
 * Entries with a different fps from the segment are tolerated within
 * SEGMENT_BREAK_FRAMES of the previous frame; if the new fps and TC are
 * far apart, the open segment closes and a fresh one starts.
 */
export function segmentsFromLookup(entries: TimecodeLookupEntry[]): LtcSegment[] {
  if (entries.length === 0) return []

  const segments: LtcSegment[] = []

  // Convert each entry to (timeSec, totalFrames @ entry.fps) up-front so we
  // do the tcToFrames work once per entry.
  const enriched = entries.map(e => {
    const tcStr = [e.tc.hours, e.tc.minutes, e.tc.seconds, e.tc.frames]
      .map(n => String(n).padStart(2, '0'))
      .join(e.tc.dropFrame ? ';' : ':')
    return {
      timeSec: e.time,
      frames: tcToFrames(tcStr, e.tc.fps),
      fps: e.tc.fps,
      dropFrame: e.tc.dropFrame,
    }
  })

  // Open-segment tracker
  let segStartTime = enriched[0].timeSec
  let segStartFrames = enriched[0].frames
  let segLastTime = enriched[0].timeSec
  let segLastFrames = enriched[0].frames
  let segFps = enriched[0].fps
  let segDropFrame = enriched[0].dropFrame

  const closeSegment = (): void => {
    const durSec = segLastTime - segStartTime
    if (durSec < MIN_SEGMENT_SEC) return  // drop noise
    segments.push({
      audioStartSec: segStartTime,
      audioEndSec: segLastTime,
      tcAtStartFrames: segStartFrames,
      tcAtEndFrames: segLastFrames,
      fps: segFps,
      dropFrame: segDropFrame,
    })
  }

  for (let i = 1; i < enriched.length; i++) {
    const cur = enriched[i]
    const dt = cur.timeSec - segLastTime
    const df = Math.abs(cur.frames - segLastFrames)
    // Same fps + (small frame delta OR small time delta + small drift)
    const sameFps = cur.fps === segFps
    const continuous = sameFps && dt < SEGMENT_TIME_GAP_SEC && df <= SEGMENT_BREAK_FRAMES
    // Strictly-consecutive frames (within tolerance) within ~1 frame's
    // worth of wall-time — the cleanest case for "still the same segment"
    const consecutiveTight = sameFps && df <= CONSECUTIVE_FRAME_TOLERANCE && dt < 0.1

    if (continuous || consecutiveTight) {
      segLastTime = cur.timeSec
      segLastFrames = cur.frames
    } else {
      closeSegment()
      segStartTime = cur.timeSec
      segStartFrames = cur.frames
      segLastTime = cur.timeSec
      segLastFrames = cur.frames
      segFps = cur.fps
      segDropFrame = cur.dropFrame
    }
  }
  // flush the trailing segment
  closeSegment()
  return segments
}

/**
 * Scan an AudioBuffer for LTC segments.
 *
 *  1. Run detectLtcChannel to pick the most-likely LTC channel.
 *  2. If confidence is below LTC_CONFIDENCE_THRESHOLD, return [] (no LTC).
 *  3. Otherwise run buildTimecodeLookup on that channel.
 *  4. Convert the lookup entries into segments via segmentsFromLookup.
 *
 * onProgress fires at coarse milestones (0.1, 0.5, 0.9, 1.0) — the
 * underlying decoder is synchronous, so we can't stream true progress
 * without rewriting it. The coarse pulses are enough to drive a "scanning
 * X / Y" overall counter in the UI without misleading detail.
 */
export async function scanLtcSegments(
  audioBuffer: AudioBuffer,
  onProgress?: (p: number) => void
): Promise<LtcSegment[]> {
  onProgress?.(0.1)
  // 1. Channel detection
  const detection = detectLtcChannel(audioBuffer)
  if (detection.confidence < LTC_CONFIDENCE_THRESHOLD) {
    onProgress?.(1.0)
    return []
  }
  onProgress?.(0.3)
  // 2. Build the entry-by-entry lookup table
  const channelData = audioBuffer.getChannelData(detection.channelIndex)
  const entries = buildTimecodeLookup(channelData, audioBuffer.sampleRate)
  onProgress?.(0.85)
  if (entries.length === 0) {
    onProgress?.(1.0)
    return []
  }
  // 3. Segment grouping
  const segments = segmentsFromLookup(entries)
  onProgress?.(1.0)
  return segments
}
