import React, { useState } from 'react'
import { useStore, MidiCuePoint, MidiMapping } from '../store'
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
}

function formatTcInput(value: string): string {
  // Strip non-digits
  const digits = value.replace(/\D/g, '').slice(0, 8)
  if (digits.length === 0) return ''
  // Pad to 8 digits
  const padded = digits.padStart(8, '0')
  return `${padded.slice(0, 2)}:${padded.slice(2, 4)}:${padded.slice(4, 6)}:${padded.slice(6, 8)}`
}

function isValidTimecode(tc: string): boolean {
  return /^\d{2}:\d{2}:\d{2}:\d{2}$/.test(tc)
}

export function MidiCuePanel({ onCueMidiPortChange, onMidiInputPortChange, onStartLearn, learningMappingId }: Props): React.JSX.Element {
  const {
    lang,
    midiOutputs,
    midiInputs,
    selectedCueMidiPort, setSelectedCueMidiPort,
    midiInputPort, setMidiInputPort,
    setlist, activeSetlistIndex,
    setSetlistItemMidiCues,
    midiMappings,
    addMidiMapping, updateMidiMapping, removeMidiMapping
  } = useStore()

  const activeSong = activeSetlistIndex !== null ? setlist[activeSetlistIndex] : null
  const cues: MidiCuePoint[] = activeSong?.midiCues ?? []

  // Local state for new cue form
  const [newTc, setNewTc] = useState('00:00:00:00')
  const [newType, setNewType] = useState<MidiCuePoint['messageType']>('note-on')
  const [newChannel, setNewChannel] = useState(1)
  const [newData1, setNewData1] = useState(60)
  const [newData2, setNewData2] = useState(100)
  const [newLabel, setNewLabel] = useState('')

  // --- Cue helpers ---
  const updateCues = (updated: MidiCuePoint[]): void => {
    if (activeSetlistIndex === null) return
    setSetlistItemMidiCues(activeSetlistIndex, updated)
  }

  const handleAddCue = (): void => {
    if (!isValidTimecode(newTc)) return
    const cue: MidiCuePoint = {
      id: nextCueId(),
      triggerTimecode: newTc,
      messageType: newType,
      channel: newChannel,
      data1: newData1,
      data2: newType !== 'program-change' ? newData2 : undefined,
      label: newLabel || undefined,
      enabled: true
    }
    const sorted = [...cues, cue].sort((a, b) => a.triggerTimecode.localeCompare(b.triggerTimecode))
    updateCues(sorted)
    setNewLabel('')
  }

  const handleDeleteCue = (id: string): void => {
    updateCues(cues.filter(c => c.id !== id))
  }

  const handleToggleCue = (id: string): void => {
    updateCues(cues.map(c => c.id === id ? { ...c, enabled: !c.enabled } : c))
  }

  const handleCueMidiPort = (portId: string): void => {
    setSelectedCueMidiPort(portId || null)
    onCueMidiPortChange(portId)
  }

  const handleMidiInputPort = (portId: string): void => {
    setMidiInputPort(portId || null)
    onMidiInputPortChange(portId)
  }

  // --- Mapping helpers ---
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

  return (
    <div className="midi-cue-panel">
      {/* ── Cue Output Port ── */}
      <div className="cue-section">
        <div className="cue-section-title">{t(lang, 'cueMidiOutput')}</div>
        <div className="device-row">
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
          <span className={`signal-dot${selectedCueMidiPort ? ' signal-ok' : ' signal-off'}`} />
        </div>
      </div>

      {/* ── Cue List ── */}
      <div className="cue-section">
        <div className="cue-section-title">
          {t(lang, 'midiCues')}
          {activeSong ? ` — ${activeSong.name}` : ''}
        </div>

        {activeSetlistIndex === null && (
          <div className="cue-empty">{t(lang, 'selectSongForCues')}</div>
        )}

        {activeSetlistIndex !== null && (
          <>
            {/* Cue list */}
            {cues.length === 0 && (
              <div className="cue-empty">{t(lang, 'noCues')}</div>
            )}
            {cues.map((cue) => (
              <div key={cue.id} className={`cue-row${cue.enabled ? '' : ' cue-row--disabled'}`}>
                <input
                  type="checkbox"
                  className="cue-enable"
                  checked={cue.enabled}
                  onChange={() => handleToggleCue(cue.id)}
                  title={t(lang, 'cueEnabled')}
                />
                <span className="cue-tc">{cue.triggerTimecode}</span>
                <span className="cue-type">{cue.messageType === 'program-change' ? 'PC' : cue.messageType === 'note-on' ? 'Note' : 'CC'}</span>
                <span className="cue-ch">Ch{cue.channel}</span>
                <span className="cue-data">
                  {cue.data1}{cue.data2 !== undefined ? `,${cue.data2}` : ''}
                </span>
                {cue.label && <span className="cue-label">{cue.label}</span>}
                <button
                  className="cue-delete"
                  onClick={() => handleDeleteCue(cue.id)}
                  title={t(lang, 'remove')}
                >✕</button>
              </div>
            ))}

            {/* Add cue form */}
            <div className="cue-add-form">
              <div className="cue-form-row">
                <input
                  type="text"
                  className="cue-tc-input"
                  value={newTc}
                  onChange={(e) => setNewTc(formatTcInput(e.target.value))}
                  placeholder="HH:MM:SS:FF"
                  maxLength={11}
                />
                <select
                  className="cue-type-select"
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as MidiCuePoint['messageType'])}
                >
                  <option value="note-on">Note On</option>
                  <option value="control-change">CC</option>
                  <option value="program-change">PC</option>
                </select>
              </div>
              <div className="cue-form-row">
                <label className="cue-form-label">Ch</label>
                <input
                  type="number"
                  className="cue-num-input"
                  min={1} max={16}
                  value={newChannel}
                  onChange={(e) => setNewChannel(Math.max(1, Math.min(16, parseInt(e.target.value) || 1)))}
                />
                <label className="cue-form-label">{newType === 'program-change' ? 'Prog' : newType === 'note-on' ? 'Note' : 'CC'}</label>
                <input
                  type="number"
                  className="cue-num-input"
                  min={0} max={127}
                  value={newData1}
                  onChange={(e) => setNewData1(Math.max(0, Math.min(127, parseInt(e.target.value) || 0)))}
                />
                {newType !== 'program-change' && (
                  <>
                    <label className="cue-form-label">{newType === 'note-on' ? 'Vel' : 'Val'}</label>
                    <input
                      type="number"
                      className="cue-num-input"
                      min={0} max={127}
                      value={newData2}
                      onChange={(e) => setNewData2(Math.max(0, Math.min(127, parseInt(e.target.value) || 0)))}
                    />
                  </>
                )}
              </div>
              <div className="cue-form-row">
                <input
                  type="text"
                  className="cue-label-input"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder={t(lang, 'cueLabelPlaceholder')}
                />
                <button
                  className="btn-sm cue-add-btn"
                  onClick={handleAddCue}
                  disabled={!isValidTimecode(newTc)}
                >
                  + {t(lang, 'addCue')}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── MIDI Input / Mappings ── */}
      <div className="cue-section">
        <div className="cue-section-title">{t(lang, 'midiInput')}</div>
        <div className="device-row">
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
          <span className={`signal-dot${midiInputPort ? ' signal-ok' : ' signal-off'}`} />
        </div>

        <div className="cue-section-subtitle">{t(lang, 'midiMappings')}</div>

        {midiMappings.length === 0 && (
          <div className="cue-empty">{t(lang, 'noMappings')}</div>
        )}

        {midiMappings.map((mapping) => (
          <div key={mapping.id} className={`mapping-row${learningMappingId === mapping.id ? ' mapping-row--learning' : ''}`}>
            <div className="mapping-trigger">
              <select
                className="mapping-select"
                value={mapping.trigger.type}
                onChange={(e) => handleUpdateMappingTriggerType(mapping.id, e.target.value as MidiMapping['trigger']['type'])}
              >
                <option value="note-on">Note</option>
                <option value="control-change">CC</option>
                <option value="program-change">PC</option>
              </select>
              <span className="mapping-label-sm">Ch</span>
              <input
                type="number"
                className="mapping-num"
                min={0} max={16}
                value={mapping.trigger.channel}
                onChange={(e) => handleUpdateMappingTriggerCh(mapping.id, Math.max(0, Math.min(16, parseInt(e.target.value) || 0)))}
                title="0 = any channel"
              />
              <span className="mapping-label-sm">#</span>
              <input
                type="number"
                className="mapping-num"
                min={0} max={127}
                value={mapping.trigger.data1}
                onChange={(e) => handleUpdateMappingTriggerData1(mapping.id, Math.max(0, Math.min(127, parseInt(e.target.value) || 0)))}
              />
            </div>
            <div className="mapping-action-row">
              <span className="mapping-arrow">→</span>
              <select
                className="mapping-select"
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
                  className="mapping-num"
                  min={1}
                  value={(mapping.actionParam ?? 0) + 1}
                  onChange={(e) => handleUpdateMappingParam(mapping.id, Math.max(0, (parseInt(e.target.value) || 1) - 1))}
                  title={t(lang, 'gotoSongIndex')}
                />
              )}
              <button
                className={`btn-sm mapping-learn${learningMappingId === mapping.id ? ' mapping-learn--active' : ''}`}
                onClick={() => onStartLearn(mapping.id)}
              >
                {learningMappingId === mapping.id ? t(lang, 'midiLearnWaiting') : t(lang, 'midiLearn')}
              </button>
              <button
                className="cue-delete"
                onClick={() => handleDeleteMapping(mapping.id)}
                title={t(lang, 'remove')}
              >✕</button>
            </div>
          </div>
        ))}

        <button className="btn-sm cue-add-btn" style={{ marginTop: 6 }} onClick={handleAddMapping}>
          + {t(lang, 'addMapping')}
        </button>
      </div>
    </div>
  )
}
