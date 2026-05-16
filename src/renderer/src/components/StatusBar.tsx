import React, { useState } from 'react'
import { useStore } from '../store'
import { t } from '../i18n'
import { PreShowCheck } from './PreShowCheck'
import type { SettingsSection } from './SettingsModal'

const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
const mod = isMac ? '⌘' : 'Ctrl'

const SHORTCUTS_BASE: Array<{ key: string; label: (lang: 'en' | 'zh' | 'ja') => string }> = [
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
  // Sprint A — F4 marker navigation
  { key: 'J',               label: (l) => t(l, 'scKeyJ') },
  { key: 'K',               label: (l) => t(l, 'scKeyK') },
  // Sprint A — F3 beat-aligned offset
  { key: 'Shift+,',         label: (l) => t(l, 'scShiftComma') },
  { key: 'Shift+.',         label: (l) => t(l, 'scShiftPeriod') },
  { key: `${mod}+,`,        label: (l) => t(l, 'scCtrlComma') },
  { key: `${mod}+.`,        label: (l) => t(l, 'scCtrlPeriod') },
]

interface Props {
  version: string
  onToggleFullscreen: () => void
  onSwitchToGenerator?: () => void
  /** Sprint UI-Reorg AC-6.2 — open Settings modal at a specific section.
   *  Pill clicks (LTC/MTC/Art-Net/OSC) call this with 'outputs'. */
  onOpenSettings?: (section?: SettingsSection) => void
}

export function StatusBar({ version, onToggleFullscreen, onSwitchToGenerator, onOpenSettings }: Props): React.JSX.Element {
  const {
    lang, setLang, midiConnected, ltcSignalOk, artnetEnabled, oscEnabled,
    playState, tcGeneratorMode, showLocked, setShowLocked,
    chaseEnabled, setChaseEnabled, chaseStatus,
    ltcInputDeviceId,
  } = useStore()
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showPreShow, setShowPreShow] = useState(false)

  // Sprint UI-Reorg AC-6.1 — pills now open Settings → Outputs (instead of
  // the deleted Devices tab). Use the prop callback so the modal state stays
  // owned by App.tsx.
  const goOutputs = (): void => onOpenSettings?.('outputs')

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
          onClick={goOutputs}
          title="LTC Signal"
        >
          <span className={`status-dot${ltcSignalOk ? ' status-dot--ok' : ''}${ltcSignalOk && playState === 'playing' ? ' status-dot--pulse' : ''}`} />
          LTC
        </button>
        <button
          className={`status-pill${midiConnected ? ' status-pill--active' : ''}`}
          onClick={goOutputs}
          title="MIDI Timecode output"
        >
          <span className={`status-dot${midiConnected ? ' status-dot--ok' : ''}${midiConnected && playState === 'playing' ? ' status-dot--pulse' : ''}`} />
          MTC
        </button>
        <button
          className={`status-pill${artnetEnabled ? ' status-pill--active' : ''}`}
          onClick={goOutputs}
          title="Art-Net output"
        >
          <span className={`status-dot${artnetEnabled ? ' status-dot--ok' : ''}${artnetEnabled && playState === 'playing' ? ' status-dot--pulse' : ''}`} />
          Art-Net
        </button>
        <button
          className={`status-pill${oscEnabled ? ' status-pill--active' : ''}`}
          onClick={goOutputs}
          title="OSC output"
        >
          <span className={`status-dot${oscEnabled ? ' status-dot--ok' : ''}${oscEnabled && playState === 'playing' ? ' status-dot--pulse' : ''}`} />
          OSC
        </button>

        {/* LTC Chase toggle. Status-coloured dot:
              chasing      → cyan (ok)
              freewheeling → amber (warn)
              lost         → red (warn)
              idle/off     → grey
            Click toggles chaseEnabled. Long-click via Settings link surfaces
            advanced options. */}
        <button
          className={`status-pill${chaseEnabled ? ' status-pill--active' : ''}${chaseEnabled && chaseStatus === 'freewheeling' ? ' status-pill--warn' : ''}`}
          onClick={() => setChaseEnabled(!chaseEnabled)}
          title={
            // Surface the most actionable diagnostic in the tooltip:
            // if chase is in 'lost' AND there's no input device, the
            // operator's next step is to go to Settings → Devices.
            chaseEnabled && chaseStatus === 'lost' && !ltcInputDeviceId
              ? t(lang, 'ltcInputNotConfiguredHint')
              : t(lang, 'chaseMode')
          }
        >
          <span
            className={`status-dot${
              chaseEnabled && chaseStatus === 'chasing' ? ' status-dot--ok' :
                chaseEnabled && chaseStatus === 'freewheeling' ? ' status-dot--warn' :
                  chaseEnabled && chaseStatus === 'lost' ? ' status-dot--warn' : ''
            }${chaseEnabled && chaseStatus === 'chasing' ? ' status-dot--pulse' : ''}`}
            style={
              chaseEnabled && chaseStatus === 'lost'
                ? { background: '#ef4444', boxShadow: '0 0 4px #ef4444' }
                : undefined
            }
          />
          CHASE
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

        <button className="btn-sm" onClick={() => setShowPreShow(true)} title={t(lang, 'preShowTitle')}>CHECK</button>
        {/* Sprint UI-Reorg Q-A — DARK toggle moved to Settings → Appearance.
            🔒 locked indicator stays here (above) for fast access during shows. */}
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
                {SHORTCUTS_BASE.map((s) => (
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

      {showPreShow && <PreShowCheck onClose={() => setShowPreShow(false)} />}
    </>
  )
}
