/**
 * The SFrame wire format, in bytes, for anyone who needs to reimplement it
 * outside JavaScript.
 *
 * This exists because of a statement in `docs/PLANO_MOVEL.md` §9: if media
 * becomes encrypted natively, Swift or Kotlin over the `libwebrtc` hooks, and the
 * interface stays the same webpage, then there are TWO implementations of the
 * same cipher and they MUST produce identical bytes. A mobile device that puts
 * the counter in a different order, or XORs the nonce against the wrong salt
 * bytes, will not talk to a browser: it connects, negotiates, transports
 * frames, and on the other side nothing opens. The failure does not look like
 * a cryptography failure. It looks like a broken camera.
 *
 * So what this script prints is not a demonstration: it is the ACCEPTANCE
 * CRITERION for a second implementation. Encrypt with this repository's
 * implementation (`packages/crypto/src/sframe.ts`), with fixed key, salt and counters, and print the
 * output bytes. Whoever writes the native version runs the same cases and
 * compares the strings. Match, it talks. Differ, it does not talk, and you
 * know which field is wrong before you have a device in hand.
 *
 * The cases are not decorative. Each one exists because of a concrete error
 * that a reimplementation makes:
 *
 *  - `contador 0` and `contador 1`, the trivial case, and the one that catches a header
 *    written in little-endian.
 *  - `contador 65535 → 65536`, the counter from 48 bits is split into two
 *    fields in the header (u32 for high bits, u16 for low). This is where a
 *    reimplementation that writes a u48 straight diverges from this one.
 *  - `contador 2^32 + 5`, the nonce XORs the salt in TWO independent u32s. An
 *    implementation that does the XOR with 32 bits arithmetic loses
 *    the carry to the high bits and produces the same nonce as the counter
 *    5. Two frames with the same nonce under the same key is the failure
 *    that breaks AES-GCM for real, and goes unnoticed because it ENCRYPTS
 *    ANYWAY.
 *  - `keyId/senderId grandes`, the header takes them in u16 and the MLS
 *    exporter context takes them in u32. Two sizes for the same number, in
 *    the same file, and whoever copies one to the other gets it wrong.
 *
 * What this script does NOT cover, on purpose: key derivation from the MLS
 * epoch (`deriveSframeKeyMaterial`). That half stays in JavaScript, see §9.4 do plan, and the
 * native side receives the 28 bytes already made. What is fixed here is what
 * happens AFTER there is a key.
 *
 *   npx tsc -b && node scripts/movel-sframe-vectores.mjs
 */
import { importSframeKey, readHeader, SframeReceiver, SframeSender } from "@enclave/crypto"

/**
 * 28 bytes: 16 of key, 12 of salt. Not random or secret, a pattern you can
 * read by eye in a hex dump, which is the only property that matters to a
 * test vector.
 */
const MATERIAL = Uint8Array.from(Array.from({ length: 28 }, (_, i) => i * 0x11 + 0x0f))

const hex = (bytes) => Buffer.from(bytes).toString("hex")

/** The plaintext of each case, so you see the length survives. */
const CLARO = new TextEncoder().encode("frame de media, em claro, com 42 bytes -- ok")

const CASOS = [
  { nome: "contador 0", keyId: 1, senderId: 2, contador: 0 },
  { nome: "contador 1", keyId: 1, senderId: 2, contador: 1 },
  { nome: "contador 65535 (limite do campo baixo)", keyId: 1, senderId: 2, contador: 65535 },
  { nome: "contador 65536 (transporte para o campo alto)", keyId: 1, senderId: 2, contador: 65536 },
  { nome: "contador 2^32+5 (transporte no XOR do nonce)", keyId: 1, senderId: 2, contador: 2 ** 32 + 5 },
  { nome: "contador 2^40 (o limiar de rechaveamento)", keyId: 1, senderId: 2, contador: 2 ** 40 },
  { nome: "keyId/senderId grandes (u16 no cabeçalho)", keyId: 0xfffe, senderId: 0xabcd, contador: 7 },
]

console.log("SFrame do Orwell — vectores do formato do fio")
console.log("chave (16 bytes): " + hex(MATERIAL.subarray(0, 16)))
console.log("sal   (12 bytes): " + hex(MATERIAL.subarray(16, 28)))
console.log("claro (" + CLARO.length + " bytes): " + hex(CLARO))
console.log("")
console.log("cabeçalho: keyId(u16) senderId(u16) contador(u32 alto | u16 baixo) versão(u8=0) — big-endian, 11 bytes")
console.log("nonce: sal com os 8 bytes finais XOR o contador em 64 bits big-endian; os 4 primeiros ficam intactos")
console.log("frame: cabeçalho || AES-GCM(chave, nonce, AAD=cabeçalho, claro) || etiqueta de 16 bytes")
console.log("")

let falhas = 0

for (const caso of CASOS) {
  const chave = await importSframeKey(MATERIAL, caso.keyId, caso.senderId)
  const emissor = new SframeSender(chave, caso.contador)
  const frame = await emissor.encrypt(CLARO)

  const cabecalho = frame.subarray(0, 11)
  const lido = readHeader(frame)

  // The counter that comes out of the header must be what went in. A u48
  // read backwards gives a plausible number, which is why we check.
  if (lido?.counter !== caso.contador || lido.keyId !== (caso.keyId & 0xffff)) {
    console.log("  !! o cabeçalho não relê o que escreveu: " + JSON.stringify(lido))
    falhas++
  }

  // And it has to DECRYPT. A vector that doesn't decrypt is a wrong vector, and
  // a document citing it sends someone chasing a ghost for a day.
  const receptor = new SframeReceiver(chave)
  const aberto = await receptor.decrypt(frame)
  if (!aberto || Buffer.compare(Buffer.from(aberto), Buffer.from(CLARO)) !== 0) {
    console.log("  !! não abriu do outro lado")
    falhas++
  }

  console.log(caso.nome)
  console.log("  keyId=" + caso.keyId + " senderId=" + caso.senderId + " contador=" + caso.contador)
  console.log("  cabeçalho: " + hex(cabecalho))
  console.log("  frame:     " + hex(frame))
  console.log("  (" + frame.length + " bytes: 11 de cabeçalho + " + CLARO.length + " de claro + 16 de etiqueta)")
  console.log("")
}

/**
 * The control, which is what makes the rest meaningful.
 *
 * Two different counters under the SAME key must give different frames. It's
 * a check that looks silly, and it's exactly what fails in a reimplementation
 * that loses the 64-bit XOR carry: counters 5 and 2^32+5 produce the same nonce,
 * the same keystream, and the same ciphertext. If these two lines ever come out
 * the same, the native implementation that made them is repeating nonces and
 * cannot be shipped.
 */
const chave = await importSframeKey(MATERIAL, 1, 2)
const a = await new SframeSender(chave, 5).encrypt(CLARO)
const b = await new SframeSender(chave, 2 ** 32 + 5).encrypt(CLARO)
const corpoA = hex(a.subarray(11))
const corpoB = hex(b.subarray(11))
console.log("controlo — contadores 5 e 2^32+5 sob a mesma chave:")
console.log("  " + (corpoA === corpoB ? "IGUAIS — NONCE REPETIDO, implementação inutilizável" : "diferentes, como tem de ser"))
if (corpoA === corpoB) falhas++

console.log("")
console.log(falhas === 0 ? "todos os casos coerentes." : falhas + " problema(s): os vectores acima não servem.")
process.exit(falhas === 0 ? 0 : 1)
