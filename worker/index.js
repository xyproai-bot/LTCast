/**
 * LTCast Trial & License Tracking — Cloudflare Worker
 *
 * Endpoints:
 *   POST /trial/check     { fingerprint }           → { trialStart, daysLeft, expired }
 *   POST /trial/reset     { fingerprint, adminKey }  → { ok } (admin only)
 *   POST /license/check   { licenseKey }             → { status, plan, updatedAt }
 *   POST /promo/redeem    { code, email, fingerprint } → { ok, licenseKey, expiresAt }
 *   POST /webhook/lemonsqueezy  (LemonSqueezy webhook payload)
 *
 * KV bindings:
 *   TRIAL_KV   — trial start dates (keyed by hashed fingerprint)
 *              — license statuses (keyed by "license:{key}")
 *
 * Secrets:
 *   ADMIN_KEY                  — admin reset (testing)
 *   LEMONSQUEEZY_WEBHOOK_SECRET — LemonSqueezy webhook signature verification
 *
 * Deploy:
 *   1. Create KV: wrangler kv:namespace create TRIAL_KV
 *   2. Add ID to wrangler.toml
 *   3. Set secrets:
 *      wrangler secret put ADMIN_KEY
 *      wrangler secret put LEMONSQUEEZY_WEBHOOK_SECRET
 *   4. wrangler deploy
 *   5. In LemonSqueezy dashboard → Settings → Webhooks:
 *      URL: https://ltcast-trial.xypro-ai.workers.dev/webhook/lemonsqueezy
 *      Events: order_created, subscription_updated, license_key_updated
 *      Signing secret: (same value as LEMONSQUEEZY_WEBHOOK_SECRET)
 */

const TRIAL_DAYS = 14
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS })
    }

    const url = new URL(request.url)

    if (request.method === 'POST') {
      if (url.pathname === '/trial/check') return handleTrialCheck(request, env)
      if (url.pathname === '/trial/reset') return handleTrialReset(request, env)
      if (url.pathname === '/license/check') return handleLicenseCheck(request, env)
      if (url.pathname === '/promo/redeem') return handlePromoRedeem(request, env)
      if (url.pathname === '/webhook/lemonsqueezy') return handleWebhook(request, env)
    }

    return json({ error: 'Not found' }, 404)
  }
}

// ════════════════════════════════════════════════════════════
// Trial endpoints (unchanged)
// ════════════════════════════════════════════════════════════

async function handleTrialCheck(request, env) {
  try {
    const { fingerprint } = await request.json()
    if (!fingerprint || typeof fingerprint !== 'string' || fingerprint.length < 8) {
      return json({ error: 'Invalid fingerprint' }, 400)
    }

    const hash = await sha256(fingerprint)
    const key = `trial:${hash}`
    const existing = await env.TRIAL_KV.get(key)

    let trialStart
    if (existing) {
      trialStart = parseInt(existing, 10)
    } else {
      trialStart = Date.now()
      await env.TRIAL_KV.put(key, String(trialStart))
    }

    const elapsed = Date.now() - trialStart
    const daysUsed = Math.floor(elapsed / (1000 * 60 * 60 * 24))
    const daysLeft = Math.max(0, TRIAL_DAYS - daysUsed)

    return json({ trialStart, daysLeft, expired: daysLeft <= 0 })
  } catch {
    return json({ error: 'Bad request' }, 400)
  }
}

async function handleTrialReset(request, env) {
  try {
    const { fingerprint, adminKey } = await request.json()
    if (!env.ADMIN_KEY || adminKey !== env.ADMIN_KEY) {
      return json({ error: 'Unauthorized' }, 403)
    }
    const hash = await sha256(fingerprint)
    await env.TRIAL_KV.delete(`trial:${hash}`)
    return json({ ok: true })
  } catch {
    return json({ error: 'Bad request' }, 400)
  }
}

// ════════════════════════════════════════════════════════════
// License status check — app calls this to verify against our DB
// ════════════════════════════════════════════════════════════

async function handleLicenseCheck(request, env) {
  try {
    const { licenseKey } = await request.json()
    if (!licenseKey || typeof licenseKey !== 'string') {
      return json({ error: 'Invalid license key' }, 400)
    }

    const hash = await sha256(licenseKey)
    const stored = await env.TRIAL_KV.get(`license:${hash}`)

    if (!stored) {
      // No record — we haven't received a webhook for this key yet.
      // App should fall back to direct LemonSqueezy validation.
      return json({ status: 'unknown' })
    }

    const data = JSON.parse(stored)
    // Auto-expire promo licenses past their expiresAt date
    let status = data.status
    if (data.expiresAt && data.status === 'active' && new Date(data.expiresAt) < new Date()) {
      status = 'expired'
    }
    return json({
      status,
      plan: data.plan,           // 'annual', '7day', 'promo', etc.
      expiresAt: data.expiresAt || null,
      updatedAt: data.updatedAt
    })
  } catch {
    return json({ error: 'Bad request' }, 400)
  }
}

// ════════════════════════════════════════════════════════════
// LemonSqueezy Webhook handler
// ════════════════════════════════════════════════════════════

async function handleWebhook(request, env) {
  // Verify signature
  const signature = request.headers.get('x-signature')
  if (!signature || !env.LEMONSQUEEZY_WEBHOOK_SECRET) {
    return json({ error: 'Missing signature' }, 401)
  }

  const rawBody = await request.text()

  const isValid = await verifyWebhookSignature(
    rawBody,
    signature,
    env.LEMONSQUEEZY_WEBHOOK_SECRET
  )
  if (!isValid) {
    return json({ error: 'Invalid signature' }, 401)
  }

  const payload = JSON.parse(rawBody)
  const eventName = payload.meta?.event_name

  // Replay protection: dedup by event ID (check only — the marker is written
  // AFTER successful processing below, so if we crash mid-handler LemonSqueezy
  // can retry and the event isn't lost for 7 days)
  const eventId = payload.meta?.webhook_id || payload.data?.id
  if (eventId) {
    const dedupKey = `webhook-seen:${eventId}`
    const seen = await env.TRIAL_KV.get(dedupKey)
    if (seen) {
      return json({ ok: true, event: eventName, note: 'duplicate event, ignored' })
    }
  }

  // Extract license key from the payload
  // LemonSqueezy includes license_key in meta.custom_data or in the data object
  const licenseKey = extractLicenseKey(payload)

  if (!licenseKey) {
    // Some events don't include a license key — that's OK, just acknowledge
    return json({ ok: true, event: eventName, note: 'no license key in payload' })
  }

  const hash = await sha256(licenseKey)
  const kvKey = `license:${hash}`

  // Determine status based on event
  let status = 'active'
  let plan = 'unknown'

  if (eventName === 'order_created') {
    status = 'active'
    plan = detectPlan(payload)
  } else if (eventName === 'subscription_updated') {
    const subStatus = payload.data?.attributes?.status
    if (subStatus === 'active' || subStatus === 'on_trial') {
      status = 'active'
    } else if (subStatus === 'cancelled' || subStatus === 'expired') {
      status = 'expired'
    } else if (subStatus === 'paused') {
      status = 'expired'
    } else {
      status = subStatus || 'unknown'
    }
    plan = detectPlan(payload)
  } else if (eventName === 'license_key_updated') {
    const keyStatus = payload.data?.attributes?.status
    if (keyStatus === 'active') {
      status = 'active'
    } else if (keyStatus === 'disabled' || keyStatus === 'expired') {
      status = 'revoked'
    } else {
      status = keyStatus || 'unknown'
    }
  } else if (eventName === 'order_refunded') {
    status = 'refunded'
  }

  // Store in KV
  await env.TRIAL_KV.put(kvKey, JSON.stringify({
    status,
    plan,
    eventName,
    updatedAt: Date.now()
  }))

  // Mark as seen only AFTER successful processing — if we failed above,
  // LemonSqueezy will retry within 3 days and we'll process it then.
  if (eventId) {
    await env.TRIAL_KV.put(`webhook-seen:${eventId}`, '1', { expirationTtl: 7 * 24 * 3600 })
  }

  return json({ ok: true, event: eventName, status })
}

// ════════════════════════════════════════════════════════════
// Promo Code redemption
// ════════════════════════════════════════════════════════════

/**
 * Redeem a promo code.
 *
 * KV layout:
 *   promo:{CODE}                → { maxUses, usedCount, expiresAt, days }
 *   promo-used:{CODE}:{fpHash}  → { email, redeemedAt, licenseKey }
 *
 * The generated license key is also stored under license:{hash}
 * so the normal /license/check endpoint works for promo licenses.
 */
async function handlePromoRedeem(request, env) {
  try {
    const { code, email, fingerprint } = await request.json()

    // Validate inputs
    if (!code || typeof code !== 'string') {
      return json({ error: 'Missing promo code' }, 400)
    }
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Invalid email address' }, 400)
    }
    if (!fingerprint || typeof fingerprint !== 'string' || fingerprint.length < 8) {
      return json({ error: 'Invalid fingerprint' }, 400)
    }

    const codeUpper = code.trim().toUpperCase()

    // 1. Look up promo config
    const promoRaw = await env.TRIAL_KV.get(`promo:${codeUpper}`)
    if (!promoRaw) {
      return json({ error: 'Invalid promo code' }, 404)
    }
    const promo = JSON.parse(promoRaw)

    // 2. Check expiry
    if (promo.expiresAt && new Date(promo.expiresAt) < new Date()) {
      return json({ error: 'Promo code has expired' }, 410)
    }

    // 3. Check capacity
    if (promo.usedCount >= promo.maxUses) {
      return json({ error: 'Promo code fully redeemed' }, 410)
    }

    // 4. Check duplicate — same machine
    const fpHash = await sha256(fingerprint)
    const usedKey = `promo-used:${codeUpper}:${fpHash}`
    const existing = await env.TRIAL_KV.get(usedKey)
    if (existing) {
      // Already redeemed on this machine — return existing license
      const prev = JSON.parse(existing)
      return json({ ok: true, licenseKey: prev.licenseKey, expiresAt: prev.expiresAt, alreadyRedeemed: true })
    }

    // 5. Generate license key: PROMO-XXXXXXXX-XXXX
    const licenseKey = `PROMO-${randomHex(8)}-${randomHex(4)}`
    const days = promo.days || 180
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

    // 6. Store license in KV (works with /license/check)
    const licenseHash = await sha256(licenseKey)
    await env.TRIAL_KV.put(`license:${licenseHash}`, JSON.stringify({
      status: 'active',
      plan: 'promo',
      eventName: 'promo_redeem',
      promoCode: codeUpper,
      email: email.toLowerCase(),
      expiresAt,
      updatedAt: Date.now()
    }))

    // 7. Mark as used for this machine
    await env.TRIAL_KV.put(usedKey, JSON.stringify({
      email: email.toLowerCase(),
      licenseKey,
      expiresAt,
      redeemedAt: Date.now()
    }))

    // 8. Increment usage counter
    promo.usedCount = (promo.usedCount || 0) + 1
    await env.TRIAL_KV.put(`promo:${codeUpper}`, JSON.stringify(promo))

    return json({ ok: true, licenseKey, expiresAt })
  } catch {
    return json({ error: 'Bad request' }, 400)
  }
}

function randomHex(bytes) {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════

/**
 * Verify LemonSqueezy webhook HMAC-SHA256 signature.
 * LemonSqueezy sends: x-signature = hex(HMAC-SHA256(rawBody, secret))
 */
async function verifyWebhookSignature(rawBody, signature, secret) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody))
  const expected = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  // Constant-time compare to prevent timing attacks on HMAC
  return constantTimeEqual(expected, signature || '')
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

/** Extract license key from various LemonSqueezy webhook payload shapes. */
function extractLicenseKey(payload) {
  // license_key_updated events have the key directly
  if (payload.data?.attributes?.key) {
    return payload.data.attributes.key
  }
  // order_created may have license key in meta
  if (payload.meta?.custom_data?.license_key) {
    return payload.meta.custom_data.license_key
  }
  // Some events include it in relationships
  if (payload.data?.attributes?.license_key) {
    return payload.data.attributes.license_key
  }
  return null
}

/** Detect plan type from LemonSqueezy payload (annual vs 7-day). */
function detectPlan(payload) {
  const variantName = payload.data?.attributes?.variant_name ||
    payload.data?.attributes?.product_name || ''
  const lower = variantName.toLowerCase()
  if (lower.includes('7-day') || lower.includes('7 day') || lower.includes('weekly')) return '7day'
  if (lower.includes('annual') || lower.includes('year')) return 'annual'
  return 'unknown'
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(str)
  )
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS })
}
