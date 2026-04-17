# Product Hunt launch post

Launch day plan: schedule **12:01 AM PT** (Product Hunt day starts at 00:00 Pacific). Post owner is the maker; invite hunters 24–48h in advance but do NOT pre-announce the exact launch date in public channels — PH ranks partly on velocity.

---

## Name
**LTCast**

## Tagline (60 char max — counted below)
> One timecode app for LTC, MTC, MIDI Clock, Art-Net & OSC
> *(55 chars)*

Alternate taglines if the above triggers moderation:

1. Timecode player for live shows — Windows & macOS *(47)*
2. LTC + MTC + Art-Net + OSC. One app. Windows & Mac. *(52)*
3. Professional timecode player for live shows *(44)*

## Topics
- Audio
- Video
- Developer Tools *(only if PH places us there — don't force it; broadcast/AV sits better under Audio)*
- Music

## Thumbnail (240×240 gif or png)
Animated gif, <3MB. Frames:
1. Dark LTCast UI, timecode `00:00:00:00`
2. Waveform loads, timecode starts climbing
3. Indicators light up one-by-one: MTC → MIDI Clock → Art-Net → OSC
4. Big Clock pulse on every second

Export path: `marketing/press-kit/thumbnails/ph-thumb.gif` (add during launch prep).

## Gallery images (up to 5, 1270×760 PNG)
1. Hero screenshot — main UI with a loaded track
2. Setlist + Pre-Show Check panel
3. Device panel — all four outputs configured
4. MIDI Cue list at specific timecodes
5. Remote Display on a phone at FOH

## Description (260 chars max — PH truncates)
> LTCast reads and generates LTC, triggers MIDI cues, and simultaneously sends MTC, MIDI Clock, Art-Net and OSC — so one app can drive your DAW, lighting console, hardware synths and media server. Windows & macOS. 14-day free trial.
> *(258 chars — check after paste)*

## Maker comment (first comment — this is the one people actually read)

> Hey Product Hunt — I'm the maker of LTCast.
>
> I got into this because a friend who does corporate AV kept complaining that every show on Windows turns into a Rube Goldberg: Reaper for LTC, a separate bridge for MIDI, sACNView to watch Art-Net, and a DIY cue list in a spreadsheet. If one of them drops at showtime, the console loses timecode and the show visibly stutters.
>
> macOS has QLab, which is great — but it's macOS only, and even then you're still bolting on timecode generators and MTC bridges.
>
> LTCast is the app I wanted: **one window that reads LTC from your audio, generates it for tracks that don't have it, and simultaneously sends MTC, MIDI Clock, Art-Net and OSC.** So your DAW chases, your lighting console chases, your drum machine syncs, and your media server triggers — from the same source of truth.
>
> A few things I'm especially proud of:
>
> - **Drop-frame 29.97 done right.** Full SMPTE 12M algorithm with 265 unit tests. Round-trip `tcToFrames` / `framesToTc` is identity. The LTC worklet survives pause/play so the clock calibration isn't lost between songs.
> - **MTC quarter-frame with no JS jitter.** We chain timestamps via Web MIDI `send(data, ts)` so the 8 quarter-frame messages land on-grid instead of being nudged by the event loop.
> - **Show tools that actually help at showtime.** Pre-Show Check with countdown, panic button that kills every output, CSV show log, Remote Display page on port 3100, and an official Bitfocus Companion module for Stream Deck.
>
> It's free for 14 days, then $49/year or $15 for a one-off 7-day pass. Student / community-theatre discounts are real — just email.
>
> Happy to answer anything, especially about:
> - drop-frame edge cases
> - the dual-AudioContext trick that keeps VB-CABLE alive on Windows
> - how we avoid shipping a daemon / admin installer
> - the licensing model (offline grace, instant revoke via Cloudflare Worker)
>
> Thanks for the look. — [maker name]

**Character count of the comment: ~1,650. PH doesn't cap comments but the above reads in under 60 seconds, which is the sweet spot.**

## Reply templates

These go in `replies.md` next door so they can be copy-pasted during launch day. Always personalise the first line.

### "How is this different from QLab?"
> Totally fair question — QLab is the gold standard on macOS and a lot of our users run both. The split I'd draw: QLab is a show-control / cueing app with timecode as one feature, LTCast is a timecode master with show-control bolted on. The other difference is platform — LTCast runs on Windows, which is where most of the pain was when I started.

### "Why not just use Reaper?"
> Reaper is what a lot of us were using. The problem is that Reaper doesn't natively send Art-Net, and getting simultaneous LTC + MTC + MIDI Clock + OSC out of one session means chaining several scripts or JSFX plugins. It works until it doesn't, and when it doesn't, it's show night.

### "Is it open source?"
> Source is public (Commons Clause + MIT). Free for personal and commercial productions. Redistribution / resale of the software itself isn't permitted — that's how we keep the lights on.

### "Will it run offline?"
> Yes. 30-day offline grace after activation, silent re-validation when you're on a network. Venues with no internet are the default assumption, not an edge case.

### "Will you do Linux?"
> Not yet. It's Electron so technically possible, but the ALSA / JACK MIDI surface and the virtual-audio story on Linux are messy enough that I'd rather ship a great Windows/Mac product first. If enough touring shows ask, I'll revisit.

## Hunter coordination (pre-launch, 48h before)

- [ ] DM 2–3 relevant hunters (live-sound, lighting, broadcast tech space) — ask them to **hunt**, not just upvote.
- [ ] Pre-populate the Product Hunt "Ship" page with the gallery and description so everything's ready to go live.
- [ ] Confirm `ltcast.app` has the landing page deployed and the `/buy`, `/download` shortlinks work.
- [ ] Queue the **maker comment** in a draft doc so it posts within 60 seconds of launch.

## Don'ts

- Don't mass-DM asking for upvotes. PH penalises it and the community notices.
- Don't post the PH link inside Slack/Discord asking "please upvote". Share it with a *reason*: "launched the timecode tool I've been building — would love feedback from anyone running shows on Windows."
- Don't put the price above the tagline. PH readers scan — lead with value, pricing comes in FAQ.
- Don't use emoji in the tagline. Rarely helps conversion and occasionally rejected by moderators.
