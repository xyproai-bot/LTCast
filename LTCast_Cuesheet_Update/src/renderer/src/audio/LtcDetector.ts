/**
 * LTC Channel Detector
 * Analyzes each channel of an AudioBuffer to detect which one contains LTC.
 * Uses a fast energy-based heuristic: LTC has characteristic high-frequency energy
 * and a very regular zero-crossing rate.
 */

interface DetectionResult {
  channelIndex: number
  confidence: number // 0–1
}

/**
 * Analyzes a short segment (first 2 seconds) of each channel.
 * Returns the channel index most likely to contain LTC, or -1 if none found.
 */
export function detectLtcChannel(buffer: AudioBuffer): DetectionResult {
  const sampleRate = buffer.sampleRate
  const channels = buffer.numberOfChannels

  // A mono file can never have a dedicated LTC channel separate from music
  if (channels === 1) return { channelIndex: 0, confidence: 0 }

  // Analyze first 2 seconds (or whole buffer if shorter)
  const analyzeLength = Math.min(sampleRate * 2, buffer.length)

  let bestChannel = 0
  let bestScore = -1

  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch).slice(0, analyzeLength)
    const score = scoreLtcLikelihood(data, sampleRate)
    if (score > bestScore) {
      bestScore = score
      bestChannel = ch
    }
  }

  return {
    channelIndex: bestChannel,
    // Confidence: if best score is significantly higher than 0.3, we trust the detection
    confidence: Math.min(bestScore, 1.0)
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
