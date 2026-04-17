# Logo and icon assets — export guide

Master source is `resources/icon.svg` (vector) and `resources/icon.png` (raster master, 1024×1024). Do not re-draw the logo; re-export it.

The goal: a reviewer or partner can drop any size / format we care about without waiting on us.

---

## Export matrix

| Use | Size | Format | Filename |
|-----|------|--------|----------|
| App store / GitHub / header nav | 512×512 | PNG, transparent | `logo-512.png` |
| Social avatar | 400×400 | PNG, transparent | `logo-400.png` |
| Favicon / tiny | 128×128, 64×64, 32×32, 16×16 | PNG, transparent | `logo-{size}.png` |
| App icon master | 1024×1024 | PNG, transparent | `logo-1024.png` |
| Vector (print, scalable) | — | SVG | `logo.svg` |
| Dark backgrounds | same sizes as above | PNG, **on dark**, for previews | `logo-{size}-dark.png` |
| Light backgrounds | same sizes as above | PNG, **on light** | `logo-{size}-light.png` |
| Product Hunt thumbnail | 240×240 | GIF (animated) | `ph-thumb.gif` |
| Open Graph image | 1200×630 | PNG (hero crop + wordmark) | `og-image.png` |
| Twitter card | 1200×600 | PNG | `twitter-card.png` |
| macOS app icon | 1024×1024 → `icon.icns` | ICNS | `icon.icns` |
| Windows app icon | 256×256 multi-resolution | ICO | `icon.ico` |

All binary outputs live in `press-kit/binary/logos/` — not committed.

---

## Export steps

```bash
# From repo root. Requires ImageMagick / librsvg / icon-gen (choose your tool).

cd marketing/press-kit/binary/logos

# 1. Raster exports from SVG master
for s in 1024 512 400 256 128 64 32 16; do
  rsvg-convert -w "$s" -h "$s" ../../../../resources/icon.svg \
    -o "logo-${s}.png"
done

# 2. macOS .icns (requires iconutil on macOS, or png2icns on Linux)
mkdir icon.iconset
cp logo-16.png   icon.iconset/icon_16x16.png
cp logo-32.png   icon.iconset/icon_16x16@2x.png
cp logo-32.png   icon.iconset/icon_32x32.png
cp logo-64.png   icon.iconset/icon_32x32@2x.png
cp logo-128.png  icon.iconset/icon_128x128.png
cp logo-256.png  icon.iconset/icon_128x128@2x.png
cp logo-256.png  icon.iconset/icon_256x256.png
cp logo-512.png  icon.iconset/icon_256x256@2x.png
cp logo-512.png  icon.iconset/icon_512x512.png
cp logo-1024.png icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset

# 3. Windows .ico (multi-resolution)
magick convert logo-16.png logo-32.png logo-64.png logo-128.png logo-256.png icon.ico

# 4. Copy the already-built app icons if they exist
cp ../../../../resources/icon.icns icon-app.icns
cp ../../../../resources/icon.ico  icon-app.ico
```

## Open Graph image

`og-image.png` (1200×630) is what Slack / Twitter / LinkedIn / Facebook render when someone pastes `ltcast.app`.

Design spec:

- Left 60%: LTCast hero screenshot, slightly zoomed so the timecode display is prominent and readable at thumbnail size.
- Right 40%: dark gradient matching the landing page hero (`#05060a → #0a0c14` with the accent glow).
- Wordmark `LTCast` bottom-right in the same accent gradient as the landing page.
- Tagline below wordmark, small: `Professional timecode for live shows`.
- Do **not** put pricing on the OG image — it dates the asset.

Export from Figma / Sketch at 1200×630 PNG, compress to under 300KB with `pngquant`.

## Wordmark / lockup rules

- LTCast is one word, capital L, capital T, capital C (**LTCast**). Not `LTcast`, not `Ltcast`, not `LT Cast`.
- The wordmark uses the same sans family as the app (ui-sans-serif stack). Don't freehand a wordmark in a different typeface.
- Minimum clear space around the mark = the height of the letter `L` in the wordmark.
- Do not recolour the icon except to produce a monochrome white version for placement on busy photography.

## Do / Don't

**Do**
- Keep the icon on a transparent background for PNG exports.
- Test the 32×32 version — if the mark is illegible at that size, it needs simplification before release.
- Re-export if the master icon changes, and bump version on all filenames if the design changes materially (`logo-512.v2.png`).

**Don't**
- Don't letter-space or stretch the wordmark.
- Don't place the wordmark over photography without a solid-colour backing plate.
- Don't drop shadows on the icon. It's a flat mark.
- Don't ship a JPEG of the logo. Ever.
