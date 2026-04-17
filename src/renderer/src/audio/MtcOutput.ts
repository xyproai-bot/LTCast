import { TimecodeFrame } from '../store'

export interface MtcPort {
  id: string
  name: string
}

export type MtcMode = 'quarter-frame' | 'full-frame'

// Exported for unit tests. 0.01 tolerance — NOT 0.1, because |30 - 29.97| = 0.03
// would then wrongly match the 29.97 branch and make 30 ND display as 30 DF
// on the receiver. Matches AudioEngine's dropFrame detection threshold.
export function fpsToRateCode(fps: number): number {
  if (Math.abs(fps - 24) < 0.01) return 0
  if (Math.abs(fps - 25) < 0.01) return 1
  if (Math.abs(fps - 29.97) < 0.01) return 2  // drop-frame
  return 3  // 30 non-drop
}

export type MidiClockSource = 'detected' | 'tapped' | 'manual'

export class MtcOutput {
  private midiAccess: MIDIAccess | null = null
  private selectedOutput: MIDIOutput | null = null
  private cueOutput: MIDIOutput | null = null
  private lastSentFrame = -1
  private mtcMode: MtcMode = 'quarter-frame'
  private lastQfPiece = -1  // tracks which quarter-frame piece (0-7) was last sent
  private _qfNibbleCache: number[] | null = null  // MTC spec: all 8 pieces encode the TC at piece 0's moment — cached to avoid mid-cycle TC drift
  private _perfNowAtPlayStart = 0
  private _audioTimeAtPlayStart = 0
  private _lastQfTimestamp = 0  // chained timestamp of the last QF sent (ms, performance.now() scale)
  onPortsChanged: (() => void) | null = null
  onPortDisconnected: ((portName: string) => void) | null = null

  // ── MIDI Clock state ──────────────────────────────────────
  private _clockRunning = false
  private _clockBpm = 0
  private _clockTimerId: ReturnType<typeof setTimeout> | null = null
  private _lastClockTimestamp = 0  // chained timestamp (ms, performance.now() scale)

  async init(): Promise<void> {
    if (!navigator.requestMIDIAccess) throw new Error('Web MIDI API not supported')
    this.midiAccess = await navigator.requestMIDIAccess({ sysex: true })
    this.midiAccess.onstatechange = (e: MIDIConnectionEvent) => {
      const port = e.port
      // If the disconnected port is the one we're using, notify
      if (port && port.state === 'disconnected' && this.selectedOutput?.id === port.id) {
        if (this._clockRunning) this.stopClock()
        const name = this.selectedOutput.name || port.id
        this.selectedOutput = null
        this.lastSentFrame = -1
        this.lastQfPiece = -1
        this._qfNibbleCache = null
        this.onPortDisconnected?.(name)
      }
      // Also handle cue port disconnect (previously unchecked)
      if (port && port.state === 'disconnected' && this.cueOutput?.id === port.id) {
        this.cueOutput = null
      }
      this.onPortsChanged?.()
    }
  }

  getPorts(): MtcPort[] {
    if (!this.midiAccess) return []
    const ports: MtcPort[] = []
    this.midiAccess.outputs.forEach((out) => {
      ports.push({ id: out.id, name: out.name || out.id })
    })
    return ports
  }

  selectPort(id: string): boolean {
    if (!this.midiAccess) return false
    const out = this.midiAccess.outputs.get(id)
    if (!out) return false
    this.selectedOutput = out
    this.lastSentFrame = -1
    this.lastQfPiece = -1
    this._lastQfTimestamp = 0
    return true
  }

  deselectPort(): void {
    if (this._clockRunning) this.stopClock()
    this.selectedOutput = null
    this.lastSentFrame = -1
    this.lastQfPiece = -1
    this._lastQfTimestamp = 0
  }

  // ── Cue output port (separate from MTC port) ───────────────

  selectCuePort(id: string): boolean {
    if (!this.midiAccess) return false
    const out = this.midiAccess.outputs.get(id)
    if (!out) return false
    this.cueOutput = out
    return true
  }

  deselectCuePort(): void {
    this.cueOutput = null
  }

  getCuePortId(): string | null {
    return this.cueOutput?.id ?? null
  }

  isCueConnected(): boolean {
    return this.cueOutput !== null
  }

  // ── Cue MIDI send methods ──────────────────────────────────

  sendProgramChange(channel: number, program: number): void {
    if (!this.cueOutput) return
    try {
      this.cueOutput.send([0xC0 | ((channel - 1) & 0x0F), program & 0x7F])
    } catch { /* port may have gone away */ }
  }

  sendNoteOn(channel: number, note: number, velocity: number): void {
    if (!this.cueOutput) return
    try {
      const ch = (channel - 1) & 0x0F
      // Capture port reference at send time — if cueOutput is reassigned before
      // the auto-note-off fires, the closure should still target the original
      // port (otherwise the original device keeps a stuck note)
      const port = this.cueOutput
      port.send([0x90 | ch, note & 0x7F, velocity & 0x7F])
      setTimeout(() => {
        try { port.send([0x80 | ch, note & 0x7F, 0]) } catch { /* ignore */ }
      }, 100)
    } catch { /* port may have gone away */ }
  }

  sendControlChange(channel: number, cc: number, value: number): void {
    if (!this.cueOutput) return
    try {
      this.cueOutput.send([0xB0 | ((channel - 1) & 0x0F), cc & 0x7F, value & 0x7F])
    } catch { /* port may have gone away */ }
  }

  /**
   * Send MIDI CC on BOTH the MTC port and cue port (if connected).
   * Used for PANIC — ensures All Notes Off reaches every downstream device
   * regardless of which port the user routed to.
   */
  sendControlChangeBroadcast(channel: number, cc: number, value: number): void {
    const data = [0xB0 | ((channel - 1) & 0x0F), cc & 0x7F, value & 0x7F]
    try { this.selectedOutput?.send(data) } catch { /* port gone */ }
    try { this.cueOutput?.send(data) } catch { /* port gone */ }
  }

  // ── MIDI Clock Output (24 PPQ) ─────────────────────────────

  /**
   * Start sending MIDI Clock.
   * Sends 0xFA (Start), then begins 0xF8 ticks at 24 PPQ.
   * Uses chained timestamps for jitter-free spacing (same strategy as MTC QF).
   */
  startClock(bpm: number): void {
    if (!this.selectedOutput || bpm <= 0) return
    if (this._clockRunning) this.stopClock()
    this._clockBpm = bpm
    this._clockRunning = true
    // Send MIDI Start (0xFA)
    try { this.selectedOutput.send([0xfa]) } catch { /* port gone */ }
    this._lastClockTimestamp = performance.now()
    this._scheduleClockBatch()
  }

  /**
   * Stop sending MIDI Clock.
   * Sends 0xFC (Stop), cancels pending ticks, and attempts to clear the
   * Web MIDI output queue so orphan ticks scheduled with future timestamps
   * don't fire AFTER 0xFC (which would cause downstream devices to lose sync
   * on rapid stop→start cycles).
   */
  stopClock(): void {
    this._clockRunning = false
    if (this._clockTimerId !== null) {
      clearTimeout(this._clockTimerId)
      this._clockTimerId = null
    }
    if (!this.selectedOutput) return
    // Cancel any pending scheduled ticks (Chrome 87+ supports clear())
    try {
      (this.selectedOutput as unknown as { clear?: () => void }).clear?.()
    } catch { /* older browsers / polyfill gap */ }
    try { this.selectedOutput.send([0xfc]) } catch { /* port gone */ }
  }

  /**
   * Update clock BPM on the fly without interrupting the tick stream.
   * The new interval takes effect on the next scheduling batch.
   */
  updateClockBpm(bpm: number): void {
    if (bpm <= 0) {
      this.stopClock()
      return
    }
    this._clockBpm = bpm
  }

  isClockRunning(): boolean { return this._clockRunning }
  getClockBpm(): number { return this._clockBpm }

  /**
   * Schedule a batch of 24 MIDI Clock ticks (one beat) using Web MIDI timestamps.
   * Each tick is chained from the previous one's timestamp, so JS event-loop
   * jitter does not affect tick spacing — only the absolute position.
   * After sending 24 ticks, schedules the next batch near the end of this beat.
   */
  private _scheduleClockBatch(): void {
    if (!this._clockRunning || !this.selectedOutput || this._clockBpm <= 0) return

    const tickIntervalMs = 60000 / (this._clockBpm * 24)
    const TICKS_PER_BATCH = 24  // one beat

    try {
      for (let i = 0; i < TICKS_PER_BATCH; i++) {
        this._lastClockTimestamp += tickIntervalMs
        this.selectedOutput!.send([0xf8], this._lastClockTimestamp)
      }
    } catch {
      // Port disconnected — stop clock
      this._clockRunning = false
      return
    }

    // Schedule next batch slightly before the last tick fires.
    // beatDurationMs = 24 * tickIntervalMs, but we wake up ~80% through
    // to avoid missing the window while keeping batches smooth.
    const beatMs = TICKS_PER_BATCH * tickIntervalMs
    const wakeupMs = Math.max(1, beatMs * 0.8)
    this._clockTimerId = setTimeout(() => {
      this._clockTimerId = null
      this._scheduleClockBatch()
    }, wakeupMs)
  }

  isConnected(): boolean {
    return this.selectedOutput !== null
  }

  setMode(mode: MtcMode): void {
    this.mtcMode = mode
    this.lastQfPiece = -1
    this._lastQfTimestamp = 0
  }

  getMode(): MtcMode {
    return this.mtcMode
  }

  /**
   * Record clock mapping baseline so quarter-frame messages can be
   * scheduled precisely via Web MIDI's `send(data, timestamp)`.
   * Call this from AudioEngine.play() right after musicSource.start().
   */
  setPlayStartClocks(perfNow: number, audioTime: number): void {
    this._perfNowAtPlayStart = perfNow
    this._audioTimeAtPlayStart = audioTime
    this._lastQfTimestamp = perfNow  // prime chain at play start
    this.lastSentFrame = -1
    this.lastQfPiece = -1
  }

  /**
   * Send MTC timecode based on current mode.
   * - quarter-frame: sends 8 quarter-frame messages per 2 frames (continuous sync)
   * - full-frame: sends SysEx on each frame change (legacy/locate)
   *
   * De-duplicated: only sends when the frame actually changes.
   */
  sendTimecode(tc: TimecodeFrame, audioContextCurrentTime: number): void {
    if (!this.selectedOutput) return

    const frameKey = (tc.hours << 24) | (tc.minutes << 16) | (tc.seconds << 8) | tc.frames
    if (frameKey === this.lastSentFrame) return
    this.lastSentFrame = frameKey

    if (this.mtcMode === 'quarter-frame') {
      this.sendQuarterFrames(tc, audioContextCurrentTime)
    } else {
      this.sendFullFrame(tc)
    }
  }

  /**
   * Send 4 quarter-frame MTC messages per frame change.
   *
   * MIDI spec requires 8 QF pieces over 2 frames (4 per frame), evenly spaced
   * at 1/4 frame intervals using Web MIDI scheduled timestamps.
   *
   * Key improvement over naive implementation: timestamps are CHAINED from the
   * previous QF rather than re-derived from AudioContext on every call.
   * This means JS event-loop delays do not shift QF spacing — the MIDI driver
   * sees perfectly uniform 1/4-frame intervals regardless of JS jitter.
   *
   * Drift guard: if the chain drifts more than one full frame from the
   * AudioContext anchor (e.g. after a seek or long pause), it re-anchors
   * silently without causing a burst of out-of-order messages.
   *
   * Quarter-frame format: [0xF1, (pieceType << 4) | nibble]
   * Pieces cycle 0→7 continuously. Complete TC update every 2 frames.
   */
  private sendQuarterFrames(tc: TimecodeFrame, audioContextCurrentTime: number): void {
    if (!this.selectedOutput) return

    const rc = fpsToRateCode(tc.fps)

    // Build the 8 nibble values for the current timecode
    const nibbles = [
      tc.frames & 0x0f,                          // 0: frame units
      (tc.frames >> 4) & 0x01,                    // 1: frame tens
      tc.seconds & 0x0f,                          // 2: seconds units
      (tc.seconds >> 4) & 0x07,                   // 3: seconds tens
      tc.minutes & 0x0f,                          // 4: minutes units
      (tc.minutes >> 4) & 0x07,                   // 5: minutes tens
      tc.hours & 0x0f,                            // 6: hours units
      (rc << 1) | ((tc.hours >> 4) & 0x01)        // 7: rate + hours tens
    ]

    // Quarter-frame interval in ms (1/4 of one frame duration)
    const qfIntervalMs = 1000 / (tc.fps * 4)

    // AudioContext → performance.now() anchor (single mapping, accumulated drift is tiny)
    const anchorPerfTime = this._perfNowAtPlayStart +
      Math.max(0, audioContextCurrentTime - this._audioTimeAtPlayStart) * 1000

    // First send after play start: init chain at anchor
    if (this._lastQfTimestamp === 0) {
      this._lastQfTimestamp = anchorPerfTime
    }

    // Drift guard: if chain is > 1 frame ahead or behind the anchor, re-anchor.
    // This handles seeks and long pauses without breaking continuous QF spacing.
    const driftMs = this._lastQfTimestamp - anchorPerfTime
    const frameMs = 1000 / tc.fps
    if (driftMs > frameMs || driftMs < -frameMs) {
      this._lastQfTimestamp = anchorPerfTime
    }

    // Guard against scheduling in the past after GC or long main-thread stall:
    // Chrome silently drops past timestamps, which would cause piece gaps
    const nowPerf = performance.now()
    if (this._lastQfTimestamp < nowPerf) {
      this._lastQfTimestamp = nowPerf + 1
    }

    // Send 4 pieces, each chained exactly qfIntervalMs from the previous.
    // MTC spec: ALL 8 pieces in a cycle must encode the TC at piece 0's moment
    // (receiver reconstructs TC upon receiving piece 7, compensating for the 2-frame
    // transmission delay). If we used the current TC for every call, pieces 4-7 would
    // encode N+1's value while receiver expects N's → 2-frame display offset.
    // Fix: cache nibbles when piece 0 is emitted, reuse for pieces 1-7.
    try {
      for (let i = 0; i < 4; i++) {
        this._lastQfTimestamp += qfIntervalMs
        this.lastQfPiece = (this.lastQfPiece + 1) % 8
        const piece = this.lastQfPiece
        if (piece === 0 || this._qfNibbleCache === null) {
          this._qfNibbleCache = nibbles
        }
        this.selectedOutput!.send([0xf1, (piece << 4) | this._qfNibbleCache[piece]], this._lastQfTimestamp)
      }
    } catch {
      const name = this.selectedOutput?.name ?? 'Unknown'
      this.selectedOutput = null
      this.lastSentFrame = -1
      this.lastQfPiece = -1
      this._qfNibbleCache = null
      this._lastQfTimestamp = 0
      this.onPortDisconnected?.(name)
    }
  }

  /** Send a full-frame MTC SysEx message (F0 7F 7F 01 01 hh mm ss ff F7) */
  sendFullFrame(tc: TimecodeFrame): void {
    if (!this.selectedOutput) return
    try {
      const rc = fpsToRateCode(tc.fps)
      const hh = (rc << 5) | (tc.hours & 0x1f)
      this.selectedOutput.send([
        0xf0, 0x7f, 0x7f, 0x01, 0x01,
        hh, tc.minutes & 0x3f, tc.seconds & 0x3f, tc.frames & 0x1f,
        0xf7
      ])
    } catch {
      const name = this.selectedOutput?.name ?? 'Unknown'
      this.selectedOutput = null
      this.lastSentFrame = -1
      this.lastQfPiece = -1
      this.onPortDisconnected?.(name)
    }
  }
}
