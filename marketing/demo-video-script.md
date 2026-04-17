# LTCast — 2-minute demo video script

Target length: **2:00 ±5s**. Pace: one idea per ~8 seconds. Voiceover over screen recording, one cut to a live-show B-roll around 0:50.

Aspect ratio: **16:9, 1920×1080**, 60fps screen capture. Export a 1:1 square crop for Instagram / X and a 9:16 vertical cut (hero frame only) for Reels / TikTok.

Audio: single bed music at -20 LUFS; voiceover at -16 LUFS; no music sting at the end — let the CTA card breathe.

---

## 0:00 – 0:15 · Hook

**Visual.** Dark screen. A Windows taskbar lights up one icon at a time: Reaper → loopMIDI → sACNView → QLab-like fake cue app → and a frustrated cursor jumping between them. Time ticks in corner.

**VO.**

> "Windows doesn't have QLab. So if you need timecode for a live show, you end up chaining three or four apps — and hoping none of them drops at showtime."

**Caption.** Big type on cut: **One file. Every device.**

---

## 0:15 – 0:45 · Core demo

**Visual.** LTCast opens. Walk through in this exact order, cursor visible:

1. **Drag a WAV onto the window** → dual waveform appears (music on top, LTC channel below). Timecode display reads `00:00:00:00`. *(3s)*
2. **Setlist panel open on the right.** Drag two more songs in. Drag to reorder. Each shows duration + auto-advance toggle. *(5s)*
3. **Device panel.** Pick music output (e.g. "Speakers"), LTC output (e.g. "VB-CABLE"), MIDI out for MTC (e.g. "loopMIDI Port 1"), Art-Net target IP `2.255.255.255`. *(6s)*
4. **Hit play.** Timecode display advances. Zoom into the Big Clock overlay. Show MIDI Clock indicator blinking with BPM, MTC QF LED blinking, Art-Net packet counter incrementing. *(6s)*
5. **Cut to B-roll** — a real lighting console (or any MA / ChamSys screen recording) receiving timecode, a DAW session chasing MTC, and a Resolume comp scrubbing on OSC. Hold 3 seconds on each to make the claim concrete. *(9s)*

**VO.**

> "Drop in a track. Build your setlist. Pick one audio device for the room and another for LTC. That's it — LTCast is now sending LTC for your lighting cues, MTC for your DAW, MIDI Clock for any hardware, Art-Net for the console, and OSC for your media server. At the same time. From one app."

---

## 0:45 – 1:30 · Show tools

**Visual.** Quick succession, 5–7 seconds each, with caption cards.

1. **Pre-Show Check.** Standby panel glows amber → operator hits GO → flips green, next-song overlay shows the upcoming track with a countdown. *(7s)*
2. **Panic button.** Hit it — transport stops, all outputs silenced, Big Clock flashes red `ALL STOPPED`. *(5s)*
3. **Show Log.** Swap panels. Scroll the event list: `cue fired`, `device dropout`, `song advance`. Click **Export CSV** — save dialog flashes. *(6s)*
4. **Stream Deck + Companion.** Cut to a physical Stream Deck. Fingers press GO, NEXT, PANIC. On screen, LTCast reacts in real time. *(10s)*
5. **Remote Display.** Open `http://phone-ip:3100` on a phone propped at FOH — giant readable timecode, current song, next song. *(6s)*
6. **MIDI Cue list.** Flash the cue panel: program change at `00:01:32:00`, CC at `00:02:15:12`. *(6s)*

**VO.**

> "You get the tools a live show actually needs. A proper standby-and-GO workflow with countdowns. A real panic button that kills every output instantly. A show log you can export for post-mortems. And since there's a Bitfocus Companion module, you run the whole thing from a Stream Deck — or from a phone at FOH."

---

## 1:30 – 2:00 · Price + CTA

**Visual.** Full-screen pricing card matching the landing page:

- $49 / year — Annual
- $15 / 7-day — single gig
- Volume licensing — contact

Then end card:

- Logo
- `ltcast.app`
- Tagline: **Professional timecode for live shows. Windows & macOS.**
- QR code bottom-right → `ltcast.app/download`

**VO.**

> "LTCast is forty-nine dollars a year, or fifteen for a one-off gig. There's a free fourteen-day trial — no credit card. Windows and Mac. Download it at ltcast.app."

---

## Shot list for producer

| # | Shot | Capture method | Duration |
|---|------|----------------|----------|
| A1 | Cluttered taskbar intro | Screen capture, scripted cursor | 0:00–0:15 |
| A2 | LTCast drag-and-drop, setlist, device panel | OBS, clean desktop | 0:15–0:33 |
| A3 | Playing state — MTC / MIDI Clock / Art-Net indicators | OBS | 0:33–0:42 |
| B1 | Lighting console receiving TC (B-roll) | External camera or screen recording | 0:42–0:51 |
| A4 | Pre-Show Check + Panic | OBS | 0:45–0:57 |
| A5 | Show Log CSV export | OBS | 0:57–1:03 |
| B2 | Stream Deck close-up — hands pressing GO/NEXT/PANIC | External camera, macro lens, 60fps | 1:03–1:13 |
| A6 | Remote Display on phone | Phone capture + OBS side-by-side | 1:13–1:19 |
| A7 | MIDI Cue list | OBS | 1:19–1:30 |
| C1 | Pricing end card | After Effects / Figma → MP4 | 1:30–2:00 |

## Voiceover notes

- Conversational, slightly dry. No hype language. No "revolutionary", no "game-changer".
- British or neutral North American reads both work — avoid heavy regional accents since lighting and theatre tech buyers are global.
- Leave breathing room; the script above is deliberately under-written for 2:00 so the delivery can land.

## Legal / asset notes

- The B-roll of competing consoles (grandMA, ChamSys, Resolume) must come from licensed footage or be our own recordings. Do not pull unlabeled YouTube clips.
- End card must not use competitor logos.
- Music bed: use a royalty-free library track (Epidemic / Artlist) — log the license URL in `marketing/press-kit/attributions.md` if not yet present.
