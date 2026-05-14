/**
 * Sprint D — F13: Stage Display pure utility functions.
 * Extracted to a plain .ts file so they can be unit-tested without JSX.
 */
import { t } from '../i18n'

/** Pure function: compute the Next row text for fullscreen stage display. */
export function formatNextRow(
  setlist: Array<{ name: string }>,
  activeIdx: number | null,
  remaining: number,
  autoAdvance: boolean,
  gap: number,
  lang: string
): string | null {
  if (activeIdx === null) return null
  const nextIdx = activeIdx + 1
  if (nextIdx >= setlist.length) {
    return t(lang as 'en' | 'zh' | 'ja', 'nextSongNone')
  }
  const nextName = setlist[nextIdx].name
  if (autoAdvance && remaining > 0) {
    const totalWait = Math.max(0, remaining + gap)
    const min = Math.floor(totalWait / 60)
    const sec = Math.floor(totalWait % 60)
    const timeStr = min > 0
      ? `${min}:${String(sec).padStart(2, '0')}`
      : `${String(sec).padStart(2, '0')}s`
    return t(lang as 'en' | 'zh' | 'ja', 'nextSongIn', { name: nextName, time: timeStr })
  }
  return t(lang as 'en' | 'zh' | 'ja', 'nextSongNext', { name: nextName })
}

/** Status pill for fullscreen stage display. */
export interface StatusPill {
  id: string
  level: 'error' | 'warn'
  label: string
}

/** Pure function: compute status pills for fullscreen stage display. */
export function computeStatusPills(state: {
  tcGeneratorMode: boolean
  playState: string
  ltcSignalOk: boolean
  ltcConfidence: number
  selectedCueMidiPort: string | null
  midiOutputs: Array<{ id: string }>
  setlist: Array<{ midiCues?: unknown[] }>
  oscEnabled: boolean
  oscTargetIp: string
  oscFeedbackDevices: Record<string, { lastSeenAt: number }>
  midiClockEnabled: boolean
  tappedBpm: number | null
  detectedBpm: number | null
  midiClockManualBpm: number
  midiClockSource: string
  lang: 'en' | 'zh' | 'ja'
}): StatusPill[] {
  const pills: StatusPill[] = []
  const now = Date.now()

  // LTC signal pill — only shown in reader mode (not generator mode)
  if (!state.tcGeneratorMode) {
    const ltcLost = state.playState === 'playing' && !state.ltcSignalOk
    if (ltcLost) {
      pills.push({ id: 'ltc', level: 'error', label: t(state.lang, 'statusPillLtc') })
    }
  }

  // MIDI Cue port pill — shown when any item has midi cues and port is not connected
  const hasCues = state.setlist.some(item => item.midiCues && (item.midiCues as unknown[]).length > 0)
  if (hasCues) {
    const portConnected = state.selectedCueMidiPort !== null &&
      state.midiOutputs.some(o => o.id === state.selectedCueMidiPort)
    if (!portConnected) {
      pills.push({ id: 'midi-cue', level: 'warn', label: t(state.lang, 'statusPillMidi') })
    }
  }

  // OSC pill — shown when osc enabled but no feedback in last 60s
  if (state.oscEnabled) {
    const ipValid = /^\d+\.\d+\.\d+\.\d+$/.test(state.oscTargetIp ?? '')
    const recentFeedback = Object.values(state.oscFeedbackDevices).some(
      d => now - d.lastSeenAt < 60000
    )
    if (!ipValid || !recentFeedback) {
      pills.push({ id: 'osc', level: 'warn', label: t(state.lang, 'statusPillOsc') })
    }
  }

  return pills
}
