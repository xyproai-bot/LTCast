/** Minimum LTC confidence to consider the signal valid (0–1) */
export const LTC_CONFIDENCE_THRESHOLD = 0.5

// ── LemonSqueezy Checkout URLs ────────────────────────────
// Replace these with your actual LemonSqueezy variant checkout URLs.
// Each plan should be a separate Product or Variant in LemonSqueezy dashboard.

/** Annual subscription — $49/year */
export const CHECKOUT_URL_ANNUAL = 'https://ltcast.lemonsqueezy.com/checkout/buy/5e0a0420-39bc-406c-83e2-dc7d36464369?enabled=1518368'

/** 7-Day Pass — $15 (single use, short-term events) */
export const CHECKOUT_URL_WEEKLY = 'https://ltcast.lemonsqueezy.com/checkout/buy/de692eee-b2d4-4afe-af50-0ca44326fc73?enabled=1518383'

/** Volume licensing info page (10+ seats, contact sales) */
export const CHECKOUT_URL_VOLUME = 'mailto:xypro.ai@gmail.com?subject=LTCast%20Volume%20Licensing'

/** Maximum days a validated license is trusted offline */
export const LICENSE_OFFLINE_GRACE_DAYS = 30
