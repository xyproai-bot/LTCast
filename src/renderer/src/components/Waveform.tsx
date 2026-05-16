import React, { useRef, useEffect, useCallback, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js'
import MinimapPlugin from 'wavesurfer.js/dist/plugins/minimap.esm.js'
import { useStore, WaveformMarker, MARKER_TYPE_COLORS, MARKER_TYPES, MarkerType, getContrastLetterColor } from '../store'
import { MARKER_TYPE_ABBREV, resolveMarkerTypeColor } from './StructurePanel'
import { t } from '../i18n'

interface Props {
  musicData: Float32Array | null
  ltcData:   Float32Array | null
  onSeek:    (time: number) => void
  onVideoOffsetChange?: (offset: number) => void
  onClearVideo?: () => void
  onResyncVideo?: () => void
}

export function Waveform({ musicData, ltcData, onSeek, onVideoOffsetChange, onClearVideo, onResyncVideo }: Props): React.JSX.Element {
  const musicContainerRef  = useRef<HTMLDivElement>(null)
  const musicWrapRef       = useRef<HTMLDivElement>(null)
  const markerCanvasRef    = useRef<HTMLCanvasElement>(null)   // marker overlay on music waveform
  const ltcWrapRef         = useRef<HTMLDivElement>(null)
  const ltcBgCanvasRef     = useRef<HTMLCanvasElement>(null)   // static waveform
  const ltcCursorCanvasRef = useRef<HTMLCanvasElement>(null)   // cursor + loop (redrawn every frame)
  const videoWrapRef       = useRef<HTMLDivElement>(null)
  const videoBgCanvasRef   = useRef<HTMLCanvasElement>(null)   // static waveform
  const videoCursorCanvasRef = useRef<HTMLCanvasElement>(null) // cursor (redrawn every frame)
  const wsRef              = useRef<WaveSurfer | null>(null)
  const zoomRef            = useRef(1)
  const drawMarkersRef     = useRef(() => {})  // updated after drawMarkers is defined
  // Stable ref so the wavesurfer event handler always sees the latest callback
  const onSeekRef = useRef(onSeek)
  onSeekRef.current = onSeek

  const {
    currentTime, duration, lang, filePath,
    videoWaveform, videoDuration, videoOffsetSeconds,
    videoStartTimecode, videoFileName, videoLoading,
    loopA, loopB,
    markers, addMarker, removeMarker, updateMarker,
    markerTypeColorOverrides
  } = useStore()

  // Stable refs for canvas drawing
  const currentTimeRef = useRef(currentTime)
  const durationRef    = useRef(duration)
  const ltcDataRef     = useRef(ltcData)
  const videoDataRef   = useRef(videoWaveform)
  const videoOffsetRef = useRef(videoOffsetSeconds)
  const videoDurRef    = useRef(videoDuration)
  useEffect(() => { currentTimeRef.current = currentTime }, [currentTime])
  useEffect(() => { durationRef.current    = duration    }, [duration])
  useEffect(() => { ltcDataRef.current     = ltcData     }, [ltcData])
  useEffect(() => { videoDataRef.current   = videoWaveform }, [videoWaveform])
  useEffect(() => { videoOffsetRef.current = videoOffsetSeconds }, [videoOffsetSeconds])
  useEffect(() => { videoDurRef.current    = videoDuration }, [videoDuration])
  const loopARef = useRef(loopA)
  const loopBRef = useRef(loopB)
  useEffect(() => { loopARef.current = loopA }, [loopA])
  useEffect(() => { loopBRef.current = loopB }, [loopB])

  // Stable refs for marker drawing
  const markersRef = useRef(markers)
  const filePathRef = useRef(filePath)
  useEffect(() => { markersRef.current = markers }, [markers])
  useEffect(() => { filePathRef.current = filePath }, [filePath])

  // Inline marker label edit (double-click on existing marker)
  const [editingMarker, setEditingMarker] = useState<{
    id: string
    initialLabel: string
    x: number
  } | null>(null)
  const [editingLabelValue, setEditingLabelValue] = useState('')
  const editingInputRef = useRef<HTMLInputElement | null>(null)

  // Selected marker (click to select, Delete key to remove, Esc / click empty to deselect)
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null)
  const selectedMarkerIdRef = useRef<string | null>(null)
  useEffect(() => { selectedMarkerIdRef.current = selectedMarkerId }, [selectedMarkerId])

  // Measured label widths per marker (filled by drawMarkers via measureText).
  // Used by findNearestMarker for precise hit-testing — clicking inside the
  // marker's visible label/badge area counts as a hit, but clicking past the
  // end of the label (empty waveform) does NOT, so double-click between
  // markers can still add a new marker.
  const markerHitWidthsRef = useRef<Record<string, number>>({})

  // ═══════════════════════════════════════════════════════════════════════════
  //  Music waveform — WaveSurfer.js
  // ═══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (!musicContainerRef.current) return

    const ws = WaveSurfer.create({
      container: musicContainerRef.current,
      waveColor:    '#4fc3f7',
      progressColor:'#0097c4',
      cursorColor:  '#00d4ff',
      cursorWidth:  2,
      height:       64,
      barWidth:     2,
      barGap:       1,
      barRadius:    1,
      normalize:    true,
      interact:     true,
      fillParent:   true,
      minPxPerSec:  1,
      autoScroll:   true,
      autoCenter:   true,
      hideScrollbar: false,
      plugins: [
        TimelinePlugin.create({
          timeInterval:         10,
          primaryLabelInterval: 30,
          style: { color: '#555', fontSize: '10px' },
        }),
        MinimapPlugin.create({
          height:        20,
          waveColor:     '#2a4a5a',
          progressColor: '#006080',
          cursorColor:   '#00d4ff',
          cursorWidth:   1,
        }),
      ],
    })

    ws.on('interaction', (time: number) => onSeekRef.current(time))
    ws.on('zoom', (px: number) => {
      zoomRef.current = px
      drawMarkersRef.current()
      // Persist zoom level per-file
      const fp = useStore.getState().filePath
      if (fp) useStore.getState().setWaveformZoom(fp, px)
    })
    ws.on('scroll', () => { drawMarkersRef.current() })

    // Listen to native scroll on WaveSurfer's scroll container
    // getWrapper() returns the inner .wrapper, but scrolling happens on its parent .scroll
    const wrapper = (ws as unknown as { getWrapper(): HTMLElement }).getWrapper?.()
    const scrollContainer = wrapper?.parentElement
    const onScroll = (): void => { drawMarkersRef.current() }
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', onScroll)
    }

    wsRef.current = ws

    // Cleanup: store scroll listener ref for removal
    const origDestroy = ws.destroy.bind(ws)
    ws.destroy = () => {
      if (scrollContainer) scrollContainer.removeEventListener('scroll', onScroll)
      origDestroy()
    }

    // Dynamic height: resize WaveSurfer when its container changes size
    const el = musicContainerRef.current
    if (el) {
      const obs = new ResizeObserver((entries) => {
        const h = entries[0].contentRect.height
        // Subtract minimap (20px) + timeline (~16px) + small buffer
        const waveH = Math.max(20, Math.round(h - 40))
        ws.setOptions({ height: waveH })
      })
      obs.observe(el)
      // Cleanup in the same effect
      const origDestroy = ws.destroy.bind(ws)
      ws.destroy = () => { obs.disconnect(); origDestroy() }
    }

    return () => { ws.destroy(); wsRef.current = null }
  }, [])

  useEffect(() => {
    const ws = wsRef.current
    if (!ws || !musicData || !duration) return
    const pos = Array.from(musicData)
    const neg = pos.map(v => -v)
    ws.load('', [pos, neg], duration)
    // Restore saved zoom level or capture initial pxPerSec
    requestAnimationFrame(() => {
      const fp = useStore.getState().filePath
      const savedZoom = fp ? useStore.getState().waveformZoom[fp] : undefined
      if (savedZoom && savedZoom > 1) {
        ws.zoom(savedZoom)
        zoomRef.current = savedZoom
      } else {
        const container = musicContainerRef.current
        if (container && duration > 0) {
          zoomRef.current = container.clientWidth / duration
        }
      }
    })
  }, [musicData, duration])

  useEffect(() => {
    const ws = wsRef.current
    if (!ws || duration <= 0) return
    ws.setTime(currentTime)
  }, [currentTime, duration])

  // Ctrl+scroll zoom — on musicWrapRef (parent) so it works even when marker canvas is on top
  useEffect(() => {
    const el = musicWrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const ws = wsRef.current
      if (!ws) return
      const norm = e.deltaMode === 0 ? e.deltaY / 100
                 : e.deltaMode === 1 ? e.deltaY / 3
                 : e.deltaY
      const next = zoomRef.current * Math.pow(1.3, -norm)
      ws.zoom(Math.max(1, Math.min(5000, next)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ═══════════════════════════════════════════════════════════════════════════
  //  Music waveform marker overlay canvas
  // ═══════════════════════════════════════════════════════════════════════════

  /** Draw markers on the music waveform overlay canvas */
  const drawMarkers = useCallback((): void => {
    const canvas = markerCanvasRef.current
    if (!canvas) return
    const ws = wsRef.current
    if (!ws) return

    const dpr = window.devicePixelRatio || 1
    const cssW = canvas.clientWidth
    const cssH = canvas.clientHeight
    if (!cssW || !cssH) return
    canvas.width = cssW * dpr
    canvas.height = cssH * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)

    ctx.clearRect(0, 0, cssW, cssH)

    const fp = filePathRef.current
    const dur = durationRef.current
    if (!fp || dur <= 0) return

    // Read scroll state from WaveSurfer's scrollContainer (parent of wrapper)
    const wrapper = (ws as unknown as { getWrapper(): HTMLElement }).getWrapper?.()
    const scrollContainer = wrapper?.parentElement
    const totalWidth = scrollContainer ? scrollContainer.scrollWidth : cssW
    const scrollLeft = scrollContainer ? scrollContainer.scrollLeft : 0
    const pxPerSec = totalWidth / dur

    // Draw right-drag loop preview region (F2, AC-2.1)
    const rd = rightDragRef.current
    if (rd && rd.isDragging) {
      const rdStartX = rd.startTime * pxPerSec - scrollLeft
      const rdEndX   = rd.currentTime * pxPerSec - scrollLeft
      const previewStart = Math.min(rdStartX, rdEndX)
      const previewEnd   = Math.max(rdStartX, rdEndX)
      ctx.fillStyle = 'rgba(255, 165, 0, 0.18)'
      ctx.fillRect(previewStart, 0, previewEnd - previewStart, cssH)
      ctx.strokeStyle = 'rgba(255, 165, 0, 0.8)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([3, 3])
      ctx.beginPath(); ctx.moveTo(rdStartX, 0); ctx.lineTo(rdStartX, cssH); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(rdEndX, 0); ctx.lineTo(rdEndX, cssH); ctx.stroke()
      ctx.setLineDash([])

      // Floating label (AC-2.7) — show if showLoopDragLabel is true
      if (useStore.getState().showLoopDragLabel) {
        const durationSec = Math.abs(rd.currentTime - rd.startTime)
        const bpm = useStore.getState().tappedBpm ?? useStore.getState().detectedBpm
        let labelText = `${durationSec.toFixed(2)}s`
        if (bpm && bpm > 0) {
          const beats = (durationSec / 60) * bpm
          labelText += ` (${beats.toFixed(1)} beats)`
        }
        const midX = (previewStart + previewEnd) / 2
        const midY = cssH / 2
        ctx.font = 'bold 11px sans-serif'
        const tw = ctx.measureText(labelText).width
        ctx.fillStyle = 'rgba(0,0,0,0.6)'
        ctx.fillRect(midX - tw / 2 - 4, midY - 12, tw + 8, 16)
        ctx.fillStyle = '#ffcc44'
        ctx.fillText(labelText, midX - tw / 2, midY)
      }
    }

    // Draw A-B loop region (scroll-aware)
    const la = loopARef.current, lb = loopBRef.current
    if (la !== null && lb !== null) {
      const aX = la * pxPerSec - scrollLeft
      const bX = lb * pxPerSec - scrollLeft
      const startX = Math.min(aX, bX)
      const endX   = Math.max(aX, bX)
      // Fill
      ctx.fillStyle = 'rgba(0, 212, 255, 0.08)'
      ctx.fillRect(startX, 0, endX - startX, cssH)
      // Dashed border lines
      ctx.strokeStyle = '#00d4ff'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      if (aX > -10 && aX < cssW + 10) {
        ctx.beginPath(); ctx.moveTo(aX, 0); ctx.lineTo(aX, cssH); ctx.stroke()
      }
      if (bX > -10 && bX < cssW + 10) {
        ctx.beginPath(); ctx.moveTo(bX, 0); ctx.lineTo(bX, cssH); ctx.stroke()
      }
      ctx.setLineDash([])
      // A / B labels
      ctx.font = 'bold 10px sans-serif'
      ctx.fillStyle = '#00d4ff'
      if (aX > -10 && aX < cssW + 10) ctx.fillText('A', aX + 3, 11)
      if (bX > -10 && bX < cssW + 10) ctx.fillText('B', bX + 3, 11)
    }

    // Draw file markers. v8 storage: markers keyed by setlist-item id, so
    // we resolve the current filePath → item id; if not in setlist, no markers.
    const itemId = useStore.getState().setlist.find(it => it.path === fp)?.id
    const fileMarkers = itemId ? (markersRef.current[itemId] ?? []) : []
    for (const marker of fileMarkers) {
      const absX = marker.time * pxPerSec
      const x = absX - scrollLeft
      if (x < -10 || x > cssW + 10) continue

      const mType = marker.type ?? 'custom'
      const color = marker.color ?? resolveMarkerTypeColor(mType, markerTypeColorOverrides)
      const isSongTitle = mType === 'song-title'
      const isSelected = marker.id === selectedMarkerIdRef.current

      // Selected marker: translucent vertical halo so it's obvious which one
      // Delete will affect. Drawn first so the line + badge sit on top.
      if (isSelected) {
        ctx.fillStyle = color + '33'   // ~20% alpha (8-digit hex)
        ctx.fillRect(x - 8, 0, 16, cssH)
      }

      // Vertical line (thicker for song-title; brighter outline when selected)
      ctx.beginPath()
      ctx.strokeStyle = color
      ctx.lineWidth = isSongTitle ? 4 : 3
      ctx.moveTo(x, 0)
      ctx.lineTo(x, cssH)
      ctx.stroke()

      // Triangle at top (bigger for song-title)
      const triSize = isSongTitle ? 8 : 6
      ctx.beginPath()
      ctx.fillStyle = color
      ctx.moveTo(x - triSize, 0)
      ctx.lineTo(x + triSize, 0)
      ctx.lineTo(x, triSize + 3)
      ctx.closePath()
      ctx.fill()

      // Type abbreviation badge — colored box with single letter, contrasting text
      const abbrev = MARKER_TYPE_ABBREV[mType] ?? '·'
      const badgeSize = isSongTitle ? 16 : 14
      const badgeX = Math.min(x + 4, cssW - 40)
      const badgeY = isSongTitle ? 18 : 16
      // Draw badge background
      ctx.fillStyle = color
      ctx.fillRect(badgeX, badgeY - badgeSize + 2, badgeSize, badgeSize)
      // Draw abbreviation letter — pick black or white based on background luminance
      ctx.font = `bold ${badgeSize - 3}px sans-serif`
      ctx.fillStyle = getContrastLetterColor(color)
      ctx.fillText(abbrev, badgeX + 3, badgeY - 1)

      // Label — white text with black outline so it stays readable on any marker color
      let labelTextWidth = 0
      if (marker.label) {
        ctx.font = isSongTitle ? 'bold 16px sans-serif' : '14px sans-serif'
        labelTextWidth = ctx.measureText(marker.label).width
        const labelX = Math.min(x + 4 + badgeSize + 4, cssW - 100)
        const labelY = isSongTitle ? 32 : 30
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)'
        ctx.lineWidth = 3
        ctx.lineJoin = 'round'
        ctx.strokeText(marker.label, labelX, labelY)
        ctx.fillStyle = '#fff'
        ctx.fillText(marker.label, labelX, labelY)
      }
      // Cache the visible extent right of the marker line for hit-testing.
      // Equals: gap + badge + gap + label width (or just badge if no label).
      markerHitWidthsRef.current[marker.id] = 4 + badgeSize + (labelTextWidth > 0 ? 4 + labelTextWidth + 2 : 4)
    }
  }, [])

  // Keep drawMarkersRef in sync so WaveSurfer event handlers can call it
  drawMarkersRef.current = drawMarkers

  // Redraw markers whenever markers, filePath, duration, currentTime, loop points, or selected marker change
  useEffect(() => { drawMarkers() }, [markers, filePath, duration, currentTime, loopA, loopB, selectedMarkerId, drawMarkers])

  // ResizeObserver for music waveform wrap
  useEffect(() => {
    const el = musicWrapRef.current
    if (!el) return
    const obs = new ResizeObserver(() => { drawMarkers() })
    obs.observe(el)
    return () => obs.disconnect()
  }, [drawMarkers])

  // ── Marker interaction helpers ─────────────────────────────
  // Compute time from mouse position relative to the waveform wrap container
  /** Get WaveSurfer's actual scroll metrics from its DOM */
  const getWsMetrics = (): { totalWidth: number; scrollLeft: number; pxPerSec: number } | null => {
    const ws = wsRef.current
    const dur = durationRef.current
    if (!ws || dur <= 0) return null
    // getWrapper() = inner .wrapper, scrolling is on parent .scroll (scrollContainer)
    const wrapper = (ws as unknown as { getWrapper(): HTMLElement }).getWrapper?.()
    const scrollContainer = wrapper?.parentElement
    if (!wrapper || !scrollContainer) return null
    const totalWidth = scrollContainer.scrollWidth
    const scrollLeft = scrollContainer.scrollLeft
    return { totalWidth, scrollLeft, pxPerSec: totalWidth / dur }
  }

  const getTimeFromMouseEvent = (e: React.MouseEvent): number | null => {
    const m = getWsMetrics()
    const wrap = musicWrapRef.current
    if (!m || !wrap) return null
    const rect = wrap.getBoundingClientRect()
    const clickX = e.clientX - rect.left + m.scrollLeft
    return Math.max(0, Math.min(durationRef.current, clickX / m.pxPerSec))
  }

  const findNearestMarker = (e: React.MouseEvent): WaveformMarker | null => {
    const fp = filePathRef.current
    const m = getWsMetrics()
    const wrap = musicWrapRef.current
    if (!fp || !m || !wrap) return null
    // v8 storage: markers keyed by setlist-item id (same key drawMarkers uses)
    const itemId = useStore.getState().setlist.find(it => it.path === fp)?.id
    if (!itemId) return null
    const rect = wrap.getBoundingClientRect()
    const fileMarkers = markersRef.current[itemId] ?? []
    const clickX = e.clientX - rect.left
    const clickY = e.clientY - rect.top
    // Top region covers triangle (~10px) + badge (~18px) + label baseline (~30px)
    // → use 36px so the full label height is hittable but the audio bars below aren't.
    const inTopRegion = clickY <= 36
    let closest: WaveformMarker | null = null
    let bestScore = Infinity
    for (const mk of fileMarkers) {
      const mx = mk.time * m.pxPerSec - m.scrollLeft
      const dx = clickX - mx
      const rightExtent = markerHitWidthsRef.current[mk.id] ?? 22   // fallback ~ badge width
      const hit = inTopRegion
        ? (dx >= -8 && dx <= rightExtent)
        : Math.abs(dx) <= 10
      if (hit && Math.abs(dx) < bestScore) {
        bestScore = Math.abs(dx)
        closest = mk
      }
    }
    return closest
  }

  // Double-click on waveform area:
  //   - on existing marker → open inline label editor
  //   - on empty area      → add new marker at click time
  const handleMarkerDblClick = useCallback((e: React.MouseEvent): void => {
    const fp = filePathRef.current
    if (fp === null) return

    const closest = findNearestMarker(e)
    if (closest) {
      const metrics = getWsMetrics()
      const wrap = musicWrapRef.current
      if (!metrics || !wrap) return
      const x = closest.time * metrics.pxPerSec - metrics.scrollLeft
      setEditingMarker({ id: closest.id, initialLabel: closest.label, x })
      setEditingLabelValue(closest.label)
      setTimeout(() => editingInputRef.current?.focus(), 0)
      return
    }

    const time = getTimeFromMouseEvent(e)
    if (time === null) return
    const mm = Math.floor(time / 60)
    const ss = Math.floor(time % 60)
    useStore.getState().addMarker(fp, {
      id: `marker-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      time,
      label: `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`,
      type: 'custom' as const
    })
    markersRef.current = useStore.getState().markers
    drawMarkers()
  }, [drawMarkers])

  const commitMarkerEdit = useCallback((): void => {
    if (!editingMarker) return
    const fp = filePathRef.current
    if (!fp) { setEditingMarker(null); return }
    const trimmed = editingLabelValue.trim()
    const state = useStore.getState()
    if (trimmed === '') {
      state.removeMarker(fp, editingMarker.id)
    } else if (trimmed !== editingMarker.initialLabel) {
      state.updateMarker(fp, editingMarker.id, { label: trimmed })
    }
    markersRef.current = useStore.getState().markers
    drawMarkers()
    setEditingMarker(null)
    setEditingLabelValue('')
  }, [editingMarker, editingLabelValue, drawMarkers])

  const cancelMarkerEdit = useCallback((): void => {
    setEditingMarker(null)
    setEditingLabelValue('')
  }, [])

  // Right-click → rename / delete nearest marker (only when NOT a right-drag)
  const handleMarkerContextMenu = useCallback((e: React.MouseEvent): void => {
    // If the right-click was part of a drag gesture (isDragging=true) we suppress
    // the context menu entirely (AC-2.4). The onMouseUp handler already committed
    // the loop; rightDragRef is null by the time contextmenu fires.
    // We detect by checking if the gesture moved > 5px (isDragging flag).
    // rightDragRef will be null at this point (cleared in onMouseUp), so we check
    // if any drag was committed by a small heuristic: if rightDragRef was non-null
    // and isDragging was true, we set a flag via the preventContextMenuRef.
    if (preventContextMenuRef.current) {
      preventContextMenuRef.current = false
      e.preventDefault()
      return
    }
    const fp = filePathRef.current
    if (!fp) return
    const closest = findNearestMarker(e)
    if (!closest) return
    e.preventDefault() // only prevent default if we found a marker
    const lang_ = useStore.getState().lang
    window.api.showInputDialog(
      t(lang_, 'renameMarker'),
      t(lang_, 'markerLabel'),
      closest.label
    ).then((newLabel: string | null) => {
      if (newLabel === null) return
      setTimeout(() => {
        const state = useStore.getState()
        if (newLabel.trim() === '') {
          state.removeMarker(fp, closest.id)
        } else {
          state.updateMarker(fp, closest.id, { label: newLabel.trim() })
        }
        markersRef.current = useStore.getState().markers
        drawMarkers()
      }, 0)
    }).catch(() => {})
  }, [drawMarkers])

  // ── Marker click + drag ──────────────────────────────────
  const dragRef = useRef<{
    id: string
    filePath: string
    startX: number          // mousedown screen X (to distinguish click vs drag)
    originalTime: number    // marker time before drag started (for undo)
    currentTime: number     // live time during drag (only written to store on mouseup)
    isDragging: boolean     // true once mouse moved > 5px from startX
  } | null>(null)

  // Set to true when a right-drag committed, so the subsequent contextmenu
  // event is suppressed (AC-2.4). Cleared after first use.
  const preventContextMenuRef = useRef(false)

  // Mousedown capture on parent div — if near a marker, prepare for potential drag (left button only)
  const handleWrapMouseDown = useCallback((e: React.MouseEvent): void => {
    if (e.button !== 0) return  // only arm marker drag for left button (AC-2.6)
    const closest = findNearestMarker(e)
    const fp = filePathRef.current
    if (closest && fp) {
      dragRef.current = {
        id: closest.id,
        filePath: fp,
        startX: e.clientX,
        originalTime: closest.time,
        currentTime: closest.time,
        isDragging: false
      }
      // Don't stopPropagation yet — only block WaveSurfer if it becomes a real drag
    } else {
      // Click on empty area → clear selection so Delete won't fire on stale id
      if (selectedMarkerIdRef.current !== null) setSelectedMarkerId(null)
    }
  }, [])

  // Global mousemove/mouseup for drag
  useEffect(() => {
    const DRAG_THRESHOLD = 5 // pixels before considered a drag

    const onMouseMove = (e: MouseEvent): void => {
      if (!dragRef.current) return
      const dx = Math.abs(e.clientX - dragRef.current.startX)

      if (!dragRef.current.isDragging) {
        if (dx < DRAG_THRESHOLD) return // not a drag yet
        dragRef.current.isDragging = true
      }

      // Calculate new time from mouse position (visual only — don't write store)
      const m = getWsMetrics()
      const wrap = musicWrapRef.current
      if (!m || !wrap) return
      const rect = wrap.getBoundingClientRect()
      const clickX = e.clientX - rect.left + m.scrollLeft
      const time = Math.max(0, Math.min(durationRef.current, clickX / m.pxPerSec))
      dragRef.current.currentTime = time

      // Update canvas visually by temporarily modifying the ref (not the store)
      // v8 storage: markers keyed by setlist-item id, not file path
      const fp = dragRef.current.filePath
      const id = dragRef.current.id
      const itemId = useStore.getState().setlist.find(it => it.path === fp)?.id
      if (!itemId) return
      const fileMarkers = markersRef.current[itemId] ?? []
      markersRef.current = {
        ...markersRef.current,
        [itemId]: fileMarkers.map(mk => mk.id === id ? { ...mk, time } : mk)
      }
      drawMarkers()
    }

    const onMouseUp = (): void => {
      if (!dragRef.current) return
      const { id, filePath: fp, originalTime, currentTime: newTime, isDragging } = dragRef.current
      dragRef.current = null

      if (isDragging && Math.abs(newTime - originalTime) > 0.01) {
        // Commit drag: write final position to store (single undo-able operation)
        useStore.getState().updateMarker(fp, id, { time: newTime })
        markersRef.current = useStore.getState().markers
        drawMarkers()
      } else {
        // Was a click, not a drag — toggle selection (click same marker again to deselect)
        setSelectedMarkerId(prev => prev === id ? null : id)
        markersRef.current = useStore.getState().markers
        drawMarkers()
      }
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [drawMarkers])

  // Delete / Backspace removes the currently selected marker.
  // Esc deselects without deleting.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // Don't intercept while typing in an input / textarea / select
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const id = selectedMarkerIdRef.current
      if (!id) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        const fp = filePathRef.current
        if (!fp) return
        useStore.getState().removeMarker(fp, id)
        setSelectedMarkerId(null)
        markersRef.current = useStore.getState().markers
        drawMarkers()
      } else if (e.key === 'Escape') {
        setSelectedMarkerId(null)
        drawMarkers()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [drawMarkers])


  // ── Right-click drag to set Loop A/B (F2) ──────────────────────────────
  // Tracks state for a right-click drag gesture. During drag a translucent
  // preview is drawn on the marker canvas; on mouseup we commit setLoopA/B.
  const rightDragRef = useRef<{
    startX: number         // mousedown screen X
    startTime: number      // time at mousedown
    currentTime: number    // time at current mouse position
    isDragging: boolean    // true once moved > 5px
  } | null>(null)

  // Handle right-mousedown on the music waveform wrap
  const handleWrapRightMouseDown = useCallback((e: React.MouseEvent): void => {
    if (e.button !== 2) return
    const time = getTimeFromMouseEvent(e)
    if (time === null) return
    // Prevent WaveSurfer from seeking on right-click (AC-2.4)
    e.stopPropagation()
    rightDragRef.current = {
      startX: e.clientX,
      startTime: time,
      currentTime: time,
      isDragging: false
    }
  }, []) // getTimeFromMouseEvent is stable (reads refs only)

  // Global right-click drag handlers
  useEffect(() => {
    const DRAG_THRESHOLD = 5

    const onMouseMove = (e: MouseEvent): void => {
      if (!rightDragRef.current) return
      const dx = Math.abs(e.clientX - rightDragRef.current.startX)

      if (!rightDragRef.current.isDragging) {
        if (dx < DRAG_THRESHOLD) return
        rightDragRef.current.isDragging = true
      }

      // Calculate time from mouse position
      const m = getWsMetrics()
      const wrap = musicWrapRef.current
      if (!m || !wrap) return
      const rect = wrap.getBoundingClientRect()
      const clickX = e.clientX - rect.left + m.scrollLeft
      const time = Math.max(0, Math.min(durationRef.current, clickX / m.pxPerSec))
      rightDragRef.current.currentTime = time

      // Redraw marker canvas to show preview region
      drawMarkersRef.current()
    }

    const onMouseUp = (e: MouseEvent): void => {
      if (!rightDragRef.current) return
      if (e.button !== 2) { rightDragRef.current = null; return }
      const { startTime, currentTime: endTime, isDragging } = rightDragRef.current
      rightDragRef.current = null

      if (isDragging) {
        // Commit loop A/B (auto-sort for reverse drag) — AC-2.2
        const loopStart = Math.min(startTime, endTime)
        const loopEnd   = Math.max(startTime, endTime)
        useStore.getState().setLoopA(loopStart)
        useStore.getState().setLoopB(loopEnd)
        // Suppress the contextmenu event that will follow this mouseup (AC-2.4)
        preventContextMenuRef.current = true
      }
      // If not dragging (distance ≤ 5px), the contextmenu event will fire normally
      // and handleMarkerContextMenu will handle it (AC-2.3).
      drawMarkersRef.current()
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [drawMarkers])

  // ═══════════════════════════════════════════════════════════════════════════
  //  LTC waveform — simple canvas
  // ═══════════════════════════════════════════════════════════════════════════

  /** Draw static LTC waveform (background canvas) — only when data or size changes */
  const drawLtcBg = useCallback((canvas: HTMLCanvasElement, data: Float32Array): void => {
    const dpr = window.devicePixelRatio || 1
    const cssW = canvas.clientWidth
    const cssH = canvas.clientHeight
    if (!cssW || !cssH) return
    canvas.width = cssW * dpr
    canvas.height = cssH * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    const W = cssW, H = cssH

    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#1e1e1e'
    ctx.fillRect(0, 0, W, H)

    ctx.beginPath()
    ctx.strokeStyle = '#ff9800'
    ctx.lineWidth   = 1
    const step = data.length / W
    for (let x = 0; x < W; x++) {
      const s = Math.floor(x * step)
      const e = Math.max(Math.floor((x + 1) * step), s + 1)
      let mx = 0
      for (let i = s; i < e && i < data.length; i++) if (data[i] > mx) mx = data[i]
      const cy = H / 2, ya = Math.min(mx, 1) * (cy - 2)
      ctx.moveTo(x + 0.5, cy - ya)
      ctx.lineTo(x + 0.5, cy + ya)
    }
    ctx.stroke()

    ctx.beginPath()
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.moveTo(0, H / 2)
    ctx.lineTo(W, H / 2)
    ctx.stroke()
  }, [])

  /** Draw cursor + loop markers (overlay canvas) — redrawn every frame */
  const drawLtcCursor = useCallback((canvas: HTMLCanvasElement): void => {
    const dpr = window.devicePixelRatio || 1
    const cssW = canvas.clientWidth
    const cssH = canvas.clientHeight
    if (!cssW || !cssH) return
    canvas.width = cssW * dpr
    canvas.height = cssH * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    const W = cssW, H = cssH
    const ct = currentTimeRef.current, dur = durationRef.current

    ctx.clearRect(0, 0, W, H)

    if (dur > 0) {
      // Draw A-B loop region
      const la = loopARef.current, lb = loopBRef.current
      if (la !== null && lb !== null && la <= lb) {
        const aPx = Math.floor((la / dur) * W)
        const bPx = Math.floor((lb / dur) * W)
        ctx.fillStyle = 'rgba(0, 212, 255, 0.12)'
        ctx.fillRect(aPx, 0, bPx - aPx, H)
        ctx.strokeStyle = '#00d4ff'
        ctx.lineWidth = 1
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.moveTo(aPx, 0); ctx.lineTo(aPx, H)
        ctx.moveTo(bPx, 0); ctx.lineTo(bPx, H)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = '#00d4ff'
        ctx.font = '9px sans-serif'
        ctx.fillText('A', aPx + 2, 9)
        ctx.fillText('B', bPx + 2, 9)
      }

      const px = Math.floor((ct / dur) * W)
      ctx.beginPath()
      ctx.strokeStyle = '#00d4ff'
      ctx.lineWidth   = 2
      ctx.moveTo(px, 0)
      ctx.lineTo(px, H)
      ctx.stroke()
    }
  }, [])

  /** Redraw static LTC background (expensive — only on data/size change) */
  const redrawLtcBg = useCallback((): void => {
    if (ltcBgCanvasRef.current && ltcDataRef.current) drawLtcBg(ltcBgCanvasRef.current, ltcDataRef.current)
  }, [drawLtcBg])

  /** Redraw LTC cursor overlay (cheap — every frame) */
  const redrawLtcCursor = useCallback((): void => {
    if (ltcCursorCanvasRef.current) drawLtcCursor(ltcCursorCanvasRef.current)
  }, [drawLtcCursor])

  // ResizeObserver: redraw both layers when container resizes
  useEffect(() => {
    const el = ltcWrapRef.current
    if (!el) return
    const obs = new ResizeObserver(() => {
      redrawLtcBg()
      redrawLtcCursor()
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [redrawLtcBg, redrawLtcCursor])

  // Background: redraw only when data or loop points change (expensive — draws 6000 bars)
  useEffect(() => { redrawLtcBg() }, [ltcData, loopA, loopB, redrawLtcBg])
  // Cursor overlay: redraw every frame (cheap — only cursor line + loop region)
  useEffect(() => { redrawLtcCursor() }, [currentTime, loopA, loopB, redrawLtcCursor])

  // ═══════════════════════════════════════════════════════════════════════════
  //  Video waveform — draggable, same timeline as music/LTC
  // ═══════════════════════════════════════════════════════════════════════════

  const videoCanvasW = useRef(0) // CSS width (not pixel width)
  const dragStartX = useRef(0)
  const dragStartOffset = useRef(0)
  const isDragging = useRef(false)
  const videoZoomRef = useRef(1)    // 1 = full timeline, higher = zoomed in
  const videoScrollRef = useRef(0)  // scroll offset in seconds (left edge of view)

  /** Shared helper: compute video timeToPx based on zoom/scroll state */
  const videoTimeToPx = (t_: number, W: number): number => {
    const dur = durationRef.current
    const zoom = videoZoomRef.current
    const scroll = videoScrollRef.current
    if (dur <= 0) return 0
    const visibleDur = dur / zoom
    return ((t_ - scroll) / visibleDur) * W
  }

  /** Draw static video waveform (background canvas) */
  const drawVideoBg = useCallback((canvas: HTMLCanvasElement, data: Float32Array): void => {
    const dpr = window.devicePixelRatio || 1
    const cssW = canvas.clientWidth
    const cssH = canvas.clientHeight
    if (!cssW || !cssH) return

    canvas.width = cssW * dpr
    canvas.height = cssH * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)

    const W = cssW, H = cssH
    videoCanvasW.current = W
    const dur = durationRef.current
    const vOffset = videoOffsetRef.current
    const vDur = videoDurRef.current

    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#1a2e1a'
    ctx.fillRect(0, 0, W, H)

    if (vDur <= 0 || dur <= 0) return

    const startPx = videoTimeToPx(vOffset, W)
    const endPx = videoTimeToPx(vOffset + vDur, W)
    const widthPx = endPx - startPx

    // Draw video waveform
    if (widthPx >= 1) {
      ctx.beginPath()
      ctx.strokeStyle = '#4caf50'
      ctx.lineWidth = 1

      const pxCount = Math.max(1, Math.ceil(widthPx))
      for (let px = 0; px < pxCount; px++) {
        const drawX = startPx + px
        if (drawX < -1 || drawX > W + 1) continue

        const dataStart = Math.floor((px / pxCount) * data.length)
        const dataEnd = Math.max(Math.floor(((px + 1) / pxCount) * data.length), dataStart + 1)
        let mx = 0
        for (let i = dataStart; i < dataEnd && i < data.length; i++) {
          if (data[i] > mx) mx = data[i]
        }
        const cy = H / 2, ya = Math.min(mx, 1) * (cy - 2)
        ctx.moveTo(drawX + 0.5, cy - ya)
        ctx.lineTo(drawX + 0.5, cy + ya)
      }
      ctx.stroke()

      // Video region background highlight
      ctx.fillStyle = 'rgba(76, 175, 80, 0.08)'
      ctx.fillRect(startPx, 0, widthPx, H)

      // Boundary lines
      ctx.strokeStyle = '#4caf50'
      ctx.lineWidth = 1.5
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(startPx, 0); ctx.lineTo(startPx, H)
      ctx.stroke()
      if (endPx >= 0 && endPx <= W) {
        ctx.beginPath()
        ctx.moveTo(endPx, 0); ctx.lineTo(endPx, H)
        ctx.stroke()
      }
      ctx.setLineDash([])
    }

    // Center line
    ctx.beginPath()
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.lineWidth = 1
    ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2)
    ctx.stroke()

    // Zoom indicator (only when zoomed in)
    const zoom = videoZoomRef.current
    if (zoom > 1.05) {
      ctx.fillStyle = 'rgba(255,255,255,0.3)'
      ctx.font = '10px sans-serif'
      ctx.fillText(`${zoom.toFixed(1)}x`, 4, H - 4)
    }

    // Drag hint
    ctx.fillStyle = 'rgba(255,255,255,0.2)'
    ctx.font = '10px sans-serif'
    const hintKey = window.api?.platform === 'darwin' ? 'dragHintMac' : 'dragHint'
    ctx.fillText(t(useStore.getState().lang, hintKey), W / 2 - 120, H - 4)
  }, [])

  /** Draw video cursor overlay (cheap — every frame) */
  const drawVideoCursor = useCallback((canvas: HTMLCanvasElement): void => {
    const dpr = window.devicePixelRatio || 1
    const cssW = canvas.clientWidth
    const cssH = canvas.clientHeight
    if (!cssW || !cssH) return
    canvas.width = cssW * dpr
    canvas.height = cssH * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    const W = cssW, H = cssH

    ctx.clearRect(0, 0, W, H)

    const ct = currentTimeRef.current
    const cursorPx = videoTimeToPx(ct, W)
    if (cursorPx >= 0 && cursorPx <= W) {
      ctx.beginPath()
      ctx.strokeStyle = '#00d4ff'
      ctx.lineWidth = 2
      ctx.moveTo(cursorPx, 0); ctx.lineTo(cursorPx, H)
      ctx.stroke()
    }
  }, [])

  const redrawVideoBg = useCallback((): void => {
    if (videoBgCanvasRef.current && videoDataRef.current) drawVideoBg(videoBgCanvasRef.current, videoDataRef.current)
  }, [drawVideoBg])

  const redrawVideoCursor = useCallback((): void => {
    if (videoCursorCanvasRef.current) drawVideoCursor(videoCursorCanvasRef.current)
  }, [drawVideoCursor])

  // Resize observer for video canvas
  useEffect(() => {
    const el = videoWrapRef.current
    if (!el) return
    const obs = new ResizeObserver(() => { redrawVideoBg(); redrawVideoCursor() })
    obs.observe(el)
    return () => obs.disconnect()
  }, [redrawVideoBg, redrawVideoCursor, videoWaveform])

  // Auto-zoom to video region when video is first loaded
  useEffect(() => {
    if (!videoWaveform || !duration || !videoDuration) return
    const padding = 0.1 // 10% padding on each side
    const vDur = videoDuration
    const viewDur = vDur * (1 + padding * 2)
    if (!viewDur) return
    const zoom = Math.max(1, Math.min(50, duration / viewDur))
    const viewStart = Math.max(0, videoOffsetSeconds - vDur * padding)
    videoZoomRef.current = zoom
    videoScrollRef.current = Math.max(0, Math.min(duration - duration / zoom, viewStart))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoWaveform]) // only on new video load

  // Background: redraw when data/offset changes (expensive)
  useEffect(() => { redrawVideoBg() }, [videoWaveform, videoOffsetSeconds, redrawVideoBg])
  // Cursor overlay: redraw every frame (cheap)
  useEffect(() => { redrawVideoCursor() }, [currentTime, redrawVideoCursor])

  // Mouse drag handlers for video waveform
  const onVideoMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>): void => {
    isDragging.current = true
    dragStartX.current = e.clientX
    dragStartOffset.current = videoOffsetRef.current
    e.preventDefault()
  }, [])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent): void => {
      if (!isDragging.current) return
      const dx = e.clientX - dragStartX.current
      const W = videoCanvasW.current
      const dur = durationRef.current
      if (W <= 0 || dur <= 0) return

      // Account for zoom: visible duration is dur / zoom
      const visibleDur = dur / videoZoomRef.current
      const deltaSec = (dx / W) * visibleDur
      const vDur = videoDurRef.current
      const minOffset = -vDur
      const maxOffset = dur
      const newOffset = Math.max(minOffset, Math.min(maxOffset, dragStartOffset.current + deltaSec))
      onVideoOffsetChange?.(newOffset)
    }

    const onMouseUp = (): void => {
      isDragging.current = false
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [onVideoOffsetChange])

  // Scroll zoom + pan on video canvas
  // Scroll = zoom, Shift+scroll = pan
  useEffect(() => {
    const el = videoWrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const dur = durationRef.current
      if (dur <= 0) return

      if (e.shiftKey) {
        // Shift+scroll → pan left/right
        const visibleDur = dur / videoZoomRef.current
        const scrollDelta = (e.deltaY / 300) * visibleDur
        videoScrollRef.current = Math.max(0, Math.min(dur - visibleDur, videoScrollRef.current + scrollDelta))
      } else {
        // Normal scroll → zoom
        const norm = e.deltaMode === 0 ? e.deltaY / 100
                   : e.deltaMode === 1 ? e.deltaY / 3
                   : e.deltaY
        const oldZoom = videoZoomRef.current
        const newZoom = Math.max(1, Math.min(50, oldZoom * Math.pow(1.3, -norm)))

        // Zoom toward mouse position
        const rect = el.getBoundingClientRect()
        const mouseRatio = (e.clientX - rect.left) / rect.width
        const oldVisibleDur = dur / oldZoom
        const newVisibleDur = dur / newZoom
        const mouseTime = videoScrollRef.current + mouseRatio * oldVisibleDur
        videoScrollRef.current = Math.max(0, Math.min(dur - newVisibleDur, mouseTime - mouseRatio * newVisibleDur))
        videoZoomRef.current = newZoom
      }

      redrawVideoBg()
      redrawVideoCursor()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [redrawVideoBg, redrawVideoCursor, videoWaveform]) // re-attach when video appears/disappears

  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="waveform-container">
      <div className="waveform-section">
        <span className="waveform-label">{t(lang, 'musicWaveform')}</span>
        <div
          ref={musicWrapRef}
          className="waveform-music-wrap"
          onMouseDownCapture={(e) => {
            if (e.button === 2) handleWrapRightMouseDown(e)
            else handleWrapMouseDown(e)
          }}
          onDoubleClickCapture={handleMarkerDblClick}
          onContextMenuCapture={handleMarkerContextMenu}
        >
          <div ref={musicContainerRef} className="waveform-ws" />
          <canvas
            ref={markerCanvasRef}
            className="waveform-canvas waveform-canvas--overlay waveform-canvas--markers"
          />
          {editingMarker && (
            <input
              ref={editingInputRef}
              className="marker-inline-edit"
              type="text"
              value={editingLabelValue}
              onChange={(e) => setEditingLabelValue(e.target.value)}
              onBlur={commitMarkerEdit}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') { e.preventDefault(); commitMarkerEdit() }
                else if (e.key === 'Escape') { e.preventDefault(); cancelMarkerEdit() }
              }}
              style={{ left: editingMarker.x + 4 }}
              placeholder={t(lang, 'markerLabel')}
            />
          )}
        </div>
      </div>

      <div className="waveform-section">
        <span className="waveform-label" style={{ color: '#ff9800' }}>{t(lang, 'ltcWaveform')}</span>
        <div className="waveform-ltc-wrap" ref={ltcWrapRef}>
          <canvas ref={ltcBgCanvasRef} className="waveform-canvas" />
          <canvas ref={ltcCursorCanvasRef} className="waveform-canvas waveform-canvas--overlay" />
        </div>
      </div>

      {(videoWaveform || videoLoading) && (
        <div className="waveform-section">
          <div className="waveform-video-header">
            <span className="waveform-label" style={{ color: '#4caf50' }}>
              {t(lang, 'videoWaveform')}
              {videoFileName && <span className="video-filename"> — {videoFileName}</span>}
            </span>
            <div className="video-controls">
              {videoStartTimecode && (
                <span className="video-start-tc">
                  {t(lang, 'videoStartTC')}: <strong>{videoStartTimecode}</strong>
                </span>
              )}
              <button className="btn-nudge" onClick={onResyncVideo} title={t(lang, 'resyncVideo')}>⟳</button>
              <button className="btn-nudge btn-clear-video" onClick={onClearVideo} title={t(lang, 'clearVideo')}>✕</button>
            </div>
          </div>
          {videoLoading ? (
            <div className="video-loading">{t(lang, 'extractingAudio')}</div>
          ) : (
            <div className="waveform-video-wrap" ref={videoWrapRef}>
              <canvas
                ref={videoBgCanvasRef}
                className="waveform-canvas waveform-canvas--draggable"
                onMouseDown={onVideoMouseDown}
              />
              <canvas
                ref={videoCursorCanvasRef}
                className="waveform-canvas waveform-canvas--overlay"
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
