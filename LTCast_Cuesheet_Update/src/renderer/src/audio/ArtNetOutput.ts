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

  private isValidIp(ip: string): boolean {
    const parts = ip.split('.')
    if (parts.length !== 4) return false
    return parts.every(p => { const n = Number(p); return p !== '' && Number.isInteger(n) && n >= 0 && n <= 255 })
  }

  setTargetIp(ip: string): void {
    // Only update if the IP is valid — ignore partial input while the user is still typing
    if (this.isValidIp(ip)) this.targetIp = ip
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
