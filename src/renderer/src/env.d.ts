/// <reference types="vite/client" />

interface Window {
  api: {
    // File operations
    openFileDialog(): Promise<string | null>
    openMultipleAudioDialog(): Promise<string[] | null>
    readAudioFile(path: string): Promise<ArrayBuffer>
    getAudioDurations(paths: string[]): Promise<Record<string, number | null>>
    getAppVersion(): Promise<string>
    checkForUpdates(): Promise<{ ok: boolean; updateAvailable?: boolean; version?: string; error?: string }>
    openVideoDialog(): Promise<string | null>
    extractAudioFromVideo(path: string): Promise<ArrayBuffer>

    // Dialog helpers
    showInputDialog(title: string, label: string, defaultValue?: string): Promise<string | null>
    showConfirmDialog(message: string): Promise<boolean>

    // License (LemonSqueezy)
    licenseActivate(key: string): Promise<{ valid: boolean; error?: string }>
    licenseDeactivate(key: string): Promise<{ valid: boolean; error?: string }>
    licenseValidate(key: string): Promise<{ valid: boolean; error?: string }>
    licenseStatus(key: string): Promise<{ status: string; tampered?: boolean; expiresAt?: string | null }>
    // Authoritative Pro check (main process with safeStorage-encrypted state)
    isPro(): Promise<{ isPro: boolean; reason: string }>

    // Trial
    trialCheck(): Promise<{ daysLeft: number; expired: boolean }>

    // Promo code redemption
    promoRedeem(code: string, email: string): Promise<{ ok: boolean; error?: string; licenseKey?: string; expiresAt?: string | null; alreadyRedeemed?: boolean }>

    // Preset / project management (filesystem)
    getLTCastPath(): Promise<string>
    listPresets(): Promise<Array<{ name: string; data: unknown; updatedAt: string }>>
    savePreset(name: string, data: unknown, filePath?: string): Promise<string>
    savePresetDialog(defaultName: string): Promise<string | null>
    deletePreset(name: string): Promise<boolean>
    openPresetsFolder(): Promise<void>
    importPreset(): Promise<{ name: string; data: unknown; updatedAt: string; path: string } | null>
    loadPresetFile(path: string): Promise<{ name: string; data: unknown; updatedAt: string } | null>
    addRecentFile(path: string, name: string): Promise<void>
    getRecentFiles(): Promise<Array<{ path: string; name: string }>>
    packageProject(name: string, data: unknown, audioPaths: string[]): Promise<string | null>
    importProject(): Promise<{ preset: { name: string; data: unknown; updatedAt: string }; audioPaths: string[]; projectDir: string; presetFilePath: string } | null>
    shareProjectZip(name: string, data: unknown, audioPaths: string[]): Promise<string | null>
    importLtcastProject(): Promise<{ preset: { name: string; data: unknown; updatedAt: string }; audioPaths: string[]; projectDir: string; presetFilePath: string } | null>

    // Export helpers
    saveCsvDialog(csvContent: string, defaultName: string): Promise<string | null>
    saveWavDialog(buffer: ArrayBuffer, defaultName: string): Promise<string | null>

    // Import: open CSV via file dialog, returns content as string
    openCsvDialog(): Promise<string | null>

    // Get filesystem path for a dragged File object (Electron 32+ requires webUtils)
    getPathForFile(file: File): string

    // File utilities
    fileExists(path: string): Promise<boolean>
    relinkFile(oldPath: string): Promise<string | null>
    scanFolderForFiles(folderPath: string, fileNames: string[]): Promise<Record<string, string>>

    // Art-Net Timecode
    artnetStart(): Promise<boolean>
    artnetStop(): Promise<boolean>
    artnetSendTc(hours: number, minutes: number, seconds: number, frames: number, fps: number, targetIp: string): void

    // OSC Output
    oscStart(): Promise<boolean>
    oscStop(): Promise<boolean>
    oscSendTc(hours: number, minutes: number, seconds: number, frames: number, fps: number, targetIp: string, port: number): void
    oscSendTransport(state: string, targetIp: string, port: number): void
    oscSendSong(name: string, index: number, targetIp: string, port: number): void
    oscSendTcCustom(address: string, tcString: string, fps: number, targetIp: string, port: number): void

    // OSC Feedback (F3) — INBOUND listener for /ltcast/tc_ack
    oscFeedbackStart(port: number, bindAddress: '127.0.0.1' | '0.0.0.0'): Promise<{ ok: true } | { ok: false; error: string }>
    oscFeedbackStop(): Promise<{ ok: true }>
    onOscFeedbackTc(callback: (data: { sourceId: string; h: number; m: number; s: number; f: number; ts: number }) => void): () => void
    onOscFeedbackError(callback: (data: { message: string }) => void): () => void

    // Menu command listeners
    onMenuCommand(channel: string, callback: (...args: unknown[]) => void): () => void

    // Open .ltcast file (from double-click / OS association)
    onOpenLTCastFile(callback: (filePath: string) => void): () => void

    // Art-Net socket failure notification
    onArtnetSocketFailed(callback: () => void): () => void

    // Auto-updater progress (v0.5.4 sprint A)
    onUpdateProgress(callback: (data: { percent: number; transferred: number; total: number; bytesPerSecond: number }) => void): () => void
    onUpdateProgressDismiss(callback: () => void): () => void
    onUpdateCancelledToast(callback: () => void): () => void
    updateCancel(): Promise<{ ok: true } | { ok: false; reason: string }>

    // Window controls (custom title bar)
    windowMinimize(): Promise<void>
    windowMaximize(): Promise<void>
    windowClose(): Promise<void>
    windowSetZoom(factor: number): Promise<void>

    // Open URL in default browser / email client
    openExternal(url: string): Promise<void>

    // PDF export (Chromium printToPDF — supports CJK)
    printToPdf(html: string, defaultName: string): Promise<{ ok: boolean; path?: string; error?: string }>

    // Clipboard
    copyToClipboard(text: string): Promise<{ ok: boolean; error?: string }>

    // Sprint D — F11: Auto Backup
    backupSnapshot(presetName: string, presetData: unknown): Promise<{ ok: boolean; path?: string; error?: string }>
    listBackups(presetName: string): Promise<Array<{ path: string; timestamp: string; sizeBytes: number }>>
    restoreBackup(backupPath: string): Promise<{ name: string; data: unknown } | null>
    deleteBackup(backupPath: string): Promise<{ ok: boolean; error?: string }>
    pruneBackups(presetName: string, keepN: number): Promise<{ ok: boolean; error?: string }>
    openBackupFolder(presetName: string): Promise<{ ok: boolean; error?: string }>

    // Platform detection
    platform: NodeJS.Platform
  }
}
