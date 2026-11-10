import { mlsExporter } from "ts-mls"
import type { GroupSession } from "./group.js"

/**
 * End-to-end encrypted voice and video.
 *
 * Discord's SFU terminates media: the server decodes every stream, which means
 * a voice call is plaintext at the operator. Enclave keeps the SFU as a dumb
 * packet forwarder — it reads RTP headers to route and pace, and the payload
 * stays sealed the whole way.
 *
 * The scheme follows SFrame (RFC 9605) in shape: encrypt the codec frame, not
 * the RTP packet, so the SFU can still fragment, drop and reorder without a key.
 * Frame keys come from the channel's MLS exporter secret, so voice membership is
 * exactly channel membership — nobody joins a call who could not read the text.
 *
 * Deviations from RFC 9605, deliberate and listed so nobody assumes wire compat:
 *  - a compact fixed header instead of the RFC's variable-length one
 *  - the full 16-byte GCM tag rather than the RFC's truncation to 10
 * Both cost a few bytes per frame and remove a class of implementation mistake.
 * Interop with other SFrame stacks is not a goal today.
 */

const SFRAME_LABEL = "enclave sframe base key v1"
const KEY_BYTES = 16
const SALT_BYTES = 12
const HEADER_BYTES = 11

/**
 * WebCrypto rejects views over a `SharedArrayBuffer`, so its types demand
 * `Uint8Array<ArrayBuffer>` specifically. Media frames run through here at frame
 * rate, so the buffers are threaded through with that type rather than copied
 * at each boundary to satisfy the checker.
 */
type Bytes = Uint8Array<ArrayBuffer>

function ownBuffer(source: Uint8Array): Bytes {
  const copy = new Uint8Array(source.length)
  copy.set(source)
  return copy
}

export interface SframeKey {
  /** Which epoch-derived key this is. Bumped on every membership change. */
  keyId: number
  /** Sender's MLS leaf index — gives each participant a distinct key. */
  senderId: number
  key: CryptoKey
  salt: Bytes
}

/**
 * Derive this participant's media key for the current epoch.
 *
 * Keys are per-sender, not per-call. A shared call key would let any
 * participant forge frames as any other, and in a moderated community that is
 * not a theoretical concern.
 */
/**
 * Raw media key material for one participant in one epoch.
 *
 * Split out from `deriveSframeKey` because of where WebRTC lives. On desktop the
 * MLS state sits in the main process while the peer connections necessarily sit
 * in the renderer, so *some* key has to cross that boundary. Exporting 28 bytes
 * scoped to one epoch and one sender is the smallest thing that can: it decrypts
 * that participant's media for that epoch and nothing else — not the channel's
 * text, not the group secrets, not any other epoch.
 */
export async function deriveSframeKeyMaterial(
  session: GroupSession,
  keyId: number,
  senderId: number,
): Promise<Uint8Array> {
  const context = new Uint8Array(8)
  const view = new DataView(context.buffer)
  view.setUint32(0, keyId, false)
  view.setUint32(4, senderId, false)

  return mlsExporter(
    session.state.keySchedule.exporterSecret,
    SFRAME_LABEL,
    context,
    KEY_BYTES + SALT_BYTES,
    session.suite,
  )
}

/** Turn exported material into a usable key. Safe to run wherever media is. */
export async function importSframeKey(material: Uint8Array, keyId: number, senderId: number): Promise<SframeKey> {
  const key = await crypto.subtle.importKey("raw", ownBuffer(material.subarray(0, KEY_BYTES)), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ])
  return { keyId, senderId, key, salt: ownBuffer(material.subarray(KEY_BYTES, KEY_BYTES + SALT_BYTES)) }
}

export async function deriveSframeKey(session: GroupSession, keyId: number, senderId: number): Promise<SframeKey> {
  return importSframeKey(await deriveSframeKeyMaterial(session, keyId, senderId), keyId, senderId)
}

/**
 * The `keyId` is the MLS epoch truncated to 16 bits, so it repeats after
 * 65,536 member changes in the same channel. It does not select a key (a key's
 * identity is its material, and that is how the sender and receivers
 * decide), but at that point the header starts showing a number that was already
 * used. Noted here because this is the kind of thing you find out late.
 *
 * Header: keyId(u16) senderId(u16) counter(u48), big-endian, unencrypted but
 * authenticated as AAD. The SFU needs the key and sender ids to know it is
 * forwarding coherent media; the counter makes the nonce unique.
 */
function writeHeader(key: SframeKey, counter: number, into: Bytes): void {
  const view = new DataView(into.buffer, into.byteOffset, HEADER_BYTES)
  view.setUint16(0, key.keyId, false)
  view.setUint16(2, key.senderId, false)
  view.setUint32(4, Math.floor(counter / 0x10000), false)
  view.setUint16(8, counter % 0x10000, false)
  view.setUint8(10, 0) // version
}

export interface FrameHeader {
  keyId: number
  senderId: number
  counter: number
}

/**
 * The format with the codec bytes in the clear (version 1), for video.
 *
 * **Why.** The SFU (mediasoup, `RTC::RTP::Codecs::VP8::Parse`) and Chrome's RTP
 * unpacker decide if a packet starts a keyframe by checking bit 0 of the FIRST
 * byte of the VP8 frame (RFC 6386, section 9.1). With the entire frame encrypted
 * and the SFrame header at the front, that byte was the high byte of `keyId`: in
 * an epoch below 256, all frames looked like keyframes; between 256 and 511, none did.
 * A viewer joining mid-screen received differential frames treated as keyframes,
 * the decoder applied them over an image that was never complete, and no one
 * requested a keyframe (PLI) because Chrome saw nothing missing. That was the
 * "pixelated" screen share of 2 November 2026.
 *
 * **How.** The first `n` bytes of the frame go in the clear, the same ones Jitsi
 * and the WebRTC end-to-end encryption sample leave (see `bytesEmClaroDoVp8`), and
 * the header moves to the END, where it does not get in the SFU's way. The
 * plaintext bytes go into the AES-GCM additional data: altering
 * them makes the frame fail.
 *
 *   [ n bytes of VP8 plaintext ][ ciphertext + tag ][ keyId u16 · senderId u16 · counter u48 · n u8 · 0xAF · 0x01 ]
 *
 * **What stays visible** to whoever forwards: whether the frame is a keyframe,
 * the image dimensions and the size of the first partition. Nothing of the content.
 *
 * Audio does not change: no plaintext bytes, the sender writes version 0 as
 * before, and a 1.0.5 receiver can still open it.
 */
const TRAILER_BYTES = 13
const MARCA_DO_TRAILER = 0xaf
const VERSAO_COM_CLARO = 1
const TAG_BYTES = 16

interface Enquadramento {
  header: FrameHeader
  /** How many bytes at the front go in the clear. Zero in the old format. */
  claro: number
  /** Where the authenticated but unencrypted bytes are (header or trailer). */
  aad: Uint8Array
  cifrado: Uint8Array
}

function lerHeader(view: DataView): FrameHeader {
  return {
    keyId: view.getUint16(0, false),
    senderId: view.getUint16(2, false),
    counter: view.getUint32(4, false) * 0x10000 + view.getUint16(8, false),
  }
}

/** The old format: header at the front, version 0. */
function enquadramentoAntigo(frame: Uint8Array): Enquadramento | undefined {
  if (frame.length < HEADER_BYTES) return undefined
  const view = new DataView(frame.buffer, frame.byteOffset, HEADER_BYTES)
  if (view.getUint8(10) !== 0) return undefined
  return { header: lerHeader(view), claro: 0, aad: frame.subarray(0, HEADER_BYTES), cifrado: frame.subarray(HEADER_BYTES) }
}

/**
 * The new format: trailer at the end, with marker and version in the last
 * two bytes.
 *
 * The marker exists so an old frame is not read as new by accident: the last
 * byte of an old frame is part of the GCM tag, so it is random. With marker and version, a mistake
 * costs one decrypt attempt per 65,536 frames, and `SframeReceiver.decrypt`
 * then tries the old format.
 */
function enquadramentoNovo(frame: Uint8Array): Enquadramento | undefined {
  if (frame.length < TRAILER_BYTES + TAG_BYTES) return undefined
  if (frame[frame.length - 1] !== VERSAO_COM_CLARO || frame[frame.length - 2] !== MARCA_DO_TRAILER) return undefined
  const inicio = frame.length - TRAILER_BYTES
  const claro = frame[inicio + 10]!
  if (claro > inicio - TAG_BYTES) return undefined
  const view = new DataView(frame.buffer, frame.byteOffset + inicio, TRAILER_BYTES)
  // Additional data is the trailer AND the plaintext bytes, together.
  const aad = new Uint8Array(TRAILER_BYTES + claro)
  aad.set(frame.subarray(inicio), 0)
  aad.set(frame.subarray(0, claro), TRAILER_BYTES)
  return { header: lerHeader(view), claro, aad, cifrado: frame.subarray(claro, inicio) }
}

/** The possible frame formats, in the order they are tried. */
function enquadramentos(frame: Uint8Array): Enquadramento[] {
  return [enquadramentoNovo(frame), enquadramentoAntigo(frame)].filter((cada): cada is Enquadramento => cada !== undefined)
}

/** The SFrame header of a frame, in either of the two formats. */
export function readHeader(frame: Uint8Array): FrameHeader | undefined {
  return enquadramentos(frame)[0]?.header
}

/**
 * How many bytes of a VP8 frame go in the clear.
 *
 * The 3-byte frame tag on any frame, and 7 more on a keyframe: the start code and
 * dimensions, which Chrome's unpacker reads (RFC 6386, section 9.1). Same rule
 * as Jitsi and the WebRTC end-to-end encryption sample. Read from the frame itself,
 * not from the WebRTC `type`, so there is a single rule on both sides and
 * across all three engines.
 */
export function bytesEmClaroDoVp8(frame: Uint8Array): number {
  if (frame.length === 0) return 0
  const chave = (frame[0]! & 0x01) === 0
  return Math.min(frame.length, chave ? 10 : 3)
}

/** Nonce = salt XOR counter, per SFrame. Never reused under a given key. */
function nonceFor(salt: Bytes, counter: number): Bytes {
  const nonce = new Uint8Array(salt.length)
  nonce.set(salt)
  const view = new DataView(nonce.buffer)
  const high = Math.floor(counter / 0x100000000)
  view.setUint32(4, view.getUint32(4, false) ^ high, false)
  view.setUint32(8, view.getUint32(8, false) ^ (counter >>> 0), false)
  return nonce
}

/**
 * Counters must never repeat under one key: a repeat in GCM leaks the XOR of
 * two frames and forges the authenticator. The sender owns its counter and we
 * force a rekey well before the 2^48 header limit.
 *
 * **And "the sender" is not just this object: it is the account, across all
 * app restarts.** The media key derives from the MLS epoch and leaf
 * index, and neither changes when someone closes the window and comes back. A
 * sender that started at zero would then repeat every nonce from the
 * previous call under the same key. That is why the initial counter is passed
 * in from outside, and the caller that picks it reserves it somewhere that survives the
 * restart (see `reservarContadorSframe`).
 *
 * The symptom was worse than the bug suggested: `SframeReceiver`
 * rejects a counter it has seen before, and also rejects those that fall behind
 * its window (see `SframeReceiver.WINDOW`). A user who reloaded the app in the
 * middle of a call came back with the counter at zero and went silent to the others,
 * with the connection still up and their tile on screen. Three people, one reloads,
 * two hear each other.
 */
export class SframeSender {
  #counter: number

  constructor(
    private readonly key: SframeKey,
    /**
     * Where it starts counting. Zero is only safe for a sender that never used
     * this key, which cannot be assumed after a restart.
     */
    contadorInicial = 0,
  ) {
    this.#counter = contadorInicial
  }

  /** Lets the code that reserves blocks know how far this sender has already got. */
  get counter(): number {
    return this.#counter
  }

  get needsRekey(): boolean {
    return this.#counter > 2 ** 40
  }

  /**
   * @param emClaro how many bytes at the front stay in the clear (authenticated). Zero,
   * for audio, is the usual format; video passes `bytesEmClaroDoVp8`. See
   * `TRAILER_BYTES`.
   */
  async encrypt(plaintext: Bytes, emClaro = 0): Promise<Bytes> {
    if (emClaro > 0) return this.#encryptComClaro(plaintext, Math.min(emClaro, plaintext.length, 255))
    const counter = this.#counter++
    const header = new Uint8Array(HEADER_BYTES)
    writeHeader(this.key, counter, header)

    const sealed = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: nonceFor(this.key.salt, counter), additionalData: header },
        this.key.key,
        plaintext,
      ),
    )

    const frame = new Uint8Array(HEADER_BYTES + sealed.length)
    frame.set(header, 0)
    frame.set(sealed, HEADER_BYTES)
    return frame
  }

  /** Version 1: `claro` bytes at the front, trailer at the end. See `TRAILER_BYTES`. */
  async #encryptComClaro(plaintext: Bytes, claro: number): Promise<Bytes> {
    const counter = this.#counter++
    const trailer = new Uint8Array(TRAILER_BYTES)
    writeHeader(this.key, counter, trailer)
    trailer[10] = claro
    trailer[11] = MARCA_DO_TRAILER
    trailer[12] = VERSAO_COM_CLARO
    const aad = new Uint8Array(TRAILER_BYTES + claro)
    aad.set(trailer, 0)
    aad.set(plaintext.subarray(0, claro), TRAILER_BYTES)

    const sealed = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: nonceFor(this.key.salt, counter), additionalData: aad },
        this.key.key,
        plaintext.subarray(claro),
      ),
    )

    const frame = new Uint8Array(claro + sealed.length + TRAILER_BYTES)
    frame.set(plaintext.subarray(0, claro), 0)
    frame.set(sealed, claro)
    frame.set(trailer, claro + sealed.length)
    return frame
  }
}

/**
 * Receive side, with replay rejection.
 *
 * A malicious SFU can replay a frame it forwarded a moment ago; without this
 * window the client would happily decode it again. A sliding window is enough
 * because media is real-time and genuinely old frames are useless anyway.
 */
export class SframeReceiver {
  #highest = -1
  #window = 0n

  /**
   * How many counters behind the highest one seen are still accepted.
   *
   * It was 128, and 128 is too short now that the counter belongs to the SENDER
   * and not the stream. A single sender encrypts the microphone (about 50 frames
   * per second), the camera (30) and, with screen sharing, the monitor (another
   * 30): the window of 128 covered little more than ONE SECOND of stream. One
   * second is not enough for a keyframe. A keyframe is ten to twenty times larger
   * than a normal frame, travels split into many packets and is the first to
   * be delayed when bandwidth tightens, and if it arrives outside the window it gets
   * rejected as a replay, silently: no error, no log. On the viewer side, the
   * image freezes on the last good frame and stays that way until the next keyframe,
   * which can be lost the same way. On a shared screen, which only
   * refreshes when something changes, that looks like a breakdown.
   *
   * 1024 gives about nine seconds across all three streams together (50 + 30 + 30
   * counters per second since the screen went to 30 frames on 2/11/2026), and
   * does not weaken anything: each counter is still accepted exactly once. What
   * changes is how much reordering the network can cause before an honest frame is
   * treated as an attack. The cost is a 1024-bit mask, shifted once
   * per frame, which is negligible next to one AES-GCM per frame.
   */
  static readonly WINDOW = 1024

  constructor(private readonly key: SframeKey) {}

  async decrypt(frame: Bytes): Promise<Bytes | undefined> {
    // The two formats, new first (see `TRAILER_BYTES`). An old frame that happens
    // to carry the new marker fails the tag there and opens here on the second try.
    for (const quadro of enquadramentos(frame)) {
      const { header } = quadro
      if (header.keyId !== this.key.keyId || header.senderId !== this.key.senderId) continue
      if (this.#isReplay(header.counter)) continue

      let aberto: Uint8Array
      try {
        aberto = new Uint8Array(
          await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: nonceFor(this.key.salt, header.counter), additionalData: ownBuffer(quadro.aad) },
            this.key.key,
            ownBuffer(quadro.cifrado),
          ),
        )
      } catch {
        continue
      }

      // Only record the counter after the tag verifies, so a forged frame cannot
      // poison the window and lock out the genuine one.
      this.#accept(header.counter)
      if (quadro.claro === 0) return aberto as Bytes
      const plaintext = new Uint8Array(quadro.claro + aberto.length)
      plaintext.set(frame.subarray(0, quadro.claro), 0)
      plaintext.set(aberto, quadro.claro)
      return plaintext
    }
    return undefined
  }

  #isReplay(counter: number): boolean {
    if (counter > this.#highest) return false
    const age = this.#highest - counter
    if (age >= SframeReceiver.WINDOW) return true
    return (this.#window & (1n << BigInt(age))) !== 0n
  }

  #accept(counter: number): void {
    if (counter > this.#highest) {
      const shift = counter - this.#highest
      this.#window = shift >= SframeReceiver.WINDOW ? 0n : (this.#window << BigInt(shift)) & ((1n << BigInt(SframeReceiver.WINDOW)) - 1n)
      this.#window |= 1n
      this.#highest = counter
    } else {
      this.#window |= 1n << BigInt(this.#highest - counter)
    }
  }
}
