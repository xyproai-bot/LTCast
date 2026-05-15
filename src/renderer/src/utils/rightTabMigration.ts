/**
 * Sprint UI-Reorg-Option-A — Pure utility for rightTab v11 → v12 migration.
 *
 * Lives in a leaf module (no React / no zustand) so vitest tests can import
 * it without pulling Toast.tsx and other JSX into the test graph.
 *
 * Mapping (per AC-7.2):
 *   'devices' / 'structure' / 'setlist' / 'cues' → 'cues'
 *   'log' / 'timer' / 'show'                     → 'show'
 *   'calc' / 'tools'                             → 'tools'
 *   anything else                                → 'cues'   (safe fallback)
 */

export type RightTab = 'cues' | 'show' | 'tools'

export function migrateRightTab(value: unknown): RightTab {
  if (value === 'show' || value === 'log' || value === 'timer') return 'show'
  if (value === 'tools' || value === 'calc') return 'tools'
  return 'cues'
}
