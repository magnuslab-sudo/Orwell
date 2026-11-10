import { sha256 } from "@noble/hashes/sha2.js"
import {
  abrirBloco,
  abrirSinal,
  chaveDoHistorico,
  epocaDoSinal,
  novoParDoHistorico,
  selarBloco,
  selarSinal,
  type ChaveDoSinal,
  type ParDoHistorico,
} from "@enclave/crypto"
import { canonicoTolerante, fromBase64, toBase64, verify } from "@enclave/protocol"
import {
  base64ParaBytes,
  fundirEntradasDoIrmao,
  guardarVideo,
  juntarMediaDoIrmao,
  type EstadoDoHistorico,
  type ItemDeMediaDoIrmao,
  type VaultContents,
} from "../vault.js"
import {
  chaveDoItem,
  entradaValida,
  faltaAqui,
  fichaDoIrmao,
  fundirRegistosDoIrmao,
  inventarioDe,
  mediaDe,
  mediaInteiraDe,
  paginaDe,
  pedidoDe,
  resumoDoHistorico,
  TECTOS_DO_HISTORICO,
  type ContextoDoIrmao,
  type Inventario,
  type MediaInteira,
  type MediaNoIrmao,
  type PaginaDoHistorico,
} from "./conteudo.js"

/**
 * The history between devices of the same account (1.0 "Arca", 29/10/2026).
 *
 * The owner's request: "all history and all media" move to the new device
 * during pairing, without prompts or questions ("I want it out"). And what one
 * device has and another device in the account lost (by being offline) passes
 * between them through the account channel.
 *
 * ## The path
 *
 * Ephemeral signals (`channel.sinal`) from the ACCOUNT CHANNEL, which the
 * server passes to whoever is online and does not store. Why these, and not MLS
 * messages:
 *
 * - an MLS message costs a ratchet generation for the sender, and an offline
 *   sibling must skip them (capped at 512): a thousand pages would deafen it;
 * - an MLS message stays on the server for thirty days: the entire account
 *   history would sit there encrypted for a month;
 * - a new `t` in a channel is rejected by an old sibling, and five rejections
 *   make it deaf to the channel (rule 1i (c)). A 1.0.4 sibling does not read
 *   account channel signals (anti-entropy does not run there: `elegivel`), and
 *   drops them without counting toward deafness.
 *
 * **The server does not change.** Its caps enforce (`TECTOS_DO_SINAL`: 120
 * signals per connection per minute, 16 KiB each, 4 MiB per channel per
 * minute). This module uses at most `sinaisPorMinuto` (40): anti-entropy uses up
 * to 60 of the same 120.
 *
 * ## The cipher
 *
 * Two layers. Outside, the signal key for the account channel's epoch: only
 * devices of the account can open it. Inside, a key for just the two devices
 * talking (ephemeral X25519, `historico.ts` in `@enclave/crypto`). Each signal
 * carries the signature of the device that sends it, and the receiver checks it
 * against the leaves of the account channel: only a device of the account
 * speaks here.
 *
 * ## The wire
 *
 * - `hi`: the caller opens a session (the ephemeral public key).
 * - `hn`: the responder sends the inventory (the channels, how many entries and
 *   the summary of each one), with its public key. The session key derives from
 *   here.
 * - `hp`: a request (a page from a channel, the media list, some media).
 * - `hr`: the response, split into signals.
 * - `hx`: "I do not know that session" (the responder restarted): request another.
 *
 * ## Resumable
 *
 * The plan (which channels, how far, which media are missing) lives in the vault
 * (`EstadoDoHistorico`). A connection that drops, or the app that closes, leaves
 * the plan where it was; the next connection opens another session and continues
 * from the cursor. A repeated page does not duplicate anything (`fundirEntradasDoIrmao`).
 */

/** The wire numbers. Mutable only for tests to lower them. */
export const TECTOS_DO_FIO_DO_HISTORICO = {
  /** Signals per minute, from the caller and the responder. The server caps at 120; anti-entropy uses up to 60. */
  sinaisPorMinuto: 40,
  /** The largest signal that goes out, in characters. The server rejects above 16 KiB. */
  sinalMaxCaracteres: 12 * 1024,
  /** Bytes of each part of a response. With the header and the two ciphers, it stays below `sinalMaxCaracteres`. */
  bytesPorParte: 8 * 1024,
  /** Without a new part of a response during this time, request what is missing. */
  esperaDaRespostaMs: 30_000,
  /** Times to request the same thing again before dropping the session. */
  tentativasPorPedido: 3,
  /** Without an inventory in response to a `hi` during this time, another `hi` can go out. */
  esperaDoInventarioMs: 20_000,
  /** A newly paired device requests history every `esperaDoInventarioMs`; after that, only every ten minutes. */
  inicialRapidoMs: 10 * 60_000,
  intervaloLentoMs: 10 * 60_000,
  /** The "initial" stops being requested after a week: the sibling never answered (it is old). */
  inicialDuraMs: 7 * 24 * 3_600_000,
  /**
   * Between already paired siblings: one request per connection, `primeiraReposicaoMs`
   * after connecting (server recovery runs first), and never two less than
   * `intervaloDaReposicaoMs` apart (a connection that goes and comes on a phone
   * does not request every time).
   */
  primeiraReposicaoMs: 15_000,
  intervaloDaReposicaoMs: 2 * 60_000,
  /** The clock step. */
  passoMs: 2_000,
  /** The responder forgets a silent session during this time. */
  sessaoCaladaMs: 30 * 60_000,
  /** Stored responses to request missing parts: up to this many bytes, for this long. */
  guardadasBytes: 16 * 1024 * 1024,
  guardadasMs: 5 * 60_000,
  /** Parts of a response, at most. 4096 parts of 8 KiB are 32 MiB. */
  partesMax: 4_096,
  /** The text of a response, after decompression, at most. */
  descomprimidoMax: 64 * 1024 * 1024,
}

/** What the module needs from the session. */
export interface PortaDoHistorico {
  eu(): { address: string; aparelho: Uint8Array; assinar: (mensagem: Uint8Array) => Uint8Array }
  conteudo(): VaultContents | null
  /** The account channel, or empty. */
  canalDaConta(): string
  /** The account channel group exists and is actually for the account. */
  contaPronta(): Promise<boolean>
  /** The device keys (base64url) of the leaves of this account in the account channel. */
  folhasDaConta(): string[]
  derivarChave(): Promise<ChaveDoSinal | null>
  /** Connected, and the server forwards signals. */
  podeSinalizar(): boolean
  enviarSinal(sinal: string, ref: string): void
  /** A change to the vault, in the session's write batch. */
  gravar(mudar: (contents: VaultContents) => void): void
  temGrupo(canal: string): boolean
  bloqueado(canal: string, autor: string): boolean
  lugar(canal: string): { seq: number; em: number } | null | undefined
  emitir(evento: EventoDoHistorico): void
  agora(): number
}

/** What the interface listens to: the progress, and the channels whose history changed. */
export interface EventoDoHistorico {
  /** History is arriving from a sibling. */
  aTrazer: boolean
  /** Fetched entries and count of remaining entries. */
  feitas: number
  total: number
  /** Media items after the text. `null` until the count is known. */
  media: { feitas: number; total: number } | null
  /** Channels whose history changed in this step: the interface reloads them. */
  canais: string[]
  /** This is the history of a device that just paired (not a sync between siblings). */
  inicial: boolean
  /** Profiles arrived with avatars: the interface reloads the directory. */
  perfis?: true
}

interface Cabecalho {
  v: 1
  k: "hi" | "hn" | "hp" | "hr" | "hx"
  s: string
  ap: string
  as?: string
  para?: string
  id?: string
  i?: number
  n?: number
  x?: string
  f?: number[]
}

type Pedido =
  | { t: "pagina"; c: string; desde: number | null }
  | { t: "media?"; canais?: string[] }
  | { t: "media"; itens: ItemDeMediaDoIrmao[] }

interface PedidoEmCurso {
  id: string
  corpo: Pedido
  enviadoEm: number
  ultimaParte: number
  tentativas: number
}

interface Chegada {
  id: string
  n: number
  partes: (Uint8Array | undefined)[]
  recebidas: number
}

interface SessaoDeQuemPede {
  s: string
  par: ParDoHistorico
  aberta: number
  chave?: Uint8Array
  /** The device that responded, in base64url. */
  com?: string
  inventario?: Chegada | undefined
  pedido?: PedidoEmCurso | undefined
  chegada?: Chegada | undefined
}

interface SessaoDeQuemResponde {
  chave: Uint8Array
  para: string
  ultimo: number
}

const MAGIA = 0x48

function novoId(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(9)))
}

/** The text being signed: the domain, channel, account, epoch, header, and body summary. */
function mensagemDoSinal(canal: string, address: string, epoca: bigint, cabecalho: Omit<Cabecalho, "as">, corpo: Uint8Array): Uint8Array {
  const prefixo = new TextEncoder().encode(
    `orwell-historico-sinal-v1\0${canal}\0${address}\0${epoca}\0${canonicoTolerante(cabecalho)}\0`,
  )
  const resumo = sha256(corpo)
  const saida = new Uint8Array(prefixo.length + resumo.length)
  saida.set(prefixo, 0)
  saida.set(resumo, prefixo.length)
  return saida
}

function embrulhar(cabecalho: Cabecalho, corpo: Uint8Array): Uint8Array {
  const texto = new TextEncoder().encode(JSON.stringify(cabecalho))
  const saida = new Uint8Array(3 + texto.length + corpo.length)
  saida[0] = MAGIA
  new DataView(saida.buffer).setUint16(1, texto.length, false)
  saida.set(texto, 3)
  saida.set(corpo, 3 + texto.length)
  return saida
}

function desembrulhar(bytes: Uint8Array): { cabecalho: Cabecalho; corpo: Uint8Array } | null {
  if (bytes.length < 3 || bytes[0] !== MAGIA) return null
  const comprimento = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(1, false)
  if (3 + comprimento > bytes.length) return null
  try {
    const cabecalho = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(3, 3 + comprimento))) as Cabecalho
    if (typeof cabecalho !== "object" || cabecalho === null || cabecalho.v !== 1) return null
    if (typeof cabecalho.k !== "string" || typeof cabecalho.s !== "string" || typeof cabecalho.ap !== "string") return null
    if (cabecalho.s.length > 32 || (cabecalho.id !== undefined && (typeof cabecalho.id !== "string" || cabecalho.id.length > 32))) return null
    return { cabecalho, corpo: bytes.subarray(3 + comprimento) }
  } catch {
    return null
  }
}

/** Compress (deflate) when the platform supports it. First byte indicates: 1 compressed, 0 raw. */
async function comprimir(texto: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") return juntar(new Uint8Array([0]), texto)
  const fluxo = new Blob([texto as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream("deflate-raw"))
  return juntar(new Uint8Array([1]), new Uint8Array(await new Response(fluxo).arrayBuffer()))
}

async function descomprimir(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (bytes.length === 0) return null
  if (bytes[0] === 0) return bytes.subarray(1)
  if (bytes[0] !== 1 || typeof DecompressionStream === "undefined") return null
  try {
    const fluxo = new Blob([bytes.subarray(1) as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw"))
    const leitor = fluxo.getReader()
    const pedacos: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await leitor.read()
      if (done) break
      total += value.length
      // Compression pump does not fill memory: it stops at the limit.
      if (total > TECTOS_DO_FIO_DO_HISTORICO.descomprimidoMax) {
        await leitor.cancel()
        return null
      }
      pedacos.push(value)
    }
    return juntar(...pedacos)
  } catch {
    return null
  }
}

function juntar(...partes: Uint8Array[]): Uint8Array {
  const total = partes.reduce((soma, parte) => soma + parte.length, 0)
  const saida = new Uint8Array(total)
  let em = 0
  for (const parte of partes) {
    saida.set(parte, em)
    em += parte.length
  }
  return saida
}

function partir(bytes: Uint8Array): Uint8Array[] {
  const passo = TECTOS_DO_FIO_DO_HISTORICO.bytesPorParte
  const partes: Uint8Array[] = []
  for (let em = 0; em < bytes.length; em += passo) partes.push(bytes.subarray(em, em + passo))
  if (partes.length === 0) partes.push(new Uint8Array(0))
  return partes
}

export class HistoricoEntreAparelhos {
  readonly #porta: PortaDoHistorico
  #pedinte: SessaoDeQuemPede | null = null
  readonly #respostas = new Map<string, SessaoDeQuemResponde>()
  /** Responses sent, by `s|id`, for any missing parts. */
  readonly #guardadas = new Map<string, { partes: Uint8Array[]; cabecalhos: Cabecalho[]; em: number; bytes: number }>()
  /** Signal queue and signals in flight awaiting possible rejection. */
  readonly #fila: { sinal: string; ref: string }[] = []
  readonly #noAr = new Map<string, { sinal: string; em: number }>()
  readonly #gastos: number[] = []
  #recuoAte = 0
  #bomba: ReturnType<typeof setTimeout> | undefined
  #relogio: ReturnType<typeof setInterval> | undefined
  #ligadoEm = 0
  #ultimoHi = 0
  #ultimaReposicao = 0
  #reposicaoNestaLigacao = false
  /** Everything touching sessions runs serially: the clock and incoming signals. */
  #cadeia: Promise<void> = Promise.resolve()
  /** The last message sent to the interface, to avoid repeating it. */
  #ultimoEvento = ""
  /** For tests: signal count sent and received. */
  readonly estatisticas = { enviados: 0, recebidos: 0, recusados: 0, ilegiveis: 0, pedidos: 0, respostas: 0 }

  constructor(porta: PortaDoHistorico) {
    this.#porta = porta
  }

  // ----------------------------------------------------------- connection

  aoLigar(): void {
    this.aoDesligar()
    this.#ligadoEm = this.#porta.agora()
    this.#reposicaoNestaLigacao = false
    this.#relogio = setInterval(() => void this.#passo(), TECTOS_DO_FIO_DO_HISTORICO.passoMs)
    ;(this.#relogio as { unref?: () => void }).unref?.()
    queueMicrotask(() => void this.#passo())
  }

  /** Connection dropped: the current session dies with it. The state stays in the vault, the next connection continues. */
  aoDesligar(): void {
    if (this.#relogio !== undefined) clearInterval(this.#relogio)
    this.#relogio = undefined
    if (this.#bomba !== undefined) clearTimeout(this.#bomba)
    this.#bomba = undefined
    this.#pedinte = null
    this.#respostas.clear()
    this.#guardadas.clear()
    this.#fila.length = 0
    this.#noAr.clear()
  }

  /** For the interface: the current state. */
  estado(): EventoDoHistorico {
    return this.#evento([])
  }

  // ------------------------------------------------------------- clock

  #emSerie(trabalho: () => Promise<void>): Promise<void> {
    const proximo = this.#cadeia.then(trabalho).catch(() => {
      // A failed step does not halt the following ones.
    })
    this.#cadeia = proximo
    return proximo
  }

  #passo(): Promise<void> {
    return this.#emSerie(() => this.#passoAgora())
  }

  async #passoAgora(): Promise<void> {
    if (!this.#porta.podeSinalizar()) return
    const contents = this.#porta.conteudo()
    if (!contents || !this.#porta.canalDaConta()) return
    if (!(await this.#porta.contaPronta())) return
    const agora = this.#porta.agora()
    this.#esquecerVelhas(agora)
    const pedinte = this.#pedinte
    if (!pedinte) {
      if (this.#querPedir(contents.historico, agora)) await this.#abrirSessao(agora)
      return
    }
    if (!pedinte.chave) {
      // No one answered the `hi` (old sibling or none connected): another can go out.
      if (agora - pedinte.aberta > TECTOS_DO_FIO_DO_HISTORICO.esperaDoInventarioMs) this.#pedinte = null
      return
    }
    if (pedinte.pedido) await this.#talvezRepetir(pedinte, agora)
    else await this.#proximoPedido(pedinte)
  }

  #querPedir(estado: EstadoDoHistorico | undefined, agora: number): boolean {
    const t = TECTOS_DO_FIO_DO_HISTORICO
    const desdeOUltimo = agora - this.#ultimoHi
    if (estado?.plano) return desdeOUltimo >= t.esperaDoInventarioMs
    const inicial = estado?.inicial
    if (inicial && agora - inicial.desde < t.inicialDuraMs) {
      const rapido = agora - inicial.desde < t.inicialRapidoMs
      return desdeOUltimo >= (rapido ? t.esperaDoInventarioMs : t.intervaloLentoMs)
    }
    if (this.#reposicaoNestaLigacao) return false
    if (agora - this.#ligadoEm < t.primeiraReposicaoMs) return false
    if (this.#ultimaReposicao > 0 && agora - this.#ultimaReposicao < t.intervaloDaReposicaoMs) return false
    this.#reposicaoNestaLigacao = true
    this.#ultimaReposicao = agora
    return true
  }

  /** A sibling said it is connected (requested history): this one also asks it, once per interval. */
  #irmaoLigado(): void {
    const agora = this.#porta.agora()
    if (this.#ultimaReposicao > 0 && agora - this.#ultimaReposicao < TECTOS_DO_FIO_DO_HISTORICO.intervaloDaReposicaoMs) return
    this.#reposicaoNestaLigacao = false
    this.#ligadoEm = Math.min(this.#ligadoEm, agora - TECTOS_DO_FIO_DO_HISTORICO.primeiraReposicaoMs + 2_000)
  }

  async #abrirSessao(agora: number): Promise<void> {
    const sessao: SessaoDeQuemPede = { s: novoId(), par: novoParDoHistorico(), aberta: agora }
    this.#pedinte = sessao
    this.#ultimoHi = agora
    await this.#enviar({ v: 1, k: "hi", s: sessao.s, ap: this.#meuAparelho(), x: toBase64(sessao.par.publica) }, new Uint8Array(0))
  }

  async #talvezRepetir(pedinte: SessaoDeQuemPede, agora: number): Promise<void> {
    const pedido = pedinte.pedido as PedidoEmCurso
    const t = TECTOS_DO_FIO_DO_HISTORICO
    if (agora - Math.max(pedido.enviadoEm, pedido.ultimaParte) < t.esperaDaRespostaMs) return
    if (pedido.tentativas >= t.tentativasPorPedido) {
      // The responder went silent: another session in the next step (maybe with a different sibling).
      this.#pedinte = null
      this.#ultimoHi = 0
      return
    }
    pedido.tentativas += 1
    pedido.ultimaParte = agora
    const chegada = pedinte.chegada
    if (chegada && chegada.id === pedido.id && chegada.recebidas > 0) {
      const faltam: number[] = []
      for (let i = 0; i < chegada.n && faltam.length < 512; i++) if (!chegada.partes[i]) faltam.push(i)
      await this.#enviar({ v: 1, k: "hp", s: pedinte.s, ap: this.#meuAparelho(), para: pedinte.com as string, id: pedido.id, f: faltam }, new Uint8Array(0))
      return
    }
    await this.#pedir(pedinte, pedido.corpo, pedido.tentativas)
  }

  // ------------------------------------------------------------ requester

  async #proximoPedido(pedinte: SessaoDeQuemPede): Promise<void> {
    const plano = this.#porta.conteudo()?.historico?.plano
    if (!plano) {
      this.#pedinte = null
      return
    }
    for (const [c, canal] of Object.entries(plano.canais)) {
      if (canal.fim) continue
      await this.#pedir(pedinte, { t: "pagina", c, desde: canal.cursor })
      return
    }
    if (!plano.media) {
      const inicial = this.#porta.conteudo()?.historico?.inicial !== undefined
      await this.#pedir(pedinte, inicial ? { t: "media?" } : { t: "media?", canais: Object.keys(plano.canais) })
      return
    }
    if (plano.media.porTrazer.length > 0) {
      await this.#pedir(pedinte, { t: "media", itens: plano.media.porTrazer.slice(0, TECTOS_DO_HISTORICO.itensPorPedidoDeMedia) })
      return
    }
    this.#acabar()
  }

  async #pedir(pedinte: SessaoDeQuemPede, corpo: Pedido, tentativas = 0): Promise<void> {
    if (!pedinte.chave || !pedinte.com) return
    const id = novoId()
    const agora = this.#porta.agora()
    pedinte.pedido = { id, corpo, enviadoEm: agora, ultimaParte: agora, tentativas }
    pedinte.chegada = undefined
    const selado = selarBloco(pedinte.chave, pedinte.s, `p:${id}`, new TextEncoder().encode(JSON.stringify(corpo)))
    this.estatisticas.pedidos += 1
    await this.#enviar({ v: 1, k: "hp", s: pedinte.s, ap: this.#meuAparelho(), para: pedinte.com, id }, selado)
  }

  /** Part of inventory or response for the requester's session. */
  async #aoParte(cabecalho: Cabecalho, corpo: Uint8Array): Promise<void> {
    const pedinte = this.#pedinte
    if (!pedinte || cabecalho.s !== pedinte.s) return
    const n = cabecalho.n
    const i = cabecalho.i
    if (typeof n !== "number" || typeof i !== "number" || !Number.isSafeInteger(n) || n < 1 || n > TECTOS_DO_FIO_DO_HISTORICO.partesMax) return
    if (!Number.isSafeInteger(i) || i < 0 || i >= n || typeof cabecalho.id !== "string") return

    if (cabecalho.k === "hn") {
      // The first sibling to respond keeps the session; the others go silent.
      if (pedinte.com && pedinte.com !== cabecalho.ap) return
      if (!pedinte.chave) {
        if (typeof cabecalho.x !== "string") return
        let publica: Uint8Array
        try {
          publica = fromBase64(cabecalho.x)
          pedinte.chave = chaveDoHistorico(pedinte.par.privada, publica, pedinte.s, {
            aparelhoQuePede: fromBase64(this.#meuAparelho()),
            aparelhoQueResponde: fromBase64(cabecalho.ap),
            efemeraQuePede: pedinte.par.publica,
            efemeraQueResponde: publica,
          })
        } catch {
          return
        }
        pedinte.com = cabecalho.ap
      }
      pedinte.inventario ??= { id: cabecalho.id, n, partes: new Array<Uint8Array | undefined>(n), recebidas: 0 }
      const completo = this.#guardarParte(pedinte.inventario, i, n, corpo)
      if (!completo) return
      const inventario = await this.#abrirResposta<Inventario>(pedinte, pedinte.inventario)
      pedinte.inventario = undefined
      if (!inventario || !Array.isArray(inventario.canais)) {
        this.#pedinte = null
        return
      }
      this.#aoInventario(inventario)
      await this.#proximoPedido(pedinte)
      return
    }

    // `hr`: a response to the current request.
    const pedido = pedinte.pedido
    if (!pedido || cabecalho.id !== pedido.id || cabecalho.ap !== pedinte.com) return
    pedido.ultimaParte = this.#porta.agora()
    pedinte.chegada ??= { id: pedido.id, n, partes: new Array<Uint8Array | undefined>(n), recebidas: 0 }
    if (!this.#guardarParte(pedinte.chegada, i, n, corpo)) return
    const resposta = await this.#abrirResposta<unknown>(pedinte, pedinte.chegada)
    pedinte.chegada = undefined
    pedinte.pedido = undefined
    if (resposta === null) return
    this.estatisticas.respostas += 1
    this.#aoResposta(pedido.corpo, resposta)
    await this.#proximoPedido(pedinte)
  }

  #guardarParte(chegada: Chegada, i: number, n: number, corpo: Uint8Array): boolean {
    if (chegada.n !== n) return false
    if (!chegada.partes[i]) {
      chegada.partes[i] = corpo.slice()
      chegada.recebidas += 1
    }
    return chegada.recebidas === chegada.n
  }

  async #abrirResposta<T>(pedinte: SessaoDeQuemPede, chegada: Chegada): Promise<T | null> {
    if (!pedinte.chave) return null
    const selado = juntar(...(chegada.partes as Uint8Array[]))
    const aberto = abrirBloco(pedinte.chave, pedinte.s, `r:${chegada.id}`, selado)
    if (!aberto) return null
    const texto = await descomprimir(aberto)
    if (!texto) return null
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(texto)) as T
    } catch {
      return null
    }
  }

  /** The sibling's inventory: the state, or the existing state with new counts. */
  #aoInventario(inventario: Inventario): void {
    const canalDaConta = this.#porta.canalDaConta()
    const agora = this.#porta.agora()
    const mudaram: string[] = []
    this.#porta.gravar((contents) => {
      const h = (contents.historico ??= {})
      const inicial = h.inicial !== undefined
      const canais = inventario.canais.filter(
        (canal) =>
          typeof canal?.c === "string" &&
          canal.c !== canalDaConta &&
          typeof canal.n === "number" &&
          typeof canal.h === "string" &&
          canal.c.length <= 255,
      )
      if (h.plano) {
        // Resume: only channels the state already had. A channel the user deleted elsewhere dropped from the state and does not come back here.
        for (const canal of canais) {
          const noPlano = h.plano.canais[canal.c]
          if (!noPlano) continue
          noPlano.total = Math.max(noPlano.total, canal.n, noPlano.feitas)
          noPlano.resumo = canal.h
        }
      } else {
        const plano: NonNullable<EstadoDoHistorico["plano"]> = { comecou: agora, canais: {} }
        for (const canal of canais) {
          // Between already-paired siblings, only channels this device is in (or was removed from with history): a channel the user deleted here does not come back through sync.
          if (!inicial && !this.#porta.temGrupo(canal.c) && contents.canaisArquivados?.[canal.c] === undefined) continue
          if (canal.h === resumoDoHistorico(contents, canal.c)) {
            ;(h.trazidos ??= {})[canal.c] = canal.h
            continue
          }
          if (!inicial && h.trazidos?.[canal.c] === canal.h) continue
          plano.canais[canal.c] = { total: canal.n, feitas: 0, cursor: null, resumo: canal.h }
        }
        // No channels and not the initial device: nothing to fetch. The initial device still fetches media.
        if (inicial || Object.keys(plano.canais).length > 0) h.plano = plano
      }
      for (const canal of canais) {
        if (!h.plano?.canais[canal.c]) continue
        fichaDoIrmao(contents, canal.c, canal.f)
        if (typeof canal.a === "number" && !this.#porta.temGrupo(canal.c) && contents.canaisArquivados?.[canal.c] === undefined) {
          contents.canaisArquivados = { ...contents.canaisArquivados, [canal.c]: canal.a }
          mudaram.push(canal.c)
        }
        if (canal.l === null || (typeof canal.l?.seq === "number" && typeof canal.l.em === "number")) {
          h.lugares = { ...h.lugares, [canal.c]: canal.l }
        }
      }
    })
    if (!this.#porta.conteudo()?.historico?.plano) {
      // Nothing to fetch from this sibling.
      this.#pedinte = null
      this.#ultimaReposicao = agora
    }
    this.#dizer(mudaram)
  }

  #aoResposta(corpo: Pedido, resposta: unknown): void {
    if (corpo.t === "pagina") return this.#aoPagina(corpo.c, resposta as PaginaDoHistorico)
    if (corpo.t === "media?") return this.#aoListaDeMedia(resposta as { itens?: MediaNoIrmao[] })
    return this.#aoMedia(corpo.itens, resposta as { itens?: MediaInteira[]; resto?: number })
  }

  #aoPagina(c: string, pagina: PaginaDoHistorico): void {
    if (typeof pagina !== "object" || pagina === null || pagina.c !== c || !Array.isArray(pagina.e)) return
    let mudou = false
    this.#porta.gravar((contents) => {
      const canal = contents.historico?.plano?.canais[c]
      if (!canal) return
      const entradas = pagina.e.filter(entradaValida).filter((entrada) => !this.#porta.bloqueado(c, entrada.sender))
      if (fundirEntradasDoIrmao(contents, c, entradas) > 0) mudou = true
      if (pagina.r && typeof pagina.r === "object") {
        fundirRegistosDoIrmao(contents, c, pagina.r)
        mudou = true
      }
      canal.feitas = Math.min(canal.total, canal.feitas + pagina.e.length)
      if (typeof pagina.ate === "number") canal.cursor = pagina.ate
      if (pagina.fim || pagina.e.length === 0) {
        canal.fim = true
        canal.feitas = canal.total
      }
    })
    this.#dizer(mudou ? [c] : [])
  }

  #aoListaDeMedia(resposta: { itens?: MediaNoIrmao[] }): void {
    const itens = Array.isArray(resposta?.itens) ? resposta.itens : []
    this.#porta.gravar((contents) => {
      const plano = contents.historico?.plano
      if (!plano) return
      const porTrazer: ItemDeMediaDoIrmao[] = []
      const vistos = new Set<string>()
      for (const item of itens) {
        if (typeof item !== "object" || item === null || typeof item.b !== "number") continue
        if ("c" in item && (typeof item.c !== "string" || typeof item.e !== "string")) continue
        if ("v" in item && typeof item.v !== "string") continue
        if ("a" in item && (typeof item.a !== "string" || typeof item.at !== "number")) continue
        if (!("c" in item) && !("v" in item) && !("a" in item)) continue
        if ("c" in item && this.#porta.bloqueado(item.c, item.e.split("|")[1] ?? "")) continue
        if (!faltaAqui(contents, item)) continue
        const pedido = pedidoDe(item)
        const chave = chaveDoItem(pedido)
        if (vistos.has(chave)) continue
        vistos.add(chave)
        porTrazer.push(pedido)
      }
      // Conversation thumbnails before videos and avatars: these show up first.
      porTrazer.sort((a, b) => ordemDoItem(a) - ordemDoItem(b))
      plano.media = { total: porTrazer.length, feitas: 0, porTrazer }
    })
    this.#dizer([])
  }

  #aoMedia(pedidos: ItemDeMediaDoIrmao[], resposta: { itens?: MediaInteira[]; resto?: number }): void {
    const itens = Array.isArray(resposta?.itens) ? resposta.itens : []
    const resto = typeof resposta?.resto === "number" && resposta.resto >= 0 ? Math.min(resposta.resto, pedidos.length) : 0
    const tratados = new Set(pedidos.slice(0, pedidos.length - resto).map(chaveDoItem))
    const canais = new Set<string>()
    let perfis = false
    this.#porta.gravar((contents) => {
      const media = contents.historico?.plano?.media
      if (!media) return
      for (const item of itens) {
        if (typeof item !== "object" || item === null) continue
        if ("c" in item && typeof item.c === "string" && typeof item.e === "string" && typeof item.p === "object" && item.p !== null) {
          if (this.#porta.bloqueado(item.c, item.e.split("|")[1] ?? "")) continue
          if (juntarMediaDoIrmao(contents, item.c, item.e, item.p)) canais.add(item.c)
        } else if ("v" in item && typeof item.v === "string" && typeof item.b64 === "string") {
          // Video verified by its hash, which is its key: a mismatched video is rejected.
          try {
            const resumo = toBase64(sha256(base64ParaBytes(item.b64)))
            if (resumo === item.v) guardarVideo(contents, item.v, item.b64, typeof item.at === "number" ? item.at : this.#porta.agora())
          } catch {
            // Corrupted bytes: rejected, not requested again.
          }
        } else if ("a" in item && typeof item.a === "string" && typeof item.perfil === "object" && item.perfil !== null) {
          const perfil = item.perfil
          if (typeof perfil.at !== "number" || typeof perfil.payload !== "object" || perfil.payload === null) continue
          const aqui = contents.directory[item.a]
          if (aqui && !aqui.parcial && aqui.at > perfil.at) continue
          const { parcial: _parcial, ...inteiro } = structuredClone(perfil)
          contents.directory[item.a] = inteiro
          perfis = true
        }
      }
      const antes = media.porTrazer.length
      media.porTrazer = media.porTrazer.filter((item) => !tratados.has(chaveDoItem(item)))
      media.feitas = Math.min(media.total, media.feitas + (antes - media.porTrazer.length))
    })
    this.#dizer([...canais], perfis)
  }

  #acabar(): void {
    const agora = this.#porta.agora()
    this.#porta.gravar((contents) => {
      const h = contents.historico
      if (!h?.plano) return
      for (const [c, canal] of Object.entries(h.plano.canais)) (h.trazidos ??= {})[c] = canal.resumo
      delete h.plano
      delete h.inicial
    })
    this.#pedinte = null
    this.#ultimaReposicao = agora
    this.#dizer([])
  }

  // -------------------------------------------------------- responder

  async #aoHi(cabecalho: Cabecalho): Promise<void> {
    if (typeof cabecalho.x !== "string") return
    const contents = this.#porta.conteudo()
    if (!contents) return
    this.#irmaoLigado()
    // One session per device: a new `hi` from the same device replaces the previous one.
    for (const [s, sessao] of this.#respostas) if (sessao.para === cabecalho.ap) this.#respostas.delete(s)
    const par = novoParDoHistorico()
    let chave: Uint8Array
    try {
      const publica = fromBase64(cabecalho.x)
      chave = chaveDoHistorico(par.privada, publica, cabecalho.s, {
        aparelhoQuePede: fromBase64(cabecalho.ap),
        aparelhoQueResponde: fromBase64(this.#meuAparelho()),
        efemeraQuePede: publica,
        efemeraQueResponde: par.publica,
      })
    } catch {
      return
    }
    const agora = this.#porta.agora()
    this.#respostas.set(cabecalho.s, { chave, para: cabecalho.ap, ultimo: agora })
    const inventario = inventarioDe(contents, this.#contexto())
    await this.#responder(cabecalho.s, "hn", cabecalho.ap, "inv", inventario, toBase64(par.publica))
  }

  async #aoPedido(cabecalho: Cabecalho, corpo: Uint8Array): Promise<void> {
    const sessao = this.#respostas.get(cabecalho.s)
    if (!sessao || sessao.para !== cabecalho.ap || typeof cabecalho.id !== "string") {
      await this.#enviar({ v: 1, k: "hx", s: cabecalho.s, ap: this.#meuAparelho(), para: cabecalho.ap }, new Uint8Array(0))
      return
    }
    sessao.ultimo = this.#porta.agora()
    if (Array.isArray(cabecalho.f)) {
      const guardada = this.#guardadas.get(`${cabecalho.s}|${cabecalho.id}`)
      if (!guardada) {
        await this.#enviar({ v: 1, k: "hx", s: cabecalho.s, ap: this.#meuAparelho(), para: cabecalho.ap, id: cabecalho.id }, new Uint8Array(0))
        return
      }
      for (const i of cabecalho.f.slice(0, 512)) {
        const parte = guardada.partes[i]
        const cab = guardada.cabecalhos[i]
        if (parte && cab) await this.#enviar(cab, parte)
      }
      return
    }
    const aberto = abrirBloco(sessao.chave, cabecalho.s, `p:${cabecalho.id}`, corpo)
    if (!aberto) return
    let pedido: Pedido
    try {
      pedido = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(aberto)) as Pedido
    } catch {
      return
    }
    const contents = this.#porta.conteudo()
    if (!contents || typeof pedido !== "object" || pedido === null) return
    let resposta: unknown
    const eu = this.#porta.eu().address
    if (pedido.t === "pagina" && typeof pedido.c === "string") {
      if (pedido.c === this.#porta.canalDaConta()) return
      const desde = typeof pedido.desde === "number" ? pedido.desde : null
      resposta = paginaDe(contents, pedido.c, desde)
    } else if (pedido.t === "media?") {
      const canais = Array.isArray(pedido.canais) ? pedido.canais.filter((c) => typeof c === "string") : undefined
      resposta = { itens: mediaDe(contents, eu, canais) }
    } else if (pedido.t === "media" && Array.isArray(pedido.itens)) {
      const pedidos = pedido.itens.slice(0, TECTOS_DO_HISTORICO.itensPorPedidoDeMedia)
      resposta = mediaInteiraDe(contents, eu, pedidos)
    } else {
      return
    }
    await this.#responder(cabecalho.s, "hr", cabecalho.ap, cabecalho.id, resposta)
  }

  async #responder(s: string, k: "hn" | "hr", para: string, id: string, resposta: unknown, x?: string): Promise<void> {
    const sessao = this.#respostas.get(s)
    if (!sessao) return
    const texto = await comprimir(new TextEncoder().encode(JSON.stringify(resposta)))
    const selado = selarBloco(sessao.chave, s, `r:${id}`, texto)
    const partes = partir(selado)
    if (partes.length > TECTOS_DO_FIO_DO_HISTORICO.partesMax) return
    const cabecalhos = partes.map(
      (_, i): Cabecalho => ({ v: 1, k, s, ap: this.#meuAparelho(), para, id, i, n: partes.length, ...(x ? { x } : {}) }),
    )
    this.#guardadas.set(`${s}|${id}`, { partes, cabecalhos, em: this.#porta.agora(), bytes: selado.length })
    for (let i = 0; i < partes.length; i++) await this.#enviar(cabecalhos[i] as Cabecalho, partes[i] as Uint8Array)
  }

  #contexto(): ContextoDoIrmao {
    return {
      canalDaConta: this.#porta.canalDaConta(),
      temGrupo: (canal) => this.#porta.temGrupo(canal),
      lugar: (canal) => this.#porta.lugar(canal),
    }
  }

  #esquecerVelhas(agora: number): void {
    for (const [s, sessao] of this.#respostas) {
      if (agora - sessao.ultimo > TECTOS_DO_FIO_DO_HISTORICO.sessaoCaladaMs) this.#respostas.delete(s)
    }
    let bytes = 0
    for (const [chave, guardada] of [...this.#guardadas].reverse()) {
      bytes += guardada.bytes
      if (agora - guardada.em > TECTOS_DO_FIO_DO_HISTORICO.guardadasMs || bytes > TECTOS_DO_FIO_DO_HISTORICO.guardadasBytes) {
        this.#guardadas.delete(chave)
      }
    }
    for (const [ref, item] of this.#noAr) if (agora - item.em > 30_000) this.#noAr.delete(ref)
  }

  // ------------------------------------------------------------- o fio

  /** A `channel.sinal` from the account's channel. Runs serially with the clock. */
  aoSinal(frame: { channel: string; from: string; sinal: string }): Promise<void> {
    return this.#emSerie(() => this.#aoSinalAgora(frame))
  }

  async #aoSinalAgora(frame: { channel: string; from: string; sinal: string }): Promise<void> {
    const canal = this.#porta.canalDaConta()
    if (!canal || frame.channel !== canal) return
    const eu = this.#porta.eu()
    if (frame.from !== eu.address) return
    let bytes: Uint8Array
    try {
      bytes = fromBase64(frame.sinal)
    } catch {
      this.estatisticas.ilegiveis += 1
      return
    }
    const chave = await this.#porta.derivarChave()
    if (!chave || epocaDoSinal(bytes) !== chave.epoca) {
      this.estatisticas.ilegiveis += 1
      return
    }
    const aberto = abrirSinal(chave, canal, bytes)
    const lido = aberto ? desembrulhar(aberto) : null
    if (!lido) {
      // A signal not from this module (future version, something else): dropped silently.
      this.estatisticas.ilegiveis += 1
      return
    }
    const { cabecalho, corpo } = lido
    const meu = this.#meuAparelho()
    if (cabecalho.ap === meu) return
    if (cabecalho.para !== undefined && cabecalho.para !== meu) return
    // The device must be a leaf of this account in the account channel, and the signature must be its own.
    if (!this.#porta.folhasDaConta().includes(cabecalho.ap) || typeof cabecalho.as !== "string") return
    const { as: assinatura, ...semAssinatura } = cabecalho
    let valida = false
    try {
      valida = verify(fromBase64(cabecalho.ap), mensagemDoSinal(canal, frame.from, chave.epoca, semAssinatura, corpo), fromBase64(assinatura))
    } catch {
      valida = false
    }
    if (!valida) {
      this.estatisticas.ilegiveis += 1
      return
    }
    this.estatisticas.recebidos += 1
    switch (cabecalho.k) {
      case "hi":
        return this.#aoHi(cabecalho)
      case "hp":
        return this.#aoPedido(cabecalho, corpo)
      case "hn":
      case "hr":
        return this.#aoParte(cabecalho, corpo)
      case "hx":
        if (this.#pedinte?.s === cabecalho.s && this.#pedinte.com === cabecalho.ap) {
          // The responder no longer knows the session (reopened): another in the next step.
          this.#pedinte = null
          this.#ultimoHi = 0
        }
        return
      default:
        return
    }
  }

  /** Server refused our signal: back off and put the signal back in the queue. */
  aoRecusa(frame: { channel: string; code: string; ref?: string | undefined; retryAfterMs?: number | undefined }): void {
    if (frame.channel !== this.#porta.canalDaConta()) return
    this.estatisticas.recusados += 1
    const agora = this.#porta.agora()
    const item = frame.ref !== undefined ? this.#noAr.get(frame.ref) : undefined
    if (frame.ref !== undefined) this.#noAr.delete(frame.ref)
    if (frame.code === "sinal-rate-limited" || frame.code === "sinal-channel-busy") {
      this.#recuoAte = Math.max(this.#recuoAte, agora + Math.max(1_000, frame.retryAfterMs ?? 2_000))
      if (item) this.#fila.unshift({ sinal: item.sinal, ref: frame.ref as string })
      this.#bombear()
      return
    }
    // Too large or no room in the channel: waiting won't help. The session starts again later.
    this.#recuoAte = agora + 30_000
    this.#fila.length = 0
    this.#pedinte = null
  }

  async #enviar(semAssinatura: Omit<Cabecalho, "as">, corpo: Uint8Array): Promise<void> {
    const canal = this.#porta.canalDaConta()
    const chave = await this.#porta.derivarChave()
    if (!canal || !chave) return
    const eu = this.#porta.eu()
    const cabecalho: Cabecalho = {
      ...semAssinatura,
      as: toBase64(eu.assinar(mensagemDoSinal(canal, eu.address, chave.epoca, semAssinatura, corpo))),
    }
    const sinal = toBase64(selarSinal(chave, canal, embrulhar(cabecalho, corpo)))
    if (sinal.length > TECTOS_DO_FIO_DO_HISTORICO.sinalMaxCaracteres) return
    this.#fila.push({ sinal, ref: novoId() })
    this.#bombear()
  }

  /** Drain the queue within the per-minute cap. Whatever doesn't fit waits for the next minute. */
  #bombear(): void {
    if (this.#bomba !== undefined) return
    const agora = this.#porta.agora()
    while (this.#gastos.length > 0 && agora - (this.#gastos[0] as number) >= 60_000) this.#gastos.shift()
    while (this.#fila.length > 0 && agora >= this.#recuoAte && this.#gastos.length < TECTOS_DO_FIO_DO_HISTORICO.sinaisPorMinuto) {
      if (!this.#porta.podeSinalizar()) {
        this.#fila.length = 0
        return
      }
      const item = this.#fila.shift() as { sinal: string; ref: string }
      try {
        this.#porta.enviarSinal(item.sinal, item.ref)
      } catch {
        this.#fila.length = 0
        return
      }
      this.#gastos.push(agora)
      this.#noAr.set(item.ref, { sinal: item.sinal, em: agora })
      this.estatisticas.enviados += 1
    }
    if (this.#fila.length === 0) return
    const proximo = Math.max(
      this.#recuoAte - agora,
      this.#gastos.length >= TECTOS_DO_FIO_DO_HISTORICO.sinaisPorMinuto ? 60_000 - (agora - (this.#gastos[0] as number)) : 0,
      50,
    )
    this.#bomba = setTimeout(() => {
      this.#bomba = undefined
      this.#bombear()
    }, proximo)
    ;(this.#bomba as { unref?: () => void }).unref?.()
  }

  #meuAparelho(): string {
    return toBase64(this.#porta.eu().aparelho)
  }

  // ------------------------------------------------------------ a interface

  #evento(canais: string[]): EventoDoHistorico {
    const plano = this.#porta.conteudo()?.historico?.plano
    const inicial = this.#porta.conteudo()?.historico?.inicial !== undefined
    if (!plano) return { aTrazer: false, feitas: 0, total: 0, media: null, canais, inicial }
    let feitas = 0
    let total = 0
    for (const canal of Object.values(plano.canais)) {
      feitas += canal.feitas
      total += canal.total
    }
    return {
      aTrazer: true,
      feitas,
      total,
      media: plano.media ? { feitas: plano.media.feitas, total: plano.media.total } : null,
      canais,
      inicial,
    }
  }

  #dizer(canais: string[], perfis = false): void {
    const evento = this.#evento(canais)
    const assinatura = JSON.stringify({ ...evento, perfis })
    if (canais.length === 0 && !perfis && assinatura === this.#ultimoEvento) return
    this.#ultimoEvento = assinatura
    this.#porta.emitir(perfis ? { ...evento, perfis: true } : evento)
  }
}

/** Conversation photos first, then videos, then portraits. */
function ordemDoItem(item: ItemDeMediaDoIrmao): number {
  if ("c" in item) return 0
  if ("v" in item) return 1
  return 2
}
