/**
 * Canonical JSON, so that two implementations signing "the same" object produce
 * byte-identical input. Without this, a signature check turns into a
 * serializer-compatibility check, and the failures are silent and intermittent.
 *
 * Rules: object keys sorted by UTF-16 code unit, no insignificant whitespace,
 * `undefined` members dropped, no floats (integers only), UTF-8 output.
 */
export function canonicalize(value: unknown): string {
  return serialize(value)
}

export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value))
}

function serialize(value: unknown): string {
  if (value === null) return "null"

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false"
    case "number":
      if (!Number.isInteger(value)) {
        throw new Error("canonical JSON forbids non-integer numbers; use a string or scale to an integer")
      }
      if (!Number.isSafeInteger(value)) {
        throw new Error("canonical JSON forbids integers outside the safe range; use a string")
      }
      return String(value)
    case "string":
      return JSON.stringify(value)
    case "object":
      break
    default:
      throw new Error(`canonical JSON cannot encode ${typeof value}`)
  }

  if (Array.isArray(value)) {
    return `[${value.map(serialize).join(",")}]`
  }

  const record = value as Record<string, unknown>
  const parts: string[] = []
  for (const key of Object.keys(record).sort()) {
    const member = record[key]
    if (member === undefined) continue
    parts.push(`${JSON.stringify(key)}:${serialize(member)}`)
  }
  return `{${parts.join(",")}}`
}

/**
 * base64url without padding. Hand-rolled rather than `Buffer` so the same code
 * runs in the Electron renderer, where we deliberately leave Node integration
 * off.
 */
const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

export function toBase64(bytes: Uint8Array): string {
  let out = ""
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    out += B64URL[a >>> 2]
    out += B64URL[((a & 0x03) << 4) | ((b ?? 0) >>> 4)]
    if (b === undefined) break
    out += B64URL[((b & 0x0f) << 2) | ((c ?? 0) >>> 6)]
    if (c === undefined) break
    out += B64URL[c & 0x3f]
  }
  return out
}

/**
 * Decodes base64url, and standard base64 too.
 *
 * The two alphabets differ only in the last two characters (`-_` against `+/`),
 * so accepting both costs one substitution and removes an entire class of
 * interoperability failure: a value produced by some other library's `base64`
 * would otherwise fail to decode for no reason a caller could act on. Encoding
 * always emits base64url.
 */
export function fromBase64(text: string): Uint8Array {
  const out: number[] = []
  let bits = 0
  let value = 0
  for (const char of text) {
    if (char === "=") break
    const normalized = char === "+" ? "-" : char === "/" ? "_" : char
    const index = B64URL.indexOf(normalized)
    if (index < 0) throw new Error(`invalid base64 character: ${char}`)
    value = (value << 6) | index
    bits += 6
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}
