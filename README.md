# LTCast

<p align="center">
  <img src="resources/icon.png" width="128" height="128" alt="LTCast"/>
</p>

**LTC Timecode player and MTC/Art-Net sender for live shows.**

LTCast reads SMPTE LTC timecode embedded in audio files and forwards it as MTC (MIDI Timecode) and Art-Net Timecode over the network. It also includes a TC Generator mode for files without embedded LTC.

Designed for live show operators, lighting programmers, and AV engineers who need reliable timecode distribution from a single playback machine.

![LTCast Screenshot](resources/screenshot.png)

---

## Features

- **LTC Reader** — Auto-detects LTC channel, decodes SMPTE timecode in real time
- **MTC Output** — Sends MIDI Timecode (quarter-frame and full-frame SysEx) to any MIDI port
- **Art-Net Timecode** — Broadcasts timecode via UDP (port 6454)
- **TC Generator** — Generates LTC audio for files without embedded timecode
- **Dual Audio Output** — Separate devices for music and LTC (e.g., VB-CABLE)
- **Setlist** — Manage multiple audio files, drag-and-drop reorder
- **A-B Loop** — Loop a specific section of the audio
- **Video Import** — Import a video file; LTCast automatically aligns its audio to the main audio track using waveform cross-correlation. Fine-tune the offset by dragging on the waveform.
- **Preset System** — Save/load project settings as .ltcast files
- **Tap BPM** — Manual tap-to-detect BPM tool
- **Bilingual** — English / Traditional Chinese

## Supported Formats

WAV, AIFF, MP3, FLAC, OGG

## System Requirements

- Windows 10+ / macOS 12+ (Apple Silicon)
- Node.js 22+ (for development)
- For MTC output: a virtual MIDI port (e.g., [loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html) on Windows, IAC Driver on macOS)
- For LTC output: a virtual audio cable (e.g., [VB-CABLE](https://vb-audio.com/Cable/) on Windows, [BlackHole](https://existential.audio/blackhole/) on macOS)

> **macOS note:** If you see an "unverified developer" warning on first launch, open **System Settings → Privacy & Security** and click **Open Anyway**. If you see a "damaged" warning, run the following in Terminal, then reopen the app:
> ```bash
> xattr -cr /Applications/LTCast.app
> ```

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
- **Quarter-frame MTC** — MTC is sent as quarter-frame messages using Web MIDI's scheduled `send(data, timestamp)` for accurate timing. Full-frame SysEx is used on seek/jump to reset receiver position.
- **Drop-frame timecode** — Full SMPTE 12M drop-frame algorithm (29.97fps) implemented in both decoder and generator.

## Feedback & Bug Reports

- **GitHub Issues**: [Open an issue](https://github.com/xyproai-bot/LTCast/issues)
- **Email**: xyproai-bot@gmail.com

## License

[Commons Clause + MIT](LICENSE)

Free to use for personal and commercial productions. Redistribution or resale of the software itself is not permitted.
