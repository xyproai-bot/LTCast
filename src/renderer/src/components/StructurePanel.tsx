import React, { useState, useRef, useEffect } from 'react'
import { useStore, MARKER_TYPES, MARKER_TYPE_COLORS, MarkerType, WaveformMarker } from '../store'
import { t } from '../i18n'

interface Props {
  onSeek: (time: number) => void
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const ms = Math.floor((sec % 1) * 10)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ms}`
}

/** Inline label editor — only commits to store on blur or Enter */
function LabelInput({ value, onChange, placeholder }: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}): React.JSX.Element {
  const [local, setLocal] = useState(value)
  const ref = useRef<HTMLInputElement>(null)

  // Sync when external value changes (e.g. type change auto-sets label)
  useEffect(() => { setLocal(value) }, [value])

  const commit = (): void => {
    if (local !== value) onChange(local)
  }

  return (
    <input
      ref={ref}
      type="text"
      className="structure-label"
      value={local}
      placeholder={placeholder}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { commit(); ref.current?.blur() } }}
    />
  )
}

export function StructurePanel({ onSeek }: Props): React.JSX.Element {
  const {
    lang, filePath, currentTime, duration,
    markers, addMarker, removeMarker, updateMarker
  } = useStore()

  const fileMarkers: WaveformMarker[] = filePath ? (markers[filePath] ?? []) : []
  const sorted = [...fileMarkers].sort((a, b) => a.time - b.time)

  const handleAdd = (): void => {
    if (!filePath) return
    const time = currentTime ?? 0
    addMarker(filePath, {
      id: `marker-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      time,
      label: '',
      type: 'custom'
    })
  }

  const handleTypeChange = (id: string, type: MarkerType): void => {
    if (!filePath) return
    const marker = fileMarkers.find(m => m.id === id)
    const updates: Partial<WaveformMarker> = { type }
    if (marker && !marker.label && type !== 'custom') {
      updates.label = t(lang, `markerType_${type}`)
    }
    updates.color = undefined
    updateMarker(filePath, id, updates)
  }

  const handleLabelCommit = (id: string, label: string): void => {
    if (!filePath) return
    updateMarker(filePath, id, { label })
  }

  const handleColorChange = (id: string, color: string): void => {
    if (!filePath) return
    updateMarker(filePath, id, { color })
  }

  const handleDelete = (id: string): void => {
    if (!filePath) return
    removeMarker(filePath, id)
  }

  if (!filePath) {
    return (
      <div className="structure-panel">
        <div className="structure-panel-empty">{t(lang, 'noFileLoaded')}</div>
      </div>
    )
  }

  return (
    <div className="structure-panel">
      <div className="structure-panel-header">
        <span className="structure-panel-title">{t(lang, 'structureTitle')}</span>
        <button
          className="btn-add-marker"
          onClick={handleAdd}
          disabled={duration <= 0}
          title={t(lang, 'addMarkerAtCurrent')}
        >
          + {t(lang, 'addMarker')}
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="structure-panel-empty">{t(lang, 'noMarkers')}</div>
      ) : (
        <div className="structure-list">
          {sorted.map((marker) => {
            const mType = marker.type ?? 'custom'
            const color = marker.color ?? MARKER_TYPE_COLORS[mType]
            return (
              <div
                key={marker.id}
                className="structure-item"
                onClick={() => onSeek(marker.time)}
                title={t(lang, 'clickToSeek')}
              >
                {/* Color indicator */}
                <input
                  type="color"
                  className="structure-color"
                  value={color}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => handleColorChange(marker.id, e.target.value)}
                />

                {/* Time */}
                <span className="structure-time">{formatTime(marker.time)}</span>

                {/* Type selector */}
                <select
                  className="structure-type"
                  value={mType}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => handleTypeChange(marker.id, e.target.value as MarkerType)}
                >
                  {MARKER_TYPES.map((mt) => (
                    <option key={mt} value={mt}>{t(lang, `markerType_${mt}`)}</option>
                  ))}
                </select>

                {/* Label — commits on blur/Enter, not every keystroke */}
                <LabelInput
                  value={marker.label}
                  onChange={(v) => handleLabelCommit(marker.id, v)}
                  placeholder={t(lang, 'markerLabelPlaceholder')}
                />

                {/* Delete */}
                <button
                  className="structure-delete"
                  onClick={(e) => { e.stopPropagation(); handleDelete(marker.id) }}
                  title={t(lang, 'delete')}
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
