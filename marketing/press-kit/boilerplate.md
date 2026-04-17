# Boilerplate descriptions

Use verbatim in press coverage. Three lengths for different slots.

---

## One-sentence (for tweet, chyron, product directory)

> LTCast is a cross-platform desktop app that reads and generates SMPTE timecode from audio files and simultaneously sends LTC, MTC, MIDI Clock, Art-Net, and OSC — for live shows, theatre, and broadcast.

*149 characters. Fits a tweet with a link.*

---

## 50-word (for directory entries, press-release lede)

> LTCast is a professional timecode player for live shows, theatre, and broadcast. It reads and generates SMPTE LTC from audio files and simultaneously outputs MIDI Timecode, MIDI Clock, Art-Net OpTimeCode, and OSC — driving lighting consoles, DAWs, hardware, and media servers from one app. Windows and macOS. Built by showrunners for showrunners.

*54 words. Edit down for strict 50-word slots by dropping the last sentence.*

---

## 150-word (for press release "about" block)

> LTCast is a professional timecode player and generator for live shows, theatre, and broadcast. Running on Windows and macOS, it reads LTC from any audio file, generates LTC for tracks that don't already have it, and simultaneously sends MIDI Timecode, MIDI Clock, Art-Net OpTimeCode, and OSC — so a single show PC can drive the lighting console, the DAW, hardware synths, and the media server from the same source of truth.
>
> Beyond raw timecode, LTCast includes the practical tools a live show needs: drag-and-drop setlist management with auto-advance, a Pre-Show Check / GO workflow with countdown timers, a panic button that tears down every output in one click, a CSV-exportable show log, a MIDI cue scheduler, and an official Bitfocus Companion module for Stream Deck control. LTCast is freemium: full Pro features are available in a 14-day trial, then $49/year or $15 for a single-event 7-day pass.

*162 words.*

---

## Product category (for directory submissions, B2B databases)

- Primary: **Show control software / Timecode generator**
- Secondary: **Professional audio utility**
- Tertiary: **Live production software**

## One-liner variations by audience

For different outlets, pick the framing that lands.

| Audience | One-liner |
|----------|-----------|
| Lighting trade press | A Windows and Mac timecode master that speaks Art-Net OpTimeCode natively, so consoles can chase a show PC directly. |
| Audio / recording press | A timecode player that sends MTC quarter-frame and MIDI Clock with sub-millisecond jitter — so your DAW and your hardware synths stay tight to the show. |
| Broadcast press | A software LTC reader / generator with drop-frame 29.97 support, replacing a Rosendahl-class box for in-the-box productions. |
| Corporate AV | One app that replaces the usual three-or-four-tool chain for sending timecode to lighting, video, and audio from a corporate show PC. |
| General tech press | A single desktop app that solves the "why is there no QLab on Windows" problem, with timecode-generation as its core. |

## Positioning statement (internal — do not quote externally)

> For live-show technicians who need to drive lighting, video, DAWs, and hardware from a single timecode source, LTCast is a cross-platform desktop timecode player that simultaneously emits LTC, MTC, MIDI Clock, Art-Net, and OSC — unlike chained DAW-plus-plugin workflows or dedicated hardware boxes, because the failure surface is a single app and the cost is a subscription, not a capex line.

## Facts sheet

One-pager values to cite with confidence:

| Fact | Value |
|------|-------|
| Current version | 0.5.1 (shipped April 2026) |
| Platforms | Windows 10+ (NSIS, signed) · macOS 12+ Universal DMG (signed, notarised) |
| LTC frame rates | 24 / 25 / 29.97 drop-frame / 30 non-drop |
| MTC modes | Quarter-frame (F1) + full-frame SysEx (F0 7F 7F 01 01 … F7) |
| MIDI Clock | 0xF8 timing clock + 0xFA/FB/FC transport |
| Art-Net version | 4 (OpTimeCode packet) |
| OSC version | 1.0 and 1.1 |
| Languages | English, 繁體中文, 日本語 |
| License | Commons Clause + MIT |
| Unit tests | 265 (`npx vitest run`) |
| Pricing | $49 / year · $15 / 7-day · Volume on request |
| Trial | 14 days, all Pro features, no card |
| Offline grace | 30 days after activation |
| Bitfocus Companion | Official module included in repo |
| Remote Display | HTTP + WebSocket on port 3100, PIN-authenticated |
| Source repository | github.com/xyproai-bot/LTCast |
| Website | ltcast.app |
| Contact | xypro.ai@gmail.com |

**Keep this table updated whenever `package.json` version or test count changes.**
