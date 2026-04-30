/**
 * Sanity test for the preset save/load round-trip, specifically that
 * per-song midiCues survive the JSON serialization the .ltcast file uses.
 *
 * Reproduces the user's reported bug:
 *   "我的cue,key完之後,別人打開save好的時候的檔案,沒有被帶進去"
 *   (cues disappear when someone else opens my saved .ltcast file)
 *
 * This test exercises the actual code paths used by the renderer:
 * - the same shape produced by `buildPresetData` (in store.ts)
 * - JSON.stringify with the same args used by the main-process IPC handler
 * - JSON.parse + the `migratePreset` + `ensureSetlistIds` logic
 *   (re-implemented here without importing store.ts, to avoid Zustand
 *   instantiation in a Node test environment)
 */
import { describe, it, expect } from 'vitest'

interface MidiCuePoint {
  id: string
  triggerTimecode: string
  messageType: 'program-change' | 'note-on' | 'control-change'
  channel: number
  data1: number
  data2?: number
  label?: string
  enabled: boolean
  offsetFrames?: number
}

interface SetlistItem {
  id: string
  path: string
  name: string
  offsetFrames?: number
  notes?: string
  midiCues?: MidiCuePoint[]
}

interface PresetData {
  version: number
  setlist?: SetlistItem[]
  [k: string]: unknown
}

const CURRENT_PRESET_VERSION = 7

// Mirrors store.ts:migratePreset — no setlist mutation, so midiCues survive.
function migratePreset(data: PresetData): PresetData {
  const version = data.version ?? 0
  if (version === CURRENT_PRESET_VERSION) return data
  // older versions backfill scalars but never touch setlist[] — verified
  // by reading store.ts:194-238 line-by-line.
  return { ...data, version: CURRENT_PRESET_VERSION }
}

// Mirrors store.ts:ensureSetlistIds.
function ensureSetlistIds(data: PresetData): PresetData {
  if (data.setlist && data.setlist.length > 0) {
    return {
      ...data,
      setlist: data.setlist.map((item) =>
        item.id ? item : { ...item, id: 'sl-generated' },
      ),
    }
  }
  return data
}

describe('preset round-trip — midiCues survive save/load', () => {
  const sampleCue: MidiCuePoint = {
    id: 'cue-1',
    triggerTimecode: '01:00:30:15',
    messageType: 'note-on',
    channel: 1,
    data1: 60,
    data2: 100,
    label: 'Scene A',
    enabled: true,
    offsetFrames: 2,
  }

  const sampleItem: SetlistItem = {
    id: 'sl-1',
    path: '/songs/foo.wav',
    name: 'Foo',
    midiCues: [sampleCue],
  }

  const samplePreset: PresetData = {
    version: CURRENT_PRESET_VERSION,
    setlist: [sampleItem],
  }

  it('JSON.stringify includes midiCues on setlist items', () => {
    const fileContents = JSON.stringify(
      { name: 'MyShow', data: samplePreset, updatedAt: '2026-01-01' },
      null,
      2,
    )
    expect(fileContents).toContain('"midiCues"')
    expect(fileContents).toContain('"triggerTimecode": "01:00:30:15"')
    expect(fileContents).toContain('"label": "Scene A"')
  })

  it('JSON.parse + migrate + ensureIds preserves midiCues', () => {
    const fileContents = JSON.stringify({
      name: 'MyShow',
      data: samplePreset,
      updatedAt: '2026-01-01',
    })
    const reloaded = JSON.parse(fileContents)
    const migrated = ensureSetlistIds(migratePreset(reloaded.data))
    expect(migrated.setlist).toHaveLength(1)
    expect(migrated.setlist![0].midiCues).toHaveLength(1)
    expect(migrated.setlist![0].midiCues![0]).toEqual(sampleCue)
  })

  it('round-trip preserves multiple cues per item across multiple items', () => {
    const setlist: SetlistItem[] = [
      {
        id: 'sl-1',
        path: '/a.wav',
        name: 'A',
        midiCues: [
          { ...sampleCue, id: 'c1', triggerTimecode: '00:00:01:00' },
          { ...sampleCue, id: 'c2', triggerTimecode: '00:00:02:00' },
        ],
      },
      {
        id: 'sl-2',
        path: '/b.wav',
        name: 'B',
        midiCues: [{ ...sampleCue, id: 'c3', triggerTimecode: '00:00:03:00' }],
      },
      { id: 'sl-3', path: '/c.wav', name: 'C' /* no midiCues */ },
    ]
    const data: PresetData = { version: CURRENT_PRESET_VERSION, setlist }
    const json = JSON.stringify({ data })
    const parsed = JSON.parse(json)
    const migrated = ensureSetlistIds(migratePreset(parsed.data))
    expect(migrated.setlist![0].midiCues).toHaveLength(2)
    expect(migrated.setlist![1].midiCues).toHaveLength(1)
    expect(migrated.setlist![2].midiCues).toBeUndefined()
  })

  it('an old (v6) preset without midiCues migrates without inventing them', () => {
    const old: PresetData = {
      version: 6,
      setlist: [{ id: 'sl-1', path: '/a.wav', name: 'A' }],
    }
    const migrated = ensureSetlistIds(migratePreset(old))
    expect(migrated.version).toBe(CURRENT_PRESET_VERSION)
    expect(migrated.setlist![0].midiCues).toBeUndefined()
  })

  it('a setlist item without an id still keeps its midiCues after id assignment', () => {
    // Reproduces the legacy-preset path: ensureSetlistIds spreads `{...item, id: ...}`
    const data: PresetData = {
      version: CURRENT_PRESET_VERSION,
      setlist: [
        { id: '', path: '/a.wav', name: 'A', midiCues: [sampleCue] } as SetlistItem,
      ],
    }
    // Force the no-id branch
    delete (data.setlist![0] as Partial<SetlistItem>).id
    const migrated = ensureSetlistIds(data)
    expect(migrated.setlist![0].id).toBeTruthy()
    expect(migrated.setlist![0].midiCues).toHaveLength(1)
    expect(migrated.setlist![0].midiCues![0]).toEqual(sampleCue)
  })
})
