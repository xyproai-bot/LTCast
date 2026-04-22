# Changelog

All notable changes to LTCast are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.2] — 2026-04-22

Live-show operator polish. Four features, all addressing pain points that surfaced after v0.5.1 shipped and the app hit real shows. No breaking changes; no architecture shifts.

### Added

- **Pre-buffer next song (F1).** Setting a setlist item to standby now decodes that file in the background so that pressing Space / GO to fire the transition completes in under 100 ms instead of re-reading disk + running `decodeAudioData` on the hot path (previously froze the UI for 1–2 seconds on 50 MB+ WAVs). Falls back cleanly to the existing openFile path when prebuffer is missing, still in-flight, or fails. Token-based identity so a cancelled standby can't bleed into a later GO. One-slot cache — never pre-decodes the entire setlist.
- **Offset scroll-wheel fine-tune (F2).** Mouse wheel over the giant TC digits or the Offset input nudges `offsetFrames` by ±1 per detent; Shift+wheel = ±10. Trackpad rate-limited (40-pixel accumulator) so a fast swipe moves at most 10 frames, not 100. UI-Lock guard; double-click-to-edit still works; Waveform wheel zoom unaffected.
- **Independent Show Timer (F4).** New right-panel tab. Create named countdowns ("Doors", "Intermission", "Lockout" — user-defined) that run wall-clock-accurate (`Date.now()` arithmetic, survives app backgrounding and JS throttling) and are completely independent of audio playback. Persist across restart via Zustand storage. Row flashes red for 5 seconds on reaching zero. OSC broadcast deferred to a later release.
- **Setlist long-press drag (F6).** Reordering songs now requires a 300 ms hold before drag initiates. A nervous operator can no longer accidentally reorder the show by grazing a setlist item mid-cue. Visual "drag armed" affordance (subtle lift + grab cursor) confirms the gesture. Click-to-standby and double-click-to-load behaviour unchanged; UI Lock still blocks drag entirely.

### Changed

- `CLAUDE.md` workflow documentation refreshed — updated directory map, added collaboration-tips section.

### Tests

- +28 `showTimer.test.ts` — pure helpers: `msToMmSs`, `computeRemaining`, completion detection, clamp.
- +15 `prebuffer.test.ts` — `prebufferFile` / `consumePrebuffered` / `clearPrebuffered` + `loadDecodedBuffer` refactor parity.
- Suite total: **314 passing** (was 271 on v0.5.1).

### Not in this release (deferred to v0.5.3 / v0.6.0)

- F3 — OSC feedback / TC sync monitoring (main-process work, OSC listener)
- F5 — Stage Display fullscreen upgrade (extends TimecodeDisplay in fullscreen mode)
- F7 — any field-surfaced bugs from v0.5.1 / v0.5.2 usage

## [0.5.1] — 2026-04-17

Patch release. Two user-reported bugs against 0.5.0.

### Fixed

- **MTC rate code wrong for 30 fps (non-drop).** `fpsToRateCode` used a `< 0.1` tolerance window, so `|30 − 29.97| = 0.03` matched the 29.97 drop-frame branch — downstream MIDI receivers displayed `30DF` instead of `30 ND`. Tightened to `< 0.01` (same threshold AudioEngine already uses for drop-frame detection). Affects both quarter-frame and full-frame SysEx paths; timecode values themselves were always correct, only the fps flag byte was wrong. (`d384084`)
- **LemonSqueezy license Deactivate button failed with "The instance id field is required."** The deactivate request sent `instance_name` instead of the `instance_id` LemonSqueezy's API demands. `ProState` now persists the `instance.id` returned by the activate call, and deactivate sends it. v0.5.0-era users with no stored id get a graceful local-only deactivation so they aren't trapped in Pro state. (`08a7e2c`)

### Tests

- Added `mtcRateCode.test.ts` with 6 cases (24 / 25 / 29.97 / 30 + float-drift edges). Full suite: 271/271 passing.

## [0.5.0] — 2026-04-17

Major feature release: MIDI Clock, Bitfocus Companion, Promo Code system, pre-show workflow, and 14+ UX improvements. 21 new features, 47 bug fixes across 10 rounds of strict code review, and a hardened Pro licensing pipeline.

### Security

- **Promo redeem TOCTOU race eliminated via Cloudflare Durable Object.** The redemption path was vulnerable to a time-of-check/time-of-use race where concurrent redeem calls for the same code could each pass the "already redeemed?" check before either write landed, minting multiple licenses from one promo. All redeem traffic now serializes through a per-code Durable Object, guaranteeing atomic check-and-mark. (`fdc0418`)
- **Pro state tamper-resistance** — on-disk license/trial state is now encrypted with Electron `safeStorage` so a user cannot simply edit a JSON file to extend their trial or forge Pro. (`257d81f`)
- **Pro state bound to machine fingerprint** — a license copied to another machine will no longer unlock Pro; mismatch triggers revalidation. (`0b82c3b`)
- **Clock rollback detection** — trial and license expiry now detect system clock being rolled back and treat it as expired rather than silently extending. (`b6448fa`)
- **Promo license expiry enforcement** — expired promo-granted licenses now correctly revert to free tier instead of remaining silently unlocked.

### Added — Pro features

- **MIDI Clock output** — 24 PPQ with chained scheduling, BPM sourced from auto-detect, tap, or manual. Sync DAWs, drum machines, and hardware synths to the show.
- **Bitfocus Companion module** — standalone companion module in `companion/` lets Stream Deck / Companion control transport, standby, GO, panic, and setlist navigation.
- **Promo Code system** — redeem codes for 180-day Pro licenses. Cloudflare Worker handles issuance; app reconciles status on launch.
- **Timecode Calculator panel** — add/subtract durations, convert between frames and TC, fps-aware math.
- **Custom OSC templates** — per-cue OSC template support with presets for Resolume, Disguise, and WATCHOUT.
- **Cue sheet PDF export** — printable cue sheets and setlists via Electron `printToPDF`, CJK filenames supported.
- **Show Log** — event timeline capturing cue fires, standby changes, GO, panic, and errors. CSV export for post-show review.
- **Pre-Show Checklist** — one-click system health check (audio devices, MIDI ports, Art-Net link, license status) before doors open.
- **Standby / GO workflow** — click to arm a song (standby), Space to GO, double-click for immediate cue.
- **Panic button** — broadcasts All Notes Off on every MIDI port and zero TC on MTC + Art-Net + OSC, using the current fps.
- **Setlist durations + total runtime** — per-song durations and cumulative show length surfaced in the setlist panel.
- **Next-song overlay** — full-screen overlay during the last 15 seconds of a song previews the next track.
- **MIDI cue fire indicator** — visual confirmation when a cue fires on the wire.

### Added — UX improvements

- Keys **1–9** jump directly to that position in the setlist.
- **TC inline edit** — double-click any timecode digit to seek.
- **Countdown toggle** — switch between elapsed and remaining time; last 30 s turns red.
- **Output heartbeat** — status dots pulse at the output rate to confirm the wire is live.
- **Waveform zoom memory** — zoom level persists per-file.
- **Ultra-dark mode** — high-contrast theme for dim FOH positions.
- **Keyboard shortcuts help** — `?` button surfaces the full shortcut list.
- **Loading spinner** — large-file imports now show progress instead of freezing.
- **License dialog improvements** — PRO badge clickable, promo expiry visible, Volume license email copy-to-clipboard.
- **Tri-lingual UI** — English / 繁體中文 / 日本語.

### Fixed

**Output protocols**
- OSC float type handling corrected for Resolume and Disguise (was sending ints where floats were required).
- Panic now broadcasts to both MTC and cue ports (previously only one).
- Panic sends zero MTC packets, not just zero Art-Net / OSC.
- Panic respects the current project fps instead of a hardcoded 25.
- MIDI Clock timer leak on transport restart eliminated.

**Timecode accuracy**
- `parseTc` frame limit is now fps-aware (rejects frame 30 at 25 fps).
- LTC spec compliance tightened (biphase mark, sync word, frame count).
- BPM detector accuracy improved (onset + autocorrelation refinements).

**Licensing & trial**
- Trial clock rollback detection hardened.
- Pro state fingerprint binding closes cross-machine license copy loophole.
- safeStorage encryption prevents on-disk tampering.
- Promo license expiry correctly enforced.

**Rendering & state**
- Standby index resyncs on setlist reorder / delete.
- Print-to-PDF runs in a sandboxed `BrowserWindow` (isolation + no remote).
- `App.tsx` `useStore` selectors narrowed with `useShallow` — avoids 30 Hz re-render storm on TC updates.
- Defensive copies on shared state; cleanup on unmount paths closed.

**Code review passes**
- 22 bugs fixed across 10 rounds of strict internal review (`1bedac2`).
- 10 issues from strict code review (`c7ec427`).
- 8 QA issues from review of standby/panic/showlog commits (`ad786cc`).
- 7 bugs from CodeRabbit review (`ba412bf`).

### Changed

- README (EN + zh-TW) rewritten to reflect the free/Pro split, pricing, and the v0.5.0 feature set.

### Performance

- `App.tsx` `useStore` narrowed with `useShallow` — previously the whole store tree triggered 30 Hz re-renders during playback; now only the fields the component reads invalidate it.

### Infrastructure

- Cloudflare Worker added for promo redemption (`worker/index.js` + `wrangler.toml`) with a per-code Durable Object for atomic redemption.
- Bitfocus Companion module lives in a separate `companion/` directory alongside the Electron app.
- 265 Vitest tests passing on every build.

### Deferred to next release

- Timecode Chase (slave to incoming LTC) — scoped into v0.6.0.

[0.5.0]: https://github.com/xyproai-bot/LTCast/releases/tag/v0.5.0
