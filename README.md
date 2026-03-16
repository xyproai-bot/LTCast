# CueSync

**LTC Timecode player and MTC/Art-Net sender for live shows.**

CueSync reads SMPTE LTC timecode embedded in audio files and forwards it as MTC (MIDI Timecode) and Art-Net Timecode over the network. It also includes a TC Generator mode for files without embedded LTC.

**CueSync 是一款用於現場演出的 LTC 時間碼播放器與 MTC / Art-Net 時間碼發送工具。**

CueSync 可讀取音訊檔案中內嵌的 SMPTE LTC 時間碼，並轉發為 MTC（MIDI 時間碼）與 Art-Net Timecode。對於無內嵌 LTC 的檔案，也提供 TC 產生器模式。

---

## Features / 功能

- **LTC Reader** — Auto-detects LTC channel, decodes SMPTE timecode in real time
  LTC 讀取器 — 自動偵測 LTC 聲道，即時解碼 SMPTE 時間碼
- **MTC Output** — Sends MIDI Timecode (full-frame SysEx) to any MIDI port
  MTC 輸出 — 透過任何 MIDI 埠發送 MIDI 時間碼
- **Art-Net Timecode** — Broadcasts timecode via UDP (port 6454)
  Art-Net 時間碼 — 透過 UDP 廣播時間碼
- **TC Generator** — Generates LTC audio for files without embedded timecode
  TC 產生器 — 為無內嵌時間碼的檔案產生 LTC 音訊
- **Dual Audio Output** — Separate devices for music and LTC (e.g., VB-CABLE)
  雙音訊輸出 — 音樂與 LTC 可分別路由至不同裝置
- **Setlist** — Manage multiple audio files, drag-and-drop reorder
  曲目列表 — 管理多個音訊檔案，支援拖放排序
- **A-B Loop** — Loop a specific section of the audio
  A-B 循環 — 循環播放指定區段
- **Video Import** — Import video files and auto-align with audio waveform
  影片匯入 — 匯入影片並自動對齊音訊波形
- **Preset System** — Save/load project settings as .cuesync files
  預設系統 — 儲存/載入專案設定為 .cuesync 檔案
- **Tap BPM** — Manual tap-to-detect BPM tool
  Tap BPM — 手動拍點偵測 BPM 工具
- **Bilingual** — English / 繁體中文

## Supported Formats / 支援格式

WAV, AIFF, MP3, FLAC, OGG

## System Requirements / 系統需求

- Windows 10+ / macOS 12+ / Linux
- Node.js 18+
- For MTC output: a virtual MIDI port (e.g., [loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html))
- For LTC output: a virtual audio cable (e.g., [VB-CABLE](https://vb-audio.com/Cable/))

## Development / 開發

```bash
# Install dependencies / 安裝依賴
npm install

# Run in development mode / 開發模式執行
npm run dev

# Build (renderer + main + preload) / 建構
npm run build

# Package installer / 打包安裝程式
npm run package          # Current platform
npm run package:win      # Windows
npm run package:mac      # macOS
```

## Architecture / 架構

```
src/
├── main/           Electron main process (IPC, file I/O, Art-Net UDP, ffmpeg)
├── preload/        Context bridge (secure IPC API for renderer)
└── renderer/src/
    ├── audio/      Audio engine (dual AudioContext, LTC worklets, MTC, Art-Net)
    ├── components/ React UI components
    ├── store.ts    Zustand state management
    ├── i18n.ts     Internationalization (en/zh)
    └── globals.css Styles
```

**Key design decisions / 關鍵設計決策：**

- **Dual AudioContext** — Music and LTC use separate AudioContexts with independent device routing. This prevents VB-CABLE handle loss on Windows.
- **AudioWorklet** — LTC decoding and encoding run in AudioWorklet processors for real-time performance.
- **Full-frame MTC SysEx** — Used instead of quarter-frame messages, which require precise timing that `requestAnimationFrame` cannot provide.
- **Drop-frame timecode** — Full SMPTE 12M drop-frame algorithm (29.97fps) implemented in both decoder and generator.

## License / 授權

[MIT](LICENSE)
