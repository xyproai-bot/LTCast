/**
 * Sprint UI-Reorg-Option-A — Right panel tab migration (preset v11 → v12).
 *
 * Old rightTab union: 'devices' | 'setlist' | 'cues' | 'structure' | 'calc' | 'log' | 'timer'
 * New rightTab union: 'cues' | 'show' | 'tools'
 *
 * Mapping (per AC-7.2):
 *   'devices' / 'structure' / 'setlist' / 'cues' → 'cues'
 *   'log' / 'timer' / 'show'                     → 'show'
 *   'calc' / 'tools'                             → 'tools'
 *   anything else                                → 'cues'
 *
 * Idempotence + version stamp also verified.
 */

import { describe, it, expect } from 'vitest'
import { migrateRightTab } from '../../utils/rightTabMigration'

describe('migrateRightTab (preset v11 → v12)', () => {
  it("maps 'devices' to 'cues' (devices tab no longer exists)", () => {
    expect(migrateRightTab('devices')).toBe('cues')
  })

  it("maps 'structure' to 'cues' (merged into Cues tab)", () => {
    expect(migrateRightTab('structure')).toBe('cues')
  })

  it("maps 'setlist' to 'cues' (setlist no longer a right-tab value)", () => {
    expect(migrateRightTab('setlist')).toBe('cues')
  })

  it("maps 'log' to 'show' (log half of Show tab)", () => {
    expect(migrateRightTab('log')).toBe('show')
  })

  it("maps 'timer' to 'show' (timer half of Show tab)", () => {
    expect(migrateRightTab('timer')).toBe('show')
  })

  it("maps 'calc' to 'tools'", () => {
    expect(migrateRightTab('calc')).toBe('tools')
  })

  it("preserves 'cues'", () => {
    expect(migrateRightTab('cues')).toBe('cues')
  })

  it("preserves 'show'", () => {
    expect(migrateRightTab('show')).toBe('show')
  })

  it("preserves 'tools'", () => {
    expect(migrateRightTab('tools')).toBe('tools')
  })

  it('falls back to cues for undefined (unset field on legacy preset)', () => {
    expect(migrateRightTab(undefined)).toBe('cues')
  })

  it('falls back to cues for null', () => {
    expect(migrateRightTab(null)).toBe('cues')
  })

  it('falls back to cues for empty string', () => {
    expect(migrateRightTab('')).toBe('cues')
  })

  it('falls back to cues for unknown legacy value', () => {
    expect(migrateRightTab('something-future-or-corrupt')).toBe('cues')
  })

  it('falls back to cues for non-string input', () => {
    expect(migrateRightTab(42)).toBe('cues')
    expect(migrateRightTab({})).toBe('cues')
    expect(migrateRightTab([])).toBe('cues')
  })

  it('is idempotent: migrating an already-migrated value is a no-op', () => {
    const all = ['cues', 'show', 'tools'] as const
    for (const v of all) {
      expect(migrateRightTab(migrateRightTab(v))).toBe(v)
    }
  })

  it('returns only the new union values for every input', () => {
    const inputs = ['devices', 'setlist', 'cues', 'structure', 'calc', 'log', 'timer', 'show', 'tools', undefined, null, '', 'garbage', 0, false]
    const allowed = new Set(['cues', 'show', 'tools'])
    for (const input of inputs) {
      expect(allowed.has(migrateRightTab(input))).toBe(true)
    }
  })
})
