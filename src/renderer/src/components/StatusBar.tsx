import React, { useState } from 'react'
import { useStore } from '../store'
import { t } from '../i18n'

const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
const mod = isMac ? '⌘' : 'Ctrl'

const SHORTCUTS: Array<{ key: string; label: (lang: 'en' | 'zh' | 'ja') => string }> = [
  { key: 'Space',           label: (l) => t(l, 'scSpace') },
  { key: 'Esc',             label: (l) => t(l, 'scEsc') },
  { key: 'F11',             label: (l) => t(l, 'scF11') },
  { key: '↑',               label: (l) => t(l, 'scUp') },
  { key: '↓',               label: (l) => t(l, 'scDown') },
  { key: '[',               label: (l) => t(l, 'scBracketL') },
  { key: ']',               label: (l) => t(l, 'scBracketR') },
  { key: `${mod}+L`,        label: (l) => t(l, 'scCtrlL') },
  { key: `${mod}+Z`,        label: (l) => t(l, 'scCtrlZ') },
  { key: `${mod}+←`,        label: (l) => t(l, 'scCtrlLeft') },
  { key: `${mod}+→`,        label: (l) => t(l, 'scCtrlRight') },
]

interface Props {
  version: string
  onToggleFullscreen: () => void
  onSwitchToGenerator?: () => void
}

export function StatusBar({ version, onToggleFullscreen, onSwitchToGenerator }: Props): React.JSX.Element {
  const { lang, setLang, midiConnected, ltcSignalOk, artnetEnabled, oscEnabled, playState, tcGeneratorMode, setRightTab, showLocked, setShowLocked } = useStore()
  const [showShortcuts, setShowShortcuts] = useState(false)

  const goDevices = (): void => setRightTab('devices')

  return (
    <>
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

        {!ltcSignalOk && playState === 'playing' && !tcGeneratorMode && (
          <button
            className="status-pill status-pill--warn"
            onClick={onSwitchToGenerator}
            title={t(lang, 'ltcSignalLostPrompt')}
          >
            <span className="status-dot status-dot--warn" />
            {t(lang, 'switchToGenerator')}
          </button>
        )}

        <span style={{ flex: 1 }} />

        <button className="btn-sm" onClick={() => setShowShortcuts(true)} title={t(lang, 'shortcutsTitle')}>?</button>
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

      {showShortcuts && (
        <div className="shortcuts-overlay" onClick={() => setShowShortcuts(false)}>
          <div className="shortcuts-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>{t(lang, 'shortcutsTitle')}</h3>
            <table className="shortcuts-table">
              <tbody>
                {SHORTCUTS.map((s) => (
                  <tr key={s.key}>
                    <td className="shortcuts-key"><kbd>{s.key}</kbd></td>
                    <td className="shortcuts-desc">{s.label(lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="btn-sm" onClick={() => setShowShortcuts(false)} style={{ marginTop: '12px' }}>
              {t(lang, 'shortcutsClose')}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
