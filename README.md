# CueSync

**LTC Timecode player and MTC/Art-Net sender for live shows.**

CueSync reads SMPTE LTC timecode embedded in audio files and forwards it as MTC (MIDI Timecode) and Art-Net Timecode over the network. It also includes a TC Generator mode for files without embedded LTC.

---

## Features

- **LTC Reader** — Auto-detects LTC channel, decodes SMPTE timecode in real time
- **MTC Output** — Sends MIDI Timecode (full-frame SysEx) to any MIDI port
- **Art-Net Timecode** — Broadcasts timecode via UDP (port 6454)
- **TC Generator** — Generates LTC audio for files without embedded timecode
- **Dual Audio Output** — Separate devices for music and LTC (e.g., VB-CABLE)
- **Setlist** — Manage multiple audio files, drag-and-drop reorder
- **A-B Loop** — Loop a specific section of the audio
- **Video Import** — Import video files and auto-align with audio waveform
- **Preset System** — Save/load project settings as .cuesync files
- **Tap BPM** — Manual tap-to-detect BPM tool
- **Bilingual** — English / Traditional Chinese

## Supported Formats

WAV, AIFF, MP3, FLAC, OGG

## System Requirements

- Windows 10+
- Node.js 18+ (for development)
- For MTC output: a virtual MIDI port (e.g., [loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html))
- For LTC output: a virtual audio cable (e.g., [VB-CABLE](https://vb-audio.com/Cable/))

> macOS and Linux support is planned but not yet tested.

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build (renderer + main + preload)
npm run build

# Package installer
npm run package          # Current platform
npm run package:win      # Windows
npm run package:mac      # macOS
```

## Architecture

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

**Key design decisions:**

- **Dual AudioContext** — Music and LTC use separate AudioContexts with independent device routing. This prevents VB-CABLE handle loss on Windows.
- **AudioWorklet** — LTC decoding and encoding run in AudioWorklet processors for real-time performance.
- **Full-frame MTC SysEx** — Used instead of quarter-frame messages, which require precise timing that `requestAnimationFrame` cannot provide.
- **Drop-frame timecode** — Full SMPTE 12M drop-frame algorithm (29.97fps) implemented in both decoder and generator.

## Feedback & Bug Reports

- **GitHub Issues**: [Open an issue](https://github.com/xyproai-bot/CueSync/issues)
- **Email**: xyproai-bot@gmail.com

## License

[MIT](LICENSE)
