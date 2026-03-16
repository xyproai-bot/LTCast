import { TimecodeFrame } from '../store'

/**
 * Art-Net Timecode output — sends OpTimeCode packets via UDP broadcast.
 * Uses main-process dgram socket via IPC for network access.
 */
export class ArtNetOutput {
  private enabled = false
  private targetIp = '255.255.255.255'
  private lastSentFrame = -1  // deduplicate: only send once per unique frame

  async start(targetIp?: string): Promise<void> {
    if (targetIp) this.targetIp = targetIp
    await window.api.artnetStart()
    this.enabled = true
    this.lastSentFrame = -1
  }

  async stop(): Promise<void> {
    this.enabled = false
    this.lastSentFrame = -1
    await window.api.artnetStop()
  }

  setTargetIp(ip: string): void {
    this.targetIp = ip || '255.255.255.255'
  }

  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Send Art-Net Timecode packet. Called once per frame from the timecode callback.
   * De-duplicates to avoid flooding the network with identical frames.
   */
  sendTimecode(tc: TimecodeFrame): void {
    if (!this.enabled) return

    // Build a unique key from the TC values to deduplicate
    const key = (tc.hours << 24) | (tc.minutes << 16) | (tc.seconds << 8) | tc.frames
    if (key === this.lastSentFrame) return
    this.lastSentFrame = key

    // Fire-and-forget via ipcRenderer.send (not invoke) for minimal latency
    window.api.artnetSendTc(
      tc.hours, tc.minutes, tc.seconds, tc.frames,
      tc.fps, this.targetIp
    )
  }
}
