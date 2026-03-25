import { detectLtcChannel } from './LtcDetector'
import { buildTimecodeLookup, TimecodeLookupEntry } from './LtcDecoder'
import { TimecodeFrame } from '../store'
import { LTC_CONFIDENCE_THRESHOLD } from '../constants'

import ltcProcessorCode from './ltcProcessor.js?raw'
import ltcEncoderCode from './ltcEncoderProcessor.js?raw'

// ── Constants ───────────────────────────────────────────────
/** Milliseconds of silence before LTC signal is considered lost */
const LTC_SIGNAL_TIMEOUT_MS = 200
/** Number of waveform peak samples extracted per audio file */
const WAVEFORM_POINTS = 6000
/** Maximum gain multiplier for LTC output (1.0 = unity / 0 dB) */
const LTC_GAIN_MAX = 1.5
/** Small scheduling delay (seconds) for AudioBufferSourceNode.start() */
const SCHEDULING_DELAY = 0.05
/** Silent buffer length (samples) for VB-CABLE device warm-up */
const WARMUP_BUFFER_LENGTH = 128
/** Warm-up delay (ms) — wait for OS driver to activate device */
const WARMUP_DELAY_MS = 100

export interface AudioEngineCallbacks {
  onTimecode: (tc: TimecodeFrame) => void
  onTimeUpdate: (currentTime: number) => void
  onEnded: () => void
  onLtcChannelDetected: (channelIndex: number) => void
  onLtcSignalStatus: (ok: boolean) => void
  onLtcConfidence: (confidence: number) => void
  onWaveformData: (music: Float32Array, ltc: Float32Array) => void
  onTimecodeLookup: (lookup: TimecodeLookupEntry[]) => void
  onDeviceDisconnected?: (deviceId: string) => void
  onPlayStarted?: (perfNow: number, audioTime: number) => void
  onLtcError?: (message: string) => void
}

/**
 * AudioEngine — dual-context architecture
 *
 * Architecture:
 *   ctx     (Music)  → setSinkId(musicDevice) → PA speakers
 *   ltcCtx  (LTC)    → setSinkId(ltcDevice)   → VB-CABLE / BlackHole
 *
 * ltcCtx lifecycle:
 *   - Created once per selected LTC device
 *   - Persists across play/pause/seek cycles (avoids VB-CABLE handle loss)
 *   - Only destroyed on: device change, file load, or app shutdown
 *
 * Muting (LTC Output = "Muted"):
 *   - ltcCtx is NOT created at all
 *   - LTC decoding uses a silent OfflineAudioContext-like approach:
 *     we create the ltcCtx with setSinkId({ type: 'none' }) so the
 *     AudioWorklet still runs but no audio device is occupied
 */
export class AudioEngine {
  // ── Music playback context ───────────────────────────────
  private ctx: AudioContext | null = null
  private musicSource: AudioBufferSourceNode | null = null

  // ── LTC decode + output context ──────────────────────────
  private ltcCtx: AudioContext | null = null
  private ltcWorkletReady = false
  private ltcEncoderReady = false
  private ltcSource: AudioBufferSourceNode | null = null
  private ltcWorkletNode: AudioWorkletNode | null = null
  private ltcEncoderNode: AudioWorkletNode | null = null
  private ltcGainNode: GainNode | null = null
  private ltcStartupDeadline = 0  // ltcCtx.currentTime before which frames are ignored
  private ltcLastStopOffset = 0   // audio position (seconds) where playback last stopped

  // ── Shared state ─────────────────────────────────────────
  private buffer: AudioBuffer | null = null
  private startTime = 0
  private startOffset = 0
  private callbacks: AudioEngineCallbacks
  private ltcChannelIndex = 1
  private musicChannelIndex = 0
  private offsetFrames = 0
  private forceFpsValue: number | null = null
  private currentFps = 25
  private loop = false
  private loopA: number | null = null
  private loopB: number | null = null
  private rafId = 0
  private ltcSignalTimeout: ReturnType<typeof setTimeout> | null = null
  private musicOutputDeviceId = 'default'
  private ltcOutputDeviceId = 'default'   // 'default' = muted
  private ltcGainValue = 1.0
  private playing = false
  /** Monotonically increasing counter to guard against play/seek race conditions */
  private playId = 0

  // TC Generator mode
  private generatorMode = false
  private generatorStartFrames = 0   // parsed from HH:MM:SS:FF
  private generatorFps = 25
  private lastGeneratedFrame = -1

  private _deviceChangeHandler = (): void => { this._checkDeviceAvailability() }

  constructor(callbacks: AudioEngineCallbacks) {
    this.callbacks = callbacks
    // Monitor audio device changes (plug/unplug)
    navigator.mediaDevices.addEventListener('devicechange', this._deviceChangeHandler)
  }

  /** Check if currently-used audio devices are still available */
  private async _checkDeviceAvailability(): Promise<void> {
    if (!this.playing) return
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const outputIds = new Set(
        devices.filter(d => d.kind === 'audiooutput').map(d => d.deviceId)
      )
      // 'default' is always present
      if (this.musicOutputDeviceId !== 'default' && !outputIds.has(this.musicOutputDeviceId)) {
        this.pause()
        this.callbacks.onDeviceDisconnected?.(this.musicOutputDeviceId)
      } else if (this.ltcOutputDeviceId !== 'default' && !outputIds.has(this.ltcOutputDeviceId)) {
        this.pause()
        this.callbacks.onDeviceDisconnected?.(this.ltcOutputDeviceId)
      }
    } catch { /* ignore enumerate errors */ }
  }

  // ════════════════════════════════════════════════════════════
  // File loading
  // ════════════════════════════════════════════════════════════

  async loadFile(arrayBuffer: ArrayBuffer): Promise<void> {
    await this.dispose()
    this.startOffset = 0
    this.callbacks.onTimeUpdate(0)

    const decodeCtx = new AudioContext()
    try {
      this.buffer = await decodeCtx.decodeAudioData(arrayBuffer)
    } finally {
      await decodeCtx.close()
    }

    // Auto-detect LTC channel
    const detection = detectLtcChannel(this.buffer)
    this.callbacks.onLtcConfidence(detection.confidence)

    if (detection.confidence >= LTC_CONFIDENCE_THRESHOLD) {
      // LTC detected — Reader mode
      this.ltcChannelIndex = detection.channelIndex
      this.musicChannelIndex = this.buffer.numberOfChannels > 1
        ? (detection.channelIndex === 0 ? 1 : 0)
        : 0
      this.callbacks.onLtcChannelDetected(detection.channelIndex)
    } else {
      // No LTC — both channels are music
      this.ltcChannelIndex = 0
      this.musicChannelIndex = 0
      this.callbacks.onLtcChannelDetected(-1)
    }

    this._extractWaveformData()

    if (detection.confidence >= LTC_CONFIDENCE_THRESHOLD) {
      const ltcData = this.buffer.getChannelData(this.ltcChannelIndex)
      const lookup = buildTimecodeLookup(ltcData, this.buffer.sampleRate)
      this.callbacks.onTimecodeLookup(lookup)
    } else {
      this.callbacks.onTimecodeLookup([])
    }
  }

  // ════════════════════════════════════════════════════════════
  // Settings
  // ════════════════════════════════════════════════════════════

  setLtcChannel(channelIndex: number): void {
    // Clamp to valid channel range — prevents out-of-bounds on mono files
    const maxCh = this.buffer ? this.buffer.numberOfChannels - 1 : 1
    const newLtc = Math.min(channelIndex, maxCh)
    const changed = newLtc !== this.ltcChannelIndex
    this.ltcChannelIndex = newLtc
    this.musicChannelIndex = this.ltcChannelIndex === 0 ? Math.min(1, maxCh) : 0

    // #9 fix: rebuild timecode lookup and waveform when channel changes
    if (changed && this.buffer) {
      this._extractWaveformData()
      const ltcData = this.buffer.getChannelData(this.ltcChannelIndex)
      const lookup = buildTimecodeLookup(ltcData, this.buffer.sampleRate)
      this.callbacks.onTimecodeLookup(lookup)
    }
  }

  setOffset(frames: number): void { this.offsetFrames = frames }

  /** Override the FPS reported by the LTC decoder. null = use detected fps. */
  setForceFps(fps: number | null): void { this.forceFpsValue = fps }

  setLoop(loop: boolean): void {
    this.loop = loop
    if (this.musicSource) this.musicSource.loop = loop
    if (this.ltcSource) this.ltcSource.loop = loop
  }

  setLoopPoints(a: number | null, b: number | null): void {
    this.loopA = a
    this.loopB = b
  }

  setGeneratorMode(enabled: boolean): void {
    this.generatorMode = enabled
    this.lastGeneratedFrame = -1
  }

  setGeneratorStartTC(tcString: string, fps: number): void {
    this.generatorFps = fps
    // Parse "HH:MM:SS:FF" into total frames
    const parts = tcString.split(/[:;]/).map(Number)
    if (parts.length === 4 && parts.every(p => !isNaN(p))) {
      const [h, m, s, f] = parts
      if (fps === 29.97) {
        // #10 fix: Drop-frame TC→frames using standard SMPTE formula
        // Must be exact inverse of _generateTimecode's DF frames→TC conversion.
        // In non-10th minutes, frame labels 00 and 01 at second 0 are skipped,
        // so we subtract D=2 to get the actual frame count within that minute.
        const fpsInt = 30
        const D = 2
        const framesPerMin = fpsInt * 60 - D   // 1798
        const framesPer10Min = framesPerMin * 10 + D  // 17982
        const framesPerHour = framesPer10Min * 6      // 107892
        const tenMinBlocks = Math.floor(m / 10)
        const mInBlock = m % 10
        let frames = h * framesPerHour + tenMinBlocks * framesPer10Min
        if (mInBlock === 0) {
          frames += s * fpsInt + f
        } else {
          // Subtract D: label "02" at s=0 is actually frame 0 of this minute
          frames += fpsInt * 60 + (mInBlock - 1) * framesPerMin + Math.max(0, s * fpsInt + f - D)
        }
        this.generatorStartFrames = frames
      } else {
        const fpsInt = Math.round(fps)
        this.generatorStartFrames = h * 3600 * fpsInt + m * 60 * fpsInt + s * fpsInt + f
      }
    } else {
      this.generatorStartFrames = 0
    }
    this.lastGeneratedFrame = -1
  }

  async setMusicOutputDevice(deviceId: string): Promise<void> {
    this.musicOutputDeviceId = deviceId
    if (this.ctx) {
      try {
        // @ts-expect-error - setSinkId newer API
        // Pass '' to revert to system default when deviceId is 'default'
        await this.ctx.setSinkId(deviceId !== 'default' ? deviceId : '')
      } catch { /**/ }
    }
  }

  async setLtcOutputDevice(deviceId: string): Promise<void> {
    const changed = this.ltcOutputDeviceId !== deviceId
    this.ltcOutputDeviceId = deviceId
    if (!changed) return

    // Device changed — must rebuild ltcCtx with new sink
    if (this.playing) {
      const currentOffset = this.getCurrentTime()
      this._teardownLtcNodes()
      await this._closeLtcCtx()
      await this._setupLtcContext()
      if (this.generatorMode) {
        this._startLtcEncoder(currentOffset)
      } else {
        this._startLtcSource(currentOffset)
      }
    } else {
      await this._closeLtcCtx()
      // Warm up the new device immediately so it's ready for playback
      if (deviceId && deviceId !== 'default') {
        await this._warmUpLtcDevice()
      }
    }
  }

  setLtcGain(value: number): void {
    this.ltcGainValue = Math.max(0, Math.min(LTC_GAIN_MAX, value))
    if (this.ltcGainNode && this.ltcCtx) {
      this.ltcGainNode.gain.setTargetAtTime(this.ltcGainValue, this.ltcCtx.currentTime, 0.01)
    }
  }

  getLtcGain(): number { return this.ltcGainValue }

  // ════════════════════════════════════════════════════════════
  // Playback control
  // ════════════════════════════════════════════════════════════

  async play(offset?: number): Promise<void> {
    if (!this.buffer) return

    const thisPlayId = ++this.playId
    this._stopPlayback()

    const startOffset = offset !== undefined ? offset : this.startOffset

    // ── Music context (recreated each time — no device handle issue) ──
    this.ctx = new AudioContext()
    if (this.musicOutputDeviceId && this.musicOutputDeviceId !== 'default') {
      try {
        // @ts-expect-error - setSinkId newer API
        await this.ctx.setSinkId(this.musicOutputDeviceId)
      } catch { /**/ }
    }

    this.musicSource = this.ctx.createBufferSource()
    this.musicSource.buffer = this.buffer
    this.musicSource.loop = this.loop

    if (this.generatorMode) {
      // Generator mode: play full stereo through music context (no LTC split)
      this.musicSource.connect(this.ctx.destination)

      // ── LTC encoder context — generates LTC audio for VB-CABLE / BlackHole ──
      await this._setupLtcContext()
      if (this.playId !== thisPlayId) return  // race guard: another play/pause interrupted
      this._startLtcEncoder(startOffset)
    } else {
      // LTC Reader mode: split channels, only play music channel
      const splitter = this.ctx.createChannelSplitter(this.buffer.numberOfChannels)
      this.musicSource.connect(splitter)
      const merger = this.ctx.createChannelMerger(2)
      splitter.connect(merger, this.musicChannelIndex, 0)
      splitter.connect(merger, this.musicChannelIndex, 1)
      merger.connect(this.ctx.destination)

      // ── LTC context (reused — preserves VB-CABLE handle) ──
      await this._setupLtcContext()
      if (this.playId !== thisPlayId) return  // race guard
      this._startLtcSource(startOffset)
    }

    // ── Start music ──
    const when = this.ctx.currentTime + SCHEDULING_DELAY
    this.musicSource.start(when, startOffset)
    this.startTime = when - startOffset
    this.startOffset = startOffset
    this.playing = true

    // Notify clock mapping baseline for MTC quarter-frame scheduling
    this.callbacks.onPlayStarted?.(performance.now(), this.ctx.currentTime)

    this.musicSource.onended = () => {
      if (!this.loop) {
        this._stopPlayback()
        this.startOffset = 0
        cancelAnimationFrame(this.rafId)
        this.callbacks.onTimeUpdate(0)
        this.callbacks.onEnded()
      }
    }

    this._startTimeUpdater()
  }

  pause(): void {
    if (!this.ctx) return
    this.startOffset = this.getCurrentTime()
    this._stopPlayback()
    cancelAnimationFrame(this.rafId)
  }

  async seek(time: number): Promise<boolean> {
    const wasPlaying = this.playing
    this.startOffset = Math.max(0, Math.min(time, this.buffer?.duration ?? 0))
    if (wasPlaying) {
      await this.play(this.startOffset)
    }
    this.callbacks.onTimeUpdate(this.startOffset)
    return wasPlaying
  }

  getCurrentTime(): number {
    if (!this.ctx) return this.startOffset
    return this.ctx.currentTime - this.startTime
  }

  getDuration(): number { return this.buffer?.duration ?? 0 }
  getSampleRate(): number { return this.buffer?.sampleRate ?? 48000 }
  getCurrentAudioContextTime(): number { return this.ctx?.currentTime ?? 0 }

  getMusicChannelData(): Float32Array | null {
    if (!this.buffer) return null
    return this.buffer.getChannelData(this.musicChannelIndex)
  }

  async dispose(): Promise<void> {
    // Don't remove devicechange listener here — loadFile() calls dispose() to reset,
    // and the listener must persist across file loads. Removed only in forceCleanup().
    cancelAnimationFrame(this.rafId)
    // #15 fix: clear pending signal timeout before teardown to prevent stale callback
    if (this.ltcSignalTimeout) { clearTimeout(this.ltcSignalTimeout); this.ltcSignalTimeout = null }
    this._stopPlayback()
    await this._closeLtcCtx()
    this.buffer = null
  }

  /**
   * Properly close ltcCtx and reset readiness flags.
   * Extracted to ensure consistent cleanup everywhere.
   */
  private async _closeLtcCtx(): Promise<void> {
    if (this.ltcCtx) {
      try { await this.ltcCtx.close() } catch { /**/ }
      this.ltcCtx = null
    }
    this.ltcWorkletReady = false
    this.ltcEncoderReady = false
  }

  /**
   * Force-release the device handle synchronously (best-effort).
   * Called from window.beforeunload to ensure VB-CABLE handles
   * are released before the process exits.
   */
  forceCleanup(): void {
    navigator.mediaDevices.removeEventListener('devicechange', this._deviceChangeHandler)
    cancelAnimationFrame(this.rafId)
    if (this.ltcSignalTimeout) { clearTimeout(this.ltcSignalTimeout); this.ltcSignalTimeout = null }
    this._teardownLtcNodes()
    if (this.musicSource) { try { this.musicSource.stop() } catch { /**/ } this.musicSource = null }
    if (this.ctx) { try { this.ctx.close() } catch { /**/ } this.ctx = null }
    if (this.ltcCtx) { try { this.ltcCtx.close() } catch { /**/ } this.ltcCtx = null }
    this.ltcWorkletReady = false
    this.ltcEncoderReady = false
  }

  /**
   * Warm up the LTC output device on startup.
   * Creates ltcCtx, sets the sink, and plays a brief silent buffer
   * to force the OS/driver to establish the device connection.
   * This prevents VB-CABLE "locked handle" issues on Windows.
   */
  async warmUpLtcDevice(): Promise<void> {
    await this._warmUpLtcDevice()
  }

  private async _warmUpLtcDevice(): Promise<void> {
    if (!this.ltcOutputDeviceId || this.ltcOutputDeviceId === 'default') return

    try {
      // Create a fresh context targeting the saved device
      await this._closeLtcCtx()
      this.ltcCtx = new AudioContext()

      // @ts-expect-error - setSinkId newer API
      await this.ltcCtx.setSinkId(this.ltcOutputDeviceId)

      // Play a tiny silent buffer to force the driver to "activate"
      const silentBuf = this.ltcCtx.createBuffer(1, WARMUP_BUFFER_LENGTH, this.ltcCtx.sampleRate)
      const src = this.ltcCtx.createBufferSource()
      src.buffer = silentBuf
      src.connect(this.ltcCtx.destination)
      src.start()

      // Wait a short moment for the driver to respond, then load worklets
      await new Promise(r => setTimeout(r, WARMUP_DELAY_MS))

      // Load worklet modules so they're ready for playback (with retry)
      this.ltcWorkletReady = await this._loadWorklet(ltcProcessorCode, 'LTC decoder')
      this.ltcEncoderReady = await this._loadWorklet(ltcEncoderCode, 'LTC encoder')

      console.log('LTC device warmed up:', this.ltcOutputDeviceId)
    } catch (e) {
      console.warn('LTC device warm-up failed, will retry on play:', e)
      this.callbacks.onLtcError?.('warmup')
      // Don't fail hard — _setupLtcContext will retry on play()
      await this._closeLtcCtx()
    }
  }

  // ════════════════════════════════════════════════════════════
  // Private — LTC context management
  // ════════════════════════════════════════════════════════════

  /**
   * Create or reuse the LTC AudioContext.
   * The context persists across play/pause/seek to avoid losing
   * the VB-CABLE / BlackHole device handle on Windows.
   */
  private async _setupLtcContext(): Promise<void> {
    // Reuse existing context if available
    if (this.ltcCtx && this.ltcCtx.state !== 'closed') {
      if (this.ltcCtx.state === 'suspended') {
        await this.ltcCtx.resume()
      }
      return
    }

    // Create new context
    this.ltcCtx = new AudioContext()
    this.ltcWorkletReady = false

    // Set output sink:
    //   'default' (muted) → { type: 'none' } = worklet runs, no audio output
    //   deviceId           → setSinkId(id)   = audio routes to that device
    try {
      if (this.ltcOutputDeviceId && this.ltcOutputDeviceId !== 'default') {
        // @ts-expect-error - setSinkId newer API
        await this.ltcCtx.setSinkId(this.ltcOutputDeviceId)
      } else {
        // @ts-expect-error - setSinkId with null sink
        await this.ltcCtx.setSinkId({ type: 'none' })
      }
    } catch {
      // Fallback for older Electron: if sink fails, audio may leak.
      // setSinkId({ type: 'none' }) requires Chromium 110+ (Electron 28+).
      console.warn('setSinkId failed, LTC audio may leak to default output')
    }

    // Load worklet modules (decoder + encoder) with retry
    this.ltcWorkletReady = await this._loadWorklet(ltcProcessorCode, 'LTC decoder')
    this.ltcEncoderReady = await this._loadWorklet(ltcEncoderCode, 'LTC encoder')
  }

  /** Load an AudioWorklet module with one retry on failure. */
  private async _loadWorklet(code: string, label: string): Promise<boolean> {
    if (!this.ltcCtx) return false
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.ltcCtx) return false  // context may have been closed during retry wait
      const blob = new Blob([code], { type: 'application/javascript' })
      const url = URL.createObjectURL(blob)
      try {
        await this.ltcCtx.audioWorklet.addModule(url)
        return true
      } catch (e) {
        if (attempt === 0) {
          console.warn(`${label} worklet load failed, retrying...`, e)
          await new Promise(r => setTimeout(r, 50))
        } else {
          console.error(`${label} worklet load failed after retry:`, e)
        }
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    return false
  }

  /**
   * Start LTC source and connect all LTC audio nodes.
   * Must be called AFTER _setupLtcContext().
   */
  private _startLtcSource(offset: number): void {
    if (!this.ltcCtx || !this.buffer) return

    this.ltcSource = this.ltcCtx.createBufferSource()
    this.ltcSource.buffer = this.buffer
    this.ltcSource.loop = this.loop

    const splitter = this.ltcCtx.createChannelSplitter(this.buffer.numberOfChannels)
    this.ltcSource.connect(splitter)

    // Worklet for LTC decoding (no audio output — numberOfOutputs: 0)
    if (this.ltcWorkletReady) {
      try {
        this.ltcWorkletNode = new AudioWorkletNode(this.ltcCtx, 'ltc-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 0,
          channelCount: 1
        })
        splitter.connect(this.ltcWorkletNode, this.ltcChannelIndex)
        this.ltcWorkletNode.port.onmessage = (e) => this._onLtcFrame(e.data)
      } catch (e) {
        console.warn('LTC worklet creation failed:', e)
        this.callbacks.onLtcError?.('worklet')
      }
    }

    // Audio output path: splitter → merger (mono→stereo) → gain → destination
    // The destination output is controlled by the context's setSinkId:
    //   { type: 'none' } = silent    |    deviceId = routes to that device
    this.ltcGainNode = this.ltcCtx.createGain()

    const merger = this.ltcCtx.createChannelMerger(2)
    splitter.connect(merger, this.ltcChannelIndex, 0)
    splitter.connect(merger, this.ltcChannelIndex, 1)
    merger.connect(this.ltcGainNode)
    this.ltcGainNode.connect(this.ltcCtx.destination)

    // Start playback
    const when = this.ltcCtx.currentTime + SCHEDULING_DELAY
    this.ltcStartupDeadline = when + 0.05

    // If seeking to a position far from where we last stopped, mute the LTC output
    // for 250ms after the scheduled start. This prevents spurious audio from position 0
    // (or from a previous file) reaching VB-CABLE before the correct position audio arrives.
    // EASY_TRIGGER reads raw audio from VB-CABLE directly, so muting the gain is the only
    // reliable way to suppress wrong-position triggers.
    // Pause/resume (offset ≈ ltcLastStopOffset) skips the mute to avoid LTC gaps.
    const isResume = Math.abs(offset - this.ltcLastStopOffset) < 0.5
    if (isResume) {
      this.ltcGainNode.gain.value = this.ltcGainValue
    } else {
      this.ltcGainNode.gain.setValueAtTime(0, this.ltcCtx.currentTime)
      this.ltcGainNode.gain.setValueAtTime(this.ltcGainValue, when + 0.25)
    }

    this.ltcSource.start(when, offset)
  }

  /**
   * Start LTC encoder — generates LTC audio signal in generator mode.
   * The encoder creates LTC from timecode parameters (no input audio needed).
   */
  private _startLtcEncoder(offset: number): void {
    if (!this.ltcCtx) return
    if (!this.ltcEncoderReady) {
      this.callbacks.onLtcError?.('encoder')
      return
    }

    try {
      this.ltcEncoderNode = new AudioWorkletNode(this.ltcCtx, 'ltc-encoder', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        channelCount: 1,
        outputChannelCount: [1]
      })

      // Gain node for output level control
      this.ltcGainNode = this.ltcCtx.createGain()

      // Mute for 250ms on seek (same protection as _startLtcSource)
      // Prevents encoder from outputting wrong-position LTC before it settles
      const when = this.ltcCtx.currentTime + SCHEDULING_DELAY
      const isResume = Math.abs(offset - this.ltcLastStopOffset) < 0.5
      if (isResume) {
        this.ltcGainNode.gain.value = this.ltcGainValue
      } else {
        this.ltcGainNode.gain.setValueAtTime(0, this.ltcCtx.currentTime)
        this.ltcGainNode.gain.setValueAtTime(this.ltcGainValue, when + 0.25)
      }

      // Encoder → gain → destination (VB-CABLE / BlackHole)
      this.ltcEncoderNode.connect(this.ltcGainNode)
      this.ltcGainNode.connect(this.ltcCtx.destination)

      // Calculate the starting frame number from offset + generatorStartTC
      const startFrameNumber = this.generatorStartFrames + Math.floor(offset * this.generatorFps)

      // Send config to start generating
      this.ltcEncoderNode.port.postMessage({
        type: 'config',
        fps: this.generatorFps,
        startFrameNumber,
        dropFrame: this.generatorFps === 29.97,
        amplitude: 0.5
      })
    } catch (e) {
      console.warn('LTC encoder worklet creation failed:', e)
    }
  }

  /**
   * Tear down LTC source nodes (but keep ltcCtx alive).
   */
  private _teardownLtcNodes(): void {
    if (this.ltcSource) { try { this.ltcSource.stop() } catch { /**/ } this.ltcSource = null }
    if (this.ltcWorkletNode) { this.ltcWorkletNode.port.onmessage = null; try { this.ltcWorkletNode.disconnect() } catch { /**/ } this.ltcWorkletNode = null }
    if (this.ltcEncoderNode) {
      try { this.ltcEncoderNode.port.postMessage({ type: 'stop' }) } catch { /**/ }
      try { this.ltcEncoderNode.disconnect() } catch { /**/ }
      this.ltcEncoderNode = null
    }
    if (this.ltcGainNode) { try { this.ltcGainNode.disconnect() } catch { /**/ } this.ltcGainNode = null }
  }

  // ════════════════════════════════════════════════════════════
  // Private — playback lifecycle
  // ════════════════════════════════════════════════════════════

  private _stopPlayback(): void {
    // #3 fix: snapshot current position BEFORE closing ctx (prevents negative/stale values)
    const snapshotTime = this.ctx ? Math.max(0, this.ctx.currentTime - this.startTime) : this.startOffset
    this.startOffset = snapshotTime
    this.playing = false
    this.lastGeneratedFrame = -1
    this.ltcLastStopOffset = snapshotTime

    // Clear pending LTC signal timeout and reset signal status
    if (this.ltcSignalTimeout) { clearTimeout(this.ltcSignalTimeout); this.ltcSignalTimeout = null }
    this.callbacks.onLtcSignalStatus(false)

    // Stop music (clear onended first to prevent double-firing of onEnded callback)
    if (this.musicSource) { this.musicSource.onended = null; try { this.musicSource.stop() } catch { /**/ } this.musicSource = null }
    if (this.ctx) { try { this.ctx.close() } catch { /**/ } this.ctx = null }

    // Stop LTC sources (but keep ltcCtx alive for device handle)
    this._teardownLtcNodes()
  }

  // ════════════════════════════════════════════════════════════
  // Private — LTC frame processing
  // ════════════════════════════════════════════════════════════

  private _onLtcFrame(raw: TimecodeFrame & { halfBitPeriod?: number }): void {
    // Discard spurious frames from audio buffer position 0 that may fire
    // during the Chromium audio engine's first render quantum before the
    // scheduled start time (causing wrong-position LTC to leak to VB-CABLE)
    if (this.ltcCtx && this.ltcCtx.currentTime < this.ltcStartupDeadline) return

    const fps = this.forceFpsValue ?? raw.fps ?? this.currentFps
    if (!fps || fps <= 0 || !isFinite(fps)) return  // guard against invalid FPS
    this.currentFps = fps

    // #1 fix: use integer arithmetic for 29.97 DF to avoid floating-point drift
    const isDropFrame = this.forceFpsValue !== null
      ? this.forceFpsValue === 29.97
      : raw.dropFrame
    const fpsInt = Math.round(fps)  // 30 for 29.97, 25 for 25, etc.

    // Convert raw HH:MM:SS:FF to absolute frame count using integer math
    let totalFrames: number
    if (isDropFrame) {
      const D = 2
      const framesPerMin = fpsInt * 60 - D           // 1798
      const framesPer10Min = framesPerMin * 10 + D   // 17982
      const framesPerHour = framesPer10Min * 6        // 107892
      const tenMinBlocks = Math.floor(raw.minutes / 10)
      const mInBlock = raw.minutes % 10
      totalFrames = raw.hours * framesPerHour + tenMinBlocks * framesPer10Min
      if (mInBlock === 0) {
        totalFrames += raw.seconds * fpsInt + raw.frames
      } else {
        totalFrames += fpsInt * 60 + (mInBlock - 1) * framesPerMin + raw.seconds * fpsInt + raw.frames
      }
    } else {
      totalFrames = raw.hours * 3600 * fpsInt
        + raw.minutes * 60 * fpsInt
        + raw.seconds * fpsInt
        + raw.frames
    }

    totalFrames += this.offsetFrames
    totalFrames = Math.max(0, totalFrames)

    // Convert back to HH:MM:SS:FF using integer math
    let h: number, m: number, s: number, f: number
    if (isDropFrame) {
      const D = 2
      const framesPerMin = fpsInt * 60 - D
      const framesPer10Min = framesPerMin * 10 + D
      const framesPerHour = framesPer10Min * 6

      h = Math.floor(totalFrames / framesPerHour) % 24
      let remaining = totalFrames - h * framesPerHour
      const tenMinBlk = Math.floor(remaining / framesPer10Min)
      remaining -= tenMinBlk * framesPer10Min

      let mInBlk: number
      if (remaining < fpsInt * 60) {
        mInBlk = 0
      } else {
        remaining -= fpsInt * 60
        mInBlk = 1 + Math.floor(remaining / framesPerMin)
        remaining -= (mInBlk - 1) * framesPerMin
      }
      m = tenMinBlk * 10 + mInBlk
      const dropAdj = mInBlk > 0 ? remaining + D : remaining
      s = Math.floor(dropAdj / fpsInt)
      f = dropAdj - s * fpsInt
    } else {
      h = Math.floor(totalFrames / (3600 * fpsInt)) % 24
      let rem = totalFrames - h * 3600 * fpsInt
      m = Math.floor(rem / (60 * fpsInt))
      rem -= m * 60 * fpsInt
      s = Math.floor(rem / fpsInt)
      f = rem - s * fpsInt
    }

    const tc: TimecodeFrame = {
      hours: h % 24,
      minutes: m % 60,
      seconds: s % 60,
      frames: Math.min(f, fpsInt - 1),
      fps,
      dropFrame: isDropFrame
    }

    this.callbacks.onTimecode(tc)
    this.callbacks.onLtcSignalStatus(true)

    if (this.ltcSignalTimeout) clearTimeout(this.ltcSignalTimeout)
    this.ltcSignalTimeout = setTimeout(() => {
      this.callbacks.onLtcSignalStatus(false)
    }, LTC_SIGNAL_TIMEOUT_MS)
  }

  // ════════════════════════════════════════════════════════════
  // Private — time tracking
  // ════════════════════════════════════════════════════════════

  private _startTimeUpdater(): void {
    const update = (): void => {
      if (!this.ctx) return

      const ct = this.getCurrentTime()
      const dur = this.buffer?.duration ?? 0

      if (!this.loop && dur > 0 && ct >= dur) {
        this._stopPlayback()
        this.startOffset = 0
        cancelAnimationFrame(this.rafId)
        this.callbacks.onTimeUpdate(0)
        this.callbacks.onEnded()
        return
      }

      if (this.loopA !== null && this.loopB !== null && this.loopA < this.loopB && ct >= this.loopB) {
        cancelAnimationFrame(this.rafId)  // stop this rAF loop before seek starts a new one
        const targetTime = this.loopA
        const currentPlayId = this.playId
        this.seek(targetTime).then(() => {
          // Guard: only update if exactly our seek completed (playId incremented by 1)
          if (this.playId === currentPlayId + 1) {
            this.callbacks.onTimeUpdate(targetTime)
          }
        })
        return
      }

      // TC Generator: emit timecode based on playback position
      if (this.generatorMode && this.generatorFps > 0) {
        this._generateTimecode(ct)
      }

      this.callbacks.onTimeUpdate(ct)
      this.rafId = requestAnimationFrame(update)
    }
    this.rafId = requestAnimationFrame(update)
  }

  /**
   * Generate a TimecodeFrame from playback position + start TC offset.
   * Only emits when the frame number actually changes (throttles to FPS rate).
   */
  private _generateTimecode(currentTime: number): void {
    const fps = this.generatorFps
    if (!fps || fps <= 0 || !isFinite(fps)) return  // guard against invalid FPS
    let totalFrames = this.generatorStartFrames
      + Math.floor(currentTime * fps)
      + this.offsetFrames

    // Only emit when frame changes
    if (totalFrames === this.lastGeneratedFrame) return
    this.lastGeneratedFrame = totalFrames

    totalFrames = Math.max(0, totalFrames)
    const isDropFrame = fps === 29.97
    const fpsInt = Math.round(fps)  // 30 for 29.97
    let h: number, m: number, s: number, f: number

    if (isDropFrame) {
      // Drop-frame: skip frames 0,1 at start of each minute except every 10th
      const D = 2
      const framesPerMin = fpsInt * 60 - D           // 1798
      const framesPer10Min = framesPerMin * 10 + D   // 17982
      const framesPerHour = framesPer10Min * 6        // 107892

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
      // Drop minutes (mInBlock > 0) skip frame labels 00 and 01 in second 0.
      // Add D=2 before dividing so that remaining=0 → frame 02, remaining=28 → second 1 frame 00, etc.
      const dropAdjusted = mInBlock > 0 ? remaining + D : remaining
      s = Math.floor(dropAdjusted / fpsInt)
      f = dropAdjusted - s * fpsInt
    } else {
      h = Math.floor(totalFrames / (3600 * fps))
      totalFrames -= h * 3600 * fps
      m = Math.floor(totalFrames / (60 * fps))
      totalFrames -= m * 60 * fps
      s = Math.floor(totalFrames / fps)
      f = Math.round(totalFrames - s * fps)
    }

    const tc: TimecodeFrame = {
      hours: h % 24,
      minutes: m % 60,
      seconds: s % 60,
      frames: Math.min(f, Math.ceil(fps) - 1),
      fps,
      dropFrame: isDropFrame
    }

    this.callbacks.onTimecode(tc)
    this.callbacks.onLtcSignalStatus(true)

    // Reset signal-lost timeout (same as _onLtcFrame) so the dot turns off
    // when generator mode is paused or stopped
    if (this.ltcSignalTimeout) clearTimeout(this.ltcSignalTimeout)
    this.ltcSignalTimeout = setTimeout(() => {
      this.callbacks.onLtcSignalStatus(false)
    }, LTC_SIGNAL_TIMEOUT_MS)
  }

  // ════════════════════════════════════════════════════════════
  // Private — waveform extraction
  // ════════════════════════════════════════════════════════════

  private _extractWaveformData(): void {
    if (!this.buffer) return
    const POINTS = WAVEFORM_POINTS
    const total = this.buffer.length
    const musicData = new Float32Array(POINTS)
    const ltcData = new Float32Array(POINTS)
    const musicCh = this.buffer.getChannelData(this.musicChannelIndex)
    // In generator mode (no LTC), ltcCh is same as music — we still show a waveform
    const ltcCh = this.buffer.getChannelData(this.ltcChannelIndex)

    for (let i = 0; i < POINTS; i++) {
      const start = Math.floor((i / POINTS) * total)
      const end = Math.floor(((i + 1) / POINTS) * total)
      let mMax = 0, lMax = 0
      for (let j = start; j < end; j++) {
        const ma = Math.abs(musicCh[j]); if (ma > mMax) mMax = ma
        const la = Math.abs(ltcCh[j]); if (la > lMax) lMax = la
      }
      musicData[i] = mMax
      ltcData[i] = lMax
    }
    this.callbacks.onWaveformData(musicData, ltcData)
  }
}
