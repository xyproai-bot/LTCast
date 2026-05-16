import { detectLtcChannel } from './LtcDetector'
import { buildTimecodeLookup, TimecodeLookupEntry } from './LtcDecoder'
import { TimecodeFrame } from '../store'
import { LTC_CONFIDENCE_THRESHOLD } from '../constants'
import { tcToFrames, framesToTc } from './timecodeConvert'

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
  onLtcStartTime?: (seconds: number) => void
  onWaveformData: (music: Float32Array, ltc: Float32Array) => void
  onTimecodeLookup: (lookup: TimecodeLookupEntry[]) => void
  onDeviceDisconnected?: (deviceId: string) => void
  onDeviceReconnected?: (deviceId: string) => void
  onPlayStarted?: (perfNow: number, audioTime: number) => void
  onLtcError?: (message: string) => void
  /** Fires when the LTC input pipeline produces a decoded TC frame from
   *  the external audio device (chase mode). Separate from onTimecode,
   *  which is reserved for the file-LTC decoder path. */
  onLtcInputTimecode?: (tc: TimecodeFrame) => void
  /** Fires when the LTC input device fails (permission denied, missing
   *  device, mid-show disconnect). `type` is a coarse classifier so the
   *  UI can pick the right toast string. */
  onLtcInputError?: (type: 'permission-denied' | 'device-missing' | 'disconnected' | 'unknown') => void
  /** Fires when auto-detect mode locks onto an input channel for LTC.
   *  Only emitted in 'auto' mode (channel === 'auto') the first time any
   *  channel produces a decoded TC frame. The UI can use this to show
   *  "Auto → CH N" to the operator. Passed value is 0-based channel index. */
  onLtcInputChannelDetected?: (channelIndex: number) => void
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
  private musicGainNode: GainNode | null = null
  private musicPannerNode: StereoPannerNode | null = null
  private musicVolumeValue = 1.0
  private musicPanValue = 0.0
  // When true, the music routing strips the LTC channel so it isn't audible
  // on the music output. Useful for files that have music + LTC mixed into
  // one stereo file. Set via setMuteLtcFromMusic().
  private muteLtcFromMusicFlag = false
  // Channel the operator selected for LTC ('auto' | 0..3). Used in addition
  // to detectedLtcChannel to decide which channel to mute from music.
  private operatorLtcChannelChoice: 'auto' | 0 | 1 | 2 | 3 = 'auto'
  // Set to true after _applyDecodedBuffer when detection confidence cleared
  // the LTC_CONFIDENCE_THRESHOLD. Lets the mute-channel resolver fall back
  // to channel 1 when the operator left ltcChannel on 'auto' for a file
  // that has no detectable LTC.
  private callbacksDetectedLtc = false
  // Splitter/merger pair wiring `musicSource` to `musicGainNode`. Tracked
  // so we can tear them down when the routing is rebuilt mid-play.
  private _musicSplitter: ChannelSplitterNode | null = null
  private _musicMerger: ChannelMergerNode | null = null

  // ── LTC decode + output context ──────────────────────────
  private ltcCtx: AudioContext | null = null
  private ltcWorkletReady = false
  private ltcEncoderReady = false
  private ltcSource: AudioBufferSourceNode | null = null
  // Track splitter/merger nodes so they can be disconnected and GC'd on stop.
  // Without this, each pause/resume cycle leaks dead node fan-in into ltcGainNode.
  private ltcSplitter: ChannelSplitterNode | null = null
  private ltcMerger: ChannelMergerNode | null = null
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

  /** Returns 0 when no LTC device is selected, so audio never leaks to default output */
  private _effectiveLtcGain(): number {
    return (!this.ltcOutputDeviceId || this.ltcOutputDeviceId === 'default') ? 0 : this.ltcGainValue
  }
  private playing = false
  /** Monotonically increasing counter to guard against play/seek race conditions */
  private playId = 0

  // TC Generator mode
  private generatorMode = false
  private generatorStartFrames = 0   // parsed from HH:MM:SS:FF
  private generatorFps = 25
  private lastGeneratedFrame = -1

  // ── LTC Input pipeline (external audio device → chase) ──────────
  // Independent of the file-LTC path. Owns its own AudioContext (so the
  // input device's nominal sample rate can differ from the file context)
  // plus a dedicated ltc-processor worklet instance. Frames are dispatched
  // via callbacks.onLtcInputTimecode.
  private ltcInputCtx: AudioContext | null = null
  private ltcInputStream: MediaStream | null = null
  private ltcInputSourceNode: MediaStreamAudioSourceNode | null = null
  private ltcInputSplitter: ChannelSplitterNode | null = null
  private ltcInputChannel: 'auto' | 0 | 1 | 2 | 3 = 'auto'
  private ltcInputWorkletNode: AudioWorkletNode | null = null
  private ltcInputDeviceId: string | null = null
  // Track the worklet load promise so concurrent setLtcInputDevice() calls
  // don't race on addModule.
  private ltcInputWorkletLoaded = false
  // Auto-detect mode: one AudioWorkletNode per scanned channel. Each worklet
  // listens to a single channel of the input device and posts decoded TC
  // frames back to the engine. The first worklet to emit a frame "wins"
  // and its channel index is locked in via `ltcAutoDetectedChannel`; frames
  // from other worklets are silently dropped after that. This lets us pick
  // up LTC on whichever channel actually carries it (Auto-fixes the case
  // where the operator's LTC is on CH 2 but we used to always read CH 0).
  private ltcInputAutoWorklets: AudioWorkletNode[] = []
  private ltcAutoDetectedChannel: number | null = null
  // Indices that the auto-detect pipeline is currently scanning. Maps a
  // worklet's position in `ltcInputAutoWorklets` to a real channel index
  // on the source device. Static once the pipeline starts.
  private ltcAutoScanChannels: number[] = []

  // ── Pre-buffer (F1) — one-slot cache for the next cued song ──────
  // A disposable scratch AudioContext decodes the next file ahead of time
  // so Space/GO can skip the multi-second read+decode pipeline. Identity
  // is tracked by a caller-supplied Symbol so a stale decode that resolves
  // after the operator has moved on self-destructs instead of firing.
  private prebufferedBuffer: AudioBuffer | null = null
  private prebufferedToken: symbol | null = null

  private _deviceChangeHandler = (): void => { this._checkDeviceAvailability() }

  constructor(callbacks: AudioEngineCallbacks) {
    this.callbacks = callbacks
    // Monitor audio device changes (plug/unplug)
    navigator.mediaDevices.addEventListener('devicechange', this._deviceChangeHandler)
  }

  /** Track which devices were disconnected so we can attempt reconnect */
  private disconnectedDeviceId: string | null = null

  /** Check if currently-used audio devices are still available */
  private async _checkDeviceAvailability(): Promise<void> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const outputIds = new Set(
        devices.filter(d => d.kind === 'audiooutput').map(d => d.deviceId)
      )

      // Check for reconnected device
      if (this.disconnectedDeviceId && outputIds.has(this.disconnectedDeviceId)) {
        const deviceId = this.disconnectedDeviceId
        this.disconnectedDeviceId = null
        // Re-warm the LTC device if it was the one that reconnected
        if (deviceId === this.ltcOutputDeviceId) {
          await this._closeLtcCtx()
          await this._warmUpLtcDevice()
          this.callbacks.onDeviceReconnected?.(deviceId)
        }
        return
      }

      if (!this.playing) return
      // 'default' is always present
      if (this.musicOutputDeviceId !== 'default' && !outputIds.has(this.musicOutputDeviceId)) {
        this.disconnectedDeviceId = this.musicOutputDeviceId
        this.pause()
        this.callbacks.onDeviceDisconnected?.(this.musicOutputDeviceId)
      } else if (this.ltcOutputDeviceId !== 'default' && !outputIds.has(this.ltcOutputDeviceId)) {
        this.disconnectedDeviceId = this.ltcOutputDeviceId
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
    let decoded: AudioBuffer
    try {
      decoded = await decodeCtx.decodeAudioData(arrayBuffer)
    } finally {
      await decodeCtx.close()
    }

    this._applyDecodedBuffer(decoded)
  }

  /**
   * Post-decode pipeline for an already-decoded AudioBuffer.
   *
   * Public entry point for the prebuffer fast path: callers (e.g. App.tsx
   * after a successful consumePrebuffered) pass in an AudioBuffer that was
   * decoded on a scratch context ahead of time. This method reproduces the
   * exact dispose → reset offset → set buffer → detect LTC → extract
   * waveform → build timecode lookup sequence that loadFile performs, so
   * the caller's post-decode side-effects (UI state, OSC fires, etc.) can
   * remain identical between the fast and fallback paths.
   */
  async loadDecodedBuffer(buffer: AudioBuffer): Promise<void> {
    await this.dispose()
    this.startOffset = 0
    this.callbacks.onTimeUpdate(0)
    this._applyDecodedBuffer(buffer)
  }

  // ════════════════════════════════════════════════════════════
  // Pre-buffer (F1) — decode next song ahead of time
  // ════════════════════════════════════════════════════════════

  /**
   * Decode an ArrayBuffer on a disposable scratch AudioContext and cache
   * the result under the given token. Returns the decoded AudioBuffer on
   * success, or null if decoding failed (silent failure — caller falls
   * back to the full loadFile path).
   *
   * Scratch context is closed in a finally block — it never touches
   * `ctx`, `ltcCtx`, or any playback node. If a previous prebuffer is
   * still cached, it is cleared synchronously before decoding starts.
   *
   * On decode rejection the cached state is cleared. If the token no
   * longer matches the engine's `prebufferedToken` at resolution time
   * (e.g. a subsequent prebuffer call overwrote it), the decoded buffer
   * is dropped and null is returned — this covers the "standby A, then
   * standby B before A's decode finishes" race.
   */
  async prebufferFile(arrayBuffer: ArrayBuffer, token: symbol): Promise<AudioBuffer | null> {
    // Clear any previous slot synchronously so nothing from a stale token
    // lingers while this decode is in flight (per contract memory lifecycle).
    this.prebufferedBuffer = null
    this.prebufferedToken = token

    const decodeCtx = new AudioContext()
    try {
      const decoded = await decodeCtx.decodeAudioData(arrayBuffer)
      // Race check: a later prebuffer call may have replaced our token.
      // If so, the new token owns the slot — drop this result on the floor.
      if (this.prebufferedToken !== token) return null
      this.prebufferedBuffer = decoded
      return decoded
    } catch {
      // Decode failure — wipe the slot so a future consume sees nothing.
      // Only clear if we still own the token (a newer prebuffer may have
      // taken over).
      if (this.prebufferedToken === token) {
        this.prebufferedBuffer = null
        this.prebufferedToken = null
      }
      return null
    } finally {
      try { await decodeCtx.close() } catch { /* best effort */ }
    }
  }

  /**
   * Retrieve the pre-decoded AudioBuffer if the supplied token matches
   * the one stored by the most recent prebufferFile call. Returns null
   * on token mismatch (stale consumer) or when no buffer is cached.
   *
   * A successful consume clears the slot in one shot — subsequent calls
   * return null. This guarantees a prebuffered buffer is used at most
   * once and never held across songs.
   */
  consumePrebuffered(token: symbol): AudioBuffer | null {
    if (this.prebufferedToken !== token) return null
    const buf = this.prebufferedBuffer
    if (!buf) return null
    this.prebufferedBuffer = null
    this.prebufferedToken = null
    return buf
  }

  /**
   * Drop the pre-decoded buffer and its token. If `token` is provided,
   * only clears when it matches (prevents a cancelled job from wiping
   * out a newer one that overlapped it). With no argument, clears
   * unconditionally.
   */
  clearPrebuffered(token?: symbol): void {
    if (token !== undefined && this.prebufferedToken !== token) return
    this.prebufferedBuffer = null
    this.prebufferedToken = null
  }

  /**
   * Internal: set the active buffer and fire the post-decode callbacks.
   * Assumes dispose/startOffset/onTimeUpdate have already been handled by
   * the caller (loadFile or loadDecodedBuffer).
   *
   * Order is load-bearing — detect LTC channel → set ltc/music indices →
   * extract waveform → build timecode lookup — must match the original
   * loadFile tail bit-for-bit.
   */
  private _applyDecodedBuffer(buffer: AudioBuffer): void {
    this.buffer = buffer

    // Auto-detect LTC channel
    const detection = detectLtcChannel(this.buffer)
    this.callbacks.onLtcConfidence(detection.confidence)
    this.callbacks.onLtcStartTime?.(detection.ltcStartTime)

    if (detection.confidence >= LTC_CONFIDENCE_THRESHOLD) {
      // LTC detected — Reader mode
      this.ltcChannelIndex = detection.channelIndex
      this.musicChannelIndex = this.buffer.numberOfChannels > 1
        ? (detection.channelIndex === 0 ? 1 : 0)
        : 0
      this.callbacksDetectedLtc = true
      this.callbacks.onLtcChannelDetected(detection.channelIndex)
    } else {
      // No LTC — both channels are music
      this.ltcChannelIndex = 0
      this.musicChannelIndex = 0
      this.callbacksDetectedLtc = false
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

  /**
   * Toggle whether the LTC channel is stripped from the music output.
   *
   * When `true`, the music speaker hears only the non-LTC channels of the
   * source — useful for files where music + LTC are mixed into one stereo
   * file. When `false` (default), the music output uses the historical
   * routing (single channel duplicated to L+R).
   *
   * Calling this while playing transparently rebuilds the music routing so
   * the change is audible immediately (no pause/resume required).
   */
  setMuteLtcFromMusic(v: boolean): void {
    if (this.muteLtcFromMusicFlag === v) return
    this.muteLtcFromMusicFlag = v
    if (this.playing && this.ctx && this.musicSource && this.musicGainNode) {
      this._rebuildMusicRouting()
    }
  }

  /**
   * Remember the operator's LTC-channel choice from the store. Used in
   * mute-LTC-from-music routing to figure out which channel to skip when
   * `ltcChannel === 'auto'` and detection didn't find LTC.
   *
   * The engine still uses `ltcChannelIndex` for actual LTC decoding (set
   * by detectLtcChannel or `setLtcChannel`); this flag only matters for
   * the mute fallback path.
   */
  setOperatorLtcChannelChoice(ch: 'auto' | 0 | 1 | 2 | 3): void {
    this.operatorLtcChannelChoice = ch
  }

  /**
   * Rebuild the music source → musicGain wiring without disturbing the
   * gain/panner/destination chain or the LTC pipeline. Called when
   * `muteLtcFromMusic` is toggled mid-playback.
   *
   * Stale splitter/merger from the previous routing are disconnected and
   * dropped — the source is reconnected to the new chain. We deliberately
   * do NOT recreate the music source (no audible glitch / restart).
   */
  private _rebuildMusicRouting(): void {
    if (!this.ctx || !this.musicSource || !this.musicGainNode || !this.buffer) return

    // Disconnect source from previous routing
    try { this.musicSource.disconnect() } catch { /* ignore */ }
    // Disconnect any previous splitter/merger nodes hanging off the source
    if (this._musicSplitter) { try { this._musicSplitter.disconnect() } catch { /* ignore */ } this._musicSplitter = null }
    if (this._musicMerger) { try { this._musicMerger.disconnect() } catch { /* ignore */ } this._musicMerger = null }

    this._connectMusicRouting()
  }

  /**
   * Resolve which channel index of the source buffer holds LTC, for the
   * purpose of stripping it from music. Distinct from `ltcChannelIndex`
   * because that one is only valid when LTC was actually detected.
   *
   * Priority:
   *   1. Operator picked a channel explicitly (ltcChannel = 0/1/2/3) → use it
   *   2. Operator left it on 'auto' AND detection found LTC → use detected
   *   3. Otherwise → default to channel 1 (right), the common LTC position
   *      in two-track music+LTC files.
   *
   * Result is clamped to the file's channel count.
   */
  private _resolveLtcChannelForMute(): number {
    if (!this.buffer) return 1
    const maxCh = this.buffer.numberOfChannels - 1
    let ch: number
    if (this.operatorLtcChannelChoice !== 'auto') {
      ch = this.operatorLtcChannelChoice
    } else if (this.ltcChannelIndex >= 0 && this.callbacksDetectedLtc) {
      ch = this.ltcChannelIndex
    } else {
      // 'auto' + no detection → assume right channel (typical music+LTC stereo)
      ch = 1
    }
    return Math.max(0, Math.min(maxCh, ch))
  }

  /**
   * Wire `musicSource` to `musicGainNode` according to the current mode:
   *
   *   - Generator mode → source straight into gain (no channel routing).
   *   - LTC mode, mute-LTC OFF → historical behaviour: pick the music
   *     channel, splitter → merger (mono → stereo) → gain.
   *   - LTC mode, mute-LTC ON → splitter → merger but EXCLUDE the LTC
   *     channel. The remaining channels are spread across L and R; a
   *     single-channel result is duplicated to both sides so the music
   *     still plays in stereo.
   *
   * Caller must have created musicSource + musicGainNode beforehand.
   * Sets `_musicSplitter` and `_musicMerger` so a future rebuild can
   * clean them up.
   */
  private _connectMusicRouting(): void {
    if (!this.ctx || !this.musicSource || !this.musicGainNode || !this.buffer) return

    if (this.generatorMode) {
      this.musicSource.connect(this.musicGainNode)
      return
    }

    const channelCount = this.buffer.numberOfChannels
    const splitter = this.ctx.createChannelSplitter(channelCount)
    this._musicSplitter = splitter
    this.musicSource.connect(splitter)
    const merger = this.ctx.createChannelMerger(2)
    this._musicMerger = merger

    if (this.muteLtcFromMusicFlag) {
      const ltcCh = this._resolveLtcChannelForMute()
      // Collect non-LTC channel indices (in source order).
      const musicChannels: number[] = []
      for (let i = 0; i < channelCount; i++) {
        if (i !== ltcCh) musicChannels.push(i)
      }
      if (musicChannels.length === 0) {
        // Pathological: only one channel and it's LTC. Fall through to
        // historical behaviour so we don't silence the whole output.
        splitter.connect(merger, this.musicChannelIndex, 0)
        splitter.connect(merger, this.musicChannelIndex, 1)
      } else if (musicChannels.length === 1) {
        // Mono music — duplicate to L+R.
        splitter.connect(merger, musicChannels[0], 0)
        splitter.connect(merger, musicChannels[0], 1)
      } else {
        // Multi-channel music — first non-LTC → L, second non-LTC → R.
        splitter.connect(merger, musicChannels[0], 0)
        splitter.connect(merger, musicChannels[1], 1)
      }
    } else {
      // Historical behaviour: route only the music channel to both sides.
      splitter.connect(merger, this.musicChannelIndex, 0)
      splitter.connect(merger, this.musicChannelIndex, 1)
    }

    merger.connect(this.musicGainNode)
  }

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
    this.generatorStartFrames = tcToFrames(tcString, fps)
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
      this.ltcGainNode.gain.setTargetAtTime(this._effectiveLtcGain(), this.ltcCtx.currentTime, 0.01)
    }
  }

  /**
   * Configure the external audio input device used for LTC chase.
   *
   * Pass `null` or `''` to detach. Otherwise getUserMedia is called for
   * the given deviceId, a MediaStreamAudioSourceNode is wired into a
   * dedicated ltc-processor AudioWorklet instance, and decoded frames are
   * delivered via `onLtcInputTimecode`.
   *
   * The input context is intentionally separate from `ltcCtx` because:
   *   - The input device may use a different sample rate than the file
   *     decoder.
   *   - Routing input audio through an output-sink context can cause
   *     monitor loops on Windows.
   *   - Worklet input/output topology differs (we want numberOfOutputs=0
   *     here — no audio is emitted by this pipeline).
   *
   * Errors are surfaced via `onLtcInputError`; the method itself never
   * throws so the UI can call it freely from a select handler.
   */
  async setLtcInputDevice(deviceId: string | null, channel: 'auto' | 0 | 1 | 2 | 3 = 'auto'): Promise<void> {
    const normalised = deviceId && deviceId.length > 0 ? deviceId : null

    // Always tear down the previous pipeline first — even if the device
    // id didn't change. This makes "Re-grant permission then re-pick the
    // same device" actually re-open the stream.
    await this._teardownLtcInput()

    this.ltcInputDeviceId = normalised
    this.ltcInputChannel = channel
    if (!normalised) return

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: normalised },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      })
    } catch (e) {
      // Classify the failure so the UI can show a useful toast. DOMException
      // names are the documented mediaDevices error contract.
      const name = (e as { name?: string })?.name ?? ''
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        this.callbacks.onLtcInputError?.('permission-denied')
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        this.callbacks.onLtcInputError?.('device-missing')
      } else {
        this.callbacks.onLtcInputError?.('unknown')
      }
      this.ltcInputDeviceId = null
      return
    }

    // If a concurrent call already overrode our device while we were
    // awaiting the prompt, drop the stream we just acquired.
    if (this.ltcInputDeviceId !== normalised) {
      try { stream.getTracks().forEach(t => t.stop()) } catch { /* ignore */ }
      return
    }

    try {
      // New AudioContext — let the browser pick the rate to match the
      // input device (avoids resampling artefacts in the LTC decoder).
      this.ltcInputCtx = new AudioContext()
      // Load the LTC decoder worklet code if not already loaded for this
      // context (each new context needs its own addModule).
      this.ltcInputWorkletLoaded = false
      const blob = new Blob([ltcProcessorCode], { type: 'application/javascript' })
      const url = URL.createObjectURL(blob)
      try {
        await this.ltcInputCtx.audioWorklet.addModule(url)
        this.ltcInputWorkletLoaded = true
      } finally {
        try { URL.revokeObjectURL(url) } catch { /* ignore */ }
      }

      // Re-check ownership after the worklet load (which yields).
      if (this.ltcInputDeviceId !== normalised) {
        try { stream.getTracks().forEach(t => t.stop()) } catch { /* ignore */ }
        await this._teardownLtcInput()
        return
      }

      this.ltcInputStream = stream
      this.ltcInputSourceNode = this.ltcInputCtx.createMediaStreamSource(stream)

      // Use a channel splitter so we can pick which channel of a multi-channel
      // input device carries LTC. Splitter outputs default to 6; bump to 8 to
      // cover prosumer multi-ch interfaces. Non-existent channels just feed
      // silence — so the auto-detect path can safely subscribe to a channel
      // that may not exist on a mono device.
      const splitterChannels = 8
      this.ltcInputSplitter = this.ltcInputCtx.createChannelSplitter(splitterChannels)
      this.ltcInputSourceNode.connect(this.ltcInputSplitter)

      if (channel === 'auto') {
        // ── AUTO MODE ──────────────────────────────────────────
        // Spawn one worklet per candidate channel. The first worklet to
        // produce a decoded frame wins, and subsequent frames from any
        // other channel are dropped. We scan channels 0 and 1 — covers
        // 99% of LTC-on-stereo-cable setups; multi-channel pro
        // interfaces are rare in this use case and the operator can
        // pick the channel explicitly if needed.
        this.ltcAutoDetectedChannel = null
        this.ltcAutoScanChannels = [0, 1]
        this.ltcInputAutoWorklets = []
        for (const ch of this.ltcAutoScanChannels) {
          const worklet = new AudioWorkletNode(this.ltcInputCtx, 'ltc-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 0,
            channelCount: 1,
            channelCountMode: 'explicit',
          })
          // Capture `ch` so the onmessage handler knows which channel
          // produced this frame — used by _onLtcInputAutoFrame to
          // decide whether to lock-in or drop.
          const myCh = ch
          worklet.port.onmessage = (e): void => this._onLtcInputAutoFrame(e.data, myCh)
          const safeCh = Math.max(0, Math.min(splitterChannels - 1, ch))
          this.ltcInputSplitter.connect(worklet, safeCh, 0)
          this.ltcInputAutoWorklets.push(worklet)
        }
        // Leave `ltcInputWorkletNode` null in auto mode — the single-worklet
        // teardown helper short-circuits on null and the auto-worklet
        // array is cleaned up in _teardownLtcInput.
      } else {
        // ── EXPLICIT CHANNEL MODE (CH 0/1/2/3) ─────────────────
        // Historical single-worklet path: route exactly one channel into
        // one ltc-processor instance. Detected-channel state is reset
        // because there's nothing to "detect".
        this.ltcAutoDetectedChannel = null
        this.ltcAutoScanChannels = []
        this.ltcInputWorkletNode = new AudioWorkletNode(this.ltcInputCtx, 'ltc-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 0,
          channelCount: 1,
          channelCountMode: 'explicit',
        })
        this.ltcInputWorkletNode.port.onmessage = (e): void => this._onLtcInputFrame(e.data)
        const safeChIdx = Math.max(0, Math.min(splitterChannels - 1, channel))
        this.ltcInputSplitter.connect(this.ltcInputWorkletNode, safeChIdx, 0)
      }

      // Hook device-disconnect: if the USB cable is yanked, the MediaStream
      // ends asynchronously. We tear down + notify so the UI flips chase to
      // "no input" without crashing.
      for (const track of stream.getAudioTracks()) {
        track.onended = (): void => {
          // The track ending is authoritative — but it could fire after
          // we've already torn down for an unrelated reason. Only react if
          // this is still our active stream.
          if (this.ltcInputStream === stream) {
            this.callbacks.onLtcInputError?.('disconnected')
            this._teardownLtcInput().catch(() => { /* best-effort */ })
            this.ltcInputDeviceId = null
          }
        }
      }
    } catch (e) {
      console.warn('LTC input pipeline setup failed:', e)
      this.callbacks.onLtcInputError?.('unknown')
      try { stream.getTracks().forEach(t => t.stop()) } catch { /* ignore */ }
      await this._teardownLtcInput()
      this.ltcInputDeviceId = null
    }
  }

  /** Currently-configured LTC input device id, or null if none. */
  getLtcInputDeviceId(): string | null { return this.ltcInputDeviceId }

  /** Channel that the auto-detect pipeline locked onto, or null if no
   *  channel has produced a frame yet (or we're not in auto mode). */
  getLtcAutoDetectedChannel(): number | null { return this.ltcAutoDetectedChannel }

  /**
   * Tear down the LTC input pipeline. Idempotent — safe to call from
   * dispose() or back-to-back setLtcInputDevice() calls.
   */
  private async _teardownLtcInput(): Promise<void> {
    if (this.ltcInputWorkletNode) {
      this.ltcInputWorkletNode.port.onmessage = null
      try { this.ltcInputWorkletNode.disconnect() } catch { /* ignore */ }
      this.ltcInputWorkletNode = null
    }
    // Tear down any auto-mode parallel worklets the same way.
    for (const worklet of this.ltcInputAutoWorklets) {
      worklet.port.onmessage = null
      try { worklet.disconnect() } catch { /* ignore */ }
    }
    this.ltcInputAutoWorklets = []
    this.ltcAutoScanChannels = []
    this.ltcAutoDetectedChannel = null
    if (this.ltcInputSplitter) {
      try { this.ltcInputSplitter.disconnect() } catch { /* ignore */ }
      this.ltcInputSplitter = null
    }
    if (this.ltcInputSourceNode) {
      try { this.ltcInputSourceNode.disconnect() } catch { /* ignore */ }
      this.ltcInputSourceNode = null
    }
    if (this.ltcInputStream) {
      try { this.ltcInputStream.getTracks().forEach(t => { t.onended = null; t.stop() }) } catch { /* ignore */ }
      this.ltcInputStream = null
    }
    if (this.ltcInputCtx) {
      try { await this.ltcInputCtx.close() } catch { /* ignore */ }
      this.ltcInputCtx = null
    }
    this.ltcInputWorkletLoaded = false
  }

  /**
   * Convert a raw LTC worklet message (HH:MM:SS:FF + fps + dropFrame)
   * into a TimecodeFrame and hand it to the host. This mirrors the
   * `_onLtcFrame` shape but does NOT apply file-decode offsetFrames —
   * chase consumes the absolute external TC directly.
   */
  private _onLtcInputFrame(raw: TimecodeFrame): void {
    const fps = raw.fps
    if (!fps || fps <= 0 || !isFinite(fps)) return
    const fpsInt = Math.round(fps)
    const tc: TimecodeFrame = {
      hours: raw.hours,
      minutes: raw.minutes,
      seconds: raw.seconds,
      frames: Math.min(raw.frames, fpsInt - 1),
      fps,
      dropFrame: raw.dropFrame,
    }
    this.callbacks.onLtcInputTimecode?.(tc)
  }

  /**
   * Auto-detect handler — called when one of the parallel worklets
   * (in 'auto' mode) decodes a frame. The first channel to produce a
   * frame wins: we lock `ltcAutoDetectedChannel` to that channel and
   * fire `onLtcInputChannelDetected`. Subsequent frames from any other
   * channel are silently dropped; frames from the winning channel are
   * dispatched as if they came from the single-worklet path.
   *
   * Keeping the losing worklets connected (rather than tearing them
   * down on first detection) lets the system recover if the LTC source
   * is later replugged into a different channel — though we don't yet
   * implement re-detection in this version; if the operator wants to
   * switch channels mid-show they can re-pick the device.
   */
  private _onLtcInputAutoFrame(raw: TimecodeFrame, channel: number): void {
    const fps = raw.fps
    if (!fps || fps <= 0 || !isFinite(fps)) return
    if (this.ltcAutoDetectedChannel === null) {
      // First valid frame across all candidate channels — lock in.
      this.ltcAutoDetectedChannel = channel
      this.callbacks.onLtcInputChannelDetected?.(channel)
    } else if (this.ltcAutoDetectedChannel !== channel) {
      // Different channel after lock-in — drop.
      return
    }
    const fpsInt = Math.round(fps)
    const tc: TimecodeFrame = {
      hours: raw.hours,
      minutes: raw.minutes,
      seconds: raw.seconds,
      frames: Math.min(raw.frames, fpsInt - 1),
      fps,
      dropFrame: raw.dropFrame,
    }
    this.callbacks.onLtcInputTimecode?.(tc)
  }

  getLtcGain(): number { return this.ltcGainValue }

  setMusicVolume(linearGain: number): void {
    this.musicVolumeValue = Math.max(0, Math.min(5.7, linearGain))
    if (this.musicGainNode && this.ctx) {
      this.musicGainNode.gain.setTargetAtTime(this.musicVolumeValue, this.ctx.currentTime, 0.01)
    }
  }

  getMusicVolume(): number { return this.musicVolumeValue }

  setMusicPan(pan: number): void {
    this.musicPanValue = Math.max(-1.0, Math.min(1.0, pan))
    if (this.musicPannerNode && this.ctx) {
      this.musicPannerNode.pan.setTargetAtTime(this.musicPanValue, this.ctx.currentTime, 0.01)
    }
  }

  getMusicPan(): number { return this.musicPanValue }

  // ════════════════════════════════════════════════════════════
  // Playback control
  // ════════════════════════════════════════════════════════════

  async play(offset?: number): Promise<void> {
    if (!this.buffer) return

    const thisPlayId = ++this.playId
    this._stopPlayback()

    const startOffset = offset !== undefined ? offset : this.startOffset

    // ── Music context ──
    this.ctx = new AudioContext()
    if (this.musicOutputDeviceId && this.musicOutputDeviceId !== 'default') {
      try {
        // @ts-expect-error - setSinkId newer API
        await this.ctx.setSinkId(this.musicOutputDeviceId)
      } catch { /**/ }
    }
    if (this.playId !== thisPlayId) return

    this.musicSource = this.ctx.createBufferSource()
    this.musicSource.buffer = this.buffer
    this.musicSource.loop = this.loop

    // Create music gain + panner nodes for volume/pan control
    this.musicGainNode = this.ctx.createGain()
    this.musicGainNode.gain.value = this.musicVolumeValue
    this.musicPannerNode = this.ctx.createStereoPanner()
    this.musicPannerNode.pan.value = this.musicPanValue
    // Chain: source → gain → panner → destination
    this.musicPannerNode.connect(this.ctx.destination)
    this.musicGainNode.connect(this.musicPannerNode)

    // Wire music routing (handles generator vs LTC mode, plus the
    // mute-LTC-from-music option). Tracks splitter/merger on the engine
    // so they can be torn down on rebuild without leaking dead nodes.
    this._musicSplitter = null
    this._musicMerger = null
    this._connectMusicRouting()

    // ── LTC context — setup before scheduling so both start at the same time ──
    await this._setupLtcContext()
    if (this.playId !== thisPlayId) return

    // ── Schedule both music and LTC at the same wall-clock moment ──
    const musicWhen = this.ctx.currentTime + SCHEDULING_DELAY
    // ltcCtx has its own clock; schedule LTC at the same delay from "now"
    const ltcWhen = this.ltcCtx ? this.ltcCtx.currentTime + SCHEDULING_DELAY : undefined

    this.musicSource.start(musicWhen, startOffset)
    this.startTime = musicWhen - startOffset
    this.startOffset = startOffset
    this.playing = true

    if (this.generatorMode) {
      this._startLtcEncoder(startOffset)
    } else {
      this._startLtcSource(startOffset, ltcWhen)
    }

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

  getBuffer(): AudioBuffer | null { return this.buffer }
  getMusicChannelIndex(): number { return this.musicChannelIndex }

  async dispose(): Promise<void> {
    // Don't remove devicechange listener here — loadFile() calls dispose() to reset,
    // and the listener must persist across file loads. Removed only in forceCleanup().
    cancelAnimationFrame(this.rafId)
    // #15 fix: clear pending signal timeout before teardown to prevent stale callback
    if (this.ltcSignalTimeout) { clearTimeout(this.ltcSignalTimeout); this.ltcSignalTimeout = null }
    this._stopPlayback()
    await this._closeLtcCtx()
    // dispose() runs on every loadFile (intentional reset). The input pipeline,
    // however, follows the device-selection lifecycle — keep it alive so that
    // loading a new audio file doesn't kick the operator out of chase.
    this.buffer = null
    // Drop any cached prebuffer so it can't outlive the engine session
    this.prebufferedBuffer = null
    this.prebufferedToken = null
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
    // All nodes belong to the closed context — must clear references
    this.ltcWorkletNode = null
    this.ltcGainNode = null
    this.ltcEncoderNode = null
    this.ltcSource = null
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
    // LTC input — sync best-effort teardown. Async _teardownLtcInput would
    // race the process exit; here we just yank everything.
    if (this.ltcInputWorkletNode) {
      this.ltcInputWorkletNode.port.onmessage = null
      try { this.ltcInputWorkletNode.disconnect() } catch { /* ignore */ }
      this.ltcInputWorkletNode = null
    }
    for (const worklet of this.ltcInputAutoWorklets) {
      worklet.port.onmessage = null
      try { worklet.disconnect() } catch { /* ignore */ }
    }
    this.ltcInputAutoWorklets = []
    this.ltcAutoScanChannels = []
    this.ltcAutoDetectedChannel = null
    if (this.ltcInputSplitter) { try { this.ltcInputSplitter.disconnect() } catch { /* ignore */ } this.ltcInputSplitter = null }
    if (this.ltcInputSourceNode) { try { this.ltcInputSourceNode.disconnect() } catch { /* ignore */ } this.ltcInputSourceNode = null }
    if (this.ltcInputStream) { try { this.ltcInputStream.getTracks().forEach(t => { t.onended = null; t.stop() }) } catch { /* ignore */ } this.ltcInputStream = null }
    if (this.ltcInputCtx) { try { this.ltcInputCtx.close() } catch { /* ignore */ } this.ltcInputCtx = null }
    this.musicGainNode = null
    this.musicPannerNode = null
    this.ltcWorkletReady = false
    this.ltcEncoderReady = false
    this.ltcInputWorkletLoaded = false
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
      this._attachLtcStateMonitor()

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

      // LTC device warmed up successfully
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

    // Create new context — old nodes are invalid, must clear them
    this.ltcCtx = new AudioContext()
    this._attachLtcStateMonitor()
    this.ltcWorkletReady = false
    this.ltcWorkletNode = null
    this.ltcGainNode = null
    this.ltcEncoderNode = null

    // Set output sink:
    //   'default' (muted) → { type: 'none' } = worklet runs, no audio output
    //   deviceId           → setSinkId(id)   = audio routes to that device
    //
    // Safety rule: LTC must never leak to default monitor speakers. If the
    // configured device fails (disconnected, invalid id, driver issue) we
    // ALWAYS fall back to the silent sink rather than letting LTC buzz
    // through the user's monitors.
    try {
      if (this.ltcOutputDeviceId && this.ltcOutputDeviceId !== 'default') {
        // @ts-expect-error - setSinkId newer API
        await this.ltcCtx.setSinkId(this.ltcOutputDeviceId)
      } else {
        // @ts-expect-error - setSinkId with null sink
        await this.ltcCtx.setSinkId({ type: 'none' })
      }
    } catch (e) {
      console.warn('LTC setSinkId failed, falling back to silent sink:', e)
      try {
        // @ts-expect-error - setSinkId with null sink
        await this.ltcCtx.setSinkId({ type: 'none' })
      } catch (e2) {
        console.warn('LTC silent-sink fallback also failed:', e2)
      }
    }

    // Load worklet modules (decoder + encoder) with retry
    this.ltcWorkletReady = await this._loadWorklet(ltcProcessorCode, 'LTC decoder')
    this.ltcEncoderReady = await this._loadWorklet(ltcEncoderCode, 'LTC encoder')

    // Notify UI if critical worklet failed
    if (!this.ltcWorkletReady) this.callbacks.onLtcError?.('worklet')
    if (!this.ltcEncoderReady && this.generatorMode) this.callbacks.onLtcError?.('encoder')
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
   * Attach onstatechange listener to ltcCtx.
   * Auto-resumes if the USB audio device gets suspended (e.g. USB disconnect/reconnect).
   * Notifies UI via onLtcError so the user can see the device went away.
   */
  private _attachLtcStateMonitor(): void {
    if (!this.ltcCtx) return
    this.ltcCtx.onstatechange = () => {
      if (!this.ltcCtx) return
      if (this.ltcCtx.state === 'suspended' && this.playing) {
        // Attempt automatic recovery first
        this.ltcCtx.resume().catch(() => {
          // Resume failed — device is likely gone; notify UI
          this.callbacks.onLtcError?.('device-suspended')
        })
      } else if (this.ltcCtx.state === 'closed') {
        this.callbacks.onLtcError?.('device-suspended')
      }
    }
  }

  /**
   * Start LTC source and connect audio nodes.
   * Reuses existing worklet node and gain if available (from previous play cycle).
   * Must be called AFTER _setupLtcContext().
   *
   * @param offset - playback start position in seconds
   * @param syncWhen - optional: schedule start at this ltcCtx time to sync with music
   */
  private _startLtcSource(offset: number, syncWhen?: number): void {
    if (!this.ltcCtx || !this.buffer) return

    this.ltcSource = this.ltcCtx.createBufferSource()
    this.ltcSource.buffer = this.buffer
    this.ltcSource.loop = this.loop

    // Disconnect previous nodes before creating new ones (prevents leak)
    try { this.ltcSplitter?.disconnect() } catch { /* ignore */ }
    try { this.ltcMerger?.disconnect() } catch { /* ignore */ }
    const splitter = this.ltcCtx.createChannelSplitter(this.buffer.numberOfChannels)
    this.ltcSplitter = splitter
    this.ltcSource.connect(splitter)

    // Reuse existing worklet node if available (keeps decoder clock calibrated)
    if (!this.ltcWorkletNode && this.ltcWorkletReady) {
      try {
        this.ltcWorkletNode = new AudioWorkletNode(this.ltcCtx, 'ltc-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 0,
          channelCount: 1
        })
        this.ltcWorkletNode.port.onmessage = (e) => this._onLtcFrame(e.data)
      } catch (e) {
        console.warn('LTC worklet creation failed:', e)
        this.callbacks.onLtcError?.('worklet')
      }
    }
    if (this.ltcWorkletNode) {
      splitter.connect(this.ltcWorkletNode, this.ltcChannelIndex)
    }

    // Reuse gain node if available, otherwise create new
    if (!this.ltcGainNode) {
      this.ltcGainNode = this.ltcCtx.createGain()
      this.ltcGainNode.connect(this.ltcCtx.destination)
    }

    // Audio output: splitter → merger (mono→stereo) → gain → destination
    const merger = this.ltcCtx.createChannelMerger(2)
    this.ltcMerger = merger
    splitter.connect(merger, this.ltcChannelIndex, 0)
    splitter.connect(merger, this.ltcChannelIndex, 1)
    merger.connect(this.ltcGainNode)

    // Schedule start — use syncWhen if provided for music/LTC alignment
    const when = syncWhen ?? (this.ltcCtx.currentTime + SCHEDULING_DELAY)
    this.ltcStartupDeadline = when

    // Pause/resume: no mute. Seek: brief 50ms mute.
    const isResume = Math.abs(offset - this.ltcLastStopOffset) < 0.5
    const effectiveGain = this._effectiveLtcGain()
    if (isResume) {
      this.ltcGainNode.gain.value = effectiveGain
    } else {
      this.ltcGainNode.gain.setValueAtTime(0, this.ltcCtx.currentTime)
      this.ltcGainNode.gain.setValueAtTime(effectiveGain, when + 0.05)
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

      // Reuse gain node if available
      if (!this.ltcGainNode) {
        this.ltcGainNode = this.ltcCtx.createGain()
        this.ltcGainNode.connect(this.ltcCtx.destination)
      }

      const when = this.ltcCtx.currentTime + SCHEDULING_DELAY
      const isResume = Math.abs(offset - this.ltcLastStopOffset) < 0.5
      const effectiveGain = this._effectiveLtcGain()
      if (isResume) {
        this.ltcGainNode.gain.value = effectiveGain
      } else {
        this.ltcGainNode.gain.setValueAtTime(0, this.ltcCtx.currentTime)
        this.ltcGainNode.gain.setValueAtTime(effectiveGain, when + 0.05)
      }

      this.ltcEncoderNode.connect(this.ltcGainNode)

      const startFrameNumber = this.generatorStartFrames + Math.floor(offset * this.generatorFps)
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
   * Stop LTC source only — keep worklet node and gain alive for instant resume.
   * The decoder worklet keeps its clock calibration across pause/play cycles.
   */
  private _stopLtcSource(): void {
    if (this.ltcSource) { try { this.ltcSource.stop() } catch { /**/ } this.ltcSource = null }
    // Disconnect worklet input (source is gone) but keep the node alive
    if (this.ltcWorkletNode) { try { this.ltcWorkletNode.disconnect() } catch { /**/ } }
    if (this.ltcEncoderNode) {
      try { this.ltcEncoderNode.port.postMessage({ type: 'stop' }) } catch { /**/ }
      try { this.ltcEncoderNode.disconnect() } catch { /**/ }
      this.ltcEncoderNode = null
    }
    // Disconnect splitter/merger so they are GC'd rather than accumulating
    // dead fan-in on the persistent gain node across pause/resume cycles
    if (this.ltcSplitter) { try { this.ltcSplitter.disconnect() } catch { /**/ } this.ltcSplitter = null }
    if (this.ltcMerger) { try { this.ltcMerger.disconnect() } catch { /**/ } this.ltcMerger = null }
  }

  /**
   * Full teardown — destroy all LTC nodes (for device change, file load, shutdown).
   */
  private _teardownLtcNodes(): void {
    this._stopLtcSource()
    if (this.ltcWorkletNode) { this.ltcWorkletNode.port.onmessage = null; try { this.ltcWorkletNode.disconnect() } catch { /**/ } this.ltcWorkletNode = null }
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
    // Music gain/panner belong to the closed ctx — clear references
    this.musicGainNode = null
    this.musicPannerNode = null
    this._musicSplitter = null
    this._musicMerger = null

    // Stop LTC source only — keep worklet + gain alive for instant resume
    this._stopLtcSource()
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

    const isDropFrame = this.forceFpsValue !== null
      ? this.forceFpsValue === 29.97
      : raw.dropFrame
    const fpsInt = Math.round(fps)

    // Convert raw HH:MM:SS:FF → frame count → apply offset → convert back
    // Uses shared timecodeConvert module (single source of truth for DF math)
    const tcStr = [raw.hours, raw.minutes, raw.seconds, raw.frames]
      .map(n => String(n).padStart(2, '0')).join(isDropFrame ? ';' : ':')
    let totalFrames = tcToFrames(tcStr, fps) + this.offsetFrames
    totalFrames = Math.max(0, totalFrames)

    const { h, m, s, f } = framesToTc(totalFrames, fps)

    const tc: TimecodeFrame = {
      hours: h,
      minutes: m,
      seconds: s,
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

    const { h, m, s, f } = framesToTc(totalFrames, fps)

    const tc: TimecodeFrame = {
      hours: h,
      minutes: m,
      seconds: s,
      frames: f,
      fps,
      dropFrame: Math.abs(fps - 29.97) < 0.01
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
