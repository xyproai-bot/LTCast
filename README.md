# LTCast

<p align="center">
  <img src="resources/icon.png" width="128" height="128" alt="LTCast"/>
</p>

**Professional timecode player for live shows, theatre, and broadcast.**

Sync your show with precision timecode. LTCast reads and generates LTC, triggers MIDI cues, and sends MTC, MIDI Clock, Art-Net, and OSC — all from one app.

![LTCast Screenshot](resources/screenshot.png)

---

## Download

- **[Windows Installer](https://github.com/xyproai-bot/LTCast/releases/latest)** (.exe)
- **[macOS Universal DMG](https://github.com/xyproai-bot/LTCast/releases/latest)** (Intel + Apple Silicon)

**14-day free trial** of all Pro features — no credit card required.

## Features

### Free
- **LTC Reader** — auto-detect LTC channel and frame rate from any audio file
- **LTC Generator** — generate timecode for files without embedded LTC
- **Dual Waveform** — music + LTC channel visualisation
- **Drop-frame 29.97** and non-drop 24/25/30 fps support
- **Dual Audio Output** — separate devices for music and LTC (VB-CABLE / BlackHole)
- **A-B Loop** — loop a specific section, visible on the music waveform
- **Tap BPM** — manual tap-to-detect
- **Video Import** — align video audio via waveform cross-correlation
- **Dark / Light Mode** — system-aware theme
- **Trilingual** — English / 繁體中文 / 日本語

### Pro
- **MIDI Cue System** — trigger program changes, notes, and CCs at specific timecodes
- **MTC Output** — quarter-frame and full-frame MIDI timecode
- **MIDI Clock Output** — send BPM clock for DAWs, drum machines, and live rigs
- **Art-Net Output** — UDP timecode for lighting consoles (MA, ChamSys, Avolites, etc.)
- **OSC Output** — Open Sound Control with per-cue templates for media servers
- **Song Structure Markers** — mark intro, verse, chorus, bridge with auto-coloring
- **Setlist Management** — drag-and-drop ordering, durations, auto-advance with countdown timer
- **Pre-Show Check** — standby / GO workflow, next-song overlay, panic button
- **Show Log** — event timeline with CSV export for post-show review
- **Bitfocus Companion Module** — control LTCast from Stream Deck
- **Timecode Calculator** — add/subtract TC, frames ↔ TC conversion
- **BPM Detection** — real-time onset + autocorrelation tempo analysis
- **Custom OSC Templates** — Resolume, Disguise (d3), WATCHOUT presets
- **Ultra-dark Mode** + **UI Lock** — high-contrast theme and accidental-change protection for live shows
- **Waveform Zoom Memory** — zoom level persisted per-file
- **Inline TC Edit** — double-click TC display to type target and seek
- **Per-song Offsets** — fine-tune timecode alignment per track
- **CSV Import/Export** — share setlists between shows and team members
- **LTC WAV Export** — generate LTC audio files for external playback
- **PDF Export** — print-ready cue sheets and setlists
- **Preset System** — save complete show configurations as `.ltcast` files

### Pricing
| Plan | Price | Best for |
|------|-------|----------|
| **Annual** | $49 / year | Working pros, regular shows |
| **7-Day Pass** | $15 | Single events, one-off gigs |
| **Volume (10+)** | Contact | Rental houses, teams |

**[Buy LTCast Pro →](https://ltcast.lemonsqueezy.com/)** · Volume licensing: `xypro.ai@gmail.com`

## Supported Formats

WAV, AIFF, MP3, FLAC, OGG · Video: MP4, MOV (audio track extracted)

## System Requirements

- Windows 10+ / macOS 12+ (Intel + Apple Silicon universal build)
- For LTC output: a virtual audio cable ([VB-CABLE](https://vb-audio.com/Cable/) on Windows, [BlackHole](https://existential.audio/blackhole/) on macOS)
- For MTC / MIDI Clock output: a virtual MIDI port ([loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html) on Windows, IAC Driver on macOS)

> **macOS note:** If you see an "unverified developer" warning on first launch, open **System Settings → Privacy & Security** and click **Open Anyway**. If you see a "damaged" warning, run:
> ```bash
> xattr -cr /Applications/LTCast.app
> ```

## Development

```bash
npm install        # Install dependencies
npm run dev        # Development mode (hot reload)
npm run build      # Build for production
npx vitest run     # Run tests (265 tests)

npm run package:win   # Windows NSIS installer
npm run package:mac   # macOS Universal DMG
```

## Architecture

```
src/
├── main/           Electron main process (IPC, file I/O, Art-Net UDP, OSC, ffmpeg)
├── preload/        Context bridge (secure IPC API)
└── renderer/src/
    ├── audio/      AudioEngine (dual AudioContext, LTC worklets, MTC, MIDI Clock,
    │               Art-Net, OSC, BPM, key detection)
    ├── components/ React UI (Transport, Waveform, DevicePanel, SetlistPanel,
    │               MidiCuePanel, StructurePanel, PreShowCheck, ShowLogPanel,
    │               TcCalcPanel, LicenseDialog, ProGate)
    ├── store.ts    Zustand state management + persist
    ├── i18n.ts     Internationalization (en/zh/ja)
    └── globals.css Styles

companion/          Bitfocus Companion module (Stream Deck integration)
worker/             Cloudflare Worker — LemonSqueezy webhook + license validation
```

**Key design decisions:**

- **Dual AudioContext** — Music and LTC use separate contexts with independent device routing, preventing VB-CABLE handle loss on Windows
- **AudioWorklet** — LTC decoding and encoding run in worklet processors for real-time performance
- **Worklet persistence** — LTC decoder node survives pause/play cycles, preserving clock calibration for instant timecode response
- **Quarter-frame MTC** — Chained timestamp scheduling via Web MIDI `send(data, timestamp)` eliminates JS jitter
- **Drop-frame timecode** — Full SMPTE 12M drop-frame algorithm (29.97fps) with shared `tcToFrames` / `framesToTc` module (265 unit tests)
- **Tamper-resistant licensing** — safeStorage-encrypted Pro state, machine-fingerprint binding, clock-rollback detection, 4-hour silent re-validation
- **Server-authoritative licensing** — Cloudflare Worker receives LemonSqueezy webhooks for instant revocation of refunded/disabled keys

## Feedback & Bug Reports

- **GitHub Issues**: [Open an issue](https://github.com/xyproai-bot/LTCast/issues)
- **Email**: xypro.ai@gmail.com

## License

[Commons Clause + MIT](LICENSE)

Free to use for personal and commercial productions. Redistribution or resale of the software itself is not permitted.
