import { abrirSinal, epocaDoSinal, selarSinal, type ChaveDoSinal } from "@enclave/crypto"
import {
  assinarAutoria,
  canonicoTolerante,
  fromBase64,
  levaAutoria,
  toBase64,
  verify,
  type Payload,
  type ItemRelatado,
  type RelatosNoFio,
  verificarAutoria,
} from "@enclave/protocol"
import type { StoredPayload, VaultContents } from "../vault.js"
import {
  anexoComBytes,
  anexoConfere,
  anexoEm,
  bytesDoAnexo,
  comAnexo,
  doInstantaneo,
  progressoDoInstantaneo,
  resumoDoAnexo,
  TECTOS_DOS_ANEXOS,
  TIPOS_DO_INSTANTANEO,
  type SincroniaDoCanal,
} from "./instantaneo.js"
import { caracteresDeBase64, partesDoAnexo } from "../videos.js"
import {
  candidatos,
  eleger,
  esperaDeSupressao,
  Recuo,
  TECTOS_DA_SINCRONIA,
  TectoPorMinuto,
  Vivacidade,
  type Folha,
} from "./eleicao.js"
import {
  lerQ,
  normalizar,
  partirRelatos,
  porOrdemDoRelato,
  prepararItem,
  receberItem,
  type QuemRelata,
  type VeredictoDoRelato,
} from "./relato.js"
import {
  baldesDiferentes,
  chaveCurta,
  comJanela,
  itemApagado,
  lapidesDoCanal,
  notarLapide,
  type CofreDaSincronia,
  chaveCurtaValida,
  itemDoPayload,
  itensDoCanal,
  nivel0DoFio,
  nivel0ParaFio,
  parDoFio,
  resumoNivel0,
  resumoNivel1,
  resumoNivel2,
  TIPOS_COM_JANELA,
  TIPOS_DO_RESUMO,
  type ItemDoResumo,
  type Nivel0NoFio,
  type ParDoResumo,
  type ResumoNivel0,
  type TipoDoResumo,
} from "./resumo.js"

/**
 * Anti-entropy between accounts (phase S4 of absolute sync,
 * `docs/planos/2026-10-20-sincronia-absoluta.md`, §4).
 *
 * **What it does.** Each device announces, in an ephemeral signal, the level 0 de
 * summary of a channel (`r0`). Whoever sees a different summary descends: asks for level 1
 * (`p1` → `n1`), then level 2 for different buckets (`p2` → `n2`), then
 * for missing items (`pi`). The responder reports them in a `typing` with
 * `until: 0` (field `relatos`), with authorship and the `seq` of origin, and closes with
 * a signal (`ri`) saying how many frames were sent. The receiver checks and applies
 * via the usual folds (`#recordPayload` and the vault, which deduplicates by key).
 *
 * **Who speaks.** The caller chooses who answers (the lowest live leaf among
 * those that showed they have the data), and all requests carry `para`: the others
 * stay silent. Anyone answering a summary with theirs waits their turn (`posição × 2 s`)
 * and stays silent if someone says the same first. See `eleicao.ts`.
 *
 * **Transport.** The signals go in the `channel.sinal` frame (phase S3), which the
 * server only delivers to those who announced `sinal-efemero`: a 0.5.7 never sees them. The
 * content travels encrypted with the signal key for the epoch (`sinal.ts` in the
 * crypto packet, outside the ratchet) and signed by the device, because the key only proves that
 * the sender is a member. Reports go in MLS, stored on the server: they are
 * content, and must reach members who are offline.
 *
 * **What's out of scope.** A server without `channel.sinal` (old, or in
 * federation) disables anti-entropy: the fallback vehicle from the plan
 * (`typing.sinal`) didn't get into this phase. Profile, shown friends, the
 * link, invites and banner don't get reported (they have their own path, or
 * control access): divergence in them needs nothing.
 *
 * **This module doesn't touch the session.** It talks to it via `PortaDaAntiEntropia`,
 * so `session.ts` only has hooks.
 */

/** The capacity that a device announces in the device signal: it knows anti-entropy. */
export const CAPACIDADE_SINCRONIA = "sincronia-v1"

/** The types that are asked for: the ones that have a reportable source in someone's vault. */
export const TIPOS_RELATAVEIS: ReadonlySet<TipoDoResumo> = new Set<TipoDoResumo>([
  "mensagem",
  "edicao",
  "apagamento",
  "reaccao",
  "ticket",
  "publicacao",
  "comentario",
  "gosto",
  "voto",
  "fundador",
  "cargo",
  "atribuicao",
  "categoria",
  "sala",
])

/** What anti-entropy needs from the session. Everything is sync except what goes on the network. */
export interface PortaDaAntiEntropia {
  readonly eu: QuemRelata
  conteudo(): VaultContents
  /** Connection is up, and the server announced `ephemeral-signal`. */
  podeSinalizar(): boolean
  /** The channel enters anti-entropy (not the account channel, we have space for it). */
  elegivel(canal: string): boolean
  ehDirecta(canal: string): boolean
  membros(canal: string): string[]
  folhas(canal: string): Folha[]
  epocaAtual(canal: string): bigint | undefined
  derivarChave(canal: string): Promise<ChaveDoSinal | null>
  /** The `seq` of the commit that seated us, or the conservative floor (see `session.ts`). */
  lugar(canal: string): number
  /** The highest `seq` read from the server on this channel. */
  ancora(canal: string): number
  /** Throws if it does not exit (no connection). */
  enviarSinal(canal: string, sinal: string, ref: string): void
  enviarRelatos(canal: string, relatos: RelatosNoFio): Promise<void>
  /** Store a reported item already verified, as if it had arrived from the server. */
  gravarRelatado(canal: string, seq: number, autor: string, payload: Payload): void
  /** Drain what was stored to the vault (the folds read from there). */
  escoar(): Promise<void>
  /** Mark the vault to store (the floor changed). */
  marcarParaGravar(): void
  aparelhoConfiavel(canal: string, autor: string, aparelho: string, cadeia: { k?: string; x?: string }): Promise<boolean>
  cadeiaDe(canal: string, autor: string, aparelho: string): { k: string; x: string } | null
  bloqueado(canal: string, autor: string): boolean
  online(address: string): boolean
  agora(): number
  /**
   * The bytes of a requested attachment arrived and match the authorship (S5, §5.4):
   * put them in place of the marker, in the `target` item of `author`.
   */
  gravarAnexo?(canal: string, autor: string, alvo: string, indice: number, anexo: Record<string, unknown>): Promise<void>
  /**
   * The bytes of a video, by digest (see `videos.ts`). A video does not travel
   * inside the attachment: the attachment holds the digest, and the bytes go in parts.
   */
  bytesDoVideo?(sha: string): Uint8Array | null
  /** An attachment request failed because of a fault, not because nobody has it. For the log. */
  aoFalharAnexo?(canal: string, detalhe: string): void
  /**
   * Resend the parts of a video to the requester (`q`). `vez` decides
   * if each part can go out. Returns whether all parts were sent.
   */
  servirVideo?(canal: string, sha: string, q: string, vez: (bytes: number) => Promise<boolean>): Promise<boolean>
  /**
   * The attachment of a video (no bytes, with the parts) arrived on request and matched
   * the authorship: its parts are now expected (`videos.ts`).
   */
  esperarVideo?(canal: string, anexo: Record<string, unknown>): void
  /** The sync state of this channel changed (S5): the interface re-reads it. */
  aoMudar?(canal: string): void
  /**
   * Profiles to third parties (3/11/2026): the channel where profiles
   * of other people are requested and provided. Today only the common room: no Welcome
   * with portrait for those entering by card, and those who were offline never tell their name.
   */
  perfisATerceiros?(canal: string): boolean
  /** Profiles of these accounts that this device can report, signed by the authors. */
  perfisParaRelatar?(canal: string, contas: readonly string[]): ItemRelatado[]
  /** This device is on the list of a profile request: publish ours (the session locks repetition). */
  republicarPerfil?(canal: string): void
  /** Reported profiles stored (`light`: without portrait bytes), for the session to notify the interface. */
  aoPerfisRelatados?(canal: string, perfis: { autor: string; versao: unknown; leve: boolean }[]): void
}

// ------------------------------------------------------------ what travels

interface R0 {
  k: "r0"
  /** The `seq` of the place of the sender. */
  l: number
  /** The window with which this digest was calculated (≥ `l`). */
  d: number
  r: Nivel0NoFio
}
interface P1 {
  k: "p1"
  id: string
  para: string
  d: number
  l: number
  tipos: string[]
}
interface N1 {
  k: "n1"
  id: string
  d: number
  parte: number
  de: number
  /** `[tipo, balde, n, h]`. */
  e: [string, string, number, string][]
}
interface P2 {
  k: "p2"
  id: string
  para: string
  d: number
  l: number
  /** `[tipo, balde]`. */
  e: [string, string][]
}
interface N2 {
  k: "n2"
  id: string
  d: number
  parte: number
  de: number
  /** `[tipo, balde, chaves curtas]`. */
  e: [string, string, string[]][]
}
interface PI {
  k: "pi"
  id: string
  para: string
  d: number
  l: number
  c: string[]
}
/**
 * Reports sent for request `id`: `de` frames of `typing`. Zero closes the
 * request. `f`: the requested keys that this leaf could not provide (does not have them, or
 * they are from another person and not signed, before S4). `au`: the authors of those it
 * has but could not provide, for the requester to try the author's leaf, which can sign them.
 */
interface RI {
  k: "ri"
  id: string
  de: number
  f?: string[]
  au?: string[]
  /**
   * S5: the reports were capped by the limit per minute, and the rest can be requested
   * after `r` ms. Without this, the requester would mark the request complete and what was left
   * would wait for the ten-minute clock. An S4 client ignores it.
   */
  r?: number
}
/**
 * The integer-type request (S5, §5.1): all items of these types, without descending
 * to levels 1 and 2. It is the snapshot for those joining late. Closes with an `ri`.
 */
interface PT {
  k: "pt"
  id: string
  para: string
  d: number
  l: number
  tipos: string[]
}
/**
 * The request for the bytes of an attachment (S5, §5.4): the item by short key, the position
 * of the attachment in the flattened list of the authorship, and the digest that the authorship signed. The
 * response is a report with `q` of attachment (`Q_DO_ANEXO`), or an `ri` with `de: 0`
 * (this leaf does not have it).
 */
interface PA {
  k: "pa"
  id: string
  para: string
  l: number
  c: string
  i: number
  m: string
  /**
   * In a video: the digest of the bytes (`partes.sha256`), which the requester only sets
   * when it already has the attachment with the parts. With it, the responder sends the
   * parts; without it, it sends the attachment first without bytes (the parts and the
   * thumbnail), in a report that the requester verifies by `m`. Sending parts to
   * someone who cannot verify them would waste up to 33 MB of bandwidth for nothing.
   */
  v?: string
}
/**
 * The request for profiles to third parties (3/11/2026, only in the common room): the accounts that
 * the requester sees without a name. One leaf responds only, by turn (`#aoPedidoDePerfis`),
 * with the profiles signed by the authors. And those on the list and online publish theirs.
 */
interface PP {
  k: "pp"
  id: string
  c: string[]
}
type Corpo = R0 | P1 | N1 | P2 | N2 | PI | RI | PT | PA | PP

/** The prefix of the `q` of a report of requested profiles (`PP`). */
const Q_DOS_PERFIS = "pf."
/**
 * Accounts per profile request. An address is 40 to 70 characters: one hundred fit
 * in the 12 KiB signal with encryption. The rest goes in the next request.
 */
export const PERFIS_POR_PEDIDO = 100
/** The leaves that respond to a profile request, by turn; the others stay silent. */
const VEZES_DOS_PERFIS = 6

/** The prefix of the `q` of a report that carries the bytes of an attachment. A descent id never has a dot. */
const Q_DO_ANEXO = "anx."

/** The envelope of a signal, before encryption: the device, its signature, the body. */
interface Envelope {
  ap: string
  as: string
  c: Corpo
}

/** The JSON of a body that splits into multiple frames stays below this. */
const BYTES_POR_PARTE = 7 * 1024
/** Keys per item request. A thousand keys are 15 KB; 400 fit in one signal. */
const CHAVES_POR_PEDIDO = 400
/** Authors of items that could not be provided, in an `ri`. */
const AUTORES_POR_RI = 16
/**
 * How long to remember a key that no leaf provided (an item from another
 * person, not signed, that only the author can report and the author is not online). Without
 * this, each trigger would descend to its request, forever.
 */
const NINGUEM_DEU_MS = 24 * 60 * 60_000
/**
 * At most this many retries per `ri.r` in a request. A channel at the 4 MiB
 * per day cap takes four retries of 1 MB; ten leave room and close the door to a
 * responder that says `r` endlessly.
 */
const VOLTAS_POR_PEDIDO = 10
/** All reports arrived, how long to wait for the `ri` that closes them. See `#talvezAcabarItens`. */
const ESPERA_DO_RI_MS = 2_000
/** The retry waits `r` plus randomness up to 25 %: N entries at the same time do not retry the same second. */
const ACASO_DA_VOLTA = 0.25
/** Tombstone targets from the board remembered per channel: the cap on amendments in the vault (`TECTOS_DO_ESTADO.emenda`). */
const ALVOS_DO_MURAL_POR_CANAL = 2_000

function mensagemDoSinal(canal: string, autor: string, epoca: bigint, corpo: Corpo): Uint8Array {
  return new TextEncoder().encode(`orwell-sinal-assinatura-v1\0${canal}\0${autor}\0${epoca}\0${canonicoTolerante(corpo)}`)
}

const inteiro = (valor: unknown): valor is number => typeof valor === "number" && Number.isSafeInteger(valor)
const textoCurto = (valor: unknown, max = 128): valor is string => typeof valor === "string" && valor.length <= max

function lerCorpo(bruto: unknown): Corpo | null {
  if (typeof bruto !== "object" || bruto === null) return null
  const c = bruto as Record<string, unknown>
  const id = c["id"]
  switch (c["k"]) {
    case "r0":
      return inteiro(c["l"]) && inteiro(c["d"]) && nivel0DoFio(c["r"]) ? (c as unknown as R0) : null
    case "p1":
      return textoCurto(id) && textoCurto(c["para"]) && inteiro(c["d"]) && inteiro(c["l"]) && Array.isArray(c["tipos"])
        ? (c as unknown as P1)
        : null
    case "p2":
    case "pi":
    case "n1":
    case "n2":
      if (!textoCurto(id) || !inteiro(c["d"])) return null
      if ((c["k"] === "p2" || c["k"] === "pi") && (!textoCurto(c["para"]) || !inteiro(c["l"]))) return null
      if (c["k"] === "pi" && !(Array.isArray(c["c"]) && c["c"].every(chaveCurtaValida))) return null
      if (c["k"] !== "pi" && !Array.isArray(c["e"])) return null
      if ((c["k"] === "n1" || c["k"] === "n2") && !(inteiro(c["parte"]) && inteiro(c["de"]))) return null
      return c as unknown as Corpo
    case "pt":
      return textoCurto(id) &&
        textoCurto(c["para"]) &&
        inteiro(c["d"]) &&
        inteiro(c["l"]) &&
        Array.isArray(c["tipos"]) &&
        c["tipos"].length <= TIPOS_DO_RESUMO.length
        ? (c as unknown as PT)
        : null
    case "pp":
      return textoCurto(id) &&
        Array.isArray(c["c"]) &&
        c["c"].length <= PERFIS_POR_PEDIDO &&
        c["c"].every((conta) => textoCurto(conta, 300))
        ? (c as unknown as PP)
        : null
    case "pa":
      return textoCurto(id) &&
        textoCurto(c["para"]) &&
        inteiro(c["l"]) &&
        chaveCurtaValida(c["c"]) &&
        inteiro(c["i"]) &&
        (c["i"] as number) >= 0 &&
        textoCurto(c["m"], 64) &&
        (c["v"] === undefined || textoCurto(c["v"], 64))
        ? (c as unknown as PA)
        : null
    case "ri":
      if (!textoCurto(id) || !inteiro(c["de"]) || (c["de"] as number) < 0) return null
      if (c["f"] !== undefined && !(Array.isArray(c["f"]) && c["f"].length <= CHAVES_POR_PEDIDO && c["f"].every(chaveCurtaValida))) return null
      if (c["au"] !== undefined && !(Array.isArray(c["au"]) && c["au"].length <= AUTORES_POR_RI && c["au"].every((a) => textoCurto(a, 300)))) return null
      if (c["r"] !== undefined && !(inteiro(c["r"]) && (c["r"] as number) >= 0 && (c["r"] as number) <= 10 * 60_000)) return null
      return c as unknown as RI
    default:
      return null
  }
}

/** Split entries into groups whose JSON stays below `BYTES_POR_PARTE`. At least one group. */
function emPartes<T>(entradas: readonly T[]): T[][] {
  const partes: T[][] = [[]]
  let bytes = 0
  for (const entrada of entradas) {
    const tamanho = JSON.stringify(entrada).length + 1
    if (bytes + tamanho > BYTES_POR_PARTE && partes[partes.length - 1]!.length > 0) {
      partes.push([])
      bytes = 0
    }
    partes[partes.length - 1]!.push(entrada)
    bytes += tamanho
  }
  return partes
}

/** Time between profile requests in the same channel. */
const INTERVALO_DOS_PEDIDOS_DE_PERFIS_MS = 60_000
/** How long a requested account waits before requesting it again. */
const LEMBRAR_PERFIS_PEDIDOS_MS = 10 * 60_000
/** Profile request responses per channel, per minute, from each device. */
const RESPOSTAS_DE_PERFIS_POR_MINUTO = 6

const numeroOuZero = (valor: unknown): number => (typeof valor === "number" && Number.isFinite(valor) ? valor : 0)

function novoId(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(9)))
}

// ------------------------------------------------------- in-memory state

interface ResumoVisto {
  d: number
  l: number
  r: ResumoNivel0
  em: number
}

/** A fetch in progress: this device requesting what it lacks from a leaf. */
interface Descida {
  id: string
  canal: string
  /** The comparison window. Can move up if the responder moves up (their floor). */
  d: number
  tipos: TipoDoResumo[]
  lista: Folha[]
  tentativa: number
  responde: Folha
  /** `inteiro`: the integer-type request from the snapshot (S5), which skips levels 1 and 2. */
  fase: "n1" | "n2" | "itens" | "inteiro"
  /** This fetch is the snapshot of who joined (S5): requests integer types. */
  inteiro: boolean
  /** The snapshot, or a fetch that continues it: the "Receiving channel..." banner stays. */
  doInstantaneo: boolean
  /** The responder hit the per-minute cap (`ri.r`): the rest requests after this. */
  voltarEm?: number
  /** How many rounds per `ri.r` this request has had, counting those from fetches that continue it. */
  voltas: number
  /** Items that responses to this fetch applied in our vault. */
  aplicados: number
  temporizador: ReturnType<typeof setTimeout> | null
  partes: Map<number, unknown[]>
  /** Telemetry frames expected (from `ri`) and received. */
  relatosEsperados?: number
  /** The `ri` of the current request has arrived (brings `f`, `au` and `r`). */
  riVisto: boolean
  relatosRecebidos: Set<number>
  /** The keys of the current item request. */
  pedidas: string[]
  /** The ones the leaf said it could not give (`ri.f`), and their authors (`ri.au`). */
  naoDadas: string[]
  autores: string[]
  /** Leaves already tried in this fetch. */
  tentadas: Set<string>
  /** How many fetches in a row in this channel, to avoid looping. */
  seguidas: number
}

export interface EstatisticasDaSincronia {
  sinaisEnviados: number
  sinaisRecebidos: number
  sinaisIlegiveis: number
  resumosEnviados: number
  pedidosEnviados: number
  relatosEnviados: number
  tramasDeRelato: number
  bytesDeRelato: number
  relatosAplicados: number
  relatosRecusados: Partial<Record<Exclude<VeredictoDoRelato, { ok: true }>["razao"], number>>
  recusasDoServidor: number
  /** S5: snapshots requested, attachments sent, received and rejected. */
  instantaneosPedidos: number
  anexosEnviados: number
  bytesDeAnexos: number
  anexosRecebidos: number
  anexosRecusados: number
  /** Profiles to third parties: requests sent, response frames sent, profiles reported and applied. */
  pedidosDePerfis: number
  respostasDePerfis: number
  perfisRelatados: number
  perfisAplicados: number
}

/**
 * What happens to an attachment request (S5, §5.4). `cancelled`: the person
 * gave up on it. `pending`: the queue was full (`FILA_DE_ANEXOS`), and the
 * request did not enter; the interface offers the button again.
 */
export type DesfechoDoAnexo =
  | { ok: true; anexo: Record<string, unknown> }
  | { ok: false; motivo: "sem-prova" | "sem-ligacao" | "ninguem" | "recusado" | "cancelado" | "por-pedir" | "falhou" }

/**
 * Attachment requests waiting their turn, at most. Opening an album of forty
 * photos dumped at once would request all forty, one after another, for
 * minutes; those beyond this stay "pending".
 */
export const FILA_DE_ANEXOS = 5

/** An attachment request waiting its turn. */
interface AnexoNaFila {
  canal: string
  alvo: string
  indice: number
  resolver: (desfecho: DesfechoDoAnexo) => void
}

/** An attachment request in progress: one leaf at a time. */
interface PedidoDeAnexo {
  id: string
  canal: string
  autor: string
  alvo: string
  c: string
  i: number
  m: string
  lista: Folha[]
  tentativa: number
  responde: Folha
  temporizador: ReturnType<typeof setTimeout> | null
  recusado: boolean
  resolver: (desfecho: DesfechoDoAnexo) => void
  /** In a video: the byte summary, and the attachment (no bytes) returned when it arrives whole. */
  video?: { sha: string; anexo: Record<string, unknown> }
  /** The video parts were requested from `responde`, and they may be serving them (see `#largarVideo`). */
  partesPedidas?: boolean
}

/** The video this device is serving: the request, who asked for it, and whether they gave up. */
interface VideoServido {
  id: string
  para: string
  parar: boolean
}

export class AntiEntropia {
  readonly #porta: PortaDaAntiEntropia
  readonly #vivas = new Vivacidade()
  readonly #tectos = new TectoPorMinuto()
  /** Attachment bytes per minute, separate: their window is `TECTOS_DOS_ANEXOS.janelaMs`. */
  readonly #tectoDosAnexos = new TectoPorMinuto(TECTOS_DOS_ANEXOS.janelaMs)
  readonly #recuo = new Recuo()
  /** The signal key of each channel, by epoch. */
  readonly #chaves = new Map<string, ChaveDoSinal>()
  /** The digests seen, per channel and per device. */
  readonly #vistos = new Map<string, Map<string, ResumoVisto>>()
  /** The devices that showed they know anti-entropy, per channel. */
  readonly #capazes = new Map<string, Set<string>>()
  readonly #descidas = new Map<string, Descida>()
  readonly #respostasAgendadas = new Map<string, { temporizador: ReturnType<typeof setTimeout>; d: number }>()
  /** What we already responded to, so a repeated request does not go out twice. */
  readonly #respondidos = new Set<string>()
  /**
   * Our last trigger digest in each channel (in our position's window).
   * A trigger only fires if our digest changed since it: this is what "new
   * events since the last digest" (§4.4) means, accounting for our own
   * sends, which the server anchor does not see.
   */
  readonly #ultimoProprio = new Map<string, string>()
  /** One pass per channel at a time: channel signals are handled in order. */
  readonly #filas = new Map<string, Promise<void>>()
  readonly #temporizadores = new Set<ReturnType<typeof setTimeout>>()
  readonly estatisticas: EstatisticasDaSincronia = {
    sinaisEnviados: 0,
    sinaisRecebidos: 0,
    sinaisIlegiveis: 0,
    resumosEnviados: 0,
    pedidosEnviados: 0,
    relatosEnviados: 0,
    tramasDeRelato: 0,
    bytesDeRelato: 0,
    relatosAplicados: 0,
    relatosRecusados: {},
    recusasDoServidor: 0,
    instantaneosPedidos: 0,
    anexosEnviados: 0,
    bytesDeAnexos: 0,
    anexosRecebidos: 0,
    anexosRecusados: 0,
    pedidosDePerfis: 0,
    respostasDePerfis: 0,
    perfisRelatados: 0,
    perfisAplicados: 0,
  }

  /** Profiles to third parties, from the requester: the last request per channel and accounts already requested. */
  readonly #perfisPedidos = new Map<string, { em: number; contas: Set<string> }>()
  /** From the responder: the answer scheduled by turn, by `canal|id`. */
  readonly #respostasDePerfis = new Map<string, ReturnType<typeof setTimeout>>()
  /** Profile requests that someone has already answered (`canal|id`), so others stay silent. */
  readonly #perfisRespondidos = new Set<string>()

  /**
   * Channels with the snapshot to request (S5): who joined via Welcome and
   * has not yet received the integer types. In-memory only: after reload, the
   * normal fetch fixes what is missing.
   */
  readonly #instantaneos = new Set<string>()
  /** When each snapshot started waiting for the first response, so the banner gives up. */
  readonly #esperasDoInstantaneo = new Map<string, ReturnType<typeof setTimeout>>()
  /** Channels with the snapshot capped per minute, waiting to request the rest. */
  readonly #continuacoes = new Set<string>()
  /** The sheet that responded to each channel's snapshot: progress is measured against its summary. */
  readonly #instantaneoDe = new Map<string, string>()
  /** Channels whose last request got no response (the "no response" state). */
  readonly #semResposta = new Set<string>()
  /** The time of the last comparison per channel: a summary sent or heard. */
  readonly #comparadoEm = new Map<string, number>()
  /** The attachment request in progress, and the queue of others (one at a time, §4.4). */
  #anexoEmCurso: PedidoDeAnexo | null = null
  readonly #filaDeAnexos: AnexoNaFila[] = []
  /** The request that is running (also before it goes to the network), so the queue can wait for it. */
  #anexoAVez: AnexoNaFila | null = null
  /** This device is sending an attachment: one at a time (§4.4). */
  #aEnviarAnexo = false
  /** The video this device is serving, to stop when the requester gives up. */
  #videoServido: VideoServido | null = null
  /** When each attachment was sent (`canal|c|i`): see `TECTOS_DOS_ANEXOS.repeticaoMs`. */
  readonly #anexosEnviados = new Map<string, number>()
  /** The attachments received and verified (`canal|c|i|m`), and how many bytes they take. See `TECTOS_DOS_ANEXOS.memoriaBytes`. */
  readonly #anexosRecebidos = new Map<string, Record<string, unknown>>()
  #bytesRecebidosEmMemoria = 0

  constructor(porta: PortaDaAntiEntropia) {
    this.#porta = porta
  }

  get #meuAparelho(): string {
    return toBase64(this.#porta.eu.aparelho)
  }

  // ----------------------------------------------------------- the floor

  #cofre(): NonNullable<CofreDaSincronia["sincronia"]> {
    const cofre = this.#porta.conteudo() as unknown as CofreDaSincronia
    cofre.sincronia ??= {}
    return cofre.sincronia
  }

  /**
   * The floor of conversation reports in a channel. See `CofreDaSincronia`.
   *
   * No record: the location of this device, which is safe (nobody who joined before
   * us needs a lower floor than ours to be protected, and whoever joined after made
   * a commit that `aoCrescer` saw).
   */
  piso(canal: string): number {
    const piso = this.#cofre().piso?.[canal]
    return piso ?? this.#porta.lugar(canal)
  }

  #porPiso(canal: string, seq: number): void {
    const cofre = this.#cofre()
    const antes = cofre.piso?.[canal]
    if (antes !== undefined && antes >= seq) return
    cofre.piso = { ...cofre.piso, [canal]: seq }
    this.#porta.marcarParaGravar()
  }

  /**
   * Someone joined the channel, at the commit with this `seq`. From now on, only
   * reports conversation said after it.
   */
  aoCrescer(canal: string, seq: number): void {
    if (seq >= 0) this.#porPiso(canal, seq)
  }

  /**
   * On the connection. The first time this version runs, channels that already existed
   * get the floor at today's anchor: we don't know who joined them or when, and
   * the safe choice is not to report.
   */
  aoLigar(canais: readonly string[]): void {
    const cofre = this.#cofre()
    if (!cofre.migrado) {
      for (const canal of canais) {
        if (cofre.piso?.[canal] === undefined) cofre.piso = { ...cofre.piso, [canal]: this.#porta.ancora(canal) }
      }
      cofre.migrado = true
      this.#porta.marcarParaGravar()
    }
    // Requests from the previous connection died with it.
    for (const descida of this.#descidas.values()) this.#parar(descida)
    this.#descidas.clear()
  }

  aoDesligar(): void {
    for (const temporizador of this.#temporizadores) clearTimeout(temporizador)
    this.#temporizadores.clear()
    this.#esperasDoInstantaneo.clear()
    if (this.#anexoEmCurso) this.#fecharAnexo(this.#anexoEmCurso, { ok: false, motivo: "sem-ligacao" })
    this.#respostasAgendadas.clear()
    // Profile requests too: the next connection has different people listening.
    this.#perfisPedidos.clear()
    this.#respostasDePerfis.clear()
    this.#resumosAdiados.clear()
    /*
      A snapshot mid-way (cut off by the cap, waiting for the next cycle, or
      in a descent that continues it) dies with the connection: the cycle timer
      was already cleaned above. It goes back to pending, and the bar goes away,
      so it doesn't stay "Receiving the channel..." forever. The request goes out
      again at the first summary from an old member after reconnecting.
    */
    const interrompidos = new Set(this.#continuacoes)
    for (const descida of this.#descidas.values()) if (descida.doInstantaneo) interrompidos.add(descida.canal)
    this.#continuacoes.clear()
    for (const descida of this.#descidas.values()) this.#parar(descida)
    this.#descidas.clear()
    for (const canal of interrompidos) {
      this.#instantaneos.add(canal)
      this.#mudou(canal)
    }
  }

  #mais(ms: number, fazer: () => void): ReturnType<typeof setTimeout> {
    const temporizador = setTimeout(() => {
      this.#temporizadores.delete(temporizador)
      fazer()
    }, ms)
    this.#temporizadores.add(temporizador)
    return temporizador
  }

  #cancelar(temporizador: ReturnType<typeof setTimeout> | null | undefined): void {
    if (!temporizador) return
    clearTimeout(temporizador)
    this.#temporizadores.delete(temporizador)
  }

  // ------------------------------------------------------ liveness and capability

  /** A live event from this device, in this channel: it is live. */
  notarVivo(aparelho: string): void {
    this.#vivas.notar(aparelho, this.#porta.agora())
  }

  /** Someone's device signal, with capabilities. */
  notarCapacidades(canal: string, aparelho: string, capacidades: readonly string[]): void {
    if (capacidades.includes(CAPACIDADE_SINCRONIA)) this.#capaz(canal, aparelho)
  }

  #capaz(canal: string, aparelho: string): void {
    let capazes = this.#capazes.get(canal)
    if (!capazes) {
      capazes = new Set()
      this.#capazes.set(canal, capazes)
    }
    capazes.add(aparelho)
  }

  #viva(folha: Folha): boolean {
    return this.#vivas.viva(folha.aparelho, this.#porta.agora()) || this.#porta.online(folha.address)
  }

  #ehCapaz(canal: string, folha: Folha): boolean {
    return this.#capazes.get(canal)?.has(folha.aparelho) === true
  }

  /** Whether this device is the lowest live sheet among those that know: the clock's choice (§4.4). */
  #souOEleito(canal: string): boolean {
    const meu = this.#meuAparelho
    const folhas = this.#porta.folhas(canal).filter((f) => f.aparelho === meu || (this.#ehCapaz(canal, f) && this.#viva(f)))
    folhas.sort((a, b) => a.indice - b.indice)
    return folhas[0]?.aparelho === meu
  }

  // ------------------------------------------------------------ the summary

  #itens(canal: string, desde?: number, comApagados = false): ItemDoResumo[] {
    const membros = this.#porta.membros(canal)
    return itensDoCanal(this.#porta.conteudo(), canal, {
      membros,
      proprio: this.#porta.eu.address,
      ...(desde !== undefined ? { desde } : {}),
      ...(comApagados ? { comApagados } : {}),
    })
  }

  /** See `alvosDoMural` in `CofreDaSincronia`. Cap like the one for amendments in the vault. */
  #marcarAlvoDoMural(canal: string, alvo: string): void {
    const cofre = this.#cofre()
    const antes = cofre.alvosDoMural?.[canal] ?? []
    if (antes.includes(alvo)) return
    const depois = [...antes, alvo].slice(-ALVOS_DO_MURAL_POR_CANAL)
    cofre.alvosDoMural = { ...cofre.alvosDoMural, [canal]: depois }
    this.#porta.marcarParaGravar()
  }

  /** This device's level 0, with the window starting at `desde`. For diagnostics (§8.2) and for the script. */
  resumoDoCanal(canal: string, desde?: number): ResumoNivel0 {
    return resumoNivel0(this.#itens(canal, desde ?? this.#porta.lugar(canal)))
  }

  /**
   * Send our level 0 summary. `janela` is that of a response (the asker's location,
   * if larger than ours). `daLigacao`: the trigger for recovery end, which passes
   * the interval between summaries once per connection (reconnection is the trigger
   * that fixes it, and doesn't wait 20 s for a summary from before the drop).
   */
  async enviarResumo(canal: string, janela?: number, daLigacao = false): Promise<boolean> {
    if (!this.#porta.podeSinalizar() || !this.#porta.elegivel(canal)) return false
    const agora = this.#porta.agora()
    const l = this.#porta.lugar(canal)
    const d = Math.max(l, janela ?? l)
    const corpo: R0 = { k: "r0", l, d, r: nivel0ParaFio(resumoNivel0(this.#itens(canal, d))) }
    const marca = `${d}|${JSON.stringify(corpo.r)}`
    const ultimo = this.#ultimoR0.get(canal)
    // A trigger equal to the last one that went out less than a minute ago says nothing new.
    // A response still goes out: it goes to whoever might not have heard the previous one. And
    // the reconnection one also does: our side might not have changed, but theirs changed while
    // we were away, and it's this summary that makes them respond. Without this, someone who
    // joins already complete (the Welcome snapshot, 1.1), drops and reconnects in the same minute
    // would miss what was said in the meantime until the next trigger (measured in
    // `sincronia-s4.test.ts`, "device revoked reporting").
    if (janela === undefined && !daLigacao && ultimo && ultimo.marca === marca && agora - ultimo.em < 60_000) return false
    const passou =
      janela === undefined
        ? this.#tectoDoGatilho.gastar(canal, 1, 1, agora) || daLigacao
        : this.#tectos.gastar(`r0-resposta|${canal}`, 1, TECTOS_DA_SINCRONIA.respostasPorCanalPorMinuto, agora)
    if (!passou) {
      if (janela === undefined && !this.#resumosAdiados.has(canal)) {
        this.#resumosAdiados.add(canal)
        this.#mais(this.#tectoDoGatilho.liberaEm(canal, agora) + 10, () => {
          this.#resumosAdiados.delete(canal)
          void this.enviarResumo(canal).catch(() => false)
        })
      }
      return false
    }
    const saiu = await this.#enviar(canal, corpo)
    if (saiu) {
      this.#notarComparacao(canal)
      this.estatisticas.resumosEnviados += 1
      if (janela === undefined) this.#ultimoProprio.set(canal, marca)
      this.#ultimoR0.set(canal, { marca, em: agora })
    }
    return saiu
  }

  /** One trigger summary per channel in each interval. See `intervaloEntreResumosMs`. */
  readonly #tectoDoGatilho = new TectoPorMinuto(TECTOS_DA_SINCRONIA.intervaloEntreResumosMs)

  /** Channels with a trigger summary waiting for the cap. */
  readonly #resumosAdiados = new Set<string>()

  /** The last summary that went out from each channel, to avoid repeating the same one within a minute. */
  readonly #ultimoR0 = new Map<string, { marca: string; em: number }>()

  /** Did our summary change since the last one we sent in this channel? */
  #mudouDesdeOUltimo(canal: string): boolean {
    const l = this.#porta.lugar(canal)
    const marca = `${l}|${JSON.stringify(nivel0ParaFio(resumoNivel0(this.#itens(canal, l))))}`
    return this.#ultimoProprio.get(canal) !== marca
  }

  // ------------------------------------------------------------ gatilhos

  /**
   * Recovery end on connection (§4.4): the device that connected sends its summary,
   * only in channels where it changed since the last one it sent. Never in a direct
   * without known divergence (a gap). If nothing changed on our side, whoever has
   * new things says theirs when they see us come online (`aoVerOnline`).
   */
  async aoFimDaRecuperacao(canais: readonly string[], temLacunas: (canal: string) => boolean): Promise<void> {
    for (const canal of canais) {
      if (!this.#porta.elegivel(canal)) continue
      if (this.#porta.ehDirecta(canal) && !temLacunas(canal)) continue
      if (!this.#mudouDesdeOUltimo(canal) && !this.#voltouDepressa(canal)) continue
      await this.enviarResumo(canal, undefined, true).catch(() => false)
    }
  }

  /**
   * We sent a summary in this channel less than a minute ago, and the connection
   * dropped and came back. Our side hasn't changed, but theirs might have while
   * we were away, and whoever has new things only says theirs when they see us
   * come online (`aoVerOnline`), once per channel per minute: the first coming
   * online already used that. Without this summary, someone who joins already
   * complete (the Welcome snapshot, 1.1) and drops right after would miss what
   * was said in the meantime until the next trigger (measured in
   * `sincronia-s4.test.ts`, "device revoked reporting"). Outside that minute,
   * `aoVerOnline` from others covers it, and nothing is paid.
   */
  #voltouDepressa(canal: string): boolean {
    const ultimo = this.#ultimoR0.get(canal)
    return ultimo !== undefined && this.#porta.agora() - ultimo.em < 60_000
  }

  /**
   * Welcome applied (§4.4): whoever joined sends their summary, which is almost
   * empty, and others respond with theirs.
   *
   * The floor ALWAYS goes up to the new location, not just when it doesn't exist.
   * On re-entry the Welcome changes the location, and between the old and new
   * location someone might have joined by a commit this device never saw (it was
   * outside the tree). With the old floor, it would report to that member
   * conversation earlier than their location (decision 2a). `#porPiso` only goes up.
   */
  async aoWelcome(canal: string): Promise<void> {
    this.#porPiso(canal, this.#porta.lugar(canal))
    if (this.#porta.ehDirecta(canal) || !this.#porta.elegivel(canal)) return
    /*
      S5: the snapshot. Our summary is almost empty; at the first summary from
      another member, the whole type is requested (`#aoR0`). If no one responds
      within the time of two sheets, the bar gives up and the channel goes "no response":
      the request still goes out when someone appears, because the channel is marked.
    */
    this.#instantaneos.add(canal)
    this.#semResposta.delete(canal)
    const anterior = this.#esperasDoInstantaneo.get(canal)
    this.#cancelar(anterior)
    this.#esperasDoInstantaneo.set(
      canal,
      this.#mais(TECTOS_DA_SINCRONIA.esperaDoPedidoMs * 2, () => {
        this.#esperasDoInstantaneo.delete(canal)
        if (this.#descidas.get(canal)?.inteiro) return
        if (this.#instantaneos.has(canal)) {
          this.#semResposta.add(canal)
          this.#mudou(canal)
        }
      }),
    )
    this.#mudou(canal)
    await this.enviarResumo(canal).catch(() => false)
  }

  // --------------------------------------------------- the state, for the interface

  #notarComparacao(canal: string): void {
    this.#comparadoEm.set(canal, this.#porta.agora())
    this.#mudou(canal)
  }

  #mudou(canal: string): void {
    try {
      this.#porta.aoMudar?.(canal)
    } catch {
      // Listeners cannot break sync.
    }
  }

  /**
   * The sync state of a channel, for the interface (§2.5): equal, repairing,
   * no response, or still to compare; and, during the snapshot, progress per type
   * against the responder's summary.
   */
  estadoDoCanal(canal: string): SincroniaDoCanal {
    const descida = this.#descidas.get(canal)
    const esperaInstantaneo = this.#instantaneos.has(canal) && this.#esperasDoInstantaneo.has(canal)
    const continua = this.#continuacoes.has(canal)
    const aReceber = descida?.doInstantaneo === true || continua || (esperaInstantaneo && !this.#semResposta.has(canal))
    let progresso: SincroniaDoCanal["progresso"] = []
    const deQuem = descida?.responde.aparelho ?? this.#instantaneoDe.get(canal)
    if (aReceber && deQuem) {
      const visto = this.#vistos.get(canal)?.get(deQuem)
      if (visto) progresso = progressoDoInstantaneo(resumoNivel0(this.#itens(canal, visto.d)), visto.r, TIPOS_DO_RESUMO)
    }
    const estado: SincroniaDoCanal["estado"] =
      descida || aReceber || continua
        ? "a-reparar"
        : this.#semResposta.has(canal)
          ? "sem-resposta"
          : this.#comparadoEm.has(canal)
            ? "igual"
            : "por-comparar"
    return { channel: canal, estado, aReceber, progresso, ultimaComparacao: this.#comparadoEm.get(canal) ?? null }
  }

  /**
   * The ten-minute clock with the connection live (§4.4): only the chosen one,
   * and only in channels with events since their last summary. Never in directs.
   */
  async aPassagem(canais: readonly string[]): Promise<void> {
    for (const canal of canais) {
      if (!this.#porta.elegivel(canal) || this.#porta.ehDirecta(canal)) continue
      if (!this.#mudouDesdeOUltimo(canal) || !this.#souOEleito(canal)) continue
      await this.enviarResumo(canal).catch(() => false)
    }
  }

  /**
   * An account came online (§4.4): in channels we share with it (outside directs),
   * whoever has new things since the last summary they sent says theirs (it might
   * be what they're missing), and the chosen one, so they can compare on arrival.
   */
  async aoVerOnline(address: string, canais: readonly string[]): Promise<void> {
    const agora = this.#porta.agora()
    for (const canal of canais) {
      if (!this.#porta.elegivel(canal) || this.#porta.ehDirecta(canal)) continue
      if (!this.#porta.membros(canal).includes(address)) continue
      if (!this.#mudouDesdeOUltimo(canal) && !this.#souOEleito(canal)) continue
      /*
        One per channel per minute. A presence that flickers (or thirty accounts
        coming online in the morning) would ask for a summary per flicker; the
        trigger cap delays it, but delaying thirty means sending thirty. Whoever
        came online and didn't hear this one sends theirs at recovery end.
      */
      if (!this.#tectos.gastar(`online|${canal}`, 1, 1, agora)) continue
      await this.enviarResumo(canal).catch(() => false)
    }
  }

  // ------------------------------------------------------------ enviar

  async #chave(canal: string): Promise<ChaveDoSinal | null> {
    const epoca = this.#porta.epocaAtual(canal)
    if (epoca === undefined) return null
    const guardada = this.#chaves.get(canal)
    if (guardada && guardada.epoca === epoca) return guardada
    const nova = await this.#porta.derivarChave(canal)
    if (nova) this.#chaves.set(canal, nova)
    return nova
  }

  async #enviar(canal: string, corpo: Corpo): Promise<boolean> {
    if (!this.#porta.podeSinalizar()) return false
    const agora = this.#porta.agora()
    if (this.#recuo.bloqueado(canal, agora)) return false
    const chave = await this.#chave(canal)
    if (!chave) return false
    const eu = this.#porta.eu
    const envelope: Envelope = {
      ap: toBase64(eu.aparelho),
      as: toBase64(eu.assinar(mensagemDoSinal(canal, eu.address, chave.epoca, corpo))),
      c: corpo,
    }
    const sinal = toBase64(selarSinal(chave, canal, new TextEncoder().encode(JSON.stringify(envelope))))
    if (sinal.length > TECTOS_DA_SINCRONIA.sinalMaxCaracteres) return false
    /*
      The server counts OUTGOING bytes: the size times the copies, one for each
      other connection in the channel (`#sinal` at the gateway). Counting just
      the size would let through, in an eleven-member channel, ten times more than
      the cap says, and a cycle of shares would hit `sinal-abuse`, which closes
      the connection.
      */
    const custo = sinal.length * this.#copias(canal)
    if (this.#tectos.usado("sinais", agora) >= TECTOS_DA_SINCRONIA.sinaisPorMinuto) return false
    if (!this.#tectos.gastar(`bytes|${canal}`, custo, TECTOS_DA_SINCRONIA.bytesDeSinalPorCanalPorMinuto, agora)) return false
    this.#tectos.gastar("sinais", 1, Number.MAX_SAFE_INTEGER, agora)
    try {
      this.#porta.enviarSinal(canal, sinal, novoId())
    } catch {
      return false
    }
    this.estatisticas.sinaisEnviados += 1
    return true
  }

  /**
   * How many copies the server delivers of our signal in this channel: one for
   * each other sheet connected (live, or with the account online). Never less
   * than one. On top of that, if anything: a dead sheet we count only makes the
   * cap tighter.
   */
  #copias(canal: string): number {
    const meu = this.#meuAparelho
    const ligadas = this.#porta.folhas(canal).filter((folha) => folha.aparelho !== meu && this.#viva(folha)).length
    return Math.max(1, ligadas)
  }

  /** A request costs one signal plus the request cap (§4.4). */
  async #pedir(canal: string, corpo: P1 | P2 | PI | PT | PA, descida?: Descida): Promise<boolean> {
    let agora = this.#porta.agora()
    /*
      The snapshot with the request cap spent waits for it, instead of giving up (S5):
      one from a large channel comes in cycles of one minute (the report cap), and
      each cycle spends requests. Giving up would leave the channel "no response"
      until the ten-minute clock. While waiting, the request wait doesn't run;
      after, it only continues if the descent is still this one. A constant descent
      (S4) still gives up on the first, as before.
    */
    if (descida?.doInstantaneo && this.#tectos.usado(`pedidos|${canal}`, agora) >= TECTOS_DA_SINCRONIA.pedidosPorCanalPorMinuto) {
      const id = descida.id
      const espera = this.#tectos.liberaEm(`pedidos|${canal}`, agora) + 50
      this.#cancelar(descida.temporizador)
      descida.temporizador = null
      await new Promise<void>((resolver) => this.#mais(espera, resolver))
      if (this.#descidas.get(canal) !== descida || descida.id !== id) return true
      this.#armarEspera(descida)
      agora = this.#porta.agora()
    }
    if (this.#tectos.usado("pedidos", agora) >= TECTOS_DA_SINCRONIA.pedidosPorMinuto) return false
    if (!this.#tectos.gastar(`pedidos|${canal}`, 1, TECTOS_DA_SINCRONIA.pedidosPorCanalPorMinuto, agora)) return false
    this.#tectos.gastar("pedidos", 1, Number.MAX_SAFE_INTEGER, agora)
    const saiu = await this.#enviar(canal, corpo)
    if (saiu) this.estatisticas.pedidosEnviados += 1
    return saiu
  }

  // ------------------------------------------------------------ receber

  /** A frame from `channel.sinal` on the server. */
  aoSinal(frame: { channel: string; from: string; sinal: string }): Promise<void> {
    const canal = frame.channel
    const anterior = this.#filas.get(canal) ?? Promise.resolve()
    const proxima = anterior.then(() => this.#tratarSinal(frame)).catch(() => {})
    this.#filas.set(canal, proxima)
    return proxima
  }

  /** A server refusal: back off (§4.4). */
  aoRecusa(frame: { channel: string; code: string; retryAfterMs?: number | undefined }): void {
    this.estatisticas.recusasDoServidor += 1
    if (frame.code === "sinal-rate-limited" || frame.code === "sinal-channel-busy") {
      this.#recuo.recusado(frame.channel, this.#porta.agora(), frame.retryAfterMs)
    } else if (frame.code === "sinal-too-large" || frame.code === "sinal-no-seat") {
      // Waiting won't help; back off as far as possible to avoid retrying on the same channel.
      this.#recuo.recusado(frame.channel, this.#porta.agora(), TECTOS_DA_SINCRONIA.recuoMaximoMs)
    }
  }

  async #tratarSinal(frame: { channel: string; from: string; sinal: string }): Promise<void> {
    const canal = frame.channel
    if (!this.#porta.elegivel(canal)) return
    let bytes: Uint8Array
    try {
      bytes = fromBase64(frame.sinal)
    } catch {
      this.estatisticas.sinaisIlegiveis += 1
      return
    }
    const epoca = epocaDoSinal(bytes)
    const chave = await this.#chave(canal)
    // A signal from an epoch that is not ours gets dropped and does not count toward deafness.
    if (!chave || epoca !== chave.epoca) {
      this.estatisticas.sinaisIlegiveis += 1
      return
    }
    const aberto = abrirSinal(chave, canal, bytes)
    if (!aberto) {
      this.estatisticas.sinaisIlegiveis += 1
      return
    }
    let envelope: Envelope
    try {
      envelope = JSON.parse(new TextDecoder().decode(aberto)) as Envelope
    } catch {
      this.estatisticas.sinaisIlegiveis += 1
      return
    }
    const corpo = lerCorpo(envelope?.c)
    if (!corpo || typeof envelope.ap !== "string" || typeof envelope.as !== "string") {
      this.estatisticas.sinaisIlegiveis += 1
      return
    }
    // The device must be a leaf of this account, in this tree, and signed by it.
    const folha = this.#porta.folhas(canal).find((f) => f.address === frame.from && f.aparelho === envelope.ap)
    if (!folha || folha.aparelho === this.#meuAparelho) return
    let valida = false
    try {
      valida = verify(fromBase64(envelope.ap), mensagemDoSinal(canal, frame.from, chave.epoca, corpo), fromBase64(envelope.as))
    } catch {
      valida = false
    }
    if (!valida) {
      this.estatisticas.sinaisIlegiveis += 1
      return
    }
    if (this.#porta.bloqueado(canal, frame.from)) return
    this.estatisticas.sinaisRecebidos += 1
    this.notarVivo(folha.aparelho)
    this.#capaz(canal, folha.aparelho)

    switch (corpo.k) {
      case "r0":
        return this.#aoR0(canal, folha, corpo)
      case "p1":
        if (corpo.para === this.#meuAparelho) await this.#responderN1(canal, corpo)
        return
      case "p2":
        if (corpo.para === this.#meuAparelho) await this.#responderN2(canal, corpo)
        return
      case "pi":
        if (corpo.para === this.#meuAparelho) await this.#responderItens(canal, corpo)
        return
      case "pt":
        if (corpo.para === this.#meuAparelho) await this.#responderTipos(canal, corpo)
        return
      case "pa":
        if (corpo.para === this.#meuAparelho) await this.#responderAnexo(canal, corpo, folha)
        return
      case "pp":
        return this.#aoPedidoDePerfis(canal, folha, corpo)
      case "n1":
      case "n2":
        return this.#aoNivel(canal, folha, corpo)
      case "ri":
        if (this.#anexoEmCurso?.id === corpo.id) return this.#anexoSemResposta(this.#anexoEmCurso, folha)
        // The caller who asked us for video gave up on it (`#largarVideo`): missing parts remain.
        if (this.#videoServido?.id === corpo.id && this.#videoServido.para === folha.aparelho) {
          this.#videoServido.parar = true
          return
        }
        return this.#aoRi(canal, folha, corpo)
    }
  }

  // ------------------------------------------------------ the summary of another

  async #aoR0(canal: string, de: Folha, corpo: R0): Promise<void> {
    const r = nivel0DoFio(corpo.r)
    if (!r) return
    const agora = this.#porta.agora()
    let vistos = this.#vistos.get(canal)
    if (!vistos) {
      vistos = new Map()
      this.#vistos.set(canal, vistos)
    }
    vistos.set(de.aparelho, { d: corpo.d, l: corpo.l, r, em: agora })
    this.#notarComparacao(canal)

    const meuLugar = this.#porta.lugar(canal)
    // Types with a window only compare if its window starts at our position or later: before
    // it, its history is not ours, and both are correct.
    const comJanela = corpo.d >= meuLugar
    const meu = resumoNivel0(this.#itens(canal, corpo.d))
    const tipos = TIPOS_DO_RESUMO.filter(
      (tipo) =>
        TIPOS_RELATAVEIS.has(tipo) &&
        (comJanela || !TIPOS_COM_JANELA.has(tipo)) &&
        (meu[tipo].n !== r[tipo].n || meu[tipo].h !== r[tipo].h),
    )

    const agendada = this.#respostasAgendadas.get(canal)
    /*
      Only the snapshot is served by those who had a position BEFORE ours, and only if
      their summary shows state or wall. Two devices (or two invites) that join via the
      same commit hear the empty summary from each other first: equal to ours, and proves
      nothing. With it, the snapshot would end before an old member replies, and `pt`
      never leaves.
    */
    const serveAoInstantaneo =
      this.#instantaneos.has(canal) && corpo.l < meuLugar && TIPOS_DO_INSTANTANEO.some((tipo) => r[tipo].n > 0)
    // The snapshot ended without asking anything: the state and wall of whoever spoke are now ours.
    if (serveAoInstantaneo && !tipos.some(doInstantaneo)) this.#instantaneoFeito(canal)
    if (tipos.length === 0) {
      // Someone said the same thing we were about to say: we stay silent (suppression).
      if (agendada && agendada.d === corpo.d) {
        this.#cancelar(agendada.temporizador)
        this.#respostasAgendadas.delete(canal)
      }
      return
    }

    // By item count: only those who can have fewer descend, and only those who can have more reply.
    const possoTerMenos = tipos.some((tipo) => r[tipo].n >= meu[tipo].n)
    const possoTerMais = tipos.some((tipo) => meu[tipo].n >= r[tipo].n)
    /*
      S5: a new joiner asks for state and wall types COMPLETE, without descending (§5.1).
      The window conversation is left for the usual descent, which `#acabar` starts next
      if there is still a difference.
    */
    const inteiros = serveAoInstantaneo ? tipos.filter((tipo) => doInstantaneo(tipo) && r[tipo].n > 0) : []
    if (inteiros.length > 0) {
      this.#instantaneoDe.set(canal, de.aparelho)
      this.#comecarDescida(canal, Math.max(corpo.d, meuLugar), inteiros, de, r, 0, true)
    }
    else if (possoTerMenos && comJanela) this.#comecarDescida(canal, corpo.d, tipos, de, r)
    else if (possoTerMenos) this.#comecarDescida(canal, Math.max(corpo.d, meuLugar), tipos.filter((t) => !TIPOS_COM_JANELA.has(t)), de, r)
    if (possoTerMais) this.#agendarResposta(canal, de, Math.max(corpo.l, meuLugar))
  }

  /**
   * Reply to a summary with ours, after waiting for suppression. In the window of whoever
   * asked (or ours, if it comes later).
   */
  #agendarResposta(canal: string, de: Folha, janela: number): void {
    if (this.#respostasAgendadas.has(canal)) return
    const meu = this.#meuAparelho
    const folhas = this.#porta
      .folhas(canal)
      .filter((f) => f.aparelho !== de.aparelho && (f.aparelho === meu || (this.#ehCapaz(canal, f) && this.#viva(f))))
    const espera = esperaDeSupressao(folhas, meu)
    const temporizador = this.#mais(espera, () => {
      this.#respostasAgendadas.delete(canal)
      void this.enviarResumo(canal, janela).catch(() => false)
    })
    this.#respostasAgendadas.set(canal, { temporizador, d: janela })
  }

  // ------------------------------------------------------------ descer

  #comecarDescida(
    canal: string,
    d: number,
    tipos: TipoDoResumo[],
    de: Folha,
    r: ResumoNivel0,
    seguidas = 0,
    inteiro = false,
    doInstantaneo = inteiro,
    voltas = 0,
  ): void {
    if (tipos.length === 0 || this.#descidas.has(canal)) return
    // Who can reply: leaves whose last summary, in the same window, shows the same data as
    // this one in different types (§4.4, point 3).
    const vistos = this.#vistos.get(canal)
    const comDados = (folha: Folha): boolean => {
      if (folha.aparelho === de.aparelho) return true
      const visto = vistos?.get(folha.aparelho)
      return visto !== undefined && visto.d === d && tipos.every((tipo) => visto.r[tipo].h === r[tipo].h)
    }
    const lista = candidatos(this.#porta.folhas(canal), {
      proprio: this.#meuAparelho,
      capaz: (folha) => this.#ehCapaz(canal, folha),
      viva: (folha) => this.#viva(folha),
      comDados,
    })
    const responde = eleger(lista, 0)
    if (!responde) return
    const descida: Descida = {
      id: novoId(),
      canal,
      d,
      tipos,
      lista,
      tentativa: 0,
      responde,
      fase: inteiro ? "inteiro" : "n1",
      inteiro,
      doInstantaneo,
      temporizador: null,
      partes: new Map(),
      relatosRecebidos: new Set(),
      pedidas: [],
      naoDadas: [],
      autores: [],
      tentadas: new Set([responde.aparelho]),
      seguidas,
      voltas,
      aplicados: 0,
      riVisto: false,
    }
    this.#descidas.set(canal, descida)
    this.#mudou(canal)
    void this.#pedirPrimeiro(descida)
  }

  /** The first request in a descent: the full type (snapshot), or level 1. */
  #pedirPrimeiro(descida: Descida): Promise<void> {
    return descida.inteiro ? this.#pedirInteiro(descida) : this.#pedirN1(descida)
  }

  async #pedirInteiro(descida: Descida): Promise<void> {
    this.#armarEspera(descida)
    const saiu = await this.#pedir(descida.canal, {
      k: "pt",
      id: descida.id,
      para: descida.responde.aparelho,
      d: descida.d,
      l: this.#porta.lugar(descida.canal),
      tipos: descida.tipos,
    }, descida)
    if (saiu) this.estatisticas.instantaneosPedidos += 1
    else this.#acabar(descida, false)
  }

  #parar(descida: Descida): void {
    this.#cancelar(descida.temporizador)
    descida.temporizador = null
  }

  /** No reply in time: the next leaf, from the start (§4.4, point 5). */
  #armarEspera(descida: Descida): void {
    this.#cancelar(descida.temporizador)
    descida.temporizador = this.#mais(TECTOS_DA_SINCRONIA.esperaDoPedidoMs, () => {
      if (this.#descidas.get(descida.canal) !== descida) return
      const seguinte = eleger(descida.lista, descida.tentativa + 1)
      if (!seguinte) {
        if (descida.inteiro && this.#descerSemInstantaneo(descida)) return
        this.#acabar(descida, false)
        return
      }
      descida.tentativa += 1
      descida.responde = seguinte
      descida.tentadas.add(seguinte.aparelho)
      descida.id = novoId()
      descida.fase = descida.inteiro ? "inteiro" : "n1"
      descida.partes.clear()
      descida.relatosRecebidos.clear()
      delete descida.relatosEsperados
      descida.riVisto = false
      void this.#pedirPrimeiro(descida)
    })
  }

  /**
   * No leaf replied to `pt`. A leaf in S4 does not know it and stays silent: if it is
   * the only one with the data, the snapshot never comes, and each summary from it asks
   * for the same `pt` again. We then descend as in S4 (levels 1 and 2 and items), against
   * a summary from a leaf that showed it, and the snapshot stops being pending. The bar
   * stays while that descent lasts.
   */
  #descerSemInstantaneo(descida: Descida): boolean {
    const canal = descida.canal
    const vistos = this.#vistos.get(canal)
    const de = descida.lista.find((folha) => vistos?.has(folha.aparelho))
    const visto = de ? vistos?.get(de.aparelho) : undefined
    if (!de || !visto) return false
    this.#parar(descida)
    this.#descidas.delete(canal)
    this.#instantaneos.delete(canal)
    this.#cancelar(this.#esperasDoInstantaneo.get(canal))
    this.#esperasDoInstantaneo.delete(canal)
    this.#semResposta.delete(canal)
    this.#comecarDescida(canal, descida.d, descida.tipos, de, visto.r, descida.seguidas + 1, false, true, descida.voltas)
    if (this.#descidas.has(canal)) return true
    this.#semResposta.add(canal)
    this.#mudou(canal)
    return true
  }

  async #pedirN1(descida: Descida): Promise<void> {
    this.#armarEspera(descida)
    const saiu = await this.#pedir(descida.canal, {
      k: "p1",
      id: descida.id,
      para: descida.responde.aparelho,
      d: descida.d,
      l: this.#porta.lugar(descida.canal),
      tipos: descida.tipos,
    }, descida)
    if (!saiu) this.#acabar(descida, false)
  }

  #acabar(descida: Descida, completa: boolean): void {
    this.#parar(descida)
    if (this.#descidas.get(descida.canal) === descida) this.#descidas.delete(descida.canal)
    if (completa) this.#semResposta.delete(descida.canal)
    else this.#semResposta.add(descida.canal)
    if (descida.inteiro && completa) {
      this.#instantaneos.delete(descida.canal)
      this.#cancelar(this.#esperasDoInstantaneo.get(descida.canal))
      this.#esperasDoInstantaneo.delete(descida.canal)
    }
    if (!completa) {
      this.#mudou(descida.canal)
      return
    }
    /*
      Whoever replied hit the cap per minute (`ri.r`): the rest is asked when the cap
      lifts, not counting as a next descent (each round brings another minute of telemetry).
      Until then, the snapshot stays "receiving".

      Only if this round applied something, and at most `VOLTAS_POR_PEDIDO` rounds. Without
      this, a dishonest responder (`r` with no items), or an honest one whose items we
      reject all of, would loop us requesting forever. Outside these conditions, it flows
      as a next descent, which has a cap.
    */
    if (descida.voltarEm !== undefined && descida.aplicados > 0 && descida.voltas < VOLTAS_POR_PEDIDO) {
      const canal = descida.canal
      if (descida.doInstantaneo) this.#continuacoes.add(canal)
      const espera = Math.round(descida.voltarEm * (1 + Math.random() * ACASO_DA_VOLTA))
      this.#mais(espera, () => {
        this.#continuacoes.delete(canal)
        this.#continuar(descida, descida.seguidas, descida.voltas + 1)
        this.#mudou(canal)
      })
      this.#mudou(canal)
      return
    }
    this.#continuar(descida, descida.seguidas + 1, descida.voltas)
    this.#mudou(descida.canal)
  }

  /**
   * Still different from the summary of whoever replied? Another descent, up to three in
   * a row: one telemetry event may have brought what was missing at one level and revealed
   * what was missing at another (a post, then its comments).
   */
  #continuar(descida: Descida, seguidas: number, voltas: number): void {
    if (this.#descidas.has(descida.canal)) return
    const visto = this.#vistos.get(descida.canal)?.get(descida.responde.aparelho)
    if (!visto || seguidas >= TECTOS_DA_SINCRONIA.tentativasPorPedido) return
    const meu = resumoNivel0(this.#itens(descida.canal, visto.d))
    // After the snapshot, all types that send telemetry: the window conversation was left out of it.
    const comJanelaVista = visto.d >= this.#porta.lugar(descida.canal)
    const candidatosATipo = descida.inteiro
      ? TIPOS_DO_RESUMO.filter((tipo) => TIPOS_RELATAVEIS.has(tipo) && (comJanelaVista || !TIPOS_COM_JANELA.has(tipo)))
      : descida.tipos
    const tipos = candidatosATipo.filter((tipo) => meu[tipo].h !== visto.r[tipo].h && visto.r[tipo].n >= meu[tipo].n)
    if (tipos.length > 0) this.#comecarDescida(descida.canal, visto.d, tipos, descida.responde, visto.r, seguidas, false, descida.doInstantaneo, voltas)
  }

  /** A part of `n1` or `n2` from whoever we are listening to. */
  async #aoNivel(canal: string, de: Folha, corpo: N1 | N2): Promise<void> {
    const descida = this.#descidas.get(canal)
    if (!descida || descida.id !== corpo.id || de.aparelho !== descida.responde.aparelho) return
    if (descida.fase !== (corpo.k === "n1" ? "n1" : "n2")) return
    if (corpo.de < 1 || corpo.de > 256 || corpo.parte < 1 || corpo.parte > corpo.de) return
    descida.partes.set(corpo.parte, corpo.e)
    // The window of whoever replies is authoritative: it can be higher than ours (their floor).
    descida.d = Math.max(descida.d, corpo.d)
    if (descida.partes.size < corpo.de) return
    const entradas = [...descida.partes.values()].flat()
    descida.partes.clear()
    if (corpo.k === "n1") await this.#depoisDoN1(descida, entradas as N1["e"])
    else await this.#depoisDoN2(descida, entradas as N2["e"])
  }

  async #depoisDoN1(descida: Descida, entradas: N1["e"]): Promise<void> {
    const itens = this.#itens(descida.canal, descida.d)
    const pedir: [string, string][] = []
    for (const tipo of descida.tipos) {
      const deles: Record<string, ParDoResumo> = {}
      for (const entrada of entradas) {
        if (!Array.isArray(entrada) || entrada[0] !== tipo || typeof entrada[1] !== "string") continue
        const par = parDoFio([entrada[2], entrada[3]])
        if (par) deles[entrada[1]] = par
      }
      const meus = resumoNivel1(itens, tipo)
      // Only the buckets they have and that differ: a bucket only we have is a gap for them, not us.
      for (const balde of baldesDiferentes(meus, deles)) {
        const delesPar = deles[balde]
        if (delesPar && delesPar.n > 0) pedir.push([tipo, balde])
      }
    }
    if (pedir.length === 0) {
      this.#acabar(descida, true)
      return
    }
    descida.fase = "n2"
    this.#armarEspera(descida)
    const saiu = await this.#pedir(descida.canal, {
      k: "p2",
      id: descida.id,
      para: descida.responde.aparelho,
      d: descida.d,
      l: this.#porta.lugar(descida.canal),
      e: pedir.slice(0, 256),
    }, descida)
    if (!saiu) this.#acabar(descida, false)
  }

  async #depoisDoN2(descida: Descida, entradas: N2["e"]): Promise<void> {
    const itens = this.#itens(descida.canal, descida.d)
    const meus = new Map<string, Set<string>>()
    const faltam: string[] = []
    for (const entrada of entradas) {
      if (!Array.isArray(entrada) || typeof entrada[0] !== "string" || typeof entrada[1] !== "string" || !Array.isArray(entrada[2])) continue
      const [tipo, balde, chaves] = entrada
      if (!(TIPOS_DO_RESUMO as readonly string[]).includes(tipo)) continue
      const chaveDoBalde = `${tipo}|${balde}`
      let conjunto = meus.get(chaveDoBalde)
      if (!conjunto) {
        conjunto = new Set(resumoNivel2(itens, tipo as TipoDoResumo, balde))
        meus.set(chaveDoBalde, conjunto)
      }
      for (const chave of chaves) if (chaveCurtaValida(chave) && !conjunto.has(chave)) faltam.push(chave)
    }
    const unicas = [...new Set(faltam)]
    if (unicas.length === 0) {
      this.#acabar(descida, true)
      return
    }
    // Those that no one gave less than a day ago are not asked again; if only those are missing, stop here.
    const agora = this.#porta.agora()
    const porPedir = unicas.filter((curta) => !this.#ninguemDeuAinda(descida.canal, curta, agora))
    if (porPedir.length === 0) {
      this.#acabar(descida, false)
      return
    }
    await this.#pedirItens(descida, porPedir.slice(0, CHAVES_POR_PEDIDO))
  }

  async #pedirItens(descida: Descida, chaves: string[]): Promise<void> {
    descida.fase = "itens"
    descida.riVisto = false
    descida.pedidas = chaves
    descida.naoDadas = []
    descida.autores = []
    this.#armarEspera(descida)
    const saiu = await this.#pedir(descida.canal, {
      k: "pi",
      id: descida.id,
      para: descida.responde.aparelho,
      d: descida.d,
      l: this.#porta.lugar(descida.canal),
      c: chaves,
    }, descida)
    if (!saiu) this.#acabar(descida, false)
  }

  /** Keys that no leaf gave, by channel, for as long as they remember. See `NINGUEM_DEU_MS`. */
  readonly #ninguemDeu = new Map<string, number>()

  #ninguemDeuAinda(canal: string, curta: string, agora: number): boolean {
    const chave = `${canal}|${curta}`
    const ate = this.#ninguemDeu.get(chave)
    if (ate === undefined) return false
    if (ate > agora) return true
    this.#ninguemDeu.delete(chave)
    return false
  }

  #lembrarNinguemDeu(canal: string, chaves: readonly string[], agora: number): void {
    for (const curta of chaves) this.#ninguemDeu.set(`${canal}|${curta}`, agora + NINGUEM_DEU_MS)
    // A map that only grows is a leak: expired entries leave when it exceeds a thousand.
    if (this.#ninguemDeu.size > 1_000) {
      for (const [chave, ate] of this.#ninguemDeu) if (ate <= agora) this.#ninguemDeu.delete(chave)
    }
  }

  /**
   * The leaf replied with everything it could and keys are missing (§4.4, point 5, for
   * the case where the leaf replies but does not have everything): ask another leaf.
   * First the live leaf of the author, who may sign what they wrote before S4; then the
   * next in the election. At most `tentativasPorPedido` leaves per descent. With no more,
   * keys stay remembered for a day (`#ninguemDeu`).
   */
  async #tentarOutraFolha(descida: Descida): Promise<boolean> {
    if (descida.tentadas.size >= TECTOS_DA_SINCRONIA.tentativasPorPedido) return false
    const meu = this.#meuAparelho
    const livre = (folha: Folha): boolean =>
      folha.aparelho !== meu && !descida.tentadas.has(folha.aparelho) && this.#ehCapaz(descida.canal, folha) && this.#viva(folha)
    const doAutor = this.#porta
      .folhas(descida.canal)
      .filter((folha) => descida.autores.includes(folha.address) && livre(folha))
      .sort((a, b) => a.indice - b.indice)[0]
    const seguinte = doAutor ?? descida.lista.find(livre)
    if (!seguinte) return false
    descida.tentativa += 1
    descida.tentadas.add(seguinte.aparelho)
    descida.responde = seguinte
    descida.id = novoId()
    descida.relatosRecebidos.clear()
    delete descida.relatosEsperados
    await this.#pedirItens(descida, descida.naoDadas)
    return true
  }

  #aoRi(canal: string, de: Folha, corpo: RI): void {
    const descida = this.#descidas.get(canal)
    if (!descida || descida.id !== corpo.id || de.aparelho !== descida.responde.aparelho) return
    if (descida.fase !== "itens" && descida.fase !== "inteiro") return
    descida.relatosEsperados = corpo.de
    descida.riVisto = true
    // Only those we asked for: a leaf does not add keys to our request.
    const pedidas = new Set(descida.pedidas)
    descida.naoDadas = (corpo.f ?? []).filter((curta) => pedidas.has(curta))
    descida.autores = corpo.au ?? []
    if (corpo.r !== undefined) descida.voltarEm = corpo.r
    this.#talvezAcabarItens(descida)
  }

  #talvezAcabarItens(descida: Descida): void {
    if (descida.relatosEsperados === undefined) return
    if (descida.relatosRecebidos.size < descida.relatosEsperados) return
    /*
      All telemetry arrived before the `ri` (they go first, over MLS): the `ri` tells what
      the leaf could not give (`f`, `au`) and when to try again (`r`). Ending early was
      losing that: the `r` stayed ineffective and the rest waited for the ten-minute timer.
      We wait a little for it; a lost `ri` (signals are ephemeral) does not hold the
      descent longer than this.
    */
    if (!descida.riVisto) {
      this.#cancelar(descida.temporizador)
      descida.temporizador = this.#mais(ESPERA_DO_RI_MS, () => {
        if (this.#descidas.get(descida.canal) !== descida) return
        descida.riVisto = true
        this.#talvezAcabarItens(descida)
      })
      return
    }
    if (descida.naoDadas.length === 0) {
      this.#acabar(descida, true)
      return
    }
    const naoDadas = descida.naoDadas
    void this.#tentarOutraFolha(descida).then((tentou) => {
      if (tentou) return
      this.#lembrarNinguemDeu(descida.canal, naoDadas, this.#porta.agora())
      this.#acabar(descida, true)
    })
  }

  // ------------------------------------------------------------ responder

  /**
   * The window of whoever replies: that of whoever asked, never below the floor. Below
   * the floor, conversation is not sent, so it also does not show in the summary: it
   * would set the caller to ask for what never comes.
   */
  #janelaDaResposta(canal: string, d: number): number {
    return Math.max(d, this.piso(canal))
  }

  #jaRespondido(id: string): boolean {
    if (this.#respondidos.has(id)) return true
    this.#respondidos.add(id)
    if (this.#respondidos.size > 512) {
      const primeiro = this.#respondidos.values().next().value
      if (primeiro !== undefined) this.#respondidos.delete(primeiro)
    }
    return false
  }

  async #responderN1(canal: string, pedido: P1): Promise<void> {
    if (this.#jaRespondido(`p1|${pedido.id}`)) return
    const d = this.#janelaDaResposta(canal, pedido.d)
    const itens = this.#itens(canal, d)
    const entradas: N1["e"] = []
    for (const bruto of pedido.tipos.slice(0, TIPOS_DO_RESUMO.length)) {
      if (!(TIPOS_DO_RESUMO as readonly string[]).includes(bruto)) continue
      const tipo = bruto as TipoDoResumo
      for (const [balde, par] of Object.entries(resumoNivel1(itens, tipo))) entradas.push([tipo, balde, par.n, par.h])
    }
    const partes = emPartes(entradas)
    for (const [indice, e] of partes.entries()) {
      // On first refusal, stop: the next parts are useless without this one, and retrying heads toward `signal-abuse`.
      if (!(await this.#enviar(canal, { k: "n1", id: pedido.id, d, parte: indice + 1, de: partes.length, e }))) return
    }
  }

  async #responderN2(canal: string, pedido: P2): Promise<void> {
    if (this.#jaRespondido(`p2|${pedido.id}`)) return
    const d = this.#janelaDaResposta(canal, pedido.d)
    const itens = this.#itens(canal, d)
    const entradas: [string, string, string[]][] = []
    for (const par of pedido.e.slice(0, 256)) {
      if (!Array.isArray(par) || typeof par[0] !== "string" || typeof par[1] !== "string") continue
      if (!(TIPOS_DO_RESUMO as readonly string[]).includes(par[0])) continue
      const chaves = resumoNivel2(itens, par[0] as TipoDoResumo, par[1])
      // A large bucket splits into chunks of keys; the caller assembles them.
      for (let i = 0; i < Math.max(1, chaves.length); i += CHAVES_POR_PEDIDO) {
        entradas.push([par[0], par[1], chaves.slice(i, i + CHAVES_POR_PEDIDO)])
      }
    }
    const partes = emPartes(entradas)
    for (const [indice, e] of partes.entries()) {
      if (!(await this.#enviar(canal, { k: "n2", id: pedido.id, d, parte: indice + 1, de: partes.length, e }))) return
    }
  }

  /**
   * Send the items requested. Sender rules (§5.3): conversation only with known `seq`
   * and from the window onward (the position of the caller, never below the group floor);
   * nothing without a reportable source; byte caps.
   */
  async #responderItens(canal: string, pedido: PI): Promise<void> {
    if (this.#jaRespondido(`pi|${pedido.id}`)) return
    const d = this.#janelaDaResposta(canal, Math.max(pedido.d, pedido.l))
    // An item with a tombstone is not sent (§4.3): `itensDoCanal` already leaves it out.
    const porChave = new Map<string, ItemDoResumo>()
    for (const item of this.#itens(canal, d)) porChave.set(chaveCurta(item.chave), item)
    const escolhidos: ItemDoResumo[] = []
    // What cannot be given, for the caller to try another leaf (see `RI`).
    const naoDadas: string[] = []
    const autores = new Set<string>()
    for (const curta of pedido.c.slice(0, CHAVES_POR_PEDIDO)) {
      const item = porChave.get(curta)
      if (!item?.fonte || (comJanela(item) && (item.fonte.seq < 0 || item.fonte.seq < d))) {
        naoDadas.push(curta)
        continue
      }
      escolhidos.push(item)
    }
    await this.#relatar(canal, pedido.id, escolhidos, naoDadas, autores)
  }

  /**
   * The snapshot (S5, §5.1): all items of the requested types, in the order of §5.2,
   * closed with an `ri`. With the same sender rules as `#responderItens`: conversation
   * only from the window onward (the position of the caller, never below the floor),
   * nothing with a tombstone, nothing without a reportable source, byte caps.
   */
  async #responderTipos(canal: string, pedido: PT): Promise<void> {
    if (this.#jaRespondido(`pt|${pedido.id}`)) return
    const d = this.#janelaDaResposta(canal, Math.max(pedido.d, pedido.l))
    const pedidos = new Set(pedido.tipos.filter((tipo): tipo is TipoDoResumo => TIPOS_RELATAVEIS.has(tipo as TipoDoResumo)))
    const escolhidos: ItemDoResumo[] = []
    const autores = new Set<string>()
    for (const item of this.#itens(canal, d)) {
      if (!pedidos.has(item.tipo) || !item.fonte) continue
      if (comJanela(item) && (item.fonte.seq < 0 || item.fonte.seq < d)) continue
      escolhidos.push(item)
    }
    await this.#relatar(canal, pedido.id, escolhidos, [], autores)
  }

  /**
   * Send already-chosen items, in the order of §5.2, within caps, and close the request
   * with an `ri`. An item from someone else without authorship (before S4) cannot be
   * given: it goes to `naoDadas`, with the author.
   */
  async #relatar(canal: string, id: string, escolhidos: ItemDoResumo[], naoDadas: string[], autores: Set<string>): Promise<void> {
    escolhidos.sort(porOrdemDoRelato)
    const relatados = escolhidos.flatMap((item) => {
      const fonte = item.fonte!
      const autoria = (fonte.payload as Record<string, unknown>)["autoria"] as { ap?: string } | undefined
      const aparelho = autoria?.ap ?? (fonte.autor === this.#porta.eu.address ? this.#meuAparelho : undefined)
      const cadeia = aparelho ? this.#porta.cadeiaDe(canal, fonte.autor, aparelho) : null
      const pronto = prepararItem(canal, fonte, this.#porta.eu, cadeia)
      if (pronto) return [pronto]
      // From someone else and without authorship (before S4): only the author can state it.
      naoDadas.push(chaveCurta(item.chave))
      autores.add(fonte.autor)
      return []
    })
    const agora = this.#porta.agora()
    const dia = new Date(agora).toISOString().slice(0, 10)
    const tramas: RelatosNoFio[] = []
    let cortado = false
    for (const trama of partirRelatos(relatados)) {
      const bytes = new TextEncoder().encode(JSON.stringify(trama)).length
      if (!this.#tectos.gastar(`relato|${canal}`, bytes, TECTOS_DA_SINCRONIA.bytesDeRelatoPorCanalPorMinuto, agora)) {
        cortado = true
        break
      }
      if (!this.#gastarDoDia(canal, dia, bytes)) break
      tramas.push(trama)
    }
    // Capped by the minute (not the day): tell the caller when they can try again.
    // With nothing spent in the window, the cap is from a frame larger than the limit: waiting won't make it fit.
    const libera = cortado ? this.#tectos.liberaEm(`relato|${canal}`, agora) : 0
    const voltar = libera > 0 ? libera + 1_000 : undefined
    // Part numbers are only known now, after the caps.
    for (const [indice, trama] of tramas.entries()) {
      const comQ: RelatosNoFio = { ...trama, q: `${id}:${indice + 1}/${tramas.length}` }
      try {
        await this.#porta.enviarRelatos(canal, comQ)
      } catch {
        break
      }
      this.estatisticas.tramasDeRelato += 1
      this.estatisticas.relatosEnviados += trama.itens.length
      this.estatisticas.bytesDeRelato += new TextEncoder().encode(JSON.stringify(comQ)).length
    }
    await this.#enviar(canal, {
      k: "ri",
      id,
      de: tramas.length,
      ...(naoDadas.length > 0 ? { f: naoDadas.slice(0, CHAVES_POR_PEDIDO), au: [...autores].slice(0, AUTORES_POR_RI) } : {}),
      ...(voltar !== undefined ? { r: Math.min(voltar, 10 * 60_000) } : {}),
    })
  }

  /**
   * Cap of 4 MB of telemetry per channel per day (§4.4), counted in the VAULT
   * (`sincronia.bytesDoDia`): in memory, each app reload gave another full
   * day, and the server disk paid for it. Days that are not today are removed
   * on each spend, so the map does not grow.
   *
   * Still per device: the server does not see what frame is telemetry, and
   * two devices do not coordinate without talking. Expected numbers and worst
   * case are in the plan (§5.5).
   */
  #gastarDoDia(canal: string, dia: string, bytes: number, anexo: boolean | "video" = false): boolean {
    const cofre = this.#cofre()
    // Attachments have their own count (`TECTOS_DOS_ANEXOS.bytesPorCanalPorDia`), in the same daily table.
    // Videos too, and again separate: a single one could exceed the attachments cap.
    const chave = anexo === "video" ? `${dia}|video|${canal}` : anexo ? `${dia}|anexo|${canal}` : `${dia}|${canal}`
    const contas = cofre.bytesDoDia ?? {}
    const usado = contas[chave] ?? 0
    const tecto =
      anexo === "video"
        ? TECTOS_DOS_ANEXOS.bytesDeVideoPorCanalPorDia
        : anexo
          ? TECTOS_DOS_ANEXOS.bytesPorCanalPorDia
          : TECTOS_DA_SINCRONIA.bytesDeRelatoPorCanalPorDia
    if (usado + bytes > tecto) return false
    const deHoje: Record<string, number> = {}
    for (const [outra, valor] of Object.entries(contas)) if (outra.startsWith(`${dia}|`)) deHoje[outra] = valor
    deHoje[chave] = usado + bytes
    cofre.bytesDoDia = deHoje
    this.#porta.marcarParaGravar()
    return true
  }

  // ------------------------------------------------------ the snapshot (S5)

  #instantaneoFeito(canal: string): void {
    this.#instantaneos.delete(canal)
    this.#semResposta.delete(canal)
    this.#cancelar(this.#esperasDoInstantaneo.get(canal))
    this.#esperasDoInstantaneo.delete(canal)
    this.#mudou(canal)
  }

  /** Whether the snapshot of this channel is still pending (for testing and diagnostics). */
  instantaneoPorPedir(canal: string): boolean {
    return this.#instantaneos.has(canal)
  }

  // ------------------------------------------------------- attachments on demand (S5)

  /**
   * Request the bytes of an attachment that this device only has by name (§5.4):
   * attachment `indice` (in authorship order, `attachments` then `media`) of
   * the item with `id` `alvo`. One leaf responds at a time, the lowest alive
   * that knows it; no response, the next one, up to three. The bytes that arrive
   * are verified against the `m` that authorship signed before saving.
   *
   * One at a time on this device: following requests wait in the queue, up to
   * `FILA_DE_ANEXOS`; beyond that, the request stays "pending".
   */
  pedirAnexo(canal: string, alvo: string, indice: number): Promise<DesfechoDoAnexo> {
    if (this.#filaDeAnexos.length >= FILA_DE_ANEXOS) return Promise.resolve({ ok: false, motivo: "por-pedir" })
    return new Promise<DesfechoDoAnexo>((resolver) => {
      this.#filaDeAnexos.push({ canal, alvo, indice, resolver })
      void this.#proximoAnexo()
    })
  }

  /**
   * Cancel an attachment request: if waiting in the queue, remove it; if running,
   * close now, and bytes that arrive after are not saved. Returns whether there
   * was a request.
   */
  cancelarAnexo(canal: string, alvo: string, indice: number): boolean {
    const mesmo = (vez: { canal: string; alvo: string }, i: number): boolean => vez.canal === canal && vez.alvo === alvo && i === indice
    const naFila = this.#filaDeAnexos.findIndex((vez) => mesmo(vez, vez.indice))
    if (naFila >= 0) {
      const [vez] = this.#filaDeAnexos.splice(naFila, 1)
      vez!.resolver({ ok: false, motivo: "cancelado" })
      return true
    }
    const emCurso = this.#anexoEmCurso
    if (emCurso && mesmo(emCurso, emCurso.i)) {
      this.#fecharAnexo(emCurso, { ok: false, motivo: "cancelado" })
      return true
    }
    return false
  }

  async #proximoAnexo(): Promise<void> {
    if (this.#anexoAVez) return
    const vez = this.#filaDeAnexos.shift()
    if (!vez) return
    this.#anexoAVez = vez
    let desfecho: DesfechoDoAnexo
    try {
      desfecho = await this.#pedirAnexoAgora(vez.canal, vez.alvo, vez.indice)
    } catch (erro) {
      // A fault is not "nobody has it" (1.3.7): it is reported as a fault, and the mechanics go to the log.
      this.#porta.aoFalharAnexo?.(vez.canal, String((erro as Error)?.message ?? erro))
      desfecho = { ok: false, motivo: "falhou" }
    }
    this.#anexoAVez = null
    vez.resolver(desfecho)
    void this.#proximoAnexo()
  }

  async #pedirAnexoAgora(canal: string, alvo: string, indice: number): Promise<DesfechoDoAnexo> {
    if (!this.#porta.elegivel(canal)) return { ok: false, motivo: "sem-prova" }
    // The item as the vault has it, with authorship: it says which bytes are valid.
    const fonte = this.#itens(canal, undefined, false).find(
      (item) => item.fonte !== undefined && (item.fonte.payload as Record<string, unknown>)["id"] === alvo,
    )
    const payload = fonte?.fonte?.payload as Record<string, unknown> | undefined
    const anexo = payload ? anexoEm(payload, indice) : undefined
    if (!fonte || !payload || anexo === undefined) return { ok: false, motivo: "sem-prova" }
    if (anexoComBytes(anexo)) return { ok: true, anexo }
    // A video: the bytes are separate. They are already here, nothing to request.
    const video = partesDoAnexo(anexo)
    if (video && this.#porta.bytesDoVideo?.(video.sha256)) return { ok: true, anexo: anexo as Record<string, unknown> }
    const m = (payload["autoria"] as { m?: unknown } | undefined)?.m
    const resumo = Array.isArray(m) ? m[indice] : undefined
    if (typeof resumo !== "string") return { ok: false, motivo: "sem-prova" }
    const guardado = this.#anexosRecebidos.get(`${canal}|${chaveCurta(fonte.chave)}|${indice}|${resumo}`)
    if (guardado) return { ok: true, anexo: guardado }
    if (!this.#porta.podeSinalizar()) return { ok: false, motivo: "sem-ligacao" }
    /*
      Who gets asked: first the live leaves that said they know how
      (`CAPACIDADE_SINCRONIA`), and THEN the live leaves whose capability is not
      yet known (1.3.7).

      The capability is only learned from a device signal IN THIS channel, and
      only lives in memory. After a reload, or with the person who has the image
      quiet in the channel since then, nobody was a candidate, and the answer was
      "nobody has this image" with the person connected. A leaf that cannot
      answer stays silent, and the deadline moves on to the next one.
    */
    const vivas = (capaz: (folha: Folha) => boolean): Folha[] =>
      candidatos(this.#porta.folhas(canal), { proprio: this.#meuAparelho, capaz, viva: (folha) => this.#viva(folha) })
    const lista = [...vivas((folha) => this.#ehCapaz(canal, folha)), ...vivas((folha) => !this.#ehCapaz(canal, folha))]
    const primeira = eleger(lista, 0)
    if (!primeira) return { ok: false, motivo: "ninguem" }
    return new Promise<DesfechoDoAnexo>((resolver) => {
      const pedido: PedidoDeAnexo = {
        id: `${Q_DO_ANEXO}${novoId()}`,
        canal,
        autor: fonte.fonte!.autor,
        alvo,
        c: chaveCurta(fonte.chave),
        i: indice,
        m: resumo,
        lista,
        tentativa: 0,
        responde: primeira,
        temporizador: null,
        recusado: false,
        resolver,
        ...(video ? { video: { sha: video.sha256, anexo: anexo as Record<string, unknown> } } : {}),
      }
      this.#anexoEmCurso = pedido
      void this.#pedirAnexoA(pedido)
    })
  }

  /**
   * How long to wait for a leaf before moving to the next. For parts of a
   * video, the server waits for the minute window between parts (two per
   * window at 4 MiB): with the 30s timeout of an attachment, the request
   * would fall halfway through, the interface would say "nobody has it" with
   * the leaf serving, and the next leaf would serve the entire video again.
   * It is a silence timeout, renewed with each part (`aoVideo`): video size
   * does not count.
   */
  #prazoDe(pedido: PedidoDeAnexo): number {
    return pedido.video ? TECTOS_DOS_ANEXOS.esperaMs + TECTOS_DOS_ANEXOS.janelaMs : TECTOS_DOS_ANEXOS.esperaMs
  }

  async #pedirAnexoA(pedido: PedidoDeAnexo): Promise<void> {
    this.#cancelar(pedido.temporizador)
    pedido.temporizador = this.#mais(this.#prazoDe(pedido), () => void this.#anexoSeguinte(pedido))
    if (pedido.video) pedido.partesPedidas = true
    // Outside the request cap: one attachment at a time is already the throttle, and it is the caller.
    const saiu = await this.#enviar(pedido.canal, {
      k: "pa",
      id: pedido.id,
      para: pedido.responde.aparelho,
      l: this.#porta.lugar(pedido.canal),
      c: pedido.c,
      i: pedido.i,
      m: pedido.m,
      ...(pedido.video ? { v: pedido.video.sha } : {}),
    })
    if (!saiu) this.#fecharAnexo(pedido, { ok: false, motivo: "sem-ligacao" })
  }

  /**
   * A part of a video arrived (`videos.ts`), from device `aparelho`.
   * Complete and verified by the digest, closes the request for that video,
   * from whoever sends it. Partway through, it extends the timeout (`#prazoDe`),
   * but only with parts from the leaf we asked: video bytes take minutes to
   * arrive at 4 MB per minute, and the timeout is for silence, not for active
   * response. Another member sending parts does not stall the request waiting
   * for one that does not respond.
   */
  aoVideo(canal: string, sha: string, completo: boolean, aparelho?: string): void {
    const pedido = this.#anexoEmCurso
    if (!pedido || pedido.canal !== canal || pedido.video?.sha !== sha) return
    if (completo) {
      // The leaf we asked is done: nothing to drop.
      if (aparelho === pedido.responde.aparelho) pedido.partesPedidas = false
      this.estatisticas.anexosRecebidos += 1
      this.#fecharAnexo(pedido, { ok: true, anexo: pedido.video.anexo })
      return
    }
    if (aparelho !== pedido.responde.aparelho) return
    this.#cancelar(pedido.temporizador)
    pedido.temporizador = this.#mais(this.#prazoDe(pedido), () => void this.#anexoSeguinte(pedido))
  }

  /** The leaf said it does not have it (an `ri` with `de: 0`): next one. */
  #anexoSemResposta(pedido: PedidoDeAnexo, de: Folha): void {
    if (de.aparelho !== pedido.responde.aparelho) return
    void this.#anexoSeguinte(pedido)
  }

  async #anexoSeguinte(pedido: PedidoDeAnexo): Promise<void> {
    if (this.#anexoEmCurso !== pedido) return
    const seguinte = eleger(pedido.lista, pedido.tentativa + 1)
    if (!seguinte || pedido.tentativa + 1 >= TECTOS_DOS_ANEXOS.tentativas) {
      this.#fecharAnexo(pedido, { ok: false, motivo: pedido.recusado ? "recusado" : "ninguem" })
      return
    }
    if (pedido.video) {
      // The leaf we drop does not keep serving the video; the next one has its own id.
      this.#largarVideo(pedido)
      pedido.id = `${Q_DO_ANEXO}${novoId()}`
    }
    pedido.tentativa += 1
    pedido.responde = seguinte
    await this.#pedirAnexoA(pedido)
  }

  #fecharAnexo(pedido: PedidoDeAnexo, desfecho: DesfechoDoAnexo): void {
    this.#cancelar(pedido.temporizador)
    pedido.temporizador = null
    if (this.#anexoEmCurso === pedido) this.#anexoEmCurso = null
    this.#largarVideo(pedido)
    pedido.resolver(desfecho)
  }

  /**
   * Cancel the parts of a video requested from a leaf: an `ri` with `de: 0` and
   * the request id, which only the server knows. Without this, a cancelled or
   * failed request left the leaf serving the entire video (35 MB of wire at
   * 25 MiB), and each dropped leaf did the same. A client without videos
   * ignores the `ri` (no stream with that id). If the signal does not go out
   * (no link, signal cap), the leaf finishes sending: parts stay on the server
   * and serve whoever requests them next.
   */
  #largarVideo(pedido: PedidoDeAnexo): void {
    if (!pedido.partesPedidas) return
    pedido.partesPedidas = false
    void this.#enviar(pedido.canal, { k: "ri", id: pedido.id, de: 0 })
  }

  /**
   * The bytes arrived. Everything is verified before saving (§5.4): the
   * authorship of the payload, the device that signed it, that it is the
   * requested item, that authorship signed the same `m` that our vault has,
   * and that the bytes give that `m`. A failure in the response from the leaf
   * we asked is "rejected", and we ask the next leaf. Verified, they also stay
   * in memory (`#guardarRecebido`).
   */
  async #aoAnexo(canal: string, relatos: RelatosNoFio, deAparelho: string): Promise<void> {
    const pedido = this.#anexoEmCurso
    if (!pedido || pedido.canal !== canal) return
    /*
      The bytes are valid from any attachment frame that brings the item, the
      position, and the `m` of our request: a response to another member who
      asked for the same (the responder does not repeat sending, `repeticaoMs`),
      or a late response from a leaf we already dropped. The `m` verifies them
      the same. Only the response from the leaf we asked now counts as rejection,
      when it does not verify.
      */
    const lido = lerQ(relatos.q)
    const daFolhaPedida = lido !== null && lido.id === pedido.id && deAparelho === pedido.responde.aparelho
    // Video is known now (first pass done): from now only parts count.
    if (pedido.video) return
    const anexo = await this.#conferirAnexo(canal, pedido, relatos)
    if (this.#anexoEmCurso !== pedido || pedido.video) return
    if (!anexo) {
      if (!daFolhaPedida) return
      this.estatisticas.anexosRecusados += 1
      pedido.recusado = true
      await this.#anexoSeguinte(pedido)
      return
    }
    const video = anexoComBytes(anexo) ? null : partesDoAnexo(anexo)
    if (video) {
      await this.#aoAnexoDoVideo(canal, pedido, anexo, video.sha256)
      return
    }
    this.#guardarRecebido(`${canal}|${pedido.c}|${pedido.i}|${pedido.m}`, anexo)
    try {
      await this.#porta.gravarAnexo?.(canal, pedido.autor, pedido.alvo, pedido.i, anexo)
    } catch {
      // No disk, still shows: bytes were already verified.
    }
    this.estatisticas.anexosRecebidos += 1
    this.#fecharAnexo(pedido, { ok: true, anexo })
  }

  /**
   * The attachment without bytes of a video arrived and verified by `m` (first
   * pass). It is saved in place of the placeholder, its parts are now expected,
   * and the request continues: to the same leaf, now with the digest (`v`), and
   * parts arrive next. In order: parts that arrived before the attachment was
   * verified were rejected, because nobody was expecting them.
   */
  async #aoAnexoDoVideo(canal: string, pedido: PedidoDeAnexo, anexo: Record<string, unknown>, sha: string): Promise<void> {
    try {
      await this.#porta.gravarAnexo?.(canal, pedido.autor, pedido.alvo, pedido.i, anexo)
    } catch {
      // No disk, parts are verified the same way by the attachment in memory.
    }
    this.#porta.esperarVideo?.(canal, anexo)
    if (this.#anexoEmCurso !== pedido) return
    if (this.#porta.bytesDoVideo?.(sha)) {
      this.estatisticas.anexosRecebidos += 1
      this.#fecharAnexo(pedido, { ok: true, anexo })
      return
    }
    pedido.video = { sha, anexo }
    pedido.id = `${Q_DO_ANEXO}${novoId()}`
    await this.#pedirAnexoA(pedido)
  }

  /** Store in memory a verified attachment, within `memoriaBytes`: oldest ones leave first. */
  #guardarRecebido(chave: string, anexo: Record<string, unknown>): void {
    const bytes = bytesDoAnexo(anexo)
    if (bytes > TECTOS_DOS_ANEXOS.memoriaBytes || this.#anexosRecebidos.has(chave)) return
    this.#anexosRecebidos.set(chave, anexo)
    this.#bytesRecebidosEmMemoria += bytes
    for (const [antiga, guardado] of this.#anexosRecebidos) {
      if (this.#bytesRecebidosEmMemoria <= TECTOS_DOS_ANEXOS.memoriaBytes) break
      this.#anexosRecebidos.delete(antiga)
      this.#bytesRecebidosEmMemoria -= bytesDoAnexo(guardado)
    }
  }

  async #conferirAnexo(canal: string, pedido: PedidoDeAnexo, relatos: RelatosNoFio): Promise<Record<string, unknown> | null> {
    if (relatos.itens.length !== 1) return null
    const item = relatos.itens[0]!
    if (item.a !== pedido.autor) return null
    const normal = normalizar(item.p)
    if (!normal) return null
    const autoria = verificarAutoria(canal, item.a, normal)
    if (!autoria.ok) return null
    const cadeia = { ...(item.k !== undefined ? { k: item.k } : {}), ...(item.x !== undefined ? { x: item.x } : {}) }
    if (!(await this.#porta.aparelhoConfiavel(canal, item.a, autoria.aparelho, cadeia))) return null
    const doResumo = itemDoPayload(item.a, normal as StoredPayload, canal)
    if (!doResumo || chaveCurta(doResumo.chave) !== pedido.c) return null
    const m = (normal["autoria"] as { m?: unknown }).m
    if (!Array.isArray(m) || m[pedido.i] !== pedido.m) return null
    const anexo = anexoEm(normal, pedido.i)
    if (anexoConfere(anexo, pedido.m)) return anexo as Record<string, unknown>
    // A video: the attachment comes without bytes (parts come separately), and verifies by the same `m`.
    if (partesDoAnexo(anexo) && resumoDoAnexo(anexo) === pedido.m) return anexo as Record<string, unknown>
    return null
  }

  /**
   * Serve the bytes of an attachment to whoever requested them. Only if we have
   * them, and only if they give the `m` that authorship signed; the stream only
   * starts from the window (the position rule applies to attachments in a
   * message as to the message itself); one attachment at a time, 4 MB per
   * minute, and the daily cap per channel.
   *
   * A video goes in two passes. Without `v` in the request, the caller does not
   * yet have the parts of the attachment (received the publication by telemetry
   * or snapshot, which bring it without bytes): the attachment goes without
   * bytes, with parts and thumbnail, and the caller verifies it by `m`. With
   * `v`, the parts go (`#servirVideo`).
   */
  async #responderAnexo(canal: string, pedido: PA, de: Folha): Promise<void> {
    if (this.#jaRespondido(`pa|${pedido.id}`)) return
    const naoTenho = (): Promise<boolean> => this.#enviar(canal, { k: "ri", id: pedido.id, de: 0 })
    if (this.#aEnviarAnexo) {
      await naoTenho()
      return
    }
    /*
      Without the group floor: the floor keeps the history of those who joined
      later, and whoever requests an attachment already proves they have the
      message (the short key and `m` are only known with it). With the floor,
      an old member never received the attachment of a message spoken before
      the last join, which is the main case. The position rule of the caller
      holds: nothing before their `l`.
      */
    const d = pedido.l
    const item = this.#itens(canal, d).find((candidato) => chaveCurta(candidato.chave) === pedido.c)
    const fonte = item?.fonte
    if (!item || !fonte || (comJanela(item) && (fonte.seq < 0 || fonte.seq < d))) {
      await naoTenho()
      return
    }
    const normal = normalizar(fonte.payload as Record<string, unknown>)
    const anexo = normal ? anexoEm(normal, pedido.i) : undefined
    const video = anexoComBytes(anexo) ? null : partesDoAnexo(anexo)
    // A video is only served if this device has the bytes: otherwise the caller moves to the next leaf.
    if (video && !this.#porta.bytesDoVideo?.(video.sha256)) {
      await naoTenho()
      return
    }
    const aparelho = ((fonte.payload as Record<string, unknown>)["autoria"] as { ap?: string } | undefined)?.ap
    const quem = aparelho ?? (fonte.autor === this.#porta.eu.address ? this.#meuAparelho : undefined)
    const pronto =
      anexoComBytes(anexo) || video ? prepararItem(canal, fonte, this.#porta.eu, quem ? this.#porta.cadeiaDe(canal, fonte.autor, quem) : null) : null
    const m = (pronto?.p["autoria"] as { m?: unknown } | undefined)?.m
    // Only the attachment that authorship signed, with the `m` of the request.
    if (!pronto || !Array.isArray(m) || m[pedido.i] !== pedido.m || resumoDoAnexo(anexo) !== pedido.m) {
      await naoTenho()
      return
    }
    // We already sent it to this channel recently: it is on the server, and the caller accepts that frame.
    const chaveDoEnvio = `${canal}|${pedido.c}|${pedido.i}`
    const partes = video !== null && pedido.v === video.sha256
    // The attachment without bytes of a video counts separately: it is the first pass, and parts are the second.
    const chave = video && !partes ? `${chaveDoEnvio}|anexo` : chaveDoEnvio
    const enviadoEm = this.#anexosEnviados.get(chave)
    if (enviadoEm !== undefined && this.#porta.agora() - enviadoEm < TECTOS_DOS_ANEXOS.repeticaoMs) {
      await naoTenho()
      return
    }
    if (video && partes) {
      /*
        Without waiting: parts take minutes (4 MB per minute), and this runs in
        the channel queue (`aoSinal`). Waiting here would stall the entire
        channel's anti-entropy while the video left. One send at a time is
        already told by `#aEnviarAnexo`, which `#servirVideo` sets before the
        first wait.
        */
      void this.#servirVideo(canal, pedido, de, video.sha256, video.byteLength, chave, naoTenho)
      return
    }
    const comBytes = comAnexo(pronto.p, pedido.i, anexo)
    if (!comBytes) {
      await naoTenho()
      return
    }
    const trama: RelatosNoFio = { v: 1, q: `${pedido.id}:1/1`, itens: [{ ...pronto, p: comBytes }] }
    const bytes = bytesDoAnexo(trama)
    const agora = this.#porta.agora()
    const dia = new Date(agora).toISOString().slice(0, 10)
    /*
      Verify the minute without spending, then spend the day, and only then the
      minute. Spending the minute first would leave it spent when the day refused,
      and the leaf would refuse following requests from other channels without
      sending anything.
      */
    if (
      this.#tectoDosAnexos.usado("anexos", agora) + bytes > TECTOS_DOS_ANEXOS.bytesPorMinuto ||
      !this.#gastarDoDia(canal, dia, bytes, true)
    ) {
      await naoTenho()
      return
    }
    this.#tectoDosAnexos.gastar("anexos", bytes, TECTOS_DOS_ANEXOS.bytesPorMinuto, agora)
    this.#aEnviarAnexo = true
    try {
      await this.#porta.enviarRelatos(canal, trama)
      this.#notarAnexoEnviado(chave, agora)
      this.estatisticas.anexosEnviados += 1
      this.estatisticas.bytesDeAnexos += bytes
    } catch {
      await naoTenho()
    } finally {
      this.#aEnviarAnexo = false
    }
  }

  /**
   * Serve a requested video (S5): the parts again, one by one, within the caps.
   * Same 4 MB per minute as attachments (waiting for its turn, instead of
   * refusing: a video exceeds 4 MB), and a daily cap per channel of its own,
   * `TECTOS_DOS_ANEXOS.bytesDeVideoPorCanalPorDia`. Both count what goes on
   * the wire: base64, one third above the bytes. The caller verifies parts by
   * the attachment digest; the caller already verified that the attachment is
   * the one the request names (same `m`, and authorship `m`).
   *
   * Runs without anyone waiting for it (see `#responderAnexo`): sets
   * `#aEnviarAnexo` before the first wait, and clears it at the end. Stops
   * before the next part if the caller gave up (`#videoServido.parar`).
   */
  async #servirVideo(
    canal: string,
    pedido: PA,
    de: Folha,
    sha: string,
    bytes: number,
    chaveDoEnvio: string,
    naoTenho: () => Promise<boolean>,
  ): Promise<void> {
    if (!this.#porta.servirVideo) {
      await naoTenho()
      return
    }
    const noFio = caracteresDeBase64(bytes)
    const dia = new Date(this.#porta.agora()).toISOString().slice(0, 10)
    // Verify the day for the entire video before the first part: half a video serves nobody.
    if (!this.#gastarDoDia(canal, dia, noFio, "video")) {
      await naoTenho()
      return
    }
    const servido: VideoServido = { id: pedido.id, para: de.aparelho, parar: false }
    const vez = async (custo: number): Promise<boolean> => {
      if (custo > TECTOS_DOS_ANEXOS.bytesPorMinuto) return false
      for (;;) {
        if (servido.parar) return false
        const agora = this.#porta.agora()
        if (this.#tectoDosAnexos.gastar("anexos", custo, TECTOS_DOS_ANEXOS.bytesPorMinuto, agora)) return true
        await new Promise<void>((acordar) => this.#mais(this.#tectoDosAnexos.liberaEm("anexos", agora) + 50, acordar))
      }
    }
    this.#aEnviarAnexo = true
    this.#videoServido = servido
    try {
      const saiu = await this.#porta.servirVideo(canal, sha, pedido.id, vez)
      if (saiu) {
        this.#notarAnexoEnviado(chaveDoEnvio, this.#porta.agora())
        this.estatisticas.anexosEnviados += 1
        this.estatisticas.bytesDeAnexos += noFio
      }
    } catch {
      // No link in the middle: the caller waits the timeout and asks the next leaf.
    } finally {
      this.#aEnviarAnexo = false
      if (this.#videoServido === servido) this.#videoServido = null
    }
  }

  #notarAnexoEnviado(chave: string, agora: number): void {
    this.#anexosEnviados.set(chave, agora)
    // A map that only grows is a leak: expired ones leave when it exceeds 256.
    if (this.#anexosEnviados.size > 256) {
      for (const [outra, em] of this.#anexosEnviados) if (agora - em >= TECTOS_DOS_ANEXOS.repeticaoMs) this.#anexosEnviados.delete(outra)
    }
  }

  // ------------------------------------------------ perfis a terceiros

  /**
   * Request profiles of those who appear nameless (3/11/2026, only where
   * `perfisATerceiros`: the common room). Whoever enters by card does not
   * receive a portrait, and whoever was offline never tells them the name:
   * without this, a new account would see "No name" in everyone not online
   * when it joined.
   *
   * An ephemeral signal, with the accounts: ONE leaf responds, by turn, with
   * profiles signed by authors (`#aoPedidoDePerfis`). At most one request per
   * channel per minute, and each account is requested once every ten minutes:
   * an account that nobody can say (no profile, or with a profile without
   * authorship) is not requested in cycle.
   */
  async pedirPerfis(canal: string, semNome: readonly string[]): Promise<boolean> {
    if (!this.#porta.elegivel(canal) || this.#porta.perfisATerceiros?.(canal) !== true) return false
    const agora = this.#porta.agora()
    const antes = this.#perfisPedidos.get(canal)
    if (antes && agora - antes.em < INTERVALO_DOS_PEDIDOS_DE_PERFIS_MS) return false
    const lembradas = antes && agora - antes.em < LEMBRAR_PERFIS_PEDIDOS_MS ? antes.contas : new Set<string>()
    const eu = this.#porta.eu.address
    const contas = [...new Set(semNome)].filter((conta) => conta !== eu && !lembradas.has(conta)).sort().slice(0, PERFIS_POR_PEDIDO)
    if (contas.length === 0) return false
    // No one alive from another account, nobody to respond: the request is not spent.
    if (!this.#porta.folhas(canal).some((folha) => folha.address !== eu && this.#viva(folha))) return false
    const saiu = await this.#enviar(canal, { k: "pp", id: novoId(), c: contas })
    if (!saiu) return false
    this.#perfisPedidos.set(canal, { em: agora, contas: new Set([...lembradas, ...contas]) })
    this.estatisticas.pedidosDePerfis += 1
    return true
  }

  /**
   * A profile request. The people on the list publish theirs (the session caps it to
   * once per ten minutes per channel). And answers with others' profiles: the lowest
   * live leaf that has them, by turn: live leaves without the caller, in tree order,
   * each one `posição × passo` after the previous one,
   * and each stays silent if another has already answered. An old leaf that doesn't know
   * this won't answer, and the next one answers one step later.
   */
  #aoPedidoDePerfis(canal: string, de: Folha, corpo: PP): void {
    if (this.#porta.perfisATerceiros?.(canal) !== true) return
    const eu = this.#porta.eu.address
    const contas = new Set(corpo.c)
    if (contas.has(eu)) this.#porta.republicarPerfil?.(canal)
    contas.delete(eu)
    contas.delete(de.address)
    const membros = new Set(this.#porta.membros(canal))
    const pedidas = [...contas].filter((conta) => membros.has(conta))
    if (pedidas.length === 0) return
    const chave = `${canal}|${corpo.id}`
    if (this.#perfisRespondidos.has(chave) || this.#respostasDePerfis.has(chave)) return
    const meu = this.#meuAparelho
    const fila = this.#porta
      .folhas(canal)
      .filter((folha) => folha.address !== de.address && (folha.aparelho === meu || this.#viva(folha)))
      .sort((a, b) => a.indice - b.indice)
    const vez = fila.findIndex((folha) => folha.aparelho === meu)
    if (vez < 0 || vez >= VEZES_DOS_PERFIS) return
    // A sheet with nothing to give does not consume anyone's turn.
    if ((this.#porta.perfisParaRelatar?.(canal, pedidas) ?? []).length === 0) return
    const temporizador = this.#mais(vez * TECTOS_DA_SINCRONIA.passoDaSupressaoMs, () => {
      this.#respostasDePerfis.delete(chave)
      void this.#relatarPerfis(canal, corpo.id, pedidas, de.aparelho).catch(() => {})
    })
    this.#respostasDePerfis.set(chave, temporizador)
  }

  async #relatarPerfis(canal: string, id: string, pedidas: readonly string[], aparelhoDeQuemPede: string): Promise<void> {
    const chave = `${canal}|${id}`
    if (this.#perfisRespondidos.has(chave)) return
    const agora = this.#porta.agora()
    // One request per device per minute, and six per channel: a repeated request does not start anyone reporting in a loop.
    if (!this.#tectos.gastar(`perfis|${canal}|${aparelhoDeQuemPede}`, 1, 1, agora)) return
    if (!this.#tectos.gastar(`perfis|${canal}`, 1, RESPOSTAS_DE_PERFIS_POR_MINUTO, agora)) return
    const itens = (this.#porta.perfisParaRelatar?.(canal, pedidas) ?? []).map((item) => {
      const ap = (item.p["autoria"] as { ap?: unknown } | undefined)?.ap
      const cadeia = typeof ap === "string" ? this.#porta.cadeiaDe(canal, item.a, ap) : null
      return cadeia ? { ...item, k: cadeia.k, x: cadeia.x } : item
    })
    if (itens.length === 0) return
    const dia = new Date(agora).toISOString().slice(0, 10)
    const tramas: RelatosNoFio[] = []
    for (const trama of partirRelatos(itens)) {
      const bytes = new TextEncoder().encode(JSON.stringify(trama)).length
      if (!this.#tectos.gastar(`relato|${canal}`, bytes, TECTOS_DA_SINCRONIA.bytesDeRelatoPorCanalPorMinuto, agora)) break
      if (!this.#gastarDoDia(canal, dia, bytes)) break
      tramas.push(trama)
    }
    this.#notarPerfisRespondidos(chave)
    for (const [indice, trama] of tramas.entries()) {
      const comQ: RelatosNoFio = { ...trama, q: `${Q_DOS_PERFIS}${id}:${indice + 1}/${tramas.length}` }
      try {
        await this.#porta.enviarRelatos(canal, comQ)
      } catch {
        break
      }
      this.estatisticas.respostasDePerfis += 1
      this.estatisticas.perfisRelatados += trama.itens.length
    }
  }

  #perfisRespondidosPor(canal: string, q: string): void {
    const id = lerQ(q)?.id.slice(Q_DOS_PERFIS.length)
    if (!id) return
    const chave = `${canal}|${id}`
    this.#notarPerfisRespondidos(chave)
    const agendada = this.#respostasDePerfis.get(chave)
    if (agendada) {
      this.#cancelar(agendada)
      this.#respostasDePerfis.delete(chave)
    }
  }

  #notarPerfisRespondidos(chave: string): void {
    this.#perfisRespondidos.add(chave)
    // The oldest ones leave: only requests from the last few seconds matter.
    if (this.#perfisRespondidos.size > 256) {
      const [primeiro] = this.#perfisRespondidos
      if (primeiro !== undefined) this.#perfisRespondidos.delete(primeiro)
    }
  }

  // ------------------------------------------------------- receber relatos

  /**
   * A `typing` with `reports`, live or from recovery. Check each item and
   * apply what passes (see `receberItem` in `relato.ts` for the rules).
   *
   * `deAparelho`: the sheet that sent the frame (MLS authenticates it). Items
   * count from whoever sends them, because each one carries authorship; but the
   * frame only counts as part of the response to our request if it comes from the
   * sheet we asked. From another member, a copied `q` would close the request too early.
   */
  aoRelatos(canal: string, seqDaTrama: number, relatos: RelatosNoFio, deAparelho: string): Promise<void> {
    const anterior = this.#filas.get(canal) ?? Promise.resolve()
    const proxima = anterior.then(() => this.#aplicarRelatos(canal, seqDaTrama, relatos, deAparelho)).catch(() => {})
    this.#filas.set(canal, proxima)
    return proxima
  }

  async #aplicarRelatos(canal: string, seqDaTrama: number, relatos: RelatosNoFio, deAparelho: string): Promise<void> {
    if (!this.#porta.elegivel(canal)) return
    // Bytes of an attachment (S5): only for those with an active request for the same attachment.
    if (relatos.q?.startsWith(Q_DO_ANEXO)) return this.#aoAnexo(canal, relatos, deAparelho)
    // Someone answered a profile request: whoever was still waiting their turn stays silent.
    if (relatos.q?.startsWith(Q_DOS_PERFIS)) this.#perfisRespondidosPor(canal, relatos.q)
    // The entire set, with deleted items included: a deleted item means "we have it", never "missing".
    const temos = new Set(this.#itens(canal, undefined, true).map((item) => item.chave))
    const lapides = lapidesDoCanal(this.#porta.conteudo(), canal)
    const lugar = this.#porta.lugar(canal)
    const lido = lerQ(relatos.q)
    const emCurso = this.#descidas.get(canal)
    const respondeANos = emCurso !== undefined && lido !== null && emCurso.id === lido.id && emCurso.responde.aparelho === deAparelho
    // The window when the reporter answered: ours, if it is a response to our request.
    const janela = respondeANos ? Math.max(lugar, emCurso.d) : lugar
    let aplicados = 0
    /*
      Reported profiles (3/11/2026): only from those with a sheet, never ours, and
      never a version older than what we already have. The signature, device and
      block state are those of any report.
    */
    const conteudo = this.#porta.conteudo()
    const eu = this.#porta.eu.address
    const membros = new Set(this.#porta.membros(canal))
    const perfis: { autor: string; versao: unknown; leve: boolean }[] = []
    const itemDe = (autor: string, payload: StoredPayload): ItemDoResumo | null => {
      if (payload.t !== "profile") return itemDoPayload(autor, payload, canal)
      if (autor === eu || !membros.has(autor)) return null
      return { tipo: "perfil", balde: autor, chave: `perfil|${autor}|${numeroOuZero(payload["updatedAt"])}` }
    }
    const perfilJaTemos = (chave: string): boolean => {
      if (!chave.startsWith("perfil|")) return false
      const fim = chave.lastIndexOf("|")
      const autor = chave.slice("perfil|".length, fim)
      const versao = Number(chave.slice(fim + 1))
      const guardado = conteudo.directory[autor]
      if (!guardado || guardado.parcial) return false
      return numeroOuZero(guardado.payload["updatedAt"]) >= versao
    }
    for (const item of relatos.itens) {
      const veredicto = await receberItem(item, {
        canal,
        seqDaTrama,
        lugar,
        janela,
        jaTemos: (chave) => temos.has(chave) || perfilJaTemos(chave),
        apagado: (doResumo, autor, payload) => itemApagado(lapides, doResumo.tipo, autor, payload),
        // Only the sheet we choose can mark a post as "public": a frame that answers
        // another member's request does not mark anything. Without this, any member would
        // spread the mark through honest reporting (re-review of 21 October 2026). The
        // remaining risk is in the plan, section 5.3.
        ...(respondeANos ? { alvoDoMural: (alvo: string) => this.#marcarAlvoDoMural(canal, alvo) } : {}),
        itemDe,
        aparelhoConfiavel: (autor, aparelho, cadeia) => this.#porta.aparelhoConfiavel(canal, autor, aparelho, cadeia),
        bloqueado: (autor) => this.#porta.bloqueado(canal, autor),
      })
      if (!veredicto.ok) {
        this.estatisticas.relatosRecusados[veredicto.razao] = (this.estatisticas.relatosRecusados[veredicto.razao] ?? 0) + 1
        continue
      }
      if (veredicto.item.tipo === "perfil") {
        const retrato = veredicto.payload["avatar"] as { evicted?: unknown } | undefined
        perfis.push({ autor: veredicto.autor, versao: veredicto.payload["updatedAt"], leve: retrato?.evicted === true })
      }
      this.#porta.gravarRelatado(canal, veredicto.seq, veredicto.autor, veredicto.payload as unknown as Payload)
      temos.add(veredicto.item.chave)
      notarLapide(lapides, veredicto.autor, veredicto.payload as StoredPayload)
      aplicados += 1
      // The founder and officers decide who has authority, and the rest of the batch asks them
      // (`#mandaEm`): they resolve right away, before the next item.
      if (veredicto.item.tipo === "fundador" || veredicto.item.tipo === "cargo" || veredicto.item.tipo === "atribuicao") {
        await this.#porta.escoar()
      }
    }
    if (aplicados > 0) await this.#porta.escoar()
    if (perfis.length > 0) {
      this.estatisticas.perfisAplicados += perfis.length
      this.#porta.aoPerfisRelatados?.(canal, perfis)
    }
    this.estatisticas.relatosAplicados += aplicados
    if (respondeANos) emCurso.aplicados += aplicados
    if (aplicados > 0 && this.#descidas.get(canal)?.inteiro) this.#mudou(canal)

    const descida = this.#descidas.get(canal)
    if (
      lido &&
      descida &&
      descida.id === lido.id &&
      descida.responde.aparelho === deAparelho &&
      (descida.fase === "itens" || descida.fase === "inteiro")
    ) {
      descida.relatosRecebidos.add(lido.parte)
      descida.relatosEsperados ??= lido.de
      this.#armarEspera(descida)
      this.#talvezAcabarItens(descida)
    }
  }
}

/**
 * Add authorship to our payload on send (section 4.1). Only in types that carry it, and
 * only if it does not have it already (a resend of what is ours already has it). A payload
 * that the schema rejects goes out as is: the send fails later, through the normal path.
 */
export function comAutoria<T extends Payload>(canal: string, payload: T, eu: QuemRelata): T {
  const bruto = payload as unknown as Record<string, unknown>
  if (!levaAutoria(bruto["t"]) || bruto["autoria"] !== undefined) return payload
  const normal = normalizar(bruto)
  if (!normal) return payload
  try {
    const autoria = assinarAutoria({ canal, autor: eu.address, payload: normal, aparelho: eu.aparelho, assinar: eu.assinar })
    return { ...payload, autoria }
  } catch {
    return payload
  }
}

/** For tests: the body of a signal, unencrypted. */
export const _paraTestes = { lerCorpo, emPartes, mensagemDoSinal }
