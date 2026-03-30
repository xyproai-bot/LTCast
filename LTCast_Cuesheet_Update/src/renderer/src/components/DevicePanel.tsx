import React, { useEffect } from 'react'
import { useStore, AudioDevice } from '../store'
import { t } from '../i18n'

interface Props {
  onMidiPortChange: (portId: string) => void
  onMusicDeviceChange: (deviceId: string) => void
  onLtcDeviceChange: (deviceId: string) => void
  onLtcGainChange: (gain: number) => void
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

export function DevicePanel({ onMidiPortChange, onMusicDeviceChange, onLtcDeviceChange, onLtcGainChange, onMtcModeChange, onLtcChannelChange }: Props): React.JSX.Element {
  const {
    audioOutputDevices, setAudioOutputDevices,
    musicOutputDeviceId, setMusicOutputDeviceId,
    ltcOutputDeviceId, setLtcOutputDeviceId,
    ltcGain, setLtcGain,
    midiOutputs,
    selectedMidiPort, setSelectedMidiPort,
    midiConnected,
    detectedLtcChannel, ltcChannel, setLtcChannel,
    ltcSignalOk,
    mtcMode, setMtcMode,
    artnetEnabled, setArtnetEnabled,
    artnetTargetIp, setArtnetTargetIp,
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

  const handleMtcMode = (mode: 'quarter-frame' | 'full-frame'): void => {
    setMtcMode(mode)
    onMtcModeChange(mode)
  }

  const handleLtcChannel = (ch: import('../store').LtcChannel): void => {
    setLtcChannel(ch)
    onLtcChannelChange(ch)
  }

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
          />
          <span className={`ltc-gain-value${ltcGain < 0.9 || ltcGain > 1.2 ? ' ltc-gain-warn' : ''}`}>
            {gainToDb(ltcGain)}
          </span>
          <button className="btn-sm" onClick={() => handleLtcGain(1.0)} title={t(lang, 'resetGain')}>
            0dB
          </button>
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

      {/* Help text */}
      <div className="help-text">
        <span style={{ whiteSpace: 'pre-line' }}>
          {t(lang, window.api.platform === 'darwin' ? 'virtualDeviceHelpMac' : 'virtualDeviceHelp')}
        </span>
      </div>
    </div>
  )
}
