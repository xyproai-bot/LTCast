/// <reference types="vite/client" />

interface Window {
  api: {
    // File operations
    openFileDialog(): Promise<string | null>
    openMultipleAudioDialog(): Promise<string[] | null>
    readAudioFile(path: string): Promise<ArrayBuffer>
    getAppVersion(): Promise<string>
    openVideoDialog(): Promise<string | null>
    extractAudioFromVideo(path: string): Promise<ArrayBuffer>

    // Dialog helpers
    showInputDialog(title: string, label: string, defaultValue?: string): Promise<string | null>
    showConfirmDialog(message: string): Promise<boolean>

    // Preset / project management (filesystem)
    getCueSyncPath(): Promise<string>
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
    importProject(): Promise<{ preset: { name: string; data: unknown; updatedAt: string }; audioPaths: string[]; projectDir: string } | null>

    // File utilities
    fileExists(path: string): Promise<boolean>
    relinkFile(oldPath: string): Promise<string | null>
    scanFolderForFiles(folderPath: string, fileNames: string[]): Promise<Record<string, string>>

    // Art-Net Timecode
    artnetStart(): Promise<boolean>
    artnetStop(): Promise<boolean>
    artnetSendTc(hours: number, minutes: number, seconds: number, frames: number, fps: number, targetIp: string): void

    // Menu command listeners
    onMenuCommand(channel: string, callback: (...args: unknown[]) => void): () => void

    // Open .cuesync file (from double-click / OS association)
    onOpenCueSyncFile(callback: (filePath: string) => void): () => void
  }
}
