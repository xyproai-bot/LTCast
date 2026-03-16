import React, { useRef, useEffect, useCallback } from 'react'
import WaveSurfer from 'wavesurfer.js'
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js'
import MinimapPlugin from 'wavesurfer.js/dist/plugins/minimap.esm.js'
import { useStore } from '../store'
import { t } from '../i18n'

interface Props {
  musicData: Float32Array | null
  ltcData:   Float32Array | null
  onSeek:    (time: number) => void
  onVideoOffsetChange?: (offset: number) => void
  onClearVideo?: () => void
}

export function Waveform({ musicData, ltcData, onSeek, onVideoOffsetChange, onClearVideo }: Props): React.JSX.Element {
  const musicContainerRef = useRef<HTMLDivElement>(null)
  const ltcWrapRef        = useRef<HTMLDivElement>(null)
  const ltcCanvasRef      = useRef<HTMLCanvasElement>(null)
  const videoWrapRef      = useRef<HTMLDivElement>(null)
  const videoCanvasRef    = useRef<HTMLCanvasElement>(null)
  const wsRef             = useRef<WaveSurfer | null>(null)
  const zoomRef           = useRef(1)

  // Stable ref so the wavesurfer event handler always sees the latest callback
  const onSeekRef = useRef(onSeek)
  onSeekRef.current = onSeek

  const {
    currentTime, duration, lang,
    videoWaveform, videoDuration, videoOffsetSeconds,
    videoStartTimecode, videoFileName, videoLoading,
    loopA, loopB
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
      if (!e.ctrlKey) return
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
  //  LTC waveform — simple canvas
  // ═══════════════════════════════════════════════════════════════════════════

  const drawLtc = useCallback((canvas: HTMLCanvasElement, data: Float32Array): void => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width, H = canvas.height
    if (!W || !H) return
    const ct = currentTimeRef.current, dur = durationRef.current

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

  const redrawLtc = useCallback((): void => {
    if (ltcCanvasRef.current && ltcDataRef.current) drawLtc(ltcCanvasRef.current, ltcDataRef.current)
  }, [drawLtc])

  useEffect(() => {
    const el = ltcWrapRef.current
    if (!el) return
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width)
        if (w > 0 && ltcCanvasRef.current) { ltcCanvasRef.current.width = w; redrawLtc() }
      }
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [redrawLtc])

  useEffect(() => { redrawLtc() }, [currentTime, ltcData, loopA, loopB, redrawLtc])

  // ═══════════════════════════════════════════════════════════════════════════
  //  Video waveform — draggable, same timeline as music/LTC
  // ═══════════════════════════════════════════════════════════════════════════

  const videoCanvasW = useRef(0) // CSS width (not pixel width)
  const dragStartX = useRef(0)
  const dragStartOffset = useRef(0)
  const isDragging = useRef(false)
  const videoZoomRef = useRef(1)    // 1 = full timeline, higher = zoomed in
  const videoScrollRef = useRef(0)  // scroll offset in seconds (left edge of view)

  const drawVideo = useCallback((canvas: HTMLCanvasElement, data: Float32Array): void => {
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
    const zoom = videoZoomRef.current
    const scroll = videoScrollRef.current

    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#1a2e1a'
    ctx.fillRect(0, 0, W, H)

    if (vDur <= 0 || dur <= 0) return

    // Visible time range based on zoom
    const visibleDur = dur / zoom
    const viewStart = scroll  // seconds at left edge

    // Convert time to pixel
    const timeToPx = (t: number): number => ((t - viewStart) / visibleDur) * W

    const startPx = timeToPx(vOffset)
    const endPx = timeToPx(vOffset + vDur)
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

    // Playback cursor
    const ct = currentTimeRef.current
    const cursorPx = timeToPx(ct)
    if (cursorPx >= 0 && cursorPx <= W) {
      ctx.beginPath()
      ctx.strokeStyle = '#00d4ff'
      ctx.lineWidth = 2
      ctx.moveTo(cursorPx, 0); ctx.lineTo(cursorPx, H)
      ctx.stroke()
    }

    // Zoom indicator (only when zoomed in)
    if (zoom > 1.05) {
      ctx.fillStyle = 'rgba(255,255,255,0.3)'
      ctx.font = '10px sans-serif'
      ctx.fillText(`${zoom.toFixed(1)}x`, 4, H - 4)
    }

    // Drag hint
    ctx.fillStyle = 'rgba(255,255,255,0.2)'
    ctx.font = '10px sans-serif'
    ctx.fillText(t(useStore.getState().lang, 'dragHint'), W / 2 - 120, H - 4)
  }, [])

  const redrawVideo = useCallback((): void => {
    if (videoCanvasRef.current && videoDataRef.current) drawVideo(videoCanvasRef.current, videoDataRef.current)
  }, [drawVideo])

  // Resize observer for video canvas
  useEffect(() => {
    const el = videoWrapRef.current
    if (!el) return
    const obs = new ResizeObserver(() => { redrawVideo() })
    obs.observe(el)
    return () => obs.disconnect()
  }, [redrawVideo, videoWaveform])

  // Auto-zoom to video region when video is first loaded
  useEffect(() => {
    if (!videoWaveform || !duration || !videoDuration) return
    const padding = 0.1 // 10% padding on each side
    const vDur = videoDuration
    const viewDur = vDur * (1 + padding * 2)
    const zoom = Math.max(1, Math.min(50, duration / viewDur))
    const viewStart = Math.max(0, videoOffsetSeconds - vDur * padding)
    videoZoomRef.current = zoom
    videoScrollRef.current = Math.max(0, Math.min(duration - duration / zoom, viewStart))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoWaveform]) // only on new video load

  // Redraw video on changes
  useEffect(() => { redrawVideo() }, [currentTime, videoWaveform, videoOffsetSeconds, redrawVideo])

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
        const newZoom = Math.max(1, Math.min(100, oldZoom * Math.pow(1.3, -norm)))

        // Zoom toward mouse position
        const rect = el.getBoundingClientRect()
        const mouseRatio = (e.clientX - rect.left) / rect.width
        const oldVisibleDur = dur / oldZoom
        const newVisibleDur = dur / newZoom
        const mouseTime = videoScrollRef.current + mouseRatio * oldVisibleDur
        videoScrollRef.current = Math.max(0, Math.min(dur - newVisibleDur, mouseTime - mouseRatio * newVisibleDur))
        videoZoomRef.current = newZoom
      }

      if (videoCanvasRef.current && videoDataRef.current) {
        drawVideo(videoCanvasRef.current, videoDataRef.current)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [drawVideo, videoWaveform]) // re-attach when video appears/disappears

  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="waveform-container">
      <div className="waveform-section">
        <span className="waveform-label">{t(lang, 'musicWaveform')}</span>
        <div ref={musicContainerRef} className="waveform-ws" />
      </div>

      <div className="waveform-section">
        <span className="waveform-label" style={{ color: '#ff9800' }}>{t(lang, 'ltcWaveform')}</span>
        <div className="waveform-ltc-wrap" ref={ltcWrapRef}>
          <canvas ref={ltcCanvasRef} className="waveform-canvas" height={40} />
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
              <button className="btn-nudge btn-clear-video" onClick={onClearVideo} title={t(lang, 'clearVideo')}>✕</button>
            </div>
          </div>
          {videoLoading ? (
            <div className="video-loading">{t(lang, 'extractingAudio')}</div>
          ) : (
            <div className="waveform-video-wrap" ref={videoWrapRef}>
              <canvas
                ref={videoCanvasRef}
                className="waveform-canvas waveform-canvas--draggable"
                style={{ height: 56 }}
                onMouseDown={onVideoMouseDown}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
