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

let _setlistIdCounter = Date.now()
export function nextSetlistId(): string { return `sl-${++_setlistIdCounter}` }

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
  notes?: string         // user notes (e.g. "間奏有換場")
  midiCues?: MidiCuePoint[]  // per-song MIDI cue points
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

export interface PresetData {
  lang: 'en' | 'zh' | 'ja'
  rightTab: 'devices' | 'setlist' | 'cues' | 'structure'
  offsetFrames: number
  loop: boolean
  loopA?: number | null
  loopB?: number | null
  musicOutputDeviceId: string
  ltcOutputDeviceId: string
  ltcGain: number
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
  autoAdvance?: boolean
  autoAdvanceGap?: number
  // Sprint 2: MIDI Cue System
  selectedCueMidiPort?: string | null
  midiInputPort?: string | null
  midiMappings?: MidiMapping[]
  // Sprint 4: Waveform Markers
  markers?: Record<string, WaveformMarker[]>
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
    data.setlist = data.setlist.map(item => item.id ? item : { ...item, id: nextSetlistId() })
  }
  return data
}

const CURRENT_PRESET_VERSION = 5

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
  data.version = CURRENT_PRESET_VERSION
  return data
}

/** Build a PresetData snapshot from the current store state. */
function buildPresetData(s: Pick<AppState,
  'lang' | 'rightTab' | 'offsetFrames' | 'loop' | 'loopA' | 'loopB' | 'musicOutputDeviceId' |
  'ltcOutputDeviceId' | 'ltcGain' | 'selectedMidiPort' | 'forceFps' |
  'ltcChannel' | 'setlist' | 'generatorStartTC' | 'generatorFps' | 'tcGeneratorMode' |
  'artnetEnabled' | 'artnetTargetIp' | 'mtcMode' | 'autoAdvance' | 'autoAdvanceGap' |
  'selectedCueMidiPort' | 'midiInputPort' | 'midiMappings' |
  'oscEnabled' | 'oscTargetIp' | 'oscTargetPort' | 'markers'>): PresetData {
  return {
    version: CURRENT_PRESET_VERSION,
    lang: s.lang, rightTab: s.rightTab, offsetFrames: s.offsetFrames,
    loop: s.loop, loopA: s.loopA, loopB: s.loopB,
    musicOutputDeviceId: s.musicOutputDeviceId,
    ltcOutputDeviceId: s.ltcOutputDeviceId, ltcGain: s.ltcGain,
    selectedMidiPort: s.selectedMidiPort, forceFps: s.forceFps,
    ltcChannel: s.ltcChannel, setlist: s.setlist,
    generatorStartTC: s.generatorStartTC, generatorFps: s.generatorFps,
    tcGeneratorMode: s.tcGeneratorMode,
    artnetEnabled: s.artnetEnabled, artnetTargetIp: s.artnetTargetIp,
    mtcMode: s.mtcMode,
    autoAdvance: s.autoAdvance, autoAdvanceGap: s.autoAdvanceGap,
    selectedCueMidiPort: s.selectedCueMidiPort,
    midiInputPort: s.midiInputPort, midiMappings: s.midiMappings,
    oscEnabled: s.oscEnabled, oscTargetIp: s.oscTargetIp, oscTargetPort: s.oscTargetPort,
    markers: s.markers
  }
}

export type SortMode = 'az' | 'za' | 'ext' | 'reverse'

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

  // Timecode lookup (offline LTC decode)
  timecodeLookup: TimecodeLookupEntry[]

  // Setlist
  setlist: SetlistItem[]
  activeSetlistIndex: number | null
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

  // UI
  rightTab: 'devices' | 'setlist' | 'cues' | 'structure'
  lang: 'en' | 'zh' | 'ja'

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
  setMidiOutputs: (ports: MidiPort[]) => void
  setSelectedMidiPort: (port: string | null) => void
  setMidiConnected: (connected: boolean) => void
  setMtcMode: (mode: 'quarter-frame' | 'full-frame') => void
  setArtnetEnabled: (enabled: boolean) => void
  setArtnetTargetIp: (ip: string) => void
  setOscEnabled: (enabled: boolean) => void
  setOscTargetIp: (ip: string) => void
  setOscTargetPort: (port: number) => void
  setVideoFile: (name: string | null, waveform: Float32Array | null, duration: number) => void
  setVideoOffsetSeconds: (offset: number) => void
  setVideoStartTimecode: (tc: string | null) => void
  setVideoLoading: (loading: boolean) => void
  setTimecodeLookup: (lookup: TimecodeLookupEntry[]) => void
  clearVideo: () => void
  addToSetlist: (items: Array<Omit<SetlistItem, 'id'> & { id?: string }>) => void
  removeFromSetlist: (index: number) => void
  setActiveSetlistIndex: (index: number | null) => void
  reorderSetlist: (from: number, to: number) => void
  clearSetlist: () => void
  undoClearSetlist: () => void
  sortSetlist: (mode: SortMode) => void
  batchUpdateSetlistPaths: (updates: Array<{ index: number; newPath: string }>) => void
  setSetlistItemOffset: (index: number, offsetFrames: number | undefined) => void
  setSetlistItemNotes: (index: number, notes: string | undefined) => void
  setSetlistItemMidiCues: (index: number, cues: MidiCuePoint[]) => void
  setRightTab: (tab: 'devices' | 'setlist' | 'cues' | 'structure') => void
  setLang: (lang: 'en' | 'zh' | 'ja') => void
  setAutoAdvance: (enabled: boolean) => void
  // Waveform Markers (Sprint 4)
  addMarker: (filePath: string, marker: WaveformMarker) => void
  removeMarker: (filePath: string, markerId: string) => void
  updateMarker: (filePath: string, markerId: string, updates: Partial<WaveformMarker>) => void
  undoMarker: () => void
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

  midiOutputs: [],
  selectedMidiPort: null,
  midiConnected: false,

  mtcMode: 'quarter-frame',

  artnetEnabled: false,
  artnetTargetIp: '255.255.255.255',

  oscEnabled: false,
  oscTargetIp: '127.0.0.1',
  oscTargetPort: 8000,

  tappedBpm: null,
  detectedBpm: null,

  videoFileName: null,
  videoWaveform: null,
  videoDuration: 0,
  videoOffsetSeconds: 0,
  videoStartTimecode: null,
  videoLoading: false,

  timecodeLookup: [],

  setlist: [],
  activeSetlistIndex: null,
  previousSetlist: null,
  autoAdvance: false,
  autoAdvanceGap: 2,

  selectedCueMidiPort: null,
  midiInputPort: null,
  midiMappings: [],
  midiInputs: [],

  markers: {},
  markerUndoStack: [],

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
  setMidiOutputs: (midiOutputs) => set({ midiOutputs }),
  setSelectedMidiPort: (selectedMidiPort) => set({ selectedMidiPort, presetDirty: true }),
  setMidiConnected: (midiConnected) => set({ midiConnected }),
  setMtcMode: (mtcMode) => set({ mtcMode, presetDirty: true }),
  setArtnetEnabled: (artnetEnabled) => set({ artnetEnabled, presetDirty: true }),
  setArtnetTargetIp: (artnetTargetIp) => set({ artnetTargetIp, presetDirty: true }),
  setOscEnabled: (oscEnabled) => set({ oscEnabled, presetDirty: true }),
  setOscTargetIp: (oscTargetIp) => set({ oscTargetIp, presetDirty: true }),
  setOscTargetPort: (oscTargetPort) => set({ oscTargetPort, presetDirty: true }),
  setTappedBpm: (tappedBpm) => set({ tappedBpm }),
  setDetectedBpm: (detectedBpm) => set({ detectedBpm }),
  setVideoFile: (videoFileName, videoWaveform, videoDuration) =>
    set({ videoFileName, videoWaveform, videoDuration }),
  setVideoOffsetSeconds: (videoOffsetSeconds) => set({ videoOffsetSeconds }),
  setVideoStartTimecode: (videoStartTimecode) => set({ videoStartTimecode }),
  setVideoLoading: (videoLoading) => set({ videoLoading }),
  setTimecodeLookup: (timecodeLookup) => set({ timecodeLookup }),
  clearVideo: () => set({
    videoFileName: null, videoWaveform: null, videoDuration: 0,
    videoOffsetSeconds: 0, videoStartTimecode: null
  }),
  addToSetlist: (items) => set((s) => ({
    setlist: [...s.setlist, ...items
      .filter(item => !s.setlist.some(existing => existing.path === item.path))
      .map(item => ({ ...item, id: item.id || nextSetlistId() }))
    ],
    presetDirty: true
  })),
  removeFromSetlist: (index) => set((s) => {
    if (index < 0 || index >= s.setlist.length) return s
    const setlist = [...s.setlist]
    setlist.splice(index, 1)
    const activeSetlistIndex = s.activeSetlistIndex === index
      ? null
      : s.activeSetlistIndex !== null && s.activeSetlistIndex > index
        ? s.activeSetlistIndex - 1
        : s.activeSetlistIndex
    return { setlist, activeSetlistIndex, presetDirty: true }
  }),
  setActiveSetlistIndex: (activeSetlistIndex) => set({ activeSetlistIndex }),
  reorderSetlist: (from, to) => set((s) => {
    if (from < 0 || from >= s.setlist.length || to < 0 || to >= s.setlist.length) return s
    if (from === to) return s
    const activeItem = s.activeSetlistIndex !== null ? s.setlist[s.activeSetlistIndex] : null
    const setlist = [...s.setlist]
    const [item] = setlist.splice(from, 1)
    setlist.splice(to, 0, item)
    // Track active item by ID — immune to index arithmetic errors
    let activeSetlistIndex: number | null = null
    if (activeItem) {
      activeSetlistIndex = setlist.findIndex(i => i.id === activeItem.id)
      if (activeSetlistIndex === -1) activeSetlistIndex = null
    }
    return { setlist, activeSetlistIndex, presetDirty: true }
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
        activeSetlistIndex: null,
        presetDirty: true
      })
    }).catch(() => {})
  },
  undoClearSetlist: () => set((s) => {
    if (!s.previousSetlist) return s
    return {
      setlist: s.previousSetlist.setlist,
      activeSetlistIndex: s.previousSetlist.activeIndex,
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
    return { setlist: sorted, activeSetlistIndex, presetDirty: true }
  }),
  batchUpdateSetlistPaths: (updates: Array<{ index: number; newPath: string }>) => set((s) => {
    const setlist = [...s.setlist]
    for (const { index, newPath } of updates) {
      if (index < 0 || index >= setlist.length) continue
      const newName = newPath.split(/[/\\]/).pop() ?? setlist[index].name
      setlist[index] = { ...setlist[index], path: newPath, name: newName }
    }
    return { setlist, presetDirty: true }
  }),
  setSetlistItemOffset: (index: number, offsetFrames: number | undefined) => set((s) => {
    if (index < 0 || index >= s.setlist.length) return s
    const setlist = [...s.setlist]
    const clamped = offsetFrames !== undefined ? Math.max(-9999, Math.min(9999, offsetFrames)) : undefined
    setlist[index] = { ...setlist[index], offsetFrames: clamped }
    return { setlist, presetDirty: true }
  }),
  setSetlistItemNotes: (index: number, notes: string | undefined) => set((s) => {
    if (index < 0 || index >= s.setlist.length) return s
    const setlist = [...s.setlist]
    setlist[index] = { ...setlist[index], notes: notes || undefined }
    return { setlist, presetDirty: true }
  }),
  setSetlistItemMidiCues: (index: number, cues: MidiCuePoint[]) => set((s) => {
    if (index < 0 || index >= s.setlist.length) return s
    const setlist = [...s.setlist]
    setlist[index] = { ...setlist[index], midiCues: cues }
    return { setlist, presetDirty: true }
  }),
  setRightTab: (rightTab) => set({ rightTab }),
  setLang: (lang) => set({ lang, presetDirty: true }),
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

  addMarker: (filePath, marker) => set((s) => ({
    markerUndoStack: [...s.markerUndoStack.slice(-19), s.markers],  // keep last 20
    markers: {
      ...s.markers,
      [filePath]: [...(s.markers[filePath] ?? []), marker]
    },
    presetDirty: true
  })),
  removeMarker: (filePath, markerId) => set((s) => ({
    markerUndoStack: [...s.markerUndoStack.slice(-19), s.markers],
    markers: {
      ...s.markers,
      [filePath]: (s.markers[filePath] ?? []).filter(m => m.id !== markerId)
    },
    presetDirty: true
  })),
  updateMarker: (filePath, markerId, updates) => set((s) => ({
    markerUndoStack: [...s.markerUndoStack.slice(-19), s.markers],
    markers: {
      ...s.markers,
      [filePath]: (s.markers[filePath] ?? []).map(m => m.id === markerId ? { ...m, ...updates } : m)
    },
    presetDirty: true
  })),
  undoMarker: () => set((s) => {
    if (s.markerUndoStack.length === 0) return s
    const prev = s.markerUndoStack[s.markerUndoStack.length - 1]
    return {
      markers: prev,
      markerUndoStack: s.markerUndoStack.slice(0, -1),
      presetDirty: true
    }
  }),

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
      selectedMidiPort: null,
      forceFps: null,
      ltcChannel: 'auto',
      setlist: [],
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
      markers: {}
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
    set({
      ...presetData,
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
      // Move to top of recent list and rebuild the native File > Open Recent menu
      useStore.getState().addRecentFile(path, result.name)
      set({
        ...presetData,
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
    return {
      ...data, presetName: name, presetPath: null, presetDirty: false,
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
      ltcGain: 1.0, selectedMidiPort: null, forceFps: null,
      ltcChannel: 'auto', setlist: [], activeSetlistIndex: null,
      presetName: null, presetPath: null, presetDirty: false,
      generatorStartTC: '01:00:00:00', generatorFps: 25,
      mtcMode: 'quarter-frame', artnetEnabled: false, artnetTargetIp: '255.255.255.255',
      autoAdvance: false, autoAdvanceGap: 2,
      selectedCueMidiPort: null, midiInputPort: null, midiMappings: [],
      oscEnabled: false, oscTargetIp: '127.0.0.1', oscTargetPort: 8000,
      markers: {}
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

  importProject: async () => {
    const result = await window.api.importProject()
    if (!result) return false
    const { preset } = result
    const presets = await loadPresetsFromDisk()
    warnIfNewerVersion(preset.data as PresetData)
    const presetData = ensureSetlistIds(migratePreset(preset.data as PresetData))
    // Update setlist paths to point to extracted audio files
    if (presetData.setlist && result.audioPaths.length > 0) {
      presetData.setlist = presetData.setlist.map(item => {
        const nameLower = item.name.toLowerCase()
        const basenameOldLower = item.path.split(/[/\\]/).pop()!.toLowerCase()
        const extracted = result.audioPaths.find(p => {
          const pLower = p.toLowerCase()
          return pLower.endsWith(nameLower) || pLower.endsWith(basenameOldLower)
        })
        return extracted ? { ...item, path: extracted } : item
      })
    }
    set({
      ...presetData,
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
    selectedMidiPort: state.selectedMidiPort,
    forceFps: state.forceFps,
    ltcChannel: state.ltcChannel,
    setlist: state.setlist,
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
    markers: state.markers,
    presetPath: state.presetPath,
    presetName: state.presetName,
    // Crash recovery: persist last played file so we can restore on relaunch
    filePath: state.filePath,
    fileName: state.fileName,
    activeSetlistIndex: state.activeSetlistIndex,
  }),
  merge: (persisted, current) => {
    if (!persisted || typeof persisted !== 'object') return current
    const merged = { ...current, ...(persisted as object) }
    // Validate critical fields — revert to defaults if corrupted
    if (!Array.isArray(merged.setlist)) merged.setlist = current.setlist
    if (typeof merged.lang !== 'string') merged.lang = current.lang
    if (typeof merged.offsetFrames !== 'number' || !isFinite(merged.offsetFrames)) merged.offsetFrames = current.offsetFrames
    if (typeof merged.generatorFps !== 'number' || merged.generatorFps <= 0) merged.generatorFps = current.generatorFps
    if (!Array.isArray(merged.midiCues)) merged.midiCues = current.midiCues ?? []
    if (!Array.isArray(merged.waveformMarkers)) merged.waveformMarkers = current.waveformMarkers ?? []
    // Ensure setlist items from old storage have IDs
    merged.setlist = merged.setlist.map((item: SetlistItem) =>
      item.id ? item : { ...item, id: nextSetlistId() }
    )
    return merged as AppState
  },
}))
