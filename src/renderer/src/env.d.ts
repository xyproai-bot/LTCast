/// <reference types="vite/client" />

interface Window {
  api: {
    // File operations
    openFileDialog(): Promise<string | null>
    openMultipleAudioDialog(): Promise<string[] | null>
    readAudioFile(path: string): Promise<ArrayBuffer>
    getAudioDurations(paths: string[]): Promise<Record<string, number | null>>
    getAppVersion(): Promise<string>
    openVideoDialog(): Promise<string | null>
    extractAudioFromVideo(path: string): Promise<ArrayBuffer>

    // Dialog helpers
    showInputDialog(title: string, label: string, defaultValue?: string): Promise<string | null>
    showConfirmDialog(message: string): Promise<boolean>

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

    // Menu command listeners
    onMenuCommand(channel: string, callback: (...args: unknown[]) => void): () => void

    // Open .ltcast file (from double-click / OS association)
    onOpenLTCastFile(callback: (filePath: string) => void): () => void

    // Art-Net socket failure notification
    onArtnetSocketFailed(callback: () => void): () => void

    // Platform detection
    platform: NodeJS.Platform
  }
}
