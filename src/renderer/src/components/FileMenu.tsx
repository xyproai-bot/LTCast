/**
 * Sprint UI-Reorg Follow-up — FileMenu
 *
 * Title-bar dropdown that gathers all 5 file/project actions previously
 * scattered as individual buttons. Trigger sits in `.title-bar-left`
 * (right after the LTCast logo); clicking it toggles a vertical list
 * dropdown anchored below the trigger.
 *
 * Items:
 *   1. Open File           → onOpenFile()
 *   2. Import Video        → onImportVideo()
 *   3. Export LTC WAV      → onExportLtcWav()
 *   ────────── (separator)
 *   4. Share Project       → onShareProject()
 *   5. Import .ltcastproject → onImportProject()
 *
 * Closing rules:
 *   - Click any item     → fires its callback then closes
 *   - Click outside      → closes (capture-phase mousedown listener)
 *   - ESC                → closes
 *   - Trigger re-click   → toggles closed
 *
 * Styling lives in globals.css under `.file-menu-*`. No third-party
 * dropdown library is used — plain useState + useEffect handle every
 * lifecycle concern.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { t } from '../i18n'

export interface FileMenuProps {
  /** Currently loaded audio file path (used for disabling Import Video) */
  filePath: string | null
  onOpenFile: () => void
  onImportVideo: () => void
  onExportLtcWav: () => void
  onShareProject: () => void
  onImportProject: () => void
}

export function FileMenu({
  filePath,
  onOpenFile,
  onImportVideo,
  onExportLtcWav,
  onShareProject,
  onImportProject,
}: FileMenuProps): React.JSX.Element {
  const lang = useStore((s) => s.lang)
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  // Close on outside click (capture phase so it fires before any inner
  // onClick — but the trigger button itself is inside the wrapper, so we
  // only close when the click target lives outside the wrapper).
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent): void => {
      const w = wrapperRef.current
      if (!w) return
      if (e.target instanceof Node && !w.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [open])

  // ESC closes the menu
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  // Each item closes the menu after running its callback. We bind via
  // useCallback so children get stable refs (helps if we later memo them).
  const fire = useCallback((fn: () => void) => {
    return () => {
      setOpen(false)
      fn()
    }
  }, [])

  return (
    <div className="file-menu" ref={wrapperRef}>
      <button
        className="title-bar-btn file-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t(lang, 'fileMenuLabel')}
      >
        <span>{t(lang, 'fileMenuLabel')}</span>
        <svg
          className="file-menu-caret"
          width="8"
          height="6"
          viewBox="0 0 8 6"
          aria-hidden="true"
        >
          <path d="M0 0 L4 6 L8 0 Z" fill="currentColor" />
        </svg>
      </button>

      {open && (
        <div className="file-menu-dropdown" role="menu">
          <button
            type="button"
            role="menuitem"
            className="file-menu-item"
            onClick={fire(onOpenFile)}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
            </svg>
            <span>{t(lang, 'openFile')}</span>
          </button>

          <button
            type="button"
            role="menuitem"
            className="file-menu-item"
            onClick={fire(onImportVideo)}
            disabled={!filePath}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
              <line x1="7" y1="2" x2="7" y2="22" />
              <line x1="17" y1="2" x2="17" y2="22" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <line x1="2" y1="7" x2="7" y2="7" />
              <line x1="2" y1="17" x2="7" y2="17" />
              <line x1="17" y1="17" x2="22" y2="17" />
              <line x1="17" y1="7" x2="22" y2="7" />
            </svg>
            <span>{t(lang, 'importVideo')}</span>
          </button>

          <button
            type="button"
            role="menuitem"
            className="file-menu-item"
            onClick={fire(onExportLtcWav)}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>{t(lang, 'exportLtcWav')}</span>
          </button>

          <div className="file-menu-separator" role="separator" />

          <button
            type="button"
            role="menuitem"
            className="file-menu-item"
            onClick={fire(onShareProject)}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
            <span>{t(lang, 'shareAsZip')}</span>
          </button>

          <button
            type="button"
            role="menuitem"
            className="file-menu-item"
            onClick={fire(onImportProject)}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 12v8a2 2 0 01-2 2H6a2 2 0 01-2-2v-8" />
              <polyline points="8 16 12 20 16 16" />
              <line x1="12" y1="20" x2="12" y2="7" />
            </svg>
            <span>{t(lang, 'importLtcastProject')}</span>
          </button>
        </div>
      )}
    </div>
  )
}
