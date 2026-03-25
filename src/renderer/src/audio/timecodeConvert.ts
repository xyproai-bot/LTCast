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
    const h = Math.floor(totalFrames / (3600 * fpsInt))
    totalFrames -= h * 3600 * fpsInt
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
