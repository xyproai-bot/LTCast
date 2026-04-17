# Changelog

All notable changes to LTCast are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
