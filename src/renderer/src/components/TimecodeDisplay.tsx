import React, { useState, useRef, useEffect } from 'react'
import { useStore } from '../store'
import { TapBpm } from './TapBpm'
import { t } from '../i18n'

function pad2(n: number): string { return String(Math.floor(n)).padStart(2, '0') }

interface Props {
  fullscreen?: boolean
}

const FPS_OPTIONS = [24, 25, 29.97, 30]

export function TimecodeDisplay({ fullscreen }: Props): React.JSX.Element {
  const {
    timecode, detectedFps, forceFps, lang,
    tcGeneratorMode, setTcGeneratorMode,
    generatorStartTC, setGeneratorStartTC,
    generatorFps, setGeneratorFps
  } = useStore()

  const fps = forceFps ?? detectedFps ?? 25

  const h = timecode ? pad2(timecode.hours)   : '--'
  const m = timecode ? pad2(timecode.minutes)  : '--'
  const s = timecode ? pad2(timecode.seconds)  : '--'
  const f = timecode ? pad2(timecode.frames)   : '--'
  const sep = timecode?.dropFrame ? ';' : ':'

  const fpsLabel = timecode
    ? `${timecode.fps % 1 !== 0 ? timecode.fps.toFixed(2) : timecode.fps} ${t(lang, timecode.dropFrame ? 'dropFrame' : 'nonDropFrame')}`
    : tcGeneratorMode
      ? `${generatorFps % 1 !== 0 ? generatorFps.toFixed(2) : generatorFps} ${t(lang, 'nonDropFrame')}`
      : `${fps} ${t(lang, 'nonDropFrame')}`

  return (
    <div className={`tc-display${fullscreen ? ' tc-display--fullscreen' : ''}`}>
      {/* Mode toggle */}
      {!fullscreen && (
        <div className="tc-mode-row">
          <button
            className={`tc-mode-btn${!tcGeneratorMode ? ' active' : ''}`}
            onClick={() => setTcGeneratorMode(false)}
          >
            {t(lang, 'tcModeLtc')}
          </button>
          <button
            className={`tc-mode-btn${tcGeneratorMode ? ' active' : ''}`}
            onClick={() => setTcGeneratorMode(true)}
          >
            {t(lang, 'tcModeGenerator')}
          </button>
        </div>
      )}

      <div className="tc-label">{t(lang, 'timecode')}</div>
      <div className="tc-digits">
        <span className="tc-seg">{h}</span>
        <span className="tc-colon">:</span>
        <span className="tc-seg">{m}</span>
        <span className="tc-colon">:</span>
        <span className="tc-seg">{s}</span>
        <span className="tc-colon">{sep}</span>
        <span className="tc-seg tc-frames">{f}</span>
      </div>
      <div className="tc-fps">{fpsLabel}</div>
      {!fullscreen && <TapBpm />}

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
