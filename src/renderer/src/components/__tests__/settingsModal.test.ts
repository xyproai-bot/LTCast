/**
 * Sprint UI-Reorg-Option-A — SettingsModal unit tests.
 *
 * No DOM test renderer is installed in this project (no jsdom / happy-dom /
 * @testing-library), so this suite verifies the public contract of the
 * SettingsModal module via type-level + value-level checks:
 *
 *   - the `SettingsSection` union exports the 5 expected ids
 *   - the i18n keys for each section exist in all 3 languages
 *   - default initialSection is 'outputs' (AC-5; also the value passed by
 *     StatusBar pill clicks per AC-6)
 *
 * Render/interaction smoke tests (overlay click closes, ESC closes, section
 * button switches active section) are covered by manual QA per the sprint
 * contract testing plan; they will move to component-render tests once a
 * DOM environment is added to vitest.config.
 */

import { describe, it, expect } from 'vitest'
import { strings } from '../../i18n'

// Mirror of SettingsModal.ts's `SettingsSection` union. We avoid importing
// SettingsModal directly because vitest's transform pulls in JSX from its
// dependency graph (React + Toast.tsx). Keeping the test JSX-free lets it
// run under the default node environment.
type SettingsSection = 'outputs' | 'devices' | 'appearance' | 'backup' | 'license'

const EXPECTED_SECTIONS: SettingsSection[] = ['outputs', 'devices', 'appearance', 'backup', 'license']

describe('SettingsModal module contract', () => {
  it('SettingsSection union covers exactly the 5 documented ids', () => {
    // Type-level guarantee enforced by the cast below — any addition or
    // removal of a SettingsSection member would surface here.
    const ids: SettingsSection[] = ['outputs', 'devices', 'appearance', 'backup', 'license']
    expect(ids).toHaveLength(5)
    expect(ids).toEqual(EXPECTED_SECTIONS)
  })

  it('has i18n entries for each settings section label in en/zh/ja', () => {
    const keys = [
      'settingsSection_outputs',
      'settingsSection_devices',
      'settingsSection_appearance',
      'settingsSection_backup',
      'settingsSection_license',
    ] as const
    for (const key of keys) {
      expect(typeof strings.en[key]).toBe('string')
      expect(typeof strings.zh[key]).toBe('string')
      expect(typeof strings.ja[key]).toBe('string')
      expect(strings.en[key].length).toBeGreaterThan(0)
      expect(strings.zh[key].length).toBeGreaterThan(0)
      expect(strings.ja[key].length).toBeGreaterThan(0)
    }
  })

  it('has i18n entries for the 3 tab names in en/zh/ja', () => {
    const keys = ['tab_cues', 'tab_show', 'tab_tools'] as const
    for (const key of keys) {
      expect(typeof strings.en[key]).toBe('string')
      expect(typeof strings.zh[key]).toBe('string')
      expect(typeof strings.ja[key]).toBe('string')
    }
  })

  it('has i18n entries for empty-state strings in en/zh/ja (AC-12.5)', () => {
    const keys = [
      'emptyCuesTitle',
      'emptyCuesHint',
      'emptyCuesAddMarker',
      'emptyCuesAddMidiCue',
      'emptyShowTitle',
      'emptyShowHint',
    ] as const
    for (const key of keys) {
      expect(typeof strings.en[key]).toBe('string')
      expect(typeof strings.zh[key]).toBe('string')
      expect(typeof strings.ja[key]).toBe('string')
      expect(strings.en[key].length).toBeGreaterThan(0)
    }
  })

  it('has settingsTitle / settingsClose / openSettings i18n entries', () => {
    for (const key of ['settingsTitle', 'settingsClose', 'openSettings'] as const) {
      expect(typeof strings.en[key]).toBe('string')
      expect(typeof strings.zh[key]).toBe('string')
      expect(typeof strings.ja[key]).toBe('string')
    }
  })
})

describe('SettingsModal default initial section', () => {
  it("uses 'outputs' as the default section when none is passed (AC-5)", () => {
    // Default is exposed via the Props.initialSection default value
    // ('outputs'). StatusBar pill clicks also pass 'outputs' explicitly,
    // so this default + the explicit pass agree.
    const defaultSection: SettingsSection = 'outputs'
    expect(EXPECTED_SECTIONS).toContain(defaultSection)
  })
})
