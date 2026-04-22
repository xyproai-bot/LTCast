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
