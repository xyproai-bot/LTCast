import React, { useState, useEffect } from 'react'
import { useStore, WaveformMarker } from '../store'
import { t } from '../i18n'

interface CheckItem {
  label: string
  status: 'checking' | 'ok' | 'warn' | 'fail'
  detail: string
}

interface Props {
  onClose: () => void
}

export function PreShowCheck({ onClose }: Props): React.JSX.Element {
  const { lang } = useStore()
  const [checks, setChecks] = useState<CheckItem[]>([])
  const [running, setRunning] = useState(true)

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      const s = useStore.getState()
      const results: CheckItem[] = []

      // 1. Audio file loaded
      results.push({
        label: t(lang, 'checkFile'),
        status: s.filePath ? 'ok' : 'warn',
        detail: s.filePath ? s.fileName ?? '' : t(lang, 'checkNoFile')
      })

      // 2. Setlist files exist
      if (s.setlist.length > 0) {
        const existResults = await Promise.all(
          s.setlist.map(item => window.api.fileExists(item.path).catch(() => false))
        )
        const missingItems = s.setlist.filter((_, idx) => !existResults[idx])
        const missing = missingItems.length
        let detail: string
        if (missing === 0) {
          detail = `${s.setlist.length} ${t(lang, 'checkSongsOk')}`
        } else {
          const names = missingItems.slice(0, 3).map(item => item.name)
          const extra = missing > 3 ? ` …+${missing - 3} more` : ''
          detail = t(lang, 'checkSetlistFilesDetail', { names: names.join(', ') + extra })
        }
        results.push({
          label: t(lang, 'checkSetlist'),
          status: missing === 0 ? 'ok' : 'fail',
          detail
        })
      }

      // 3. LTC output
      results.push({
        label: 'LTC Output',
        status: s.ltcOutputDeviceId && s.ltcOutputDeviceId !== 'default' ? 'ok' : 'warn',
        detail: s.ltcOutputDeviceId === 'default' ? 'Muted' : s.ltcOutputDeviceId ? 'OK' : 'Not set'
      })

      // 4. MTC MIDI port
      results.push({
        label: 'MTC Output',
        status: s.midiConnected ? 'ok' : 'warn',
        detail: s.midiConnected ? 'Connected' : 'No port selected'
      })

      // 5. Art-Net
      if (s.artnetEnabled) {
        results.push({
          label: 'Art-Net',
          status: 'ok',
          detail: `→ ${s.artnetTargetIp}`
        })
      }

      // 6. OSC
      if (s.oscEnabled) {
        results.push({
          label: 'OSC',
          status: 'ok',
          detail: `→ ${s.oscTargetIp}:${s.oscTargetPort}`
        })
      }

      // 7. MIDI Clock
      if (s.midiClockEnabled) {
        const bpm = s.midiClockSource === 'manual' ? s.midiClockManualBpm
          : s.midiClockSource === 'tapped' ? (s.tappedBpm ?? 0) : (s.detectedBpm ?? 0)
        results.push({
          label: 'MIDI Clock',
          status: bpm > 0 ? 'ok' : 'warn',
          detail: bpm > 0 ? `${bpm} BPM` : 'No BPM source'
        })
      }

      // 8. (F6-AC-6.1) LTC signal
      results.push({
        label: t(lang, 'checkLtcSignal'),
        status: s.ltcSignalOk ? 'ok' : (s.ltcConfidence > 0 ? 'warn' : 'warn'),
        detail: s.ltcSignalOk
          ? t(lang, 'checkLtcSignalOk')
          : t(lang, 'checkLtcSignalWarn')
      })

      // 9. (F6-AC-6.2) MIDI Cue port — only if any setlist item has midiCues
      const hasMidiCues = s.setlist.some(item => item.midiCues && item.midiCues.length > 0)
      if (hasMidiCues) {
        const cuePortConnected = s.selectedCueMidiPort !== null &&
          s.midiOutputs.some(p => p.id === s.selectedCueMidiPort || p.name === s.selectedCueMidiPort)
        results.push({
          label: t(lang, 'checkMidiCuePort'),
          status: cuePortConnected ? 'ok' : 'fail',
          detail: cuePortConnected
            ? t(lang, 'checkMidiCuePortOk')
            : t(lang, 'checkMidiCuePortFail')
        })
      }

      // 10. (F6-AC-6.3) OSC reachability — valid IP + last 60s feedback
      if (s.oscEnabled) {
        const ipValid = /^(\d{1,3}\.){3}\d{1,3}$/.test(s.oscTargetIp)
        const now = Date.now()
        const recentFeedback = Object.values(s.oscFeedbackDevices).some(d => now - d.lastSeenAt < 60000)
        results.push({
          label: t(lang, 'checkOscReachability'),
          status: ipValid && recentFeedback ? 'ok' : 'warn',
          detail: !ipValid
            ? `Invalid IP: ${s.oscTargetIp}`
            : recentFeedback
              ? t(lang, 'checkOscReachabilityOk')
              : t(lang, 'checkOscReachabilityWarn')
        })
      }

      // 11. (F6-AC-6.4) Setlist offsets — informational
      if (s.setlist.length > 0) {
        const withOffset = s.setlist.filter(item => item.offsetFrames !== undefined).length
        results.push({
          label: t(lang, 'checkSetlistOffsets'),
          status: 'warn',
          detail: withOffset === 0
            ? t(lang, 'checkSetlistOffsetsAll', { n: String(s.setlist.length) })
            : t(lang, 'checkSetlistOffsetsSome', { defined: String(withOffset), total: String(s.setlist.length) })
        })
      }

      // 12. (F6-AC-6.6) Markers populated — informational
      if (s.activeSetlistIndex !== null) {
        const activeItem = s.setlist[s.activeSetlistIndex]
        if (activeItem) {
          const activeMarkers: WaveformMarker[] = s.markers[activeItem.id] ?? []
          results.push({
            label: t(lang, 'checkMarkersPopulated'),
            status: activeMarkers.length > 0 ? 'ok' : 'warn',
            detail: activeMarkers.length > 0
              ? t(lang, 'checkMarkersOk', { n: String(activeMarkers.length) })
              : t(lang, 'checkMarkersWarn')
          })
        }
      }

      if (!cancelled) {
        setChecks(results)
        setRunning(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [lang])

  const allOk = checks.every(c => c.status === 'ok')
  const hasFailure = checks.some(c => c.status === 'fail')

  return (
    <div className="shortcuts-overlay" onClick={onClose}>
      <div className="shortcuts-dialog" style={{ minWidth: '360px' }} onClick={(e) => e.stopPropagation()}>
        <h3>{t(lang, 'preShowTitle')}</h3>
        {running ? (
          <div style={{ textAlign: 'center', padding: '20px', color: '#888' }}>Checking...</div>
        ) : (
          <>
            <table className="preshow-table">
              <tbody>
                {checks.map((c, i) => (
                  <tr key={i}>
                    <td className={`preshow-status preshow-status--${c.status}`}>
                      {c.status === 'ok' ? '✓' : c.status === 'warn' ? '—' : '✗'}
                    </td>
                    <td className="preshow-label">{c.label}</td>
                    <td className="preshow-detail">{c.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={`preshow-verdict ${allOk ? 'preshow-verdict--ok' : hasFailure ? 'preshow-verdict--fail' : 'preshow-verdict--warn'}`}>
              {allOk ? t(lang, 'preShowAllGood') : hasFailure ? t(lang, 'preShowIssues') : t(lang, 'preShowWarnings')}
            </div>
          </>
        )}
        <button className="btn-sm" onClick={onClose} style={{ marginTop: '12px' }}>
          {t(lang, 'shortcutsClose')}
        </button>
      </div>
    </div>
  )
}
