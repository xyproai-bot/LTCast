import { describe, it, expect } from 'vitest'
import { formatNextRow, computeStatusPills } from '../utils/stageDisplay'

// ── formatNextRow ─────────────────────────────────────────────────────────────

describe('formatNextRow', () => {
  const setlist = [
    { name: 'Song A' },
    { name: 'Song B' },
    { name: 'Song C' }
  ]

  it('returns null when activeIdx is null', () => {
    expect(formatNextRow(setlist, null, 0, false, 2, 'en')).toBeNull()
  })

  it('returns end-of-show text for the last song', () => {
    const result = formatNextRow(setlist, 2, 30, false, 2, 'en')
    expect(result).toContain('End of show')
  })

  it('returns next song name (no autoAdvance)', () => {
    const result = formatNextRow(setlist, 0, 30, false, 2, 'en')
    expect(result).toContain('Song B')
  })

  it('returns countdown when autoAdvance is on and remaining > 0', () => {
    // remaining=58s, gap=2 → totalWait=60s → 1:00
    const result = formatNextRow(setlist, 0, 58, true, 2, 'en')
    expect(result).toContain('Song B')
    expect(result).toContain('1:00')
  })

  it('formats sub-minute wait as Xs', () => {
    // remaining=10s, gap=2 → totalWait=12s → 12s
    const result = formatNextRow(setlist, 0, 10, true, 2, 'en')
    expect(result).toContain('12s')
  })

  it('uses nextSongNext when autoAdvance but remaining is 0', () => {
    const result = formatNextRow(setlist, 0, 0, true, 2, 'en')
    // remaining=0, totalWait=max(0, 0+2)=2 > 0 but remaining itself is 0
    // branch: autoAdvance && remaining > 0 is false when remaining===0
    expect(result).toContain('Song B')
    // should NOT contain countdown format (remaining > 0 is false)
    expect(result).not.toContain('s')
  })

  it('returns zh locale end-of-show text', () => {
    const result = formatNextRow(setlist, 2, 0, false, 2, 'zh')
    expect(result).toContain('演出結束')
  })

  it('returns ja locale end-of-show text', () => {
    const result = formatNextRow(setlist, 2, 0, false, 2, 'ja')
    expect(result).toContain('ショー終了')
  })

  it('works with a single-item setlist (last song immediately)', () => {
    const single = [{ name: 'Only Song' }]
    const result = formatNextRow(single, 0, 30, false, 2, 'en')
    expect(result).toContain('End of show')
  })
})

// ── computeStatusPills ────────────────────────────────────────────────────────

describe('computeStatusPills', () => {
  const baseState = {
    tcGeneratorMode: false,
    playState: 'stopped',
    ltcSignalOk: true,
    ltcConfidence: 1,
    selectedCueMidiPort: null,
    midiOutputs: [],
    setlist: [],
    oscEnabled: false,
    oscTargetIp: '',
    oscFeedbackDevices: {},
    midiClockEnabled: false,
    tappedBpm: null,
    detectedBpm: null,
    midiClockManualBpm: 120,
    midiClockSource: 'manual',
    lang: 'en' as const
  }

  it('returns empty array with healthy default state', () => {
    expect(computeStatusPills(baseState)).toHaveLength(0)
  })

  it('adds LTC error pill when playing with signal lost (reader mode)', () => {
    const pills = computeStatusPills({
      ...baseState,
      playState: 'playing',
      ltcSignalOk: false
    })
    const ltcPill = pills.find(p => p.id === 'ltc')
    expect(ltcPill).toBeDefined()
    expect(ltcPill?.level).toBe('error')
  })

  it('does NOT add LTC pill in generator mode even when signal is lost', () => {
    const pills = computeStatusPills({
      ...baseState,
      tcGeneratorMode: true,
      playState: 'playing',
      ltcSignalOk: false
    })
    expect(pills.find(p => p.id === 'ltc')).toBeUndefined()
  })

  it('does NOT add LTC pill when stopped even if signal is lost', () => {
    const pills = computeStatusPills({
      ...baseState,
      playState: 'stopped',
      ltcSignalOk: false
    })
    expect(pills.find(p => p.id === 'ltc')).toBeUndefined()
  })

  it('adds MIDI cue warn pill when setlist has cues but no port', () => {
    const pills = computeStatusPills({
      ...baseState,
      setlist: [{ midiCues: [{ id: 'c1' }] }],
      selectedCueMidiPort: null
    })
    expect(pills.find(p => p.id === 'midi-cue')).toBeDefined()
    expect(pills.find(p => p.id === 'midi-cue')?.level).toBe('warn')
  })

  it('does NOT add MIDI cue pill when cue port is connected', () => {
    const pills = computeStatusPills({
      ...baseState,
      setlist: [{ midiCues: [{ id: 'c1' }] }],
      selectedCueMidiPort: 'port1',
      midiOutputs: [{ id: 'port1' }]
    })
    expect(pills.find(p => p.id === 'midi-cue')).toBeUndefined()
  })

  it('does NOT add MIDI cue pill when no cues in setlist', () => {
    const pills = computeStatusPills({
      ...baseState,
      setlist: [{ midiCues: [] }],
      selectedCueMidiPort: null
    })
    expect(pills.find(p => p.id === 'midi-cue')).toBeUndefined()
  })

  it('adds OSC warn pill when OSC is enabled but IP is invalid', () => {
    const pills = computeStatusPills({
      ...baseState,
      oscEnabled: true,
      oscTargetIp: 'not-an-ip',
      oscFeedbackDevices: {}
    })
    expect(pills.find(p => p.id === 'osc')).toBeDefined()
    expect(pills.find(p => p.id === 'osc')?.level).toBe('warn')
  })

  it('adds OSC warn pill when OSC enabled, valid IP, but no recent feedback', () => {
    const staleTs = Date.now() - 90000 // 90s ago, beyond 60s threshold
    const pills = computeStatusPills({
      ...baseState,
      oscEnabled: true,
      oscTargetIp: '192.168.1.100',
      oscFeedbackDevices: { dev1: { lastSeenAt: staleTs } }
    })
    expect(pills.find(p => p.id === 'osc')).toBeDefined()
  })

  it('does NOT add OSC pill when recent feedback exists', () => {
    const recentTs = Date.now() - 5000 // 5s ago, within 60s threshold
    const pills = computeStatusPills({
      ...baseState,
      oscEnabled: true,
      oscTargetIp: '192.168.1.100',
      oscFeedbackDevices: { dev1: { lastSeenAt: recentTs } }
    })
    expect(pills.find(p => p.id === 'osc')).toBeUndefined()
  })

  it('does NOT add OSC pill when OSC is disabled', () => {
    const pills = computeStatusPills({
      ...baseState,
      oscEnabled: false,
      oscTargetIp: 'not-an-ip'
    })
    expect(pills.find(p => p.id === 'osc')).toBeUndefined()
  })

  it('can return multiple pills simultaneously', () => {
    const staleTs = Date.now() - 90000
    const pills = computeStatusPills({
      ...baseState,
      playState: 'playing',
      ltcSignalOk: false,
      setlist: [{ midiCues: [{ id: 'c1' }] }],
      selectedCueMidiPort: null,
      oscEnabled: true,
      oscTargetIp: '192.168.1.1',
      oscFeedbackDevices: { dev1: { lastSeenAt: staleTs } }
    })
    expect(pills.length).toBe(3)
  })
})
