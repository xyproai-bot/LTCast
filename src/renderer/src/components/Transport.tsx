import React, { useRef, useState, useEffect } from 'react'
import { useStore } from '../store'
import { t } from '../i18n'

/* ── SVG icon helpers ─────────────────────────────────────── */
const IconStop = (): React.JSX.Element => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor">
    <rect x="1.5" y="1.5" width="10" height="10" rx="1"/>
  </svg>
)
const IconPlay = (): React.JSX.Element => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
    <polygon points="3,1 14,7.5 3,14"/>
  </svg>
)
const IconPause = (): React.JSX.Element => (
  <svg width="13" height="15" viewBox="0 0 13 15" fill="currentColor">
    <rect x="1" y="1" width="4" height="13" rx="1"/>
    <rect x="8" y="1" width="4" height="13" rx="1"/>
  </svg>
)
const IconLoop = (): React.JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="17 1 21 5 17 9"/>
    <path d="M3 11V9a4 4 0 014-4h14"/>
    <polyline points="7 23 3 19 7 15"/>
    <path d="M21 13v2a4 4 0 01-4 4H3"/>
  </svg>
)
const IconSkipBack = (): React.JSX.Element => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="19,20 9,12 19,4"/>
    <rect x="5" y="4" width="2.5" height="16" rx="1"/>
  </svg>
)
const IconSkipForward = (): React.JSX.Element => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5,4 15,12 5,20"/>
    <rect x="16.5" y="4" width="2.5" height="16" rx="1"/>
  </svg>
)
const IconRewind = (): React.JSX.Element => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="22,19 12,12 22,5"/>
    <polygon points="11,19 1,12 11,5"/>
  </svg>
)
const IconFastForward = (): React.JSX.Element => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="2,5 12,12 2,19"/>
    <polygon points="13,5 23,12 13,19"/>
  </svg>
)

interface Props {
  onPlay:  () => void
  onPause: () => void
  onStop:  () => void
  onSeek:  (time: number) => void
  onPanic?: () => void
}

function formatTime(sec: number): string {
  const h  = Math.floor(sec / 3600)
  const m  = Math.floor((sec % 3600) / 60)
  const s  = Math.floor(sec % 60)
  const ms = Math.floor((sec % 1) * 10)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ms}`
}

export function Transport({ onPlay, onPause, onStop, onSeek, onPanic }: Props): React.JSX.Element {
  const {
    playState, currentTime, duration, loop, setLoop,
    offsetFrames, setOffsetFrames,
    loopA, loopB, setLoopA, setLoopB, clearLoop,
    lang
  } = useStore()

  // Scrub bar: only seek on mouse release
  const isScrubbing = useRef(false)
  const [scrubValue, setScrubValue] = useState(0)

  useEffect(() => {
    if (!isScrubbing.current) setScrubValue(currentTime)
  }, [currentTime])

  useEffect(() => {
    const onGlobalMouseUp = (): void => { isScrubbing.current = false }
    window.addEventListener('mouseup', onGlobalMouseUp)
    return () => window.removeEventListener('mouseup', onGlobalMouseUp)
  }, [])

  const handleScrubStart = (): void => {
    isScrubbing.current = true
    setScrubValue(currentTime)
  }

  const handleScrubChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setScrubValue(parseFloat(e.target.value))
  }

  const handleScrubEnd = (e: React.MouseEvent<HTMLInputElement>): void => {
    isScrubbing.current = false
    onSeek(parseFloat((e.target as HTMLInputElement).value))
  }

  const handleOffsetSlider = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setOffsetFrames(parseInt(e.target.value, 10))
  }

  const handleOffsetInput = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const val = parseInt(e.target.value, 10)
    if (!isNaN(val)) setOffsetFrames(Math.max(-999, Math.min(999, val)))
  }

  // F2: Wheel-to-offset nudging on the whole `.transport-offset` wrapper
  // (covers +/- buttons, slider, and number input).
  // Scroll = ±1 frame, Shift+scroll = ±10 frames.
  // UI Lock is already handled by CSS `.ui-locked .transport-offset { pointer-events: none }`
  // so wheel events won't reach this element when locked — no extra guard needed here.
  // Attached via useEffect + non-passive listener so preventDefault() works
  // (React synthetic onWheel is passive by default).
  const offsetWrapRef = useRef<HTMLDivElement>(null)
  const offsetWheelAccumRef = useRef(0)
  useEffect(() => {
    const el = offsetWrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      // Natural "wheel up = value up":
      //   scroll up (deltaY < 0) → step +1 (AC-1)
      //   scroll down (deltaY > 0) → step -1 (AC-2)
      let step = 0
      if (e.deltaMode === 1) {
        // Line mode (typical Windows mouse, ±3 per detent). One step per event.
        if (e.deltaY < 0) step = 1
        else if (e.deltaY > 0) step = -1
      } else {
        // Pixel mode (mac trackpad, precision touchpad, hi-res wheels).
        // Accumulate deltaY; emit a step every 40 pixels crossed (AC-8).
        offsetWheelAccumRef.current += e.deltaY
        while (offsetWheelAccumRef.current >= 40) {
          step -= 1
          offsetWheelAccumRef.current -= 40
        }
        while (offsetWheelAccumRef.current <= -40) {
          step += 1
          offsetWheelAccumRef.current += 40
        }
      }
      // Always preventDefault so page/slider don't also scroll (AC-6)
      e.preventDefault()
      if (step === 0) return
      // Shift multiplier (AC-4)
      if (e.shiftKey) step *= 10
      // setOffsetFrames clamps -999..999 and sets presetDirty (AC-5, AC-11)
      setOffsetFrames(offsetFrames + step)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [offsetFrames, setOffsetFrames])

  const hasLoopRegion = loopA !== null && loopB !== null
  const remaining = duration > 0 ? Math.max(0, duration - scrubValue) : 0

  return (
    <div className="transport">
      {/* Scrub bar */}
      <div className="scrub-row">
        <span className="scrub-time">{formatTime(scrubValue)}</span>
        <input
          type="range"
          className="scrub-bar"
          min={0}
          max={duration || 1}
          step={0.05}
          value={scrubValue}
          onMouseDown={handleScrubStart}
          onChange={handleScrubChange}
          onMouseUp={handleScrubEnd}
          disabled={!duration}
        />
        <span className={`scrub-time scrub-time--remaining${remaining <= 30 && duration > 0 ? ' scrub-time--warn' : ''}`}>
          {duration > 0 ? `-${formatTime(remaining)}` : formatTime(0)}
        </span>
        <span className="scrub-time scrub-time--right">{formatTime(duration)}</span>
      </div>

      {/* Main transport row */}
      <div className="transport-main">
        {/* Left: offset control */}
        <div ref={offsetWrapRef} className="transport-offset">
          <span className="offset-label">{t(lang, 'offset')}</span>
          <button className="btn-offset" onClick={() => setOffsetFrames(Math.max(-999, offsetFrames - 1))}>−</button>
          <input
            type="range"
            className="offset-slider"
            min={-999}
            max={999}
            step={1}
            value={offsetFrames}
            onChange={handleOffsetSlider}
          />
          <input
            type="number"
            className="offset-input"
            min={-999}
            max={999}
            value={offsetFrames}
            onChange={handleOffsetInput}
          />
          <button className="btn-offset" onClick={() => setOffsetFrames(Math.min(999, offsetFrames + 1))}>+</button>
          <span className="offset-unit">{t(lang, 'frames')}</span>
        </div>

        {/* Center: playback buttons */}
        <div className="transport-buttons">
          <button className="btn-transport btn-skip" onClick={() => onSeek(0)} disabled={!duration} title="Go to start">
            <IconSkipBack />
          </button>
          <button className="btn-transport btn-skip" onClick={() => onSeek(Math.max(0, currentTime - 5))} disabled={!duration} title="−5s">
            <IconRewind />
          </button>
          <button className="btn-transport btn-stop" onClick={onStop} disabled={!duration} title={t(lang, 'stop')}>
            <IconStop />
          </button>
          {playState === 'playing' ? (
            <button className="btn-transport btn-play active" onClick={onPause} disabled={!duration} title={t(lang, 'pause')}>
              <IconPause />
            </button>
          ) : (
            <button className="btn-transport btn-play" onClick={onPlay} disabled={!duration} title={t(lang, 'play')}>
              <IconPlay />
            </button>
          )}
          <button className="btn-transport btn-skip" onClick={() => onSeek(Math.min(duration, currentTime + 5))} disabled={!duration} title="+5s">
            <IconFastForward />
          </button>
          <button className="btn-transport btn-skip" onClick={() => onSeek(duration)} disabled={!duration} title="Go to end">
            <IconSkipForward />
          </button>
          {onPanic && (
            <button className="btn-transport btn-panic" onClick={onPanic} title="PANIC — stop all outputs">
              !!
            </button>
          )}
        </div>

        {/* Right: A-B loop */}
        <div className="transport-loop">
          <button
            className={`btn-transport btn-loop${loop ? ' active' : ''}`}
            onClick={() => setLoop(!loop)}
            title={t(lang, 'loop')}
          ><IconLoop /></button>

          <div className="ab-loop-box">
            <button
              className={`btn-ab${loopA !== null ? ' active' : ''}`}
              onClick={() => setLoopA(loopA !== null ? null : currentTime)}
              disabled={!duration}
              title={t(lang, 'loopA')}
            >A</button>
            {hasLoopRegion && (
              <span className="ab-loop-range">{formatTime(loopA!)} → {formatTime(loopB!)}</span>
            )}
            <button
              className={`btn-ab${loopB !== null ? ' active' : ''}`}
              onClick={() => setLoopB(loopB !== null ? null : currentTime)}
              disabled={!duration}
              title={t(lang, 'loopB')}
            >B</button>
            {hasLoopRegion && (
              <button className="btn-ab btn-ab-clear" onClick={clearLoop} title={t(lang, 'clearLoop')}>✕</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
