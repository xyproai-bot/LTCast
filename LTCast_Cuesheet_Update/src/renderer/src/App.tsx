import React, { useEffect, useRef, useState, useCallback } from 'react'
import { AudioEngine } from './audio/AudioEngine'
import { MtcOutput } from './audio/MtcOutput'
import { ArtNetOutput } from './audio/ArtNetOutput'
import { TimecodeDisplay } from './components/TimecodeDisplay'
import { Waveform } from './components/Waveform'
import { Transport } from './components/Transport'
import { DevicePanel } from './components/DevicePanel'
import { SetlistPanel } from './components/SetlistPanel'
import { PresetBar } from './components/PresetBar'
import { StatusBar } from './components/StatusBar'
import { useStore, TimecodeFrame, isGeneratorItem } from './store'
import * as XLSX from 'xlsx'
import { alignAudio } from './audio/AudioAligner'
import { getTimecodeAtTime, formatTimecode } from './audio/LtcDecoder'
import { t } from './i18n'
import { toast } from './components/Toast'

/** Minimum LTC confidence to consider the signal valid (0–1) */
const LTC_CONFIDENCE_THRESHOLD = 0.5

export default function App(): React.JSX.Element {
  const engine = useRef<AudioEngine | null>(null)
  const mtc    = useRef<MtcOutput | null>(null)
  const artnet = useRef<ArtNetOutput | null>(null)
  const [musicWaveform, setMusicWaveform] = useState<Float32Array | null>(null)
  const [ltcWaveform, setLtcWaveform]     = useState<Float32Array | null>(null)
  const [version, setVersion]             = useState('0.1.0')
  const [dragging, setDragging]           = useState(false)
  const dragCounter = useRef(0)
  const [fullscreenTc, setFullscreenTc]   = useState(false)
  const [pendingAutoPlayIndex, setPendingAutoPlayIndex] = useState<number | null>(null)
  // Layout states
  const leftPanelWidth = useStore(s => s.leftPanelWidth)
  const rightPanelWidth = useStore(s => s.rightPanelWidth)
  const [resizingPanel, setResizingPanel] = useState<'left' | 'right' | null>(null)

  const {
    filePath, fileName, presetName, lang, loop,
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
    setLtcConfidence,
    artnetEnabled, artnetTargetIp,
    setSelectedMidiPort,
    setlist, activeSetlistIndex
  } = useStore()

  const activeTrackStartTC = activeSetlistIndex !== null ? setlist[activeSetlistIndex]?.startTC : undefined
  const effectiveStartTC = activeTrackStartTC ?? generatorStartTC

  const activeTrackMode = activeSetlistIndex !== null ? setlist[activeSetlistIndex]?.tcGeneratorMode : undefined
  const effectiveGeneratorMode = activeTrackMode ?? tcGeneratorMode

  // Sync window title bar with preset name
  useEffect(() => {
    document.title = presetName ? `LTCast - ${presetName}` : 'LTCast'
  }, [presetName])

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

  // Handle panel resizing
  useEffect(() => {
    if (!resizingPanel) return

    const handleMouseMove = (e: MouseEvent) => {
      if (resizingPanel === 'left') {
        const newWidth = Math.max(140, Math.min(e.clientX, 600))
        useStore.getState().setLeftPanelWidth(newWidth)
      } else if (resizingPanel === 'right') {
        const docWidth = document.documentElement.clientWidth
        const newWidth = Math.max(140, Math.min(docWidth - e.clientX, 600))
        useStore.getState().setRightPanelWidth(newWidth)
      }
    }

    const handleMouseUp = () => {
      setResizingPanel(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [resizingPanel])

  // Init engine + MIDI once
  useEffect(() => {
    engine.current = new AudioEngine({
      onTimecode: handleTimecode,
      onTimeUpdate: (t) => {
        setCurrentTime(t)
      },
      onEnded: () => {
        const s = useStore.getState()
        if (s.activeSetlistIndex !== null) {
          const currentTrack = s.setlist[s.activeSetlistIndex]
          if (currentTrack?.nextTrackId !== undefined && currentTrack.nextTrackId !== '') {
            const nextId = currentTrack.nextTrackId
            if (nextId === 'stop') {
              setPlayState('stopped')
              return
            }
            if (nextId === 'next') {
              if (s.activeSetlistIndex < s.setlist.length - 1) {
                setPendingAutoPlayIndex(s.activeSetlistIndex + 1)
                return
              }
            } else {
              const targetIdx = s.setlist.findIndex(t => t.id === nextId)
              if (targetIdx !== -1) {
                setPendingAutoPlayIndex(targetIdx)
                return
              }
            }
            // Explicit target not found or end of list
            setPlayState('stopped')
            return
          }

          // Fallback to global Auto Play
          if (s.autoPlayNext && s.activeSetlistIndex < s.setlist.length - 1) {
            setPendingAutoPlayIndex(s.activeSetlistIndex + 1)
            return
          }
        }
        setPlayState('stopped')
      },
      onLtcChannelDetected: (ch) => setDetectedLtcChannel(ch >= 0 ? ch : null),
      onLtcSignalStatus: (ok) => setLtcSignalOk(ok),
      onLtcConfidence: (confidence) => {
        setLtcConfidence(confidence)
        const s = useStore.getState()
        const trackMode = s.activeSetlistIndex !== null ? s.setlist[s.activeSetlistIndex]?.tcGeneratorMode : undefined
        if (trackMode !== undefined) {
          engine.current?.setGeneratorMode(trackMode)
          return
        }

        // Auto-enable generator mode when no LTC detected
        if (confidence < LTC_CONFIDENCE_THRESHOLD) {
          setTcGeneratorMode(true)
          engine.current?.setGeneratorMode(true)
          const currentActiveStartTC = s.activeSetlistIndex !== null ? s.setlist[s.activeSetlistIndex]?.startTC : undefined
          const fallbackStartTC = currentActiveStartTC ?? s.generatorStartTC
          engine.current?.setGeneratorStartTC(fallbackStartTC, s.generatorFps)
        } else {
          setTcGeneratorMode(false)
          engine.current?.setGeneratorMode(false)
        }
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
        const lang = useStore.getState().lang
        toast.warning(t(lang, 'audioDeviceDisconnected'))
      },
      onPlayStarted: (perfNow, audioTime) => {
        mtc.current?.setPlayStartClocks(perfNow, audioTime)
      },
      onLtcError: (type) => {
        const lang = useStore.getState().lang
        if (type === 'worklet') toast.error(t(lang, 'ltcWorkletError'))
        else if (type === 'warmup') toast.warning(t(lang, 'ltcWarmupError'))
        else if (type === 'encoder') toast.warning(t(lang, 'ltcEncoderError'))
      }
    })

    // Init Web MIDI
    const mtcOut = new MtcOutput()
    mtcOut.onPortsChanged = () => {
      setMidiOutputs(mtcOut.getPorts())
      setMidiConnected(mtcOut.isConnected())
    }
    mtcOut.onPortDisconnected = (portName: string) => {
      setMidiConnected(false)
      setSelectedMidiPort(null)
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
      })
      .catch((e) => console.warn('MIDI init failed:', e))
    mtc.current = mtcOut

    // Init Art-Net Timecode
    artnet.current = new ArtNetOutput()
    const savedState = useStore.getState()
    if (savedState.artnetEnabled) {
      artnet.current.start(savedState.artnetTargetIp).catch(() => {})
    }

    // Restore saved engine settings
    engine.current.setOffset(savedState.offsetFrames)
    engine.current.setLtcGain(savedState.ltcGain)

    // Warm up VB-CABLE / BlackHole device on startup
    // This forces the OS to establish the device connection early,
    // preventing the "locked handle" issue on Windows
    if (savedState.ltcOutputDeviceId && savedState.ltcOutputDeviceId !== 'default') {
      engine.current.setLtcOutputDevice(savedState.ltcOutputDeviceId).catch(() => {})
    }

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
      window.removeEventListener('beforeunload', handleBeforeUnload)
      engine.current?.forceCleanup()
      engine.current?.dispose()
      mtc.current?.deselectPort()
      artnet.current?.stop()
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

  // Re-apply offset when it changes
  useEffect(() => {
    engine.current?.setOffset(offsetFrames)
  }, [offsetFrames])

  // Sync loop toggle to engine
  useEffect(() => {
    engine.current?.setLoop(loop)
  }, [loop])

  // Sync A-B loop points to engine
  useEffect(() => {
    engine.current?.setLoopPoints(loopA, loopB)
  }, [loopA, loopB])

  // Handle AutoPlay Next Track
  useEffect(() => {
    if (pendingAutoPlayIndex !== null) {
      const idx = pendingAutoPlayIndex
      setPendingAutoPlayIndex(null)
      const s = useStore.getState()
      const track = s.setlist[idx]
      if (track) {
        s.setActiveSetlistIndex(idx)
        openFile(track.path, track.offsetFrames).then(() => {
          handlePlay()
        }).catch(err => {
          console.error("Autoplay failed:", err)
          setPlayState('stopped')
        })
      }
    }
  }, [pendingAutoPlayIndex])

  // Sync TC Generator settings to engine
  useEffect(() => {
    engine.current?.setGeneratorMode(effectiveGeneratorMode)
  }, [effectiveGeneratorMode])

  useEffect(() => {
    engine.current?.setGeneratorStartTC(effectiveStartTC, generatorFps)
  }, [effectiveStartTC, generatorFps])

  // Sync force FPS override to engine
  useEffect(() => {
    engine.current?.setForceFps(forceFps)
  }, [forceFps])

  // Sync manual LTC channel override to engine
  // When switching back to 'auto', restore the auto-detected channel index
  useEffect(() => {
    if (ltcChannel !== 'auto') {
      engine.current?.setLtcChannel(ltcChannel)
    } else {
      // Restore auto-detected channel so the engine isn't stuck on the last manual selection
      const detected = useStore.getState().detectedLtcChannel
      if (detected !== null) engine.current?.setLtcChannel(detected)
    }
  }, [ltcChannel])

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

  // Keyboard shortcuts (Space = play/pause, Ctrl+Z = undo clear setlist)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // Don't intercept shortcuts when typing in input fields
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.code === 'Space') {
        e.preventDefault()
        const state = useStore.getState()
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
      // Ctrl+Z / Cmd+Z: undo clear setlist
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        const state = useStore.getState()
        if (state.previousSetlist) {
          e.preventDefault()
          state.undoClearSetlist()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleTimecode = useCallback((tc: TimecodeFrame): void => {
    setTimecode(tc)
    setDetectedFps(tc.fps)
    const audioTime = engine.current?.getCurrentAudioContextTime() ?? 0
    mtc.current?.sendTimecode(tc, audioTime)
    artnet.current?.sendTimecode(tc)
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

  const openFile = async (path?: string, songOffsetFrames?: number): Promise<void> => {
    const filePath_ = path ?? await window.api.openFileDialog()
    if (!filePath_) return

    engine.current?.pause()  // stop audio immediately — don't let old file keep playing during file read
    setPlayState('stopped')
    setTimecode(null)
    setMusicWaveform(null)
    setLtcWaveform(null)
    clearVideo()

    const name = filePath_.split(/[/\\]/).pop() ?? filePath_

    try {
      const arrayBuffer = await window.api.readAudioFile(filePath_)
      if (!arrayBuffer) throw new Error('Empty file')
      await engine.current?.loadFile(arrayBuffer)
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
    } catch (e) {
      setFilePath(null, null, 0)  // clear stale file state so UI doesn't show old file as loaded
      toast.error(`${t(lang, 'loadFailed')}: ${e}`)
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

  const openVideo = async (): Promise<void> => {
    const videoPath = await window.api.openVideoDialog()
    if (!videoPath) return

    const videoName = videoPath.split(/[/\\/]/).pop() ?? videoPath
    setVideoLoading(true)

    try {
      // Step 1: Extract audio from video → saved to LTCast/Audio folder
      const extracted = await window.api.extractAudioFromVideoToFile(videoPath)

      // Step 2: Read the saved WAV file (uses the proven readAudioFile path — handles large files)
      const arrayBuffer = await window.api.readAudioFile(extracted.path)
      if (!arrayBuffer) throw new Error('Empty audio')

      const tempCtx = new AudioContext()
      let videoBuffer: AudioBuffer
      try {
        videoBuffer = await tempCtx.decodeAudioData(arrayBuffer)
      } finally {
        await tempCtx.close()
      }

      // Extract waveform peaks (high resolution for video)
      const POINTS = 12000
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

      // Auto-add extracted audio to setlist
      const { addToSetlist } = useStore.getState()
      addToSetlist([{ path: extracted.path, name: extracted.name }])

      // Auto-align using waveform peaks (only if an audio file is already loaded)
      if (musicWaveform && useStore.getState().duration) {
        const { offset, confidence } = alignAudio(
          musicWaveform, videoData,
          useStore.getState().duration,
          videoBuffer.duration
        )
        const finalOffset = confidence >= 0.7 ? offset : 0
        if (confidence < 0.7) toast.warning(t(lang, 'videoAlignPoor'))
        setVideoOffsetSeconds(finalOffset)

        // Look up timecode at alignment point
        const lookup = useStore.getState().timecodeLookup
        const tc = getTimecodeAtTime(lookup, finalOffset)
        setVideoStartTimecode(tc ? formatTimecode(tc) : null)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === 'NO_AUDIO_TRACK') {
        toast.error(t(lang, 'noAudioTrack'))
      } else {
        toast.error(t(lang, 'videoImportFailed'))
      }
    } finally {
      setVideoLoading(false)
    }
  }

  const resyncVideo = (): void => {
    const s = useStore.getState()
    if (!musicWaveform || !s.videoWaveform || !s.duration || !s.videoDuration) return
    const { offset, confidence } = alignAudio(
      musicWaveform, s.videoWaveform, s.duration, s.videoDuration
    )
    const finalOffset = confidence >= 0.7 ? offset : 0
    if (confidence < 0.7) toast.warning(t(lang, 'videoAlignPoor'))
    setVideoOffsetSeconds(finalOffset)
    const tc = getTimecodeAtTime(s.timecodeLookup, finalOffset)
    setVideoStartTimecode(tc ? formatTimecode(tc) : null)
  }

  const handlePlay = (): void => {
    setPlayState('playing')
    engine.current?.play().then(() => {
      const tc = useStore.getState().timecode
      if (tc) mtc.current?.sendFullFrame(tc)
    }).catch(() => {
      setPlayState('paused')
    })
  }

  const handlePause = (): void => {
    engine.current?.pause()
    setPlayState('paused')
  }

  const handleStop = (): void => {
    engine.current?.pause()
    engine.current?.seek(0)
    setPlayState('stopped')
    setTimecode(null)
  }

  const handleSeek = async (time: number): Promise<void> => {
    const wasPlaying = await engine.current?.seek(time)
    if (wasPlaying) setPlayState('playing')
    const tc = useStore.getState().timecode
    if (tc) mtc.current?.sendFullFrame(tc)
  }

  // ── Cue-sheet export ──────────────────────────────────────
  const handleDownloadCueSheet = async (): Promise<void> => {
    const s = useStore.getState()
    if (s.setlist.length === 0) {
      toast.info(t(lang, 'cueSheetEmpty'))
      return
    }

    const globalStartTC = s.generatorStartTC || '01:00:00:00'
    const globalFps = s.generatorFps || 25

    // Parse a TC string (HH:MM:SS:FF) into total seconds
    const tcToSeconds = (tc: string, fps: number): number => {
      const p = tc.split(':').map(Number)
      return (p[0] || 0) * 3600 + (p[1] || 0) * 60 + (p[2] || 0) + (p[3] || 0) / fps
    }

    // Convert total seconds into TC string
    const secondsToTC = (totalSec: number, fps: number): string => {
      const h = Math.floor(totalSec / 3600)
      const m = Math.floor((totalSec % 3600) / 60)
      const sec = Math.floor(totalSec % 60)
      const fr = Math.floor((totalSec % 1) * fps)
      return [
        String(h).padStart(2, '0'),
        String(m).padStart(2, '0'),
        String(sec).padStart(2, '0'),
        String(fr).padStart(2, '0')
      ].join(':')
    }

    // Format duration to mm.ssm (minutes.seconds+deciseconds) like the reference image
    const formatDuration = (sec: number): string => {
      const mins = Math.floor(sec / 60)
      const remainder = sec % 60
      return `${String(mins).padStart(2, '0')}.${remainder.toFixed(0).padStart(2, '0')}m`
    }

    // Read durations for all tracks
    const ctx = new AudioContext()
    const durations: number[] = []
    for (const item of s.setlist) {
      try {
        const buf = await window.api.readAudioFile(item.path)
        const decoded = await ctx.decodeAudioData(buf)
        durations.push(decoded.duration)
      } catch {
        durations.push(0)
      }
    }
    ctx.close()

    // Build rows
    const rows: string[][] = []
    for (let i = 0; i < s.setlist.length; i++) {
      const item = s.setlist[i]
      const trackStartTC = item.startTC || globalStartTC
      const startSec = tcToSeconds(trackStartTC, globalFps)
      const dur = durations[i]
      const endSec = startSec + dur
      const endTC = secondsToTC(endSec, globalFps)
      const durationStr = formatDuration(dur)

      // Resolve next track name and start TC
      let nextTrackName = ''
      let nextTrackLTC = ''
      if (item.nextTrackId && item.nextTrackId !== 'stop') {
        if (item.nextTrackId === 'next') {
          if (i + 1 < s.setlist.length) {
            const nt = s.setlist[i + 1]
            nextTrackName = `${String(i + 2).padStart(2, '0')} ${nt.name}`
            nextTrackLTC = nt.startTC || globalStartTC
          }
        } else {
          const idx = s.setlist.findIndex(t => t.id === item.nextTrackId)
          if (idx !== -1) {
            const nt = s.setlist[idx]
            nextTrackName = `${String(idx + 1).padStart(2, '0')} ${nt.name}`
            nextTrackLTC = nt.startTC || globalStartTC
          }
        }
      } else if (s.autoPlayNext && !item.nextTrackId && i + 1 < s.setlist.length) {
        const nt = s.setlist[i + 1]
        nextTrackName = `${String(i + 2).padStart(2, '0')} ${nt.name}`
        nextTrackLTC = nt.startTC || globalStartTC
      }

      rows.push([
        `${String(i + 1).padStart(2, '0')} ${item.name}`,
        trackStartTC,
        endTC,
        durationStr,
        nextTrackName,
        nextTrackLTC
      ])
    }

    // Build Excel workbook
    const header = ['SETLIST', 'START LTC', 'END LTC', 'TRACK DURATION', 'NEXT TRACK', 'NEXT TRACK LTC']
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows])

    // Column widths
    ws['!cols'] = [
      { wch: 35 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 35 }, { wch: 18 }
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Cue Sheet')
    const xlsxBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer

    const presetName = s.presetName || 'LTCast'
    await window.api.saveFileBuffer(
      `${presetName} - Cue Sheet.xlsx`,
      [{ name: 'Excel Files', extensions: ['xlsx'] }],
      xlsxBuf
    )
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
      className={`app${dragging ? ' app--drag' : ''}`}
      onDragEnter={(e) => { e.preventDefault(); dragCounter.current++; setDragging(true) }}
      onDragOver={(e) => { e.preventDefault() }}
      onDragLeave={() => { dragCounter.current--; if (dragCounter.current <= 0) { dragCounter.current = 0; setDragging(false) } }}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="header">
        <span className="app-title">LTCast{
          (() => {
            const displayName = activeSetlistIndex !== null
              ? (setlist[activeSetlistIndex]?.name ?? fileName)
              : fileName
            return displayName ? ` — ${displayName}` : ''
          })()
        }</span>
        <PresetBar />
        <button className="btn-open" onClick={handleDownloadCueSheet} title={t(lang, 'downloadCueSheet')}>
          {t(lang, 'downloadCueSheet')}
        </button>
        <button className="btn-open" onClick={() => openFile()}>
          {t(lang, 'openFile')}
        </button>
        <button className="btn-open" onClick={openVideo}>
          {t(lang, 'importVideo')}
        </button>
      </div>

      {/* Main content */}
      <div className="main-content">
        {/* Left: Setlist sidebar */}
        <div className="setlist-sidebar" style={{ width: leftPanelWidth }}>
          <div className="setlist-sidebar-title">{t(lang, 'setlist')}</div>
          <SetlistPanel
            onLoadFile={(path, offsetFrames) => {
              const s = useStore.getState()
              const idx = s.setlist.findIndex(item => item.path === path)
              const item = idx !== -1 ? s.setlist[idx] : null
              if (item && isGeneratorItem(item)) {
                // Generator item — activate generator mode directly, no audio file load
                s.setActiveSetlistIndex(idx)
                // Apply this generator's startTC if set
                const tc = item.startTC ?? s.generatorStartTC
                engine.current?.setGeneratorStartTC(tc, s.generatorFps)
                engine.current?.setGeneratorMode(true)
                return
              }
              openFile(path, offsetFrames)
            }}
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

        </div>

        {/* Resizer Left */}
        <div
          className={`panel-resizer ${resizingPanel === 'left' ? 'panel-resizer--active' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); setResizingPanel('left') }}
        />

        {/* Center: TC + waveform */}
        <div className="center-panel">
          <TimecodeDisplay />

          {filePath ? (
            <div className="file-info">{
              activeSetlistIndex !== null
                ? (setlist[activeSetlistIndex]?.name ?? fileName)
                : fileName
            }</div>
          ) : (
            <div className="drop-zone" onClick={() => openFile()}>
              <div className="drop-icon">🎵</div>
              <div>{t(lang, 'dropFile')}</div>
              <div className="drop-formats">{t(lang, 'supportedFormats')}</div>
            </div>
          )}

          <Waveform
            musicData={musicWaveform}
            ltcData={ltcWaveform}
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
          />
        </div>

        {/* Resizer Right */}
        <div
          className={`panel-resizer ${resizingPanel === 'right' ? 'panel-resizer--active' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); setResizingPanel('right') }}
        />

        {/* Right: Device panel */}
        <div className="right-panel" style={{ width: rightPanelWidth }}>
          <DevicePanel
            onMidiPortChange={selectMidiPort}
            onMusicDeviceChange={(id) => engine.current?.setMusicOutputDevice(id).catch(() => {})}
            onLtcDeviceChange={(id) => engine.current?.setLtcOutputDevice(id).catch(() => {})}
            onLtcGainChange={(gain) => engine.current?.setLtcGain(gain)}
            onMtcModeChange={(mode) => mtc.current?.setMode(mode)}
            onLtcChannelChange={(ch) => { if (ch !== 'auto') engine.current?.setLtcChannel(ch) }}
          />

        </div>
      </div>

      <StatusBar
        version={version}
        onToggleFullscreen={() => setFullscreenTc(true)}
      />
    </div>
  )
}
