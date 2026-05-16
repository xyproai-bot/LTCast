import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useStore, SortMode, WaveformMarker, MidiCuePoint } from '../store'
import { framesToTc, tcToString, tcToFrames } from '../audio/timecodeConvert'
import { alignAudio } from '../audio/AudioAligner'
import { t } from '../i18n'
import { toast } from './Toast'
import { buildCueSheetHtml, CueSheetLayout } from '../utils/exportCueSheet'
import { Tooltip } from './Tooltip'
import { WaveformCompare } from './WaveformCompare'

// F6: Long-press threshold before a setlist row becomes draggable.
// Below this, mousedown+mouseup is treated as a normal click (standby toggle).
const LONG_PRESS_MS = 300

interface Props {
  onLoadFile: (path: string, offsetFrames?: number) => void
  onImportFiles?: () => void
  onShowLicense?: () => void
}

function formatDurShort(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function SetlistPanel({ onLoadFile, onImportFiles, onShowLicense }: Props): React.JSX.Element {
  const {
    setlist, activeSetlistIndex, lang,
    addToSetlist, removeFromSetlist, reorderSetlist, clearSetlist,
    sortSetlist, setActiveSetlistIndex,
    autoAdvance, autoAdvanceGap, setAutoAdvance, setAutoAdvanceGap,
    setlistVariants, activeSetlistVariantId,
    addSetlistVariant, renameSetlistVariant, deleteSetlistVariant,
    duplicateSetlistVariant, switchSetlistVariant
  } = useStore()

  const [showSortMenu, setShowSortMenu] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const lastSingleClickIdxRef = useRef<number | null>(null)
  const [missingPaths, setMissingPaths] = useState<Set<string>>(new Set())
  const [durations, setDurations] = useState<Record<string, number | null>>({})
  // Per-item expand state — click left ▶ arrow toggles offset editor visibility.
  // Local React state (not in store) — purely UI.
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(new Set())
  const [editingOffsetIdx, setEditingOffsetIdx] = useState<number | null>(null)
  const [editingOffsetStr, setEditingOffsetStr] = useState('')
  const [editingNotesIdx, setEditingNotesIdx] = useState<number | null>(null)
  const [editingNotesStr, setEditingNotesStr] = useState('')
  const [editingStageNoteIdx, setEditingStageNoteIdx] = useState<number | null>(null)
  const [editingStageNoteStr, setEditingStageNoteStr] = useState('')
  const [replacingAudioIdx, setReplacingAudioIdx] = useState<number | null>(null)
  const [replaceAligning, setReplaceAligning] = useState(false)
  // Replace audio preview modal state
  const [replacePreview, setReplacePreview] = useState<{
    index: number
    newPath: string
    newName: string
    newDuration: number
    oldDuration: number
    offsetSec: number
    confidence: number
    oldPeaks: Float32Array
    newPeaks: Float32Array
    markerPreview: Array<{ id: string; label: string; oldTime: number; newTime: number; clipped: boolean }>
    cuePreview: Array<{ id: string; label: string; oldTc: string; newTc: string }>
  } | null>(null)

  // F10: variant rename/context state
  const [variantContextMenu, setVariantContextMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [renamingVariantId, setRenamingVariantId] = useState<string | null>(null)
  const [renamingVariantStr, setRenamingVariantStr] = useState('')
  // PDF layout choice (compact vs detailed)
  const [pdfLayout, setPdfLayout] = useState<CueSheetLayout>('detailed')
  const [showPdfLayoutMenu, setShowPdfLayoutMenu] = useState(false)
  const pdfMenuRef = useRef<HTMLDivElement>(null)
  // F6: which row (if any) has passed the LONG_PRESS_MS threshold and is now draggable.
  const [armedIdx, setArmedIdx] = useState<number | null>(null)
  const offsetInputRef = useRef<HTMLInputElement>(null)
  const notesInputRef = useRef<HTMLInputElement>(null)
  const stageNoteInputRef = useRef<HTMLInputElement>(null)
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

  // Auto-focus stage note input when it appears
  useEffect(() => {
    if (editingStageNoteIdx !== null) {
      stageNoteInputRef.current?.focus()
    }
  }, [editingStageNoteIdx])

  // Clear selection + expand state when variant switches
  useEffect(() => {
    setSelectedIds(new Set())
    setExpandedItemIds(new Set())
    setEditingOffsetIdx(null)
    lastSingleClickIdxRef.current = null
  }, [activeSetlistVariantId])

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

  // Close PDF layout menu when clicking outside
  useEffect(() => {
    if (!showPdfLayoutMenu) return
    const onClick = (e: MouseEvent): void => {
      if (pdfMenuRef.current && !pdfMenuRef.current.contains(e.target as Node)) {
        setShowPdfLayoutMenu(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [showPdfLayoutMenu])

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

  const handleItemClick = useCallback((index: number, e?: React.MouseEvent): void => {
    if (editingOffsetIdx === index) return
    const item = setlist[index]
    if (missingPaths.has(item.path)) {
      handleRelink(index)
      return
    }

    const isCtrl = e ? (e.ctrlKey || e.metaKey) : false
    const isShift = e ? e.shiftKey : false

    if (isCtrl) {
      // Toggle this item in selection without changing active song
      setSelectedIds(prev => {
        const next = new Set(prev)
        if (next.has(item.id)) { next.delete(item.id) } else { next.add(item.id) }
        return next
      })
      lastSingleClickIdxRef.current = index
      return
    }

    if (isShift && lastSingleClickIdxRef.current !== null) {
      // Range select from last single-click to here
      const lo = Math.min(lastSingleClickIdxRef.current, index)
      const hi = Math.max(lastSingleClickIdxRef.current, index)
      setSelectedIds(new Set(setlist.slice(lo, hi + 1).map(it => it.id)))
      return
    }

    // Normal click: update standby (existing behavior) + single-select
    lastSingleClickIdxRef.current = index
    setSelectedIds(new Set([item.id]))
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

  // Arrow toggle — expand/collapse the row's offset editor. The arrow replaces
  // the old gear (⊕) icon: clicking it opens the same offset-edit UI that the
  // gear used to open. Only one row can be expanded at a time because
  // `editingOffsetStr` is shared state (single input value).
  const handleToggleArrow = useCallback((e: React.MouseEvent, index: number, itemId: string): void => {
    e.stopPropagation()
    const item = setlist[index]
    const isOpen = expandedItemIds.has(itemId)
    if (isOpen) {
      setExpandedItemIds(new Set())
      setEditingOffsetIdx(null)
    } else {
      // Opening — replace any previously-open row.
      setExpandedItemIds(new Set([itemId]))
      setEditingOffsetIdx(index)
      setEditingOffsetStr(item.offsetFrames !== undefined ? String(item.offsetFrames) : '')
      setEditingNotesIdx(null)
      setEditingStageNoteIdx(null)
    }
  }, [setlist, expandedItemIds])

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
  const handleItemMouseDown = useCallback((_e: React.MouseEvent, index: number, isEditingOffset: boolean): void => {
    // Every fresh interaction starts from a clean state. Without this, a
    // drag gesture ended off-window (no mouseup on a setlist row) would
    // leave `suppressNextClickRef` stuck true and silently eat the NEXT
    // unrelated click on any row.
    suppressNextClickRef.current = false
    // If a previous gesture left a pending timer, clear it first.
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
    // Offset-editor open on this row: the row is already non-draggable
    // (`draggable={false}`), so arming would only show misleading visual
    // feedback — skip entirely.
    if (isEditingOffset) return
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

  const handleExportPdf = useCallback(async (layout: CueSheetLayout): Promise<void> => {
    if (setlist.length === 0) return
    const s = useStore.getState()
    // Pro gate: PDF export is Pro-only
    if (!s.isPro()) {
      onShowLicense?.()
      return
    }
    const fps = s.forceFps ?? s.detectedFps ?? 25
    // Get durations for title page
    const paths = setlist.map(item => item.path)
    let durMap: Record<string, number | null> = {}
    try {
      durMap = await window.api.getAudioDurations(paths)
    } catch { /* best-effort */ }
    const appVersion = await window.api.getAppVersion().catch(() => '')
    const html = buildCueSheetHtml({
      presetName: s.presetName || 'Untitled',
      setlist,
      markers: s.markers,
      fps,
      layout,
      durations: durMap,
      markerTypeColorOverrides: s.markerTypeColorOverrides,
      appVersion,
      generatorStartTC: s.tcGeneratorMode ? (s.generatorStartTC ?? '') : ''
    })
    const defaultName = `${s.presetName || 'cuesheet'}.pdf`
    const savedPath = await window.api.printToPdf(html, defaultName)
    if (savedPath) toast.success(t(lang, 'exportPdfSuccess'))
    setShowPdfLayoutMenu(false)
  }, [setlist, lang])

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

  /** Extract 6000-point peaks from an audio ArrayBuffer */
  const extractPeaks = useCallback(async (arrayBuffer: ArrayBuffer): Promise<{ peaks: Float32Array; duration: number } | null> => {
    try {
      const decodeCtx = new AudioContext()
      let decoded: AudioBuffer
      try {
        decoded = await decodeCtx.decodeAudioData(arrayBuffer)
      } finally {
        try { await decodeCtx.close() } catch { /* best effort */ }
      }
      const POINTS = 6000
      const total = decoded.length
      const peaks = new Float32Array(POINTS)
      // Use channel 0 (music) for alignment
      const ch = decoded.getChannelData(0)
      for (let i = 0; i < POINTS; i++) {
        const start = Math.floor((i / POINTS) * total)
        const end = Math.floor(((i + 1) / POINTS) * total)
        let max = 0
        for (let j = start; j < end; j++) {
          const a = Math.abs(ch[j]); if (a > max) max = a
        }
        peaks[i] = max
      }
      return { peaks, duration: decoded.duration }
    } catch (e) {
      console.error('Peak extraction failed', e)
      return null
    }
  }, [])

  /** Apply the audio swap with the computed offset */
  const applyAudioReplace = useCallback((index: number, newPath: string, offsetSec: number, newDuration: number, confidence: number): void => {
    const s = useStore.getState()
    const item = s.setlist[index]
    if (!item) return
    const fps = (s.forceFps ?? s.detectedFps ?? 25)

    // Get current markers for this item
    const itemId = item.id
    const currentMarkers: WaveformMarker[] = s.markers[itemId] ?? []
    const currentMidiCues: MidiCuePoint[] = item.midiCues ?? []

    // Shift markers
    let clippedCount = 0
    const shiftedMarkers: WaveformMarker[] = currentMarkers.map(m => {
      const newTime = m.time + offsetSec
      if (newTime > newDuration) { clippedCount++; return { ...m, time: Math.max(0, newDuration - 0.1) } }
      return { ...m, time: Math.max(0, newTime) }
    })

    // Shift MIDI cues: parse HH:MM:SS:FF → add offset → re-format
    const shiftedMidiCues: MidiCuePoint[] = currentMidiCues.map(cue => {
      const frames = tcToFrames(cue.triggerTimecode, fps)
      const offsetFrames = Math.round(offsetSec * fps)
      const newFrames = Math.max(0, frames + offsetFrames)
      const tc = framesToTc(newFrames, fps)
      return { ...cue, triggerTimecode: tcToString(tc) }
    })

    // Push composite undo entry + apply
    s.replaceSetlistItemAudio(
      index, newPath, item.name,
      shiftedMarkers, shiftedMidiCues,
      item.path, item.name,
      currentMarkers, currentMidiCues
    )

    // Success toast
    const pct = Math.round(confidence * 100)
    const offsetStr = offsetSec >= 0 ? `+${offsetSec.toFixed(3)}` : offsetSec.toFixed(3)
    if (currentMarkers.length > 0 || currentMidiCues.length > 0) {
      toast.success(t(lang, 'replaceAudioSuccess', {
        n: String(currentMarkers.length + currentMidiCues.length),
        offset: offsetStr,
        pct: String(pct)
      }))
    } else {
      toast.success(t(lang, 'replaceAudioNoMarkers'))
    }
    if (clippedCount > 0) {
      toast.warning(t(lang, 'replaceAudioMarkersClipped', { n: String(clippedCount) }))
    }
  }, [lang])

  /** Recompute marker/cue preview lists given a new offsetSec value */
  const computeMarkerCuePreviews = useCallback((
    index: number,
    offsetSec: number,
    newDuration: number
  ) => {
    const s = useStore.getState()
    const item = s.setlist[index]
    if (!item) return { markerPreview: [], cuePreview: [] }
    const fps = (s.forceFps ?? s.detectedFps ?? 25)
    const offsetFrames = Math.round(offsetSec * fps)
    const itemMarkers = s.markers[item.id] ?? []
    const itemCues = item.midiCues ?? []

    const markerPreview = itemMarkers.map(m => {
      const newTime = m.time + offsetSec
      const clipped = newTime > newDuration
      return {
        id: m.id,
        label: m.label || m.type || '—',
        oldTime: m.time,
        newTime: clipped ? Math.max(0, newDuration - 0.1) : Math.max(0, newTime),
        clipped
      }
    })

    const cuePreview = itemCues.map(cue => {
      const oldFrames = tcToFrames(cue.triggerTimecode, fps)
      const newFrames = Math.max(0, oldFrames + offsetFrames)
      const newTc = tcToString(framesToTc(newFrames, fps))
      return {
        id: cue.id,
        label: cue.label || cue.messageType,
        oldTc: cue.triggerTimecode,
        newTc
      }
    })

    return { markerPreview, cuePreview }
  }, [])

  const handleReplaceAudio = useCallback(async (index: number): Promise<void> => {
    const s = useStore.getState()
    const item = s.setlist[index]
    if (!item) return

    // Pick new file
    const newPath = await window.api.openFileDialog()
    if (!newPath) return

    setReplacingAudioIdx(index)
    setReplaceAligning(true)

    try {
      // Load both files
      const [origBuffer, newBuffer] = await Promise.all([
        window.api.readAudioFile(item.path),
        window.api.readAudioFile(newPath)
      ])

      if (!origBuffer || !newBuffer) {
        toast.error(t(lang, 'replaceAudioAlignError'))
        setReplaceAligning(false)
        setReplacingAudioIdx(null)
        return
      }

      // Extract peaks from both
      const [origResult, newResult] = await Promise.all([
        extractPeaks(origBuffer),
        extractPeaks(newBuffer)
      ])

      if (!origResult || !newResult) {
        // Fallback: replace with offset 0
        toast.warning(t(lang, 'replaceAudioAlignError'))
        applyAudioReplace(index, newPath, 0, 0, 0)
        setReplaceAligning(false)
        setReplacingAudioIdx(null)
        return
      }

      const result = alignAudio(origResult.peaks, newResult.peaks, origResult.duration, newResult.duration)
      const { offset: offsetSec, confidence } = result

      setReplaceAligning(false)
      setReplacingAudioIdx(null)

      // Build preview lists so user can see exactly what will change
      const { markerPreview, cuePreview } = computeMarkerCuePreviews(index, offsetSec, newResult.duration)
      const newName = newPath.split(/[/\\]/).pop() ?? newPath

      setReplacePreview({
        index,
        newPath,
        newName,
        newDuration: newResult.duration,
        oldDuration: origResult.duration,
        offsetSec,
        confidence,
        oldPeaks: origResult.peaks,
        newPeaks: newResult.peaks,
        markerPreview,
        cuePreview
      })
    } catch (e) {
      console.error('Replace audio failed', e)
      toast.error(t(lang, 'replaceAudioAlignError'))
      setReplaceAligning(false)
      setReplacingAudioIdx(null)
    }
  }, [lang, extractPeaks])

  // Keyboard handler for multi-select: Ctrl+A, Escape, Delete
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // Guard: ignore if an input/textarea/select is focused
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      const isCtrlOrMeta = e.ctrlKey || e.metaKey

      if (isCtrlOrMeta && e.key === 'a') {
        // Ctrl+A: select all items in current variant
        if (setlist.length === 0) return
        e.preventDefault()
        setSelectedIds(new Set(setlist.map(it => it.id)))
        return
      }

      if (e.key === 'Escape') {
        // Clear selection on Escape (only if we have a selection — let other handlers run otherwise)
        if (selectedIds.size > 0) {
          e.stopPropagation()
          setSelectedIds(new Set())
        }
        return
      }

      if (e.key === 'Delete' && selectedIds.size > 0) {
        e.preventDefault()
        const count = selectedIds.size
        const confirmMsg = t(useStore.getState().lang, 'deleteSelectedConfirm').replace('{n}', String(count))
        const doDelete = count === 1 || confirm(confirmMsg)
        if (!doDelete) return
        // Remove all selected items. Work from highest index downward to avoid index shift.
        const indicesToRemove = setlist
          .map((item, i) => ({ id: item.id, i }))
          .filter(({ id }) => selectedIds.has(id))
          .map(({ i }) => i)
          .sort((a, b) => b - a) // descending
        const { removeFromSetlist } = useStore.getState()
        for (const idx of indicesToRemove) {
          removeFromSetlist(idx)
        }
        setSelectedIds(new Set())
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [setlist, selectedIds])

  return (
    <div
      className="setlist-panel"
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
      onDrop={handleFileDrop}
    >
      {/* Always-visible header: title + actions */}
      <div className="setlist-panel-header">
        <span className="setlist-panel-title">
          {selectedIds.size > 0
            ? t(lang, 'nSelected').replace('{n}', String(selectedIds.size))
            : t(lang, 'setlist')}
        </span>
        {selectedIds.size > 0 && (
          <button
            className="btn-sm"
            style={{ marginLeft: 4, padding: '1px 6px', fontSize: '11px' }}
            onClick={() => setSelectedIds(new Set())}
            title={t(lang, 'clearSelection')}
          >{t(lang, 'clearSelection')}</button>
        )}
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
          <div className="setlist-sort-wrapper" ref={pdfMenuRef}>
            <button
              className="setlist-hdr-btn"
              onClick={() => {
                if (!useStore.getState().isPro()) { onShowLicense?.(); return }
                setShowPdfLayoutMenu(!showPdfLayoutMenu)
              }}
              title={t(lang, 'exportPdf') + ' (Pro)'}
              disabled={setlist.length === 0}
            >PDF</button>
            {showPdfLayoutMenu && (
              <div className="setlist-sort-menu--down">
                <button onClick={() => handleExportPdf('detailed')}>{t(lang, 'exportPdfDetailed')}</button>
                <button onClick={() => handleExportPdf('compact')}>{t(lang, 'exportPdfCompact')}</button>
              </div>
            )}
          </div>
          <button
            className="setlist-hdr-btn"
            onClick={handleImportCsv}
            title={t(lang, 'importCsv')}
          >↓</button>
        </div>
      </div>

      {/* F10: Variant tab strip */}
      <div className="variant-tab-strip" onClick={() => setVariantContextMenu(null)}>
        {setlistVariants.map(v => {
          const isActive = v.id === activeSetlistVariantId
          return (
            <button
              key={v.id}
              className={`variant-tab${isActive ? ' variant-tab--active' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                if (!isActive) switchSetlistVariant(v.id)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setVariantContextMenu({ id: v.id, x: e.clientX, y: e.clientY })
              }}
              title={v.name}
            >
              {renamingVariantId === v.id ? (
                <input
                  autoFocus
                  className="variant-tab-rename-input"
                  value={renamingVariantStr}
                  onChange={e => setRenamingVariantStr(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      renameSetlistVariant(v.id, renamingVariantStr)
                      setRenamingVariantId(null)
                    }
                    if (e.key === 'Escape') {
                      e.stopPropagation()
                      setRenamingVariantId(null)
                    }
                  }}
                  onBlur={() => {
                    renameSetlistVariant(v.id, renamingVariantStr)
                    setRenamingVariantId(null)
                  }}
                  onClick={e => e.stopPropagation()}
                  style={{ width: Math.max(50, renamingVariantStr.length * 8 + 12) }}
                />
              ) : (
                <span>{v.name}</span>
              )}
            </button>
          )
        })}
        <button
          className="variant-tab variant-tab--add"
          title={t(lang, 'variantAdd')}
          onClick={async (e) => {
            e.stopPropagation()
            const name = await window.api.showInputDialog(
              t(lang, 'variantAdd'),
              t(lang, 'variantNamePlaceholder'),
              t(lang, 'defaultVariantName')
            )
            if (name !== null) addSetlistVariant(name.trim() || t(lang, 'defaultVariantName'))
          }}
        >+</button>
      </div>

      {/* F10: variant context menu */}
      {variantContextMenu && (() => {
        const v = setlistVariants.find(vv => vv.id === variantContextMenu.id)
        if (!v) return null
        return (
          <div
            className="variant-context-menu"
            style={{ position: 'fixed', top: variantContextMenu.y, left: variantContextMenu.x, zIndex: 9999 }}
            onClick={e => e.stopPropagation()}
          >
            <button onClick={() => {
              setRenamingVariantId(v.id)
              setRenamingVariantStr(v.name)
              setVariantContextMenu(null)
            }}>{t(lang, 'variantRename')}</button>
            <button onClick={async () => {
              const name = await window.api.showInputDialog(
                t(lang, 'variantDuplicate'),
                t(lang, 'variantNamePlaceholder'),
                `${v.name} copy`
              )
              if (name !== null) duplicateSetlistVariant(v.id, name.trim() || `${v.name} copy`)
              setVariantContextMenu(null)
            }}>{t(lang, 'variantDuplicate')}</button>
            <button
              disabled={setlistVariants.length <= 1}
              title={setlistVariants.length <= 1 ? t(lang, 'variantCannotDeleteLast') : ''}
              onClick={async () => {
                if (setlistVariants.length <= 1) return
                if (await window.api.showConfirmDialog(`Delete variant "${v.name}"?`)) {
                  deleteSetlistVariant(v.id)
                }
                setVariantContextMenu(null)
              }}
              style={{ color: setlistVariants.length <= 1 ? '#444' : '#ef5350' }}
            >{t(lang, 'variantDelete')}</button>
          </div>
        )
      })()}

      {replaceAligning && (
        <div className="setlist-aligning-overlay">
          <span>{t(lang, 'aligningAudio')}</span>
        </div>
      )}

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
              const isExpanded = expandedItemIds.has(item.id)
              const isActive = i === activeSetlistIndex
              return (
                <div key={item.id} className="setlist-item-wrap">
                  <div
                    className={`setlist-item${isActive ? ' active' : ''}${i === standbySetlistIndex ? ' standby' : ''}${isMissing ? ' missing' : ''}${isEditingOffset ? ' offset-open' : ''}${isExpanded ? ' expanded' : ''}${armedIdx === i ? ' drag-armed' : ''}${selectedIds.has(item.id) ? ' setlist-item--selected' : ''}`}
                    draggable={armedIdx === i && !isEditingOffset}
                    onDragStart={(e) => handleDragStart(e, i)}
                    onDragOver={(e) => handleDragOver(e, i)}
                    onDragEnd={handleDragEnd}
                    onMouseDown={(e) => handleItemMouseDown(e, i, isEditingOffset)}
                    onMouseUp={(e) => handleItemMouseUp(e, i)}
                    onMouseLeave={handleItemMouseLeave}
                    onClick={(e) => {
                      // F6: swallow the click that trails a long-press gesture (Q2).
                      if (suppressNextClickRef.current) {
                        suppressNextClickRef.current = false
                        return
                      }
                      handleItemClick(i, e)
                    }}
                    onDoubleClick={() => handleItemDoubleClick(i)}
                    title={isMissing ? t(lang, 'fileMissing') : item.name}
                  >
                    {/* Top row: arrow + index + name (left) | badges + action buttons (right) */}
                    <div className="setlist-item-row">
                      <div className="setlist-item-row-left">
                        <Tooltip text={t(lang, 'songOffset')}>
                          <button
                            className={`setlist-expand-arrow${isExpanded ? ' open' : ''}${isActive ? ' active' : ''}`}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => handleToggleArrow(e, i, item.id)}
                            aria-expanded={isExpanded}
                            aria-label={t(lang, 'songOffset')}
                          >▶</button>
                        </Tooltip>
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
                      </div>
                      <div className="setlist-item-row-right">
                        {hasOffset && (
                          <span className="setlist-offset-badge" title={t(lang, 'songOffset')}>
                            {(item.offsetFrames ?? 0) >= 0 ? '+' : ''}{item.offsetFrames}f
                          </span>
                        )}
                        {item.notes && (
                          <span className="setlist-notes-badge" title={item.notes}>N</span>
                        )}
                        {item.stageNote && (
                          <span className="setlist-notes-badge" title={item.stageNote} style={{ background: '#e8c97a22', color: '#e8c97a' }}>S</span>
                        )}
                      </div>
                    </div>
                    {/* Bottom row: duration. ml-5 in Stitch ≈ aligned under the name (skip arrow column). */}
                    {durations[item.path] != null && (
                      <span className="setlist-duration">{formatDurShort(durations[item.path] as number)}</span>
                    )}
                  </div>
                  {isExpanded && (
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
                          if (e.key === 'Enter') { e.preventDefault(); commitOffset(i) }
                          if (e.key === 'Escape') {
                            e.stopPropagation()
                            setEditingOffsetIdx(null)
                            setExpandedItemIds(prev => {
                              const next = new Set(prev); next.delete(item.id); return next
                            })
                          }
                          if (e.key === 'ArrowUp') { e.preventDefault(); adjustOffset(1) }
                          if (e.key === 'ArrowDown') { e.preventDefault(); adjustOffset(-1) }
                        }}
                        onBlur={() => { stopHold(); commitOffset(i) }}
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
                            }}
                          >✕</button>
                        </Tooltip>
                      )}
                      <span className="setlist-expanded-divider" />
                      <Tooltip text={t(lang, 'songNotes')}>
                        <button
                          className={`setlist-action-btn${editingNotesIdx === i ? ' active' : ''}`}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (editingNotesIdx === i) {
                              setEditingNotesIdx(null)
                            } else {
                              setEditingNotesStr(item.notes ?? '')
                              setEditingNotesIdx(i)
                              setEditingOffsetIdx(null)
                              setEditingStageNoteIdx(null)
                            }
                          }}
                        >N</button>
                      </Tooltip>
                      <Tooltip text={t(lang, 'stageNote')}>
                        <button
                          className={`setlist-action-btn${editingStageNoteIdx === i ? ' active' : ''}`}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (editingStageNoteIdx === i) {
                              setEditingStageNoteIdx(null)
                            } else {
                              setEditingStageNoteStr(item.stageNote ?? '')
                              setEditingStageNoteIdx(i)
                              setEditingNotesIdx(null)
                              setEditingOffsetIdx(null)
                            }
                          }}
                          style={{ color: item.stageNote ? '#e8c97a' : undefined }}
                        >S</button>
                      </Tooltip>
                      <Tooltip text={t(lang, 'replaceAudio') + ' (Pro)'}>
                        <button
                          className="setlist-action-btn"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (!useStore.getState().isPro()) { onShowLicense?.(); return }
                            handleReplaceAudio(i)
                          }}
                          disabled={replacingAudioIdx === i && replaceAligning}
                          title={t(lang, 'replaceAudio') + ' (Pro)'}
                        >⇄</button>
                      </Tooltip>
                      <Tooltip text={t(lang, 'remove')}>
                        <button
                          className="setlist-action-btn setlist-action-btn--danger"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); removeFromSetlist(i) }}
                        >✕</button>
                      </Tooltip>
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
                  {editingStageNoteIdx === i && (
                    <div className="setlist-notes-editor" onClick={(e) => e.stopPropagation()}>
                      <input
                        ref={stageNoteInputRef}
                        type="text"
                        className="setlist-notes-input"
                        value={editingStageNoteStr}
                        placeholder={t(lang, 'stageNotePlaceholder')}
                        maxLength={200}
                        style={{ borderColor: '#e8c97a44' }}
                        onChange={(e) => setEditingStageNoteStr(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            useStore.getState().setSetlistItemStageNote(i, editingStageNoteStr)
                            setEditingStageNoteIdx(null)
                          }
                          if (e.key === 'Escape') { e.stopPropagation(); setEditingStageNoteIdx(null) }
                        }}
                        onBlur={() => {
                          useStore.getState().setSetlistItemStageNote(i, editingStageNoteStr)
                          setEditingStageNoteIdx(null)
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

      {/* Replace audio preview modal */}
      {replacePreview && (() => {
        const p = replacePreview
        const item = setlist[p.index]
        if (!item) return null
        const durDiff = p.newDuration - p.oldDuration
        const durDiffStr = durDiff >= 0 ? `+${durDiff.toFixed(2)}s` : `${durDiff.toFixed(2)}s`
        const offsetStr = p.offsetSec >= 0 ? `+${p.offsetSec.toFixed(3)}s` : `${p.offsetSec.toFixed(3)}s`
        const pct = Math.round(p.confidence * 100)
        const lowConf = p.confidence < 0.7
        const fmt = (sec: number): string => {
          const m = Math.floor(sec / 60)
          const s = Math.floor(sec % 60)
          const ms = Math.round((sec - Math.floor(sec)) * 1000)
          return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
        }
        return (
          <div className="ltc-wav-dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget) setReplacePreview(null) }}>
            <div className="ltc-wav-dialog" style={{ width: '740px', maxWidth: '96vw' }}>
              <div className="ltc-wav-dialog-header">
                <div>
                  <div className="ltc-wav-dialog-title">{t(lang, 'replaceAudioPreviewTitle')}</div>
                  <div className="ltc-wav-dialog-sub">{item.name} → {p.newName}</div>
                </div>
                <button className="ltc-wav-dialog-close" onClick={() => setReplacePreview(null)}>×</button>
              </div>

              <div style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {/* Summary */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', fontSize: '12px' }}>
                  <div style={{ background: '#1a1a1a', padding: '8px', borderRadius: '4px' }}>
                    <div style={{ color: '#888', fontSize: '10px' }}>{t(lang, 'replaceAudioOldDuration')}</div>
                    <div style={{ fontFamily: 'Consolas, monospace' }}>{fmt(p.oldDuration)}</div>
                  </div>
                  <div style={{ background: '#1a1a1a', padding: '8px', borderRadius: '4px' }}>
                    <div style={{ color: '#888', fontSize: '10px' }}>{t(lang, 'replaceAudioNewDuration')}</div>
                    <div style={{ fontFamily: 'Consolas, monospace' }}>{fmt(p.newDuration)} <span style={{ color: durDiff >= 0 ? '#4caf50' : '#ff9800', fontSize: '11px' }}>({durDiffStr})</span></div>
                  </div>
                  <div style={{ background: '#1a1a1a', padding: '8px', borderRadius: '4px' }}>
                    <div style={{ color: '#888', fontSize: '10px' }}>{t(lang, 'replaceAudioOffset')} ({pct}%)</div>
                    <div style={{ fontFamily: 'Consolas, monospace', color: lowConf ? '#ff9800' : '#4caf50' }}>{offsetStr}</div>
                  </div>
                </div>

                {lowConf && (
                  <div style={{ background: 'rgba(255, 152, 0, 0.12)', border: '1px solid #ff9800', borderRadius: '4px', padding: '8px 10px', fontSize: '11px', color: '#ffb74d' }}>
                    ⚠ {t(lang, 'replaceAudioLowConfWarn')}
                  </div>
                )}

                {/* F12: Waveform Compare */}
                <div style={{ background: '#111', borderRadius: 6, padding: '10px 12px', border: '1px solid #1e2e38' }}>
                  <div style={{ fontSize: '11px', color: '#aaa', marginBottom: 8 }}>{t(lang, 'compareWaveforms')}</div>
                  <WaveformCompare
                    oldPeaks={p.oldPeaks}
                    newPeaks={p.newPeaks}
                    oldDuration={p.oldDuration}
                    newDuration={p.newDuration}
                    offsetSec={p.offsetSec}
                    markers={useStore.getState().markers[item.id] ?? []}
                    onOffsetChange={(newOffset) => {
                      const { markerPreview, cuePreview } = computeMarkerCuePreviews(p.index, newOffset, p.newDuration)
                      setReplacePreview(prev => prev ? { ...prev, offsetSec: newOffset, markerPreview, cuePreview } : prev)
                    }}
                  />
                </div>

                {/* Marker preview */}
                {p.markerPreview.length > 0 && (
                  <div>
                    <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '4px' }}>
                      {t(lang, 'replaceAudioMarkers')} ({p.markerPreview.length})
                    </div>
                    <div style={{ maxHeight: '140px', overflowY: 'auto', background: '#0d0d0d', borderRadius: '4px', border: '1px solid #2a2a2a' }}>
                      {p.markerPreview.map(m => (
                        <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '6px', alignItems: 'center', padding: '4px 8px', fontSize: '11px', borderBottom: '1px solid #1a1a1a' }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.label}</div>
                          <div style={{ fontFamily: 'Consolas, monospace', color: '#888' }}>{fmt(m.oldTime)}</div>
                          <div style={{ color: '#666' }}>→</div>
                          <div style={{ fontFamily: 'Consolas, monospace', color: m.clipped ? '#ff9800' : '#4caf50' }}>
                            {fmt(m.newTime)}{m.clipped ? ' ⚠' : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* MIDI cue preview */}
                {p.cuePreview.length > 0 && (
                  <div>
                    <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '4px' }}>
                      {t(lang, 'replaceAudioMidiCues')} ({p.cuePreview.length})
                    </div>
                    <div style={{ maxHeight: '120px', overflowY: 'auto', background: '#0d0d0d', borderRadius: '4px', border: '1px solid #2a2a2a' }}>
                      {p.cuePreview.map(c => (
                        <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '6px', alignItems: 'center', padding: '4px 8px', fontSize: '11px', borderBottom: '1px solid #1a1a1a' }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</div>
                          <div style={{ fontFamily: 'Consolas, monospace', color: '#888' }}>{c.oldTc}</div>
                          <div style={{ color: '#666' }}>→</div>
                          <div style={{ fontFamily: 'Consolas, monospace', color: '#4caf50' }}>{c.newTc}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {p.markerPreview.length === 0 && p.cuePreview.length === 0 && (
                  <div style={{ color: '#888', fontSize: '11px', fontStyle: 'italic', padding: '8px 0' }}>
                    {t(lang, 'replaceAudioNoMarkers')}
                  </div>
                )}
              </div>

              <div style={{ padding: '12px 18px', borderTop: '1px solid #2a2a2a', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button className="ltc-wav-btn" onClick={() => setReplacePreview(null)}>
                  {t(lang, 'cancel')}
                </button>
                <button
                  className="ltc-wav-btn ltc-wav-btn--primary"
                  onClick={() => {
                    applyAudioReplace(p.index, p.newPath, p.offsetSec, p.newDuration, p.confidence)
                    setReplacePreview(null)
                  }}
                >
                  {t(lang, 'replaceAudioApply')}
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
