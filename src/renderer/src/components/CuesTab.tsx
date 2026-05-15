/**
 * Sprint UI-Reorg-Option-A — CuesTab
 *
 * Wraps StructurePanel (markers) + MidiCuePanel (MIDI cue list + input
 * mappings) into the new "Cues" right-panel tab. Both child panels are
 * mounted unchanged — this component only does layout + ProGate + empty-state.
 *
 * Empty state (AC-12.1): when the active song has no markers AND there
 * are no MIDI cues, render a centered icon + "No cues yet" + two buttons.
 * The Add Marker / Add MIDI Cue buttons defer to the existing flows by
 * calling props.onAddMarker / props.onAddMidiCue.
 */

import React from 'react'
import { useStore } from '../store'
import { useShallow } from 'zustand/react/shallow'
import { t } from '../i18n'
import { StructurePanel } from './StructurePanel'
import { MidiCuePanel } from './MidiCuePanel'
import { ProGate } from './ProGate'

interface Props {
  onSeek: (time: number) => void
  onUpgrade: () => void
  onCueMidiPortChange: (portId: string) => void
  onMidiInputPortChange: (portId: string) => void
  onStartLearn: (id: string) => void
  learningMappingId: string | null
  lastFiredCueId: string | null
  onAddMarker: () => void
  onAddMidiCue: () => void
}

export function CuesTab({
  onSeek, onUpgrade,
  onCueMidiPortChange, onMidiInputPortChange,
  onStartLearn, learningMappingId, lastFiredCueId,
  onAddMarker, onAddMidiCue,
}: Props): React.JSX.Element {
  // Subscribe narrowly so this wrapper doesn't re-render every TC update.
  // We project the relevant counts (not full arrays) to keep useShallow's
  // equality check cheap.
  const { lang, hasSong, currentSongMarkers, midiCueCount } = useStore(useShallow((s) => {
    const idx = s.activeSetlistIndex
    const item = idx !== null && idx >= 0 && idx < s.setlist.length ? s.setlist[idx] : null
    const markers = item ? (s.markers[item.id] ?? []) : []
    const cues = item?.midiCues ?? []
    return {
      lang: s.lang,
      hasSong: idx !== null && s.setlist.length > 0,
      currentSongMarkers: markers.length,
      midiCueCount: cues.length,
    }
  }))

  // Empty state only when:
  //   - a song is loaded
  //   - markers list is empty
  //   - MIDI cues list is empty
  // If no song loaded, fall through to StructurePanel which renders its own
  // "noMarkers" message — keeps existing flow for first-launch state.
  const isEmpty = hasSong && currentSongMarkers === 0 && midiCueCount === 0

  if (isEmpty) {
    return (
      <ProGate onUpgrade={onUpgrade}>
        <div className="tab-empty-state">
          <div className="tab-empty-state__icon">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
          <div className="tab-empty-state__title">{t(lang, 'emptyCuesTitle')}</div>
          <div className="tab-empty-state__hint">{t(lang, 'emptyCuesHint')}</div>
          <div className="tab-empty-state__buttons">
            <button className="btn-sm btn-outline" onClick={onAddMarker}>{t(lang, 'emptyCuesAddMarker')}</button>
            <button className="btn-sm btn-primary" onClick={onAddMidiCue}>{t(lang, 'emptyCuesAddMidiCue')}</button>
          </div>
        </div>
      </ProGate>
    )
  }

  return (
    <ProGate onUpgrade={onUpgrade}>
      <div className="cues-tab">
        <div className="cues-tab__half cues-tab__top">
          <StructurePanel onSeek={onSeek} />
        </div>
        <div className="cues-tab__divider" />
        <div className="cues-tab__half cues-tab__bottom">
          <MidiCuePanel
            onCueMidiPortChange={onCueMidiPortChange}
            onMidiInputPortChange={onMidiInputPortChange}
            onStartLearn={onStartLearn}
            learningMappingId={learningMappingId}
            lastFiredCueId={lastFiredCueId}
          />
        </div>
      </div>
    </ProGate>
  )
}
