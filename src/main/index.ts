import { app, shell, BrowserWindow, ipcMain, dialog, session, Menu, screen, nativeTheme } from 'electron'
import { join, basename, dirname } from 'path'
import { readFileSync, readFile, existsSync, unlinkSync, mkdirSync, writeFileSync, readdirSync, copyFileSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { is } from '@electron-toolkit/utils'
import ffmpeg from 'fluent-ffmpeg'
import dgram from 'dgram'
import { autoUpdater } from 'electron-updater'

// Point fluent-ffmpeg at the bundled binary
// In production, ffmpeg-static is asarUnpacked so we resolve manually
const ffmpegBin = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
// On macOS, ffmpeg-static ships arch-specific binaries in subdirectories for ARM64
const ffmpegPath = app.isPackaged
  ? (() => {
      const base = join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static')
      // Try arch-specific path first (macOS ARM64: ffmpeg-static/bin/darwin/arm64/ffmpeg)
      if (process.platform === 'darwin') {
        const archPath = join(base, 'bin', 'darwin', process.arch, 'ffmpeg')
        if (existsSync(archPath)) return archPath
      }
      return join(base, ffmpegBin)
    })()
  : require('ffmpeg-static')
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath)

// ════════════════════════════════════════════════════════════
// Auto-Updater (electron-updater + GitHub Releases)
// ════════════════════════════════════════════════════════════

// Don't auto-download — ask user first
autoUpdater.autoDownload = false
// Install silently when app quits (if update was downloaded)
autoUpdater.autoInstallOnAppQuit = true
// Suppress verbose logging to console
autoUpdater.logger = null

/** True when the user manually triggered "Check for Updates" — controls whether
 *  to show a "You're up to date" dialog (auto check is silent on no-update). */
let isManualUpdateCheck = false
/** True while a download triggered by the user is in progress — ensures download
 *  errors are always surfaced even when the original check was silent. */
let isDownloadInProgress = false

function getUpdateWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
}

/** Kick off an update check. Pass silent=true for startup auto-check (no dialog if up to date). */
function checkForUpdates(silent = false): void {
  if (!app.isPackaged) {
    // Dev mode — can't use auto-updater (no local installer)
    if (!silent) {
      dialog.showMessageBox({
        type: 'info', title: 'Dev Mode',
        message: 'Update check is disabled in development mode.',
        buttons: ['OK']
      })
    }
    return
  }
  isManualUpdateCheck = !silent
  autoUpdater.checkForUpdates().catch((e) => {
    isManualUpdateCheck = false
    if (!silent) {
      const win = getUpdateWindow()
      const opts = {
        type: 'error' as const,
        title: 'Update Error',
        message: 'Could not check for updates.',
        detail: String(e),
        buttons: ['OK']
      }
      win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts)
    }
  })
}

// Update available → ask user if they want to download
autoUpdater.on('update-available', async (info) => {
  const win = getUpdateWindow()
  const opts = {
    type: 'info' as const,
    title: 'Update Available',
    message: `LTCast ${info.version} is available`,
    detail: `You are running v${app.getVersion()}.\nWould you like to download the update now?\nYou can continue using LTCast while it downloads.`,
    buttons: ['Download', 'Later'],
    defaultId: 0,
    cancelId: 1
  }
  const result = await (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts))
  if (result.response === 0) {
    isDownloadInProgress = true
    autoUpdater.downloadUpdate().catch(() => {})
  }
})

// No update available → only show dialog on manual check
autoUpdater.on('update-not-available', () => {
  if (!isManualUpdateCheck) return
  isManualUpdateCheck = false
  const win = getUpdateWindow()
  const opts = {
    type: 'info' as const,
    title: 'Up to Date',
    message: 'LTCast is up to date!',
    detail: `You are running the latest version (v${app.getVersion()}).`,
    buttons: ['OK']
  }
  win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts)
})

// Error during update check or download
autoUpdater.on('error', async (err) => {
  // Suppress ENOENT for app-update.yml — happens when running a local build
  // that wasn't published (no app-update.yml injected into bundle)
  if ((err as NodeJS.ErrnoException).code === 'ENOENT' &&
      err.message.includes('app-update.yml')) return
  // Suppress network errors silently — offline is normal in production environments
  const code = (err as NodeJS.ErrnoException).code
  if (code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED' ||
      code === 'ENETUNREACH' || code === 'EAI_AGAIN' || code === 'ECONNRESET' ||
      code === 'EPIPE' || err.message.includes('ERR_CONNECTION_CLOSED') ||
      err.message.includes('net::ERR_')) return
  const wasDownload = isDownloadInProgress
  const wasManual = isManualUpdateCheck
  isManualUpdateCheck = false
  isDownloadInProgress = false
  if (!wasManual && !wasDownload) return

  const win = getUpdateWindow()
  if (wasDownload) {
    // Download failed — offer to open the releases page as fallback
    const opts = {
      type: 'error' as const,
      title: 'Download Failed',
      message: 'Could not download the update.',
      detail: `${err.message}\n\nYou can download the latest version manually from the releases page.`,
      buttons: ['Open Download Page', 'Cancel'],
      defaultId: 0,
      cancelId: 1
    }
    const r = await (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts))
    if (r.response === 0) shell.openExternal('https://github.com/xyproai-bot/LTCast/releases/latest')
  } else {
    const opts = {
      type: 'error' as const,
      title: 'Update Error',
      message: 'Update check failed.',
      detail: err.message,
      buttons: ['OK']
    }
    win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts)
  }
})

// Update fully downloaded → prompt to restart
autoUpdater.on('update-downloaded', async (info) => {
  isDownloadInProgress = false
  const win = getUpdateWindow()
  const isMac = process.platform === 'darwin'
  const opts = {
    type: 'info' as const,
    title: 'Update Ready',
    message: `LTCast ${info.version} is ready to install`,
    detail: isMac
      ? 'Quit and relaunch LTCast to apply the update. Your presets and settings are preserved.'
      : 'Restart LTCast now to apply the update. Your presets and settings are preserved.',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
    cancelId: 1
  }
  const result = await (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts))
  if (result.response === 0) {
    try {
      autoUpdater.quitAndInstall()
    } catch {
      // On unsigned macOS apps quitAndInstall can fail — fall back to opening releases page
      shell.openExternal('https://github.com/xyproai-bot/LTCast/releases/latest')
    }
  }
})

// ════════════════════════════════════════════════════════════
// License Validation (LemonSqueezy API)
// ════════════════════════════════════════════════════════════

const LEMONSQUEEZY_API = 'https://api.lemonsqueezy.com/v1/licenses'

async function lemonSqueezyRequest(
  action: 'activate' | 'deactivate' | 'validate',
  licenseKey: string
): Promise<{ valid: boolean; error?: string; status?: string }> {
  try {
    const { net } = require('electron')
    const body = JSON.stringify({
      license_key: licenseKey,
      instance_name: `${require('os').hostname()}-${require('os').platform()}`
    })
    const response = await net.fetch(`${LEMONSQUEEZY_API}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body
    })
    const data = await response.json()
    if (data.valid || data.activated) {
      // Persist validated state via safeStorage on success
      if (action !== 'deactivate') {
        saveProState({
          licenseKey,
          validatedAt: Date.now(),
          status: data.license_key?.status ?? 'active',
          fingerprint: getMachineFingerprint()
        })
      } else {
        clearProState()
      }
      return { valid: true, status: data.license_key?.status }
    }
    return { valid: false, error: data.error || data.message || 'Invalid license key' }
  } catch (e) {
    return { valid: false, error: `Network error: ${(e as Error).message}` }
  }
}

// ════════════════════════════════════════════════════════════
// Pro state persistence via safeStorage (OS keychain encryption)
// ════════════════════════════════════════════════════════════
// Renderer's localStorage is trivially tampered via DevTools —
// storing Pro state there means users unlock Pro in <60 seconds.
// safeStorage uses OS keychain (Keychain on macOS, DPAPI on Windows)
// so the blob on disk is encrypted and only decryptable by this app
// on this machine. Renderer can READ the blob but can't decrypt it.

interface ProState {
  licenseKey: string
  validatedAt: number  // ms
  status: string       // 'active' | 'expired' | 'refunded' | 'revoked'
  expiresAt?: string   // ISO date, for promo licenses
  fingerprint?: string // machine fingerprint at activation time — binds Pro to hardware
}

function getProStatePath(): string {
  return join(app.getPath('userData'), '.pro-state')
}

function saveProState(state: ProState): void {
  try {
    const { safeStorage } = require('electron')
    if (!safeStorage.isEncryptionAvailable()) {
      // Fallback: write plaintext (still better than renderer-modifiable store)
      writeFileSync(getProStatePath(), JSON.stringify(state), 'utf-8')
      return
    }
    const encrypted = safeStorage.encryptString(JSON.stringify(state))
    writeFileSync(getProStatePath(), encrypted)
  } catch { /* non-fatal */ }
}

function readProState(): ProState | null {
  try {
    const p = getProStatePath()
    if (!existsSync(p)) return null
    const { safeStorage } = require('electron')
    const raw = readFileSync(p)
    if (safeStorage.isEncryptionAvailable()) {
      try { return JSON.parse(safeStorage.decryptString(raw)) } catch { return null }
    }
    // Fallback plaintext
    try { return JSON.parse(raw.toString('utf-8')) } catch { return null }
  } catch { return null }
}

function clearProState(): void {
  try {
    const p = getProStatePath()
    if (existsSync(p)) require('fs').unlinkSync(p)
  } catch { /* non-fatal */ }
}

/**
 * Returns true if the app is currently in Pro state.
 * Main process is authoritative — renderer cannot forge this because
 * the state is encrypted via OS keychain.
 * Clock rollback check is built-in (expire immediately on tamper).
 */
function computeIsPro(): { isPro: boolean; reason: string } {
  // Rollback check first
  const hw = updateHighWater()
  if (hw.rolledBack) return { isPro: false, reason: 'clock-tampered' }

  const state = readProState()
  if (!state) return { isPro: false, reason: 'no-license' }
  if (state.status !== 'active') return { isPro: false, reason: `status-${state.status}` }

  // Promo hard expiry
  if (state.expiresAt) {
    if (new Date(state.expiresAt).getTime() < Date.now()) {
      return { isPro: false, reason: 'expired' }
    }
  }

  // Hardware fingerprint binding: if the license was activated on a different
  // machine (user cloned .pro-state, swapped hardware, or transferred install),
  // require re-activation. Legitimate hardware swaps just need one re-activate.
  if (state.fingerprint) {
    const current = getMachineFingerprint()
    if (state.fingerprint !== current) {
      return { isPro: false, reason: 'hardware-changed' }
    }
  }

  // 30-day offline grace period since last successful server validation
  const daysSince = (Date.now() - state.validatedAt) / (1000 * 60 * 60 * 24)
  if (daysSince < -1) return { isPro: false, reason: 'clock-tampered' }  // validated in future
  if (daysSince > 30) return { isPro: false, reason: 'offline-grace-exceeded' }

  return { isPro: true, reason: 'ok' }
}

// ════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════
// License Status Check — our Worker catches refunds/cancellations
// ════════════════════════════════════════════════════════════

const WORKER_API = 'https://ltcast-trial.xypro-ai.workers.dev'

/**
 * Check license status against our Cloudflare Worker.
 * The Worker receives LemonSqueezy webhooks and tracks refunds/cancellations.
 * Returns 'active', 'expired', 'refunded', 'revoked', or 'unknown' (no record).
 */
async function checkLicenseStatus(licenseKey: string): Promise<{ status: string; tampered?: boolean; expiresAt?: string | null }> {
  // Clock rollback check: if detected, force expire regardless of server response
  const hw = updateHighWater()
  if (hw.rolledBack) {
    clearProState()
    return { status: 'expired', tampered: true }
  }
  try {
    const { net } = require('electron')
    const response = await net.fetch(`${WORKER_API}/license/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey })
    })
    const data = await response.json()
    // Worker is authoritative — update encrypted pro state based on result
    if (data.status === 'active') {
      saveProState({
        licenseKey, validatedAt: Date.now(),
        status: 'active',
        expiresAt: data.expiresAt || undefined,
        fingerprint: getMachineFingerprint()
      })
    } else if (data.status === 'refunded' || data.status === 'revoked' || data.status === 'expired') {
      clearProState()
    }
    // 'unknown' = Worker doesn't have the key yet — leave existing state alone
    return data
  } catch {
    return { status: 'unknown' }
  }
}

// ════════════════════════════════════════════════════════════
// Trial System — server-side fingerprint tracking
// ════════════════════════════════════════════════════════════

const TRIAL_API = WORKER_API

/**
 * Generate stable machine fingerprint using hardware UUID.
 * Falls back to CPU+hostname if UUID is unavailable.
 * Does NOT use MAC address (changes with VPN/dock/virtual adapters).
 */
function getMachineFingerprint(): string {
  const crypto = require('crypto')
  const uuid = _getHardwareUUID()
  if (uuid) {
    return crypto.createHash('sha256').update(`uuid|${uuid}`).digest('hex')
  }
  // Fallback: CPU model + hostname + platform (no MAC)
  const os = require('os')
  const cpuModel = os.cpus().length > 0 ? os.cpus()[0].model : 'unknown'
  const raw = `${cpuModel}|${os.hostname()}|${os.platform()}`
  return crypto.createHash('sha256').update(raw).digest('hex')
}

/** Legacy fingerprint for backward compatibility with existing activations. */
function getLegacyFingerprint(): string {
  const os = require('os')
  const crypto = require('crypto')
  const cpuModel = os.cpus().length > 0 ? os.cpus()[0].model : 'unknown'
  const hostname = os.hostname()
  const platform = os.platform()
  const nets = os.networkInterfaces()
  let mac = ''
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
        mac = net.mac
        break
      }
    }
    if (mac) break
  }
  const raw = `${cpuModel}|${mac}|${hostname}|${platform}`
  return crypto.createHash('sha256').update(raw).digest('hex')
}

/** Get hardware UUID (motherboard/platform). Stable across network changes. */
function _getHardwareUUID(): string | null {
  try {
    const { execSync } = require('child_process')
    if (process.platform === 'win32') {
      // Windows: SMBIOS UUID from motherboard
      const out = execSync('wmic csproduct get uuid', { timeout: 5000 }).toString()
      const lines = out.trim().split('\n').map((l: string) => l.trim()).filter(Boolean)
      if (lines.length >= 2 && lines[1] !== 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF') {
        return lines[1]
      }
    } else if (process.platform === 'darwin') {
      // macOS: IOPlatformUUID
      const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice', { timeout: 5000 }).toString()
      const match = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)
      if (match) return match[1]
    } else {
      // Linux: machine-id
      const { readFileSync, existsSync } = require('fs')
      if (existsSync('/etc/machine-id')) {
        return readFileSync('/etc/machine-id', 'utf8').trim()
      }
    }
  } catch { /* UUID unavailable — use fallback */ }
  return null
}

async function checkTrial(): Promise<{ daysLeft: number; expired: boolean; tampered?: boolean }> {
  // Always update high-water mark on trial check, regardless of network.
  // Rollback detection must work even when online to prevent "rollback + online = reset" attacks.
  const hw = updateHighWater()
  if (hw.rolledBack) {
    return { daysLeft: 0, expired: true, tampered: true }
  }
  try {
    const { net } = require('electron')
    const fingerprint = getMachineFingerprint()
    const response = await net.fetch(`${TRIAL_API}/trial/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fingerprint })
    })
    const data = await response.json()
    return { daysLeft: data.daysLeft ?? 0, expired: data.expired ?? true }
  } catch {
    // Offline — fall back to local trial (stored in system registry/file)
    return checkLocalTrial()
  }
}

/** Local fallback: store trial start in a system-level location that survives app reinstall */
function getLocalTrialPath(): string {
  const os = require('os')
  if (process.platform === 'win32') {
    return join(os.homedir(), 'AppData', 'Local', '.ltcast-trial')
  }
  return join(os.homedir(), 'Library', 'Application Support', '.ltcast-trial')
}

/**
 * Monotonic "high-water mark" timestamp to detect clock rollback tampering.
 * Written on every license/trial check. If the system clock ever goes
 * earlier than the stored value, the user rolled it back to cheat the
 * trial / offline license grace period → treat as tampered.
 */
function getHighWaterPath(): string {
  const os = require('os')
  if (process.platform === 'win32') {
    return join(os.homedir(), 'AppData', 'Local', '.ltcast-hw')
  }
  return join(os.homedir(), 'Library', 'Application Support', '.ltcast-hw')
}

function readHighWater(): number {
  try {
    const p = getHighWaterPath()
    if (!existsSync(p)) return 0
    const n = parseInt(readFileSync(p, 'utf8').trim(), 10)
    return isNaN(n) ? 0 : n
  } catch { return 0 }
}

function writeHighWater(ts: number): void {
  try {
    const p = getHighWaterPath()
    const dir = dirname(p)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(p, String(ts))
  } catch { /* non-fatal */ }
}

/**
 * Update high-water mark to max(stored, now).
 * Returns true if clock rollback was detected (stored > now by >1 day).
 * The 1-day tolerance handles timezone changes and small NTP corrections.
 */
function updateHighWater(): { rolledBack: boolean; stored: number; now: number } {
  const now = Date.now()
  const stored = readHighWater()
  const rolledBack = stored > 0 && (stored - now) > 24 * 60 * 60 * 1000
  if (now > stored) writeHighWater(now)
  return { rolledBack, stored, now }
}

function checkLocalTrial(): { daysLeft: number; expired: boolean; tampered?: boolean } {
  // Clock-rollback check first — if the user rolled back, expire immediately
  const hw = updateHighWater()
  if (hw.rolledBack) {
    return { daysLeft: 0, expired: true, tampered: true }
  }

  const trialPath = getLocalTrialPath()
  let trialStart: number
  if (existsSync(trialPath)) {
    try {
      trialStart = parseInt(readFileSync(trialPath, 'utf8').trim(), 10)
    } catch {
      trialStart = Date.now()
      writeFileSync(trialPath, String(trialStart))
    }
  } else {
    trialStart = Date.now()
    const dir = dirname(trialPath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(trialPath, String(trialStart))
  }
  // Use max(Date.now(), high-water) so rollback between the tolerance window
  // and full rollback still gives correct elapsed days
  const effectiveNow = Math.max(Date.now(), hw.stored)
  const daysUsed = Math.floor((effectiveNow - trialStart) / (1000 * 60 * 60 * 24))
  const daysLeft = Math.max(0, 14 - daysUsed)
  return { daysLeft, expired: daysLeft <= 0 }
}

// ════════════════════════════════════════════════════════════
// OSC Output — UDP sender (user-configured port, default 8000)
// ════════════════════════════════════════════════════════════

let oscSocket: dgram.Socket | null = null

function oscString(str: string): Buffer {
  // utf8 — OSC 1.0 says ASCII but Resolume/TouchDesigner/most modern
  // receivers accept utf8 and users expect CJK song names to transmit correctly.
  // ASCII encoding silently stripped high bits, corrupting non-Latin names.
  const buf = Buffer.from(str + '\0', 'utf8')
  const rem = buf.length % 4
  return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - rem)])
}

function oscInt32(val: number): Buffer {
  const buf = Buffer.alloc(4)
  buf.writeInt32BE(val, 0)
  return buf
}

function oscMessage(address: string, types: string, ...args: (number | string)[]): Buffer {
  const parts: Buffer[] = [oscString(address), oscString(',' + types)]
  for (let i = 0; i < args.length; i++) {
    const t = types[i]
    if (t === 'i') parts.push(oscInt32(args[i] as number))
    else if (t === 'f') { const buf = Buffer.alloc(4); buf.writeFloatBE(args[i] as number, 0); parts.push(buf) }
    else if (t === 's') parts.push(oscString(args[i] as string))
  }
  return Buffer.concat(parts)
}

function ensureOscSocket(): void {
  if (oscSocket) return
  oscSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  oscSocket.on('error', (err) => {
    console.error('OSC socket error:', err)
    oscSocket?.close()
    oscSocket = null
  })
  oscSocket.bind()
}

function closeOscSocket(): void {
  if (oscSocket) {
    try { oscSocket.close() } catch { /**/ }
    oscSocket = null
  }
}

// ════════════════════════════════════════════════════════════
// Art-Net Timecode — UDP sender on port 6454
// ════════════════════════════════════════════════════════════

const ARTNET_PORT = 6454
let artnetSocket: dgram.Socket | null = null

// Pre-allocate the 19-byte Art-Net Timecode packet
// Layout: "Art-Net\0" (8) + OpCode (2) + ProtVer (2) + Filler (2) + Frames (1) + Seconds (1) + Minutes (1) + Hours (1) + Type (1)
const artnetPacket = Buffer.alloc(19)
artnetPacket.write('Art-Net\0', 0, 8, 'ascii')    // ID
artnetPacket.writeUInt16LE(0x9700, 8)              // OpTimeCode (little-endian)
artnetPacket.writeUInt8(0, 10)                     // ProtVerHi
artnetPacket.writeUInt8(14, 11)                    // ProtVerLo
artnetPacket.writeUInt8(0, 12)                     // Filler 1
artnetPacket.writeUInt8(0, 13)                     // Filler 2

function artnetFpsToType(fps: number): number {
  if (fps === 24) return 0   // Film
  if (fps === 25) return 1   // EBU
  if (fps === 29.97) return 2 // DF
  return 3                    // SMPTE (30)
}

function ensureArtnetSocket(): void {
  if (artnetSocket) return
  artnetSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  artnetSocket.on('error', (err) => {
    console.error('Art-Net socket error:', err)
    artnetSocket?.close()
    artnetSocket = null
    // Notify all renderer windows so they can disable Art-Net in the UI
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send('artnet-socket-failed')
    })
  })
  artnetSocket.bind(() => {
    artnetSocket?.setBroadcast(true)
  })
}

function closeArtnetSocket(): void {
  if (artnetSocket) {
    try { artnetSocket.close() } catch { /**/ }
    artnetSocket = null
  }
}

function createWindow(): BrowserWindow {
  // Adapt to available screen size (handles high-DPI scaling, e.g. 175% on 1080p)
  const { workArea } = screen.getPrimaryDisplay()
  const winW = Math.min(1100, Math.max(900, workArea.width))
  const winH = Math.min(700, Math.max(520, Math.floor(workArea.height * 0.85)))
  const win = new BrowserWindow({
    width: winW,
    height: winH,
    minWidth: 860,
    minHeight: 500,
    backgroundColor: '#1a1a1a',
    // hiddenInset on Mac: hides the native title bar chrome but keeps the
    // traffic light buttons inset into the content area (no double-header)
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Critical for live-show reliability: keep timers running at full rate
      // when window is backgrounded (A-B loop, MIDI Clock, auto-advance, cue
      // triggers all rely on sub-second timer precision)
      backgroundThrottling: false
    },
    show: false,
    title: 'LTCast'
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  // In dev mode, allow DevTools; in production, block shortcuts
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    win.webContents.on('ready-to-show', () => {
      win.webContents.openDevTools({ mode: 'detach' })
    })
  } else {
    // Block DevTools shortcuts (F12, Ctrl+Shift+I, Cmd+Option+I)
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.key === 'F12' ||
          (input.control && input.shift && input.key.toLowerCase() === 'i') ||
          (input.meta && input.alt && input.key.toLowerCase() === 'i')) {
        _e.preventDefault()
      }
    })
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    // Only allow http/https URLs to be opened externally
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Pipe renderer console to terminal for debugging
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const prefix = ['LOG', 'WARN', 'ERR ', 'DBG '][level] ?? 'LOG'
    console.log(`[renderer:${prefix}] ${message} (${sourceId}:${line})`)
  })

  return win
}

// Recent files stored in a simple JSON file
const recentFilesPath = join(app.getPath('userData'), 'recent-files.json')

function loadRecentFiles(): Array<{ path: string; name: string }> {
  try {
    if (existsSync(recentFilesPath)) {
      return JSON.parse(readFileSync(recentFilesPath, 'utf-8'))
    }
  } catch { /* ignore */ }
  return []
}

function saveRecentFiles(files: Array<{ path: string; name: string }>): void {
  try {
    writeFileSync(recentFilesPath, JSON.stringify(files.slice(0, 10)), 'utf-8')
  } catch { /* ignore — recent files list is non-critical */ }
}

function addToRecentFiles(filePath: string, name: string): void {
  const files = loadRecentFiles().filter(f => f.path !== filePath)
  files.unshift({ path: filePath, name })
  saveRecentFiles(files.slice(0, 10))
}

// Register open-file BEFORE whenReady — on macOS the event can fire before the app is ready
// (e.g. user double-clicks a .ltcast file to launch the app)
let pendingOpenFile: string | null = null

app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (filePath.toLowerCase().endsWith('.ltcast')) {
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.webContents.isLoading()) {
      win.webContents.send('open-ltcast-file', filePath)
    } else {
      pendingOpenFile = filePath
    }
  }
})

let currentWin: BrowserWindow | null = null

function buildMenu(win: BrowserWindow, presetsDir: string): void {
  currentWin = win
  const isMac = process.platform === 'darwin'
  const send = (channel: string, ...args: unknown[]): void => { win.webContents.send(channel, ...args) }

  const recentFiles = loadRecentFiles()
  const recentSubmenu: Electron.MenuItemConstructorOptions[] = recentFiles.length > 0
    ? [
        ...recentFiles.map(f => ({
          label: f.name,
          click: () => send('menu-open-recent', f.path)
        })),
        { type: 'separator' as const },
        { label: 'Clear Recent', click: () => { saveRecentFiles([]); rebuildMenu(presetsDir) } }
      ]
    : [{ label: 'No Recent Files', enabled: false }]

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => send('menu-new-preset') },
        { label: 'Open...', accelerator: 'CmdOrCtrl+O', click: () => send('menu-import-preset') },
        { label: 'Open Recent', submenu: recentSubmenu },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('menu-save-preset') },
        { label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('menu-save-preset-as') },
        { type: 'separator' },
        { label: 'Collect Project...', click: () => send('menu-package-project') },
        { label: 'Open Project...', click: () => send('menu-import-project') },
        { type: 'separator' },
        { label: isMac ? 'Show in Finder' : 'Show in Explorer', click: () => { shell.openPath(presetsDir) } },
        { type: 'separator' },
        { label: 'Check for Updates...', click: () => checkForUpdates(false) },
        { type: 'separator' },
        ...(isMac ? [] : [{ role: 'quit' as const }])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function rebuildMenu(presetsDir: string): void {
  if (currentWin) buildMenu(currentWin, presetsDir)
}

// Set macOS About panel content (version + copyright)
if (process.platform === 'darwin') {
  app.setAboutPanelOptions({
    applicationName: 'LTCast',
    applicationVersion: app.getVersion(),
    copyright: 'Copyright © 2024 LTCast',
    credits: 'LTC Timecode player and MTC/Art-Net sender'
  })
}

app.whenReady().then(() => {
  // Force dark mode — prevents Windows title bar from flickering between light/dark
  nativeTheme.themeSource = 'dark'

  // Allow Web MIDI API (including SysEx) and speaker selection (for setSinkId) without permission prompt
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'midi' || permission === 'midiSysex' || permission === 'speaker-selection') {
      callback(true)
    } else {
      callback(false)
    }
  })

  // Permission check handler — required for setSinkId() and enumerateDevices() on macOS
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    if (permission === 'midi' || permission === 'midiSysex' || permission === 'speaker-selection' || permission === 'audiooutput') {
      return true
    }
    return false
  })

  // ── LTCast Documents folder setup ──────────────────────────
  const documentsDir = app.getPath('documents')
  const ltcastDir = join(documentsDir, 'LTCast')
  const presetsDir = join(ltcastDir, 'Presets')
  const projectsDir = join(ltcastDir, 'Projects')

  // Ensure directories exist on startup
  for (const dir of [ltcastDir, presetsDir, projectsDir]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }

  const win = createWindow()
  buildMenu(win, presetsDir)

  // Renderer crash recovery — reload if renderer process crashes or becomes unresponsive
  let crashCount = 0
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer process gone:', details.reason)
    if (details.reason !== 'clean-exit') {
      crashCount++
      if (crashCount <= 3) {
        setTimeout(() => { try { win.webContents.reload() } catch { /**/ } }, 1000)
      } else {
        dialog.showErrorBox('LTCast Error',
          'The application crashed repeatedly and cannot recover.\nPlease restart LTCast manually.')
      }
    }
  })
  win.on('unresponsive', () => {
    console.warn('Window became unresponsive, waiting...')
  })
  win.on('responsive', () => {
    console.log('Window became responsive again')
  })

  // ── Handle .ltcast file opened via double-click ──────────

  // Windows/Linux: file path passed as command-line argument
  const argv = process.argv
  for (const arg of argv) {
    if (arg.toLowerCase().endsWith('.ltcast') && existsSync(arg)) {
      pendingOpenFile = arg
      break
    }
  }

  // Send pending file to renderer once it finishes loading
  // (covers both the argv case above and the open-file event registered before whenReady)
  win.webContents.on('did-finish-load', () => {
    if (pendingOpenFile) {
      win.webContents.send('open-ltcast-file', pendingOpenFile)
      pendingOpenFile = null
    }
  })

  // ── Virtual audio cable first-launch prompt ──────────────────
  // Show once after install to let users know they need a virtual audio cable for LTC output
  if (app.isPackaged && (process.platform === 'win32' || process.platform === 'darwin')) {
    const vbcableFlagPath = join(app.getPath('userData'), 'vbcable-prompted.json')
    if (!existsSync(vbcableFlagPath)) {
      writeFileSync(vbcableFlagPath, '{"prompted":true}', 'utf-8')
      const isMacPrompt = process.platform === 'darwin'
      setTimeout(async () => {
        const result = await dialog.showMessageBox(win, {
          type: 'info',
          title: 'Virtual Audio Cable Recommended',
          message: 'LTCast requires a virtual audio cable to output LTC via software.',
          detail: isMacPrompt
            ? 'BlackHole is a free virtual audio device that lets LTCast send LTC timecode to other software on your Mac.\n\nIf you\'re using a physical audio interface to output LTC, you can skip this.'
            : 'VB-CABLE is a free virtual audio device that lets LTCast send LTC timecode to other software on your computer.\n\nIf you\'re using a physical audio interface to output LTC, you can skip this.',
          buttons: [isMacPrompt ? 'Download BlackHole (Free)' : 'Download VB-CABLE (Free)', 'Skip'],
          defaultId: 0,
          cancelId: 1
        })
        if (result.response === 0) {
          shell.openExternal(isMacPrompt
            ? 'https://existential.audio/blackhole/'
            : 'https://vb-audio.com/Cable/index.htm'
          )
        }
      }, 2000)
    }
  }

  // Silent auto-check for updates 5 seconds after startup
  // Only in production — dev builds can't use the updater
  setTimeout(() => checkForUpdates(true), 5000)

  // IPC: get LTCast base path
  ipcMain.handle('get-ltcast-path', () => ltcastDir)

  // IPC: add to recent files and rebuild menu
  ipcMain.handle('add-recent-file', (_event, filePath: string, name: string) => {
    addToRecentFiles(filePath, name)
    rebuildMenu(presetsDir)
  })

  // IPC: get recent files list
  ipcMain.handle('get-recent-files', () => loadRecentFiles())

  // IPC: list presets from filesystem
  ipcMain.handle('list-presets', () => {
    try {
      const files = readdirSync(presetsDir).filter(f => f.endsWith('.ltcast'))
      const results = []
      for (const f of files) {
        try {
          const raw = readFileSync(join(presetsDir, f), 'utf-8')
          const data = JSON.parse(raw)
          results.push({ name: data.name ?? f.replace('.ltcast', ''), data: data.data, updatedAt: data.updatedAt ?? '' })
        } catch { /* skip corrupted preset file */ }
      }
      return results
    } catch { return [] }
  })

  // Track paths the user has explicitly approved via save dialog, so
  // save-preset(filePath) can't be abused to write arbitrary locations from
  // a compromised renderer.
  const approvedSavePaths = new Set<string>()

  const sanitizePresetName = (name: string): string => {
    // Strip illegal chars + leading dots (Windows reserved)
    const cleaned = String(name).replace(/[<>:"/\\|?*\0]/g, '_').replace(/^\.+/, '_')
    // Prevent path traversal components
    return cleaned.replace(/\.\.+/g, '__').slice(0, 200) || 'untitled'
  }

  // IPC: save preset to a specific path (used when path is already known)
  ipcMain.handle('save-preset', (_event, name: string, data: unknown, filePath?: string) => {
    let dest: string
    if (filePath) {
      // Only accept filePath if it's inside presetsDir OR was previously
      // returned by save-preset-dialog (user-approved)
      const resolved = require('path').resolve(filePath)
      const presetsResolved = require('path').resolve(presetsDir)
      const inPresetsDir = resolved.startsWith(presetsResolved + require('path').sep)
      if (!inPresetsDir && !approvedSavePaths.has(resolved)) {
        throw new Error('Invalid save path')
      }
      if (!resolved.endsWith('.ltcast')) throw new Error('Save path must end with .ltcast')
      dest = resolved
    } else {
      dest = join(presetsDir, sanitizePresetName(name) + '.ltcast')
    }
    const dir = dirname(dest)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const content = JSON.stringify({ name, data, updatedAt: new Date().toISOString() }, null, 2)
    writeFileSync(dest, content, 'utf-8')
    return dest
  })

  // IPC: open save dialog for preset (returns chosen path or null)
  ipcMain.handle('save-preset-dialog', async (_event, defaultName: string) => {
    const result = await dialog.showSaveDialog({
      title: 'Save Preset',
      defaultPath: join(presetsDir, defaultName + '.ltcast'),
      filters: [
        { name: 'LTCast Preset', extensions: ['ltcast'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePath) return null
    // Track the approved path so save-preset can write to it later
    approvedSavePaths.add(require('path').resolve(result.filePath))
    return result.filePath
  })

  // IPC: delete preset from filesystem
  ipcMain.handle('delete-preset', (_event, name: string) => {
    const safeName = sanitizePresetName(name)
    const filePath = join(presetsDir, safeName + '.ltcast')
    // Ensure final path is still inside presetsDir after any basename collapse
    const resolved = require('path').resolve(filePath)
    const presetsResolved = require('path').resolve(presetsDir)
    if (!resolved.startsWith(presetsResolved + require('path').sep)) return false
    if (existsSync(resolved)) unlinkSync(resolved)
    return true
  })

  // IPC: open preset folder in file explorer
  ipcMain.handle('open-presets-folder', () => {
    shell.openPath(presetsDir)
  })

  // IPC: open a .ltcast file via dialog
  ipcMain.handle('import-preset', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open',
      defaultPath: presetsDir,
      filters: [
        { name: 'LTCast File', extensions: ['ltcast'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    try {
      const filePath = result.filePaths[0]
      const raw = readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      // Copy to presets folder if not already there (skip if dest already exists to avoid overwriting)
      const destPath = join(presetsDir, basename(filePath))
      if (filePath !== destPath && !existsSync(destPath)) {
        writeFileSync(destPath, raw, 'utf-8')
      }
      return { name: parsed.name, data: parsed.data, updatedAt: parsed.updatedAt ?? '', path: filePath }
    } catch { return null }
  })

  // IPC: load a .ltcast file by path (for Open Recent)
  ipcMain.handle('load-preset-file', (_event, filePath: string) => {
    try {
      if (!existsSync(filePath)) return null
      const raw = readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      return { name: parsed.name, data: parsed.data, updatedAt: parsed.updatedAt ?? '' }
    } catch { return null }
  })

  // IPC: package project — create a project folder with preset + audio copies
  ipcMain.handle('package-project', async (_event, presetName: string, presetData: unknown, audioPaths: string[]) => {
    // Let user pick where to create the project folder
    const result = await dialog.showOpenDialog({
      title: 'Choose Project Location',
      defaultPath: projectsDir,
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null

    const parentDir = result.filePaths[0]
    const safeName = presetName.replace(/[<>:"/\\|?*]/g, '_')
    const projectDir = join(parentDir, safeName)
    const audioDir = join(projectDir, 'Audio')

    // Create project folder structure
    mkdirSync(audioDir, { recursive: true })

    // Copy audio files and build new setlist with relative paths
    const copiedMap: Record<string, string> = {}
    for (const srcPath of audioPaths) {
      if (existsSync(srcPath)) {
        const fileName = basename(srcPath)
        const destPath = join(audioDir, fileName)
        // Handle duplicate filenames
        let finalDest = destPath
        let counter = 1
        while (existsSync(finalDest)) {
          const ext = fileName.includes('.') ? '.' + fileName.split('.').pop() : ''
          const base = ext ? fileName.slice(0, -ext.length) : fileName
          finalDest = join(audioDir, `${base} (${counter})${ext}`)
          counter++
        }
        copyFileSync(srcPath, finalDest)
        copiedMap[srcPath] = finalDest
      }
    }

    // Update preset data — setlist paths point to copied files
    const updatedData = JSON.parse(JSON.stringify(presetData))
    if (updatedData.setlist) {
      updatedData.setlist = updatedData.setlist.map((item: { path: string; name: string }) => {
        const copied = copiedMap[item.path]
        return copied ? { ...item, path: copied } : item
      })
    }

    // Save preset file in project root
    const presetFilePath = join(projectDir, safeName + '.ltcast')
    const content = JSON.stringify({
      name: presetName,
      data: updatedData,
      updatedAt: new Date().toISOString()
    }, null, 2)
    writeFileSync(presetFilePath, content, 'utf-8')

    // Open the project folder in file explorer
    shell.openPath(projectDir)

    return projectDir
  })

  // IPC: import project — open a .ltcast file from any location
  ipcMain.handle('import-project', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open Project',
      defaultPath: projectsDir,
      filters: [
        { name: 'LTCast Preset', extensions: ['ltcast'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null

    try {
      const presetFilePath = result.filePaths[0]
      const raw = readFileSync(presetFilePath, 'utf-8')
      const preset = JSON.parse(raw)

      // Check if there's an Audio subfolder next to the preset file
      const projectDir = dirname(presetFilePath)
      const audioDir = join(projectDir, 'Audio')
      let audioPaths: string[] = []
      if (existsSync(audioDir)) {
        audioPaths = readdirSync(audioDir)
          .map(f => join(audioDir, f))
          .filter(p => { try { return statSync(p).isFile() } catch { return false } })
      }

      return {
        preset: { name: preset.name, data: preset.data, updatedAt: preset.updatedAt ?? '' },
        audioPaths,
        projectDir,
        presetFilePath
      }
    } catch { return null }
  })

  // IPC: save CSV file via save dialog
  ipcMain.handle('save-csv-dialog', async (_event, csvContent: string, defaultName: string) => {
    const result = await dialog.showSaveDialog({
      title: 'Export Setlist CSV',
      defaultPath: defaultName || 'setlist.csv',
      filters: [
        { name: 'CSV File', extensions: ['csv'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePath) return null
    writeFileSync(result.filePath, '\uFEFF' + csvContent, 'utf-8')
    return result.filePath
  })

  // IPC: open CSV file via open dialog and return its content as a string
  ipcMain.handle('open-csv-dialog', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Setlist CSV',
      filters: [
        { name: 'CSV File', extensions: ['csv'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths[0]) return null
    return readFileSync(result.filePaths[0], 'utf-8')
  })

  // IPC: save WAV file via save dialog
  ipcMain.handle('save-wav-dialog', async (_event, buffer: ArrayBuffer, defaultName: string) => {
    const result = await dialog.showSaveDialog({
      title: 'Export LTC WAV',
      defaultPath: defaultName || 'ltc.wav',
      filters: [
        { name: 'WAV Audio', extensions: ['wav'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePath) return null
    writeFileSync(result.filePath, Buffer.from(buffer))
    return result.filePath
  })

  // IPC: check if file exists on disk
  ipcMain.handle('file-exists', (_e, filePath: string) => {
    return existsSync(filePath)
  })

  // IPC: relink a missing file — open a file dialog to locate it
  ipcMain.handle('relink-file', async (_e, oldPath: string) => {
    const oldName = basename(oldPath)
    const result = await dialog.showOpenDialog({
      title: `Locate "${oldName}"`,
      filters: [
        { name: 'Audio Files', extensions: ['wav', 'mp3', 'aiff', 'aif', 'flac', 'ogg', 'm4a'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // IPC: scan a directory (and subdirectories, max 3 levels) for files matching given filenames
  // Uses lstatSync and skips symlinks to prevent symlink-escape DoS / info-leak
  // Caps total entries visited to prevent runaway scans
  ipcMain.handle('scan-folder-for-files', (_e, folderPath: string, fileNames: string[]) => {
    const MAX_DEPTH = 3
    const MAX_ENTRIES = 50_000
    const result: Record<string, string> = {}
    if (!isSafeFilePath(folderPath) || !Array.isArray(fileNames)) return result
    const { lstatSync } = require('fs')
    const targets = new Set(fileNames.map(n => String(n).toLowerCase()))
    let visited = 0
    const scan = (dir: string, depth: number): void => {
      if (depth > MAX_DEPTH || visited > MAX_ENTRIES) return
      let entries: string[]
      try { entries = readdirSync(dir) } catch { return }
      for (const entry of entries) {
        if (++visited > MAX_ENTRIES) return
        const full = join(dir, entry)
        try {
          const st = lstatSync(full)  // lstat: do not follow symlinks
          if (st.isSymbolicLink()) continue
          if (st.isDirectory()) {
            scan(full, depth + 1)
          } else if (targets.has(entry.toLowerCase()) && !result[entry.toLowerCase()]) {
            result[entry.toLowerCase()] = full
          }
        } catch { /* skip inaccessible */ }
        if (Object.keys(result).length === targets.size) return
      }
    }
    scan(folderPath, 0)
    return result
  })

  // IPC: open file dialog
  ipcMain.handle('open-file-dialog', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open Audio File',
      filters: [
        { name: 'Audio Files', extensions: ['wav', 'mp3', 'aiff', 'aif', 'flac', 'ogg', 'm4a'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // IPC: open multiple audio files dialog (for setlist)
  ipcMain.handle('open-multiple-audio-dialog', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Add Audio Files to Setlist',
      filters: [
        { name: 'Audio Files', extensions: ['wav', 'mp3', 'aiff', 'aif', 'flac', 'ogg', 'm4a'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths
  })

  // Reject paths that could trigger ffmpeg pseudo-protocol attacks (concat:,
  // subfile, pipe:, cache:, ...) or remote SMB/UNC pulls. Only allow plain
  // filesystem paths.
  const isSafeFilePath = (p: unknown): p is string => {
    if (typeof p !== 'string' || p.length === 0 || p.length > 1024) return false
    if (p.startsWith('\\\\')) return false                                // UNC
    if (/^[a-z][a-z0-9+.-]*:(?![\\/])/i.test(p)) return false             // protocol like concat:
    if (p.includes('\0')) return false                                    // null byte
    return true
  }

  // IPC: get audio durations for multiple files via ffprobe
  ipcMain.handle('get-audio-durations', async (_event, filePaths: string[]) => {
    const results: Record<string, number | null> = {}
    if (!Array.isArray(filePaths)) return results
    for (const fp of filePaths) {
      if (!isSafeFilePath(fp) || !existsSync(fp)) { results[fp as string] = null; continue }
      try {
        const dur = await new Promise<number>((resolve, reject) => {
          ffmpeg.ffprobe(fp, (err, metadata) => {
            if (err) return reject(err)
            resolve(metadata.format.duration ?? 0)
          })
        })
        results[fp] = dur
      } catch { results[fp] = null }
    }
    return results
  })

  // IPC: read file as buffer (async to avoid blocking main process)
  const MAX_AUDIO_FILE_SIZE = 500 * 1024 * 1024  // 500 MB
  ipcMain.handle('read-audio-file', (_event, filePath: string) => {
    if (!isSafeFilePath(filePath)) throw new Error('Invalid file path')
    if (!existsSync(filePath)) throw new Error('File not found: ' + filePath)
    const fileSize = statSync(filePath).size
    if (fileSize > MAX_AUDIO_FILE_SIZE) throw new Error(`File too large (${Math.round(fileSize / 1024 / 1024)} MB, max ${MAX_AUDIO_FILE_SIZE / 1024 / 1024} MB)`)
    return new Promise<ArrayBuffer>((resolve, reject) => {
      readFile(filePath, (err, buffer) => {
        if (err) return reject(err)
        resolve(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
      })
    })
  })

  // IPC: open video file dialog
  ipcMain.handle('open-video-dialog', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open Video File',
      filters: [
        { name: 'Video Files', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'mxf', 'ts'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // IPC: extract audio from video via ffmpeg
  ipcMain.handle('extract-audio-from-video', async (_event, filePath: string) => {
    if (!isSafeFilePath(filePath)) throw new Error('Invalid file path')
    if (!existsSync(filePath)) throw new Error('File not found: ' + filePath)

    const outPath = join(tmpdir(), `ltcast-video-audio-${Date.now()}.wav`)

    try {
      await new Promise<void>((resolve, reject) => {
        ffmpeg(filePath)
          .noVideo()
          .audioCodec('pcm_s16le')
          .audioFrequency(48000)
          .output(outPath)
          .on('end', () => resolve())
          .on('error', (err: Error) => {
            // Check for no audio stream
            if (err.message.includes('does not contain any stream') ||
                err.message.includes('Output file #0 does not contain any stream') ||
                err.message.toLowerCase().includes('no audio') ||
                err.message.includes('Invalid data found when processing input')) {
              reject(new Error('NO_AUDIO_TRACK'))
            } else {
              reject(err)
            }
          })
          .run()
      })

      const buffer = readFileSync(outPath)
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    } finally {
      // Clean up temp file whether ffmpeg succeeded or failed
      try { unlinkSync(outPath) } catch { /* ignore */ }
    }
  })

  ipcMain.handle('get-app-version', () => app.getVersion())
  ipcMain.handle('check-for-updates', () => checkForUpdates(false))

  // ── Window controls (custom title bar) ──
  ipcMain.handle('window:minimize', () => { BrowserWindow.getFocusedWindow()?.minimize() })
  ipcMain.handle('window:maximize', () => {
    const w = BrowserWindow.getFocusedWindow()
    if (w?.isMaximized()) w.unmaximize(); else w?.maximize()
  })
  ipcMain.handle('window:close', () => { BrowserWindow.getFocusedWindow()?.close() })

  // ── Art-Net Timecode IPC ──
  ipcMain.handle('artnet-start', () => {
    ensureArtnetSocket()
    return true
  })

  ipcMain.handle('artnet-stop', () => {
    closeArtnetSocket()
    return true
  })

  // High-frequency: use ipcMain.on (fire-and-forget) instead of handle for performance
  // Validate IPv4 address (each octet 0-255)
  const isValidIp = (ip: string): boolean => {
    const parts = ip.split('.')
    if (parts.length !== 4) return false
    return parts.every(p => { const n = Number(p); return Number.isInteger(n) && n >= 0 && n <= 255 })
  }

  ipcMain.on('artnet-send-tc', (_event, hours: number, minutes: number, seconds: number, frames: number, fps: number, targetIp: string) => {
    if (!artnetSocket) return
    const ip = (targetIp && isValidIp(targetIp)) ? targetIp : '255.255.255.255'
    artnetPacket.writeUInt8(frames & 0x1f, 14)
    artnetPacket.writeUInt8(seconds & 0x3f, 15)
    artnetPacket.writeUInt8(minutes & 0x3f, 16)
    artnetPacket.writeUInt8(hours & 0x1f, 17)
    artnetPacket.writeUInt8(artnetFpsToType(fps), 18)
    artnetSocket.send(artnetPacket, 0, 19, ARTNET_PORT, ip)
  })

  // ── OSC Output IPC ──
  ipcMain.handle('osc-start', () => {
    ensureOscSocket()
    return true
  })

  ipcMain.handle('osc-stop', () => {
    closeOscSocket()
    return true
  })

  // Shared UDP send helper: validates port, swallows per-send errors so a
  // transient bad target (ENETUNREACH) doesn't tear down the socket
  const safeUdpSend = (sock: dgram.Socket | null, pkt: Buffer, port: number, ip: string): void => {
    if (!sock) return
    if (!Number.isInteger(port) || port < 1 || port > 65535) return
    try {
      sock.send(pkt, 0, pkt.length, port, ip, (err) => {
        if (err) console.warn('[UDP] send failed:', err.code || err.message)
      })
    } catch (e) {
      console.warn('[UDP] sync send threw:', e)
    }
  }

  // Validate OSC address pattern per OSC 1.0 (starts with /, limited charset)
  const isValidOscAddress = (addr: string): boolean =>
    typeof addr === 'string' && addr.length > 0 && addr.length <= 256 &&
    addr.startsWith('/') && !/[\s#*,?[\]{}\x00-\x1f]/.test(addr)

  ipcMain.on('osc-send-tc', (_event, hours: number, minutes: number, seconds: number, frames: number, fps: number, targetIp: string, port: number) => {
    if (!oscSocket) return
    const ip = (targetIp && isValidIp(targetIp)) ? targetIp : '127.0.0.1'
    const pkt = oscMessage('/timecode', 'iiiii', hours, minutes, seconds, frames, fps)
    safeUdpSend(oscSocket, pkt, port, ip)
  })

  ipcMain.on('osc-send-tc-custom', (_event, address: string, tcString: string, fps: number, targetIp: string, port: number) => {
    if (!oscSocket) return
    if (!isValidOscAddress(address)) return
    const ip = (targetIp && isValidIp(targetIp)) ? targetIp : '127.0.0.1'
    const safeTcStr = typeof tcString === 'string' ? tcString.slice(0, 64) : ''
    const pkt = oscMessage(address, 'sf', safeTcStr, fps)
    safeUdpSend(oscSocket, pkt, port, ip)
  })

  ipcMain.on('osc-send-transport', (_event, state: string, targetIp: string, port: number) => {
    if (!oscSocket) return
    const ip = (targetIp && isValidIp(targetIp)) ? targetIp : '127.0.0.1'
    const addr = state === 'play' ? '/transport/play'
               : state === 'pause' ? '/transport/pause'
               : '/transport/stop'
    const pkt = oscMessage(addr, '')
    safeUdpSend(oscSocket, pkt, port, ip)
  })

  ipcMain.on('osc-send-song', (_event, name: string, index: number, targetIp: string, port: number) => {
    if (!oscSocket) return
    const ip = (targetIp && isValidIp(targetIp)) ? targetIp : '127.0.0.1'
    // Cap song name length to keep UDP packet below typical 1472 MTU
    const safeName = typeof name === 'string' ? name.slice(0, 256) : ''
    const safeIndex = Number.isInteger(index) ? index : 0
    const pkt = oscMessage('/song', 'si', safeName, safeIndex)
    safeUdpSend(oscSocket, pkt, port, ip)
  })

  // IPC: show input dialog (replacement for prompt())
  // ── License IPC ──
  ipcMain.handle('license-activate', async (_event, key: string) => lemonSqueezyRequest('activate', key))
  ipcMain.handle('license-deactivate', async (_event, key: string) => lemonSqueezyRequest('deactivate', key))
  ipcMain.handle('license-validate', async (_event, key: string) => lemonSqueezyRequest('validate', key))
  ipcMain.handle('license-status', async (_event, key: string) => checkLicenseStatus(key))
  // Authoritative Pro check — encrypted safeStorage, tamper-resistant
  ipcMain.handle('is-pro', () => computeIsPro())
  ipcMain.handle('print-to-pdf', async (_event, html: string, defaultName: string) => {
    const { dialog } = require('electron')
    const { writeFileSync } = require('fs')
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePath) return null
    const hiddenWin = new BrowserWindow({
      show: false, width: 800, height: 600,
      webPreferences: {
        nodeIntegration: false, contextIsolation: true, sandbox: true,
        javascript: false  // PDF content is static HTML — disable JS entirely
      }
    })
    // Inject a strict CSP so even if somehow untrusted HTML slips through
    // (current caller sanitizes, but future callers may not), no JS/remote/file
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; object-src 'none'; base-uri 'none'">`
    const safeHtml = html.includes('<head>') ? html.replace('<head>', `<head>${csp}`) : csp + html
    // try/finally so the hidden window is always torn down — otherwise a
    // failed loadURL / printToPDF leaks a renderer process per attempt.
    // destroy() is used instead of close() because JS is disabled in this
    // window so there's no unload handler to rely on.
    try {
      await hiddenWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(safeHtml)}`)
      const pdfBuffer = await hiddenWin.webContents.printToPDF({ printBackground: true, landscape: false })
      writeFileSync(result.filePath, pdfBuffer)
      return result.filePath
    } finally {
      try { hiddenWin.destroy() } catch { /* ignore */ }
    }
  })

  ipcMain.handle('clipboard-write', (_event, text: string) => {
    if (typeof text !== 'string' || text.length > 100_000) return
    const { clipboard } = require('electron')
    clipboard.writeText(text)
  })
  ipcMain.handle('open-external', async (_event, url: string) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('mailto:'))) {
      await shell.openExternal(url)
    }
  })
  ipcMain.handle('trial-check', async () => checkTrial())
  ipcMain.handle('get-machine-fingerprint', () => getMachineFingerprint())
  ipcMain.handle('promo-redeem', async (_event, code: string, email: string) => {
    try {
      const fingerprint = getMachineFingerprint()
      const { net } = require('electron')
      const resp = await net.fetch(`${WORKER_API}/promo/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, email, fingerprint })
      })
      return await resp.json()
    } catch {
      return { error: 'Network error' }
    }
  })

  ipcMain.handle('show-input-dialog', async (_event, title: string, label: string, defaultValue: string) => {
    const focusedWin = BrowserWindow.getFocusedWindow()
    if (!focusedWin) return null

    // Escape HTML to prevent injection
    const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const safeLabel = escapeHtml(label)
    const safeDefault = escapeHtml(defaultValue)
    const safeTitle = escapeHtml(title)
    const inputWin = new BrowserWindow({
      width: 360, height: process.platform === 'darwin' ? 180 : 150,
      parent: focusedWin,
      modal: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      backgroundColor: '#1a1a1a',
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
      show: false,
      title: safeTitle,
      autoHideMenuBar: true
    })

    const htmlContent = `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><style>
      body{margin:0;padding:20px;background:#1a1a1a;color:#e0e0e0;font-family:'Consolas',monospace;font-size:13px;display:flex;flex-direction:column;gap:12px}
      label{font-size:12px;color:#aaa}
      input{width:100%;box-sizing:border-box;background:#222;color:#fff;border:1px solid #3a3a3a;border-radius:4px;padding:8px;font-size:13px;outline:none;font-family:inherit}
      input:focus{border-color:#00d4ff}
      .btns{display:flex;gap:8px;justify-content:flex-end}
      button{background:#2a2a2a;color:#ccc;border:1px solid #3a3a3a;border-radius:4px;padding:6px 16px;font-size:12px;cursor:pointer;font-family:inherit}
      button:hover{background:#3a3a3a;color:#fff}
      .primary{background:#003a4a;border-color:#00d4ff;color:#00d4ff}
      .primary:hover{background:#004d5c}
    </style></head><body>
      <label>${safeLabel}</label>
      <input id="inp" value="${safeDefault}" autofocus />
      <div class="btns">
        <button onclick="done(null)">Cancel</button>
        <button class="primary" onclick="done(document.getElementById('inp').value)">OK</button>
      </div>
      <script>
        function done(v){window.__result=v;window.close()}
        document.getElementById('inp').addEventListener('keydown',e=>{
          if(e.key==='Enter')done(document.getElementById('inp').value);
          if(e.key==='Escape')done(null);
        });
      </script>
    </body></html>`

    inputWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent))
    inputWin.once('ready-to-show', () => inputWin.show())

    return new Promise<string | null>((resolve) => {
      let resolved = false
      const done = (val: string | null): void => {
        if (resolved) return
        resolved = true
        clearInterval(pollResult)
        resolve(val)
      }
      inputWin.on('closed', () => done(null))
      // Listen for result from the dialog
      const pollResult = setInterval(async () => {
        try {
          const result = await inputWin.webContents.executeJavaScript('window.__result')
          if (result !== undefined) {
            const val = result as string | null
            if (!inputWin.isDestroyed()) inputWin.close()
            done(val)
          }
        } catch { /* window closed */ done(null) }
      }, 100)
    })
  })

  // IPC: show confirm dialog (replacement for confirm())
  ipcMain.handle('show-confirm-dialog', async (_event, message: string) => {
    const focusedWin = BrowserWindow.getFocusedWindow() ?? win
    const result = await dialog.showMessageBox(focusedWin, {
      type: 'question',
      buttons: ['Cancel', 'OK'],
      defaultId: 1,
      cancelId: 0,
      message
    })
    return result.response === 1
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const newWin = createWindow()
      buildMenu(newWin, presetsDir)
      // Deliver any file that was opened while the window was closed
      newWin.webContents.on('did-finish-load', () => {
        if (pendingOpenFile) {
          newWin.webContents.send('open-ltcast-file', pendingOpenFile)
          pendingOpenFile = null
        }
      })
    }
  })
})

app.on('window-all-closed', () => {
  closeArtnetSocket()
  if (process.platform !== 'darwin') app.quit()
})
