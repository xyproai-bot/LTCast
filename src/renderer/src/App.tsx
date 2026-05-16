import React, { useEffect, useRef, useState, useCallback } from 'react'
import { AudioEngine } from './audio/AudioEngine'
import { ChaseEngine, ChaseCue } from './audio/ChaseEngine'
import { MtcOutput } from './audio/MtcOutput'
import { MidiInput } from './audio/MidiInput'
import { ArtNetOutput } from './audio/ArtNetOutput'
import { OscOutput } from './audio/OscOutput'
import { getScanManager } from './utils/scanManager'
import { TimecodeDisplay } from './components/TimecodeDisplay'
import { Waveform } from './components/Waveform'
import { Transport } from './components/Transport'
import { SetlistPanel } from './components/SetlistPanel'
import { TcCalcPanel } from './components/TcCalcPanel'
import { CuesTab } from './components/CuesTab'
import { ShowTab } from './components/ShowTab'
import { SettingsModal, SettingsSection, gainToDb, panToDisplay } from './components/SettingsModal'
import { FileMenu } from './components/FileMenu'
import { PresetBar } from './components/PresetBar'
import { TapBpm } from './components/TapBpm'
import { StatusBar } from './components/StatusBar'
import { LtcWavExportDialog } from './components/LtcWavExportDialog'
import { LicenseDialog } from './components/LicenseDialog'
import { useStore, TimecodeFrame, MidiCuePoint, buildPresetData } from './store'
import { useShallow } from 'zustand/react/shallow'
import { alignAudio } from './audio/AudioAligner'
import { getTimecodeAtTime, formatTimecode } from './audio/LtcDecoder'
import { tcToFrames, nudgeOffsetByBeats, findNthMarker, findAdjacentMarker } from './audio/timecodeConvert'
import { detectBpmAt } from './audio/BpmDetector'
import { t } from './i18n'
import { toast } from './components/Toast'
import { showLog } from './utils/showLog'
import { LTC_CONFIDENCE_THRESHOLD } from './constants'

/**
 * Compact CHASE on/off pill that lives in the center-top-right strip
 * (next to the SIGNAL OK badge). Mirrors the StatusBar CHASE pill's
 * state model:
 *   off       → grey outline
 *   chasing   → cyan filled
 *   freewheel → amber filled
 *   lost      → red filled
 *
 * Click toggles `chaseEnabled`. Tooltip surfaces the keyboard shortcut.
 * Subscribes via a narrow selector so this widget re-renders independently
 * of the App tree.
 */
function ChaseQuickToggle(): React.JSX.Element {
  const chaseEnabled    = useStore(s => s.chaseEnabled)
  const chaseStatus     = useStore(s => s.chaseStatus)
  const lang            = useStore(s => s.lang)
  const setChaseEnabled = useStore(s => s.setChaseEnabled)

  let stateClass = ''
  if (chaseEnabled && chaseStatus === 'chasing')      stateClass = ' chase-quick-toggle--chasing'
  else if (chaseEnabled && chaseStatus === 'freewheeling') stateClass = ' chase-quick-toggle--freewheel'
  else if (chaseEnabled && chaseStatus === 'lost')         stateClass = ' chase-quick-toggle--lost'
  else if (chaseEnabled)                                   stateClass = ' chase-quick-toggle--on'

  return (
    <button
      className={`chase-quick-toggle${stateClass}`}
      onClick={() => setChaseEnabled(!chaseEnabled)}
      title={t(lang, 'chaseToggleHint')}
      aria-label={t(lang, 'chaseMode')}
    >
      <span className="chase-quick-toggle-dot" />
      CHASE
    </button>
  )
}

export default function App(): React.JSX.Element {
  const engine    = useRef<AudioEngine | null>(null)
  const chase     = useRef<ChaseEngine | null>(null)
  const mtc       = useRef<MtcOutput | null>(null)
  const midiIn    = useRef<MidiInput | null>(null)
  const artnet    = useRef<ArtNetOutput | null>(null)
  const osc       = useRef<OscOutput | null>(null)
  const [musicWaveform, setMusicWaveform] = useState<Float32Array | null>(null)
  const [ltcWaveform, setLtcWaveform]     = useState<Float32Array | null>(null)
  const [version, setVersion]             = useState('0.1.0')
  const [dragging, setDragging]           = useState(false)
  const dragCounter = useRef(0)
  const [fullscreenTc, setFullscreenTc]   = useState(false)
  const [sidebarWidth, setSidebarWidth]       = useState(200)
  const isResizingSidebar = useRef(false)
  const [rightPanelWidth, setRightPanelWidth] = useState(250)
  const isResizingRightPanel = useRef(false)
  const [showLtcWavDialog, setShowLtcWavDialog] = useState(false)
  const [showLicenseDialog, setShowLicenseDialog] = useState(false)
  // Sprint UI-Reorg — Settings modal (per-mount, not persisted)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('outputs')
  const openSettings = useCallback((section: SettingsSection = 'outputs') => {
    setSettingsSection(section)
    setShowSettings(true)
  }, [])
  const lastBpmUpdateTime = useRef(0)
  // Auto-advance: timer ref + countdown state
  const autoAdvanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [autoAdvanceCountdown, setAutoAdvanceCountdown] = useState<{ name: string; remaining: number } | null>(null)
  const autoAdvanceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // FPS mismatch warning: track last shown mismatch to avoid spam
  const fpsMismatchKey = useRef<string | null>(null)
  // MIDI cue: track last triggered cue IDs per playback session
  const triggeredCueIds = useRef<Set<string>>(new Set())
  // MIDI input: learning state
  const [learningMappingId, setLearningMappingId] = useState<string | null>(null)
  // MIDI activity indicator
  const [midiActivity, setMidiActivity] = useState(false)
  const midiActivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [lastFiredCueId, setLastFiredCueId] = useState<string | null>(null)
  const cueFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Sprint D — F11: Auto backup timer ref
  const autoBackupTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // LTC Chase — host-side state for the virtual chase cursor. Throttled
  // via rAF in the chase engine callback below; passed to Waveform when
  // chase is active so the cursor follows external TC instead of audio
  // playback time.
  const chaseVirtualTimeRef = useRef<number | null>(null)
  const [chaseVirtualTime, setChaseVirtualTime] = useState<number | null>(null)
  // Throttle the React state write to 30Hz so chase doesn't spike re-renders
  // at the LTC frame rate (which can be 30Hz already + cue scheduling work).
  const chaseRenderRafRef = useRef<number | null>(null)

  // Pre-buffer state (F1). Tracks the currently in-flight / completed
  // prebuffer so openFile() can grab it when the user finally fires Space.
  // - token: identity for the AudioEngine slot (engine.consumePrebuffered)
  // - index: setlist index the prebuffer was started for (used by the
  //   standby subscriber's before-change cleanup)
  // - path: the setlist item's file path at start time — openFile() matches
  //   against this to decide whether to use the fast path
  // - abort: best-effort cancellation flag; decodeAudioData cannot truly
  //   be cancelled mid-flight, so this just marks the result as unwanted
  const prebufferStateRef = useRef<{
    token: symbol
    index: number
    path: string
    abort: AbortController
  } | null>(null)

  // Cancel any pending auto-advance countdown
  const cancelAutoAdvance = useCallback((): void => {
    if (autoAdvanceTimer.current) { clearTimeout(autoAdvanceTimer.current); autoAdvanceTimer.current = null }
    if (autoAdvanceIntervalRef.current) { clearInterval(autoAdvanceIntervalRef.current); autoAdvanceIntervalRef.current = null }
    setAutoAdvanceCountdown(null)
  }, [])

  // F10 — when active setlist variant changes, hard-stop the audio engine so
  // we don't leave audio + outputs running while the UI shows the new variant.
  // (store.switchSetlistVariant flips playState to 'stopped' but can't reach
  // engine.current — that ref lives only in App.)
  const activeVariantId = useStore(s => s.activeSetlistVariantId)
  const prevVariantId = useRef(activeVariantId)
  useEffect(() => {
    if (prevVariantId.current === activeVariantId) return
    prevVariantId.current = activeVariantId
    cancelAutoAdvance()
    engine.current?.pause()
    engine.current?.seek(0)
    triggeredCueIds.current = new Set()
    osc.current?.sendTransport('stop')
  }, [activeVariantId, cancelAutoAdvance])

  // NARROW SELECTOR with useShallow — prevents App from re-rendering on every
  // setCurrentTime (30Hz) and setTimecode (30Hz). Previously App subscribed to
  // the WHOLE store via useStore() with no selector, causing the entire App
  // tree to re-render 30×/sec during playback. Now it only re-renders when
  // one of THESE specific fields changes.
  const {
    filePath, fileName, presetName, presetDirty, lang, loop,
    setFilePath, setPlayState, setCurrentTime,
    setTimecode, setDetectedFps, setLtcSignalOk,
    setDetectedLtcChannel, setMidiConnected, setMidiOutputs,
    setTimecodeLookup, setVideoFile, setVideoOffsetSeconds,
    setVideoStartTimecode, setVideoLoading, clearVideo,
    offsetFrames, loopA, loopB,
    tcGeneratorMode, setTcGeneratorMode,
    generatorStartTC, generatorFps,
    forceFps,
    ltcChannel,
    ltcSignalOk, ltcConfidence, detectedLtcChannel,
    setLtcConfidence, setDetectedBpm,
    artnetEnabled, artnetTargetIp,
    oscEnabled, oscTargetIp, oscTargetPort,
    setSelectedMidiPort,
    rightTab, setMidiInputs, showLocked,
    setSelectedCueMidiPort,
    setMidiInputPort,
    updateMidiMapping,
    trialDaysLeft, isPro, savePreset,
    audioLoading, loadingFileName, setAudioLoading,
    themeColor, uiSize,
    musicVolume, musicPan, setMusicVolume, setMusicPan,
    muteLtcFromMusic,
    shareProjectZip, importLtcastProject
  } = useStore(useShallow((s) => ({
    filePath: s.filePath, fileName: s.fileName, presetName: s.presetName,
    presetDirty: s.presetDirty, lang: s.lang, loop: s.loop,
    setFilePath: s.setFilePath, setPlayState: s.setPlayState, setCurrentTime: s.setCurrentTime,
    setTimecode: s.setTimecode, setDetectedFps: s.setDetectedFps, setLtcSignalOk: s.setLtcSignalOk,
    setDetectedLtcChannel: s.setDetectedLtcChannel, setMidiConnected: s.setMidiConnected, setMidiOutputs: s.setMidiOutputs,
    setTimecodeLookup: s.setTimecodeLookup, setVideoFile: s.setVideoFile, setVideoOffsetSeconds: s.setVideoOffsetSeconds,
    setVideoStartTimecode: s.setVideoStartTimecode, setVideoLoading: s.setVideoLoading, clearVideo: s.clearVideo,
    offsetFrames: s.offsetFrames, loopA: s.loopA, loopB: s.loopB,
    tcGeneratorMode: s.tcGeneratorMode, setTcGeneratorMode: s.setTcGeneratorMode,
    generatorStartTC: s.generatorStartTC, generatorFps: s.generatorFps,
    forceFps: s.forceFps,
    ltcChannel: s.ltcChannel,
    ltcSignalOk: s.ltcSignalOk, ltcConfidence: s.ltcConfidence, detectedLtcChannel: s.detectedLtcChannel,
    setLtcConfidence: s.setLtcConfidence, setDetectedBpm: s.setDetectedBpm,
    artnetEnabled: s.artnetEnabled, artnetTargetIp: s.artnetTargetIp,
    oscEnabled: s.oscEnabled, oscTargetIp: s.oscTargetIp, oscTargetPort: s.oscTargetPort,
    setSelectedMidiPort: s.setSelectedMidiPort,
    rightTab: s.rightTab, setMidiInputs: s.setMidiInputs, showLocked: s.showLocked, setShowLocked: s.setShowLocked,
    selectedCueMidiPort: s.selectedCueMidiPort, setSelectedCueMidiPort: s.setSelectedCueMidiPort,
    midiInputPort: s.midiInputPort, setMidiInputPort: s.setMidiInputPort,
    midiMappings: s.midiMappings, updateMidiMapping: s.updateMidiMapping,
    trialDaysLeft: s.trialDaysLeft, isPro: s.isPro, savePreset: s.savePreset,
    audioLoading: s.audioLoading, loadingFileName: s.loadingFileName, setAudioLoading: s.setAudioLoading,
    themeColor: s.themeColor, uiSize: s.uiSize,
    musicVolume: s.musicVolume, musicPan: s.musicPan,
    setMusicVolume: s.setMusicVolume, setMusicPan: s.setMusicPan,
    muteLtcFromMusic: s.muteLtcFromMusic,
    shareProjectZip: s.shareProjectZip, importLtcastProject: s.importLtcastProject
  })))

  // Sync window title bar with preset name
  useEffect(() => {
    document.title = presetName ? `LTCast - ${presetName}` : 'LTCast'
  }, [presetName])

  // Sync ultra-dark body class with store state
  useEffect(() => {
    const unsub = useStore.subscribe(
      (s, prev) => { if (s.ultraDark !== prev.ultraDark) document.body.classList.toggle('ultra-dark', s.ultraDark) }
    )
    // Apply on mount
    document.body.classList.toggle('ultra-dark', useStore.getState().ultraDark)
    return unsub
  }, [])

  // Handle .ltcast file opened via double-click / OS association
  useEffect(() => {
    const cleanup = window.api.onOpenLTCastFile((filePath: string) => {
      useStore.getState().openRecentFile(filePath)
    })
    return cleanup
  }, [])

  // Art-Net socket failure — main process UDP socket died, disable Art-Net in UI
  useEffect(() => {
    const cleanup = window.api.onArtnetSocketFailed(() => {
      useStore.getState().setArtnetEnabled(false)
      toast.error(t(useStore.getState().lang, 'artnetSocketError'))
    })
    return cleanup
  }, [])

  // Validate license + check trial on startup
  useEffect(() => {
    const s = useStore.getState()
    // License check — only on startup, NEVER during playback (live show safety)
    if (s.licenseKey) {
      // Sequential: LemonSqueezy first, then Worker check (Worker has final say).
      // This prevents race condition where LS 'valid' overwrites Worker 'refunded'.
      window.api.licenseValidate(s.licenseKey).then((result: { valid: boolean; error?: string }) => {
        if (result.valid) {
          s.setLicenseStatus('valid')
          s.setLicenseValidatedAt(Date.now())
        } else {
          // Server explicitly returned invalid — set status based on error type
          const err = (result.error ?? '').toLowerCase()
          if (err.includes('disabled') || err.includes('invalid')) {
            s.setLicenseStatus('invalid')
          } else {
            s.setLicenseStatus('expired')
          }
        }
      }).catch(() => {
        // Network failure — use 30-day offline grace period
        if (s.licenseValidatedAt) {
          const daysSince = (Date.now() - s.licenseValidatedAt) / (1000 * 60 * 60 * 24)
          if (daysSince > 30) s.setLicenseStatus('expired')
        }
      }).finally(() => {
        // Worker check runs AFTER LS — catches refunds/cancellations.
        // Worker result overrides LS because webhooks are authoritative.
        const key = useStore.getState().licenseKey
        if (!key) return
        window.api.licenseStatus(key).then((result: { status: string }) => {
          if (result.status === 'refunded' || result.status === 'revoked') {
            const cur = useStore.getState()
            cur.setLicenseStatus('expired')
            cur.setLicenseKey(null)
            cur.setLicenseValidatedAt(null)
          }
        }).catch(() => {})
      })
    }
    // Trial check (always, even if licensed — to show days left in UI)
    window.api.trialCheck().then((result) => {
      useStore.getState().setTrialDaysLeft(result.daysLeft)
    }).catch(() => {})

    // Periodic silent license re-check every 4 hours (only when NOT playing)
    const licenseCheckInterval = setInterval(() => {
      const cur = useStore.getState()
      if (!cur.licenseKey || cur.playState === 'playing') return
      window.api.licenseValidate(cur.licenseKey).then((result: { valid: boolean; error?: string }) => {
        if (result.valid) {
          // Refresh the 30-day offline timer (important for always-on installations)
          cur.setLicenseStatus('valid')
          cur.setLicenseValidatedAt(Date.now())
        } else {
          const err = (result.error ?? '').toLowerCase()
          cur.setLicenseStatus(err.includes('disabled') || err.includes('invalid') ? 'invalid' : 'expired')
        }
      }).catch(() => {})
    }, 4 * 60 * 60 * 1000)
    return () => clearInterval(licenseCheckInterval)
  }, [])

  // Init engine + MIDI once
  useEffect(() => {
    // Guard against React StrictMode double-mount in dev — don't recreate
    // the engine if it already exists (prevents orphaned AudioContext leaks)
    if (engine.current) return
    engine.current = new AudioEngine({
      onTimecode: handleTimecode,
      onTimeUpdate: (t) => {
        setCurrentTime(t)
        // Real-time BPM detection every 3 seconds
        const now = performance.now()
        if (now - lastBpmUpdateTime.current > 3000) {
          lastBpmUpdateTime.current = now
          const buf = engine.current?.getBuffer()
          if (buf) {
            const musicCh = engine.current?.getMusicChannelIndex() ?? 0
            const bpm = detectBpmAt(buf, musicCh, t)
            useStore.getState().setDetectedBpm(bpm)
            // Live-update MIDI Clock BPM if source is 'detected'
            if (bpm && mtc.current?.isClockRunning() && useStore.getState().midiClockSource === 'detected') {
              mtc.current.updateClockBpm(bpm)
            }
          }
        }
      },
      onEnded: () => {
        setPlayState('stopped')
        // Auto-advance: check if we should load next song
        const s = useStore.getState()
        if (!s.autoAdvance) return
        if (s.activeSetlistIndex === null) return
        const nextIdx = s.activeSetlistIndex + 1
        if (nextIdx >= s.setlist.length) return  // last song — stop
        const nextItem = s.setlist[nextIdx]
        const gapMs = (s.autoAdvanceGap ?? 2) * 1000

        // Start countdown display
        let remaining = Math.ceil(s.autoAdvanceGap ?? 2)
        setAutoAdvanceCountdown({ name: nextItem.name, remaining })
        autoAdvanceIntervalRef.current = setInterval(() => {
          remaining -= 1
          if (remaining <= 0) {
            if (autoAdvanceIntervalRef.current) { clearInterval(autoAdvanceIntervalRef.current); autoAdvanceIntervalRef.current = null }
            setAutoAdvanceCountdown(null)
          } else {
            setAutoAdvanceCountdown({ name: nextItem.name, remaining })
          }
        }, 1000)

        autoAdvanceTimer.current = setTimeout(() => {
          autoAdvanceTimer.current = null
          // Re-check state in case user cancelled
          const latest = useStore.getState()
          if (latest.autoAdvance && latest.activeSetlistIndex !== null) {
            const ni = latest.activeSetlistIndex + 1
            if (ni < latest.setlist.length) {
              const item = latest.setlist[ni]
              latest.setActiveSetlistIndex(ni)
              openFile(item.path, item.offsetFrames).then(() => {
                // Auto-play after loading
                const afterLoad = useStore.getState()
                if (afterLoad.duration > 0) {
                  setPlayState('playing')
                  engine.current?.play().then(() => {
                    const tc = useStore.getState().timecode
                    if (tc) mtc.current?.sendFullFrame(tc)
                  }).catch(() => setPlayState('paused'))
                }
              })
            }
          }
        }, gapMs)
      },
      onLtcChannelDetected: (ch) => setDetectedLtcChannel(ch >= 0 ? ch : null),
      onLtcSignalStatus: (ok) => setLtcSignalOk(ok),
      onLtcConfidence: (confidence) => {
        setLtcConfidence(confidence)
        // Auto-enable generator mode when no LTC detected
        if (confidence < LTC_CONFIDENCE_THRESHOLD) {
          setTcGeneratorMode(true)
          const s = useStore.getState()
          engine.current?.setGeneratorMode(true)
          engine.current?.setGeneratorStartTC(s.generatorStartTC, s.generatorFps)
        } else {
          setTcGeneratorMode(false)
          engine.current?.setGeneratorMode(false)
        }
      },
      onLtcStartTime: (seconds) => {
        useStore.getState().setLtcStartTime(seconds)
      },
      onWaveformData: (music, ltc) => {
        setMusicWaveform(music)
        setLtcWaveform(ltc)
      },
      onTimecodeLookup: (lookup) => {
        setTimecodeLookup(lookup)
      },
      onDeviceDisconnected: () => {
        setPlayState('paused')
        toast.warning(t(useStore.getState().lang, 'audioDeviceDisconnected'))
      },
      onDeviceReconnected: () => {
        toast.success(t(useStore.getState().lang, 'audioDeviceReconnected'))
      },
      onPlayStarted: (perfNow, audioTime) => {
        mtc.current?.setPlayStartClocks(perfNow, audioTime)
      },
      onLtcError: (type) => {
        const l = useStore.getState().lang
        if (type === 'worklet') toast.error(t(l, 'ltcWorkletError'))
        else if (type === 'warmup') toast.warning(t(l, 'ltcWarmupError'))
        else if (type === 'encoder') toast.warning(t(l, 'ltcEncoderError'))
      },
      onLtcInputTimecode: (tc) => {
        // Route every decoded LTC frame from the external input pipeline
        // into the ChaseEngine. We do NOT gate on chaseEnabled here —
        // ChaseEngine itself early-outs when disabled, and we want the
        // engine to see frames the moment chase is toggled on (instead
        // of losing the first frames during the next decode cycle).
        if (chase.current) {
          chase.current.onIncomingTc({
            hours: tc.hours, minutes: tc.minutes, seconds: tc.seconds, frames: tc.frames,
            fps: tc.fps, dropFrame: tc.dropFrame,
          })
        }
      },
      onLtcInputError: (type) => {
        const l = useStore.getState().lang
        if (type === 'permission-denied') {
          toast.error(t(l, 'ltcInputPermissionDenied'))
        } else if (type === 'device-missing') {
          toast.warning(t(l, 'ltcInputDeviceDisconnected'))
        } else if (type === 'disconnected') {
          toast.warning(t(l, 'ltcInputDeviceDisconnected'))
          // Clear the saved device so the dropdown doesn't keep showing a
          // device that's no longer there. Operator picks a new one on the
          // next configure step.
          useStore.getState().setLtcInputDevice(null)
        }
      }
    })

    // Init Web MIDI
    const mtcOut = new MtcOutput()
    mtcOut.onPortsChanged = () => {
      setMidiOutputs(mtcOut.getPorts())
      setMidiConnected(mtcOut.isConnected())
      // Auto-reconnect: if a saved port reappears after disconnect, re-select it
      const savedPort = useStore.getState().selectedMidiPort
      if (savedPort && !mtcOut.isConnected()) {
        const ok = mtcOut.selectPort(savedPort)
        setMidiConnected(ok)
      }
    }
    mtcOut.onPortDisconnected = (portName: string) => {
      // Keep selectedMidiPort so auto-reconnect works when the port reappears
      setMidiConnected(false)
      const lang = useStore.getState().lang
      toast.warning(t(lang, 'midiPortDisconnected', { name: portName }))
    }
    mtcOut.init()
      .then(() => {
        setMidiOutputs(mtcOut.getPorts())
        // Restore saved MIDI port
        const savedPort = useStore.getState().selectedMidiPort
        if (savedPort) {
          const ok = mtcOut.selectPort(savedPort)
          setMidiConnected(ok)
        }
        // Restore saved MTC mode
        mtcOut.setMode(useStore.getState().mtcMode)
        // Restore saved cue MIDI port
        const savedCuePort = useStore.getState().selectedCueMidiPort
        if (savedCuePort) mtcOut.selectCuePort(savedCuePort)

        // Init MIDI Input using same midiAccess
        const midiInst = new MidiInput()
        midiInst.onPortsChanged = () => {
          setMidiInputs(midiInst.getInputPorts())
        }
        midiInst.onActionReceived = (event) => {
          const s = useStore.getState()
          switch (event.action) {
            case 'play':
              if (s.playState !== 'playing' && s.duration > 0) {
                s.setPlayState('playing')
                engine.current?.play().then(() => {
                  const tc = useStore.getState().timecode
                  if (tc) mtcOut.sendFullFrame(tc)
                }).catch(() => s.setPlayState('paused'))
              }
              break
            case 'pause':
              if (s.playState === 'playing') {
                engine.current?.pause()
                s.setPlayState('paused')
              }
              break
            case 'stop':
              engine.current?.pause()
              engine.current?.seek(0)
              s.setPlayState('stopped')
              s.setTimecode(null)
              triggeredCueIds.current = new Set()
              break
            case 'play-pause':
              if (s.playState === 'playing') {
                engine.current?.pause()
                s.setPlayState('paused')
              } else if (s.duration > 0) {
                s.setPlayState('playing')
                engine.current?.play().then(() => {
                  const tc = useStore.getState().timecode
                  if (tc) mtcOut.sendFullFrame(tc)
                }).catch(() => s.setPlayState('paused'))
              }
              break
            case 'next': {
              const ni = s.activeSetlistIndex !== null ? s.activeSetlistIndex + 1 : 0
              if (ni < s.setlist.length) {
                s.setActiveSetlistIndex(ni)
                const item = s.setlist[ni]
                openFile(item.path, item.offsetFrames)
              }
              break
            }
            case 'prev': {
              const pi = s.activeSetlistIndex !== null && s.activeSetlistIndex > 0
                ? s.activeSetlistIndex - 1 : null
              if (pi !== null) {
                s.setActiveSetlistIndex(pi)
                const item = s.setlist[pi]
                openFile(item.path, item.offsetFrames)
              }
              break
            }
            case 'goto-song': {
              const idx = event.param ?? 0
              if (idx >= 0 && idx < s.setlist.length) {
                s.setActiveSetlistIndex(idx)
                const item = s.setlist[idx]
                openFile(item.path, item.offsetFrames)
              }
              break
            }
          }
        }
        midiInst.onMidiActivity = () => {
          setMidiActivity(true)
          if (midiActivityTimer.current) clearTimeout(midiActivityTimer.current)
          midiActivityTimer.current = setTimeout(() => setMidiActivity(false), 200)
        }

        // Use the same midiAccess from MtcOutput to avoid requesting a second permission
        const sharedAccess = (mtcOut as unknown as { midiAccess: MIDIAccess | null }).midiAccess
        if (sharedAccess) {
          midiInst.init(sharedAccess).then(() => {
            setMidiInputs(midiInst.getInputPorts())
            // Restore saved MIDI input port
            const savedInputPort = useStore.getState().midiInputPort
            if (savedInputPort) {
              const ok = midiInst.selectPort(savedInputPort)
              if (ok) midiInst.setupMappingListener(() => useStore.getState().midiMappings)
            }
          }).catch((e) => console.warn('MIDI Input init failed:', e))
        }
        midiIn.current = midiInst
      })
      .catch((e) => console.warn('MIDI init failed:', e))
    mtc.current = mtcOut

    // Init Art-Net Timecode
    artnet.current = new ArtNetOutput()
    const savedState = useStore.getState()
    if (savedState.artnetEnabled) {
      artnet.current.start(savedState.artnetTargetIp).catch(() => {})
    }

    // Init OSC Output
    osc.current = new OscOutput()
    if (savedState.oscEnabled) {
      osc.current.start(savedState.oscTargetIp, savedState.oscTargetPort).catch(() => {})
    }

    // Restore saved engine settings
    engine.current.setOffset(savedState.offsetFrames)
    engine.current.setLtcGain(savedState.ltcGain)
    engine.current.setMusicVolume(savedState.musicVolume ?? 1.0)
    engine.current.setMusicPan(savedState.musicPan ?? 0.0)
    engine.current.setMuteLtcFromMusic(savedState.muteLtcFromMusic ?? false)
    engine.current.setOperatorLtcChannelChoice(savedState.ltcChannel)

    // Warm up VB-CABLE / BlackHole device on startup
    // This forces the OS to establish the device connection early,
    // preventing the "locked handle" issue on Windows
    if (savedState.ltcOutputDeviceId && savedState.ltcOutputDeviceId !== 'default') {
      engine.current.setLtcOutputDevice(savedState.ltcOutputDeviceId).catch(() => {})
    }

    // Restore previously-selected LTC input device. We delay slightly so
    // the browser-side device list has time to populate (some drivers are
    // slow to enumerate on cold boot). The engine's own error handling
    // surfaces a toast if the device has vanished since last quit.
    if (savedState.ltcInputDeviceId) {
      engine.current.setLtcInputDevice(savedState.ltcInputDeviceId, savedState.ltcInputChannel).catch(() => {})
    }

    // ── LTC Chase — instantiate engine + start background scanner ──
    chase.current = new ChaseEngine()
    chase.current.setFreewheelEnabled(savedState.chaseFreewheelEnabled)
    // Boot up the scan manager so any items already in the setlist get
    // scanned in the background. We don't store the stop fn — the manager
    // is a singleton and disposed in the cleanup block below.
    getScanManager().start()

    window.api.getAppVersion().then(setVersion).catch(() => {})

    // Load presets from filesystem on startup
    useStore.getState().refreshPresets()

    // Force-release device handles on window close (sync cleanup)
    const handleBeforeUnload = (): void => {
      engine.current?.forceCleanup()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    // Auto-save every 5 minutes (only if dirty and has a known path)
    const autoSaveInterval = setInterval(() => {
      const s = useStore.getState()
      if (s.presetDirty && s.presetPath && s.presetName) {
        s.savePreset().then(() => {
          if (!useStore.getState().presetDirty) toast.info(t(s.lang, 'autoSaved'))
          else toast.error(t(s.lang, 'autoSaveFailed'))
        }).catch(() => toast.error(t(s.lang, 'autoSaveFailed')))
      }
    }, 5 * 60 * 1000)

    return () => {
      clearInterval(autoSaveInterval)
      if (midiActivityTimer.current) { clearTimeout(midiActivityTimer.current); midiActivityTimer.current = null }
      if (cueFlashTimer.current) { clearTimeout(cueFlashTimer.current); cueFlashTimer.current = null }
      if (autoAdvanceTimer.current) { clearTimeout(autoAdvanceTimer.current); autoAdvanceTimer.current = null }
      if (autoAdvanceIntervalRef.current) { clearInterval(autoAdvanceIntervalRef.current); autoAdvanceIntervalRef.current = null }
      window.removeEventListener('beforeunload', handleBeforeUnload)
      engine.current?.forceCleanup()
      engine.current?.dispose()
      chase.current?.stop()
      getScanManager().stop()
      mtc.current?.deselectPort()
      mtc.current?.deselectCuePort()
      midiIn.current?.deselectPort()
      artnet.current?.stop()
      osc.current?.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // When file is cleared (e.g. New), also clear local waveform state and stop engine
  useEffect(() => {
    if (!filePath) {
      engine.current?.pause()
      engine.current?.seek(0)
      setMusicWaveform(null)
      setLtcWaveform(null)
    }
  }, [filePath])

  // UI size: apply via Electron's setZoomFactor so the layout reflows properly
  // (CSS `zoom` would overflow on scale-up / leave gaps on scale-down).
  useEffect(() => {
    const factor = uiSize === 'sm' ? 0.9 : uiSize === 'lg' ? 1.15 : 1.0
    window.api.windowSetZoom?.(factor)
  }, [uiSize])


  // Sprint D — F11: Auto-backup interval timer
  // Runs every autoBackupIntervalMin minutes and writes a snapshot if there
  // is an active named preset. Also registers window.__ltcast_quitBackup so
  // the main-process before-quit handler can call it synchronously.
  useEffect(() => {
    // Register the quit-time backup hook for main process
    ;(window as unknown as Record<string, unknown>)['__ltcast_quitBackup'] = async () => {
      const s = useStore.getState()
      if (!s.presetName) return
      const data = buildPresetData(s)
      try {
        await window.api.backupSnapshot(s.presetName, data)
        await window.api.pruneBackups(s.presetName, s.autoBackupKeepCount)
      } catch (e) {
        console.error('[AutoBackup] quit-time backup failed', e)
      }
    }

    // Rebuild interval whenever settings change
    if (autoBackupTimerRef.current) {
      clearInterval(autoBackupTimerRef.current)
      autoBackupTimerRef.current = null
    }

    const s0 = useStore.getState()
    if (!s0.autoBackupEnabled) return

    const intervalMs = s0.autoBackupIntervalMin * 60 * 1000
    autoBackupTimerRef.current = setInterval(async () => {
      const cur = useStore.getState()
      if (!cur.autoBackupEnabled || !cur.presetName) return
      try {
        await window.api.backupSnapshot(cur.presetName, buildPresetData(cur))
        await window.api.pruneBackups(cur.presetName, cur.autoBackupKeepCount)
      } catch (e) {
        console.error('[AutoBackup] snapshot failed', e)
      }
    }, intervalMs)

    return () => {
      if (autoBackupTimerRef.current) {
        clearInterval(autoBackupTimerRef.current)
        autoBackupTimerRef.current = null
      }
    }
  // Re-run when auto-backup settings change (reads from store on each tick)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── LTC Chase ────────────────────────────────────────────────
  //
  // Wire the ChaseEngine to:
  //   - Store-driven config (chaseEnabled, chaseFreewheelEnabled)
  //   - The setlist (rebuild segment index whenever items change)
  //   - The active song's MIDI cues (so cue firing works while chasing)
  //   - The store's chaseStatus / chaseLastTcFrames runtime fields
  //   - Setlist actions (auto-switch song when chase decides we're elsewhere)
  //   - Waveform cursor (via chaseVirtualTime state)
  //
  // These useEffects deliberately read from store via subscribe so we don't
  // re-trigger on every 30Hz timecode update — only on the specific fields
  // we care about.
  useEffect(() => {
    const ch = chase.current
    if (!ch) return
    const unsub = useStore.subscribe((s, prev) => {
      if (s.chaseEnabled !== prev.chaseEnabled) {
        if (s.chaseEnabled) {
          // Build initial segment index from scanned items
          const songs: Array<{ setlistIdx: number; segments: import('./store').LtcSegment[] }> = []
          for (let i = 0; i < s.setlist.length; i++) {
            const item = s.setlist[i]
            if (item.ltcSegments && item.ltcSegments.length > 0) {
              songs.push({ setlistIdx: i, segments: item.ltcSegments })
            }
          }
          ch.updateSegmentIndex(songs)
          // Seed cues from the currently-active song
          const cueSrc: ChaseCue[] = s.activeSetlistIndex !== null
            ? (s.setlist[s.activeSetlistIndex]?.midiCues ?? []).map(c => ({
              id: c.id, enabled: c.enabled, triggerTimecode: c.triggerTimecode, offsetFrames: c.offsetFrames,
            }))
            : []
          ch.setActiveSongCues(cueSrc)
          ch.start({
            onSongChange: (idx, audioOffsetSec) => {
              // Switch active song via the standard openFile pathway. We do
              // NOT setStandbySetlistIndex — chase auto-loads, not standby.
              const state = useStore.getState()
              if (idx < 0 || idx >= state.setlist.length) return
              const item = state.setlist[idx]
              state.setActiveSetlistIndex(idx)
              // Seed the cue list for the new song immediately; the load
              // pathway also updates it but chase needs it synchronously
              // for the very next incoming frame.
              ch.setActiveSongCues((item.midiCues ?? []).map(c => ({
                id: c.id, enabled: c.enabled, triggerTimecode: c.triggerTimecode, offsetFrames: c.offsetFrames,
              })))
              openFile(item.path, item.offsetFrames).then(() => {
                // If audio output is desired during chase, kick off playback
                // from the offset returned by the engine. Otherwise just
                // seek so the cursor lands correctly.
                const cur = useStore.getState()
                if (cur.duration <= 0) return
                if (cur.chaseOutputAudio) {
                  // Start audio at the matched audio-file offset
                  setPlayState('playing')
                  engine.current?.seek(audioOffsetSec).then(() => engine.current?.play())
                    .catch(() => setPlayState('paused'))
                } else {
                  engine.current?.seek(audioOffsetSec)
                }
              })
            },
            onStatusChange: (status) => {
              useStore.getState().setChaseStatus(status)
            },
            onTcUpdate: (chaseSec) => {
              // chaseSec is the audio-file position the programmer is at.
              // Drive both the waveform cursor and the store's runtime field
              // (cursor render is throttled via rAF; store write is once
              // per ~30 ms so React state doesn't churn at LTC rate).
              chaseVirtualTimeRef.current = isNaN(chaseSec) ? null : chaseSec
              if (chaseRenderRafRef.current === null) {
                chaseRenderRafRef.current = requestAnimationFrame(() => {
                  chaseRenderRafRef.current = null
                  setChaseVirtualTime(chaseVirtualTimeRef.current)
                })
              }
            },
            onFireCue: (cueId) => {
              const state = useStore.getState()
              const idx = state.activeSetlistIndex
              if (idx === null) return
              const cue = (state.setlist[idx]?.midiCues ?? []).find(c => c.id === cueId)
              if (!cue) return
              showLog.log('cue', `[chase] ${cue.messageType} ch${cue.channel} #${cue.data1}${cue.label ? ` "${cue.label}"` : ''} @ ${cue.triggerTimecode}`)
              setLastFiredCueId(cue.id)
              if (cueFlashTimer.current) clearTimeout(cueFlashTimer.current)
              cueFlashTimer.current = setTimeout(() => setLastFiredCueId(null), 500)
              if (cue.messageType === 'program-change') {
                mtc.current?.sendProgramChange(cue.channel, cue.data1)
              } else if (cue.messageType === 'note-on') {
                mtc.current?.sendNoteOn(cue.channel, cue.data1, cue.data2 ?? 100)
              } else if (cue.messageType === 'control-change') {
                mtc.current?.sendControlChange(cue.channel, cue.data1, cue.data2 ?? 0)
              }
            },
          })
          useStore.getState().setChaseStatus(ch.getStatus())
        } else {
          ch.stop()
          useStore.getState().setChaseStatus('idle')
          useStore.getState().setChaseLastTcFrames(null)
          setChaseVirtualTime(null)
          chaseVirtualTimeRef.current = null
        }
      }
      // Freewheel toggle applies immediately
      if (s.chaseFreewheelEnabled !== prev.chaseFreewheelEnabled) {
        ch.setFreewheelEnabled(s.chaseFreewheelEnabled)
      }
      // Rebuild segment index whenever the setlist mutates while enabled
      if (s.chaseEnabled && s.setlist !== prev.setlist) {
        const songs: Array<{ setlistIdx: number; segments: import('./store').LtcSegment[] }> = []
        for (let i = 0; i < s.setlist.length; i++) {
          const item = s.setlist[i]
          if (item.ltcSegments && item.ltcSegments.length > 0) {
            songs.push({ setlistIdx: i, segments: item.ltcSegments })
          }
        }
        ch.updateSegmentIndex(songs)
      }
      // When the active song changes (chase or otherwise), refresh the
      // engine's cue list so chase fires cues for the right song.
      if (s.chaseEnabled && s.activeSetlistIndex !== prev.activeSetlistIndex) {
        const idx = s.activeSetlistIndex
        if (idx !== null && idx >= 0 && idx < s.setlist.length) {
          const item = s.setlist[idx]
          ch.setActiveSongCues((item.midiCues ?? []).map(c => ({
            id: c.id, enabled: c.enabled, triggerTimecode: c.triggerTimecode, offsetFrames: c.offsetFrames,
          })))
        }
      }
    })
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync LTC input device selection to the engine. We subscribe directly
  // instead of putting `ltcInputDeviceId` in the destructured component
  // state because the store update path is the only place that needs to
  // re-trigger the audio pipeline; doing this via React state would re-
  // render the whole App on every device change.
  useEffect(() => {
    const unsub = useStore.subscribe((s, prev) => {
      if (s.ltcInputDeviceId !== prev.ltcInputDeviceId || s.ltcInputChannel !== prev.ltcInputChannel) {
        engine.current?.setLtcInputDevice(s.ltcInputDeviceId, s.ltcInputChannel).catch(() => { /* engine surfaces errors */ })
      }
    })
    return unsub
  }, [])

  // Re-apply offset when it changes
  useEffect(() => {
    engine.current?.setOffset(offsetFrames)
  }, [offsetFrames])

  // Sync loop toggle to engine
  useEffect(() => {
    engine.current?.setLoop(loop)
  }, [loop])

  // Sync music volume and pan to engine
  useEffect(() => {
    engine.current?.setMusicVolume(musicVolume)
  }, [musicVolume])

  useEffect(() => {
    engine.current?.setMusicPan(musicPan)
  }, [musicPan])

  // Sync A-B loop points to engine
  useEffect(() => {
    engine.current?.setLoopPoints(loopA, loopB)
  }, [loopA, loopB])

  // Sync TC Generator settings to engine
  useEffect(() => {
    engine.current?.setGeneratorMode(tcGeneratorMode)
  }, [tcGeneratorMode])

  useEffect(() => {
    engine.current?.setGeneratorStartTC(generatorStartTC, generatorFps)
  }, [generatorStartTC, generatorFps])

  // Sync force FPS override to engine
  useEffect(() => {
    engine.current?.setForceFps(forceFps)
  }, [forceFps])

  // FPS mismatch warning: toast when forced FPS differs from detected.
  // Subscribe to detectedFps changes via Zustand (not in dep array — changes every frame).
  useEffect(() => {
    const checkFpsMismatch = (): void => {
      const s = useStore.getState()
      const detected = s.detectedFps
      const forced = s.forceFps
      if (forced === null || detected === null) {
        fpsMismatchKey.current = null
        return
      }
      if (forced === detected) {
        fpsMismatchKey.current = null
        return
      }
      const key = `${detected}-${forced}`
      if (fpsMismatchKey.current === key) return
      fpsMismatchKey.current = key
      toast.warning(t(s.lang, 'fpsMismatch', {
        detected: detected % 1 !== 0 ? detected.toFixed(2) : String(detected),
        forced: forced % 1 !== 0 ? forced.toFixed(2) : String(forced)
      }))
    }
    checkFpsMismatch()
    // Also re-check when detectedFps changes (e.g. loading new file with different FPS)
    const unsub = useStore.subscribe(
      (s, prev) => { if (s.detectedFps !== prev.detectedFps) checkFpsMismatch() }
    )
    return unsub
  }, [forceFps])

  // LTC signal-lost: no longer uses toast (caused layout jitter).
  // Signal status is shown in StatusBar instead.

  // Sync manual LTC channel override to engine
  // When switching back to 'auto', restore the auto-detected channel index
  useEffect(() => {
    // Track the operator choice so mute-LTC-from-music routing can resolve
    // the correct channel even when 'auto' + no LTC was detected.
    engine.current?.setOperatorLtcChannelChoice(ltcChannel)
    if (ltcChannel !== 'auto') {
      engine.current?.setLtcChannel(ltcChannel)
    } else {
      // Restore auto-detected channel so the engine isn't stuck on the last manual selection
      const detected = useStore.getState().detectedLtcChannel
      if (detected !== null) engine.current?.setLtcChannel(detected)
    }
  }, [ltcChannel])

  // Sync mute-LTC-from-music flag to engine. Engine rebuilds the music
  // routing live while playing so the change is audible immediately.
  useEffect(() => {
    engine.current?.setMuteLtcFromMusic(muteLtcFromMusic)
  }, [muteLtcFromMusic])

  // Sync Art-Net settings
  useEffect(() => {
    if (artnetEnabled) {
      artnet.current?.start(artnetTargetIp).catch(() => {})
    } else {
      artnet.current?.stop()
    }
  }, [artnetEnabled])

  useEffect(() => {
    artnet.current?.setTargetIp(artnetTargetIp)
  }, [artnetTargetIp])

  // Sync OSC settings
  useEffect(() => {
    if (oscEnabled) {
      osc.current?.start(oscTargetIp, oscTargetPort).catch(() => {})
    } else {
      osc.current?.stop()
    }
  }, [oscEnabled])

  useEffect(() => {
    osc.current?.setTargetIp(oscTargetIp)
  }, [oscTargetIp])

  useEffect(() => {
    osc.current?.setTargetPort(oscTargetPort)
  }, [oscTargetPort])

  // Sync MIDI Clock: react to settings or playState changes.
  // Handles play/pause/stop from any source (transport, remote, MIDI input, setlist).
  useEffect(() => {
    const unsub = useStore.subscribe((s, prev) => {
      if (!mtc.current?.isConnected()) return
      const relevant =
        s.midiClockEnabled !== prev.midiClockEnabled ||
        s.midiClockSource !== prev.midiClockSource ||
        s.midiClockManualBpm !== prev.midiClockManualBpm ||
        s.tappedBpm !== prev.tappedBpm ||
        s.detectedBpm !== prev.detectedBpm ||  // missed: auto-detected BPM first appearing
        s.midiConnected !== prev.midiConnected ||  // missed: port selected mid-playback
        s.playState !== prev.playState

      if (!relevant) return

      if (s.playState === 'playing' && s.midiClockEnabled) {
        const bpm =
          s.midiClockSource === 'manual' ? s.midiClockManualBpm :
          s.midiClockSource === 'tapped' ? (s.tappedBpm ?? 0) :
          (s.detectedBpm ?? 0)
        if (bpm > 0) {
          if (mtc.current!.isClockRunning()) {
            mtc.current!.updateClockBpm(bpm)
          } else {
            mtc.current!.startClock(bpm)
          }
        } else if (mtc.current!.isClockRunning()) {
          mtc.current!.stopClock()
        }
      } else if (mtc.current?.isClockRunning()) {
        mtc.current.stopClock()
      }
    })
    return unsub
  }, [])

  // Pre-buffer next song (F1). When the operator cues a song to standby,
  // decode it on a scratch AudioContext ahead of time so Space/GO becomes
  // effectively instant (no multi-second read+decode on large WAVs).
  //
  // Policy:
  //   - standby cleared → cancel any in-flight prebuffer, clear state
  //   - standby changed → cancel previous, start new
  //   - new standby == active index AND path matches currently-loaded file:
  //     skip (Q3 decision — song is already the one playing/loaded)
  //   - decode rejection → silent failure, state cleared (Q2 decision)
  //   - no debounce (Q1 decision — wasted decode on a racy click is cheap)
  useEffect(() => {
    const unsub = useStore.subscribe((s, prev) => {
      if (s.standbySetlistIndex === prev.standbySetlistIndex) return

      const nextIdx = s.standbySetlistIndex
      const engineRef = engine.current

      // Cancel any previous in-flight prebuffer first — unconditional.
      const old = prebufferStateRef.current
      if (old) {
        old.abort.abort()
        // The engine's token-identity check will drop the eventual decode
        // if it was in flight, but we also explicitly clear the slot to
        // reclaim memory the moment the token changes.
        engineRef?.clearPrebuffered(old.token)
        prebufferStateRef.current = null
      }

      // Standby cleared — done, just make sure UI-level state is idle.
      if (nextIdx === null || !engineRef) {
        if (s.prebufferingIndex !== null) s.setPrebufferingIndex(null)
        return
      }

      const item = s.setlist[nextIdx]
      if (!item) {
        if (s.prebufferingIndex !== null) s.setPrebufferingIndex(null)
        return
      }

      // Q3 short-circuit: standby is the currently-active song and its
      // filePath matches what's loaded. Prebuffering would do nothing
      // useful — the engine already has this buffer resident.
      if (nextIdx === s.activeSetlistIndex && item.path === s.filePath) {
        if (s.prebufferingIndex !== null) s.setPrebufferingIndex(null)
        return
      }

      const token = Symbol('prebuffer')
      const abort = new AbortController()
      prebufferStateRef.current = { token, index: nextIdx, path: item.path, abort }
      s.setPrebufferingIndex(nextIdx)

      // Kick off the async read + decode. We deliberately do NOT await —
      // the subscriber must return synchronously so the next standby
      // change can cancel us cleanly.
      ;(async (): Promise<void> => {
        try {
          const arrayBuffer = await window.api.readAudioFile(item.path)
          if (abort.signal.aborted) return
          if (!arrayBuffer) return
          await engineRef.prebufferFile(arrayBuffer, token)
        } catch {
          // Silent failure per Q2 — user will hit fallback openFile path.
        } finally {
          // Only clear UI state if we're still the active prebuffer job.
          // A newer job may have taken over (prebufferStateRef rotated).
          if (prebufferStateRef.current?.token === token) {
            useStore.getState().setPrebufferingIndex(null)
          }
        }
      })()
    })
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // Don't intercept shortcuts when typing in input fields
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      // Ctrl+L: toggle UI lock
      if (e.code === 'KeyL' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        const s = useStore.getState()
        s.setShowLocked(!s.showLocked)
        return
      }

      // Ctrl+Shift+C: toggle LTC chase. Does not collide with Ctrl+C (copy)
      // because the Shift requirement is mandatory.
      if (e.code === 'KeyC' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault()
        const s = useStore.getState()
        s.setChaseEnabled(!s.chaseEnabled)
        return
      }

      // When locked, only allow Space (play/pause), Escape (stop), F11 (fullscreen)
      if (useStore.getState().showLocked) {
        if (e.code !== 'Space' && e.code !== 'Escape' && e.code !== 'F11') return
      }

      // Space: GO (standby → load+play) or play/pause toggle
      if (e.code === 'Space') {
        e.preventDefault()
        cancelAutoAdvance()
        const state = useStore.getState()

        // Standby/GO: if a song is on standby, load AND start playback.
        // openFile() only loads — we must explicitly play() once loading is done,
        // otherwise GO appears to do nothing (song loaded but silent).
        if (state.standbySetlistIndex !== null && state.playState !== 'playing') {
          const idx = state.standbySetlistIndex
          const item = state.setlist[idx]
          if (item) {
            // Order matters for the prebuffer fast path: openFile() reads
            // prebufferStateRef to decide whether to consume the cached
            // decode. If we cleared standby first, the subscriber would
            // fire synchronously and wipe the ref — killing the fast path.
            // We clear standby AFTER openFile has consumed (or declined to
            // consume) the prebuffered buffer.
            state.setActiveSetlistIndex(idx)
            openFile(item.path, item.offsetFrames).then(() => {
              // Clear standby now that the song is loaded (or failed).
              useStore.getState().setStandbySetlistIndex(null)
              const s = useStore.getState()
              if (s.duration > 0) {
                s.setPlayState('playing')
                engine.current?.play().then(() => {
                  const tc = useStore.getState().timecode
                  if (tc) mtc.current?.sendFullFrame(tc)
                }).catch(() => s.setPlayState('paused'))
              }
            })
          }
          return
        }

        if (!state.duration) return
        if (state.playState === 'playing') {
          engine.current?.pause()
          setPlayState('paused')
        } else {
          setPlayState('playing')
          engine.current?.play().then(() => {
            const tc = useStore.getState().timecode
            if (tc) mtc.current?.sendFullFrame(tc)
          }).catch(() => {
            setPlayState('paused')
          })
        }
      }

      // Escape: stop
      if (e.code === 'Escape') {
        e.preventDefault()
        if (fullscreenTc) {
          setFullscreenTc(false)
        } else {
          cancelAutoAdvance()
          engine.current?.pause()
          engine.current?.seek(0)
          setPlayState('stopped')
          setTimecode(null)
        }
      }

      // F11: toggle fullscreen timecode
      if (e.code === 'F11') {
        e.preventDefault()
        setFullscreenTc(prev => !prev)
      }

      // ArrowUp: previous song in setlist
      if (e.code === 'ArrowUp' && !e.ctrlKey && !e.metaKey) {
        const state = useStore.getState()
        if (state.setlist.length === 0) return
        const idx = state.activeSetlistIndex
        const prevIdx = idx !== null && idx > 0 ? idx - 1 : null
        if (prevIdx !== null) {
          e.preventDefault()
          state.setActiveSetlistIndex(prevIdx)
          const item = state.setlist[prevIdx]
          openFile(item.path, item.offsetFrames)
        }
      }

      // ArrowDown: next song in setlist
      if (e.code === 'ArrowDown' && !e.ctrlKey && !e.metaKey) {
        const state = useStore.getState()
        if (state.setlist.length === 0) return
        const idx = state.activeSetlistIndex
        const nextIdx = idx !== null && idx < state.setlist.length - 1 ? idx + 1
                      : idx === null ? 0 : null
        if (nextIdx !== null) {
          e.preventDefault()
          state.setActiveSetlistIndex(nextIdx)
          const item = state.setlist[nextIdx]
          openFile(item.path, item.offsetFrames)
        }
      }

      // [ : set loop A at current time
      if (e.code === 'BracketLeft' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        const state = useStore.getState()
        if (state.duration > 0) state.setLoopA(state.currentTime)
      }

      // ] : set loop B at current time
      if (e.code === 'BracketRight' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        const state = useStore.getState()
        if (state.duration > 0) state.setLoopB(state.currentTime)
      }

      // Ctrl+Z / Cmd+Z: undo (markers first, then setlist)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        const state = useStore.getState()
        if (state.markerUndoStack.length > 0) {
          e.preventDefault()
          state.undoMarker()
        } else if (state.previousSetlist) {
          e.preventDefault()
          state.undoClearSetlist()
        }
      }

      // Ctrl+Left / Ctrl+Right: jump to previous/next marker
      if ((e.ctrlKey || e.metaKey) && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
        e.preventDefault()
        const state = useStore.getState()
        if (!state.filePath || state.duration <= 0) return
        // v8 storage: markers keyed by setlist-item id, not filePath.
        const itemId = state.setlist.find(it => it.path === state.filePath)?.id
        const fileMarkers = itemId ? (state.markers[itemId] ?? []) : []
        if (fileMarkers.length === 0) return
        const sorted = [...fileMarkers].sort((a, b) => a.time - b.time)
        const ct = state.currentTime
        const threshold = 0.5 // seconds tolerance

        if (e.code === 'ArrowLeft') {
          const prev = sorted.filter(m => m.time < ct - threshold)
          if (prev.length > 0) {
            handleSeek(prev[prev.length - 1].time)
          }
        } else {
          const next = sorted.filter(m => m.time > ct + threshold)
          if (next.length > 0) {
            handleSeek(next[0].time)
          }
        }
      }

      // F4 — J: previous marker, K: next marker (AC-4.1, AC-4.2)
      if ((e.code === 'KeyJ' || e.code === 'KeyK') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const state = useStore.getState()
        if (!state.filePath || state.duration <= 0) return
        const itemId = state.setlist.find(it => it.path === state.filePath)?.id
        const fileMarkers = itemId ? (state.markers[itemId] ?? []) : []
        if (fileMarkers.length === 0) return
        const ct = state.currentTime
        const dir = e.code === 'KeyJ' ? 'prev' : 'next'
        const target = findAdjacentMarker(fileMarkers, ct, dir, 0.5)
        if (target) {
          e.preventDefault()
          handleSeek(target.time)
        }
      }

      // Number keys 1-9: behavior depends on numericKeyAction setting (Q4.1)
      if (e.code >= 'Digit1' && e.code <= 'Digit9' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const state = useStore.getState()
        const n = parseInt(e.code.charAt(5)) // Digit1→1, Digit9→9

        if (state.numericKeyAction === 'goto-marker') {
          // Jump to Nth marker of current song sorted by time (AC-4.3)
          if (!state.filePath || state.duration <= 0) return
          const itemId = state.setlist.find(it => it.path === state.filePath)?.id
          const fileMarkers = itemId ? (state.markers[itemId] ?? []) : []
          if (fileMarkers.length === 0) return
          const target = findNthMarker(fileMarkers, n)
          if (target) {
            e.preventDefault()
            handleSeek(target.time)
          }
        } else {
          // Default: goto-song (backward-compatible behavior)
          if (state.setlist.length === 0) return
          const idx = n - 1 // Digit1 → 0, Digit9 → 8
          if (idx < state.setlist.length) {
            e.preventDefault()
            state.setActiveSetlistIndex(idx)
            const item = state.setlist[idx]
            openFile(item.path, item.offsetFrames)
          }
        }
      }

      // F3 — Beat-aligned offset: Shift+,/. = ±½ beat, Ctrl+,/. = ±1 beat (AC-3.5)
      const isComma  = e.code === 'Comma'
      const isPeriod = e.code === 'Period'
      if ((isComma || isPeriod) && (e.shiftKey || e.ctrlKey || e.metaKey) && !(e.shiftKey && (e.ctrlKey || e.metaKey))) {
        const state = useStore.getState()
        if (state.duration <= 0) return
        const bpmSnapshot = state.tappedBpm ?? state.detectedBpm
        if (!bpmSnapshot) return
        const fps = state.forceFps ?? state.detectedFps ?? state.generatorFps ?? 25
        const beats = (e.shiftKey ? 0.5 : 1) * (isComma ? -1 : 1)
        e.preventDefault()

        // AC-3.4: act on active song's offsetFrames if present, else global
        const aIdx = state.activeSetlistIndex
        const songOffset = aIdx !== null ? state.setlist[aIdx]?.offsetFrames : undefined
        if (songOffset !== undefined && aIdx !== null) {
          const newVal = nudgeOffsetByBeats(songOffset, beats, bpmSnapshot, fps)
          state.setSetlistItemOffset(aIdx, newVal)
        } else {
          const newVal = nudgeOffsetByBeats(state.offsetFrames, beats, bpmSnapshot, fps)
          state.setOffsetFrames(newVal)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreenTc])

  const handleTimecode = useCallback((tc: TimecodeFrame): void => {
    setTimecode(tc)
    setDetectedFps(tc.fps)
    const audioTime = engine.current?.getCurrentAudioContextTime() ?? 0
    mtc.current?.sendTimecode(tc, audioTime)
    artnet.current?.sendTimecode(tc)
    osc.current?.sendTimecode(tc)

    // NOTE: file-decoded LTC is NOT routed to the ChaseEngine. Chase
    // follows external LTC from the dedicated input device only, set
    // up via Settings → Devices → LTC Input Device. The previous
    // arrangement (forwarding file-LTC frames here) caused chase to
    // re-trigger from its own playback, which made song-switch logic
    // race with the playhead. The new wiring lives on
    // AudioEngine.onLtcInputTimecode → chase.onIncomingTc.

    // MIDI Cue triggering — compare absolute timecode
    const s = useStore.getState()
    if (s.playState === 'playing' && s.activeSetlistIndex !== null) {
      const song = s.setlist[s.activeSetlistIndex]
      const cues = song?.midiCues ?? []
      if (cues.length > 0) {
        const tcStr = [tc.hours, tc.minutes, tc.seconds, tc.frames]
          .map(n => String(n).padStart(2, '0')).join(tc.dropFrame ? ';' : ':')
        const currentFrames = tcToFrames(tcStr, tc.fps)
        for (const cue of cues) {
          if (!cue.enabled) continue
          if (triggeredCueIds.current.has(cue.id)) continue
          const cueFrames = tcToFrames(cue.triggerTimecode, tc.fps) + (cue.offsetFrames ?? 0)
          if (cueFrames <= currentFrames) {
            triggeredCueIds.current.add(cue.id)
            showLog.log('cue', `${cue.messageType} ch${cue.channel} #${cue.data1}${cue.label ? ` "${cue.label}"` : ''} @ ${cue.triggerTimecode}`)
            // Visual feedback: flash the cue row
            setLastFiredCueId(cue.id)
            if (cueFlashTimer.current) clearTimeout(cueFlashTimer.current)
            cueFlashTimer.current = setTimeout(() => setLastFiredCueId(null), 500)
            // Fire the cue
            if (cue.messageType === 'program-change') {
              mtc.current?.sendProgramChange(cue.channel, cue.data1)
            } else if (cue.messageType === 'note-on') {
              mtc.current?.sendNoteOn(cue.channel, cue.data1, cue.data2 ?? 100)
            } else if (cue.messageType === 'control-change') {
              mtc.current?.sendControlChange(cue.channel, cue.data1, cue.data2 ?? 0)
            }
          }
        }
      }
    }
  }, [setTimecode, setDetectedFps])

  const selectMidiPort = useCallback((portId: string): void => {
    if (!mtc.current) return
    if (!portId) {
      mtc.current.deselectPort()
      setMidiConnected(false)
      setSelectedMidiPort(null)
      return
    }
    const ok = mtc.current.selectPort(portId)
    setMidiConnected(ok)
    setSelectedMidiPort(ok ? portId : null)
    // Send full frame immediately so receiving software syncs
    if (ok) {
      const tc = useStore.getState().timecode
      if (tc) mtc.current.sendFullFrame(tc)
    }
  }, [setMidiConnected, setSelectedMidiPort])

  const selectCueMidiPort = useCallback((portId: string): void => {
    if (!mtc.current) return
    if (!portId) {
      mtc.current.deselectCuePort()
      setSelectedCueMidiPort(null)
      return
    }
    const ok = mtc.current.selectCuePort(portId)
    setSelectedCueMidiPort(ok ? portId : null)
  }, [setSelectedCueMidiPort])

  /**
   * Test-fire a MIDI cue from the renderer immediately. Same MtcOutput path
   * the scheduler uses (`mtc.current.sendNoteOn` / `sendControlChange` /
   * `sendProgramChange`), so the user hears the same MIDI byte stream they'd
   * get during playback. Used by the cue-row ▶ button.
   */
  const testFireCue = useCallback((cue: MidiCuePoint): void => {
    if (!mtc.current) return
    if (cue.messageType === 'program-change') {
      mtc.current.sendProgramChange(cue.channel, cue.data1)
    } else if (cue.messageType === 'note-on') {
      mtc.current.sendNoteOn(cue.channel, cue.data1, cue.data2 ?? 100)
    } else if (cue.messageType === 'control-change') {
      mtc.current.sendControlChange(cue.channel, cue.data1, cue.data2 ?? 0)
    }
    showLog.log('cue', `[test] ${cue.messageType} ch${cue.channel} #${cue.data1}${cue.label ? ` "${cue.label}"` : ''}`)
  }, [])

  const selectMidiInputPort = useCallback((portId: string): void => {
    if (!midiIn.current) return
    if (!portId) {
      midiIn.current.deselectPort()
      setMidiInputPort(null)
      return
    }
    const ok = midiIn.current.selectPort(portId)
    setMidiInputPort(ok ? portId : null)
    if (ok) {
      // Setup mapping listener
      midiIn.current.setupMappingListener(() => useStore.getState().midiMappings)
    }
  }, [setMidiInputPort])

  const handleStartLearn = useCallback((mappingId: string): void => {
    if (!midiIn.current) return
    if (learningMappingId === mappingId) {
      // Cancel learn
      midiIn.current.stopLearn()
      setLearningMappingId(null)
      return
    }
    setLearningMappingId(mappingId)
    midiIn.current.startLearn((result) => {
      setLearningMappingId(null)
      updateMidiMapping(mappingId, {
        trigger: { type: result.type, channel: result.channel, data1: result.data1 }
      })
    })
  }, [learningMappingId, updateMidiMapping])

  const openFile = async (path?: string, songOffsetFrames?: number): Promise<void> => {
    const filePath_ = path ?? await window.api.openFileDialog()
    if (!filePath_) return

    cancelAutoAdvance()
    engine.current?.pause()  // stop audio immediately — don't let old file keep playing during file read
    setPlayState('stopped')
    setTimecode(null)
    setMusicWaveform(null)
    setLtcWaveform(null)
    clearVideo()

    const name = filePath_.split(/[/\\]/).pop() ?? filePath_
    setAudioLoading(true, name)
    showLog.log('file', `Loading: ${name}`)

    // Pre-buffer fast path (F1): if the file we're about to load matches the
    // song we prebuffered for, skip the read+decode pipeline and hand the
    // already-decoded buffer straight to the engine.
    //
    // "Match" requires both:
    //   1. path identity — same file on disk as the prebuffer was started for
    //   2. token identity — engine's prebufferedToken still equals ours (the
    //      engine short-circuits if it was overwritten by a newer prebuffer)
    //
    // If either condition fails (decode still in flight, file changed, token
    // stale) consumePrebuffered returns null and we drop through to the
    // standard read-and-decode path. No double-load, no audio gap.
    let decodedBuffer: AudioBuffer | null = null
    const prebufState = prebufferStateRef.current
    if (prebufState && prebufState.path === filePath_ && engine.current) {
      decodedBuffer = engine.current.consumePrebuffered(prebufState.token)
      if (!decodedBuffer) {
        // Mid-decode GO — the in-flight prebuffer's promise hasn't resolved
        // yet. Abort the signal, invalidate the engine token so the eventual
        // decode result self-destructs instead of sticking in the slot, and
        // let the fallback path run.
        prebufState.abort.abort()
        engine.current.clearPrebuffered(prebufState.token)
      }
      // Whether consume succeeded or not, this slot is now "spent" — clear
      // the ref so a subsequent openFile doesn't try to reuse it.
      prebufferStateRef.current = null
      useStore.getState().setPrebufferingIndex(null)
    }

    try {
      if (decodedBuffer) {
        // Fast path: engine already has the decoded buffer. loadDecodedBuffer
        // runs the same dispose → set buffer → detect → waveform → lookup
        // pipeline as loadFile minus the read+decode that normally costs
        // 1–2s on large WAVs.
        await engine.current?.loadDecodedBuffer(decodedBuffer)
      } else {
        const arrayBuffer = await window.api.readAudioFile(filePath_)
        if (!arrayBuffer) throw new Error('Empty file')
        await engine.current?.loadFile(arrayBuffer)
      }

      // Reset BPM on new file load (real-time detection happens during playback)
      setDetectedBpm(null)

      // Apply manual LTC channel override if set (overrides auto-detect from loadFile)
      const ch = useStore.getState().ltcChannel
      if (ch !== 'auto') engine.current?.setLtcChannel(ch)
      // Apply per-song offset override, or fall back to global offset
      const effectiveOffset = songOffsetFrames !== undefined
        ? songOffsetFrames
        : useStore.getState().offsetFrames
      engine.current?.setOffset(effectiveOffset)
      const duration = engine.current?.getDuration() ?? 0
      setFilePath(filePath_, name, duration)
      // Notify OSC clients of song change
      const s = useStore.getState()
      const songIndex = s.activeSetlistIndex ?? 0
      osc.current?.sendSong(name, songIndex)
    } catch (e) {
      setFilePath(null, null, 0)  // clear stale file state so UI doesn't show old file as loaded
      toast.error(`${t(useStore.getState().lang, 'loadFailed')}: ${e}`)
    } finally {
      setAudioLoading(false)
    }
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    dragCounter.current = 0
    setDragging(false)

    // Handle drag from setlist panel → load the file
    const setlistData = e.dataTransfer.getData('application/x-ltcast-setlist')
    if (setlistData) {
      try {
        const { index, path } = JSON.parse(setlistData) as { index: number; path: string }
        const { setActiveSetlistIndex, setlist } = useStore.getState()
        setActiveSetlistIndex(index)
        openFile(path, setlist[index]?.offsetFrames)
      } catch { /* ignore malformed data */ }
      return
    }

    // Handle OS file drops
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return

    const audioExts = ['.wav', '.aiff', '.aif', '.mp3', '.flac', '.ogg', '.m4a']
    const audioFiles = files.filter(f => audioExts.some(ext => f.name.toLowerCase().endsWith(ext)))
    if (audioFiles.length === 0) return

    if (audioFiles.length === 1) {
      // Single file: load immediately + add to setlist
      const path = window.api.getPathForFile(audioFiles[0])
      openFile(path)
      const { addToSetlist } = useStore.getState()
      addToSetlist([{ path, name: audioFiles[0].name }])
    } else {
      // Multiple files: add all to setlist, load the first one
      const items = audioFiles.map(f => ({
        path: window.api.getPathForFile(f),
        name: f.name
      }))
      const { addToSetlist } = useStore.getState()
      addToSetlist(items)
      openFile(items[0].path)
    }
  }

  // FileMenu wrappers — mirror PresetBar's share/import handlers so the
  // user gets the same toast feedback regardless of which entry point
  // they used. The store actions themselves stay the source of truth.
  const handleShareProject = useCallback(async (): Promise<void> => {
    const path = await shareProjectZip()
    if (path) toast.success(t(useStore.getState().lang, 'shareAsZipSuccess'))
  }, [shareProjectZip])

  const handleImportProject = useCallback(async (): Promise<void> => {
    const ok = await importLtcastProject()
    if (ok) toast.success(t(useStore.getState().lang, 'projectImported'))
  }, [importLtcastProject])

  const openVideo = async (): Promise<void> => {
    if (!engine.current || !useStore.getState().duration) {
      toast.warning(t(useStore.getState().lang, 'noFile'))
      return
    }

    const videoPath = await window.api.openVideoDialog()
    if (!videoPath) return

    const videoName = videoPath.split(/[/\\]/).pop() ?? videoPath
    setVideoLoading(true)

    try {
      const arrayBuffer = await window.api.extractAudioFromVideo(videoPath)
      if (!arrayBuffer) throw new Error('Empty audio')

      const tempCtx = new AudioContext()
      let videoBuffer: AudioBuffer
      try {
        videoBuffer = await tempCtx.decodeAudioData(arrayBuffer)
      } finally {
        await tempCtx.close()
      }

      // Extract waveform peaks (high resolution for video)
      const POINTS = 12000 // Higher than WAVEFORM_POINTS for better alignment precision
      const total = videoBuffer.length
      const videoData = new Float32Array(POINTS)
      const ch = videoBuffer.getChannelData(0)
      for (let i = 0; i < POINTS; i++) {
        const start = Math.floor((i / POINTS) * total)
        const end = Math.floor(((i + 1) / POINTS) * total)
        let maxAbs = 0
        for (let j = start; j < end; j++) {
          const abs = Math.abs(ch[j])
          if (abs > maxAbs) maxAbs = abs
        }
        videoData[i] = maxAbs
      }

      setVideoFile(videoName, videoData, videoBuffer.duration)

      // Auto-align using waveform peaks (fast)
      if (musicWaveform) {
        const { offset, confidence } = alignAudio(
          musicWaveform, videoData,
          useStore.getState().duration,
          videoBuffer.duration
        )
        const finalOffset = confidence >= 0.7 ? offset : 0
        if (confidence < 0.7) toast.warning(t(useStore.getState().lang, 'videoAlignPoor'))
        setVideoOffsetSeconds(finalOffset)

        // Look up timecode at alignment point
        const lookup = useStore.getState().timecodeLookup
        const tc = getTimecodeAtTime(lookup, finalOffset)
        setVideoStartTimecode(tc ? formatTimecode(tc) : null)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      const l = useStore.getState().lang
      if (msg === 'NO_AUDIO_TRACK') {
        toast.error(t(l, 'noAudioTrack'))
      } else {
        toast.error(t(l, 'videoImportFailed'))
      }
    } finally {
      setVideoLoading(false)
    }
  }

  const handleSidebarResizeStart = (e: React.MouseEvent): void => {
    e.preventDefault()
    isResizingSidebar.current = true
    const startX = e.clientX
    const startWidth = sidebarWidth
    const onMouseMove = (ev: MouseEvent): void => {
      if (!isResizingSidebar.current) return
      const newWidth = Math.max(140, Math.min(450, startWidth + (ev.clientX - startX)))
      setSidebarWidth(newWidth)
    }
    const onMouseUp = (): void => {
      isResizingSidebar.current = false
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  const handleRightPanelResizeStart = (e: React.MouseEvent): void => {
    e.preventDefault()
    isResizingRightPanel.current = true
    const startX = e.clientX
    const startWidth = rightPanelWidth
    const onMouseMove = (ev: MouseEvent): void => {
      if (!isResizingRightPanel.current) return
      const newWidth = Math.max(180, Math.min(520, startWidth - (ev.clientX - startX)))
      setRightPanelWidth(newWidth)
    }
    const onMouseUp = (): void => {
      isResizingRightPanel.current = false
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  const resyncVideo = (): void => {
    const s = useStore.getState()
    if (!musicWaveform || !s.videoWaveform || !s.duration || !s.videoDuration) return
    const { offset, confidence } = alignAudio(
      musicWaveform, s.videoWaveform, s.duration, s.videoDuration
    )
    const finalOffset = confidence >= 0.7 ? offset : 0
    if (confidence < 0.7) toast.warning(t(useStore.getState().lang, 'videoAlignPoor'))
    setVideoOffsetSeconds(finalOffset)
    const tc = getTimecodeAtTime(s.timecodeLookup, finalOffset)
    setVideoStartTimecode(tc ? formatTimecode(tc) : null)
  }

  const handlePlay = (): void => {
    cancelAutoAdvance()
    setPlayState('playing')
    osc.current?.sendTransport('play')
    showLog.log('transport', 'Play')
    engine.current?.play().then(() => {
      const tc = useStore.getState().timecode
      if (tc) mtc.current?.sendFullFrame(tc)
    }).catch(() => {
      setPlayState('paused')
    })
  }

  const handlePause = (): void => {
    cancelAutoAdvance()
    engine.current?.pause()
    setPlayState('paused')
    osc.current?.sendTransport('pause')
    showLog.log('transport', 'Pause')
  }

  const handleStop = (): void => {
    cancelAutoAdvance()
    engine.current?.pause()
    engine.current?.seek(0)
    setPlayState('stopped')
    setTimecode(null)
    triggeredCueIds.current = new Set()
    osc.current?.sendTransport('stop')
    showLog.log('transport', 'Stop')
  }

  const handlePanic = (): void => {
    showLog.log('transport', 'PANIC — all outputs stopped')
    const s = useStore.getState()
    // Clear standby so next Space press does not fire a stale song
    s.setStandbySetlistIndex(null)
    // Stop playback
    handleStop()
    // Send MIDI All Notes Off + All Sound Off on ALL 16 channels,
    // broadcasting to both MTC and cue ports (whichever is connected)
    if (mtc.current) {
      for (let ch = 0; ch < 16; ch++) {
        mtc.current.sendControlChangeBroadcast(ch + 1, 123, 0) // All Notes Off
        mtc.current.sendControlChangeBroadcast(ch + 1, 120, 0) // All Sound Off
      }
    }
    // Stop MIDI Clock if running
    if (mtc.current?.isClockRunning()) mtc.current.stopClock()
    // Build zero TC using the current show's fps/dropFrame (not hardcoded 25)
    const curFps = s.timecode?.fps ?? s.forceFps ?? s.detectedFps ?? s.generatorFps ?? 25
    const curDf = s.timecode?.dropFrame ?? false
    const zeroTc = { hours: 0, minutes: 0, seconds: 0, frames: 0, fps: curFps, dropFrame: curDf }
    // Send zero to all protocols
    mtc.current?.sendFullFrame(zeroTc)
    artnet.current?.sendTimecode(zeroTc)
    osc.current?.sendTimecode(zeroTc)
  }

  const handleSeek = async (time: number): Promise<void> => {
    const wasPlaying = await engine.current?.seek(time)
    if (wasPlaying) setPlayState('playing')
    const tc = useStore.getState().timecode
    if (tc) mtc.current?.sendFullFrame(tc)
    // Reset cue tracking: re-add IDs of cues that are already past the new seek position
    const s = useStore.getState()
    if (s.activeSetlistIndex !== null) {
      const song = s.setlist[s.activeSetlistIndex]
      const cues = song?.midiCues ?? []
      if (tc) {
        const seekTcStr = [tc.hours, tc.minutes, tc.seconds, tc.frames]
          .map(n => String(n).padStart(2, '0')).join(tc.dropFrame ? ';' : ':')
        const seekFrames = tcToFrames(seekTcStr, tc.fps)
        triggeredCueIds.current = new Set(
          cues.filter(c => (tcToFrames(c.triggerTimecode, tc.fps) + (c.offsetFrames ?? 0)) < seekFrames).map(c => c.id)
        )
      } else {
        triggeredCueIds.current = new Set()
      }
    }
  }

  if (fullscreenTc) {
    return (
      <div
        className="fullscreen-tc"
        onClick={() => setFullscreenTc(false)}
        title={t(lang, 'clickToExit')}
      >
        <TimecodeDisplay fullscreen />
      </div>
    )
  }

  return (
    <div
      className={`app theme-${themeColor}${dragging ? ' app--drag' : ''}${showLocked ? ' ui-locked' : ''}`}
      onDragEnter={(e) => { e.preventDefault(); dragCounter.current++; setDragging(true) }}
      onDragOver={(e) => { e.preventDefault() }}
      onDragLeave={() => { dragCounter.current--; if (dragCounter.current <= 0) { dragCounter.current = 0; setDragging(false) } }}
      onDrop={handleDrop}
    >
      {/* Custom Title Bar */}
      <div className="title-bar">
        {/* Left: logo + file menu dropdown (Sprint UI-Reorg Follow-up).
            The previous 3 inline buttons (Open File / Import Video /
            Export LTC WAV) plus PresetBar's Share Project / Import
            .ltcastproject buttons all now live inside <FileMenu>. */}
        <div className="title-bar-left">
          <span className="title-bar-logo">LTCast</span>
          <div className="title-bar-ops">
            <FileMenu
              filePath={filePath}
              onOpenFile={() => openFile()}
              onImportVideo={openVideo}
              onExportLtcWav={() => setShowLtcWavDialog(true)}
              onShareProject={handleShareProject}
              onImportProject={handleImportProject}
            />
          </div>
        </div>

        {/* Center: preset name */}
        <div className="title-bar-center">
          <PresetBar />
        </div>

        {/* Right: save + trial + window controls */}
        <div className="title-bar-right">
          <button className="title-bar-btn" onClick={() => savePreset()} disabled={!presetName}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
            </svg>
            {t(lang, 'save')}{presetDirty ? ' *' : ''}
          </button>
          {/* Sprint UI-Reorg — Settings gear icon. Placed between Save and the
              trial / PRO badge per Stitch design + AC-5.4. */}
          <button
            className="title-bar-btn title-bar-gear"
            onClick={() => openSettings('outputs')}
            title={t(lang, 'openSettings')}
            aria-label={t(lang, 'openSettings')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h0a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51h0a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v0a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
          </button>
          {!isPro() && trialDaysLeft !== null && trialDaysLeft > 0 && (
            <button className="title-bar-trial" onClick={() => setShowLicenseDialog(true)}>
              {trialDaysLeft}d Trial
            </button>
          )}
          {!isPro() && trialDaysLeft === 0 && (
            <button className="title-bar-trial title-bar-trial--expired" onClick={() => setShowLicenseDialog(true)}>
              Trial Expired
            </button>
          )}
          {!isPro() && trialDaysLeft === null && (
            <button className="title-bar-trial" onClick={() => setShowLicenseDialog(true)}>
              License
            </button>
          )}
          {isPro() && (
            <button className="title-bar-pro" onClick={() => setShowLicenseDialog(true)}>PRO</button>
          )}
          {/* Window controls — Windows only (Mac uses native traffic lights) */}
          {window.api.platform === 'win32' && (
            <div className="title-bar-wc">
              <button className="wc-btn" onClick={() => window.api.windowMinimize()} title="Minimize">
                <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
              </button>
              <button className="wc-btn" onClick={() => window.api.windowMaximize()} title="Maximize">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1"><rect x="0.5" y="0.5" width="9" height="9"/></svg>
              </button>
              <button className="wc-btn wc-btn--close" onClick={() => window.api.windowClose()} title="Close">
                <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2"><line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/></svg>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="main-content">
        {/* Left: Setlist sidebar */}
        <div className="setlist-sidebar" style={{ width: sidebarWidth }}>
          <SetlistPanel
            onLoadFile={(path, offsetFrames) => openFile(path, offsetFrames)}
            onShowLicense={() => setShowLicenseDialog(true)}
            onImportFiles={async () => {
              const files = await window.api.openMultipleAudioDialog()
              if (files && files.length > 0) {
                const { addToSetlist } = useStore.getState()
                const items = files.map(f => ({
                  path: f,
                  name: f.split(/[/\\]/).pop() ?? f
                }))
                addToSetlist(items)
              }
            }}
          />
          <div className="sidebar-resize-handle" onMouseDown={handleSidebarResizeStart} />
        </div>

        {/* Center: TC + waveform */}
        <div className="center-panel">
          {/* Mode tabs + signal/BPM row */}
          <div className="center-top-bar">
            <div className="mode-tabs">
              <button
                className={`mode-tab${!tcGeneratorMode ? ' active' : ''}`}
                onClick={() => setTcGeneratorMode(false)}
              >{t(lang, 'tcModeLtc')}</button>
              <button
                className={`mode-tab${tcGeneratorMode ? ' active' : ''}`}
                onClick={() => setTcGeneratorMode(true)}
              >{t(lang, 'tcModeGenerator')}</button>
            </div>
            <div className="center-top-right">
              {!tcGeneratorMode && (
                <div className={`signal-badge${ltcSignalOk ? ' signal-badge--ok' : ' signal-badge--lost'}`}>
                  <span className="signal-dot" />
                  <span>{ltcSignalOk ? 'SIGNAL OK' : 'NO SIGNAL'}</span>
                  {ltcSignalOk && ltcConfidence > 0 && (
                    <span className="signal-confidence">{Math.round(ltcConfidence * 100)}%</span>
                  )}
                  {ltcSignalOk && detectedLtcChannel !== null && (
                    <span className="signal-ch">CH{(detectedLtcChannel ?? 0) + 1}</span>
                  )}
                </div>
              )}
              {tcGeneratorMode && (
                <div className="signal-badge signal-badge--gen">
                  <span className="signal-dot" />
                  <span>GENERATING</span>
                </div>
              )}
              <ChaseQuickToggle />
              <TapBpm />
            </div>
          </div>

          <TimecodeDisplay onSeekToTimecode={(tcStr) => {
            const s = useStore.getState()
            const fps = s.timecode?.fps ?? s.forceFps ?? s.detectedFps ?? s.generatorFps ?? 25
            const targetFrames = tcToFrames(tcStr, fps)
            // Compute delta from current TC → new TC, apply to current audio time.
            // This respects the file's TC start offset (e.g., LTC that starts at 01:00:00).
            const curTc = s.timecode
            if (curTc) {
              const curTcStr = [curTc.hours, curTc.minutes, curTc.seconds, curTc.frames]
                .map(n => String(n).padStart(2, '0')).join(':')
              const curFrames = tcToFrames(curTcStr, fps)
              const deltaSec = (targetFrames - curFrames) / fps
              handleSeek(Math.max(0, s.currentTime + deltaSec))
            } else {
              // No current TC — fall back to absolute conversion (generator mode at 0)
              handleSeek(targetFrames / fps)
            }
          }} />

          {audioLoading ? (
            <div className="file-info file-info--loading">
              <span className="file-loading-spinner" />
              {loadingFileName ?? t(lang, 'loading')}
            </div>
          ) : filePath ? (
            <div className="file-info">{fileName}</div>
          ) : (
            <div className="drop-zone" onClick={() => openFile()}>
              <div className="drop-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18V5l12-2v13"/>
                  <circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                </svg>
              </div>
              <div>{t(lang, 'dropFile')}</div>
              <div className="drop-formats">{t(lang, 'supportedFormats')}</div>
            </div>
          )}

          {/* Music master strip — horizontal volume + pan above waveform (Stitch Variant 3) */}
          <div className="music-mixer-strip">
            <span className="mixer-master-label">Music Master</span>
            <div className="mixer-divider" />
            <div className="mixer-vol-section">
              <span className="mixer-mini-label">VOL</span>
              <div className="mixer-slider-wrap">
                <input
                  type="range"
                  className="mixer-vol-slider"
                  min={0} max={5.7} step={0.01}
                  value={musicVolume}
                  onChange={(e) => setMusicVolume(parseFloat(e.target.value))}
                  onDoubleClick={() => setMusicVolume(1.0)}
                  onContextMenu={(e) => { e.preventDefault(); setMusicVolume(1.0) }}
                  title={`${t(lang, 'musicVolume')} — Right-click / double-click: reset to 0 dB`}
                />
                <div className="mixer-scale mixer-scale--vol">
                  <span>-∞</span><span>0</span><span>+15</span>
                </div>
              </div>
              <span className={`mixer-db-value${musicVolume > 2.0 ? ' mixer-db-value--warn' : ''}`}>{gainToDb(musicVolume)}</span>
            </div>
            <div className="mixer-pan-section">
              <span className="mixer-mini-label">PAN</span>
              <div className="mixer-slider-wrap">
                <input
                  type="range"
                  className="mixer-pan-slider"
                  min={-1} max={1} step={0.01}
                  value={musicPan}
                  onChange={(e) => setMusicPan(parseFloat(e.target.value))}
                  onDoubleClick={() => setMusicPan(0)}
                  onContextMenu={(e) => { e.preventDefault(); setMusicPan(0) }}
                  title={`${t(lang, 'musicPan')} — Right-click / double-click: center`}
                />
                <div className="mixer-scale mixer-scale--pan">
                  <span>L</span><span>C</span><span>R</span>
                </div>
              </div>
              <span className="mixer-pan-value">{panToDisplay(musicPan)}</span>
            </div>
          </div>

          <Waveform
            musicData={musicWaveform}
            ltcData={ltcWaveform}
            chaseTime={chaseVirtualTime}
            onSeek={handleSeek}
            onVideoOffsetChange={(offset) => {
              setVideoOffsetSeconds(offset)
              const lookup = useStore.getState().timecodeLookup
              const tc = getTimecodeAtTime(lookup, offset)
              setVideoStartTimecode(tc ? formatTimecode(tc) : null)
            }}
            onClearVideo={clearVideo}
            onResyncVideo={resyncVideo}
          />

          <Transport
            onPlay={handlePlay}
            onPause={handlePause}
            onStop={handleStop}
            onSeek={handleSeek}
            onPanic={handlePanic}
          />

          {/* Auto-advance countdown banner */}
          {autoAdvanceCountdown && (
            <div className="auto-advance-banner">
              <span>{t(lang, 'nextSongIn', { name: autoAdvanceCountdown.name, s: String(autoAdvanceCountdown.remaining) })}</span>
              <button className="auto-advance-cancel" onClick={cancelAutoAdvance}>✕</button>
            </div>
          )}
        </div>

        {/* Right: Device / Cue panel */}
        <div className="right-panel" style={{ width: rightPanelWidth }}>
          <div className="right-panel-resize-handle" onMouseDown={handleRightPanelResizeStart} />
          {/* Tab switcher — Sprint UI-Reorg: 6 tabs collapsed to 3 (Cues / Show / Tools). */}
          <div className="right-panel-tabs">
            <button
              className={`right-tab-btn${rightTab === 'cues' ? ' active' : ''}`}
              onClick={() => useStore.getState().setRightTab('cues')}
            >
              {t(lang, 'tab_cues')}
              <span className={`midi-activity-dot${midiActivity ? ' active' : ''}`} />
            </button>
            <button
              className={`right-tab-btn${rightTab === 'show' ? ' active' : ''}`}
              onClick={() => useStore.getState().setRightTab('show')}
            >{t(lang, 'tab_show')}</button>
            <button
              className={`right-tab-btn${rightTab === 'tools' ? ' active' : ''}`}
              onClick={() => useStore.getState().setRightTab('tools')}
            >{t(lang, 'tab_tools')}</button>
          </div>

          {rightTab === 'cues' && (
            <CuesTab
              onSeek={handleSeek}
              onUpgrade={() => setShowLicenseDialog(true)}
              onCueMidiPortChange={selectCueMidiPort}
              onMidiInputPortChange={selectMidiInputPort}
              onStartLearn={handleStartLearn}
              learningMappingId={learningMappingId}
              lastFiredCueId={lastFiredCueId}
              onTestFireCue={testFireCue}
              onAddMarker={() => {
                // Defer to the marker-add flow already wired into the keyboard
                // 'M' shortcut: drop a marker at the current playhead.
                const s = useStore.getState()
                const fp = s.filePath
                if (!fp) {
                  toast.info(t(s.lang, 'noFile'))
                  return
                }
                const time = s.currentTime ?? 0
                const id = `mk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
                s.addMarker(fp, { id, time, label: '', type: 'custom' })
              }}
              onAddMidiCue={() => {
                // Mirror MidiCuePanel.handleAddCue: append a default cue + flip
                // user to the cue list (already visible in CuesTab).
                const s = useStore.getState()
                const idx = s.activeSetlistIndex
                if (idx === null || idx < 0 || idx >= s.setlist.length) {
                  toast.info(t(s.lang, 'noFile'))
                  return
                }
                const tc = s.timecode
                const pad = (n: number): string => String(n).padStart(2, '0')
                const triggerTimecode = tc
                  ? `${pad(tc.hours)}:${pad(tc.minutes)}:${pad(tc.seconds)}:${pad(tc.frames)}`
                  : '00:00:00:00'
                const item = s.setlist[idx]
                const cues = item.midiCues ?? []
                const newCue = {
                  id: `cue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  triggerTimecode,
                  messageType: 'program-change' as const,
                  channel: 1,
                  data1: 0,
                  enabled: true,
                }
                s.setSetlistItemMidiCues(idx, [...cues, newCue])
              }}
            />
          )}

          {rightTab === 'show' && <ShowTab />}

          {rightTab === 'tools' && <TcCalcPanel />}
        </div>
      </div>

      <StatusBar
        version={version}
        onToggleFullscreen={() => setFullscreenTc(true)}
        onOpenSettings={openSettings}
        onSwitchToGenerator={() => {
          const s = useStore.getState()
          const lastTc = s.timecode
          if (lastTc) {
            const startTc = [lastTc.hours, lastTc.minutes, lastTc.seconds, lastTc.frames]
              .map(n => String(n).padStart(2, '0')).join(':')
            s.setGeneratorStartTC(startTc)
            s.setGeneratorFps(lastTc.fps)
            engine.current?.setGeneratorStartTC(startTc, lastTc.fps)
          }
          s.setTcGeneratorMode(true)
          engine.current?.setGeneratorMode(true)
        }}
      />

      {showLtcWavDialog && (
        <LtcWavExportDialog onClose={() => setShowLtcWavDialog(false)} />
      )}
      {showLicenseDialog && (
        <LicenseDialog onClose={() => setShowLicenseDialog(false)} />
      )}
      {showSettings && (
        <SettingsModal
          initialSection={settingsSection}
          onClose={() => setShowSettings(false)}
          onMidiPortChange={selectMidiPort}
          onMusicDeviceChange={(id) => engine.current?.setMusicOutputDevice(id).catch(() => {})}
          onLtcDeviceChange={(id) => engine.current?.setLtcOutputDevice(id).catch(() => {})}
          onLtcGainChange={(gain) => engine.current?.setLtcGain(gain)}
          onMtcModeChange={(mode) => mtc.current?.setMode(mode)}
          onLtcChannelChange={(ch) => { if (ch !== 'auto') engine.current?.setLtcChannel(ch) }}
        />
      )}
    </div>
  )
}
