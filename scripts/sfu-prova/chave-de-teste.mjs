/**
 * The media key for this proof, and only this one.
 *
 * In the real application this material comes from the MLS exporter of the epoch
 * (`deriveSframeKeyMaterial`), and that is why it differs for each channel, each
 * epoch and each sender. Here it is a hand-written constant, because Phase 0
 * does not set up MLS: what is being proved is TRANSPORT, not derivation.
 *
 * The file exists separately for a reason that is the proof itself: whoever imports
 * this knows the key, and whoever does not import it does not know. `servidor.mjs` does not
 * import it, and `auditarSegredos` in `analise.mjs` fails if it ever
 * imports it, or if these bytes appear there by any other path.
 *
 * 28 bytes: 16 of AES-GCM key + 12 of salt, which is what `importSframeKey`
 * expects. They do not need to be truly random, they need to be fixed, so both
 * browsers in the proof derive the same thing without exchanging anything.
 */

/** 16 bytes of key + 12 of salt, in hexadecimal. */
export const MATERIAL_HEX = "5f1c7ad3e0b249a68c3f10d7e4b95a2c7f0e3d1a2b4c5d6e7f809a1b"

/**
 * The `keyId` is the epoch truncated to 16 bits. 41 is the number the plan uses in the
 * examples ("A+B in epoch 41"), and choosing the same makes the proof read alongside
 * the document without translation.
 */
export const KEY_ID = 41

/** The `senderId` is the index of the sender's MLS leaf. Any fixed value. */
export const SENDER_ID = 7

export function materialEmBytes() {
  const bytes = new Uint8Array(MATERIAL_HEX.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(MATERIAL_HEX.slice(i * 2, i * 2 + 2), 16)
  return bytes
}
