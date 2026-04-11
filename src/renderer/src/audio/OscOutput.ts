import { TimecodeFrame } from '../store'

/**
 * OSC Output — sends timecode and transport state via OSC/UDP.
 * Uses main-process dgram socket via IPC for network access.
 */
export class OscOutput {
  private enabled = false
  private targetIp = '127.0.0.1'
  private targetPort = 8000
  private lastSentFrame = -1  // deduplicate: only send once per unique frame

  async start(targetIp?: string, targetPort?: number): Promise<void> {
    if (targetIp) this.targetIp = targetIp
    if (targetPort !== undefined) this.targetPort = targetPort
    await window.api.oscStart()
    this.enabled = true
    this.lastSentFrame = -1
  }

  async stop(): Promise<void> {
    this.enabled = false
    this.lastSentFrame = -1
    await window.api.oscStop()
  }

  private isValidIp(ip: string): boolean {
    const parts = ip.split('.')
    if (parts.length !== 4) return false
    return parts.every(p => { const n = Number(p); return p !== '' && Number.isInteger(n) && n >= 0 && n <= 255 })
  }

  setTargetIp(ip: string): void {
    if (this.isValidIp(ip)) this.targetIp = ip
  }

  setTargetPort(port: number): void {
    if (Number.isInteger(port) && port > 0 && port <= 65535) this.targetPort = port
  }

  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Send OSC timecode message. Called once per frame from the timecode callback.
   * De-duplicates to avoid flooding the network with identical frames.
   */
  sendTimecode(tc: TimecodeFrame): void {
    if (!this.enabled) return

    const key = (tc.hours << 24) | (tc.minutes << 16) | (tc.seconds << 8) | tc.frames
    if (key === this.lastSentFrame) return
    this.lastSentFrame = key

    window.api.oscSendTc(
      tc.hours, tc.minutes, tc.seconds, tc.frames,
      Math.round(tc.fps), this.targetIp, this.targetPort
    )
  }

  sendTransport(state: 'play' | 'pause' | 'stop'): void {
    if (!this.enabled) return
    window.api.oscSendTransport(state, this.targetIp, this.targetPort)
  }

  sendSong(name: string, index: number): void {
    if (!this.enabled) return
    window.api.oscSendSong(name, index, this.targetIp, this.targetPort)
  }
}
