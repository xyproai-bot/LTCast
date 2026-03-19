/**
 * Audio Aligner
 * Uses normalized cross-correlation on pre-extracted waveform peaks
 * to quickly find where a video's audio best matches in the main audio.
 */

interface AlignResult {
  /** Position in the main audio where the video starts (seconds) */
  offset: number
  /** Normalized cross-correlation score, 0–1. < 0.7 means unreliable match. */
  confidence: number
}

/**
 * Find the best alignment offset (in seconds) using waveform peak data.
 *
 * @param mainPeaks  - Waveform peak data from the main audio (e.g. 6000+ points)
 * @param videoPeaks - Waveform peak data from the video audio
 * @param mainDuration  - Duration of the main audio in seconds
 * @param videoDuration - Duration of the video audio in seconds
 * @returns AlignResult with offsetSeconds and confidence score
 */
export function alignAudio(
  mainPeaks: Float32Array,
  videoPeaks: Float32Array,
  mainDuration: number,
  videoDuration: number
): AlignResult {
  if (mainDuration <= 0 || videoDuration <= 0) return { offset: 0, confidence: 0 }

  // Scale video peaks to same points-per-second as main peaks
  const mainPPS = mainPeaks.length / mainDuration
  const videoPointsNeeded = Math.floor(videoDuration * mainPPS)

  // Resample video peaks to match main's resolution
  const videoRS = resample(videoPeaks, videoPointsNeeded)
  const maxLag = mainPeaks.length - videoRS.length
  if (maxLag <= 0) return { offset: 0, confidence: 0 }

  // Pre-compute video stats
  let videoMean = 0
  for (let i = 0; i < videoRS.length; i++) videoMean += videoRS[i]
  videoMean /= videoRS.length

  let videoEnergy = 0
  for (let i = 0; i < videoRS.length; i++) {
    const d = videoRS[i] - videoMean
    videoEnergy += d * d
  }
  const videoStd = Math.sqrt(videoEnergy)
  if (videoStd < 1e-10) return { offset: 0, confidence: 0 }

  // Slide and compute normalized cross-correlation
  let bestCorr = -Infinity
  let bestLag = 0

  // Use a step size for speed: check every N-th lag, then refine
  const coarseStep = Math.max(1, Math.floor(mainPeaks.length / 2000))

  // Coarse pass
  for (let lag = 0; lag <= maxLag; lag += coarseStep) {
    const corr = computeCorrelation(mainPeaks, videoRS, lag, videoMean, videoStd)
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag }
  }

  // Fine pass around best coarse result
  const fineStart = Math.max(0, bestLag - coarseStep)
  const fineEnd = Math.min(maxLag, bestLag + coarseStep)
  for (let lag = fineStart; lag <= fineEnd; lag++) {
    const corr = computeCorrelation(mainPeaks, videoRS, lag, videoMean, videoStd)
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag }
  }

  // Convert lag in peak-points back to seconds
  // Normalize bestCorr from [-1, 1] to [0, 1] for confidence
  const confidence = (bestCorr + 1) / 2
  return { offset: (bestLag / mainPeaks.length) * mainDuration, confidence }
}

function computeCorrelation(
  main: Float32Array,
  video: Float32Array,
  lag: number,
  videoMean: number,
  videoStd: number
): number {
  let mainMean = 0
  for (let i = 0; i < video.length; i++) mainMean += main[lag + i]
  mainMean /= video.length

  let mainEnergy = 0
  let cross = 0
  for (let i = 0; i < video.length; i++) {
    const dm = main[lag + i] - mainMean
    const dv = video[i] - videoMean
    cross += dm * dv
    mainEnergy += dm * dm
  }

  const mainStd = Math.sqrt(mainEnergy)
  if (mainStd < 1e-10) return -1
  return cross / (mainStd * videoStd)
}

function resample(data: Float32Array, targetLen: number): Float32Array {
  if (data.length === targetLen) return data
  const result = new Float32Array(targetLen)
  const ratio = data.length / targetLen
  for (let i = 0; i < targetLen; i++) {
    const srcIdx = i * ratio
    const lo = Math.floor(srcIdx)
    const hi = Math.min(lo + 1, data.length - 1)
    const frac = srcIdx - lo
    result[i] = data[lo] * (1 - frac) + data[hi] * frac
  }
  return result
}
