/**
 * Real-time BPM detection using onset detection + autocorrelation.
 *
 * Analyzes a sliding window (~10s) around the current playback position.
 * Call `detectBpmAt()` periodically (every 2-3 seconds) during playback.
 */

/** BPM search range */
const MIN_BPM = 60
const MAX_BPM = 200

/** Window size for real-time analysis (seconds) */
const WINDOW_SECONDS = 10

/**
 * Detect BPM at a specific position in the audio buffer.
 * Uses a sliding window centered on `currentTime`.
 */
export function detectBpmAt(
  buffer: AudioBuffer,
  musicChannelIndex: number,
  currentTime: number
): number | null {
  const sampleRate = buffer.sampleRate
  const data = buffer.getChannelData(musicChannelIndex)
  const totalSamples = data.length

  // Window: 10 seconds centered on currentTime
  const windowSamples = Math.min(sampleRate * WINDOW_SECONDS, totalSamples)
  const centerSample = Math.floor(currentTime * sampleRate)
  const halfWindow = Math.floor(windowSamples / 2)

  let startSample = centerSample - halfWindow
  if (startSample < 0) startSample = 0
  if (startSample + windowSamples > totalSamples) {
    startSample = Math.max(0, totalSamples - windowSamples)
  }

  const segment = data.subarray(startSample, startSample + windowSamples)

  // Check if segment has enough energy (skip silence)
  let rms = 0
  for (let i = 0; i < segment.length; i += 64) {
    rms += segment[i] ** 2
  }
  rms = Math.sqrt(rms / (segment.length / 64))
  if (rms < 0.001) return null  // silence

  const onsets = computeOnsetEnvelope(segment, sampleRate)
  // Need at least enough onset frames to cover one full period at MIN_BPM
  // (60 BPM = 1 beat/sec, onset at ~87fps → ~87 frames per beat, need ≥2 beats)
  const hopSize = Math.floor(Math.round(sampleRate * 0.023) / 2)
  const minOnsetFrames = Math.ceil((sampleRate / hopSize) * 60 / MIN_BPM) * 2
  if (onsets.length < minOnsetFrames) return null

  return autocorrelateBpm(onsets, sampleRate)
}

/**
 * Legacy: detect BPM from an entire buffer (one-shot analysis).
 */
export function detectBpm(buffer: AudioBuffer, musicChannelIndex: number): number | null {
  const sampleRate = buffer.sampleRate
  const data = buffer.getChannelData(musicChannelIndex)

  const analyzeSeconds = 30
  const analyzeSamples = Math.min(sampleRate * analyzeSeconds, data.length)
  const startSample = Math.min(
    Math.floor(data.length * 0.2),
    Math.max(0, data.length - analyzeSamples)
  )
  const segment = data.slice(startSample, startSample + analyzeSamples)

  const onsets = computeOnsetEnvelope(segment, sampleRate)
  const hopSize2 = Math.floor(Math.round(sampleRate * 0.023) / 2)
  const minOnsetFrames2 = Math.ceil((sampleRate / hopSize2) * 60 / MIN_BPM) * 2
  if (onsets.length < minOnsetFrames2) return null

  return autocorrelateBpm(onsets, sampleRate)
}

/**
 * Compute onset strength envelope from audio samples.
 */
function computeOnsetEnvelope(data: Float32Array, sampleRate: number): Float32Array {
  const windowSize = Math.round(sampleRate * 0.023)
  const hopSize = Math.floor(windowSize / 2)
  const numFrames = Math.floor((data.length - windowSize) / hopSize)
  if (numFrames < 2) return new Float32Array(0)

  const energy = new Float32Array(numFrames)
  for (let i = 0; i < numFrames; i++) {
    const offset = i * hopSize
    let sum = 0
    for (let j = 0; j < windowSize; j++) {
      sum += data[offset + j] ** 2
    }
    energy[i] = Math.sqrt(sum / windowSize)
  }

  const onsets = new Float32Array(numFrames)
  for (let i = 1; i < numFrames; i++) {
    const diff = energy[i] - energy[i - 1]
    onsets[i] = diff > 0 ? diff : 0
  }

  let maxOnset = 0
  for (let i = 0; i < onsets.length; i++) {
    if (onsets[i] > maxOnset) maxOnset = onsets[i]
  }
  if (maxOnset > 0) {
    for (let i = 0; i < onsets.length; i++) {
      onsets[i] /= maxOnset
    }
  }

  return onsets
}

/**
 * Autocorrelation-based BPM estimation from onset envelope.
 * Includes octave-error correction: if lag/2 (double BPM) has
 * similar correlation strength, prefer the faster tempo.
 */
function autocorrelateBpm(onsets: Float32Array, sampleRate: number): number | null {
  const hopSize = Math.floor(Math.round(sampleRate * 0.023) / 2)
  const onsetFps = sampleRate / hopSize

  const minLag = Math.floor(onsetFps * 60 / MAX_BPM)
  const maxLag = Math.ceil(onsetFps * 60 / MIN_BPM)

  if (maxLag >= onsets.length) return null

  // Compute correlation for all lags
  const corrs = new Float32Array(maxLag + 1)
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0
    const n = onsets.length - lag
    for (let i = 0; i < n; i++) {
      corr += onsets[i] * onsets[i + lag]
    }
    corrs[lag] = corr / n
  }

  // Find best lag
  let bestLag = minLag
  let bestCorr = -Infinity
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (corrs[lag] > bestCorr) {
      bestCorr = corrs[lag]
      bestLag = lag
    }
  }

  if (bestCorr < 0.001) return null

  // Octave correction: check if half-lag (double BPM) is also strong.
  // If correlation at lag/2 is >= 80% of best, prefer the faster tempo.
  const halfLag = Math.round(bestLag / 2)
  if (halfLag >= minLag && halfLag <= maxLag) {
    const halfCorr = corrs[halfLag]
    if (halfCorr >= bestCorr * 0.8) {
      bestLag = halfLag
    }
  }

  const bpm = (onsetFps * 60) / bestLag

  return Math.round(bpm * 10) / 10
}
