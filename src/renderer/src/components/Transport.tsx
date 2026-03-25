import React, { useRef, useState, useEffect } from 'react'
import { useStore } from '../store'
import { t } from '../i18n'

interface Props {
  onPlay:  () => void
  onPause: () => void
  onStop:  () => void
  onSeek:  (time: number) => void
}

function formatTime(sec: number): string {
  const h  = Math.floor(sec / 3600)
  const m  = Math.floor((sec % 3600) / 60)
  const s  = Math.floor(sec % 60)
  const ms = Math.floor((sec % 1) * 10)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ms}`
}

export function Transport({ onPlay, onPause, onStop, onSeek }: Props): React.JSX.Element {
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

  // Reset scrub state if mouse is released outside the slider element
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

  const hasLoopRegion = loopA !== null && loopB !== null

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
        <span className={`scrub-time scrub-time--remaining${duration > 0 && (duration - scrubValue) <= 30 ? ' scrub-time--warn' : ''}`}>{duration > 0 ? `-${formatTime(Math.max(0, duration - scrubValue))}` : formatTime(0)}</span>
        <span className="scrub-time scrub-time--right">{formatTime(duration)}</span>
      </div>

      {/* Buttons row */}
      <div className="transport-row">
        <div className="transport-buttons">
          <button className="btn-transport btn-stop" onClick={onStop} disabled={!duration} title={t(lang, 'stop')}>⏹</button>

          {playState === 'playing' ? (
            <button className="btn-transport btn-play active" onClick={onPause} disabled={!duration} title={t(lang, 'pause')}>⏸</button>
          ) : (
            <button className="btn-transport btn-play" onClick={onPlay} disabled={!duration} title={t(lang, 'play')}>▶</button>
          )}

          <button
            className={`btn-transport btn-loop${loop ? ' active' : ''}`}
            onClick={() => setLoop(!loop)}
            title={t(lang, 'loop')}
          >🔁</button>

          {/* A-B Loop controls */}
          <div className="ab-loop-controls">
            <button
              className={`btn-ab${loopA !== null ? ' active' : ''}`}
              onClick={() => setLoopA(loopA !== null ? null : currentTime)}
              disabled={!duration}
              title={t(lang, 'loopA')}
            >A</button>
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

          {hasLoopRegion && (
            <span className="ab-loop-times">
              {formatTime(loopA!)} → {formatTime(loopB!)}
            </span>
          )}
        </div>
      </div>

      {/* Offset control */}
      <div className="offset-row">
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
    </div>
  )
}
