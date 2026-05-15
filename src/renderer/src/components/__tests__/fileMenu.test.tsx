// @vitest-environment jsdom
/**
 * Sprint UI-Reorg Follow-up — FileMenu interaction tests.
 *
 * Uses jsdom + react-dom/client + react-dom/test-utils.act so we can
 * mount, click, and verify state without pulling in @testing-library.
 *
 * NOTE: This test file uses React.createElement instead of JSX to
 * sidestep the renderer-only JSX transform — the project ships
 * @vitejs/plugin-react via electron.vite.config.ts, but vitest 4.x
 * runs with a separate rolldown-driven transform and there is no
 * vitest.config so JSX in test files isn't routed through Babel.
 * Switching to React.createElement keeps the test in plain TS that
 * vitest can parse directly (matches settingsModal.test.ts).
 *
 * Coverage:
 *   1. defaults closed (no .file-menu-dropdown in DOM)
 *   2. clicking the trigger opens the dropdown
 *   3. clicking outside the wrapper closes it
 *   4. ESC keydown closes it
 *   5. clicking an item fires its callback and closes the menu
 *   6. Import Video item is disabled when no file is loaded
 */

import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoot, Root } from 'react-dom/client'
import { FileMenu, FileMenuProps } from '../FileMenu'

// React 18's act() expects this global flag, otherwise it logs a
// "act environment is not configured" warning during the tests.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

function mount(props: Partial<FileMenuProps> = {}): {
  trigger: HTMLButtonElement
  callbacks: Required<Pick<FileMenuProps, 'onOpenFile' | 'onImportVideo' | 'onExportLtcWav' | 'onShareProject' | 'onImportProject'>>
} {
  container = document.createElement('div')
  document.body.appendChild(container)

  const callbacks = {
    onOpenFile: vi.fn(),
    onImportVideo: vi.fn(),
    onExportLtcWav: vi.fn(),
    onShareProject: vi.fn(),
    onImportProject: vi.fn(),
  }

  // Use a sentinel to distinguish "caller didn't pass filePath" from
  // "caller explicitly passed null". `??` collapses both into the
  // default, which breaks the disabled-when-no-file test.
  const filePath: string | null = Object.prototype.hasOwnProperty.call(props, 'filePath')
    ? (props.filePath as string | null)
    : '/tmp/song.wav'

  act(() => {
    root = createRoot(container!)
    root.render(
      React.createElement(FileMenu, {
        filePath,
        onOpenFile: callbacks.onOpenFile,
        onImportVideo: callbacks.onImportVideo,
        onExportLtcWav: callbacks.onExportLtcWav,
        onShareProject: callbacks.onShareProject,
        onImportProject: callbacks.onImportProject,
      }),
    )
  })

  const trigger = container.querySelector<HTMLButtonElement>('.file-menu-trigger')
  if (!trigger) throw new Error('FileMenu trigger button not found in DOM')

  return { trigger, callbacks }
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  container = null
  root = null
})

function dropdownEl(): HTMLElement | null {
  return container?.querySelector('.file-menu-dropdown') ?? null
}

describe('FileMenu', () => {
  it('starts closed — dropdown is not in the DOM', () => {
    const { trigger } = mount()
    expect(dropdownEl()).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens when the trigger is clicked', () => {
    const { trigger } = mount()
    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(dropdownEl()).not.toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    const items = dropdownEl()!.querySelectorAll('.file-menu-item')
    expect(items.length).toBe(5)
    const sep = dropdownEl()!.querySelector('.file-menu-separator')
    expect(sep).not.toBeNull()
  })

  it('closes when a mousedown lands outside the wrapper', () => {
    const { trigger } = mount()
    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(dropdownEl()).not.toBeNull()

    const outside = document.createElement('div')
    document.body.appendChild(outside)
    act(() => {
      outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(dropdownEl()).toBeNull()
    outside.remove()
  })

  it('closes when ESC is pressed', () => {
    const { trigger } = mount()
    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(dropdownEl()).not.toBeNull()

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(dropdownEl()).toBeNull()
  })

  it('fires each item callback once and auto-closes', () => {
    type ItemKey =
      | 'onOpenFile'
      | 'onImportVideo'
      | 'onExportLtcWav'
      | 'onShareProject'
      | 'onImportProject'
    const order: ItemKey[] = [
      'onOpenFile',
      'onImportVideo',
      'onExportLtcWav',
      'onShareProject',
      'onImportProject',
    ]

    for (const key of order) {
      const { trigger, callbacks } = mount()
      act(() => {
        trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      const items = dropdownEl()!.querySelectorAll<HTMLButtonElement>('.file-menu-item')
      const targetIndex = order.indexOf(key)
      const item = items[targetIndex]
      act(() => {
        item.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(callbacks[key]).toHaveBeenCalledTimes(1)
      expect(dropdownEl()).toBeNull()

      // Tear down between iterations so the next mount() owns a fresh root
      act(() => {
        root?.unmount()
      })
      container?.remove()
      container = null
      root = null
    }
  })

  it('disables Import Video when no file is loaded', () => {
    const { trigger } = mount({ filePath: null })
    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const items = dropdownEl()!.querySelectorAll<HTMLButtonElement>('.file-menu-item')
    // Index 1 is Import Video (per FileMenu render order)
    expect(items[1].disabled).toBe(true)
    // Other items remain enabled
    expect(items[0].disabled).toBe(false)
    expect(items[2].disabled).toBe(false)
  })
})
