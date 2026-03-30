"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("api", {
  openFileDialog: () => electron.ipcRenderer.invoke("open-file-dialog"),
  openMultipleAudioDialog: () => electron.ipcRenderer.invoke("open-multiple-audio-dialog"),
  readAudioFile: (path) => electron.ipcRenderer.invoke("read-audio-file", path),
  getAppVersion: () => electron.ipcRenderer.invoke("get-app-version"),
  openVideoDialog: () => electron.ipcRenderer.invoke("open-video-dialog"),
  extractAudioFromVideo: (path) => electron.ipcRenderer.invoke("extract-audio-from-video", path),
  extractAudioFromVideoToFile: (path) => electron.ipcRenderer.invoke("extract-audio-from-video-to-file", path),
  generateLtcWav: (opts) => electron.ipcRenderer.invoke("generate-ltc-wav", opts),
  // Dialog helpers (replacement for prompt/confirm which don't work in Electron)
  showInputDialog: (title, label, defaultValue) => electron.ipcRenderer.invoke("show-input-dialog", title, label, defaultValue ?? ""),
  showConfirmDialog: (message) => electron.ipcRenderer.invoke("show-confirm-dialog", message),
  // Preset / project management (filesystem-based)
  getLTCastPath: () => electron.ipcRenderer.invoke("get-ltcast-path"),
  listPresets: () => electron.ipcRenderer.invoke("list-presets"),
  savePreset: (name, data, filePath) => electron.ipcRenderer.invoke("save-preset", name, data, filePath),
  savePresetDialog: (defaultName) => electron.ipcRenderer.invoke("save-preset-dialog", defaultName),
  deletePreset: (name) => electron.ipcRenderer.invoke("delete-preset", name),
  openPresetsFolder: () => electron.ipcRenderer.invoke("open-presets-folder"),
  importPreset: () => electron.ipcRenderer.invoke("import-preset"),
  loadPresetFile: (path) => electron.ipcRenderer.invoke("load-preset-file", path),
  addRecentFile: (path, name) => electron.ipcRenderer.invoke("add-recent-file", path, name),
  getRecentFiles: () => electron.ipcRenderer.invoke("get-recent-files"),
  packageProject: (name, data, audioPaths) => electron.ipcRenderer.invoke("package-project", name, data, audioPaths),
  importProject: () => electron.ipcRenderer.invoke("import-project"),
  // Save a raw buffer to a user-chosen file location (e.g. cue sheet Excel)
  saveFileBuffer: (defaultName, filters, buffer) => electron.ipcRenderer.invoke("save-file-buffer", defaultName, filters, buffer),
  // Get filesystem path for a dragged File object (Electron 32+ requires webUtils)
  getPathForFile: (file) => electron.webUtils.getPathForFile(file),
  // File utilities
  fileExists: (path) => electron.ipcRenderer.invoke("file-exists", path),
  relinkFile: (oldPath) => electron.ipcRenderer.invoke("relink-file", oldPath),
  scanFolderForFiles: (folderPath, fileNames) => electron.ipcRenderer.invoke("scan-folder-for-files", folderPath, fileNames),
  // Art-Net Timecode
  artnetStart: () => electron.ipcRenderer.invoke("artnet-start"),
  artnetStop: () => electron.ipcRenderer.invoke("artnet-stop"),
  artnetSendTc: (hours, minutes, seconds, frames, fps, targetIp) => electron.ipcRenderer.send("artnet-send-tc", hours, minutes, seconds, frames, fps, targetIp),
  // Menu command listeners
  onMenuCommand: (channel, callback) => {
    const handler = (_event, ...args) => callback(...args);
    electron.ipcRenderer.on(channel, handler);
    return () => {
      electron.ipcRenderer.removeListener(channel, handler);
    };
  },
  // Open .ltcast file (from double-click / OS association)
  onOpenLTCastFile: (callback) => {
    const handler = (_event, filePath) => callback(filePath);
    electron.ipcRenderer.on("open-ltcast-file", handler);
    return () => {
      electron.ipcRenderer.removeListener("open-ltcast-file", handler);
    };
  },
  // Art-Net socket failure notification (main process UDP socket died)
  onArtnetSocketFailed: (callback) => {
    const handler = () => callback();
    electron.ipcRenderer.on("artnet-socket-failed", handler);
    return () => {
      electron.ipcRenderer.removeListener("artnet-socket-failed", handler);
    };
  },
  // Platform detection (for platform-specific UI text)
  platform: process.platform
});
