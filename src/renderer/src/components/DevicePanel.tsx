import React, { useEffect, useMemo } from 'react'
import { useStore, AudioDevice, ThemeColor, UiSize } from '../store'
import { t } from '../i18n'
import { tcToFrames } from '../audio/timecodeConvert'

interface Props {
  onMidiPortChange: (portId: string) => void
  onMusicDeviceChange: (deviceId: string) => void
  onLtcDeviceChange: (deviceId: string) => void
  onLtcGainChange: (gain: number) => void
  onMusicVolumeChange: (v: number) => void
  onMusicPanChange: (p: number) => void
  onMtcModeChange: (mode: 'quarter-frame' | 'full-frame') => void
  onLtcChannelChange: (ch: import('../store').LtcChannel) => void
}

function isValidIpv4(ip: string): boolean {
  const parts = ip.split('.')
  if (parts.length !== 4) return false
  return parts.every(p => { const n = Number(p); return p !== '' && Number.isInteger(n) && n >= 0 && n <= 255 })
}

function gainToDb(gain: number): string {
  if (gain === 0) return '-∞ dB'
  const db = 20 * Math.log10(gain)
  return (db >= 0 ? '+' : '') + db.toFixed(1) + ' dB'
}

function panToDisplay(pan: number): string {
  if (Math.abs(pan) < 0.01) return 'C'
  const pct = Math.round(Math.abs(pan) * 100)
  return pan < 0 ? `L ${pct}` : `R ${pct}`
}

export function DevicePanel({ onMidiPortChange, onMusicDeviceChange, onLtcDeviceChange, onLtcGainChange, onMusicVolumeChange, onMusicPanChange, onMtcModeChange, onLtcChannelChange }: Props): React.JSX.Element {
  const {
    audioOutputDevices, setAudioOutputDevices,
    musicOutputDeviceId, setMusicOutputDeviceId,
    ltcOutputDeviceId, setLtcOutputDeviceId,
    ltcGain, setLtcGain,
    musicVolume, setMusicVolume,
    musicPan, setMusicPan,
    midiOutputs,
    selectedMidiPort, setSelectedMidiPort,
    midiConnected,
    detectedLtcChannel, ltcChannel, setLtcChannel,
    ltcSignalOk,
    mtcMode, setMtcMode,
    artnetEnabled, setArtnetEnabled,
    artnetTargetIp, setArtnetTargetIp,
    oscEnabled, setOscEnabled,
    oscTargetIp, setOscTargetIp,
    oscTargetPort, setOscTargetPort,
    oscTemplate, setOscTemplate,
    // F3 — OSC Feedback
    oscFeedbackEnabled, setOscFeedbackEnabled,
    oscFeedbackPort, setOscFeedbackPort,
    oscFeedbackBindAddress, setOscFeedbackBindAddress,
    oscFeedbackDevices, recordOscFeedbackDevice, pruneOscFeedbackDevices, clearOscFeedbackDevices,
    timecode,
    midiClockEnabled, setMidiClockEnabled,
    midiClockSource, setMidiClockSource,
    midiClockManualBpm, setMidiClockManualBpm,
    tappedBpm, detectedBpm,
    // Sprint A settings
    numericKeyAction, setNumericKeyAction,
    showLoopDragLabel, setShowLoopDragLabel,
    // Sprint D — F11: Auto Backup settings
    autoBackupEnabled, setAutoBackupEnabled,
    autoBackupIntervalMin, setAutoBackupIntervalMin,
    autoBackupKeepCount, setAutoBackupKeepCount,
    // Theme & UI size
    themeColor, setThemeColor,
    uiSize, setUiSize,
    lang
  } = useStore()

  // Enumerate audio output devices + auto-refresh on plug/unplug
  useEffect(() => {
    const refresh = (): void => {
      navigator.mediaDevices.enumerateDevices().then((devices) => {
        const outputs: AudioDevice[] = devices
          .filter((d) => d.kind === 'audiooutput')
          .map((d) => ({ deviceId: d.deviceId, label: d.label || d.deviceId }))
        setAudioOutputDevices(outputs)
      }).catch(() => {})
    }
    refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh)
  }, [setAudioOutputDevices])

  // F3 — Subscribe to inbound TC ack events from main. Always subscribed so
  // packets that arrive while the user is on a different tab are still
  // recorded; the listener is cheap when no packets flow.
  useEffect(() => {
    const offTc = window.api.onOscFeedbackTc((data) => {
      recordOscFeedbackDevice(data.sourceId, { h: data.h, m: data.m, s: data.s, f: data.f }, data.ts)
    })
    const offErr = window.api.onOscFeedbackError((data) => {
      // Surface as a transient error and force-disable the toggle.
      console.warn('[OSC Feedback] socket error:', data.message)
      setOscFeedbackEnabled(false)
      clearOscFeedbackDevices()
    })
    return () => {
      offTc()
      offErr()
    }
  }, [recordOscFeedbackDevice, setOscFeedbackEnabled, clearOscFeedbackDevices])

  // F3 — Periodic stale-device pruning. 5s timeout per AC-6.
  useEffect(() => {
    if (!oscFeedbackEnabled) return
    const id = setInterval(() => {
      pruneOscFeedbackDevices(Date.now(), 5000)
    }, 1000)
    return () => clearInterval(id)
  }, [oscFeedbackEnabled, pruneOscFeedbackDevices])

  // F3 — Cleanup: when component unmounts, stop the listener so we don't
  // leak a UDP socket. (DevicePanel mount/unmount tracks Devices tab visibility,
  // but in practice the listener should keep running while enabled. We only
  // close on app quit; the renderer doesn't auto-close on unmount.)

  const handleMidiSelect = (portId: string): void => {
    setSelectedMidiPort(portId)
    onMidiPortChange(portId)
  }

  const handleMusicDevice = (deviceId: string): void => {
    setMusicOutputDeviceId(deviceId)
    onMusicDeviceChange(deviceId)
  }

  const handleLtcDevice = (deviceId: string): void => {
    setLtcOutputDeviceId(deviceId)
    onLtcDeviceChange(deviceId)
  }

  const handleLtcGain = (value: number): void => {
    setLtcGain(value)
    onLtcGainChange(value)
  }

  const handleMusicVolume = (value: number): void => {
    setMusicVolume(value)
    onMusicVolumeChange(value)
  }

  const handleMusicPan = (value: number): void => {
    setMusicPan(value)
    onMusicPanChange(value)
  }

  const handleMtcMode = (mode: 'quarter-frame' | 'full-frame'): void => {
    setMtcMode(mode)
    onMtcModeChange(mode)
  }

  const handleLtcChannel = (ch: import('../store').LtcChannel): void => {
    setLtcChannel(ch)
    onLtcChannelChange(ch)
  }

  // F3 — Toggle handler. Validates port + bind, then calls main. On failure,
  // surfaces error via console + disable toggle so UI stays consistent.
  const handleOscFeedbackToggle = async (enabled: boolean): Promise<void> => {
    if (enabled) {
      const result = await window.api.oscFeedbackStart(oscFeedbackPort, oscFeedbackBindAddress)
      if (result.ok) {
        setOscFeedbackEnabled(true)
      } else {
        console.warn('[OSC Feedback] start failed:', result.error)
        setOscFeedbackEnabled(false)
      }
    } else {
      await window.api.oscFeedbackStop()
      setOscFeedbackEnabled(false)
      clearOscFeedbackDevices()
    }
  }

  // Sent TC in absolute frames, used to compute drift for each device.
  // useMemo keeps the calc cheap on rerender; recomputes only when timecode
  // changes (~30 Hz).
  const sentFrames = useMemo<number | null>(() => {
    if (!timecode) return null
    const fps = timecode.fps
    if (!fps || fps <= 0) return null
    const tcStr = `${String(timecode.hours).padStart(2, '0')}:${String(timecode.minutes).padStart(2, '0')}:${String(timecode.seconds).padStart(2, '0')}:${String(timecode.frames).padStart(2, '0')}`
    return tcToFrames(tcStr, fps)
  }, [timecode])

  // Format an inbound TC for display.
  const formatTc = (tc: { h: number; m: number; s: number; f: number }): string => {
    const pad = (n: number): string => String(n).padStart(2, '0')
    return `${pad(tc.h)}:${pad(tc.m)}:${pad(tc.s)}:${pad(tc.f)}`
  }

  // Compute drift colour per Q-C: green ≤1, amber 2-4, red ≥5.
  const driftColor = (driftFrames: number | null): string => {
    if (driftFrames === null) return '#888'
    const abs = Math.abs(driftFrames)
    if (abs <= 1) return '#4ade80'   // green
    if (abs <= 4) return '#fbbf24'   // amber
    return '#ef4444'                 // red
  }

  const feedbackDeviceList = Object.values(oscFeedbackDevices).sort((a, b) => a.sourceId.localeCompare(b.sourceId))

  return (
    <div className="device-panel">
      {/* LTC Status */}
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

      {/* LTC Track selector (manual override) */}
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

      {/* Music Output */}
      <div className="device-row">
        <span className="device-label">{t(lang, 'musicOutput')}</span>
        <select
          className="device-select"
          value={musicOutputDeviceId}
          onChange={(e) => handleMusicDevice(e.target.value)}
        >
          <option value="default">{t(lang, 'defaultDevice')}</option>
          {audioOutputDevices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
          ))}
        </select>
      </div>

      {/* Music Volume */}
      <div className="device-row">
        <span className="device-label">{t(lang, 'musicVolume')}</span>
        <div className="ltc-gain-row">
          <input
            type="range"
            className="ltc-gain-slider"
            min={0}
            max={5.7}
            step={0.01}
            value={musicVolume}
            onChange={(e) => handleMusicVolume(parseFloat(e.target.value))}
            onDoubleClick={() => handleMusicVolume(1.0)}
            onContextMenu={(e) => { e.preventDefault(); handleMusicVolume(1.0) }}
            title="Right-click: reset to 0 dB"
          />
          <span className={`ltc-gain-value${musicVolume > 2.0 ? ' ltc-gain-warn' : ''}`}>
            {gainToDb(musicVolume)}
          </span>
        </div>
      </div>

      {/* Music Pan */}
      <div className="device-row">
        <span className="device-label">{t(lang, 'musicPan')}</span>
        <div className="ltc-gain-row">
          <span className="artnet-ip-label" style={{ minWidth: '14px', textAlign: 'center', fontSize: '10px' }}>{t(lang, 'panLeft')}</span>
          <input
            type="range"
            className="ltc-gain-slider"
            min={-1}
            max={1}
            step={0.01}
            value={musicPan}
            onChange={(e) => handleMusicPan(parseFloat(e.target.value))}
            onDoubleClick={() => handleMusicPan(0)}
            onContextMenu={(e) => { e.preventDefault(); handleMusicPan(0) }}
            title="Right-click: center"
          />
          <span className="artnet-ip-label" style={{ minWidth: '14px', textAlign: 'center', fontSize: '10px' }}>{t(lang, 'panRight')}</span>
          <span className="ltc-gain-value" style={{ minWidth: '34px' }}>
            {panToDisplay(musicPan)}
          </span>
        </div>
      </div>

      {/* LTC Audio Output */}
      <div className="device-row">
        <span className="device-label">{t(lang, 'ltcOutput')}</span>
        <select
          className="device-select"
          value={ltcOutputDeviceId}
          onChange={(e) => handleLtcDevice(e.target.value)}
        >
          <option value="default">{t(lang, 'ltcMuted')}</option>
          {audioOutputDevices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
          ))}
        </select>
      </div>

      {/* LTC Output Level */}
      <div className="device-row">
        <span className="device-label">{t(lang, 'ltcLevel')}</span>
        <div className="ltc-gain-row">
          <input
            type="range"
            className="ltc-gain-slider"
            min={0}
            max={1.5}
            step={0.01}
            value={ltcGain}
            onChange={(e) => handleLtcGain(parseFloat(e.target.value))}
            onDoubleClick={() => handleLtcGain(1.0)}
            onContextMenu={(e) => { e.preventDefault(); handleLtcGain(1.0) }}
            title="Right-click: reset to 0 dB"
          />
          <span className={`ltc-gain-value${ltcGain < 0.9 || ltcGain > 1.2 ? ' ltc-gain-warn' : ''}`}>
            {gainToDb(ltcGain)}
          </span>
        </div>
        <span className="ltc-gain-hint">{t(lang, 'ltcGainHint')}</span>
      </div>

      {/* MTC MIDI Output */}
      <div className="device-row">
        <span className="device-label">{t(lang, 'midiOutput')}</span>
        <select
          className="device-select"
          value={selectedMidiPort ?? ''}
          onChange={(e) => handleMidiSelect(e.target.value)}
        >
          <option value="">{t(lang, 'selectMidiPort')}</option>
          {midiOutputs.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <span className={`signal-dot${midiConnected ? ' signal-ok' : ' signal-off'}`} />
        <span className="signal-label">
          {midiConnected ? t(lang, 'connected') : t(lang, 'disconnected')}
        </span>
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

      {/* MIDI Clock Output */}
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
                  min={20}
                  max={300}
                  step={0.1}
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
        {!selectedMidiPort && (
          <span className="ltc-gain-hint">{t(lang, 'midiClockNoPort')}</span>
        )}
        {selectedMidiPort && (
          <span className="ltc-gain-hint">{t(lang, 'midiClockHint')}</span>
        )}
      </div>

      {/* Art-Net Timecode */}
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
              onBlur={() => {
                // Reset to broadcast if invalid
                if (!isValidIpv4(artnetTargetIp)) {
                  setArtnetTargetIp('255.255.255.255')
                }
              }}
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
              onBlur={() => {
                if (!isValidIpv4(oscTargetIp)) setOscTargetIp('127.0.0.1')
              }}
              placeholder="127.0.0.1"
              spellCheck={false}
            />
            <span className="artnet-ip-label">{t(lang, 'oscTargetPort')}</span>
            <input
              type="number"
              className="artnet-ip-input"
              value={oscTargetPort}
              min={1}
              max={65535}
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

      {/* TC Feedback (F3) — INBOUND OSC ack listener */}
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
              min={1024}
              max={65535}
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
                  // Compute received absolute frames using the sender's local fps.
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

      {/* Sprint A — per-install settings */}
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

      {/* Sprint D — F11: Auto Backup settings */}
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
              min={1}
              max={60}
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
              min={1}
              max={50}
              value={autoBackupKeepCount}
              onChange={(e) => {
                const v = Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 1))
                setAutoBackupKeepCount(v)
              }}
            />
          </div>
        </>
      )}

      {/* Theme Color */}
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
                width: 20,
                height: 20,
                borderRadius: '50%',
                border: themeColor === color ? `2px solid #fff` : '2px solid transparent',
                background: hex,
                cursor: 'pointer',
                padding: 0,
                outline: themeColor === color ? `2px solid ${hex}` : 'none',
                outlineOffset: 2,
                boxSizing: 'border-box',
              }}
            />
          ))}
        </div>
      </div>

      {/* UI Size */}
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
                borderRadius: 4,
                cursor: 'pointer',
                padding: '2px 8px',
                fontSize,
                fontFamily: 'inherit',
                lineHeight: 1.4,
                fontWeight: uiSize === size ? 600 : 400,
              }}
            >
              {label}
            </button>
          ))}
        </div>
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
