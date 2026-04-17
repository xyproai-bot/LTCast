# Screenshots — capture list

10 key frames that cover the product end-to-end. Capture both dark and light variants where a reviewer might prefer one. All shots are **1920×1200 window size** (retina → export at 2× = 3840×2400), dark theme by default.

Save output as `press-kit/binary/screenshots/{01..10}-<slug>.png` (not committed). Compress with `pngquant --quality 80-95` before uploading to public bucket.

---

## Capture environment

- A clean show folder with three real tracks that have LTC already encoded (or will be generated).
- Devices panel populated with realistic names — VB-CABLE or BlackHole, loopMIDI or IAC, Art-Net target `2.255.255.255`.
- Setlist filled with 3–5 songs, mixed durations.
- No debug panels, no dev tools, no console.
- App at **v0.5.0** or later. Put the version in filename if we're shipping press materials mid-version.
- macOS traffic-light buttons: leave visible. Windows controls: same.
- No personal folder paths visible — use a generic folder like `~/Shows/Demo Show/`.

Turn off notifications, set the system language to English for the main shots (capture zh-TW and ja variants separately for i18n coverage if a reviewer asks).

---

## The 10 shots

### 01 — Main UI, mid-playback
**Slug:** `01-main-ui.png`

Full window, a song loaded, timecode display reads around `00:01:30:12`. Dual waveform visible (music on top, LTC channel below). Transport running. This is the hero image for the landing page and most press.

### 02 — Setlist panel with auto-advance
**Slug:** `02-setlist.png`

Right-side setlist panel expanded. 4 songs listed with durations and auto-advance toggles. Current song is highlighted; next song has a countdown badge.

### 03 — Device panel, all outputs configured
**Slug:** `03-devices.png`

Device panel open. Music output, LTC output, MTC MIDI output, MIDI Clock output, Art-Net target IP, OSC target — all populated with sensible values. Shows the "one app, every protocol" pitch in a single frame.

### 04 — MIDI Cue list
**Slug:** `04-midi-cues.png`

MIDI Cue panel open with 5–8 cues at different timecodes: program change, CC, note on/off. Shows the scheduling UI.

### 05 — Pre-Show Check + Big Clock
**Slug:** `05-pre-show-check.png`

Pre-Show Check panel in the `STANDBY` state (amber glow). Big Clock overlay visible with the current timecode. Next-song card visible showing upcoming track and countdown.

### 06 — Panic state
**Slug:** `06-panic.png`

After the panic button was hit. Big Clock flashing red, `ALL STOPPED` banner, every output indicator showing its off state. Dramatic, useful for articles about "what happens when it all goes wrong".

### 07 — Show Log
**Slug:** `07-show-log.png`

Show Log panel open with a realistic run of events — setlist advance, device dropout, cue fired, panic invoked, resume. CSV export button visible.

### 08 — Remote Display on phone
**Slug:** `08-remote-display-phone.png`

Composite: phone mockup showing the remote display page (big timecode, current song, next song) with an optional "real phone on a stand" photograph behind it. Demonstrates the FOH-tablet story.

### 09 — Bitfocus Companion on Stream Deck
**Slug:** `09-companion-stream-deck.png`

Close-up photo of a Stream Deck (XL or MK2) with labelled buttons — GO, NEXT, PREV, PANIC, ARM, STANDBY. Real hardware photo is better than a mockup here.

### 10 — Timecode calculator
**Slug:** `10-tc-calculator.png`

TC Calculator panel open with a worked example — e.g., "show start 19:00:00 + pre-show 14:32:10 = doors 04:27:50 next day" or "frame offset calculation". Niche but surprisingly often featured in timecode articles.

---

## B-roll shots (for blog posts and Twitter — optional)

- `b01-hero-light.png` — main UI in **light theme**, for light-themed blogs.
- `b02-ultra-dark.png` — Ultra-Dark mode, showing the high-contrast theme designed for live FOH.
- `b03-waveform-zoom.png` — waveform zoomed right in to a single frame boundary, showing the LTC decode precision.
- `b04-osc-templates.png` — OSC Templates dropdown open with Resolume / Disguise / WATCHOUT presets visible.
- `b05-multi-language.png` — same UI in zh-TW and ja side by side.

---

## Shot composition rules

- Leave **30–40% negative space** around the subject so the reviewer can crop for their layout.
- Do **not** burn LTCast's own logo into the screenshots. Let the app UI speak for itself.
- Capture at native resolution; deliver PNG (lossless). Never JPEG for UI shots.
- For the hero image (shot 01), **also export a version with no window chrome** — some press kits want a flat UI grab for embedding into mockups.

## Automated capture script (optional, future)

There isn't one yet. If we end up needing the same shots regenerated for every version, a Playwright-driven Electron automation that loads a deterministic show file and captures at fixed coordinates would pay for itself after the third release. Track that as a separate task, not part of this launch.
