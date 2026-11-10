import {
  partesDoVideo,
  VIDEO_BYTES_POR_PARTE,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_SEGUNDOS,
  videoAceite,
  type Attachment,
  type ParteDeVideo,
  type PartesDoVideo,
} from "@enclave/protocol"
import { base64ParaBytes, bytesParaBase64, entradasDoCanal, videoCabeNoCofre, videoNoCofre, type VaultContents } from "./vault.js"

/**
 * Video in posts, in the core (26/10/2026). The wire format is in
 * `video.ts` of the protocol: the `post` carries the attachment without bytes, and the bytes follow
 * in parts, each in an expired `typing`.
 *
 * This module holds the rules and memory. The session just bridges: it sends the
 * parts we give it and delivers the parts that arrive (`#aoParteDeVideo`).
 *
 * **Where the bytes live.** In three places, in this order:
 *
 * 1. Session memory (`MEMORIA_BYTES`). Both the publisher and receiver see the
 *    video from here while the app is open.
 * 2. The vault, within the media budget (`guardarVideo`). Today the budget
 *    is 4 million characters for everything: only one small video fits, and it leaves
 *    first when space runs out.
 * 3. Other members (S5): those who no longer have it ask for it, and those who have it send
 *    the parts again. The SHA-256 hash of the attachment verifies them.
 */

/** Error messages, stable: the UI gives them the code (`codigosDeErro.ts`). */
export const ERROS_DO_VIDEO = {
  grande: "the video is too large",
  longo: "the video is too long",
  formato: "this video format is not accepted",
  cancelado: "the video upload was cancelled",
  /** A send is already in progress: one at a time. */
  ocupado: "a video upload is already in progress",
  /** The send failed midway (no connection, for example). The post deletes itself, as in cancellation. */
  falhou: "the video upload failed",
} as const

/** What the UI delivers for publishing: the bytes and what it read from them. */
export interface VideoAPublicar {
  bytes: Uint8Array
  name: string
  mediaType: string
  /** Seconds, read by the UI from an off-screen `<video>` element. */
  duration: number
  /** The thumbnail, already downsized, as an image data URL. */
  poster?: string
}

/** The state of a video. See `VideosDaSessao.estado`. */
export type EstadoDoVideo =
  | { fase: "pronto" }
  | { fase: "a-enviar" | "a-receber"; feitas: number; de: number }
  | { fase: "sem-bytes" }

/** The `video` event of the session. */
export type EventoDoVideo =
  | { sha: string; fase: "a-enviar" | "a-receber"; feitas: number; de: number }
  | { sha: string; fase: "pronto" | "cancelado" | "falhou" }

/**
 * Video bytes that the session holds in memory. Four videos at the limit: the
 * one just published and viewed. Older ones leave first.
 */
export const MEMORIA_BYTES = 4 * VIDEO_MAX_BYTES

/**
 * Bytes of parts waiting to complete a video, maximum. Two videos at the limit
 * at the same time. Beyond that, the oldest assembly leaves: if anyone wants it
 * they ask other members for the video.
 */
export const MONTAGENS_BYTES = 2 * VIDEO_MAX_BYTES

/** Videos announced, cached in memory (see `VideosDaSessao.esperar`). */
const ESPERADOS_MAX = 256

/** Validate before sending. Throws with the stable message and the limit in `cause`. */
export function validarVideo(video: Pick<VideoAPublicar, "bytes" | "mediaType" | "duration">): void {
  if (!videoAceite(video.mediaType)) throw new Error("this video format is not accepted", { cause: { tipo: video.mediaType } })
  if (video.bytes.length > VIDEO_MAX_BYTES) throw new Error("the video is too large", { cause: { max: VIDEO_MAX_BYTES } })
  if (!Number.isFinite(video.duration) || video.duration > VIDEO_MAX_SEGUNDOS) {
    throw new Error("the video is too long", { cause: { max: VIDEO_MAX_SEGUNDOS } })
  }
}

/** The SHA-256 of some bytes, in base64url without padding (43 characters). */
export async function resumoDoVideo(bytes: Uint8Array): Promise<string> {
  const resumo = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>))
  return bytesParaBase64(resumo)
}

/** The parts of some bytes: views over the same buffer, no copies. */
export function partir(bytes: Uint8Array, porParte = VIDEO_BYTES_POR_PARTE): Uint8Array[] {
  const partes: Uint8Array[] = []
  for (let inicio = 0; inicio < bytes.length; inicio += porParte) partes.push(bytes.subarray(inicio, inicio + porParte))
  return partes.length > 0 ? partes : [bytes]
}

/** The correct size of part `indice` of a video of `total` bytes. */
export function tamanhoDaParte(partes: PartesDoVideo, total: number, indice: number): number {
  if (indice < partes.n - 1) return partes.bytes
  return total - partes.bytes * (partes.n - 1)
}

/** The base64url characters (no padding) of `bytes` bytes. */
export function caracteresDeBase64(bytes: number): number {
  return Math.ceil((bytes * 4) / 3)
}

/**
 * The parts that an attachment says it has, if it is a video in parts.
 *
 * Only videos that this version publishes: up to `VIDEO_MAX_BYTES`, in parts of
 * `VIDEO_BYTES_POR_PARTE`. The scheme is loose on purpose (a future version
 * may accept more), but the receiver reserves memory for what the attachment says:
 * without this limit, a 768 MB attachment in 3 MB parts would pass, and assembly
 * would request 768 MB at once.
 */
export function partesDoAnexo(anexo: unknown): (PartesDoVideo & { byteLength: number }) | null {
  if (typeof anexo !== "object" || anexo === null) return null
  const registo = anexo as Record<string, unknown>
  const partes = registo["partes"] as PartesDoVideo | undefined
  const total = registo["byteLength"]
  if (!partes || typeof partes.sha256 !== "string" || typeof total !== "number") return null
  if (!Number.isSafeInteger(partes.n) || !Number.isSafeInteger(partes.bytes) || partes.n < 1 || partes.bytes < 1) return null
  if (!Number.isSafeInteger(total) || total > VIDEO_MAX_BYTES || partes.bytes !== VIDEO_BYTES_POR_PARTE) return null
  // The math must check out: n parts of `bytes`, the last with the remainder.
  if (total <= partes.bytes * (partes.n - 1) || total > partes.bytes * partes.n) return null
  return { ...partes, byteLength: total }
}

/** The video attachment with this hash, in a post saved to this channel. */
export function anexoDoVideo(contents: VaultContents, canal: string, sha: string): (PartesDoVideo & { byteLength: number }) | null {
  for (const entrada of entradasDoCanal(contents, canal)) {
    if (entrada.payload.t !== "post") continue
    const media = entrada.payload["media"]
    if (!Array.isArray(media)) continue
    for (const anexo of media) {
      const partes = partesDoAnexo(anexo)
      if (partes && partes.sha256 === sha) return partes
    }
  }
  return null
}

/** The hashes of the videos in a list of attachments. */
export function resumosDosVideos(media: unknown): string[] {
  if (!Array.isArray(media)) return []
  const resumos: string[] = []
  for (const anexo of media) {
    const partes = partesDoAnexo(anexo)
    if (partes) resumos.push(partes.sha256)
  }
  return resumos
}

/**
 * Whether any live post in the vault uses the video `sha`, not counting the post
 * `excepto` (the one just deleted). Live: no tombstone from the author in the
 * same channel. The same video can be in two posts; it only leaves the vault
 * when no post uses it.
 */
export function videoEmUso(contents: VaultContents, sha: string, excepto?: { canal: string; id: string }): boolean {
  const canais = new Set([...Object.keys(contents.history), ...Object.keys(contents.estadoDoCanal ?? {})])
  for (const canal of canais) {
    const entradas = entradasDoCanal(contents, canal)
    const apagadas = new Set<string>()
    for (const entrada of entradas) {
      if (entrada.payload.t === "redact") apagadas.add(`${entrada.sender}|${String(entrada.payload["target"])}`)
    }
    for (const entrada of entradas) {
      if (entrada.payload.t !== "post") continue
      const id = String(entrada.payload["id"])
      if (canal === excepto?.canal && id === excepto.id) continue
      if (apagadas.has(`${entrada.sender}|${id}`)) continue
      if (resumosDosVideos(entrada.payload["media"]).includes(sha)) return true
    }
  }
  return false
}

/** A byte memory with a limit, ordered by use: least used leaves first. */
export class MemoriaDeVideos {
  readonly #porSha = new Map<string, Uint8Array>()
  #total = 0
  constructor(readonly tecto = MEMORIA_BYTES) {}

  guardar(sha: string, bytes: Uint8Array): void {
    this.apagar(sha)
    if (bytes.length > this.tecto) return
    this.#porSha.set(sha, bytes)
    this.#total += bytes.length
    for (const [antigo, guardado] of this.#porSha) {
      if (this.#total <= this.tecto) break
      this.#porSha.delete(antigo)
      this.#total -= guardado.length
    }
  }

  obter(sha: string): Uint8Array | null {
    const bytes = this.#porSha.get(sha)
    if (!bytes) return null
    // To the end of the queue: used now, leaves last.
    this.#porSha.delete(sha)
    this.#porSha.set(sha, bytes)
    return bytes
  }

  apagar(sha: string): void {
    const bytes = this.#porSha.get(sha)
    if (!bytes) return
    this.#porSha.delete(sha)
    this.#total -= bytes.length
  }

  get total(): number {
    return this.#total
  }
}

interface Montagem {
  sha: string
  canal: string
  partes: (Uint8Array | undefined)[]
  feitas: number
  bytes: number
  esperado: PartesDoVideo & { byteLength: number }
}

/** What the session gives to `VideosDaSessao`. */
export interface PortaDosVideos {
  conteudo(): VaultContents
  /** Save to the vault (within budget). Returns whether it fit. */
  guardarNoCofre(sha: string, b64: string): Promise<boolean>
  /** Delete video bytes from the vault (cancelled, or no live post). */
  apagarDoCofre?(sha: string): Promise<void>
  enviarParte(canal: string, parte: ParteDeVideo): Promise<void>
  emitir(evento: EventoDoVideo): void
  /** A part of `sha` arrived from `aparelho` (`completo`: the video is complete and verified). For S5 requests. */
  aoChegar?(canal: string, sha: string, completo: boolean, aparelho: string): void
}

/**
 * Videos in a session: publish, receive and serve.
 *
 * One send at a time, because there is only one thread and the user sees progress.
 */
export class VideosDaSessao {
  readonly #porta: PortaDosVideos
  readonly #memoria: MemoriaDeVideos
  /**
   * Assemblies in progress, keyed by `sha|aparelho`: each device that sends parts
   * has its own. By hash alone, the first part that arrived would stick, and any
   * member could poison the assembly with garbage of the right size.
   */
  readonly #montagens = new Map<string, Montagem>()
  /**
   * Videos that posts received in this session announced, by channel
   * and hash. The post arrives before the parts, but the vault only sees it on the
   * next save: without this, the first parts would reach a vault that
   * did not yet know about the video, and they would be rejected.
   */
  readonly #esperados = new Map<string, PartesDoVideo & { byteLength: number }>()
  #envio: { sha: string; feitas: number; de: number; cancelado: boolean } | null = null

  /** Whether a send is in progress. One at a time: see `enviarPartes`. */
  get aEnviar(): boolean {
    return this.#envio !== null
  }

  constructor(porta: PortaDosVideos, memoria = new MemoriaDeVideos()) {
    this.#porta = porta
    this.#memoria = memoria
  }

  /**
   * Prepare a video for publishing: validate, hash, save the bytes (in
   * memory and, if it fits, in the vault) and return the attachment for the `post`.
   */
  async preparar(video: VideoAPublicar): Promise<{ anexo: Attachment; sha: string }> {
    validarVideo(video)
    const sha = await resumoDoVideo(video.bytes)
    const n = partesDoVideo(video.bytes.length)
    this.#memoria.guardar(sha, video.bytes)
    await this.#guardarNoCofre(sha, video.bytes)
    const anexo: Attachment = {
      url: "",
      key: "",
      nonce: "",
      digest: "",
      kind: "video",
      name: video.name,
      mediaType: video.mediaType,
      duration: video.duration,
      byteLength: video.bytes.length,
      ...(video.poster ? { poster: video.poster } : {}),
      partes: { n, sha256: sha, bytes: VIDEO_BYTES_POR_PARTE },
    }
    return { anexo, sha }
  }

  /**
   * Send the parts of a prepared video, one by one, to `canal`. Throws
   * `ERROS_DO_VIDEO.cancelado` if the user cancels midway.
   */
  async enviarPartes(canal: string, sha: string): Promise<void> {
    // One send at a time: a second one would overwrite the first one's state, and "Cancel" would stop the wrong one.
    if (this.#envio) throw new Error("a video upload is already in progress")
    const bytes = this.bytes(sha)
    if (!bytes) throw new Error("the video upload was cancelled")
    const partes = partir(bytes)
    const envio = { sha, feitas: 0, de: partes.length, cancelado: false }
    this.#envio = envio
    try {
      for (const [indice, parte] of partes.entries()) {
        if (envio.cancelado) throw new Error("the video upload was cancelled")
        await this.#porta.enviarParte(canal, { sha, parte: indice, de: partes.length, dados: bytesParaBase64(parte) })
        envio.feitas = indice + 1
        this.#porta.emitir({ sha, fase: "a-enviar", feitas: envio.feitas, de: envio.de })
      }
      this.#porta.emitir({ sha, fase: "pronto" })
    } catch (erro) {
      this.#porta.emitir({ sha, fase: envio.cancelado ? "cancelado" : "falhou" })
      throw envio.cancelado ? new Error("the video upload was cancelled") : erro
    } finally {
      if (this.#envio === envio) this.#envio = null
    }
  }

  /** Cancel the send in progress. The part being sent completes; the next one does not. */
  cancelarEnvio(): boolean {
    if (!this.#envio || this.#envio.cancelado) return false
    this.#envio.cancelado = true
    return true
  }

  /**
   * Forget the bytes of a video (the send was cancelled or failed, and the
   * post deleted): from memory, from assemblies and from the vault.
   */
  async esquecer(sha: string): Promise<void> {
    this.#memoria.apagar(sha)
    for (const [chave, montagem] of this.#montagens) if (montagem.sha === sha) this.#montagens.delete(chave)
    await this.#porta.apagarDoCofre?.(sha).catch(() => {})
  }

  /**
   * Publication `id` in `channel` was deleted: its videos that no other live
   * publication uses are removed from memory and the vault.
   */
  async largarDaPublicacao(canal: string, id: string, shas: readonly string[]): Promise<void> {
    for (const sha of shas) {
      if (this.#envio?.sha === sha) continue
      if (videoEmUso(this.#porta.conteudo(), sha, { canal, id })) continue
      await this.esquecer(sha)
    }
  }

  /** Store in the vault only if it fits: a video that doesn't fit won't be encoded to base64. */
  async #guardarNoCofre(sha: string, bytes: Uint8Array): Promise<void> {
    if (!videoCabeNoCofre(this.#porta.conteudo(), caracteresDeBase64(bytes.length))) return
    await this.#porta.guardarNoCofre(sha, bytesParaBase64(bytes)).catch(() => false)
  }

  /** A publication arrived in `channel`: its videos are now expected. */
  esperar(canal: string, media: unknown): void {
    if (!Array.isArray(media)) return
    for (const anexo of media) {
      const partes = partesDoAnexo(anexo)
      if (!partes) continue
      this.#esperados.set(`${canal}|${partes.sha256}`, partes)
      // A map that only grows is a leak: the oldest entries are evicted.
      if (this.#esperados.size > ESPERADOS_MAX) {
        const [maisAntigo] = this.#esperados.keys()
        if (maisAntigo !== undefined) this.#esperados.delete(maisAntigo)
      }
    }
  }

  /**
   * A chunk arrived from device `aparelho` (MLS authenticates it). It only counts if
   * a publication in this channel reports this hash, and if the size matches what
   * it says. Each device assembles its chunk independently: garbage from one doesn't
   * break another's assembly. When complete, the video is stored only if the SHA-256
   * of the bytes matches the publication's hash.
   */
  async aoParte(canal: string, parte: ParteDeVideo, aparelho: string): Promise<void> {
    const { sha } = parte
    if (this.#memoria.obter(sha) || this.#envio?.sha === sha) return
    const chave = `${sha}|${aparelho}`
    const existente = this.#montagens.get(chave)
    // An assembly belongs to one channel: the same chunk in another channel doesn't complete it.
    if (existente && existente.canal !== canal) return
    const esperado =
      existente?.esperado ?? this.#esperados.get(`${canal}|${sha}`) ?? anexoDoVideo(this.#porta.conteudo(), canal, sha)
    if (!esperado || parte.de !== esperado.n || existente?.partes[parte.parte] !== undefined) return
    let dados: Uint8Array
    try {
      dados = base64ParaBytes(parte.dados)
    } catch {
      return
    }
    if (dados.length !== tamanhoDaParte(esperado, esperado.byteLength, parte.parte)) return
    // Only a valid chunk opens the assembly: a bad chunk doesn't reserve memory.
    const montagem = existente ?? { sha, canal, partes: new Array<Uint8Array | undefined>(esperado.n), feitas: 0, bytes: 0, esperado }
    this.#montagens.set(chave, montagem)
    montagem.partes[parte.parte] = dados
    montagem.feitas += 1
    montagem.bytes += dados.length
    this.#apararMontagens(chave)
    if (montagem.feitas < esperado.n) {
      this.#porta.emitir({ sha, fase: "a-receber", feitas: this.#feitasDe(sha), de: esperado.n })
      this.#porta.aoChegar?.(canal, sha, false, aparelho)
      return
    }
    this.#montagens.delete(chave)
    let inteiro: Uint8Array | null = null
    try {
      const juntos = new Uint8Array(esperado.byteLength)
      let onde = 0
      for (const bocado of montagem.partes as Uint8Array[]) {
        juntos.set(bocado, onde)
        onde += bocado.length
      }
      if ((await resumoDoVideo(juntos)) === sha) inteiro = juntos
    } catch {
      // No memory to assemble: same as bytes that don't match.
    }
    if (!inteiro) {
      // The bytes from this device don't match the hash. Another device still might.
      if (!this.#aMontar(sha)) this.#porta.emitir({ sha, fase: "falhou" })
      return
    }
    for (const [outra, outraMontagem] of this.#montagens) if (outraMontagem.sha === sha) this.#montagens.delete(outra)
    this.#memoria.guardar(sha, inteiro)
    await this.#guardarNoCofre(sha, inteiro)
    this.#porta.emitir({ sha, fase: "pronto" })
    this.#porta.aoChegar?.(canal, sha, true, aparelho)
  }

  /** Whether any device is still assembling `sha`. */
  #aMontar(sha: string): boolean {
    for (const montagem of this.#montagens.values()) if (montagem.sha === sha) return true
    return false
  }

  /** The chunks of `sha` that have arrived, in the most advanced assembly. */
  #feitasDe(sha: string): number {
    let feitas = 0
    for (const montagem of this.#montagens.values()) if (montagem.sha === sha) feitas = Math.max(feitas, montagem.feitas)
    return feitas
  }

  /** Assemblies over the cap (all together) are evicted, oldest first. Never the one just touched. */
  #apararMontagens(atual: string): void {
    let total = 0
    for (const montagem of this.#montagens.values()) total += montagem.bytes
    for (const [chave, montagem] of this.#montagens) {
      if (total <= MONTAGENS_BYTES) break
      if (chave === atual) continue
      this.#montagens.delete(chave)
      total -= montagem.bytes
    }
  }

  /** The bytes of a video: from memory or the vault. `null` if this device doesn't have them. */
  bytes(sha: string): Uint8Array | null {
    const emMemoria = this.#memoria.obter(sha)
    if (emMemoria) return emMemoria
    const b64 = videoNoCofre(this.#porta.conteudo(), sha)
    if (b64 === null) return null
    try {
      const bytes = base64ParaBytes(b64)
      this.#memoria.guardar(sha, bytes)
      return bytes
    } catch {
      return null
    }
  }

  estado(sha: string): EstadoDoVideo {
    if (this.#envio?.sha === sha) return { fase: "a-enviar", feitas: this.#envio.feitas, de: this.#envio.de }
    if (this.#memoria.obter(sha) || this.bytes(sha)) return { fase: "pronto" }
    for (const montagem of this.#montagens.values()) {
      if (montagem.sha === sha) return { fase: "a-receber", feitas: this.#feitasDe(sha), de: montagem.esperado.n }
    }
    return { fase: "sem-bytes" }
  }

  /**
   * Serve a video to the requester (S5): its chunks again, with the request's `q`.
   * `vez` decides if each chunk can be sent (responder caps), and receives what the
   * chunk weighs ON THE WIRE: the base64 data and the rest of `typing` (256 spare).
   * The first refusal stops. Returns whether all were sent.
   */
  async servir(canal: string, sha: string, q: string, vez: (bytes: number) => Promise<boolean>): Promise<boolean> {
    const bytes = this.bytes(sha)
    if (!bytes) return false
    const partes = partir(bytes)
    for (const [indice, parte] of partes.entries()) {
      if (!(await vez(caracteresDeBase64(parte.length) + 256))) return false
      await this.#porta.enviarParte(canal, { sha, parte: indice, de: partes.length, dados: bytesParaBase64(parte), q })
    }
    return true
  }
}
