"use strict";
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const utils = require("@electron-toolkit/utils");
const ffmpeg = require("fluent-ffmpeg");
const dgram = require("dgram");
electron.app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const ffmpegBin = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
const ffmpegPath = electron.app.isPackaged ? (() => {
  const base = path.join(process.resourcesPath, "app.asar.unpacked", "node_modules", "ffmpeg-static");
  if (process.platform === "darwin") {
    const archPath = path.join(base, "bin", "darwin", process.arch, "ffmpeg");
    if (fs.existsSync(archPath)) return archPath;
  }
  return path.join(base, ffmpegBin);
})() : require("ffmpeg-static");
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
const ARTNET_PORT = 6454;
let artnetSocket = null;
const artnetPacket = Buffer.alloc(19);
artnetPacket.write("Art-Net\0", 0, 8, "ascii");
artnetPacket.writeUInt16LE(38656, 8);
artnetPacket.writeUInt8(0, 10);
artnetPacket.writeUInt8(14, 11);
artnetPacket.writeUInt8(0, 12);
artnetPacket.writeUInt8(0, 13);
function artnetFpsToType(fps) {
  if (fps === 24) return 0;
  if (fps === 25) return 1;
  if (fps === 29.97) return 2;
  return 3;
}
function ensureArtnetSocket() {
  if (artnetSocket) return;
  artnetSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  artnetSocket.on("error", (err) => {
    console.error("Art-Net socket error:", err);
    artnetSocket?.close();
    artnetSocket = null;
    electron.BrowserWindow.getAllWindows().forEach((w) => {
      if (!w.isDestroyed()) w.webContents.send("artnet-socket-failed");
    });
  });
  artnetSocket.bind(() => {
    artnetSocket?.setBroadcast(true);
  });
}
function closeArtnetSocket() {
  if (artnetSocket) {
    try {
      artnetSocket.close();
    } catch {
    }
    artnetSocket = null;
  }
}
function createWindow() {
  const { workArea } = electron.screen.getPrimaryDisplay();
  const winW = Math.min(1100, Math.max(900, workArea.width));
  const winH = Math.min(700, Math.max(520, Math.floor(workArea.height * 0.85)));
  const win = new electron.BrowserWindow({
    width: winW,
    height: winH,
    minWidth: 860,
    minHeight: 500,
    backgroundColor: "#1a1a1a",
    // hiddenInset on Mac: hides the native title bar chrome but keeps the
    // traffic light buttons inset into the content area (no double-header)
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    show: false,
    title: "LTCast"
  });
  win.on("ready-to-show", () => {
    win.show();
  });
  win.webContents.on("before-input-event", (_e, input) => {
    if (input.key === "F12" || input.control && input.shift && input.key.toLowerCase() === "i" || input.meta && input.alt && input.key.toLowerCase() === "i") {
      _e.preventDefault();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      electron.shell.openExternal(url);
    }
    return { action: "deny" };
  });
  if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  win.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    const prefix = ["LOG", "WARN", "ERR ", "DBG "][level] ?? "LOG";
    console.log(`[renderer:${prefix}] ${message} (${sourceId}:${line})`);
  });
  return win;
}
const recentFilesPath = path.join(electron.app.getPath("userData"), "recent-files.json");
function loadRecentFiles() {
  try {
    if (fs.existsSync(recentFilesPath)) {
      return JSON.parse(fs.readFileSync(recentFilesPath, "utf-8"));
    }
  } catch {
  }
  return [];
}
function saveRecentFiles(files) {
  try {
    fs.writeFileSync(recentFilesPath, JSON.stringify(files.slice(0, 10)), "utf-8");
  } catch {
  }
}
function addToRecentFiles(filePath, name) {
  const files = loadRecentFiles().filter((f) => f.path !== filePath);
  files.unshift({ path: filePath, name });
  saveRecentFiles(files.slice(0, 10));
}
let pendingOpenFile = null;
electron.app.on("open-file", (event, filePath) => {
  event.preventDefault();
  if (filePath.toLowerCase().endsWith(".ltcast")) {
    const win = electron.BrowserWindow.getAllWindows()[0];
    if (win && !win.webContents.isLoading()) {
      win.webContents.send("open-ltcast-file", filePath);
    } else {
      pendingOpenFile = filePath;
    }
  }
});
let currentWin = null;
function buildMenu(win, presetsDir) {
  currentWin = win;
  const isMac = process.platform === "darwin";
  const send = (channel, ...args) => {
    win.webContents.send(channel, ...args);
  };
  const recentFiles = loadRecentFiles();
  const recentSubmenu = recentFiles.length > 0 ? [
    ...recentFiles.map((f) => ({
      label: f.name,
      click: () => send("menu-open-recent", f.path)
    })),
    { type: "separator" },
    { label: "Clear Recent", click: () => {
      saveRecentFiles([]);
      rebuildMenu(presetsDir);
    } }
  ] : [{ label: "No Recent Files", enabled: false }];
  const template = [
    ...isMac ? [{
      label: electron.app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    }] : [],
    {
      label: "File",
      submenu: [
        { label: "New", accelerator: "CmdOrCtrl+N", click: () => send("menu-new-preset") },
        { label: "Open...", accelerator: "CmdOrCtrl+O", click: () => send("menu-import-preset") },
        { label: "Open Recent", submenu: recentSubmenu },
        { type: "separator" },
        { label: "Save", accelerator: "CmdOrCtrl+S", click: () => send("menu-save-preset") },
        { label: "Save As...", accelerator: "CmdOrCtrl+Shift+S", click: () => send("menu-save-preset-as") },
        { type: "separator" },
        { label: "Collect Project...", click: () => send("menu-package-project") },
        { label: "Open Project...", click: () => send("menu-import-project") },
        { type: "separator" },
        { label: isMac ? "Show in Finder" : "Show in Explorer", click: () => {
          electron.shell.openPath(presetsDir);
        } },
        { type: "separator" },
        ...isMac ? [] : [{ role: "quit" }]
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    }
  ];
  electron.Menu.setApplicationMenu(electron.Menu.buildFromTemplate(template));
}
function rebuildMenu(presetsDir) {
  if (currentWin) buildMenu(currentWin, presetsDir);
}
if (process.platform === "darwin") {
  electron.app.setAboutPanelOptions({
    applicationName: "LTCast",
    applicationVersion: electron.app.getVersion(),
    copyright: "Copyright © 2024 LTCast",
    credits: "LTC Timecode player and MTC/Art-Net sender"
  });
}
electron.app.whenReady().then(() => {
  electron.nativeTheme.themeSource = "dark";
  electron.session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === "midi" || permission === "midiSysex" || permission === "speaker-selection") {
      callback(true);
    } else {
      callback(false);
    }
  });
  electron.session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    if (permission === "midi" || permission === "midiSysex" || permission === "speaker-selection" || permission === "audiooutput") {
      return true;
    }
    return false;
  });
  const documentsDir = electron.app.getPath("documents");
  const ltcastDir = path.join(documentsDir, "LTCast");
  const presetsDir = path.join(ltcastDir, "Presets");
  const projectsDir = path.join(ltcastDir, "Projects");
  const audioDir = path.join(ltcastDir, "Audio");
  for (const dir of [ltcastDir, presetsDir, projectsDir, audioDir]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  const win = createWindow();
  buildMenu(win, presetsDir);
  const argv = process.argv;
  for (const arg of argv) {
    if (arg.toLowerCase().endsWith(".ltcast") && fs.existsSync(arg)) {
      pendingOpenFile = arg;
      break;
    }
  }
  win.webContents.on("did-finish-load", () => {
    if (pendingOpenFile) {
      win.webContents.send("open-ltcast-file", pendingOpenFile);
      pendingOpenFile = null;
    }
  });
  if (electron.app.isPackaged && (process.platform === "win32" || process.platform === "darwin")) {
    const vbcableFlagPath = path.join(electron.app.getPath("userData"), "vbcable-prompted.json");
    if (!fs.existsSync(vbcableFlagPath)) {
      fs.writeFileSync(vbcableFlagPath, '{"prompted":true}', "utf-8");
      const isMacPrompt = process.platform === "darwin";
      setTimeout(async () => {
        const result = await electron.dialog.showMessageBox(win, {
          type: "info",
          title: "Virtual Audio Cable Recommended",
          message: "LTCast requires a virtual audio cable to output LTC via software.",
          detail: isMacPrompt ? "BlackHole is a free virtual audio device that lets LTCast send LTC timecode to other software on your Mac.\n\nIf you're using a physical audio interface to output LTC, you can skip this." : "VB-CABLE is a free virtual audio device that lets LTCast send LTC timecode to other software on your computer.\n\nIf you're using a physical audio interface to output LTC, you can skip this.",
          buttons: [isMacPrompt ? "Download BlackHole (Free)" : "Download VB-CABLE (Free)", "Skip"],
          defaultId: 0,
          cancelId: 1
        });
        if (result.response === 0) {
          electron.shell.openExternal(
            isMacPrompt ? "https://existential.audio/blackhole/" : "https://vb-audio.com/Cable/index.htm"
          );
        }
      }, 2e3);
    }
  }
  electron.ipcMain.handle("get-ltcast-path", () => ltcastDir);
  electron.ipcMain.handle("add-recent-file", (_event, filePath, name) => {
    addToRecentFiles(filePath, name);
    rebuildMenu(presetsDir);
  });
  electron.ipcMain.handle("get-recent-files", () => loadRecentFiles());
  electron.ipcMain.handle("list-presets", () => {
    try {
      const files = fs.readdirSync(presetsDir).filter((f) => f.endsWith(".ltcast"));
      const results = [];
      for (const f of files) {
        try {
          const raw = fs.readFileSync(path.join(presetsDir, f), "utf-8");
          const data = JSON.parse(raw);
          results.push({ name: data.name ?? f.replace(".ltcast", ""), data: data.data, updatedAt: data.updatedAt ?? "" });
        } catch {
        }
      }
      return results;
    } catch {
      return [];
    }
  });
  electron.ipcMain.handle("save-preset", (_event, name, data, filePath) => {
    const dest = filePath ?? path.join(presetsDir, name.replace(/[<>:"/\\|?*]/g, "_") + ".ltcast");
    const dir = path.dirname(dest);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const content = JSON.stringify({ name, data, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }, null, 2);
    fs.writeFileSync(dest, content, "utf-8");
    return dest;
  });
  electron.ipcMain.handle("save-preset-dialog", async (_event, defaultName) => {
    const result = await electron.dialog.showSaveDialog({
      title: "Save Preset",
      defaultPath: path.join(presetsDir, defaultName + ".ltcast"),
      filters: [
        { name: "LTCast Preset", extensions: ["ltcast"] },
        { name: "All Files", extensions: ["*"] }
      ]
    });
    if (result.canceled || !result.filePath) return null;
    return result.filePath;
  });
  electron.ipcMain.handle("delete-preset", (_event, name) => {
    const safeName = name.replace(/[<>:"/\\|?*]/g, "_");
    const filePath = path.join(presetsDir, safeName + ".ltcast");
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return true;
  });
  electron.ipcMain.handle("open-presets-folder", () => {
    electron.shell.openPath(presetsDir);
  });
  electron.ipcMain.handle("import-preset", async () => {
    const result = await electron.dialog.showOpenDialog({
      title: "Open",
      defaultPath: presetsDir,
      filters: [
        { name: "LTCast File", extensions: ["ltcast"] },
        { name: "All Files", extensions: ["*"] }
      ],
      properties: ["openFile"]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    try {
      const filePath = result.filePaths[0];
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      const destPath = path.join(presetsDir, path.basename(filePath));
      if (filePath !== destPath && !fs.existsSync(destPath)) {
        fs.writeFileSync(destPath, raw, "utf-8");
      }
      return { name: parsed.name, data: parsed.data, updatedAt: parsed.updatedAt ?? "", path: filePath };
    } catch {
      return null;
    }
  });
  electron.ipcMain.handle("load-preset-file", (_event, filePath) => {
    try {
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      return { name: parsed.name, data: parsed.data, updatedAt: parsed.updatedAt ?? "" };
    } catch {
      return null;
    }
  });
  electron.ipcMain.handle("package-project", async (_event, presetName, presetData, audioPaths) => {
    const result = await electron.dialog.showOpenDialog({
      title: "Choose Project Location",
      defaultPath: projectsDir,
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const parentDir = result.filePaths[0];
    const safeName = presetName.replace(/[<>:"/\\|?*]/g, "_");
    const projectDir = path.join(parentDir, safeName);
    const audioDir2 = path.join(projectDir, "Audio");
    fs.mkdirSync(audioDir2, { recursive: true });
    const copiedMap = {};
    for (const srcPath of audioPaths) {
      if (fs.existsSync(srcPath)) {
        const fileName = path.basename(srcPath);
        const destPath = path.join(audioDir2, fileName);
        let finalDest = destPath;
        let counter = 1;
        while (fs.existsSync(finalDest)) {
          const ext = fileName.includes(".") ? "." + fileName.split(".").pop() : "";
          const base = ext ? fileName.slice(0, -ext.length) : fileName;
          finalDest = path.join(audioDir2, `${base} (${counter})${ext}`);
          counter++;
        }
        fs.copyFileSync(srcPath, finalDest);
        copiedMap[srcPath] = finalDest;
      }
    }
    const updatedData = JSON.parse(JSON.stringify(presetData));
    if (updatedData.setlist) {
      updatedData.setlist = updatedData.setlist.map((item) => {
        const copied = copiedMap[item.path];
        return copied ? { ...item, path: copied } : item;
      });
    }
    const presetFilePath = path.join(projectDir, safeName + ".ltcast");
    const content = JSON.stringify({
      name: presetName,
      data: updatedData,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    }, null, 2);
    fs.writeFileSync(presetFilePath, content, "utf-8");
    electron.shell.openPath(projectDir);
    return projectDir;
  });
  electron.ipcMain.handle("import-project", async () => {
    const result = await electron.dialog.showOpenDialog({
      title: "Open Project",
      defaultPath: projectsDir,
      filters: [
        { name: "LTCast Preset", extensions: ["ltcast"] },
        { name: "All Files", extensions: ["*"] }
      ],
      properties: ["openFile"]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    try {
      const presetFilePath = result.filePaths[0];
      const raw = fs.readFileSync(presetFilePath, "utf-8");
      const preset = JSON.parse(raw);
      const projectDir = path.dirname(presetFilePath);
      const audioDir2 = path.join(projectDir, "Audio");
      let audioPaths = [];
      if (fs.existsSync(audioDir2)) {
        audioPaths = fs.readdirSync(audioDir2).map((f) => path.join(audioDir2, f)).filter((p) => {
          try {
            return fs.statSync(p).isFile();
          } catch {
            return false;
          }
        });
      }
      return {
        preset: { name: preset.name, data: preset.data, updatedAt: preset.updatedAt ?? "" },
        audioPaths,
        projectDir,
        presetFilePath
      };
    } catch {
      return null;
    }
  });
  electron.ipcMain.handle("file-exists", (_e, filePath) => {
    return fs.existsSync(filePath);
  });
  electron.ipcMain.handle("relink-file", async (_e, oldPath) => {
    const oldName = path.basename(oldPath);
    const result = await electron.dialog.showOpenDialog({
      title: `Locate "${oldName}"`,
      filters: [
        { name: "Audio Files", extensions: ["wav", "mp3", "aiff", "aif", "flac", "ogg", "m4a"] },
        { name: "All Files", extensions: ["*"] }
      ],
      properties: ["openFile"]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  electron.ipcMain.handle("scan-folder-for-files", (_e, folderPath, fileNames) => {
    const MAX_DEPTH = 10;
    const result = {};
    const targets = new Set(fileNames.map((n) => n.toLowerCase()));
    const scan = (dir, depth) => {
      if (depth > MAX_DEPTH) return;
      let entries;
      try {
        entries = fs.readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry);
        try {
          const st = fs.statSync(full);
          if (st.isDirectory()) {
            scan(full, depth + 1);
          } else if (targets.has(entry.toLowerCase()) && !result[entry.toLowerCase()]) {
            result[entry.toLowerCase()] = full;
          }
        } catch {
        }
        if (Object.keys(result).length === targets.size) return;
      }
    };
    scan(folderPath, 0);
    return result;
  });
  electron.ipcMain.handle("save-file-buffer", async (_event, defaultName, filters, buffer) => {
    const result = await electron.dialog.showSaveDialog({
      title: "Save File",
      defaultPath: path.join(electron.app.getPath("documents"), defaultName),
      filters
    });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, Buffer.from(buffer));
    return result.filePath;
  });
  electron.ipcMain.handle("open-file-dialog", async () => {
    const result = await electron.dialog.showOpenDialog({
      title: "Open Audio File",
      filters: [
        { name: "Audio Files", extensions: ["wav", "mp3", "aiff", "aif", "flac", "ogg", "m4a"] },
        { name: "All Files", extensions: ["*"] }
      ],
      properties: ["openFile"]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  electron.ipcMain.handle("open-multiple-audio-dialog", async () => {
    const result = await electron.dialog.showOpenDialog({
      title: "Add Audio Files to Setlist",
      filters: [
        { name: "Audio Files", extensions: ["wav", "mp3", "aiff", "aif", "flac", "ogg", "m4a"] },
        { name: "All Files", extensions: ["*"] }
      ],
      properties: ["openFile", "multiSelections"]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths;
  });
  const MAX_AUDIO_FILE_SIZE = 500 * 1024 * 1024;
  electron.ipcMain.handle("read-audio-file", (_event, filePath) => {
    if (!filePath || !fs.existsSync(filePath)) throw new Error("File not found: " + filePath);
    const fileSize = fs.statSync(filePath).size;
    if (fileSize > MAX_AUDIO_FILE_SIZE) throw new Error(`File too large (${Math.round(fileSize / 1024 / 1024)} MB, max ${MAX_AUDIO_FILE_SIZE / 1024 / 1024} MB)`);
    return new Promise((resolve, reject) => {
      fs.readFile(filePath, (err, buffer) => {
        if (err) return reject(err);
        resolve(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
      });
    });
  });
  electron.ipcMain.handle("open-video-dialog", async () => {
    const result = await electron.dialog.showOpenDialog({
      title: "Open Video File",
      filters: [
        { name: "Video Files", extensions: ["mp4", "mov", "mkv", "avi", "webm", "mxf", "ts"] },
        { name: "All Files", extensions: ["*"] }
      ],
      properties: ["openFile"]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  electron.ipcMain.handle("extract-audio-from-video", async (_event, filePath) => {
    if (!filePath || !fs.existsSync(filePath)) throw new Error("File not found: " + filePath);
    const outPath = path.join(os.tmpdir(), `ltcast-video-audio-${Date.now()}.wav`);
    try {
      await new Promise((resolve, reject) => {
        ffmpeg(filePath).noVideo().audioCodec("pcm_s16le").audioFrequency(48e3).output(outPath).on("end", () => resolve()).on("error", (err) => {
          if (err.message.includes("does not contain any stream") || err.message.includes("Output file #0 does not contain any stream") || err.message.toLowerCase().includes("no audio") || err.message.includes("Invalid data found when processing input")) {
            reject(new Error("NO_AUDIO_TRACK"));
          } else {
            reject(err);
          }
        }).run();
      });
      const buffer = fs.readFileSync(outPath);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    } finally {
      try {
        fs.unlinkSync(outPath);
      } catch {
      }
    }
  });
  electron.ipcMain.handle("extract-audio-from-video-to-file", async (_event, videoPath) => {
    if (!videoPath || !fs.existsSync(videoPath)) throw new Error("File not found: " + videoPath);
    const videoBasename = path.basename(videoPath);
    const nameWithoutExt = videoBasename.includes(".") ? videoBasename.slice(0, videoBasename.lastIndexOf(".")) : videoBasename;
    let outName = nameWithoutExt + ".wav";
    let outPath = path.join(audioDir, outName);
    let counter = 1;
    while (fs.existsSync(outPath)) {
      outName = `${nameWithoutExt} (${counter}).wav`;
      outPath = path.join(audioDir, outName);
      counter++;
    }
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath).noVideo().audioCodec("pcm_s16le").audioFrequency(48e3).output(outPath).on("end", () => resolve()).on("error", (err) => {
        if (err.message.includes("does not contain any stream") || err.message.includes("Output file #0 does not contain any stream") || err.message.toLowerCase().includes("no audio") || err.message.includes("Invalid data found when processing input")) {
          reject(new Error("NO_AUDIO_TRACK"));
        } else {
          reject(err);
        }
      }).run();
    });
    return { path: outPath, name: outName };
  });
  electron.ipcMain.handle("generate-ltc-wav", async (_event, opts) => {
    const { startTC, durationSec, fps, amplitude = 0.8 } = opts;
    const SAMPLE_RATE = 48e3;
    const parts = startTC.split(/[:;]/).map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) throw new Error("Invalid startTC: " + startTC);
    const [hh, mm, ss, ff] = parts;
    const fpsInt = Math.round(fps);
    const isDF = fps === 29.97;
    let startFrameNumber;
    if (isDF) {
      const D = 2;
      const framesPerMin = fpsInt * 60 - D;
      const framesPer10Min = framesPerMin * 10 + D;
      const framesPerHour = framesPer10Min * 6;
      const tenMinBlocks = Math.floor(mm / 10);
      const mInBlock = mm % 10;
      let fr = hh * framesPerHour + tenMinBlocks * framesPer10Min;
      if (mInBlock === 0) {
        fr += ss * fpsInt + ff;
      } else {
        fr += fpsInt * 60 + (mInBlock - 1) * framesPerMin + ss * fpsInt + ff;
      }
      startFrameNumber = fr;
    } else {
      startFrameNumber = hh * 3600 * fpsInt + mm * 60 * fpsInt + ss * fpsInt + ff;
    }
    const totalSamples = Math.ceil(durationSec * SAMPLE_RATE);
    const samplesPerFrame = SAMPLE_RATE / fps;
    const samplesPerHalfBit = samplesPerFrame / 160;
    const frameCache = /* @__PURE__ */ new Map();
    function encodeFrame(totalFrames) {
      if (frameCache.has(totalFrames)) return frameCache.get(totalFrames);
      totalFrames = Math.max(0, totalFrames);
      let h, m, s, f;
      if (isDF && fpsInt === 30) {
        const D = 2;
        const fpm = fpsInt * 60 - D;
        const fp10m = fpm * 10 + D;
        const fph = fp10m * 6;
        h = Math.floor(totalFrames / fph) % 24;
        let rem = totalFrames - h * fph;
        const tenBlocks = Math.floor(rem / fp10m);
        rem -= tenBlocks * fp10m;
        let mInBlock;
        if (rem < fpsInt * 60) {
          mInBlock = 0;
        } else {
          rem -= fpsInt * 60;
          mInBlock = 1 + Math.floor(rem / fpm);
          rem -= (mInBlock - 1) * fpm;
        }
        m = tenBlocks * 10 + mInBlock;
        s = Math.floor(rem / fpsInt);
        f = rem - s * fpsInt;
      } else {
        h = Math.floor(totalFrames / (fpsInt * 3600)) % 24;
        let rem = totalFrames - Math.floor(totalFrames / (fpsInt * 3600)) * fpsInt * 3600;
        m = Math.floor(rem / (fpsInt * 60));
        rem -= m * fpsInt * 60;
        s = Math.floor(rem / fpsInt);
        f = rem - s * fpsInt;
      }
      const bits = new Uint8Array(new ArrayBuffer(80));
      bits[0] = f % 10 & 1;
      bits[1] = f % 10 >> 1 & 1;
      bits[2] = f % 10 >> 2 & 1;
      bits[3] = f % 10 >> 3 & 1;
      bits[8] = Math.floor(f / 10) & 1;
      bits[9] = Math.floor(f / 10) >> 1 & 1;
      bits[10] = isDF ? 1 : 0;
      bits[16] = s % 10 & 1;
      bits[17] = s % 10 >> 1 & 1;
      bits[18] = s % 10 >> 2 & 1;
      bits[19] = s % 10 >> 3 & 1;
      bits[24] = Math.floor(s / 10) & 1;
      bits[25] = Math.floor(s / 10) >> 1 & 1;
      bits[26] = Math.floor(s / 10) >> 2 & 1;
      bits[32] = m % 10 & 1;
      bits[33] = m % 10 >> 1 & 1;
      bits[34] = m % 10 >> 2 & 1;
      bits[35] = m % 10 >> 3 & 1;
      bits[40] = Math.floor(m / 10) & 1;
      bits[41] = Math.floor(m / 10) >> 1 & 1;
      bits[42] = Math.floor(m / 10) >> 2 & 1;
      bits[48] = h % 10 & 1;
      bits[49] = h % 10 >> 1 & 1;
      bits[50] = h % 10 >> 2 & 1;
      bits[51] = h % 10 >> 3 & 1;
      bits[56] = Math.floor(h / 10) & 1;
      bits[57] = Math.floor(h / 10) >> 1 & 1;
      bits[64] = 0;
      bits[65] = 0;
      bits[66] = 1;
      bits[67] = 1;
      bits[68] = 1;
      bits[69] = 1;
      bits[70] = 1;
      bits[71] = 1;
      bits[72] = 1;
      bits[73] = 1;
      bits[74] = 1;
      bits[75] = 1;
      bits[76] = 1;
      bits[77] = 1;
      bits[78] = 0;
      bits[79] = 1;
      frameCache.set(totalFrames, bits);
      return bits;
    }
    const pcm = new Int16Array(totalSamples);
    let phase = 1;
    let lastHalfBitIdx = -1;
    let lastEncodedFrameIdx = -1;
    let currentBits = new Uint8Array(new ArrayBuffer(80));
    for (let i = 0; i < totalSamples; i++) {
      const frameIdx = Math.floor(i / samplesPerFrame);
      const sampleInFrame = i - frameIdx * samplesPerFrame;
      const halfBitIdx = Math.floor(sampleInFrame / samplesPerHalfBit);
      if (frameIdx !== lastEncodedFrameIdx) {
        lastEncodedFrameIdx = frameIdx;
        currentBits = encodeFrame(startFrameNumber + frameIdx);
      }
      if (halfBitIdx !== lastHalfBitIdx) {
        lastHalfBitIdx = halfBitIdx;
        const bitIdx = halfBitIdx >> 1;
        const isSecondHalf = (halfBitIdx & 1) === 1;
        if (!isSecondHalf) {
          phase = -phase;
        } else {
          if (bitIdx < 80 && currentBits[bitIdx] === 1) {
            phase = -phase;
          }
        }
      }
      pcm[i] = Math.round(phase * amplitude * 32767);
    }
    const dataSize = pcm.byteLength;
    const headerSize = 44;
    const buf = Buffer.alloc(headerSize + dataSize);
    buf.write("RIFF", 0);
    buf.writeUInt32LE(36 + dataSize, 4);
    buf.write("WAVE", 8);
    buf.write("fmt ", 12);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(SAMPLE_RATE, 24);
    buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
    buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);
    buf.write("data", 36);
    buf.writeUInt32LE(dataSize, 40);
    const pcmBuf = Buffer.from(pcm.buffer.slice(0));
    pcmBuf.copy(buf, headerSize);
    const tcSafe = startTC.replace(/:/g, "-");
    const fpsLabel = fps === 29.97 ? "29df" : String(fpsInt);
    const durLabel = durationSec >= 3600 ? `${Math.floor(durationSec / 3600)}h${Math.floor(durationSec % 3600 / 60)}m` : durationSec >= 60 ? `${Math.floor(durationSec / 60)}m${durationSec % 60}s` : `${durationSec}s`;
    let outName = `LTC_${tcSafe}_${fpsLabel}fps_${durLabel}.wav`;
    let outPath = path.join(audioDir, outName);
    let counter = 1;
    while (fs.existsSync(outPath)) {
      outName = `LTC_${tcSafe}_${fpsLabel}fps_${durLabel} (${counter}).wav`;
      outPath = path.join(audioDir, outName);
      counter++;
    }
    fs.writeFileSync(outPath, buf);
    return { path: outPath, name: outName };
  });
  electron.ipcMain.handle("get-app-version", () => electron.app.getVersion());
  electron.ipcMain.handle("artnet-start", () => {
    ensureArtnetSocket();
    return true;
  });
  electron.ipcMain.handle("artnet-stop", () => {
    closeArtnetSocket();
    return true;
  });
  const isValidIp = (ip) => {
    const parts = ip.split(".");
    if (parts.length !== 4) return false;
    return parts.every((p) => {
      const n = Number(p);
      return Number.isInteger(n) && n >= 0 && n <= 255;
    });
  };
  electron.ipcMain.on("artnet-send-tc", (_event, hours, minutes, seconds, frames, fps, targetIp) => {
    if (!artnetSocket) return;
    const ip = targetIp && isValidIp(targetIp) ? targetIp : "255.255.255.255";
    artnetPacket.writeUInt8(frames & 31, 14);
    artnetPacket.writeUInt8(seconds & 63, 15);
    artnetPacket.writeUInt8(minutes & 63, 16);
    artnetPacket.writeUInt8(hours & 31, 17);
    artnetPacket.writeUInt8(artnetFpsToType(fps), 18);
    artnetSocket.send(artnetPacket, 0, 19, ARTNET_PORT, ip);
  });
  electron.ipcMain.handle("show-input-dialog", async (_event, title, label, defaultValue) => {
    const focusedWin = electron.BrowserWindow.getFocusedWindow() ?? electron.BrowserWindow.getAllWindows()[0];
    if (!focusedWin) return null;
    const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const safeLabel = escapeHtml(label);
    const safeDefault = escapeHtml(defaultValue);
    const safeTitle = escapeHtml(title);
    const inputWin = new electron.BrowserWindow({
      width: 360,
      height: process.platform === "darwin" ? 180 : 150,
      parent: focusedWin,
      modal: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      backgroundColor: "#1a1a1a",
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
      show: false,
      title: safeTitle,
      autoHideMenuBar: true
    });
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
      <\/script>
    </body></html>`;
    inputWin.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(htmlContent));
    inputWin.once("ready-to-show", () => inputWin.show());
    return new Promise((resolve) => {
      let resolved = false;
      const done = (val) => {
        if (resolved) return;
        resolved = true;
        clearInterval(pollResult);
        resolve(val);
      };
      inputWin.on("closed", () => done(null));
      const pollResult = setInterval(async () => {
        try {
          const result = await inputWin.webContents.executeJavaScript("window.__result");
          if (result !== void 0) {
            const val = result;
            if (!inputWin.isDestroyed()) inputWin.close();
            done(val);
          }
        } catch {
          done(null);
        }
      }, 100);
    });
  });
  electron.ipcMain.handle("show-confirm-dialog", async (_event, message) => {
    const focusedWin = electron.BrowserWindow.getFocusedWindow() ?? win;
    const result = await electron.dialog.showMessageBox(focusedWin, {
      type: "question",
      buttons: ["Cancel", "OK"],
      defaultId: 1,
      cancelId: 0,
      message
    });
    return result.response === 1;
  });
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      const newWin = createWindow();
      buildMenu(newWin, presetsDir);
      newWin.webContents.on("did-finish-load", () => {
        if (pendingOpenFile) {
          newWin.webContents.send("open-ltcast-file", pendingOpenFile);
          pendingOpenFile = null;
        }
      });
    }
  });
});
electron.app.on("window-all-closed", () => {
  closeArtnetSocket();
  if (process.platform !== "darwin") electron.app.quit();
});
