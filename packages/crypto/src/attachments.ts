import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { blake3 } from "@noble/hashes/blake3.js"
import { toBase64, fromBase64, type Attachment } from "@enclave/protocol"

/**
 * Attachments.
 *
 * Discord serves uploads from an unauthenticated CDN — a link leaks the file to
 * anyone who has it, forever, and the operator holds the plaintext. Here the
 * blob store only ever receives ciphertext, and the key lives inside the MLS
 * message that references it. Losing the channel means losing the ability to
 * decrypt the file, which is the behaviour people already assume they have.
 */

export interface EncryptedBlob {
  ciphertext: Uint8Array
  /** Goes in the payload, alongside the URL the store returns. */
  descriptor: Omit<Attachment, "url">
}

export interface AttachmentMeta {
  name: string
  mediaType: string
  kind?: "image" | "video" | "audio" | "document" | "other"
  duration?: number
  blurhash?: string
}

/**
 * Classify from the MIME type the sender reported.
 *
 * Only used to choose a player, never to decide whether something is safe to
 * open — a sender controls this string, so it is a hint and nothing more.
 */
export function kindOf(mediaType: string): "image" | "video" | "audio" | "document" | "other" {
  if (mediaType.startsWith("image/")) return "image"
  if (mediaType.startsWith("video/")) return "video"
  if (mediaType.startsWith("audio/")) return "audio"
  if (mediaType === "application/pdf" || mediaType.startsWith("text/")) return "document"
  return "other"
}

/**
 * XChaCha20-Poly1305 with a fresh random key per file.
 *
 * A 24-byte nonce means we can pick it at random with no counter to track and no
 * chance of collision in practice. Per-file keys mean a leaked attachment key
 * exposes exactly that attachment.
 */
export function encryptAttachment(plaintext: Uint8Array, meta: AttachmentMeta): EncryptedBlob {
  const key = crypto.getRandomValues(new Uint8Array(32))
  const nonce = crypto.getRandomValues(new Uint8Array(24))
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(plaintext)

  return {
    ciphertext,
    descriptor: {
      key: toBase64(key),
      nonce: toBase64(nonce),
      // Digest of the *ciphertext*, so we can reject a tampered blob before
      // spending any work on it — and so the store can be content-addressed
      // without ever seeing the plaintext.
      digest: toBase64(blake3(ciphertext)),
      kind: meta.kind ?? kindOf(meta.mediaType),
      name: meta.name,
      mediaType: meta.mediaType,
      byteLength: plaintext.length,
      ...(meta.duration !== undefined ? { duration: meta.duration } : {}),
      ...(meta.blurhash !== undefined ? { blurhash: meta.blurhash } : {}),
    },
  }
}

export function decryptAttachment(ciphertext: Uint8Array, attachment: Attachment): Uint8Array {
  const expected = fromBase64(attachment.digest)
  const actual = blake3(ciphertext)
  if (!timingSafeEqual(expected, actual)) {
    throw new Error("attachment digest mismatch — the blob store returned different bytes than the sender referenced")
  }

  return xchacha20poly1305(fromBase64(attachment.key), fromBase64(attachment.nonce)).decrypt(ciphertext)
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number)
  return diff === 0
}
