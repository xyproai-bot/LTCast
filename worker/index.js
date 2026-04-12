/**
 * LTCast Trial Tracking — Cloudflare Worker
 *
 * Endpoints:
 *   POST /trial/check  { fingerprint }  → { trialStart, daysLeft, expired }
 *   POST /trial/reset  { fingerprint, adminKey }  → { ok } (admin only, for testing)
 *
 * KV binding: TRIAL_KV (namespace for storing trial start dates)
 *
 * Deploy:
 *   1. Create KV namespace: wrangler kv:namespace create TRIAL_KV
 *   2. Add the ID to wrangler.toml
 *   3. wrangler deploy
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
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS })
    }

    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === '/trial/check') {
      return handleTrialCheck(request, env)
    }

    if (request.method === 'POST' && url.pathname === '/trial/reset') {
      return handleTrialReset(request, env)
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: CORS_HEADERS
    })
  }
}

async function handleTrialCheck(request, env) {
  try {
    const { fingerprint } = await request.json()
    if (!fingerprint || typeof fingerprint !== 'string' || fingerprint.length < 8) {
      return json({ error: 'Invalid fingerprint' }, 400)
    }

    // Hash the fingerprint for privacy (don't store raw hardware IDs)
    const hash = await sha256(fingerprint)
    const key = `trial:${hash}`

    // Check if this machine already started a trial
    const existing = await env.TRIAL_KV.get(key)

    let trialStart
    if (existing) {
      trialStart = parseInt(existing, 10)
    } else {
      // First time — record trial start (server time, can't be faked)
      trialStart = Date.now()
      await env.TRIAL_KV.put(key, String(trialStart))
    }

    const elapsed = Date.now() - trialStart
    const daysUsed = Math.floor(elapsed / (1000 * 60 * 60 * 24))
    const daysLeft = Math.max(0, TRIAL_DAYS - daysUsed)
    const expired = daysLeft <= 0

    return json({ trialStart, daysLeft, expired })
  } catch (e) {
    return json({ error: 'Bad request' }, 400)
  }
}

async function handleTrialReset(request, env) {
  try {
    const { fingerprint, adminKey } = await request.json()

    // Simple admin key check — set ADMIN_KEY as a Worker secret
    if (!env.ADMIN_KEY || adminKey !== env.ADMIN_KEY) {
      return json({ error: 'Unauthorized' }, 403)
    }

    const hash = await sha256(fingerprint)
    await env.TRIAL_KV.delete(`trial:${hash}`)

    return json({ ok: true })
  } catch (e) {
    return json({ error: 'Bad request' }, 400)
  }
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
