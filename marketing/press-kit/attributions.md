# Third-party attributions

Running list of everything we didn't write ourselves and the terms we use it under. Update whenever a new dependency, asset, or third-party integration lands.

## Software dependencies

Full list in `package.json` + `package-lock.json`. Noteworthy for attribution:

| Package | License | Role |
|---------|---------|------|
| Electron | MIT | Desktop shell |
| React | MIT | UI |
| Zustand | MIT | State |
| Vite / electron-vite | MIT | Build tooling |
| ffmpeg-static | GPL/LGPL (bundled binary) | Audio/video decoding |
| fluent-ffmpeg | MIT | FFmpeg wrapper |
| wavesurfer.js | BSD-3-Clause | Waveform rendering |
| electron-updater | MIT | Auto-update |
| archiver / extract-zip | MIT | Preset import/export |

FFmpeg is bundled under LGPL. Our shipping binary does not statically link FFmpeg into our own code; we shell out. If that changes, we owe an additional LGPL compliance notice.

## Fonts

Landing page uses system font stack (`ui-sans-serif`, `system-ui`, `-apple-system`, `Segoe UI`, `Inter`). No licensed fonts shipped with the landing page — everything is user-installed.

The app itself uses the same system stack. No CDN fonts (the Google Fonts CDN was removed in v0.5.0 audit for offline-safe operation).

## Assets

- **App icon:** original artwork, property of LTCast.
- **Landing page screenshots:** captured from our own application.
- **Competitor names in comparison table:** used nominatively. QLab is a trademark of Figure 53 LLC. grandMA is a trademark of MA Lighting. ChamSys is a trademark of ChamSys Ltd. Avolites is a trademark of Avolites Ltd. Rosendahl, Mutec, Resolume, Disguise (d3), WATCHOUT — all trademarks of their respective owners.
- **Demo video music:** to be sourced from a royalty-free library (Epidemic Sound / Artlist) at time of production. Log the actual track URL and license certificate in this file once the video is cut.
- **Stream Deck photography:** either our own hardware or licensed stock. Stream Deck is a trademark of Elgato / Corsair.

## Protocols

LTCast reads and writes standardised protocols. No attribution required, but we cite specs for precision:

- SMPTE 12M (timecode, LTC biphase-mark encoding)
- MIDI Association — MTC and MIDI Clock specifications
- Art-Net 4 — specification by Artistic Licence
- OSC 1.0 / 1.1 — Open Sound Control specification (CNMAT, UC Berkeley)

We do not republish specification text; we reference it.

## Trademark usage

LTCast itself is an unregistered trademark of the project maker. If that changes (registration), update the footer of `landing-page/index.html` and every press doc.

When press releases name competitors for comparison, use the ™ / ® symbols the first time the mark appears in the document, or include a disclaimer paragraph at the end. The landing page already has the disclaimer paragraph under the comparison table.
