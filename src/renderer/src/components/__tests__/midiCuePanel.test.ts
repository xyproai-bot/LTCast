import { describe, it, expect } from 'vitest'
import { noteNumberToName, normalizeTcInput, isValidTimecode } from '../MidiCuePanel'

describe('noteNumberToName', () => {
  it('maps middle C correctly', () => {
    expect(noteNumberToName(60)).toBe('C4')
  })

  it('handles sharps', () => {
    expect(noteNumberToName(61)).toBe('C#4')
    expect(noteNumberToName(70)).toBe('A#4')
  })

  it('handles octave wraps', () => {
    expect(noteNumberToName(0)).toBe('C-1')
    expect(noteNumberToName(12)).toBe('C0')
    expect(noteNumberToName(24)).toBe('C1')
    expect(noteNumberToName(72)).toBe('C5')
    expect(noteNumberToName(127)).toBe('G9')
  })

  it('returns empty string for out-of-range', () => {
    expect(noteNumberToName(-1)).toBe('')
    expect(noteNumberToName(128)).toBe('')
    expect(noteNumberToName(NaN)).toBe('')
  })

  it('matches expected scale notes', () => {
    expect(noteNumberToName(60)).toBe('C4')
    expect(noteNumberToName(62)).toBe('D4')
    expect(noteNumberToName(64)).toBe('E4')
    expect(noteNumberToName(65)).toBe('F4')
    expect(noteNumberToName(67)).toBe('G4')
    expect(noteNumberToName(69)).toBe('A4')
    expect(noteNumberToName(71)).toBe('B4')
  })
})

describe('normalizeTcInput', () => {
  it('returns empty for empty input', () => {
    expect(normalizeTcInput('')).toBe('')
    expect(normalizeTcInput('   ')).toBe('')
  })

  it('handles full HH:MM:SS:FF form unchanged', () => {
    expect(normalizeTcInput('01:02:03:04')).toBe('01:02:03:04')
    expect(normalizeTcInput('11:22:33:24')).toBe('11:22:33:24')
  })

  it('expands single number to seconds', () => {
    expect(normalizeTcInput('5')).toBe('00:00:05:00')
    expect(normalizeTcInput('30')).toBe('00:00:30:00')
  })

  it('expands M:S to MM:SS:00', () => {
    expect(normalizeTcInput('1:23')).toBe('00:01:23:00')
    expect(normalizeTcInput('12:34')).toBe('00:12:34:00')
  })

  it('expands M:S:F to MM:SS:FF (3 groups = last is frames)', () => {
    expect(normalizeTcInput('1:23:45')).toBe('00:01:23:45')
    expect(normalizeTcInput('0:30:15')).toBe('00:00:30:15')
  })

  it('expands H:M:S:F to padded HH:MM:SS:FF', () => {
    expect(normalizeTcInput('1:2:3:4')).toBe('01:02:03:04')
  })

  it('3-4 digit input maps to MM:SS', () => {
    // last 2 digits = seconds, leading = minutes
    expect(normalizeTcInput('523')).toBe('00:05:23:00')
    expect(normalizeTcInput('1234')).toBe('00:12:34:00')
  })

  it('legacy 8-digit paste flow works', () => {
    expect(normalizeTcInput('11030200')).toBe('11:03:02:00')
  })

  it('handles whitespace around segments', () => {
    expect(normalizeTcInput(' 1 : 23 ')).toBe('00:01:23:00')
  })

  it('clamps absurdly large parts to 99 each', () => {
    expect(normalizeTcInput('999:0:0:0')).toBe('99:00:00:00')
  })

  it('returns original on non-numeric junk to allow continued editing', () => {
    expect(normalizeTcInput('abc')).toBe('abc')
  })

  it('roundtrips through isValidTimecode', () => {
    const samples = ['5', '1:23', '1:23:45', '1:2:3:4', '00:00:00:00']
    for (const s of samples) {
      expect(isValidTimecode(normalizeTcInput(s))).toBe(true)
    }
  })
})

describe('isValidTimecode', () => {
  it('accepts well-formed TCs', () => {
    expect(isValidTimecode('00:00:00:00')).toBe(true)
    expect(isValidTimecode('23:59:59:29')).toBe(true)
  })

  it('rejects malformed', () => {
    expect(isValidTimecode('1:2:3:4')).toBe(false)        // unpadded
    expect(isValidTimecode('00:00:00')).toBe(false)        // missing frames
    expect(isValidTimecode('00:00:00:00:00')).toBe(false)  // extra group
    expect(isValidTimecode('aa:bb:cc:dd')).toBe(false)
    expect(isValidTimecode('')).toBe(false)
  })
})
