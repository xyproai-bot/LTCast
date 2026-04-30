// In-app auto-update download progress overlay (v0.5.4 sprint A).
//
// Lifecycle (Q-6, locked by sprint contract):
//   - hidden by default
//   - first `update-progress` IPC event from main → mount, show progress
//   - `update-progress-dismiss` IPC → unmount immediately
//   - cancel button → invoke `update-cancel` IPC, optimistically dismiss
//
// Position is bottom-right floating panel (Q-1) — non-blocking, does not
// capture pointer events outside its own footprint. Z-index sits above
// PresetBar/StatusBar but below OS-level dialog.showMessageBox modals
// (those are native and always on top).
//
// Speed/ETA (Q-3, Q-5):
//   - Speed: < 1 MB/s → kB/s, ≥ 1 MB/s → MB/s. Handled by formatSpeed.
//   - ETA: only revealed after 2 s of stable throughput. We track samples
//     in a ref (no re-render churn), and require ≥3 non-zero bytesPerSecond
//     samples spanning ≥2 s before computing the rolling-window average.
//     Until then, the ETA cell renders nothing.
//
// State location: local useState only (per contract "transient UI state, not Zustand").
// Lang is read from the store but never written here — store.ts is untouched.

import React, { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { t } from '../i18n'
import { toast } from './Toast'
import { formatBytes, formatSpeed, formatEta } from '../utils/formatBytes'

interface ProgressInfo {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

interface ThroughputSample {
  bps: number
  at: number
}

const ETA_STABILITY_MS = 2000
const ETA_MIN_SAMPLES = 3
// Cap rolling window so a long, slow tail doesn't drag the average forever.
const ETA_WINDOW_MAX_SAMPLES = 16

export function UpdateProgressOverlay(): React.JSX.Element | null {
  const lang = useStore((s) => s.lang)
  const [progress, setProgress] = useState<ProgressInfo | null>(null)
  const [cancelling, setCancelling] = useState(false)

  // Rolling throughput samples for ETA stability (Q-3). Lives in a ref so
  // pushing samples doesn't force a re-render — the UI re-renders on every
  // setProgress() call already.
  const samplesRef = useRef<ThroughputSample[]>([])
  const firstSampleAtRef = useRef<number | null>(null)

  useEffect(() => {
    const api = window.api as
      | {
          onUpdateProgress?: (cb: (data: ProgressInfo) => void) => () => void
          onUpdateProgressDismiss?: (cb: () => void) => () => void
          onUpdateCancelledToast?: (cb: () => void) => () => void
        }
      | undefined
    if (!api?.onUpdateProgress || !api?.onUpdateProgressDismiss) return

    const offProgress = api.onUpdateProgress((data) => {
      const now = Date.now()
      if (firstSampleAtRef.current === null) firstSampleAtRef.current = now
      // Discard zero / non-finite samples for ETA calculation. They still
      // trigger a UI re-render so the user sees "Starting download…".
      if (Number.isFinite(data.bytesPerSecond) && data.bytesPerSecond > 0) {
        const arr = samplesRef.current
        arr.push({ bps: data.bytesPerSecond, at: now })
        if (arr.length > ETA_WINDOW_MAX_SAMPLES) arr.shift()
      }
      setProgress(data)
      setCancelling(false)
    })

    const offDismiss = api.onUpdateProgressDismiss(() => {
      // Reset everything so the next download starts from a clean slate.
      samplesRef.current = []
      firstSampleAtRef.current = null
      setProgress(null)
      setCancelling(false)
    })

    // Optional: surface a small toast when the user cancels. The IPC fires
    // `update-cancelled-toast` from the main process. If the renderer has
    // not opted into the Toast container yet we just no-op.
    const offCancelToast = api.onUpdateCancelledToast?.(() => {
      toast.info(t(lang, 'updateCancelled'))
    })

    return () => {
      offProgress?.()
      offDismiss?.()
      offCancelToast?.()
    }
    // We intentionally re-subscribe when `lang` changes so the toast text
    // is rendered in the current language — the `t()` call above closes
    // over the current lang value. Re-subscribing is cheap (one IPC handler).
  }, [lang])

  if (progress === null) return null

  const percent = Number.isFinite(progress.percent)
    ? Math.max(0, Math.min(100, progress.percent))
    : 0
  const transferred = formatBytes(progress.transferred)
  const total = formatBytes(progress.total)
  const speedRaw = progress.bytesPerSecond
  const speedText =
    !Number.isFinite(speedRaw) || speedRaw <= 0
      ? t(lang, 'updateStarting')
      : formatSpeed(speedRaw)

  // ETA is shown only after 2 s of stable throughput AND at least 3 samples.
  const samples = samplesRef.current
  let etaText = ''
  const firstAt = firstSampleAtRef.current
  if (
    firstAt !== null &&
    samples.length >= ETA_MIN_SAMPLES &&
    Date.now() - firstAt >= ETA_STABILITY_MS &&
    Number.isFinite(progress.total) &&
    progress.total > 0 &&
    progress.transferred < progress.total
  ) {
    // Rolling-window average bytes-per-second.
    const avgBps =
      samples.reduce((acc, s) => acc + s.bps, 0) / samples.length
    if (avgBps > 0) {
      const remainingBytes = Math.max(0, progress.total - progress.transferred)
      const seconds = remainingBytes / avgBps
      etaText = formatEta(seconds)
    }
  }

  const handleCancel = async (): Promise<void> => {
    setCancelling(true)
    const apiCancel = (window.api as { updateCancel?: () => Promise<unknown> } | undefined)
      ?.updateCancel
    if (apiCancel) {
      try {
        await apiCancel()
      } catch {
        // Errors here are surfaced through the existing error channel; the
        // `update-cancelled` event handler will dismiss the overlay. If for
        // some reason it doesn't, leave the overlay up so the user can retry.
        setCancelling(false)
      }
    } else {
      setCancelling(false)
    }
  }

  return (
    <div
      className="update-progress-overlay"
      role="status"
      aria-live="polite"
      aria-label={t(lang, 'updateDownloading')}
    >
      <div className="update-progress-title">{t(lang, 'updateDownloading')}</div>

      <div
        className="update-progress-bar"
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="update-progress-bar-fill"
          style={{ width: `${percent.toFixed(1)}%` }}
        />
      </div>

      <div className="update-progress-info">
        <span className="update-progress-bytes">
          {transferred} / {total} ({Math.round(percent)}%)
        </span>
        <span className="update-progress-speed">{speedText}</span>
        {etaText !== '' && (
          <span className="update-progress-eta">
            {t(lang, 'updateEta')} {etaText}
          </span>
        )}
      </div>

      <div className="update-progress-actions">
        <button
          type="button"
          className="update-progress-cancel"
          onClick={handleCancel}
          disabled={cancelling}
        >
          {t(lang, 'updateCancel')}
        </button>
      </div>
    </div>
  )
}
