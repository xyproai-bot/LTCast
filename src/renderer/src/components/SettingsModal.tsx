/**
 * Sprint UI-Reorg-Option-A — SettingsModal
 *
 * Houses all per-install + per-preset configuration. Five sections, picked
 * from a left sidebar:
 *
 *   Outputs   — LTC level / Music vol+pan / MTC mode / Art-Net / OSC /
 *               OSC Feedback / MIDI Clock
 *   Devices   — Music + LTC output device, LTC channel, MTC port,
 *               MIDI cue port, MIDI input port
 *   Appearance— Theme color, UI size, Ultra-dark toggle, numericKeyAction,
 *               showLoopDragLabel
 *   Backup    — Auto-backup toggle + interval + keep count + open folder
 *   License   — Activate / deactivate, promo redemption, status
 *
 * Layout matches Stitch design: 900×580 modal, 220px sidebar, 56px header,
 * active section is solid #00d4ff background with black text.
 *
 * State (active section + open/closed) is owned by App.tsx and passed via
 * props. ESC closes; overlay click closes. All field edits write through
 * to store actions — no separate draft state.
 */

import React, { useEffect, useMemo, useState } from 'react'
import { useStore, AudioDevice, ThemeColor, UiSize, LtcChannel } from '../store'
import { t } from '../i18n'
import { tcToFrames } from '../audio/timecodeConvert'
import { CHECKOUT_URL_ANNUAL, CHECKOUT_URL_WEEKLY } from '../constants'
import { toast } from './Toast'

export type SettingsSection = 'outputs' | 'devices' | 'chase' | 'appearance' | 'backup' | 'license'

interface Props {
  initialSection?: SettingsSection
  onClose: () => void
  onMidiPortChange: (portId: string) => void
  onMusicDeviceChange: (deviceId: string) => void
  onLtcDeviceChange: (deviceId: string) => void
  onLtcGainChange: (gain: number) => void
  onMtcModeChange: (mode: 'quarter-frame' | 'full-frame') => void
  onLtcChannelChange: (ch: LtcChannel) => void
}

function isValidIpv4(ip: string): boolean {
  const parts = ip.split('.')
  if (parts.length !== 4) return false
  return parts.every(p => { const n = Number(p); return p !== '' && Number.isInteger(n) && n >= 0 && n <= 255 })
}

export function gainToDb(gain: number): string {
  if (gain === 0) return '-∞ dB'
  const db = 20 * Math.log10(gain)
  return (db >= 0 ? '+' : '') + db.toFixed(1) + ' dB'
}

export function panToDisplay(pan: number): string {
  if (Math.abs(pan) < 0.01) return 'C'
  const pct = Math.round(Math.abs(pan) * 100)
  return pan < 0 ? `L ${pct}` : `R ${pct}`
}

export function SettingsModal({
  initialSection = 'outputs',
  onClose,
  onMidiPortChange,
  onMusicDeviceChange,
  onLtcDeviceChange,
  onLtcGainChange,
  onMtcModeChange,
  onLtcChannelChange,
}: Props): React.JSX.Element {
  const [active, setActive] = useState<SettingsSection>(initialSection)
  const lang = useStore(s => s.lang)

  // ESC closes the modal. Use capture phase so we beat global keydown handlers
  // (PreShowCheck, fullscreen, etc.) but still let downstream inputs cancel
  // their own state first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const sections: Array<{ id: SettingsSection; labelKey: 'settingsSection_outputs' | 'settingsSection_devices' | 'settingsSection_chase' | 'settingsSection_appearance' | 'settingsSection_backup' | 'settingsSection_license' }> = [
    { id: 'outputs',    labelKey: 'settingsSection_outputs' },
    { id: 'devices',    labelKey: 'settingsSection_devices' },
    { id: 'chase',      labelKey: 'settingsSection_chase' },
    { id: 'appearance', labelKey: 'settingsSection_appearance' },
    { id: 'backup',     labelKey: 'settingsSection_backup' },
    { id: 'license',    labelKey: 'settingsSection_license' },
  ]

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="settings-header">
          <h1>{t(lang, 'settingsTitle')}</h1>
          <button className="settings-close" onClick={onClose} title={t(lang, 'settingsClose')} aria-label={t(lang, 'settingsClose')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="6" y1="6" x2="18" y2="18" /><line x1="6" y1="18" x2="18" y2="6" />
            </svg>
          </button>
        </header>

        <div className="settings-body">
          <nav className="settings-sidebar">
            {sections.map(s => (
              <button
                key={s.id}
                className={`settings-section-btn${active === s.id ? ' active' : ''}`}
                onClick={() => setActive(s.id)}
              >
                {t(lang, s.labelKey)}
              </button>
            ))}
          </nav>

          <section className="settings-content">
            {active === 'outputs'    && <OutputsSection
              onLtcGainChange={onLtcGainChange}
              onMtcModeChange={onMtcModeChange}
            />}
            {active === 'devices'    && <DevicesSection
              onMidiPortChange={onMidiPortChange}
              onMusicDeviceChange={onMusicDeviceChange}
              onLtcDeviceChange={onLtcDeviceChange}
              onLtcChannelChange={onLtcChannelChange}
            />}
            {active === 'chase'      && <ChaseSection onJumpToDevices={() => setActive('devices')} />}
            {active === 'appearance' && <AppearanceSection />}
            {active === 'backup'     && <BackupSection />}
            {active === 'license'    && <LicenseSection />}
          </section>
        </div>

        <footer className="settings-footer">
          <button className="btn-sm settings-close-btn" onClick={onClose}>
            {t(lang, 'settingsClose')}
          </button>
        </footer>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Section: Outputs — LTC level, Music vol/pan, MTC mode, Art-Net, OSC,
//                    OSC Feedback (bottom), MIDI Clock
// ────────────────────────────────────────────────────────────

interface OutputsSectionProps {
  onLtcGainChange: (gain: number) => void
  onMtcModeChange: (mode: 'quarter-frame' | 'full-frame') => void
}

function OutputsSection({
  onLtcGainChange, onMtcModeChange,
}: OutputsSectionProps): React.JSX.Element {
  const {
    lang,
    ltcGain, setLtcGain,
    mtcMode, setMtcMode,
    artnetEnabled, setArtnetEnabled,
    artnetTargetIp, setArtnetTargetIp,
    oscEnabled, setOscEnabled,
    oscTargetIp, setOscTargetIp,
    oscTargetPort, setOscTargetPort,
    oscTemplate, setOscTemplate,
    oscFeedbackEnabled, setOscFeedbackEnabled,
    oscFeedbackPort, setOscFeedbackPort,
    oscFeedbackBindAddress, setOscFeedbackBindAddress,
    oscFeedbackDevices, recordOscFeedbackDevice, pruneOscFeedbackDevices, clearOscFeedbackDevices,
    timecode,
    midiClockEnabled, setMidiClockEnabled,
    midiClockSource, setMidiClockSource,
    midiClockManualBpm, setMidiClockManualBpm,
    selectedMidiPort,
    tappedBpm, detectedBpm,
    muteLtcFromMusic, setMuteLtcFromMusic,
  } = useStore()

  // F3 — OSC feedback listener subscription
  useEffect(() => {
    const offTc = window.api.onOscFeedbackTc((data) => {
      recordOscFeedbackDevice(data.sourceId, { h: data.h, m: data.m, s: data.s, f: data.f }, data.ts)
    })
    const offErr = window.api.onOscFeedbackError((data) => {
      console.warn('[OSC Feedback] socket error:', data.message)
      setOscFeedbackEnabled(false)
      clearOscFeedbackDevices()
    })
    return () => { offTc(); offErr() }
  }, [recordOscFeedbackDevice, setOscFeedbackEnabled, clearOscFeedbackDevices])

  useEffect(() => {
    if (!oscFeedbackEnabled) return
    const id = setInterval(() => { pruneOscFeedbackDevices(Date.now(), 5000) }, 1000)
    return () => clearInterval(id)
  }, [oscFeedbackEnabled, pruneOscFeedbackDevices])

  const handleLtcGain = (v: number): void => { setLtcGain(v); onLtcGainChange(v) }
  const handleMtcMode = (m: 'quarter-frame' | 'full-frame'): void => { setMtcMode(m); onMtcModeChange(m) }

  const handleOscFeedbackToggle = async (enabled: boolean): Promise<void> => {
    if (enabled) {
      const result = await window.api.oscFeedbackStart(oscFeedbackPort, oscFeedbackBindAddress)
      if (result.ok) setOscFeedbackEnabled(true)
      else { console.warn('[OSC Feedback] start failed:', result.error); setOscFeedbackEnabled(false) }
    } else {
      await window.api.oscFeedbackStop()
      setOscFeedbackEnabled(false)
      clearOscFeedbackDevices()
    }
  }

  const sentFrames = useMemo<number | null>(() => {
    if (!timecode) return null
    const fps = timecode.fps
    if (!fps || fps <= 0) return null
    const tcStr = `${String(timecode.hours).padStart(2, '0')}:${String(timecode.minutes).padStart(2, '0')}:${String(timecode.seconds).padStart(2, '0')}:${String(timecode.frames).padStart(2, '0')}`
    return tcToFrames(tcStr, fps)
  }, [timecode])

  const formatTc = (tc: { h: number; m: number; s: number; f: number }): string => {
    const pad = (n: number): string => String(n).padStart(2, '0')
    return `${pad(tc.h)}:${pad(tc.m)}:${pad(tc.s)}:${pad(tc.f)}`
  }
  const driftColor = (driftFrames: number | null): string => {
    if (driftFrames === null) return '#888'
    const abs = Math.abs(driftFrames)
    if (abs <= 1) return '#4ade80'
    if (abs <= 4) return '#fbbf24'
    return '#ef4444'
  }
  const feedbackDeviceList = Object.values(oscFeedbackDevices).sort((a, b) => a.sourceId.localeCompare(b.sourceId))

  return (
    <div className="device-panel">
      {/* LTC Level */}
      <div className="device-row">
        <span className="device-label">{t(lang, 'ltcLevel')}</span>
        <div className="ltc-gain-row">
          <input
            type="range"
            className="ltc-gain-slider"
            min={0} max={1.5} step={0.01}
            value={ltcGain}
            onChange={(e) => handleLtcGain(parseFloat(e.target.value))}
            onDoubleClick={() => handleLtcGain(1.0)}
            onContextMenu={(e) => { e.preventDefault(); handleLtcGain(1.0) }}
            title="Right-click: reset to 0 dB"
          />
          <span className={`ltc-gain-value${ltcGain < 0.9 || ltcGain > 1.2 ? ' ltc-gain-warn' : ''}`}>{gainToDb(ltcGain)}</span>
        </div>
        <span className="ltc-gain-hint">{t(lang, 'ltcGainHint')}</span>
      </div>

      {/* Mute LTC channel from music output */}
      <div className="device-row">
        <span className="device-label">{t(lang, 'muteLtcFromMusic')}</span>
        <div className="artnet-row">
          <label className="artnet-toggle">
            <input
              type="checkbox"
              checked={muteLtcFromMusic}
              onChange={(e) => setMuteLtcFromMusic(e.target.checked)}
            />
            <span>{muteLtcFromMusic ? t(lang, 'artnetOn') : t(lang, 'artnetOff')}</span>
          </label>
        </div>
        <span className="ltc-gain-hint">{t(lang, 'muteLtcFromMusicHint')}</span>
      </div>

      {/* MTC Mode */}
      <div className="device-row">
        <span className="device-label">{t(lang, 'mtcModeLabel')}</span>
        <select
          className="device-select"
          value={mtcMode}
          onChange={(e) => handleMtcMode(e.target.value as 'quarter-frame' | 'full-frame')}
        >
          <option value="quarter-frame">{t(lang, 'mtcModeQuarterFrame')}</option>
          <option value="full-frame">{t(lang, 'mtcModeFullFrame')}</option>
        </select>
        <span className="ltc-gain-hint">{t(lang, 'mtcModeHint')}</span>
      </div>

      {/* MIDI Clock */}
      <div className="device-row">
        <span className="device-label">{t(lang, 'midiClockEnabled')}</span>
        <div className="artnet-row">
          <label className="artnet-toggle">
            <input
              type="checkbox"
              checked={midiClockEnabled}
              disabled={!selectedMidiPort}
              onChange={(e) => setMidiClockEnabled(e.target.checked)}
            />
            <span>{midiClockEnabled ? t(lang, 'artnetOn') : t(lang, 'artnetOff')}</span>
          </label>
          <span className={`signal-dot${midiClockEnabled && selectedMidiPort ? ' signal-ok' : ' signal-off'}`} />
        </div>
        {midiClockEnabled && selectedMidiPort && (
          <>
            <div className="artnet-ip-row">
              <span className="artnet-ip-label">{t(lang, 'midiClockSource')}</span>
              <select
                className="device-select"
                value={midiClockSource}
                onChange={(e) => setMidiClockSource(e.target.value as 'detected' | 'tapped' | 'manual')}
                style={{ width: 'auto', minWidth: '110px' }}
              >
                <option value="detected">{t(lang, 'midiClockSourceDetected')}{detectedBpm ? ` (${detectedBpm})` : ''}</option>
                <option value="tapped">{t(lang, 'midiClockSourceTapped')}{tappedBpm ? ` (${tappedBpm})` : ''}</option>
                <option value="manual">{t(lang, 'midiClockSourceManual')}</option>
              </select>
            </div>
            {midiClockSource === 'manual' && (
              <div className="artnet-ip-row">
                <span className="artnet-ip-label">{t(lang, 'midiClockManualBpm')}</span>
                <input
                  type="number"
                  className="artnet-ip-input"
                  value={midiClockManualBpm}
                  min={20} max={300} step={0.1}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    if (!isNaN(v)) setMidiClockManualBpm(v)
                  }}
                  style={{ width: '80px' }}
                />
              </div>
            )}
          </>
        )}
        {!selectedMidiPort && <span className="ltc-gain-hint">{t(lang, 'midiClockNoPort')}</span>}
        {selectedMidiPort && <span className="ltc-gain-hint">{t(lang, 'midiClockHint')}</span>}
      </div>

      {/* Art-Net */}
      <div className="device-row">
        <span className="device-label">{t(lang, 'artnetOutput')}</span>
        <div className="artnet-row">
          <label className="artnet-toggle">
            <input
              type="checkbox"
              checked={artnetEnabled}
              onChange={(e) => setArtnetEnabled(e.target.checked)}
            />
            <span>{artnetEnabled ? t(lang, 'artnetOn') : t(lang, 'artnetOff')}</span>
          </label>
          <span className={`signal-dot${artnetEnabled ? ' signal-ok' : ' signal-off'}`} />
        </div>
        {artnetEnabled && (
          <div className="artnet-ip-row">
            <span className="artnet-ip-label">{t(lang, 'artnetTargetIp')}</span>
            <input
              type="text"
              className={`artnet-ip-input${!isValidIpv4(artnetTargetIp) ? ' artnet-ip-invalid' : ''}`}
              value={artnetTargetIp}
              onChange={(e) => setArtnetTargetIp(e.target.value)}
              onBlur={() => { if (!isValidIpv4(artnetTargetIp)) setArtnetTargetIp('255.255.255.255') }}
              placeholder="255.255.255.255"
              spellCheck={false}
            />
          </div>
        )}
        <span className="ltc-gain-hint">{t(lang, 'artnetHint')}</span>
      </div>

      {/* OSC Output */}
      <div className="device-row">
        <span className="device-label">{t(lang, 'oscEnabled')}</span>
        <div className="artnet-row">
          <label className="artnet-toggle">
            <input
              type="checkbox"
              checked={oscEnabled}
              onChange={(e) => setOscEnabled(e.target.checked)}
            />
            <span>{oscEnabled ? t(lang, 'artnetOn') : t(lang, 'artnetOff')}</span>
          </label>
          <span className={`signal-dot${oscEnabled ? ' signal-ok' : ' signal-off'}`} />
          {oscEnabled && <span className="signal-label">{t(lang, 'oscStatus')}</span>}
        </div>
        {oscEnabled && (
          <div className="artnet-ip-row">
            <span className="artnet-ip-label">{t(lang, 'oscTargetIp')}</span>
            <input
              type="text"
              className={`artnet-ip-input${!isValidIpv4(oscTargetIp) ? ' artnet-ip-invalid' : ''}`}
              value={oscTargetIp}
              onChange={(e) => setOscTargetIp(e.target.value)}
              onBlur={() => { if (!isValidIpv4(oscTargetIp)) setOscTargetIp('127.0.0.1') }}
              placeholder="127.0.0.1"
              spellCheck={false}
            />
            <span className="artnet-ip-label">{t(lang, 'oscTargetPort')}</span>
            <input
              type="number"
              className="artnet-ip-input"
              value={oscTargetPort}
              min={1} max={65535}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10)
                if (!isNaN(v) && v > 0 && v <= 65535) setOscTargetPort(v)
              }}
              style={{ width: '70px' }}
            />
          </div>
        )}
        {oscEnabled && (
          <div className="artnet-ip-row">
            <span className="artnet-ip-label">{t(lang, 'oscTemplate')}</span>
            <select
              className="device-select"
              value={oscTemplate}
              onChange={(e) => setOscTemplate(e.target.value as 'generic' | 'resolume' | 'disguise' | 'watchout')}
              style={{ width: 'auto', minWidth: '110px' }}
            >
              <option value="generic">Generic (/timecode)</option>
              <option value="resolume">Resolume Arena</option>
              <option value="disguise">Disguise (d3)</option>
              <option value="watchout">WATCHOUT</option>
            </select>
          </div>
        )}
      </div>

      {/* OSC Feedback (Q-D: bottom of Outputs section) */}
      <div className="device-row">
        <span className="device-label">{t(lang, 'oscFeedbackTitle')}</span>
        <div className="artnet-row">
          <label className="artnet-toggle">
            <input
              type="checkbox"
              checked={oscFeedbackEnabled}
              onChange={(e) => { handleOscFeedbackToggle(e.target.checked) }}
            />
            <span>{oscFeedbackEnabled ? t(lang, 'artnetOn') : t(lang, 'artnetOff')}</span>
          </label>
          <span className={`signal-dot${oscFeedbackEnabled ? ' signal-ok' : ' signal-off'}`} />
          {oscFeedbackEnabled && <span className="signal-label">{t(lang, 'oscFeedbackActive')}</span>}
        </div>
        {!oscFeedbackEnabled && (
          <div className="artnet-ip-row">
            <span className="artnet-ip-label">{t(lang, 'oscFeedbackPort')}</span>
            <input
              type="number"
              className="artnet-ip-input"
              value={oscFeedbackPort}
              min={1024} max={65535}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10)
                if (Number.isInteger(v) && v >= 1024 && v <= 65535) setOscFeedbackPort(v)
              }}
              style={{ width: '70px' }}
            />
            <span className="artnet-ip-label">{t(lang, 'oscFeedbackBind')}</span>
            <select
              className="device-select"
              value={oscFeedbackBindAddress}
              onChange={(e) => {
                const v = e.target.value
                if (v === '127.0.0.1' || v === '0.0.0.0') setOscFeedbackBindAddress(v)
              }}
              style={{ width: 'auto', minWidth: '150px' }}
            >
              <option value="127.0.0.1">{t(lang, 'oscFeedbackBindLocal')}</option>
              <option value="0.0.0.0">{t(lang, 'oscFeedbackBindLan')}</option>
            </select>
          </div>
        )}
        {oscFeedbackEnabled && (
          <span className="ltc-gain-hint">
            {oscFeedbackBindAddress === '0.0.0.0'
              ? t(lang, 'oscFeedbackLanWarning')
              : t(lang, 'oscFeedbackHint')}
          </span>
        )}
        {oscFeedbackEnabled && (
          <div className="osc-feedback-list" style={{ marginTop: 8 }}>
            {feedbackDeviceList.length === 0 ? (
              <span className="ltc-gain-hint">{t(lang, 'oscFeedbackNoDevices')}</span>
            ) : (
              feedbackDeviceList.map((d) => {
                let drift: number | null = null
                if (sentFrames !== null && timecode) {
                  const rcvStr = formatTc(d.lastTc)
                  const rcvFrames = tcToFrames(rcvStr, timecode.fps)
                  drift = rcvFrames - sentFrames
                }
                return (
                  <div key={d.sourceId} className="osc-feedback-row" style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '4px 0',
                    fontFamily: 'monospace', fontSize: 12
                  }}>
                    <span style={{ flex: '0 0 auto', minWidth: 140 }}>{d.sourceId}</span>
                    <span style={{ flex: '0 0 auto', minWidth: 110 }}>{formatTc(d.lastTc)}</span>
                    <span style={{ flex: '1 1 auto', color: driftColor(drift) }}>
                      {drift === null ? '—' : (drift >= 0 ? '+' : '') + drift + 'f'}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Section: Devices — output devices + MIDI ports
// ────────────────────────────────────────────────────────────

interface DevicesSectionProps {
  onMidiPortChange: (portId: string) => void
  onMusicDeviceChange: (deviceId: string) => void
  onLtcDeviceChange: (deviceId: string) => void
  onLtcChannelChange: (ch: LtcChannel) => void
}

function DevicesSection({
  onMidiPortChange, onMusicDeviceChange, onLtcDeviceChange, onLtcChannelChange,
}: DevicesSectionProps): React.JSX.Element {
  const {
    lang,
    audioOutputDevices, setAudioOutputDevices,
    musicOutputDeviceId, setMusicOutputDeviceId,
    ltcOutputDeviceId, setLtcOutputDeviceId,
    ltcInputDeviceId, setLtcInputDevice,
    ltcInputChannel, setLtcInputChannel,
    midiOutputs,
    selectedMidiPort, setSelectedMidiPort,
    midiConnected,
    detectedLtcChannel, ltcChannel, setLtcChannel,
    ltcSignalOk,
  } = useStore()

  // Per-render local list of audio INPUT devices (mics, line-ins, virtual
  // input cables). Kept local to this component because nothing else in
  // the app currently consumes the list, and the input enumeration only
  // returns useful labels after the user has granted microphone permission
  // at least once — so we re-enumerate on every mount.
  const [audioInputDevices, setAudioInputDevices] = useState<AudioDevice[]>([])
  // True when at least one audio input device has an empty label, meaning
  // the browser hasn't granted microphone permission yet. Names will look
  // like garbled deviceIds, and virtual cables (VB-Cable Output etc.) won't
  // be recognisable.
  const [needsMicPermission, setNeedsMicPermission] = useState(false)
  const [requestingMic, setRequestingMic] = useState(false)

  // Enumerate audio output AND input devices on mount + on plug/unplug
  useEffect(() => {
    const refresh = (): void => {
      navigator.mediaDevices.enumerateDevices().then((devices) => {
        const outputs: AudioDevice[] = devices
          .filter((d) => d.kind === 'audiooutput')
          .map((d) => ({ deviceId: d.deviceId, label: d.label || d.deviceId }))
        setAudioOutputDevices(outputs)
        const rawInputs = devices.filter((d) => d.kind === 'audioinput')
        const inputs: AudioDevice[] = rawInputs
          .map((d) => ({ deviceId: d.deviceId, label: d.label || d.deviceId }))
        setAudioInputDevices(inputs)
        // Heuristic: if any input has an empty raw label, permission hasn't
        // been granted. Browsers hide labels until getUserMedia is granted
        // at least once. (Drop the empty-deviceId "" sentinel which Chromium
        // returns for the default device.)
        setNeedsMicPermission(
          rawInputs.some(d => d.deviceId !== '' && !d.label)
        )
      }).catch(() => {})
    }
    refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh)
  }, [setAudioOutputDevices])

  // One-shot getUserMedia to unlock real device labels. We open a stream
  // for the briefest moment and immediately release the tracks — the side
  // effect is that subsequent enumerateDevices() returns proper names like
  // "VB-Audio Cable Output (VB-Audio Virtual Cable)" instead of hashes.
  const handleRequestMicPermission = async (): Promise<void> => {
    setRequestingMic(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      stream.getTracks().forEach(t => t.stop())
      // Refresh — labels should now populate
      const devices = await navigator.mediaDevices.enumerateDevices()
      const outputs: AudioDevice[] = devices
        .filter((d) => d.kind === 'audiooutput')
        .map((d) => ({ deviceId: d.deviceId, label: d.label || d.deviceId }))
      setAudioOutputDevices(outputs)
      const rawInputs = devices.filter((d) => d.kind === 'audioinput')
      const inputs: AudioDevice[] = rawInputs
        .map((d) => ({ deviceId: d.deviceId, label: d.label || d.deviceId }))
      setAudioInputDevices(inputs)
      setNeedsMicPermission(
        rawInputs.some(d => d.deviceId !== '' && !d.label)
      )
    } catch (e) {
      console.warn('Microphone permission denied or failed:', e)
    } finally {
      setRequestingMic(false)
    }
  }

  const handleMidiSelect = (portId: string): void => { setSelectedMidiPort(portId); onMidiPortChange(portId) }
  const handleMusicDevice = (deviceId: string): void => { setMusicOutputDeviceId(deviceId); onMusicDeviceChange(deviceId) }
  const handleLtcDevice = (deviceId: string): void => { setLtcOutputDeviceId(deviceId); onLtcDeviceChange(deviceId) }
  const handleLtcChannel = (ch: LtcChannel): void => { setLtcChannel(ch); onLtcChannelChange(ch) }
  // LTC INPUT device select: '' from the dropdown is the "None" sentinel
  // (no input pipeline). Anything else is a real device id which the
  // engine will getUserMedia() against. We do NOT call any output-side
  // wiring here — the engine subscribes to the store change directly.
  const handleLtcInputDevice = (deviceId: string): void => {
    setLtcInputDevice(deviceId === '' ? null : deviceId)
  }

  return (
    <div className="device-panel">
      {/* LTC channel status */}
      <div className="device-row status-row">
        <span className="device-label">{t(lang, 'ltcChannel')}</span>
        <span className="status-badge">
          {detectedLtcChannel !== null
            ? `${t(lang, 'ltcDetected')} CH${detectedLtcChannel + 1}`
            : t(lang, 'ltcNotDetected')}
        </span>
        <span className={`signal-dot${ltcSignalOk ? ' signal-ok' : ' signal-off'}`} />
        <span className="signal-label">{ltcSignalOk ? t(lang, 'ltcSignalOk') : t(lang, 'ltcSignalWeak')}</span>
      </div>

      {/* LTC channel selector */}
      <div className="device-row">
        <span className="device-label">{t(lang, 'ltcChannelSelect')}</span>
        <select
          className="device-select"
          value={ltcChannel}
          onChange={(e) => handleLtcChannel(e.target.value === 'auto' ? 'auto' : Number(e.target.value) as 0 | 1 | 2 | 3)}
        >
          <option value="auto">{t(lang, 'ltcChannelAuto')}</option>
          <option value={0}>CH 1</option>
          <option value={1}>CH 2</option>
          <option value={2}>CH 3</option>
          <option value={3}>CH 4</option>
        </select>
      </div>

      {/* Music output device */}
      <div className="device-row">
        <span className="device-label">{t(lang, 'musicOutput')}</span>
        <select
          className="device-select"
          value={musicOutputDeviceId}
          onChange={(e) => handleMusicDevice(e.target.value)}
        >
          <option value="default">{t(lang, 'defaultDevice')}</option>
          {audioOutputDevices.map((d) => (<option key={d.deviceId} value={d.deviceId}>{d.label}</option>))}
        </select>
      </div>

      {/* LTC output device */}
      <div className="device-row">
        <span className="device-label">{t(lang, 'ltcOutput')}</span>
        <select
          className="device-select"
          value={ltcOutputDeviceId}
          onChange={(e) => handleLtcDevice(e.target.value)}
        >
          <option value="default">{t(lang, 'ltcMuted')}</option>
          {audioOutputDevices.map((d) => (<option key={d.deviceId} value={d.deviceId}>{d.label}</option>))}
        </select>
      </div>

      {/* LTC INPUT device — chase mode */}
      <div className="device-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="device-label">{t(lang, 'ltcInputDevice')}</span>
          <select
            className="device-select"
            value={ltcInputDeviceId ?? ''}
            onChange={(e) => handleLtcInputDevice(e.target.value)}
          >
            <option value="">{t(lang, 'ltcInputDeviceNone')}</option>
            {audioInputDevices.map((d) => (<option key={d.deviceId} value={d.deviceId}>{d.label}</option>))}
          </select>
          <select
            className="device-select"
            value={ltcInputChannel}
            onChange={(e) => setLtcInputChannel(e.target.value === 'auto' ? 'auto' : Number(e.target.value) as 0 | 1 | 2 | 3)}
            disabled={!ltcInputDeviceId}
            title={t(lang, 'ltcInputChannelHint')}
          >
            <option value="auto">{t(lang, 'ltcChannelAuto')}</option>
            <option value={0}>CH 1</option>
            <option value={1}>CH 2</option>
            <option value={2}>CH 3</option>
            <option value={3}>CH 4</option>
          </select>
        </div>
        {needsMicPermission && (
          <button
            type="button"
            onClick={handleRequestMicPermission}
            disabled={requestingMic}
            style={{
              alignSelf: 'flex-start',
              marginTop: 4,
              padding: '6px 12px',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.04em',
              background: 'rgba(0, 212, 255, 0.08)',
              border: '1px solid rgba(0, 212, 255, 0.4)',
              color: 'var(--accent)',
              borderRadius: 4,
              cursor: requestingMic ? 'wait' : 'pointer',
              transition: 'background 0.12s',
            }}
            onMouseEnter={(e) => { if (!requestingMic) e.currentTarget.style.background = 'rgba(0, 212, 255, 0.16)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0, 212, 255, 0.08)' }}
          >
            {requestingMic ? t(lang, 'ltcInputRequestingPermission') : t(lang, 'ltcInputGrantPermission')}
          </button>
        )}
        <span className="ltc-gain-hint">{t(lang, 'ltcInputDeviceHint')}</span>
        {needsMicPermission && (
          <span className="ltc-gain-hint" style={{ color: '#fbbf24', opacity: 0.9 }}>
            {t(lang, 'ltcInputDeviceNamesHidden')}
          </span>
        )}
      </div>

      {/* MTC MIDI port */}
      <div className="device-row">
        <span className="device-label">{t(lang, 'midiOutput')}</span>
        <select
          className="device-select"
          value={selectedMidiPort ?? ''}
          onChange={(e) => handleMidiSelect(e.target.value)}
        >
          <option value="">{t(lang, 'selectMidiPort')}</option>
          {midiOutputs.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
        </select>
        <span className={`signal-dot${midiConnected ? ' signal-ok' : ' signal-off'}`} />
        <span className="signal-label">{midiConnected ? t(lang, 'connected') : t(lang, 'disconnected')}</span>
      </div>

      {/* Help text */}
      <div className="help-text">
        <span style={{ whiteSpace: 'pre-line' }}>
          {t(lang, window.api.platform === 'darwin' ? 'virtualDeviceHelpMac' : 'virtualDeviceHelp')}
        </span>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Section: Chase — LTC chase-mode controls.
// Default: chase disabled; visual + MIDI only (no audio output).
// Operator can override via the toggles below.
// ────────────────────────────────────────────────────────────

function ChaseSection({ onJumpToDevices }: { onJumpToDevices: () => void }): React.JSX.Element {
  const {
    lang,
    chaseEnabled, setChaseEnabled,
    chaseOutputAudio, setChaseOutputAudio,
    chaseFreewheelEnabled, setChaseFreewheelEnabled,
    chaseStatus,
    ltcInputDeviceId,
  } = useStore()

  const noInputDeviceConfigured = !ltcInputDeviceId

  const statusLabel = chaseStatus === 'idle' ? t(lang, 'chaseStatusIdle')
    : chaseStatus === 'chasing' ? t(lang, 'chaseStatusChasing')
      : chaseStatus === 'freewheeling' ? t(lang, 'chaseStatusFreewheeling')
        : t(lang, 'chaseStatusLost')

  const statusColor = chaseStatus === 'chasing' ? '#00d4ff'
    : chaseStatus === 'freewheeling' ? '#fbbf24'
      : chaseStatus === 'lost' ? '#ef4444'
        : '#666'

  return (
    <div className="device-panel">
      {/* Warn if no LTC input device is configured. Chase needs external
          LTC; without an input device the engine sits in 'lost' forever. */}
      {noInputDeviceConfigured && (
        <button
          type="button"
          onClick={onJumpToDevices}
          className="device-row"
          style={{
            color: '#fbbf24',
            background: 'rgba(251, 191, 36, 0.08)',
            border: '1px solid rgba(251, 191, 36, 0.3)',
            borderRadius: 4,
            padding: '8px 12px',
            fontSize: 12,
            cursor: 'pointer',
            textAlign: 'left',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            transition: 'background 0.12s, border-color 0.12s',
            width: '100%',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(251, 191, 36, 0.16)'
            e.currentTarget.style.borderColor = 'rgba(251, 191, 36, 0.5)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(251, 191, 36, 0.08)'
            e.currentTarget.style.borderColor = 'rgba(251, 191, 36, 0.3)'
          }}
          title={t(lang, 'ltcInputJumpToDevicesHint')}
        >
          <span>{t(lang, 'ltcInputNotConfiguredHint')}</span>
          <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>→</span>
        </button>
      )}

      {/* Enable chase mode */}
      <div className="device-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
        <label className="artnet-toggle" style={{ gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={chaseEnabled}
            onChange={(e) => setChaseEnabled(e.target.checked)}
          />
          <span className="device-label" style={{ cursor: 'pointer' }}>{t(lang, 'chaseEnable')}</span>
        </label>
        <span className="ltc-gain-hint" style={{ marginLeft: 28 }}>{t(lang, 'chaseEnableHint')}</span>
      </div>

      {/* Output audio while chasing */}
      <div className="device-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
        <label className="artnet-toggle" style={{ gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={chaseOutputAudio}
            onChange={(e) => setChaseOutputAudio(e.target.checked)}
          />
          <span className="device-label" style={{ cursor: 'pointer' }}>{t(lang, 'chaseOutputAudio')}</span>
        </label>
        <span className="ltc-gain-hint" style={{ marginLeft: 28 }}>{t(lang, 'chaseOutputAudioHint')}</span>
      </div>

      {/* Freewheel toggle — keep running when LTC drops? */}
      <div className="device-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
        <label className="artnet-toggle" style={{ gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={chaseFreewheelEnabled}
            onChange={(e) => setChaseFreewheelEnabled(e.target.checked)}
          />
          <span className="device-label" style={{ cursor: 'pointer' }}>{t(lang, 'chaseFreewheelEnable')}</span>
        </label>
        <span className="ltc-gain-hint" style={{ marginLeft: 28 }}>{t(lang, 'chaseFreewheelHint')}</span>
      </div>

      {/* Status read-out */}
      <div className="device-row" style={{ alignItems: 'center' }}>
        <span className="device-label">{t(lang, 'chaseStatusLabel')}</span>
        <span
          className="status-badge"
          style={{
            color: statusColor,
            borderColor: statusColor,
            padding: '2px 8px',
            borderRadius: 4,
            border: `1px solid ${statusColor}`,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}
        >{statusLabel}</span>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Section: Appearance — theme color, UI size, ultra-dark, per-install prefs
// ────────────────────────────────────────────────────────────

function AppearanceSection(): React.JSX.Element {
  const {
    lang,
    themeColor, setThemeColor,
    uiSize, setUiSize,
    ultraDark, setUltraDark,
    numericKeyAction, setNumericKeyAction,
    showLoopDragLabel, setShowLoopDragLabel,
    doubleClickAddsMarker, setDoubleClickAddsMarker,
  } = useStore()

  return (
    <div className="device-panel">
      {/* Theme color */}
      <div className="device-row" style={{ alignItems: 'center' }}>
        <span className="device-label">{t(lang, 'themeColor')}</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {([
            { color: 'cyan',   hex: '#00d4ff' },
            { color: 'red',    hex: '#ef4444' },
            { color: 'green',  hex: '#10b981' },
            { color: 'orange', hex: '#f59e0b' },
            { color: 'purple', hex: '#a855f7' },
            { color: 'pink',   hex: '#ec4899' },
          ] as Array<{ color: ThemeColor; hex: string }>).map(({ color, hex }) => (
            <button
              key={color}
              title={color}
              onClick={() => setThemeColor(color)}
              style={{
                width: 24, height: 24, borderRadius: '50%',
                border: themeColor === color ? '2px solid #fff' : '2px solid transparent',
                background: hex, cursor: 'pointer', padding: 0,
                outline: themeColor === color ? `2px solid ${hex}` : 'none',
                outlineOffset: 2, boxSizing: 'border-box',
              }}
            />
          ))}
        </div>
      </div>

      {/* UI size */}
      <div className="device-row" style={{ alignItems: 'center' }}>
        <span className="device-label">{t(lang, 'uiSize')}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {([
            { size: 'sm', label: 'Aa', labelKey: 'sizeSmall',  fontSize: 10 },
            { size: 'md', label: 'Aa', labelKey: 'sizeMedium', fontSize: 13 },
            { size: 'lg', label: 'Aa', labelKey: 'sizeLarge',  fontSize: 16 },
          ] as Array<{ size: UiSize; label: string; labelKey: 'sizeSmall' | 'sizeMedium' | 'sizeLarge'; fontSize: number }>).map(({ size, label, labelKey, fontSize }) => (
            <button
              key={size}
              title={t(lang, labelKey)}
              onClick={() => setUiSize(size)}
              style={{
                background: uiSize === size ? 'var(--accent-bg)' : 'transparent',
                border: `1px solid ${uiSize === size ? 'var(--accent)' : '#333'}`,
                color: uiSize === size ? 'var(--accent)' : '#888',
                borderRadius: 4, cursor: 'pointer', padding: '2px 8px',
                fontSize, fontFamily: 'inherit', lineHeight: 1.4,
                fontWeight: uiSize === size ? 600 : 400,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Ultra-dark toggle (moved from StatusBar per Q-A) */}
      <div className="device-row" style={{ alignItems: 'center' }}>
        <label className="artnet-toggle" style={{ gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={ultraDark}
            onChange={(e) => setUltraDark(e.target.checked)}
          />
          <span className="device-label" style={{ cursor: 'pointer' }}>Ultra-dark mode</span>
        </label>
      </div>

      {/* numericKeyAction (Sprint A per-install pref, Q-H → Appearance) */}
      <div className="device-row">
        <span className="device-label">{t(lang, 'numericKeyActionLabel')}</span>
        <select
          className="device-select"
          value={numericKeyAction}
          onChange={(e) => setNumericKeyAction(e.target.value as 'goto-song' | 'goto-marker')}
          style={{ width: 'auto', minWidth: '180px' }}
        >
          <option value="goto-song">{t(lang, 'numericKeyActionGotoSong')}</option>
          <option value="goto-marker">{t(lang, 'numericKeyActionGotoMarker')}</option>
        </select>
      </div>

      {/* showLoopDragLabel */}
      <div className="device-row">
        <label className="artnet-toggle" style={{ gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showLoopDragLabel}
            onChange={(e) => setShowLoopDragLabel(e.target.checked)}
          />
          <span className="device-label" style={{ cursor: 'pointer' }}>{t(lang, 'showLoopDragLabel')}</span>
        </label>
      </div>

      {/* doubleClickAddsMarker — toggle off if user wants only Ctrl+double-click to add */}
      <div className="device-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
        <label className="artnet-toggle" style={{ gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={doubleClickAddsMarker}
            onChange={(e) => setDoubleClickAddsMarker(e.target.checked)}
          />
          <span className="device-label" style={{ cursor: 'pointer' }}>{t(lang, 'doubleClickAddsMarker')}</span>
        </label>
        <span className="ltc-gain-hint" style={{ marginLeft: 28 }}>{t(lang, 'doubleClickAddsMarkerHint')}</span>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Section: Backup — auto-backup prefs + open folder
// ────────────────────────────────────────────────────────────

function BackupSection(): React.JSX.Element {
  const {
    lang,
    autoBackupEnabled, setAutoBackupEnabled,
    autoBackupIntervalMin, setAutoBackupIntervalMin,
    autoBackupKeepCount, setAutoBackupKeepCount,
  } = useStore()

  // Best-effort. Older main builds may not expose openBackupFolder yet —
  // try/catch so we don't blow up the UI.
  const openFolder = async (): Promise<void> => {
    try {
      const api = window.api as unknown as { openBackupFolder?: () => Promise<void> }
      if (typeof api.openBackupFolder === 'function') await api.openBackupFolder()
    } catch (e) { console.warn('openBackupFolder failed:', e) }
  }

  return (
    <div className="device-panel">
      <div className="device-row" style={{ alignItems: 'center' }}>
        <label className="artnet-toggle" style={{ gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={autoBackupEnabled}
            onChange={(e) => setAutoBackupEnabled(e.target.checked)}
          />
          <span className="device-label" style={{ cursor: 'pointer' }}>{t(lang, 'autoBackupEnabled')}</span>
        </label>
      </div>

      {autoBackupEnabled && (
        <>
          <div className="device-row">
            <span className="device-label">{t(lang, 'backupIntervalMin')}</span>
            <input
              type="number"
              className="device-select"
              style={{ width: 70 }}
              min={1} max={60}
              value={autoBackupIntervalMin}
              onChange={(e) => {
                const v = Math.max(1, Math.min(60, parseInt(e.target.value, 10) || 1))
                setAutoBackupIntervalMin(v)
              }}
            />
          </div>
          <div className="device-row">
            <span className="device-label">{t(lang, 'backupKeepCount')}</span>
            <input
              type="number"
              className="device-select"
              style={{ width: 70 }}
              min={1} max={50}
              value={autoBackupKeepCount}
              onChange={(e) => {
                const v = Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 1))
                setAutoBackupKeepCount(v)
              }}
            />
          </div>
        </>
      )}

      <div className="device-row">
        <button className="btn-sm" onClick={openFolder}>Open backups folder</button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Section: License — activate / deactivate / promo
// (Cloned from LicenseDialog body. We don't re-mount LicenseDialog because
//  it has its own overlay; we'd get a modal-in-modal.)
// ────────────────────────────────────────────────────────────

function LicenseSection(): React.JSX.Element {
  const { lang, licenseKey, licenseStatus, licenseExpiresAt, setLicenseKey, setLicenseStatus, setLicenseValidatedAt, setLicenseExpiresAt } = useStore()
  const [inputKey, setInputKey] = useState(licenseKey ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [promoCode, setPromoCode] = useState('')
  const [promoEmail, setPromoEmail] = useState('')
  const [promoLoading, setPromoLoading] = useState(false)
  const [promoMsg, setPromoMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const handleActivate = async (): Promise<void> => {
    const key = inputKey.trim()
    if (!key) return
    setLoading(true); setError(null); setSuccess(null)
    try {
      const result = await window.api.licenseActivate(key)
      if (result.valid) {
        setLicenseKey(key); setLicenseStatus('valid'); setLicenseValidatedAt(Date.now())
        setSuccess(t(lang, 'licenseActivated'))
      } else {
        setError(result.error ?? t(lang, 'licenseInvalid'))
        setLicenseStatus('invalid')
      }
    } catch { setError(t(lang, 'licenseNetworkError')) }
    setLoading(false)
  }

  const handleDeactivate = async (): Promise<void> => {
    if (!licenseKey) return
    if (licenseKey.startsWith('PROMO-')) {
      setLicenseKey(null); setLicenseStatus('none'); setLicenseValidatedAt(null); setLicenseExpiresAt(null)
      setInputKey(''); setSuccess(t(lang, 'licenseDeactivated'))
      return
    }
    setLoading(true); setError(null); setSuccess(null)
    try {
      const result = await window.api.licenseDeactivate(licenseKey)
      if (result.valid) {
        setLicenseKey(null); setLicenseStatus('none'); setLicenseValidatedAt(null); setLicenseExpiresAt(null)
        setInputKey(''); setSuccess(t(lang, 'licenseDeactivated'))
      } else {
        setError(result.error ?? 'Failed to deactivate')
      }
    } catch { setError(t(lang, 'licenseNetworkError')) }
    setLoading(false)
  }

  const handlePromoRedeem = async (): Promise<void> => {
    const code = promoCode.trim()
    const email = promoEmail.trim()
    if (!code) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setPromoMsg({ text: t(lang, 'promoInvalidEmail'), ok: false })
      return
    }
    setPromoLoading(true); setPromoMsg(null)
    try {
      const api = window.api as unknown as { promoRedeem: (c: string, e: string) => Promise<{ ok: boolean; licenseKey?: string; expiresAt?: string; alreadyRedeemed?: boolean; error?: string }> }
      const result = await api.promoRedeem(code, email)
      if (result.ok && result.licenseKey) {
        setLicenseKey(result.licenseKey); setLicenseStatus('valid'); setLicenseValidatedAt(Date.now())
        setLicenseExpiresAt(result.expiresAt || null)
        setPromoMsg({ text: result.alreadyRedeemed ? t(lang, 'promoAlready') : t(lang, 'promoSuccess'), ok: true })
      } else {
        setPromoMsg({ text: result.error || t(lang, 'promoError'), ok: false })
      }
    } catch { setPromoMsg({ text: t(lang, 'promoError'), ok: false }) }
    setPromoLoading(false)
  }

  const statusLabel = licenseStatus === 'valid' ? '✅ Pro'
    : licenseStatus === 'expired' ? '⚠️ Expired'
      : licenseStatus === 'invalid' ? '❌ Invalid' : 'Free'

  return (
    <div className="device-panel">
      <div className="license-status">
        <span>{t(lang, 'licenseCurrentStatus')}:</span>
        <span className={`license-badge license-badge--${licenseStatus}`}>{statusLabel}</span>
      </div>

      {licenseExpiresAt && licenseStatus === 'valid' && (() => {
        const daysLeft = Math.max(0, Math.ceil((new Date(licenseExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
        const expDate = new Date(licenseExpiresAt).toLocaleDateString()
        return (
          <div className="license-expiry">
            {t(lang, 'licenseExpires')}: {expDate} ({daysLeft} {t(lang, 'licenseDaysLeft')})
          </div>
        )
      })()}

      {licenseStatus !== 'valid' && (
        <div className="license-input-row">
          <input
            type="text"
            className="license-input"
            value={inputKey}
            onChange={(e) => setInputKey(e.target.value)}
            placeholder={t(lang, 'licenseKeyPlaceholder')}
            disabled={loading}
            onKeyDown={(e) => { if (e.key === 'Enter') handleActivate() }}
          />
          <button
            className="license-btn license-btn--primary"
            onClick={handleActivate}
            disabled={loading || !inputKey.trim()}
          >
            {loading ? '...' : t(lang, 'licenseActivate')}
          </button>
        </div>
      )}

      {licenseStatus === 'valid' && (
        <div className="license-input-row">
          <span className="license-key-display">{licenseKey?.slice(0, 8)}...{licenseKey?.slice(-4)}</span>
          <button
            className="license-btn license-btn--danger"
            onClick={handleDeactivate}
            disabled={loading}
          >
            {loading ? '...' : t(lang, 'licenseDeactivate')}
          </button>
        </div>
      )}

      {error && <div className="license-error">{error}</div>}
      {success && <div className="license-success">{success}</div>}

      {licenseStatus !== 'valid' && (
        <div className="license-pricing">
          <a className="license-plan license-plan--highlight" href={CHECKOUT_URL_ANNUAL} target="_blank" rel="noopener noreferrer">
            <div className="license-plan-name">ANNUAL</div>
            <div className="license-plan-price">$49<span className="license-plan-per">/year</span></div>
            <div className="license-plan-note">Best value for professionals</div>
          </a>
          <a className="license-plan" href={CHECKOUT_URL_WEEKLY} target="_blank" rel="noopener noreferrer">
            <div className="license-plan-name">7-DAY PASS</div>
            <div className="license-plan-price">$15</div>
            <div className="license-plan-note">Perfect for single events</div>
          </a>
          <div
            className="license-plan"
            style={{ cursor: 'pointer' }}
            onClick={() => {
              const api = window.api as unknown as { copyToClipboard?: (s: string) => void }
              api.copyToClipboard?.('xypro.ai@gmail.com')
              toast.success('Email copied — xypro.ai@gmail.com')
            }}
          >
            <div className="license-plan-name">VOLUME</div>
            <div className="license-plan-price">10+</div>
            <div className="license-plan-note">Rental houses &amp; teams — click to copy email</div>
          </div>
        </div>
      )}

      {licenseStatus !== 'valid' && (
        <div className="promo-section">
          <div className="promo-title">{t(lang, 'promoTitle')}</div>
          <div className="promo-row">
            <input
              type="text"
              className="promo-input"
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
              placeholder={t(lang, 'promoCodePlaceholder')}
              disabled={promoLoading}
              spellCheck={false}
            />
            <input
              type="email"
              className="promo-input promo-email"
              value={promoEmail}
              onChange={(e) => setPromoEmail(e.target.value)}
              placeholder={t(lang, 'promoEmailPlaceholder')}
              disabled={promoLoading}
              onKeyDown={(e) => { if (e.key === 'Enter') handlePromoRedeem() }}
              spellCheck={false}
            />
            <button
              className="license-btn license-btn--primary"
              onClick={handlePromoRedeem}
              disabled={promoLoading || !promoCode.trim() || !promoEmail.trim()}
            >
              {promoLoading ? '...' : t(lang, 'promoRedeem')}
            </button>
          </div>
          {promoMsg && (
            <div className={promoMsg.ok ? 'license-success' : 'license-error'}>{promoMsg.text}</div>
          )}
        </div>
      )}

      <div className="license-footer">
        <a href={CHECKOUT_URL_ANNUAL} target="_blank" rel="noopener noreferrer" className="license-buy-link">
          {t(lang, 'licenseBuyPro')}
        </a>
        <div className="license-powered">Powered by LemonSqueezy</div>
      </div>
    </div>
  )
}
