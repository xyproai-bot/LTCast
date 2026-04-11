# LTCast

<p align="center">
  <img src="resources/icon.png" width="128" height="128" alt="LTCast"/>
</p>

**Professional timecode player for live shows, theatre, and broadcast.**

Sync your show with precision timecode. LTCast reads and generates LTC, triggers MIDI cues, and sends MTC, Art-Net, and OSC — all from one app.

![LTCast Screenshot](resources/screenshot.png)

---

## Download

- **[Windows Installer](https://github.com/xyproai-bot/LTCast/releases/latest)** (.exe)
- **[macOS Universal DMG](https://github.com/xyproai-bot/LTCast/releases/latest)** (Intel + Apple Silicon)

## Features

### Free
- **LTC Reader** — auto-detect LTC channel and frame rate from any audio file
- **LTC Generator** — generate timecode for files without embedded LTC
- **Dual Waveform** — music + LTC channel visualisation
- **Drop-frame 29.97** and non-drop 25/30 fps support
- **Dual Audio Output** — separate devices for music and LTC (VB-CABLE / BlackHole)
- **A-B Loop** — loop a specific section
- **Tap BPM** — manual tap-to-detect
- **Video Import** — align video audio via waveform cross-correlation
- **Trilingual** — English / 繁體中文 / 日本語

### Pro ($49/year or $149 lifetime)
- **MIDI Cue System** — trigger program changes, notes, and CCs at specific timecodes
- **MTC Output** — quarter-frame and full-frame MIDI timecode to any port
- **Art-Net Output** — UDP timecode for lighting consoles (MA, ChamSys, Avolites, etc.)
- **OSC Output** — Open Sound Control for media servers and show control
- **Song Structure Markers** — mark intro, verse, chorus, bridge on the waveform with auto-coloring
- **Setlist Management** — drag-and-drop song order, auto-advance with countdown timer
- **CSV Import/Export** — share setlists between shows and team members
- **LTC WAV Export** — generate LTC audio files for external playback
- **BPM Detection** — real-time onset + autocorrelation tempo analysis
- **Per-song Offsets** — fine-tune timecode alignment per track
- **Preset System** — save and load complete show configurations as .ltcast files

**[Buy LTCast Pro →](https://ltcast.lemonsqueezy.com/checkout/buy/001f3f48-747b-4649-801f-c0063a8b7afd)**

## Supported Formats

WAV, AIFF, MP3, FLAC, OGG

## System Requirements

- Windows 10+ / macOS 12+
- For LTC output: a virtual audio cable ([VB-CABLE](https://vb-audio.com/Cable/) on Windows, [BlackHole](https://existential.audio/blackhole/) on macOS)
- For MTC output: a virtual MIDI port ([loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html) on Windows, IAC Driver on macOS)

> **macOS note:** If you see an "unverified developer" warning on first launch, open **System Settings → Privacy & Security** and click **Open Anyway**. If you see a "damaged" warning, run:
> ```bash
> xattr -cr /Applications/LTCast.app
> ```

## Development

```bash
npm install        # Install dependencies
npm run dev        # Development mode (hot reload)
npm run build      # Build for production
npx vitest run     # Run tests (123 tests)

npm run package:win   # Windows NSIS installer
npm run package:mac   # macOS DMG
```

## Architecture

```
src/
├── main/           Electron main process (IPC, file I/O, Art-Net UDP, OSC, ffmpeg)
├── preload/        Context bridge (secure IPC API)
└── renderer/src/
    ├── audio/      AudioEngine (dual AudioContext, LTC worklets, MTC, Art-Net, OSC, BPM)
    ├── components/ React UI (Transport, Waveform, DevicePanel, SetlistPanel, MidiCuePanel, StructurePanel)
    ├── store.ts    Zustand state management + persist
    ├── i18n.ts     Internationalization (en/zh/ja)
    └── globals.css Styles
```

**Key design decisions:**

- **Dual AudioContext** — Music and LTC use separate contexts with independent device routing, preventing VB-CABLE handle loss on Windows
- **AudioWorklet** — LTC decoding and encoding run in worklet processors for real-time performance
- **Worklet persistence** — LTC decoder node survives pause/play cycles, preserving clock calibration for instant timecode response
- **Quarter-frame MTC** — Scheduled via Web MIDI `send(data, timestamp)` for sub-millisecond accuracy
- **Drop-frame timecode** — Full SMPTE 12M drop-frame algorithm (29.97fps) with shared `tcToFrames`/`framesToTc` module (81 unit tests)

## Feedback & Bug Reports

- **GitHub Issues**: [Open an issue](https://github.com/xyproai-bot/LTCast/issues)

## License

[Commons Clause + MIT](LICENSE)

Free to use for personal and commercial productions. Redistribution or resale of the software itself is not permitted.
