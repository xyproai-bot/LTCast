import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useStore, SortMode, isGeneratorItem } from '../store'
import { t } from '../i18n'
import { toast } from './Toast'
import { Tooltip } from './Tooltip'

interface Props {
  onLoadFile: (path: string, offsetFrames?: number) => void
  onImportFiles?: () => void
  onAddGenerator?: () => Promise<void>
}

export function SetlistPanel({ onLoadFile, onImportFiles }: Omit<Props, 'onAddGenerator'>): React.JSX.Element {
  const {
    setlist, activeSetlistIndex, lang,
    addToSetlist, removeFromSetlist, reorderSetlist, clearSetlist,
    sortSetlist, setActiveSetlistIndex,
    autoPlayNext, setAutoPlayNext
  } = useStore()

  const [showSortMenu, setShowSortMenu] = useState(false)
  const [missingPaths, setMissingPaths] = useState<Set<string>>(new Set())
  const [editingOffsetIdx, setEditingOffsetIdx] = useState<number | null>(null)
  const [editingOffsetStr, setEditingOffsetStr] = useState('')
  const [editingTcIdx, setEditingTcIdx] = useState<number | null>(null)
  const [editingTcStr, setEditingTcStr] = useState('')
  const offsetInputRef = useRef<HTMLInputElement>(null)
  const sortRef = useRef<HTMLDivElement>(null)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Inline Gen dialog state
  const [showGenDialog, setShowGenDialog] = useState(false)
  const [genTc, setGenTc] = useState('')
  const [genDuration, setGenDuration] = useState('3600')
  const [genGenerating, setGenGenerating] = useState(false)

  // Inline rename state
  const [editingNameIdx, setEditingNameIdx] = useState<number | null>(null)
  const [editingNameStr, setEditingNameStr] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Auto-focus offset input when it appears
  useEffect(() => {
    if (editingOffsetIdx !== null) {
      offsetInputRef.current?.focus()
      offsetInputRef.current?.select()
    }
  }, [editingOffsetIdx])

  // Auto-focus name input when rename editor appears
  useEffect(() => {
    if (editingNameIdx !== null) {
      nameInputRef.current?.focus()
      nameInputRef.current?.select()
    }
  }, [editingNameIdx])

  // Clear hold timer/interval on unmount
  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current)
      if (holdIntervalRef.current) clearInterval(holdIntervalRef.current)
    }
  }, [])

  // Check which setlist files are missing on disk (skip generator items — they have no file)
  const checkMissing = useCallback(async (items: typeof setlist): Promise<void> => {
    if (items.length === 0) { setMissingPaths(new Set()); return }
    const results = await Promise.all(
      items.map(item =>
        isGeneratorItem(item)
          ? Promise.resolve({ path: item.path, exists: true })
          : window.api.fileExists(item.path).then(exists => ({ path: item.path, exists })).catch(() => ({ path: item.path, exists: true }))
      )
    )
    const missing = new Set(results.filter(r => !r.exists).map(r => r.path))
    setMissingPaths(missing)
  }, [])

  useEffect(() => {
    if (setlist.length === 0) { setMissingPaths(new Set()); return }
    let cancelled = false
    const snapshot = setlist
    Promise.all(
      snapshot.map(item =>
        isGeneratorItem(item)
          ? Promise.resolve({ path: item.path, exists: true })
          : window.api.fileExists(item.path).then(exists => ({ path: item.path, exists })).catch(() => ({ path: item.path, exists: true }))
      )
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
    if (editingTcIdx === index) return      // Don't load while editing TC
    const item = setlist[index]
    if (isGeneratorItem(item)) {
      // Generator item — just select it; App.tsx handles activating generator mode
      setActiveSetlistIndex(index)
      onLoadFile(item.path, item.offsetFrames)
      return
    }
    if (missingPaths.has(item.path)) {
      handleRelink(index)
      return
    }
    setActiveSetlistIndex(index)
    onLoadFile(item.path, item.offsetFrames)
  }, [setlist, missingPaths, setActiveSetlistIndex, onLoadFile, handleRelink, editingOffsetIdx, editingTcIdx])

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

  const commitTc = useCallback((index: number): void => {
    const val = editingTcStr.trim()
    if (/^\d{2}:\d{2}:\d{2}:\d{2}$/.test(val)) {
      const s = useStore.getState()
      s.setSetlistItemStartTC(index, val)
      // Also update the display name to reflect the new TC
      const fps = s.generatorFps
      const newName = `TC Gen ${val} @${fps}fps`
      const newSetlist = [...s.setlist]
      newSetlist[index] = { ...newSetlist[index], name: newName, startTC: val }
      useStore.setState({ setlist: newSetlist, presetDirty: true })
    }
  }, [editingTcStr])

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

  const commitName = useCallback((index: number): void => {
    const newName = editingNameStr.trim()
    if (newName) {
      useStore.getState().setSetlistItemName(index, newName)
    }
  }, [editingNameStr])

  const handleGenerate = useCallback(async (): Promise<void> => {
    const tcVal = genTc.trim()
    if (!/^\d{2}:\d{2}:\d{2}:\d{2}$/.test(tcVal)) {
      toast.error('Invalid timecode — use HH:MM:SS:FF')
      return
    }

    let durationSec: number
    const dur = genDuration.trim()
    if (dur.includes(':')) {
      const parts = dur.split(':').map(Number)
      if (parts.length === 3) {
        durationSec = parts[0] * 3600 + parts[1] * 60 + parts[2]
      } else {
        durationSec = parts[0] * 60 + (parts[1] || 0)
      }
    } else {
      durationSec = parseInt(dur, 10)
    }

    if (!durationSec || durationSec <= 0 || durationSec > 86400) {
      toast.error('Invalid duration — enter seconds (e.g. 3600) or HH:MM:SS')
      return
    }

    setGenGenerating(true)
    try {
      const s = useStore.getState()
      const result = await window.api.generateLtcWav({
        startTC: tcVal,
        durationSec,
        fps: s.generatorFps
      })
      addToSetlist([{ path: result.path, name: result.name }])
      toast.success(`LTC WAV added: ${result.name}`)
      setShowGenDialog(false)
    } catch (err) {
      console.error('LTC WAV generation failed:', err)
      toast.error('Failed to generate LTC WAV')
    } finally {
      setGenGenerating(false)
    }
  }, [genTc, genDuration, addToSetlist])

  return (
    <div
      className="setlist-panel"
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
      onDrop={handleFileDrop}
    >
      {/* Scrollable list area — shows empty state or item list */}
      {setlist.length === 0 ? (
        <div className="setlist-empty" onClick={onImportFiles}>
          <div className="setlist-empty-icon">+</div>
          <div>{t(lang, 'dropFilesHere')}</div>
          <div className="setlist-empty-hint">{t(lang, 'clickToImport')}</div>
        </div>
      ) : (
        <div className="setlist-list">
          {setlist.map((item, i) => {
            const isGen = isGeneratorItem(item)
            const isMissing = !isGen && missingPaths.has(item.path)
            const hasOffset = item.offsetFrames !== undefined
            const isEditingOffset = editingOffsetIdx === i
            const isEditingTc = editingTcIdx === i
            const isEditingName = editingNameIdx === i
            return (
              <div key={item.id} className="setlist-item-wrap">
                <div
                  className={`setlist-item${i === activeSetlistIndex ? ' active' : ''}${isMissing ? ' missing' : ''}${isEditingOffset || isEditingTc || isEditingName ? ' offset-open' : ''}${isGen ? ' setlist-item--generator' : ''}`}
                  draggable={!isEditingOffset && !isEditingTc && !isEditingName}
                  onDragStart={(e) => handleDragStart(e, i)}
                  onDragOver={(e) => handleDragOver(e, i)}
                  onDragEnd={handleDragEnd}
                  onClick={() => handleItemClick(i)}
                  title={isGen ? `TC Generator — ${item.startTC ?? 'default TC'}` : isMissing ? t(lang, 'fileMissing') : item.name}
                >
                  <span className="setlist-index">{i + 1}</span>
                  {isGen && <span className="setlist-gen-icon">⏱</span>}
                  <span className="setlist-name">{isMissing ? '⚠ ' : ''}{item.name}</span>
                  {hasOffset && !isGen && (
                    <span className="setlist-offset-badge" title={t(lang, 'songOffset')}>
                      {(item.offsetFrames ?? 0) >= 0 ? '+' : ''}{item.offsetFrames}f
                    </span>
                  )}
                  {isGen ? (
                    <Tooltip text="Edit Start TC">
                      <button
                        className={`setlist-offset-btn${isEditingTc ? ' active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (isEditingTc) {
                            setEditingTcIdx(null)
                          } else {
                            setEditingTcIdx(i)
                            setEditingTcStr(item.startTC ?? useStore.getState().generatorStartTC)
                          }
                        }}
                      >TC</button>
                    </Tooltip>
                  ) : (
                    <Tooltip text={t(lang, 'songOffset')}>
                      <button
                        className={`setlist-offset-btn${isEditingOffset ? ' active' : ''}`}
                        onClick={(e) => handleToggleOffsetEdit(e, i)}
                      >⊕</button>
                    </Tooltip>
                  )}
                  <Tooltip text="Rename">
                    <button
                      className={`setlist-offset-btn setlist-rename-btn${isEditingName ? ' active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (isEditingName) {
                          commitName(i)
                          setEditingNameIdx(null)
                        } else {
                          setEditingNameIdx(i)
                          setEditingNameStr(item.name)
                        }
                      }}
                    >✏</button>
                  </Tooltip>
                  <Tooltip text={t(lang, 'remove')}>
                    <button
                      className="setlist-remove"
                      onClick={(e) => { e.stopPropagation(); removeFromSetlist(i) }}
                    >✕</button>
                  </Tooltip>
                </div>
                {isEditingName && (
                  <div
                    className="setlist-offset-editor setlist-rename-editor"
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        commitName(i)
                        setEditingNameIdx(null)
                      }
                    }}
                  >
                    <span style={{ fontSize: '11px', color: '#aaa', whiteSpace: 'nowrap' }}>Name:</span>
                    <input
                      ref={nameInputRef}
                      type="text"
                      className="setlist-offset-input"
                      style={{ flex: 1, minWidth: '80px' }}
                      value={editingNameStr}
                      placeholder={item.name}
                      onChange={(e) => setEditingNameStr(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          commitName(i)
                          setEditingNameIdx(null)
                        }
                        if (e.key === 'Escape') { e.stopPropagation(); setEditingNameIdx(null) }
                      }}
                    />
                    <button
                      className="offset-adj-btn"
                      style={{ fontSize: '10px', padding: '2px 6px' }}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        commitName(i)
                        setEditingNameIdx(null)
                      }}
                    >✓</button>
                  </div>
                )}
                {isEditingTc && (
                  <div
                    className="setlist-offset-editor setlist-tc-editor"
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setEditingTcIdx(null)
                      }
                    }}
                  >
                    <span style={{ fontSize: '11px', color: '#aaa', whiteSpace: 'nowrap' }}>Start TC:</span>
                    <input
                      autoFocus
                      type="text"
                      className="setlist-offset-input"
                      style={{ width: '90px', fontFamily: 'monospace', letterSpacing: '1px' }}
                      value={editingTcStr}
                      placeholder="HH:MM:SS:FF"
                      onChange={(e) => setEditingTcStr(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          commitTc(i)
                          setEditingTcIdx(null)
                        }
                        if (e.key === 'Escape') { e.stopPropagation(); setEditingTcIdx(null) }
                      }}
                    />
                    <button
                      className="offset-adj-btn"
                      style={{ fontSize: '10px', padding: '2px 6px' }}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        commitTc(i)
                        setEditingTcIdx(null)
                      }}
                    >✓</button>
                  </div>
                )}
                {isEditingOffset && (
                  <div
                    className="setlist-offset-editor"
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        commitOffset(i)
                        setEditingOffsetIdx(null)
                      }
                    }}
                  >
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
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '11px', color: '#888', whiteSpace: 'nowrap' }}>{t(lang, 'nextTrackLabel')}</span>
                      <select
                        style={{ backgroundColor: '#1a1a1a', color: '#eee', border: '1px solid #444', borderRadius: '4px', fontSize: '11px', padding: '2px', maxWidth: '120px' }}
                        title={t(lang, 'nextTrackLabel')}
                        value={item.nextTrackId || ''}
                        onChange={(e) => {
                          useStore.getState().setSetlistItemNextTrackId(i, e.target.value || undefined)
                        }}
                      >
                        <option value="">{t(lang, 'nextTrackDefault')}</option>
                        <option value="stop">{t(lang, 'nextTrackStop')}</option>
                        <option value="next">{t(lang, 'nextTrackSequential')}</option>
                        <optgroup label="━━━━━━">
                          {setlist.map(tOption => (
                            <option key={tOption.id} value={tOption.id}>
                              {tOption.name}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Action bar — always visible */}
      {/* Inline Gen dialog */}
      {showGenDialog && (
        <div className="setlist-gen-dialog">
          <div style={{ fontSize: '11px', color: '#f59e0b', fontWeight: 600, marginBottom: '6px' }}>⏱ Generate LTC WAV File</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label style={{ fontSize: '11px', color: '#aaa', width: '60px', flexShrink: 0 }}>Start TC:</label>
              <input
                type="text"
                className="setlist-offset-input"
                style={{ flex: 1, fontFamily: 'monospace', letterSpacing: '1px' }}
                value={genTc}
                placeholder="HH:MM:SS:FF"
                onChange={e => setGenTc(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') setShowGenDialog(false) }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label style={{ fontSize: '11px', color: '#aaa', width: '60px', flexShrink: 0 }}>Duration:</label>
              <input
                type="text"
                className="setlist-offset-input"
                style={{ flex: 1 }}
                value={genDuration}
                placeholder="3600 (sec) or 1:00:00"
                onChange={e => setGenDuration(e.target.value)}
                onKeyDown={async e => {
                  if (e.key === 'Enter') {
                    await handleGenerate()
                  }
                  if (e.key === 'Escape') setShowGenDialog(false)
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', marginTop: '2px' }}>
              <button
                className="offset-adj-btn"
                style={{ fontSize: '11px', padding: '3px 10px' }}
                onClick={() => setShowGenDialog(false)}
                disabled={genGenerating}
              >Cancel</button>
              <button
                className="btn-setlist-generator"
                style={{ fontSize: '11px', padding: '3px 12px', borderRadius: '4px', border: '1px solid #f59e0b', background: genGenerating ? '#3a2a00' : '#2a1a00', color: '#f59e0b', cursor: genGenerating ? 'wait' : 'pointer' }}
                onClick={handleGenerate}
                disabled={genGenerating}
              >{genGenerating ? '⏳ Generating…' : '✓ Generate'}</button>
            </div>
          </div>
        </div>
      )}

      <div className="setlist-actions">
        <button className="btn-setlist-action" onClick={onImportFiles} title={t(lang, 'addFiles')}>+</button>
        <button
          className={`btn-setlist-action${autoPlayNext ? ' active' : ''}`}
          style={autoPlayNext ? { color: '#00c853', borderColor: '#00c853' } : {}}
          onClick={() => setAutoPlayNext(!autoPlayNext)}
          title={t(lang, 'autoPlayNext')}
        >
          {t(lang, 'autoPlayNext')}
        </button>
        <Tooltip text="Generate LTC WAV and add to setlist">
          <button
            className={`btn-setlist-action btn-setlist-generator${showGenDialog ? ' active' : ''}`}
            onClick={() => {
              if (!showGenDialog) {
                // Pre-fill with current store values
                const s = useStore.getState()
                setGenTc(s.generatorStartTC)
                setGenDuration('3600')
              }
              setShowGenDialog(v => !v)
            }}
            title="Generate TC Audio"
          >⏱ Gen</button>
        </Tooltip>
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

      {/* Clear all — only when there are items */}
      {setlist.length > 0 && (
        <button
          className="btn-setlist-clear-all"
          onClick={clearSetlist}
        >
          {t(lang, 'clearAll')}
        </button>
      )}
    </div>
  )
}
