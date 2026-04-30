/**
 * Sprint E — markers refactor regression coverage.
 *
 * The user-reported bug: song-structure markers added on machine A disappear
 * when the .ltcast preset is opened on machine B. Root cause was that
 * `state.markers` was keyed by absolute filePath, which is machine-specific.
 *
 * v0.5.4 / preset version 8 moves markers onto each `SetlistItem` so they
 * travel with the setlist serialisation. This file pins the migration logic
 * inside `store.ts` (re-implemented locally to avoid Zustand bootstrap in
 * Node tests).
 */
import { describe, it, expect } from 'vitest'

interface WaveformMarker {
  id: string
  time: number
  label: string
  type?: string
}
interface SetlistItem {
  id: string
  path: string
  name: string
  markers?: WaveformMarker[]
}
interface PresetData {
  version: number
  setlist?: SetlistItem[]
  markers?: Record<string, WaveformMarker[]>
  [k: string]: unknown
}

// Mirrors `migratePreset` v7 → v8 from store.ts. Keep this in sync if the
// in-tree migration changes.
function migrate7to8(data: PresetData): PresetData {
  if ((data.version ?? 0) >= 8) return data
  const legacy = data.markers
  if (legacy && data.setlist) {
    for (const item of data.setlist) {
      const arr = legacy[item.path]
      if (arr && arr.length > 0) item.markers = arr
    }
  }
  delete data.markers
  data.version = 8
  return data
}

const sampleMarker: WaveformMarker = {
  id: 'm1',
  time: 12.5,
  label: 'Chorus',
  type: 'chorus',
}

describe('v7 → v8 marker migration', () => {
  it('attaches markers from path-keyed Record onto matching setlist items', () => {
    const v7: PresetData = {
      version: 7,
      setlist: [
        { id: 'sl-a', path: 'D:\\Music\\song1.wav', name: 'Song 1' },
        { id: 'sl-b', path: 'D:\\Music\\song2.wav', name: 'Song 2' },
      ],
      markers: {
        'D:\\Music\\song1.wav': [sampleMarker],
        'D:\\Music\\song2.wav': [{ ...sampleMarker, id: 'm2', label: 'Bridge' }],
      },
    }
    const migrated = migrate7to8({ ...v7, setlist: v7.setlist!.map(i => ({ ...i })) })
    expect(migrated.version).toBe(8)
    expect(migrated.markers).toBeUndefined()
    expect(migrated.setlist![0].markers).toHaveLength(1)
    expect(migrated.setlist![0].markers![0]).toEqual(sampleMarker)
    expect(migrated.setlist![1].markers).toHaveLength(1)
    expect(migrated.setlist![1].markers![0].label).toBe('Bridge')
  })

  it('drops markers attached to paths not in the setlist (Q-D)', () => {
    const v7: PresetData = {
      version: 7,
      setlist: [{ id: 'sl-a', path: 'A.wav', name: 'A' }],
      markers: {
        'A.wav': [sampleMarker],
        'GHOST.wav': [{ ...sampleMarker, id: 'ghost', label: 'orphan' }],
      },
    }
    const migrated = migrate7to8({ ...v7, setlist: v7.setlist!.map(i => ({ ...i })) })
    expect(migrated.setlist![0].markers).toHaveLength(1)
    expect(migrated.setlist![0].markers![0].id).toBe('m1')
    // Orphan markers must NOT leak anywhere
    expect(migrated.markers).toBeUndefined()
    const allMarkerIds = (migrated.setlist ?? []).flatMap(i => i.markers ?? []).map(m => m.id)
    expect(allMarkerIds).not.toContain('ghost')
  })

  it('handles v7 preset with no markers Record at all', () => {
    const v7: PresetData = {
      version: 7,
      setlist: [{ id: 'sl-a', path: 'A.wav', name: 'A' }],
    }
    const migrated = migrate7to8(v7)
    expect(migrated.version).toBe(8)
    expect(migrated.setlist![0].markers).toBeUndefined()
  })

  it('idempotent on a v8 preset', () => {
    const v8: PresetData = {
      version: 8,
      setlist: [{ id: 'sl-a', path: 'A.wav', name: 'A', markers: [sampleMarker] }],
    }
    const migrated = migrate7to8(v8)
    expect(migrated).toBe(v8) // early return
    expect(migrated.setlist![0].markers).toHaveLength(1)
  })

  it("cross-machine simulation: same preset works regardless of recipient's local path", () => {
    // Author saves on machine A.
    const authorPreset: PresetData = {
      version: 7,
      setlist: [{ id: 'sl-a', path: 'D:\\Music\\song.wav', name: 'My Song' }],
      markers: { 'D:\\Music\\song.wav': [sampleMarker] },
    }
    const migrated = migrate7to8({
      ...authorPreset,
      setlist: authorPreset.setlist!.map(i => ({ ...i })),
    })
    // After migration, markers travel with the setlist item. The recipient
    // can put the audio anywhere and relink — the markers are bound by id,
    // not path.
    expect(migrated.setlist![0].markers![0]).toEqual(sampleMarker)
    expect(migrated.setlist![0].id).toBe('sl-a') // id is the portable identifier
  })
})
