/**
 * LTC Encoder AudioWorklet Processor
 * Generates SMPTE LTC audio signal from timecode parameters.
 * Uses biphase mark encoding (same as standard LTC).
 *
 * Receives config via port messages:
 *   { type: 'config', fps, startFrameNumber, dropFrame, amplitude }
 *   { type: 'stop' }
 */
class LTCEncoderProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.fps = 25
    this.fpsInt = 25
    this.startFrameNumber = 0
    this.dropFrame = false
    this.amplitude = 0.5
    this.running = false

    // Internal encoding state
    this.sampleCounter = 0
    this.phase = 1               // current signal polarity (+1 or -1)
    this.lastHalfBitIdx = -1     // track half-bit transitions
    this.lastEncodedFrame = -1
    this.frameBits = new Uint8Array(80)

    this.port.onmessage = (e) => {
      if (e.data.type === 'config') {
        this.fps = e.data.fps || 25
        this.fpsInt = Math.round(this.fps)
        this.startFrameNumber = e.data.startFrameNumber || 0
        this.dropFrame = e.data.dropFrame || false
        this.amplitude = e.data.amplitude ?? 0.5
        this.sampleCounter = 0
        this.phase = 1
        this.lastHalfBitIdx = -1
        this.lastEncodedFrame = -1
        this.running = true
      } else if (e.data.type === 'stop') {
        this.running = false
      }
    }
  }

  process(inputs, outputs) {
    const output = outputs[0] && outputs[0][0]
    if (!output) return true

    if (!this.running) {
      output.fill(0)
      return true
    }

    const samplesPerFrame = sampleRate / this.fps
    const samplesPerBit = samplesPerFrame / 80
    const samplesPerHalfBit = samplesPerBit / 2

    for (let i = 0; i < output.length; i++) {
      // Which frame are we generating?
      const frameIdx = Math.floor(this.sampleCounter / samplesPerFrame)
      const sampleInFrame = this.sampleCounter - frameIdx * samplesPerFrame

      // Which half-bit within the frame? (0..159)
      const halfBitIdx = Math.floor(sampleInFrame / samplesPerHalfBit)

      // Encode new frame when needed
      if (frameIdx !== this.lastEncodedFrame) {
        this.lastEncodedFrame = frameIdx
        this._encodeFrame(this.startFrameNumber + frameIdx)
      }

      // Detect half-bit boundary → transition
      if (halfBitIdx !== this.lastHalfBitIdx) {
        this.lastHalfBitIdx = halfBitIdx
        const bitIdx = halfBitIdx >> 1  // Math.floor(halfBitIdx / 2)
        const isSecondHalf = (halfBitIdx & 1) === 1

        if (!isSecondHalf) {
          // Start of bit cell — ALWAYS transition
          this.phase = -this.phase
        } else {
          // Midpoint — transition only for bit "1"
          const bit = bitIdx < 80 ? this.frameBits[bitIdx] : 0
          if (bit === 1) {
            this.phase = -this.phase
          }
        }
      }

      output[i] = this.phase * this.amplitude
      this.sampleCounter++
    }

    return true
  }

  /**
   * Encode a frame number into the 80-bit LTC frame structure.
   * Converts totalFrames → HH:MM:SS:FF → BCD → 80 bits + sync word.
   */
  _encodeFrame(totalFrames) {
    totalFrames = Math.max(0, totalFrames)
    const fps = this.fpsInt
    let h, m, s, f

    if (this.dropFrame && fps === 30) {
      // Drop-frame timecode: skip frames 0,1 at start of each minute except every 10th
      // 17982 frames per 10-minute block (10*60*30 - 9*2 = 17982)
      const D = 2 // frames dropped per minute
      const framesPerMin = fps * 60 - D           // 1798
      const framesPer10Min = framesPerMin * 10 + D // 17982
      const framesPerHour = framesPer10Min * 6     // 107892

      h = Math.floor(totalFrames / framesPerHour) % 24
      let remaining = totalFrames - h * framesPerHour
      const tenMinBlocks = Math.floor(remaining / framesPer10Min)
      remaining -= tenMinBlocks * framesPer10Min

      let mInBlock
      if (remaining < fps * 60) {
        // First minute of the 10-min block (no drop)
        mInBlock = 0
      } else {
        remaining -= fps * 60
        mInBlock = 1 + Math.floor(remaining / framesPerMin)
        remaining -= (mInBlock - 1) * framesPerMin
      }
      m = tenMinBlocks * 10 + mInBlock
      s = Math.floor(remaining / fps)
      f = remaining - s * fps
    } else {
      // Non-drop-frame: simple division
      h = Math.floor(totalFrames / (fps * 3600)) % 24
      let rem = totalFrames - Math.floor(totalFrames / (fps * 3600)) * fps * 3600
      m = Math.floor(rem / (fps * 60))
      rem -= m * fps * 60
      s = Math.floor(rem / fps)
      f = rem - s * fps
    }

    const bits = this.frameBits
    bits.fill(0)

    // Bits 0-3: Frame units (BCD)
    bits[0] = (f % 10) & 1
    bits[1] = ((f % 10) >> 1) & 1
    bits[2] = ((f % 10) >> 2) & 1
    bits[3] = ((f % 10) >> 3) & 1

    // Bits 4-7: User bits field 1 (0)

    // Bits 8-9: Frame tens (BCD)
    bits[8] = Math.floor(f / 10) & 1
    bits[9] = (Math.floor(f / 10) >> 1) & 1

    // Bit 10: Drop frame flag
    bits[10] = this.dropFrame ? 1 : 0

    // Bit 11: Color frame (0)
    // Bits 12-15: User bits field 2 (0)

    // Bits 16-19: Seconds units (BCD)
    bits[16] = (s % 10) & 1
    bits[17] = ((s % 10) >> 1) & 1
    bits[18] = ((s % 10) >> 2) & 1
    bits[19] = ((s % 10) >> 3) & 1

    // Bits 20-23: User bits field 3 (0)

    // Bits 24-26: Seconds tens (BCD)
    bits[24] = Math.floor(s / 10) & 1
    bits[25] = (Math.floor(s / 10) >> 1) & 1
    bits[26] = (Math.floor(s / 10) >> 2) & 1

    // Bit 27: Biphase correction (0)
    // Bits 28-31: User bits field 4 (0)

    // Bits 32-35: Minutes units (BCD)
    bits[32] = (m % 10) & 1
    bits[33] = ((m % 10) >> 1) & 1
    bits[34] = ((m % 10) >> 2) & 1
    bits[35] = ((m % 10) >> 3) & 1

    // Bits 36-39: User bits field 5 (0)

    // Bits 40-42: Minutes tens (BCD)
    bits[40] = Math.floor(m / 10) & 1
    bits[41] = (Math.floor(m / 10) >> 1) & 1
    bits[42] = (Math.floor(m / 10) >> 2) & 1

    // Bit 43: Binary group flag (0)
    // Bits 44-47: User bits field 6 (0)

    // Bits 48-51: Hours units (BCD)
    bits[48] = (h % 10) & 1
    bits[49] = ((h % 10) >> 1) & 1
    bits[50] = ((h % 10) >> 2) & 1
    bits[51] = ((h % 10) >> 3) & 1

    // Bits 52-55: User bits field 7 (0)

    // Bits 56-57: Hours tens (BCD)
    bits[56] = Math.floor(h / 10) & 1
    bits[57] = (Math.floor(h / 10) >> 1) & 1

    // Bit 58: Reserved (0)
    // Bit 59: Biphase correction polarity (0)
    // Bits 60-63: User bits field 8 (0)

    // Bits 64-79: Sync word 0011111111111101
    // (LSB first: bits[64]=0, bits[65]=0, bits[66]=1, ..., bits[78]=0, bits[79]=1)
    bits[64] = 0; bits[65] = 0
    bits[66] = 1; bits[67] = 1
    bits[68] = 1; bits[69] = 1
    bits[70] = 1; bits[71] = 1
    bits[72] = 1; bits[73] = 1
    bits[74] = 1; bits[75] = 1
    bits[76] = 1; bits[77] = 1
    bits[78] = 0; bits[79] = 1
  }
}

registerProcessor('ltc-encoder', LTCEncoderProcessor)
