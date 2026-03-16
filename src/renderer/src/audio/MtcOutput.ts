import { TimecodeFrame } from '../store'

export interface MtcPort {
  id: string
  name: string
}

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
  onPortsChanged: (() => void) | null = null

  async init(): Promise<void> {
    if (!navigator.requestMIDIAccess) throw new Error('Web MIDI API not supported')
    this.midiAccess = await navigator.requestMIDIAccess({ sysex: true })
    this.midiAccess.onstatechange = () => this.onPortsChanged?.()
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
    return true
  }

  deselectPort(): void {
    this.selectedOutput = null
    this.lastSentFrame = -1
  }

  isConnected(): boolean {
    return this.selectedOutput !== null
  }

  /**
   * Send MTC full-frame SysEx for continuous position updates.
   *
   * Quarter-frame messages require precise 1/4-frame timing intervals
   * which cannot be reliably achieved from requestAnimationFrame callbacks.
   * Full-frame SysEx is the correct approach for position updates — it sends
   * the complete timecode in a single message and is widely supported by
   * receiving software (Resolume Arena, QLab, etc.).
   *
   * De-duplicated: only sends when the frame actually changes.
   */
  sendTimecode(tc: TimecodeFrame): void {
    if (!this.selectedOutput) return

    // Compute a unique frame key to avoid sending duplicate messages
    const frameKey = (tc.hours << 24) | (tc.minutes << 16) | (tc.seconds << 8) | tc.frames
    if (frameKey === this.lastSentFrame) return
    this.lastSentFrame = frameKey

    this.sendFullFrame(tc)
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
      // Device may have been disconnected — deselect to prevent repeated errors
      this.selectedOutput = null
      this.lastSentFrame = -1
    }
  }
}
