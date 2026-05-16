/**
 * scanManager — background queue for offline LTC scanning of setlist items.
 *
 * Subscribes to the Zustand store and picks up any item whose
 * `ltcScanStatus` is undefined (never scanned) or 'pending' (queued by an
 * explicit rescan). Runs up to MAX_CONCURRENT scans in parallel so the UI
 * stays responsive on huge setlists.
 *
 * Each scan:
 *   1. Read the audio file off disk (window.api.readAudioFile)
 *   2. Decode on a scratch AudioContext (mirrors AudioEngine.prebufferFile)
 *   3. Call scanLtcSegments to find continuous LTC runs
 *   4. Write the result back via store.setSetlistItemLtcScan
 *
 * Failure handling: any error along the way writes status='error' so we
 * don't infinite-loop on a broken file. The user can manually retrigger
 * by writing status='pending' (see SetlistPanel rescan action).
 *
 * Lifecycle: start() / stop() — App.tsx mounts the manager on init and
 * disposes it on unmount. The unsubscribe handle is returned by start().
 */

import { useStore } from '../store'
import type { SetlistItem, AppState } from '../store'
import { scanLtcSegments } from './scanLtcSegments'

const MAX_CONCURRENT = 3

interface JobState {
  inflightItemIds: Set<string>
  /** Active progress, item-id → 0..1. Used to compute aggregate progress. */
  progressById: Map<string, number>
  /** Items currently being scanned by id, for status badging in UI. */
  scanningById: Set<string>
  /** Aborted? Stops the loop without trying to schedule more. */
  stopped: boolean
}

export interface ScanManagerStatus {
  /** Total number of items that need scanning (queued + in-flight + done so far this cycle). */
  total: number
  /** Number completed in this cycle (status moved to scanned/no-ltc/error). */
  done: number
  /** Whether any scan is currently in flight. */
  active: boolean
}

let _instance: ScanManager | null = null

class ScanManager {
  private state: JobState = {
    inflightItemIds: new Set(),
    progressById: new Map(),
    scanningById: new Set(),
    stopped: false,
  }
  private unsubscribe: (() => void) | null = null
  private statusListeners: Array<(s: ScanManagerStatus) => void> = []
  private cycleTotal = 0
  private cycleDone = 0

  start(): () => void {
    if (this.unsubscribe) return this.unsubscribe
    this.state.stopped = false

    // Initial pickup so we don't wait on a subsequent setlist mutation.
    this._tick()

    this.unsubscribe = useStore.subscribe((s, prev) => {
      // Re-tick whenever the setlist identity changes (add/remove/reorder) or
      // when any item's scan status changes (which is how rescans get queued).
      if (s.setlist !== prev.setlist) {
        this._tick()
      }
    })

    return () => this.stop()
  }

  stop(): void {
    this.state.stopped = true
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }
    this.state.inflightItemIds.clear()
    this.state.scanningById.clear()
    this.state.progressById.clear()
    this.cycleTotal = 0
    this.cycleDone = 0
    this._notify()
  }

  /** Subscribe to status changes (for SetlistPanel header progress). */
  onStatus(fn: (s: ScanManagerStatus) => void): () => void {
    this.statusListeners.push(fn)
    fn(this._snapshot())
    return () => {
      this.statusListeners = this.statusListeners.filter(l => l !== fn)
    }
  }

  /** Queue a specific item for rescan (by index in current setlist). */
  rescanItem(index: number): void {
    const s = useStore.getState()
    if (index < 0 || index >= s.setlist.length) return
    // Reset to 'pending' so the tick picks it up; clear old segments so
    // chase doesn't keep using stale data while a new scan is in flight.
    s.setSetlistItemLtcScan(index, undefined, 'pending')
    this._tick()
  }

  private _snapshot(): ScanManagerStatus {
    return {
      total: this.cycleTotal,
      done: this.cycleDone,
      active: this.state.inflightItemIds.size > 0,
    }
  }

  private _notify(): void {
    const snap = this._snapshot()
    for (const fn of this.statusListeners) fn(snap)
  }

  private _tick(): void {
    if (this.state.stopped) return
    const s = useStore.getState()
    // Find candidates — items not in flight, status undefined or 'pending'
    const candidates = s.setlist.filter((item) =>
      !this.state.inflightItemIds.has(item.id) &&
      (item.ltcScanStatus === undefined || item.ltcScanStatus === 'pending')
    )
    if (candidates.length === 0 && this.state.inflightItemIds.size === 0) {
      // Cycle complete — reset counters so the next round of rescans
      // shows progress from 0/N rather than carried-over numbers.
      if (this.cycleTotal > 0) {
        this.cycleTotal = 0
        this.cycleDone = 0
        this._notify()
      }
      return
    }
    // Recompute total whenever new items appear during a cycle
    const newCycleTotal = this.cycleDone + this.state.inflightItemIds.size + candidates.length
    if (newCycleTotal !== this.cycleTotal) {
      this.cycleTotal = newCycleTotal
    }

    // Launch up to MAX_CONCURRENT
    while (this.state.inflightItemIds.size < MAX_CONCURRENT && candidates.length > 0) {
      const next = candidates.shift()
      if (!next) break
      this._launch(next)
    }
    this._notify()
  }

  private _launch(item: SetlistItem): void {
    this.state.inflightItemIds.add(item.id)
    this.state.scanningById.add(item.id)
    this.state.progressById.set(item.id, 0)

    // Mark status as 'scanning' so the UI can show "scanning" badge.
    // Use the index at the moment we kick off — getCurrentIdxFor handles
    // setlist-reorders by re-resolving the id each time we want to write back.
    const writeBack = (
      state: AppState,
      segments: import('../store').LtcSegment[] | undefined,
      status: import('../store').LtcScanStatus | undefined
    ): boolean => {
      const idx = state.setlist.findIndex(it => it.id === item.id)
      if (idx === -1) return false  // item removed mid-scan; bail
      state.setSetlistItemLtcScan(idx, segments, status)
      return true
    }

    {
      const s = useStore.getState()
      writeBack(s, undefined, 'scanning')
    }

    ;(async (): Promise<void> => {
      try {
        const arrayBuffer = await window.api.readAudioFile(item.path)
        if (!arrayBuffer) throw new Error('empty file')
        const decodeCtx = new AudioContext()
        let buffer: AudioBuffer
        try {
          buffer = await decodeCtx.decodeAudioData(arrayBuffer)
        } finally {
          try { await decodeCtx.close() } catch { /* best effort */ }
        }
        const segments = await scanLtcSegments(buffer, (p) => {
          this.state.progressById.set(item.id, p)
          this._notify()
        })
        const state = useStore.getState()
        if (segments.length === 0) {
          writeBack(state, [], 'no-ltc')
        } else {
          writeBack(state, segments, 'scanned')
        }
      } catch (e) {
        console.warn('[scanManager] scan failed for', item.path, e)
        const state = useStore.getState()
        writeBack(state, undefined, 'error')
      } finally {
        this.state.inflightItemIds.delete(item.id)
        this.state.scanningById.delete(item.id)
        this.state.progressById.delete(item.id)
        this.cycleDone += 1
        // After every completion: try to launch more.
        this._tick()
      }
    })()
  }
}

/** Lazy singleton. App.tsx calls getScanManager().start() on mount. */
export function getScanManager(): ScanManager {
  if (!_instance) _instance = new ScanManager()
  return _instance
}
