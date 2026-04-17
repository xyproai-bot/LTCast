import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('api', {
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  openMultipleAudioDialog: () => ipcRenderer.invoke('open-multiple-audio-dialog'),
  readAudioFile: (path: string) => ipcRenderer.invoke('read-audio-file', path),
  getAudioDurations: (paths: string[]) => ipcRenderer.invoke('get-audio-durations', paths),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  openVideoDialog: () => ipcRenderer.invoke('open-video-dialog'),
  extractAudioFromVideo: (path: string) => ipcRenderer.invoke('extract-audio-from-video', path),

  // Dialog helpers (replacement for prompt/confirm which don't work in Electron)
  showInputDialog: (title: string, label: string, defaultValue?: string) =>
    ipcRenderer.invoke('show-input-dialog', title, label, defaultValue ?? ''),
  showConfirmDialog: (message: string) =>
    ipcRenderer.invoke('show-confirm-dialog', message),

  // License (LemonSqueezy)
  licenseActivate: (key: string) => ipcRenderer.invoke('license-activate', key),
  licenseDeactivate: (key: string) => ipcRenderer.invoke('license-deactivate', key),
  licenseValidate: (key: string) => ipcRenderer.invoke('license-validate', key),
  licenseStatus: (key: string) => ipcRenderer.invoke('license-status', key),
  // Authoritative Pro check (main process with safeStorage-encrypted state)
  isPro: () => ipcRenderer.invoke('is-pro') as Promise<{ isPro: boolean; reason: string }>,

  // Trial
  trialCheck: () => ipcRenderer.invoke('trial-check'),

  // Promo code redemption
  promoRedeem: (code: string, email: string) => ipcRenderer.invoke('promo-redeem', code, email),

  // Preset / project management (filesystem-based)
  getLTCastPath: () => ipcRenderer.invoke('get-ltcast-path'),
  listPresets: () => ipcRenderer.invoke('list-presets'),
  savePreset: (name: string, data: unknown, filePath?: string) => ipcRenderer.invoke('save-preset', name, data, filePath),
  savePresetDialog: (defaultName: string) => ipcRenderer.invoke('save-preset-dialog', defaultName),
  deletePreset: (name: string) => ipcRenderer.invoke('delete-preset', name),
  openPresetsFolder: () => ipcRenderer.invoke('open-presets-folder'),
  importPreset: () => ipcRenderer.invoke('import-preset'),
  loadPresetFile: (path: string) => ipcRenderer.invoke('load-preset-file', path),
  addRecentFile: (path: string, name: string) => ipcRenderer.invoke('add-recent-file', path, name),
  getRecentFiles: () => ipcRenderer.invoke('get-recent-files'),
  packageProject: (name: string, data: unknown, audioPaths: string[]) =>
    ipcRenderer.invoke('package-project', name, data, audioPaths),
  importProject: () => ipcRenderer.invoke('import-project'),

  // Export: save CSV (setlist) via save dialog
  saveCsvDialog: (csvContent: string, defaultName: string) =>
    ipcRenderer.invoke('save-csv-dialog', csvContent, defaultName),

  // Import: open CSV (setlist) via open dialog, returns file content as string
  openCsvDialog: () =>
    ipcRenderer.invoke('open-csv-dialog'),

  // Export: save WAV (LTC) via save dialog
  saveWavDialog: (buffer: ArrayBuffer, defaultName: string) =>
    ipcRenderer.invoke('save-wav-dialog', buffer, defaultName),

  // Get filesystem path for a dragged File object (Electron 32+ requires webUtils)
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  // File utilities
  fileExists: (path: string) => ipcRenderer.invoke('file-exists', path),
  relinkFile: (oldPath: string) => ipcRenderer.invoke('relink-file', oldPath),
  scanFolderForFiles: (folderPath: string, fileNames: string[]) =>
    ipcRenderer.invoke('scan-folder-for-files', folderPath, fileNames) as Promise<Record<string, string>>,

  // Art-Net Timecode
  artnetStart: () => ipcRenderer.invoke('artnet-start'),
  artnetStop: () => ipcRenderer.invoke('artnet-stop'),
  artnetSendTc: (hours: number, minutes: number, seconds: number, frames: number, fps: number, targetIp: string) =>
    ipcRenderer.send('artnet-send-tc', hours, minutes, seconds, frames, fps, targetIp),

  // OSC Output
  oscStart: () => ipcRenderer.invoke('osc-start'),
  oscStop: () => ipcRenderer.invoke('osc-stop'),
  oscSendTc: (hours: number, minutes: number, seconds: number, frames: number, fps: number, targetIp: string, port: number) =>
    ipcRenderer.send('osc-send-tc', hours, minutes, seconds, frames, fps, targetIp, port),
  oscSendTransport: (state: string, targetIp: string, port: number) =>
    ipcRenderer.send('osc-send-transport', state, targetIp, port),
  oscSendSong: (name: string, index: number, targetIp: string, port: number) =>
    ipcRenderer.send('osc-send-song', name, index, targetIp, port),
  oscSendTcCustom: (address: string, tcString: string, fps: number, targetIp: string, port: number) =>
    ipcRenderer.send('osc-send-tc-custom', address, tcString, fps, targetIp, port),

  // Menu command listeners
  onMenuCommand: (channel: string, callback: (...args: unknown[]) => void) => {
    const handler = (_event: unknown, ...args: unknown[]): void => callback(...args)
    ipcRenderer.on(channel, handler)
    return () => { ipcRenderer.removeListener(channel, handler) }
  },

  // Open .ltcast file (from double-click / OS association)
  onOpenLTCastFile: (callback: (filePath: string) => void) => {
    const handler = (_event: unknown, filePath: string): void => callback(filePath)
    ipcRenderer.on('open-ltcast-file', handler)
    return () => { ipcRenderer.removeListener('open-ltcast-file', handler) }
  },

  // Art-Net socket failure notification (main process UDP socket died)
  onArtnetSocketFailed: (callback: () => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('artnet-socket-failed', handler)
    return () => { ipcRenderer.removeListener('artnet-socket-failed', handler) }
  },

  // Window controls (custom title bar)
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),

  // Open URL in default browser / email client
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  // PDF export (Chromium printToPDF — supports CJK)
  printToPdf: (html: string, defaultName: string) => ipcRenderer.invoke('print-to-pdf', html, defaultName),

  // Clipboard
  copyToClipboard: (text: string) => ipcRenderer.invoke('clipboard-write', text),

  // Platform detection (for platform-specific UI text)
  platform: process.platform
})
