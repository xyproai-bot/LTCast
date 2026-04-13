/** Minimum LTC confidence to consider the signal valid (0–1) */
export const LTC_CONFIDENCE_THRESHOLD = 0.5

// ── LemonSqueezy Checkout URLs ────────────────────────────
// Replace these with your actual LemonSqueezy variant checkout URLs.
// Each plan should be a separate Product or Variant in LemonSqueezy dashboard.

/** Annual subscription — $49/year */
export const CHECKOUT_URL_ANNUAL = 'https://ltcast.lemonsqueezy.com/checkout/buy/001f3f48-747b-4649-801f-c0063a8b7afd'

/** 7-Day Pass — $15 (single use, short-term events) */
export const CHECKOUT_URL_WEEKLY = 'https://ltcast.lemonsqueezy.com/checkout/buy/REPLACE_WITH_WEEKLY_VARIANT_ID'

/** Volume licensing info page (10+ seats, contact sales) */
export const CHECKOUT_URL_VOLUME = 'mailto:support@xypro-ai.com?subject=LTCast%20Volume%20Licensing'

/** Maximum days a validated license is trusted offline */
export const LICENSE_OFFLINE_GRACE_DAYS = 30
