# r/livesound launch post

> **Important: r/livesound is stricter than the theatre subs about self-promo.** Many tool posts get removed unless they are:
>
> 1. From an account with significant live-sound / mixing history in the sub, and
> 2. Posted as a genuine question or discussion, not an announcement.
>
> **If the account doesn't have at least a dozen substantive comments in r/livesound already, DO NOT post this — comment for a week first, then revisit.**

Audience framing: this sub is engineers at FOH and monitor. They care about **reliability, latency, and not getting fired**. They do not care about brand voice, feature marketing, or "one app to rule them all" language.

---

## Flair
`Discussion` (preferred) or `Gear` — avoid `Promotion` unless the sub has a dedicated promo thread.

## Title options

Pick one. Framed as an engineering discussion, not a release.

1. *What's your current go-to for sending LTC + MIDI Clock simultaneously on a Windows rig?*
2. *Open-sourcing the timecode app I've been using on corporate gigs — curious what live-sound folks think*
3. *How are people handling MTC + Art-Net generation on Windows show PCs these days?*

Option 1 is the safest — it's a genuine question and you can mention LTCast in a reply, not the post body. That's the tactic to use if this is a first-time post.

## Body (Option 1 — question-led, recommended)

> Sanity check from the live-sound side. On a Windows show PC I need to send:
>
> - LTC out to a video playback rig (timeline chase)
> - MIDI Clock to a few pieces of hardware and a laptop running Ableton
> - Occasionally Art-Net to lighting for the intro walk-in
>
> I've been running a mix of Reaper + a couple of scripts + sACNView to watch packets, and it works but if one of them chokes, the whole thing cascades.
>
> What's everyone actually using? Specifically curious about:
>
> - How you're getting Art-Net OpTimeCode out of a DAW (if at all)
> - Whether anyone uses dedicated hardware (Rosendahl / Mutec) just for this
> - Whether hand-rolled OSC bridges are still the norm for triggering media servers
>
> I've been building a tool (LTCast) that rolls all four protocols into one app because I got tired of the chain, but I'd genuinely rather use whatever the community already trusts. Tell me what I'm missing.

Mention LTCast once, late, in that framing. Let the discussion go where it goes. If people ask more, answer in replies with detail.

## Body (Option 2 — release-led, only if account has standing)

> Been building a timecode app called LTCast specifically for the Windows side of live sound because I got tired of chaining tools. It reads and generates LTC, and simultaneously sends MTC, MIDI Clock, Art-Net and OSC out of one window — so the show PC has one thing to crash, not four.
>
> Free 14-day trial. Paid is $49/year. Runs on Mac too.
>
> What I want from this sub specifically:
>
> - Anyone have pathological Windows audio-driver behaviour they want me to test against? WASAPI edge cases, buffer-size weirdness, ASIO quirks around virtual cables — I want the bug reports.
> - What's the worst show-night timecode failure you've had, and which app caused it? Trying to build the failure modes into regression tests.
>
> Site: ltcast.app · source: github.com/xyproai-bot/LTCast

## Reply posture

- Live-sound engineers will test your claims. Be ready to answer, in order: frame accuracy, buffer size, CPU usage at 48k/96k, what happens when a USB audio interface is unplugged mid-show.
- If someone says "I just use hardware", agree that hardware is more reliable and explain where software fits — i.e., when the show is entirely in-the-box and adding $600–$2500 of hardware per rig isn't justifiable.
- Be specific about Windows driver pain. This audience respects the Windows reality.
- Don't post the Lemon Squeezy URL in this sub.

## What to do if the post gets removed

- Don't re-post. DM the mod, ask what the issue was, and adjust. The sub's long memory is worse than a single removal.
- If removal was for "promo", treat the account as "needs 6 months of real comments in the sub before anything product-related shows up again".
