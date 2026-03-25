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
import { useStore, TimecodeFrame } from './store'
import { alignAudio } from './audio/AudioAligner'
import { getTimecodeAtTime, formatTimecode } from './audio/LtcDecoder'
import { t } from './i18n'
import { toast } from './components/Toast'
import { LTC_CONFIDENCE_THRESHOLD } from './constants'

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
  const [sidebarWidth, setSidebarWidth]   = useState(200)
  const isResizingSidebar = useRef(false)

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
    setSelectedMidiPort
  } = useStore()

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

  // Init engine + MIDI once
  useEffect(() => {
    engine.current = new AudioEngine({
      onTimecode: handleTimecode,
      onTimeUpdate: (t) => {
        setCurrentTime(t)
      },
      onEnded: () => setPlayState('stopped'),
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

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // Don't intercept shortcuts when typing in input fields
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      // Space: play/pause
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

      // Escape: stop
      if (e.code === 'Escape') {
        e.preventDefault()
        if (fullscreenTc) {
          setFullscreenTc(false)
        } else {
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
  }, [fullscreenTc])

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
    if (!engine.current || !useStore.getState().duration) {
      toast.warning(t(lang, 'noFile'))
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
        <span className="app-title">LTCast{fileName ? ` — ${fileName}` : ''}</span>
        <PresetBar />
        <button className="btn-open" onClick={() => openFile()}>
          {t(lang, 'openFile')}
        </button>
        <button className="btn-open" onClick={openVideo} disabled={!filePath}>
          {t(lang, 'importVideo')}
        </button>
      </div>

      {/* Main content */}
      <div className="main-content">
        {/* Left: Setlist sidebar */}
        <div className="setlist-sidebar" style={{ width: sidebarWidth }}>
          <div className="setlist-sidebar-title">{t(lang, 'setlist')}</div>
          <SetlistPanel
            onLoadFile={(path, offsetFrames) => openFile(path, offsetFrames)}
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
          <TimecodeDisplay />

          {filePath ? (
            <div className="file-info">{fileName}</div>
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

        {/* Right: Device panel */}
        <div className="right-panel">
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
