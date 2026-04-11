import React, { useRef, useEffect, useCallback } from 'react'
import WaveSurfer from 'wavesurfer.js'
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js'
import MinimapPlugin from 'wavesurfer.js/dist/plugins/minimap.esm.js'
import { useStore, WaveformMarker } from '../store'
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
  // Stable ref so the wavesurfer event handler always sees the latest callback
  const onSeekRef = useRef(onSeek)
  onSeekRef.current = onSeek

  const {
    currentTime, duration, lang, filePath,
    videoWaveform, videoDuration, videoOffsetSeconds,
    videoStartTimecode, videoFileName, videoLoading,
    loopA, loopB,
    markers, addMarker, removeMarker, updateMarker
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
    ws.on('zoom', (px: number) => { zoomRef.current = px })

    wsRef.current = ws

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
  }, [musicData, duration])

  useEffect(() => {
    const ws = wsRef.current
    if (!ws || duration <= 0) return
    ws.setTime(currentTime)
  }, [currentTime, duration])

  useEffect(() => {
    const el = musicContainerRef.current
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
    if (!fp) return
    const fileMarkers = markersRef.current[fp] ?? []
    if (fileMarkers.length === 0) return

    const dur = durationRef.current
    if (dur <= 0) return

    // Get WaveSurfer scroll position and zoom
    const scrollLeft = (ws as unknown as { getScroll(): number }).getScroll?.() ?? 0
    const totalWidth = Math.max(cssW, zoomRef.current * dur)
    const pxPerSec = totalWidth / dur

    for (const marker of fileMarkers) {
      const absX = marker.time * pxPerSec
      const x = absX - scrollLeft
      if (x < -10 || x > cssW + 10) continue

      const color = marker.color ?? '#00d4ff'

      // Vertical line
      ctx.beginPath()
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.moveTo(x, 0)
      ctx.lineTo(x, cssH)
      ctx.stroke()

      // Triangle at top
      ctx.beginPath()
      ctx.fillStyle = color
      ctx.moveTo(x - 5, 0)
      ctx.lineTo(x + 5, 0)
      ctx.lineTo(x, 8)
      ctx.closePath()
      ctx.fill()

      // Label
      if (marker.label) {
        ctx.font = '10px sans-serif'
        ctx.fillStyle = color
        const labelX = Math.min(x + 4, cssW - 60)
        ctx.fillText(marker.label, labelX, 20)
      }
    }
  }, [])

  // Redraw markers whenever markers, filePath, duration, currentTime changes
  useEffect(() => { drawMarkers() }, [markers, filePath, duration, currentTime, drawMarkers])

  // ResizeObserver for music waveform wrap
  useEffect(() => {
    const el = musicWrapRef.current
    if (!el) return
    const obs = new ResizeObserver(() => { drawMarkers() })
    obs.observe(el)
    return () => obs.disconnect()
  }, [drawMarkers])

  // Double-click on music waveform → add marker at that time
  useEffect(() => {
    const el = musicContainerRef.current
    if (!el) return

    const onDblClick = (e: MouseEvent): void => {
      const ws = wsRef.current
      const fp = filePathRef.current
      const dur = durationRef.current
      if (!ws || !fp || dur <= 0) return

      // Compute time at click position
      const rect = el.getBoundingClientRect()
      const scrollLeft = ws.getScroll() ?? 0
      const totalWidth = Math.max(rect.width, zoomRef.current * (durationRef.current || 1))
      const pxPerSec = totalWidth / dur
      const clickX = e.clientX - rect.left + scrollLeft
      const time = Math.max(0, Math.min(dur, clickX / pxPerSec))

      // Prompt for marker name
      const lang_ = useStore.getState().lang
      window.api.showInputDialog(
        t(lang_, 'addMarker'),
        t(lang_, 'markerLabel'),
        t(lang_, 'markerPlaceholder')
      ).then((label: string | null) => {
        if (label === null) return
        const { addMarker: add } = useStore.getState()
        add(fp, {
          id: `marker-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          time,
          label: label.trim() || String(Math.round(time * 10) / 10) + 's',
          color: '#00d4ff'
        })
      }).catch(() => {})
    }

    el.addEventListener('dblclick', onDblClick)
    return () => el.removeEventListener('dblclick', onDblClick)
  }, [])

  // Right-click on marker canvas → rename or delete marker
  // (showInputDialog: blank/cancel = delete, any text = rename)
  useEffect(() => {
    const canvas = markerCanvasRef.current
    if (!canvas) return

    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault()
      const ws = wsRef.current
      const fp = filePathRef.current
      const dur = durationRef.current
      if (!ws || !fp || dur <= 0) return

      const rect = canvas.getBoundingClientRect()
      const scrollLeft = ws.getScroll() ?? 0
      const totalWidth = Math.max(rect.width, zoomRef.current * (durationRef.current || 1))
      const pxPerSec = totalWidth / dur

      // Find nearest marker within 10px
      const fileMarkers = markersRef.current[fp] ?? []
      let closest: WaveformMarker | null = null
      let minDist = 10
      for (const m of fileMarkers) {
        const mx = m.time * pxPerSec - scrollLeft
        const dist = Math.abs(mx - (e.clientX - rect.left))
        if (dist < minDist) { minDist = dist; closest = m }
      }

      if (!closest) return

      const lang_ = useStore.getState().lang
      // showInputDialog: blank = delete, text = rename, cancel = do nothing
      window.api.showInputDialog(
        t(lang_, 'renameMarker'),
        t(lang_, 'markerLabel'),
        closest.label
      ).then((newLabel: string | null) => {
        if (newLabel === null) return // cancelled — do nothing
        const state = useStore.getState()
        if (newLabel.trim() === '') {
          state.removeMarker(fp, closest!.id)
        } else {
          state.updateMarker(fp, closest!.id, { label: newLabel.trim() })
        }
      }).catch(() => {})
    }

    canvas.addEventListener('contextmenu', onContextMenu)
    return () => canvas.removeEventListener('contextmenu', onContextMenu)
  }, [])

  // Click on marker canvas → seek to nearest marker
  useEffect(() => {
    const canvas = markerCanvasRef.current
    if (!canvas) return

    const onClick = (e: MouseEvent): void => {
      const ws = wsRef.current
      const fp = filePathRef.current
      const dur = durationRef.current
      if (!ws || !fp || dur <= 0) return

      const rect = canvas.getBoundingClientRect()
      const scrollLeft = ws.getScroll() ?? 0
      const totalWidth = Math.max(rect.width, zoomRef.current * (durationRef.current || 1))
      const pxPerSec = totalWidth / dur

      const fileMarkers = markersRef.current[fp] ?? []
      let closest: WaveformMarker | null = null
      let minDist = 10
      for (const m of fileMarkers) {
        const mx = m.time * pxPerSec - scrollLeft
        const dist = Math.abs(mx - (e.clientX - rect.left))
        if (dist < minDist) { minDist = dist; closest = m }
      }

      if (closest) {
        onSeekRef.current(closest.time)
        e.stopPropagation()
      }
    }

    canvas.addEventListener('click', onClick)
    return () => canvas.removeEventListener('click', onClick)
  }, [])

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
        <div ref={musicWrapRef} className="waveform-music-wrap">
          <div ref={musicContainerRef} className="waveform-ws" />
          <canvas ref={markerCanvasRef} className="waveform-canvas waveform-canvas--overlay waveform-canvas--markers" />
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
