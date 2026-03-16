/**
 * LTC (Linear Timecode) AudioWorklet Processor
 * Based on libltc (x42/Robin Gareus) algorithm — the industry standard.
 *
 * Key techniques from libltc:
 * - Adaptive signal threshold (tracks min/max envelope)
 * - Exponential smoothing for half-bit period (7/8 + 1/8)
 * - 16-bit shift register for instant sync word detection
 * - Circular bit buffer for frame extraction
 * - Sanity-bounded interval filtering (handles MP3 encoder delay)
 */
class LTCProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._reset()
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'reset') this._reset()
    }
  }

  _reset() {
    // Adaptive envelope tracking (libltc style)
    this.sigMax = 0.001
    this.sigMin = -0.001
    this.prevState = 0
    this.samplesSinceCrossing = 0

    // Biphase mark decoding
    this.avgHalfBit = sampleRate / (25 * 80 * 2) // initial guess: 25fps
    this.waitingSecondShort = false

    // 16-bit shift register for sync word detection
    this.shiftReg = 0

    // Circular bit buffer (256 entries, stores last N bits)
    this.bitRing = new Uint8Array(256)
    this.bitRingPos = 0    // write pointer
    this.bitsReceived = 0  // total bits since last sync

    this.framesDecoded = 0

    // Interval bounds (covers 24fps–30fps at any common sample rate)
    this.intervalMin = Math.floor(sampleRate / (30 * 80 * 2) * 0.5)
    this.intervalMax = Math.ceil(sampleRate / (24 * 80 * 2) * 2.8)
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (!channel) return true

    for (let i = 0; i < channel.length; i++) {
      const sample = channel[i]
      this.samplesSinceCrossing++

      // ── Adaptive envelope tracking ──
      if (sample > this.sigMax) this.sigMax = sample
      else this.sigMax *= 0.9998

      if (sample < this.sigMin) this.sigMin = sample
      else this.sigMin *= 0.9998

      // Threshold at midpoint of envelope
      const threshold = (this.sigMax + this.sigMin) * 0.5
      const state = sample > threshold ? 1 : -1

      // ── Zero crossing ──
      if (this.prevState !== 0 && state !== this.prevState) {
        const interval = this.samplesSinceCrossing
        this.samplesSinceCrossing = 0

        // Only process intervals within valid LTC range
        // This automatically ignores MP3 encoder delay silence
        if (interval >= this.intervalMin && interval <= this.intervalMax) {
          this._onInterval(interval)
        }
      }

      this.prevState = state
    }
    return true
  }

  _onInterval(interval) {
    const threshold = this.avgHalfBit * 1.5

    if (interval < threshold) {
      // SHORT interval — libltc smoothing: 7/8 + 1/8
      this.avgHalfBit = (this.avgHalfBit * 7 + interval) * 0.125

      if (this.waitingSecondShort) {
        this._decodeBit(1)
        this.waitingSecondShort = false
      } else {
        this.waitingSecondShort = true
      }
    } else {
      // LONG interval
      if (this.waitingSecondShort) {
        // Orphan short — don't clear everything, just reset biphase
        this.waitingSecondShort = false
      }
      this.avgHalfBit = (this.avgHalfBit * 7 + interval * 0.5) * 0.125
      this._decodeBit(0)
      this.waitingSecondShort = false
    }
  }

  _decodeBit(bit) {
    // Store in circular buffer
    this.bitRing[this.bitRingPos & 255] = bit
    this.bitRingPos++
    this.bitsReceived++

    // Update shift register (16-bit)
    this.shiftReg = ((this.shiftReg << 1) | bit) & 0xFFFF

    // Check for sync word: 0011111111111101 = 0x3FFD
    if (this.shiftReg === 0x3FFD && this.bitsReceived >= 80) {
      this._onSyncWord()
      this.bitsReceived = 0
    }

    // Safety reset if too many bits without sync
    if (this.bitsReceived > 240) {
      this.bitsReceived = 0
    }
  }

  _onSyncWord() {
    // Read the 80 bits that form this frame from the ring buffer
    // The sync word (bits 64-79) just ended at bitRingPos
    // So bit 0 of the frame is at (bitRingPos - 80)
    const start = this.bitRingPos - 80

    const b = (bitOffset, len) => {
      let v = 0
      for (let i = 0; i < len; i++) {
        v |= (this.bitRing[(start + bitOffset + i) & 255] << i)
      }
      return v
    }

    const frameUnits = b(0, 4)
    const frameTens  = b(8, 2)
    const dropFrame  = b(10, 1)
    const secsUnits  = b(16, 4)
    const secsTens   = b(24, 3)
    const minsUnits  = b(32, 4)
    const minsTens   = b(40, 3)
    const hoursUnits = b(48, 4)
    const hoursTens  = b(56, 2)

    const frames  = frameTens * 10 + frameUnits
    const seconds = secsTens  * 10 + secsUnits
    const minutes = minsTens  * 10 + minsUnits
    const hours   = hoursTens * 10 + hoursUnits

    // BCD validity
    if (frameUnits > 9 || frameTens > 2) return
    if (secsUnits  > 9 || secsTens  > 5) return
    if (minsUnits  > 9 || minsTens  > 5) return
    if (hoursUnits > 9 || hoursTens > 2) return
    if (seconds > 59 || minutes > 59 || hours > 23) return

    const fps = this._detectFps()
    if (frames >= fps) return

    this.port.postMessage({
      hours, minutes, seconds, frames,
      dropFrame: dropFrame === 1,
      fps,
      halfBitPeriod: this.avgHalfBit
    })
    this.framesDecoded++
  }

  _detectFps() {
    const raw = sampleRate / (this.avgHalfBit * 2 * 80)
    const standards = [24, 25, 29.97, 30]
    let best = raw, bestDist = Infinity
    for (const std of standards) {
      const d = Math.abs(raw - std)
      if (d < bestDist) { bestDist = d; best = std }
    }
    if (bestDist < 2) return best
    return Math.round(raw * 10) / 10
  }
}

registerProcessor('ltc-processor', LTCProcessor)
