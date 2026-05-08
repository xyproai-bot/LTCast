import React, { useState, useRef, useEffect } from 'react'
import { useStore, MARKER_TYPES, MARKER_TYPE_COLORS, MarkerType, WaveformMarker } from '../store'
import { t } from '../i18n'

/** Returns the effective color for a marker type, applying preset overrides (AC-1.4). */
export function resolveMarkerTypeColor(
  mType: MarkerType,
  overrides: Partial<Record<MarkerType, string>>
): string {
  return overrides[mType] ?? MARKER_TYPE_COLORS[mType]
}

// Single-letter abbreviations for each marker type (used in waveform badge)
export const MARKER_TYPE_ABBREV: Record<MarkerType, string> = {
  'intro':      'I',
  'verse':      'V',
  'chorus':     'C',
  'bridge':     'B',
  'outro':      'O',
  'break':      'K',
  'song-title': 'S',
  'custom':     '·',
}

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
    lang, filePath, currentTime, duration, setlist,
    markers, addMarker, removeMarker, updateMarker,
    markerTypeFilter, setMarkerTypeFilter,
    markerTypeColorOverrides, setMarkerTypeColorOverride
  } = useStore()

  const [showTypeColors, setShowTypeColors] = useState(false)

  // v8 storage: markers keyed by setlist-item id, not filePath. Resolve the
  // current file's item id; if file isn't in the setlist, no markers (Q-A).
  const itemId = filePath ? (setlist.find(it => it.path === filePath)?.id ?? null) : null
  const fileMarkers: WaveformMarker[] = itemId ? (markers[itemId] ?? []) : []
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

  // Toggle a type in the filter set
  const toggleTypeFilter = (type: MarkerType): void => {
    if (markerTypeFilter.includes(type)) {
      setMarkerTypeFilter(markerTypeFilter.filter(t => t !== type))
    } else {
      setMarkerTypeFilter([...markerTypeFilter, type])
    }
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

      {/* Type filter chips (AC-1.3) */}
      <div className="structure-filter-chips">
        {MARKER_TYPES.map((mt) => {
          const isActive = markerTypeFilter.length === 0 || !markerTypeFilter.includes(mt)
          const color = resolveMarkerTypeColor(mt, markerTypeColorOverrides)
          return (
            <button
              key={mt}
              className={`structure-chip${isActive ? ' active' : ''}`}
              style={isActive ? { background: color, borderColor: color, color: '#fff' } : { borderColor: color, color: color }}
              onClick={() => toggleTypeFilter(mt)}
              title={t(lang, `markerType_${mt}`)}
            >
              {MARKER_TYPE_ABBREV[mt]}
            </button>
          )
        })}
        {markerTypeFilter.length > 0 && (
          <button
            className="structure-chip structure-chip-clear"
            onClick={() => setMarkerTypeFilter([])}
            title={t(lang, 'markerFilterClearAll')}
          >
            ✕
          </button>
        )}
      </div>

      {/* AC-1.4: Per-preset type color overrides */}
      <div className="structure-type-colors-section">
        <button
          className="structure-type-colors-toggle"
          onClick={() => setShowTypeColors(v => !v)}
          title={t(lang, 'markerTypeColorsTitle')}
        >
          {showTypeColors ? '▾' : '▸'} {t(lang, 'markerTypeColorsTitle')}
          {Object.keys(markerTypeColorOverrides).length > 0 && (
            <span className="structure-type-colors-badge">{Object.keys(markerTypeColorOverrides).length}</span>
          )}
        </button>
        {showTypeColors && (
          <div className="structure-type-colors-grid">
            {MARKER_TYPES.map((mt) => {
              const effectiveColor = resolveMarkerTypeColor(mt, markerTypeColorOverrides)
              const hasOverride = !!markerTypeColorOverrides[mt]
              return (
                <div key={mt} className="structure-type-color-row">
                  <input
                    type="color"
                    className="structure-color"
                    value={effectiveColor}
                    title={t(lang, `markerType_${mt}`)}
                    onChange={(e) => setMarkerTypeColorOverride(mt, e.target.value)}
                  />
                  <span className="structure-type-color-label" style={{ color: effectiveColor }}>
                    {MARKER_TYPE_ABBREV[mt]} {t(lang, `markerType_${mt}`)}
                  </span>
                  {hasOverride && (
                    <button
                      className="structure-type-color-reset"
                      onClick={() => setMarkerTypeColorOverride(mt, null)}
                      title={t(lang, 'markerTypeColorReset')}
                    >
                      ↺
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {sorted.length === 0 ? (
        <div className="structure-panel-empty">{t(lang, 'noMarkers')}</div>
      ) : (
        <div className="structure-list">
          {sorted.map((marker) => {
            const mType = marker.type ?? 'custom'
            // Per-marker color override → preset type override → global default
            const color = marker.color ?? resolveMarkerTypeColor(mType, markerTypeColorOverrides)
            // Fade out if this type is in the filter (hidden)
            const isFiltered = markerTypeFilter.length > 0 && markerTypeFilter.includes(mType)
            return (
              <div
                key={marker.id}
                className="structure-item"
                style={isFiltered ? { opacity: 0.3 } : undefined}
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
