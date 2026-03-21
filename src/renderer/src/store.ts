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

export interface SetlistItem {
  id: string
  path: string
  name: string
}

export interface PresetData {
  lang: 'en' | 'zh'
  rightTab: 'devices' | 'setlist'
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
  artnetEnabled?: boolean
  artnetTargetIp?: string
  mtcMode?: 'quarter-frame' | 'full-frame'
  version?: number
}

export interface SavedPreset {
  name: string
  data: PresetData
  updatedAt: string
}

const ACTIVE_PRESET_KEY = 'ltcast-active-preset'

function loadActivePresetName(): string | null {
  return localStorage.getItem(ACTIVE_PRESET_KEY)
}

function saveActivePresetName(name: string | null): void {
  if (name) localStorage.setItem(ACTIVE_PRESET_KEY, name)
  else localStorage.removeItem(ACTIVE_PRESET_KEY)
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

const CURRENT_PRESET_VERSION = 1

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
  // Future: if (version < 2) { ... }
  data.version = CURRENT_PRESET_VERSION
  return data
}

/** Build a PresetData snapshot from the current store state. */
function buildPresetData(s: Pick<AppState,
  'lang' | 'rightTab' | 'offsetFrames' | 'loop' | 'loopA' | 'loopB' | 'musicOutputDeviceId' |
  'ltcOutputDeviceId' | 'ltcGain' | 'selectedMidiPort' | 'forceFps' |
  'ltcChannel' | 'setlist' | 'generatorStartTC' | 'generatorFps' |
  'artnetEnabled' | 'artnetTargetIp' | 'mtcMode'>): PresetData {
  return {
    version: CURRENT_PRESET_VERSION,
    lang: s.lang, rightTab: s.rightTab, offsetFrames: s.offsetFrames,
    loop: s.loop, loopA: s.loopA, loopB: s.loopB,
    musicOutputDeviceId: s.musicOutputDeviceId,
    ltcOutputDeviceId: s.ltcOutputDeviceId, ltcGain: s.ltcGain,
    selectedMidiPort: s.selectedMidiPort, forceFps: s.forceFps,
    ltcChannel: s.ltcChannel, setlist: s.setlist,
    generatorStartTC: s.generatorStartTC, generatorFps: s.generatorFps,
    artnetEnabled: s.artnetEnabled, artnetTargetIp: s.artnetTargetIp,
    mtcMode: s.mtcMode
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

  // BPM (tap-to-detect)
  tappedBpm: number | null
  setTappedBpm: (bpm: number | null) => void

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

  // UI
  rightTab: 'devices' | 'setlist'
  lang: 'en' | 'zh'

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
  setLang: (lang: 'en' | 'zh') => void

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

  tappedBpm: null,

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

  rightTab: 'devices',
  lang: 'en',

  presetName: loadActivePresetName(),
  presetPath: null,
  presetDirty: false,
  savedPresets: [],  // loaded async from filesystem on mount
  recentFiles: [],   // loaded from localStorage

  setFilePath: (path, name, duration) => set({ filePath: path, fileName: name, duration }),
  setPlayState: (playState) => set({ playState }),
  setCurrentTime: (() => {
    let lastUpdate = 0
    return (currentTime: number): void => {
      // Throttle Zustand updates to ~30fps to prevent 60fps re-renders
      const now = Date.now()
      if (now - lastUpdate >= 33) {
        lastUpdate = now
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
    // If setting B and A already exists, enforce A < B
    if (loopB !== null && s.loopA !== null && loopB <= s.loopA) return s
    // Clamp loopB to at least 50ms before end of file so the A-B loop
    // fires before musicSource.onended stops playback at file end
    const clamped = loopB !== null && s.duration > 0
      ? Math.min(loopB, s.duration - 0.05)
      : loopB
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
  setTappedBpm: (tappedBpm) => set({ tappedBpm }),
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
    const setlist = [...s.setlist]
    const [item] = setlist.splice(from, 1)
    setlist.splice(to, 0, item)
    // Find where the active item ended up by tracking its identity
    let activeSetlistIndex = s.activeSetlistIndex
    if (activeSetlistIndex !== null) {
      if (activeSetlistIndex === from) {
        activeSetlistIndex = to
      } else {
        // Item removed from `from`, inserted at `to`
        if (from < activeSetlistIndex) activeSetlistIndex-- // shift down after removal
        if (to <= activeSetlistIndex) activeSetlistIndex++   // shift up after insertion
      }
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
  setLang: (lang) => set({ lang, presetDirty: true }),

  newPreset: () => {
    saveActivePresetName(null)
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
      presetDirty: false
    })
  },

  savePreset: async () => {
    try {
      const s = useStore.getState()
      const data = buildPresetData(s)
      if (s.presetPath && s.presetName) {
        await window.api.savePreset(s.presetName, data, s.presetPath)
        saveActivePresetName(s.presetName)
        window.api.addRecentFile(s.presetPath, s.presetName)
        const presets = await loadPresetsFromDisk()
        set({ savedPresets: presets, presetDirty: false })
      } else {
        const chosenPath = await window.api.savePresetDialog(s.presetName ?? 'Untitled')
        if (!chosenPath) return
        const name = chosenPath.split(/[/\\]/).pop()!.replace(/\.ltcast$/i, '')
        await window.api.savePreset(name, data, chosenPath)
        saveActivePresetName(name)
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
      saveActivePresetName(name)
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
    saveActivePresetName(result.name)
    // Add to recent files
    useStore.getState().addRecentFile(result.path ?? '', result.name)
    set({
      ...presetData,
      loopA: presetData.loopA ?? null, loopB: presetData.loopB ?? null,
      previousSetlist: null,
      savedPresets: presets,
      presetName: result.name,
      presetPath: result.path ?? null,
      presetDirty: false,
      // Clear playback state
      filePath: null, fileName: null, duration: 0,
      playState: 'stopped', currentTime: 0,
      timecode: null, detectedFps: null,
      tappedBpm: null, timecodeLookup: [],
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
      saveActivePresetName(result.name)
      // Move to top of recent list and rebuild the native File > Open Recent menu
      useStore.getState().addRecentFile(path, result.name)
      set({
        ...presetData,
        loopA: presetData.loopA ?? null, loopB: presetData.loopB ?? null,
        previousSetlist: null,
        savedPresets: presets,
        presetName: result.name,
        presetPath: path,
        presetDirty: false,
        filePath: null, fileName: null, duration: 0,
        playState: 'stopped', currentTime: 0,
        timecode: null, detectedFps: null,
        tappedBpm: null, timecodeLookup: [],
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
    saveActivePresetName(name)
    warnIfNewerVersion(preset.data)
    const data = ensureSetlistIds(migratePreset(preset.data))
    return {
      ...data, presetName: name, presetPath: null, presetDirty: false,
      // Explicitly reset loop points in case old preset doesn't have them
      loopA: data.loopA ?? null, loopB: data.loopB ?? null,
      previousSetlist: null,
      // Clear playback state
      filePath: null, fileName: null, duration: 0,
      playState: 'stopped', currentTime: 0,
      timecode: null, detectedFps: null,
      tappedBpm: null, timecodeLookup: [],
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
      if (isActive) saveActivePresetName(null)
      loadPresetsFromDisk().then(presets => set({
        savedPresets: presets,
        ...(isActive ? { presetName: null, presetPath: null } : {})
      })).catch(() => {})
    }).catch(() => {})
  },

  resetToDefaults: () => {
    saveActivePresetName(null)
    set({
      lang: 'en', rightTab: 'devices', offsetFrames: 0, loop: false,
      loopA: null, loopB: null, previousSetlist: null,
      musicOutputDeviceId: 'default', ltcOutputDeviceId: 'default',
      ltcGain: 1.0, selectedMidiPort: null, forceFps: null,
      ltcChannel: 'auto', setlist: [], activeSetlistIndex: null,
      presetName: null, presetPath: null, presetDirty: false
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
        const extracted = result.audioPaths.find(p => p.endsWith(item.name) || p.endsWith(item.path.split(/[/\\]/).pop()!))
        return extracted ? { ...item, path: extracted } : item
      })
    }
    saveActivePresetName(preset.name)
    set({
      ...presetData,
      loopA: presetData.loopA ?? null, loopB: presetData.loopB ?? null,
      previousSetlist: null,
      savedPresets: presets,
      presetName: preset.name,
      presetPath: result.presetFilePath ?? null,
      presetDirty: false,
      // Clear playback state
      filePath: null, fileName: null, duration: 0,
      playState: 'stopped', currentTime: 0,
      timecode: null, detectedFps: null,
      tappedBpm: null, timecodeLookup: [],
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
    presetPath: state.presetPath,
  }),
  merge: (persisted, current) => {
    const merged = { ...current, ...(persisted as object) }
    // Ensure setlist items from old storage have IDs
    if (merged.setlist) {
      merged.setlist = merged.setlist.map((item: SetlistItem) =>
        item.id ? item : { ...item, id: nextSetlistId() }
      )
    }
    return merged as AppState
  },
}))
