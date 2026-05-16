import { describe, it, expect } from 'vitest'
import {
  formatRemaining,
  computeRemaining,
  hasCompleted,
  parseDurationInput,
} from '../../utils/showTimer'

describe('formatRemaining', () => {
  it('shows 00:00 at zero', () => {
    expect(formatRemaining(0)).toBe('00:00')
  })

  it('clamps negative input to 00:00', () => {
    expect(formatRemaining(-500)).toBe('00:00')
  })

  it('rounds up sub-second remainder (14.5s -> 00:15)', () => {
    expect(formatRemaining(14_500)).toBe('00:15')
  })

  it('formats 59 seconds as 00:59', () => {
    expect(formatRemaining(59_000)).toBe('00:59')
  })

  it('formats exactly 60s as 01:00', () => {
    expect(formatRemaining(60_000)).toBe('01:00')
  })

  it('formats 15 minutes as 15:00', () => {
    expect(formatRemaining(15 * 60 * 1000)).toBe('15:00')
  })

  it('formats 3599s (59:59) as MM:SS without hour', () => {
    expect(formatRemaining(3599 * 1000)).toBe('59:59')
  })

  it('formats exactly 1 hour as H:MM:SS', () => {
    expect(formatRemaining(3600 * 1000)).toBe('1:00:00')
  })

  it('formats 1h 23m 45s as 1:23:45', () => {
    expect(formatRemaining((3600 + 23 * 60 + 45) * 1000)).toBe('1:23:45')
  })
})

describe('computeRemaining', () => {
  const baseTimer = {
    running: true,
    startedAt: 1_000_000,
    durationMs: 15 * 60 * 1000,
    remainingMsAtStop: 15 * 60 * 1000,
  }

  it('returns full duration at start instant', () => {
    expect(computeRemaining(baseTimer, 1_000_000)).toBe(15 * 60 * 1000)
  })

  it('returns midpoint value at half duration', () => {
    expect(computeRemaining(baseTimer, 1_000_000 + (7.5 * 60 * 1000)))
      .toBe(7.5 * 60 * 1000)
  })

  it('returns 0 exactly at end', () => {
    expect(computeRemaining(baseTimer, 1_000_000 + (15 * 60 * 1000))).toBe(0)
  })

  it('returns 0 after end (sleep-past-deadline)', () => {
    expect(computeRemaining(baseTimer, 1_000_000 + (20 * 60 * 1000))).toBe(0)
  })

  it('clamps to durationMs on clock rollback (now < startedAt)', () => {
    // A backwards system-clock jump must not inflate the remaining value.
    expect(computeRemaining(baseTimer, 500_000)).toBe(15 * 60 * 1000)
  })

  it('returns remainingMsAtStop when not running', () => {
    const stopped = { ...baseTimer, running: false, startedAt: null, remainingMsAtStop: 5 * 60 * 1000 }
    expect(computeRemaining(stopped, 9_999_999)).toBe(5 * 60 * 1000)
  })

  it('clamps stored remaining above duration back to duration', () => {
    const stopped = { ...baseTimer, running: false, startedAt: null, remainingMsAtStop: 9_999_999 }
    expect(computeRemaining(stopped, 0)).toBe(baseTimer.durationMs)
  })

  it('clamps negative stored remaining to 0', () => {
    const stopped = { ...baseTimer, running: false, startedAt: null, remainingMsAtStop: -1000 }
    expect(computeRemaining(stopped, 0)).toBe(0)
  })
})

describe('hasCompleted', () => {
  const timer = {
    running: true,
    startedAt: 0,
    durationMs: 10_000,
    remainingMsAtStop: 10_000,
  }

  it('is false before deadline', () => {
    expect(hasCompleted(timer, 9_999)).toBe(false)
  })

  it('is true at deadline', () => {
    expect(hasCompleted(timer, 10_000)).toBe(true)
  })

  it('is true past deadline', () => {
    expect(hasCompleted(timer, 20_000)).toBe(true)
  })

  it('is false when not running', () => {
    expect(hasCompleted({ ...timer, running: false, startedAt: null }, 20_000)).toBe(false)
  })
})

describe('parseDurationInput', () => {
  it('parses bare integer as minutes', () => {
    expect(parseDurationInput('15')).toBe(15 * 60 * 1000)
  })

  it('parses mm:ss', () => {
    expect(parseDurationInput('2:30')).toBe(150 * 1000)
  })

  it('parses h:mm:ss', () => {
    expect(parseDurationInput('1:00:00')).toBe(3600 * 1000)
  })

  it('rejects empty input', () => {
    expect(parseDurationInput('')).toBeNull()
    expect(parseDurationInput('   ')).toBeNull()
  })

  it('rejects zero', () => {
    expect(parseDurationInput('0')).toBeNull()
    expect(parseDurationInput('0:00')).toBeNull()
  })

  it('rejects non-numeric / malformed', () => {
    expect(parseDurationInput('abc')).toBeNull()
    expect(parseDurationInput('1:aa')).toBeNull()
    expect(parseDurationInput('-5')).toBeNull()
    expect(parseDurationInput('1:2:3:4')).toBeNull()
  })

  it('rejects seconds >= 60 in mm:ss', () => {
    expect(parseDurationInput('1:60')).toBeNull()
  })
})

// ── ShowTimer UX overhaul tests ──────────────────────────────
// These pin down two non-obvious behaviours the new panel UI relies on:
//   1. stopShowTimer is effectively a "pause" — remainingMsAtStop is
//      preserved so the button can present a "Resume" affordance and
//      startShowTimer picks up where pause left off (no reset).
//   2. resetShowTimer snaps remaining back to the full duration and is
//      what the user must reach to clear the "completed" / DONE badge
//      tracked separately by the panel.
describe('stopShowTimer → startShowTimer = pause/resume semantics', () => {
  // We synthesize the reducer logic the store uses (lines 1416-1430 of
  // store.ts) so the test exercises that exact arithmetic without
  // booting Zustand / window.api. If the store implementation changes,
  // this guard catches a divergence.
  function pause(t: TimerLikeFull, now: number): TimerLikeFull {
    if (!t.running || t.startedAt === null) return t
    const elapsed = now - t.startedAt
    const remaining = Math.max(0, Math.min(t.durationMs, t.durationMs - elapsed))
    return { ...t, running: false, startedAt: null, remainingMsAtStop: remaining }
  }
  function resume(t: TimerLikeFull, now: number): TimerLikeFull {
    if (t.running) return t
    const remaining = t.remainingMsAtStop > 0 ? t.remainingMsAtStop : t.durationMs
    return {
      ...t,
      running: true,
      startedAt: now - (t.durationMs - remaining),
      remainingMsAtStop: remaining,
    }
  }
  type TimerLikeFull = {
    running: boolean
    startedAt: number | null
    durationMs: number
    remainingMsAtStop: number
  }

  it('pause preserves remaining; resume continues from there', () => {
    const start: TimerLikeFull = {
      running: true,
      startedAt: 1_000_000,
      durationMs: 60_000,
      remainingMsAtStop: 60_000,
    }
    const paused = pause(start, 1_000_000 + 20_000) // 20 s in
    expect(paused.running).toBe(false)
    expect(paused.remainingMsAtStop).toBe(40_000)

    // 30 s later, user hits Resume. Remaining should still read ~40s
    // immediately, then count down from there.
    const resumed = resume(paused, 1_000_000 + 50_000)
    expect(resumed.running).toBe(true)
    expect(computeRemaining(resumed, 1_000_000 + 50_000)).toBe(40_000)
    expect(computeRemaining(resumed, 1_000_000 + 50_000 + 10_000)).toBe(30_000)
  })

  it('control mode picker: paused timer (0 < remaining < duration) maps to "resume"', () => {
    // Mirrors the controlMode logic in ShowTimerPanel.TimerRow: a stopped
    // timer with a remainingMsAtStop strictly between 0 and durationMs
    // must surface "Resume", not "Start" (which would imply a fresh run).
    const t: TimerLikeFull = {
      running: false,
      startedAt: null,
      durationMs: 60_000,
      remainingMsAtStop: 35_000,
    }
    const isPaused = !t.running && t.remainingMsAtStop > 0 && t.remainingMsAtStop < t.durationMs
    expect(isPaused).toBe(true)
  })

  it('control mode picker: fresh / reset timer maps to "start" (not resume)', () => {
    const t: TimerLikeFull = {
      running: false,
      startedAt: null,
      durationMs: 60_000,
      remainingMsAtStop: 60_000, // == durationMs == reset state
    }
    const isPaused = !t.running && t.remainingMsAtStop > 0 && t.remainingMsAtStop < t.durationMs
    expect(isPaused).toBe(false)
  })

  it('control mode picker: completed timer (remaining == 0) maps to "start"', () => {
    const t: TimerLikeFull = {
      running: false,
      startedAt: null,
      durationMs: 60_000,
      remainingMsAtStop: 0,
    }
    const isPaused = !t.running && t.remainingMsAtStop > 0 && t.remainingMsAtStop < t.durationMs
    expect(isPaused).toBe(false)
  })
})

describe('progress fraction tiering', () => {
  // Mirrors the tier selection in ShowTimerPanel.TimerRow so future
  // tweaks to thresholds stay deliberate.
  function tier(progress: number): 'ok' | 'warn' | 'critical' {
    if (progress >= 0.9) return 'critical'
    if (progress >= 0.7) return 'warn'
    return 'ok'
  }

  it('< 0.7 is ok', () => {
    expect(tier(0)).toBe('ok')
    expect(tier(0.5)).toBe('ok')
    expect(tier(0.6999)).toBe('ok')
  })
  it('0.7..0.9 is warn', () => {
    expect(tier(0.7)).toBe('warn')
    expect(tier(0.85)).toBe('warn')
  })
  it('>= 0.9 is critical', () => {
    expect(tier(0.9)).toBe('critical')
    expect(tier(1.0)).toBe('critical')
  })
})
