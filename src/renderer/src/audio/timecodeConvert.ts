/**
 * Pure timecode ↔ frame conversion utilities.
 * Extracted from AudioEngine so they can be unit-tested independently.
 */

export interface HMSF {
  h: number
  m: number
  s: number
  f: number
}

/**
 * Convert HH:MM:SS:FF timecode to an absolute frame count.
 * For 29.97 DF uses standard SMPTE drop-frame formula.
 * Must be the exact inverse of `framesToTC`.
 */
export function tcToFrames(h: number, m: number, s: number, f: number, fps: number): number {
  if (fps === 29.97) {
    const fpsInt = 30
    const D = 2
    const framesPerMin = fpsInt * 60 - D        // 1798
    const framesPer10Min = framesPerMin * 10 + D // 17982
    const framesPerHour = framesPer10Min * 6     // 107892

    const tenMinBlocks = Math.floor(m / 10)
    const mInBlock = m % 10
    let frames = h * framesPerHour + tenMinBlocks * framesPer10Min

    if (mInBlock === 0) {
      frames += s * fpsInt + f
    } else {
      frames += fpsInt * 60 + (mInBlock - 1) * framesPerMin + Math.max(0, s * fpsInt + f - D)
    }
    return frames
  }

  const fpsInt = Math.round(fps)
  return h * 3600 * fpsInt + m * 60 * fpsInt + s * fpsInt + f
}

/**
 * Convert an absolute frame count back to HH:MM:SS:FF timecode.
 * For 29.97 DF uses standard SMPTE drop-frame formula.
 * Must be the exact inverse of `tcToFrames`.
 */
export function framesToTC(totalFrames: number, fps: number): HMSF {
  totalFrames = Math.max(0, totalFrames)
  const fpsInt = Math.round(fps)

  if (fps === 29.97) {
    const D = 2
    const framesPerMin = fpsInt * 60 - D           // 1798
    const framesPer10Min = framesPerMin * 10 + D   // 17982
    const framesPerHour = framesPer10Min * 6       // 107892

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

    return { h: h % 24, m: m % 60, s: s % 60, f: Math.min(f, fpsInt - 1) }
  }

  // Non-drop-frame (25, 30, etc.)
  let rem = totalFrames
  const h = Math.floor(rem / (3600 * fpsInt))
  rem -= h * 3600 * fpsInt
  const m = Math.floor(rem / (60 * fpsInt))
  rem -= m * 60 * fpsInt
  const s = Math.floor(rem / fpsInt)
  const f = rem - s * fpsInt

  return { h: h % 24, m: m % 60, s: s % 60, f: Math.min(f, fpsInt - 1) }
}
