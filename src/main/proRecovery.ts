/**
 * Pro state recovery cache helpers.
 *
 * Background: ProState is persisted as a safeStorage-encrypted blob keyed
 * to the OS Keychain (macOS) / DPAPI (Windows). Two real-world failures
 * lock users out without a recovery hint:
 *   1. Windows 24H2 removed `wmic`. Existing pre-24H2 activations whose
 *      fingerprint was UUID-based fall back to cpuModel|hostname|platform
 *      after the Windows update → fingerprint changes → `computeIsPro`
 *      returns `hardware-changed` → silent free tier.
 *   2. macOS ad-hoc signature rotation between releases can refuse to
 *      decrypt the previous safeStorage blob.
 *
 * The recovery cache is a plaintext JSON file at `userData/.pro-recovery`
 * containing ONLY `{licenseKey: string}` — a recovery hint to identify which
 * key to re-validate against the Worker. ProState remains server-authoritative
 * and re-encrypted via safeStorage on successful recovery.
 *
 * Per the v0.5.4 B sprint contract, Q-B locks the cache to licenseKey-only —
 * NO email, NO expiresAt, NO fingerprint.
 *
 * The module is pure (no Electron app reference at module level) so it's
 * unit-testable without spinning up Electron — callers pass `userDataDir`.
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'

export interface RecoveryCache {
  licenseKey: string
}

export function getRecoveryCachePath(userDataDir: string): string {
  return join(userDataDir, '.pro-recovery')
}

/**
 * Write the recovery cache. Plaintext JSON, UTF-8.
 * Errors are swallowed — the cache is a recovery hint, not authoritative.
 */
export function writeRecoveryCache(userDataDir: string, licenseKey: string): void {
  try {
    if (!licenseKey || typeof licenseKey !== 'string') return
    const data: RecoveryCache = { licenseKey }
    writeFileSync(getRecoveryCachePath(userDataDir), JSON.stringify(data), 'utf-8')
  } catch { /* non-fatal */ }
}

/**
 * Read the recovery cache. Returns null when:
 * - the file does not exist
 * - the file is unreadable
 * - the JSON is malformed
 * - the `licenseKey` field is missing or not a non-empty string
 */
export function readRecoveryCache(userDataDir: string): RecoveryCache | null {
  try {
    const p = getRecoveryCachePath(userDataDir)
    if (!existsSync(p)) return null
    const raw = readFileSync(p, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<RecoveryCache>
    if (!parsed || typeof parsed.licenseKey !== 'string' || parsed.licenseKey.length === 0) {
      return null
    }
    return { licenseKey: parsed.licenseKey }
  } catch {
    return null
  }
}

/** Delete the recovery cache. Called on revocation/refund/expiry. */
export function clearRecoveryCache(userDataDir: string): void {
  try {
    const p = getRecoveryCachePath(userDataDir)
    if (existsSync(p)) unlinkSync(p)
  } catch { /* non-fatal */ }
}
