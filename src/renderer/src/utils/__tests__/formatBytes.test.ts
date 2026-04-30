import { describe, it, expect } from 'vitest'
import { formatBytes, formatSpeed, formatEta } from '../formatBytes'

describe('formatBytes', () => {
  it('renders zero as "0 B"', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('renders sub-kilobyte values with B unit', () => {
    expect(formatBytes(1)).toBe('1 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(999)).toBe('999 B')
  })

  it('renders kilobyte values with kB unit and one decimal', () => {
    expect(formatBytes(1000)).toBe('1.0 kB')
    expect(formatBytes(1500)).toBe('1.5 kB')
    expect(formatBytes(999_000)).toBe('999.0 kB')
  })

  it('renders megabyte values with MB unit and one decimal', () => {
    expect(formatBytes(1_000_000)).toBe('1.0 MB')
    expect(formatBytes(45_200_000)).toBe('45.2 MB')
    expect(formatBytes(187_600_000)).toBe('187.6 MB')
  })

  it('renders gigabyte values with GB unit and two decimals', () => {
    expect(formatBytes(1_000_000_000)).toBe('1.00 GB')
    expect(formatBytes(2_500_000_000)).toBe('2.50 GB')
  })

  it('falls back to "0 B" for negative or NaN input', () => {
    expect(formatBytes(-1)).toBe('0 B')
    expect(formatBytes(NaN)).toBe('0 B')
    expect(formatBytes(Infinity)).toBe('0 B')
  })
})

describe('formatSpeed', () => {
  it('returns placeholder em-dash for zero (no sample yet)', () => {
    expect(formatSpeed(0)).toBe('—')
  })

  it('uses kB/s when below 1 MB/s', () => {
    expect(formatSpeed(800)).toBe('0.8 kB/s')
    expect(formatSpeed(456_000)).toBe('456.0 kB/s')
    expect(formatSpeed(999_000)).toBe('999.0 kB/s')
  })

  it('uses MB/s at and above 1 MB/s', () => {
    expect(formatSpeed(1_000_000)).toBe('1.0 MB/s')
    expect(formatSpeed(12_300_000)).toBe('12.3 MB/s')
    expect(formatSpeed(125_000_000)).toBe('125.0 MB/s')
  })

  it('returns placeholder em-dash for negative or NaN input', () => {
    expect(formatSpeed(-1)).toBe('—')
    expect(formatSpeed(NaN)).toBe('—')
    expect(formatSpeed(Infinity)).toBe('—')
  })
})

describe('formatEta', () => {
  it('returns placeholder em-dash for zero', () => {
    expect(formatEta(0)).toBe('—')
  })

  it('returns "<1s" for sub-second remaining time', () => {
    expect(formatEta(0.4)).toBe('<1s')
    expect(formatEta(0.99)).toBe('<1s')
  })

  it('renders MM:SS for under an hour', () => {
    expect(formatEta(11)).toBe('~00:11')
    expect(formatEta(45)).toBe('~00:45')
    expect(formatEta(125)).toBe('~02:05')
    expect(formatEta(3599)).toBe('~59:59')
  })

  it('renders Hh MMm for one hour or more', () => {
    expect(formatEta(3600)).toBe('~1h 00m')
    expect(formatEta(3660)).toBe('~1h 01m')
    expect(formatEta(7325)).toBe('~2h 02m')
  })

  it('returns placeholder em-dash for negative or NaN input', () => {
    expect(formatEta(-5)).toBe('—')
    expect(formatEta(NaN)).toBe('—')
    expect(formatEta(Infinity)).toBe('—')
  })
})
