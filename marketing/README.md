# LTCast launch kit

Everything needed to launch LTCast publicly. Scoped to marketing only — no source code, no product changes.

```
marketing/
├── README.md                  This file
├── landing-page/              Static site — deployable to Cloudflare Pages
│   ├── index.html
│   ├── _headers
│   ├── _redirects
│   ├── robots.txt
│   ├── sitemap.xml
│   └── README.md              Deploy instructions + asset population steps
├── demo-video-script.md       2-minute demo: hook → demo → tools → price/CTA
├── launch-posts/
│   ├── README.md              Posting order + spacing + ground rules
│   ├── product-hunt.md
│   ├── hackernews.md
│   ├── reddit-lightingdesign.md
│   ├── reddit-techtheatre.md
│   ├── reddit-livesound.md
│   ├── controlbooth.md
│   └── etc-community.md
├── press-kit/
│   ├── README.md
│   ├── boilerplate.md         One-sentence / 50-word / 150-word / facts sheet
│   ├── screenshots.md         10 named shots, with capture environment spec
│   ├── logo-assets.md         Export matrix + bash commands
│   ├── press-contacts.md      Email routing + response templates
│   ├── attributions.md        Third-party licenses and trademarks
│   └── social-proof.md        Empty until launch — populated with real quotes only
└── launch-checklist.md        T-7 / T-1 / T-0 / T+1 / emergency playbook
```

## How to use this folder

The documents are designed to be worked through in roughly this order:

1. **Read `launch-checklist.md` first.** It's the spine of the launch and tells you when everything else is needed.
2. **Deploy `landing-page/`.** Instructions in `landing-page/README.md`. This is the dependency for every other channel — all launch posts link to it.
3. **Film the demo video** using `demo-video-script.md`. Upload unlisted first; flip to public on launch day.
4. **Populate `press-kit/`.** The text files in here are guides — the actual binary assets (PNG screenshots, logo exports) are produced following those guides and uploaded to a public bucket or stored in `press-kit/binary/` (gitignored).
5. **Prep the launch posts.** Each file is platform-specific — treat them as drafts to be read aloud, then posted at the times specified in `launch-checklist.md`. Do not cross-paste between platforms.

## What's in scope for this branch

- All content under `marketing/**`.

## What's explicitly out of scope

- `src/**` — not touched.
- `README.md`, `CHANGELOG.md` — not touched.
- `package.json`, `package-lock.json` — not touched.
- `.github/**` — not touched (CI and release workflows owned by Sprint A).
- `electron-builder.yml` — not touched (code signing owned by Sprint E).
- Any source, build, or packaging config.

## Review-first PR

This branch is meant to be **opened as a PR but not merged**. The copy across all these files needs human review — tone, factual accuracy, version alignment, legal claims, competitor references. Don't auto-merge.

## Things that are deliberately missing

Some things a launch kit usually has that are **not included here, and why**:

- **Twitter / X thread drafts.** Low-ROI for a niche pro tool. One thread on launch day, written the morning of, is enough. Pre-written threads tend to read stale by the time they post.
- **LinkedIn posts.** Only useful if the maker has a pre-existing AV/theatre network. Generic LinkedIn reach doesn't convert for this product.
- **Email newsletter drafts.** We don't have a list yet. Build it post-launch from signups on the landing page, then write the first issue.
- **Paid ad creative.** Not the right stage. This product converts on trust and word-of-mouth in pro communities, not paid impressions.

If any of these become relevant later, they belong here too — but don't add them speculatively.

## Maintenance

When v0.5.x ships, update:

1. Version callout in `landing-page/index.html` (hero badge)
2. Test count in `press-kit/boilerplate.md` facts sheet
3. Feature list in `landing-page/index.html` (feature grid) if anything new is announceable
4. `press-kit/attributions.md` if new dependencies landed
5. `press-kit/social-proof.md` after every meaningful piece of press coverage

Leave everything else alone unless specifically required. The files here are reference documents — they get stale if you touch them constantly.
