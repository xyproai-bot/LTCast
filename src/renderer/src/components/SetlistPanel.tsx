import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useStore, SortMode } from '../store'
import { framesToTc, tcToString } from '../audio/timecodeConvert'
import { t } from '../i18n'
import { toast } from './Toast'
import { buildCueSheetHtml } from '../utils/exportCueSheet'
import { Tooltip } from './Tooltip'

// F6: Long-press threshold before a setlist row becomes draggable.
// Below this, mousedown+mouseup is treated as a normal click (standby toggle).
const LONG_PRESS_MS = 300

interface Props {
  onLoadFile: (path: string, offsetFrames?: number) => void
  onImportFiles?: () => void
}

function formatDurShort(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function SetlistPanel({ onLoadFile, onImportFiles }: Props): React.JSX.Element {
  const {
    setlist, activeSetlistIndex, lang,
    addToSetlist, removeFromSetlist, reorderSetlist, clearSetlist,
    sortSetlist, setActiveSetlistIndex,
    autoAdvance, autoAdvanceGap, setAutoAdvance, setAutoAdvanceGap
  } = useStore()

  const [showSortMenu, setShowSortMenu] = useState(false)
  const [missingPaths, setMissingPaths] = useState<Set<string>>(new Set())
  const [durations, setDurations] = useState<Record<string, number | null>>({})
  const [editingOffsetIdx, setEditingOffsetIdx] = useState<number | null>(null)
  const [editingOffsetStr, setEditingOffsetStr] = useState('')
  const [editingNotesIdx, setEditingNotesIdx] = useState<number | null>(null)
  const [editingNotesStr, setEditingNotesStr] = useState('')
  // F6: which row (if any) has passed the LONG_PRESS_MS threshold and is now draggable.
  const [armedIdx, setArmedIdx] = useState<number | null>(null)
  const offsetInputRef = useRef<HTMLInputElement>(null)
  const notesInputRef = useRef<HTMLInputElement>(null)
  const sortRef = useRef<HTMLDivElement>(null)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // F6: pending long-press timer handle; set on mousedown, cleared on mouseup/mouseleave/unmount.
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // F6: when true, the next synthetic click event is swallowed (Q2: armed release does not
  // re-fire the standby toggle).
  const suppressNextClickRef = useRef(false)

  // Auto-focus offset input when it appears
  useEffect(() => {
    if (editingOffsetIdx !== null) {
      offsetInputRef.current?.focus()
      offsetInputRef.current?.select()
    }
  }, [editingOffsetIdx])

  // Auto-focus notes input when it appears
  useEffect(() => {
    if (editingNotesIdx !== null) {
      notesInputRef.current?.focus()
    }
  }, [editingNotesIdx])

  // Clear hold timer/interval on unmount (also F6 long-press timer)
  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current)
      if (holdIntervalRef.current) clearInterval(holdIntervalRef.current)
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
    }
  }, [])

  // Check which setlist files are missing on disk
  const checkMissing = useCallback(async (items: typeof setlist): Promise<void> => {
    if (items.length === 0) { setMissingPaths(new Set()); return }
    const results = await Promise.all(
      items.map(item => window.api.fileExists(item.path).then(exists => ({ path: item.path, exists })).catch(() => ({ path: item.path, exists: true })))
    )
    const missing = new Set(results.filter(r => !r.exists).map(r => r.path))
    setMissingPaths(missing)
  }, [])

  useEffect(() => {
    if (setlist.length === 0) { setMissingPaths(new Set()); return }
    let cancelled = false
    const snapshot = setlist
    Promise.all(
      snapshot.map(item => window.api.fileExists(item.path).then(exists => ({ path: item.path, exists })).catch(() => ({ path: item.path, exists: true })))
    ).then(results => {
      if (cancelled) return
      setMissingPaths(new Set(results.filter(r => !r.exists).map(r => r.path)))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [setlist])

  // Fetch durations only for paths not yet cached (avoids re-probing on every edit)
  const pathsKey = setlist.map(i => i.path).join('|')
  useEffect(() => {
    if (setlist.length === 0) { setDurations({}); return }
    let cancelled = false
    const paths = setlist.map(item => item.path)
    const missing = paths.filter(p => !(p in durations))
    if (missing.length === 0) return
    window.api.getAudioDurations(missing).then(result => {
      if (cancelled) return
      setDurations(prev => ({ ...prev, ...result }))
    }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathsKey])

  // Re-check file existence when window regains focus
  useEffect(() => {
    const onFocus = (): void => {
      const current = useStore.getState().setlist
      if (current.length > 0) checkMissing(current)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [checkMissing])

  // Close sort menu when clicking outside
  useEffect(() => {
    if (!showSortMenu) return
    const onClick = (e: MouseEvent): void => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setShowSortMenu(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [showSortMenu])

  const dragIdx = useRef<number | null>(null)
  const dragOverIdx = useRef<number | null>(null)

  const handleFileDrop = useCallback((e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    const files = Array.from(e.dataTransfer.files)
    const audioExts = ['.wav', '.aiff', '.aif', '.mp3', '.flac', '.ogg', '.m4a']
    const items = files
      .filter(f => audioExts.some(ext => f.name.toLowerCase().endsWith(ext)))
      .map(f => ({
        path: window.api.getPathForFile(f),
        name: f.name
      }))
    if (items.length > 0) addToSetlist(items)
  }, [addToSetlist])

  const handleRelink = useCallback(async (index: number): Promise<void> => {
    const item = setlist[index]
    const newPath = await window.api.relinkFile(item.path)
    if (!newPath) return

    const resolvedPaths = new Set<string>([item.path])
    const batchUpdates: Array<{ index: number; newPath: string }> = [
      { index, newPath }
    ]

    // Auto-relink: scan the folder (+ subfolders) for other missing files
    const folderPath = newPath.replace(/[/\\][^/\\]+$/, '') // dirname
    const otherMissing: Array<{ idx: number; name: string; oldPath: string }> = []
    for (let i = 0; i < setlist.length; i++) {
      if (i === index) continue
      if (missingPaths.has(setlist[i].path)) {
        otherMissing.push({ idx: i, name: setlist[i].name, oldPath: setlist[i].path })
      }
    }

    if (otherMissing.length > 0) {
      const fileNames = otherMissing.map(m => m.name)
      try {
        const found = await window.api.scanFolderForFiles(folderPath, fileNames)
        for (const m of otherMissing) {
          const foundPath = found[m.name.toLowerCase()]
          if (foundPath) {
            batchUpdates.push({ index: m.idx, newPath: foundPath })
            resolvedPaths.add(m.oldPath)
          }
        }
      } catch (e) { console.warn('Folder scan failed:', e) }
    }

    // Single store update — triggers one re-render instead of N
    const { batchUpdateSetlistPaths } = useStore.getState()
    batchUpdateSetlistPaths(batchUpdates)

    setMissingPaths(prev => {
      const next = new Set(prev)
      for (const p of resolvedPaths) next.delete(p)
      return next
    })

    const count = resolvedPaths.size
    if (count === 1) {
      toast.success(t(lang, 'fileRelinked'))
    } else {
      toast.success(t(lang, 'filesAutoRelinked').replace('{n}', String(count)))
    }
  }, [setlist, missingPaths, lang])

  const { setStandbySetlistIndex, standbySetlistIndex } = useStore()

  // Single click = standby (cue up), double-click = immediate load
  // Debounce single-click by 250ms so double-click doesn't briefly flash standby.
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleItemClick = useCallback((index: number): void => {
    if (editingOffsetIdx === index) return
    const item = setlist[index]
    if (missingPaths.has(item.path)) {
      handleRelink(index)
      return
    }
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null
      setStandbySetlistIndex(index)
    }, 250)
  }, [setlist, missingPaths, setStandbySetlistIndex, handleRelink, editingOffsetIdx])

  const handleItemDoubleClick = useCallback((index: number): void => {
    if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null }
    const item = setlist[index]
    if (missingPaths.has(item.path)) return
    setStandbySetlistIndex(null)
    setActiveSetlistIndex(index)
    onLoadFile(item.path, item.offsetFrames)
  }, [setlist, missingPaths, setStandbySetlistIndex, setActiveSetlistIndex, onLoadFile])

  useEffect(() => {
    return () => { if (clickTimerRef.current) clearTimeout(clickTimerRef.current) }
  }, [])

  const handleToggleOffsetEdit = useCallback((e: React.MouseEvent, index: number): void => {
    e.stopPropagation()
    if (editingOffsetIdx === index) {
      setEditingOffsetIdx(null)
    } else {
      const item = setlist[index]
      setEditingOffsetIdx(index)
      setEditingOffsetStr(item.offsetFrames !== undefined ? String(item.offsetFrames) : '')
    }
  }, [editingOffsetIdx, setlist])

  const commitOffset = useCallback((index: number): void => {
    const { setSetlistItemOffset } = useStore.getState()
    const val = editingOffsetStr.trim()
    if (val === '' || val === '-') {
      setSetlistItemOffset(index, undefined)
    } else {
      const num = parseInt(val, 10)
      if (!isNaN(num)) {
        setSetlistItemOffset(index, Math.max(-9999, Math.min(9999, num)))
      }
    }
  }, [editingOffsetStr])

  const adjustOffset = useCallback((delta: number): void => {
    setEditingOffsetStr(prev => {
      const cur = parseInt(prev, 10)
      const base = isNaN(cur) ? 0 : cur
      return String(Math.max(-9999, Math.min(9999, base + delta)))
    })
  }, [])

  const startHold = useCallback((delta: number): void => {
    adjustOffset(delta)
    holdTimerRef.current = setTimeout(() => {
      holdIntervalRef.current = setInterval(() => adjustOffset(delta), 80)
    }, 500)
  }, [adjustOffset])

  const stopHold = useCallback((): void => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null }
    if (holdIntervalRef.current) { clearInterval(holdIntervalRef.current); holdIntervalRef.current = null }
  }, [])

  const handleDragStart = useCallback((e: React.DragEvent<HTMLDivElement>, index: number): void => {
    dragIdx.current = index
    e.dataTransfer.effectAllowed = 'move'
    // Set custom data so the center panel can detect setlist drags
    e.dataTransfer.setData('application/x-ltcast-setlist', JSON.stringify({ index, path: setlist[index].path }))
  }, [setlist])

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>, index: number): void => {
    e.preventDefault()
    dragOverIdx.current = index
  }, [])

  const handleDragEnd = useCallback((): void => {
    if (dragIdx.current !== null && dragOverIdx.current !== null && dragIdx.current !== dragOverIdx.current) {
      reorderSetlist(dragIdx.current, dragOverIdx.current)
    }
    dragIdx.current = null
    dragOverIdx.current = null
    // F6: clear armed visual once the drag gesture ends (success, cancel, or drop off-target).
    setArmedIdx(null)
    // Clean up any still-pending long-press timer (belt-and-braces; should already be cleared
    // because dragstart only fires after we armed the row).
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [reorderSetlist])

  // F6: long-press gate. We keep the HTML5 drag-and-drop flow intact; `draggable` is only
  // true once the user has held the row for LONG_PRESS_MS. Mousedown starts the timer;
  // mouseup/mouseleave clears it. If the timer fires, the row arms and the next click on
  // the same row is suppressed (Q2).
  const handleItemMouseDown = useCallback((_e: React.MouseEvent, index: number): void => {
    // If a previous gesture left a pending timer, clear it first.
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null
      suppressNextClickRef.current = true
      setArmedIdx(index)
    }, LONG_PRESS_MS)
  }, [])

  const handleItemMouseUp = useCallback((_e: React.MouseEvent, _index: number): void => {
    // Release before threshold → cancel timer, let the native click fire normally.
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    // If the row was already armed but the user released without dragging, clear the
    // armed visual. `suppressNextClickRef` is already true from the timer callback, so
    // the trailing React click event will be swallowed (Q2).
    if (armedIdx !== null) setArmedIdx(null)
  }, [armedIdx])

  const handleItemMouseLeave = useCallback((): void => {
    // Leaving the row mid-gesture cancels the long-press. Also clears armed visual if set.
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    if (armedIdx !== null) setArmedIdx(null)
  }, [armedIdx])

  const handleSort = useCallback((mode: SortMode): void => {
    sortSetlist(mode)
    setShowSortMenu(false)
  }, [sortSetlist])

  const handleExportCsv = useCallback(async (): Promise<void> => {
    if (setlist.length === 0) {
      toast.warning(t(lang, 'exportCsvEmpty'))
      return
    }
    const escape = (s: string): string => {
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"'
      }
      return s
    }
    const formatDuration = (secs: number): string => {
      const h = Math.floor(secs / 3600)
      const m = Math.floor((secs % 3600) / 60)
      const s = Math.floor(secs % 60)
      return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    }
    try {
      // Get durations for all files via ffprobe
      const paths = setlist.map(item => item.path)
      const durations = await window.api.getAudioDurations(paths)
      const fps = useStore.getState().forceFps ?? 25

      const header = '#,Song Name,Duration,Offset,Notes,File Path'
      const rows = setlist.map((item, i) => {
        const dur = durations[item.path]
        const durationStr = dur != null ? formatDuration(dur) : ''
        const offsetStr = item.offsetFrames
          ? tcToString(framesToTc(item.offsetFrames, fps))
          : '00:00:00:00'
        return [
          String(i + 1),
          escape(item.name),
          durationStr,
          offsetStr,
          escape(item.notes ?? ''),
          escape(item.path)
        ].join(',')
      })
      const csvContent = [header, ...rows].join('\r\n')
      const defaultName = 'setlist.csv'
      const savedPath = await window.api.saveCsvDialog(csvContent, defaultName)
      if (savedPath) toast.success(t(lang, 'exportCsvSuccess'))
    } catch (e) {
      console.error('CSV export failed', e)
    }
  }, [setlist, lang])

  const handleExportPdf = useCallback(async (): Promise<void> => {
    if (setlist.length === 0) return
    const s = useStore.getState()
    const fps = s.forceFps ?? s.detectedFps ?? 25
    const html = buildCueSheetHtml({
      presetName: s.presetName || 'Untitled',
      setlist,
      markers: s.markers,
      fps
    })
    const defaultName = `${s.presetName || 'cuesheet'}.pdf`
    const savedPath = await window.api.printToPdf(html, defaultName)
    if (savedPath) toast.success('PDF exported')
  }, [setlist])

  const handleImportCsv = useCallback(async (): Promise<void> => {
    try {
      const csvContent = await window.api.openCsvDialog()
      if (!csvContent) return

      // Parse CSV — handle UTF-8 BOM
      const content = csvContent.startsWith('\uFEFF') ? csvContent.slice(1) : csvContent
      const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0)
      if (lines.length === 0) { toast.error(t(lang, 'csvFormatError')); return }

      // Simple CSV field parser — handles quoted fields with commas/quotes inside
      const parseRow = (line: string): string[] => {
        const fields: string[] = []
        let cur = ''
        let inQuote = false
        for (let i = 0; i < line.length; i++) {
          const ch = line[i]
          if (inQuote) {
            if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
            else if (ch === '"') { inQuote = false }
            else { cur += ch }
          } else {
            if (ch === '"') { inQuote = true }
            else if (ch === ',') { fields.push(cur); cur = '' }
            else { cur += ch }
          }
        }
        fields.push(cur)
        return fields
      }

      // Detect header format
      const firstRow = parseRow(lines[0])
      const h1 = firstRow.map(f => f.trim().toLowerCase())
      const hasHeader = h1[0] === '#' || h1.includes('song name')
      const dataLines = hasHeader ? lines.slice(1) : lines

      // Detect new format: #, Song Name, Duration, Offset, Notes, File Path
      const isNewFormat = hasHeader && h1.includes('notes') && h1.includes('duration')

      const items: Array<{ path: string; name: string; offsetFrames?: number; notes?: string }> = []
      let missingCount = 0

      for (const line of dataLines) {
        const row = parseRow(line)
        if (row.length < 3) continue

        let name: string, path: string, notes: string | undefined

        if (isNewFormat) {
          // New format: #, Song Name, Duration, Offset, Notes, File Path
          name = row[1]?.trim() ?? ''
          notes = row[4]?.trim() || undefined
          path = row[5]?.trim() ?? ''
        } else {
          // Old format: #, Song Name, File Path, Song Offset (frames)
          name = row[1]?.trim() ?? ''
          path = row[2]?.trim() ?? ''
        }
        if (!path) continue

        items.push({
          path,
          name: name || (path.split(/[/\\]/).pop() ?? path),
          notes
        })
      }

      if (items.length === 0) { toast.error(t(lang, 'csvFormatError')); return }

      // Check which paths exist
      const existenceChecks = await Promise.all(
        items.map(item => window.api.fileExists(item.path).then(e => e).catch(() => true))
      )
      missingCount = existenceChecks.filter(e => !e).length

      addToSetlist(items)

      if (missingCount === 0) {
        toast.success(t(lang, 'importCsvSuccess', { n: String(items.length) }))
      } else {
        toast.warning(t(lang, 'importCsvPartial', {
          n: String(items.length - missingCount),
          m: String(missingCount)
        }))
      }
    } catch (e) {
      console.error('CSV import failed', e)
      toast.error(t(lang, 'csvFormatError'))
    }
  }, [lang, addToSetlist])

  return (
    <div
      className="setlist-panel"
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
      onDrop={handleFileDrop}
    >
      {/* Always-visible header: title + actions */}
      <div className="setlist-panel-header">
        <span className="setlist-panel-title">{t(lang, 'setlist')}</span>
        <div className="setlist-header-actions">
          <button className="setlist-hdr-btn setlist-hdr-btn--add" onClick={onImportFiles} title={t(lang, 'addFiles')}>+</button>
          <div className="setlist-sort-wrapper" ref={sortRef}>
            <button
              className="setlist-hdr-btn"
              onClick={() => setShowSortMenu(!showSortMenu)}
              title={t(lang, 'sortAZ')}
            >⇅</button>
            {showSortMenu && (
              <div className="setlist-sort-menu--down">
                <button onClick={() => handleSort('az')}>{t(lang, 'sortAZ')}</button>
                <button onClick={() => handleSort('za')}>{t(lang, 'sortZA')}</button>
                <button onClick={() => handleSort('ext')}>{t(lang, 'sortExt')}</button>
                <button onClick={() => handleSort('reverse')}>{t(lang, 'sortReverse')}</button>
              </div>
            )}
          </div>
          <button
            className="setlist-hdr-btn"
            onClick={handleExportCsv}
            title={t(lang, 'exportCsv')}
            disabled={setlist.length === 0}
          >↑</button>
          <button
            className="setlist-hdr-btn"
            onClick={handleExportPdf}
            title="Export PDF Cue Sheet"
            disabled={setlist.length === 0}
          >PDF</button>
          <button
            className="setlist-hdr-btn"
            onClick={handleImportCsv}
            title={t(lang, 'importCsv')}
          >↓</button>
        </div>
      </div>

      {setlist.length === 0 ? (
        <div className="setlist-empty" onClick={onImportFiles}>
          <div className="setlist-empty-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </div>
          <div>{t(lang, 'dropFilesHere')}</div>
          <div className="setlist-empty-hint">{t(lang, 'clickToImport')}</div>
        </div>
      ) : (
        <>
          <div className="setlist-list">
            {setlist.map((item, i) => {
              const isMissing = missingPaths.has(item.path)
              const hasOffset = item.offsetFrames !== undefined
              const isEditingOffset = editingOffsetIdx === i
              return (
                <div key={item.id} className="setlist-item-wrap">
                  <div
                    className={`setlist-item${i === activeSetlistIndex ? ' active' : ''}${i === standbySetlistIndex ? ' standby' : ''}${isMissing ? ' missing' : ''}${isEditingOffset ? ' offset-open' : ''}${armedIdx === i ? ' drag-armed' : ''}`}
                    draggable={armedIdx === i && !isEditingOffset}
                    onDragStart={(e) => handleDragStart(e, i)}
                    onDragOver={(e) => handleDragOver(e, i)}
                    onDragEnd={handleDragEnd}
                    onMouseDown={(e) => handleItemMouseDown(e, i)}
                    onMouseUp={(e) => handleItemMouseUp(e, i)}
                    onMouseLeave={handleItemMouseLeave}
                    onClick={() => {
                      // F6: swallow the click that trails a long-press gesture (Q2).
                      if (suppressNextClickRef.current) {
                        suppressNextClickRef.current = false
                        return
                      }
                      handleItemClick(i)
                    }}
                    onDoubleClick={() => handleItemDoubleClick(i)}
                    title={isMissing ? t(lang, 'fileMissing') : item.name}
                  >
                    <span className="setlist-index">{i + 1}</span>
                    <span className="setlist-name">
                      {isMissing && (
                        <svg style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#ff8800" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                      )}
                      {item.name}
                    </span>
                    {durations[item.path] != null && (
                      <span className="setlist-duration">{formatDurShort(durations[item.path] as number)}</span>
                    )}
                    {hasOffset && (
                      <span className="setlist-offset-badge" title={t(lang, 'songOffset')}>
                        {(item.offsetFrames ?? 0) >= 0 ? '+' : ''}{item.offsetFrames}f
                      </span>
                    )}
                    {item.notes && (
                      <span className="setlist-notes-badge" title={item.notes}>N</span>
                    )}
                    <Tooltip text={t(lang, 'songOffset')}>
                      <button
                        className={`setlist-offset-btn${isEditingOffset ? ' active' : ''}`}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => handleToggleOffsetEdit(e, i)}
                      >⊕</button>
                    </Tooltip>
                    <Tooltip text={t(lang, 'songNotes')}>
                      <button
                        className={`setlist-offset-btn${editingNotesIdx === i ? ' active' : ''}`}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (editingNotesIdx === i) {
                            setEditingNotesIdx(null)
                          } else {
                            setEditingNotesStr(item.notes ?? '')
                            setEditingNotesIdx(i)
                            setEditingOffsetIdx(null)
                          }
                        }}
                      >N</button>
                    </Tooltip>
                    <Tooltip text={t(lang, 'remove')}>
                      <button
                        className="setlist-remove"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); removeFromSetlist(i) }}
                      >✕</button>
                    </Tooltip>
                  </div>
                  {isEditingOffset && (
                    <div className="setlist-offset-editor" onClick={(e) => e.stopPropagation()}>
                      <Tooltip text="-1 frame">
                        <button
                          className="offset-adj-btn"
                          onMouseDown={(e) => { e.preventDefault(); startHold(-1) }}
                          onMouseUp={stopHold}
                          onMouseLeave={stopHold}
                        >−</button>
                      </Tooltip>
                      <input
                        ref={offsetInputRef}
                        type="text"
                        inputMode="numeric"
                        className="setlist-offset-input"
                        value={editingOffsetStr}
                        placeholder="0"
                        onChange={(e) => {
                          const v = e.target.value
                          if (v === '' || v === '-' || /^-?\d+$/.test(v)) setEditingOffsetStr(v)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); commitOffset(i); setEditingOffsetIdx(null) }
                          if (e.key === 'Escape') { e.stopPropagation(); setEditingOffsetIdx(null) }
                          if (e.key === 'ArrowUp') { e.preventDefault(); adjustOffset(1) }
                          if (e.key === 'ArrowDown') { e.preventDefault(); adjustOffset(-1) }
                        }}
                        onBlur={() => { stopHold(); commitOffset(i); setEditingOffsetIdx(null) }}
                      />
                      <Tooltip text="+1 frame">
                        <button
                          className="offset-adj-btn"
                          onMouseDown={(e) => { e.preventDefault(); startHold(1) }}
                          onMouseUp={stopHold}
                          onMouseLeave={stopHold}
                        >+</button>
                      </Tooltip>
                      {hasOffset && (
                        <Tooltip text={t(lang, 'songOffsetClear')}>
                          <button
                            className="setlist-offset-clear"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => {
                              e.stopPropagation()
                              useStore.getState().setSetlistItemOffset(i, undefined)
                              setEditingOffsetIdx(null)
                            }}
                          >✕</button>
                        </Tooltip>
                      )}
                    </div>
                  )}
                  {editingNotesIdx === i && (
                    <div className="setlist-notes-editor" onClick={(e) => e.stopPropagation()}>
                      <input
                        ref={notesInputRef}
                        type="text"
                        className="setlist-notes-input"
                        value={editingNotesStr}
                        placeholder={t(lang, 'songNotesPlaceholder')}
                        onChange={(e) => setEditingNotesStr(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            useStore.getState().setSetlistItemNotes(i, editingNotesStr)
                            setEditingNotesIdx(null)
                          }
                          if (e.key === 'Escape') { e.stopPropagation(); setEditingNotesIdx(null) }
                        }}
                        onBlur={() => {
                          useStore.getState().setSetlistItemNotes(i, editingNotesStr)
                          setEditingNotesIdx(null)
                        }}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Auto-advance controls */}
          <div className="setlist-auto-advance">
            <label className="auto-advance-toggle">
              <input
                type="checkbox"
                checked={autoAdvance}
                onChange={e => setAutoAdvance(e.target.checked)}
              />
              <span>{t(lang, 'autoAdvance')}</span>
            </label>
            {autoAdvance && (
              <label className="auto-advance-gap">
                <span>{t(lang, 'autoAdvanceGap')}</span>
                <input
                  type="number"
                  className="auto-advance-gap-input"
                  min={0}
                  max={30}
                  step={1}
                  value={autoAdvanceGap}
                  onChange={e => setAutoAdvanceGap(Number(e.target.value))}
                />
              </label>
            )}
          </div>

          {/* Clear all at very bottom, red, with confirmation */}
          {Object.keys(durations).length > 0 && (() => {
            const total = setlist.reduce((sum, item) => sum + (durations[item.path] ?? 0), 0)
            const h = Math.floor(total / 3600)
            const m = Math.floor((total % 3600) / 60)
            const s = Math.floor(total % 60)
            const timeStr = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
            return <div className="setlist-total">{setlist.length} songs — {timeStr}</div>
          })()}
          <button
            className="btn-setlist-clear-all"
            onClick={clearSetlist}
          >
            {t(lang, 'clearAll')}
          </button>
        </>
      )}
    </div>
  )
}
