/**
 * What an MLS frame says about itself in the clear, read without decrypting
 * anything.
 *
 * The server never had to read MLS, and it still does not read the contents.
 * It now needs three numbers that travel in plain sight in the header (the
 * group, the epoch, and whether it is a commit), because without them it cannot
 * do the one thing that keeps a group from splitting: accept ONE commit per
 * epoch. Two commits stored for the same epoch, each author applying their own,
 * are two branches that can never read each other again (common room,
 * 12/9/2026: epochs 12, 16 and 17 at the same time).
 *
 * Parsed by hand, not with `ts-mls`, for two reasons: the server does not load
 * the crypto (the production image does not even carry it patched, see
 * `infra/Dockerfile`), and what is read here is four fixed-size fields and two
 * vectors; the full decoder would pull in everything else just to read this.
 *
 * The structures, from RFC 9420:
 *
 * - `MLSMessage` (§6): `version u16`, `wire_format u16`, and the body.
 * - `PrivateMessage` (§6.3): `group_id<V>`, `epoch u64`, `content_type u8`,
 *   `authenticated_data<V>`, `encrypted_sender_data<V>`, `ciphertext<V>`. The
 *   content type is in the clear on purpose: the RFC keeps it out of the
 *   encryption so that intermediaries can handle handshakes separately.
 * - `PublicMessage` (§6.2): `FramedContent` = `group_id<V>`, `epoch u64`,
 *   `sender` (`sender_type u8`, plus `u32` for `member` and `external`),
 *   `authenticated_data<V>`, `content_type u8`, and the body.
 * - `GroupInfo` (§12.4.3): `GroupContext` (`version u16`, `cipher_suite u16`,
 *   `group_id<V>`, `epoch u64`, `tree_hash<V>`, `confirmed_transcript_hash<V>`,
 *   `extensions<V>`), `extensions<V>`, `confirmation_tag<V>`, `signer u32`,
 *   `signature<V>`.
 * - `<V>` (§2.1.2): length as a QUIC variable-length integer (RFC 9000 §16):
 *   the top two bits say whether it takes 1, 2 or 4 bytes; `0b11` does not
 *   exist in MLS.
 *
 * **Strict in what it reads, tolerant in what it skips.** A value not in the
 * registry, a length that runs past the end, or a `0b11` prefix gives
 * `undefined`, and nothing here throws to the caller. But two tolerances match
 * `ts-mls`, on purpose: lengths encoded in more bytes than needed, and trailing
 * bytes after the frame. A parser stricter than the client would mark as
 * unreadable a commit that the client applies, and an unreadable commit escapes
 * the one-per-epoch rule.
 *
 * How far it checks: in an encrypted message and in a group info card, EVERY
 * field to the end; in a plaintext message, only up to the content type,
 * because the body of a commit (proposals, path, leaf) would need the full
 * decoder again.
 */

export type ConteudoMls = "application" | "proposal" | "commit"
export type RemetenteMls = "member" | "external" | "new_member_proposal" | "new_member_commit"

export type CabecalhoMls =
  | { formato: "public_message"; grupo: Uint8Array; epoch: bigint; remetente: RemetenteMls; conteudo: ConteudoMls }
  | { formato: "private_message"; grupo: Uint8Array; epoch: bigint; conteudo: ConteudoMls }
  | { formato: "group_info"; grupo: Uint8Array; epoch: bigint }
  | { formato: "welcome" }
  | { formato: "key_package" }

const MLS10 = 1

const CONTEUDOS: Record<number, ConteudoMls> = { 1: "application", 2: "proposal", 3: "commit" }
const REMETENTES: Record<number, RemetenteMls> = {
  1: "member",
  2: "external",
  3: "new_member_proposal",
  4: "new_member_commit",
}

/** Thrown only inside this file and caught on the way out: none of it reaches the caller. */
class Ilegivel extends Error {}

class Leitor {
  #bytes: Uint8Array
  #vista: DataView
  #pos = 0

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes
    this.#vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  #avancar(quantos: number): number {
    const inicio = this.#pos
    if (inicio + quantos > this.#bytes.length) throw new Ilegivel()
    this.#pos = inicio + quantos
    return inicio
  }

  u8(): number {
    return this.#vista.getUint8(this.#avancar(1))
  }

  u16(): number {
    return this.#vista.getUint16(this.#avancar(2))
  }

  u32(): number {
    return this.#vista.getUint32(this.#avancar(4))
  }

  u64(): bigint {
    return this.#vista.getBigUint64(this.#avancar(8))
  }

  /** `opaque field<V>`: the QUIC varint length, and the bytes. */
  vector(): Uint8Array {
    const primeiro = this.u8()
    const prefixo = primeiro >> 6
    let comprimento = primeiro & 0b0011_1111
    if (prefixo === 0b11) throw new Ilegivel()
    const mais = prefixo === 0b00 ? 0 : prefixo === 0b01 ? 1 : 3
    for (let i = 0; i < mais; i++) comprimento = comprimento * 256 + this.u8()
    const inicio = this.#avancar(comprimento)
    return this.#bytes.subarray(inicio, inicio + comprimento)
  }

  /** A value that must be in the registry, or the frame cannot be read. */
  registo<T>(tabela: Record<number, T>, valor: number): T {
    const encontrado = tabela[valor]
    if (encontrado === undefined) throw new Ilegivel()
    return encontrado
  }
}

/**
 * The header of an MLS frame, or `undefined` if the bytes are not one.
 *
 * The returned `grupo` is a view into the input bytes, not a copy.
 */
export function lerCabecalhoMls(bytes: Uint8Array): CabecalhoMls | undefined {
  try {
    return ler(new Leitor(bytes))
  } catch {
    // In practice only `Ilegivel`: the `Leitor` checks the end before each
    // read. Catching everything keeps the promise never to throw, even
    // against a bug in this file.
    return undefined
  }
}

/** Whether these bytes are an MLS commit, of any group and epoch. */
export function ehCommit(bytes: Uint8Array): boolean {
  const cabecalho = lerCabecalhoMls(bytes)
  return (
    (cabecalho?.formato === "private_message" || cabecalho?.formato === "public_message") &&
    cabecalho.conteudo === "commit"
  )
}

/**
 * The epoch of a commit for THIS CHANNEL, if the frame is one; otherwise
 * `undefined`.
 *
 * "For this channel" means the group in the header is the channel identifier,
 * which `createChannel` uses as `group_id`. Nobody here applies a commit for
 * another group, so it cannot change the epoch of the members here.
 *
 * An epoch above `Number.MAX_SAFE_INTEGER - 1` also returns `undefined`: no honest
 * group gets there, and the next epoch must still be an exact integer.
 */
export function epochDeCommit(bytes: Uint8Array, channel: string): number | undefined {
  const cabecalho = lerCabecalhoMls(bytes)
  if (cabecalho?.formato !== "private_message" && cabecalho?.formato !== "public_message") return undefined
  if (cabecalho.conteudo !== "commit") return undefined
  return epochDoGrupo(cabecalho, channel)
}

/**
 * Is this an EXTERNAL commit for this channel, i.e. someone joining through the
 * group info card?
 *
 * An external commit always goes in the clear (`PublicMessage`) with the sender
 * `new_member_commit` (RFC 9420 §12.4.3.2), and the group in the header must be
 * this channel. It is the only frame a temporary seat in the common room may
 * send (INV-01, see `Gateway.#relay`).
 */
export function ehCommitExterno(bytes: Uint8Array, channel: string): boolean {
  const cabecalho = lerCabecalhoMls(bytes)
  if (cabecalho?.formato !== "public_message") return false
  if (cabecalho.conteudo !== "commit" || cabecalho.remetente !== "new_member_commit") return false
  return epochDoGrupo(cabecalho, channel) !== undefined
}

/** The epoch described by a group info card for this channel, if the bytes are one. */
export function epochDeCartao(bytes: Uint8Array, channel: string): number | undefined {
  const cabecalho = lerCabecalhoMls(bytes)
  if (cabecalho?.formato !== "group_info") return undefined
  return epochDoGrupo(cabecalho, channel)
}

function epochDoGrupo(cabecalho: { grupo: Uint8Array; epoch: bigint }, channel: string): number | undefined {
  if (cabecalho.epoch > BigInt(Number.MAX_SAFE_INTEGER - 1)) return undefined
  const esperado = new TextEncoder().encode(channel)
  if (cabecalho.grupo.length !== esperado.length) return undefined
  for (let i = 0; i < esperado.length; i++) if (cabecalho.grupo[i] !== esperado[i]) return undefined
  return Number(cabecalho.epoch)
}

function ler(leitor: Leitor): CabecalhoMls {
  if (leitor.u16() !== MLS10) throw new Ilegivel()
  const formato = leitor.u16()

  switch (formato) {
    case 1: {
      const grupo = leitor.vector()
      const epoch = leitor.u64()
      const remetente = leitor.registo(REMETENTES, leitor.u8())
      if (remetente === "member" || remetente === "external") leitor.u32()
      leitor.vector() // authenticated_data
      const conteudo = leitor.registo(CONTEUDOS, leitor.u8())
      return { formato: "public_message", grupo, epoch, remetente, conteudo }
    }

    case 2: {
      const grupo = leitor.vector()
      const epoch = leitor.u64()
      const conteudo = leitor.registo(CONTEUDOS, leitor.u8())
      leitor.vector() // authenticated_data
      leitor.vector() // encrypted_sender_data
      leitor.vector() // ciphertext
      return { formato: "private_message", grupo, epoch, conteudo }
    }

    case 3:
      return { formato: "welcome" }

    case 4: {
      if (leitor.u16() !== MLS10) throw new Ilegivel()
      leitor.u16() // cipher_suite
      const grupo = leitor.vector()
      const epoch = leitor.u64()
      leitor.vector() // tree_hash
      leitor.vector() // confirmed_transcript_hash
      leitor.vector() // context extensions
      leitor.vector() // GroupInfo extensions
      leitor.vector() // confirmation_tag
      leitor.u32() // signer
      leitor.vector() // signature
      return { formato: "group_info", grupo, epoch }
    }

    case 5:
      return { formato: "key_package" }

    default:
      throw new Ilegivel()
  }
}
