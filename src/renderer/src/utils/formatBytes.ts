// Pure formatters for the update progress overlay (v0.5.4 sprint A).
// Kept side-effect-free so they can be unit-tested without a DOM.
//
// Conventions (locked by sprint contract Q-3 / Q-5):
//   - bytes:  B / kB / MB / GB, decimal (1000) units to match download UI norms
//   - speed:  < 1 MB/s → kB/s, >= 1 MB/s → MB/s
//   - eta:    "<1s" under one second, "~MM:SS" under one hour, "~Hh MMm" beyond.
//             Zero / non-finite values render as the em-dash placeholder "—".
//
// Defensive against NaN / negative input — auto-updater can occasionally hand us
// a 0 total before the HEAD response lands, or a negative delta on resumed downloads.

const KB = 1000
const MB = 1000 * 1000
const GB = 1000 * 1000 * 1000

const PLACEHOLDER = '—'

function isFiniteNonNegative(n: number): boolean {
  return Number.isFinite(n) && n >= 0
}

/** Format a byte count. Returns "0 B" for zero / negative / NaN. */
export function formatBytes(n: number): string {
  if (!isFiniteNonNegative(n)) return '0 B'
  if (n < KB) return `${Math.round(n)} B`
  if (n < MB) return `${(n / KB).toFixed(1)} kB`
  if (n < GB) return `${(n / MB).toFixed(1)} MB`
  return `${(n / GB).toFixed(2)} GB`
}

/** Format a download speed in bytes-per-second.
 *  Returns the placeholder em-dash for zero / negative / NaN inputs so the UI
 *  can show "Starting download…" instead of "0 B/s" before the first sample. */
export function formatSpeed(bps: number): string {
  if (!isFiniteNonNegative(bps) || bps === 0) return PLACEHOLDER
  if (bps < MB) return `${(bps / KB).toFixed(1)} kB/s`
  return `${(bps / MB).toFixed(1)} MB/s`
}

/** Format an ETA in seconds.
 *    < 1 s   →  "<1s"
 *    < 1 h   →  "~MM:SS"
 *    >= 1 h  →  "~Hh MMm"
 *  Zero / non-finite / negative inputs render as the placeholder em-dash. */
export function formatEta(seconds: number): string {
  if (!isFiniteNonNegative(seconds) || seconds === 0) return PLACEHOLDER
  if (seconds < 1) return '<1s'
  const total = Math.round(seconds)
  if (total < 3600) {
    const m = Math.floor(total / 60)
    const s = total % 60
    return `~${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  return `~${h}h ${String(m).padStart(2, '0')}m`
}
