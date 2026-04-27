/**
 * Defensive OSC 1.0 parser for inbound `/ltcast/tc_ack` packets.
 *
 * Only the single message LTCast expects to receive is accepted; everything
 * else returns null. The parser is intentionally narrow because it sits on the
 * first inbound network surface in the app (F3 sprint, v0.5.3) and must never
 * throw across the dgram message handler boundary, never allocate unbounded
 * memory, and never partially-parse a malformed packet.
 *
 * Spec accepted:
 *   address  = "/ltcast/tc_ack" (exact match)
 *   typeTag  = ",iiii"          (exact match — h, m, s, f)
 *   payload  = 4 × big-endian int32 → { h, m, s, f }
 *
 * Everything else (bundles, other addresses, other type tags, oversize buffers,
 * malformed strings, out-of-range values) returns null silently.
 */

const EXPECTED_ADDRESS = '/ltcast/tc_ack'
const EXPECTED_TYPE_TAG = ',iiii'
const MAX_BUFFER_BYTES = 256
const MAX_OSC_STRING_BYTES = 64

export interface ParsedTcAck {
  h: number
  m: number
  s: number
  f: number
}

/**
 * Read an OSC string starting at `offset` from `buf`. OSC strings are
 * null-terminated and padded to a 4-byte boundary. Returns either the parsed
 * string + the offset *after* the padding, or null on any malformed condition.
 */
function readOscString(buf: Buffer, offset: number): { value: string; nextOffset: number } | null {
  if (offset < 0 || offset >= buf.length) return null
  // Cap the search window to avoid scanning the whole buffer for a missing
  // terminator on adversarial input.
  const searchEnd = Math.min(offset + MAX_OSC_STRING_BYTES, buf.length)
  let nullIdx = -1
  for (let i = offset; i < searchEnd; i++) {
    if (buf[i] === 0) { nullIdx = i; break }
  }
  if (nullIdx < 0) return null
  // OSC strings must occupy a multiple of 4 bytes including at least one null.
  const stringWithNullLen = nullIdx - offset + 1
  const padding = (4 - (stringWithNullLen % 4)) % 4
  const totalLen = stringWithNullLen + padding
  const nextOffset = offset + totalLen
  if (nextOffset > buf.length) return null
  // Verify all padding bytes are zero — guards against malformed packets that
  // happen to contain a null in the right spot but bogus padding.
  for (let i = nullIdx + 1; i < nextOffset; i++) {
    if (buf[i] !== 0) return null
  }
  // OSC 1.0 strings are ASCII; we accept printable ASCII only for the address
  // and type tag (the only strings this parser reads). Reject control chars
  // and high bits to keep the surface narrow.
  for (let i = offset; i < nullIdx; i++) {
    const c = buf[i]
    if (c < 0x20 || c > 0x7e) return null
  }
  const value = buf.toString('ascii', offset, nullIdx)
  return { value, nextOffset }
}

/**
 * Parse a single OSC `/ltcast/tc_ack` packet. Returns the parsed TC components
 * or null on any error. Never throws.
 */
export function parseOscTcAck(buf: Buffer): ParsedTcAck | null {
  try {
    if (!buf || !(buf instanceof Buffer)) return null
    if (buf.length === 0) return null
    if (buf.length > MAX_BUFFER_BYTES) return null

    // Bundle prefix is explicitly rejected for v0.5.3 (single messages only).
    if (buf.length >= 8) {
      // "#bundle\0"
      if (
        buf[0] === 0x23 && buf[1] === 0x62 && buf[2] === 0x75 && buf[3] === 0x6e &&
        buf[4] === 0x64 && buf[5] === 0x6c && buf[6] === 0x65 && buf[7] === 0x00
      ) return null
    }

    // Address pattern
    const addr = readOscString(buf, 0)
    if (!addr) return null
    if (addr.value !== EXPECTED_ADDRESS) return null

    // Type tag
    const tag = readOscString(buf, addr.nextOffset)
    if (!tag) return null
    if (tag.value !== EXPECTED_TYPE_TAG) return null

    // Four int32s, big-endian
    let p = tag.nextOffset
    if (p + 16 !== buf.length) {
      // Strict length check: any trailing bytes or short packet → reject.
      return null
    }

    const h = buf.readInt32BE(p); p += 4
    const m = buf.readInt32BE(p); p += 4
    const s = buf.readInt32BE(p); p += 4
    const f = buf.readInt32BE(p); p += 4

    // Range checks. Reject (not clamp) so upstream config bugs surface.
    if (!Number.isInteger(h) || h < 0 || h > 23) return null
    if (!Number.isInteger(m) || m < 0 || m > 59) return null
    if (!Number.isInteger(s) || s < 0 || s > 59) return null
    if (!Number.isInteger(f) || f < 0 || f > 60) return null

    return { h, m, s, f }
  } catch {
    // Defensive: must never throw to dgram callback.
    return null
  }
}
