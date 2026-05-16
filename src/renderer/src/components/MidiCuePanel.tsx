import React, { useState, useRef, useMemo, useEffect } from 'react'
import { useStore, MidiCuePoint, MidiMapping, WaveformMarker } from '../store'
import { framesToTc, tcToString, tcToFrames } from '../audio/timecodeConvert'
import { formatTimecode } from '../audio/LtcDecoder'
import { t } from '../i18n'

let _cueIdCounter = Date.now()
function nextCueId(): string { return `cue-${++_cueIdCounter}` }

let _mappingIdCounter = Date.now() + 1000000
function nextMappingId(): string { return `map-${++_mappingIdCounter}` }

interface Props {
  onCueMidiPortChange: (portId: string) => void
  onMidiInputPortChange: (portId: string) => void
  onStartLearn: (mappingId: string) => void
  learningMappingId: string | null
  lastFiredCueId?: string | null
  /** Test-fire a cue immediately (sends MIDI via the same path the scheduler uses). */
  onTestFireCue?: (cue: MidiCuePoint) => void
}

const MSG_TYPES: Array<{ value: MidiCuePoint['messageType']; label: string }> = [
  { value: 'note-on',        label: 'NOTE' },
  { value: 'control-change', label: 'CC'   },
  { value: 'program-change', label: 'PC'   },
]

/**
 * Quick-setup presets — common scenarios pre-fill the type/channel/data values
 * so LDs don't need to know the underlying MIDI bytes. The string key matches
 * an i18n key for the dropdown label.
 *
 * "custom" means: don't touch the current form values — keep whatever the user
 * has already filled in (useful as the "do nothing" option in the dropdown).
 */
type QuickSetupKey =
  | 'custom'
  | 'lighting-note'
  | 'lighting-pc'
  | 'resolume-clip'
  | 'resolume-effect'
  | 'disguise'
  | 'daw-transport'

interface QuickSetupPreset {
  i18nKey:
    | 'quickSetupCustom' | 'quickSetupLightingNote' | 'quickSetupLightingPc'
    | 'quickSetupResolumeClip' | 'quickSetupResolumeEffect'
    | 'quickSetupDisguise' | 'quickSetupDawTransport'
  type: MidiCuePoint['messageType']
  channel: number
  data1: number
  data2?: number
}

const QUICK_SETUPS: Record<QuickSetupKey, QuickSetupPreset> = {
  'custom':          { i18nKey: 'quickSetupCustom',          type: 'note-on',        channel: 1,  data1: 60, data2: 100 }, // values ignored when applied
  'lighting-note':   { i18nKey: 'quickSetupLightingNote',    type: 'note-on',        channel: 1,  data1: 60, data2: 100 },
  'lighting-pc':     { i18nKey: 'quickSetupLightingPc',      type: 'program-change', channel: 1,  data1: 0                },
  'resolume-clip':   { i18nKey: 'quickSetupResolumeClip',    type: 'note-on',        channel: 1,  data1: 36, data2: 100 },
  'resolume-effect': { i18nKey: 'quickSetupResolumeEffect',  type: 'control-change', channel: 1,  data1: 11, data2: 64  },
  'disguise':        { i18nKey: 'quickSetupDisguise',        type: 'note-on',        channel: 16, data1: 60, data2: 100 },
  'daw-transport':   { i18nKey: 'quickSetupDawTransport',    type: 'control-change', channel: 1,  data1: 117, data2: 127 },
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/**
 * MIDI note number → scientific pitch name.
 * 60 → "C4", 61 → "C#4", 69 → "A4", etc.
 * Uses the standard convention where MIDI 60 = middle C = C4.
 */
export function noteNumberToName(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 127) return ''
  const note = NOTE_NAMES[n % 12]
  const octave = Math.floor(n / 12) - 1
  return `${note}${octave}`
}

/**
 * Flexible TC parser/normalizer for the add-cue input.
 * Accepts:
 *   "5"         → "00:00:05:00"   (single short number = seconds)
 *   "1:23"      → "00:01:23:00"   (M:S → MM:SS:00)
 *   "1:23:45"   → "00:01:23:45"   (M:S:F → MM:SS:FF, last group = frames)
 *   "1:2:3:4"   → "01:02:03:04"   (H:M:S:F)
 *   "01:02:03:04" → "01:02:03:04" (full form, untouched)
 *
 * Pure-digit paste flow (no colons) is still supported for >4 digits:
 *   "11030200"  → "11:03:02:00"   (8 digits → HHMMSSFF)
 *   "523"       → would be ambiguous → kept as raw to let user fix it.
 *
 * Returns the normalized "HH:MM:SS:FF" if it can parse, else the original
 * input (so the user can keep typing). Use `isValidTimecode` to gate submission.
 */
export function normalizeTcInput(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '') return ''

  // Path 1: colon-separated → split, pad each part, infer position from group count
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':').map(p => p.trim())
    if (parts.every(p => /^\d+$/.test(p))) {
      const nums = parts.map(p => Math.min(99, parseInt(p, 10)))
      let h = 0, m = 0, s = 0, f = 0
      if (nums.length === 1) { s = nums[0] }
      else if (nums.length === 2) { m = nums[0]; s = nums[1] }
      else if (nums.length === 3) { m = nums[0]; s = nums[1]; f = nums[2] }
      else if (nums.length >= 4) { h = nums[0]; m = nums[1]; s = nums[2]; f = nums[3] }
      const pad = (n: number): string => String(n).padStart(2, '0')
      return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`
    }
    return raw  // contains non-digits, leave as-is
  }

  // Path 2: pure digits, no colons.
  // - Reject anything that isn't all digits — return raw so the user can fix it.
  // - 1-2 digits → seconds ("5" → 00:00:05:00).
  // - 3-4 digits → MM:SS ("523" → 00:05:23 → 00:00:05:23 would be ambiguous —
  //   instead treat as M+SS or MM+SS, depending on length).
  // - 5-8 digits → legacy right-padded HHMMSSFF.
  if (!/^\d+$/.test(trimmed)) return raw

  const digits = trimmed
  const pad = (n: number): string => String(n).padStart(2, '0')

  if (digits.length <= 2) {
    return `00:00:${pad(Math.min(99, parseInt(digits, 10)))}:00`
  }
  if (digits.length <= 4) {
    // last 2 = seconds, rest = minutes
    const ss = pad(Math.min(99, parseInt(digits.slice(-2), 10)))
    const mm = pad(Math.min(99, parseInt(digits.slice(0, -2), 10)))
    return `00:${mm}:${ss}:00`
  }
  if (digits.length > 8) return raw
  const padded = digits.padStart(8, '0')
  return `${padded.slice(0, 2)}:${padded.slice(2, 4)}:${padded.slice(4, 6)}:${padded.slice(6, 8)}`
}

export function isValidTimecode(tc: string): boolean {
  return /^\d{2}:\d{2}:\d{2}:\d{2}$/.test(tc)
}

function typeColor(type: MidiCuePoint['messageType']): string {
  if (type === 'note-on')        return 'note'
  if (type === 'control-change') return 'cc'
  return 'pc'
}

/** Add N frames to a TC string (HH:MM:SS:FF), returning a new normalized TC. */
function shiftTcByFrames(tc: string, frames: number, fps: number): string {
  if (!isValidTimecode(tc)) return tc
  const total = tcToFrames(tc, fps) + frames
  return tcToString(framesToTc(Math.max(0, total), fps))
}

type EditableField = 'tc' | 'type' | 'channel' | 'data1' | 'data2' | 'label'

export function MidiCuePanel({
  onCueMidiPortChange, onMidiInputPortChange,
  onStartLearn, learningMappingId, lastFiredCueId, onTestFireCue
}: Props): React.JSX.Element {
  const {
    lang,
    midiOutputs,
    midiInputs,
    selectedCueMidiPort, setSelectedCueMidiPort,
    midiInputPort, setMidiInputPort,
    setlist, activeSetlistIndex,
    setSetlistItemMidiCues,
    updateSetlistItemMidiCue,
    midiMappings,
    addMidiMapping, updateMidiMapping, removeMidiMapping,
    timecode,
    detectedFps,
    offsetFrames: globalOffsetFrames,
    markers
  } = useStore()

  const activeSong = activeSetlistIndex !== null ? setlist[activeSetlistIndex] : null
  const cues: MidiCuePoint[] = activeSong?.midiCues ?? []

  // Per-session memory: last-used type/channel/data so add-form predefaults to it.
  // Lives in refs so it persists across active-song changes within one mount.
  const lastNewTypeRef    = useRef<MidiCuePoint['messageType']>('note-on')
  const lastNewChannelRef = useRef(1)
  const lastNewData1Ref   = useRef(60)
  const lastNewData2Ref   = useRef(100)

  const [newTc, setNewTc]           = useState('00:00:00:00')
  const [newType, setNewType]       = useState<MidiCuePoint['messageType']>(lastNewTypeRef.current)
  const [newChannel, setNewChannel] = useState(lastNewChannelRef.current)
  const [newData1, setNewData1]     = useState(lastNewData1Ref.current)
  const [newData2, setNewData2]     = useState(lastNewData2Ref.current)
  const [newLabel, setNewLabel]     = useState('')
  // Advanced section default collapsed — LDs only need label + TC for the
  // 80% case (after picking a Quick Setup, they're done). Power users expand it.
  const [advancedOpen, setAdvancedOpen] = useState(false)

  // Inline editing state — only one cue field at a time.
  const [editing, setEditing] = useState<{ cueId: string; field: EditableField } | null>(null)
  const [editValue, setEditValue] = useState('')
  const editInputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null)

  // Autofocus + select-all when entering edit mode
  useEffect(() => {
    if (editing && editInputRef.current && 'select' in editInputRef.current) {
      ;(editInputRef.current as HTMLInputElement).select()
    }
  }, [editing])

  const updateCues = (updated: MidiCuePoint[]): void => {
    if (activeSetlistIndex === null) return
    setSetlistItemMidiCues(activeSetlistIndex, updated)
  }

  const handleAddCue = (): void => {
    const normalized = normalizeTcInput(newTc)
    if (!isValidTimecode(normalized)) return
    // Label is now required — the user-facing language is "Trigger", and an
    // un-named trigger is useless to an LD operating live. Disable Add button
    // and bail here just in case.
    const trimmedLabel = newLabel.trim()
    if (trimmedLabel === '') return
    const cue: MidiCuePoint = {
      id: nextCueId(),
      triggerTimecode: normalized,
      messageType: newType,
      channel: newChannel,
      data1: newData1,
      data2: newType !== 'program-change' ? newData2 : undefined,
      label: trimmedLabel,
      enabled: true
    }
    const sorted = [...cues, cue].sort((a, b) => a.triggerTimecode.localeCompare(b.triggerTimecode))
    updateCues(sorted)
    // Remember the last-used set for next time
    lastNewTypeRef.current    = newType
    lastNewChannelRef.current = newChannel
    lastNewData1Ref.current   = newData1
    lastNewData2Ref.current   = newData2
    setNewLabel('')
  }

  // Apply a Quick Setup preset to the add-form. "custom" is a no-op — leaves
  // current values in place so the user can fine-tune manually.
  const handleQuickSetup = (key: QuickSetupKey): void => {
    if (key === 'custom') return
    const p = QUICK_SETUPS[key]
    setNewType(p.type)
    setNewChannel(p.channel)
    setNewData1(p.data1)
    if (p.data2 !== undefined) setNewData2(p.data2)
  }

  const handleDeleteCue = (id: string): void => {
    updateCues(cues.filter(c => c.id !== id))
  }

  const handleToggleCue = (id: string): void => {
    updateCues(cues.map(c => c.id === id ? { ...c, enabled: !c.enabled } : c))
  }

  // Duplicate a cue. Bumps the TC by 1 second to avoid collision with the source.
  const handleDuplicateCue = (id: string): void => {
    if (activeSetlistIndex === null) return
    const src = cues.find(c => c.id === id)
    if (!src) return
    const fps = (timecode?.fps ?? detectedFps ?? 30)
    const fpsInt = Math.round(fps)
    const newTc = shiftTcByFrames(src.triggerTimecode, fpsInt, fps)  // +1 second
    const dup: MidiCuePoint = { ...src, id: nextCueId(), triggerTimecode: newTc }
    const sorted = [...cues, dup].sort((a, b) => a.triggerTimecode.localeCompare(b.triggerTimecode))
    updateCues(sorted)
  }

  // Test-fire button — sends MIDI immediately via the parent's onTestFireCue.
  const handleTestFireCue = (cue: MidiCuePoint): void => {
    if (!onTestFireCue) return
    onTestFireCue(cue)
  }

  // Fill the add-form TC field with the current live timecode.
  const handleUseCurrentTc = (): void => {
    if (!timecode) return
    setNewTc(formatTimecode(timecode).replace(';', ':'))
  }

  // Import markers as cues — one cue per marker, NOTE on with ascending data1.
  // Skips markers whose TC already collides with an existing cue.
  const handleImportMarkers = (): void => {
    if (activeSetlistIndex === null || !activeSong) return
    const songMarkers: WaveformMarker[] = (markers[activeSong.id] ?? []).slice().sort((a, b) => a.time - b.time)
    if (songMarkers.length === 0) return
    const fps = (timecode?.fps ?? detectedFps ?? 30)
    const offset = globalOffsetFrames + (activeSong.offsetFrames ?? 0)
    const existingTcs = new Set(cues.map(c => c.triggerTimecode))
    const additions: MidiCuePoint[] = []
    songMarkers.forEach((m, i) => {
      const frames = Math.round(m.time * fps) + offset
      const tc = tcToString(framesToTc(Math.max(0, frames), fps))
      if (existingTcs.has(tc)) return
      existingTcs.add(tc)
      additions.push({
        id: nextCueId(),
        triggerTimecode: tc,
        messageType: 'note-on',
        channel: 1,
        data1: Math.min(127, 60 + i),
        data2: 100,
        label: m.label || undefined,
        enabled: true
      })
    })
    if (additions.length === 0) return
    const sorted = [...cues, ...additions].sort((a, b) => a.triggerTimecode.localeCompare(b.triggerTimecode))
    updateCues(sorted)
  }

  const handleCueMidiPort = (portId: string): void => {
    setSelectedCueMidiPort(portId || null)
    onCueMidiPortChange(portId)
  }

  const handleMidiInputPort = (portId: string): void => {
    setMidiInputPort(portId || null)
    onMidiInputPortChange(portId)
  }

  const handleAddMapping = (): void => {
    const mapping: MidiMapping = {
      id: nextMappingId(),
      trigger: { type: 'note-on', channel: 0, data1: 0 },
      action: 'play-pause'
    }
    addMidiMapping(mapping)
  }

  const handleDeleteMapping = (id: string): void => {
    removeMidiMapping(id)
  }

  const handleUpdateMappingTriggerType = (id: string, type: MidiMapping['trigger']['type']): void => {
    const m = midiMappings.find(m => m.id === id)
    if (!m) return
    updateMidiMapping(id, { trigger: { ...m.trigger, type } })
  }

  const handleUpdateMappingTriggerCh = (id: string, channel: number): void => {
    const m = midiMappings.find(m => m.id === id)
    if (!m) return
    updateMidiMapping(id, { trigger: { ...m.trigger, channel } })
  }

  const handleUpdateMappingTriggerData1 = (id: string, data1: number): void => {
    const m = midiMappings.find(m => m.id === id)
    if (!m) return
    updateMidiMapping(id, { trigger: { ...m.trigger, data1 } })
  }

  const handleUpdateMappingAction = (id: string, action: MidiMapping['action']): void => {
    updateMidiMapping(id, { action })
  }

  const handleUpdateMappingParam = (id: string, param: number): void => {
    updateMidiMapping(id, { actionParam: param })
  }

  // ── Inline edit helpers ─────────────────────────────────────────────

  const startEdit = (cueId: string, field: EditableField, currentValue: string | number): void => {
    setEditing({ cueId, field })
    setEditValue(String(currentValue))
  }

  const cancelEdit = (): void => {
    setEditing(null)
    setEditValue('')
  }

  // Commit the in-progress inline edit. Returns true if accepted.
  const commitEdit = (): void => {
    if (!editing || activeSetlistIndex === null) return
    const { cueId, field } = editing
    const cue = cues.find(c => c.id === cueId)
    if (!cue) { cancelEdit(); return }

    let patch: Partial<MidiCuePoint> | null = null

    if (field === 'tc') {
      const normalized = normalizeTcInput(editValue)
      if (isValidTimecode(normalized)) {
        patch = { triggerTimecode: normalized }
      }
    } else if (field === 'type') {
      const v = editValue as MidiCuePoint['messageType']
      if (v === 'note-on' || v === 'control-change' || v === 'program-change') {
        patch = { messageType: v }
        // Clear data2 when switching to PC; default it back when leaving PC
        if (v === 'program-change') patch.data2 = undefined
        else if (cue.messageType === 'program-change' && cue.data2 === undefined) patch.data2 = 100
      }
    } else if (field === 'channel') {
      const n = parseInt(editValue, 10)
      if (Number.isFinite(n)) patch = { channel: Math.max(1, Math.min(16, n)) }
    } else if (field === 'data1') {
      const n = parseInt(editValue, 10)
      if (Number.isFinite(n)) patch = { data1: Math.max(0, Math.min(127, n)) }
    } else if (field === 'data2') {
      const n = parseInt(editValue, 10)
      if (Number.isFinite(n)) patch = { data2: Math.max(0, Math.min(127, n)) }
    } else if (field === 'label') {
      patch = { label: editValue.trim() || undefined }
    }

    if (patch) updateSetlistItemMidiCue(activeSetlistIndex, cueId, patch)
    cancelEdit()
  }

  const handleEditKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit() }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
  }

  // Memo so the format string preview for the add form doesn't re-render churn.
  const newData1NoteName = useMemo(
    () => newType === 'note-on' ? noteNumberToName(newData1) : '',
    [newType, newData1]
  )

  // Plain-language explanation for the currently-selected message type. Shown
  // below the type tabs so LDs new to MIDI can pick the right one without
  // hunting through specs.
  const typeHint = newType === 'note-on'        ? t(lang, 'typeHintNote')
                  : newType === 'control-change' ? t(lang, 'typeHintCc')
                  : t(lang, 'typeHintPc')

  const liveTcAvailable = !!timecode
  const normalizedNewTc = normalizeTcInput(newTc)
  const labelTrimmed    = newLabel.trim()
  const canAdd          = isValidTimecode(normalizedNewTc) && labelTrimmed !== ''

  return (
    <div className="midi-cue-panel">

      {/* ── Cue Output Port ── */}
      <div className="cp-section">
        <div className="cp-section-head">
          <span className="cp-section-label">{t(lang, 'cueMidiOutput')}</span>
          <span className={`cp-port-dot${selectedCueMidiPort ? ' cp-port-dot--ok' : ''}`} />
        </div>
        <select
          className="device-select"
          value={selectedCueMidiPort ?? ''}
          onChange={(e) => handleCueMidiPort(e.target.value)}
        >
          <option value="">{t(lang, 'selectMidiPort')}</option>
          {midiOutputs.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* ── Cue List ── */}
      <div className="cp-section">
        <div className="cp-section-head">
          <span className="cp-section-label">
            {t(lang, 'midiCues')}
            {activeSong && <span className="cp-section-song"> — {activeSong.name}</span>}
          </span>
          {activeSetlistIndex !== null && (markers[activeSong?.id ?? ''] ?? []).length > 0 && (
            <button
              className="cp-import-markers-btn"
              onClick={handleImportMarkers}
              title={t(lang, 'importMarkersAsCuesTip')}
            >
              {t(lang, 'importMarkersAsCues')}
            </button>
          )}
        </div>

        {activeSetlistIndex === null ? (
          <div className="cp-empty">{t(lang, 'selectSongForCues')}</div>
        ) : (
          <>
            {/* Cue rows */}
            <div className="cp-cue-list">
              {cues.length === 0 && (
                <div className="cp-empty">{t(lang, 'noCues')}</div>
              )}
              {cues.map((cue) => {
                const isEditingThis = editing?.cueId === cue.id
                const isEditingField = (f: EditableField): boolean => isEditingThis && editing?.field === f

                // Plain-language layout:
                //   Top line  : [toggle ▶] TC · LABEL (big, white)            [dup ✕]
                //   Bottom line: Ch1 · Note C4 · Vel 100  (small, zinc-500)
                // Label is the row's identity; MIDI bytes recede to greyscale.
                const typeName = cue.messageType === 'note-on' ? 'NOTE' : cue.messageType === 'control-change' ? 'CC' : 'PC'
                const data1Label = cue.messageType === 'program-change' ? 'Prog' : cue.messageType === 'note-on' ? 'Note' : 'CC'
                const data2Label = cue.messageType === 'note-on' ? 'Vel' : 'Val'

                return (
                  <div key={cue.id} className={`cp-cue-item cp-cue-item--two-line${cue.enabled ? '' : ' cp-cue-item--off'}${lastFiredCueId === cue.id ? ' cp-cue-item--fired' : ''}`}>
                    <div className="cp-cue-row-main">
                      <button
                        className={`cp-cue-toggle${cue.enabled ? ' cp-cue-toggle--on' : ''}`}
                        onClick={() => handleToggleCue(cue.id)}
                        title={t(lang, 'cueEnabled')}
                      />
                      {/* Test-fire ▶ */}
                      <button
                        className="cp-cue-fire"
                        onClick={() => handleTestFireCue(cue)}
                        disabled={!onTestFireCue || !selectedCueMidiPort}
                        title={t(lang, 'testFireCue')}
                      >
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                          <polygon points="1,1 7,4 1,7" />
                        </svg>
                      </button>

                      {/* TC — inline editable */}
                      {isEditingField('tc') ? (
                        <input
                          ref={el => { if (el) editInputRef.current = el }}
                          type="text"
                          className="cp-cue-tc cp-cue-edit-input"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={handleEditKeyDown}
                        />
                      ) : (
                        <span
                          className="cp-cue-tc cp-cue-editable"
                          onClick={() => startEdit(cue.id, 'tc', cue.triggerTimecode)}
                          title={t(lang, 'cueEditClickHint')}
                        >{cue.triggerTimecode}</span>
                      )}

                      {/* LABEL — the primary identity of the row. Big white text;
                          falls back to "Untitled trigger" italic if empty. */}
                      {isEditingField('label') ? (
                        <input
                          ref={el => { if (el) editInputRef.current = el }}
                          type="text"
                          className="cp-cue-edit-label cp-cue-edit-label--big"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={handleEditKeyDown}
                        />
                      ) : cue.label ? (
                        <span
                          className="cp-cue-label-big cp-cue-editable"
                          title={cue.label}
                          onClick={() => startEdit(cue.id, 'label', cue.label ?? '')}
                        >{cue.label}</span>
                      ) : (
                        <span
                          className="cp-cue-label-big cp-cue-label-big--unnamed cp-cue-editable"
                          onClick={() => startEdit(cue.id, 'label', '')}
                          title={t(lang, 'cueEditClickHint')}
                        >{t(lang, 'triggersUnnamed')}</span>
                      )}

                      {/* Action buttons (right side) */}
                      <button
                        className="cp-cue-dup"
                        onClick={() => handleDuplicateCue(cue.id)}
                        title={t(lang, 'duplicateCue')}
                      >
                        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.25">
                          <rect x="0.5" y="0.5" width="6" height="6" rx="0.5" />
                          <rect x="2.5" y="2.5" width="6" height="6" rx="0.5" />
                        </svg>
                      </button>

                      <button
                        className="cp-cue-del"
                        onClick={() => handleDeleteCue(cue.id)}
                        title={t(lang, 'remove')}
                      >
                        <svg width="8" height="8" viewBox="0 0 8 8" stroke="currentColor" strokeWidth="1.5">
                          <line x1="1" y1="1" x2="7" y2="7"/><line x1="7" y1="1" x2="1" y2="7"/>
                        </svg>
                      </button>
                    </div>

                    {/* Second row — MIDI bytes in plain language, small zinc-500.
                        Each segment is independently click-to-edit for power
                        users; casuals can ignore this row entirely. */}
                    <div className="cp-cue-row-bytes">
                      {/* Type badge (small) */}
                      {isEditingField('type') ? (
                        <select
                          ref={el => { if (el) editInputRef.current = el }}
                          className="cp-cue-edit-select"
                          value={editValue}
                          autoFocus
                          onChange={(e) => {
                            const v = e.target.value as MidiCuePoint['messageType']
                            if (activeSetlistIndex !== null && (v === 'note-on' || v === 'control-change' || v === 'program-change')) {
                              const patch: Partial<MidiCuePoint> = { messageType: v }
                              if (v === 'program-change') patch.data2 = undefined
                              else if (cue.messageType === 'program-change' && cue.data2 === undefined) patch.data2 = 100
                              updateSetlistItemMidiCue(activeSetlistIndex, cue.id, patch)
                            }
                            cancelEdit()
                          }}
                          onBlur={cancelEdit}
                          onKeyDown={(e) => { if (e.key === 'Escape') cancelEdit() }}
                        >
                          <option value="note-on">NOTE</option>
                          <option value="control-change">CC</option>
                          <option value="program-change">PC</option>
                        </select>
                      ) : (
                        <span
                          className={`cp-cue-byte-type cp-cue-byte-type--${typeColor(cue.messageType)} cp-cue-editable`}
                          onClick={() => startEdit(cue.id, 'type', cue.messageType)}
                          title={t(lang, 'cueEditClickHint')}
                        >
                          {typeName}
                        </span>
                      )}

                      {/* Channel · data1 · data2 — plain-language form */}
                      <span className="cp-cue-bytes">
                        {'Ch'}
                        {isEditingField('channel') ? (
                          <input
                            ref={el => { if (el) editInputRef.current = el }}
                            type="number" min={1} max={16}
                            className="cp-cue-edit-num"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={handleEditKeyDown}
                          />
                        ) : (
                          <span className="cp-cue-editable" onClick={() => startEdit(cue.id, 'channel', cue.channel)}>{cue.channel}</span>
                        )}
                        {' · '}
                        {data1Label}{' '}
                        {isEditingField('data1') ? (
                          <input
                            ref={el => { if (el) editInputRef.current = el }}
                            type="number" min={0} max={127}
                            className="cp-cue-edit-num"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={handleEditKeyDown}
                          />
                        ) : (
                          <span className="cp-cue-editable" onClick={() => startEdit(cue.id, 'data1', cue.data1)}>
                            {cue.messageType === 'note-on' ? noteNumberToName(cue.data1) : cue.data1}
                          </span>
                        )}
                        {cue.data2 !== undefined && (
                          <>
                            {' · '}
                            {data2Label}{' '}
                            {isEditingField('data2') ? (
                              <input
                                ref={el => { if (el) editInputRef.current = el }}
                                type="number" min={0} max={127}
                                className="cp-cue-edit-num"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={commitEdit}
                                onKeyDown={handleEditKeyDown}
                              />
                            ) : (
                              <span className="cp-cue-editable" onClick={() => startEdit(cue.id, 'data2', cue.data2 ?? 0)}>{cue.data2}</span>
                            )}
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Add cue form — plain-language layout:
                  Row 1: Label input (primary — "what does this do?")
                  Row 2: TC input + Now button
                  Row 3: Advanced ▼ toggle → expands the MIDI byte controls
                  Row 4 (advanced): Quick Setup dropdown
                  Row 5 (advanced): Type tabs + plain-language hint
                  Row 6 (advanced): Channel + data1 + data2
                  Row 7: Add button (disabled until label + valid TC)
            */}
            <div className="cp-add-form">
              {/* Row 1: Label — first thing user fills in */}
              <div className="cp-form-row">
                <input
                  type="text"
                  className="cp-label-input cp-label-input--primary"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && canAdd) handleAddCue() }}
                  placeholder={t(lang, 'cueLabelPlaceholder')}
                  autoFocus={cues.length === 0}
                />
              </div>

              {/* Row 2: TC + Now */}
              <div className="cp-form-row">
                <input
                  type="text"
                  className="cp-tc-input"
                  value={newTc}
                  onChange={(e) => setNewTc(e.target.value)}
                  onBlur={(e) => setNewTc(normalizeTcInput(e.target.value))}
                  placeholder="HH:MM:SS:FF"
                />
                <button
                  className="cp-tc-now-btn"
                  onClick={handleUseCurrentTc}
                  disabled={!liveTcAvailable}
                  title={t(lang, 'useCurrentTc')}
                >
                  {t(lang, 'now')}
                </button>
              </div>

              {/* Row 3: Advanced toggle — collapsed by default; lets LDs add
                  a basic trigger without ever seeing MIDI bytes. */}
              <div className="cp-form-row">
                <button
                  type="button"
                  className="cp-advanced-toggle"
                  onClick={() => setAdvancedOpen(o => !o)}
                  aria-expanded={advancedOpen}
                >
                  {advancedOpen ? t(lang, 'advancedCollapse') : t(lang, 'advancedExpand')}
                </button>
              </div>

              {advancedOpen && (
                <>
                  {/* Quick Setup — applies preset to form fields below */}
                  <div className="cp-form-row">
                    <span className="cp-form-lbl">{t(lang, 'quickSetup')}</span>
                    <select
                      className="cp-quick-setup"
                      value="custom"
                      onChange={(e) => {
                        handleQuickSetup(e.target.value as QuickSetupKey)
                        // Reset back to "custom" so the dropdown is reusable —
                        // we treat it as a one-shot action, not a sticky mode.
                        e.target.value = 'custom'
                      }}
                    >
                      <option value="custom">{t(lang, 'quickSetupCustom')}</option>
                      <option value="lighting-note">{t(lang, 'quickSetupLightingNote')}</option>
                      <option value="lighting-pc">{t(lang, 'quickSetupLightingPc')}</option>
                      <option value="resolume-clip">{t(lang, 'quickSetupResolumeClip')}</option>
                      <option value="resolume-effect">{t(lang, 'quickSetupResolumeEffect')}</option>
                      <option value="disguise">{t(lang, 'quickSetupDisguise')}</option>
                      <option value="daw-transport">{t(lang, 'quickSetupDawTransport')}</option>
                    </select>
                  </div>

                  {/* Type tabs */}
                  <div className="cp-form-row">
                    <div className="cp-type-tabs">
                      {MSG_TYPES.map(({ value, label }) => (
                        <button
                          key={value}
                          className={`cp-type-tab${newType === value ? ' active' : ''}`}
                          onClick={() => setNewType(value)}
                        >{label}</button>
                      ))}
                    </div>
                  </div>

                  {/* Plain-language hint for selected type */}
                  <div className="cp-form-row cp-form-row--hint">
                    <span className="cp-type-hint">{typeHint}</span>
                  </div>

                  {/* Channel + data fields */}
                  <div className="cp-form-row cp-form-row--params">
                    <span className="cp-form-lbl">Ch</span>
                    <input
                      type="number"
                      className="cp-num"
                      min={1} max={16}
                      value={newChannel}
                      onChange={(e) => setNewChannel(Math.max(1, Math.min(16, parseInt(e.target.value) || 1)))}
                    />
                    <span className="cp-form-lbl">
                      {newType === 'program-change' ? 'Prog' : newType === 'note-on' ? 'Note' : 'CC'}
                    </span>
                    <input
                      type="number"
                      className="cp-num"
                      min={0} max={127}
                      value={newData1}
                      onChange={(e) => setNewData1(Math.max(0, Math.min(127, parseInt(e.target.value) || 0)))}
                    />
                    {newType === 'note-on' && newData1NoteName && (
                      <span className="cp-form-hint">{newData1NoteName}</span>
                    )}
                    {newType !== 'program-change' && (
                      <>
                        <span className="cp-form-lbl">{newType === 'note-on' ? 'Vel' : 'Val'}</span>
                        <input
                          type="number"
                          className="cp-num"
                          min={0} max={127}
                          value={newData2}
                          onChange={(e) => setNewData2(Math.max(0, Math.min(127, parseInt(e.target.value) || 0)))}
                        />
                      </>
                    )}
                  </div>
                </>
              )}

              {/* Add button */}
              <div className="cp-form-row">
                <button
                  className="cp-add-btn cp-add-btn--full"
                  onClick={handleAddCue}
                  disabled={!canAdd}
                  title={!canAdd && labelTrimmed === '' ? t(lang, 'triggerLabelRequiredHint') : undefined}
                >
                  + {t(lang, 'addCue')}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── MIDI Input / Mappings ── */}
      <div className="cp-section">
        <div className="cp-section-head">
          <span className="cp-section-label">{t(lang, 'midiInput')}</span>
          <span className={`cp-port-dot${midiInputPort ? ' cp-port-dot--ok' : ''}`} />
        </div>
        <select
          className="device-select"
          value={midiInputPort ?? ''}
          onChange={(e) => handleMidiInputPort(e.target.value)}
        >
          <option value="">{t(lang, 'selectMidiInputPort')}</option>
          {midiInputs.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <div className="cp-subsection-head">
          <span className="cp-section-label">{t(lang, 'midiMappings')}</span>
          <button className="cp-add-mapping-btn" onClick={handleAddMapping}>
            + {t(lang, 'addMapping')}
          </button>
        </div>

        {midiMappings.length === 0 && (
          <div className="cp-empty">{t(lang, 'noMappings')}</div>
        )}

        {midiMappings.map((mapping) => (
          <div key={mapping.id} className={`cp-mapping${learningMappingId === mapping.id ? ' cp-mapping--learning' : ''}`}>
            {/* Trigger row */}
            <div className="cp-mapping-trigger">
              <span className="cp-mapping-label">IN</span>
              <select
                className="cp-mini-select"
                value={mapping.trigger.type}
                onChange={(e) => handleUpdateMappingTriggerType(mapping.id, e.target.value as MidiMapping['trigger']['type'])}
              >
                <option value="note-on">NOTE</option>
                <option value="control-change">CC</option>
                <option value="program-change">PC</option>
              </select>
              <span className="cp-form-lbl">Ch</span>
              <input
                type="number"
                className="cp-num"
                min={0} max={16}
                value={mapping.trigger.channel}
                onChange={(e) => handleUpdateMappingTriggerCh(mapping.id, Math.max(0, Math.min(16, parseInt(e.target.value) || 0)))}
                title="0 = any channel"
              />
              <span className="cp-form-lbl">#</span>
              <input
                type="number"
                className="cp-num"
                min={0} max={127}
                value={mapping.trigger.data1}
                onChange={(e) => handleUpdateMappingTriggerData1(mapping.id, Math.max(0, Math.min(127, parseInt(e.target.value) || 0)))}
              />
            </div>
            {/* Action row */}
            <div className="cp-mapping-action">
              <span className="cp-mapping-arrow">→</span>
              <select
                className="cp-mini-select cp-mini-select--action"
                value={mapping.action}
                onChange={(e) => handleUpdateMappingAction(mapping.id, e.target.value as MidiMapping['action'])}
              >
                <option value="play">{t(lang, 'play')}</option>
                <option value="pause">{t(lang, 'pause')}</option>
                <option value="stop">{t(lang, 'stop')}</option>
                <option value="play-pause">{t(lang, 'playPause')}</option>
                <option value="next">{t(lang, 'nextSong')}</option>
                <option value="prev">{t(lang, 'prevSong')}</option>
                <option value="goto-song">{t(lang, 'gotoSong')}</option>
              </select>
              {mapping.action === 'goto-song' && (
                <input
                  type="number"
                  className="cp-num"
                  min={1}
                  value={(mapping.actionParam ?? 0) + 1}
                  onChange={(e) => handleUpdateMappingParam(mapping.id, Math.max(0, (parseInt(e.target.value) || 1) - 1))}
                  title={t(lang, 'gotoSongIndex')}
                />
              )}
              <button
                className={`cp-learn-btn${learningMappingId === mapping.id ? ' cp-learn-btn--active' : ''}`}
                onClick={() => onStartLearn(mapping.id)}
              >
                {learningMappingId === mapping.id ? t(lang, 'midiLearnWaiting') : t(lang, 'midiLearn')}
              </button>
              <button
                className="cp-cue-del"
                onClick={() => handleDeleteMapping(mapping.id)}
                title={t(lang, 'remove')}
              >
                <svg width="8" height="8" viewBox="0 0 8 8" stroke="currentColor" strokeWidth="1.5">
                  <line x1="1" y1="1" x2="7" y2="7"/><line x1="7" y1="1" x2="1" y2="7"/>
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
