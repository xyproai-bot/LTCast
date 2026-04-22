import React, { useState, useRef, useEffect } from 'react'
import { useStore } from '../store'
import { t } from '../i18n'

function pad2(n: number): string { return String(Math.floor(n)).padStart(2, '0') }

interface Props {
  fullscreen?: boolean
  onSeekToTimecode?: (tc: string) => void
}

const FPS_OPTIONS = [24, 25, 29.97, 30]

function formatCountdown(remaining: number): string {
  if (remaining < 0) remaining = 0
  const h = Math.floor(remaining / 3600)
  const m = Math.floor((remaining % 3600) / 60)
  const s = Math.floor(remaining % 60)
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function TimecodeDisplay({ fullscreen, onSeekToTimecode }: Props): React.JSX.Element {
  const {
    timecode, detectedFps, forceFps, setForceFps, lang,
    tcGeneratorMode, setTcGeneratorMode,
    generatorStartTC, setGeneratorStartTC,
    generatorFps, setGeneratorFps,
    ltcSignalOk, playState,
    currentTime, duration,
    ltcStartTime,
    autoAdvance, setlist, activeSetlistIndex,
    offsetFrames, setOffsetFrames, showLocked
  } = useStore()

  // Toggle elapsed vs remaining time (click to switch, like Arena)
  const [showElapsed, setShowElapsed] = useState(false)

  // Inline TC edit: double-click timecode to type a target TC and seek
  const [tcEditing, setTcEditing] = useState(false)
  const [tcEditValue, setTcEditValue] = useState('')
  const tcEditRef = useRef<HTMLInputElement>(null)

  // F2: Wheel-to-offset nudging on .tc-digits
  // Scroll = ±1 frame, Shift+scroll = ±10 frames.
  // Attached via useEffect + non-passive listener so preventDefault() works
  // (React synthetic onWheel is passive by default).
  const tcDigitsRef = useRef<HTMLDivElement>(null)
  const wheelAccumRef = useRef(0)
  useEffect(() => {
    const el = tcDigitsRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      // AC-7: UI Lock → do nothing, let page scroll normally (no preventDefault)
      if (showLocked) return
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
        wheelAccumRef.current += e.deltaY
        while (wheelAccumRef.current >= 40) {
          step -= 1
          wheelAccumRef.current -= 40
        }
        while (wheelAccumRef.current <= -40) {
          step += 1
          wheelAccumRef.current += 40
        }
      }
      // Always preventDefault so page does not scroll while wheeling over digits (AC-6)
      e.preventDefault()
      if (step === 0) return
      // Shift multiplier (AC-4)
      if (e.shiftKey) step *= 10
      // setOffsetFrames clamps -999..999 and sets presetDirty (AC-5, AC-11)
      setOffsetFrames(offsetFrames + step)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // tcEditing included because .tc-digits unmounts when editing; re-attach when it re-mounts
  }, [offsetFrames, setOffsetFrames, showLocked, tcEditing])

  const handleTcDoubleClick = (): void => {
    if (!duration || !onSeekToTimecode) return
    const current = timecode
      ? `${pad2(timecode.hours)}:${pad2(timecode.minutes)}:${pad2(timecode.seconds)}:${pad2(timecode.frames)}`
      : '00:00:00:00'
    setTcEditValue(current)
    setTcEditing(true)
  }

  useEffect(() => {
    if (tcEditing && tcEditRef.current) {
      tcEditRef.current.focus()
      tcEditRef.current.select()
    }
  }, [tcEditing])

  const commitTcEdit = (): void => {
    setTcEditing(false)
    const fps = forceFps ?? detectedFps ?? generatorFps
    const parsed = parseAndValidateTC(tcEditValue, fps)
    if (parsed && onSeekToTimecode) onSeekToTimecode(parsed)
  }

  // LTC signal lost: playing in reader mode but no signal
  const signalLost = !tcGeneratorMode && playState === 'playing' && !ltcSignalOk

  const fps = forceFps ?? detectedFps ?? 25

  const h = timecode ? pad2(timecode.hours)   : '--'
  const m = timecode ? pad2(timecode.minutes)  : '--'
  const s = timecode ? pad2(timecode.seconds)  : '--'
  const f = timecode ? pad2(timecode.frames)   : '--'
  const sep = timecode?.dropFrame ? ';' : ':'

  const fpsLabel = timecode
    ? `${timecode.fps % 1 !== 0 ? timecode.fps.toFixed(2) : timecode.fps} ${t(lang, timecode.dropFrame ? 'dropFrame' : 'nonDropFrame')}`
    : tcGeneratorMode
      ? `${generatorFps % 1 !== 0 ? generatorFps.toFixed(2) : generatorFps} ${t(lang, generatorFps === 29.97 ? 'dropFrame' : 'nonDropFrame')}`
      : `${fps} ${t(lang, fps === 29.97 ? 'dropFrame' : 'nonDropFrame')}`

  return (
    <div className={`tc-display${fullscreen ? ' tc-display--fullscreen' : ''}${signalLost ? ' tc-signal-lost' : ''}`}>
      <div className="tc-label">{t(lang, 'timecode')}</div>
      {tcEditing ? (
        <div className="tc-digits">
          <input
            ref={tcEditRef}
            className="tc-edit-input"
            autoFocus
            value={tcEditValue}
            onChange={(e) => setTcEditValue(e.target.value)}
            onBlur={commitTcEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTcEdit()
              if (e.key === 'Escape') setTcEditing(false)
            }}
            placeholder="HH:MM:SS:FF"
            spellCheck={false}
          />
        </div>
      ) : (
        <div ref={tcDigitsRef} className="tc-digits" onDoubleClick={handleTcDoubleClick} style={{ cursor: duration ? 'pointer' : undefined }}>
          <span className="tc-seg">{h}</span>
          <span className="tc-colon">:</span>
          <span className="tc-seg">{m}</span>
          <span className="tc-colon">:</span>
          <span className="tc-seg">{s}</span>
          <span className="tc-colon">{sep}</span>
          <span className="tc-seg tc-frames">{f}</span>
        </div>
      )}
      <div className="tc-fps">{fpsLabel}</div>

      {/* Elapsed / Remaining timer (click to toggle) */}
      {duration > 0 ? (() => {
        const remaining = Math.max(0, duration - currentTime)
        const elapsed = Math.max(0, currentTime)
        const displayTime = showElapsed ? elapsed : remaining
        const isWarning = remaining <= 30
        return (
          <div
            className={`tc-countdown${isWarning ? ' tc-countdown--warn' : ''}`}
            onClick={() => setShowElapsed(prev => !prev)}
            title={showElapsed ? 'Elapsed (click for remaining)' : 'Remaining (click for elapsed)'}
          >
            {showElapsed ? '' : '-'}{formatCountdown(displayTime)}
          </div>
        )
      })() : (
        <div className="tc-countdown tc-countdown--empty">--:--</div>
      )}

      {/* Next song indicator (auto-advance, last 15 seconds) */}
      {(() => {
        if (!autoAdvance || duration <= 0 || activeSetlistIndex === null) return null
        const remaining = duration - currentTime
        const nextIdx = activeSetlistIndex + 1
        if (nextIdx >= setlist.length || remaining > 15 || remaining <= 0) return null
        return <div className="tc-next-song">NEXT: {setlist[nextIdx].name}</div>
      })()}

      <div className={`tc-signal-lost-banner${signalLost ? '' : ' tc-banner--hidden'}`}>
        {t(lang, 'ltcSignalLost')}
      </div>
      {!fullscreen && !tcGeneratorMode && (
        <div className={`tc-preroll-banner${ltcStartTime > 0 ? '' : ' tc-banner--hidden'}`}>
          {ltcStartTime > 0
            ? t(lang, 'ltcPreroll').replace('{time}', formatCountdown(ltcStartTime))
            : '\u00A0'}
        </div>
      )}

      {/* Force FPS — only shown in LTC Reader mode */}
      {!tcGeneratorMode && !fullscreen && (
        <div className="tc-generator-controls">
          <div className="tc-gen-row">
            <span className="tc-gen-label">{t(lang, 'forceFpsLabel')}</span>
            <div className="tc-gen-fps-buttons">
              <button
                className={`tc-gen-fps-btn${forceFps === null ? ' active' : ''}`}
                onClick={() => setForceFps(null)}
              >{t(lang, 'forceFpsAuto')}</button>
              {FPS_OPTIONS.map(opt => (
                <button
                  key={opt}
                  className={`tc-gen-fps-btn${forceFps === opt ? ' active' : ''}`}
                  onClick={() => setForceFps(opt)}
                >
                  {opt === 29.97 ? '29.97' : opt}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Generator controls — only shown when in generator mode */}
      {tcGeneratorMode && !fullscreen && (
        <div className="tc-generator-controls">
          <div className="tc-gen-row">
            <span className="tc-gen-label">{t(lang, 'generatorStartTC')}</span>
            <TimecodeInput
              value={generatorStartTC}
              onChange={setGeneratorStartTC}
              fps={generatorFps}
            />
          </div>
          <div className="tc-gen-row">
            <span className="tc-gen-label">{t(lang, 'generatorFps')}</span>
            <div className="tc-gen-fps-buttons">
              {FPS_OPTIONS.map(opt => (
                <button
                  key={opt}
                  className={`tc-gen-fps-btn${generatorFps === opt ? ' active' : ''}`}
                  onClick={() => setGeneratorFps(opt)}
                >
                  {opt === 29.97 ? '29.97' : opt}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Timecode input component — HH:MM:SS:FF format with validation
 */
function TimecodeInput({
  value,
  onChange,
  fps
}: {
  value: string
  onChange: (tc: string) => void
  fps: number
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) setEditValue(value)
  }, [value, editing])

  const handleFocus = (): void => {
    setEditing(true)
    setEditValue(value)
  }

  const handleBlur = (): void => {
    setEditing(false)
    const parsed = parseAndValidateTC(editValue, fps)
    if (parsed) {
      onChange(parsed)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      inputRef.current?.blur()
    } else if (e.key === 'Escape') {
      setEditing(false)
      setEditValue(value)
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      className="tc-gen-input"
      value={editing ? editValue : value}
      onChange={(e) => setEditValue(e.target.value)}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      placeholder="01:00:00:00"
      spellCheck={false}
    />
  )
}

function parseAndValidateTC(input: string, fps: number): string | null {
  const cleaned = input.trim()

  // Try HH:MM:SS:FF or HH;MM;SS;FF
  const parts = cleaned.split(/[:;]/).map(Number)
  if (parts.length === 4 && parts.every(p => !isNaN(p))) {
    const [h, m, s, f] = parts
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59 && s >= 0 && s <= 59 && f >= 0 && f < Math.ceil(fps)) {
      return `${pad2(h)}:${pad2(m)}:${pad2(s)}:${pad2(f)}`
    }
  }

  // Try 8-digit number: 01000000
  if (/^\d{8}$/.test(cleaned)) {
    const h = parseInt(cleaned.slice(0, 2))
    const m = parseInt(cleaned.slice(2, 4))
    const s = parseInt(cleaned.slice(4, 6))
    const f = parseInt(cleaned.slice(6, 8))
    if (h <= 23 && m <= 59 && s <= 59 && f < Math.ceil(fps)) {
      return `${pad2(h)}:${pad2(m)}:${pad2(s)}:${pad2(f)}`
    }
  }

  return null
}
