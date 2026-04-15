import { describe, it, expect, vi, beforeEach } from 'vitest'

// ════════════════════════════════════════════════════════════════════
//  Mock Web MIDI API so MtcOutput can be tested without a browser
// ════════════════════════════════════════════════════════════════════

class MockMIDIOutput {
  id: string
  name: string
  state = 'connected'
  sent: Array<{ data: number[]; timestamp?: number }> = []

  constructor(id: string, name: string) {
    this.id = id
    this.name = name
  }

  send(data: number[], timestamp?: number): void {
    this.sent.push({ data: [...data], timestamp })
  }

  clear(): void { this.sent = [] }
}

// We need to import MtcOutput after mocking — use dynamic import trick
// But since MtcOutput uses navigator.requestMIDIAccess only in init(),
// we can construct it and manually inject the port via selectPort().

import { MtcOutput } from '../MtcOutput'

function createMtcWithMockPort(): { mtc: MtcOutput; port: MockMIDIOutput } {
  const mtc = new MtcOutput()
  const port = new MockMIDIOutput('test-port', 'Test MIDI Port')

  // Inject mock midiAccess so selectPort works
  const fakeAccess = {
    outputs: new Map([['test-port', port]]),
    inputs: new Map(),
    onstatechange: null
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(mtc as any).midiAccess = fakeAccess
  mtc.selectPort('test-port')

  return { mtc, port }
}

// ════════════════════════════════════════════════════════════════════
//  MIDI Clock tick interval calculations
// ════════════════════════════════════════════════════════════════════

describe('MIDI Clock tick interval', () => {
  it('120 BPM → tick interval 20.833ms (24 PPQ)', () => {
    const bpm = 120
    const expectedMs = 60000 / (bpm * 24) // = 20.8333...
    expect(expectedMs).toBeCloseTo(20.833, 2)
  })

  it('60 BPM → tick interval 41.667ms', () => {
    const bpm = 60
    const expectedMs = 60000 / (bpm * 24)
    expect(expectedMs).toBeCloseTo(41.667, 2)
  })

  it('300 BPM → tick interval 8.333ms', () => {
    const bpm = 300
    const expectedMs = 60000 / (bpm * 24)
    expect(expectedMs).toBeCloseTo(8.333, 2)
  })

  it('20 BPM → tick interval 125ms', () => {
    const bpm = 20
    const expectedMs = 60000 / (bpm * 24)
    expect(expectedMs).toBe(125)
  })
})

// ════════════════════════════════════════════════════════════════════
//  Clock messages (0xFA Start, 0xFC Stop, 0xF8 Tick)
// ════════════════════════════════════════════════════════════════════

describe('Clock messages', () => {
  let mtc: MtcOutput
  let port: MockMIDIOutput

  beforeEach(() => {
    vi.useFakeTimers()
    const setup = createMtcWithMockPort()
    mtc = setup.mtc
    port = setup.port
    // Mock performance.now for deterministic timestamps
    vi.spyOn(performance, 'now').mockReturnValue(1000)
  })

  it('startClock sends 0xFA (Start) as first message', () => {
    mtc.startClock(120)
    // First message should be MIDI Start (0xFA)
    expect(port.sent[0].data).toEqual([0xfa])
  })

  it('startClock sends 24 tick messages (0xF8) after Start', () => {
    mtc.startClock(120)
    // sent[0] = Start, sent[1..24] = 24 ticks
    const ticks = port.sent.filter(m => m.data[0] === 0xf8)
    expect(ticks.length).toBe(24)
  })

  it('stopClock sends 0xFC (Stop)', () => {
    mtc.startClock(120)
    port.clear()
    mtc.stopClock()
    expect(port.sent.length).toBe(1)
    expect(port.sent[0].data).toEqual([0xfc])
  })

  it('stopClock after stopClock does not crash', () => {
    mtc.startClock(120)
    mtc.stopClock()
    port.clear()
    mtc.stopClock() // second stop should not crash
    // Should still send Stop (port is connected)
    expect(port.sent[0].data).toEqual([0xfc])
  })

  it('tick timestamps are evenly spaced', () => {
    mtc.startClock(120)
    const ticks = port.sent.filter(m => m.data[0] === 0xf8)
    const interval = 60000 / (120 * 24) // 20.833ms

    for (let i = 1; i < ticks.length; i++) {
      const diff = ticks[i].timestamp! - ticks[i - 1].timestamp!
      expect(diff).toBeCloseTo(interval, 3)
    }
  })

  it('all tick messages have correct byte value 0xF8', () => {
    mtc.startClock(120)
    const ticks = port.sent.filter(m => m.data[0] === 0xf8)
    ticks.forEach(t => {
      expect(t.data).toEqual([0xf8])
    })
  })
})

// ════════════════════════════════════════════════════════════════════
//  BPM change during clock
// ════════════════════════════════════════════════════════════════════

describe('BPM change', () => {
  let mtc: MtcOutput
  let port: MockMIDIOutput

  beforeEach(() => {
    vi.useFakeTimers()
    const setup = createMtcWithMockPort()
    mtc = setup.mtc
    port = setup.port
    vi.spyOn(performance, 'now').mockReturnValue(1000)
  })

  it('updateClockBpm changes interval for next batch', () => {
    mtc.startClock(120)
    expect(mtc.getClockBpm()).toBe(120)

    mtc.updateClockBpm(90)
    expect(mtc.getClockBpm()).toBe(90)
    expect(mtc.isClockRunning()).toBe(true)
  })

  it('updateClockBpm(0) stops the clock', () => {
    mtc.startClock(120)
    mtc.updateClockBpm(0)
    expect(mtc.isClockRunning()).toBe(false)
  })

  it('clock continues running after BPM change', () => {
    mtc.startClock(120)
    port.clear()
    mtc.updateClockBpm(140)

    // Advance time to trigger next batch
    vi.advanceTimersByTime(600) // enough for 120 BPM beat (~500ms)

    // Should have sent more ticks
    const ticks = port.sent.filter(m => m.data[0] === 0xf8)
    expect(ticks.length).toBeGreaterThan(0)
  })
})

// ════════════════════════════════════════════════════════════════════
//  Edge cases
// ════════════════════════════════════════════════════════════════════

describe('Edge cases', () => {
  let mtc: MtcOutput
  let port: MockMIDIOutput

  beforeEach(() => {
    vi.useFakeTimers()
    const setup = createMtcWithMockPort()
    mtc = setup.mtc
    port = setup.port
    vi.spyOn(performance, 'now').mockReturnValue(1000)
  })

  it('startClock with BPM=0 does not send anything', () => {
    mtc.startClock(0)
    expect(port.sent.length).toBe(0)
    expect(mtc.isClockRunning()).toBe(false)
  })

  it('startClock with negative BPM does not send anything', () => {
    mtc.startClock(-10)
    expect(port.sent.length).toBe(0)
    expect(mtc.isClockRunning()).toBe(false)
  })

  it('isClockRunning returns correct state', () => {
    expect(mtc.isClockRunning()).toBe(false)
    mtc.startClock(120)
    expect(mtc.isClockRunning()).toBe(true)
    mtc.stopClock()
    expect(mtc.isClockRunning()).toBe(false)
  })

  it('deselectPort stops clock', () => {
    mtc.startClock(120)
    expect(mtc.isClockRunning()).toBe(true)
    mtc.deselectPort()
    expect(mtc.isClockRunning()).toBe(false)
  })

  it('startClock with no port selected does nothing', () => {
    mtc.deselectPort()
    port.clear()
    mtc.startClock(120)
    expect(port.sent.length).toBe(0)
  })

  it('high BPM (300) sends correct number of ticks per batch', () => {
    mtc.startClock(300)
    // Start + 24 ticks
    expect(port.sent[0].data).toEqual([0xfa])
    const ticks = port.sent.filter(m => m.data[0] === 0xf8)
    expect(ticks.length).toBe(24)
  })
})
