import { TimecodeFrame } from '../store'

export interface MtcPort {
  id: string
  name: string
}

export type MtcMode = 'quarter-frame' | 'full-frame'

function fpsToRateCode(fps: number): number {
  if (Math.abs(fps - 24) < 0.1) return 0
  if (Math.abs(fps - 25) < 0.1) return 1
  if (Math.abs(fps - 29.97) < 0.1) return 2
  return 3
}

export class MtcOutput {
  private midiAccess: MIDIAccess | null = null
  private selectedOutput: MIDIOutput | null = null
  private cueOutput: MIDIOutput | null = null
  private lastSentFrame = -1
  private mtcMode: MtcMode = 'quarter-frame'
  private lastQfPiece = -1  // tracks which quarter-frame piece (0-7) was last sent
  private _perfNowAtPlayStart = 0
  private _audioTimeAtPlayStart = 0
  private _lastQfTimestamp = 0  // chained timestamp of the last QF sent (ms, performance.now() scale)
  onPortsChanged: (() => void) | null = null
  onPortDisconnected: ((portName: string) => void) | null = null

  async init(): Promise<void> {
    if (!navigator.requestMIDIAccess) throw new Error('Web MIDI API not supported')
    this.midiAccess = await navigator.requestMIDIAccess({ sysex: true })
    this.midiAccess.onstatechange = (e: MIDIConnectionEvent) => {
      const port = e.port
      // If the disconnected port is the one we're using, notify
      if (port && port.state === 'disconnected' && this.selectedOutput?.id === port.id) {
        const name = this.selectedOutput.name || port.id
        this.selectedOutput = null
        this.lastSentFrame = -1
        this.lastQfPiece = -1
        this.onPortDisconnected?.(name)
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
      this.cueOutput.send([0x90 | ch, note & 0x7F, velocity & 0x7F])
      // Auto Note Off after 100ms
      setTimeout(() => {
        try { this.cueOutput?.send([0x80 | ch, note & 0x7F, 0]) } catch { /* ignore */ }
      }, 100)
    } catch { /* port may have gone away */ }
  }

  sendControlChange(channel: number, cc: number, value: number): void {
    if (!this.cueOutput) return
    try {
      this.cueOutput.send([0xB0 | ((channel - 1) & 0x0F), cc & 0x7F, value & 0x7F])
    } catch { /* port may have gone away */ }
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

    // Send 4 pieces, each chained exactly qfIntervalMs from the previous.
    // JS event-loop jitter does NOT affect spacing — only the absolute position.
    try {
      for (let i = 0; i < 4; i++) {
        this._lastQfTimestamp += qfIntervalMs
        this.lastQfPiece = (this.lastQfPiece + 1) % 8
        const piece = this.lastQfPiece
        this.selectedOutput!.send([0xf1, (piece << 4) | nibbles[piece]], this._lastQfTimestamp)
      }
    } catch {
      const name = this.selectedOutput?.name ?? 'Unknown'
      this.selectedOutput = null
      this.lastSentFrame = -1
      this.lastQfPiece = -1
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
