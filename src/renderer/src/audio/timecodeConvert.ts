/**
 * Pure timecode ↔ frame conversion functions.
 * Extracted from AudioEngine so they can be unit-tested independently.
 *
 * These two functions MUST be exact inverses:
 *   tcToFrames(framesToTc(n, fps), fps) === n   for all valid n
 *   framesToTc(tcToFrames(tc, fps), fps) === tc  for all valid tc
 */

export interface TcComponents {
  h: number
  m: number
  s: number
  f: number
}

/**
 * Convert a timecode string "HH:MM:SS:FF" (or "HH:MM:SS;FF") into
 * an absolute frame count.
 */
export function tcToFrames(tc: string, fps: number): number {
  const parts = tc.split(/[:;]/).map(Number)
  if (parts.length !== 4 || parts.some(p => isNaN(p))) return 0
  const [h, m, s, f] = parts

  if (fps === 29.97) {
    const fpsInt = 30
    const D = 2
    const framesPerMin = fpsInt * 60 - D          // 1798
    const framesPer10Min = framesPerMin * 10 + D   // 17982
    const framesPerHour = framesPer10Min * 6       // 107892
    const tenMinBlocks = Math.floor(m / 10)
    const mInBlock = m % 10
    let frames = h * framesPerHour + tenMinBlocks * framesPer10Min
    if (mInBlock === 0) {
      frames += s * fpsInt + f
    } else {
      frames += fpsInt * 60 + (mInBlock - 1) * framesPerMin + Math.max(0, s * fpsInt + f - D)
    }
    return frames
  } else {
    const fpsInt = Math.round(fps)
    return h * 3600 * fpsInt + m * 60 * fpsInt + s * fpsInt + f
  }
}

/**
 * Convert an absolute frame count back into { h, m, s, f }.
 * For 29.97 fps this uses the SMPTE drop-frame algorithm.
 */
export function framesToTc(totalFrames: number, fps: number): TcComponents {
  totalFrames = Math.max(0, totalFrames)
  const fpsInt = Math.round(fps)

  if (fps === 29.97) {
    const D = 2
    const framesPerMin = fpsInt * 60 - D           // 1798
    const framesPer10Min = framesPerMin * 10 + D   // 17982
    const framesPerHour = framesPer10Min * 6       // 107892

    // Wrap at 24 hours to match LTC receivers (SMPTE 12M only defines 0-23h)
    totalFrames = totalFrames % (framesPerHour * 24)

    const h = Math.floor(totalFrames / framesPerHour) % 24
    let remaining = totalFrames - h * framesPerHour
    const tenMinBlocks = Math.floor(remaining / framesPer10Min)
    remaining -= tenMinBlocks * framesPer10Min

    let mInBlock: number
    if (remaining < fpsInt * 60) {
      mInBlock = 0
    } else {
      remaining -= fpsInt * 60
      mInBlock = 1 + Math.floor(remaining / framesPerMin)
      remaining -= (mInBlock - 1) * framesPerMin
    }
    const m = tenMinBlocks * 10 + mInBlock
    const dropAdjusted = mInBlock > 0 ? remaining + D : remaining
    const s = Math.floor(dropAdjusted / fpsInt)
    const f = dropAdjusted - s * fpsInt

    return { h: h % 24, m: m % 60, s: s % 60, f: Math.min(f, 29) }
  } else {
    // Wrap at 24h
    const framesPerHour = 3600 * fpsInt
    totalFrames = totalFrames % (framesPerHour * 24)
    const h = Math.floor(totalFrames / framesPerHour)
    totalFrames -= h * framesPerHour
    const m = Math.floor(totalFrames / (60 * fpsInt))
    totalFrames -= m * 60 * fpsInt
    const s = Math.floor(totalFrames / fpsInt)
    const f = totalFrames - s * fpsInt

    return { h: h % 24, m: m % 60, s: s % 60, f: Math.min(f, fpsInt - 1) }
  }
}

/** Helper: format TcComponents back to "HH:MM:SS:FF" string */
export function tcToString(tc: TcComponents): string {
  return [tc.h, tc.m, tc.s, tc.f].map(n => String(n).padStart(2, '0')).join(':')
}

/**
 * Calculate frames per beat.
 * framesPerBeat = (60 / bpm) * fps, rounded to nearest integer frame.
 * @param bpm Beats per minute (must be > 0)
 * @param fps Frame rate (e.g. 25, 29.97, 30)
 * @returns Integer number of frames per beat
 */
export function framesPerBeat(bpm: number, fps: number): number {
  if (bpm <= 0 || fps <= 0) return 0
  return Math.round((60 / bpm) * fps)
}

/**
 * Nudge an offset by a number of beats.
 * @param currentFrames Current offset in frames
 * @param beats Number of beats to nudge (positive = forward, negative = backward; supports 0.5)
 * @param bpm Beats per minute (null → no-op, returns currentFrames unchanged)
 * @param fps Frame rate
 * @returns New offset in frames (integer)
 */
export function nudgeOffsetByBeats(currentFrames: number, beats: number, bpm: number | null, fps: number): number {
  if (bpm === null || bpm <= 0 || fps <= 0) return currentFrames
  const fpb = (60 / bpm) * fps
  const delta = beats * fpb
  // Round half away from zero so +N and -N beats are symmetric.
  // JS Math.round(-7.5) = -7, but we want -8 to match round(7.5)=8.
  const absDelta = Math.abs(delta)
  const rounded = Math.floor(absDelta + 0.5) * Math.sign(delta)
  return currentFrames + rounded
}

/**
 * Find the Nth marker (1-based) sorted by time.
 * Returns null if n < 1 or n > markers.length.
 */
export interface MarkerLike { id: string; time: number }

export function findNthMarker<T extends MarkerLike>(markers: T[], n: number): T | null {
  if (n < 1 || markers.length === 0) return null
  const sorted = [...markers].sort((a, b) => a.time - b.time)
  if (n > sorted.length) return null
  return sorted[n - 1]
}

/**
 * Find the adjacent marker (previous or next) from currentTime.
 * @param markers List of markers
 * @param currentTime Current playback time in seconds
 * @param dir 'prev' or 'next'
 * @param threshold Seconds tolerance (markers within threshold of currentTime
 *   are considered "at" current position for the prev direction)
 * @returns The adjacent marker or null if none exists in that direction
 */
export function findAdjacentMarker<T extends MarkerLike>(
  markers: T[],
  currentTime: number,
  dir: 'prev' | 'next',
  threshold = 0.5
): T | null {
  if (markers.length === 0) return null
  const sorted = [...markers].sort((a, b) => a.time - b.time)
  if (dir === 'prev') {
    // Nearest marker strictly before the threshold cutoff.
    // Markers within ±threshold of currentTime count as "current" and are skipped.
    const candidates = sorted.filter(m => m.time < currentTime - threshold)
    return candidates.length === 0 ? null : candidates[candidates.length - 1]
  } else {
    // Nearest marker strictly after the threshold cutoff.
    const candidates = sorted.filter(m => m.time > currentTime + threshold)
    return candidates.length === 0 ? null : candidates[0]
  }
}
