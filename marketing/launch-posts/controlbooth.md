# ControlBooth.com launch post

ControlBooth is a forum, not a feed. Posts live for months and get found by search — that means the post should read like a *reference document*, not an announcement. Include version numbers, protocol spec citations, OS support, and links. Avoid marketing voice entirely.

Forum rules (as of latest check):

- `Commercial Announcements` is the correct subforum for a tool release. The forum requires that self-promotion goes **only** in that subforum.
- Put your user title / disclaimer in the signature line (e.g. "Maker of LTCast — take my opinions accordingly").
- Don't cross-post to `Lighting` / `Sound` / `Video`. Link from those threads if someone asks, but the launch post itself belongs in Commercial Announcements.

---

## Subforum
`Commercial Announcements → Software`

## Prefix (if available)
`[New Product]`

## Title

> LTCast v0.5 — Timecode player for live shows (LTC / MTC / MIDI Clock / Art-Net / OSC, Windows & macOS)

## Body (forum BBCode-style; adjust tags if the forum uses a different flavour)

> [b]Summary[/b]
>
> LTCast is a cross-platform desktop app that reads and generates SMPTE 12M LTC from audio files, and simultaneously emits MIDI Timecode (quarter-frame + full-frame SysEx), MIDI Clock, Art-Net OpTimeCode, and OSC.
>
> It's designed for the specific problem of "my show PC needs to act as the timecode master for lighting, video, DAW chase, and hardware sync at the same time". On Windows in particular, this usually requires chaining multiple applications; LTCast consolidates it into one window.
>
> [b]Supported protocols and formats[/b]
>
> [list]
> [*][b]LTC I/O[/b]: biphase-mark with SMPTE 12M-1 §6.2 correction bit. Frame rates 24 / 25 / 29.97DF / 30 NDF. Full drop-frame algorithm with 265 unit tests; round-trip TC → frames → TC is identity across the full 24h range.
> [*][b]MTC[/b]: quarter-frame (0xF1 + nibble) with chained timestamp scheduling over Web MIDI (sub-millisecond jitter in testing). Full-frame SysEx (F0 7F 7F 01 01 hh mm ss ff F7) for jump sync.
> [*][b]MIDI Clock[/b]: 0xF8 timing clock at any BPM, 0xFA / 0xFB / 0xFC transport.
> [*][b]Art-Net[/b]: OpTimeCode UDP packet, Art-Net 4 compliant, broadcast or unicast, configurable target IP / port.
> [*][b]OSC[/b]: per-cue templates for Resolume, Disguise (d3), WATCHOUT; arbitrary OSC messages at user-defined timecodes.
> [*][b]Audio input[/b]: WAV, AIFF, MP3, FLAC, OGG. Video: MP4, MOV (audio track auto-extracted via ffmpeg-static).
> [/list]
>
> [b]Show-control features[/b]
>
> [list]
> [*]Setlist with drag-and-drop ordering, per-track duration, auto-advance with countdown timer, pre-cache of next song for gapless transitions.
> [*]Pre-Show Check / standby / GO workflow with next-song overlay.
> [*]Panic button — tears down every output (audio, MIDI, Art-Net, OSC) in one click.
> [*]Show Log with CSV export (timestamp, event, source, target, notes).
> [*]MIDI Cue list — program changes, notes, CCs scheduled to specific timecodes.
> [*]Remote Display on port 3100 (WebSocket + HTML) with PIN auth — for phones/tablets at FOH.
> [*]Bitfocus Companion module (source in [tt]companion/[/tt] subdir) — Stream Deck control.
> [/list]
>
> [b]System requirements[/b]
>
> [list]
> [*]Windows 10 or later (NSIS installer, code-signed)
> [*]macOS 12 or later (universal DMG, Intel + Apple Silicon, signed + notarised)
> [*]For LTC output: any virtual audio cable (VB-CABLE on Windows, BlackHole on macOS)
> [*]For MTC / MIDI Clock output: any virtual MIDI port (loopMIDI on Windows, IAC Driver built-in on macOS)
> [/list]
>
> [b]Licensing[/b]
>
> - Free tier: LTC reader + generator, dual waveform, A-B loop, tap BPM, video import, all frame rates.
> - Pro tier: MIDI Cues, MTC, MIDI Clock, Art-Net, OSC, setlist, Pre-Show Check, Show Log, Companion module, and the rest — full list at ltcast.app.
> - 14-day Pro trial on first run, no credit card. $49/year or $15 for a 7-day single-event pass.
> - Source is public under Commons Clause + MIT. Free for commercial productions; no redistribution of the software itself.
>
> [b]Links[/b]
>
> - Site: [url]https://ltcast.app[/url]
> - Downloads: [url]https://github.com/xyproai-bot/LTCast/releases/latest[/url]
> - Source: [url]https://github.com/xyproai-bot/LTCast[/url]
> - Issues / feedback: [url]https://github.com/xyproai-bot/LTCast/issues[/url]
> - Contact: xypro.ai@gmail.com
>
> Happy to answer technical questions in this thread. If you hit a bug, a GitHub issue with a sample WAV and your console model is the fastest path to a fix.
>
> — [maker name], maker of LTCast

## Reply posture

- Forum culture rewards patience and specificity. Answers can be long. Protocol citations and version numbers are expected.
- If someone asks about a grandMA3 / Hog 4 / EOS quirk, give specifics — model, OS version, LTCast version tested. If you haven't tested it, say so and offer to get it on a rig within a week.
- Thread will stay searchable for years. Keep the tone so it still reads well to someone finding it in 2028.
