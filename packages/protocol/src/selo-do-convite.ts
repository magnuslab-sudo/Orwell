import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { hkdf } from "@noble/hashes/hkdf.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { fromBase64, toBase64 } from "./canonical.js"

/**
 * The invite seal: the channel name, encrypted with the code (1.0 "Arca", slice 5c).
 *
 * **The problem.** With opaque addresses (slice 3), a channel address does not
 * reveal the name. The name lives only inside the channel's encrypted state
 * (`room.created`, `space.meta`), and anyone opening an invite is not yet inside. The invite
 * prompt showed the address: "Invite to i8rwt9b44ce…".
 *
 * **The choice.** The invite creator seals the channel name (and their own name, if
 * they have one) with a key derived from the invite code, and sends the seal in
 * `invite.create`. The server stores it and returns it to anyone who requests it by invite.
 * The person opening the link has the code in the fragment, and only they open the
 * seal. The server stores bytes it cannot read: without the code, which never
 * reaches it, the seal is noise of fixed size `SELO_DO_CONVITE_BYTES`.
 *
 * **The size is always the same**, on purpose: a seal of variable size would tell
 * the server how many letters the name has. The text goes in a fixed block of
 * `TEXTO_DO_SELO_BYTES`, padded with zeros.
 *
 * **What the seal does not prove.** That the name is true. The invite creator
 * writes anything, and the server accepts `invite.create` from any account. It only proves
 * that the name comes from whoever had the code, not from the server or the network:
 * a swapped seal (from another invite or tampered) does not open, and the prompt
 * says "a channel".
 *
 * Key: HKDF-SHA256 of the code, with its own label (key domain separation from the
 * proof key, `prova-do-convite.ts`). Cipher: XChaCha20-Poly1305 with random nonce of 24 bytes,
 * like the vault and the pairing box. The label goes in the associated data too.
 *
 * Text format: `versão (1 byte) | n (2 bytes) | nome do canal (n bytes) |
 * m (2 bytes) | nome de quem convida (m bytes) | zeros`. UTF-8.
 */
const DOMINIO_DA_CHAVE = new TextEncoder().encode("orwell/convite/chave-do-selo/v1")
const DADOS_ASSOCIADOS = new TextEncoder().encode("orwell/convite/selo/v1")
const VERSAO_DO_SELO = 1
const NONCE_BYTES = 24
const ETIQUETA_BYTES = 16

/** The channel name fits here (the `space.meta` is 100 units, up to 300 bytes). */
export const NOME_DO_CANAL_NO_SELO_BYTES = 300
/** The inviter name fits here (the profile is 64 units, up to 192 bytes). */
export const NOME_DE_QUEM_NO_SELO_BYTES = 192
/** The fixed block of text, before encryption. */
export const TEXTO_DO_SELO_BYTES = 512
/** The entire seal, in bytes: nonce, text, and tag. */
export const SELO_DO_CONVITE_BYTES = NONCE_BYTES + TEXTO_DO_SELO_BYTES + ETIQUETA_BYTES
/**
 * The seal cap in the wire, in base64url characters. The server refuses anything
 * larger. It leaves room for a future version without letting the table store
 * what it cannot.
 */
export const SELO_DO_CONVITE_MAX_CARACTERES = 1024

/** What goes inside the seal. */
export interface NomeDoConvite {
  canal: string
  quem?: string
}

function chaveDoSelo(codigo: string): Uint8Array {
  return hkdf(sha256, new TextEncoder().encode(codigo), undefined, DOMINIO_DA_CHAVE, 32)
}

/** Trim a text to `limite` bytes of UTF-8 without breaking a character. */
function cortarEmBytes(texto: string, limite: number): Uint8Array {
  const codificador = new TextEncoder()
  const inteiro = codificador.encode(texto)
  if (inteiro.length <= limite) return inteiro
  let cortado = ""
  let usados = 0
  for (const caracter of texto) {
    const tamanho = codificador.encode(caracter).length
    if (usados + tamanho > limite) break
    cortado += caracter
    usados += tamanho
  }
  return codificador.encode(cortado)
}

/** Seal the channel name (and the inviter name) with the invite code. Returns base64url. */
export function selarNomeDoConvite(codigo: string, nome: NomeDoConvite): string {
  const canal = cortarEmBytes(nome.canal, NOME_DO_CANAL_NO_SELO_BYTES)
  const quem = cortarEmBytes(nome.quem ?? "", NOME_DE_QUEM_NO_SELO_BYTES)
  const texto = new Uint8Array(TEXTO_DO_SELO_BYTES)
  const vista = new DataView(texto.buffer)
  texto[0] = VERSAO_DO_SELO
  vista.setUint16(1, canal.length)
  texto.set(canal, 3)
  vista.setUint16(3 + canal.length, quem.length)
  texto.set(quem, 5 + canal.length)

  const chave = chaveDoSelo(codigo)
  try {
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
    const cifrado = xchacha20poly1305(chave, nonce, DADOS_ASSOCIADOS).encrypt(texto)
    const selo = new Uint8Array(NONCE_BYTES + cifrado.length)
    selo.set(nonce, 0)
    selo.set(cifrado, NONCE_BYTES)
    return toBase64(selo)
  } finally {
    chave.fill(0)
    texto.fill(0)
  }
}

/**
 * Open a seal with the link code. `null` when it does not open: wrong code,
 * seal tampered, swapped, from another version, or malformed. Never throws.
 */
export function abrirSeloDoConvite(codigo: string, selo: string): NomeDoConvite | null {
  let bytes: Uint8Array
  try {
    bytes = fromBase64(selo)
  } catch {
    return null
  }
  if (bytes.length !== SELO_DO_CONVITE_BYTES) return null

  const chave = chaveDoSelo(codigo)
  let texto: Uint8Array
  try {
    texto = xchacha20poly1305(chave, bytes.subarray(0, NONCE_BYTES), DADOS_ASSOCIADOS).decrypt(bytes.subarray(NONCE_BYTES))
  } catch {
    return null
  } finally {
    chave.fill(0)
  }

  try {
    if (texto[0] !== VERSAO_DO_SELO) return null
    const vista = new DataView(texto.buffer, texto.byteOffset, texto.byteLength)
    const n = vista.getUint16(1)
    if (n === 0 || n > NOME_DO_CANAL_NO_SELO_BYTES) return null
    const m = vista.getUint16(3 + n)
    if (m > NOME_DE_QUEM_NO_SELO_BYTES) return null
    // `fatal`: bytes that are not UTF-8 are a wrong seal, not a name with "?".
    const descodificador = new TextDecoder("utf-8", { fatal: true })
    const canal = descodificador.decode(texto.subarray(3, 3 + n))
    const quem = m > 0 ? descodificador.decode(texto.subarray(5 + n, 5 + n + m)) : ""
    // The rest must be zeros: text with garbage after the end is not ours.
    for (let i = 5 + n + m; i < texto.length; i++) if (texto[i] !== 0) return null
    return quem ? { canal, quem } : { canal }
  } catch {
    return null
  } finally {
    texto.fill(0)
  }
}
