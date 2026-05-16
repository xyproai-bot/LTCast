// Lightweight Web Audio "beep" tone generator for completion alerts on the
// Show Timer panel. Lives outside the LTC/MTC AudioEngine because:
//   1. We don't want to share the dedicated LTC AudioContext (would risk
//      glitching active LTC output).
//   2. The beep is UI feedback only — no need for AudioWorklet or precise
//      scheduling.
//
// Uses a single lazy-instantiated AudioContext so the first beep may incur
// a one-time ~10 ms init cost; subsequent beeps reuse the same context.
// A short fade envelope avoids the audible click that raw oscillator
// gating would produce.

let ctx: AudioContext | null = null

// Lazily acquire the shared AudioContext. Returns null if the environment
// doesn't expose AudioContext (e.g. headless tests in jsdom).
function getCtx(): AudioContext | null {
  if (ctx) return ctx
  if (typeof window === 'undefined') return null
  const Ctor: typeof AudioContext | undefined =
    (window as Window & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (window as Window & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try {
    ctx = new Ctor()
  } catch {
    return null
  }
  return ctx
}

/**
 * Play a short beep tone.
 *
 * @param freq     Hz (default 440 — A4, sits below the LTC band so it
 *                 won't be confused with LTC audio leaking through).
 * @param duration ms per beep (default 200).
 * @param count    number of beeps in sequence (default 2). Beeps are
 *                 spaced by `duration` ms of silence so a 200 ms × 2
 *                 sequence finishes in ~600 ms.
 */
export function beep(freq = 440, duration = 200, count = 2): void {
  const audio = getCtx()
  if (!audio) return
  // Resume in case the context was suspended by the browser's autoplay
  // policy. Safe to call repeatedly; resume() returns a Promise but we
  // don't need to await it for scheduling — start times use audio.currentTime.
  if (audio.state === 'suspended') {
    audio.resume().catch(() => { /* ignore */ })
  }
  const startBase = audio.currentTime
  const durSec = Math.max(0.02, duration / 1000)
  const gapSec = durSec  // silence between beeps == beep length
  for (let i = 0; i < count; i++) {
    const t0 = startBase + i * (durSec + gapSec)
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    // Tiny fade in/out to suppress the click that a hard gate produces.
    // Peak gain 0.25 — plenty audible without being startling on monitors.
    const fade = Math.min(0.01, durSec * 0.1)
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(0.25, t0 + fade)
    gain.gain.setValueAtTime(0.25, t0 + durSec - fade)
    gain.gain.linearRampToValueAtTime(0, t0 + durSec)
    osc.connect(gain).connect(audio.destination)
    osc.start(t0)
    osc.stop(t0 + durSec + 0.02)
  }
}
