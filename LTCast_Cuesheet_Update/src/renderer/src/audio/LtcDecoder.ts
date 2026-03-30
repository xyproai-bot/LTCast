/**
 * Offline LTC Decoder — based on libltc algorithm
 * Adaptive envelope threshold + exponential smoothing + shift register sync
 */

import { TimecodeFrame } from '../store'

export interface TimecodeLookupEntry {
  time: number
  tc: TimecodeFrame
}

export function buildTimecodeLookup(
  channelData: Float32Array,
  sampleRate: number
): TimecodeLookupEntry[] {
  const entries: TimecodeLookupEntry[] = []

  // Adaptive envelope
  let sigMax = 0.001, sigMin = -0.001
  let prevState = 0
  let samplesSinceCrossing = 0

  // Biphase mark
  let avgHalfBit = sampleRate / (25 * 80 * 2)
  let waitingSecondShort = false

  // Shift register + circular bit buffer
  let shiftReg = 0
  const bitRing = new Uint8Array(256)
  let bitRingPos = 0
  let bitsReceived = 0

  // Interval bounds
  const intervalMin = Math.floor(sampleRate / (30 * 80 * 2) * 0.5)
  const intervalMax = Math.ceil(sampleRate / (24 * 80 * 2) * 2.8)

  let lastEntryTime = -1

  for (let i = 0; i < channelData.length; i++) {
    const sample = channelData[i]
    samplesSinceCrossing++

    // Adaptive envelope
    if (sample > sigMax) sigMax = sample; else sigMax *= 0.9998
    if (sample < sigMin) sigMin = sample; else sigMin *= 0.9998

    const threshold = (sigMax + sigMin) * 0.5
    const state = sample > threshold ? 1 : -1

    if (prevState !== 0 && state !== prevState) {
      const interval = samplesSinceCrossing
      samplesSinceCrossing = 0

      if (interval >= intervalMin && interval <= intervalMax) {
        const th = avgHalfBit * 1.5

        if (interval < th) {
          avgHalfBit = (avgHalfBit * 7 + interval) * 0.125
          if (waitingSecondShort) {
            // bit 1
            bitRing[bitRingPos & 255] = 1
            bitRingPos++
            bitsReceived++
            shiftReg = ((shiftReg << 1) | 1) & 0xFFFF
            waitingSecondShort = false
          } else {
            waitingSecondShort = true
          }
        } else {
          if (waitingSecondShort) waitingSecondShort = false
          avgHalfBit = (avgHalfBit * 7 + interval * 0.5) * 0.125
          // bit 0
          bitRing[bitRingPos & 255] = 0
          bitRingPos++
          bitsReceived++
          shiftReg = ((shiftReg << 1) | 0) & 0xFFFF
          waitingSecondShort = false
        }

        // Check sync word
        if (shiftReg === 0x3FFD && bitsReceived >= 80) {
          const tc = extractFrame(bitRing, bitRingPos, sampleRate, avgHalfBit)
          if (tc !== null) {
            const timeSec = i / sampleRate
            if (timeSec - lastEntryTime > 0.02) {
              entries.push({ time: timeSec, tc })
              lastEntryTime = timeSec
            }
          }
          bitsReceived = 0
        }

        if (bitsReceived > 240) bitsReceived = 0
      }
    }

    prevState = state
  }

  return entries
}

function extractFrame(
  bitRing: Uint8Array,
  bitRingPos: number,
  sampleRate: number,
  avgHalfBit: number
): TimecodeFrame | null {
  const start = bitRingPos - 80

  const b = (bitOffset: number, len: number): number => {
    let v = 0
    for (let i = 0; i < len; i++) {
      v |= (bitRing[(start + bitOffset + i) & 255] << i)
    }
    return v
  }

  const frameUnits = b(0, 4)
  const frameTens = b(8, 2)
  const dropFrame = b(10, 1)
  const secsUnits = b(16, 4)
  const secsTens = b(24, 3)
  const minsUnits = b(32, 4)
  const minsTens = b(40, 3)
  const hoursUnits = b(48, 4)
  const hoursTens = b(56, 2)

  const frames = frameTens * 10 + frameUnits
  const seconds = secsTens * 10 + secsUnits
  const minutes = minsTens * 10 + minsUnits
  const hours = hoursTens * 10 + hoursUnits

  if (frameUnits > 9 || frameTens > 2) return null
  if (secsUnits > 9 || secsTens > 5) return null
  if (minsUnits > 9 || minsTens > 5) return null
  if (hoursUnits > 9 || hoursTens > 2) return null
  if (seconds > 59 || minutes > 59 || hours > 23) return null

  const fps = detectFps(sampleRate, avgHalfBit)
  if (frames >= fps) return null

  return { hours, minutes, seconds, frames, fps, dropFrame: dropFrame === 1 }
}

function detectFps(sampleRate: number, avgHalfBit: number): number {
  const raw = sampleRate / (avgHalfBit * 2 * 80)
  const standards = [24, 25, 29.97, 30]
  let best = raw, bestDist = Infinity
  for (const std of standards) {
    const d = Math.abs(raw - std)
    if (d < bestDist) { bestDist = d; best = std }
  }
  if (bestDist < 2) return best
  return Math.round(raw * 10) / 10
}

export function getTimecodeAtTime(
  lookup: TimecodeLookupEntry[],
  time: number
): TimecodeFrame | null {
  if (lookup.length === 0) return null
  let lo = 0, hi = lookup.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (lookup[mid].time <= time) lo = mid
    else hi = mid - 1
  }
  return lookup[lo].tc
}

export function formatTimecode(tc: TimecodeFrame): string {
  const pad = (n: number): string => String(Math.floor(n)).padStart(2, '0')
  const sep = tc.dropFrame ? ';' : ':'
  return `${pad(tc.hours)}:${pad(tc.minutes)}:${pad(tc.seconds)}${sep}${pad(tc.frames)}`
}
