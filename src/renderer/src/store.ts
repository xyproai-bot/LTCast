import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { TimecodeLookupEntry } from './audio/LtcDecoder'
import { t } from './i18n'
import { toast } from './components/Toast'

export interface TimecodeFrame {
  hours: number
  minutes: number
  seconds: number
  frames: number
  fps: number
  dropFrame: boolean
}

export type PlayState = 'stopped' | 'playing' | 'paused'
export type LtcChannel = 'auto' | 0 | 1 | 2 | 3

export interface AudioDevice {
  deviceId: string
  label: string
}

export interface MidiPort {
  id: string
  name: string
}

/** F3 — OSC Feedback. Transient renderer-side record of an inbound ack source. */
export interface FeedbackDevice {
  sourceId: string                // "IP:port" from dgram rinfo
  lastTc: { h: number; m: number; s: number; f: number }
  lastSeenAt: number              // ms epoch
}

let _setlistIdCounter = Date.now()
export function nextSetlistId(): string { return `sl-${++_setlistIdCounter}` }

// F10 — Setlist Variants
let _variantIdCounter = Date.now()
export function nextVariantId(): string { return `v-${++_variantIdCounter}` }

export interface SetlistVariant {
  id: string
  name: string
  setlist: SetlistItem[]
  activeSetlistIndex: number | null
}

export interface MidiCuePoint {
  id: string
  triggerTimecode: string          // HH:MM:SS:FF absolute timecode
  messageType: 'program-change' | 'note-on' | 'control-change'
  channel: number                  // 1-16
  data1: number                    // Program/Note/CC number (0-127)
  data2?: number                   // Velocity/CC value (0-127); not used for PC
  label?: string                   // User label (e.g. "Scene A")
  enabled: boolean                 // mute/unmute
  offsetFrames?: number            // Fine-tune trigger offset in frames (+/- from triggerTimecode)
}

export interface MidiMapping {
  id: string
  trigger: {
    type: 'note-on' | 'control-change' | 'program-change'
    channel: number    // 1-16, or 0 = any
    data1: number      // note/cc/program number
  }
  action: 'play' | 'pause' | 'stop' | 'play-pause' | 'next' | 'prev' | 'goto-song'
  actionParam?: number // for goto-song: setlist index (0-based)
}

export interface SetlistItem {
  id: string
  path: string
  name: string
  offsetFrames?: number  // per-song offset override; undefined = use global
  notes?: string         // user notes (e.g. "間奏有換場") — used for cue sheet PDF
  stageNote?: string     // F13: single-line operator note for fullscreen stage display (≤200 chars)
  midiCues?: MidiCuePoint[]  // per-song MIDI cue points
  markers?: WaveformMarker[]  // per-song structure markers (intro/verse/etc); v8+
}

export type MarkerType = 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro' | 'break' | 'song-title' | 'custom'

export const MARKER_TYPE_COLORS: Record<MarkerType, string> = {
  'intro':      '#42a5f5',  // blue
  'verse':      '#66bb6a',  // green
  'chorus':     '#ef5350',  // red
  'bridge':     '#ab47bc',  // purple
  'outro':      '#78909c',  // grey-blue
  'break':      '#ffa726',  // orange
  'song-title': '#ffee58',  // yellow
  'custom':     '#00d4ff',  // cyan (legacy default)
}

export const MARKER_TYPES: MarkerType[] = ['song-title', 'intro', 'verse', 'chorus', 'bridge', 'outro', 'break', 'custom']

export interface WaveformMarker {
  id: string
  time: number       // seconds
  label: string      // user-defined name
  color?: string     // override auto color
  type?: MarkerType  // section type (undefined = 'custom' for backward compat)
}

// F4 — Independent Show Timer (v0.5.2)
// A standalone countdown timer, independent of audio playback. Multiple
// timers can coexist in `AppState.showTimers`. Wall-clock arithmetic
// (`startedAt = Date.now()` + clamp) keeps remaining accurate across tab
// throttling / sleep. See `utils/showTimer.ts` for the pure math.
export interface ShowTimer {
  id: string
  name: string
  durationMs: number
  running: boolean
  /** `Date.now()` snapshot when `running = true`; null otherwise. */
  startedAt: number | null
  /** Frozen remaining snapshot used while stopped and for persisted restore. */
  remainingMsAtStop: number
}

export function nextShowTimerId(): string {
  // Prefer crypto.randomUUID() so IDs survive multi-window / add-remove-add
  // cycles without collision. Falls back to time+random for envs without it
  // (older Node in tests, though Electron 40 ships crypto.randomUUID).
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `st-${crypto.randomUUID()}`
  }
  return `st-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export interface PresetData {
  lang: 'en' | 'zh' | 'ja'
  rightTab: 'devices' | 'setlist' | 'cues' | 'structure' | 'calc' | 'log' | 'timer'
  offsetFrames: number
  loop: boolean
  loopA?: number | null
  loopB?: number | null
  musicOutputDeviceId: string
  ltcOutputDeviceId: string
  ltcGain: number
  musicVolume?: number
  musicPan?: number
  selectedMidiPort: string | null
  forceFps: number | null
  ltcChannel: LtcChannel
  setlist: SetlistItem[]
  generatorStartTC?: string
  generatorFps?: number
  tcGeneratorMode?: boolean
  artnetEnabled?: boolean
  artnetTargetIp?: string
  mtcMode?: 'quarter-frame' | 'full-frame'
  oscEnabled?: boolean
  oscTargetIp?: string
  oscTargetPort?: number
  oscTemplate?: 'generic' | 'resolume' | 'disguise' | 'watchout'
  autoAdvance?: boolean
  autoAdvanceGap?: number
  // Sprint 2: MIDI Cue System
  selectedCueMidiPort?: string | null
  midiInputPort?: string | null
  midiMappings?: MidiMapping[]
  // Sprint 4: Waveform Markers
  markers?: Record<string, WaveformMarker[]>
  // MIDI Clock
  midiClockEnabled?: boolean
  midiClockSource?: 'detected' | 'tapped' | 'manual'
  midiClockManualBpm?: number
  // UI Lock (show mode)
  showLocked?: boolean
  // Sprint A — AC-1.4: per-preset marker type color overrides
  markerTypeColorOverrides?: Partial<Record<MarkerType, string>>
  // Sprint D — F10: Setlist Variants
  setlistVariants?: SetlistVariant[]
  activeSetlistVariantId?: string
  version?: number
}

export interface SavedPreset {
  name: string
  data: PresetData
  updatedAt: string
}

// Async helper to reload presets from filesystem
async function loadPresetsFromDisk(): Promise<SavedPreset[]> {
  try {
    const list = await window.api.listPresets()
    return list.map(p => ({ name: p.name, data: p.data as PresetData, updatedAt: p.updatedAt }))
  } catch { return [] }
}

/** Ensure every setlist item has a unique id (backward compat for old presets). */
function ensureSetlistIds(data: PresetData): PresetData {
  if (data.setlist && data.setlist.length > 0) {
    // Return new object — don't mutate the cached preset in savedPresets
    return { ...data, setlist: data.setlist.map(item => item.id ? item : { ...item, id: nextSetlistId() }) }
  }
  return data
}

const CURRENT_PRESET_VERSION = 11

/** Warn once if a preset was created by a newer version of the app. */
function warnIfNewerVersion(data: PresetData): void {
  if ((data.version ?? 0) > CURRENT_PRESET_VERSION) {
    toast.warning(t(useStore.getState().lang, 'presetNewerVersion'))
  }
}

/** Migrate old preset data to current version. */
function migratePreset(data: PresetData): PresetData {
  const version = data.version ?? 0
  if (version === CURRENT_PRESET_VERSION) return data
  // version 0 → 1: add mtcMode default
  if (version < 1) {
    data.mtcMode = data.mtcMode ?? 'full-frame' // old presets keep full-frame behavior
  }
  // version 1 → 2: add autoAdvance defaults
  if (version < 2) {
    data.autoAdvance = data.autoAdvance ?? false
    data.autoAdvanceGap = data.autoAdvanceGap ?? 2
  }
  // version 2 → 3: add MIDI cue system defaults
  if (version < 3) {
    data.selectedCueMidiPort = data.selectedCueMidiPort ?? null
    data.midiInputPort = data.midiInputPort ?? null
    data.midiMappings = data.midiMappings ?? []
  }
  // version 3 → 4: add OSC output defaults
  if (version < 4) {
    data.oscEnabled = data.oscEnabled ?? false
    data.oscTargetIp = data.oscTargetIp ?? '127.0.0.1'
    data.oscTargetPort = data.oscTargetPort ?? 8000
  }
  // version 4 → 5: add waveform markers + ja language support
  if (version < 5) {
    data.markers = data.markers ?? {}
    // Migrate 'ja' lang: was not valid before, keep as-is or default to 'en'
    if (!['en', 'zh', 'ja'].includes(data.lang as string)) {
      data.lang = 'en'
    }
  }
  // version 5 → 6: add UI lock mode
  if (version < 6) {
    data.showLocked = data.showLocked ?? false
  }
  // version 6 → 7: add MIDI Clock output + OSC template
  if (version < 7) {
    data.midiClockEnabled = data.midiClockEnabled ?? false
    data.midiClockSource = data.midiClockSource ?? 'detected'
    data.midiClockManualBpm = data.midiClockManualBpm ?? 120
    data.oscTemplate = data.oscTemplate ?? 'generic'
  }
  // version 7 → 8: relocate markers from top-level path-keyed Record onto
  // each SetlistItem. Path-keyed storage broke when sharing presets — the
  // recipient's local file path differs from the saver's, so the lookup
  // missed and markers appeared empty. Per-item storage travels with the
  // setlist serialization. Markers attached to paths that don't match any
  // setlist item are silently dropped (Q-D).
  if (version < 8) {
    type LegacyMarkers = Record<string, WaveformMarker[]> | undefined
    const legacy = (data as { markers?: LegacyMarkers }).markers
    if (legacy && data.setlist) {
      for (const item of data.setlist) {
        const arr = legacy[item.path]
        if (arr && arr.length > 0) item.markers = arr
      }
    }
    delete (data as { markers?: unknown }).markers
  }
  // version 8 → 9: add per-preset marker type color overrides
  if (version < 9) {
    data.markerTypeColorOverrides = data.markerTypeColorOverrides ?? {}
  }
  // version 9 → 10: wrap setlist in a default "Main" variant
  if (version < 10) {
    if (!data.setlistVariants || data.setlistVariants.length === 0) {
      data.setlistVariants = [{
        id: 'main',
        name: 'Main',
        setlist: data.setlist ?? [],
        activeSetlistIndex: null
      }]
    }
    if (!data.activeSetlistVariantId) {
      data.activeSetlistVariantId = data.setlistVariants[0].id
    }
    // Keep data.setlist as mirror (unchanged)
  }
  // version 10 → 11: add music volume + pan
  if (version < 11) {
    data.musicVolume = data.musicVolume ?? 1.0
    data.musicPan = data.musicPan ?? 0.0
  }
  data.version = CURRENT_PRESET_VERSION
  return data
}

/** Build a PresetData snapshot from the current store state.
 *  Stamps each setlist item with its markers from the in-memory id-keyed
 *  state.markers map (v8 storage). Top-level `markers` field is gone. */
export function buildPresetData(s: Pick<AppState,
  'lang' | 'rightTab' | 'offsetFrames' | 'loop' | 'loopA' | 'loopB' | 'musicOutputDeviceId' |
  'ltcOutputDeviceId' | 'ltcGain' | 'musicVolume' | 'musicPan' | 'selectedMidiPort' | 'forceFps' |
  'ltcChannel' | 'setlist' | 'activeSetlistIndex' | 'generatorStartTC' | 'generatorFps' | 'tcGeneratorMode' |
  'artnetEnabled' | 'artnetTargetIp' | 'mtcMode' | 'autoAdvance' | 'autoAdvanceGap' |
  'selectedCueMidiPort' | 'midiInputPort' | 'midiMappings' |
  'oscEnabled' | 'oscTargetIp' | 'oscTargetPort' | 'oscTemplate' | 'markers' | 'showLocked' |
  'midiClockEnabled' | 'midiClockSource' | 'midiClockManualBpm' | 'markerTypeColorOverrides' |
  'setlistVariants' | 'activeSetlistVariantId'>): PresetData {
  // Stamp markers onto each item before serialisation. The empty-array case
  // is omitted to keep .ltcast files compact.
  const stampMarkers = (items: SetlistItem[]): SetlistItem[] =>
    items.map(item => {
      const arr = s.markers[item.id]
      return arr && arr.length > 0 ? { ...item, markers: arr } : { ...item, markers: undefined }
    })

  const setlistWithMarkers = stampMarkers(s.setlist)

  // Write the current top-level setlist + activeSetlistIndex back into the active variant
  // so the saved file reflects the latest edits.
  const updatedVariants: SetlistVariant[] = s.setlistVariants.map(v =>
    v.id === s.activeSetlistVariantId
      ? { ...v, setlist: setlistWithMarkers, activeSetlistIndex: s.activeSetlistIndex }
      : { ...v, setlist: stampMarkers(v.setlist) }
  )

  return {
    version: CURRENT_PRESET_VERSION,
    lang: s.lang, rightTab: s.rightTab, offsetFrames: s.offsetFrames,
    loop: s.loop, loopA: s.loopA, loopB: s.loopB,
    musicOutputDeviceId: s.musicOutputDeviceId,
    ltcOutputDeviceId: s.ltcOutputDeviceId, ltcGain: s.ltcGain,
    musicVolume: s.musicVolume, musicPan: s.musicPan,
    selectedMidiPort: s.selectedMidiPort, forceFps: s.forceFps,
    ltcChannel: s.ltcChannel, setlist: setlistWithMarkers,
    generatorStartTC: s.generatorStartTC, generatorFps: s.generatorFps,
    tcGeneratorMode: s.tcGeneratorMode,
    artnetEnabled: s.artnetEnabled, artnetTargetIp: s.artnetTargetIp,
    mtcMode: s.mtcMode,
    autoAdvance: s.autoAdvance, autoAdvanceGap: s.autoAdvanceGap,
    selectedCueMidiPort: s.selectedCueMidiPort,
    midiInputPort: s.midiInputPort, midiMappings: s.midiMappings,
    oscEnabled: s.oscEnabled, oscTargetIp: s.oscTargetIp, oscTargetPort: s.oscTargetPort, oscTemplate: s.oscTemplate,
    showLocked: s.showLocked,
    midiClockEnabled: s.midiClockEnabled,
    midiClockSource: s.midiClockSource,
    midiClockManualBpm: s.midiClockManualBpm,
    markerTypeColorOverrides: Object.keys(s.markerTypeColorOverrides).length > 0 ? s.markerTypeColorOverrides : undefined,
    setlistVariants: updatedVariants,
    activeSetlistVariantId: s.activeSetlistVariantId
  }
}

/** Rebuild the runtime id-keyed markers map from a freshly-loaded setlist
 *  whose items carry `markers` (v8). Empty / undefined arrays are omitted. */
function deriveMarkersFromSetlist(setlist: SetlistItem[]): Record<string, WaveformMarker[]> {
  const out: Record<string, WaveformMarker[]> = {}
  for (const item of setlist) {
    if (item.markers && item.markers.length > 0) {
      out[item.id] = item.markers
    }
  }
  return out
}

/** Ensure setlist items in all variants have unique ids */
function ensureVariantSetlistIds(variants: SetlistVariant[]): SetlistVariant[] {
  return variants.map(v => ({
    ...v,
    setlist: v.setlist.map(item => item.id ? item : { ...item, id: nextSetlistId() })
  }))
}

/** Extract variants and active variant id from preset, with safe defaults */
function resolveVariantsFromPreset(presetData: PresetData): { setlistVariants: SetlistVariant[], activeSetlistVariantId: string } {
  const defaultVariant: SetlistVariant = { id: 'main', name: 'Main', setlist: presetData.setlist ?? [], activeSetlistIndex: null }
  const rawVariants = presetData.setlistVariants && presetData.setlistVariants.length > 0
    ? presetData.setlistVariants
    : [defaultVariant]
  const variants = ensureVariantSetlistIds(rawVariants)
  const activeId = presetData.activeSetlistVariantId && variants.some(v => v.id === presetData.activeSetlistVariantId)
    ? presetData.activeSetlistVariantId
    : variants[0].id
  return { setlistVariants: variants, activeSetlistVariantId: activeId }
}

/** Build the full markers map from all variants (used when loading a preset) */
function deriveMarkersFromAllVariants(variants: SetlistVariant[]): Record<string, WaveformMarker[]> {
  const out: Record<string, WaveformMarker[]> = {}
  for (const v of variants) {
    for (const item of v.setlist) {
      if (item.markers && item.markers.length > 0) {
        out[item.id] = item.markers
      }
    }
  }
  return out
}

export type SortMode = 'az' | 'za' | 'ext' | 'reverse'
export type ThemeColor = 'cyan' | 'red' | 'green' | 'orange' | 'purple' | 'pink'
export type UiSize = 'sm' | 'md' | 'lg'

export interface AppState {
  // File
  filePath: string | null
  fileName: string | null
  duration: number

  // Playback
  playState: PlayState
  currentTime: number
  loop: boolean
  loopA: number | null
  loopB: number | null

  // Timecode
  timecode: TimecodeFrame | null
  detectedFps: number | null
  forceFps: number | null
  offsetFrames: number
  ltcChannel: LtcChannel
  detectedLtcChannel: number | null
  ltcSignalOk: boolean

  // TC Generator mode (for files without embedded LTC)
  tcGeneratorMode: boolean
  generatorStartTC: string      // "HH:MM:SS:FF" format
  generatorFps: number           // 24, 25, 29.97, 30
  ltcConfidence: number          // 0–1, from LTC detector
  ltcStartTime: number           // seconds where LTC signal first appears (0 = from start)

  // Audio devices
  audioOutputDevices: AudioDevice[]
  musicOutputDeviceId: string
  ltcOutputDeviceId: string
  ltcGain: number       // 0.0–1.5 (1.0 = unity / 0 dB)
  musicVolume: number   // 0.0–1.5 (1.0 = unity)
  musicPan: number      // -1.0 (L) to +1.0 (R), 0 = center

  // MIDI
  midiOutputs: MidiPort[]
  selectedMidiPort: string | null
  midiConnected: boolean

  // MTC mode
  mtcMode: 'quarter-frame' | 'full-frame'

  // Art-Net Timecode
  artnetEnabled: boolean
  artnetTargetIp: string          // broadcast IP, default '255.255.255.255'

  // OSC Output
  oscEnabled: boolean
  oscTargetIp: string             // unicast IP, default '127.0.0.1'
  oscTargetPort: number           // default 8000

  // OSC Feedback (F3) — INBOUND TC ack listener
  // Per-install setting (Q-G). NOT bound to .ltcast preset, never marks
  // presetDirty. Default-off, default-loopback. oscFeedbackDevices is
  // transient and must never be persisted.
  oscFeedbackEnabled: boolean
  oscFeedbackPort: number                                   // default 9001
  oscFeedbackBindAddress: '127.0.0.1' | '0.0.0.0'           // default loopback
  oscFeedbackDevices: Record<string, FeedbackDevice>         // transient

  // MIDI Clock Output
  midiClockEnabled: boolean
  midiClockSource: 'detected' | 'tapped' | 'manual'
  midiClockManualBpm: number      // 20–300, used when source = 'manual'

  // OSC template preset
  oscTemplate: 'generic' | 'resolume' | 'disguise' | 'watchout'

  // BPM
  tappedBpm: number | null
  detectedBpm: number | null
  setTappedBpm: (bpm: number | null) => void
  setDetectedBpm: (bpm: number | null) => void

  // Video import
  videoFileName: string | null
  videoWaveform: Float32Array | null
  videoDuration: number
  videoOffsetSeconds: number
  videoStartTimecode: string | null
  videoLoading: boolean

  // Audio file loading
  audioLoading: boolean
  loadingFileName: string | null

  // Timecode lookup (offline LTC decode)
  timecodeLookup: TimecodeLookupEntry[]

  // Setlist
  setlist: SetlistItem[]
  activeSetlistIndex: number | null
  // Sprint D — F10: Setlist Variants
  setlistVariants: SetlistVariant[]
  activeSetlistVariantId: string
  standbySetlistIndex: number | null  // cued but not yet loaded (Standby/GO workflow)
  // Index currently being pre-buffered in the background (null = idle).
  // Transient — not persisted, does not mark preset dirty. UI may render
  // a spinner in the future; for v0.5.2 no renderer consumes this field.
  prebufferingIndex: number | null
  previousSetlist: { setlist: SetlistItem[]; activeIndex: number | null } | null
  autoAdvance: boolean
  autoAdvanceGap: number  // seconds, 0–30

  // MIDI Cue Output (Sprint 2)
  selectedCueMidiPort: string | null

  // MIDI Input (Sprint 2)
  midiInputPort: string | null
  midiMappings: MidiMapping[]
  midiInputs: MidiPort[]

  // Waveform Markers (Sprint 4)
  markers: Record<string, WaveformMarker[]>
  markerUndoStack: Record<string, WaveformMarker[]>[]

  // Sprint A — per-install settings
  // F1: active type filter for StructurePanel (empty = show all)
  markerTypeFilter: MarkerType[]
  // F2: show/hide floating label during right-click drag to set loop region
  showLoopDragLabel: boolean
  // F4: behavior of number keys 1-9
  numericKeyAction: 'goto-song' | 'goto-marker'

  // Sprint B — F7: last session (per-install, for resume on launch)
  lastSession: {
    filePath: string
    fileName: string
    positionSeconds: number
    setlistIndex: number | null
    savedAt: number
  } | null
  disableResumePrompt: boolean

  // Sprint D — F11: auto backup per-install settings
  autoBackupEnabled: boolean       // default true
  autoBackupIntervalMin: number    // default 5, min 1, max 60
  autoBackupKeepCount: number      // default 10, min 1, max 100

  // Sprint A — AC-1.4: per-preset marker type color overrides (saved in preset)
  markerTypeColorOverrides: Partial<Record<MarkerType, string>>

  // Waveform zoom memory (per-file pxPerSec)
  waveformZoom: Record<string, number>

  // F4 — Independent Show Timer (v0.5.2)
  // Standalone countdown timers; independent of audio playback. Persisted via
  // Zustand (partialize). On rehydrate we force `running = false` so a timer
  // that was ticking at quit comes back stopped at its last-known remaining.
  showTimers: ShowTimer[]

  // UI
  rightTab: 'devices' | 'setlist' | 'cues' | 'structure' | 'calc' | 'log' | 'timer'
  lang: 'en' | 'zh' | 'ja'
  showLocked: boolean   // UI lock mode — prevents accidental changes during live shows
  ultraDark: boolean    // Ultra-dark high-contrast mode for dim environments
  themeColor: ThemeColor  // Accent color theme (per-install)
  uiSize: UiSize          // UI scale factor (per-install)

  // License
  licenseKey: string | null
  licenseStatus: 'none' | 'valid' | 'expired' | 'invalid'
  licenseValidatedAt: number | null  // timestamp of last successful validation
  licenseExpiresAt: string | null   // ISO date string for promo licenses
  trialDaysLeft: number | null       // null = not checked yet, 0 = expired

  // Project
  presetName: string | null
  presetPath: string | null   // filesystem path of the current .ltcast file
  presetDirty: boolean
  savedPresets: SavedPreset[]
  recentFiles: Array<{ path: string; name: string }>

  // Actions
  setFilePath: (path: string | null, name: string | null, duration: number) => void
  setPlayState: (state: PlayState) => void
  setCurrentTime: (time: number) => void
  setLoop: (loop: boolean) => void
  setLoopA: (time: number | null) => void
  setLoopB: (time: number | null) => void
  clearLoop: () => void
  setTimecode: (tc: TimecodeFrame | null) => void
  setDetectedFps: (fps: number | null) => void
  setForceFps: (fps: number | null) => void
  setOffsetFrames: (offset: number) => void
  setLtcChannel: (ch: LtcChannel) => void
  setDetectedLtcChannel: (ch: number | null) => void
  setLtcSignalOk: (ok: boolean) => void
  setTcGeneratorMode: (mode: boolean) => void
  setGeneratorStartTC: (tc: string) => void
  setGeneratorFps: (fps: number) => void
  setLtcConfidence: (confidence: number) => void
  setLtcStartTime: (time: number) => void
  setAudioOutputDevices: (devices: AudioDevice[]) => void
  setMusicOutputDeviceId: (id: string) => void
  setLtcOutputDeviceId: (id: string) => void
  setLtcGain: (gain: number) => void
  setMusicVolume: (v: number) => void
  setMusicPan: (p: number) => void
  setMidiOutputs: (ports: MidiPort[]) => void
  setSelectedMidiPort: (port: string | null) => void
  setMidiConnected: (connected: boolean) => void
  setMtcMode: (mode: 'quarter-frame' | 'full-frame') => void
  setArtnetEnabled: (enabled: boolean) => void
  setArtnetTargetIp: (ip: string) => void
  setOscEnabled: (enabled: boolean) => void
  setOscTargetIp: (ip: string) => void
  setOscTargetPort: (port: number) => void
  // F3 — OSC Feedback. None of these mark presetDirty (Q-G).
  setOscFeedbackEnabled: (enabled: boolean) => void
  setOscFeedbackPort: (port: number) => void
  setOscFeedbackBindAddress: (addr: '127.0.0.1' | '0.0.0.0') => void
  recordOscFeedbackDevice: (sourceId: string, tc: { h: number; m: number; s: number; f: number }, ts: number) => void
  pruneOscFeedbackDevices: (now: number, maxAgeMs: number) => void
  clearOscFeedbackDevices: () => void
  setMidiClockEnabled: (enabled: boolean) => void
  setMidiClockSource: (source: 'detected' | 'tapped' | 'manual') => void
  setMidiClockManualBpm: (bpm: number) => void
  setOscTemplate: (template: 'generic' | 'resolume' | 'disguise' | 'watchout') => void
  setVideoFile: (name: string | null, waveform: Float32Array | null, duration: number) => void
  setVideoOffsetSeconds: (offset: number) => void
  setVideoStartTimecode: (tc: string | null) => void
  setVideoLoading: (loading: boolean) => void
  setAudioLoading: (loading: boolean, fileName?: string | null) => void
  setTimecodeLookup: (lookup: TimecodeLookupEntry[]) => void
  clearVideo: () => void
  addToSetlist: (items: Array<Omit<SetlistItem, 'id'> & { id?: string }>) => void
  removeFromSetlist: (index: number) => void
  setActiveSetlistIndex: (index: number | null) => void
  setStandbySetlistIndex: (index: number | null) => void
  setPrebufferingIndex: (index: number | null) => void
  reorderSetlist: (from: number, to: number) => void
  clearSetlist: () => void
  undoClearSetlist: () => void
  sortSetlist: (mode: SortMode) => void
  batchUpdateSetlistPaths: (updates: Array<{ index: number; newPath: string }>) => void
  setSetlistItemOffset: (index: number, offsetFrames: number | undefined) => void
  setSetlistItemNotes: (index: number, notes: string | undefined) => void
  setSetlistItemStageNote: (index: number, stageNote: string | undefined) => void
  setSetlistItemMidiCues: (index: number, cues: MidiCuePoint[]) => void
  // Sprint B — F5: replace audio with alignment
  setSetlistItemPath: (index: number, path: string, name: string) => void
  replaceSetlistItemAudio: (
    index: number,
    newPath: string,
    newName: string,
    shiftedMarkers: WaveformMarker[],
    shiftedMidiCues: MidiCuePoint[],
    oldPath: string,
    oldName: string,
    oldMarkers: WaveformMarker[],
    oldMidiCues: MidiCuePoint[]
  ) => void
  // Sprint D — F10: Setlist Variants
  addSetlistVariant: (name: string) => string
  renameSetlistVariant: (id: string, newName: string) => void
  deleteSetlistVariant: (id: string) => void
  duplicateSetlistVariant: (id: string, newName: string) => string
  switchSetlistVariant: (id: string) => void

  // Sprint B — F7: last session
  saveLastSession: (filePath: string, fileName: string, positionSeconds: number, setlistIndex: number | null) => void
  clearLastSession: () => void
  setDisableResumePrompt: (disabled: boolean) => void

  // Sprint D — F11: auto backup settings
  setAutoBackupEnabled: (enabled: boolean) => void
  setAutoBackupIntervalMin: (min: number) => void
  setAutoBackupKeepCount: (count: number) => void
  setRightTab: (tab: 'devices' | 'setlist' | 'cues' | 'structure' | 'calc' | 'log' | 'timer') => void
  // F4 Show Timer actions
  addShowTimer: (name: string, durationMs: number) => void
  removeShowTimer: (id: string) => void
  startShowTimer: (id: string) => void
  stopShowTimer: (id: string) => void
  resetShowTimer: (id: string) => void
  renameShowTimer: (id: string, name: string) => void
  setShowTimerDuration: (id: string, durationMs: number) => void
  markShowTimerCompleted: (id: string) => void
  setLang: (lang: 'en' | 'zh' | 'ja') => void
  setShowLocked: (locked: boolean) => void
  setUltraDark: (dark: boolean) => void
  setThemeColor: (color: ThemeColor) => void
  setUiSize: (size: UiSize) => void
  setAutoAdvance: (enabled: boolean) => void
  // Waveform Markers (Sprint 4)
  addMarker: (filePath: string, marker: WaveformMarker) => void
  removeMarker: (filePath: string, markerId: string) => void
  updateMarker: (filePath: string, markerId: string, updates: Partial<WaveformMarker>) => void
  undoMarker: () => void
  setWaveformZoom: (filePath: string, pxPerSec: number) => void

  // Sprint A — per-install actions
  setMarkerTypeFilter: (filter: MarkerType[]) => void
  setShowLoopDragLabel: (show: boolean) => void
  setNumericKeyAction: (action: 'goto-song' | 'goto-marker') => void
  // Sprint A — AC-1.4: per-preset marker type color override action
  setMarkerTypeColorOverride: (markerType: MarkerType, color: string | null) => void
  // License
  setLicenseKey: (key: string | null) => void
  setLicenseStatus: (status: 'none' | 'valid' | 'expired' | 'invalid') => void
  setLicenseValidatedAt: (ts: number | null) => void
  setLicenseExpiresAt: (expiresAt: string | null) => void
  isPro: () => boolean
  setAutoAdvanceGap: (gap: number) => void
  setSelectedCueMidiPort: (port: string | null) => void
  setMidiInputPort: (port: string | null) => void
  setMidiMappings: (mappings: MidiMapping[]) => void
  addMidiMapping: (mapping: MidiMapping) => void
  updateMidiMapping: (id: string, mapping: Partial<MidiMapping>) => void
  removeMidiMapping: (id: string) => void
  setMidiInputs: (ports: MidiPort[]) => void

  // Project actions
  newPreset: () => void
  savePreset: () => void
  savePresetAs: () => void
  openProject: () => Promise<void>
  openRecentFile: (path: string) => Promise<void>
  addRecentFile: (path: string, name: string) => void
  loadPreset: (name: string) => void
  deletePreset: (name: string) => void
  resetToDefaults: () => void
  refreshPresets: () => Promise<void>
  packageProject: () => Promise<string | null>
  importProject: () => Promise<boolean>
  shareProjectZip: () => Promise<string | null>
  importLtcastProject: () => Promise<boolean>
}

export const useStore = create<AppState>()(persist((set) => ({
  filePath: null,
  fileName: null,
  duration: 0,

  playState: 'stopped',
  currentTime: 0,
  loop: false,
  loopA: null,
  loopB: null,

  timecode: null,
  detectedFps: null,
  forceFps: null,
  offsetFrames: 0,
  ltcChannel: 'auto',
  detectedLtcChannel: null,
  ltcSignalOk: false,

  tcGeneratorMode: false,
  generatorStartTC: '01:00:00:00',
  generatorFps: 25,
  ltcConfidence: 0,
  ltcStartTime: 0,

  audioOutputDevices: [],
  musicOutputDeviceId: 'default',
  ltcOutputDeviceId: 'default',
  ltcGain: 1.0,
  musicVolume: 1.0,
  musicPan: 0.0,

  midiOutputs: [],
  selectedMidiPort: null,
  midiConnected: false,

  mtcMode: 'quarter-frame',

  artnetEnabled: false,
  artnetTargetIp: '255.255.255.255',

  oscEnabled: false,
  oscTargetIp: '127.0.0.1',
  oscTargetPort: 8000,

  // F3 — OSC Feedback defaults. Default-off, default-loopback (Q-A).
  // Default port 9001 (Q-B). Devices map is transient (never persisted).
  oscFeedbackEnabled: false,
  oscFeedbackPort: 9001,
  oscFeedbackBindAddress: '127.0.0.1',
  oscFeedbackDevices: {},

  midiClockEnabled: false,
  midiClockSource: 'detected',
  midiClockManualBpm: 120,

  oscTemplate: 'generic',

  tappedBpm: null,
  detectedBpm: null,

  videoFileName: null,
  videoWaveform: null,
  videoDuration: 0,
  videoOffsetSeconds: 0,
  videoStartTimecode: null,
  videoLoading: false,

  audioLoading: false,
  loadingFileName: null,

  timecodeLookup: [],

  setlist: [],
  activeSetlistIndex: null,
  setlistVariants: [{ id: 'main', name: 'Main', setlist: [], activeSetlistIndex: null }],
  activeSetlistVariantId: 'main',
  standbySetlistIndex: null,
  prebufferingIndex: null,
  previousSetlist: null,
  autoAdvance: false,
  autoAdvanceGap: 2,

  selectedCueMidiPort: null,
  midiInputPort: null,
  midiMappings: [],
  midiInputs: [],

  markers: {},
  markerUndoStack: [],
  waveformZoom: {},

  // Sprint A — per-install settings defaults
  markerTypeFilter: [],          // empty = all types shown
  showLoopDragLabel: true,       // show label by default (Q2.1)
  numericKeyAction: 'goto-song', // backward-compatible default (Q4.1)

  // Sprint B — F7: last session defaults
  lastSession: null,
  disableResumePrompt: false,

  // Sprint D — F11: auto backup defaults
  autoBackupEnabled: true,
  autoBackupIntervalMin: 5,
  autoBackupKeepCount: 10,

  // Sprint A — AC-1.4: per-preset marker type color overrides
  markerTypeColorOverrides: {},

  // F4 — Independent Show Timer. Default empty per Q-A.
  showTimers: [],
  showLocked: false,
  ultraDark: false,
  themeColor: 'cyan',
  uiSize: 'md',

  licenseKey: null,
  licenseStatus: 'none',
  licenseValidatedAt: null,
  licenseExpiresAt: null,
  trialDaysLeft: null,

  rightTab: 'devices',
  lang: 'en',

  presetName: null,  // restored from Zustand persist on load
  presetPath: null,
  presetDirty: false,
  savedPresets: [],  // loaded async from filesystem on mount
  recentFiles: [],   // loaded from localStorage

  setFilePath: (path, name, duration) => set({ filePath: path, fileName: name, duration }),
  setPlayState: (playState) => set({ playState }),
  setCurrentTime: (() => {
    let lastUpdate = 0
    let lastValue = 0
    return (currentTime: number): void => {
      const now = Date.now()
      // Bypass throttle on large jumps (seek, stop, end) so the final value is never lost
      const jump = Math.abs(currentTime - lastValue) > 0.5
      if (jump || now - lastUpdate >= 33) {
        lastUpdate = now
        lastValue = currentTime
        set({ currentTime })
      }
    }
  })(),
  setLoop: (loop) => set({ loop }),
  setLoopA: (loopA) => set((s) => {
    // If setting A and B already exists, enforce A < B
    if (loopA !== null && s.loopB !== null && loopA >= s.loopB) return s
    return { loopA }
  }),
  setLoopB: (loopB) => set((s) => {
    // Clamp loopB to at least 50ms before end of file so the A-B loop
    // fires before musicSource.onended stops playback at file end
    const clamped = loopB !== null && s.duration > 0
      ? Math.min(loopB, s.duration - 0.05)
      : loopB
    // Enforce A < B after clamping (not before) to avoid edge-case inconsistency
    if (clamped !== null && s.loopA !== null && clamped <= s.loopA) return s
    return { loopB: clamped }
  }),
  clearLoop: () => set({ loopA: null, loopB: null }),
  setTimecode: (timecode) => set({ timecode }),
  setDetectedFps: (detectedFps) => set({ detectedFps }),
  setForceFps: (forceFps) => set({ forceFps, presetDirty: true }),
  setOffsetFrames: (offsetFrames) => set({ offsetFrames: Math.max(-999, Math.min(999, offsetFrames)), presetDirty: true }),
  setLtcChannel: (ltcChannel) => set({ ltcChannel, presetDirty: true }),
  setDetectedLtcChannel: (detectedLtcChannel) => set({ detectedLtcChannel }),
  setLtcSignalOk: (ltcSignalOk) => set({ ltcSignalOk }),
  setTcGeneratorMode: (tcGeneratorMode) => set({ tcGeneratorMode, presetDirty: true }),
  setGeneratorStartTC: (generatorStartTC) => set({ generatorStartTC, presetDirty: true }),
  setGeneratorFps: (generatorFps) => set({ generatorFps, presetDirty: true }),
  setLtcConfidence: (ltcConfidence) => set({ ltcConfidence }),
  setLtcStartTime: (ltcStartTime) => set({ ltcStartTime }),
  setAudioOutputDevices: (audioOutputDevices) => set({ audioOutputDevices }),
  setMusicOutputDeviceId: (musicOutputDeviceId) => set({ musicOutputDeviceId, presetDirty: true }),
  setLtcOutputDeviceId: (ltcOutputDeviceId) => set({ ltcOutputDeviceId, presetDirty: true }),
  setLtcGain: (ltcGain) => set({ ltcGain, presetDirty: true }),
  setMusicVolume: (musicVolume) => set({ musicVolume: Math.max(0, Math.min(5.7, musicVolume)), presetDirty: true }),
  setMusicPan: (musicPan) => set({ musicPan: Math.max(-1.0, Math.min(1.0, musicPan)), presetDirty: true }),
  setMidiOutputs: (midiOutputs) => set({ midiOutputs }),
  setSelectedMidiPort: (selectedMidiPort) => set({ selectedMidiPort, presetDirty: true }),
  setMidiConnected: (midiConnected) => set({ midiConnected }),
  setMtcMode: (mtcMode) => set({ mtcMode, presetDirty: true }),
  setArtnetEnabled: (artnetEnabled) => set({ artnetEnabled, presetDirty: true }),
  setArtnetTargetIp: (artnetTargetIp) => set({ artnetTargetIp, presetDirty: true }),
  setOscEnabled: (oscEnabled) => set({ oscEnabled, presetDirty: true }),
  setOscTargetIp: (oscTargetIp) => set({ oscTargetIp, presetDirty: true }),
  setOscTargetPort: (oscTargetPort) => set({ oscTargetPort, presetDirty: true }),
  // F3 — OSC Feedback. Per Q-G: persist via Zustand only, never touch
  // presetDirty, never written to .ltcast preset.
  setOscFeedbackEnabled: (oscFeedbackEnabled) => set({ oscFeedbackEnabled }),
  setOscFeedbackPort: (oscFeedbackPort) => {
    if (!Number.isInteger(oscFeedbackPort) || oscFeedbackPort < 1024 || oscFeedbackPort > 65535) return
    set({ oscFeedbackPort })
  },
  setOscFeedbackBindAddress: (oscFeedbackBindAddress) => {
    // Strict whitelist: defends against accidental binding to any other interface.
    if (oscFeedbackBindAddress !== '127.0.0.1' && oscFeedbackBindAddress !== '0.0.0.0') return
    set({ oscFeedbackBindAddress })
  },
  recordOscFeedbackDevice: (sourceId, tc, ts) => set((s) => {
    // Existing device — always update timestamp + TC.
    if (sourceId in s.oscFeedbackDevices) {
      return {
        oscFeedbackDevices: {
          ...s.oscFeedbackDevices,
          [sourceId]: { sourceId, lastTc: tc, lastSeenAt: ts }
        }
      }
    }
    // New device — only accept if under the 32-device cap. Drop new sources
    // when full (NOT evict). Mirrors the main-side cap and prevents an
    // attacker from rotating source IPs to force eviction of a real device.
    if (Object.keys(s.oscFeedbackDevices).length >= 32) return {}
    return {
      oscFeedbackDevices: {
        ...s.oscFeedbackDevices,
        [sourceId]: { sourceId, lastTc: tc, lastSeenAt: ts }
      }
    }
  }),
  pruneOscFeedbackDevices: (now, maxAgeMs) => set((s) => {
    let changed = false
    const next: Record<string, FeedbackDevice> = {}
    for (const [k, v] of Object.entries(s.oscFeedbackDevices)) {
      if (now - v.lastSeenAt <= maxAgeMs) {
        next[k] = v
      } else {
        changed = true
      }
    }
    return changed ? { oscFeedbackDevices: next } : {}
  }),
  clearOscFeedbackDevices: () => set({ oscFeedbackDevices: {} }),
  setMidiClockEnabled: (midiClockEnabled) => set({ midiClockEnabled, presetDirty: true }),
  setMidiClockSource: (midiClockSource) => set({ midiClockSource, presetDirty: true }),
  setMidiClockManualBpm: (midiClockManualBpm) => set({ midiClockManualBpm: Math.max(20, Math.min(300, midiClockManualBpm)), presetDirty: true }),
  setOscTemplate: (oscTemplate) => set({ oscTemplate, presetDirty: true }),
  setTappedBpm: (tappedBpm) => set({ tappedBpm }),
  setDetectedBpm: (detectedBpm) => set({ detectedBpm }),
  setVideoFile: (videoFileName, videoWaveform, videoDuration) =>
    set({ videoFileName, videoWaveform, videoDuration }),
  setVideoOffsetSeconds: (videoOffsetSeconds) => set({ videoOffsetSeconds }),
  setVideoStartTimecode: (videoStartTimecode) => set({ videoStartTimecode }),
  setVideoLoading: (videoLoading) => set({ videoLoading }),
  setAudioLoading: (loading, fileName) => set({ audioLoading: loading, loadingFileName: loading ? (fileName ?? null) : null }),
  setTimecodeLookup: (timecodeLookup) => set({ timecodeLookup }),
  clearVideo: () => set({
    videoFileName: null, videoWaveform: null, videoDuration: 0,
    videoOffsetSeconds: 0, videoStartTimecode: null
  }),
  // ── F10 Variant helpers ──────────────────────────────────────────────
  // Helper: apply updater to top-level setlist and mirror into active variant.
  // Returns { setlist, setlistVariants } patch — caller spreads into set().

  addSetlistVariant: (name) => {
    const id = nextVariantId()
    set((s) => ({
      // Write current top-level setlist back into active variant first
      setlistVariants: [
        ...s.setlistVariants.map(v =>
          v.id === s.activeSetlistVariantId ? { ...v, setlist: s.setlist, activeSetlistIndex: s.activeSetlistIndex } : v
        ),
        { id, name: name.trim() || 'Variant', setlist: [], activeSetlistIndex: null }
      ],
      // Switch to new empty variant
      setlist: [],
      activeSetlistIndex: null,
      activeSetlistVariantId: id,
      presetDirty: true
    }))
    return id
  },

  renameSetlistVariant: (id, newName) => set((s) => ({
    setlistVariants: s.setlistVariants.map(v =>
      v.id === id ? { ...v, name: newName.trim() || v.name } : v
    ),
    presetDirty: true
  })),

  deleteSetlistVariant: (id) => set((s) => {
    if (s.setlistVariants.length <= 1) return s // can't delete last
    const idx = s.setlistVariants.findIndex(v => v.id === id)
    if (idx === -1) return s
    const newVariants = s.setlistVariants.filter(v => v.id !== id)
    if (s.activeSetlistVariantId !== id) {
      return { setlistVariants: newVariants, presetDirty: true }
    }
    // Deleting active variant — switch to adjacent
    const targetIdx = Math.max(0, idx - 1)
    const target = newVariants[targetIdx]
    return {
      setlistVariants: newVariants,
      activeSetlistVariantId: target.id,
      setlist: target.setlist,
      activeSetlistIndex: target.activeSetlistIndex,
      presetDirty: true
    }
  }),

  duplicateSetlistVariant: (id, newName) => {
    const newId = nextVariantId()
    set((s) => {
      const source = s.setlistVariants.find(v => v.id === id)
      if (!source) return s
      const dup: SetlistVariant = {
        id: newId,
        name: newName.trim() || `${source.name} copy`,
        setlist: source.setlist.map(item => ({ ...item, id: nextSetlistId() })),
        activeSetlistIndex: null
      }
      // Write current setlist back if active variant is the source
      const updatedVariants = s.setlistVariants.map(v =>
        v.id === s.activeSetlistVariantId ? { ...v, setlist: s.setlist, activeSetlistIndex: s.activeSetlistIndex } : v
      )
      return {
        setlistVariants: [...updatedVariants, dup],
        presetDirty: true
      }
    })
    return newId
  },

  switchSetlistVariant: (id) => set((s) => {
    if (id === s.activeSetlistVariantId) return s
    const target = s.setlistVariants.find(v => v.id === id)
    if (!target) return s
    // Write back current top-level setlist into active variant
    const updatedVariants = s.setlistVariants.map(v =>
      v.id === s.activeSetlistVariantId ? { ...v, setlist: s.setlist, activeSetlistIndex: s.activeSetlistIndex } : v
    )
    return {
      setlistVariants: updatedVariants,
      activeSetlistVariantId: id,
      setlist: target.setlist,
      activeSetlistIndex: target.activeSetlistIndex,
      // If playing, stop playback (AC-10.6)
      playState: 'stopped',
      presetDirty: true
    }
  }),

  addToSetlist: (items) => set((s) => {
    const newSetlist = [...s.setlist, ...items
      .filter(item => !s.setlist.some(existing => existing.path === item.path))
      .map(item => ({ ...item, id: item.id || nextSetlistId() }))
    ]
    return {
      setlist: newSetlist,
      setlistVariants: s.setlistVariants.map(v =>
        v.id === s.activeSetlistVariantId ? { ...v, setlist: newSetlist } : v
      ),
      presetDirty: true
    }
  }),
  removeFromSetlist: (index) => set((s) => {
    if (index < 0 || index >= s.setlist.length) return s
    const setlist = [...s.setlist]
    setlist.splice(index, 1)
    const shift = (i: number | null): number | null =>
      i === null ? null : i === index ? null : i > index ? i - 1 : i
    const newActiveIndex = shift(s.activeSetlistIndex)
    return {
      setlist,
      setlistVariants: s.setlistVariants.map(v =>
        v.id === s.activeSetlistVariantId ? { ...v, setlist, activeSetlistIndex: newActiveIndex } : v
      ),
      activeSetlistIndex: newActiveIndex,
      standbySetlistIndex: shift(s.standbySetlistIndex),
      presetDirty: true
    }
  }),
  setActiveSetlistIndex: (activeSetlistIndex) => set({ activeSetlistIndex }),
  setStandbySetlistIndex: (standbySetlistIndex) => set({ standbySetlistIndex }),
  // Transient UI feedback for the prebuffer subscriber. Not persisted and
  // does not mark the preset dirty (per Q4 decision — field exists for a
  // future UI sprint; v0.5.2 has no renderer reading it).
  setPrebufferingIndex: (prebufferingIndex) => set({ prebufferingIndex }),
  reorderSetlist: (from, to) => set((s) => {
    if (from < 0 || from >= s.setlist.length || to < 0 || to >= s.setlist.length) return s
    if (from === to) return s
    const activeItem = s.activeSetlistIndex !== null ? s.setlist[s.activeSetlistIndex] : null
    const standbyItem = s.standbySetlistIndex !== null ? s.setlist[s.standbySetlistIndex] : null
    const setlist = [...s.setlist]
    const [item] = setlist.splice(from, 1)
    setlist.splice(to, 0, item)
    // Track active + standby items by ID — immune to index arithmetic errors
    const findId = (target: SetlistItem | null): number | null => {
      if (!target) return null
      const i = setlist.findIndex(it => it.id === target.id)
      return i === -1 ? null : i
    }
    const newActiveIndex = findId(activeItem)
    return {
      setlist,
      setlistVariants: s.setlistVariants.map(v =>
        v.id === s.activeSetlistVariantId ? { ...v, setlist, activeSetlistIndex: newActiveIndex } : v
      ),
      activeSetlistIndex: newActiveIndex,
      standbySetlistIndex: findId(standbyItem),
      presetDirty: true
    }
  }),
  clearSetlist: () => {
    const s = useStore.getState()
    if (s.setlist.length === 0) return
    window.api.showConfirmDialog(
      t(s.lang, 'confirmClearSetlist')
    ).then(ok => {
      if (!ok) return
      // Re-read state in case it changed during the dialog
      const current = useStore.getState()
      if (current.setlist.length === 0) return
      set({
        previousSetlist: { setlist: current.setlist, activeIndex: current.activeSetlistIndex },
        setlist: [],
        setlistVariants: current.setlistVariants.map(v =>
          v.id === current.activeSetlistVariantId ? { ...v, setlist: [], activeSetlistIndex: null } : v
        ),
        activeSetlistIndex: null,
        standbySetlistIndex: null,
        presetDirty: true
      })
    }).catch(() => {})
  },
  undoClearSetlist: () => set((s) => {
    if (!s.previousSetlist) return s
    const restoredSetlist = s.previousSetlist.setlist
    const restoredIdx = s.previousSetlist.activeIndex
    return {
      setlist: restoredSetlist,
      setlistVariants: s.setlistVariants.map(v =>
        v.id === s.activeSetlistVariantId ? { ...v, setlist: restoredSetlist, activeSetlistIndex: restoredIdx } : v
      ),
      activeSetlistIndex: restoredIdx,
      previousSetlist: null,
      presetDirty: true
    }
  }),
  sortSetlist: (mode: SortMode) => set((s) => {
    let sorted: SetlistItem[]
    switch (mode) {
      case 'az':
        sorted = [...s.setlist].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
        break
      case 'za':
        sorted = [...s.setlist].sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' }))
        break
      case 'ext':
        sorted = [...s.setlist].sort((a, b) => {
          const extA = a.name.includes('.') ? a.name.split('.').pop()!.toLowerCase() : ''
          const extB = b.name.includes('.') ? b.name.split('.').pop()!.toLowerCase() : ''
          if (extA !== extB) return extA.localeCompare(extB)
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        })
        break
      case 'reverse':
        sorted = [...s.setlist].reverse()
        break
    }
    // Track where active item ended up
    let activeSetlistIndex = s.activeSetlistIndex
    if (activeSetlistIndex !== null) {
      if (activeSetlistIndex >= s.setlist.length) {
        activeSetlistIndex = null
      } else {
        const activeItem = s.setlist[activeSetlistIndex]
        activeSetlistIndex = sorted.findIndex(item => item.id === activeItem.id)
        if (activeSetlistIndex === -1) activeSetlistIndex = null
      }
    }
    return {
      setlist: sorted,
      setlistVariants: s.setlistVariants.map(v =>
        v.id === s.activeSetlistVariantId ? { ...v, setlist: sorted, activeSetlistIndex } : v
      ),
      activeSetlistIndex,
      presetDirty: true
    }
  }),
  batchUpdateSetlistPaths: (updates: Array<{ index: number; newPath: string }>) => set((s) => {
    const setlist = [...s.setlist]
    for (const { index, newPath } of updates) {
      if (index < 0 || index >= setlist.length) continue
      const newName = newPath.split(/[/\\]/).pop() ?? setlist[index].name
      setlist[index] = { ...setlist[index], path: newPath, name: newName }
    }
    return {
      setlist,
      setlistVariants: s.setlistVariants.map(v =>
        v.id === s.activeSetlistVariantId ? { ...v, setlist } : v
      ),
      presetDirty: true
    }
  }),
  setSetlistItemOffset: (index: number, offsetFrames: number | undefined) => set((s) => {
    if (index < 0 || index >= s.setlist.length) return s
    const setlist = [...s.setlist]
    const clamped = offsetFrames !== undefined ? Math.max(-9999, Math.min(9999, offsetFrames)) : undefined
    setlist[index] = { ...setlist[index], offsetFrames: clamped }
    return {
      setlist,
      setlistVariants: s.setlistVariants.map(v =>
        v.id === s.activeSetlistVariantId ? { ...v, setlist } : v
      ),
      presetDirty: true
    }
  }),
  setSetlistItemNotes: (index: number, notes: string | undefined) => set((s) => {
    if (index < 0 || index >= s.setlist.length) return s
    const capped = notes ? notes.slice(0, 500) : undefined
    const setlist = [...s.setlist]
    setlist[index] = { ...setlist[index], notes: capped || undefined }
    return {
      setlist,
      setlistVariants: s.setlistVariants.map(v =>
        v.id === s.activeSetlistVariantId ? { ...v, setlist } : v
      ),
      presetDirty: true
    }
  }),
  setSetlistItemStageNote: (index: number, stageNote: string | undefined) => set((s) => {
    if (index < 0 || index >= s.setlist.length) return s
    const capped = stageNote ? stageNote.slice(0, 200) : undefined
    const setlist = [...s.setlist]
    setlist[index] = { ...setlist[index], stageNote: capped || undefined }
    return {
      setlist,
      setlistVariants: s.setlistVariants.map(v =>
        v.id === s.activeSetlistVariantId ? { ...v, setlist } : v
      ),
      presetDirty: true
    }
  }),
  setSetlistItemMidiCues: (index: number, cues: MidiCuePoint[]) => set((s) => {
    if (index < 0 || index >= s.setlist.length) return s
    const setlist = [...s.setlist]
    setlist[index] = { ...setlist[index], midiCues: cues }
    return {
      setlist,
      setlistVariants: s.setlistVariants.map(v =>
        v.id === s.activeSetlistVariantId ? { ...v, setlist } : v
      ),
      presetDirty: true
    }
  }),

  // Sprint B — F5: replace setlist item audio path
  setSetlistItemPath: (index, path, name) => set((s) => {
    if (index < 0 || index >= s.setlist.length) return s
    const setlist = [...s.setlist]
    setlist[index] = { ...setlist[index], path, name }
    return {
      setlist,
      setlistVariants: s.setlistVariants.map(v =>
        v.id === s.activeSetlistVariantId ? { ...v, setlist } : v
      ),
      presetDirty: true
    }
  }),

  // Sprint B — F5: atomic replace audio + markers + midi cues, with undo
  replaceSetlistItemAudio: (index, newPath, newName, shiftedMarkers, shiftedMidiCues, oldPath, oldName, oldMarkers, oldMidiCues) => set((s) => {
    if (index < 0 || index >= s.setlist.length) return s
    const itemId = s.setlist[index].id

    // Build snapshot of current markers for undo (includes old path info)
    // We encode the path change into a special undo entry by stashing old path
    // in the setlist snapshot inside markerUndoStack. We use a composite approach:
    // push old markers map AND old setlist item info as a special undo entry.
    const prevMarkers = { ...s.markers }
    const prevSetlist = [...s.setlist]

    const newSetlist = [...s.setlist]
    newSetlist[index] = { ...newSetlist[index], path: newPath, name: newName, midiCues: shiftedMidiCues }

    const newMarkers = {
      ...s.markers,
      [itemId]: shiftedMarkers
    }

    // Push a composite undo entry that includes both the old markers map and
    // a special _setlistPatch key so undoMarker can also revert path+midiCues.
    // We encode this as a special property on the markers snapshot object.
    const undoEntry = {
      ...prevMarkers,
      _setlistPatch: [{
        index,
        path: oldPath,
        name: oldName,
        midiCues: oldMidiCues,
        markersBefore: oldMarkers
      }]
    } as Record<string, WaveformMarker[]> & { _setlistPatch?: unknown }

    return {
      markerUndoStack: [...s.markerUndoStack.slice(-19), undoEntry as Record<string, WaveformMarker[]>],
      markers: newMarkers,
      setlist: newSetlist,
      setlistVariants: s.setlistVariants.map(v =>
        v.id === s.activeSetlistVariantId ? { ...v, setlist: newSetlist } : v
      ),
      presetDirty: true
    }
  }),

  // Sprint B — F7: last session management
  saveLastSession: (filePath, fileName, positionSeconds, setlistIndex) => set({
    lastSession: { filePath, fileName, positionSeconds, setlistIndex, savedAt: Date.now() }
  }),
  clearLastSession: () => set({ lastSession: null }),
  setDisableResumePrompt: (disabled) => set({ disableResumePrompt: disabled }),

  // Sprint D — F11: auto backup settings actions
  setAutoBackupEnabled: (enabled) => set({ autoBackupEnabled: enabled }),
  setAutoBackupIntervalMin: (min) => set({ autoBackupIntervalMin: Math.max(1, Math.min(60, min)) }),
  setAutoBackupKeepCount: (count) => set({ autoBackupKeepCount: Math.max(1, Math.min(100, count)) }),

  setRightTab: (rightTab) => set({ rightTab }),

  // ── F4 Show Timer actions ──────────────────────────────────────────
  // Timers are per-install (Zustand persist only, NOT in .ltcast preset per
  // Q-E), so none of these mark presetDirty.
  addShowTimer: (name, durationMs) => set((s) => {
    const trimmed = name.trim() || 'Timer'
    const safeDuration = Math.max(1000, Math.floor(durationMs))
    const newTimer: ShowTimer = {
      id: nextShowTimerId(),
      name: trimmed,
      durationMs: safeDuration,
      running: false,
      startedAt: null,
      remainingMsAtStop: safeDuration,
    }
    return { showTimers: [...s.showTimers, newTimer] }
  }),
  removeShowTimer: (id) => set((s) => ({
    showTimers: s.showTimers.filter(t => t.id !== id),
  })),
  startShowTimer: (id) => set((s) => ({
    showTimers: s.showTimers.map(t => {
      if (t.id !== id) return t
      // Idempotent: calling start on an already-running timer is a no-op.
      // Prevents accidental double-click from resetting the anchor + visibly
      // snapping the remaining back up.
      if (t.running) return t
      // Resume from the last-known remaining; startedAt anchors wall-clock.
      const remaining = t.remainingMsAtStop > 0 ? t.remainingMsAtStop : t.durationMs
      return {
        ...t,
        running: true,
        // Pretend startedAt = now - (durationMs - remaining) so the running-time
        // math (durationMs - (now - startedAt)) yields `remaining` right now.
        startedAt: Date.now() - (t.durationMs - remaining),
        remainingMsAtStop: remaining,
      }
    }),
  })),
  stopShowTimer: (id) => set((s) => ({
    showTimers: s.showTimers.map(t => {
      if (t.id !== id || !t.running || t.startedAt === null) return t
      const elapsed = Date.now() - t.startedAt
      const remaining = Math.max(0, Math.min(t.durationMs, t.durationMs - elapsed))
      return { ...t, running: false, startedAt: null, remainingMsAtStop: remaining }
    }),
  })),
  resetShowTimer: (id) => set((s) => ({
    showTimers: s.showTimers.map(t =>
      t.id === id
        ? { ...t, running: false, startedAt: null, remainingMsAtStop: t.durationMs }
        : t
    ),
  })),
  renameShowTimer: (id, name) => set((s) => ({
    showTimers: s.showTimers.map(t =>
      t.id === id ? { ...t, name: name.trim() || t.name } : t
    ),
  })),
  setShowTimerDuration: (id, durationMs) => set((s) => ({
    showTimers: s.showTimers.map(t => {
      if (t.id !== id) return t
      const safe = Math.max(1000, Math.floor(durationMs))
      return {
        ...t,
        durationMs: safe,
        // If idle (not running), snap remaining to the new duration.
        remainingMsAtStop: t.running ? t.remainingMsAtStop : safe,
      }
    }),
  })),
  // Called by the panel when wall-clock shows the timer has crossed zero
  // while running. Flips `running` off and pins remaining to 0 so the
  // next render stops ticking (AC-6).
  markShowTimerCompleted: (id) => set((s) => ({
    showTimers: s.showTimers.map(t =>
      t.id === id && t.running
        ? { ...t, running: false, startedAt: null, remainingMsAtStop: 0 }
        : t
    ),
  })),

  setLang: (lang) => set({ lang, presetDirty: true }),
  setShowLocked: (showLocked) => set({ showLocked, presetDirty: true }),
  setUltraDark: (ultraDark) => set({ ultraDark }),
  setThemeColor: (themeColor) => set({ themeColor }),
  setUiSize: (uiSize) => set({ uiSize }),
  setAutoAdvance: (autoAdvance) => set({ autoAdvance, presetDirty: true }),
  setAutoAdvanceGap: (autoAdvanceGap) => set({ autoAdvanceGap: Math.max(0, Math.min(30, autoAdvanceGap)), presetDirty: true }),
  setSelectedCueMidiPort: (selectedCueMidiPort) => set({ selectedCueMidiPort, presetDirty: true }),
  setMidiInputPort: (midiInputPort) => set({ midiInputPort, presetDirty: true }),
  setMidiMappings: (midiMappings) => set({ midiMappings, presetDirty: true }),
  addMidiMapping: (mapping) => set((s) => ({ midiMappings: [...s.midiMappings, mapping], presetDirty: true })),
  updateMidiMapping: (id, partial) => set((s) => ({
    midiMappings: s.midiMappings.map(m => m.id === id ? { ...m, ...partial } : m),
    presetDirty: true
  })),
  removeMidiMapping: (id) => set((s) => ({
    midiMappings: s.midiMappings.filter(m => m.id !== id),
    presetDirty: true
  })),
  setMidiInputs: (midiInputs) => set({ midiInputs }),

  // Marker actions still take filePath at the public boundary (every existing
  // caller already has a filePath in scope). Internally we resolve to the
  // setlist item's stable id and store under that — this is what makes
  // markers travel correctly when the preset is shared to another machine.
  // If the file isn't currently in the setlist, the call is a silent no-op
  // (single-file mode markers are not supported in v0.5.4 per Q-A).
  addMarker: (filePath, marker) => set((s) => {
    const itemId = s.setlist.find(it => it.path === filePath)?.id
    if (!itemId) return s
    return {
      markerUndoStack: [...s.markerUndoStack.slice(-19), s.markers],
      markers: {
        ...s.markers,
        [itemId]: [...(s.markers[itemId] ?? []), marker]
      },
      presetDirty: true
    }
  }),
  removeMarker: (filePath, markerId) => set((s) => {
    const itemId = s.setlist.find(it => it.path === filePath)?.id
    if (!itemId) return s
    return {
      markerUndoStack: [...s.markerUndoStack.slice(-19), s.markers],
      markers: {
        ...s.markers,
        [itemId]: (s.markers[itemId] ?? []).filter(m => m.id !== markerId)
      },
      presetDirty: true
    }
  }),
  updateMarker: (filePath, markerId, updates) => set((s) => {
    const itemId = s.setlist.find(it => it.path === filePath)?.id
    if (!itemId) return s
    return {
      markerUndoStack: [...s.markerUndoStack.slice(-19), s.markers],
      markers: {
        ...s.markers,
        [itemId]: (s.markers[itemId] ?? []).map(m => m.id === markerId ? { ...m, ...updates } : m)
      },
      presetDirty: true
    }
  }),
  undoMarker: () => set((s) => {
    if (s.markerUndoStack.length === 0) return s
    const prev = s.markerUndoStack[s.markerUndoStack.length - 1]
    // Sprint B — F5: check for composite undo entry (audio swap)
    const patch = (prev as Record<string, unknown>)._setlistPatch as Array<{
      index: number; path: string; name: string; midiCues: MidiCuePoint[]; markersBefore: WaveformMarker[]
    }> | undefined
    if (patch) {
      // Restore setlist item paths + midiCues + markers from before the swap
      const setlist = [...s.setlist]
      const cleanMarkers: Record<string, WaveformMarker[]> = {}
      // Copy prev markers without _setlistPatch
      for (const [k, v] of Object.entries(prev)) {
        if (k !== '_setlistPatch') cleanMarkers[k] = v as WaveformMarker[]
      }
      for (const entry of patch) {
        if (entry.index >= 0 && entry.index < setlist.length) {
          const itemId = setlist[entry.index].id
          setlist[entry.index] = { ...setlist[entry.index], path: entry.path, name: entry.name, midiCues: entry.midiCues }
          if (entry.markersBefore.length > 0) {
            cleanMarkers[itemId] = entry.markersBefore
          } else {
            delete cleanMarkers[itemId]
          }
        }
      }
      return {
        markers: cleanMarkers,
        setlist,
        markerUndoStack: s.markerUndoStack.slice(0, -1),
        presetDirty: true
      }
    }
    return {
      markers: prev,
      markerUndoStack: s.markerUndoStack.slice(0, -1),
      presetDirty: true
    }
  }),

  setWaveformZoom: (filePath, pxPerSec) => set((s) => ({
    waveformZoom: { ...s.waveformZoom, [filePath]: pxPerSec }
  })),

  // Sprint A — per-install actions
  setMarkerTypeFilter: (markerTypeFilter) => set({ markerTypeFilter }),
  setShowLoopDragLabel: (showLoopDragLabel) => set({ showLoopDragLabel }),
  setNumericKeyAction: (numericKeyAction) => set({ numericKeyAction }),

  // Sprint A — AC-1.4: per-preset marker type color override
  setMarkerTypeColorOverride: (markerType, color) => set((s) => {
    const overrides = { ...s.markerTypeColorOverrides }
    if (color === null) {
      delete overrides[markerType]
    } else {
      overrides[markerType] = color
    }
    return { markerTypeColorOverrides: overrides, presetDirty: true }
  }),

  // License actions
  setLicenseKey: (licenseKey) => set({ licenseKey }),
  setLicenseStatus: (licenseStatus) => set({ licenseStatus }),
  setLicenseValidatedAt: (licenseValidatedAt) => set({ licenseValidatedAt }),
  setLicenseExpiresAt: (licenseExpiresAt) => set({ licenseExpiresAt }),
  isPro: () => {
    // Dev mode: always unlock Pro features for local testing (npm run dev).
    // Production builds (npm run package) have import.meta.env.DEV === false.
    if (import.meta.env.DEV) return true

    const s = useStore.getState()
    // Licensed user — 30-day offline grace period (live events often have no internet)
    if (s.licenseStatus === 'valid') {
      // Promo licenses: check hard expiry date first
      if (s.licenseExpiresAt && new Date(s.licenseExpiresAt) < new Date()) return false
      // Must have a validation timestamp — reject if missing (corrupt/tampered state)
      if (!s.licenseValidatedAt) return false
      const daysSince = (Date.now() - s.licenseValidatedAt) / (1000 * 60 * 60 * 24)
      // Clock rollback detection: if validatedAt is in the future, reject
      if (daysSince < -1) return false
      if (daysSince > 30) return false
      return true
    }
    // Trial user
    if (s.trialDaysLeft !== null && s.trialDaysLeft > 0) return true
    return false
  },
  setTrialDaysLeft: (trialDaysLeft: number | null) => set({ trialDaysLeft }),

  newPreset: () => {
    set({
      // Clear loaded file
      filePath: null,
      fileName: null,
      duration: 0,
      playState: 'stopped',
      currentTime: 0,
      timecode: null,
      detectedFps: null,
      tappedBpm: null,
      detectedBpm: null,
      timecodeLookup: [],
      // Clear video
      videoFileName: null,
      videoWaveform: null,
      videoDuration: 0,
      videoOffsetSeconds: 0,
      videoStartTimecode: null,
      videoLoading: false,
      // Reset settings
      offsetFrames: 0,
      loop: false,
      loopA: null,
      loopB: null,
      musicOutputDeviceId: 'default',
      ltcOutputDeviceId: 'default',
      ltcGain: 1.0,
      musicVolume: 1.0,
      musicPan: 0.0,
      selectedMidiPort: null,
      forceFps: null,
      ltcChannel: 'auto',
      setlist: [],
      setlistVariants: [{ id: 'main', name: 'Main', setlist: [], activeSetlistIndex: null }],
      activeSetlistVariantId: 'main',
      activeSetlistIndex: null,
      previousSetlist: null,
      tcGeneratorMode: false,
      ltcConfidence: 0,
      presetName: null,
      presetPath: null,
      presetDirty: false,
      generatorStartTC: '01:00:00:00',
      generatorFps: 25,
      mtcMode: 'quarter-frame',
      artnetEnabled: false,
      artnetTargetIp: '255.255.255.255',
      autoAdvance: false,
      autoAdvanceGap: 2,
      selectedCueMidiPort: null,
      midiInputPort: null,
      midiMappings: [],
      oscEnabled: false,
      oscTargetIp: '127.0.0.1',
      oscTargetPort: 8000,
      oscTemplate: 'generic',
      midiClockEnabled: false,
      midiClockSource: 'detected',
      midiClockManualBpm: 120,
      standbySetlistIndex: null,
      showLocked: false,
      markers: {},
      waveformZoom: {}
    })
  },

  savePreset: async () => {
    try {
      const s = useStore.getState()
      const data = buildPresetData(s)
      if (s.presetPath && s.presetName) {
        await window.api.savePreset(s.presetName, data, s.presetPath)
        window.api.addRecentFile(s.presetPath, s.presetName)
        const presets = await loadPresetsFromDisk()
        set({ savedPresets: presets, presetDirty: false })
      } else {
        const chosenPath = await window.api.savePresetDialog(s.presetName ?? 'Untitled')
        if (!chosenPath) return
        const name = chosenPath.split(/[/\\]/).pop()!.replace(/\.ltcast$/i, '')
        await window.api.savePreset(name, data, chosenPath)
        window.api.addRecentFile(chosenPath, name)
        const presets = await loadPresetsFromDisk()
        set({ savedPresets: presets, presetName: name, presetPath: chosenPath, presetDirty: false })
      }
    } catch (e) { console.error('Save preset failed:', e); toast.error(t(useStore.getState().lang, 'saveFailed')) }
  },

  savePresetAs: async () => {
    try {
      const s = useStore.getState()
      const data = buildPresetData(s)
      const chosenPath = await window.api.savePresetDialog(s.presetName ?? 'Untitled')
      if (!chosenPath) return
      const name = chosenPath.split(/[/\\]/).pop()!.replace(/\.ltcast$/i, '')
      await window.api.savePreset(name, data, chosenPath)
      window.api.addRecentFile(chosenPath, name)
      const presets = await loadPresetsFromDisk()
      set({ savedPresets: presets, presetName: name, presetPath: chosenPath, presetDirty: false })
    } catch (e) { console.error('Save preset failed:', e); toast.error(t(useStore.getState().lang, 'saveFailed')) }
  },

  openProject: async () => {
    const result = await window.api.importPreset()
    if (!result) return
    warnIfNewerVersion(result.data as PresetData)
    const presetData = ensureSetlistIds(migratePreset(result.data as PresetData))
    const presets = await loadPresetsFromDisk()
    // Add to recent files
    useStore.getState().addRecentFile(result.path ?? '', result.name)
    const { setlistVariants, activeSetlistVariantId } = resolveVariantsFromPreset(presetData)
    const activeVariant = setlistVariants.find(v => v.id === activeSetlistVariantId) ?? setlistVariants[0]
    const markersFromItems = deriveMarkersFromAllVariants(setlistVariants)
    set({
      ...presetData,
      setlist: activeVariant.setlist,
      setlistVariants,
      activeSetlistVariantId,
      markers: markersFromItems,
      markerUndoStack: [],
      loopA: presetData.loopA ?? null, loopB: presetData.loopB ?? null,
      previousSetlist: null,
      activeSetlistIndex: null,
      savedPresets: presets,
      presetName: result.name,
      presetPath: result.path ?? null,
      presetDirty: false,
      // Clear playback state
      filePath: null, fileName: null, duration: 0,
      playState: 'stopped', currentTime: 0,
      timecode: null, detectedFps: null,
      tappedBpm: null, detectedBpm: null, timecodeLookup: [],
      videoFileName: null, videoWaveform: null, videoDuration: 0,
      videoOffsetSeconds: 0, videoStartTimecode: null, videoLoading: false,
      tcGeneratorMode: false, ltcConfidence: 0, ltcSignalOk: false, detectedLtcChannel: null
    })
  },

  openRecentFile: async (path: string) => {
    try {
      const result = await window.api.loadPresetFile(path)
      if (!result) return
      warnIfNewerVersion(result.data as PresetData)
      const presetData = ensureSetlistIds(migratePreset(result.data as PresetData))
      const presets = await loadPresetsFromDisk()
      const { setlistVariants, activeSetlistVariantId } = resolveVariantsFromPreset(presetData)
      const activeVariant = setlistVariants.find(v => v.id === activeSetlistVariantId) ?? setlistVariants[0]
      const markersFromItems = deriveMarkersFromAllVariants(setlistVariants)
      // Move to top of recent list and rebuild the native File > Open Recent menu
      useStore.getState().addRecentFile(path, result.name)
      set({
        ...presetData,
        setlist: activeVariant.setlist,
        setlistVariants,
        activeSetlistVariantId,
        markers: markersFromItems,
        markerUndoStack: [],
        loopA: presetData.loopA ?? null, loopB: presetData.loopB ?? null,
        previousSetlist: null,
        activeSetlistIndex: null,
        savedPresets: presets,
        presetName: result.name,
        presetPath: path,
        presetDirty: false,
        filePath: null, fileName: null, duration: 0,
        playState: 'stopped', currentTime: 0,
        timecode: null, detectedFps: null,
        tappedBpm: null, detectedBpm: null, timecodeLookup: [],
        videoFileName: null, videoWaveform: null, videoDuration: 0,
        videoOffsetSeconds: 0, videoStartTimecode: null, videoLoading: false,
        tcGeneratorMode: false, ltcConfidence: 0, ltcSignalOk: false, detectedLtcChannel: null
      })
    } catch { /* file may no longer exist */ }
  },

  addRecentFile: (path: string, name: string) => {
    if (!path) return
    window.api.addRecentFile(path, name).catch(() => {})
    set((s) => {
      const filtered = s.recentFiles.filter(f => f.path !== path)
      const recentFiles = [{ path, name }, ...filtered].slice(0, 10)
      return { recentFiles }
    })
  },

  loadPreset: (name) => set((s) => {
    const preset = s.savedPresets.find(p => p.name === name)
    if (!preset) return s
    warnIfNewerVersion(preset.data)
    const data = ensureSetlistIds(migratePreset(preset.data))
    const { setlistVariants, activeSetlistVariantId } = resolveVariantsFromPreset(data)
    const activeVariant = setlistVariants.find(v => v.id === activeSetlistVariantId) ?? setlistVariants[0]
    const markers = deriveMarkersFromAllVariants(setlistVariants)
    return {
      ...data,
      setlist: activeVariant.setlist,
      setlistVariants,
      activeSetlistVariantId,
      presetName: name, presetPath: null, presetDirty: false,
      markers,
      markerUndoStack: [],
      // Explicitly reset loop points in case old preset doesn't have them
      loopA: data.loopA ?? null, loopB: data.loopB ?? null,
      previousSetlist: null,
      // Reset active index — old index may be out of bounds for the new setlist
      activeSetlistIndex: null,
      // Clear playback state
      filePath: null, fileName: null, duration: 0,
      playState: 'stopped', currentTime: 0,
      timecode: null, detectedFps: null,
      tappedBpm: null, detectedBpm: null, timecodeLookup: [],
      videoFileName: null, videoWaveform: null, videoDuration: 0,
      videoOffsetSeconds: 0, videoStartTimecode: null, videoLoading: false,
      // Reset runtime detection state so old session state doesn't bleed into new preset
      tcGeneratorMode: false, ltcConfidence: 0, ltcSignalOk: false, detectedLtcChannel: null
    }
  }),

  deletePreset: (name) => {
    window.api.deletePreset(name).then(() => {
      // Read current state inside .then() to avoid stale closure
      const isActive = useStore.getState().presetName === name
      loadPresetsFromDisk().then(presets => set({
        savedPresets: presets,
        ...(isActive ? { presetName: null, presetPath: null } : {})
      })).catch(() => {})
    }).catch(() => {})
  },

  resetToDefaults: () => {
    set({
      lang: 'en', rightTab: 'devices', offsetFrames: 0, loop: false,
      loopA: null, loopB: null, previousSetlist: null,
      musicOutputDeviceId: 'default', ltcOutputDeviceId: 'default',
      ltcGain: 1.0, musicVolume: 1.0, musicPan: 0.0, selectedMidiPort: null, forceFps: null,
      ltcChannel: 'auto', setlist: [], activeSetlistIndex: null,
      presetName: null, presetPath: null, presetDirty: false,
      generatorStartTC: '01:00:00:00', generatorFps: 25,
      mtcMode: 'quarter-frame', artnetEnabled: false, artnetTargetIp: '255.255.255.255',
      autoAdvance: false, autoAdvanceGap: 2,
      selectedCueMidiPort: null, midiInputPort: null, midiMappings: [],
      oscEnabled: false, oscTargetIp: '127.0.0.1', oscTargetPort: 8000,
      midiClockEnabled: false, midiClockSource: 'detected', midiClockManualBpm: 120,
      markers: {},
      markerTypeColorOverrides: {}
    })
  },

  refreshPresets: async () => {
    const presets = await loadPresetsFromDisk()
    set({ savedPresets: presets })
  },

  packageProject: async () => {
    const s = useStore.getState()
    const name = s.presetName ?? 'Untitled'
    const data = buildPresetData(s)
    const audioPaths = s.setlist.map(item => item.path)
    if (s.filePath) audioPaths.unshift(s.filePath)
    return window.api.packageProject(name, data, [...new Set(audioPaths)])
  },

  shareProjectZip: async () => {
    const s = useStore.getState()
    const name = s.presetName ?? 'Untitled'
    const data = buildPresetData(s)
    const audioPaths = s.setlist.map(item => item.path)
    if (s.filePath) audioPaths.unshift(s.filePath)
    return window.api.shareProjectZip(name, data, [...new Set(audioPaths)])
  },

  importLtcastProject: async () => {
    const result = await window.api.importLtcastProject()
    if (!result) return false
    const { preset } = result
    const presets = await loadPresetsFromDisk()
    warnIfNewerVersion(preset.data as PresetData)
    const presetData = ensureSetlistIds(migratePreset(preset.data as PresetData))
    // Update setlist paths to point to extracted audio files
    const remapPaths = (items: SetlistItem[]): SetlistItem[] => {
      if (!result.audioPaths.length) return items
      return items.map((item: SetlistItem) => {
        const nameLower = item.name.toLowerCase()
        const basenameOldLower = item.path.split(/[/\\]/).pop()!.toLowerCase()
        const extracted = result.audioPaths.find((p: string) => {
          const pLower = p.toLowerCase()
          return pLower.endsWith(nameLower) || pLower.endsWith(basenameOldLower)
        })
        return extracted ? { ...item, path: extracted } : item
      })
    }
    if (presetData.setlist) presetData.setlist = remapPaths(presetData.setlist)
    const { setlistVariants, activeSetlistVariantId } = resolveVariantsFromPreset(presetData)
    const remappedVariants = setlistVariants.map(v => ({ ...v, setlist: remapPaths(v.setlist) }))
    const activeVariant = remappedVariants.find(v => v.id === activeSetlistVariantId) ?? remappedVariants[0]
    const markersFromItems = deriveMarkersFromAllVariants(remappedVariants)
    set({
      ...presetData,
      setlist: activeVariant.setlist,
      setlistVariants: remappedVariants,
      activeSetlistVariantId,
      markers: markersFromItems,
      markerUndoStack: [],
      loopA: presetData.loopA ?? null, loopB: presetData.loopB ?? null,
      previousSetlist: null,
      activeSetlistIndex: null,
      savedPresets: presets,
      presetName: preset.name,
      presetPath: result.presetFilePath ?? null,
      presetDirty: false,
      filePath: null, fileName: null, duration: 0,
      playState: 'stopped', currentTime: 0,
      timecode: null, detectedFps: null,
      tappedBpm: null, detectedBpm: null, timecodeLookup: [],
      videoFileName: null, videoWaveform: null, videoDuration: 0,
      videoOffsetSeconds: 0, videoStartTimecode: null, videoLoading: false,
      tcGeneratorMode: false, ltcConfidence: 0, ltcSignalOk: false, detectedLtcChannel: null
    })
    return true
  },

  importProject: async () => {
    const result = await window.api.importProject()
    if (!result) return false
    const { preset } = result
    const presets = await loadPresetsFromDisk()
    warnIfNewerVersion(preset.data as PresetData)
    const presetData = ensureSetlistIds(migratePreset(preset.data as PresetData))
    // Update setlist paths to point to extracted audio files
    const remapPaths2 = (items: SetlistItem[]): SetlistItem[] => {
      if (!result.audioPaths.length) return items
      return items.map(item => {
        const nameLower = item.name.toLowerCase()
        const basenameOldLower = item.path.split(/[/\\]/).pop()!.toLowerCase()
        const extracted = result.audioPaths.find(p => {
          const pLower = p.toLowerCase()
          return pLower.endsWith(nameLower) || pLower.endsWith(basenameOldLower)
        })
        return extracted ? { ...item, path: extracted } : item
      })
    }
    if (presetData.setlist) presetData.setlist = remapPaths2(presetData.setlist)
    const { setlistVariants, activeSetlistVariantId } = resolveVariantsFromPreset(presetData)
    const remappedVariants2 = setlistVariants.map(v => ({ ...v, setlist: remapPaths2(v.setlist) }))
    const activeVariant2 = remappedVariants2.find(v => v.id === activeSetlistVariantId) ?? remappedVariants2[0]
    const markersFromItems2 = deriveMarkersFromAllVariants(remappedVariants2)
    set({
      ...presetData,
      setlist: activeVariant2.setlist,
      setlistVariants: remappedVariants2,
      activeSetlistVariantId,
      markers: markersFromItems2,
      markerUndoStack: [],
      loopA: presetData.loopA ?? null, loopB: presetData.loopB ?? null,
      previousSetlist: null,
      activeSetlistIndex: null,
      savedPresets: presets,
      presetName: preset.name,
      presetPath: result.presetFilePath ?? null,
      presetDirty: false,
      // Clear playback state
      filePath: null, fileName: null, duration: 0,
      playState: 'stopped', currentTime: 0,
      timecode: null, detectedFps: null,
      tappedBpm: null, detectedBpm: null, timecodeLookup: [],
      videoFileName: null, videoWaveform: null, videoDuration: 0,
      videoOffsetSeconds: 0, videoStartTimecode: null, videoLoading: false,
      tcGeneratorMode: false, ltcConfidence: 0, ltcSignalOk: false, detectedLtcChannel: null
    })
    return true
  }
}), {
  name: 'ltcast-settings',
  partialize: (state) => ({
    // Only persist user preferences, not transient playback state
    lang: state.lang,
    rightTab: state.rightTab,
    offsetFrames: state.offsetFrames,
    loop: state.loop,
    musicOutputDeviceId: state.musicOutputDeviceId,
    ltcOutputDeviceId: state.ltcOutputDeviceId,
    ltcGain: state.ltcGain,
    musicVolume: state.musicVolume,
    musicPan: state.musicPan,
    selectedMidiPort: state.selectedMidiPort,
    forceFps: state.forceFps,
    ltcChannel: state.ltcChannel,
    setlist: state.setlist,
    setlistVariants: state.setlistVariants,
    activeSetlistVariantId: state.activeSetlistVariantId,
    generatorStartTC: state.generatorStartTC,
    generatorFps: state.generatorFps,
    mtcMode: state.mtcMode,
    artnetEnabled: state.artnetEnabled,
    artnetTargetIp: state.artnetTargetIp,
    autoAdvance: state.autoAdvance,
    autoAdvanceGap: state.autoAdvanceGap,
    selectedCueMidiPort: state.selectedCueMidiPort,
    midiInputPort: state.midiInputPort,
    midiMappings: state.midiMappings,
    oscEnabled: state.oscEnabled,
    oscTargetIp: state.oscTargetIp,
    oscTargetPort: state.oscTargetPort,
    oscTemplate: state.oscTemplate,
    // F3 — OSC Feedback (Q-G: Zustand-only, NOT preset-bound).
    // oscFeedbackDevices is intentionally excluded — transient.
    oscFeedbackEnabled: state.oscFeedbackEnabled,
    oscFeedbackPort: state.oscFeedbackPort,
    oscFeedbackBindAddress: state.oscFeedbackBindAddress,
    midiClockEnabled: state.midiClockEnabled,
    midiClockSource: state.midiClockSource,
    midiClockManualBpm: state.midiClockManualBpm,
    markers: state.markers,
    waveformZoom: state.waveformZoom,
    // Sprint A — per-install settings
    markerTypeFilter: state.markerTypeFilter,
    showLoopDragLabel: state.showLoopDragLabel,
    numericKeyAction: state.numericKeyAction,
    // Sprint B — F7: last session (per-install)
    lastSession: state.lastSession,
    disableResumePrompt: state.disableResumePrompt,
    // Sprint D — F11: auto backup per-install settings
    autoBackupEnabled: state.autoBackupEnabled,
    autoBackupIntervalMin: state.autoBackupIntervalMin,
    autoBackupKeepCount: state.autoBackupKeepCount,
    // F4 — Show Timer: per-install, not per-preset (Q-E). On rehydrate we
    // force running=false in merge() so a ticking timer at quit comes back
    // stopped at its last snapshot (AC-8).
    showTimers: state.showTimers,
    showLocked: state.showLocked,
    ultraDark: state.ultraDark,
    themeColor: state.themeColor,
    uiSize: state.uiSize,
    presetPath: state.presetPath,
    presetName: state.presetName,
    // Crash recovery: persist last played file so we can restore on relaunch
    filePath: state.filePath,
    fileName: state.fileName,
    activeSetlistIndex: state.activeSetlistIndex,
    // License (persist across restarts)
    licenseKey: state.licenseKey,
    licenseStatus: state.licenseStatus,
    licenseValidatedAt: state.licenseValidatedAt,
    licenseExpiresAt: state.licenseExpiresAt,
  }),
  merge: (persisted, current) => {
    if (!persisted || typeof persisted !== 'object') return current
    const merged = { ...current, ...(persisted as object) }
    // Validate critical fields — revert to defaults if corrupted
    if (!Array.isArray(merged.setlist)) merged.setlist = current.setlist
    if (typeof merged.lang !== 'string') merged.lang = current.lang
    if (typeof merged.offsetFrames !== 'number' || !isFinite(merged.offsetFrames)) merged.offsetFrames = current.offsetFrames
    if (typeof merged.generatorFps !== 'number' || merged.generatorFps <= 0) merged.generatorFps = current.generatorFps
    if (!Array.isArray(merged.midiMappings)) merged.midiMappings = current.midiMappings ?? []
    if (typeof merged.markers !== 'object' || merged.markers === null) merged.markers = current.markers ?? {}
    // v8 storage: state.markers is keyed by setlist-item id, not filePath.
    // Detect a legacy localStorage shape (keys are filePaths matching items'
    // path field) and migrate them to id-keyed in place. Markers attached to
    // paths not in the current setlist are dropped silently (Q-D / Q-F).
    if (Array.isArray(merged.setlist) && merged.markers) {
      const ids = new Set<string>(merged.setlist.map((it: SetlistItem) => it.id))
      const persistedKeys = Object.keys(merged.markers)
      const hasIdKey = persistedKeys.some(k => ids.has(k))
      const hasPathKey = persistedKeys.some(
        k => merged.setlist.some((it: SetlistItem) => it.path === k)
      )
      if (!hasIdKey && hasPathKey) {
        // Pure legacy shape (no id keys, has path keys). Migrate.
        const migrated: Record<string, WaveformMarker[]> = {}
        for (const item of merged.setlist as SetlistItem[]) {
          const arr = (merged.markers as Record<string, WaveformMarker[]>)[item.path]
          if (arr && arr.length > 0) migrated[item.id] = arr
        }
        merged.markers = migrated
        // Q-F: signal a one-time toast in the UI on first launch after upgrade.
        // The flag is read + cleared by App.tsx; not persisted.
        ;(merged as { _markersMigrated?: boolean })._markersMigrated = true
      }
    }
    if (typeof merged.waveformZoom !== 'object' || merged.waveformZoom === null) merged.waveformZoom = {}
    // F10 — Validate setlistVariants
    if (!Array.isArray(merged.setlistVariants) || merged.setlistVariants.length === 0) {
      merged.setlistVariants = [{ id: 'main', name: 'Main', setlist: merged.setlist ?? [], activeSetlistIndex: null }]
    }
    if (typeof merged.activeSetlistVariantId !== 'string' ||
        !merged.setlistVariants.some((v: SetlistVariant) => v.id === merged.activeSetlistVariantId)) {
      merged.activeSetlistVariantId = (merged.setlistVariants[0] as SetlistVariant).id
    }
    // Validate license expiry (prevent NaN display from corrupted data)
    if (merged.licenseExpiresAt && isNaN(new Date(merged.licenseExpiresAt).getTime())) merged.licenseExpiresAt = null
    // F3 — OSC Feedback. Validate persisted settings; reset to defaults on
    // corruption. oscFeedbackDevices is always reset to {} on launch (AC-11).
    // v0.5.4 nit fix: ALWAYS force oscFeedbackEnabled=false on launch so the
    // toggle visual matches the actual listener state (which is closed at
    // boot per F3 security baseline). Without this the toggle showed ON but
    // the listener was off, forcing users to flip OFF→ON to re-enable.
    merged.oscFeedbackEnabled = false
    if (
      typeof merged.oscFeedbackPort !== 'number' ||
      !Number.isInteger(merged.oscFeedbackPort) ||
      merged.oscFeedbackPort < 1024 || merged.oscFeedbackPort > 65535
    ) merged.oscFeedbackPort = 9001
    if (merged.oscFeedbackBindAddress !== '127.0.0.1' && merged.oscFeedbackBindAddress !== '0.0.0.0') {
      merged.oscFeedbackBindAddress = '127.0.0.1'
    }
    merged.oscFeedbackDevices = {}
    // Ensure setlist items from old storage have IDs
    merged.setlist = merged.setlist.map((item: SetlistItem) =>
      item.id ? item : { ...item, id: nextSetlistId() }
    )
    // F4 — rehydrate Show Timers as stopped (AC-8). Guard against corrupted
    // storage: anything non-array or missing required fields becomes [].
    if (!Array.isArray(merged.showTimers)) {
      merged.showTimers = []
    } else {
      merged.showTimers = merged.showTimers
        .filter((t: unknown): t is ShowTimer =>
          !!t && typeof t === 'object' &&
          typeof (t as ShowTimer).id === 'string' &&
          typeof (t as ShowTimer).name === 'string' &&
          typeof (t as ShowTimer).durationMs === 'number' &&
          isFinite((t as ShowTimer).durationMs) &&
          (t as ShowTimer).durationMs > 0
        )
        .map((t: ShowTimer) => ({
          id: t.id,
          name: t.name,
          durationMs: t.durationMs,
          // Force-stop on rehydrate — clock rollback / sleep / hibernate all
          // break naive resume (see AC-8 in sprint-contract-F4.md).
          running: false,
          startedAt: null,
          remainingMsAtStop: typeof t.remainingMsAtStop === 'number' && isFinite(t.remainingMsAtStop)
            ? Math.max(0, Math.min(t.durationMs, t.remainingMsAtStop))
            : t.durationMs,
        }))
    }
    return merged as AppState
  },
}))
