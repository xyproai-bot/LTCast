# LTCast landing page

Single-page static site. Tailwind via CDN, no build step, deploys to Cloudflare Pages.

## Structure

```
landing-page/
├── index.html        Main landing page (hero, features, comparison, pricing, FAQ)
├── _headers          Cloudflare Pages security + cache headers
├── _redirects        Shortlinks: /buy, /download, /github, /companion
├── robots.txt
├── sitemap.xml
└── assets/           (create before deploy)
    ├── icon.png       512×512 app icon  — copy from ../../resources/icon.png
    ├── screenshot.png 1600×1000 hero shot — copy from ../../resources/screenshot.png
    └── og-image.png   1200×630 Open Graph image — see press-kit/ for guidance
```

## Before first deploy — populate `assets/`

From repo root:

```bash
mkdir -p marketing/landing-page/assets
cp resources/icon.png       marketing/landing-page/assets/icon.png
cp resources/screenshot.png marketing/landing-page/assets/screenshot.png
# Export og-image.png from the press kit (1200×630, .png, <300KB)
```

## Deploy to Cloudflare Pages

### Option A — drag-and-drop (fastest, good for first deploy)

1. Log in to https://dash.cloudflare.com → Workers & Pages → Create → Pages → "Upload assets".
2. Project name: `ltcast`.
3. Zip `marketing/landing-page/` and drop it in.
4. After first publish, bind custom domain `ltcast.app` (Pages will create the CNAME automatically).

### Option B — Git-connected (recommended for updates)

1. Workers & Pages → Create → Pages → Connect to Git → pick this repo.
2. Branch: `master` (or `marketing/launch-kit` for preview).
3. Build command: *(leave empty)*
4. Build output directory: `marketing/landing-page`
5. Save. Cloudflare rebuilds on every push.

## Production hardening (before scale)

Tailwind CDN is fine for launch but adds ~300KB and a runtime compile. Before you expect real traffic:

```bash
cd marketing/landing-page
npx tailwindcss -i ./src.css -o ./assets/tailwind.css --minify
```

Then replace the `<script src="https://cdn.tailwindcss.com">` block with:

```html
<link rel="stylesheet" href="/assets/tailwind.css" />
```

Config for the compiled build lives in a `tailwind.config.js` you'd add — keep the extended palette from the inline config in `index.html`.

## Analytics

None wired. If you want them, drop Plausible or Cloudflare Web Analytics just above `</body>` — both are cookieless and fit the rest of the privacy posture (no GA).

## Content review checklist

- [ ] Screenshot is current-release UI (no stale element positions)
- [ ] Pricing numbers match Lemon Squeezy product page
- [ ] All three download/buy links resolve
- [ ] Comparison table disclaimer is present
- [ ] No AI-generated claim wording ("world's first", "revolutionary", etc.) — this copy was deliberately written to avoid that register
