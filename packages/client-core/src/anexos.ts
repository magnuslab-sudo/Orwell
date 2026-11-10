import { MAX_SEALED_BYTES } from "./session.js"

/**
 * How much an attachment can really weigh.
 *
 * **The schema ceiling is not the real ceiling, and the gap is a defect.**
 * The `Attachment` protocol accepts four million characters in `inline` and
 * ten attachments per message, close to thirty megabytes of file. None of
 * that reaches the other side: the message comes out encrypted and in base64,
 * and `Session.send` refuses above `MAX_SEALED_BYTES`. An attachment valid
 * per schema can be unsendable, and before this the only way to find out was
 * to try.
 *
 * Worse than unsendable: the server measures the whole frame and, over
 * twelve megabytes, CLOSES THE CONNECTION. The client's refusal exists so
 * the encounter never happens, but it comes after the message is composed,
 * and a message refused at send is wasted work. This module counts even
 * earlier: before the file is accepted in the write box.
 *
 * **The overhead, measured not estimated.** File bytes become base64 in a
 * data URL (4/3), the whole message gets encrypted, and the result goes
 * base64 again inside the frame JSON (4/3 once more). That is 16/9 ≈ 1.778×,
 * and measuring against `encryptPayload` for real gives 1.7784 on a one-meg
 * file, with a constant remainder of a few hundred bytes that is the MLS
 * header plus the JSON scaffold around the attachment. See `anexos.test.ts`,
 * which redoes the measurement instead of trusting this paragraph.
 */

/**
 * The `inline` ceiling in the schema, in characters.
 *
 * Repeated here and not imported because in the protocol it is a literal
 * inside the `z.object`. `anexos.test.ts` puts both declarations side by
 * side, an attachment with exactly this passes validation and with one more
 * character does not, so a divergence fails a test instead of appearing as
 * a send that the receiver discards in silence.
 */
export const INLINE_MAX_CHARS = 4_000_000

/**
 * Space reserved for everything that is not the file bytes.
 *
 * MLS header (roughly 460 bytes measured), JSON braces and quotes around
 * attachments, filename (up to 255), type (up to 128). Four kilobytes is
 * intentional overhead: against the eight and a half megabytes left, it is
 * one ten-thousandth of the budget, and paying for it is cheaper than risking
 * a closed connection from counting too short.
 */
const RESERVA_ESTRUTURA = 4096

/**
 * Payload characters that a message holds before encryption puts it above
 * the sealed limit.
 *
 * `MAX_SEALED_BYTES` counts the base64 of the ciphertext. Base64 of `n` bytes takes
 * `ceil(n/3)*4`, so the largest `n` that still fits is `floor(tecto/4)*3`.
 */
export const PAYLOAD_MAX_CHARS = Math.floor(MAX_SEALED_BYTES / 4) * 3 - RESERVA_ESTRUTURA

/**
 * The exact length of a file data URL, without building it.
 *
 * `data:` + type + `;base64,` + base64 of bytes. Computing this before reading
 * the file is what lets us reject it without first loading it all into memory.
 * A half-gigabyte file chosen by mistake should not cost half a gigabyte of RAM
 * to reject.
 */
export function caracteresDeDataUrl(bytes: number, mediaType: string): number {
  return "data:".length + mediaType.length + ";base64,".length + Math.ceil(bytes / 3) * 4
}

/**
 * How many file bytes still fit in this message.
 *
 * `used` is the payload characters the message already carries: text, images,
 * link card, files already chosen. The caller knows this and this module does
 * not guess: a fixed cap would lie on the second thing added to the message.
 *
 * Returns the smaller of the two caps, because failing either one is failure:
 * the schema cap, which would reject the attachment on validation, and the frame
 * cap, which the server would reject by closing the connection.
 */
export function bytesQueAindaCabem(ocupado: number, mediaType: string): number {
  const prefixo = "data:".length + mediaType.length + ";base64,".length
  const porEsquema = INLINE_MAX_CHARS - prefixo
  const porMoldura = PAYLOAD_MAX_CHARS - ocupado - prefixo
  const base64 = Math.min(porEsquema, porMoldura)
  if (base64 <= 0) return 0
  // Base64 moves in groups of four characters per three bytes. Rounding down to
  // the full group ensures the result, converted back by `caracteresDeDataUrl`,
  // does not exceed the measured character count.
  return Math.floor(base64 / 4) * 3
}

/**
 * The largest file that ever fits in a message with an empty message.
 *
 * Used for the label shown BEFORE any choice. "up to this much". The schema cap
 * always wins here, because an empty message leaves six and a half megabytes of
 * frame for three of schema. With anything already in the message, the real
 * number comes from `bytesQueAindaCabem`, and that is what the rejection must
 * state.
 */
export const FICHEIRO_MAX_BYTES = bytesQueAindaCabem(0, "application/octet-stream")
