import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('api', {
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  openMultipleAudioDialog: () => ipcRenderer.invoke('open-multiple-audio-dialog'),
  readAudioFile: (path: string) => ipcRenderer.invoke('read-audio-file', path),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  openVideoDialog: () => ipcRenderer.invoke('open-video-dialog'),
  extractAudioFromVideo: (path: string) => ipcRenderer.invoke('extract-audio-from-video', path),

  // Dialog helpers (replacement for prompt/confirm which don't work in Electron)
  showInputDialog: (title: string, label: string, defaultValue?: string) =>
    ipcRenderer.invoke('show-input-dialog', title, label, defaultValue ?? ''),
  showConfirmDialog: (message: string) =>
    ipcRenderer.invoke('show-confirm-dialog', message),

  // Preset / project management (filesystem-based)
  getCueSyncPath: () => ipcRenderer.invoke('get-cuesync-path'),
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

  // Menu command listeners
  onMenuCommand: (channel: string, callback: (...args: unknown[]) => void) => {
    const handler = (_event: unknown, ...args: unknown[]): void => callback(...args)
    ipcRenderer.on(channel, handler)
    return () => { ipcRenderer.removeListener(channel, handler) }
  },

  // Open .cuesync file (from double-click / OS association)
  onOpenCueSyncFile: (callback: (filePath: string) => void) => {
    const handler = (_event: unknown, filePath: string): void => callback(filePath)
    ipcRenderer.on('open-cuesync-file', handler)
    return () => { ipcRenderer.removeListener('open-cuesync-file', handler) }
  },

  // Platform detection (for platform-specific UI text)
  platform: process.platform
})
