/**
 * LTC Channel Detector
 * Analyzes each channel of an AudioBuffer to detect which one contains LTC.
 * Uses a fast energy-based heuristic: LTC has characteristic high-frequency energy
 * and a very regular zero-crossing rate.
 */

export interface DetectionResult {
  channelIndex: number
  confidence: number // 0–1
  /** Time in seconds where LTC signal first appears (pre-roll detection) */
  ltcStartTime: number
}

/**
 * Analyzes multiple segments across the entire file to detect LTC.
 * Scans: first 2s, then every 30s throughout the file.
 * If LTC appears anywhere (e.g. music for 3 min then LTC starts),
 * it will still be detected.
 */
export function detectLtcChannel(buffer: AudioBuffer): DetectionResult {
  const sampleRate = buffer.sampleRate
  const channels = buffer.numberOfChannels

  // A mono file can never have a dedicated LTC channel separate from music
  if (channels === 1) return { channelIndex: 0, confidence: 0, ltcStartTime: 0 }

  // Build list of sample offsets to analyze (2-second windows)
  const windowLen = Math.min(sampleRate * 2, buffer.length)
  const offsets: number[] = [0] // always check the start
  // Then check every 30 seconds throughout the file
  const step = sampleRate * 30
  for (let pos = step; pos + windowLen <= buffer.length; pos += step) {
    offsets.push(pos)
  }
  // Also check near the end if not already covered
  const endOffset = Math.max(0, buffer.length - windowLen)
  if (endOffset > 0 && !offsets.some(o => Math.abs(o - endOffset) < sampleRate * 5)) {
    offsets.push(endOffset)
  }

  let bestChannel = 0
  let bestScore = -1
  /** Earliest sample offset where LTC is detected on the best channel */
  let ltcFirstOffset = 0

  for (let ch = 0; ch < channels; ch++) {
    const fullData = buffer.getChannelData(ch)
    let channelBestScore = 0
    let channelFirstOffset = 0

    // Check each window — take the highest score found anywhere in the file
    for (const offset of offsets) {
      const end = Math.min(offset + windowLen, buffer.length)
      const segment = fullData.subarray(offset, end)
      const score = scoreLtcLikelihood(segment, sampleRate)
      if (score > channelBestScore) channelBestScore = score
    }

    // Find earliest window where LTC appears (score > 0.3 threshold)
    if (channelBestScore > bestScore) {
      bestScore = channelBestScore
      bestChannel = ch
      // Scan offsets in order to find first LTC appearance
      channelFirstOffset = 0
      for (const offset of offsets) {
        const end = Math.min(offset + windowLen, buffer.length)
        const segment = fullData.subarray(offset, end)
        const score = scoreLtcLikelihood(segment, sampleRate)
        if (score > 0.3) {
          channelFirstOffset = offset
          break
        }
      }
      ltcFirstOffset = channelFirstOffset
    }
  }

  return {
    channelIndex: bestChannel,
    confidence: Math.min(bestScore, 1.0),
    ltcStartTime: ltcFirstOffset / sampleRate
  }
}

/**
 * Score how likely a channel contains LTC signal.
 * LTC characteristics:
 *  1. High zero-crossing rate (2× bit rate)
 *  2. Zero-crossings are very regular (biphase clock)
 *  3. RMS energy in mid-high frequency range (1–3 kHz typical for 25fps @ 48kHz)
 *  4. Not a pure sine or flat signal
 */
function scoreLtcLikelihood(data: Float32Array, sampleRate: number): number {
  const len = data.length
  if (len < 100) return 0

  // 1. Zero crossing rate
  let crossings = 0
  for (let i = 1; i < len; i++) {
    if ((data[i] >= 0) !== (data[i - 1] >= 0)) crossings++
  }
  const zcr = crossings / len // zero crossings per sample

  // For 24fps LTC @ 48kHz: ~80bits×24fps×2 = 3840 crossings/sec → zcr ≈ 0.08
  // For 30fps LTC @ 48kHz: ~80bits×30fps×2 = 4800 crossings/sec → zcr ≈ 0.10
  // Music typically has much lower zcr (< 0.02) or higher but irregular
  const zcrScore = gaussianScore(zcr, 0.09, 0.04) // peak around 0.09

  // 2. Regularity of zero crossings (low variance in intervals)
  const intervals: number[] = []
  let lastCross = 0
  for (let i = 1; i < Math.min(len, sampleRate); i++) {
    if ((data[i] >= 0) !== (data[i - 1] >= 0)) {
      if (lastCross > 0) intervals.push(i - lastCross)
      lastCross = i
    }
  }

  let regularityScore = 0
  if (intervals.length > 20) {
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length
    const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length
    const cv = Math.sqrt(variance) / mean // coefficient of variation
    // LTC has regular intervals: cv should be < 0.7 (mix of short and long but patterned)
    // Pure noise has cv ≈ 1+
    regularityScore = cv < 1.0 ? (1.0 - cv) : 0
  }

  // 3. RMS energy — LTC should not be silent
  let rms = 0
  for (let i = 0; i < len; i++) rms += data[i] ** 2
  rms = Math.sqrt(rms / len)
  const energyScore = rms > 0.01 ? Math.min(rms * 5, 1.0) : 0

  // Combined score
  return (zcrScore * 0.4 + regularityScore * 0.4 + energyScore * 0.2)
}

function gaussianScore(x: number, mean: number, sigma: number): number {
  return Math.exp(-0.5 * ((x - mean) / sigma) ** 2)
}
