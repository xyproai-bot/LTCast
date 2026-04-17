# ETC Community launch post

ETC Community (community.etcconnect.com) is frequented by Eos family operators. The audience is narrow and technical — lighting programmers, touring LDs, and ETC's own staff occasionally weigh in. Posts that come across as self-promotion get ignored; posts that solve a specific Eos-adjacent problem get pinned.

The angle here is **not** "look at my new app". The angle is **"here's a timecode source that plays nicely with Eos"**. Prove it with Eos-specific details.

Subforum likely candidates:

- `Lighting Consoles → Eos Family` — if the post is framed around timecode-to-Eos.
- `Off-topic / General` — if the post is a plain tool share.

Put it in the Eos subforum. Broader reach comes from relevance, not from a bigger audience.

---

## Title

> Free tool for sending LTC / MTC / Art-Net timecode from a Windows or Mac show PC into Eos

## Body

> Hi all — wanted to flag a tool in case it's useful for anyone running timecode into Eos from a show PC.
>
> **LTCast** (ltcast.app) is a desktop app that reads or generates timecode from an audio file and simultaneously sends it as LTC, MTC, and Art-Net OpTimeCode. It runs on Windows and macOS. I built it because I kept needing all three of those outputs on one PC for corporate gigs, and chaining apps had failure modes I couldn't accept.
>
> Eos-specific notes from my testing (Eos Ti, Eos Apex, Gio @5, Element 2 — all on recent firmware):
>
> - **Art-Net OpTimeCode** into Eos works cleanly. `Setup → System → Show Control → Art-Net Time Code`, pick the right universe, and Eos picks it up. LTCast sends standard Art-Net 4 OpTimeCode, broadcast or unicast.
> - **MTC** into Eos works if you have a USB-MIDI interface on the Eos side. Quarter-frame is what Eos chases; LTCast's quarter-frame scheduling uses chained Web MIDI timestamps so the 8 QF messages land on-grid rather than being nudged by the JavaScript event loop. (In testing, sub-ms jitter vs. LTCast's master clock.)
> - **LTC** into Eos works through a physical audio interface on the Eos side; LTCast generates biphase-mark LTC with the SMPTE 12M-1 §6.2 correction bit. 24 / 25 / 29.97DF / 30 NDF supported.
>
> A few things I've specifically tested that matter for Eos users:
>
> - Drop-frame 29.97 is handled correctly end-to-end. TC → frames → TC is identity across the full 24h range (265 unit tests on the conversion layer).
> - Pausing and resuming playback does **not** re-initialise the LTC encoder — the worklet persists, so timecode resumes cleanly from the exact frame you paused on, with no re-calibration blip that would throw Eos off.
> - The Pre-Show Check / panic-stop workflow means the timecode source can be killed in one click during a problem, which is the missing piece I couldn't get out of a DAW.
>
> It's a freemium app — LTC reader/generator is free; the Art-Net / MTC / OSC outputs and show-control features are Pro. 14-day free trial, then $49/year or $15 for a 7-day pass. Student / community-theatre licenses free on request.
>
> Source is public: github.com/xyproai-bot/LTCast
>
> If anyone runs a show PC alongside Eos and wants to test, I'd value bug reports — especially any desk-specific quirk. Please file issues on GitHub with your desk model and firmware version, and a sample WAV if the issue is timecode-shape related.
>
> Not ETC-affiliated in any way; just a user posting what I made. Mods, please move if this isn't the right subforum.

## Reply posture

- Eos users expect precision. "I think it works" is not enough — give version numbers.
- If a user asks about something you haven't tested (e.g. Eos Classic, specific Nomad configs), be upfront: "haven't tested that — if you set up a bench rig I'll match it here".
- Don't compare to ETC's own Nomad timecode handling unfavourably. The community dislikes it and it's unnecessary — we're solving a different problem (show-PC-as-master, rather than the desk-as-master).
- Don't paste pricing repeatedly. One mention, in the main post, is enough.
