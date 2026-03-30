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
   * Send 8 quarter-frame MTC messages for the given timecode.
   *
   * Quarter-frame format: [0xF1, (pieceType << 4) | nibble]
   * A complete timecode is transmitted over 2 frames (8 messages).
   * Pieces 0-3 are sent on the first frame, pieces 4-7 on the next.
   *
   * Per MIDI spec, we cycle through pieces 0→7 sequentially.
   * Each call to sendTimecode sends 1 piece (not all 8 at once),
   * advancing the piece counter. This means the receiver gets
   * a complete timecode update every 8 frame changes.
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

    // Advance to next piece (0-7 cycle)
    this.lastQfPiece = (this.lastQfPiece + 1) % 8
    const piece = this.lastQfPiece

    // Map AudioContext time → performance.now() coordinate for scheduled send
    // Clamp to 0 to avoid negative timestamps (Web MIDI rejects them)
    const perfTime = this._perfNowAtPlayStart +
      Math.max(0, audioContextCurrentTime - this._audioTimeAtPlayStart) * 1000

    try {
      this.selectedOutput.send([0xf1, (piece << 4) | nibbles[piece]], perfTime)
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
