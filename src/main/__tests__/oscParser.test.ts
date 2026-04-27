import { describe, it, expect } from 'vitest'
import { randomBytes } from 'crypto'
import { parseOscTcAck } from '../oscParser'

/**
 * Build an OSC message buffer: address + ",iiii" + 4 × int32 BE.
 * Used to construct happy-path inputs for the parser.
 */
function encodeOscMessage(address: string, ints: number[]): Buffer {
  const encodeOscString = (s: string): Buffer => {
    const buf = Buffer.from(s + '\0', 'ascii')
    const rem = buf.length % 4
    return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - rem)])
  }
  const addr = encodeOscString(address)
  const typeTag = encodeOscString(',' + 'i'.repeat(ints.length))
  const args = Buffer.alloc(ints.length * 4)
  for (let i = 0; i < ints.length; i++) {
    args.writeInt32BE(ints[i] | 0, i * 4)
  }
  return Buffer.concat([addr, typeTag, args])
}

describe('parseOscTcAck — happy path', () => {
  it('parses a valid /ltcast/tc_ack with ,iiii', () => {
    const pkt = encodeOscMessage('/ltcast/tc_ack', [1, 2, 3, 4])
    const r = parseOscTcAck(pkt)
    expect(r).toEqual({ h: 1, m: 2, s: 3, f: 4 })
  })

  it('parses zeros at all positions', () => {
    const pkt = encodeOscMessage('/ltcast/tc_ack', [0, 0, 0, 0])
    expect(parseOscTcAck(pkt)).toEqual({ h: 0, m: 0, s: 0, f: 0 })
  })

  it('parses the upper edge of valid TC values', () => {
    const pkt = encodeOscMessage('/ltcast/tc_ack', [23, 59, 59, 59])
    expect(parseOscTcAck(pkt)).toEqual({ h: 23, m: 59, s: 59, f: 59 })
  })
})

describe('parseOscTcAck — malformed inputs return null and never throw', () => {
  it('rejects an empty buffer', () => {
    expect(parseOscTcAck(Buffer.alloc(0))).toBeNull()
  })

  it('rejects buffers larger than 256 bytes', () => {
    const oversize = Buffer.alloc(300)
    // even if it starts with a valid address, length check fires first
    Buffer.from('/ltcast/tc_ack\0').copy(oversize, 0)
    expect(parseOscTcAck(oversize)).toBeNull()
  })

  it('rejects the wrong address pattern', () => {
    const pkt = encodeOscMessage('/foo/bar', [1, 2, 3, 4])
    expect(parseOscTcAck(pkt)).toBeNull()
  })

  it('rejects address with no leading slash', () => {
    // Construct a packet whose "address" is "ltcast/tc_ack" (no slash).
    const fakeAddr = Buffer.from('ltcast/tc_ack\0\0\0', 'ascii') // padded to 16
    const tag = Buffer.from(',iiii\0\0\0', 'ascii')
    const args = Buffer.alloc(16)
    expect(parseOscTcAck(Buffer.concat([fakeAddr, tag, args]))).toBeNull()
  })

  it('rejects type tag that is not exactly ,iiii', () => {
    const pkt = encodeOscMessage('/ltcast/tc_ack', [1, 2, 3]) // ,iii
    expect(parseOscTcAck(pkt)).toBeNull()
  })

  it('rejects ,iiif (non-int last arg)', () => {
    const addr = Buffer.from('/ltcast/tc_ack\0\0', 'ascii')   // 16 bytes
    const tag = Buffer.from(',iiif\0\0\0', 'ascii')           // 8 bytes
    const args = Buffer.alloc(16)
    expect(parseOscTcAck(Buffer.concat([addr, tag, args]))).toBeNull()
  })

  it('rejects ,iiiii (5 ints)', () => {
    const pkt = encodeOscMessage('/ltcast/tc_ack', [1, 2, 3, 4, 5])
    expect(parseOscTcAck(pkt)).toBeNull()
  })

  it('rejects bundle prefix #bundle\\0', () => {
    const bundle = Buffer.concat([
      Buffer.from('#bundle\0', 'ascii'),
      Buffer.alloc(16) // bogus payload
    ])
    expect(parseOscTcAck(bundle)).toBeNull()
  })

  it('rejects out-of-range hours (h=24)', () => {
    const pkt = encodeOscMessage('/ltcast/tc_ack', [24, 0, 0, 0])
    expect(parseOscTcAck(pkt)).toBeNull()
  })

  it('rejects out-of-range minutes (m=60)', () => {
    const pkt = encodeOscMessage('/ltcast/tc_ack', [0, 60, 0, 0])
    expect(parseOscTcAck(pkt)).toBeNull()
  })

  it('rejects out-of-range seconds (s=60)', () => {
    const pkt = encodeOscMessage('/ltcast/tc_ack', [0, 0, 60, 0])
    expect(parseOscTcAck(pkt)).toBeNull()
  })

  it('rejects out-of-range frames (f=61)', () => {
    const pkt = encodeOscMessage('/ltcast/tc_ack', [0, 0, 0, 61])
    expect(parseOscTcAck(pkt)).toBeNull()
  })

  it('rejects negative integers', () => {
    const pkt = encodeOscMessage('/ltcast/tc_ack', [-1, 0, 0, 0])
    expect(parseOscTcAck(pkt)).toBeNull()
  })

  it('rejects truncated buffer that cuts mid-int', () => {
    const pkt = encodeOscMessage('/ltcast/tc_ack', [1, 2, 3, 4])
    // Drop the last 2 bytes
    expect(parseOscTcAck(pkt.subarray(0, pkt.length - 2))).toBeNull()
  })

  it('rejects address string with no null terminator within 64 bytes', () => {
    const buf = Buffer.alloc(80, 0x41) // 'A' repeated, no null
    expect(parseOscTcAck(buf)).toBeNull()
  })

  it('rejects type tag with no null terminator', () => {
    const addr = Buffer.from('/ltcast/tc_ack\0\0', 'ascii') // 16 bytes
    const noNull = Buffer.alloc(64, 0x41)
    expect(parseOscTcAck(Buffer.concat([addr, noNull]))).toBeNull()
  })

  it('rejects packet with trailing extra bytes', () => {
    const pkt = encodeOscMessage('/ltcast/tc_ack', [1, 2, 3, 4])
    const extra = Buffer.concat([pkt, Buffer.from([0, 0, 0, 0])])
    expect(parseOscTcAck(extra)).toBeNull()
  })

  it('rejects buffer not aligned to 4-byte OSC padding', () => {
    // /ltcast/tc_ack is 14 bytes + 1 null = 15, needs 1 byte pad → 16. If we
    // chop off the padding so only 15 bytes precede the type tag, it fails.
    const broken = Buffer.from('/ltcast/tc_ack\0', 'ascii') // 15 bytes, no pad
    const rest = Buffer.concat([Buffer.from(',iiii\0\0\0', 'ascii'), Buffer.alloc(16)])
    expect(parseOscTcAck(Buffer.concat([broken, rest]))).toBeNull()
  })

  it('rejects address with control characters', () => {
    const evil = Buffer.from('/ltcast/tc_\x01ack\0', 'ascii') // 16 bytes with embedded ctl
    const rest = Buffer.concat([Buffer.from(',iiii\0\0\0', 'ascii'), Buffer.alloc(16)])
    expect(parseOscTcAck(Buffer.concat([evil, rest]))).toBeNull()
  })

  it('rejects null/undefined-ish input safely', () => {
    // @ts-expect-error — runtime guard test
    expect(parseOscTcAck(null)).toBeNull()
    // @ts-expect-error — runtime guard test
    expect(parseOscTcAck(undefined)).toBeNull()
    // @ts-expect-error — runtime guard test
    expect(parseOscTcAck('not a buffer')).toBeNull()
  })

  it('handles 200 random fuzz inputs without throwing (all return null)', () => {
    for (let i = 0; i < 200; i++) {
      // Random size 1..255 inclusive — stays under MAX_BUFFER_BYTES so we test
      // the malformed-content paths, not just the size guard.
      const size = 1 + (i % 255)
      const buf = randomBytes(size)
      // Should never throw.
      const r = parseOscTcAck(buf)
      // Random bytes will essentially never form a valid /ltcast/tc_ack;
      // we accept either null or a valid parse but the function must not
      // throw and must not produce out-of-range values.
      if (r !== null) {
        expect(r.h).toBeGreaterThanOrEqual(0); expect(r.h).toBeLessThanOrEqual(23)
        expect(r.m).toBeGreaterThanOrEqual(0); expect(r.m).toBeLessThanOrEqual(59)
        expect(r.s).toBeGreaterThanOrEqual(0); expect(r.s).toBeLessThanOrEqual(59)
        expect(r.f).toBeGreaterThanOrEqual(0); expect(r.f).toBeLessThanOrEqual(60)
      }
    }
  })
})
