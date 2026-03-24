import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useStore, SortMode } from '../store'
import { t } from '../i18n'
import { toast } from './Toast'
import { Tooltip } from './Tooltip'

interface Props {
  onLoadFile: (path: string, offsetFrames?: number) => void
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
  const [editingOffsetIdx, setEditingOffsetIdx] = useState<number | null>(null)
  const [editingOffsetStr, setEditingOffsetStr] = useState('')
  const offsetInputRef = useRef<HTMLInputElement>(null)
  const sortRef = useRef<HTMLDivElement>(null)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Auto-focus offset input when it appears
  useEffect(() => {
    if (editingOffsetIdx !== null) {
      offsetInputRef.current?.focus()
      offsetInputRef.current?.select()
    }
  }, [editingOffsetIdx])

  // Clear hold timer/interval on unmount
  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current)
      if (holdIntervalRef.current) clearInterval(holdIntervalRef.current)
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

  const handleItemClick = useCallback((index: number): void => {
    if (editingOffsetIdx === index) return  // Don't load while editing offset
    const item = setlist[index]
    if (missingPaths.has(item.path)) {
      handleRelink(index)
      return
    }
    setActiveSetlistIndex(index)
    onLoadFile(item.path, item.offsetFrames)
  }, [setlist, missingPaths, setActiveSetlistIndex, onLoadFile, handleRelink, editingOffsetIdx])

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
              const hasOffset = item.offsetFrames !== undefined
              const isEditingOffset = editingOffsetIdx === i
              return (
                <div key={item.id} className="setlist-item-wrap">
                  <div
                    className={`setlist-item${i === activeSetlistIndex ? ' active' : ''}${isMissing ? ' missing' : ''}${isEditingOffset ? ' offset-open' : ''}`}
                    draggable={!isEditingOffset}
                    onDragStart={(e) => handleDragStart(e, i)}
                    onDragOver={(e) => handleDragOver(e, i)}
                    onDragEnd={handleDragEnd}
                    onClick={() => handleItemClick(i)}
                    title={isMissing ? t(lang, 'fileMissing') : item.name}
                  >
                    <span className="setlist-index">{i + 1}</span>
                    <span className="setlist-name">{isMissing ? '⚠ ' : ''}{item.name}</span>
                    {hasOffset && (
                      <span className="setlist-offset-badge" title={t(lang, 'songOffset')}>
                        {(item.offsetFrames ?? 0) >= 0 ? '+' : ''}{item.offsetFrames}f
                      </span>
                    )}
                    <Tooltip text={t(lang, 'songOffset')}>
                      <button
                        className={`setlist-offset-btn${isEditingOffset ? ' active' : ''}`}
                        onClick={(e) => handleToggleOffsetEdit(e, i)}
                      >⊕</button>
                    </Tooltip>
                    <Tooltip text={t(lang, 'remove')}>
                      <button
                        className="setlist-remove"
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
