import { describe, it, expect } from 'vitest'
import { fpsToRateCode } from '../MtcOutput'

describe('fpsToRateCode — MTC rate code mapping', () => {
  it('24 fps → 0 (film)', () => {
    expect(fpsToRateCode(24)).toBe(0)
  })

  it('25 fps → 1 (EBU / PAL)', () => {
    expect(fpsToRateCode(25)).toBe(1)
  })

  it('29.97 fps → 2 (drop-frame)', () => {
    expect(fpsToRateCode(29.97)).toBe(2)
  })

  it('30 fps → 3 (non-drop) — v0.5.0 regression: 0.1 tolerance made 30 match 29.97', () => {
    expect(fpsToRateCode(30)).toBe(3)
  })

  it('small float drift on 29.97 still maps to DF', () => {
    expect(fpsToRateCode(29.970001)).toBe(2)
    expect(fpsToRateCode(29.9699)).toBe(2)
  })

  it('small float drift on 30 still maps to ND', () => {
    expect(fpsToRateCode(30.0000001)).toBe(3)
    expect(fpsToRateCode(29.9999)).toBe(3)
  })
})
