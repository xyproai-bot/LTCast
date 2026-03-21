import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useStore, SortMode } from '../store'
import { t } from '../i18n'
import { toast } from './Toast'

interface Props {
  onLoadFile: (path: string) => void
  onImportFiles?: () => void
}

export function SetlistPanel({ onLoadFile, onImportFiles }: Props): React.JSX.Element {
  const {
    setlist, activeSetlistIndex, lang,
    addToSetlist, removeFromSetlist, reorderSetlist, clearSetlist,
    sortSetlist, setActiveSetlistIndex
  } = useStore()

  const [showSortMenu, setShowSortMenu] = useState(false)
  const [missingPaths, setMissingPaths] = useState<Set<string>>(new Set())
  const sortRef = useRef<HTMLDivElement>(null)

  // Check which setlist files are missing on disk
  const checkMissing = useCallback(async (items: typeof setlist): Promise<void> => {
    if (items.length === 0) { setMissingPaths(new Set()); return }
    const missing = new Set<string>()
    for (const item of items) {
      try {
        const exists = await window.api.fileExists(item.path)
        if (!exists) missing.add(item.path)
      } catch { /* ignore */ }
    }
    setMissingPaths(missing)
  }, [])

  useEffect(() => {
    if (setlist.length === 0) { setMissingPaths(new Set()); return }
    let cancelled = false
    const snapshot = setlist
    const run = async (): Promise<void> => {
      if (snapshot.length === 0) { if (!cancelled) setMissingPaths(new Set()); return }
      const missing = new Set<string>()
      for (const item of snapshot) {
        if (cancelled) return
        try {
          const exists = await window.api.fileExists(item.path)
          if (!exists) missing.add(item.path)
        } catch { /* ignore */ }
      }
      if (!cancelled) setMissingPaths(missing)
    }
    run().catch(() => {})
    return () => { cancelled = true }
  }, [setlist])

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

  const handleRelinkRef = useRef(handleRelink)
  handleRelinkRef.current = handleRelink

  const handleItemClick = useCallback((index: number): void => {
    const item = setlist[index]
    if (missingPaths.has(item.path)) {
      // File is missing — offer to relink
      handleRelinkRef.current(index)
      return
    }
    setActiveSetlistIndex(index)
    onLoadFile(item.path)
  }, [setlist, missingPaths, setActiveSetlistIndex, onLoadFile])

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
  }, [reorderSetlist])

  const handleSort = useCallback((mode: SortMode): void => {
    sortSetlist(mode)
    setShowSortMenu(false)
  }, [sortSetlist])

  return (
    <div
      className="setlist-panel"
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
      onDrop={handleFileDrop}
    >
      {setlist.length === 0 ? (
        <div className="setlist-empty" onClick={onImportFiles}>
          <div className="setlist-empty-icon">+</div>
          <div>{t(lang, 'dropFilesHere')}</div>
          <div className="setlist-empty-hint">{t(lang, 'clickToImport')}</div>
        </div>
      ) : (
        <>
          <div className="setlist-list">
            {setlist.map((item, i) => {
              const isMissing = missingPaths.has(item.path)
              return (
                <div
                  key={item.id}
                  className={`setlist-item${i === activeSetlistIndex ? ' active' : ''}${isMissing ? ' missing' : ''}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, i)}
                  onDragOver={(e) => handleDragOver(e, i)}
                  onDragEnd={handleDragEnd}
                  onClick={() => handleItemClick(i)}
                  title={isMissing ? t(lang, 'fileMissing') : item.name}
                >
                  <span className="setlist-index">{i + 1}</span>
                  <span className="setlist-name">{isMissing ? '⚠ ' : ''}{item.name}</span>
                  <button
                    className="setlist-remove"
                    onClick={(e) => { e.stopPropagation(); removeFromSetlist(i) }}
                    title={t(lang, 'remove')}
                  >✕</button>
                </div>
              )
            })}
          </div>

          {/* Top action bar: add + sort */}
          <div className="setlist-actions">
            <button className="btn-setlist-action" onClick={onImportFiles} title={t(lang, 'addFiles')}>+</button>
            <div className="setlist-sort-wrapper" ref={sortRef}>
              <button
                className="btn-setlist-action"
                onClick={() => setShowSortMenu(!showSortMenu)}
                title={t(lang, 'sortAZ')}
              >
                {t(lang, 'sort')}
              </button>
              {showSortMenu && (
                <div className="setlist-sort-menu">
                  <button onClick={() => handleSort('az')}>{t(lang, 'sortAZ')}</button>
                  <button onClick={() => handleSort('za')}>{t(lang, 'sortZA')}</button>
                  <button onClick={() => handleSort('ext')}>{t(lang, 'sortExt')}</button>
                  <button onClick={() => handleSort('reverse')}>{t(lang, 'sortReverse')}</button>
                </div>
              )}
            </div>
          </div>

          {/* Clear all at very bottom, red, with confirmation */}
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
