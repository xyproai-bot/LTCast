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
