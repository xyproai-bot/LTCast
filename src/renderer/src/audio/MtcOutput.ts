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
    return true
  }

  deselectPort(): void {
    this.selectedOutput = null
    this.lastSentFrame = -1
    this.lastQfPiece = -1
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
   * #4 fix: MIDI spec requires 8 quarter-frame pieces over 2 frames,
   * meaning 4 pieces per frame. Each piece is spaced at 1/4 frame intervals
   * using scheduled MIDI timestamps for precise timing.
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

    // Map AudioContext time → performance.now() coordinate
    const basePerfTime = this._perfNowAtPlayStart +
      Math.max(0, audioContextCurrentTime - this._audioTimeAtPlayStart) * 1000

    // Send 4 pieces per frame, scheduled at quarter-frame intervals
    try {
      for (let i = 0; i < 4; i++) {
        this.lastQfPiece = (this.lastQfPiece + 1) % 8
        const piece = this.lastQfPiece
        const timestamp = basePerfTime + i * qfIntervalMs
        this.selectedOutput!.send([0xf1, (piece << 4) | nibbles[piece]], timestamp)
      }
    } catch {
      const name = this.selectedOutput?.name ?? 'Unknown'
      this.selectedOutput = null
      this.lastSentFrame = -1
      this.lastQfPiece = -1
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
