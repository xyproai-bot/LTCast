import React, { useState } from 'react'
import { tcToFrames, framesToTc } from '../audio/timecodeConvert'
import { t } from '../i18n'
import { useStore } from '../store'

const FPS_OPTIONS = [24, 25, 29.97, 30]

function pad2(n: number): string { return String(Math.floor(n)).padStart(2, '0') }

function formatTcResult(tc: { h: number; m: number; s: number; f: number }): string {
  return `${pad2(tc.h)}:${pad2(tc.m)}:${pad2(tc.s)}:${pad2(tc.f)}`
}

function parseTc(input: string, fps: number): string | null {
  const maxFrame = Math.ceil(fps)
  const cleaned = input.trim()
  const parts = cleaned.split(/[:;]/).map(Number)
  if (parts.length === 4 && parts.every(p => !isNaN(p))) {
    const [h, m, s, f] = parts
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59 && s >= 0 && s <= 59 && f >= 0 && f < maxFrame) {
      return `${pad2(h)}:${pad2(m)}:${pad2(s)}:${pad2(f)}`
    }
  }
  if (/^\d{8}$/.test(cleaned)) {
    const h = parseInt(cleaned.slice(0, 2))
    const m = parseInt(cleaned.slice(2, 4))
    const s = parseInt(cleaned.slice(4, 6))
    const f = parseInt(cleaned.slice(6, 8))
    if (h <= 23 && m <= 59 && s <= 59 && f < maxFrame) {
      return `${pad2(h)}:${pad2(m)}:${pad2(s)}:${pad2(f)}`
    }
  }
  return null
}

export function TcCalcPanel(): React.JSX.Element {
  const { lang } = useStore()
  const [fps, setFps] = useState(25)
  const [tcA, setTcA] = useState('01:00:00:00')
  const [tcB, setTcB] = useState('00:00:00:00')
  const [frameInput, setFrameInput] = useState('')

  // TC → Frames
  const parsedA = parseTc(tcA, fps)
  const parsedB = parseTc(tcB, fps)
  const framesA = parsedA ? tcToFrames(parsedA, fps) : null
  const framesB = parsedB ? tcToFrames(parsedB, fps) : null

  // A + B
  const sumResult = framesA !== null && framesB !== null
    ? formatTcResult(framesToTc(framesA + framesB, fps))
    : null

  // A - B
  const diffResult = framesA !== null && framesB !== null && framesA >= framesB
    ? formatTcResult(framesToTc(framesA - framesB, fps))
    : null

  // Duration between A and B (absolute)
  const durationResult = framesA !== null && framesB !== null
    ? formatTcResult(framesToTc(Math.abs(framesA - framesB), fps))
    : null

  // Duration in seconds
  const durationSec = framesA !== null && framesB !== null
    ? (Math.abs(framesA - framesB) / fps).toFixed(3)
    : null

  // Frames → TC
  const frameNum = parseInt(frameInput)
  const frameTcResult = !isNaN(frameNum) && frameNum >= 0
    ? formatTcResult(framesToTc(frameNum, fps))
    : null

  return (
    <div className="tc-calc-panel">
      <div className="tc-calc-title">{t(lang, 'tcCalcTitle')}</div>

      {/* FPS selector */}
      <div className="tc-calc-row">
        <span className="tc-calc-label">FPS</span>
        <div className="tc-gen-fps-buttons">
          {FPS_OPTIONS.map(opt => (
            <button
              key={opt}
              className={`tc-gen-fps-btn${fps === opt ? ' active' : ''}`}
              onClick={() => setFps(opt)}
            >
              {opt === 29.97 ? '29.97' : opt}
            </button>
          ))}
        </div>
      </div>

      {/* TC A input */}
      <div className="tc-calc-row">
        <span className="tc-calc-label">TC A</span>
        <input
          className="tc-calc-input"
          value={tcA}
          onChange={(e) => setTcA(e.target.value)}
          placeholder="HH:MM:SS:FF"
          spellCheck={false}
        />
        {framesA !== null && <span className="tc-calc-frames">= {framesA} fr</span>}
      </div>

      {/* TC B input */}
      <div className="tc-calc-row">
        <span className="tc-calc-label">TC B</span>
        <input
          className="tc-calc-input"
          value={tcB}
          onChange={(e) => setTcB(e.target.value)}
          placeholder="HH:MM:SS:FF"
          spellCheck={false}
        />
        {framesB !== null && <span className="tc-calc-frames">= {framesB} fr</span>}
      </div>

      {/* Results */}
      <div className="tc-calc-results">
        <div className="tc-calc-result-row">
          <span className="tc-calc-op">A + B</span>
          <span className="tc-calc-value">{sumResult ?? '—'}</span>
        </div>
        <div className="tc-calc-result-row">
          <span className="tc-calc-op">A − B</span>
          <span className="tc-calc-value">{diffResult ?? '—'}</span>
        </div>
        <div className="tc-calc-result-row">
          <span className="tc-calc-op">{t(lang, 'tcCalcDuration')}</span>
          <span className="tc-calc-value">{durationResult ?? '—'}{durationSec ? ` (${durationSec}s)` : ''}</span>
        </div>
      </div>

      {/* Frame → TC converter */}
      <div className="tc-calc-divider" />
      <div className="tc-calc-row">
        <span className="tc-calc-label">{t(lang, 'tcCalcFrames')}</span>
        <input
          className="tc-calc-input"
          type="number"
          value={frameInput}
          onChange={(e) => setFrameInput(e.target.value)}
          placeholder="0"
          min={0}
        />
        <span className="tc-calc-value">{frameTcResult ? `= ${frameTcResult}` : ''}</span>
      </div>
    </div>
  )
}
