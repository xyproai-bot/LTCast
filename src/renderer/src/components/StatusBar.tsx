import React from 'react'
import { useStore } from '../store'
import { t } from '../i18n'

interface Props {
  version: string
  onToggleFullscreen: () => void
}

export function StatusBar({ version, onToggleFullscreen }: Props): React.JSX.Element {
  const { lang, setLang, midiConnected, ltcSignalOk } = useStore()

  return (
    <div className="status-bar">
      <span className="status-item">
        <span className={`dot${ltcSignalOk ? ' dot-ok' : ' dot-off'}`} />
        LTC
      </span>
      <span className="status-item">
        <span className={`dot${midiConnected ? ' dot-ok' : ' dot-off'}`} />
        MTC
      </span>
      <span style={{ flex: 1 }} />
      <button className="btn-sm" onClick={onToggleFullscreen}>{t(lang, 'fullscreen')}</button>
      <button
        className="btn-sm"
        onClick={() => setLang(lang === 'en' ? 'zh' : lang === 'zh' ? 'ja' : 'en')}
      >
        {lang === 'en' ? '中文' : lang === 'zh' ? '日本語' : 'EN'}
      </button>
      <span className="status-version">v{version}</span>
    </div>
  )
}
