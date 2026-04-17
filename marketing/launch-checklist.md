# Launch day checklist

Target launch: **Tuesday, Wednesday, or Thursday** of a non-holiday week. Avoid Mondays (front-page churn), Fridays (graveyard), the week of a major US holiday, and CES / NAMM / LDI weeks (trade-press bandwidth is saturated).

All times assume **Pacific Time (PT)** — Product Hunt day starts at 00:00 PT. Convert for your local timezone.

---

## T-7 days — preparation

### Product
- [ ] Current release (v0.5.x) is cut and tagged on `master`. Installers are signed and notarised. (Tracked by Sprint A / Sprint E — do not assume; confirm before this checklist starts.)
- [ ] `ltcast.app` landing page is deployed on Cloudflare Pages with custom domain. Confirm `/buy` and `/download` shortlinks resolve.
- [ ] Lemon Squeezy storefront is live. Run a $1 test purchase against a non-production test product to verify the webhook path end-to-end; refund immediately. Do NOT test against the real product — it muddies analytics and can trigger a fraud flag.
- [ ] Machine fingerprint binding has been verified on at least one Windows and one macOS machine in the last 7 days. License revoke path (admin → revoke → app re-checks) has been exercised.
- [ ] `npx vitest run` is green. `npm run build` is green. The GitHub Actions `build.yml` tag job succeeded on the tagged release.

### Content
- [ ] Demo video is rendered in 16:9, 1:1, and 9:16 aspects. Uploaded to the YouTube channel as **unlisted**. (Public flip happens at T-0.)
- [ ] Screenshot pack (shots 01–10 from `press-kit/screenshots.md`) is captured at current-release UI and compressed.
- [ ] Open Graph image (`og-image.png`) is produced and deployed.
- [ ] Product Hunt "Ship" page is pre-populated: gallery images uploaded, description pasted, maker comment drafted, hunter invited.
- [ ] Hacker News post draft exists but is NOT submitted. The post is a single-shot — one submission, no edits — so treat it carefully.

### Relationships
- [ ] 2–3 Product Hunt hunters DM'd — asked to hunt (not just upvote). Give them the landing page link to review ahead.
- [ ] 3–5 potential reviewers / podcast hosts in the lighting / AV space have been emailed with a **one-year press license** and a personal note offering interview slots. See `press-kit/press-contacts.md` for the template.
- [ ] Any pre-existing AV community contacts (forum mods, Discord admins) have been messaged personally — "heads up, launching Tuesday, would love feedback from your community, not asking you to post anything for me". Courtesy goes far.

### Admin
- [ ] Press email (`xypro.ai@gmail.com`) has auto-reply turned **off** during launch week. Auto-replies read as robotic and hurt first-contact relationships.
- [ ] GitHub issues template enabled, triage labels set up.
- [ ] A bug-fix release branch is prepared in case something immediate comes up during launch day — `git checkout -b hotfix-launch-day` and verify it can be packaged quickly.

---

## T-1 day — final checks

### Product smoke tests (run every one)
- [ ] Fresh install on a clean Windows 10 VM → activate trial → load a track → send LTC + MTC + Art-Net → confirm receiver sees signal. Time the whole flow; if it takes more than 5 minutes, something is wrong.
- [ ] Fresh install on a clean macOS VM (or throwaway account) → same end-to-end flow.
- [ ] Trial expiration path: set system clock forward 15 days, confirm the app downgrades to free tier gracefully rather than crashing.
- [ ] Offline activation: unplug network, confirm 30-day grace keeps Pro features active.
- [ ] Panic button tears down every output on the first press.

### Landing page
- [ ] Every download button resolves to a valid release asset. Click from the page, watch the browser follow the redirect.
- [ ] Every buy button resolves to the right Lemon Squeezy checkout.
- [ ] Open Graph + Twitter card render correctly. Paste `ltcast.app` into Slack and Twitter compose; confirm the preview.
- [ ] Mobile layout works on a phone. Not just "responsive in dev tools" — on an actual phone.

### Content final pass
- [ ] Read every launch post out loud. Anything that reads like marketing copy gets cut.
- [ ] No AI-voice anywhere: "unlock", "seamless", "revolutionary", "powerful", "empower", "delightful", "game-changer".
- [ ] Every claim in copy is verified against the current product. If we say "X works", it works today.
- [ ] Pricing numbers match across landing page, Lemon Squeezy, launch posts, press kit boilerplate. One source of truth.

### Infrastructure
- [ ] Cloudflare Worker (license webhook) has the current deploy — `cd worker && npx wrangler deploy` if there's any doubt.
- [ ] KV namespace bindings verified.
- [ ] Status page (if any) is reachable.
- [ ] Sentry / error reporting (if wired) has the current release registered so crashes get grouped correctly.

### Schedule the post
- [ ] Add a calendar entry for **00:01 PT** tomorrow for the PH launch. Set a 23:30 PT alarm to be at your desk.
- [ ] Add a calendar entry for **08:00 UTC** for the Hacker News Show HN submission.

---

## T-0 — launch day (times in PT)

### 00:00 — Product Hunt goes live
- [ ] Click **Ship** in the PH maker dashboard at exactly 00:01 PT. Not earlier, not later.
- [ ] Paste the pre-drafted maker comment within 60 seconds of going live.
- [ ] Share the PH URL with the hunters you invited, in a plain DM: "We're live, here's the link, thanks again for hunting."
- [ ] Flip the YouTube demo video from **unlisted** to **public**. Pin it to the channel.

### 00:00 – 04:00 — first four hours
- [ ] Reply to every comment on PH. Fast replies (<15 min) compound into velocity, which drives rank.
- [ ] Do not post the PH link into broadcast channels (company Slack ≠ ok, Telegram group with 500 random people ≠ ok). Share with individuals who'd specifically care, with a reason.
- [ ] Monitor the `#press` inbox — any journalist who sees the PH post may email within the first hour. Reply promptly.

### 08:00 UTC (varies in PT depending on time of year) — Hacker News
- [ ] Submit the Show HN post with the URL `https://ltcast.app`, title: `Show HN: LTCast – a Windows/Mac timecode player (LTC, MTC, Art-Net, OSC)`.
- [ ] Within 5 minutes, post a first comment adding any technical context that didn't fit in the body. Signals a live maker.
- [ ] For the next 4–6 hours, stay in the thread. Reply to every substantive comment. Avoid defensive tone even if the top comment is hostile.
- [ ] If the post hits front page, do NOT go silent. Keep replying. A front-page post that stops getting maker replies slides fast.

### 10:00 PT — social push
- [ ] Tweet / X thread: pinned post summarising what LTCast is, 3–4 screenshots, link. No "we're live on PH, please upvote".
- [ ] Any personal network post on LinkedIn, once only.
- [ ] Post in any Slack / Discord communities where the maker has real standing — always with a personal context sentence, never a broadcast.

### Afternoon — watch, don't do
- [ ] If things are going well, resist the urge to start additional campaigns. Launch week's momentum is front-loaded; extra channels on day one dilute attention.
- [ ] Log every notable comment, question, and piece of feedback into `press-kit/social-proof.md` as it arrives.

### Evening — wind down
- [ ] PH final rank is fixed at 23:59 PT. If top-5: great. If not: doesn't matter, PH rank is a lagging indicator.
- [ ] Acknowledge the team (even a team of one — note what worked and didn't in the log).
- [ ] Go to bed. Tomorrow has a lot of inbound.

---

## T+1 — day two

- [ ] Reply to every email that came in overnight. Press licenses within 24h of request, as committed.
- [ ] Reply to any remaining PH comments.
- [ ] Read every new issue / PR on GitHub. File internally whatever needs a fix.
- [ ] Fix any urgent bug from launch feedback. Cut a patch release if needed. Do not pretend nothing broke — transparent fix communication is worth more than the initial launch headline.
- [ ] Write a short "launch day in numbers" internal note: PH rank, HN peak, downloads, paid conversions, top support questions. File under `press-kit/social-proof.md` or a launch retro doc.

---

## T+2 to T+7 — the slower wave

Spread over the week, don't stack them:

- [ ] **T+2:** r/lightingdesign post (if account has standing in the sub).
- [ ] **T+4:** ControlBooth post in Commercial Announcements.
- [ ] **T+5:** ETC Community post in Eos Family subforum.
- [ ] **T+7:** r/techtheatre post.
- [ ] Anytime: reply to any press inbound. Ship press licenses within 24h.

### Things that are NOT part of launch week

These come later, or not at all:

- Paid ads. Not for this audience, not at this stage.
- Influencer sponsorships. Pro AV YouTube / Twitch has genuine voices and the ones worth working with won't do sponsored reads of a $49 tool; they'll review organically if the product earns it.
- Bundles / crossover deals. Wait until you have a relationship to offer something meaningful.
- Press releases to trade magazines. PRs as outbound are low-value; build relationships instead.

---

## Emergency playbook

### A critical bug is found in the release during launch day
1. Acknowledge it publicly wherever you posted. Pin a note on the PH thread; edit the HN post only if HN still lets you (it locks edits after a short window).
2. Cut a patch release the same day. Re-sign, re-notarise, re-publish.
3. DM the reporters who flagged it. Fix credit to them if they're open to being named.
4. Do not hide it. Hiding it finds its way back to the top of the HN thread and kills credibility.

### A negative review / teardown goes viral during launch day
1. Read it fully before responding.
2. If they're wrong, correct with facts (not tone). If they're right, thank them and fix it.
3. Do not argue in their comment section. Respond once on our own channels.
4. Walk away. The worst thing you can do is turn a one-hour news cycle into a week-long one.

### Payments fail / webhook is down
1. Check the Cloudflare Worker logs immediately. Most outages are 5-minute blips from upstream Lemon Squeezy.
2. If it's sustained, post on the landing page: "checkout temporarily unavailable — email us for a manual license while we fix this". Collect emails.
3. Issue manual licenses for anyone who emailed during the outage, with a note apologising. This becomes a trust builder if handled well.
