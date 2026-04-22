// Pure helpers for the Show Timer panel. Kept side-effect-free so they can
// be unit-tested without a DOM or Zustand. See F4 sprint contract (AC-5, AC-6, AC-12)
// and the 測試計畫 section for the exact behaviours covered by showTimer.test.ts.

/** Format a non-negative millisecond value as `MM:SS` or `H:MM:SS` when >= 1h. */
export function formatRemaining(ms: number): string {
  // Clamp negatives (callers should already clamp, but defensive)
  const clamped = ms < 0 ? 0 : ms
  // Round UP to the next whole second while any sub-second remainder exists —
  // so a freshly-started 15-minute timer reads "15:00" for almost the full
  // first second rather than flipping to 14:59 immediately.
  const totalSeconds = Math.ceil(clamped / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`
  }
  return `${pad(minutes)}:${pad(seconds)}`
}

export interface TimerLike {
  running: boolean
  startedAt: number | null
  durationMs: number
  remainingMsAtStop: number
}

/**
 * Compute the timer's current remaining milliseconds.
 *
 * Wall-clock arithmetic: when running, we compute `durationMs - (now - startedAt)`
 * and clamp to `[0, durationMs]`. This survives tab throttling / backgrounding
 * (see AC-5) and is robust against clock rollback (clamp to durationMs) and
 * long sleeps past the deadline (clamp to 0).
 */
export function computeRemaining(timer: TimerLike, now: number): number {
  if (!timer.running || timer.startedAt === null) {
    const stored = timer.remainingMsAtStop
    if (!Number.isFinite(stored)) return 0
    if (stored < 0) return 0
    if (stored > timer.durationMs) return timer.durationMs
    return stored
  }
  const elapsed = now - timer.startedAt
  // Clock rollback guard: if now went backwards, remaining must not exceed durationMs.
  if (elapsed < 0) return timer.durationMs
  const remaining = timer.durationMs - elapsed
  if (remaining <= 0) return 0
  if (remaining > timer.durationMs) return timer.durationMs
  return remaining
}

/** True when a running timer has reached (or passed) zero at the given now. */
export function hasCompleted(timer: TimerLike, now: number): boolean {
  if (!timer.running || timer.startedAt === null) return false
  return now - timer.startedAt >= timer.durationMs
}

/** Parse a `mm:ss` or `m:ss` or bare seconds string into milliseconds.
 *  Returns null for invalid or non-positive input. Used by the new-timer form. */
export function parseDurationInput(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  // Bare integer = minutes (convenience: "15" -> 15 minutes)
  if (/^\d+$/.test(trimmed)) {
    const mins = parseInt(trimmed, 10)
    if (!Number.isFinite(mins) || mins <= 0) return null
    return mins * 60 * 1000
  }
  // mm:ss or h:mm:ss
  const parts = trimmed.split(':').map(s => s.trim())
  if (parts.some(p => !/^\d+$/.test(p))) return null
  const nums = parts.map(p => parseInt(p, 10))
  if (nums.some(n => !Number.isFinite(n) || n < 0)) return null
  let totalSeconds = 0
  if (nums.length === 2) {
    const [m, s] = nums
    if (s >= 60) return null
    totalSeconds = m * 60 + s
  } else if (nums.length === 3) {
    const [h, m, s] = nums
    if (m >= 60 || s >= 60) return null
    totalSeconds = h * 3600 + m * 60 + s
  } else {
    return null
  }
  if (totalSeconds <= 0) return null
  return totalSeconds * 1000
}
