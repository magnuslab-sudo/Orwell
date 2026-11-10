/**
 * Phase 0 measurements, with no I/O, so they can be tested.
 *
 * Two questions live here:
 *
 *  1. **Is what the SFU forwarded still SFrame?** We receive the RTP packet as
 *     the server saw it, strip the RTP header, and what remains must read as an
 *     SFrame header and decrypt with the sender's key. The AES-GCM tag is what
 *     makes this a proof, not just a read: if the forwarder had touched a single
 *     byte of the payload, decryption would fail.
 *
 *  2. **Did the server ever have a key?** We read the source code of
 *     `servidor.mjs` and search for key material in every form it could be in,
 *     and every path that could bring it from outside.
 *
 * `autoTeste()` runs both against good cases AND against deliberately broken ones.
 * That is the house rule: a measurement that passes with a false premise is not
 * measuring anything. `prova.mjs` runs it BEFORE starting the server-if the
 * measurements do not work, there is no point spinning up browsers.
 */

const HEADER_SFRAME = 11

/**
 * The payload of an RTP packet, without the header.
 *
 * RFC 3550: twelve fixed bytes, then `CC` source identifiers of four bytes
 * each, and then-only if the `X` bit is set-an extension whose length comes
 * in 32-bit words. The `P` bit says the end of the packet is padding, and the
 * last byte says how much.
 *
 * This is not decoration: mediasoup puts header extensions in the packets it
 * forwards (audio level, mid, send time), and whoever ignores the `X` bit reads
 * the payload offset and concludes that SFrame arrived broken-which is exactly
 * the wrong conclusion with the right appearance.
 */
export function payloadDeRtp(pacote) {
  if (pacote.length < 12) return undefined
  const versao = pacote[0] >> 6
  if (versao !== 2) return undefined

  const temEnchimento = (pacote[0] & 0x20) !== 0
  const temExtensao = (pacote[0] & 0x10) !== 0
  const contribuintes = pacote[0] & 0x0f

  let inicio = 12 + contribuintes * 4
  if (temExtensao) {
    if (pacote.length < inicio + 4) return undefined
    const palavras = (pacote[inicio + 2] << 8) | pacote[inicio + 3]
    inicio += 4 + palavras * 4
  }

  let fim = pacote.length
  if (temEnchimento) {
    const enchimento = pacote[pacote.length - 1]
    if (enchimento < 1 || enchimento > fim - inicio) return undefined
    fim -= enchimento
  }

  if (inicio >= fim) return undefined
  return pacote.subarray(inicio, fim)
}

/**
 * What this payload is, from the perspective of someone with the key.
 *
 * Returns `{ cabecalho, claro }` if it is an SFrame frame that decrypts, and
 * `{ cabecalho, erro }` if the header reads but decryption fails-the distinction
 * matters: a readable header with failed decryption is a tampered payload,
 * which is a different failure from "this is not SFrame at all".
 */
export async function abrirSframe(payload, chave) {
  const cabecalho = lerCabecalho(payload)
  if (!cabecalho) return { erro: "sem cabeçalho SFrame" }
  const nonce = new Uint8Array(chave.salt)
  const vista = new DataView(nonce.buffer)
  vista.setUint32(4, vista.getUint32(4, false) ^ Math.floor(cabecalho.counter / 0x100000000), false)
  vista.setUint32(8, vista.getUint32(8, false) ^ (cabecalho.counter >>> 0), false)
  try {
    const claro = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonce, additionalData: payload.slice(0, HEADER_SFRAME) },
        chave.key,
        payload.slice(HEADER_SFRAME),
      ),
    )
    return { cabecalho, claro }
  } catch {
    return { cabecalho, erro: "a tag do AES-GCM não verifica" }
  }
}

/**
 * The same as `readHeader` from `packages/crypto`, rewritten here on purpose.
 *
 * If the analysis used the same function as encryption, a header error would
 * cancel itself: writing and reading wrong gives the same number. A second
 * implementation, drawn from the comment in `sframe.ts` and not from its code,
 * is what makes this read a check.
 */
export function lerCabecalho(frame) {
  if (frame.length < HEADER_SFRAME) return undefined
  if (frame[10] !== 0) return undefined
  // The counter is 48 bits and we count in floating point, not bit shifts:
  // `<<` in JavaScript works on 32 bits signed, and past bit 31 it would
  // silently return a negative number.
  const counter =
    frame[4] * 0x10000000000 + frame[5] * 0x100000000 + frame[6] * 0x1000000 + frame[7] * 0x10000 + frame[8] * 0x100 + frame[9]
  return { keyId: (frame[0] << 8) | frame[1], senderId: (frame[2] << 8) | frame[3], counter }
}

/**
 * What `servidor.mjs` knows that it should not.
 *
 * Returns the list of issues; empty means clean. We search for key material in
 * every form someone could put it there without noticing-hexadecimal, base64,
 * decimal byte list-and also the paths it would enter from outside: importing
 * the key module, importing `@enclave/crypto`, or touching `crypto.subtle`.
 *
 * The last is the most important and least obvious: an SFU that never decrypts
 * has no reason to call `subtle`. If it ever does, someone changed their mind,
 * and this file is what catches it.
 */
export function auditarSegredos(fonte, materialHex) {
  const problemas = []
  const bytes = []
  for (let i = 0; i < materialHex.length; i += 2) bytes.push(Number.parseInt(materialHex.slice(i, i + 2), 16))
  const semEspacos = fonte.replace(/[\s_]/g, "")

  if (semEspacos.toLowerCase().includes(materialHex.toLowerCase())) problemas.push("o material de chave está lá em hexadecimal")
  if (semEspacos.includes(Buffer.from(bytes).toString("base64"))) problemas.push("o material de chave está lá em base64")
  if (semEspacos.includes(bytes.join(","))) problemas.push("o material de chave está lá como lista de bytes")
  if (/from\s*["'][^"']*chave-de-teste/.test(fonte)) problemas.push("importa o módulo da chave de teste")
  if (/from\s*["']@enclave\/crypto["']/.test(fonte)) problemas.push("importa o @enclave/crypto")
  if (/subtle\s*\./.test(fonte)) problemas.push("usa crypto.subtle — um relé não decifra nada")
  return problemas
}

/**
 * Measurements against good cases and against cases deliberately broken.
 *
 * Returns `{ passou, falhou, linhas }`. Each check appears twice:
 * once saying it recognizes the correct case, once saying it REJECTS the wrong case. Only the
 * pair proves anything.
 */
export async function autoTeste() {
  const linhas = []
  let passou = 0
  let falhou = 0
  const check = (rotulo, ok, detalhe = "") => {
    if (ok) {
      passou++
      linhas.push(`  PASS  ${rotulo}`)
    } else {
      falhou++
      linhas.push(`  FAIL  ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`)
    }
  }

  // --- payloadDeRtp ---------------------------------------------------------
  const carga = Uint8Array.from([0xaa, 0xbb, 0xcc, 0xdd, 0xee])
  const simples = montarRtp({ carga })
  check("o payload sai de um RTP simples", igual(payloadDeRtp(simples), carga))

  const comExtensao = montarRtp({ carga, extensao: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]) })
  check("o payload sai de um RTP com extensão de cabeçalho", igual(payloadDeRtp(comExtensao), carga))
  // The mutation that matters: if bit X were ignored, the eight extension bytes
  // would end up in the payload. This line is what ensures they do not.
  const ignorandoX = comExtensao.subarray(12)
  check("uma leitura que ignore o bit X dá outra coisa (a medição morde)", !igual(ignorandoX, carga))

  const comContribuintes = montarRtp({ carga, contribuintes: 2 })
  check("o payload sai de um RTP com CSRC", igual(payloadDeRtp(comContribuintes), carga))

  const comEnchimento = montarRtp({ carga, enchimento: 3 })
  check("o enchimento do fim é descartado", igual(payloadDeRtp(comEnchimento), carga))

  const naoRtp = Uint8Array.from([0x00, 0x00, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 9])
  check("um pacote que não é RTP versão 2 é recusado", payloadDeRtp(naoRtp) === undefined)
  check("um pacote curto de mais é recusado", payloadDeRtp(Uint8Array.from([0x80, 0x6f])) === undefined)

  // --- abrirSframe ----------------------------------------------------------
  const { SframeSender, importSframeKey } = await import("@enclave/crypto")
  const { materialEmBytes, KEY_ID, SENDER_ID, MATERIAL_HEX } = await import("./chave-de-teste.mjs")
  const chave = await importSframeKey(materialEmBytes(), KEY_ID, SENDER_ID)
  const emissor = new SframeSender(chave, 1000)
  const claro = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  const cifrado = await emissor.encrypt(claro)

  const bom = await abrirSframe(cifrado, chave)
  check("um frame cifrado abre com a chave do emissor", igual(bom.claro, claro), bom.erro)
  check("o cabeçalho lê o keyId, o senderId e o contador", bom.cabecalho?.keyId === KEY_ID && bom.cabecalho?.senderId === SENDER_ID && bom.cabecalho?.counter === 1000, JSON.stringify(bom.cabecalho))

  // The central mutation of Phase 0: one byte swapped in the payload and the tag
  // fails verification. This, and only this, is what transforms "the audio arrived" into "the audio
  // arrived intact", and therefore transforms the SFU into a proven relay.
  const adulterado = Uint8Array.from(cifrado)
  adulterado[adulterado.length - 5] ^= 0x01
  const mau = await abrirSframe(adulterado, chave)
  check("um byte trocado no payload faz a decifra falhar", mau.claro === undefined && mau.cabecalho !== undefined, "abriu na mesma")

  const chaveErrada = await importSframeKey(materialEmBytes().map((b, i) => (i === 0 ? b ^ 0xff : b)), KEY_ID, SENDER_ID)
  const comOutraChave = await abrirSframe(cifrado, chaveErrada)
  check("outra chave não abre o frame", comOutraChave.claro === undefined)

  check("um payload que não é SFrame não tem cabeçalho legível", (await abrirSframe(Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9, 9]), chave)).cabecalho === undefined)

  // --- auditarSegredos ------------------------------------------------------
  const limpo = "import * as mediasoup from 'mediasoup'\nconst router = await worker.createRouter({})\n"
  check("uma fonte sem segredos passa a auditoria", auditarSegredos(limpo, MATERIAL_HEX).length === 0)
  check("o material em hexadecimal é apanhado", auditarSegredos(`const k = "${MATERIAL_HEX}"`, MATERIAL_HEX).length > 0)
  const emBase64 = Buffer.from(materialEmBytes()).toString("base64")
  check("o material em base64 é apanhado", auditarSegredos(`const k = "${emBase64}"`, MATERIAL_HEX).length > 0)
  check("o material como lista de bytes é apanhado", auditarSegredos(`const k = [${[...materialEmBytes()].join(", ")}]`, MATERIAL_HEX).length > 0)
  check("importar a chave de teste é apanhado", auditarSegredos(`import { KEY_ID } from "./chave-de-teste.mjs"`, MATERIAL_HEX).length > 0)
  check("importar o @enclave/crypto é apanhado", auditarSegredos(`import { readHeader } from "@enclave/crypto"`, MATERIAL_HEX).length > 0)
  check("chamar o crypto.subtle é apanhado", auditarSegredos(`await crypto.subtle.decrypt(a, b, c)`, MATERIAL_HEX).length > 0)

  return { passou, falhou, linhas }
}

function igual(a, b) {
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** An RTP packet assembled by hand, so the measurements have something to bite against. */
function montarRtp({ carga, extensao, contribuintes = 0, enchimento = 0 }) {
  const cabecalho = 12 + contribuintes * 4 + (extensao ? 4 + extensao.length : 0)
  const pacote = new Uint8Array(cabecalho + carga.length + enchimento)
  pacote[0] = 0x80 | (enchimento ? 0x20 : 0) | (extensao ? 0x10 : 0) | contribuintes
  pacote[1] = 111 // payload type: the usual dynamic Opus
  let i = 12 + contribuintes * 4
  if (extensao) {
    pacote[i] = 0xbe
    pacote[i + 1] = 0xde
    pacote[i + 2] = 0
    pacote[i + 3] = extensao.length / 4
    pacote.set(extensao, i + 4)
    i += 4 + extensao.length
  }
  pacote.set(carga, i)
  if (enchimento) pacote[pacote.length - 1] = enchimento
  return pacote
}
