import { app, shell, BrowserWindow, ipcMain, dialog, session, Menu, screen, nativeTheme } from 'electron'
import { join, basename, dirname } from 'path'
import { readFileSync, readFile, existsSync, unlinkSync, mkdirSync, writeFileSync, readdirSync, copyFileSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { is } from '@electron-toolkit/utils'
import ffmpeg from 'fluent-ffmpeg'
import dgram from 'dgram'


// Bypass chromium requirement for explicit user gestures before instantiating AudioContexts
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

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
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    show: false,
    title: 'LTCast'
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  // Block DevTools shortcuts (F12, Ctrl+Shift+I, Cmd+Option+I)
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.key === 'F12' ||
      (input.control && input.shift && input.key.toLowerCase() === 'i') ||
      (input.meta && input.alt && input.key.toLowerCase() === 'i')) {
      _e.preventDefault()
    }
  })

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
    if (permission === 'midi' || permission === 'midiSysex' || (permission as string) === 'speaker-selection' || (permission as string) === 'audiooutput') {
      return true
    }
    return false
  })

  // ── LTCast Documents folder setup ──────────────────────────
  const documentsDir = app.getPath('documents')
  const ltcastDir = join(documentsDir, 'LTCast')
  const presetsDir = join(ltcastDir, 'Presets')
  const projectsDir = join(ltcastDir, 'Projects')
  const audioDir = join(ltcastDir, 'Audio')

  // Ensure directories exist on startup
  for (const dir of [ltcastDir, presetsDir, projectsDir, audioDir]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }

  const win = createWindow()
  buildMenu(win, presetsDir)

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
      const results: Array<{ name: string; data: unknown; updatedAt: string }> = []
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

  // IPC: save preset to a specific path (used when path is already known)
  ipcMain.handle('save-preset', (_event, name: string, data: unknown, filePath?: string) => {
    const dest = filePath ?? join(presetsDir, name.replace(/[<>:"/\\|?*]/g, '_') + '.ltcast')
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
    return result.filePath
  })

  // IPC: delete preset from filesystem
  ipcMain.handle('delete-preset', (_event, name: string) => {
    const safeName = name.replace(/[<>:"/\\|?*]/g, '_')
    const filePath = join(presetsDir, safeName + '.ltcast')
    if (existsSync(filePath)) unlinkSync(filePath)
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

  // IPC: scan a directory (and subdirectories, max 10 levels) for files matching given filenames
  ipcMain.handle('scan-folder-for-files', (_e, folderPath: string, fileNames: string[]) => {
    const MAX_DEPTH = 10
    const result: Record<string, string> = {}
    const targets = new Set(fileNames.map(n => n.toLowerCase()))
    const scan = (dir: string, depth: number): void => {
      if (depth > MAX_DEPTH) return
      let entries: string[]
      try { entries = readdirSync(dir) } catch { return }
      for (const entry of entries) {
        const full = join(dir, entry)
        try {
          const st = statSync(full)
          if (st.isDirectory()) {
            scan(full, depth + 1)
          } else if (targets.has(entry.toLowerCase()) && !result[entry.toLowerCase()]) {
            result[entry.toLowerCase()] = full
          }
        } catch { /* skip inaccessible */ }
        // Early exit if all found
        if (Object.keys(result).length === targets.size) return
      }
    }
    scan(folderPath, 0)
    return result
  })

  // IPC: save a raw buffer to a user-chosen file location (e.g. Excel cue sheet)
  ipcMain.handle('save-file-buffer', async (_event, defaultName: string, filters: { name: string; extensions: string[] }[], buffer: ArrayBuffer) => {
    const result = await dialog.showSaveDialog({
      title: 'Save File',
      defaultPath: join(app.getPath('documents'), defaultName),
      filters
    })
    if (result.canceled || !result.filePath) return null
    writeFileSync(result.filePath, Buffer.from(buffer))
    return result.filePath
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

  // IPC: read file as buffer (async to avoid blocking main process)
  const MAX_AUDIO_FILE_SIZE = 500 * 1024 * 1024  // 500 MB
  ipcMain.handle('read-audio-file', (_event, filePath: string) => {
    if (!filePath || !existsSync(filePath)) throw new Error('File not found: ' + filePath)
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
    if (!filePath || !existsSync(filePath)) throw new Error('File not found: ' + filePath)

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

  // IPC: extract audio from video — saves to LTCast/Audio, returns path + buffer in ONE ffmpeg call
  ipcMain.handle('extract-audio-from-video-to-file', async (_event, videoPath: string) => {
    if (!videoPath || !existsSync(videoPath)) throw new Error('File not found: ' + videoPath)

    // Derive output filename from video name (strip video extension, add .wav)
    const videoBasename = basename(videoPath)
    const nameWithoutExt = videoBasename.includes('.')
      ? videoBasename.slice(0, videoBasename.lastIndexOf('.'))
      : videoBasename
    let outName = nameWithoutExt + '.wav'
    let outPath = join(audioDir, outName)

    // Avoid overwriting an existing file — append a counter
    let counter = 1
    while (existsSync(outPath)) {
      outName = `${nameWithoutExt} (${counter}).wav`
      outPath = join(audioDir, outName)
      counter++
    }

    await new Promise<void>((resolve, reject) => {
      ffmpeg(videoPath)
        .noVideo()
        .audioCodec('pcm_s16le')
        .audioFrequency(48000)
        .output(outPath)
        .on('end', () => resolve())
        .on('error', (err: Error) => {
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

    // Return only path and name — renderer reads the file separately via readAudioFile
    return { path: outPath, name: outName }
  })

  // IPC: generate LTC WAV file — encodes SMPTE timecode audio to a .wav file
  ipcMain.handle('generate-ltc-wav', async (_event, opts: {
    startTC: string    // "HH:MM:SS:FF"
    durationSec: number
    fps: number        // 24 | 25 | 29.97 | 30
    amplitude?: number // 0..1, default 0.8
  }) => {
    const { startTC, durationSec, fps, amplitude = 0.8 } = opts
    const SAMPLE_RATE = 48000

    // ── Parse start TC ─────────────────────────────────────────
    const parts = startTC.split(/[:;]/).map(Number)
    if (parts.length !== 4 || parts.some(isNaN)) throw new Error('Invalid startTC: ' + startTC)
    const [hh, mm, ss, ff] = parts
    const fpsInt = Math.round(fps)
    const isDF = fps === 29.97

    let startFrameNumber: number
    if (isDF) {
      const D = 2
      const framesPerMin = fpsInt * 60 - D
      const framesPer10Min = framesPerMin * 10 + D
      const framesPerHour = framesPer10Min * 6
      const tenMinBlocks = Math.floor(mm / 10)
      const mInBlock = mm % 10
      let fr = hh * framesPerHour + tenMinBlocks * framesPer10Min
      if (mInBlock === 0) {
        fr += ss * fpsInt + ff
      } else {
        fr += fpsInt * 60 + (mInBlock - 1) * framesPerMin + ss * fpsInt + ff
      }
      startFrameNumber = fr
    } else {
      startFrameNumber = hh * 3600 * fpsInt + mm * 60 * fpsInt + ss * fpsInt + ff
    }

    // ── LTC encoding ───────────────────────────────────────────
    const totalSamples = Math.ceil(durationSec * SAMPLE_RATE)
    const samplesPerFrame = SAMPLE_RATE / fps
    const samplesPerHalfBit = samplesPerFrame / 160  // 80 bits × 2 half-bits

    const frameCache = new Map<number, Uint8Array<ArrayBuffer>>()

    function encodeFrame(totalFrames: number): Uint8Array<ArrayBuffer> {
      if (frameCache.has(totalFrames)) return frameCache.get(totalFrames)!
      totalFrames = Math.max(0, totalFrames)
      let h: number, m: number, s: number, f: number

      if (isDF && fpsInt === 30) {
        const D = 2
        const fpm = fpsInt * 60 - D
        const fp10m = fpm * 10 + D
        const fph = fp10m * 6
        h = Math.floor(totalFrames / fph) % 24
        let rem = totalFrames - h * fph
        const tenBlocks = Math.floor(rem / fp10m)
        rem -= tenBlocks * fp10m
        let mInBlock: number
        if (rem < fpsInt * 60) {
          mInBlock = 0
        } else {
          rem -= fpsInt * 60
          mInBlock = 1 + Math.floor(rem / fpm)
          rem -= (mInBlock - 1) * fpm
        }
        m = tenBlocks * 10 + mInBlock
        s = Math.floor(rem / fpsInt)
        f = rem - s * fpsInt
      } else {
        h = Math.floor(totalFrames / (fpsInt * 3600)) % 24
        let rem = totalFrames - Math.floor(totalFrames / (fpsInt * 3600)) * fpsInt * 3600
        m = Math.floor(rem / (fpsInt * 60))
        rem -= m * fpsInt * 60
        s = Math.floor(rem / fpsInt)
        f = rem - s * fpsInt
      }

      const bits = new Uint8Array(new ArrayBuffer(80))
      // Frame units (bits 0-3)
      bits[0] = (f % 10) & 1; bits[1] = ((f % 10) >> 1) & 1
      bits[2] = ((f % 10) >> 2) & 1; bits[3] = ((f % 10) >> 3) & 1
      // Frame tens (bits 8-9)
      bits[8] = Math.floor(f / 10) & 1; bits[9] = (Math.floor(f / 10) >> 1) & 1
      // Drop frame flag (bit 10)
      bits[10] = isDF ? 1 : 0
      // Seconds units (bits 16-19)
      bits[16] = (s % 10) & 1; bits[17] = ((s % 10) >> 1) & 1
      bits[18] = ((s % 10) >> 2) & 1; bits[19] = ((s % 10) >> 3) & 1
      // Seconds tens (bits 24-26)
      bits[24] = Math.floor(s / 10) & 1; bits[25] = (Math.floor(s / 10) >> 1) & 1
      bits[26] = (Math.floor(s / 10) >> 2) & 1
      // Minutes units (bits 32-35)
      bits[32] = (m % 10) & 1; bits[33] = ((m % 10) >> 1) & 1
      bits[34] = ((m % 10) >> 2) & 1; bits[35] = ((m % 10) >> 3) & 1
      // Minutes tens (bits 40-42)
      bits[40] = Math.floor(m / 10) & 1; bits[41] = (Math.floor(m / 10) >> 1) & 1
      bits[42] = (Math.floor(m / 10) >> 2) & 1
      // Hours units (bits 48-51)
      bits[48] = (h % 10) & 1; bits[49] = ((h % 10) >> 1) & 1
      bits[50] = ((h % 10) >> 2) & 1; bits[51] = ((h % 10) >> 3) & 1
      // Hours tens (bits 56-57)
      bits[56] = Math.floor(h / 10) & 1; bits[57] = (Math.floor(h / 10) >> 1) & 1
      // Sync word (bits 64-79): 0011 1111 1111 1101
      bits[64]=0; bits[65]=0; bits[66]=1; bits[67]=1
      bits[68]=1; bits[69]=1; bits[70]=1; bits[71]=1
      bits[72]=1; bits[73]=1; bits[74]=1; bits[75]=1
      bits[76]=1; bits[77]=1; bits[78]=0; bits[79]=1

      frameCache.set(totalFrames, bits)
      return bits
    }

    // Generate PCM samples using biphase mark encoding
    const pcm = new Int16Array(totalSamples)
    let phase = 1
    let lastHalfBitIdx = -1
    let lastEncodedFrameIdx = -1
    let currentBits: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(80))

    for (let i = 0; i < totalSamples; i++) {
      const frameIdx = Math.floor(i / samplesPerFrame)
      const sampleInFrame = i - frameIdx * samplesPerFrame
      const halfBitIdx = Math.floor(sampleInFrame / samplesPerHalfBit)

      if (frameIdx !== lastEncodedFrameIdx) {
        lastEncodedFrameIdx = frameIdx
        currentBits = encodeFrame(startFrameNumber + frameIdx)
      }

      if (halfBitIdx !== lastHalfBitIdx) {
        lastHalfBitIdx = halfBitIdx
        const bitIdx = halfBitIdx >> 1
        const isSecondHalf = (halfBitIdx & 1) === 1
        if (!isSecondHalf) {
          phase = -phase  // always transition at start of bit
        } else {
          if (bitIdx < 80 && currentBits[bitIdx] === 1) {
            phase = -phase  // midpoint transition only for bit '1'
          }
        }
      }

      pcm[i] = Math.round(phase * amplitude * 32767)
    }

    // ── Write WAV ──────────────────────────────────────────────
    // WAV header: RIFF/WAVE, PCM 16-bit mono 48kHz
    const dataSize = pcm.byteLength
    const headerSize = 44
    const buf = Buffer.alloc(headerSize + dataSize)
    // RIFF chunk
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8)
    // fmt chunk
    buf.write('fmt ', 12); buf.writeUInt32LE(16, 16)
    buf.writeUInt16LE(1, 20)          // PCM
    buf.writeUInt16LE(1, 22)          // mono
    buf.writeUInt32LE(SAMPLE_RATE, 24)
    buf.writeUInt32LE(SAMPLE_RATE * 2, 28) // byte rate
    buf.writeUInt16LE(2, 32)          // block align
    buf.writeUInt16LE(16, 34)         // bits per sample
    // data chunk
    buf.write('data', 36); buf.writeUInt32LE(dataSize, 40)
    // Copy PCM data into WAV buffer
    const pcmBuf = Buffer.from(pcm.buffer.slice(0) as ArrayBuffer)
    pcmBuf.copy(buf, headerSize)


    // Build output filename
    const tcSafe = startTC.replace(/:/g, '-')
    const fpsLabel = fps === 29.97 ? '29df' : String(fpsInt)
    const durLabel = durationSec >= 3600
      ? `${Math.floor(durationSec / 3600)}h${Math.floor((durationSec % 3600) / 60)}m`
      : durationSec >= 60
        ? `${Math.floor(durationSec / 60)}m${durationSec % 60}s`
        : `${durationSec}s`
    let outName = `LTC_${tcSafe}_${fpsLabel}fps_${durLabel}.wav`
    let outPath = join(audioDir, outName)

    let counter = 1
    while (existsSync(outPath)) {
      outName = `LTC_${tcSafe}_${fpsLabel}fps_${durLabel} (${counter}).wav`
      outPath = join(audioDir, outName)
      counter++
    }

    writeFileSync(outPath, buf)
    return { path: outPath, name: outName }
  })

  ipcMain.handle('get-app-version', () => app.getVersion())


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

  // IPC: show input dialog (replacement for prompt())
  ipcMain.handle('show-input-dialog', async (_event, title: string, label: string, defaultValue: string) => {
    const focusedWin = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
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
