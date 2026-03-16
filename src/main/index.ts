import { app, shell, BrowserWindow, ipcMain, dialog, session, Menu } from 'electron'
import { join, basename, dirname } from 'path'
import { readFileSync, readFile, existsSync, unlinkSync, mkdirSync, writeFileSync, readdirSync, copyFileSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { is } from '@electron-toolkit/utils'
import ffmpeg from 'fluent-ffmpeg'
import dgram from 'dgram'

// Point fluent-ffmpeg at the bundled binary
// In production, ffmpeg-static is asarUnpacked so we resolve manually
const ffmpegBin = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
const ffmpegPath = app.isPackaged
  ? join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', ffmpegBin)
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
  const win = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1a1a1a',
    titleBarStyle: 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    show: false,
    title: 'CueSync'
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
  writeFileSync(recentFilesPath, JSON.stringify(files.slice(0, 10)), 'utf-8')
}

function addToRecentFiles(filePath: string, name: string): void {
  const files = loadRecentFiles().filter(f => f.path !== filePath)
  files.unshift({ path: filePath, name })
  saveRecentFiles(files.slice(0, 10))
}

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
        { label: 'Show in Explorer', click: () => { shell.openPath(presetsDir) } },
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

app.whenReady().then(() => {
  // Allow Web MIDI API (including SysEx) without permission prompt
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'midi' || permission === 'midiSysex') {
      callback(true)
    } else {
      callback(false)
    }
  })

  // ── CueSync Documents folder setup ──────────────────────────
  const documentsDir = app.getPath('documents')
  const cuesyncDir = join(documentsDir, 'CueSync')
  const presetsDir = join(cuesyncDir, 'Presets')
  const projectsDir = join(cuesyncDir, 'Projects')

  // Ensure directories exist on startup
  for (const dir of [cuesyncDir, presetsDir, projectsDir]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }

  const win = createWindow()
  buildMenu(win, presetsDir)

  // ── Handle .cuesync file opened via double-click ──────────
  let pendingOpenFile: string | null = null

  // Windows/Linux: file path passed as command-line argument
  const argv = process.argv
  for (const arg of argv) {
    if (arg.toLowerCase().endsWith('.cuesync') && existsSync(arg)) {
      pendingOpenFile = arg
      break
    }
  }

  // macOS: open-file event (may fire before or after ready)
  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    if (filePath.toLowerCase().endsWith('.cuesync')) {
      if (win.webContents.isLoading()) {
        pendingOpenFile = filePath
      } else {
        win.webContents.send('open-cuesync-file', filePath)
      }
    }
  })

  // Send pending file to renderer once it finishes loading
  win.webContents.on('did-finish-load', () => {
    if (pendingOpenFile) {
      win.webContents.send('open-cuesync-file', pendingOpenFile)
      pendingOpenFile = null
    }
  })

  // IPC: get CueSync base path
  ipcMain.handle('get-cuesync-path', () => cuesyncDir)

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
      const files = readdirSync(presetsDir).filter(f => f.endsWith('.cuesync'))
      return files.map(f => {
        const raw = readFileSync(join(presetsDir, f), 'utf-8')
        const data = JSON.parse(raw)
        return { name: data.name ?? f.replace('.cuesync', ''), data: data.data, updatedAt: data.updatedAt ?? '' }
      })
    } catch { return [] }
  })

  // IPC: save preset to a specific path (used when path is already known)
  ipcMain.handle('save-preset', (_event, name: string, data: unknown, filePath?: string) => {
    const dest = filePath ?? join(presetsDir, name.replace(/[<>:"/\\|?*]/g, '_') + '.cuesync')
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
      defaultPath: join(presetsDir, defaultName + '.cuesync'),
      filters: [
        { name: 'CueSync Preset', extensions: ['cuesync'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePath) return null
    return result.filePath
  })

  // IPC: delete preset from filesystem
  ipcMain.handle('delete-preset', (_event, name: string) => {
    const safeName = name.replace(/[<>:"/\\|?*]/g, '_')
    const filePath = join(presetsDir, safeName + '.cuesync')
    if (existsSync(filePath)) unlinkSync(filePath)
    return true
  })

  // IPC: open preset folder in file explorer
  ipcMain.handle('open-presets-folder', () => {
    shell.openPath(presetsDir)
  })

  // IPC: open a .cuesync file via dialog
  ipcMain.handle('import-preset', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open',
      defaultPath: presetsDir,
      filters: [
        { name: 'CueSync File', extensions: ['cuesync'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    try {
      const filePath = result.filePaths[0]
      const raw = readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      // Copy to presets folder if not already there
      const destPath = join(presetsDir, basename(filePath))
      if (filePath !== destPath) {
        writeFileSync(destPath, raw, 'utf-8')
      }
      return { name: parsed.name, data: parsed.data, updatedAt: parsed.updatedAt ?? '', path: filePath }
    } catch { return null }
  })

  // IPC: load a .cuesync file by path (for Open Recent)
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
    const presetFilePath = join(projectDir, safeName + '.cuesync')
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

  // IPC: import project — open a .cuesync file from any location
  ipcMain.handle('import-project', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open Project',
      defaultPath: projectsDir,
      filters: [
        { name: 'CueSync Preset', extensions: ['cuesync'] },
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
        audioPaths = readdirSync(audioDir).map(f => join(audioDir, f))
      }

      return {
        preset: { name: preset.name, data: preset.data, updatedAt: preset.updatedAt ?? '' },
        audioPaths,
        projectDir
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

  // IPC: open file dialog
  ipcMain.handle('open-file-dialog', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open Audio File',
      filters: [
        { name: 'Audio Files', extensions: ['wav', 'mp3', 'aiff', 'aif', 'flac', 'ogg'] },
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

    const outPath = join(tmpdir(), `cuesync-video-audio-${Date.now()}.wav`)

    await new Promise<void>((resolve, reject) => {
      ffmpeg(filePath)
        .noVideo()
        .audioCodec('pcm_s16le')
        .audioFrequency(48000)
        .audioChannels(1)
        .output(outPath)
        .on('end', () => resolve())
        .on('error', (err: Error) => {
          // Check for no audio stream
          if (err.message.includes('does not contain any stream') ||
              err.message.includes('Output file #0 does not contain any stream')) {
            reject(new Error('NO_AUDIO_TRACK'))
          } else {
            reject(err)
          }
        })
        .run()
    })

    const buffer = readFileSync(outPath)
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)

    // Clean up temp file
    try { unlinkSync(outPath) } catch { /* ignore */ }

    return arrayBuffer
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
    const focusedWin = BrowserWindow.getFocusedWindow()
    if (!focusedWin) return null

    // Escape HTML to prevent injection
    const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const safeLabel = escapeHtml(label)
    const safeDefault = escapeHtml(defaultValue)
    const safeTitle = escapeHtml(title)
    const inputWin = new BrowserWindow({
      width: 360, height: 150,
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

    const htmlContent = `<!DOCTYPE html><html><head><style>
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
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  closeArtnetSocket()
  if (process.platform !== 'darwin') app.quit()
})
