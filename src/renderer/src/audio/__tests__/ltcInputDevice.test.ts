/**
 * LTC Input device — AudioEngine unit tests
 *
 * Covers the error-handling surface of setLtcInputDevice:
 *   - permission-denied (DOMException name = NotAllowedError) → onLtcInputError
 *   - device-missing (NotFoundError / OverconstrainedError)  → onLtcInputError
 *   - generic failure                                         → onLtcInputError
 *   - null deviceId → idempotent teardown, no callback fired
 *
 * We mock getUserMedia + a minimal AudioContext shape because Node has no
 * Web Audio. The engine constructor also touches devicechange listeners on
 * navigator.mediaDevices — stubbed alongside getUserMedia.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AudioEngine, AudioEngineCallbacks } from '../AudioEngine'

// ── Minimal mocks (mirrors prebuffer.test.ts to keep the file shapes
// consistent — we only need enough surface for the engine constructor
// and the setLtcInputDevice happy/sad paths).

function makeMockAudioContext(): unknown {
  return {
    currentTime: 0,
    state: 'running',
    sampleRate: 48000,
    destination: {},
    async decodeAudioData(): Promise<unknown> { return {} },
    async close(): Promise<void> { /* noop */ },
    createBuffer(): unknown { return { getChannelData: (): Float32Array => new Float32Array(0) } },
    createBufferSource(): unknown { return { connect(): void {}, start(): void {}, stop(): void {} } },
    createChannelSplitter(): unknown { return { connect(): void {}, disconnect(): void {} } },
    createChannelMerger(): unknown { return { connect(): void {}, disconnect(): void {} } },
    createGain(): unknown {
      return { connect(): void {}, disconnect(): void {}, gain: { value: 0, setValueAtTime(): void {}, setTargetAtTime(): void {} } }
    },
    createMediaStreamSource(): unknown {
      return { connect(): void {}, disconnect(): void {} }
    },
    audioWorklet: { async addModule(): Promise<void> { /* noop */ } },
    setSinkId: async (): Promise<void> => {},
  }
}

function makeCallbacks(overrides: Partial<AudioEngineCallbacks> = {}): AudioEngineCallbacks {
  return {
    onTimecode: vi.fn(),
    onTimeUpdate: vi.fn(),
    onEnded: vi.fn(),
    onLtcChannelDetected: vi.fn(),
    onLtcSignalStatus: vi.fn(),
    onLtcConfidence: vi.fn(),
    onLtcStartTime: vi.fn(),
    onWaveformData: vi.fn(),
    onTimecodeLookup: vi.fn(),
    onDeviceDisconnected: vi.fn(),
    onDeviceReconnected: vi.fn(),
    onPlayStarted: vi.fn(),
    onLtcError: vi.fn(),
    onLtcInputTimecode: vi.fn(),
    onLtcInputError: vi.fn(),
    ...overrides,
  }
}

/** A DOMException-shaped error — vitest in Node doesn't have DOMException
 *  on globalThis by default, so we construct a plain Error with the right
 *  `name` (the contract is `e.name`, not `instanceof DOMException`). */
function mediaError(name: string): Error {
  const err = new Error(`mock ${name}`)
  err.name = name
  return err
}

let getUserMediaMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.stubGlobal('AudioContext', function MockCtxCtor(this: unknown) {
    Object.assign(this as object, makeMockAudioContext())
  })

  getUserMediaMock = vi.fn()
  vi.stubGlobal('navigator', {
    mediaDevices: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      enumerateDevices: vi.fn().mockResolvedValue([]),
      getUserMedia: getUserMediaMock,
    },
  })

  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(0))
  vi.stubGlobal('Blob', class MockBlob { constructor(_: unknown, _opts?: unknown) {} })
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn().mockReturnValue('blob:mock'),
    revokeObjectURL: vi.fn(),
  })
  // AudioWorkletNode constructor must be present for happy-path tests; we
  // do not exercise it here but the engine references it.
  vi.stubGlobal('AudioWorkletNode', class MockWorkletNode {
    public port = { onmessage: null as ((e: unknown) => void) | null, postMessage(): void {} }
    constructor(_ctx: unknown, _name: string, _opts?: unknown) {}
    connect(): void {}
    disconnect(): void {}
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ════════════════════════════════════════════════════════════════════
// setLtcInputDevice — error paths
// ════════════════════════════════════════════════════════════════════

describe('AudioEngine.setLtcInputDevice', () => {
  it('null deviceId is a no-op teardown (no getUserMedia, no error callback)', async () => {
    const onLtcInputError = vi.fn()
    const engine = new AudioEngine(makeCallbacks({ onLtcInputError }))

    await engine.setLtcInputDevice(null)

    expect(getUserMediaMock).not.toHaveBeenCalled()
    expect(onLtcInputError).not.toHaveBeenCalled()
    expect(engine.getLtcInputDeviceId()).toBeNull()
  })

  it('empty-string deviceId is treated as null (no pipeline created)', async () => {
    const onLtcInputError = vi.fn()
    const engine = new AudioEngine(makeCallbacks({ onLtcInputError }))

    await engine.setLtcInputDevice('')

    expect(getUserMediaMock).not.toHaveBeenCalled()
    expect(onLtcInputError).not.toHaveBeenCalled()
    expect(engine.getLtcInputDeviceId()).toBeNull()
  })

  it('reports permission-denied when getUserMedia rejects with NotAllowedError', async () => {
    const onLtcInputError = vi.fn()
    const engine = new AudioEngine(makeCallbacks({ onLtcInputError }))
    getUserMediaMock.mockRejectedValueOnce(mediaError('NotAllowedError'))

    await engine.setLtcInputDevice('input-1')

    expect(onLtcInputError).toHaveBeenCalledWith('permission-denied')
    // On error, engine clears its internal device id so future "select
    // same device" attempts still re-prompt.
    expect(engine.getLtcInputDeviceId()).toBeNull()
  })

  it('reports device-missing when getUserMedia rejects with NotFoundError', async () => {
    const onLtcInputError = vi.fn()
    const engine = new AudioEngine(makeCallbacks({ onLtcInputError }))
    getUserMediaMock.mockRejectedValueOnce(mediaError('NotFoundError'))

    await engine.setLtcInputDevice('missing-device')

    expect(onLtcInputError).toHaveBeenCalledWith('device-missing')
    expect(engine.getLtcInputDeviceId()).toBeNull()
  })

  it('reports device-missing when getUserMedia rejects with OverconstrainedError', async () => {
    const onLtcInputError = vi.fn()
    const engine = new AudioEngine(makeCallbacks({ onLtcInputError }))
    getUserMediaMock.mockRejectedValueOnce(mediaError('OverconstrainedError'))

    await engine.setLtcInputDevice('mismatched-device')

    expect(onLtcInputError).toHaveBeenCalledWith('device-missing')
  })

  it('reports unknown when getUserMedia rejects with an unrecognised error', async () => {
    const onLtcInputError = vi.fn()
    const engine = new AudioEngine(makeCallbacks({ onLtcInputError }))
    getUserMediaMock.mockRejectedValueOnce(mediaError('TotallyMadeUpError'))

    await engine.setLtcInputDevice('weird-device')

    expect(onLtcInputError).toHaveBeenCalledWith('unknown')
  })

  it('calls getUserMedia with deviceId.exact + LTC-friendly constraints (no AEC/NS/AGC)', async () => {
    const engine = new AudioEngine(makeCallbacks())
    // Reject immediately so we don't have to fully simulate the pipeline —
    // we only care about the constraints argument.
    getUserMediaMock.mockRejectedValueOnce(mediaError('NotAllowedError'))

    await engine.setLtcInputDevice('cable-1')

    expect(getUserMediaMock).toHaveBeenCalledTimes(1)
    const args = getUserMediaMock.mock.calls[0]?.[0] as MediaStreamConstraints | undefined
    expect(args).toBeDefined()
    expect(args?.video).toBe(false)
    // LTC carries broadband square-wave signal — every Chromium DSP step
    // is *destructive*. Verify they're all off.
    expect(args?.audio).toMatchObject({
      deviceId: { exact: 'cable-1' },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    })
  })
})

// ════════════════════════════════════════════════════════════════════
// setLtcInputDevice — auto-detect channel
//
// In 'auto' mode the engine should spawn parallel worklets (one per
// candidate channel) and the first worklet to emit a TC frame wins.
// We capture the worklet instances created during pipeline setup, then
// simulate worklet `port.onmessage` events from the channel under test
// to verify the lock-in behaviour.
// ════════════════════════════════════════════════════════════════════

describe('AudioEngine.setLtcInputDevice — auto-detect channel', () => {
  // Captured worklets across the most recent setLtcInputDevice call. The
  // mock AudioWorkletNode constructor pushes to this array so tests can
  // grab the parallel-mode instances by index.
  let createdWorklets: Array<{ port: { onmessage: ((e: { data: unknown }) => void) | null } }>

  beforeEach(() => {
    createdWorklets = []
    // Override the AudioWorkletNode mock from the outer beforeEach so we
    // can capture instances (the outer one is fine for error-path tests
    // that never construct one but isn't observable enough for these).
    vi.stubGlobal('AudioWorkletNode', class MockCaptureWorkletNode {
      public port: { onmessage: ((e: { data: unknown }) => void) | null; postMessage(): void } = {
        onmessage: null,
        postMessage(): void { /* noop */ },
      }
      constructor(_ctx: unknown, _name: string, _opts?: unknown) {
        createdWorklets.push(this)
      }
      connect(): void { /* noop */ }
      disconnect(): void { /* noop */ }
    })

    // getUserMedia must succeed so the pipeline gets built. Return a stream
    // with a single (irrelevant) audio track that exposes the .onended hook.
    getUserMediaMock.mockResolvedValue({
      getTracks: () => [{ stop(): void {}, set onended(_h: (() => void) | null) {} }],
      getAudioTracks: () => [{ stop(): void {}, set onended(_h: (() => void) | null) {} }],
    } as unknown as MediaStream)
  })

  /** Build a fake worklet port message that matches the shape produced by
   *  ltcProcessor.js (HH:MM:SS:FF + fps + dropFrame). */
  function mkFrame(h: number, m: number, s: number, f: number): { data: unknown } {
    return { data: { hours: h, minutes: m, seconds: s, frames: f, fps: 25, dropFrame: false } }
  }

  it('spawns two parallel worklets when channel === "auto"', async () => {
    const engine = new AudioEngine(makeCallbacks())
    await engine.setLtcInputDevice('cable-1', 'auto')
    // One worklet per scanned channel (CH 0 + CH 1).
    expect(createdWorklets.length).toBe(2)
    expect(engine.getLtcAutoDetectedChannel()).toBeNull()
  })

  it('spawns exactly one worklet when channel is explicit (CH 1)', async () => {
    const engine = new AudioEngine(makeCallbacks())
    await engine.setLtcInputDevice('cable-1', 1)
    expect(createdWorklets.length).toBe(1)
  })

  it('locks onto the first channel to emit a frame, drops later frames from the other', async () => {
    const onLtcInputTimecode = vi.fn()
    const onLtcInputChannelDetected = vi.fn()
    const engine = new AudioEngine(makeCallbacks({ onLtcInputTimecode, onLtcInputChannelDetected }))
    await engine.setLtcInputDevice('cable-1', 'auto')

    // Worklet 0 listens to CH 0, worklet 1 to CH 1 (per ltcAutoScanChannels = [0, 1]).
    const [worklet0, worklet1] = createdWorklets
    expect(worklet0).toBeDefined()
    expect(worklet1).toBeDefined()

    // CH 1 emits first — it wins the race.
    worklet1.port.onmessage?.(mkFrame(1, 0, 0, 5))
    expect(engine.getLtcAutoDetectedChannel()).toBe(1)
    expect(onLtcInputChannelDetected).toHaveBeenCalledWith(1)
    expect(onLtcInputChannelDetected).toHaveBeenCalledTimes(1)
    expect(onLtcInputTimecode).toHaveBeenCalledTimes(1)

    // CH 0 fires later — must be dropped, count stays at 1.
    worklet0.port.onmessage?.(mkFrame(1, 0, 0, 10))
    expect(onLtcInputTimecode).toHaveBeenCalledTimes(1)
    expect(engine.getLtcAutoDetectedChannel()).toBe(1)

    // CH 1 keeps emitting — counts add up because it's the locked channel.
    worklet1.port.onmessage?.(mkFrame(1, 0, 0, 6))
    worklet1.port.onmessage?.(mkFrame(1, 0, 0, 7))
    expect(onLtcInputTimecode).toHaveBeenCalledTimes(3)
    // onLtcInputChannelDetected is fire-once per detection — still 1.
    expect(onLtcInputChannelDetected).toHaveBeenCalledTimes(1)
  })

  it('CH 0 winning the race produces detected channel = 0', async () => {
    const onLtcInputChannelDetected = vi.fn()
    const engine = new AudioEngine(makeCallbacks({ onLtcInputChannelDetected }))
    await engine.setLtcInputDevice('cable-1', 'auto')

    const [worklet0, worklet1] = createdWorklets
    worklet0.port.onmessage?.(mkFrame(0, 0, 1, 0))
    expect(engine.getLtcAutoDetectedChannel()).toBe(0)
    expect(onLtcInputChannelDetected).toHaveBeenCalledWith(0)
    // CH 1 trying later is dropped.
    worklet1.port.onmessage?.(mkFrame(0, 0, 2, 0))
    expect(onLtcInputChannelDetected).toHaveBeenCalledTimes(1)
  })

  it('switching from auto to explicit tears down auto worklets and resets detected channel', async () => {
    const engine = new AudioEngine(makeCallbacks())
    await engine.setLtcInputDevice('cable-1', 'auto')
    expect(createdWorklets.length).toBe(2)

    // Lock onto a channel via a fake frame.
    createdWorklets[1].port.onmessage?.({ data: { hours: 1, minutes: 0, seconds: 0, frames: 0, fps: 25, dropFrame: false } })
    expect(engine.getLtcAutoDetectedChannel()).toBe(1)

    // Reset the captured list and pick CH 0 explicitly. Single worklet now.
    createdWorklets = []
    await engine.setLtcInputDevice('cable-1', 0)
    expect(createdWorklets.length).toBe(1)
    expect(engine.getLtcAutoDetectedChannel()).toBeNull()
  })

  it('frames with invalid fps are silently dropped (no detection)', async () => {
    const onLtcInputChannelDetected = vi.fn()
    const onLtcInputTimecode = vi.fn()
    const engine = new AudioEngine(makeCallbacks({ onLtcInputChannelDetected, onLtcInputTimecode }))
    await engine.setLtcInputDevice('cable-1', 'auto')

    const [worklet0] = createdWorklets
    worklet0.port.onmessage?.({ data: { hours: 0, minutes: 0, seconds: 0, frames: 0, fps: 0, dropFrame: false } })
    worklet0.port.onmessage?.({ data: { hours: 0, minutes: 0, seconds: 0, frames: 0, fps: NaN, dropFrame: false } })
    expect(onLtcInputChannelDetected).not.toHaveBeenCalled()
    expect(onLtcInputTimecode).not.toHaveBeenCalled()
    expect(engine.getLtcAutoDetectedChannel()).toBeNull()
  })
})
