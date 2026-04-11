/**
 * ltcWavGenerator.ts
 *
 * Pure TypeScript LTC WAV generator.
 * Encodes a SMPTE LTC signal into a 16-bit mono PCM WAV file.
 *
 * Derived from the LTC encoding logic in ltcEncoderProcessor.js,
 * rewritten for main-thread use (no AudioWorklet required).
 */

import { tcToFrames } from './timecodeConvert'

export interface LtcWavOptions {
  startTC: string       // "HH:MM:SS:FF" or "HH:MM:SS;FF"
  durationSeconds: number
  fps: number           // 24 | 25 | 29.97 | 30
  sampleRate: number    // 44100 | 48000
  amplitude: number     // 0.0 – 1.0
  onProgress?: (progress: number) => void  // 0..1
}

/**
 * Encode a frame number into the 80-bit LTC frame structure.
 * Ported directly from ltcEncoderProcessor.js _encodeFrame().
 */
function encodeFrame(totalFrames: number, fpsInt: number, dropFrame: boolean, bits: Uint8Array): void {
  totalFrames = Math.max(0, totalFrames)
  let h: number, m: number, s: number, f: number

  if (dropFrame && fpsInt === 30) {
    const D = 2
    const framesPerMin = fpsInt * 60 - D           // 1798
    const framesPer10Min = framesPerMin * 10 + D   // 17982
    const framesPerHour = framesPer10Min * 6       // 107892

    h = Math.floor(totalFrames / framesPerHour) % 24
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
    m = tenMinBlocks * 10 + mInBlock
    const dropAdjusted = mInBlock > 0 ? remaining + D : remaining
    s = Math.floor(dropAdjusted / fpsInt)
    f = dropAdjusted - s * fpsInt
  } else {
    h = Math.floor(totalFrames / (fpsInt * 3600)) % 24
    let rem = totalFrames - Math.floor(totalFrames / (fpsInt * 3600)) * fpsInt * 3600
    m = Math.floor(rem / (fpsInt * 60))
    rem -= m * fpsInt * 60
    s = Math.floor(rem / fpsInt)
    f = rem - s * fpsInt
  }

  bits.fill(0)

  // Bits 0-3: Frame units (BCD)
  bits[0] = (f % 10) & 1
  bits[1] = ((f % 10) >> 1) & 1
  bits[2] = ((f % 10) >> 2) & 1
  bits[3] = ((f % 10) >> 3) & 1

  // Bits 8-9: Frame tens (BCD)
  bits[8] = Math.floor(f / 10) & 1
  bits[9] = (Math.floor(f / 10) >> 1) & 1

  // Bit 10: Drop frame flag
  bits[10] = dropFrame ? 1 : 0

  // Bits 16-19: Seconds units (BCD)
  bits[16] = (s % 10) & 1
  bits[17] = ((s % 10) >> 1) & 1
  bits[18] = ((s % 10) >> 2) & 1
  bits[19] = ((s % 10) >> 3) & 1

  // Bits 24-26: Seconds tens (BCD)
  bits[24] = Math.floor(s / 10) & 1
  bits[25] = (Math.floor(s / 10) >> 1) & 1
  bits[26] = (Math.floor(s / 10) >> 2) & 1

  // Bits 32-35: Minutes units (BCD)
  bits[32] = (m % 10) & 1
  bits[33] = ((m % 10) >> 1) & 1
  bits[34] = ((m % 10) >> 2) & 1
  bits[35] = ((m % 10) >> 3) & 1

  // Bits 40-42: Minutes tens (BCD)
  bits[40] = Math.floor(m / 10) & 1
  bits[41] = (Math.floor(m / 10) >> 1) & 1
  bits[42] = (Math.floor(m / 10) >> 2) & 1

  // Bits 48-51: Hours units (BCD)
  bits[48] = (h % 10) & 1
  bits[49] = ((h % 10) >> 1) & 1
  bits[50] = ((h % 10) >> 2) & 1
  bits[51] = ((h % 10) >> 3) & 1

  // Bits 56-57: Hours tens (BCD)
  bits[56] = Math.floor(h / 10) & 1
  bits[57] = (Math.floor(h / 10) >> 1) & 1

  // Bits 64-79: Sync word 0011111111111101 (LSB first)
  bits[64] = 0; bits[65] = 0
  bits[66] = 1; bits[67] = 1
  bits[68] = 1; bits[69] = 1
  bits[70] = 1; bits[71] = 1
  bits[72] = 1; bits[73] = 1
  bits[74] = 1; bits[75] = 1
  bits[76] = 1; bits[77] = 1
  bits[78] = 0; bits[79] = 1
}

/**
 * Build a WAV header (44 bytes) for 16-bit mono PCM.
 */
function buildWavHeader(sampleRate: number, numSamples: number): ArrayBuffer {
  const byteRate = sampleRate * 2      // 16-bit mono: 2 bytes/sample
  const dataBytes = numSamples * 2
  const buf = new ArrayBuffer(44)
  const view = new DataView(buf)
  const write4 = (off: number, s: string): void => {
    for (let i = 0; i < 4; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  write4(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  write4(8, 'WAVE')
  write4(12, 'fmt ')
  view.setUint32(16, 16, true)           // PCM chunk size
  view.setUint16(20, 1, true)            // PCM format
  view.setUint16(22, 1, true)            // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, 2, true)            // block align (mono 16-bit)
  view.setUint16(34, 16, true)           // bits per sample
  write4(36, 'data')
  view.setUint32(40, dataBytes, true)
  return buf
}

/**
 * Generate a LTC WAV file and return it as an ArrayBuffer.
 *
 * This runs synchronously in chunks (yielding via setTimeout) to avoid
 * blocking the UI. Use onProgress to show a progress bar.
 *
 * Returns a Promise that resolves to the complete WAV ArrayBuffer.
 */
export function generateLtcWav(opts: LtcWavOptions): Promise<ArrayBuffer> {
  const { startTC, durationSeconds, fps, sampleRate, amplitude, onProgress } = opts

  const dropFrame = fps === 29.97
  const fpsInt = Math.round(fps)

  // Total frames and samples
  const startFrame = tcToFrames(startTC, fps)
  const totalFrames = Math.ceil(durationSeconds * fps)
  const samplesPerFrame = sampleRate / fps
  const totalSamples = Math.round(totalFrames * samplesPerFrame)

  // Allocate PCM buffer (Int16)
  const pcmData = new Int16Array(totalSamples)

  // Biphase mark encoding state
  let phase = 1
  let lastHalfBitIdx = -1
  let lastEncodedFrame = -1
  const frameBits = new Uint8Array(80)
  let sampleCounter = 0

  // Process in chunks to avoid blocking UI
  const CHUNK_FRAMES = 500  // process 500 frames at a time (~20 sec at 25fps)
  let framesDone = 0

  return new Promise((resolve) => {
    const processChunk = (): void => {
      const chunkEnd = Math.min(framesDone + CHUNK_FRAMES, totalFrames)
      // Samples to fill in this chunk
      const sampleStart = Math.round(framesDone * samplesPerFrame)
      const sampleEnd = Math.round(chunkEnd * samplesPerFrame)

      for (let si = sampleStart; si < sampleEnd && sampleCounter < totalSamples; si++) {
        const frameIdx = Math.floor(sampleCounter / samplesPerFrame)
        const sampleInFrame = sampleCounter - frameIdx * samplesPerFrame
        const samplesPerHalfBit = samplesPerFrame / 160  // 80 bits × 2 halves
        const halfBitIdx = Math.floor(sampleInFrame / samplesPerHalfBit)

        if (frameIdx !== lastEncodedFrame) {
          lastEncodedFrame = frameIdx
          encodeFrame(startFrame + frameIdx, fpsInt, dropFrame, frameBits)
        }

        if (halfBitIdx !== lastHalfBitIdx) {
          lastHalfBitIdx = halfBitIdx
          const bitIdx = halfBitIdx >> 1
          const isSecondHalf = (halfBitIdx & 1) === 1

          if (!isSecondHalf) {
            // Start of bit cell: always transition
            phase = -phase
          } else {
            // Midpoint: transition only for bit=1
            const bit = bitIdx < 80 ? frameBits[bitIdx] : 0
            if (bit === 1) {
              phase = -phase
            }
          }
        }

        // Write Int16 sample (clamp to [-32768, 32767])
        pcmData[sampleCounter] = Math.round(phase * amplitude * 32767)
        sampleCounter++
      }

      framesDone = chunkEnd

      if (onProgress) {
        onProgress(framesDone / totalFrames)
      }

      if (framesDone >= totalFrames) {
        // Build WAV file: header + pcmData
        const header = buildWavHeader(sampleRate, totalSamples)
        const wav = new Uint8Array(44 + totalSamples * 2)
        wav.set(new Uint8Array(header), 0)
        wav.set(new Uint8Array(pcmData.buffer), 44)
        resolve(wav.buffer)
      } else {
        // Yield to event loop before next chunk
        setTimeout(processChunk, 0)
      }
    }

    // Kick off first chunk
    setTimeout(processChunk, 0)
  })
}
