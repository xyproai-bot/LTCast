# Hacker News launch post (Show HN)

Timing: **Tuesday / Wednesday / Thursday, 08:00–10:00 UTC** hits the US morning and keeps European eyes. Avoid Mondays (front-page churn) and Fridays (graveyard).

HN is unforgiving about marketing language. The rules for this post: first-person, specific, technical, no adjectives doing work.

---

## Title

> **Show HN: LTCast – a Windows/Mac timecode player (LTC, MTC, Art-Net, OSC)**

Title constraints: HN caps at 80 chars, strips links, dislikes colons sometimes but "Show HN:" is canonical.

Character count: 78. Keep under 80.

Do NOT use: "revolutionary", "simple", "easy", "beautiful", "world's first", an emoji, or the year. HN filters / dismisses these.

## URL

`https://ltcast.app`

(Not a GitHub release link — the landing page surfaces the story better and lets us update without editing the post.)

## Body (optional in Show HN, but recommended — keep under ~2,500 chars)

> I'm the maker. Short version: I wanted a single app that could read LTC off a show WAV, generate it for tracks without LTC, and simultaneously output MTC, MIDI Clock, Art-Net OpTimeCode, and OSC — on Windows and macOS. Most existing workflows chain 3–4 apps (Reaper + MIDI bridge + sACNView + a DIY cue list). That chain breaks in ugly ways at showtime.
>
> LTCast is an Electron + React + TypeScript desktop app. A few technical notes that might be interesting:
>
> * **Dual AudioContext.** Music and LTC each get their own `AudioContext` with independent `sinkId` routing. This was the fix for a Windows-specific issue where VB-CABLE would drop its WASAPI handle if the music and LTC outputs shared a context.
> * **LTC encode/decode in an AudioWorklet.** Biphase-mark with the correction bit from SMPTE 12M-1 §6.2. 265 unit tests on `tcToFrames` / `framesToTc`, including drop-frame 29.97 round-trip identity across the full day range.
> * **MTC quarter-frame without JS jitter.** Instead of scheduling 8 QF messages via `setTimeout` (which the event loop will nudge by several ms), we chain timestamps via `WebMIDI output.send(data, timestamp)` so they land on the exact sub-frame boundaries.
> * **Licensing without a daemon.** Cloudflare Worker receives Lemon Squeezy webhooks; the app keeps a signed license in `safeStorage`, binds to a machine fingerprint, has a 30-day offline grace, and silently re-validates every 4 hours when online. No long-running service, no admin install.
> * **Show-shaped features.** Pre-Show Check with countdowns, a Panic that tears down every output in one click, a CSV show log, a Remote Display served on `:3100` for phones/tablets at FOH, and a Bitfocus Companion module so a Stream Deck drives it.
>
> Free 14-day Pro trial. Pricing is $49/year or $15 for a one-off 7-day pass. Source is public under Commons Clause + MIT — free for personal and commercial productions, no redistribution.
>
> Happy to get into any of the above. I especially want to hear from anyone who's run timecode on Windows at scale — the failure modes have been strange and I bet there are more I haven't hit yet.

Character count: ~1,990. Under the HN body limit (2500 is soft).

## Expected questions (prepare replies in `replies.md`)

### "Why Electron?"
> Because the alternative was to write two native UIs and I'd still ship worse. The heavy paths (LTC worklet, Web MIDI scheduling, Art-Net UDP) aren't in JS or aren't on the hot path. The Electron main process does the file I/O, UDP socket, and IPC; the renderer drives the UI. Memory hovers around 180MB at idle which is fine for a dedicated show machine.

### "How accurate is the timecode?"
> LTC output is sample-accurate inside the LTC worklet — we emit the biphase bitstream at the audio rate of the selected device, so alignment is bounded by the device's buffer size (typically 128–512 samples, i.e. 2.7–10.7 ms at 48k). For MTC QF, jitter is bounded by the MIDI driver, which in practice is sub-millisecond on both platforms once we stopped round-tripping through `setTimeout`.

### "Does it do genlock / house sync?"
> No hardware genlock — that's firmly a hardware-box problem (Rosendahl, Mutec). LTCast is for the case where your show audio is already authoritative and you want everything downstream to chase it.

### "Why not cross-compile and ship a native Rust binary?"
> Honestly considered it. The show-tools UI (setlist, pre-show check, show log, MIDI cue list) is half the product and iterating on React was faster than any native GUI I can ship alone. I'd revisit if the app got heavy enough to justify it.

### "What about Linux?"
> See above — want to, not shipping it yet. The JACK/ALSA MIDI story and virtual-audio-cable equivalents are enough work to be its own project.

### "Is the license actually OSI-approved?"
> No — Commons Clause + MIT isn't OSI-compliant and I wouldn't claim otherwise. It's open source in the read-the-code, patch-it-yourself sense, but you can't repackage and resell. If that matters to your use, use the 14-day trial and talk to me.

### "Pricing seems high / low for [X]"
> Don't get defensive. Ask what comparison they're making, then give real numbers. For touring pros, $49/year is cheap compared to a single replacement Rosendahl card. For bedroom hobbyists, the 7-day pass at $15 exists on purpose so they don't pay annually for one gig.

## What NOT to do

- Don't post about pricing in the first 30 minutes — HN reads it as ad copy. Let people find it via the landing page.
- Don't upvote-beg in Slack or Discord. HN explicitly forbids this and mods will detect it.
- Don't re-submit the same URL within 24h of first submission.
- Don't respond defensively. If someone finds a bug, thank them and file it.
- Don't use "/s" or emoji. HN culture.
- If a comment gets nasty, walk away — HN downweights fights.

## After the post is live

- [ ] First comment within 5 minutes: any additional technical context you couldn't fit in the body. This signals a live maker.
- [ ] Stay in the thread for 4–6 hours to reply. Response rate matters for front-page retention.
- [ ] If it's on the front page at the 4h mark, DM a couple of people who'd find it useful but don't blanket-notify.
- [ ] Archive the thread link + top comments into `press-kit/social-proof.md` afterwards — quotes from HN threads are gold for the landing page and press.
