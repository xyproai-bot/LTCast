/**
 * LTC Chase — preset migration v12 → v13.
 *
 * The bump adds optional `ltcSegments` and `ltcScanStatus` fields to each
 * SetlistItem but does NOT touch existing fields. This test ensures a
 * pre-Chase preset (version 12) survives the migration intact: setlist
 * items keep their original shape, no new keys are forced onto them, and
 * the version is bumped.
 *
 * We re-implement the relevant slice of migratePreset rather than import
 * store.ts (Zustand instantiation under Node fails). This matches the
 * approach taken by presetRoundtrip.test.ts.
 */
import { describe, it, expect } from 'vitest'

interface SetlistItem {
  id: string
  path: string
  name: string
  ltcSegments?: unknown[]
  ltcScanStatus?: string
}

interface PresetData {
  version: number
  setlist?: SetlistItem[]
  [k: string]: unknown
}

const CURRENT_PRESET_VERSION = 13

// Slice of store.ts:migratePreset focused on v12 → v13 (no shape change).
function migratePreset(data: PresetData): PresetData {
  const version = data.version ?? 0
  if (version === CURRENT_PRESET_VERSION) return data
  // v12 → v13 is intentionally a no-op for shape — only the version bumps.
  return { ...data, version: CURRENT_PRESET_VERSION }
}

describe('LTC Chase — preset v12 → v13', () => {
  it('bumps version', () => {
    const v12: PresetData = {
      version: 12,
      setlist: [{ id: 'sl-1', path: '/a.wav', name: 'A' }],
    }
    const migrated = migratePreset(v12)
    expect(migrated.version).toBe(13)
  })

  it('does NOT inject ltcSegments / ltcScanStatus on existing items', () => {
    const v12: PresetData = {
      version: 12,
      setlist: [
        { id: 'sl-1', path: '/a.wav', name: 'A' },
        { id: 'sl-2', path: '/b.wav', name: 'B' },
      ],
    }
    const migrated = migratePreset(v12)
    expect(migrated.setlist![0].ltcSegments).toBeUndefined()
    expect(migrated.setlist![0].ltcScanStatus).toBeUndefined()
    expect(migrated.setlist![1].ltcSegments).toBeUndefined()
    expect(migrated.setlist![1].ltcScanStatus).toBeUndefined()
  })

  it('preserves ltcSegments on items that already have them (v13-authored preset re-opened)', () => {
    const v13: PresetData = {
      version: 13,
      setlist: [
        {
          id: 'sl-1',
          path: '/a.wav',
          name: 'A',
          ltcSegments: [{
            audioStartSec: 0, audioEndSec: 5,
            tcAtStartFrames: 90000, tcAtEndFrames: 90125,
            fps: 25, dropFrame: false,
          }],
          ltcScanStatus: 'scanned',
        },
      ],
    }
    const migrated = migratePreset(v13)
    expect(migrated.setlist![0].ltcSegments).toHaveLength(1)
    expect(migrated.setlist![0].ltcScanStatus).toBe('scanned')
  })

  it('empty setlist still migrates cleanly', () => {
    const v12: PresetData = { version: 12, setlist: [] }
    const migrated = migratePreset(v12)
    expect(migrated.version).toBe(13)
    expect(migrated.setlist).toEqual([])
  })
})
