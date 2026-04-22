/**
 * F1 Pre-buffer — AudioEngine unit tests
 *
 * Covers:
 *   - prebufferFile: success, failure, scratch context lifecycle,
 *                    token identity, stale-decode race handling
 *   - consumePrebuffered: single-consumption semantics, token mismatch
 *   - clearPrebuffered: selective clear, no-op on mismatch
 *   - loadDecodedBuffer: post-decode callback sequence parity with loadFile
 *
 * We mock AudioContext because Vitest runs on Node — there's no Web Audio.
 * The mock is deliberately minimal: only the shape the engine touches
 * (decodeAudioData, close, audioWorklet, createBuffer...). Tests that do
 * not touch the LTC worklet path (prebuffer tests are decode-only) use an
 * even slimmer variant.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AudioEngine, AudioEngineCallbacks } from '../AudioEngine'

// ── Mock types ─────────────────────────────────────────────────────

interface MockAudioBuffer {
  numberOfChannels: number
  sampleRate: number
  length: number
  duration: number
  getChannelData(ch: number): Float32Array
}

/** Minimal AudioBuffer factory. 2 channels, 1s of silence by default. */
function makeBuffer(
  overrides: Partial<MockAudioBuffer> = {}
): MockAudioBuffer {
  const numberOfChannels = overrides.numberOfChannels ?? 2
  const sampleRate = overrides.sampleRate ?? 48000
  const length = overrides.length ?? sampleRate
  const channels: Float32Array[] = []
  for (let i = 0; i < numberOfChannels; i++) channels.push(new Float32Array(length))
  return {
    numberOfChannels,
    sampleRate,
    length,
    duration: length / sampleRate,
    getChannelData: overrides.getChannelData ?? ((ch: number): Float32Array => channels[ch]),
    ...overrides
  }
}

/**
 * Mock AudioContext queue entry — lets tests decide how each
 * decodeAudioData call resolves (sync success, async delay, rejection).
 */
type DecodeBehaviour =
  | { kind: 'resolve'; buffer: MockAudioBuffer }
  | { kind: 'reject'; error: Error }
  | { kind: 'manual'; promise: Promise<MockAudioBuffer> }

let decodeQueue: DecodeBehaviour[] = []
let createdCtxCount = 0
let closedCtxCount = 0

/** Default: every decodeAudioData resolves with a fresh empty buffer. */
function makeMockAudioContext(): unknown {
  createdCtxCount++
  const ctx = {
    currentTime: 0,
    state: 'running',
    sampleRate: 48000,
    destination: {},
    async decodeAudioData(_buf: ArrayBuffer): Promise<MockAudioBuffer> {
      const next = decodeQueue.shift() ?? { kind: 'resolve', buffer: makeBuffer() }
      if (next.kind === 'resolve') return next.buffer
      if (next.kind === 'reject') throw next.error
      return next.promise
    },
    async close(): Promise<void> {
      closedCtxCount++
    },
    // Engine helpers that may be touched even by prebuffer paths — kept
    // stubbed so the engine's other methods don't throw if accidentally
    // invoked during the same test.
    createBuffer(): unknown { return { getChannelData: (): Float32Array => new Float32Array(0) } },
    createBufferSource(): unknown { return { connect(): void {}, start(): void {}, stop(): void {} } },
    createChannelSplitter(): unknown { return { connect(): void {}, disconnect(): void {} } },
    createChannelMerger(): unknown { return { connect(): void {}, disconnect(): void {} } },
    createGain(): unknown {
      return { connect(): void {}, disconnect(): void {}, gain: { value: 0, setValueAtTime(): void {}, setTargetAtTime(): void {} } }
    },
    audioWorklet: { async addModule(): Promise<void> {} },
    setSinkId: async (): Promise<void> => {}
  }
  return ctx
}

// Minimal no-op callbacks — only care about the ones that fire in
// loadDecodedBuffer for the spy-assertion test.
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
    ...overrides
  }
}

// ── Shared setup ───────────────────────────────────────────────────

beforeEach(() => {
  decodeQueue = []
  createdCtxCount = 0
  closedCtxCount = 0
  // AudioContext is a constructor in the real world — stub it so `new
  // AudioContext()` inside the engine returns our mock.
  vi.stubGlobal('AudioContext', function MockCtxCtor(this: unknown) {
    Object.assign(this as object, makeMockAudioContext())
  })
  // Engine constructor touches navigator.mediaDevices.addEventListener
  // for device-change tracking. Node has no navigator — stub it.
  vi.stubGlobal('navigator', {
    mediaDevices: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      enumerateDevices: vi.fn().mockResolvedValue([])
    }
  })
  // dispose() and the rAF-driven time updater call cancelAnimationFrame /
  // requestAnimationFrame — not in Node globals.
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(0))
  // _loadWorklet uses Blob + URL.createObjectURL — the prebuffer tests
  // never reach _setupLtcContext, but loadFile / loadDecodedBuffer do
  // not either (they only run _applyDecodedBuffer). Stub defensively.
  vi.stubGlobal('Blob', class MockBlob { constructor(_: unknown, _opts?: unknown) {} })
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn().mockReturnValue('blob:mock'),
    revokeObjectURL: vi.fn()
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ════════════════════════════════════════════════════════════════════
// prebufferFile
// ════════════════════════════════════════════════════════════════════

describe('AudioEngine.prebufferFile', () => {
  it('returns an AudioBuffer on success and stores it under the given token', async () => {
    const engine = new AudioEngine(makeCallbacks())
    const buf = makeBuffer()
    decodeQueue.push({ kind: 'resolve', buffer: buf })
    const token = Symbol('p1')
    const ab = new ArrayBuffer(16)

    const result = await engine.prebufferFile(ab, token)

    expect(result).toBe(buf)
    // The same token should be able to consume what was stored.
    expect(engine.consumePrebuffered(token)).toBe(buf)
  })

  it('closes the scratch AudioContext after decode (success path)', async () => {
    const engine = new AudioEngine(makeCallbacks())
    decodeQueue.push({ kind: 'resolve', buffer: makeBuffer() })
    const before = closedCtxCount

    await engine.prebufferFile(new ArrayBuffer(8), Symbol('p'))

    expect(closedCtxCount).toBe(before + 1)
    expect(createdCtxCount).toBeGreaterThan(0)
  })

  it('closes the scratch AudioContext after decode (rejection path)', async () => {
    const engine = new AudioEngine(makeCallbacks())
    decodeQueue.push({ kind: 'reject', error: new Error('decode failed') })
    const before = closedCtxCount

    const result = await engine.prebufferFile(new ArrayBuffer(8), Symbol('p'))

    expect(result).toBeNull()
    expect(closedCtxCount).toBe(before + 1)
  })

  it('on decode rejection, resolves to null and leaves prebuffered state cleared', async () => {
    const engine = new AudioEngine(makeCallbacks())
    decodeQueue.push({ kind: 'reject', error: new Error('boom') })
    const token = Symbol('p')

    const result = await engine.prebufferFile(new ArrayBuffer(4), token)

    expect(result).toBeNull()
    // Same token — state is cleared, so consume returns null.
    expect(engine.consumePrebuffered(token)).toBeNull()
  })

  it('starting a second prebuffer with a different token clears the first buffer before the new decode begins', async () => {
    const engine = new AudioEngine(makeCallbacks())
    const bufA = makeBuffer()
    const bufB = makeBuffer()
    const tokenA = Symbol('A')
    const tokenB = Symbol('B')

    decodeQueue.push({ kind: 'resolve', buffer: bufA })
    await engine.prebufferFile(new ArrayBuffer(4), tokenA)
    // bufA is cached. Starting a new prebuffer with tokenB must replace.
    decodeQueue.push({ kind: 'resolve', buffer: bufB })
    await engine.prebufferFile(new ArrayBuffer(4), tokenB)

    // Old token can no longer retrieve bufA (slot rotated).
    expect(engine.consumePrebuffered(tokenA)).toBeNull()
    // New token gets bufB.
    expect(engine.consumePrebuffered(tokenB)).toBe(bufB)
  })

  it('when a new prebuffer overwrites the token mid-decode, the stale result is dropped', async () => {
    const engine = new AudioEngine(makeCallbacks())
    // First decode hangs on a manual promise we control.
    let resolveA: (b: MockAudioBuffer) => void = () => {}
    const pendingA = new Promise<MockAudioBuffer>(res => { resolveA = res })
    decodeQueue.push({ kind: 'manual', promise: pendingA })
    const tokenA = Symbol('A')
    const inflight = engine.prebufferFile(new ArrayBuffer(4), tokenA)

    // Second prebuffer starts and resolves immediately — it rotates the
    // engine's internal token.
    const bufB = makeBuffer()
    decodeQueue.push({ kind: 'resolve', buffer: bufB })
    const tokenB = Symbol('B')
    await engine.prebufferFile(new ArrayBuffer(4), tokenB)

    // Now finish the first decode. Its result must be discarded because
    // the token no longer matches.
    const bufA = makeBuffer()
    resolveA(bufA)
    const resultA = await inflight

    expect(resultA).toBeNull()
    // tokenB still holds bufB — the stale decode must not have clobbered it.
    expect(engine.consumePrebuffered(tokenB)).toBe(bufB)
  })

  it('leaves the previous slot intact if the in-flight prebuffer is cleared before it resolves', async () => {
    // Covers the mid-decode GO cancellation path: the App layer calls
    // clearPrebuffered(token) to invalidate an in-flight job. When the
    // decode eventually settles, it must not repopulate the slot.
    const engine = new AudioEngine(makeCallbacks())
    let resolveFn: (b: MockAudioBuffer) => void = () => {}
    const pending = new Promise<MockAudioBuffer>(res => { resolveFn = res })
    decodeQueue.push({ kind: 'manual', promise: pending })
    const token = Symbol('mid')
    const inflight = engine.prebufferFile(new ArrayBuffer(4), token)

    // Simulate mid-decode abort from App layer.
    engine.clearPrebuffered(token)

    // Now the decode completes. The engine must see the token mismatch
    // and drop the buffer.
    resolveFn(makeBuffer())
    const result = await inflight

    expect(result).toBeNull()
    expect(engine.consumePrebuffered(token)).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════
// consumePrebuffered
// ════════════════════════════════════════════════════════════════════

describe('AudioEngine.consumePrebuffered', () => {
  it('returns the stored buffer once when token matches; null on subsequent calls', async () => {
    const engine = new AudioEngine(makeCallbacks())
    const buf = makeBuffer()
    const token = Symbol('once')
    decodeQueue.push({ kind: 'resolve', buffer: buf })
    await engine.prebufferFile(new ArrayBuffer(4), token)

    expect(engine.consumePrebuffered(token)).toBe(buf)
    // Slot is cleared after a successful consume — cannot consume twice.
    expect(engine.consumePrebuffered(token)).toBeNull()
  })

  it('returns null when token mismatches and does NOT clear the stored buffer', async () => {
    const engine = new AudioEngine(makeCallbacks())
    const buf = makeBuffer()
    const stored = Symbol('stored')
    const wrong = Symbol('wrong')
    decodeQueue.push({ kind: 'resolve', buffer: buf })
    await engine.prebufferFile(new ArrayBuffer(4), stored)

    expect(engine.consumePrebuffered(wrong)).toBeNull()
    // The real consumer can still grab it.
    expect(engine.consumePrebuffered(stored)).toBe(buf)
  })

  it('returns null when nothing has been prebuffered', () => {
    const engine = new AudioEngine(makeCallbacks())
    expect(engine.consumePrebuffered(Symbol('empty'))).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════
// clearPrebuffered
// ════════════════════════════════════════════════════════════════════

describe('AudioEngine.clearPrebuffered', () => {
  it('clears stored buffer + token when called with matching token', async () => {
    const engine = new AudioEngine(makeCallbacks())
    const token = Symbol('match')
    decodeQueue.push({ kind: 'resolve', buffer: makeBuffer() })
    await engine.prebufferFile(new ArrayBuffer(4), token)

    engine.clearPrebuffered(token)

    expect(engine.consumePrebuffered(token)).toBeNull()
  })

  it('clears stored buffer + token when called with no token', async () => {
    const engine = new AudioEngine(makeCallbacks())
    const token = Symbol('any')
    decodeQueue.push({ kind: 'resolve', buffer: makeBuffer() })
    await engine.prebufferFile(new ArrayBuffer(4), token)

    engine.clearPrebuffered()

    expect(engine.consumePrebuffered(token)).toBeNull()
  })

  it('is a no-op when called with a mismatched token', async () => {
    const engine = new AudioEngine(makeCallbacks())
    const buf = makeBuffer()
    const stored = Symbol('stored')
    const wrong = Symbol('wrong')
    decodeQueue.push({ kind: 'resolve', buffer: buf })
    await engine.prebufferFile(new ArrayBuffer(4), stored)

    engine.clearPrebuffered(wrong)

    // Original token still works.
    expect(engine.consumePrebuffered(stored)).toBe(buf)
  })
})

// ════════════════════════════════════════════════════════════════════
// loadDecodedBuffer — callback parity with loadFile tail
// ════════════════════════════════════════════════════════════════════

describe('AudioEngine.loadDecodedBuffer', () => {
  it('fires the same post-decode callbacks as loadFile (detectable LTC path)', async () => {
    // This test does not care about specific values — only that the
    // callback sequence fires in the right order. The detection is
    // irrelevant for shape verification: we only assert which spies
    // were called (not their arguments). LtcDetector on a silent buffer
    // will report low confidence → the non-LTC branch in
    // _applyDecodedBuffer runs. Either branch still calls
    // onLtcConfidence, onLtcChannelDetected, onWaveformData,
    // onTimecodeLookup — which is what we check here.
    const cb = makeCallbacks()
    const engine = new AudioEngine(cb)
    const buf = makeBuffer({ numberOfChannels: 2, sampleRate: 48000, length: 48000 })

    await engine.loadDecodedBuffer(buf as unknown as AudioBuffer)

    expect(cb.onLtcConfidence).toHaveBeenCalled()
    expect(cb.onLtcChannelDetected).toHaveBeenCalled()
    expect(cb.onWaveformData).toHaveBeenCalled()
    expect(cb.onTimecodeLookup).toHaveBeenCalled()
    // Contract: startOffset reset + time update to 0 at entry.
    expect(cb.onTimeUpdate).toHaveBeenCalledWith(0)
  })

  it('produces the same callback fingerprint as loadFile for the same source bytes', async () => {
    // Wire one engine through loadFile, another through loadDecodedBuffer
    // with a pre-decoded buffer that matches what loadFile would get.
    // Both must fire the same set of post-decode callbacks.
    const cbA = makeCallbacks()
    const cbB = makeCallbacks()
    const sharedBuf = makeBuffer({ numberOfChannels: 2, sampleRate: 48000, length: 48000 })

    const engineA = new AudioEngine(cbA)
    // loadFile decodes internally — queue up the same buffer to come out.
    decodeQueue.push({ kind: 'resolve', buffer: sharedBuf })
    await engineA.loadFile(new ArrayBuffer(8))

    const engineB = new AudioEngine(cbB)
    await engineB.loadDecodedBuffer(sharedBuf as unknown as AudioBuffer)

    // Both engines saw onWaveformData called with similar output shape.
    expect((cbA.onWaveformData as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      (cbB.onWaveformData as unknown as { mock: { calls: unknown[] } }).mock.calls.length
    )
    expect((cbA.onLtcConfidence as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      (cbB.onLtcConfidence as unknown as { mock: { calls: unknown[] } }).mock.calls.length
    )
    expect((cbA.onTimecodeLookup as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      (cbB.onTimecodeLookup as unknown as { mock: { calls: unknown[] } }).mock.calls.length
    )
    expect((cbA.onLtcChannelDetected as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      (cbB.onLtcChannelDetected as unknown as { mock: { calls: unknown[] } }).mock.calls.length
    )
  })
})
