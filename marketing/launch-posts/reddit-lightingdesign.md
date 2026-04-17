# r/lightingdesign launch post

> **Read the sub rules before posting.** r/lightingdesign explicitly restricts promotional posts. Self-promotion is allowed if you **participate in the community** outside of your own links and if the post is **useful, not salesy**. As of the most recent rule sweep, the rule of thumb is "9:1" — nine community contributions for every one self-promo — and mods have been known to remove posts that don't meet it.
>
> **Action before posting:** spend a week answering console / timecode / Art-Net questions in the sub under the same account. If that hasn't happened yet, DO NOT post this.

---

## Flair
`Resource` (or `Free Resource` if available). Do not use `Self-promotion` unless the sub has a dedicated thread — some subs do, check.

## Title options

Pick one. All are phrased as a **tool-share**, not an ad.

1. *I built a Windows/Mac timecode app that sends Art-Net, LTC, MTC, and OSC at the same time — free 14-day trial, would love LD feedback*
2. *Tired of chaining 4 apps for timecode on a Windows show PC — built an alternative, looking for real-world testers*

## Body

> Long-time lurker, first time posting something I made. Apologies in advance if this is too close to the line on self-promo — mods, please nuke if so.
>
> Context: I kept running into the same problem on Windows show PCs — if you want LTC for the console, MTC for a DAW, MIDI Clock for hardware, and OSC for a media server, you end up running three or four apps. When one drops, your console loses timecode on stage.
>
> I built **LTCast** to do all of that in one window:
>
> - Reads LTC from any audio file, auto-detects the channel and frame rate.
> - Sends **Art-Net OpTimeCode** over UDP (broadcast or unicast), which the grandMA / ChamSys / Avolites desks read as external timecode.
> - Also emits MTC, MIDI Clock, and OSC simultaneously, so you can sync the audio world and the video world from the same master.
> - Has a Pre-Show Check / GO workflow, a panic button, a CSV show log, and a Bitfocus Companion module.
>
> Runs on Windows 10+ and macOS 12+.
>
> **What I actually want from this post:** if you run timecode on a show, I'd love to know the failure modes you've hit and whether the above would have saved you any grief. Specifically curious about:
>
> - How reliable is your current Art-Net TC source? Consoles I've tested with read fine; would love to know edge cases.
> - Whether Stream Deck integration is actually useful at FOH or whether it's just a "nice to have".
> - Whether anyone needs 23.976 (NDF) specifically — I support 24/25/29.97DF/30 right now and have had one request for 23.976.
>
> Free 14-day trial of everything, no credit card. If you're a student or a community theatre, there's a free license — DM me.
>
> Site: ltcast.app · GitHub: github.com/xyproai-bot/LTCast

## Why this post should work (or not)

**Good:**
- Lead with the problem, not the product.
- Ask real questions — gives the community a reason to comment.
- Offers students / community theatre a free license (the sub has a lot of both).
- Doesn't dunk on competing tools.

**Risk:**
- If the account has zero prior activity in the sub, mods will remove. Check the account's history in the sub before posting; if it's under ~5 meaningful comments, build that first.
- "Free 14-day trial" reads like ad copy. It's fine if surrounded by substance, but if mods remove, drop that line and leave only the product link.

## Reply posture

- Answer every technical question with specifics (frame rates, protocols, buffer sizes). This sub respects technical rigour.
- If someone complains about the price, take it seriously and ask what they'd compare it to. Don't retreat to "it's cheaper than hardware" unless you're specifically being compared to hardware.
- If someone has a feature request that's plausible, say so openly ("yeah that's on the list" / "not today but I'd take a PR" / "interesting — can you describe the use case?"). LDs can smell corporate PR voice from a mile away.
- **Do not post the Lemon Squeezy checkout URL in replies.** Link to the landing page; let the page convert.
