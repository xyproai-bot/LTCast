/**
 * Sprint D — F10: Setlist Variants migration + round-trip tests.
 *
 * Tests the migration logic v9→v10 and the core invariant that
 * the active variant's setlist is always mirrored in top-level state.
 */

import { describe, it, expect } from 'vitest'

interface SetlistItem {
  id: string
  path: string
  name: string
  markers?: Array<{ id: string; time: number; label: string }>
  midiCues?: Array<{ id: string; triggerTimecode: string; messageType: string; channel: number; data1: number; enabled: boolean }>
}

interface SetlistVariant {
  id: string
  name: string
  setlist: SetlistItem[]
  activeSetlistIndex: number | null
}

interface PresetData {
  version?: number
  setlist?: SetlistItem[]
  setlistVariants?: SetlistVariant[]
  activeSetlistVariantId?: string
  markerTypeColorOverrides?: Record<string, string>
}

// Re-implement migrateV9toV10 locally (mirrors store.ts logic)
function migratePreset(data: PresetData): PresetData {
  const version = data.version ?? 0
  // version 9 → 10: wrap setlist in default variant
  if (version < 10) {
    if (!data.setlistVariants || data.setlistVariants.length === 0) {
      data.setlistVariants = [{
        id: 'main',
        name: 'Main',
        setlist: data.setlist ?? [],
        activeSetlistIndex: null
      }]
    }
    if (!data.activeSetlistVariantId) {
      data.activeSetlistVariantId = data.setlistVariants[0].id
    }
  }
  data.version = 10
  return data
}

// Re-implement resolveVariantsFromPreset
function resolveVariantsFromPreset(presetData: PresetData): { setlistVariants: SetlistVariant[]; activeSetlistVariantId: string } {
  const defaultVariant: SetlistVariant = { id: 'main', name: 'Main', setlist: presetData.setlist ?? [], activeSetlistIndex: null }
  const rawVariants = presetData.setlistVariants && presetData.setlistVariants.length > 0
    ? presetData.setlistVariants
    : [defaultVariant]
  const activeId = presetData.activeSetlistVariantId && rawVariants.some(v => v.id === presetData.activeSetlistVariantId)
    ? presetData.activeSetlistVariantId
    : rawVariants[0].id
  return { setlistVariants: rawVariants, activeSetlistVariantId: activeId }
}

describe('F10 — migratePreset v9→v10', () => {
  it('wraps existing setlist into a single Main variant', () => {
    const v9: PresetData = {
      version: 9,
      setlist: [
        { id: 'sl-1', path: '/a/song.wav', name: 'song.wav' }
      ]
    }
    const result = migratePreset(v9)
    expect(result.version).toBe(10)
    expect(result.setlistVariants).toHaveLength(1)
    expect(result.setlistVariants![0].id).toBe('main')
    expect(result.setlistVariants![0].name).toBe('Main')
    expect(result.setlistVariants![0].setlist).toHaveLength(1)
    expect(result.setlistVariants![0].setlist[0].id).toBe('sl-1')
    expect(result.activeSetlistVariantId).toBe('main')
  })

  it('preserves existing setlistVariants if already present (idempotent for v9 with variants)', () => {
    const preset: PresetData = {
      version: 9,
      setlist: [{ id: 'sl-1', path: '/a.wav', name: 'a.wav' }],
      setlistVariants: [
        { id: 'v-custom', name: 'Rehearsal', setlist: [{ id: 'sl-2', path: '/b.wav', name: 'b.wav' }], activeSetlistIndex: null }
      ],
      activeSetlistVariantId: 'v-custom'
    }
    const result = migratePreset(preset)
    // Should not overwrite existing variants
    expect(result.setlistVariants).toHaveLength(1)
    expect(result.setlistVariants![0].id).toBe('v-custom')
    expect(result.activeSetlistVariantId).toBe('v-custom')
  })

  it('handles empty setlist (no songs)', () => {
    const v9: PresetData = { version: 9, setlist: [] }
    const result = migratePreset(v9)
    expect(result.setlistVariants).toHaveLength(1)
    expect(result.setlistVariants![0].setlist).toHaveLength(0)
  })

  it('handles missing setlist (undefined)', () => {
    const v9: PresetData = { version: 9 }
    const result = migratePreset(v9)
    expect(result.setlistVariants).toHaveLength(1)
    expect(result.setlistVariants![0].setlist).toHaveLength(0)
  })

  it('is idempotent when run on v10', () => {
    const v10: PresetData = {
      version: 10,
      setlist: [{ id: 'sl-1', path: '/a.wav', name: 'a.wav' }],
      setlistVariants: [
        { id: 'main', name: 'Main', setlist: [{ id: 'sl-1', path: '/a.wav', name: 'a.wav' }], activeSetlistIndex: null }
      ],
      activeSetlistVariantId: 'main'
    }
    const result = migratePreset(v10)
    expect(result.setlistVariants).toHaveLength(1)
    expect(result.setlistVariants![0].id).toBe('main')
  })
})

describe('F10 — resolveVariantsFromPreset', () => {
  it('returns variants and active id', () => {
    const preset: PresetData = {
      version: 10,
      setlistVariants: [
        { id: 'v-1', name: 'Main', setlist: [], activeSetlistIndex: null },
        { id: 'v-2', name: 'Encore', setlist: [], activeSetlistIndex: null }
      ],
      activeSetlistVariantId: 'v-2'
    }
    const { setlistVariants, activeSetlistVariantId } = resolveVariantsFromPreset(preset)
    expect(setlistVariants).toHaveLength(2)
    expect(activeSetlistVariantId).toBe('v-2')
  })

  it('falls back to first variant if activeId not found', () => {
    const preset: PresetData = {
      version: 10,
      setlistVariants: [
        { id: 'v-1', name: 'Main', setlist: [], activeSetlistIndex: null }
      ],
      activeSetlistVariantId: 'v-missing'
    }
    const { activeSetlistVariantId } = resolveVariantsFromPreset(preset)
    expect(activeSetlistVariantId).toBe('v-1')
  })

  it('creates default variant if setlistVariants missing', () => {
    const preset: PresetData = {
      version: 9,
      setlist: [{ id: 'sl-x', path: '/x.wav', name: 'x.wav' }]
    }
    const { setlistVariants, activeSetlistVariantId } = resolveVariantsFromPreset(preset)
    expect(setlistVariants).toHaveLength(1)
    expect(setlistVariants[0].setlist[0].id).toBe('sl-x')
    expect(activeSetlistVariantId).toBe('main')
  })
})

describe('F10 — variant switch write-back invariant', () => {
  /**
   * Simulate the switchSetlistVariant action:
   * 1. Write current top-level setlist back to active variant
   * 2. Load new variant's setlist into top-level
   */
  function simulateSwitchVariant(
    variants: SetlistVariant[],
    currentActiveId: string,
    currentSetlist: SetlistItem[],
    currentActiveIdx: number | null,
    targetId: string
  ): { variants: SetlistVariant[]; setlist: SetlistItem[]; activeSetlistVariantId: string; activeSetlistIndex: number | null } {
    const updatedVariants = variants.map(v =>
      v.id === currentActiveId ? { ...v, setlist: currentSetlist, activeSetlistIndex: currentActiveIdx } : v
    )
    const target = updatedVariants.find(v => v.id === targetId)!
    return {
      variants: updatedVariants,
      setlist: target.setlist,
      activeSetlistVariantId: targetId,
      activeSetlistIndex: target.activeSetlistIndex
    }
  }

  it('preserves A contents when switching to B and back to A', () => {
    const variantA: SetlistVariant = {
      id: 'v-a', name: 'A',
      setlist: [{ id: 'sl-1', path: '/a.wav', name: 'a.wav' }],
      activeSetlistIndex: 0
    }
    const variantB: SetlistVariant = {
      id: 'v-b', name: 'B',
      setlist: [{ id: 'sl-2', path: '/b.wav', name: 'b.wav' }],
      activeSetlistIndex: null
    }

    // A is active, setlist has 1 song
    let state = {
      variants: [variantA, variantB],
      setlist: variantA.setlist,
      activeId: 'v-a',
      activeIdx: 0 as number | null
    }

    // Switch to B
    const afterSwitchToB = simulateSwitchVariant(state.variants, state.activeId, state.setlist, state.activeIdx, 'v-b')
    expect(afterSwitchToB.setlist[0].id).toBe('sl-2')
    // A should still be saved in variants
    const savedA = afterSwitchToB.variants.find(v => v.id === 'v-a')!
    expect(savedA.setlist[0].id).toBe('sl-1')
    expect(savedA.activeSetlistIndex).toBe(0)

    // Simulate editing B (add a song)
    const editedBSetlist = [...afterSwitchToB.setlist, { id: 'sl-3', path: '/c.wav', name: 'c.wav' }]

    // Switch back to A
    const afterSwitchToA = simulateSwitchVariant(afterSwitchToB.variants, 'v-b', editedBSetlist, null, 'v-a')
    // A content should be unchanged
    expect(afterSwitchToA.setlist[0].id).toBe('sl-1')
    expect(afterSwitchToA.setlist).toHaveLength(1)
    // B should have 2 songs saved
    const savedB = afterSwitchToA.variants.find(v => v.id === 'v-b')!
    expect(savedB.setlist).toHaveLength(2)
  })

  it('does not change other variants when mutating active variant', () => {
    const variants: SetlistVariant[] = [
      { id: 'v-main', name: 'Main', setlist: [{ id: 'sl-1', path: '/a.wav', name: 'a.wav' }], activeSetlistIndex: 0 },
      { id: 'v-enc', name: 'Encore', setlist: [{ id: 'sl-2', path: '/b.wav', name: 'b.wav' }], activeSetlistIndex: 0 }
    ]

    // Simulate adding item to active variant (mirrors store.addToSetlist)
    const currentSetlist = variants[0].setlist
    const newItem: SetlistItem = { id: 'sl-99', path: '/c.wav', name: 'c.wav' }
    const newSetlist = [...currentSetlist, newItem]
    const updatedVariants = variants.map(v =>
      v.id === 'v-main' ? { ...v, setlist: newSetlist } : v
    )

    // Encore should be untouched
    const encoreVariant = updatedVariants.find(v => v.id === 'v-enc')!
    expect(encoreVariant.setlist).toHaveLength(1)
    expect(encoreVariant.setlist[0].id).toBe('sl-2')
    // Main should have 2 songs
    const mainVariant = updatedVariants.find(v => v.id === 'v-main')!
    expect(mainVariant.setlist).toHaveLength(2)
  })
})

describe('F10 — deleteVariant safety', () => {
  function simulateDelete(variants: SetlistVariant[], activeId: string, deleteId: string) {
    if (variants.length <= 1) return null // blocked
    const idx = variants.findIndex(v => v.id === deleteId)
    if (idx === -1) return null
    const newVariants = variants.filter(v => v.id !== deleteId)
    if (activeId !== deleteId) {
      return { variants: newVariants, activeId }
    }
    const targetIdx = Math.max(0, idx - 1)
    return { variants: newVariants, activeId: newVariants[targetIdx].id }
  }

  it('blocks deletion of last variant', () => {
    const variants: SetlistVariant[] = [{ id: 'main', name: 'Main', setlist: [], activeSetlistIndex: null }]
    const result = simulateDelete(variants, 'main', 'main')
    expect(result).toBeNull()
  })

  it('switches to adjacent variant when deleting active', () => {
    const variants: SetlistVariant[] = [
      { id: 'v-a', name: 'A', setlist: [], activeSetlistIndex: null },
      { id: 'v-b', name: 'B', setlist: [], activeSetlistIndex: null },
      { id: 'v-c', name: 'C', setlist: [], activeSetlistIndex: null }
    ]
    // Delete B (middle), active
    const result = simulateDelete(variants, 'v-b', 'v-b')
    expect(result).not.toBeNull()
    expect(result!.variants).toHaveLength(2)
    // Should switch to A (idx 0 when B at idx 1 is deleted → max(0, 1-1) = 0 = A)
    expect(result!.activeId).toBe('v-a')
  })

  it('keeps active id when deleting non-active variant', () => {
    const variants: SetlistVariant[] = [
      { id: 'v-a', name: 'A', setlist: [], activeSetlistIndex: null },
      { id: 'v-b', name: 'B', setlist: [], activeSetlistIndex: null }
    ]
    const result = simulateDelete(variants, 'v-a', 'v-b')
    expect(result!.activeId).toBe('v-a')
    expect(result!.variants).toHaveLength(1)
  })
})
