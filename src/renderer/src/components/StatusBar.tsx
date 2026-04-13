import React from 'react'
import { useStore } from '../store'
import { t } from '../i18n'

interface Props {
  version: string
  onToggleFullscreen: () => void
}

export function StatusBar({ version, onToggleFullscreen }: Props): React.JSX.Element {
  const { lang, setLang, midiConnected, ltcSignalOk, artnetEnabled, oscEnabled, setRightTab, showLocked, setShowLocked } = useStore()

  const goDevices = (): void => setRightTab('devices')

  return (
    <div className="status-bar">
      {showLocked && (
        <button
          className="status-pill status-pill--lock"
          onClick={() => setShowLocked(false)}
          title={t(lang, 'uiLocked')}
        >
          {'🔒 '}{t(lang, 'locked')}
        </button>
      )}
      <button
        className={`status-pill${ltcSignalOk ? ' status-pill--active' : ''}`}
        onClick={goDevices}
        title="LTC Signal"
      >
        <span className={`status-dot${ltcSignalOk ? ' status-dot--ok' : ''}`} />
        LTC
      </button>
      <button
        className={`status-pill${midiConnected ? ' status-pill--active' : ''}`}
        onClick={goDevices}
        title="MIDI Timecode output"
      >
        <span className={`status-dot${midiConnected ? ' status-dot--ok' : ''}`} />
        MTC
      </button>
      <button
        className={`status-pill${artnetEnabled ? ' status-pill--active' : ''}`}
        onClick={goDevices}
        title="Art-Net output"
      >
        <span className={`status-dot${artnetEnabled ? ' status-dot--ok' : ''}`} />
        Art-Net
      </button>
      <button
        className={`status-pill${oscEnabled ? ' status-pill--active' : ''}`}
        onClick={goDevices}
        title="OSC output"
      >
        <span className={`status-dot${oscEnabled ? ' status-dot--ok' : ''}`} />
        OSC
      </button>

      <span style={{ flex: 1 }} />

      <button className="btn-sm" onClick={onToggleFullscreen}>{t(lang, 'fullscreen')}</button>
      <button
        className="btn-sm"
        onClick={() => setLang(lang === 'en' ? 'zh' : lang === 'zh' ? 'ja' : 'en')}
      >
        {lang === 'en' ? '中文' : lang === 'zh' ? '日本語' : 'EN'}
      </button>
      <button
        className="status-version"
        onClick={() => window.api.checkForUpdates()}
        title="Check for updates"
      >v{version}</button>
    </div>
  )
}
