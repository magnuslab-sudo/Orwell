import {
  addMembers,
  addressAtLeaf,
  createChannel,
  credentialOfKeyPackage,
  declaraPermissoes,
  declaraRetrato,
  declaredEpoch,
  decodeKeyPackage,
  deviceKeyAtLeaf,
  encryptPayload,
  epochOf,
  exportKeyPackage,
  exportSession,
  generateKeyPackages,
  importKeyPackage,
  importSession,
  joinChannelComExtensoes,
  joinChannelExternally,
  leafIndexOf,
  leavesOf,
  memberAccountKey,
  memberAccounts,
  memberAddresses,
  publishableGroupInfo,
  receive,
  removeMembers,
  retratoDasExtensoes,
  deriveSframeKeyMaterial,
  type AddMembersResult,
  type EntradaPorWelcome,
  type GroupSession,
  type StoredKeyPackage,
} from "@enclave/crypto"
import type { MediaKeyMaterial } from "./call.js"
import { RecusaDoSfu } from "./call-sfu.js"
import { desempateDaDirecta, type DesempateDaDirecta } from "./desempateDaDirecta.js"
import { credentialAtLeaf, derivarChaveDoSinal, type ChaveDoSinal } from "@enclave/crypto"
import {
  CAPACIDADE_ENVIO_RECUSADO,
  CAPACIDADE_ESTREIA_DA_DIRECTA,
  CAPACIDADE_LIGACOES_CURTAS,
  CAPACIDADE_SINAL_EFEMERO,
  eCodigoCurto,
  lerRetrato,
  verifyDeviceChain,
} from "@enclave/protocol"
import {
  AntiEntropia,
  CAPACIDADE_SINCRONIA,
  comAutoria,
  type EstatisticasDaSincronia,
  type DesfechoDoAnexo,
  type PortaDaAntiEntropia,
} from "./sincronia/pedido.js"
import { aparelhoPeloManifesto, receberItem, type QuemRelata, type VeredictoDoRelato } from "./sincronia/relato.js"
import { construirDenuncia, semAsMinhas, type AlvoDaDenuncia, type DenunciaPreparada } from "./denuncia-construir.js"
import { denunciaRecebidaDe, denunciasParaOsIrmaos, fundirDenuncias, payloadsDasDenuncias } from "./denuncia-recebida.js"
import {
  abrirCopia,
  conteudoDaCopia,
  corpoDaDenuncia,
  enviarDenuncia,
  lerCaixa,
  lerSuspensao,
  pedirFundador,
  pedirRevisao,
  selarCopia,
  type EscolhaDaDenuncia,
  type ItemDaCaixaLido,
} from "./denuncia.js"
import { origemDoServidorDe } from "./relato.js"
import { escolherFundador, montarRetrato, ordemDeAplicacao, perfisParaRelatar, type RetratoMontado } from "./retrato.js"
import { HistoricoEntreAparelhos, type EventoDoHistorico, type PortaDoHistorico } from "./historico/historico.js"
import {
  itemApagado,
  itemDoPayload,
  itensDoCanal,
  lapidesDoCanal,
  type CofreDaSincronia,
  type ItemDoResumo,
  type ResumoNivel0,
} from "./sincronia/resumo.js"
import { comAnexo, type SincroniaDoCanal } from "./sincronia/instantaneo.js"
import {
  accountIdFromSigningKey,
  fromBase64,
  generateIdentity,
  identityFromPrivateKey,
  makeUserAddress,
  newRoomId,
  parseAddress,
  parseServerName,
  safetyNumber,
  signWithDevice,
  toBase64,
  foldFriendTies,
  friendsOfTies,
  isFriendPayload,
  openRequestsOf,
  sentRequestsOf,
  acceptedInvitesOf,
  foldInviteTies,
  inviteKey,
  isInvitePayload,
  pendingInvitesOf,
  type FriendEvent,
  type FriendTie,
  type InviteEvent,
  type InviteTie,
  type Attachment,
  type Identity,
  type LinkCard,
  type Payload,
  type Poll,
  type ClientFrame,
  type ServerFrame,
  type UserAddress,
  type Power,
  POWERS,
  CARGO_TODOS,
  PODERES_DE_TODOS_POR_OMISSAO,
  alturaDe,
  compararCargos,
  fundirCargoAntigo,
  mandaNosCargos,
  permissoesEm as permissoesNoModelo,
  MENCAO_TODOS,
  mencoesConferidas,
  podeAtribuir,
  podeGerirCargo,
  podeSobrepor,
  poderesConhecidos,
  Sobreposicao,
  sobreposicoesAGuardar,
  type CargoDefinido,
  type EstadoDePermissoes,
  type Lugar,
  DEFAULT_ROOM,
  SALA_DA_PERGUNTA,
  SalaAfk,
  MAX_PINNED,
  PINNED_BODY_MAX,
  PinnedMessage,
  type RoleColour,
  ROLE_COLOURS,
  CAPACIDADE_APARELHOS,
  CAPACIDADE_BUNDLE,
  CAPACIDADE_EMPARELHAMENTO,
  CAPACIDADE_REVOGACAO,
  CAPACIDADE_SFU,
  CAPACIDADE_SFU_FOTOGRAMA_CHAVE,
  APARELHOS_POR_CONTA,
  PAIR_SECRET_BYTES,
  aparelhosDoManifestoSeguinte,
  identityFromDeviceCert,
  temChaveDeConta,
  signDeviceManifest,
  verifyDeviceManifest,
  type DeviceManifest,
  type DeviceManifestWire,
  type FonteDeMedia,
  PROTOCOL_VERSION,
  TICKET_STATES,
  type TicketState,
  ARQUIVO_MAX,
  BLOQUEIO_MAX,
  CAPACIDADE_CHAVE_DE_CONTA,
  CAPACIDADE_ESTADO_DA_CONTA,
  CHAVE_DE_PREFERENCIA,
  EntradaDoLivro,
  PerfilDaConta,
  PERFIS_MAX,
  PerfisDeOutros,
  LIDAS_MAX,
  LIVRO_CANAIS_MAX,
  LIVRO_ENTRADAS_MAX,
  PREFERENCIA_MAX_CARACTERES,
  PREFERENCIAS_MAX,
  eMoradaOpaca,
  podeEstrearCanal,
  moradaDaConta,
  moradaDirecta,
  moradaDoMural,
  FICHAS_MAX,
  chaveDaProvaDoConvite,
  provarCodigoDoConvite,
  selarNomeDoConvite,
  abrirSeloDoConvite,
  CAPACIDADE_SELO_DO_CONVITE,
  type NomeDoConvite,
  type EstadoDeConta,
  type CopiaSelada,
  type AvisoDeSuspensao,
} from "@enclave/protocol"
import { ticketsOf, type Ticket } from "./tickets.js"
import {
  fichaDoCanal as fichaNoCofre,
  registarFicha,
  type FichaDoCanal,
  type TipoDoCanal,
} from "./tipoDoCanal.js"
import { APELIDO_MAX, apelidoDaMensagem, apelidosDoCanal, esquecerApelidos, registarApelido, type RegistoDeApelido } from "./apelidos.js"
import { chaveDoEvento, porOrdemDoServidor, venceCarimbo } from "./dobras.js"
import { AnfitriaoDeEmparelhamento, ConvidadoDeEmparelhamento, type CofreDeAparelho, type PairEvento } from "./emparelhar.js"
import { PREFERENCIA_SALA_COMUM, SALA_COMUM_ENTRAR, SALA_COMUM_FORA, querSalaComum } from "./salaComum.js"
import {
  comContaJuntada,
  contasJuntadas,
  corpoDaSucessao,
  marcarSucessaoFeita,
  PREFERENCIA_CONTAS_JUNTADAS,
  registarSucessao,
  sucessoesDoCofre,
  sucessoraDaMensagem,
  type RegistoDeSucessao,
  type SucessaoRecebida,
} from "./sucessao.js"
import {
  canaisAvisados,
  canaisComFalha,
  esquecerRevogado,
  estaRevogado,
  lerRevogacao,
  notarAvisado,
  notarRevogado,
  revogarAparelho,
  SEM_RESPOSTA,
  type SessaoParaRevogar,
} from "./revogacao.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { bootstrapPeersFor } from "./bootstrap.js"
import { Emitter } from "./emitter.js"
import {
  aplicarEstadoDeConta,
  fundirPerfisDeOutros,
  perfilQueViaja,
  perfisParaOsIrmaos,
  adoptarPerfil,
  aplicarAtribuicao,
  chaveConfirmada,
  appendHistory,
  canaisComEntradas,
  confirmarSeq,
  entradasDoCanal,
  esquecerEntradas,
  fundirAmigosMostrados,
  fundirArquivo,
  fundirBloqueio,
  fundirLidas,
  fundirPreferencias,
  maisRecentes,
  marcasDeBloqueio,
  deviceManifestSeen,
  hasTransmitted,
  hasTransmitterEvidence,
  mayRepair,
  mergeOlderHistory,
  noteDeviceManifest,
  noteTransmitter,
  upsertDirectory,
  upsertSpaceMeta,
  type DenunciaRecebida,
  type StoredChatMessage,
  type StoredPayload,
  type StoredNotification,
  type StoredPeerProfile,
  type StoredProfile,
  type VaultContents,
  type Vault,
  guardarVideo,
  apagarVideo,
  videoNoCofre,
} from "./vault.js"
import {
  ERROS_DO_VIDEO,
  resumosDosVideos,
  videoEmUso,
  VideosDaSessao,
  type EstadoDoVideo,
  type EventoDoVideo,
  type VideoAPublicar,
} from "./videos.js"

/**
 * The client's whole brain, with no platform dependencies.
 *
 * The same file runs in Electron's main process and in a browser tab. That is
 * only possible because every primitive it needs — WebSocket, WebCrypto,
 * TextEncoder — is standard in both, and because the vault's platform-specific
 * parts sit behind `VaultBackend`.
 *
 * On desktop this runs in the main process, so the renderer never holds a key.
 * In the browser there is no such separation available: the page holds the keys,
 * because there is nowhere else to put them. `docs/THREAT-MODEL.md` says so.
 */

export interface ReceivedMessage {
  channel: string
  seq: number
  sender: UserAddress
  payload: Payload
  /**
   * The message just arrived, in a live frame from the server (3/11/2026).
   *
   * Absent from recovery on reconnect, in telemetry and in mine. The interface reads this for the sound of channel messages: the history that arrives on app open is not a new message, and cannot play thirty times.
   */
  aoVivo?: true
}

export type ConnectionState = "offline" | "connecting" | "online" | "reconnecting"

/**
 * Why an event did not arrive, which decides whether to ask again.
 *
 * `permanente` is text that is not base64: it never will be, and insisting wastes requests. `recuperavel` is everything else, almost always an epoch that has not arrived yet, and that deserves the retries the distinction exists to give it.
 */
type Recusa = "permanente" | "recuperavel"

/**
 * What happened to an event, seen by whoever decides the anchor.
 *
 * - `prova`: entered IN THE EPOCH THE GROUP IS IN, a commit applied or a message encrypted in that epoch. It is proof the channel continues on our branch after it.
 * - `lido`: there is nothing more to do with it (entered in a past epoch we still have, or is before our seat, or is junk that will never open).
 * - `saltado`: not read, and we had a seat when it was said. A message from an epoch this device already left behind. Until 5 October 2026 this was `lido`, and that is how history was lost silently: the anchor passed over it and nobody asked for it again. See `#anotarLacuna`.
 * - `buraco`: an epoch ahead of ours. See `BuracoDeEpoca`.
 * - a `Recusa`.
 */
type Desfecho = "prova" | "lido" | "saltado" | "buraco" | Recusa

/**
 * The server accepts one commit per epoch per channel and rejects the rest with `stale-epoch`.
 * See `channel.rejected` in the protocol.
 */
const CAPACIDADE_UM_COMMIT_POR_EPOCA = "commit-per-epoch"

/**
 * What this client guarantees to the server, said in the `hello`.
 *
 * `commit-after-echo`: a commit of ours is applied only after the echo. It is true on all paths that commit, because all go through `#publicarCommit`, invite, admission, expulsion, remove and restore seat, entry by card. A new path that sends a handshake by another gate makes this false, and the server would lock the room with our word: the second round test in `session.particao-rele.test.ts` runs them all against a server that demands it.
 */
/*
  `sinal-efemero` (S4): this client reads and sends `channel.sinal`, the ephemeral frame of hashes and requests of sync between accounts. The server only delivers it to whoever announces it; an old server ignores the name.
  */
/*
  `envio-recusado` (S6): this client reads the rejection of a send for rate limit (`channel.rejected` with `rate-limited`) and retries the send. See `#aoRecusaPorRitmo`.
  */
const GARANTIAS_DO_CLIENTE = ["commit-after-echo", CAPACIDADE_SINAL_EFEMERO, CAPACIDADE_ENVIO_RECUSADO]

/** How many reconnections to wait for an event before calling it lost. */
const TENTATIVAS_POR_BURACO = 3

/** How long a manifest read to decide an admission stays valid without going back to the server. See `#manifestoPara`. */
const MANIFESTO_LEMBRADO_MS = 5 * 60_000

/**
 * How long to wait for a `manifest.result` in an admission guard.
 *
 * The gateway goes silent above the bucket (60 per minute per account) instead of rejecting, and a silent wait is the only way to know. Ten seconds (the general timeout of `#await`) times each address above the bucket was a reconciliation of minutes; two is enough for a response that comes, and silence counts as "did not read", which is what it is.
 */
const PRAZO_MANIFESTO_GUARDA_MS = 2_000

/**
 * A frame from an epoch ahead of ours: the channel moved and we are missing the commit.
 *
 * `receive` does not throw for this, it returns `ignored`, like for junk, and so recovery took it as read and passed the anchor over it. It is the same recoverable rejection as an app that crashes, and that is how we treat it: the anchor stays before it and we go fetch what we need from there.
 */
class BuracoDeEpoca extends Error {
  constructor(
    readonly epocaDoFrame: bigint,
    readonly epocaDoGrupo: bigint,
  ) {
    super(`frame na epoch ${epocaDoFrame}, grupo na ${epocaDoGrupo}`)
  }
}

/**
 * A commit from us, assembled but not yet applied.
 *
 * It stays this way until the server confirms, the echo with our `ref`. See
 * `#publicarCommit`, which explains why applying it early broke the room.
 */
interface CommitNosso {
  /** The exact bytes that went on the wire: the server stores them unchanged. */
  commit: Uint8Array
  /** The epoch it was assembled on. Only valid while the group is at that epoch. */
  base: bigint
  /** The group after it. */
  session: GroupSession
  /** The Welcome from a join, which only goes out after the commit is accepted. */
  welcome?: { bytes: Uint8Array; recipient: string } | undefined
}

/** The server rejected one of our commits: the epoch it was assembled on has passed. */
class CommitRecusado extends Error {
  constructor(
    readonly base: bigint,
    readonly epocaDoCanal: number | undefined,
  ) {
    super(`o servidor recusou o commit sobre a epoch ${base}: o canal já vai na ${epocaDoCanal ?? "?"}`)
  }
}

/** The `stale-epoch` rejection reaches the one waiting for the receipt. See `#onFrame`. */
/** The server rejected a commit or banner from us because we did not announce the capability. */
class AtualizacaoExigida extends Error {
  constructor() {
    super("o servidor exige commit-after-echo a esta ligação")
  }
}

/**
 * How long a voice signal is worth retrying after it was sent.
 *
 * A `voice.join` retried a minute later would add to the room someone who had
 * already left (phantom presence), and a late `voice.move` arrived after the
 * next one and moved the person to the wrong room (S6 revision). Five seconds is
 * the delay of a rejection with the cap nearly free; above that the signal is
 * already stale.
 */
const VOZ_REPETE_ATE_MS = 5_000

/**
 * A send worth retrying after a rate rejection. Live write signal and buzz are
 * not: a minute later they mean nothing. Channel exit is not either: the caller
 * waits for the receipt of the `ref` that exited.
 *
 * Voice only while fresh (`VOZ_REPETE_ATE_MS`, by the signal's own `at`); voice
 * with no `at` (offer, answer, ICE, key) never: negotiation already moved on
 * without it, and the next attempt will use it. Checked when storing and again
 * before retrying, because the wait can be long.
 */
function repeteSeRecusado(payload: Payload, agora = Date.now()): boolean {
  if (payload.t === "buzz" || payload.t === "member.left") return false
  if (payload.t === "typing") return (payload as { until?: number }).until === 0
  if (payload.t.startsWith("voice.")) {
    const at = (payload as { at?: unknown }).at
    return typeof at === "number" && agora - at < VOZ_REPETE_ATE_MS
  }
  return true
}

/** The server rejected the send because the account hit the per-minute cap. It was not stored. */
class EnvioRecusadoPorRitmo extends Error {
  constructor(readonly esperaMs: number) {
    super(`o servidor recusou o envio por ritmo; há lugar daqui a ${esperaMs} ms`)
  }
}

class EpocaVelhaNoServidor extends Error {
  constructor(readonly epoca: number | undefined) {
    super("o servidor recusou: a epoch deste envio já passou")
  }
}

/**
 * The server's two buckets (S6): messages, and commits with Welcomes. Each has
 * its own pause and slow mode, so an expulsion does not wait for synchronization.
 * See `#ritmo`.
 */
type BaldeDeEnvio = "envios" | "handshake"

/** What a send put on the wire, and how we know if it went through. */
interface Enviado {
  ref: string
  /** Only the log waits for the echo. */
  recibo: Promise<number> | null
  marca: string | null
  /**
   * Only the log: the retry if the receipt fails due to rate. Resolves when the
   * retry goes out (with its `Enviado`), and rejects when we give up.
   */
  repeticao: Promise<Enviado> | null
}

/**
 * A send that retries if the server rejects it due to rate (S6).
 *
 * `ordem` is the position the author stated it in, and does not change on
 * retries: retries from a channel go out in that order, ahead of what has not
 * yet gone out. Without this, two edits in a row with the first rejected would
 * leave the first on top (higher `seq`), for everyone.
 *
 * `vida` is the session that stated it: a retry from another account never goes out.
 */
type Reenviavel = {
  channel: string
  ordem: number
  /** When it was first rejected; `null` while it has not been. See `PRAZO_DOS_REENVIOS_MS`. */
  primeiraRecusa: number | null
  vida: number
} & (
  | { tipo: "payload"; payload: Payload; livro: { resolver: (enviado: Enviado) => void; rejeitar: (erro: Error) => void } | null }
  | { tipo: "welcome"; welcome: { bytes: Uint8Array; recipient: string } }
)

/** The turn of a send in slow mode: what tells it it went out, or that it never made it. */
interface VezDeEnvio {
  /** The message went out with this `ref`. `comEco`: the server echoes it back to the sender (the Welcome does not). */
  saiu(ref: string, comEco: boolean): void
  /** It did not go out: the turn passes to the next one. */
  largar(): void
}

/** The turn of someone not in slow mode: nothing to release. */
const VEZ_LIVRE: VezDeEnvio = { saiu: () => {}, largar: () => {} }

/** Waiting for a send to be written to the batch. See `Session.#enviarEmLote`. */
interface BarreiraDoLote {
  chegou: () => void
  passar: Promise<void>
}

/** A send in flight from a bucket in slow mode. See `Session.#ritmo`. */
interface EmVoo {
  /** `null` until the message goes out. */
  ref: string | null
  libertada: Promise<void>
  libertar: () => void
  relogio: ReturnType<typeof setTimeout> | undefined
}

/** A commit from a single operation, which is what all of them produce today. */
function umSoCommit(commits: Uint8Array[]): Uint8Array {
  const [commit, ...resto] = commits
  // The form is still a list (see `removeMembers`), but applying only after the
  // echo needs a verdict per commit. An operation with two commits has to learn
  // to wait for both before reaching here.
  if (!commit || resto.length > 0) throw new Error("uma operação com mais de um commit não sabe ainda esperar pelos veredictos")
  return commit
}

/**
 * A shortened address for diagnostics: first word and ellipsis.
 *
 * "Copy diagnostics" leaves the device by the hand of whoever copies it, and a
 * full address is a person's identity. Six characters are enough to tell two
 * people apart in the same failure.
 */
function semEnderecos(texto: string): string {
  return texto.replace(/@([a-z0-9]{1,6})[a-z0-9-]*:[a-z0-9.-]+(?::\d+)?/gi, "@$1…")
}

/**
 * What seating somebody actually did — the difference between a repair that
 * moved and one that had nothing to move.
 *
 * The interface needs this to tell the truth after a button press: "invited"
 * and "reseated" both mean a welcome is now waiting for them to open the app,
 * "live" means the cryptography already proves they are reading, and
 * "unproven" means this device has not heard enough from the channel to judge
 * and deliberately did nothing rather than risk re-seating a healthy member.
 */
export type SeatOutcome = "invited" | "reseated" | "live" | "unproven"

/**
 * A seat outcome, or the rate limiter declining an unattended retry, or a
 * device of an account already seated that has no key packages to be seated
 * with ("device-unreachable": nothing was spent, the brake IS recorded, and
 * the next pass past the cooldown tries again). Ver `repairInvite`.
 */
export type RepairOutcome = SeatOutcome | "cooldown" | "device-unreachable"

/**
 * The account is already in the tree and missing a device whose key package
 * the server does not have. Raised by `#invite` and caught by `repairInvite`,
 * which tells it apart from "the account has no keys" (transient, races with
 * pool publication) because this one is not transient: the missing device may
 * never connect again, and retrying on each connection, per friend, with three
 * attempts and three seconds' wait, was the cost of having it in the manifest.
 */
export class AparelhoSemChaves extends Error {
  constructor(address: string) {
    // Same key as the case where the account has no keys: for the reader, what to
    // do is the same (the person opens the app). The address goes in `cause`, never
    // in the message.
    super("that person has no invite keys", { cause: { address, aparelho: true } })
    this.name = "AparelhoSemChaves"
  }
}

/**
 * Key packages claimed from the server and already verified, waiting for a commit.
 *
 * Exists so `#reseat` can claim before removing: see there, and see
 * `#reclamarPacotes`.
 */
interface PacotesReclamados {
  manifesto: DeviceManifest | null
  pacotes: { deviceKey: string; pacote: ReturnType<typeof decodeKeyPackage> }[]
}

/**
 * How long each member waits its turn before answering a rejoin request.
 *
 * Answers are staggered by position in the member list so the channel's
 * members do not all commit a new seat for the same person at the same
 * instant. Concurrent commits are the fork: MLS applies one of them and the
 * rest are garbage, which splits the channel into groups that share an id and
 * nothing else — two people in "the same room", each alone in a call.
 */
export const REJOIN_TURN_MS = 3_000

/**
 * The rate limit per pair for repairs that the live connection triggers (F9,
 * 20/10/2026): someone's presence flickering, a friend request from someone
 * already a friend. Ten minutes is enough for flickering presence not to become
 * a flickering repair, and is short next to the six-hour limit on key packages,
 * which stays underneath (`repairInvite`).
 */
export const REPARAR_PAR_MS = 10 * 60_000

/**
 * The built-in role: gives the four responsibilities, plus the one to manage
 * roles.
 *
 * It is not defined or deleted, and is what keeps channels created before named
 * roles working without any migration, the admin list in the old format reads
 * as who has this role.
 */
export const ADMIN_ROLE = "admin"

/**
 * What a device says in a channel's device signal so others know it deduplicates
 * its own retransmission (S1, §4.6 of the plan). A 0.5.7 client never says it:
 * it stored each comment or ticket retransmitted as a new entry, so that
 * retransmission only runs where all leaves said it. In the `capacidades` field
 * of `typing`, which a 0.5.7 throws away without rejecting the payload; no new
 * field on the wire.
 */
export const CAPACIDADE_REENVIO = "reenvio-v1"

/**
 * A profile request (F10, F14): whoever reads it in a channel's device signal
 * publishes their profile in that channel. Goes out when someone in the channel
 * appears without a name.
 */
export const CAPACIDADE_PEDE_PERFIS = "pede-perfis"

/**
 * The 1.2 permissions model (`permissoes.ts` in the protocol): this device reads
 * the `rank`, the `perms`, and new powers. In the device signal, like
 * retransmission. It is the gate to delegation (decision D13): a non-admin with
 * `gerircargos` only manages roles in a channel where all leaves said so,
 * because a 1.0.x or a 1.1.0 does not accept what they assign.
 */
export const CAPACIDADE_PERMISSOES = "permissoes-v1"

/**
 * The rejection of the three admin doors in a one-to-one conversation.
 *
 * Written once, for the reason of its twin `#porqueNaoSeElimina`: the message
 * the person reads must be the one that was decided, and three identical strings
 * scattered across three methods drift apart at the first tweak in one of them.
 *
 * It is a key, not a message: the interface gives it the code and message in
 * the reader's language (`packages/ui/src/lib/codigosDeErro.ts`).
 */
const SEM_ADMINISTRACAO_EM_CONVERSA = "a direct conversation has no administration"

/**
 * How many failures in a row, and for how long, before declaring deafness.
 *
 * Both conditions together, and the second is what matters. A dead place always
 * fails: messages keep arriving and none open, indefinitely. A burst of frames
 * that do not open for another reason, our own echoes when the reference log
 * was lost in a restart, repeated handshakes, garbage, exhausts itself in
 * milliseconds.
 *
 * With the count alone, three echoes in a row were enough for the device to
 * declare itself deaf, ask for a new seat, and trigger a reseat that wipes the
 * channel history for future privacy. In a call, dozens of messages trade hands
 * per second, and it was exactly during call tests that a channel collected four
 * invites for the same member.
 */
const DEAF_FAILURES = 5
const DEAF_WINDOW_MS = 30_000

/**
 * What a step of own retransmission returns (S1).
 *
 * `falhas`: how many sends launched (no connection, vault full). The caller only
 * marks the channel done with zero (finding 2 from the 0.7.0 revision). `retido`:
 * stayed unsent because not all leaves announced themselves (§4.6).
 */
export interface Reenvio {
  falhas: number
  retido: boolean
}

const semReenvio = (): Reenvio => ({ falhas: 0, retido: false })

/**
 * F10: whether a profile request has an answer (finding 4 from the 0.7.0
 * revision). Pure, so the three guards prove themselves one by one. See
 * `#responderAPedidoDePerfis`.
 *
 * @param ditas the channel accounts when our profile last went out there;
 *   absent when it never went out (or the vault predates this).
 * @param lidoAntesDaLigacao the channel's `lastSeq` when the connection started.
 */
/**
 * F10: the accounts in a channel whose profile is requested, in order.
 *
 * Those with no profile in the directory, and those with only what a twin device
 * told (`parcial`): that one has the name but not the picture, and counts as
 * missing for anyone connected to publish the full one. Without this, a device
 * fresh from pairing would never ask for anyone's pictures again.
 */
export function contasSemPerfil(
  contas: Iterable<string>,
  eu: string,
  directory: Readonly<Record<string, { parcial?: true }>>,
): string[] {
  return [...contas].filter((conta) => conta !== eu && (directory[conta] === undefined || directory[conta].parcial === true)).sort()
}

export function podeResponderAPedidoDePerfis(pedido: {
  eu: string
  contas: readonly string[]
  ditas: readonly string[] | undefined
  ultimaResposta: number | undefined
  agora: number
  seq: number
  aoVivo: boolean
  lidoAntesDaLigacao: number | undefined
}): boolean {
  if (!pedido.aoVivo && pedido.seq >= 0 && pedido.seq <= (pedido.lidoAntesDaLigacao ?? -1)) return false
  if (pedido.ultimaResposta !== undefined && pedido.agora - pedido.ultimaResposta < Session.PERFIS_DADOS_MS) return false
  const ditas = new Set(pedido.ditas ?? [])
  return pedido.contas.some((conta) => conta !== pedido.eu && !ditas.has(conta))
}

/**
 * How many posts to republish to whoever enters our feed.
 *
 * Thirty is a wall: newcomers see who we are without downloading a file. Each
 * of these goes through MLS like any message, and some carry photos, so the
 * number is not decorative, it is what separates a new friendship from
 * megabytes of loading the moment it is accepted. See `republishPosts`.
 */
const POSTS_REPUBLICADOS = 30

/**
 * And how many of OUR votes come back with them. See the end of `republishPosts`.
 *
 * Lower than the count for posts on purpose: a vote is a tiny event, but these
 * are our votes in OUR polls, on our own feed, and any number above the count
 * of republished posts would be mathematically impossible. Twenty covers polls
 * still visible with plenty of margin.
 */
const VOTOS_REPUBLICADOS = 20

/**
 * The profile repair round this version requires. See `profileRepairRound` in
 * the vault, and the block that reads it in `connect`.
 *
 * Incrementing this makes each device republish the profile on all channels
 * once. It is expensive, a profile with a photo runs about 124 KB, and only
 * justified when a bug left people seeing addresses instead of names.
 *
 * 1: whoever invited someone never republished the profile, because the commit
 *    is local and never comes back through the receive path. Invitees up to
 *    August 12, 2026 never saw the name of who invited them.
 * 2: round 1 itself was marked as complete even when publishing failed, there
 *    was a `.catch(() => {})` before the write, so anyone who connected with
 *    the network down or the vault full burned it without fixing anything. And
 *    a vault imported from another device brings the `publishedProfileAt` of
 *    whoever exported it, which says "already published" on channels where this
 *    device never published: the repair round is the only path to undo it.
 *    Reported by the owner on October 5, 2026, with names appearing as
 *    addresses in a three-way call.
 */
const RONDA_DE_REPARACAO = 2

/**
 * How many SFrame counters to reserve at a time. See `reservarContadorSframe`.
 *
 * One million gives, at fifty frames per second, nearly six hours of speech per
 * app launch. The header cap is 2^48 counters, so there is still room for two
 * hundred eighty million blocks with the same key, and the key changes on each
 * epoch change, which is long before that.
 */
const RESERVA_SFRAME = 1_000_000

/** The state of consecutive failures on a channel. */
export interface FalhasSeguidas {
  falhas: number
  /** When the series started. Reset to zero by any success. */
  desde: number
}

/** See DEAF_FAILURES. Exported to be testable without a full session. */
export function surdezConfirmada(estado: FalhasSeguidas, agora: number, limiar = DEAF_FAILURES): boolean {
  return estado.falhas >= limiar && agora - estado.desde >= DEAF_WINDOW_MS
}

/** Who was a member of a channel in the last epoch we saw. See `chegouAlguemNovo`. */
export interface MembrosVistos {
  /** Leaves of the tree, which since 0.3.0 are more than people: one per device. */
  folhas: number
  enderecos: Set<string>
}

/**
 * Did someone arrive who has not yet seen our profile?
 *
 * This is the question that triggers republishing the profile, the authority,
 * the rooms and the wall on a channel: whoever just joined has never decrypted
 * anything said there, by forward secrecy, and to them the channel has no owner,
 * no rooms, and people have no names.
 *
 * We used to answer by TOTAL leaf count alone, and an equal total read as "no
 * one joined". It is not the same: a departure and an arrival that fall in the
 * same commit, or a device removed at the same time someone joins, leave the
 * tree with the same leaf count, and whoever joined saw the first part of the
 * address instead of the name forever, because `publishedProfileAt` marks the
 * profile as published on this channel and `publishProfile` without `force`
 * skips it.
 *
 * Answers yes to either: an address not in the set, or one more leaf. The
 * second condition stays on purpose, though the set alone fixes the reported
 * bug, a new leaf from a member already here is a new device of theirs, and a
 * paired device from long ago can carry a vault without our profile in it.
 * Keeping it costs no republishing that would not happen anyway.
 *
 * With no history answers yes, and that is the right way to be wrong: whoever
 * joined gets a name, instead of everyone getting none. This happens at the
 * first epoch after the app opens, because this is not stored in the vault.
 *
 * Exported to be testable without a full session, like `surdezConfirmada`.
 */
/**
 * Whether our leaf left this group by a commit from someone else.
 *
 * ts-mls marks it in `groupActiveState` when it processes a commit that removes
 * the leaf of whoever is processing it (`selfRemoved`). See `#fomosRemovidos`.
 */
/** A slot to request, with request spacing. See `lugaresPorPedir` in the vault. */
export type LugarPorPedir = { desde: number; tentativas: number; proxima: number }

/** How long to keep requesting a lost slot. The server's retention. */
const LUGAR_POR_PEDIR_MS = 30 * 24 * 60 * 60_000

/** The `seq` to store in a record, only when it is from the server (our send has -1). */
/**
 * A timer that does not keep the process alive (Node). In the browser, a
 * number, and nothing to do.
 */
function soltar<T>(relogio: T): T {
  ;(relogio as { unref?: () => void }).unref?.()
  return relogio
}

function comSeq(seq: number): { seq?: number } {
  return seq >= 0 ? { seq } : {}
}

export function resumoDoLivro(bytes: Uint8Array): string {
  return toBase64(sha256(bytes))
}

/** How long a pending bookmark mark waits for the echo. The server's retention. */
const LIVRO_POR_CONFIRMAR_MS = 30 * 24 * 60 * 60_000

/** The cap of `friends.shown` in the protocol, repeated here to reject before encryption. */
const MAX_AMIGOS_MOSTRADOS = 500

/**
 * How far ahead a read mark can go of this device's clock.
 *
 * The interface marks with the `sentAt` of the last message, which is the clock
 * of who sent it. A clock one year fast put the mark next year: since marks
 * only go up, the channel looked read until then, on this device and all its
 * siblings. One day covers any timezone and clocks set wrong, and cuts the rest.
 */
const MARCA_DE_LIDO_FUTURO_MS = 24 * 60 * 60_000

function limitarMarcaDeLido(at: number, agora = Date.now()): number {
  return Math.min(Math.floor(at), agora + MARCA_DE_LIDO_FUTURO_MS)
}

/** The same limit, for marks arriving from a sibling device. */
function limitarMarcasDeLido(lidas: Readonly<Record<string, number>>): Record<string, number> {
  const agora = Date.now()
  const saida: Record<string, number> = {}
  for (const [channel, at] of Object.entries(lidas)) saida[channel] = limitarMarcaDeLido(at, agora)
  return saida
}

export function estaRemovido(group: GroupSession): boolean {
  return group.state.groupActiveState.kind === "removedFromGroup"
}

export function chegouAlguemNovo(antes: MembrosVistos | undefined, agora: readonly string[]): boolean {
  if (antes === undefined) return true
  if (agora.length > antes.folhas) return true
  return agora.some((quem) => !antes.enderecos.has(quem))
}

/**
 * Is this frame before our slot in the channel?
 *
 * The distinction missing from the deafness count, and in the data since always:
 * the frame declares the epoch it was encrypted in, and we know which we are in.
 *
 * - **Epoch before ours**: it was said before we had a slot. Forward secrecy
 *   guarantees it will not open today or tomorrow. Not a symptom of anything,  *   it is what any used channel has behind it.
 * - **Epoch equal or later**: either it is our echo and momentary junk, or the
 *   channel went on without us. The second is real deafness, and that is what
 *   the count is for.
 *
 * No epoch declared (junk that does not even have a header) answers no: unknown,
 * and clearing by ignorance would silence precisely the case where a hostile
 * relay dumps unreadable frames.
 *
 * Exported to be testable without a full session, like `surdezConfirmada`.
 */
export function anteriorAoNossoLugar(resultado: { session: GroupSession; epochDoFrame?: bigint | undefined }): boolean {
  return resultado.epochDoFrame !== undefined && resultado.epochDoFrame < epochOf(resultado.session)
}

/**
 * The list of pinned messages a `channel.meta` brings, or nothing.
 *
 * **The distinction between `undefined` and `[]` is everything**, and that is
 * why this function exists instead of direct field access. `undefined` means
 * "this record says nothing about pins", what an old client always publishes,
 * and what any rename publishes, and `[]` means "no pins exist", which is how
 * you unpin the last one. Reading the two as the same would unpin everything
 * the first time the sidebar refreshed.
 *
 * Narrowed field by field, and not trusted: the vault stores payloads raw on
 * purpose, and a vault written by a newer version must open here. A malformed
 * entry discards itself, never brings the list, never brings the room.
 *
 * Exported to be testable without a full session, like `surdezConfirmada`.
 */
/**
 * The permission overrides stored in a `channel.meta` or `channel.category`
 * (1.2). Absent or malformed is `undefined`: "none known", which is different
 * from "none exist" (empty list).
 */
export function sobreposicoesDe(payload: unknown): Sobreposicao[] | undefined {
  const bruto = (payload as { perms?: unknown } | undefined)?.perms
  if (bruto === undefined) return undefined
  const lido = Sobreposicao.array().max(16).safeParse(bruto)
  return lido.success ? lido.data : undefined
}

export function fixadasDe(payload: unknown): PinnedMessage[] | undefined {
  const bruto = (payload as { pinned?: unknown } | null | undefined)?.pinned
  if (!Array.isArray(bruto)) return undefined
  const fixadas: PinnedMessage[] = []
  for (const entrada of bruto) {
    const lida = PinnedMessage.safeParse(entrada)
    if (lida.success) fixadas.push(lida.data)
  }
  return fixadas.slice(0, MAX_PINNED)
}

/** Images and link cards attached to a post. Both travel inside the ciphertext. */
export interface PostExtras {
  media?: Attachment[]
  links?: LinkCard[]
  /** The title the publisher gave the post. See `post.title` in the protocol. */
  title?: string
  /**
   * The poll this post is, if it is one.
   *
   * The caption goes the same way and carries the question and options in full,
   * for anyone who cannot draw the card to read them as text. See `Poll` in the
   * protocol.
   */
  poll?: Poll
}

export interface InvitePolicy {
  /** Seconds from now. Omit for a code that never expires on its own. */
  expiresInSeconds?: number
  /** Omit for unlimited. */
  maxUses?: number
}

export interface StoredInvite {
  codeHash: string
  expiresAt: number | null
  maxUses: number | null
  uses: number
}

/** The one path an https invite may have. Everything that identifies anything sits after the `#`. */
export const INVITE_PATH = "/app/convite"

/**
 * Loopback development is the only place plain `ws`/`http` is allowed. One rule,
 * shared by the gateway URL and by invite links, so the two can never disagree
 * about what counts as local.
 */
function isLoopbackHost(host: string): boolean {
  return /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)
}

/**
 * Store the list of friends an author shows, if it is theirs most recent.
 *
 * By the author's own `updatedAt`, like the profile (`upsertDirectory`): only
 * they write this list, so their clock is the only one that orders it. Tie goes
 * to whoever arrived later, which is a resend of the same act.
 */
export function guardarListaMostrada(
  contents: VaultContents,
  lista: { author: string; shown: string[]; updatedAt: number },
): void {
  const actual = contents.shownFriends?.[lista.author]
  if (actual && actual.updatedAt > lista.updatedAt) return
  contents.shownFriends = {
    ...contents.shownFriends,
    [lista.author]: { shown: [...new Set(lista.shown)], updatedAt: lista.updatedAt },
  }
}

/**
 * Build `https://<server>/app/convite#<channel>/<code>`.
 *
 * Channel AND code sit in the fragment on purpose: fragments are never sent to
 * a server in an HTTP request and are not written to access logs, so opening
 * the link cannot leak the secret, nor even which channel it is for, to
 * whoever runs that host, to a proxy, or to a link previewer. The path is a
 * constant. Nothing secret may ever move to the path or to a query string.
 */
export function formatInviteLink(server: string, channel: string, code: string): string {
  const scheme = isLoopbackHost(server) ? "http" : "https"
  return `${scheme}://${server}${INVITE_PATH}#${encodeURIComponent(channel)}/${code}`
}

/**
 * Parse an invite link, in either of its two forms:
 *
 *   https://<server>/app/convite#<channel>/<code>     what is minted today
 *   enclave://join/<server>/<channel>#<code>          what was minted before,
 *                                                     accepted forever
 *
 * Both give the same `{server, channel, code}`. The https form is strict: any
 * other path, any query string, userinfo, a fragment that is not exactly
 * `<channel>/<code>`, or plain http to a host that is not loopback, is refused.
 * A link carrying the code anywhere but the fragment is not a lenient variant
 * of ours, it is a link that already leaked its secret, and accepting it would
 * teach people that such links work.
 */
export function parseInviteLink(link: string): { server: string; channel: string; code: string } | null {
  // A link pasted out of a chat arrives with spaces and line breaks around it.
  const text = link.trim()
  if (text.length > MAX_INVITE_LINK) return null

  const legacy = /^enclave:\/\/join\/([^/]+)\/([^#]+)#(.+)$/.exec(text)
  if (legacy) {
    const [, rawHost, channel, code] = legacy
    const server = hostOf(rawHost)
    if (!server || !channel || !code) return null
    const decoded = decodeChannel(channel)
    return decoded ? { server, channel: decoded, code } : null
  }

  const web = /^(https?):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?#(.*)$/i.exec(text)
  if (!web) return null
  const [, scheme, rawHost, path, query, fragment] = web
  const server = hostOf(rawHost)
  if (!scheme || !server || fragment === undefined) return null
  if (scheme.toLowerCase() === "http" && !isLoopbackHost(server)) return null
  if (path !== INVITE_PATH) return null
  if (query !== undefined) return null

  // An encoded channel has no `/` in it (it becomes %2F) and a code is
  // base64url, so exactly one separator is the only honest shape.
  const parts = fragment.split("/")
  if (parts.length !== 2) return null
  const [channel, code] = parts
  if (!channel || !code) return null
  const decoded = decodeChannel(channel)
  return decoded ? { server, channel: decoded, code } : null
}

/**
 * The short invite link (1.0 "Arca", slice 5b-2):
 *
 *   https://<server>/c#<short code>.<invite code>
 *
 * Two parts, both in the fragment. The first (8 characters, the short code the
 * server gave in `invite.created`) is what you send in `invite.resolve`: the
 * server returns the channel and the `codeHash` of the invite. The second
 * (16 characters, the invite code) NEVER leaves this device: it produces the
 * redemption proof (`prova-do-convite.ts`), and from it the app verifies the
 * server answered with the right invite. Eight characters alone (about 40 bits)
 * is not enough secrecy against someone with the database; 80 bits of the code
 * is enough, and it stays twenty-five characters instead of sixty-some of the
 * long link.
 *
 * Copy `/c#…`; Caddy redirects `/c` to `/app/c`, and the fragment survives the
 * redirect without hitting the server (slice 5b-1). That is why reading accepts
 * both paths.
 */
export const SHORT_INVITE_PATH = "/app/c"
/** The path you copy. See `SHORT_INVITE_PATH`. */
const SHORT_INVITE_COPY_PATH = "/c"

/**
 * The alphabet of the invite code: Crockford base32, lowercase.
 *
 * Thirty-two symbols, so 10 bytes make exactly 16 characters (80 bits), no bias
 * and no padding. It has no `i`, `l`, `o` or `u`: someone copying by hand will
 * not swap an `l` for a `1`. It has `0` and `1`, which the short code alphabet
 * (31 symbols) does not: there eight characters were the whole secret; here
 * exact bit size mattered more.
 */
const ALFABETO_DO_CODIGO_DO_CONVITE = "0123456789abcdefghjkmnpqrstvwxyz"
/** How many characters an invite code from 1.0 has. */
export const CODIGO_DO_CONVITE_CARACTERES = 16
const BYTES_DO_CODIGO_DO_CONVITE = 10
const FORMA_DO_CODIGO_DO_CONVITE = new RegExp(`^[${ALFABETO_DO_CODIGO_DO_CONVITE}]{${CODIGO_DO_CONVITE_CARACTERES}}$`)

/** True only for an invite code from 1.0, already lowercase. */
export function eCodigoDoConvite(texto: string): boolean {
  return FORMA_DO_CODIGO_DO_CONVITE.test(texto)
}

/**
 * A new invite code: 10 bytes from the system generator, in base32.
 *
 * Invites before 1.0 had 24 bytes in base64url (32 characters). Those still
 * work through the long link: the server only sees the hash and the public key
 * of the proof, and neither depends on the code's form.
 */
export function novoCodigoDoConvite(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(BYTES_DO_CODIGO_DO_CONVITE))
  let codigo = ""
  // 80 bits, read from 5 em 5 do highest to lowest.
  let acumulado = 0
  let bits = 0
  for (const byte of bytes) {
    acumulado = (acumulado << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      codigo += ALFABETO_DO_CODIGO_DO_CONVITE[(acumulado >> bits) & 31]
    }
    acumulado &= (1 << bits) - 1
  }
  bytes.fill(0)
  return codigo
}

/** Write `https://<servidor>/c#<código curto>.<código>`. See `SHORT_INVITE_PATH`. */
export function formatShortInviteLink(server: string, codigoCurto: string, code: string): string {
  const scheme = isLoopbackHost(server) ? "http" : "https"
  return `${scheme}://${server}${SHORT_INVITE_COPY_PATH}#${codigoCurto}.${code}`
}

/**
 * Read a short invite link, or `null`.
 *
 * Same rigor as `parseInviteLink`: `http` only on loopback, no query, no
 * userinfo, only the two paths, and a fragment that is EXACTLY the two parts.
 * Letters become lowercase, because both alphabets are lowercase only and
 * someone typing the link by hand may not have lowercase. Nothing else fixes:
 * an `l` instead of a `1` does not guess itself.
 */
export function parseShortInviteLink(link: string): { server: string; codigoCurto: string; code: string } | null {
  const text = link.trim()
  if (text.length > MAX_INVITE_LINK) return null
  const web = /^(https?):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?#(.*)$/i.exec(text)
  if (!web) return null
  const [, scheme, rawHost, path, query, fragment] = web
  const server = hostOf(rawHost)
  if (!scheme || !server || fragment === undefined) return null
  if (scheme.toLowerCase() === "http" && !isLoopbackHost(server)) return null
  if (path !== SHORT_INVITE_PATH && path !== SHORT_INVITE_COPY_PATH) return null
  if (query !== undefined) return null

  const partes = fragment.toLowerCase().split(".")
  if (partes.length !== 2) return null
  const [codigoCurto, code] = partes
  if (!codigoCurto || !code || !eCodigoCurto(codigoCurto) || !eCodigoDoConvite(code)) return null
  return { server, codigoCurto, code }
}

/** The one path an https pairing link may have. The secret sits after the `#`, and nowhere else. */
export const PAIR_PATH = "/app/emparelhar"

/**
 * Build `https://<server>/app/emparelhar#<segredo>`.
 *
 * The same rule as `formatInviteLink`, for the same reason and with more at
 * stake: whoever holds this secret can join the box and, if the person then
 * confirms the wrong words, be certified as a device of the account. It is a
 * fragment so that opening the link sends nothing to the host, a proxy or a
 * previewer. Nothing secret may ever move to the path or to a query string;
 * `convite.test.ts` walks the repository to make sure nothing does.
 */
export function formatPairLink(server: string, segredo: Uint8Array): string {
  const scheme = isLoopbackHost(server) ? "http" : "https"
  return `${scheme}://${server}${PAIR_PATH}#${toBase64(segredo)}`
}

/**
 * Parse a pairing link, in either of its two forms:
 *
 *   https://<server>/app/emparelhar#<segredo>     what is shown today
 *   enclave://pair/<server>#<segredo>             the August plan's form,
 *                                                 accepted as well
 *
 * Strict like `parseInviteLink`: any other path, a query string, userinfo,
 * plain http off loopback, or a fragment that is not exactly 32 bytes of
 * base64url is refused. A link with the secret anywhere but the fragment is
 * not lenient, it is leaked.
 */
export function parsePairLink(link: string): { server: string; segredo: Uint8Array } | null {
  const text = link.trim()
  if (text.length > MAX_INVITE_LINK) return null

  const legacy = /^enclave:\/\/pair\/([^/#?]+)#(.+)$/.exec(text)
  if (legacy) {
    const [, rawHost, fragment] = legacy
    const server = hostOf(rawHost)
    const segredo = segredoDe(fragment)
    return server && segredo ? { server, segredo } : null
  }

  const web = /^(https?):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?#(.*)$/i.exec(text)
  if (!web) return null
  const [, scheme, rawHost, path, query, fragment] = web
  const server = hostOf(rawHost)
  if (!scheme || !server || fragment === undefined) return null
  if (scheme.toLowerCase() === "http" && !isLoopbackHost(server)) return null
  if (path !== PAIR_PATH) return null
  if (query !== undefined) return null
  const segredo = segredoDe(fragment)
  return segredo ? { server, segredo } : null
}

/**
 * The only path of a friend link. The address goes after the `#`.
 *
 * No secret here: an address is meant to share. It goes in the fragment for the
 * other reason fragments are for, and the one that counts here: the fragment
 * does not reach the server, so opening the link does not tell it who you are
 * looking for. A friend link in the path or query was a piece of the social
 * graph in the access log, which is exactly what this design refuses to keep.
 */
export const FRIEND_PATH = "/app/amigo"

/**
 * `https://<servidor>/app/amigo#@<id>:<servidor>`.
 *
 * The `@` and `:` are left unescaped on purpose: they are legal in a fragment
 * (RFC 3986, `pchar`), and a link you can read is a link a person will check
 * before sending it. Everything else escapes, which prevents a malformed
 * address from breaking the link.
 */
export function friendLink(server: string, address: string): string {
  const scheme = isLoopbackHost(server) ? "http" : "https"
  const fragmento = encodeURIComponent(address).replace(/%40/g, "@").replace(/%3A/gi, ":")
  return `${scheme}://${server}${FRIEND_PATH}#${fragmento}`
}

/**
 * Read a friend link, with the same rigor as `parseInviteLink`: only this path,
 * no query, no userinfo, no `http` outside loopback, and a fragment that is an
 * account address and nothing else.
 *
 * Returns the server of the LINK and the address: they need not be the same (an
 * account on another server can be shared from here), and whoever decides what
 * to do with that is whoever calls.
 */
export function parseFriendLink(link: string): { server: string; address: string } | null {
  const text = link.trim()
  if (text.length > MAX_INVITE_LINK) return null
  const web = /^(https?):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?#(.*)$/i.exec(text)
  if (!web) return null
  const [, scheme, rawHost, path, query, fragment] = web
  const server = hostOf(rawHost)
  if (!scheme || !server || fragment === undefined) return null
  if (scheme.toLowerCase() === "http" && !isLoopbackHost(server)) return null
  if (path !== FRIEND_PATH) return null
  if (query !== undefined) return null
  const address = decodeChannel(fragment)
  if (!address || !/^@[^\s:@/#?]+:[^\s@/#?]+$/.test(address)) return null
  try {
    const parsed = parseAddress(address)
    if (parsed.sigil !== "@") return null
  } catch {
    return null
  }
  return { server, address }
}

/** Exactly 32 bytes of base64url (43 chars, no padding), or nothing. */
function segredoDe(fragment: string | undefined): Uint8Array | null {
  if (!fragment || !/^[A-Za-z0-9_-]{43}$/.test(fragment)) return null
  const bytes = fromBase64(fragment)
  return bytes.length === PAIR_SECRET_BYTES ? bytes : null
}

/**
 * The ceiling on a link's length, checked before any regular expression sees it.
 *
 * The longest link the product itself produces is a private conversation on a
 * server with a DNS name of the maximum 253 characters:
 *
 *   `https://` 8 + host 253 + `/app/convite#` 13
 *   + `!dm-<a>.<b>:<host>` encoded: 4 + 35 + 1 + 35 + 1 + 253, plus 4 for the
 *     two escapes (`!` and `:`) = 333
 *   + `/` 1 + code 32                                                  = 640
 *
 * A named channel (`!<slug>:<host>`) is shorter than that unless the name runs
 * past 70 characters, and the slug has no cap of its own, so the ceiling is set
 * at 2048: three times the structural worst case, room for a channel name of
 * some 1400 characters, and what a link can be before chat apps start cutting
 * it anyway. What it refuses is the 200 000-character link built to make the
 * dialog that shows it, or the expressions below, do work for an attacker.
 */
const MAX_INVITE_LINK = 2048

/**
 * A host as it may appear in a link, lowercased, or null.
 *
 * One rule for both forms. Letters, digits, dots and hyphens (or a bracketed
 * IPv6 literal), with an optional port, and nothing else: no `@`, so the host
 * that is read is the host that would be opened; no `%`, no spaces and no
 * control or direction marks, so the name shown to a person in the confirmation
 * is the name and not a drawing of another one.
 */
function hostOf(raw: string | undefined): string | null {
  if (!raw || !/^(\[[0-9a-f:]+\]|[a-z0-9.-]+)(:\d{1,5})?$/i.test(raw)) return null
  return raw.toLowerCase()
}

/** `decodeURIComponent` throws on a malformed escape; a bad link is just not a link. */
function decodeChannel(encoded: string): string | null {
  try {
    return decodeURIComponent(encoded) || null
  } catch {
    return null
  }
}

/**
 * Whether two homeserver names are the same host. Case does not matter in a
 * hostname; the port does, because two ports are two servers.
 *
 * Two spellings of one server are folded before comparing: the trailing dot of
 * a fully qualified name (`orwell.pt.`), and `:443`, which is the port every
 * non-loopback homeserver is already reached on (`wss`, `https`). Loopback
 * ports are left exactly as written: there, the port IS the server.
 */
export function sameHomeserver(a: string, b: string): boolean {
  return canonicalHomeserver(a) === canonicalHomeserver(b)
}

function canonicalHomeserver(name: string): string {
  const lower = name.trim().toLowerCase()
  const match = /^(.*?)(?::(\d+))?$/.exec(lower)
  const host = (match?.[1] ?? lower).replace(/\.$/, "")
  const port = match?.[2]
  if (port === undefined) return host
  if (port === "443" && !isLoopbackHost(host)) return host
  return `${host}:${port}`
}

/**
 * Where a status belongs, decided at the source.
 *
 * A toast is an INTERRUPTION, and interrupting is only justified by something
 * the person just asked for or an error they can act on. Everything else —
 * restores, epochs, automatic entries into channels, silent repairs — is
 * mechanics, and mechanics belong in the diagnostic log, not in front of
 * somebody's eyes. Absent (older hosts) the interface falls back to severity.
 */
export type StatusRoute = "toast" | "notice" | "log"

/**
 * The largest sealed payload this client will hand to a server.
 *
 * The gateway measures the whole frame and refuses an oversized one *fatally*,
 * closing the connection. Discovering that after the message is persisted and
 * on screen is the worst possible order: the person sees a sent message that
 * no one will ever receive. Checked before anything is written, so an image
 * that will not fit fails as a plain, honest error at the composer instead.
 * Kept below the gateway's own ceiling, leaving room for the JSON around it.
 */
export const MAX_SEALED_BYTES = 11 * 1024 * 1024

/** A stable, machine-readable name for a status, for coalescing and the log. */
export type StatusCode =
  /** An admin removed the channel (`space.removed`). The `detail` carries the name after the key. */
  | "channel-deleted"
  /** The vault identity is before the server's account cutoff. */
  | "identity-obsolete"
  /** The server does not know our slot on this channel. See `channel.rejected`. */
  | "channel-orphaned"
  | "handshake-failed"
  | "channels-unreadable"
  | "channel-forked"
  /** Phase 1g: someone who missed the live stream premiere did not receive the Welcome in time and created the group. */
  | "directa-sem-estreia"
  | "catchup-failed"
  | "event-failed"
  | "keypackages-failed"
  | "invite-sent"
  | "invite-not-mine"
  | "invite-rejected"
  | "member-joined"
  | "channel-deaf"
  | "channel-joined"
  | "channel-readopted"
  | "channel-removed"
  | "welcome-dead"
  /** Phase 1 of 1.1: the snapshot of the Welcome applied (with the count of what joined and what declined), unreadable or failed. Logging only. */
  | "retrato-aplicado"
  | "retrato-ilegivel"
  | "retrato-falhou"
  | "server-error"
  /** A vault recording failed. See `#falhaAoGravar`. */
  | "persist-failed"
  /** A frame ahead of our epoch: missing a commit. See `BuracoDeEpoca`. */
  | "epoch-gap"
  /** An epoch gap that turned out to be garbage: the channel stayed on our branch after it. */
  | "epoch-garbage"
  /**
   * An event that the anchor passed WITHOUT BEING ABLE TO READ, with us having a place in the channel.
   *
   * The missing name. This was a silent discard, and it lasted months because it was silent.
   * Brings the channel, `seq` and the connection count, and DOES NOT enter the deafness counter. See `#anotarLacuna`.
   */
  | "epoca-saltada"
  /**
   * The gate hit the cap and the held batch was discarded. See `#reterAoVivo`.
   *
   * Not a loss: the anchor never ran over a held frame, so the recovery that follows
   * asks the server for it again and reads it in order. It is in the log for the day
   * someone asks why a busy channel requested the same page twice.
   */
  | "portao-no-tecto"
  /** The server rejected our commit because the epoch has already passed. See `#commitar`. */
  | "commit-rejected"
  /** Our commit got no verdict within the timeout. See `#publicarCommit`. */
  | "commit-unconfirmed"
  /** The server rejected our sends for rate limiting; the sends wait and retry. See `#aoRecusaPorRitmo`. */
  | "send-rate-limited"
  /** The server rejected one of our cards because it is from an epoch that has already passed. */
  | "groupinfo-rejected"
  /** A card entry brought the old leaf of this device. See `joinChannelExternally`. */
  | "rejoin-resync"
  /** Adding or removing someone's place failed, on a path with no one waiting. */
  | "reseat-failed"
  /** The server requires a guarantee that this connection did not advertise. Never on an up-to-date client. */
  | "update-required"
  /** The server served a device manifest that does not close. See `deviceManifestOf`. */
  | "manifest-invalid"
  /** The server served a device manifest with version below the one already seen. See `deviceManifestOf`. */
  | "manifest-rollback"
  /** An invite key that does not verify (chain, count, or outside the manifest) was discarded before the commit. See `#pacotesAdmissiveis`. */
  | "keypackage-invalid"
  /** The profile repair round did not publish to all channels, so it was NOT considered complete. See `publishProfile`. */
  | "profile-repair-pending"
  /**
   * Someone who had asked us for friendship withdrew the request (`friend.decline` with
   * `withdrawn`). Live only, with `actor` and `channel`: the cue for the UI to remove the request from the badge. Not a notification. See `#onFriendPayload`.
   */
  | "friend-withdrawn"
  /** The server rejected this device, or a `device.revoke` arrived with it: the account removed it on another device. The session disconnects. */
  | "device-revoked"
  /** A `device.revoke` that does not match the account key of who sent it. See `lerRevogacao`. */
  | "device-revoke-invalid"
  /** A link entry request from a device outside the account's manifest, or revoked. See `#admit`. */
  | "device-not-in-account"
  /** This device is not in the manifest and the account is at the limit: not adding it. See `#garantirManifesto`. */
  | "manifest-full"
  /** A group with the name of the account's channel that has leaves from another account, or from devices that account does not declare. Rejected. See `#confiarNoCanalDaConta`. */
  | "account-channel-foreign"
  /** A report arrived in a channel this account created. The channel only: nothing from who reported. See `recolherDenuncias`. */
  | "denuncia-recebida"
  /** The decision on a report this account made arrived (article 16, section 5 of the DSA). The `decision` only: not the number or the facts. See `recolherDenuncias`. */
  | "denuncia-decidida"
  /** Periodic reading of the report inbox failed. Error message only, never content. See `#armarCaixa`. */
  | "denuncia-caixa-falhou"
  /** The server suspended this account (reports, section 8). Comes with the `notice` when read. The session disconnects. */
  | "account-suspended"

export type SessionEvents = {
  message: ReceivedMessage
  epoch: { channel: string; epoch: string }
  status: {
    detail: string
    level?: "info" | "error"
    /** What happened, independent of the wording. */
    code?: StatusCode
    /** Where it belongs. Omitted means "decide by severity". */
    route?: StatusRoute
    /** The channel it concerns, when it concerns one. */
    channel?: string
    /** The person it concerns, when it concerns one. */
    actor?: string
    /** In `account-suspended` only: the suspension notice, read from the server. */
    aviso?: AvisoDeSuspensao
    /** In `denuncia-decidida` only: the decision, and nothing else. */
    decisao?: "suspensa" | "sem-accao"
  }
  connection: { state: ConnectionState; detail?: string }
  channels: { channels: string[] }
  /** Voice signalling, surfaced for the call layer to consume. */
  voice: { channel: string; from: UserAddress; payload: Payload }
  /**
   * Someone is typing. Live, and live only.
   *
   * Its own event for the same reason voice signaling has its own: this is not something
   * that was said, it is something that is happening, and passing it through `message`
   * would put it in the conversation thread and in the vault. See `#applyEvent`,
   * where it is cut before reaching either.
   *
   * `until` is the deadline the sender claims. The reader clears the indicator
   * when it passes, without waiting for an end that may never come.
   */
  typing: { channel: string; from: UserAddress; room: string; until: number }
  /**
   * A buzz. Live, and live only.
   *
   * Its own event for the same reason the typing event is: a buzz is not something
   * said. If it traveled by `message`, it would stay in the vault and shake the
   * screen again for anyone who opened the conversation the next day, once for each buzz
   * that had stayed there.
   */
  buzz: { channel: string; from: UserAddress; at: number }
  /** Someone sharing a channel with us connected or disconnected. */
  presence: { address: UserAddress; online: boolean }
  /**
   * The pairing of a device, step by step. See `emparelhar.ts`.
   *
   * One event with `phase` instead of five events, so the UI has a single place to listen
   * and the compiler forces handling each phase.
   */
  pair: PairEvento
  /**
   * Read marks changed: by `marcarLido` on this device, or by a sibling device
   * via the account channel. Carries the full map, like `lidas()`.
   */
  lidas: { lidas: Readonly<Record<string, number>> }
  /** Preferences changed, here or on a sibling device. Carries the full map, like `preferencias()`. */
  preferencias: { preferencias: Readonly<Record<string, string>> }
  /** The person's archive changed, here or on a sibling device. Carries the full map, like `arquivo()`. */
  arquivo: { arquivo: Readonly<Record<string, number>> }
  /**
   * A sibling device blocked or unblocked someone (account channel).
   *
   * Only what comes from outside: what we do here, whoever called `block` already knows.
   * The cue for the UI to reread `blocked()`.
   */
  bloqueio: { address: string; bloqueado: boolean }
  /**
   * The sync state of a channel changed (S5): snapshot arriving, repair starting or ending,
   * new comparison. Carries the state of that channel; the full list is read from `estadoDaSincronia()`.
   */
  sincronia: SincroniaDoCanal
  /**
   * The video of a publication: sending or receiving (piece by piece), ready,
   * canceled or failed. By the SHA-256 hash of the video. See `videos.ts`.
   */
  video: EventoDoVideo
  /**
   * What the SFU says without anyone asking.
   *
   * Warnings only, never responses: a response belongs to whoever made the request
   * and arrives there, matched by tag. This is the other half, the streams that appear
   * and disappear in the call because of someone else's action, that nobody asked for
   * and that everyone needs to know about.
   */
  sfu: SfuAviso
  /**
   * Friendship bonds changed: a friendship event entered the vault (live,
   * recovered, or sent by us) or the echo of our send gave it a `seq` and
   * reordered things. Returns the full list, like `friendTies()`.
   *
   * Exists so the interface stops folding friendships on its own. The fold ran
   * over the limited and unordered list of visible messages, and on a cross
   * request it read the accept before the other's request: the bell showed
   * "pending" next to the "accept" that came from here (phase 1d). One fold
   * only, from the core, in server order.
   */
  amizades: { ties: FriendTie[] }
  /**
   * The account profile changed from a peer device (phase 1e): it came via the
   * account channel and was newer. Returns the full profile, like `profile`.
   * Whoever called `updateProfile` already knows what changed here.
   */
  perfil: { profile: StoredProfile }
  /**
   * The directory gained profiles from other people via a peer device (account
   * channel): newer versions than what we had. Signals the interface to re-read
   * `directorySnapshot()`; profiles that come directly from those people arrive
   * via `message`, as always.
   */
  perfis: { enderecos: string[] }
  /**
   * An account that this one knew became another (phase 8.2, "Merge accounts"),
   * or this account replied to a succession. Returns the full map, like
   * `sucessoes()`. See `sucessao.ts`.
   */
  sucessoes: { sucessoes: Record<string, RegistoDeSucessao> }
  /**
   * History arriving from a peer device (1.0 "Arca"): the progress, and the
   * channels whose vault history changed (the interface re-reads them). See
   * `historico/historico.ts`.
   */
  historico: EventoDoHistorico
}

/**
 * A request to the SFU waiting for a response, everything except leave.
 *
 * `sfu.scope.leave` is excluded because the gateway does not respond to it, and
 * for that reason the schema does not even give it a `ref` field. Excluding it
 * here prevents the compiler from letting someone send it via `#pedirSfu` and
 * wait fifteen seconds for a response that, by design, will never come.
 */
type PedidoSfu = Exclude<Extract<ClientFrame, { t: `sfu.${string}` }>, { t: "sfu.scope.leave" }>

/**
 * The same, without the tag: the caller never chooses it.
 *
 * Conditional on `T` rather than `Omit<PedidoSfu, "ref">` directly, because an
 * `Omit` over a union flattens it, gives a single object with common fields,
 * and with that an `sfu.produce` without `transport` would compile. The
 * conditional distributes over members and each keeps its own shape.
 */
type PedidoSfuSemEtiqueta = PedidoSfu extends infer Membro
  ? Membro extends PedidoSfu
    ? Omit<Membro, "ref">
    : never
  : never

/** An alert from the SFU, of those that arrive without a request. See the `sfu` event. */
export type SfuAviso =
  | {
      t: "producer.new"
      channel: string
      scope: string
      producer: string
      kind: "audio" | "video"
      /**
       * Whose stream it is, by ADDRESS.
       *
       * The server does not read the MLS tree and will never know the leaf index;
       * the client learns who is in the call by their encrypted roster, and it
       * is the client's job to match address to leaf, which is where the
       * information exists.
       */
      address: UserAddress
      /**
       * Microphone, camera, or screen, what the producer declared.
       *
       * Absent against a server before video, and the absence is read from the
       * `kind`: it prevents a new client from not knowing what to do with a
       * stream from a server that still only forwards voice.
       */
      fonte?: FonteDeMedia
    }
  | { t: "producer.closed"; channel: string; scope: string; producer: string }

/**
 * A channel as `roomsOf` returns it.
 *
 * `afk` only appears in the channel's AFK room (at most one). See `SalaAfk`.
 */
export interface SalaListada {
  room: string
  name: string
  category: string
  kind: "text" | "voice"
  layout?: string
  position: number
  afk?: { minutos: number }
  /**
   * The timestamp the vault saved it with (3/11/2026). The interface adds what
   * arrives in memory, and only a message newer than this can cover it: without
   * this, an old republish would beat the vault. See `useRooms`.
   */
  updatedAt?: number
}

export class Session extends Emitter<SessionEvents> {
  #identity: Identity | null = null
  #socket: WebSocket | null = null
  #serverCapabilities: string[] = []
  /** How many days the server keeps events, stated in `hello.ok`; `undefined` on a server before this. */
  #serverRetentionDays: number | undefined
  /** Announce this connection to channel-mates? Set before connecting, so an
   * invisible account never flashes online for a moment on reload. */
  #visible = true
  #groups = new Map<string, GroupSession>()
  /** The first read of the reports inbox after connecting, and every hour. See `#armarCaixa`. */
  #caixaPrimeira: ReturnType<typeof setTimeout> | null = null
  #caixaRelogio: ReturnType<typeof setInterval> | null = null
  /** A read of the inbox each time. See `recolherDenuncias`. */
  #recolhaEmCurso: Promise<void> | null = null
  #keyPackages = new Map<string, StoredKeyPackage>()
  #pending = new Map<string, ((frame: ServerFrame) => void)[]>()
  /**
   * Pending SFU requests, by TAG not by type.
   *
   * The `#pending` above pairs by frame type and arrival order, and that works
   * for everything that came before: ask for something, wait for it, move on.
   * SFU signaling breaks that assumption in the first second of any call,    * `mediasoup-client` makes two transports, one for send and one for receive,
   * and both are born at the same time. Two indistinguishable `sfu.transport.created`
   * responses by shape, and matching by order gave fifty percent odds of hanging
   * the send cipher on the transport where only media comes in.
   *
   * This is the race condition the SFU switch exists to end. A separate map, not
   * a second life of `#pending`, because the key is different: there it is the
   * type, here it is the tag.
   */
  #sfuPendentes = new Map<string, { esperado: ServerFrame["t"]; resolver: (frame: ServerFrame) => void; rejeitar: (erro: Error) => void }>()
  #sfuEtiqueta = 0
  #connection: ConnectionState = "offline"
  #reconnectAttempt = 0
  #deliberateClose = false
  /**
   * Reading the current suspension notice after an `account-suspended`. The
   * `connect()` that failed because of it waits for this before rejecting: the
   * `status` arrives first, as with `device-revoked`, and the interface knows why.
   */
  #leituraDaSuspensao: Promise<void> | null = null
  /** The event where each channel's read got stuck, and how many connections ago. */
  #buracos = new Map<string, { seq: number; tentativas: number; geracao: number }>()
  /**
   * Which connection we are in.
   *
   * The retry limit counts CONNECTIONS not passes: a channel's catch-up runs
   * more than once per connection (startup, and then each `welcome` that arrives),
   * and without this all three retries would be spent without the device having
   * fetched anything new in the meantime, which is exactly what we are waiting for.
   */
  #geracaoDaLigacao = 0

  /**
   * Refs of frames we sent, so we can recognise the server's echo of them.
   *
   * We subscribe to our own channels, so everything we send comes back.
   * Re-processing our own commit fails — it was already applied locally — and
   * our own application messages are undecryptable to us by construction,
   * because encrypting consumed that generation of the sender ratchet.
   */
  #ownRefs = new Set<string>()

  /**
   * The version of the app using this core, as its `package.json` states it.
   * Goes in both `hello` messages (the session one and the pairing one): the 1.0
   * server rejects a `hello` below the minimum, or without a version, with
   * `versao-antiga` (`ENCLAVE_VERSAO_MINIMA_DO_CLIENTE`, slice 4). Whoever creates
   * the session knows it: the browser bridge reads the app's `package.json`, the
   * desktop one reads `app.getVersion()`. Absent in tests that don't talk to such
   * a server.
   */
  readonly #versaoDaApp: string | undefined

  constructor(
    private readonly vault: Vault,
    opcoes: { versaoDaApp?: string } = {},
  ) {
    super()
    this.#versaoDaApp = opcoes.versaoDaApp
  }

  get identity(): Identity {
    if (!this.#identity) throw new Error("no identity loaded")
    return this.#identity
  }

  /**
   * What this channel is, read from the vault (1.0 "Arca", slice 2). Every
   * question "is it a direct? a bulletin? the account channel?" goes through here,
   * not through the address form. Without a record in the vault, a room (slice 3:
   * the old-form gate closed). See `tipoDoCanal.ts`.
   */
  fichaDoCanal(channel: string): FichaDoCanal {
    /*
      A record for a newly created or joined channel waits for the group write
      (`#escreverGrupos`), and the `channels` event fires before it: without
      looking at the waiting one, the interface saw a room at that instant
      (and the bell said "You were added to #…" by a bulletin or a direct).
    */
    const guardada = this.vault.unlocked ? this.vault.contents.fichasDosCanais?.[channel] : undefined
    return guardada ?? this.#fichaAoNascer.get(channel) ?? this.#directaProvisoria(channel) ?? fichaNoCofre(null, channel)
  }

  /**
   * A direct that this device cannot yet prove, shown as a direct until the
   * record arrives (report from 2/11/2026: private ones in "Communities").
   *
   * Only the device with the account key deduces a direct (`#fichaDeduzida`). A
   * paired device receives the record via the account channel, when the primary
   * recognizes it. With the primary offline, the new direct was a room here, and
   * stayed that way until it came back. Someone who created the account in a
   * browser and uses the paired computer might never see it change.
   *
   * The rule, only on a device WITHOUT the account key and only without any
   * record: the group has exactly two accounts, this one and a peer, and has
   * nothing of community (no published name, no rooms, no categories, no roles),
   * nor is it a bulletin we know, the account channel or the common room. A
   * community is always born with rooms (`createSpace`, `SALAS_INICIAIS`), so a
   * two-person community does not pass through here.
   *
   * Provisional and only in memory: does not enter the vault, does not go to
   * peers (they only receive saved records), and the record the primary sends
   * goes on top. Not used on the device with the key: there a two-person group
   * that does not give the DH address is not the direct, and stays a room.
   */
  #directaProvisoria(channel: string): FichaDoCanal | null {
    const identity = this.#identity
    if (!this.vault.unlocked || identity === null || temChaveDeConta(identity)) return null
    // The common room is not either: you enter by card, and with two people it has nothing else to set it apart.
    if (channel === this.canalDaConta || channel === this.commonRoom) return null
    const grupo = this.#groups.get(channel)
    if (!grupo) return null
    const c = this.vault.contents
    const tem = (mapa: Record<string, unknown> | undefined): boolean => mapa !== undefined && Object.keys(mapa).length > 0
    if (c.spaceMeta[channel] || tem(c.channelRooms[channel]) || tem(c.channelCategories[channel])) return null
    if (tem(c.channelRoles[channel]) || tem(c.channelMemberRoles[channel])) return null
    if (this.#donoDaMoradaDeMural(channel)) return null
    const contas = new Set([...memberAddresses(grupo.state.ratchetTree).values()].map(String))
    if (contas.size !== 2 || !contas.has(identity.address)) return null
    const par = [...contas].find((conta) => conta !== identity.address)
    return par ? { tipo: "directa", par } : null
  }

  /** The provisional directs right now, in a key that compares. Empty on the device with the key. */
  #chaveDasProvisorias(): string {
    if (!this.vault.unlocked || this.#identity === null || temChaveDeConta(this.#identity)) return ""
    const fichas = this.vault.contents.fichasDosCanais ?? {}
    const partes: string[] = []
    for (const canal of this.#groups.keys()) {
      if (fichas[canal] || this.#fichaAoNascer.has(canal)) continue
      const provisoria = this.#directaProvisoria(canal)
      if (provisoria) partes.push(`${canal} ${provisoria.par}`)
    }
    return partes.sort().join("\n")
  }

  /** Just the type. See `fichaDoCanal`. */
  tipoDoCanal(channel: string): TipoDoCanal {
    return this.fichaDoCanal(channel).tipo
  }

  /**
   * The records of all channels in this vault, for the interface (which does not
   * open the vault) to save each time the list changes. A copy: whoever receives
   * it does not touch the vault.
   */
  fichasDosCanais(): Record<string, FichaDoCanal> {
    if (!this.vault.unlocked) return {}
    const fichas: Record<string, FichaDoCanal> = {}
    // The ones waiting for the write first, and the vault ones on top (the first stays).
    for (const [canal, ficha] of this.#fichaAoNascer) fichas[canal] = { ...ficha }
    for (const [canal, ficha] of Object.entries(this.vault.contents.fichasDosCanais ?? {})) fichas[canal] = { ...ficha }
    // The provisional directs of a paired device, where there is no other. See `#directaProvisoria`.
    for (const canal of this.#groups.keys()) {
      if (fichas[canal]) continue
      const provisoria = this.#directaProvisoria(canal)
      if (provisoria) fichas[canal] = provisoria
    }
    return fichas
  }

  #eDirecta(channel: string): boolean {
    return this.tipoDoCanal(channel) === "directa"
  }

  #eMural(channel: string): boolean {
    return this.tipoDoCanal(channel) === "mural"
  }

  /**
   * The record with which a channel created HERE enters the vault, until the
   * first group write (`#escreverGrupos`). Whoever creates knows what they
   * created; the form does not need to say.
   */
  #fichaAoNascer = new Map<string, FichaDoCanal>()

  get connection(): ConnectionState {
    return this.#connection
  }

  /**
   * How long a round trip to the server takes, in milliseconds.
   *
   * Measured with the `ping`/`pong` pair that the server already responds to,    * it is the only frame that does nothing else, so what is measured is the
   * network and socket queue, not anyone's work. The server returns no timestamp
   * or serial number, so the clock is all on this side: starts here and counts
   * until the response.
   *
   * **This is the distance to the SERVER, never the distance to a person.**
   * Outside a call there is no peer to measure against, channels are
   * cryptographic groups, not links, and showing server time as if it were
   * someone's would be making it up. Inside a call there is a better number,
   * and it is different: see `Call.measureLatency`.
   *
   * `null` when there is no honest answer to give: offline, or the response did
   * not arrive in time. Whoever calls this designs the absence, not a zero.
   */
  async measureLatency(timeoutMs = 5_000): Promise<number | null> {
    if (this.#connection !== "online") return null
    const partiu = performance.now()
    try {
      this.#send({ t: "ping" })
    } catch {
      return null
    }
    // `#await` pairs by arrival order, and the `pong` carries nothing that
    // identifies it: two measurements at once would swap responses between them.
    // Not a grave error, both would measure the same network, but whoever calls
    // this measures one at a time on purpose. See `useLatencia`.
    const frame = await this.#await("pong", timeoutMs).catch(() => null)
    if (!frame || frame.t !== "pong") return null
    return Math.round(performance.now() - partiu)
  }

  /**
   * The channels of this account, for the interface.
   *
   * Without the account channel: that is not a conversation, it is the pipeline
   * between the person's devices, and showing it in the list was putting a
   * channel there where nothing can be read. Whoever needs it inside the core
   * goes to `#groups`.
   */
  get channels(): string[] {
    const proprio = this.#identity !== null ? this.canalDaConta : null
    return [...this.#groups.keys()].filter((channel) => channel !== proprio)
  }

  /**
   * The channels we were removed from and whose history stayed on this device (N2).
   *
   * Outside `channels`, because they have no group: nothing is read or written
   * in them. They stay here so the interface can show them as archive, and for
   * the person to decide to delete them (`forgetChannel`), which is the only
   * act that deletes history.
   */
  archivedChannels(): { channel: string; archivedAt: number }[] {
    if (!this.vault.unlocked) return []
    return Object.entries(this.vault.contents.canaisArquivados ?? {})
      .filter(([channel]) => !this.#groups.has(channel))
      .map(([channel, archivedAt]) => ({ channel, archivedAt }))
      .sort((a, b) => b.archivedAt - a.archivedAt)
  }

  get profile(): StoredProfile {
    return this.vault.contents.profile
  }

  // -------------------------------------------------------------- identity

  /**
   * Create an account.
   *
   * There is no registration request. The keypair is generated locally and the
   * homeserver learns of it the first time we connect, which means creating an
   * identity is invisible to everyone — including the server.
   */
  async createIdentity(homeserver: string): Promise<Identity> {
    const identity = generateIdentity(parseServerName(homeserver))
    await this.vault.update((contents) => {
      contents.signingPrivateKey = toBase64(identity.signingPrivateKey)
      // The account is born with both keys: the one that IS the account and this
      // device's. Today both stay in the same vault, and that is why none of this shows.
      contents.deviceSigningPrivateKey = toBase64(identity.deviceSigningPrivateKey)
      contents.homeserver = homeserver
      // Birth date of the identity, so the server can declare a cut and everything
      // before it becomes stale on its own. See `#reconcileAccountsReset`.
      contents.identityCreatedAtMinute = Math.floor(Date.now() / 60_000)
    })
    this.#identity = identity
    return identity
  }

  loadIdentity(): Identity {
    const { signingPrivateKey, homeserver, accountPublicKey, deviceCert } = this.vault.contents
    if (!signingPrivateKey) {
      /**
       * The second form of vault: one for a PAIRED device.
       *
       * It does not have the account key, and never will: it has the public one,
       * the certificate the account signed over this device's key, and this
       * device's key. `identityFromDeviceCert` rejects the chain that does not
       * close, and it is here, on opening, that you want the rejection: a vault
       * like this that does not open is one that should never have been written.
       */
      const stored = this.vault.contents.deviceSigningPrivateKey
      if (!accountPublicKey || !deviceCert || !stored) throw new Error("vault holds no identity")
      const accountKey = fromBase64(accountPublicKey)
      this.#identity = identityFromDeviceCert({
        address: makeUserAddress(accountIdFromSigningKey(accountKey), parseServerName(homeserver)),
        accountKey,
        deviceSigningPrivateKey: fromBase64(stored),
        signature: fromBase64(deviceCert),
      })
      return this.#identity
    }
    // The device key belongs to this vault and must survive a restart: already-
    // published MLS leaves are signed by it, and minting a new one each startup
    // would make the account present itself as a different device every time. A
    // vault without it gets one, it is the same path as account creation, not
    // a migration.
    const stored = this.vault.contents.deviceSigningPrivateKey
    this.#identity = identityFromPrivateKey(
      fromBase64(signingPrivateKey),
      parseServerName(homeserver),
      stored ? fromBase64(stored) : undefined,
    )
    if (!stored) {
      const minted = toBase64(this.#identity.deviceSigningPrivateKey)
      void this.vault
        .update((contents) => {
          contents.deviceSigningPrivateKey = minted
        })
        .catch(() => {})
    }
    return this.#identity
  }

  /**
   * Out-of-band verification string, to be compared aloud with another member.
   *
   * Over ACCOUNT keys on both sides. See `memberAccountKey`: mixing an account
   * key with a device key would give different numbers at each end without
   * anyone in the middle.
   */
  safetyNumberWith(theirAccountKey: Uint8Array): string {
    return safetyNumber(this.identity.signingPublicKey, theirAccountKey)
  }

  /**
   * Safety number for a fellow member of a channel, or null if their key
   * cannot be read from the ratchet tree.
   *
   * The key comes from the chain in that member's leaf, the chain this client
   * already validated before admitting the leaf, so a matching number means
   * the person you compared with owns the account this device is encrypting to,
   * with no server in a position to swap the key.
   */
  safetyNumberFor(channel: string, address: string): string | null {
    const group = this.#groups.get(channel)
    if (!group) return null
    const theirKey = memberAccountKey(group, address as UserAddress)
    if (!theirKey) return null
    return this.safetyNumberWith(theirKey)
  }

  // ------------------------------------------------------------ connection

  async connect(): Promise<void> {
    const identity = this.identity
    // A stopped channel doesn't reconnect (see `pararDeEscrever`): connecting means
    // receiving frames, and receiving frames means writing to the vault.
    if (!this.#escreve) throw new Error("this tab no longer writes")
    /*
      The backoff timer dies here (phase 4 review). A "Connect now" or a
      `visibilitychange` that opens the connection would leave the old timer to
      fire later, and the connection it opened would close the good socket.
    */
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer)
      this.#reconnectTimer = undefined
    }

    /*
      Vault groups before the socket, not just after `auth.ok`.
      
      `restore()` only ran inside `#handshake`. A first socket that failed before
      authentication (WebKit does this when switching tabs), or a connection
      attempt without network, left `channels` empty, and the UI seeded an empty
      channel list. `restore()` is idempotent (what's already live in memory
      doesn't get replaced), and `#handshake` calls it again to know what to
      subscribe to.
      
      Up here, before the guard for concurrent connections: everything from here
      to `new WebSocket` is synchronous, so the newer connection stays the one
      with the socket.
      */
    try {
      const antes = this.#groups.size
      await this.restore()
      if (this.#groups.size !== antes) this.emit("channels", { channels: this.channels })
    } catch {
      // A vault that can't be read now gets retried in the handshake, which reports it.
    }

    // Two connects can race — StrictMode mounting twice, a manual retry while
    // a reconnect timer is in flight. The newer call wins: the old socket is
    // detached *before* being closed, so its close event (guarded below) is
    // recognised as stale and never schedules a competing reconnect loop.
    const stale = this.#socket
    if (stale && (stale.readyState === 0 || stale.readyState === 1)) {
      this.#socket = null
      // What was waiting for the old socket's response won't get it: say so now, and
      // don't let the new socket's response reach its hands.
      this.#failPending("the connection was replaced")
      stale.close()
    }

    this.#deliberateClose = false
    // What was already read before this connection: a profile request that recovery
    // brought from before this point already had its turn (F10).
    if (this.vault.unlocked) this.#lastSeqAntesDaLigacao = { ...this.vault.contents.lastSeq }
    this.#setConnection("connecting")

    const socket = new WebSocket(gatewayUrl(identity))
    this.#socket = socket

    try {
      await new Promise<void>((resolve, reject) => {
        const onOpen = (): void => {
          socket.removeEventListener("error", onError)
          resolve()
        }
        const onError = (): void => {
          socket.removeEventListener("open", onOpen)
          reject(new Error("could not reach the homeserver"))
        }
        socket.addEventListener("open", onOpen, { once: true })
        socket.addEventListener("error", onError, { once: true })
      })
    } catch (error) {
      /**
       * A socket that never opened fires no close event — and `close` is what
       * schedules the retry. Without this, a homeserver that is down for the
       * ten seconds around launch left the session parked in "connecting" for
       * ever: no reconnect timer, no way back short of reloading the page, and
       * an indicator that said "a ligar…" until someone gave up. The failed
       * connect is now an ordinary reconnect, like every other kind of loss.
       */
      /*
        Only if the socket is still THIS one. Two `connect()` calls in the same
        tick (the `online` and the `visibilitychange`) make the second close the
        first while CONNECTING, and a socket closed this way fires `error`: this
        branch ran for the first, wiped the second socket, and scheduled a
        reconnect that closed it too. Replaced, it stays silent: whoever replaced
        it controls the connection.
      */
      if (this.#socket !== socket) throw new Error("the connection was replaced")
      this.#socket = null
      socket.close()
      this.#setConnection("reconnecting", (error as Error).message)
      this.#scheduleReconnect()
      throw error
    }

    socket.addEventListener("message", (event) => {
      // A frame that will not parse is the relay's problem, not a reason to
      // throw inside a DOM event handler where nothing can catch it.
      let frame: ServerFrame
      try {
        frame = JSON.parse(String(event.data)) as ServerFrame
      } catch {
        return
      }
      void this.#onFrame(frame).catch((error: Error) => {
        // Handling one frame must never take the connection with it: the
        // vault write behind it can fail (quota, a lock racing the write) and
        // the socket is still perfectly good.
        this.emit("status", {
          detail: `frame ${frame.t}: ${error.message}`,
          level: "error",
          code: "event-failed",
          route: "log",
        })
      })
    })
    // A socket that was replaced by a newer connect still fires close; acting
    // on it would schedule a reconnect against a connection that is fine.
    socket.addEventListener("close", () => {
      if (this.#socket === socket) this.#onClose()
    })

    // Everything past this point can fail with the socket still open — a
    // rejected login, a timed-out handshake, a vault that will not read. If it
    // does, the connection would sit in "connecting" forever: no close event
    // fires, so nothing ever schedules a retry, and every later send throws
    // "not connected" with no explanation. Closing the socket on the way out
    // turns a silent hang into an ordinary reconnect.
    try {
      await this.#handshake(identity)
    } catch (error) {
      // A suspension: the `status`, with the warning, goes out before `connect()` rejects.
      await this.#leituraDaSuspensao
      /*
        Replaced mid-handshake: an outside `connect()` swapped this socket for
        another, `#failPending` answered this socket's waits with error, and the
        handshake fell here. It's not a connection failure, it's the new
        connection starting: saying "reconnecting" and `handshake-failed` would
        have made the banner flicker over it. It stays silent, like the branch
        before opening.
        */
      if (this.#socket !== socket) {
        socket.close()
        throw error
      }
      const detail = (error as Error).message
      this.#setConnection("reconnecting", detail)
      // A silent amber dot forever is the worst possible report. Say what
      // stage failed, so "nothing works" becomes something diagnosable.
      this.emit("status", {
        detail: detail === "the server did not answer in time"
          ? "O servidor aceitou a ligação mas não completou a autenticação. A tentar de novo…"
          : detail,
        level: "error",
        code: "handshake-failed",
        // The connection banner already says the connection is down, in
        // permanent view rather than for five seconds. This is the detail
        // behind it, for the diagnostic log.
        route: "log",
      })
      socket.close()
      throw error
    }
  }

  async #handshake(identity: Identity): Promise<void> {
    this.#send({
      t: "hello",
      version: PROTOCOL_VERSION,
      capabilities: GARANTIAS_DO_CLIENTE,
      ...(this.#versaoDaApp ? { versao: this.#versaoDaApp } : {}),
    })
    const hello = await this.#await("hello.ok")
    /*
      A wait answered with `error` (the socket was replaced and `#failPending`
      answered for it, or the server refused) is a failure, not a missing
      `hello.ok`: moving to `auth.begin` would have written to a socket that's
      no longer this one.
    */
    if (hello.t === "error") throw new Error(hello.message)
    if (hello.t === "hello.ok") {
      this.#serverCapabilities = hello.capabilities
      this.#serverRetentionDays = hello.retentionDays
      this.#commonRoom = this.#acceptCommonRoom(hello.commonRoom)
      this.#salaComumTemCartao = hello.commonRoomGroupInfo === true
      // Before proving who we are: no point authenticating an account the server no
      // longer recognizes.
      if (await this.#reconcileAccountsReset(hello.accountsResetAtMinute)) {
        throw new Error("this account is no longer valid on this server")
      }
      await this.#reconcileServerReset(hello.resetAtMinute)
    }

    // Prove possession of the key. Nothing secret crosses the wire: we sign a
    // nonce the server generated a moment ago.
    //
    // The DEVICE signs, and the chain goes along so the server can
    // close the account against the address without the account key appearing here. It is the
    // same proof as always, one link longer: `hash(accountKey) == endereço`,
    // the account signed this device, and this device signs the challenge.
    this.#send({
      t: "auth.begin",
      address: identity.address,
      signingKey: toBase64(identity.deviceSigningPublicKey),
      accountKey: toBase64(identity.signingPublicKey),
      deviceCert: toBase64(identity.credential.signature),
    })
    const challenge = await this.#await("auth.challenge")
    if (challenge.t !== "auth.challenge") throw new Error("the server refused the login")

    /*
      Device possession (`auth.finish` in the protocol). A vault freshly imported
      asks for the next generation, and the server closes the copy left on the
      device that exported it; others present the generation they have, and the
      copy left behind gets rejected as revoked.
    */
    const { posseDoAparelho, assumirPosse } = this.vault.contents
    this.#send({
      t: "auth.finish",
      signature: toBase64(signWithDevice(identity, fromBase64(challenge.nonce))),
      ...(posseDoAparelho !== undefined ? { posse: posseDoAparelho } : {}),
      ...(assumirPosse ? { assumirPosse } : {}),
    })
    const ok = await this.#await("auth.ok")
    if (ok.t !== "auth.ok") throw new Error("the server refused the login")
    // A server that doesn't know the possession doesn't answer `possession`: the
    // request stays pending for a server that does know it.
    if (ok.posse !== undefined && (ok.posse !== posseDoAparelho || assumirPosse)) {
      const geracao = ok.posse
      await this.vault.update((contents) => {
        contents.posseDoAparelho = geracao
        // Only the mark this login carried: a fresh import that wrote another one
        // meanwhile keeps asking for its own.
        if (contents.assumirPosse === assumirPosse) delete contents.assumirPosse
      })
    }

    this.#reconnectAttempt = 0
    // Before any channel.subscribe — which is what triggers the gateway's
    // presence announcement — so invisibility never flickers on reconnect.
    if (!this.#visible) this.#send({ t: "presence.set", visible: false })
    this.#setConnection("online", identity.address)

    const { restored, failed } = await this.restore()
    // A new connection restarts the account: what was left to recover in the last
    // one gets recovered again below, and only those.
    this.#recuperacoesPorFazer.clear()
    /*
      And what was held back by the dead connection gets thrown away.

      It's not a loss: the anchor never went past a held frame, so the recovery
      that starts next asks for it again from the server and reads it in order,
      which is exactly what we want. Keeping it would be worse, it would apply
      after the new recovery already read it, against a spent generation, and each
      such failure counts toward the silent limit. See `#portaoFechado`.
    */
    this.#retidasAoVivo.clear()
    this.#bytesRetidos.clear()
    /*
      And the mark of who was draining, which was the only gate map that nobody
      cleaned.

      A drain stuck on `await` when the socket died left the channel in `#aLargar`
      forever: `#portaoFechado` reads it, so the gate for that channel stayed
      closed for the rest of the session and EVERYTHING that arrived live there
      got held with nobody to release it. Its `finally` is inert in this
      connection on purpose (see the stamp in `#largarRetidas`), and that's why
      cleanup has to be here.
    */
    this.#aLargar.clear()
    // And the page count, which is per connection: the server's backfill cap is per
    // minute, and a new connection is fresh credit. See `#pedirLacunas`.
    this.#paginasGastas.clear()
    /*
      And the epoch floor restarts with the connection: where it found each
      channel.

      Read HERE, before subscribing and before recovering, which is the only
      moment when the answer is clean, from here on the epoch moves, and moving
      is precisely what causes loss. See `#epocaAoLigar`.
    */
    this.#epocaAoLigar.clear()
    for (const canal of restored) {
      const grupo = this.#groups.get(canal)
      if (grupo) this.#epocaAoLigar.set(canal, epochOf(grupo))
    }
    /*
      GENERATION ALWAYS GOES UP, and it was inside `if (restored.length > 0)`.

      In a connection where `restore()` returns zero channels, a vault with no
      groups yet, a failed read, a brand new account, the generation didn't go
      up, so ALL the `finally` blocks from the last connection came back into
      play: the two that are stamped (`#catchUpChannel`, `#comRecuperacaoPorFazer`),
      the one in `#largarRetidas`, and the stamps in `#pedirLacunas`. The stamp
      compares against a number that didn't move, so it protects nothing. Going
      up always costs one integer.
    */
    this.#geracaoDaLigacao += 1
    // Presence restarts with the connection (the server announces it again), and anti-entropy too (S4).
    this.#presentes.clear()
    this.#anti.aoLigar([...this.#groups.keys()])
    // And the history across devices: a plan midway continues here.
    this.#historico.aoLigar()
    if (restored.length > 0) {
      /*
        Recover BEFORE subscribing, and this is where M1 came in.

        Subscription opens live frames from all channels at once, and recovery
        runs one channel at a time. A live frame from the last channel arrived
        long before its turn and jumped its anchor ahead; when the turn came,
        recovery started after the missing commit and never asked for it.
        See `#ancoraPresa`.
      */
      for (const canal of restored) this.#recuperacoesPorFazer.add(canal)
      try {
        this.#send({ t: "channel.subscribe", channels: restored })
      } catch (erro) {
        // Without subscription nothing arrives live, and the next connection restarts
        // the count: the mark has nothing to hold. See `#comRecuperacaoPorFazer`.
        for (const canal of restored) this.#recuperacoesPorFazer.delete(canal)
        throw erro
      }
      this.emit("channels", { channels: this.channels })
    }


    /**
     * Ask for pending invitations here, not at the end.
     *
     * The precondition is a loaded keyring, and `restore()` above is what
     * loads it — nothing further down is required to open a welcome. Asking
     * last meant asking after catch-up, which on a loaded account is hundreds
     * of round-trips: if the connection died in the middle, this frame never
     * went out at all, and every invitation waiting on the server stayed
     * waiting for another whole cycle. Asking first costs nothing and is the
     * one frame somebody on the other side is blocked on.
     */
    this.#send({ t: "welcome.resync" })

    if (restored.length > 0) {
      /**
       * Catch-up is best-effort, and this guard is the whole point of it.
       *
       * It used to be awaited bare. One unreadable event — malformed base64
       * from a relay, a page the vault could not write because the quota was
       * full — threw out of catch-up, out of the handshake, and took the
       * connection down with it. Everything after this line never ran: no key
       * package top-up, and above all no `welcome.resync`, so every pending
       * invitation stayed undelivered. Worse, the next attempt re-fetched the
       * same event and failed the same way: a login loop with no exit, whose
       * only symptom was that nothing worked. Losing catch-up costs history
       * and, at worst, an epoch this device must ask to rejoin — never the
       * session.
       */
      try {
        await this.#comRecuperacaoPorFazer(restored, () => this.#catchUp(restored))
      } catch (error) {
        const message = (error as Error).message
      this.emit("status", {
        detail: message.includes("storage is full") ? message : `recuperação de mensagens interrompida: ${message}`,
        level: "error",
        code: "catchup-failed",
        // A full local store is the one catch-up failure a person can act on,
        // and the one that silently poisons everything downstream if it is not
        // said out loud. Everything else here is mechanics.
        route: message.includes("storage is full") ? "toast" : "log",
      })
      }
      // Recovery of what raced the last shutdown, deliberately not awaited:
      // connect() must resolve on catch-up, not on best-effort archaeology.
      // And after it, a pass of friendships (F9): what only backfill brought was
      // handled in the next connection, which might be days away.
      void this.#backfillMissed(restored)
        .then(() => {
          // Recovery ends, which triggers the summary (S4, §4.4), without waiting for the pass.
          void this.#anti
            .aoFimDaRecuperacao(restored, (canal) => (this.vault.contents.lacunas?.[canal]?.length ?? 0) > 0)
            .catch(() => {})
          return this.#sincronizar()
        })
        .catch(() => {})
      /**
       * Friendships left hanging while we were away.
       *
       * Here and not in the UI, because it's an obligation not a screen: whoever
       * accepted our request already gave us a place in their feed and is waiting
       * for ours back, and that has to happen whether someone opens Friends or
       * not. After recovery, which is what brought the acceptance into the vault;
       * and without waiting for it, like everything else that's best-effort.
       *
       * **"Recovery" here is `#catchUp`, which is awaited, and NOT the
       * `#backfillMissed` from the line above, which is not.** The difference
       * costs one cycle: a friendship event that only backfill brings gets handled
       * in the next connection. See `syncFriendships`, where what that implies is
       * written.
       */
      // Via the single pass (`#sincronizar`), which brings friendships and invites
      // together and stops two from running at once (I7): in parallel, they claimed
      // the same key package twice and gave bent leaves.
      void this.#sincronizar().catch(() => {})

      /**
       * And channel invites accepted while we were away, by the same logic.
       *
       * Whoever accepted can't join alone, only the device of whoever invited
       * makes the commit that admits them. This is that debt being paid, and it
       * gets paid whether someone opens Friends or not. See `syncChannelInvites`.
       */
      // (Invites go in the same pass, above.)

      /**
       * And the rooms of channels we administer, by the same logic.
       *
       * `republishRooms` runs when the group grows, which handles whoever joins
       * from now on, but doesn't fix who's already there. Whoever joined before
       * this existed got a channel with no rooms, and there's nothing on their
       * side that fixes it: the statements were encrypted in an epoch they'll
       * never see, and only whoever administrates can publish them again.
       *
       * Cheap and idempotent: one `channel.meta` per room, only in channels we
       * administer, and whoever already had them just rewrites what they knew.
       * Without this, the only fix was an admin remembering to tweak a room
       * somewhere to force it to republish.
       */
      /**
       * And who runs them, by the same logic taken to the gravest case.
       *
       * Missing rooms gave an empty channel; missing authority gave a channel
       * with no owner, and a channel with no owner was, until this version,
       * a channel owned by whoever joined it. Whoever joined before this
       * republish existed still doesn't know today who founded the channel they're
       * in, and nothing on their side can discover it. This is the fix for those.
       *
       * Before rooms, not after: the guards on receiving roles depend on the
       * founder already being known. See `republishAuthority`.
       */
      for (const canal of restored) {
        void this.republishAuthority(canal)
          .catch(() => {})
          .then(() => this.republishRooms(canal))
          .catch(() => {})
      }
    }
    if (failed.length > 0) {
      this.emit("status", {
        detail: `${failed.length} canal(is) com estado ilegível, ignorado(s)`,
        level: "error",
        code: "channels-unreadable",
        // Rare, real, and not something the log should swallow: part of this
        // account cannot be opened on this device.
        route: "toast",
      })
    }

    // If the vault holds no private halves, whatever the server is still
    // offering on our behalf is unanswerable — an invitation using one would be
    // consumed and then silently never join. Replace the lot.
    // Invariant: the server's pool and our private halves must not drift.
    // Empty locally means whatever it still offers is unanswerable — replace
    // the lot. Low locally means top up before someone claims the last one:
    // waiting for the server's keypackage.low nudge leaves a window where an
    // inviter gets nothing and the invitation silently never happens.
    try {
      if (this.#keyPackages.size === 0) await this.topUpKeyPackages(20, true)
      else if (this.#keyPackages.size < 10) await this.topUpKeyPackages(20)
      this.#chavesProntas = true
    } catch (error) {
      // Guarded for the same reason as catch-up: a vault that will not accept
      // a write must not be able to stop the resync below, which is what
      // delivers invitations people are waiting on.
      const message = (error as Error).message
      this.emit("status", {
        detail: message.includes("storage is full")
          ? message
          : `não foi possível repor as chaves de convite: ${message}`,
        level: "error",
        code: "keypackages-failed",
        route: message.includes("storage is full") ? "toast" : "log",
      })
    }

    /**
     * The profile, and a repair round for vaults that went silent.
     *
     * `publishProfile` skips the channel where this profile version already went
     * out, and that's right: republishing 124 KB per connection per channel was
     * nearly the whole database of a live server. But "already went out" isn't
     * "already arrived". There was a version where the inviter never republished
     * the profile, the commit is local and never comes back, so the invitee saw
     * the address in place of the name, and it stayed forever: on this side the
     * profile showed as published and nothing sent it again.
     *
     * The fix handles invites from now on. It doesn't undo the ones already made,
     * and that's what this round is for: once per device, force publishing in all
     * channels and record that it happened. Then go back to normal.
     *
     * **The round only gets recorded when publishing passed in ALL channels, and
     * it's `publishProfile` that says so.** There was a `try/catch` here waiting
     * for an exception that never comes: the two reasons this fails, `#send`
     * with no connection and the vault full refusing the write, are both inside
     * the `try/catch` PER CHANNEL of `publishProfile`, which does right to catch
     * them (a silent channel can't block the others) and so resolved as success
     * even if nothing went out. The round would record itself over zero publishes:
     * the worst of both worlds, because someone connecting with the network down,
     * or the vault full, lost the repair forever and ended up exactly in the state
     * this comes to fix. By contrast, the cost of failing is a second try on the
     * next connection.
     *
     * No `displayName` means all fail, and that doesn't complete the round either:
     * whoever still has no name has nothing to repair, and calling the round done
     * was spending it before it helped anything.
     *
     * **And the name goes in the condition itself, because "all failed" has a
     * corner case.** `publishProfile` with no name returns the list of channels
     * it got, and on a brand new account that list is EMPTY, no channels. Zero
     * failed out of zero publishes passed as success and the round recorded
     * itself on the account's first connection ever, before there was a name or
     * channel: exactly what the paragraph above says it wants to avoid, through
     * the only door the count didn't block.
     */
    const rondaFeita = this.vault.contents.profileRepairRound ?? 0
    if (rondaFeita < RONDA_DE_REPARACAO) {
      // The `try` goes on, and now only for what it could always catch: vault write
      // down here. The round is best-effort and can't block the rest of `connect`,
      // which delivers invites and friendships to whoever waits for them.
      try {
        const falhados = await this.publishProfile(undefined, true)
        if (falhados.length === 0 && this.profile.displayName) {
          this.vault.contents.profileRepairRound = RONDA_DE_REPARACAO
          await this.flush()
        } else if (this.profile.displayName) {
          /*
            Said, and not just unrecorded: a repair that didn't happen is
            something someone will want to see in the log the day someone's name
            shows as an address. Mechanics and never content, like all this log:
            how many channels, not which.

            Only with name, and the condition is not cosmetic: whoever just
            created the account still has no profile, so "all failed" is the truth
            not a failure, and one log line per connection of whoever hasn't
            named themselves is noise pointing the wrong way. `route: "log"` never
            `toast`: there's no gesture on the other end of this sentence, and the
            next connection tries again on its own.
          */
          this.emit("status", {
            detail: `perfil não publicado em ${falhados.length} canal(is): a ronda de reparação fica por cumprir`,
            level: "info",
            code: "profile-repair-pending",
            route: "log",
          })
        }
      } catch {
        // Left undone on purpose: the next connection tries again.
      }
    } else {
      await this.publishProfile()
    }

    /**
     * The manifest of devices for this account, published once in its lifetime.
     *
     * Best-effort and without waiting, like friendships and invites above:
     * nothing that follows depends on it, and today nothing reads it to admit
     * anyone. It's what puts everyone now with a manifest and no gesture for
     * the day pairing publishes v2 over it. See `#garantirManifesto`.
     */
    void this.#garantirManifesto().catch(() => {})

    /**
     * Ask to join the shared room, and only now.
     *
     * It ran fine much higher, right after restoring channels, and so before
     * key packages were published. Admitting someone uses one of theirs: whoever
     * got the request from a brand new account tried to claim one for three
     * seconds, gave up with "has no invite keys", and the exception died in an
     * empty `catch`. The request had gone out, nobody answered, and the reason
     * was the requester didn't leave them with what to answer with.
     *
     * Down here the cost is a few extra seconds to join, and in return the
     * request reaches a server that already has what to handle it. It still
     * doesn't block the rest: whoever waits for admission waits anyway, and the
     * push starts over from the top on each connection, which is the best time
     * for the request to catch someone awake.
     */
    this.#pararDeInsistir()
    void this.ensureCommonRoom().catch(() => {})

    /**
     * The seats lost, asked for again on each connection (F3), and the devices
     * missing in channels (F6). Here at the end, with invite keys already
     * published: whoever answers us has what to give us our seat.
     */
    this.#expirarLivroPorConfirmar()
    this.#pedirLugares(null)
    void this.#assentarAparelhosEmFalta().catch(() => {})
    // Account state (phase 5): the account channel, this device's announcement, and
    // what remains unsent while there is no connection.
    void this.#estadoAoLigar().catch(() => {})
    this.#rearmarSaidas()
    // A pending list (the cap on retries) tries again on each connection: recovery
    // may have brought the event that resets the counter.
    if (this.#listaPorEnviar) this.#agendarLista(Session.LISTA_MS)
    // Reconciliation now runs with a live connection, not just on connect (F9).
    this.#ultimaSincronia = Date.now()
    this.#armarSincronia()
    // And the report inbox: 5 seconds later, and hourly.
    this.#armarCaixa()
  }

  #onClose(): void {
    // Waiters belong to the socket, not to the session. Left in place they
    // outlive it: the reconnect's backoff is shorter than the ten-second
    // timeout, so a page requested by the dead connection's catch-up was
    // still queued when the new one started answering — and the new
    // connection's reply went to the old waiter, for the wrong channel. The
    // replay then broke off at `page.channel !== channel` and that channel
    // silently stopped catching up.
    this.#failPending("the connection dropped")
    // Retries (S6): a rate limit refusal only arrives on the connection that carried
    // the frame. Without this, payloads with attachments stayed in memory until the
    // cap. What got no echo is recognized in recovery by the bytes.
    this.#reenviaveis.clear()
    // And slow mode's turn: the echo it was waiting for no longer comes here. Slow
    // mode stays (the server's bucket belongs to the account, not the connection).
    this.#libertarVezes()
    // Periodic reconciliation and this connection's keys die with it.
    this.#desarmarSincronia()
    this.#desarmarCaixa()
    // And anti-entropy requests in flight (S4): responses came on this connection.
    this.#antiEntropia?.aoDesligar()
    this.#historicoDosIrmaos?.aoDesligar()
    this.#chavesProntas = false
    // And the grace of exits: grace is counted with a connection, because the
    // Welcome of a reseat arrives with a connection. It restarts at the end of the
    // next handshake.
    this.#limparSaidasPorConfirmar()

    if (this.#deliberateClose) {
      this.#setConnection("offline")
      return
    }

    this.#setConnection("reconnecting")
    this.#scheduleReconnect()
  }

  /**
   * Try again later, with capped exponential backoff and jitter.
   *
   * Without jitter a server restart brings every client back in lockstep,
   * which is its own outage — and a synchronised reconnect pattern is itself
   * identifying. Called from `#onClose` and from a connect whose socket never
   * opened, which is the case that used to have no retry at all.
   */
  #scheduleReconnect(): void {
    const attempt = Math.min(this.#reconnectAttempt++, 6)
    const delay = 500 * 2 ** attempt + Math.random() * 500

    // One timer at a time, and stored: `connect()` cancels it.
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer)
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined
      if (this.#deliberateClose) return
      /*
        The rule: RECONNECTION does not replace an open socket. If meanwhile
        someone connected and the connection is up, there is nothing to fix, and
        closing it would be the bug. A `connect()` called from outside always
        replaces (the user pressing "Connect now" asks for a fresh connection).
      */
      if (this.#socket && (this.#socket.readyState === 0 || this.#socket.readyState === 1)) return
      void this.connect().catch(() => {
        // Either `#onClose` or the pre-open guard schedules the next attempt.
      })
    }, delay)
  }

  #reconnectTimer: ReturnType<typeof setTimeout> | undefined

  /** Whether this session still writes (to the server and vault). See `pararDeEscrever`. */
  #escreve = true

  /**
   * Can this session still write? `false` after `pararDeEscrever`: the tab lost
   * vault ownership, or it has stale code. The UI reads this to disable the
   * text input; `connect()` refuses with "this tab no longer writes".
   */
  escreve(): boolean {
    return this.#escreve
  }

  /**
   * Stop writing, forever in this session: disconnects, and no `connect()` will
   * reconnect. The host seals the vault (`apps/web/src/bridge.ts`); this is
   * the client half, so refusals and prompts live in one place.
   */
  pararDeEscrever(): void {
    this.#escreve = false
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer)
      this.#reconnectTimer = undefined
    }
    this.disconnect()
  }

  #setConnection(state: ConnectionState, detail?: string): void {
    this.#connection = state
    this.emit("connection", detail === undefined ? { state } : { state, detail })
  }

  disconnect(): void {
    this.#deliberateClose = true
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer)
      this.#reconnectTimer = undefined
    }
    // The pending list does not leave when the session closes; whoever was waiting
    // for it already knows. The choice lives in the vault, and the next connection
    // handles it.
    if (this.#listaTimer) {
      clearTimeout(this.#listaTimer)
      this.#listaTimer = undefined
    }
    const esperavamPelaLista = this.#listaEspera
    this.#listaEspera = []
    for (const quem of esperavamPelaLista) quem.reject(new Error("the session ended"))
    this.#desarmarSincronia()
    this.#desarmarCaixa()
    if (this.#pedidoDePerfisNaSalaComum !== null) {
      clearTimeout(this.#pedidoDePerfisNaSalaComum)
      this.#pedidoDePerfisNaSalaComum = null
    }
    this.#antiEntropia?.aoDesligar()
    this.#historicoDosIrmaos?.aoDesligar()
    this.#pararRevezamentos()
    this.#chavesProntas = false
    // Exit grace too: restarts at the end of the next handshake (I2).
    this.#limparSaidasPorConfirmar()
    this.#pararDeInsistir()
    this.#failPending("the session ended")
    /*
      Disarm the timer BEFORE saving, and this order loses nothing: the flush
      below writes everything the timer would have written, and writes it now.
      Leaving it armed only bought a second save arriving a second and a half
      after the gate closed, against a vault that the bridge may already have
      locked or destroyed, and over work this line already handled.
      */
    this.#cancelarFlushAdiado()
    // The flush's encryption happens synchronously, so even a `lock()` on the
    // next line cannot race it; the catch is for a vault already locked.
    void this.flush().catch(() => {})
    this.#socket?.close()
    this.#socket = null
    this.#setConnection("offline")
  }

  /**
   * Drop every secret this session holds in memory.
   *
   * `vault.lock()` wipes the vault's key but the session still holds live MLS
   * group state and key-package private halves. "Bloquear" that leaves those
   * in the heap is theatre, so the bridges call this between `disconnect()`
   * and locking or destroying the vault. A later unlock rebuilds everything
   * from the vault via `restore()`.
   */
  reset(): void {
    this.#desarmarSincronia()
    this.#desarmarCaixa()
    this.#pararRevezamentos()
    this.#salasOuvidas.clear()
    this.#arrumacaoOuvida.clear()
    // And anti-entropy requests in flight (S4): responses came on this connection.
    this.#antiEntropia?.aoDesligar()
    this.#historicoDosIrmaos?.aoDesligar()
    this.#chavesProntas = false
    for (const relogio of this.#saidasPorConfirmar.values()) clearTimeout(relogio)
    this.#saidasPorConfirmar.clear()
    for (const relogio of this.#ultimosActosAgendados.values()) clearTimeout(relogio)
    this.#ultimosActosAgendados.clear()
    // Account state (phase 5): what belongs to this identity does not carry to the next.
    if (this.#lidasTimer) clearTimeout(this.#lidasTimer)
    this.#lidasTimer = undefined
    this.#lidasPorEnviar.clear()
    if (this.#canalDaContaTimer) clearTimeout(this.#canalDaContaTimer)
    this.#canalDaContaTimer = undefined
    if (this.#perfisTimer) clearTimeout(this.#perfisTimer)
    this.#perfisTimer = undefined
    this.#perfisPorAnunciar.clear()
    this.#perfisDitos.clear()
    this.#vivoNaEpoca.clear()
    this.#lugaresPedidosPorMim.clear()
    this.#convitesAoCanalDaConta.clear()
    this.#reparacaoDoCanalDaConta = 0
    this.#pararDeInsistir()
    this.#identity = null
    this.#groups.clear()
    this.#commitsPorConfirmar.clear()
    this.#commitsPorConfirmarSujos = false
    this.#keyPackages.clear()
    this.#keyPackagesDirty = false
    this.#pending.clear()
    this.#falharConfirmacoes("the session ended")
    // Media requests fail instead of disappearing: a plain `clear()` left the
    // promise of whoever is joining a call with no resolution, ever, and whoever
    // waits for it is `join`, which hung with no error and no call. The same holds
    // for the exit confirmations above: both waits are born from the same `clear()`
    // and die the same way.
    this.#falharSfuPendentes("the session ended")
    this.#ownRefs.clear()
    this.#ecos.clear()
    // Rate-limited retries (S6) belong to this account: none escapes to the next.
    // `vida` rises first, so whoever is already waiting for it wakes and stops.
    this.#vida += 1
    this.#reenviaveis.clear()
    this.#largarRepeticoes("the session ended")
    this.#libertarVezes()
    this.#ritmo = Session.#ritmoNovo()
    this.#dirty.clear()
    this.#backfilled.clear()
    // These were missing here and survived account switches: the admission gate
    // held a window opened by an old attempt, and the member count described a
    // channel of another identity.
    this.#rejoinAnswered.clear()
    this.#memberCounts.clear()
    /*
      And these four, for the same reason pushed to the costliest case this
      client knows how to run.

      **The identifier that makes this concrete is the common room's.** It is
      the same for everyone on the same server, so two accounts back-to-back on
      the same tab, lock and unlock, or bring another `.enclave` by import,
      which is where `bridge.ts` calls this, talk about the SAME channel with
      equal keys in these maps.

      - `#undecryptable` stores `{ falhas, desde }`, and `surdezConfirmada`
        needs five failures AND thirty seconds since the first. An inherited
        series arrives already with five and a `desde` from hours ago: the FIRST
        unreadable frame of the new account declares the channel deaf. After that
        comes `repairChannel`, the rejoin request, and the reseat of whoever
        answers, a remove followed by an add, meaning the channel history
        vanishes by persistent secrecy. It is the silent break that
        `session.surdez.test.ts` exists to measure, triggered by an account that
        was never sick.
      - `#rejoinAsked` is the gate on "once per channel per session": inherited,
        it silences the repair of the new account in that channel forever.
      - `#buracos` describes the event where reading stopped, by sequence number
        of ANOTHER account.
      - `#entradaExternaPorConfirmar` is the observation opened by an invite card
        entry: inherited, it makes the new account drop a good seat on the third
        contradiction that is not hers.
    */
    this.#undecryptable.clear()
    this.#rejoinAsked.clear()
    this.#buracos.clear()
    this.#buracoAnunciado.clear()
    this.#consumidasAoVivo.clear()
    // And the held frames, for the same reason: frames encrypted for the group of
    // ANOTHER account. The anchor never went over them, so recovery from the next
    // connection asks the server for them again, losing the copy in memory does
    // not lose the event. See `#portaoFechado`.
    this.#retidasAoVivo.clear()
    this.#bytesRetidos.clear()
    // And the mark of who was draining, for the reason in `connect()`: it is the
    // only gate map no one cleaned, and holding it closes the gate for the rest of
    // the session. See `#largarRetidas`.
    this.#aLargar.clear()
    this.#epocaFuturaVista.clear()
    this.#cartaoAdiado = false
    this.#recuperacoesPorFazer.clear()
    this.#recuperacoes.clear()
    this.#crescidosNaRecuperacao.clear()
    this.#entradaExternaPorConfirmar.clear()
    this.#pendingAuthority = []
    this.#pendingRooms = []
    this.#pendingCategories = []
    this.#orfaos.clear()
    this.#pendingHistory = []
    this.#pendingDirectory = []
    this.#pendingAutoriasDosPerfis = []
    this.#pendingSpaceMeta = []
    // These two were missing from the list, and are the worst to forget:
    // `#drainRecords` runs on the FIRST save of the next vault, which is already
    // the new account's. Records declared in another identity stayed written in it,
    // proof that someone transmitted on a channel this account never saw, the
    // guard that `repairInvite` depends on to decide to touch another person's tree.
    this.#pendingRoleDefs = []
    this.#pendingTransmitters = []
    // And account successions to save (phase 8.2), for the same reason: what
    // another identity received does not get saved in the next account's vault.
    this.#pendingSucessoes = []
    // And gaps to save, for the same reason as the two lines above: the
    // `#drainRecords` on the next save already runs against the new account's vault,
    // and a `seq` from another identity tells us nothing about this channel.
    this.#lacunasPorGravar = []
    // And the accounts that decide what to ask for again, for the same reason as
    // `#buracos` above: they are `canal|seq` from ANOTHER identity. Inherited, they silenced
    // gap requests from this account on channels it never saw.
    this.#lacunasPedidas.clear()
    this.#paginasGastas.clear()
    this.#saltadosNaLigacao.clear()
    // And the epoch floor: it belongs to ANOTHER identity, and the common room is
    // the same identifier for everyone on the server. See `#epocaAoLigar`.
    this.#epocaAoLigar.clear()
    this.#cancelarFlushAdiado()
  }

  /**
   * Keep a pool of unclaimed key packages on the server.
   *
   * Running out means nobody can invite us while we are offline, which pushes
   * people towards staying connected — the opposite of what this client should
   * encourage.
   */
  async topUpKeyPackages(count: number, replaceServerCopy = false): Promise<void> {
    const generated = await generateKeyPackages(this.identity, count)
    for (const item of generated) this.#keyPackages.set(toBase64(item.wire), exportKeyPackage(item))
    this.#keyPackagesDirty = true
    this.#send({
      t: "keypackage.publish",
      packages: generated.map((item) => toBase64(item.wire)),
      replace: replaceServerCopy,
      // The device signing these records, so the server can serve them per device.
      // An old server discards the field.
      device: toBase64(this.identity.deviceSigningPublicKey),
    })
    await this.flush()
  }

  // -------------------------------------------------------------- channels

  /**
   * Create the group for a channel.
   *
   * When this device already holds history or a read cursor for the channel,
   * creating it again is a FORK: same id on the server, brand-new MLS group,
   * and everybody who was in the old one goes deaf — they hold secrets for a
   * group that no longer produces the messages. It happens when group state is
   * lost (fresh browser, cleared storage, imported account) while the channel
   * lives on. It cannot be prevented from here — the group state is the only
   * thing that could have opened the old channel, and it is gone — so it is
   * announced honestly, and the circle repair re-invites the members so their
   * clients can adopt the new group.
   */
  /**
   * The ROOMS a channel is born with.
   *
   * The hierarchy, where words are exchanged: a CHANNEL is the MLS group (this,
   * `channel`), and inside it are categories that group text or voice ROOMS
   * (`room`). Only the channel has cryptographic existence.
   *
   * A channel born with one room explains nothing: an arrival sees a list of one
   * item and must guess they can create more. Three show the purpose without
   * reading anything, a place to talk, a place to talk aloud, a place for what
   * is not discussed.
   *
   * "Announcements" is a TEXT room with its own name, not a new type: only
   * `text` and `voice` exist, and inventing a third type now would invent a
   * thing no other client knows how to read. The prefix `praeconium-` is
   * reserved in `names.ts` for the day there is one.
   */
  static readonly SALAS_INICIAIS: readonly { kind: "text" | "voice"; name: string }[] = [
    { kind: "text", name: "anúncios" },
    { kind: "text", name: "conversa" },
    { kind: "voice", name: "voz" },
  ]

  /**
   * The rooms the server's COMMON channel is born with, others, and for reasons.
   *
   * "Announcements" is what stays out, and it is the choice that matters. In a
   * channel someone created, the channel owner announces and the room tells the
   * truth. The common channel has no owner in that sense: whoever founded it won
   * the arbitration, any account, the first to connect, and writing in it is
   * no one's privilege. A room called "announcements" in a place where anyone
   * publishes is exactly the forgeable seal the UI refuses to draw, just made of
   * words.
   *
   * What enters, enters by serving whoever arrives at a place where everyone
   * already is: a place to say who you are, a place to say what broke, and voice.
   * General talk already exists without creating anything, it is the default
   * room, with empty identifier, and where the person lands.
   */
  static readonly SALAS_DO_CANAL_COMUM: readonly { kind: "text" | "voice"; name: string }[] = [
    { kind: "text", name: "apresentações" },
    { kind: "text", name: "avarias" },
    { kind: "voice", name: "voz" },
  ]

  /**
   * Create a people CHANNEL: the group and the rooms it is born with.
   *
   * Separate from `createSpaceChannel` on purpose. That one creates the group
   * and nothing else, and it serves the feed and direct messages, neither wants
   * three rooms inside. Only a people channel wants them.
   *
   * The default room (with empty identifier) still exists and is first: it holds
   * what was said before rooms existed, and where messages land that arrive with
   * no room. These are born beside it.
   */
  async createSpace(
    channel: string,
    /** Which rooms are born inside. The common channel wants others, see the constant. */
    salas: readonly { kind: "text" | "voice"; name: string }[] = Session.SALAS_INICIAIS,
    /** The name the user wrote (slice 3). The address does not carry it. */
    nome?: string,
  ): Promise<void> {
    /**
     * Create the group first, but failing to create it and failing to announce
     * it are not the same thing.
     *
     * `createSpaceChannel` saves the group before touching the socket, and only
     * then subscribes and publishes the `room.created`. No net means the socket
     * breaks: the channel exists, saved, and the subscription repeats itself on
     * reconnect. Letting that error up from here was giving up on initial rooms
     * for something that fixes itself, and a channel is born once, so it would
     * stay empty forever.
     *
     * When the group never came to exist, the error rises: no group means each
     * `upsertRoom` below fails with "you are not a member", and their `catch`
     * turned a channel that was not created into silent success.
     */
    try {
      await this.createSpaceChannel(channel, nome)
    } catch (erro) {
      if (!this.#groups.has(channel)) throw erro
    }
    let posicao = 0
    for (const inicial of salas) {
      posicao += 100
      // A room that never gets published does not undo the channel, and the channel
      // is what the user asked for. Same choice as in `room.created`.
      await this.upsertRoom(channel, {
        room: newRoomId(inicial.kind),
        name: inicial.name,
        kind: inicial.kind,
        position: posicao,
      }).catch(() => {})
    }
  }

  async createSpaceChannel(channel: string, nome?: string): Promise<void> {
    /*
      Reject right away what the server will reject, by the same rule
      (`podeEstrearCanal`): only an opaque address or the common room debut
      since the 1.0 "Arca" 6a.1. Before this, a readable address (`!nome:servidor`)
      saved the group, sent the commit and only then fell into `channel-orphaned`.
      Here nothing gets saved or asked for. The channel goes in `cause`, never in the key.
    */
    if (!podeEstrearCanal(channel, this.#commonRoom)) {
      throw new Error("the server does not open this channel address", { cause: { channel } })
    }
    // A channel created here with no other note (direct, mural, account) is a room.
    if (!this.#fichaAoNascer.has(channel) && channel !== this.canalDaConta) this.#fichaAoNascer.set(channel, { tipo: "sala" })
    const knownBefore = this.#cofreConheceOCanal(channel)
    if (knownBefore) {
      this.emit("status", {
        detail: `${channel}: o estado deste canal perdeu-se e foi recriado. Quem lá estava precisa de ser convidado outra vez.`,
        level: "error",
        code: "channel-forked",
        // Rare, consequential, and it asks something of the person: the other
        // members have to be invited again. This one earns the interruption.
        route: "toast",
        channel,
      })
    }
    const nosso = await createChannel(this.identity, channel)
    await this.#persistGroup(channel, nosso)
    // And the epoch floor, which in a channel of ours is the epoch it is born in.
    // Without this, a real loss in THIS channel stayed unnamed: `#epocaAoLigar` had
    // no entry for it and the question "did I have the key to this?" answered
    // itself with silence. It is the third place of three. See `#epocaAoLigar`.
    this.#epocaAoLigar.set(channel, epochOf(nosso))
    this.#announceLocalEpoch(channel)
    await this.flush()
    this.#send({ t: "channel.subscribe", channels: [channel] })
    this.emit("channels", { channels: this.channels })

    /**
     * Record the channel founder, and record it before anything else.
     *
     * The sender is authenticated by MLS, and the first `room.created` in the channel
     * is what counts: without it the channel is born with no owner, and a channel
     * with no owner can be edited by any member. Failing here does not undo the
     * channel, whoever created it can still publish it later, so the error does
     * not propagate.
     */
    /*
      The name goes INSIDE the channel, encrypted (1.0 "Arca", slice 3): in the
      `room.created` and in the `space.meta`, which is where the UI reads the
      banner. Until 0.9 the name also went in the address (`!lagar:servidor`),
      and so it stayed in plaintext on the server disk. Anyone who joins later
      receives the `space.meta` in republication from whoever is there
      (`republishAuthority`).
      */
    const nomeLimpo = nome?.trim().slice(0, 100)
    await this.send(channel, {
      t: "room.created",
      name: nomeLimpo || (eMoradaOpaca(channel) ? "" : (channel.replace(/^!/, "").split(":")[0] ?? channel)),
      createdAt: Date.now(),
    }).catch(() => {})
    if (nomeLimpo) await this.updateSpaceMeta(channel, { name: nomeLimpo }).catch(() => {})
    await this.publishProfile([channel])
    // Other devices on this account, which a new channel does not bring (F6). No
    // wait: the claim can take seconds, and whoever created the channel already has it.
    void this.#assentarAparelhosEmFalta(channel).catch(() => {})
  }

  /**
   * Stop tracking a channel on this device. Local and honest: MLS has no way
   * for a member to remove *themselves* with effect for the others — leaving
   * for real means another member committing our removal. What this does is
   * drop everything local — group secrets, history, catch-up anchor — so the
   * channel can no longer be read here, and tell the server to stop sending
   * its events. The other members keep seeing this account in the tree until
   * somebody removes it.
   */
  async forgetChannel(channel: string): Promise<void> {
    await this.#largarGrupo(channel, true)
  }

  /**
   * Drop a channel from a group: the keys, the subscription, the per-channel state.
   *
   * `apagarHistorico` is true only when the person is asking (`forgetChannel`).
   * Being removed from a group by another's commit is not an action of ours: the
   * history stays in the vault, and the channel stays archived (`canaisArquivados`).
   * Deleting it would lose forever what the person had already received (C1 from
   * the 20/10/2026 review): a reseat removes ALL leaves from the account, and a
   * healthy device with no packets on the server would have no place and, thirty
   * seconds later, no history. The threat model says otherwise: what was already
   * received stays with whoever received it.
   */
  async #largarGrupo(channel: string, apagarHistorico: boolean): Promise<void> {
    /*
      To archive, first save what is still waiting for the flush (N4 from the
      review): messages from the last `FLUSH_MS` are in `#pendingHistory`, and
      the lines below discard them. Saving the history and losing its end would
      be saving half of it.
    */
    if (!apagarHistorico && this.vault.unlocked) await this.flush()
    this.#groups.delete(channel)
    this.#dirty.delete(channel)
    this.#backfilled.delete(channel)
    if (this.#commitsPorConfirmar.delete(channel)) this.#commitsPorConfirmarSujos = true
    this.#pendingHistory = this.#pendingHistory.filter((item) => item.channel !== channel)
    this.#lacunasPorGravar = this.#lacunasPorGravar.filter((item) => item.channel !== channel)
    this.#saltadosNaLigacao.delete(channel)
    this.#vivoNaEpoca.delete(channel)
    // The epoch floor comes with the channel: a new invite returns to the same
    // identifier, and there the slot starts elsewhere. See `#epocaAoLigar`.
    this.#epocaAoLigar.delete(channel)
    /*
      The channel's metadata sheet travels with the channel, and it's the half
that was missing.
      
      These maps are all indexed BY CHANNEL, and a channel's identifier survives
      leaving it: you come back to the same one via a new invite, and the common
      room is the same identifier for everyone on the same server, `#contarDesmentido`
forgets it and re-enters in the same gesture.
      
What was left behind:
      
        - `#undecryptable` stores `{ falhas, desde }`, and `surdezConfirmada` needs
        five failures AND thirty seconds since the first. An old series arrives
        already meeting both conditions: the FIRST frame that the new entry could
        not open, our own echo arrives, marked a channel deaf where we had just
        entered. Behind deafness comes `repairChannel`, the request to re-enter
        and the reseat of who answers, which is a remove followed by an add: the
        history just received disappeared by persistent silence.
      - `#rejoinAsked` is the brake on "once per channel per session", and on the
        flip side of the same coin: inherited, it silences real repairs forever.
      - `deafChannels()` reads `#undecryptable`, so a channel you left kept
        showing as broken.
      - `#buracos` describes the event where reading stopped, by sequence number
        from an earlier life of this channel.
      - `#orfaos` silences the "you have no place here" warning on new entry.
      - `#memberCounts` makes `#noteMembership` decide the channel did not grow,
        and it's growth that orders re-publishing authority, rooms, and the feed
        to whoever enters, without it, arrivals have no owner and no rooms.
      - `#rejoinAnswered` is the brake of sixty seconds per person, and the place
        it speaks of is no longer this one.
    */
    this.#undecryptable.delete(channel)
    this.#rejoinAsked.delete(channel)
    this.#buracos.delete(channel)
    this.#buracoAnunciado.delete(channel)
    this.#consumidasAoVivo.delete(channel)
    // And the retained ones: the group for this channel is being deleted in this
    // very function, so what was waiting for its turn no longer opens anywhere.
    this.#retidasAoVivo.delete(channel)
    this.#bytesRetidos.delete(channel)
    this.#epocaFuturaVista.delete(channel)
    this.#recuperacoesPorFazer.delete(channel)
    this.#entradaExternaPorConfirmar.delete(channel)
    this.#orfaos.delete(channel)
    this.#memberCounts.delete(channel)
    const saida = this.#saidasPorConfirmar.get(channel)
    if (saida) clearTimeout(saida)
    this.#saidasPorConfirmar.delete(channel)
    const reenvio = this.#ultimosActosAgendados.get(channel)
    if (reenvio) clearTimeout(reenvio)
    this.#ultimosActosAgendados.delete(channel)
    for (const chave of [...this.#rejoinAnswered.keys()]) {
      if (chave.startsWith(`${channel}|`)) this.#rejoinAnswered.delete(chave)
    }

    try {
      this.#send({ t: "channel.unsubscribe", channels: [channel] })
    } catch {
      // Offline. The group state is about to be erased, so any event the
      // server still queues for us will simply be undecryptable noise.
    }

    if (this.vault.unlocked) {
      await this.vault.update((contents) => {
        delete contents.groups[channel]
        if (apagarHistorico) {
          esquecerEntradas(contents, channel)
          // Nicknames (phase 3) live outside the history, and go with it.
          esquecerApelidos(contents, channel)
          // And the history that came from a sibling: a forgotten channel does not come back by it.
          if (contents.historico?.plano) delete contents.historico.plano.canais[channel]
          if (contents.historico?.trazidos) delete contents.historico.trazidos[channel]
          if (contents.historico?.lugares) delete contents.historico.lugares[channel]
          if (contents.canaisArquivados) delete contents.canaisArquivados[channel]
        } else {
          contents.canaisArquivados = { ...contents.canaisArquivados, [channel]: Date.now() }
        }
        delete contents.lastSeq[channel]
        delete contents.transmitters[channel]
        if (contents.seatSince) delete contents.seatSince[channel]
        const lugares = (contents as unknown as CofreDaSincronia).sincronia?.lugares
        if (lugares) delete lugares[channel]
        // Gaps come with the anchor they describe: without it, a `seq` saved here
        // describes an earlier life of this identifier.
        if (contents.lacunas) delete contents.lacunas[channel]
        if (contents.pendingCommits) delete contents.pendingCommits[channel]
        // Forgetting a channel is ceasing to want it: you do not ask for a place in it.
        if (contents.lugaresPorPedir) delete contents.lugaresPorPedir[channel]
      })
    }

    this.emit("channels", { channels: this.channels })
  }

  /**
   * Leave a channel for real: request the exit, then drop it.
   *
   * The difference from `forgetChannel` is all the difference between appearing
   * to have left and actually leaving. `forgetChannel` is local and honest about
   * what it says: it deletes the group from here and the leaf stays in the tree,
   * with the epoch frozen. This publishes a `member.left` inside the channel
   * first, which is the request that the client of whoever stays honors by
   * removing our leaf, and it is that commit, theirs, that advances the epoch.
   * MLS does not let anyone commit their own removal (RFC 9420 §12.2), so this
   * is the path that exists, not laziness.
   *
   * **Publish first, drop after**, as in `deleteChannel` and for the same reason
   * taken to its worst case: dropping without publishing leaves the person
   * without the channel and their leaf in the tree forever, because the only
   * device that could ask to leave just threw away the keys it asked with.
   *
   * And a failed send is not enough: you must wait for the server receipt. A send
   * that enters an open socket and is refused right after looked exactly like a
   * successful exit. See `#confirmado`.
   */
  async leaveChannel(channel: string): Promise<void> {
    if (!this.#groups.has(channel) || channel !== this.#commonRoom) return this.#sairDoCanal(channel)
    /*
      Leaving the common room is saying you do not want it. Without this, leaving
      was a gesture that undid itself: the next connection re-entered it
      (`ensureCommonRoom`). The choice goes BEFORE the exit, so no entry attempt
      can fit in between; if the exit fails, the person stays inside, and the
      choice is again what someone inside would choose.
    */
    await this.escolherSalaComum(false)
    try {
      await this.#sairDoCanal(channel)
    } catch (erro) {
      await this.definirPreferencia(PREFERENCIA_SALA_COMUM, SALA_COMUM_ENTRAR).catch(() => {})
      throw erro
    }
  }

  /** The exit itself, with no choice: `leaveAllChannels` (delete account) uses this. */
  async #sairDoCanal(channel: string): Promise<void> {
    if (!this.#groups.has(channel)) throw new Error("not a member of this channel", { cause: { channel } })
    const ref = await this.#sendPayload(channel, { t: "member.left", leftAt: Date.now() })
    await this.#confirmado(ref, channel)
    await this.forgetChannel(channel)
  }

  /**
   * Leave ALL channels, and say which ones you could not leave.
   *
   * This is the step missing from account deletion. `Vault.destroy()` cleared
   * the local vault and nothing else: the leaf stayed in the tree of each channel,
   * the person stayed in the member list for everyone, and, what is worse than
   * the visible symptom, **the epoch did not advance**, so the future secrecy
   * that a departure should guarantee never happened. It was reported like this:
   * "I deleted an account and it stays visible in the channel".
   *
   * Does not throw: returns the list of what was left unsaid, because the caller
   * must be able to decide. And the caller always decides the same way, by default
   *, see `prepareAccountDeletion`, but the decision is theirs, not this
   * function's.
   *
   * One channel at a time, on purpose: each exit waits for the server receipt,
   * and the wait is by `ref`. In parallel, what fails stops being traceable to a
   * channel, and the returned list is precisely the list of channels.
   *
   * Idempotent by construction: what leaves is dropped, so a second attempt only
   * retries what failed.
   *
   * **The list comes from both vault and memory, and the vault part is essential.**
   * Groups only enter `#groups` in `restore()`, and `restore()` runs inside
   * `connect()`. A session that opened without network, which is precisely the
   * situation where exit cannot exit, has empty memory and a full vault, and
   * asking memory alone answered "there are no channels to leave". That let you
   * delete the account with all leaves in the tree: the original defect again,
   * by another door. A channel that exists only in the vault cannot be dropped
   * (there is no group to encrypt the request with), so it counts as stuck, which
   * is the right answer, because you did not leave it.
   *
   * @returns channels you could NOT leave. Empty is the good outcome.
   */
  async leaveAllChannels(): Promise<string[]> {
    const presos: string[] = []
    const guardados = this.vault.unlocked ? Object.keys(this.vault.contents.groups) : []
    for (const canal of new Set([...this.#groups.keys(), ...guardados])) {
      try {
        await this.#sairDoCanal(canal)
      } catch {
        presos.push(canal)
      }
    }
    return presos
  }

  /**
   * What must run well BEFORE the vault is destroyed.
   *
   * **The decision that was pending, and the one that was made: leave first, and
   * do not destroy if you cannot leave.** Both answers cost something. Destroying
   * anyway costs the worst: the person hits delete, the vault vanishes, and their
   * leaf stays in the tree of each channel forever, because the only device in
   * the world that could ask to leave just threw away the keys it would ask with.
   * It stays visible in the list, with the epoch frozen, and no one removes it
   * except by hand by a member with the power to expel. Refusal costs far less:
   * the account still exists and the person hits it again when they have network.
   *
   * That is why refusal is the default behavior. It is written in
   * `docs/PENDENTES.md` for the owner to change knowing what they trade.
   *
   * @throws if any channel is left unsaid, with the reason in Portuguese to read.
   */
  async prepareAccountDeletion(): Promise<void> {
    const presos = await this.leaveAllChannels()
    if (presos.length === 0) return
    // The account stays: deleting it would leave the person visible in channels to
    // leave. The number of channels goes in `cause` so the message can say it.
    throw new Error("could not leave every channel, account kept", { cause: { canais: presos.length } })
  }

  /**
   * Can this channel be deleted by this account, here and now?
   *
   * Two questions in one: whether the account has the `delete` responsibility,
   * and whether the channel is even the kind of thing that gets deleted. The
   * second does not depend on any power, the exceptions below apply to whoever
   * founded the channel exactly as they apply to everyone else.
   */
  mayDeleteChannel(channel: string): boolean {
    return this.#porqueNaoSeElimina(channel) === null
  }

  /**
   * Why cannot this channel be deleted, or `null` if it can.
   *
   * One function alone, so the menu and the refusal cannot disagree: what the
   * screen hides is exactly what the core refuses, and the reason the person
   * reads is the same one that decided.
   */
  #porqueNaoSeElimina(channel: string): string | null {
    if (!this.#groups.has(channel)) return "not a member of this channel"

    /*
      The person's own feed channel, for the same reason it could never be
      forgotten, taken to its worst case: the posts whoever has it published live
      inside it. Forgetting it would break them on this device; deleting it would
      break them on all of them, and for everyone who follows.
    */
    if (this.#eMural(channel)) return "a feed channel cannot be deleted"

    /*
      A conversation between two people has no administration to exercise. Offering
      to delete was giving a button to make the conversation disappear from the
      other person's screen, which is different from leaving, and it is the exit
      that a conversation needs.
      
      The guard is even more precise than it was: whoever opened the conversation
      published `room.created` there and is, in the vault itself, its founder,       so they have `delete` by `powersOf` and this line is exactly what takes it
      away. On the other side there is no recorded founding and `delete` is not
      granted without it; the refusal had to apply to both, and it does.
      */
    if (this.#eDirecta(channel)) return "a direct conversation cannot be deleted"

    /*
      The common room belongs to the server, and the server restores it.

      `ensureCommonRoom` re-enters it as soon as the connection opens. Deleting it
      was a gesture that undid itself: the channel would leave and resurrect next,
      with no explanation on the screen. Whoever decides it exists is whoever
      announces it in the `hello`.
    */
    if (channel === this.#commonRoom) return "the common room belongs to the server"

    if (!this.may(channel, "eliminar")) return "you may not delete this channel"
    return null
  }

  /**
   * End the channel for everyone, as much as that is possible.
   *
   * Publish the tombstone (`space.removed`) and drop the channel from here, which
   * is exactly what any other honest client will do when it receives it. There is
   * no privilege here: whoever deletes ends up in the same situation as whoever
   * just received the news.
   *
   * The limit, stated where it cannot be ignored: **messages are not deleted.**
   * They are encrypted in each person's vault, and no server or administrator
   * reaches there. An altered client ignores the tombstone and keeps everything.
   * This ends the channel by convention, not by cryptography, and any text that
   * promises otherwise is lying about the one thing the product promises.
   *
   * Order matters and is not negotiable: publish FIRST, drop after. If the send
   * fails, offline especially, nothing is dropped. Dropping without publishing
   * would leave the person without the channel and the channel alive for everyone
   * else, with no one who could delete it if they were the only one with the
   * responsibility.
   */
  async deleteChannel(channel: string): Promise<void> {
    const recusa = this.#porqueNaoSeElimina(channel)
    if (recusa) throw new Error(recusa, { cause: { channel } })

    await this.send(channel, { t: "space.removed", removedAt: Date.now() })
    await this.forgetChannel(channel)
  }

  /**
   * Drop ALL rooms and feeds, keeping the account.
   *
   * It exists because the state of an MLS group can diverge beyond repair:
   * successive reseats leave members in different epochs, and from there nothing
   * deciphers, not messages, not call signaling, which travels inside the group.
   * Reconciling that from the client side is impossible: the old keys are gone,
   * by design.
   *
   * What stays: the identity (the account IS the key), the profile and the key
   * packages. What is lost: the history deciphered on this device and the place
   * in each group. Re-entering requires a new invite, and that is what you want,
   * because the goal is a clean state shared by everyone.
   */
  async forgetAllChannels(): Promise<void> {
    const canais = [...this.#groups.keys()]
    for (const canal of canais) {
      try {
        await this.forgetChannel(canal)
      } catch {
        // A channel that does not drop should not block the rest.
      }
    }

    if (this.vault.unlocked) {
      await this.vault.update((contents) => {
        contents.groups = {}
        contents.history = {}
        contents.estadoDoCanal = {}
        contents.lastSeq = {}
        delete contents.seatSince
        delete (contents as unknown as CofreDaSincronia).sincronia?.lugares
        delete contents.pendingCommits
        contents.transmitters = {}
        contents.directory = {}
        contents.deadWelcomes = []
        contents.repairAttempts = {}
        contents.publishedProfileAt = {}
        contents.mintedInvites = {}
      })
      await this.flush()
    }

    this.#groups.clear()
    this.#commitsPorConfirmar.clear()
    this.#memberCounts.clear()
    this.emit("channels", { channels: this.channels })
    this.emit("status", {
      detail: "Salas e feeds recomeçados. A tua conta e o teu perfil mantêm-se; pede para te convidarem de novo.",
      level: "info",
      route: "toast",
    })
  }

  /**
   * Was the server restarted since the last time we were here?
   *
   * If it was, the group state saved on this device lost its counterpart: the
   * channels we think are ours have no history or members the server recognizes,
   * and nothing will decipher again, not messages, not call signaling, which
   * travels inside the group. We drop everything once, automatically, and the
   * account stays.
   *
   * The mark is compared, not just tested: a server that was never restarted sends
   * no field, and a restart older than the one we already know about does not
   * repeat the work.
   */
  /**
   * The server cut off accounts before a given moment.
   *
   * Clearing the server storage is not enough to end an account: the identity and
   * history live in each person's vault, and a client that reconnects will
   * republish its keys as if nothing happened. This is the real cut, and it does
   * itself: anyone with an identity in the vault before the cutoff loses it.
   *
   * The absence of `identityCreatedAtMinute` counts as before. This applies to all
   * vaults created before this mechanism existed, which is exactly who you want to
   * cut the first time this is used.
   *
   * Destructive and without asking, on purpose: asking someone if they want to
   * keep an account the server no longer recognizes only offers the choice to
   * stay in an app that does not work.
   *
   * @returns whether the identity was marked obsolete and the vault destroyed.
   */
  async #reconcileAccountsReset(accountsResetAtMinute: number | undefined): Promise<boolean> {
    if (accountsResetAtMinute === undefined) return false
    if (!this.vault.unlocked) return false

    const nascimento = this.vault.contents.identityCreatedAtMinute
    if (nascimento !== undefined && nascimento >= accountsResetAtMinute) return false

    this.emit("status", {
      detail:
        "As contas anteriores deixaram de ser válidas neste servidor. Esta foi apagada deste dispositivo — cria uma conta nova e pede para te convidarem.",
      level: "error",
      code: "identity-obsolete",
      route: "toast",
    })

    this.reset()
    await this.vault.destroy()
    return true
  }

  async #reconcileServerReset(resetAtMinute: number | undefined): Promise<void> {
    if (resetAtMinute === undefined) return
    if (!this.vault.unlocked) return

    const visto = this.vault.contents.serverResetAtMinute
    if (visto !== undefined && visto >= resetAtMinute) return

    const tinhaEstado = Object.keys(this.vault.contents.groups).length > 0

    await this.vault.update((contents) => {
      contents.serverResetAtMinute = resetAtMinute
    })

    if (!tinhaEstado) {
      await this.flush()
      return
    }

    await this.forgetAllChannels()
    this.emit("status", {
      detail:
        "O servidor foi reiniciado e as salas e feeds antigos deixaram de existir. A tua conta e o teu perfil mantêm-se — pede para te convidarem de novo.",
      level: "info",
      route: "toast",
    })
  }

  /**
   * Invite someone by address.
   *
   * We claim one of their published key packages, add them with a commit, and
   * hand the resulting Welcome only to them. The server routes all three and
   * reads none of them.
   */
  /**
   * Invites and requests in progress, by "channel|person".
   *
   * The guards below read state that only exists after the operation ends: the
   * tree after the commit, the history after writing. Between the first click and
   * that moment seconds pass, and that is exactly when an impatient person clicks
   * again. Without this, both clicks read the same old state and both pass.
   */
  #emCurso = new Map<string, Promise<unknown>>()

  async #umaDeCadaVez<T = void>(chave: string, fn: () => Promise<T>): Promise<T> {
    const anterior = this.#emCurso.get(chave) as Promise<T> | undefined
    if (anterior) return anterior
    const promessa = fn().finally(() => this.#emCurso.delete(chave))
    this.#emCurso.set(chave, promessa)
    return promessa
  }

  /** The operation in progress on each channel's group. See `#umDeCadaVezNoGrupo`. */
  #filaDoGrupo = new Map<string, Promise<unknown>>()

  /**
   * One operation at a time on a channel's group, queued, not merged.
   *
   * **The difference from `#umaDeCadaVez`, which is nearby and does something else:** there
   * the second request MERGES with the first and both get the same result,
   * because two clicks on "invite" are one invite. Here the second request
   * WAITS for the first and runs next, because two messages are two
   * messages.
   *
   * **What this protects, and why.** Opening or encrypting something in a
   * channel is always the same sequence: read the group state, do async
   * cryptographic work, and write back the resulting state. Nothing
   * on the client waited: each frame that arrives is launched with `void` in
   * `#onFrame`, catch-up runs alongside live frames, and
   * `send` is called without `await` in several places (the write signal, the
   * `republishRooms` after someone joins, the profile).
   *
   * Two of these overlapping sequences break the channel three ways, all
   * measured in `session.corrida.test.ts`:
   *
   * - **Encrypting:** both sends read the same rack and produce the SAME
   *   generation. The receiver opens one and refuses the other with "Desired gen in the
   *   past". On the sender's screen both appear, because our own
   *   send enters local history without going through MLS. This is exactly the
   *   telemetry: *appeared on theirs, not on hers*.
   * - **Opening:** the second decrypts against a state that the first already
   *   replaced, a message encrypted in the new epoch opened with the old key,
   *   which gives "invalid tag" and nothing more.
   * - **Writing:** the second overwrites the first, and a commit
   *   applied and then undone leaves the device one epoch behind forever. From
   *   then on nothing opens, the ignored ones pile up, and declared
   *   deafness takes the history with the reseat.
   *
   * None of them raise an error: a failed `receive` does not throw, it is
   * handled inside `receive`. That is why this looked like messages
   * disappearing without explanation.
   *
   * The queue is PER CHANNEL: different channels have different groups and have nothing
   * to wait for each other. And the place in the queue is marked at the INSTANT of the
   * call, which is what guarantees the order, `#applyEvent` runs
   * synchronously from `#onFrame` to here, so two frames on the same connection
   * enter in the order the server wrote them, which is the order the
   * commits must be applied.
   *
   * **AND THAT SENTENCE IS A REQUIREMENT ON THE PATH, not an observation about
   * it.** Each frame arrives in its own task, so the chain of the first
   * only has to reach here before the task of the second starts, which is true
   * as long as nothing on the path waits for real I/O. On October 5, 2026 the
   * gate (`#reterAoVivo`) entered that path as `async` with an `await`
   * inside it, and the sentence became false for a few hours; that is why the
   * gate is synchronous and its cap discards instead of draining. Whoever
   * adds an `await` between `#onFrame` and this line is changing the order
   * in which commits are applied, not tidying up the code.
   *
   * The stored chain NEVER rejects. An operation that fails fails for whoever
   * called it, it is `#applyEventSafely` that decides whether to retry, but it
   * cannot carry the next one with it, which often is the commit that fixes it.
   *
   * **The full cost:** sending on a channel with a large recovery underway
   * now waits for it. That is the right price to pay, before this,
   * that message would go out with the wrong generation and reach no one, which is
   * worse than arriving late, but if someone notices sends stuck
   * during a catch-up one day, look here, and the fix is a queue per direction
   * not just one.
   */
  #umDeCadaVezNoGrupo<T>(channel: string, fn: () => Promise<T>): Promise<T> {
    const anterior = this.#filaDoGrupo.get(channel) ?? Promise.resolve()
    const minha = anterior.then(fn)
    const calada = minha.then(
      () => undefined,
      () => undefined,
    )
    this.#filaDoGrupo.set(channel, calada)
    // A stopped channel does not keep a stuck promise in the map forever. The
    // comparison is what stops cleanup from wiping a queue already renewed by
    // whoever arrived in the meantime.
    void calada.then(() => {
      if (this.#filaDoGrupo.get(channel) === calada) this.#filaDoGrupo.delete(channel)
    })
    return minha
  }

  // ------------------------------------------------------------ commits nossos

  /** How many times an operation retries the commit after the server refuses it for epoch. */
  static readonly TENTATIVAS_DE_COMMIT = 3

  /**
   * Our commit, end to end: built, sent, and applied ONLY after accepted.
   *
   * **This broke the common room.** The commit was applied and saved before sending,
   * then published. Two joins at the same time, one from the card, another
   * admitted by a member, made two commits for the same epoch; the
   * server saved both and each author got theirs. Two branches with the same
   * name, each with half the people, on 12/9/2026.
   *
   * Now state only changes when the server returns the echo with our `ref`.
   * A server with `commit-per-epoch` accepts the first commit of each epoch and
   * refuses the rest (`stale-epoch`): the loser throws theirs away, fetches the channel
   *, the winning commit usually is already queued behind ours, and rebuilds over
   * what is left. `rebuild` gets the attempt number so it can
   * say "nothing to do" (someone else did it meanwhile) instead of
   * repeating on top.
   *
   * Against a server without that rule the echo always arrives, and this is just the delay
   * of one server round before applying.
   *
   * @returns whether there was a commit. `false` when `rebuild` concluded nothing needed doing.
   */
  async #commitar(
    channel: string,
    montar: (grupo: GroupSession, tentativa: number) => Promise<{ commit: Uint8Array; session: GroupSession; welcome?: CommitNosso["welcome"] } | null>,
  ): Promise<boolean> {
    for (let tentativa = 1; ; tentativa++) {
      try {
        // The queue spans rebuild→send→verdict→save: a second our commit
        // built on the same epoch while the first waits would be refused,
        // or, against an old server, our own branch against ourselves.
        return await this.#umDeCadaVezNoGrupo(channel, async () => {
          const grupo = this.#groups.get(channel)
          if (!grupo) throw new Error("not a member of this channel", { cause: { channel } })
          const montado = await montar(grupo, tentativa)
          if (!montado) return false
          const nosso: CommitNosso = { commit: montado.commit, base: epochOf(grupo), session: montado.session, welcome: montado.welcome }
          const seqDoCommit = await this.#publicarCommit(channel, nosso)
          // A Welcome is someone joining: the floor of chat telemetry goes up (S4).
          if (nosso.welcome) this.#anti.aoCrescer(channel, seqDoCommit)
          /*
            Accepted. In this order, and each step has its reason.

            The Welcome FIRST: it used to go out after saving, and a failed save
            , the vault full, a tab closing, left the person in everyone's tree
            without ever getting what to join with. A Welcome repeated
            later (adoption by bytes) is harmless: it does not open twice and falls
            into `deadWelcomes`.

            The new group and exit from the "pending" record next, with nothing
            yielding the turn between them: a save that caught the record already
            cleaned and the group still old left this device one epoch behind, with the
            commit explaining it forgotten.
          */
          if (nosso.welcome) {
            try {
              await this.#enviarWelcome(channel, nosso.welcome)
            } catch {
              // No connection. The commit entered and saves anyway; whoever lost
              // the Welcome is fixed by the normal path (re-entry, resync).
            }
          }
          await this.#persistGroup(channel, nosso.session)
          this.#largarPorConfirmar(channel, nosso)
          await this.flush()
          return true
        })
      } catch (erro) {
        if (!(erro instanceof CommitRecusado) || tentativa >= Session.TENTATIVAS_DE_COMMIT) throw erro
        await this.#apanharDepoisDeRecusa(channel, erro.base)
      }
    }
  }

  /**
   * Send our commit and wait for the verdict, without touching the group.
   *
   * Runs INSIDE the group's queue, whoever calls holds it, and does not request it: the
   * response arrives via `#onFrame` before any queue, so waiting for
   * it here does not deadlock.
   *
   * **Before exiting, the commit is stored in the vault as pending**, with the
   * group it produces. That was the reason for saving the group before sending:
   * a commit that reaches the server but not disk left the device one
   * epoch behind forever. Stored this way, the group on disk stays in the epoch
   * before, which is the truth until there is a verdict, and if the echo does not arrive
   * (timeout, network drop, page reload) the commit is recognized by
   * bytes when it shows up in recovery, and only then applied. See `#applyEvent`.
   */
  async #publicarCommit(channel: string, nosso: CommitNosso, guardar = true): Promise<number> {
    // The life of whoever published (S6): after waiting for the rhythm, a commit from
    // an account that already left this session does not go out as the next one.
    const vida = this.#vida
    if (guardar) {
      this.#guardarPorConfirmar(channel, nosso)
      await this.flush()
    }

    /*
      Refused for rhythm, not saved: the same bytes again when
      there is room, right here with the channel queue in hand (S6). A commit does not
      spend the rack, and the server never saw it. In a loop and not by calling
      itself: the "pending" record is from this call to the end,
      and a refusal for epoch after one for rhythm must release it anyway
      (S6 revision: it stayed behind, with `save` already false on retry).
    */
    let primeiraRecusa: number | null = null
    for (;;) {
      let vez: VezDeEnvio
      try {
        // Also on the first send: a delay already open from another refusal counts
        // for commits in the same bucket.
        vez = await this.#esperarVez("handshake", vida)
      } catch (erro) {
        if (guardar && vida === this.#vida) this.#largarPorConfirmar(channel, nosso)
        throw erro
      }
      const ref = this.#markOwn()
      const veredicto = this.#confirmado(ref, channel)
      this.#marcarHandshake(ref)
      try {
        this.#send({ t: "channel.send", channel, kind: "handshake", ciphertext: toBase64(nosso.commit), ref })
        vez.saiu(ref, true)
      } catch (erro) {
        vez.largar()
        // It did not go out, so there is no verdict to wait for.
        veredicto.catch(() => {})
        this.#confirmacoes.get(ref)?.reject(erro as Error)
        this.#ownRefs.delete(ref)
        this.#refsDeHandshake.delete(ref)
        if (guardar) this.#largarPorConfirmar(channel, nosso)
        throw erro
      }

      try {
        // Whoever calls releases the "pending" record along with the new group.
        return await veredicto
      } catch (erro) {
        // An echo that arrives after this is no longer "ours" for `#onFrame`: it goes
        // through the events path, and that is where the saved commit is recognized.
        this.#ownRefs.delete(ref)
        if (erro instanceof EpocaVelhaNoServidor) {
          if (guardar) this.#largarPorConfirmar(channel, nosso)
          this.emit("status", {
            detail: `${channel}: commit sobre a epoch ${nosso.base} recusado (o canal já vai na ${erro.epoca ?? "?"}); a apanhar o canal`,
            level: "info",
            code: "commit-rejected",
            route: "log",
            channel,
          })
          throw new CommitRecusado(nosso.base, erro.epoca)
        }
        if (erro instanceof AtualizacaoExigida) {
          // Refused without saving: it will never show up, and there is nothing to wait for.
          if (guardar) this.#largarPorConfirmar(channel, nosso)
          throw erro
        }
        if (erro instanceof EnvioRecusadoPorRitmo) {
          primeiraRecusa ??= Date.now()
          // Give up by time, not by number of refusals (see `PRAZO_DOS_REENVIOS_MS`).
          if (Date.now() - primeiraRecusa <= Session.PRAZO_DOS_REENVIOS_MS) continue
          // Never made it to the server: the record exits.
          if (guardar) this.#largarPorConfirmar(channel, nosso)
        }
        this.emit("status", {
          detail: `${channel}: commit sobre a epoch ${nosso.base} sem veredicto (${(erro as Error).message}); não foi aplicado`,
          level: "info",
          code: "commit-unconfirmed",
          route: "log",
          channel,
        })
        throw erro
      }
    }
  }

  /**
   * After a refusal: wait for the commit that won to arrive, and fetch it if it does not.
   *
   * Most of the time it is already in the channel queue, behind ours, the server
   * spread it before refusing us. Only if the epoch did not change do we
   * ask the server for what is missing.
   */
  async #apanharDepoisDeRecusa(channel: string, base: bigint): Promise<void> {
    await this.#umDeCadaVezNoGrupo(channel, async () => undefined)
    const grupo = this.#groups.get(channel)
    if (!grupo || epochOf(grupo) > base) return
    const emCurso = this.#recuperacoes.get(channel)
    if (emCurso) {
      emCurso.repetir = true
      await emCurso.promessa.catch(() => {})
      return
    }
    await this.#catchUpChannel(channel).catch(() => {})
  }

  /**
   * A Welcome, with the same bytes, when the commit bucket allows (S6).
   *
   * Refused for rhythm, it retries through the channel queue (`#drenarRepeticoes`): it does not
   * spend a rack, and without it whoever sat never joins. No delay and no
   * slow mode goes right out, same turn: whoever calls saves the group next, and the
   * Welcome has to go out before that (see `#commitar`).
   */
  #enviarWelcome(channel: string, welcome: NonNullable<CommitNosso["welcome"]>): Promise<void> {
    const vida = this.#vida
    const ja = this.#vezSemEspera("handshake")
    if (ja) {
      try {
        this.#sairWelcome(channel, welcome, ja, null)
        return Promise.resolve()
      } catch (erro) {
        return Promise.reject(erro as Error)
      }
    }
    return this.#esperarVez("handshake", vida).then((vez) => this.#sairWelcome(channel, welcome, vez, null, vida))
  }

  /** The Welcome for the thread, with the turn already in hand. `repeticao`: from a rhythm refusal. */
  #sairWelcome(channel: string, welcome: NonNullable<CommitNosso["welcome"]>, vez: VezDeEnvio, repeticao: Reenviavel | null, vida = repeticao?.vida ?? this.#vida): void {
    if (vida !== this.#vida) {
      vez.largar()
      throw new Error("the session ended")
    }
    const ref = this.#markOwn()
    this.#guardarReenviavel(ref, {
      tipo: "welcome",
      channel,
      welcome,
      ordem: repeticao?.ordem ?? this.#proximaOrdem(),
      primeiraRecusa: repeticao?.primeiraRecusa ?? null,
      vida,
    })
    this.#marcarHandshake(ref)
    try {
      this.#send({
        t: "channel.send",
        channel,
        kind: "welcome",
        ciphertext: toBase64(welcome.bytes),
        recipient: welcome.recipient,
        ref,
      })
      // The server does not return the Welcome to whoever sent it: in slow mode, the turn
      // passes after `ESPERA_SEM_ECO_MS`, or with the refusal, if it arrives.
      vez.saiu(ref, false)
    } catch (erro) {
      vez.largar()
      this.#reenviaveis.delete(ref)
      this.#refsDeHandshake.delete(ref)
      throw erro
    }
  }

  /** Our sent commits without a verdict, per channel. Mirrored in the vault. */
  #commitsPorConfirmar = new Map<string, CommitNosso[]>()
  #commitsPorConfirmarSujos = false

  #guardarPorConfirmar(channel: string, nosso: CommitNosso): void {
    // Few: each one is an entire group state, and only the current epoch one can
    // still come in. The ones from past epochs exit in `#tirarPorConfirmar`.
    const lista = [...(this.#commitsPorConfirmar.get(channel) ?? []), nosso].slice(-4)
    this.#commitsPorConfirmar.set(channel, lista)
    this.#commitsPorConfirmarSujos = true
  }

  #largarPorConfirmar(channel: string, nosso: CommitNosso): void {
    const lista = (this.#commitsPorConfirmar.get(channel) ?? []).filter((outro) => outro !== nosso)
    if (lista.length > 0) this.#commitsPorConfirmar.set(channel, lista)
    else this.#commitsPorConfirmar.delete(channel)
    this.#commitsPorConfirmarSujos = true
  }

  /**
   * A commit that arrives from the server is one of ours pending? Remove it, if so.
   *
   * By the bytes, which the server keeps and returns as is, and only over the epoch
   * the group is on: built on another, it would never enter.
   */
  #tirarPorConfirmar(channel: string, bytes: Uint8Array, epocaDoGrupo: bigint): CommitNosso | undefined {
    const lista = this.#commitsPorConfirmar.get(channel)
    if (!lista) return undefined
    const vivos = lista.filter((nosso) => nosso.base >= epocaDoGrupo)
    const nosso = vivos.find(
      (candidato) =>
        candidato.base === epocaDoGrupo &&
        candidato.commit.length === bytes.length &&
        candidato.commit.every((byte, i) => byte === bytes[i]),
    )
    const resto = vivos.filter((candidato) => candidato !== nosso)
    if (resto.length !== lista.length) {
      if (resto.length > 0) this.#commitsPorConfirmar.set(channel, resto)
      else this.#commitsPorConfirmar.delete(channel)
      this.#commitsPorConfirmarSujos = true
    }
    return nosso
  }

  /**
   * Invite someone on purpose, the invite that a person activates with a button.
   *
   * **Inviting does not seat anyone anywhere.** What this does is send an
   * invite, which arrives as a private message; whoever receives it joins only if
   * they accept, and admission itself is a second act, from this device. See the
   * section "invites for a channel" below, where it explains why and
   * what the cost is, time passes between accepting and joining.
   *
   * This used to seat the person right here without asking: a place given to
   * someone who never asked for it, with the member list going to two before the other
   * person knew the channel existed.
   *
   * It requires the `invite` permission, and is the only path that requires it. Restoring
   * a dead seat (`seat`, `#reseat`) and responding to a re-entry request are
   * not invites: they restore someone who should already be there, and run on any member.
   * Spending the permission on them too would break what keeps channels alive, if only
   * whoever invites could seat, the common room would stop healing itself and
   * a channel with no admin online would have no way to fix anyone.
   *
   * Inviting is convention, unlike expulsion: a modified client admits
   * whoever it wants, and no other client can stop or undo it. What this
   * permission does is decide what THIS client publishes.
   */
  async invite(channel: string, address: string, note?: string, extra: { sucessao?: string } = {}): Promise<void> {
    if (!this.#groups.has(channel)) throw new Error("not a member of this channel", { cause: { channel } })
    if (!this.may(channel, "convidar")) throw new Error("you may not invite in this channel", { cause: { channel } })
    const group = this.#groups.get(channel)
    // Someone already there does not get invited, and whoever invites is always there, so
    // this also answers inviting themselves. The same permission exists in
    // `#invite`, which is where admission goes; this one is so the invite does not
    // go out at all, because a message inviting someone already a member is noise that stays
    // in the chat and does not get erased.
    //
    // "Already there" became "they lack no device": an account with
    // two devices in the manifest and one in the tree still has a seat to give.
    // See `#faltam`.
    if (group && !(await this.#haLugarPorDar(group, address))) {
      throw new Error("that person is already in this channel", { cause: { address } })
    }
    return this.#umaDeCadaVez(`convite|${channel}|${address}`, () => this.#inviteToChannel(channel, address, note, extra))
  }

  /**
   * The manifest devices with no leaf in the tree, in base64url.
   *
   * It is the predicate that replaced "the address is already in the tree" in all
   * admission guards: `invite`, `#invite`, `seat`, `#honourInvite`. An
   * account is complete in a channel when each device it declared has
   * a leaf; until then there is a seat to give, and only that one.
   */
  #faltam(tree: GroupSession["state"]["ratchetTree"], address: string, manifesto: DeviceManifest): string[] {
    const presentes = new Set<string>()
    for (const folha of leavesOf(tree, address as UserAddress)) {
      const chave = deviceKeyAtLeaf(tree, folha)
      if (chave) presentes.add(toBase64(chave))
    }
    return manifesto.devices.map((device) => toBase64(device.deviceKey)).filter((chave) => !presentes.has(chave))
  }

  /**
   * An account's manifest for deciding admissions, or `null` with no bundle on the
   * server, remembered for one minute.
   *
   * Short memory exists because of the bucket: `manifest.get` is 60 per
   * minute per account, and the gateway GOES SILENT above it (`deviceManifestOf`
   * waits 10 s and returns `null`). The reconciliation of each connection goes through
   * `#honourInvite` for each accepted invite, and each of these asks for the
   * manifest of whoever is already in the tree; an account with sixty accepted
   * invites got ten seconds stuck on each starting from the sixty-first.
   * One minute is enough for one full pass to read each address once,
   * and it is short enough for a paired device to be
   * seen on the next connection or the next repair.
   */
  async #manifestoPara(address: string): Promise<DeviceManifest | null> {
    if (!this.suportaBundle) return null
    const lembrado = this.#manifestosRecentes.get(address)
    if (lembrado !== undefined && Date.now() - lembrado.em < MANIFESTO_LEMBRADO_MS) return lembrado.manifesto
    // A request in flight per address: reconciling a connection can
    // ask for the same manifest several ways at once (the feed and the
    // accepted invite from the same person), and each extra request is one bucket unit and,
    // above it, a whole timeout waiting for nothing.
    const emVoo = this.#manifestosEmVoo.get(address)
    if (emVoo !== undefined) return emVoo
    const pedido = this.#lerManifesto(address, PRAZO_MANIFESTO_GUARDA_MS)
      .then((leitura) => {
        // Only what is READ is remembered. A server silence is not "no
        // manifest": remembering it as such used to admit for five minutes as if the
        // account had one device only.
        if (!leitura.lido) return null
        this.#lembrarManifestoLido(address, leitura.manifesto)
        return leitura.manifesto
      })
      .finally(() => this.#manifestosEmVoo.delete(address))
    this.#manifestosEmVoo.set(address, pedido)
    return pedido
  }

  /** See `#manifestoPara`. Memory only: the anti-rollback anchor is from the vault. */
  #manifestosRecentes = new Map<string, { manifesto: DeviceManifest | null; em: number }>()
  #manifestosEmVoo = new Map<string, Promise<DeviceManifest | null>>()

  #lembrarManifestoLido(address: string, manifesto: DeviceManifest | null): void {
    this.#manifestosRecentes.set(address, { manifesto, em: Date.now() })
  }

  /**
   * If there is still a device of this account to admit in this channel.
   *
   * Outside the tree, yes, without asking the server: that is the normal invite. In the
   * tree, only if the manifest lists a device with no leaf; no manifest (old
   * server, or account that never published one), the account is single-device and
   * is complete. The server call only happens in the rare case, so the manifest
   * bucket does not get spent on each invite to a new person.
   */
  async #haLugarPorDar(group: GroupSession, address: string): Promise<boolean> {
    const tree = group.state.ratchetTree
    if (leavesOf(tree, address as UserAddress).length === 0) return true
    const manifesto = await this.#manifestoPara(address)
    return manifesto !== null && this.#faltam(tree, address, manifesto).length > 0
  }

  /**
   * The key packages from a claim response that can be spent in a commit.
   *
   * **Each package passes through the chain BEFORE going to the commit, including the singular one.**
   * `addressBindingAuthService` already refused leaves with a broken chain, but only
   * inside `createCommit`, with the package already claimed and the entire invite failing
   * due to a bad package. Here we decide package by package
   * (`credentialOfKeyPackage`: the three links), and what does not verify exits with
   * a journal entry, and the rest enters. It is the security gain that the slice gives to
   * everyone, also to those with one device only.
   *
   * The manifest, when present, decides: the `deviceKey` of the credential must be in
   * it, otherwise it is a device that the account did not declare (revoked, or never
   * its own), and it stays out. What decides is the manifest that came in the response,
   * verified and passed by the anti-rollback, or what was read before the claim if the
   * one in the response does not work. With none (old server, account with no
   * manifest), the chain goes through. What the server said about the device of
   * each package is checked against the credential: a package with a swapped tag
   * is a package where the server lied, and it does not enter.
   *
   * With `pedidos` (the claim with `devices`), the device of the credential must
   * be one of the requested ones (M1 of the revision of slot 1). The backup package
   * comes with no device, and can be from another leaf of the account: from a device
   * that is already there (a second leaf for it), or from a 0.5.7 leaf that would thus
   * enter the account channel, where we never invite.
   */
  async #pacotesAdmissiveis(
    address: string,
    claimed: Extract<ServerFrame, { t: "keypackage.claimed" }>,
    manifestoPrevio: DeviceManifest | null,
    pedidos?: readonly string[],
  ): Promise<{ manifesto: DeviceManifest | null; pacotes: { deviceKey: string; pacote: ReturnType<typeof decodeKeyPackage> }[] }> {
    const daResposta = claimed.manifest ? await this.#verificarManifesto(address, claimed.manifest) : null
    if (daResposta !== null) this.#lembrarManifestoLido(address, daResposta)
    const manifesto = daResposta ?? manifestoPrevio
    const declarados = manifesto === null ? null : new Set(manifesto.devices.map((device) => toBase64(device.deviceKey)))

    const brutos: { deviceKey: string | null; keyPackage: string }[] =
      claimed.keyPackages !== undefined && claimed.keyPackages.length > 0
        ? claimed.keyPackages
        : claimed.keyPackage
          ? [{ deviceKey: null, keyPackage: claimed.keyPackage }]
          : []

    const pacotes: { deviceKey: string; pacote: ReturnType<typeof decodeKeyPackage> }[] = []
    const rejeitar = (porque: string): void => {
      this.emit("status", {
        detail: `chave de convite de ${address} recusada: ${porque}`,
        level: "error",
        code: "keypackage-invalid",
        route: "log",
      })
    }
    for (const bruto of brutos.slice(0, APARELHOS_POR_CONTA)) {
      let pacote: ReturnType<typeof decodeKeyPackage>
      try {
        pacote = decodeKeyPackage(fromBase64(bruto.keyPackage))
      } catch {
        rejeitar("ilegível")
        continue
      }
      const cadeia = credentialOfKeyPackage(pacote)
      if (cadeia === undefined) {
        rejeitar("a cadeia de aparelho não fecha")
        continue
      }
      if (cadeia.address !== address) {
        rejeitar("a credencial é de outra conta")
        continue
      }
      const deviceKey = toBase64(cadeia.deviceKey)
      if (bruto.deviceKey !== null && bruto.deviceKey !== deviceKey) {
        rejeitar("o servidor atribuiu-a a outro aparelho")
        continue
      }
      if (declarados !== null && !declarados.has(deviceKey)) {
        rejeitar("aparelho fora do manifesto da conta")
        continue
      }
      if (pedidos !== undefined && !pedidos.includes(deviceKey)) {
        rejeitar("aparelho que não foi pedido")
        continue
      }
      // An old manifest served by the server can still list it; the vault
      // remembers the `device.revoke` that arrived or the revocation done here.
      if (estaRevogado(this.vault.contents, address, deviceKey)) {
        rejeitar("aparelho revogado pela conta")
        continue
      }
      if (pacotes.some((p) => p.deviceKey === deviceKey)) continue
      pacotes.push({ deviceKey, pacote })
    }
    return { manifesto, pacotes }
  }

  /** The invite with no paper trail, for recovery paths. See `invite`. */
  async #seatInvite(channel: string, address: string, jaReclamados?: PacotesReclamados): Promise<void> {
    return this.#umaDeCadaVez(`invite|${channel}|${address}`, () => this.#invite(channel, address, jaReclamados))
  }

  /**
   * Claim the key packages of an account without committing anything.
   *
   * Separated from `#invite` so that `#reseat` can know whether there is room to give BEFORE
   * taking what is there, see it. Claiming SPENDS the packages on the server and that cannot be
   * undone, so the caller commits to using them or accepting they are lost: it is the same cost
   * that `#invite` always paid when the commit failed after the claim.
   */
  async #reclamarPacotes(address: string, pedidos: string[] | undefined, manifestoPrevio: DeviceManifest | null): Promise<PacotesReclamados> {
    // A short retry, because "no key packages" is often just a race: someone
    // who connected a moment ago is still publishing their pool while we are
    // already claiming from it. Three attempts over ~3 s turns that race into
    // a non-event; a genuinely depleted pool still fails, honestly.
    let claimed = null as Extract<ServerFrame, { t: "keypackage.claimed" }> | null
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1500))
      // `bundle` only to the one doing it: against an old server the field drops and we get
      // the singular. A request, never offered: see `CAPACIDADE_BUNDLE`.
      this.#send({ t: "keypackage.claim", address, bundle: this.suportaBundle, ...(pedidos ? { devices: pedidos } : {}) })
      // By ADDRESS TAG, not by order: two invites in flight on the
      // same socket (two recovery `seat` calls, or an invite alongside a repair) would receive
      // each other's response, and each would commit the wrong person's package. See the match
      // by key in `#onFrame`.
      const reply = await this.#await("keypackage.claimed", 10_000, address)
      if (reply.t !== "keypackage.claimed" || reply.address !== address) continue
      claimed = reply
      if (claimed.keyPackage) break
    }
    if (!claimed?.keyPackage) {
      if (pedidos !== undefined) throw new AparelhoSemChaves(address)
      throw new Error("that person has no invite keys", { cause: { address } })
    }

    const { manifesto, pacotes } = await this.#pacotesAdmissiveis(address, claimed, manifestoPrevio, pedidos)
    if (pacotes.length === 0) {
      throw new Error("no invite key verifies", { cause: { address } })
    }
    return { manifesto, pacotes }
  }

  async #invite(channel: string, address: string, jaReclamados?: PacotesReclamados): Promise<void> {
    const group = this.#groups.get(channel)
    if (!group) throw new Error("not a member of this channel", { cause: { channel } })

    /**
     * Someone already there does not get invited again.
     *
     * Without this, tapping the button twice would spend another key package from that
     * person and give them a second leaf in the tree for the same address,
     * with a second invite on the way. Two leaves for one person means
     * half the messages are encrypted for a place they do not open, and
     * exhausting their key package reserve prevents anyone who comes next from inviting them
     * at all.
     *
     * `seat()` already checked this before calling here; the interface calls
     * `invite` directly and checked nothing. The guard belongs here,
     * at the place where everyone passes.
     *
     * Repairing a dead seat is another path, `repairInvite`, which knows how to
     * tell a silent seat from a dead one before touching the tree.
     */
    /**
     * And "already there" means "no device is missing" (`#faltam`): with the
     * manifest in hand, what we ask the server for are only the devices with no
     * leaf, so we do not spend a package from each of the ones already here. The
     * manifest is read BEFORE the claim for this reason, and it comes back in the response
     * to check what the server delivered.
     */
    /*
      With the packages ALREADY CLAIMED, none of this runs.

      Whoever claimed them read the tree before touching it and decided with it in hand. It is the
      path of `#reseat`, and it is the only one: the guard of "already there" is based on the tree
      BEFORE the removal, and there the person IS there, the dead leaf is precisely what
      will be taken out, so the guard would refuse the work itself. The one that matters
      in that path is the one inside `#commitar`, which rereads the tree after the
      removal and is the one that catches a race.
    */
    let reclamados = jaReclamados
    if (!reclamados) {
      const manifestoPrevio = await this.#manifestoPara(address)
      const naArvore = leavesOf(group.state.ratchetTree, address as UserAddress).length > 0
      if (naArvore && (manifestoPrevio === null || this.#faltam(group.state.ratchetTree, address, manifestoPrevio).length === 0)) {
        throw new Error("that person is already in this channel", { cause: { address } })
      }
      const pedidos = naArvore && manifestoPrevio !== null ? this.#faltam(group.state.ratchetTree, address, manifestoPrevio) : undefined
      reclamados = await this.#reclamarPacotes(address, pedidos, manifestoPrevio)
    }
    const { manifesto, pacotes } = reclamados

    /*
      One commit at a time, PER CHANNEL. See `#umDeCadaVezNoGrupo`.
      
      **The queue STARTS HERE and not at the entry to the method, and the difference is in
      liveness.** Claiming a key package is a server round-trip with three
      retries and ~3 s wait in between; holding the queue during that would freeze
      all sends and all events arriving at the channel, and would make the queue's
      liveness depend on the server responding. What must be protected is the read→commit→save
      sequence, and only that.
      
      **What this fixed, measured:** with the commit outside the queue, eight sends
      alongside a `seat` left Ana publishing a commit for epoch 2 and
      stuck herself in epoch 1, the `#persistGroup` of the send, which read before and
      wrote after, erased the one from the invite. The receiver stays in the new epoch and
      reads old messages through the old-epoch window, so there is no symptom at all: just an
      account that fell behind, which soon declares itself deaf and takes the history with the reseat.
      */
    // If the snapshot was with the Welcome and carries all that the cascade would carry (phase 1 of 1.1).
    let estadoNoRetrato = false
    const commitou = await this.#commitar(channel, async (atual, tentativa) => {
      /**
       * Reread HERE INSIDE, not what was read at the top of the method.
       *
       * Between one read and the next a server round-trip happened. In that time the
       * group may have changed epoch, by our commit, by someone else's commit applied alongside,        * and committing from the old state produces a commit that no one else accepts, with our own
       * state falling behind it. The guard of "already in this room" comes with it: the response
       * may have changed in that same window, and it is here that it matters.
       *
       * On a second try, the server refused the first because another
       * commit won the epoch, finding it in there means someone admitted it in the meantime,
       * and that is what we wanted, not an error.
       */
      const arvore = atual.state.ratchetTree
      const jaLa = new Set<string>()
      for (const folha of leavesOf(arvore, address as UserAddress)) {
        const chave = deviceKeyAtLeaf(arvore, folha)
        if (chave) jaLa.add(toBase64(chave))
      }
      // Without a manifest, the account is single-device and the guard is the usual one:
      // any leaf of the address is "already there". With a manifest, only
      // devices with no leaf enter, and the packages of the others stay unspent in the
      // commit (they were already claimed, and that cannot be undone).
      const novos = manifesto === null && jaLa.size > 0 ? [] : pacotes.filter((p) => !jaLa.has(p.deviceKey))
      if (novos.length === 0) {
        if (tentativa > 1) return null
        throw new Error("that person is already in this channel", { cause: { address } })
      }

      let result
      try {
        const juntado = await this.#juntarComRetrato(
          channel,
          atual,
          novos.map((p) => p.pacote),
        )
        result = juntado.result
        estadoNoRetrato = juntado.estadoNoRetrato
      } catch (error) {
        // MLS validation failures are precise and completely unreadable. Translate
        // the ones a person can actually cause; anything else is a bug, and saying
        // so is more honest than dressing it up.
        const raw = (error as Error).message
        if (raw.includes("already in the group")) throw new Error("that person is already in this channel", { cause: { address } })
        if (raw.includes("Lifetime")) throw new Error("that person's invite key expired", { cause: { address } })
        throw new Error("could not add that person to this channel", { cause: { address, detalhe: raw } })
      }
      // The same key package on a second try is safe: the refused commit
      // was never saved, and its Welcome never left.
      return { commit: result.commit, session: result.session, welcome: { bytes: result.welcome, recipient: address } }
    })
    // Outside the queue: the republishes that this triggers call `send`, which goes back to the
    // queue. See the same note in `#unseat`.
    if (commitou) this.#announceLocalEpoch(channel, estadoNoRetrato ? "entregue" : undefined)
  }

  /**
   * Add people to the group, with the channel snapshot in the Welcome when the joiner
   * can read it (phase 1 of 1.1, `docs/planos/estado-cifrado-plano.md`).
   *
   * One hook for all Welcome entries: the invite by address, the link entry
   * admitted by any member (`#admit`), the reseat, the re-admission, and the seating
   * of a sibling device (all go through `#invite`).
   *
   * The snapshot goes if SOME new leaf declares the extension (an old leaf
   * receives it anyway, encrypted for it, and throws it away without noticing). The cascade
   * from `#announceLocalEpoch` only skips when ALL read it and the snapshot carries the
   * entire state (`completo`): an old leaf still needs the cascade.
   */
  async #juntarComRetrato(
    channel: string,
    atual: GroupSession,
    pacotes: Parameters<typeof declaraRetrato>[0][],
  ): Promise<{ result: AddMembersResult; estadoNoRetrato: boolean }> {
    const leem = pacotes.filter((pacote) => declaraRetrato(pacote)).length
    let retrato: RetratoMontado | null = null
    if (leem > 0 && channel !== this.canalDaConta) {
      try {
        retrato = this.#montarRetrato(channel, atual)
      } catch {
        // A snapshot that fails to build does not block the entry: it goes without it, and the cascade does the old one.
        retrato = null
      }
    }
    const result = await addMembers(atual, pacotes, retrato ? { retrato: retrato.bytes } : {})
    /*
      And all read the permissions model (1.2, `EXTENSAO_PERMISSOES`). A 1.1.0
      reads the snapshot but strips the `rank` and `perms` before verifying: a rank
      or room with them does not verify there and fails. With it in the Welcome the cascade
      runs, and they receive them live, authenticated by MLS.
    */
    const permissoes = pacotes.every((pacote) => declaraPermissoes(pacote))
    return { result, estadoNoRetrato: retrato !== null && retrato.completo && leem === pacotes.length && permissoes }
  }

  /**
   * The snapshot of this channel, from our vault. See `montarRetrato` in `retrato.ts`.
   *
   * Our profile goes whenever it would come out in a `publishProfile` (with name, or in
   * our profile wall, where it goes even without a name with the profile secret).
   */
  #montarRetrato(channel: string, grupo: GroupSession): RetratoMontado {
    const eu = this.identity.address
    const profile = this.profile
    const perfil = profile.displayName || channel === this.feedChannel ? (this.#payloadDoPerfil(profile, channel) as StoredPayload) : null
    return montarRetrato(
      {
        canal: channel,
        eu: this.#quemRelata(),
        conteudo: this.vault.contents,
        membros: [...new Set([...memberAddresses(grupo.state.ratchetTree).values()].map(String))],
        perfilProprio: perfil,
        fundador: this.founderOf(channel) === eu,
        gerePapeis: this.mayManageRoles(channel),
        arruma: this.mayEditChannel(channel),
        fixa: this.may(channel, "fixar"),
        cargosDe: (address) => this.rolesFor(channel, address),
      },
      Date.now(),
    )
  }

  async send(channel: string, payload: Payload): Promise<void> {
    await this.#sendPayload(channel, this.#comMencoesConferidas(channel, this.identity.address, payload))
  }

  /**
   * Multiple sends in a row on the same channel, with ONE vault save (slow-after-entry, 4/11/2026).
   *
   * Each `send` saves the entire vault before the frame leaves (see `#cifrarEEnviar`:
   * it is what prevents replaying a ratchet generation after a crash). In a
   * cascade from channel housekeeping (`republishAuthority`: one `role.assign` per
   * person with a rank, 80 in `!984`) it was ~100 vault saves per entry,
   * all with the group turn: measured at 13 MB, 101 saves and ~6 s CPU on an M4, during which
   * the next commit and media key waited.
   *
   * Here all are encrypted, in order, inside ONE group turn; the vault is saved
   * once, with the ratchet after the last one; and only then the frames leave,
   * in the same order. The guarantee is the same as a single `send`: no frame leaves before
   * the disk has a ratchet ahead of it. A crash before the save did not let anything out,
   * and the disk has the ratchet from before; a crash after has the ratchet on disk
   * after all, and nothing is encrypted again with the spent generations. The receiver sees
   * the same payloads, one by one, as always.
   *
   * Only at normal pace. With the bucket in slow mode (one rate refusal), each
   * send waits for the echo of the previous one, and the batch goes to `send` one by one, as before.
   * The book (friends, invites) too, because it has its own receipt.
   */
  async #enviarEmLote(channel: string, payloads: readonly Payload[]): Promise<void> {
    if (!this.#groups.has(channel)) throw new Error("not a member of this channel", { cause: { channel } })
    const vida = this.#vida
    const preparados = payloads.map((payload) => {
      const conferido = this.#comMencoesConferidas(channel, this.identity.address, payload)
      return channel !== this.canalDaConta ? comAutoria(channel, conferido, this.#quemRelata()) : conferido
    })
    const emLote = (payload: Payload): boolean =>
      payload.t !== "typing" && payload.t !== "buzz" && !isFriendPayload(payload) && !isInvitePayload(payload)
    let feitos = 0
    if (preparados.length > 1 && preparados.every(emLote)) {
      feitos = await this.#umDeCadaVezNoGrupo(channel, async () => {
        await this.#drenarRepeticoes(channel, vida)
        const emCurso: { envio: Promise<Enviado>; soltar: (erro?: unknown) => void; payload: Payload }[] = []
        for (const payload of preparados) {
          if (this.#porRepetir.has(channel)) break
          const vez = this.#vezSemEspera("envios")
          if (vez !== VEZ_LIVRE) {
            vez?.largar()
            break
          }
          let chegou!: () => void
          const chegada = new Promise<void>((resolve) => (chegou = resolve))
          let soltar!: (erro?: unknown) => void
          const passar = new Promise<void>((resolve, reject) => (soltar = (erro) => (erro === undefined ? resolve() : reject(erro))))
          const envio = this.#cifrarEEnviar(channel, payload, vez, vida, null, { chegou, passar })
          envio.catch(() => {})
          // One at a time until the barrier: the ratchet moves by batch order.
          await Promise.race([chegada, envio.then(() => {}, () => {})])
          emCurso.push({ envio, soltar, payload })
        }
        try {
          await this.flush()
        } catch (erro) {
          // No save, nothing leaves: each one fails like a `send` whose `flush`
          // failed, and the group in memory gets ahead of disk, as there.
          for (const { soltar } of emCurso) soltar(erro)
          throw erro
        }
        // Saved: all leave, in order. One that fails does not hold up the others,
        // which already have the ratchet on disk; the first error is reported at the end.
        let saidos = 0
        let primeiroErro: unknown = null
        for (const { envio, soltar, payload } of emCurso) {
          soltar()
          try {
            await envio
            if (channel !== this.canalDaConta) this.emit("message", { channel, seq: -1, sender: this.identity.address, payload })
          } catch (erro) {
            primeiroErro ??= erro
          }
          saidos++
        }
        if (primeiroErro !== null) throw primeiroErro
        return saidos
      })
    }
    // What did not fit in the batch (slow pace, retries, book, just one): one by one,
    // by the same path as `send` (not through the public `send` again,
    // which is where a test counts: each payload is counted once, in the batch).
    for (const payload of payloads.slice(feitos)) {
      await this.#sendPayload(channel, this.#comMencoesConferidas(channel, this.identity.address, payload))
    }
  }

  /**
   * Send all of these, in order, with one vault save. See `#enviarEmLote`.
   * The cascade calls it here, not the private one, for the same reason it
   * calls `send`: it is the point where a test sees what leaves.
   */
  async sendBatch(channel: string, payloads: readonly Payload[]): Promise<void> {
    await this.#enviarEmLote(channel, payloads)
  }

  /**
   * The message with the mention of everyone (`MENCAO_TODOS`) only if the author has
   * `mencionartodos` in that room. Without the permission, the mention leaves and the rest stays.
   *
   * Runs on both sides, with the same rule (`mencoesConferidas`, in the
   * protocol): on send, before the signature, so this app never puts it in
   * the thread without the permission; and on delivery to the interface (`message` and `history`),
   * so an altered app's copy comes as plain text. The permission reads from the
   * ranks that this device knows NOW, as with the tomb of someone who moderates.
   *
   * Returns the SAME object when nothing changes. Never changes what is in the vault:
   * the saved payload is the signed one, and that is what is reported.
   */
  #comMencoesConferidas<P extends { t: string }>(channel: string, sender: string, payload: P): P {
    if (payload.t !== "message") return payload
    const mentions = (payload as { mentions?: unknown }).mentions
    if (!Array.isArray(mentions) || !mentions.includes(MENCAO_TODOS)) return payload
    const room = (payload as { room?: unknown }).room
    const sala = typeof room === "string" ? room : DEFAULT_ROOM.room
    const pode = !this.#eDirecta(channel) && this.permissoesEm(channel, sender, sala).includes("mencionartodos")
    const conferidas = mencoesConferidas(mentions as string[], pode)
    return conferidas === mentions ? payload : { ...payload, mentions: [...conferidas] }
  }

  /**
   * The same `send`, returning the reference that the server returns in the echo.
   *
   * Exists because of one question alone, and it is from `leaveChannel`: "did this really
   * reach the server?". `#send` only guarantees that the frame entered an open socket,    * the server can refuse it after (`channel.rejected`), and in that case everything
   * looked fine on this side. For a chat message that is acceptable; for the exit from
   * a channel that precedes deleting the account, it is not: the person would be convinced
   * they left, with the leaf in the tree and the vault destroyed. See `#confirmado`.
   *
   * **The `ref` returned must be the one that went INTO THE THREAD.** It is what ties the two
   * rewrites that this `send` suffered at the same time: the queue per channel, which
   * decides when the frame leaves, and the receipt, which needs to know which
   * reference it left with. Returning any other makes `leaveChannel` wait for
   * an echo that never comes, and at the end of the timeout the account refuses to delete
   * because of an exit that actually ran fine. Proved by mutation.
   *
   * Mark it on exit, inside the queue, not before waiting the turn: `#ownRefs`
   * has 512 slots and dumps the oldest, so a reference marked before a long wait
   * is the first to be dumped, when it is the last to need to be recognized. **This is
   * reasoning, not measurement**, no test tells the two positions apart, and it is
   * stated this way in `docs/PENDENTES.md`.
   */
  async #sendPayload(channel: string, payload: Payload): Promise<string> {
    if (!this.#groups.has(channel)) throw new Error("not a member of this channel", { cause: { channel } })
    // The life of this account in the session (S6): what to expect from the pace and wake
    // after an account switch does not leave. See `#vida`.
    const vida = this.#vida
    // The authorship (S4): the signature of this device in the reportable types. See `comAutoria`.
    if (channel !== this.canalDaConta) payload = comAutoria(channel, payload, this.#quemRelata())
    /*
      The lists followed in my feed (see `#listasSeguidas`). Counted here, on the
      path that ALL sends go through, so no shortcut lets them pass the cap;
      and any other send of ours in the feed resets the count.
    */
    // Rate retries do not pass here (`#drenarRepeticoes` goes straight to
    // `#cifrarEEnviar`): the refused list was already counted, and the guard refused it
    // on the second try (S6 revision).
    if (channel === this.feedChannel && payload.t === "friends.shown" && this.#listasSeguidas >= Session.LISTAS_SEGUIDAS_MAX) {
      throw new Error("too many friend lists in a row", { cause: { channel } })
    }

    /**
     * What is ephemeral is not a said thing.
     *
     * On the receiver side it is already cut in `#applyEvent`; on this side
     * it would have to be cut again, otherwise our own signal would enter our
     * list of messages in memory, every four seconds of writing,
     * and every elbow. That list has 400 slots per channel, which is
     * exactly the budget that real messages need for themselves.
     */
    const efemero = payload.t === "typing" || payload.t === "buzz"

    /**
     * The book (friends and invites) is only saved after the server accepts it.
     *
     * A chat message is saved before it leaves, and if it does not leave a text stays
     * on screen that did not arrive: bad, but visible. A book act saved and not sent is worse,
     * because it is state: the `friend.accept` stayed in the vault, the fold on this side
     * said "friends", the other side stayed in "request sent", and the accept button
     * disappeared with no way to retry it (F2 of the sync audit, 20/10/2026).
     *
     * So here we wait for the echo like `leaveChannel` waits, and we save with the
     * `seq` it brings. The real `seq` is the other half of the fix: two devices
     * of the same account answering the same request at the same time would double the two acts
     * in different orders (each put its own first, with `-1`), and diverged. With the server's number,
     * all three sides read the same order. If there is no echo, nothing is saved and the error
     * goes up: the request stays unanswered and the button stays there.
     */
    const doLivro = !efemero && (isFriendPayload(payload) || isInvitePayload(payload))

    /*
      One send at a time, PER CHANNEL. See `#umDeCadaVezNoGrupo`.

      Encrypting advances the sender's ratchet, and advancing it is a read
      followed by a write with async work in between. Two overlapping sends
      both read the same ratchet and produce the SAME generation: the receiver
      opens one and refuses the other with "Desired gen in the past", while on
      the sender's screen both appear, because our own send enters the local
      history without going through MLS.

      No one needs to write fast for this to happen: the "is typing" signal
      goes out without `await`, and the same goes for `republishRooms` and
      `publishProfile` after someone joins the channel. It only takes one of
      those to catch the message halfway through.
    */
    const enviado = await this.#umDeCadaVezNoGrupo(channel, async () => {
      /*
        Retries by rate for this channel go out FIRST, in the order they were
        sent, and only then this one (S6 revision). They used to go to the end
        of the queue: two edits in a row with the first refused gave the first
        the larger `seq`, and everyone ended up with the old text. Same for
        `channel.meta`, roles, and profile, which are the last to be sent.

        In a loop: a refusal that arrives while waiting its turn puts another
        retry ahead, and it also goes first.
      */
      for (;;) {
        await this.#drenarRepeticoes(channel, vida)
        const vez = await this.#esperarVez("envios", vida)
        if (!this.#porRepetir.has(channel)) return this.#cifrarEEnviar(channel, payload, vez, vida, null)
        vez.largar()
      }
    })

    if (enviado.recibo) {
      // Outside the queue: the echo arrives via `#onFrame`, which does not wait for it.
      let atual = enviado
      let seq: number
      for (;;) {
        try {
          seq = await (atual.recibo as Promise<number>)
          break
        } catch (erro) {
          // Refused by rate: it did not land on the server, so the mark comes out and
          // the send retries at the front of the channel queue, with a new mark and
          // receipt (S6). Give up by time: then the retry rejects, and the error rises.
          if (!(erro instanceof EnvioRecusadoPorRitmo) || !atual.repeticao) throw erro
          if (atual.marca) this.#largarMarcaDoLivro(atual.marca)
          atual = await atual.repeticao
        }
      }
      if (atual.marca) this.#largarMarcaDoLivro(atual.marca)
      this.#recordPayload(channel, seq, this.identity.address, payload)
      await this.flush()
      this.emit("message", { channel, seq, sender: this.identity.address, payload })
      return atual.ref
    }

    // Our own message never round-trips through MLS, so this is the only place
    // it can enter the local timeline. Outside the queue on purpose: whoever
    // listens to this can call `send` again, and an emit inside the queue would
    // make that call wait for itself.
    if (!efemero && channel !== this.canalDaConta) this.emit("message", { channel, seq: -1, sender: this.identity.address, payload })
    return enviado.ref
  }

  /**
   * Encrypt and put a send on the wire, with the rate slot already in hand.
   * Runs INSIDE the channel queue: the caller holds it.
   *
   * `repeticao` is from a rate refusal (S6): the send is already in the vault
   * and on screen, and only the frame goes out again, encrypted again, with
   * the `ordem` and first refusal from when it was sent.
   */
  async #cifrarEEnviar(
    channel: string,
    payload: Payload,
    vez: VezDeEnvio,
    vida: number,
    repeticao: Reenviavel | null,
    barreira: BarreiraDoLote | null = null,
  ): Promise<Enviado> {
    const reenvio = repeticao !== null
    const efemero = payload.t === "typing" || payload.t === "buzz"
    const doLivro = !efemero && (isFriendPayload(payload) || isInvitePayload(payload))
    try {
      // Read HERE INSIDE: whoever waited its turn must encrypt from the ratchet
      // that the previous send left, not the one it saw when it arrived.
      if (vida !== this.#vida) throw new Error("the session ended")
      const group = this.#groups.get(channel)
      if (!group) throw new Error("not a member of this channel", { cause: { channel } })
      // The account channel only carries state to leaves of this account (B1). The
      // full guard, with the manifest, is `#confiarNoCanalDaConta`; this is the
      // sync part, and is the last gate before the cipher goes out.
      if (channel === this.canalDaConta && this.#folhaDeOutraConta(group)) {
        throw new Error("account-channel-foreign", { cause: { channel } })
      }

      const result = await encryptPayload(group, payload)
      const ciphertext = toBase64(result.ciphertext)
      // Before persisting, before emitting: see MAX_SEALED_BYTES. The ratchet
      // advance made just above is discarded with the throw — nothing went out,
      // so nothing can be re-encrypted under a used key.
      if (ciphertext.length > MAX_SEALED_BYTES) {
        throw new Error("too large to send", { cause: { channel } })
      }

      /**
       * Persist before the ciphertext leaves, and do not defer it.
       *
       * Encrypting has already advanced the sender ratchet. If we let the batched
       * flush handle this and the process dies inside its window, the next launch
       * restores pre-send state and encrypts *new plaintext under the same key and
       * nonce* — the one thing an AEAD must never do, leaking the XOR of two
       * messages and forging the authenticator.
       *
       * Batching remains correct for receiving, where a lost update costs only a
       * re-decrypt. Sending is the asymmetric case, so it pays for a synchronous
       * write.
       */
      await this.#persistGroup(channel, result.session)
      // The state we publish (profile, roles, rooms, publications) is saved as
      // always before it goes out. Only the CONVERSATION MESSAGE waits for the
      // send: see the end of this section. The ledger is saved with the echo.
      const mensagem = payload.t === "message"
      // The account channel is not a conversation: the state that comes out there is already in the vault (phase 5).
      const daConta = channel === this.canalDaConta
      /*
        The `seq` of the echo in all sends (S1, §7.2). What is saved now, with
        -1, carries the order mark (`apos`), and waits for the echo by event
        key: the live echo (`#ecos`) or, if lost, recovery, which recognizes it
        by bytes (`enviosPorConfirmar`). Only for what has `id`, which is what
        goes to history. The ledger has its own rule, stronger.
      */
      const apos = this.vault.contents.lastSeq[channel] ?? -1
      const chave = !efemero && !doLivro && !daConta ? chaveDoEvento({ sender: this.identity.address, payload }) : null
      // A resend of what already has `seq` does not wait for any echo: the echo
      // changes nothing, and the mark would exceed the cap on marks (finding 5).
      const porConfirmar = chave !== null && !chaveConfirmada(this.vault.contents, channel, chave)
      const marcaDoEco = porConfirmar ? resumoDoLivro(result.ciphertext) : null
      if (chave !== null && marcaDoEco !== null) this.#marcarEnvioPorConfirmar(marcaDoEco, channel, chave)
      if (!efemero && !doLivro && !mensagem && !daConta && !reenvio) this.#recordPayload(channel, -1, this.identity.address, payload, apos)
      // The ledger is marked in the vault BEFORE it goes out, by a digest of the
      // bytes: an echo that arrives after the receipt timeout, or only in recovery,
      // still recognizes it and saves it (I3). Without the mark, a send that landed
      // on the server never entered the vault of whoever made it. See
      // `#reconhecerLivroNosso`.
      const marca = doLivro ? resumoDoLivro(result.ciphertext) : null
      if (marca) {
        this.vault.contents.livroPorConfirmar = {
          ...this.vault.contents.livroPorConfirmar,
          [marca]: { channel, payload: structuredClone(payload) as StoredChatMessage["payload"], at: Date.now() },
        }
      }
      /*
        In a batch (`#enviarEmLote`) the save is the batch's: we wait here, with
        the ratchet already advanced and the group in memory, until all in the
        batch are encrypted and the vault is saved ONCE with the ratchet after
        all. Nothing from this batch goes out before that save, which is the
        rule above.
        */
      if (barreira) {
        barreira.chegou()
        await barreira.passar
      } else await this.flush()

      // Marked here, on the way out, and returned to whoever wants the receipt.
      // See the header: the queue decides when this frame goes out, so the queue
      // must say with what reference it went out.
      const ref = this.#markOwn()
      // The wait is logged BEFORE the frame goes out, as in `#publicarCommit`: a
      // fast echo cannot arrive at a map where no one is waiting yet.
      const recibo = doLivro ? this.#confirmado(ref, channel) : null
      if (chave !== null && marcaDoEco !== null) this.#ecos.set(ref, { channel, chave, marca: marcaDoEco })
      // What retries if the server refuses it by rate. The channel send does not:
      // whoever asks for it waits for this `ref`'s receipt and learns the result.
      // The ledger does, and whoever waits for its receipt also waits for the
      // retry (`repeticao`).
      let repeticaoDoLivro: Promise<Enviado> | null = null
      if (repeteSeRecusado(payload)) {
        let livro: Extract<Reenviavel, { tipo: "payload" }>["livro"] = null
        if (doLivro) {
          repeticaoDoLivro = new Promise<Enviado>((resolver, rejeitar) => {
            livro = { resolver, rejeitar }
          })
          // What waits is the receipt; a give-up with no one waiting is not a loose error.
          repeticaoDoLivro.catch(() => {})
        }
        this.#guardarReenviavel(ref, {
          tipo: "payload",
          channel,
          payload,
          livro,
          ordem: repeticao?.ordem ?? this.#proximaOrdem(),
          primeiraRecusa: repeticao?.primeiraRecusa ?? null,
          vida,
        })
      }
      try {
        this.#send({
          t: "channel.send",
          channel,
          kind: "application",
          ciphertext,
          ref,
        })
        vez.saiu(ref, true)
      } catch (erro) {
        if (recibo) {
          recibo.catch(() => {})
          this.#confirmacoes.get(ref)?.reject(erro as Error)
          this.#ownRefs.delete(ref)
        }
        // Did not go out: no echo to recognize.
        if (marca) this.#largarMarcaDoLivro(marca)
        if (marcaDoEco) this.#largarEnvioPorConfirmar(marcaDoEco)
        this.#ecos.delete(ref)
        this.#reenviaveis.delete(ref)
        throw erro
      }
      /*
        Our conversation message enters history ONLY AFTER the frame goes out
        (phase 4 revision). Saved before, a `#send` that threw (no connection)
        left a message in the vault that never went out, and resend from the
        outbox saved a second copy. Only messages: it is theirs, the outbox,
        and the rest of published state has another rule. The group keeps
        saving BEFORE (it is the nonce, see above). `seq` -1: never loops,
        never gains one. The ledger does not: it saves with the echo.

        In memory now, and on disk RIGHT AFTER, without waiting: a save
        scheduled for the next microtask (`#gravarJa`), outside this queue and
        without holding it. Waiting for it here cost 180 to 380 ms per message
        on a 5 to 10 MB vault (measured 20/10/2026), and leaving it for the
        `FLUSH_MS` batch lost the message from whoever closes the tab right after
        sending, even with `pagehide` (`scripts/e2e-separadores.mjs`, on all
        three engines). Correctness before latency. Several messages in a row
        merge into one save.
      */
      // The count of followed lists only touches what WENT OUT: a frame that did
      // not go out never reached any old client. See `#listasSeguidas`.
      if (channel === this.feedChannel && !reenvio) {
        if (payload.t === "friends.shown") this.#listasSeguidas += 1
        else if (!efemero) this.#outroEventoNoFeed()
      }
      if (mensagem && !reenvio) {
        this.#recordPayload(channel, -1, this.identity.address, payload, apos)
        // Already in the vault IN MEMORY, so whoever reads it next (`history`, the
        // ticket board) sees it; on disk, with the batch.
        this.#drainRecords(this.vault.contents)
        this.#memoriaPorGravar = true
        this.#gravarJa()
      }
      return { ref, recibo, marca, repeticao: repeticaoDoLivro }
    } finally {
      // After `saiu`, does nothing; before (cipher failed, send too big, no
      // connection), the slot passes to the next one.
      vez.largar()
    }
  }

  /**
   * How long to keep trying a send refused by rate before giving up.
   *
   * By TIME, not by number of refusals (S6 revision). It was twenty tries;
   * with the cap letting one send through at a time, a single place's
   * `retryAfterMs` is only 1 ms, and twenty refusals blew past in seconds
   * without the account spending a minute sending. Ten minutes from the first
   * refusal is an account sending non-stop, and then the report says it gave up.
   * What has authorship stays in the vault and anti-entropy still carries it.
   * Static for tests to shorten it.
   */
  static PRAZO_DOS_REENVIOS_MS = 10 * 60_000

  /**
   * Random jitter added to each pause, in ms.
   *
   * Without it, retries from all devices on the account woke up at the SAME
   * millisecond (the `retryAfterMs` is the same for all), fought for the same
   * slot, and all but one were refused again.
   */
  static readonly VARIACAO_DO_RITMO_MS = 250

  /**
   * In slow mode, how long to wait for a send's echo before letting the next
   * one go out. A lost echo cannot hold up the account's sends; past this, the
   * next goes out and slow mode stays on.
   */
  static ESPERA_PELO_ECO_LENTO_MS = 10_000

  /** In slow mode, the wait for a send with no echo (the Welcome): the time for the refusal to arrive, if it does. */
  static ESPERA_SEM_ECO_MS = 1_000

  /** How many inflight sends to keep to retry. The oldest goes out. */
  static readonly REENVIAVEIS_MAX = 1024

  /**
   * This account's lifetime in the session: rises in `reset()`.
   *
   * A retry waiting for rate survived an account swap on the same `Session`
   * (lock and unlock another, import another vault) and went out encrypted as
   * the next account, with the first one's payload: A's profile on B's leaf,
   * and the same with a Welcome or commit (S6 revision). Whoever waits grabs
   * the lifetime at the start and stops if it changed.
   */
  #vida = 0

  /**
   * The inflight sends that retry if the server refuses them by rate, by `ref`.
   * They go out with the echo, with the refusal, or by the cap. Memory only: a
   * refusal only arrives on the live connection that carried the frame.
   */
  #reenviaveis = new Map<string, Reenviavel>()

  /**
   * Sends refused by rate, per channel and in the `ordem` they were sent, waiting
   * to go out ahead of the rest of that channel's queue. See `#drenarRepeticoes`.
   */
  #porRepetir = new Map<string, Reenviavel[]>()

  /** Channels with a `#drenarRepeticoes` pass already in the queue. */
  #drenosAgendados = new Set<string>()

  /** The order of the next send. See `Reenviavel.ordem`. */
  #ordemDosEnvios = 0

  /** The `ref`s of commits and Welcomes inflight: their refusal is from the `handshake` bucket. */
  #refsDeHandshake = new Set<string>()

  static #ritmoNovo(): Record<BaldeDeEnvio, { pausadoAte: number; lento: boolean; emVoo: EmVoo | null }> {
    return {
      envios: { pausadoAte: 0, lento: false, emVoo: null },
      handshake: { pausadoAte: 0, lento: false, emVoo: null },
    }
  }

  /**
   * The rate of each server bucket (S6).
   *
   * `pausadoAte`: nothing from that bucket goes out before this. `lento`: after
   * a refusal, ONE send at a time, for the whole account, waiting for the echo
   * or refusal before the next, until one is accepted. `emVoo`: that send.
   *
   * Slow mode is what holds the ratchet (S6 revision): each refused send
   * burns one generation for the receiver, and above 512 in a row (`suite.ts`)
   * the receiver goes deaf until the next commit. Without it, a whole burst
   * would go out before the first refusal arrived, and go out again whole at
   * each pause expiry.
   */
  #ritmo = Session.#ritmoNovo()

  /** Refusals by rate in a row in the message bucket, since the last accepted send, and the longest streak. */
  #recusasSeguidas = 0
  #maiorSerieDeRecusas = 0

  /**
   * The state of send rate, for the report and for tests.
   *
   * `maiorSerie` is the longest run of refusals in a row in the message bucket
   * with no accepted send in between: the upper bound of generations this
   * device made jump for the receiver.
   */
  ritmoDosEnvios(): { lento: Record<BaldeDeEnvio, boolean>; recusasSeguidas: number; maiorSerie: number; porRepetir: number } {
    let porRepetir = 0
    for (const fila of this.#porRepetir.values()) porRepetir += fila.length
    return {
      lento: { envios: this.#ritmo.envios.lento, handshake: this.#ritmo.handshake.lento },
      recusasSeguidas: this.#recusasSeguidas,
      maiorSerie: this.#maiorSerieDeRecusas,
      porRepetir,
    }
  }

  #proximaOrdem(): number {
    this.#ordemDosEnvios += 1
    return this.#ordemDosEnvios
  }

  #guardarReenviavel(ref: string, entrada: Reenviavel): void {
    this.#reenviaveis.set(ref, entrada)
    if (this.#reenviaveis.size > Session.REENVIAVEIS_MAX) {
      const antiga = this.#reenviaveis.keys().next().value
      if (antiga !== undefined) this.#reenviaveis.delete(antiga)
    }
  }

  #marcarHandshake(ref: string): void {
    this.#refsDeHandshake.add(ref)
    if (this.#refsDeHandshake.size > 512) {
      const antiga = this.#refsDeHandshake.values().next().value
      if (antiga !== undefined) this.#refsDeHandshake.delete(antiga)
    }
  }

  /**
   * The slot to send in this bucket now, or `null` if we must wait (pause, or
   * another send inflight in slow mode). Sync: whoever gets it has it in hand
   * before yielding the turn.
   */
  #vezSemEspera(balde: BaldeDeEnvio): VezDeEnvio | null {
    const estado = this.#ritmo[balde]
    if (estado.pausadoAte > Date.now()) return null
    if (!estado.lento) return VEZ_LIVRE
    if (estado.emVoo) return null
    let libertar!: () => void
    const libertada = new Promise<void>((resolve) => {
      libertar = resolve
    })
    const emVoo: EmVoo = { ref: null, libertada, libertar: () => {}, relogio: undefined }
    emVoo.libertar = () => {
      if (emVoo.relogio) clearTimeout(emVoo.relogio)
      if (estado.emVoo === emVoo) estado.emVoo = null
      libertar()
    }
    estado.emVoo = emVoo
    return {
      saiu: (ref, comEco) => {
        emVoo.ref = ref
        emVoo.relogio = setTimeout(emVoo.libertar, comEco ? Session.ESPERA_PELO_ECO_LENTO_MS : Session.ESPERA_SEM_ECO_MS)
      },
      largar: () => {
        if (emVoo.ref === null) emVoo.libertar()
      },
    }
  }

  /**
   * Wait for the send slot in this bucket: until the pause is in the past and,
   * in slow mode, until the inflight send has an echo or refusal.
   *
   * In a LOOP (S6 revision): it waited once, and a pause stretched by another
   * refusal in the meantime was not respected. And stops if the session
   * switched accounts while waiting (`#vida`).
   */
  async #esperarVez(balde: BaldeDeEnvio, vida: number): Promise<VezDeEnvio> {
    for (;;) {
      if (vida !== this.#vida) throw new Error("the session ended")
      const vez = this.#vezSemEspera(balde)
      if (vez) return vez
      const estado = this.#ritmo[balde]
      const espera = estado.pausadoAte - Date.now()
      if (espera > 0) await new Promise((resolve) => setTimeout(resolve, espera))
      else if (estado.emVoo) await estado.emVoo.libertada
    }
  }

  /** The send with this `ref` had an echo: it was accepted, and that bucket's slow mode ends. */
  #aoEcoDoEnvio(ref: string): void {
    this.#refsDeHandshake.delete(ref)
    for (const balde of ["envios", "handshake"] as const) {
      const estado = this.#ritmo[balde]
      if (estado.emVoo?.ref === ref) {
        estado.lento = false
        estado.emVoo.libertar()
      }
    }
    if (this.#reenviaveis.delete(ref) || this.#ownRefs.has(ref)) this.#recusasSeguidas = 0
  }

  /** The flight send with this `ref` got a response that wasn't accepted: the turn passes, slow mode stays on. */
  #libertarVezDe(ref: string): void {
    for (const balde of ["envios", "handshake"] as const) {
      const emVoo = this.#ritmo[balde].emVoo
      if (emVoo?.ref === ref) emVoo.libertar()
    }
  }

  #libertarVezes(): void {
    for (const balde of ["envios", "handshake"] as const) this.#ritmo[balde].emVoo?.libertar()
  }

  /** All pending retries leave, and whoever waits for the ledger receipt knows why. */
  #largarRepeticoes(motivo: string): void {
    for (const fila of this.#porRepetir.values()) {
      for (const entrada of fila) if (entrada.tipo === "payload") entrada.livro?.rejeitar(new Error(motivo))
    }
    this.#porRepetir.clear()
    this.#drenosAgendados.clear()
  }

  #agendarDreno(channel: string): void {
    if (this.#drenosAgendados.has(channel)) return
    this.#drenosAgendados.add(channel)
    const vida = this.#vida
    void this.#umDeCadaVezNoGrupo(channel, async () => {
      this.#drenosAgendados.delete(channel)
      await this.#drenarRepeticoes(channel, vida)
    }).catch((erro: unknown) => {
      if (vida !== this.#vida) return
      this.emit("status", {
        detail: `${channel}: as repetições de envios recusados por ritmo pararam (${(erro as Error).message})`,
        level: "error",
        code: "send-rate-limited",
        route: "log",
        channel,
      })
    })
  }

  /**
   * The rate-based retries for this channel, one by one and in the order they
   * were sent, each with its own turn. Runs INSIDE the channel queue: that's
   * what puts them ahead of what hasn't left yet.
   */
  async #drenarRepeticoes(channel: string, vida: number): Promise<void> {
    for (;;) {
      const primeira = this.#porRepetir.get(channel)?.[0]
      if (!primeira) return
      const balde: BaldeDeEnvio = primeira.tipo === "welcome" ? "handshake" : "envios"
      const vez = await this.#esperarVez(balde, vida)
      // Check again: while waiting, a lower-order one may have arrived.
      const fila = this.#porRepetir.get(channel)
      const entrada = fila?.[0]
      if (!fila || !entrada || (entrada.tipo === "welcome" ? "handshake" : "envios") !== balde) {
        vez.largar()
        continue
      }
      fila.shift()
      if (fila.length === 0) this.#porRepetir.delete(channel)
      if (entrada.vida !== this.#vida) {
        vez.largar()
        continue
      }
      if (Date.now() - (entrada.primeiraRecusa ?? Date.now()) > Session.PRAZO_DOS_REENVIOS_MS) {
        vez.largar()
        const motivo = `um envio recusado por ritmo durante ${Math.round(Session.PRAZO_DOS_REENVIOS_MS / 1000)} s; desisti dele`
        if (entrada.tipo === "payload") entrada.livro?.rejeitar(new Error(motivo))
        this.emit("status", { detail: `${channel}: ${motivo}`, level: "error", code: "send-rate-limited", route: "log", channel })
        continue
      }
      if (entrada.tipo === "payload" && !repeteSeRecusado(entrada.payload)) {
        // The voice that's no longer fresh: replaying it now would lie (see `VOZ_REPETE_ATE_MS`).
        vez.largar()
        entrada.livro?.rejeitar(new Error("too late to repeat"))
        continue
      }
      try {
        if (entrada.tipo === "welcome") {
          this.#sairWelcome(channel, entrada.welcome, vez, entrada)
        } else {
          const enviado = await this.#cifrarEEnviar(channel, entrada.payload, vez, entrada.vida, entrada)
          entrada.livro?.resolver(enviado)
        }
      } catch (erro) {
        vez.largar()
        if (entrada.tipo === "payload") entrada.livro?.rejeitar(erro as Error)
        if (vida !== this.#vida) throw erro
        this.emit("status", {
          detail: `${channel}: a repetição de um envio recusado por ritmo falhou (${(erro as Error).message})`,
          level: "error",
          code: "send-rate-limited",
          route: "log",
          channel,
        })
      }
    }
  }

  /**
   * The server rejected our send for rate limiting (S6, `channel.rejected` with
   * `rate-limited`). It wasn't stored or delivered.
   *
   * Until 21/10/2026 the rejection was silent, and the send stayed in the vault
   * as done without reaching anyone. Now: that send's bucket stops until there's
   * room, with backoff, and enters slow mode; whoever waits for the receipt of
   * this `ref` knows why (commits retry along their path); the rest goes to the
   * front of its channel queue, to leave encrypted again without re-entering the
   * vault or the screen. The echo marker leaves: the echo of these bytes never
   * comes.
   */
  #aoRecusaPorRitmo(channel: string, ref: string | undefined, retryAfterMs: number | undefined): void {
    const balde: BaldeDeEnvio = ref !== undefined && this.#refsDeHandshake.has(ref) ? "handshake" : "envios"
    const espera =
      Math.min(Math.max(retryAfterMs ?? 1_000, 50), 60_000) + Math.floor(Math.random() * Session.VARIACAO_DO_RITMO_MS)
    const agora = Date.now()
    const estado = this.#ritmo[balde]
    const jaParado = estado.pausadoAte > agora
    estado.pausadoAte = Math.max(estado.pausadoAte, agora + espera)
    estado.lento = true
    if (balde === "envios") {
      this.#recusasSeguidas += 1
      this.#maiorSerieDeRecusas = Math.max(this.#maiorSerieDeRecusas, this.#recusasSeguidas)
    }
    if (!jaParado) {
      this.emit("status", {
        detail: `${channel}: o servidor recusou envios por ritmo; repetem-se daqui a ${espera} ms`,
        level: "info",
        code: "send-rate-limited",
        route: "log",
        channel,
      })
    }
    if (ref === undefined) return
    this.#refsDeHandshake.delete(ref)
    this.#ownRefs.delete(ref)
    const eco = this.#ecos.get(ref)
    if (eco) {
      this.#ecos.delete(ref)
      this.#largarEnvioPorConfirmar(eco.marca)
    }
    this.#confirmacoes.get(ref)?.reject(new EnvioRecusadoPorRitmo(espera))
    const repetir = this.#reenviaveis.get(ref)
    if (repetir) {
      this.#reenviaveis.delete(ref)
      if (repetir.vida === this.#vida) {
        repetir.primeiraRecusa ??= agora
        const fila = this.#porRepetir.get(repetir.channel) ?? []
        const lugar = fila.findIndex((outra) => outra.ordem > repetir.ordem)
        if (lugar < 0) fila.push(repetir)
        else fila.splice(lugar, 0, repetir)
        this.#porRepetir.set(repetir.channel, fila)
        this.#agendarDreno(repetir.channel)
      }
    }
    // Only at the end: whoever wakes with the turn must already see the retry in the queue.
    this.#libertarVezDe(ref)
  }

  /**
   * The echoes we wait for live, by the `ref` the send left with (S1).
   *
   * Memory only: if the connection drops before the echo, the mark in the vault
   * (`enviosPorConfirmar`) lets recovery recognize the send by its bytes.
   */
  #ecos = new Map<string, { channel: string; chave: string; marca: string }>()

  /** How many marks of sends awaiting confirmation the vault stores. The oldest leaves. */
  static readonly ENVIOS_POR_CONFIRMAR_MAX = 512

  #marcarEnvioPorConfirmar(marca: string, channel: string, chave: string): void {
    const marcas = { ...this.vault.contents.enviosPorConfirmar, [marca]: { channel, chave, at: Date.now() } }
    const chaves = Object.keys(marcas)
    for (const antiga of chaves.slice(0, Math.max(0, chaves.length - Session.ENVIOS_POR_CONFIRMAR_MAX))) delete marcas[antiga]
    this.vault.contents.enviosPorConfirmar = marcas
  }

  #largarEnvioPorConfirmar(marca: string): void {
    const marcas = this.vault.contents.enviosPorConfirmar
    if (!marcas || !(marca in marcas)) return
    const { [marca]: _tirada, ...resto } = marcas
    this.vault.contents.enviosPorConfirmar = resto
  }

  /**
   * The echo of our send arrived: the entry stored with -1 now gets the
   * server's `seq` (`confirmarSeq`). Already in memory, to disk with the next
   * save (scheduled right away).
   */
  #confirmarEco(channel: string, chave: string, seq: number, marca: string): void {
    if (!this.vault.unlocked) return
    this.#largarEnvioPorConfirmar(marca)
    // Our friend send that gains a `seq` can move place in the fold.
    if (confirmarSeq(this.vault.contents, channel, chave, seq) && chave.startsWith("friend.")) this.#avisarAmizades()
    this.#memoriaPorGravar = true
    this.#gravarJa()
  }

  /** Remove a mark from the ledger to confirm. Saves on the next flush. */
  #largarMarcaDoLivro(marca: string): void {
    const marcas = this.vault.contents.livroPorConfirmar
    if (!marcas || !(marca in marcas)) return
    const { [marca]: _tirada, ...resto } = marcas
    this.vault.contents.livroPorConfirmar = resto
  }

  /**
   * A server event is an act of ours from the ledger that missed its receipt? Save it.
   *
   * Our own send doesn't decrypt on this side (MLS won't allow it), so we
   * recognize it by its bytes, like commits waiting for confirmation. It arrives
   * through three gates: the echo with our `ref` after the receipt deadline
   * passes, recovery from a later connection, and `backfillBefore`. In any case
   * it brings the real `seq`, which is what the fold wants.
   *
   * @returns whether it was one of ours.
   */
  #reconhecerLivroNosso(channel: string, seq: number, bytes: Uint8Array): boolean {
    if (!this.vault.unlocked || seq < 0) return false
    // Our send outside the ledger, with the entry already stored with -1: gains the
    // `seq` (S1). Nothing new saves, just the number gets fixed.
    const envios = this.vault.contents.enviosPorConfirmar
    if (envios && Object.keys(envios).length > 0) {
      const marcaDoEnvio = resumoDoLivro(bytes)
      const envio = envios[marcaDoEnvio]
      if (envio && envio.channel === channel) {
        this.#confirmarEco(channel, envio.chave, seq, marcaDoEnvio)
        return true
      }
    }
    const marcas = this.vault.contents.livroPorConfirmar
    if (!marcas || Object.keys(marcas).length === 0) return false
    const marca = resumoDoLivro(bytes)
    const guardado = marcas[marca]
    if (!guardado || guardado.channel !== channel) return false
    this.#largarMarcaDoLivro(marca)
    this.#recordPayload(channel, seq, this.identity.address, guardado.payload as unknown as Payload)
    void this.flush().catch(() => {})
    return true
  }

  /** Marks older than thirty days: the server's retention already took the event. */
  #expirarLivroPorConfirmar(): void {
    const limite = Date.now() - LIVRO_POR_CONFIRMAR_MS
    for (const [marca, guardado] of Object.entries(this.vault.contents.enviosPorConfirmar ?? {})) {
      if (guardado.at < limite) this.#largarEnvioPorConfirmar(marca)
    }
    const marcas = this.vault.contents.livroPorConfirmar
    if (!marcas) return
    for (const [marca, guardado] of Object.entries(marcas)) if (guardado.at < limite) this.#largarMarcaDoLivro(marca)
  }

  #markOwn(): string {
    const ref = toBase64(crypto.getRandomValues(new Uint8Array(9)))
    this.#ownRefs.add(ref)
    if (this.#ownRefs.size > 512) {
      const oldest = this.#ownRefs.values().next().value
      if (oldest) this.#ownRefs.delete(oldest)
    }
    return ref
  }

  /**
   * Who waits for the server to confirm a send, by `ref`.
   *
   * Confirmation is the ECHO: the server saves the event and broadcasts it to
   * the channel, us included, with the same reference we gave it. `#onFrame`
   * already recognized it, to discard it, since the message is already applied
   * here, and that recognition is exactly what serves as a receipt.
   *
   * Its own map, not `#pending`, which is a queue by FRAME TYPE: two sends in
   * flight would receive each other's echo, and a `channel.event` from someone
   * else would count as receipt for either one.
   */
  #confirmacoes = new Map<string, { resolve: (seq: number) => void; reject: (erro: Error) => void; channel: string }>()

  /**
   * How long we wait for a receipt before marking the send as lost.
   *
   * The same timeout as `#await`, and for the same reason: past this, either
   * the server isn't responding or it didn't save. Static for tests to shorten
   * it, a test that waits ten seconds for a silent server is a test no one runs.
   */
  static CONFIRM_MS = 10_000

  /**
   * Wait for a send's receipt, or learn why it didn't come.
   *
   * Three outcomes, and none of them is silence: the echo (accepted), the
   * `channel.rejected` from the same channel (the server doesn't recognize our
   * place), and the timeout. The connection dropping fails pending confirmations
   * the same way it fails everything else, in `#failPending`.
   *
   * **That fourth path, the connection drops mid-wait, has no test**, and
   * that's on record: the offline test disconnects BEFORE asking to send, so a
   * receipt never gets pending. If it breaks, the ten-second timeout solves it
   * anyway, slower. In `docs/PENDENTES.md`.
   */
  #confirmado(ref: string, channel: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const temporizador = setTimeout(() => {
        this.#confirmacoes.delete(ref)
        reject(new Error("the server did not confirm the send", { cause: { channel } }))
      }, Session.CONFIRM_MS)
      this.#confirmacoes.set(ref, {
        channel,
        // With the `seq` the server gave the send: whoever enters by card needs it to
        // know where their place starts.
        resolve: (seq) => {
          clearTimeout(temporizador)
          this.#confirmacoes.delete(ref)
          resolve(seq)
        },
        reject: (erro) => {
          clearTimeout(temporizador)
          this.#confirmacoes.delete(ref)
          reject(erro)
        },
      })
    })
  }

  /** Fail pending confirmations, all of them, or just those in one channel. */
  #falharConfirmacoes(motivo: string, channel?: string): void {
    for (const [ref, espera] of [...this.#confirmacoes]) {
      if (channel !== undefined && espera.channel !== channel) continue
      this.#confirmacoes.delete(ref)
      espera.reject(new Error(motivo, { cause: { channel: espera.channel } }))
    }
  }

  // ------------------------------------------------------- channel presentation

  /**
   * How this channel presents itself, if anyone has said.
   *
   * Read from the vault, not the network, so the name is on screen before the
   * connection answers. Without this the sidebar flickers the raw identifier at
   * every start, and the identifier is exactly the ugly thing we wanted to hide.
   */
  /**
   * Does this account manage roles in this channel?
   *
   * Whoever founded it does, and whoever that person named admin. **If we don't
   * know who founded it, nobody manages.** This line cost effort to reach.
   *
   * It said the opposite: a channel with no recorded founder belonged to
   * everyone, so channels born before we tracked founders wouldn't lack someone
   * to rename them. The logic was sound for the wrong question. Who doesn't know
   * the owner isn't just whoever joined an old channel, it's **everyone who
   * enters after it was founded**: the `room.created` was published once, in an
   * earlier epoch, and forward secrecy guarantees an invitee never decrypts it.
   * For each invited person, the channel seemed to have no owner, and "has no
   * owner" gave them full admin: name themselves, and with the role built in,
   * everything else. This was proved with two real accounts, see
   * `apps/server/src/fundador.test.ts`.
   *
   * The real fix is `republishAuthority`, which republishes the founder record
   * to arrivals. But there's always a window between entering and getting that
   * republish, and this line decides on that window. Opening while we don't know
   * grants power through ignorance to crown oneself; closing while we don't know
   * costs delayed admin. Close it.
   *
   * The cost, told in full with the workaround beside it: in a genuinely
   * owner-less channel, those before we tracked founders, this server's common
   * room, nobody can rename it or name anyone, until someone uses `claimFounder`,
   * which exists for exactly that and is in the properties screen. One click, and
   * the channel has admin again. It's a price you pay once, and it's smaller than
   * the channel belonging to whoever enters it.
   *
   * Managing roles is NOT one of the four powers, and that's on purpose. If it
   * were, having any power would let you name yourself all the others, and the
   * separation the owner asked for wouldn't last a day.
   *
   * In a one-on-one chat nobody has power, and that's the owner's order word for
   * word: "It must not be possible to make admin in the private chat between two
   * users." The refusal must be here, not the screen, because a hidden button
   * won't stop anyone calling the bridge, and here everything falls at once:
   * `mayManageRoles` stops offering it and the two guards on `role.assign` and
   * `role.define` reception now ignore names that arrive over the wire, from the
   * other side or from a changed client.
   *
   * And it stays this line that makes sure, even with founders locked down on
   * top: whoever OPENED the chat published a `room.created` there and stays
   * recorded as founder in the vault itself. Without this first line they'd be
   * admin of the chat, and the order was exactly that there be none. See
   * `session.administracao-dm.test.ts`, which locks both sides.
   *
   * It's the twin of `#porqueNaoSeElimina`, which refuses to delete a chat for
   * the same underlying reason: there's no admin there to exercise.
   */
  #mandaEm(channel: string, address: string): boolean {
    if (this.#eDirecta(channel)) return false
    const fundador = this.#fundadorConhecido(channel)
    if (!fundador) return false
    if (fundador === address) return true
    return this.rolesFor(channel, address).includes(ADMIN_ROLE)
  }

  /**
   * Who founded the channel, counting also what hasn't reached the vault yet.
   *
   * `founderOf` reads the vault, and the vault only gets the record in the drain
   *, that is, in the save that closes the event batch. A batch where the
   * republished `room.created` and a `role.assign` arrive together is normal,
   * not rare: it's exactly what `republishAuthority` sends, one after the other.
   * If the guard on `role.assign` asked the vault alone, the founder wouldn't be
   * there yet, `#mandaEm` would answer "nobody manages" and the name would be
   * thrown out, the republish would come and not stick, and the channel would
   * stay with no roles until next time.
   *
   * So we also look at what's waiting to be saved. It's not a compromise: it's
   * the same fact, minutes before disk. And the order `republishAuthority` sends
   * them in, founding first, always, is what makes sure that when the name is
   * read, the founding is already here.
   */
  #fundadorConhecido(channel: string): string | null {
    const gravado = this.founderOf(channel)
    if (gravado) return gravado
    const pendente = this.#pendingAuthority.find((entrada) => entrada.channel === channel && entrada.kind === "founder")
    return pendente?.address ?? null
  }

  // ----------------------------------------------------------------- roles
  //
  // Named roles, assignable to people, each with the powers given to it, or
  // none, which is the role that just marks who has channel access.
  //
  // The four powers aren't worth the same, and nothing at this layer can make them
  // worth the same: `expulsar` tears the leaf from the MLS tree and moves the
  // epoch, and that's cryptography; `convidar`, `renomear` and `mover` are
  // convention that honest clients apply, and a changed client ignores them.
  // Whoever shows this to the user must split the two, see `POWERS` and
  // `CRYPTOGRAPHIC_POWERS` in the protocol, which exist so there aren't two
  // hand-written lists disagreeing.
  //
  // Holding back a power is always convention, `expulsar` included: any member
  // can commit a removal, and what stops them is each honest client refusing to
  // offer it. The difference is in the effect, a completed expulsion can't be
  // undone.

  /**
   * The roles defined in this channel, in order. From the vault, like rooms.
   *
   * Without the built-in `admin` role: whoever shows roles to the user is who
   * names it, and a display name doesn't belong in the core. The powers of the
   * built-in are in `powersOf`, which decides.
   */
  rolesOf(channel: string): { role: string; name: string; powers: Power[]; colour?: RoleColour; position: number; rank: number }[] {
    const guardados = this.vault.contents.channelRoles[channel] ?? {}
    const papeis: { role: string; name: string; powers: Power[]; colour?: RoleColour; position: number; rank: number }[] = []
    for (const [role, entrada] of Object.entries(guardados)) {
      // The vault stores payloads raw, on purpose: a vault written by a newer
      // version has to open here. Narrowing by hand is the price.
      const bruto = entrada.payload as {
        t: string
        name?: unknown
        powers?: unknown
        colour?: unknown
        position?: unknown
        rank?: unknown
        removed?: unknown
      }
      if (bruto.t !== "role.define" || typeof bruto.name !== "string" || bruto.removed === true) continue
      // The built-in's name lives here since it can change, but it's not a declared
      // role: it reads through `adminRole`. The `@todos` is also built-in, and
      // reads through `todosOf`.
      if (role === ADMIN_ROLE || role === CARGO_TODOS) continue
      // A color this version doesn't know is a color this version can't paint, and
      // the right answer is don't paint, never drop the role. It's the same discount
      // of powers in the line below, with a difference that matters: there discarding
      // protects against granting what we don't understand, here we just lose
      // decoration. That's why the schema accepts the chain and it's judged here.
      const cor = ROLE_COLOURS.find((nome) => nome === bruto.colour)
      papeis.push({
        role,
        name: bruto.name,
        // A power this version doesn't know is a power this version can't evaluate,
        // and so won't grant. Discarding is the only safe answer: accepting it would
        // grant what we don't understand.
        powers: POWERS.filter((poder) => (Array.isArray(bruto.powers) ? (bruto.powers as unknown[]).includes(poder) : false)),
        // The key only exists when there's a color: `colour: undefined` in an object
        // is one thing, absence is another, and whoever reads next tells "didn't pick"
        // from "picked and didn't give".
        ...(cor ? { colour: cor } : {}),
        position: typeof bruto.position === "number" ? bruto.position : 0,
        // Absent is zero: the bottom of the hierarchy, where all roles from before 1.2 are.
        rank: typeof bruto.rank === "number" ? bruto.rank : 0,
      })
    }
    // The channel order: the hierarchy, top to bottom. The same everywhere (member
    // list, profile, role-giving menus), because everyone reads here. See
    // `compararCargos`.
    return papeis.sort(compararCargos)
  }

  /**
   * The base powers for everyone in this channel: the built-in `@todos` role
   * (1.2). Absent or deleted, defaults to `PODERES_DE_TODOS_POR_OMISSAO`, which
   * is what's free today. `definido` says if someone published it.
   */
  todosOf(channel: string): { powers: Power[]; definido: boolean } {
    const bruto = this.vault.contents.channelRoles[channel]?.[CARGO_TODOS]?.payload as
      | { t?: unknown; powers?: unknown; removed?: unknown }
      | undefined
    if (!bruto || bruto.t !== "role.define" || bruto.removed === true) {
      return { powers: [...PODERES_DE_TODOS_POR_OMISSAO], definido: false }
    }
    return { powers: poderesConhecidos(bruto.powers), definido: true }
  }

  /**
   * The channel state as the permissions model reads it (`permissoes.ts`). From
   * the vault, with founding still to save (`#fundadorConhecido`).
   */
  #estadoDePermissoes(channel: string): EstadoDePermissoes {
    const cargos = new Map<string, CargoDefinido>(this.rolesOf(channel).map((papel) => [papel.role, { powers: papel.powers, rank: papel.rank }]))
    const salas = this.vault.contents.channelRooms[channel] ?? {}
    const categorias = this.vault.contents.channelCategories?.[channel] ?? {}
    return {
      fundador: this.#fundadorConhecido(channel),
      cargosDe: (address) => this.rolesFor(channel, address),
      cargo: (role) => cargos.get(role),
      todos: this.todosOf(channel).powers,
      categoriaDaSala: (room) => {
        const entrada = salas[room]
        return entrada ? this.#categoriaDaSala(channel, (entrada.payload as { category?: unknown }).category, entrada.at) : ""
      },
      sobreposicoesDaSala: (room) => sobreposicoesDe(salas[room]?.payload),
      sobreposicoesDaCategoria: (category) => sobreposicoesDe(categorias[category]?.payload),
    }
  }

  /**
   * What this person can do in this channel, in a room or category (1.2). The
   * single source: `powersOf`, `may` and the reception guards ask here. See
   * `permissoesEm` in `permissoes.ts`, where the rule is written.
   *
   * `lugar` is a room identifier, or `{ categoria }`. Without it, the whole
   * channel (overrides don't count).
   */
  permissoesEm(channel: string, address: string, lugar?: string | Lugar): Power[] {
    const onde: Lugar = typeof lugar === "string" ? { sala: lugar } : (lugar ?? {})
    return permissoesNoModelo(this.#estadoDePermissoes(channel), address, onde)
  }

  /**
   * Whether role delegation is on in this channel (decision D13): all leaves say
   * they read the permissions model. Until then, only the founder and whoever has
   * `admin` manage roles, as before, and a role with `gerircargos` waits: a 1.0.x
   * or 1.1.0 in the channel wouldn't accept what it assigns, and the channel
   * would have different roles by who reads it.
   *
   * Only decides what THIS device offers and sends. Whoever receives accepts a
   * valid delegation by the rule (`podeAtribuir`) without looking at the gate:
   * so all new clients reach the same state.
   */
  delegacaoDeCargos(channel: string): boolean {
    if (this.#eDirecta(channel)) return false
    return this.#todasAsFolhasDisseram(channel, this.vault.contents.conhecemPermissoes?.[channel] ?? {})
  }

  /**
   * The name and color that whoever manages roles gave the built-in `admin` role.
   *
   * Null while nobody changed its name: the interface then shows its name
   * ("Administrator"). Powers don't come here because they don't change: `admin`
   * gives everything, and `powersOf` says so.
   */
  adminRole(channel: string): { name: string; colour?: RoleColour } | null {
    const bruto = this.vault.contents.channelRoles[channel]?.[ADMIN_ROLE]?.payload as
      | { t?: unknown; name?: unknown; colour?: unknown; removed?: unknown }
      | undefined
    if (!bruto || bruto.t !== "role.define" || bruto.removed === true) return null
    if (typeof bruto.name !== "string" || !bruto.name.trim()) return null
    const cor = ROLE_COLOURS.find((nome) => nome === bruto.colour)
    return { name: bruto.name, ...(cor ? { colour: cor } : {}) }
  }

  /**
   * What roles this person has in this channel.
   *
   * The new record always wins if it exists, and only in its absence does the
   * old admin list format read. That order is what makes taking back a role work:
   * reading both together left the old entry resurrect them.
   */
  rolesFor(channel: string, address: string): string[] {
    const novo = this.vault.contents.channelMemberRoles[channel]?.[address]
    if (novo) return [...novo]
    return (this.vault.contents.channelAdmins[channel] ?? []).includes(address) ? [ADMIN_ROLE] : []
  }

  /**
   * Everything this person can do in this channel, in fixed order.
   *
   * Whoever founded can do anything and can't be removed. The built-in `admin`
   * role does everything too.
   *
   * **With no known founder, grant only what undoes, and nothing else.** It was
   * "grant everything", for old channels' sake, and that rule met the hole that
   * `#mandaEm` tells: for whoever enters after founding, the channel seems to
   * have no owner, so an invited person with no role would expel the founder,
   * which moves the epoch and has no undo.
   *
   * The split isn't between grave and light, it's between what fixes and what
   * sticks: renaming someone else's channel is ugly and undoes with another name;
   * expelling and deleting don't undo with any gesture. See `IRREVERSIBLE_POWERS`,
   * in the protocol, next to the list that sorts, so there isn't a second
   * hand-written list here disagreeing.
   *
   * And it's an early exit, not a minimum added to roles: a role saved in a
   * channel with no owner was saved under the old rule, and so it might be
   * exactly the role someone gave themselves before this version. A vault with
   * that poison in it won't grant by it again.
   */
  powersOf(channel: string, address: string): Power[] {
    /**
     * Use `#fundadorConhecido`, not `founderOf`, which was here before.
     *
     * Both functions answer the same question and disagreed: `founderOf` reads
     * the vault, and the vault only gets the record after the drain; `#mandaEm`,
     * a hundred lines away, already counted what was waiting to be written. While
     * this one read only the disk, the answer CHANGED in the middle of a batch,      * and changed between the instant the interface draws a button and the instant
     * someone clicks it.
     *
     * What that gave on screen, measured in a swarm run: the invite button in
     * view, the click refused with "you don't have the power to invite to this
     * channel", and, worse, four people in the same channel with different
     * answers, depending on what each vault had already drained. A rule that
     * depends on what reached the disk is not a rule.
     */
    // Since 1.2, the entire channel of `permissoesEm` (single source): the same
    // rule as before (founder, no foundation, `admin`, deleted roles don't count),
    // plus the basis of `@todos` and the implications of the migration.
    return this.permissoesEm(channel, address)
  }

  /** Whether this account has this power in this channel, or in this room. */
  may(channel: string, power: Power, room?: string): boolean {
    return this.permissoesEm(channel, this.identity.address, room).includes(power)
  }

  /**
   * Whether this account can create, delete and assign roles in this channel:
   * the founder and whoever has `admin`, as always; and, with role delegation
   * on (`delegacaoDeCargos`), whoever has `gerircargos`, only over roles below
   * them (`mayManageRole`).
   */
  mayManageRoles(channel: string): boolean {
    if (this.#mandaEm(channel, this.identity.address)) return true
    // No known foundation means no delegation: `permissoesEm` gives there all that
    // undoes itself, and "manage roles" with the built-in in hand was giving away
    // the rest.
    if (this.#eDirecta(channel) || this.#fundadorConhecido(channel) === null || !this.delegacaoDeCargos(channel)) return false
    return this.permissoesEm(channel, this.identity.address).includes("gerircargos")
  }

  /** Whether this account can touch THIS role (the hierarchy and the escalation). See `podeGerirCargo`. */
  mayManageRole(channel: string, role: string): boolean {
    if (this.#eDirecta(channel)) return false
    if (this.#mandaEm(channel, this.identity.address)) return true
    return this.delegacaoDeCargos(channel) && podeGerirCargo(this.#estadoDePermissoes(channel), this.identity.address, role)
  }

  /**
   * The guard over who sends an act about roles: the founder and `admin` always;
   * delegation only with the gate open and the rule allowing it. Throws the same
   * phrase as before, which the interface already translates.
   */
  #exigirGestaoDeCargos(channel: string, permitido: (estado: EstadoDePermissoes) => boolean): void {
    if (this.#mandaEm(channel, this.identity.address)) return
    if (this.delegacaoDeCargos(channel) && permitido(this.#estadoDePermissoes(channel))) return
    throw new Error("only an administrator may manage roles", { cause: { channel } })
  }

  /**
   * Create or change a channel role.
   *
   * `role` is the identifier and does not change; `name` is the label and
   * changes freely. Renaming a role cannot remove anyone's role, and it is
   * this separation that guarantees it, the same separation that exists
   * between a room's id and its name.
   */
  async defineRole(
    channel: string,
    next: { role: string; name: string; powers: Power[]; colour?: string; position?: number; rank?: number },
  ): Promise<void> {
    if (!this.#groups.has(channel)) throw new Error("not a member of this channel", { cause: { channel } })
    // Before the generic one, so the person reads the right reason: not lack of
    // power, it's that there is no power here to have. See `SEM_ADMINISTRACAO_EM_CONVERSA`.
    if (this.#eDirecta(channel)) throw new Error(SEM_ADMINISTRACAO_EM_CONVERSA, { cause: { channel } })
    const id = next.role.trim()
    const todos = id === CARGO_TODOS
    // The `@todos` is always called "todos": whoever reads it in an old version sees that name.
    const nome = todos ? "todos" : next.name.trim()
    if (!id) throw new Error("the role needs an id and a name")
    if (!nome) throw new Error("the role needs an id and a name")
    /*
      The built-in changes the NAME and the COLOR, and never the powers (2/11/2026, owner
      request: "the founder should be able to change the role's name").

      Emptying it stays impossible: an `admin` with zero powers would remove,
      all at once, everyone who had it, including whoever published it. That's why
      the powers in the request don't count, and the full list always goes:
      `powersOf` gives everything to `admin` without reading what is stored, and
      the full list is just the truth told on the wire. An old client refuses this
      `role.define` on arrival (its guard doesn't let it redefine the built-in)
      and keeps showing "Administrador", which is what it knows.
    */
    const embutido = id === ADMIN_ROLE
    const antes = this.rolesOf(channel).find((papel) => papel.role === id)
    const poderes = embutido ? [...POWERS] : POWERS.filter((poder) => next.powers.includes(poder))
    /*
      The `rank` always goes, even at zero (1.2): by it whoever reads can tell
      a new writer from an old one (see `fundirCargoAntigo`). Missing from the
      request, it stays as it was.
    */
    const rank = Math.max(0, Math.floor(next.rank ?? antes?.rank ?? 0))
    this.#exigirGestaoDeCargos(channel, (estado) =>
      podeGerirCargo(estado, this.identity.address, id, { depois: { powers: poderes, rank: todos ? -1 : rank } }),
    )
    // Filtered and not trusted, like the powers in the line below. A color name
    // that is not on the list does not go on the wire: the schema accepts the
    // format so a future color does not reject the payload of whoever receives
    // it, and this filter ensures that a made-up color does not come out FROM
    // HERE. Going out without color is the right behavior, the decoration is
    // lost, never the role.
    const cor = ROLE_COLOURS.find((nome) => nome === next.colour)
    await this.send(channel, {
      t: "role.define",
      role: id,
      name: nome,
      powers: poderes,
      // The key only goes when there is a color. `colour: undefined` survives the
      // object but not serialization, and relying on it was relying on a detail
      // of JSON to say "did not choose".
      ...(cor ? { colour: cor } : {}),
      position: next.position ?? antes?.position ?? this.#posicaoDeUmCargoNovo(channel, id),
      rank,
      removed: false,
      definedAt: this.#carimboSeguinte(this.vault.contents.channelRoles[channel]?.[id]?.at),
    })
  }

  /**
   * The `position` of a role born now: after the last one.
   *
   * A new role is born at the bottom of the order, like on Discord: with `rank`
   * at zero (below all ordered ones) and with `position` after all of them. The
   * two in agreement, because a 1.1.x client only reads `position`: at zero, the
   * new role showed up at the top for it and at the bottom here. The `admin` and
   * `@todos` don't count, they have a fixed place.
   */
  #posicaoDeUmCargoNovo(channel: string, role: string): number {
    if (role === ADMIN_ROLE || role === CARGO_TODOS) return 0
    const posicoes = this.rolesOf(channel).map((papel) => papel.position)
    return posicoes.length === 0 ? 0 : Math.max(...posicoes) + 1
  }

  /**
   * Delete a role.
   *
   * Stated, and not left unstated: silence does not spread, and a role that
   * simply stopped being published stayed alive, with the powers it had, on
   * all devices that had already stored it.
   *
   * Whoever had it keeps it in the list, and stops receiving what it gave. Clearing
   * each person's list would cost a message per person, and the effect is already
   * right: `powersOf` only counts roles that exist now.
   */
  async deleteRole(channel: string, role: string): Promise<void> {
    if (!this.#groups.has(channel)) throw new Error("not a member of this channel", { cause: { channel } })
    if (this.#eDirecta(channel)) throw new Error(SEM_ADMINISTRACAO_EM_CONVERSA, { cause: { channel } })
    if (role === ADMIN_ROLE) throw new Error("the admin role is built in")
    // The `@todos` also does not delete: it applies to everyone. It empties.
    if (role === CARGO_TODOS) throw new Error("the everyone role is built in")
    this.#exigirGestaoDeCargos(channel, (estado) => podeGerirCargo(estado, this.identity.address, role))
    const actual = this.rolesOf(channel).find((papel) => papel.role === role)
    await this.send(channel, {
      t: "role.define",
      role,
      name: actual?.name ?? role,
      powers: [],
      position: actual?.position ?? 0,
      rank: actual?.rank ?? 0,
      removed: true,
      definedAt: this.#carimboSeguinte(this.vault.contents.channelRoles[channel]?.[role]?.at),
    })
  }

  /**
   * Give someone the full set of roles they now have in this channel.
   *
   * The whole set, not a change: whoever joins the channel midway never saw the
   * earlier steps, and an incremental format would force them to have seen them.
   * Empty list is "no roles".
   *
   * The check is here and on the side of whoever receives: an altered client
   * publishes what it wants, and what keeps it without effect is each honest
   * client refusing what does not come from whoever commands.
   */
  async assignRoles(channel: string, subject: string, roles: string[]): Promise<void> {
    if (!this.#groups.has(channel)) throw new Error("not a member of this channel", { cause: { channel } })
    if (this.#eDirecta(channel)) throw new Error(SEM_ADMINISTRACAO_EM_CONVERSA, { cause: { channel } })
    if (subject === this.founderOf(channel)) throw new Error("the founder cannot lose the role", { cause: { channel } })
    const conhecidos = new Set([ADMIN_ROLE, ...this.rolesOf(channel).map((papel) => papel.role)])
    // `@todos` is not assigned: it applies to everyone, and does not go in the list.
    const pedidos = [...new Set(roles.map((role) => role.trim()).filter((role) => role && role !== CARGO_TODOS))]
    this.#exigirGestaoDeCargos(channel, (estado) =>
      podeAtribuir(estado, this.identity.address, subject, this.rolesFor(channel, subject), pedidos),
    )
    // Assigning a role that does not exist would be giving a label that nobody
    // knows how to read, and that one day someone would define with powers that
    // were never meant for whoever already has it.
    const desconhecido = pedidos.find((role) => !conhecidos.has(role))
    if (desconhecido) throw new Error("that role does not exist in this channel", { cause: { channel, role: desconhecido } })
    await this.send(channel, {
      t: "role.assign",
      subject,
      roles: pedidos,
      assignedAt: this.#carimboSeguinte(this.vault.contents.channelMemberRolesAt?.[channel]?.[subject]?.at),
    })
  }

  /**
   * The order of roles, top to bottom (1.2): the hierarchy. The first in the
   * list gets the highest `rank`. Only the role whose height or position changes
   * is republished. Only the founder and `admin`: dragging the entire hierarchy
   * changes roles above the one dragging, and delegation never reaches there.
   */
  async reorderRoles(channel: string, ordem: string[]): Promise<void> {
    if (!this.#groups.has(channel)) throw new Error("not a member of this channel", { cause: { channel } })
    if (this.#eDirecta(channel)) throw new Error(SEM_ADMINISTRACAO_EM_CONVERSA, { cause: { channel } })
    if (!this.#mandaEm(channel, this.identity.address)) throw new Error("only an administrator may manage roles", { cause: { channel } })
    const actuais = new Map(this.rolesOf(channel).map((papel) => [papel.role, papel]))
    const lista = [...new Set(ordem)].filter((role) => actuais.has(role))
    // The ones the list does not bring stay below, in the order they were (from `rolesOf`).
    for (const papel of this.rolesOf(channel)) {
      if (!lista.includes(papel.role)) lista.push(papel.role)
    }
    for (const [indice, role] of lista.entries()) {
      const papel = actuais.get(role)
      if (!papel) continue
      const rank = lista.length - indice
      if (papel.rank === rank && papel.position === indice) continue
      await this.defineRole(channel, { ...papel, rank, position: indice })
    }
  }

  /**
   * The permission overrides of a room or a category (1.2).
   *
   * Republishes the room (or the category) as it is, with `perms`. Empty list
   * is "none". Convention: they tell honest clients what to offer and accept,
   * and do not take any key from anyone.
   */
  async setSobreposicoes(channel: string, lugar: Lugar, perms: Sobreposicao[]): Promise<void> {
    if (!this.#groups.has(channel)) throw new Error("not a member of this channel", { cause: { channel } })
    if (this.#eDirecta(channel)) throw new Error(SEM_ADMINISTRACAO_EM_CONVERSA, { cause: { channel } })
    const lidas = Sobreposicao.array().max(16).parse(perms)
    const estado = this.#estadoDePermissoes(channel)
    if (lugar.sala !== undefined) {
      const antes = sobreposicoesDe(this.vault.contents.channelRooms[channel]?.[lugar.sala]?.payload)
      if (!podeSobrepor(estado, this.identity.address, { sala: lugar.sala }, antes, lidas)) {
        throw new Error("you may not change the permissions of this room", { cause: { channel } })
      }
      await this.#publicarSala(channel, lugar.sala, undefined, { perms: lidas })
      return
    }
    const nome = lugar.categoria?.trim()
    if (!nome) throw new Error("the category needs a name")
    const guardada = this.vault.contents.channelCategories?.[channel]?.[nome]
    const antes = sobreposicoesDe(guardada?.payload)
    if (!podeSobrepor(estado, this.identity.address, { categoria: nome }, antes, lidas)) {
      throw new Error("you may not change the permissions of this room", { cause: { channel } })
    }
    const declarada = this.categoriesOf(channel).find((categoria) => categoria.category === nome)
    await this.send(channel, {
      t: "channel.category",
      category: nome,
      position: declarada?.position ?? 0,
      roles: declarada?.roles ?? [],
      perms: lidas,
      removed: false,
      updatedAt: this.#carimboSeguinte(guardada?.at),
    })
  }

  /** The stored overrides of a room or category, for the interface. */
  sobreposicoesDe(channel: string, lugar: Lugar): Sobreposicao[] {
    if (lugar.sala !== undefined) return sobreposicoesDe(this.vault.contents.channelRooms[channel]?.[lugar.sala]?.payload) ?? []
    return sobreposicoesDe(this.vault.contents.channelCategories?.[channel]?.[lugar.categoria ?? ""]?.payload) ?? []
  }

  /** Whether this account can change the overrides of this place (without looking at the content). */
  maySetSobreposicoes(channel: string, lugar: Lugar): boolean {
    if (this.#eDirecta(channel)) return false
    if (this.#mandaEm(channel, this.identity.address)) return true
    return this.permissoesEm(channel, this.identity.address, lugar).includes("gerirsalas") && this.founderOf(channel) !== null
  }

  /**
   * The timestamp of a new act on a record with a timestamp (F11, finding 3 from
   * the 0.7.0 review): the clock, but never below what is stored.
   *
   * The higher timestamp wins (`venceCarimbo`). An administrator with the clock
   * two hours fast would timestamp an act in the future, and that act would beat
   * all that followed for those two hours: return the role, change the room's
   * name, nothing stuck. A new act is later than what we know by definition, and
   * the timestamp says that. The receiver's clock does not enter.
   */
  #carimboSeguinte(guardado: number | undefined): number {
    return Math.max(Date.now(), (guardado ?? 0) + 1)
  }

  /**
   * Appoint or remove an administrator, the two states that existed before
   * named roles, now as a shortcut for the built-in role.
   */
  async assignRole(channel: string, subject: string, admin: boolean): Promise<void> {
    await this.assignRoles(channel, subject, admin ? [ADMIN_ROLE] : [])
  }

  /**
   * Expel someone from the channel.
   *
   * This is the only power with cryptographic weight: it removes the leaf from
   * the MLS tree, advances the epoch, and whoever leaves really stops being able
   * to read what comes next. It is not a request that honest clients honor, it
   * is a fact that no client undoes, not even the one of whoever was expelled.
   *
   * What is stated to not promise more: the history the person already received
   * stays with them. The removal is going forward, and calling it something else
   * would be a lie, it is in the threat model with these words.
   *
   * The roles of whoever leaves are not deleted. If they get invited back they
   * return with them, which is what is expected of an expulsion that is undone,
   * and it is a choice that reverses with a nomination if that is not what you want.
   */
  async expel(channel: string, address: string): Promise<void> {
    const group = this.#groups.get(channel)
    if (!group) throw new Error("not a member of this channel", { cause: { channel } })
    if (address === this.identity.address) {
      throw new Error("to leave, forget the channel")
    }
    // The guard lives here and not just in the interface, and here it is even
    // clearer why: a committed removal does not undo, and a hidden button does not
    // stop anyone from calling the bridge.
    if (!this.may(channel, "expulsar")) throw new Error("you may not expel in this channel", { cause: { channel } })
    /**
     * Knowing who founded is a condition to expel, not just a consequence.
     *
     * Today this line is redundant, `powersOf` no longer grants `expel` in a
     * channel with no known foundation, and it stays the same, on purpose. The
     * other three powers can afford to depend on one rule alone, because the
     * worst that happens is it undoes; this one does not undo, and it was
     * exactly one rule alone, changed once, that opened the hole this file went
     * on to test. Two locks on the only door that does not open again is the
     * price of three lines.
     *
     * And it says the right thing to whoever reads: not lack of power, but lack
     * of knowing against whom you are using it.
     */
    if (!this.founderOf(channel)) {
      throw new Error("this channel has no recorded founder", { cause: { channel } })
    }
    if (address === this.founderOf(channel)) throw new Error("the founder cannot be expelled", { cause: { channel } })

    // One commit at a time, PER CHANNEL, the same sequence as `#unseat` and for
    // the same reason. The guards above are policy and read first; the leaf reads
    // again inside, because the tree may have changed while waiting.
    const commitou = await this.#commitar(channel, async (atual, tentativa) => {
      // ALL its leaves, not the first one: an account with two devices has two
      // leaves, and expelling by the first one leaves the person reading by the other, // with no symptom on this side, because the commit is valid and the interface
      // says "expelled". `removeMembers` accepts the list and proves the UpdatePath.
      const folhas = leavesOf(atual.state.ratchetTree, address as UserAddress)
      if (folhas.length === 0) {
        // On a retry, already not being there is what was asked for.
        if (tentativa > 1) return null
        throw new Error("that person is not in this channel", { cause: { channel, address } })
      }
      const removal = await removeMembers(atual, folhas)
      return { commit: umSoCommit(removal.commits), session: removal.session }
    })
    if (commitou) this.#announceLocalEpoch(channel)
  }

  /**
   * Move someone from one voice room to another.
   *
   * **This is convention, and the difference from `expel` is right here to see.**
   * Expelling removes the leaf from the MLS tree, advances the epoch and does not
   * undo; moving is an encrypted request to the OTHER PERSON'S CLIENT, who leaves
   * one call and joins another on their own. An altered client reads the request
   * and stays where it is, and there is nothing in this layer that can stop it,    * what the cipher guarantees is only that no one outside the channel emits or
   * reads it.
   *
   * The guard lives here and not just in the interface, for the same reason as
   * always: a hidden button does not stop anyone from calling the bridge. But it
   * is a guard over what THIS client sends, not over what the other obeys.
   *
   * Empty `room` is the default room of the channel.
   */
  async moveVoice(channel: string, subject: string, room: string, de?: string): Promise<void> {
    if (!this.#groups.has(channel)) throw new Error("not a member of this channel", { cause: { channel } })
    if (subject === this.identity.address) {
      throw new Error("to change room, join it")
    }
    // Per room since 1.2: `mover` in the destination room and in the one the person leaves.
    if (!this.#podeMoverDe(channel, this.identity.address, { room, ...(de !== undefined ? { de } : {}) })) {
      throw new Error("you may not move people in this channel", { cause: { channel } })
    }
    await this.send(channel, { t: "voice.move", subject, room, ...(de !== undefined ? { de } : {}), at: Date.now() })
  }

  /**
   * Whether whoever sends can do this `voice.move` (1.2, per room). The same
   * rule for whoever moves (`moveVoice`) and for whoever is moved (`#applyEvent`).
   *
   * Move: `mover` in the destination room and, if known from where, in the origin.
   * Disconnect: `desligar` in the room being left (whoever has `mover` has it,
   * `IMPLICACOES`). Without `de` (a 1.0.x or 1.1.0 client), the destination counts,
   * and in the disconnect the whole channel.
   */
  #podeMoverDe(channel: string, sender: string, pedido: { room: string; de?: string | undefined; desligar?: boolean | undefined }): boolean {
    if (pedido.desligar === true) return this.permissoesEm(channel, sender, pedido.de).includes("desligar")
    if (!this.permissoesEm(channel, sender, pedido.room).includes("mover")) return false
    return pedido.de === undefined || this.permissoesEm(channel, sender, pedido.de).includes("mover")
  }

  /**
   * Whether this account can move someone from room `de` to room `para` (1.2).
   * Without `para`, whether they can disconnect someone who is in `de`. For the
   * interface to offer only what the session can send.
   */
  mayMoveIn(channel: string, de: string | undefined, para?: string): boolean {
    if (para === undefined) return this.#podeMoverDe(channel, this.identity.address, { room: SALA_DA_PERGUNTA, de, desligar: true })
    return this.#podeMoverDe(channel, this.identity.address, { room: para, de })
  }

  /**
   * "Disconnect from the call": remove someone from this channel's voice call.
   *
   * The same power as move (`mover`), like on Discord, and the same status:
   * convention, honored by the person's client. Travels as a `voice.move` with
   * `desligar` and the query room, and that is because of the old client: it
   * reads it as a move to the sentinel, which refuses, and stays where it is.
   * See `voice.move` in the protocol.
   */
  async disconnectVoice(channel: string, subject: string, de?: string): Promise<void> {
    if (!this.#groups.has(channel)) throw new Error("not a member of this channel", { cause: { channel } })
    if (subject === this.identity.address) throw new Error("to leave the call, leave it")
    if (!this.#podeMoverDe(channel, this.identity.address, { room: SALA_DA_PERGUNTA, de, desligar: true })) {
      throw new Error("you may not move people in this channel", { cause: { channel } })
    }
    await this.send(channel, {
      t: "voice.move",
      subject,
      room: SALA_DA_PERGUNTA,
      desligar: true,
      ...(de !== undefined ? { de } : {}),
      at: Date.now(),
    })
  }

  /**
   * Take over the administration of a channel that has no owner.
   *
   * Only exists because of channels born before foundation was recorded, the
   * official channel of this server is one of them. Publishes the record with
   * OUR signature, which is what makes us the owner: nobody can do this for
   * someone else, and it is that impossibility that stops a stranger from
   * declaring themselves owner of another's channel.
   *
   * Runs once and fails after: with owner recorded, the second `room.created`
   * is ignored by everyone, because the first one counts.
   */
  async claimFounder(channel: string): Promise<void> {
    if (!this.#groups.has(channel)) throw new Error("not a member of this channel", { cause: { channel } })
    const dono = this.founderOf(channel)
    if (dono) {
      throw new Error(
        dono === this.identity.address ? "you already administer this channel" : "this channel already has an administrator",
        { cause: { channel } },
      )
    }
    await this.send(channel, {
      t: "room.created",
      name: channel.replace(/^!/, "").split(":")[0] ?? channel,
      createdAt: Date.now(),
    })
  }

  /**
   * Whoever administers this channel, besides who founded it. From the vault.
   *
   * The two records together, the new one and the old format, but resolved
   * per person in `rolesFor`, not summed: whoever was removed has a new empty
   * entry, and summing the lists would resurrect them by the old entry.
   */
  adminsOf(channel: string): string[] {
    const candidatos = new Set([
      ...(this.vault.contents.channelAdmins[channel] ?? []),
      ...Object.keys(this.vault.contents.channelMemberRoles[channel] ?? {}),
    ])
    return [...candidatos].filter((address) => this.rolesFor(channel, address).includes(ADMIN_ROLE))
  }

  /**
   * Whether this account can manage the channel: name, description, icon, and rooms.
   *
   * This is the `rename` permission, not full administration. A role that grants
   * only this must be able to use it, or the separation the owner requested was
   * just a label. Managing members is separate: `mayManageRoles`.
   */
  mayEditChannel(channel: string): boolean {
    return this.may(channel, "renomear")
  }

  /**
   * Who founded the channel, if registered.
   *
   * Read from the vault, not from session memory. The founding record arrives
   * once and never again: it is consumed in the catch-up and does not come back.
   * Reading only what came through this connection made an F5 erase the owner,
   * and the channel offered itself to whoever arrived.
   */
  founderOf(channel: string): string | null {
    return this.vault.contents.channelFounder[channel]?.address ?? null
  }

  /**
   * How the channel presents itself, with the timestamp that dated it.
   *
   * The timestamp travels together because whoever reads this almost always has
   * a SECOND source nearby: the messages still in memory. The rule between the
   * two is the timestamp. Without it, the vault would enter that comparison at
   * zero and lose against any `space.meta` that passes through the wire, no
   * matter how old it was. And `republishAuthority` does exactly that: republishes
   * the presentation with the ORIGINAL timestamp on purpose, so it does not win
   * over a deletion on the way. It would take just a second administrator who was
   * offline when the icon was set to republish it without it.
   *
   * What that cost was not a flickering icon. The properties sheet fills the
   * icon field with what is on screen, and a `space.meta` published from there
   * carries today's timestamp, which everyone's vault accepts because it is the
   * most recent. The icon died for everyone, and who killed it was whoever was
   * changing something else.
   */
  spaceMeta(channel: string): { name: string; topic?: string; icon?: string; updatedAt: number } | null {
    const guardado = this.vault.contents.spaceMeta[channel]
    if (!guardado) return null
    // The vault stores payloads as `{ t: string } & Record<string, unknown>` on
    // purpose: a vault written by a newer version must open here. Narrowing by hand
    // is the price, and it is better than a cast that would accept garbage.
    const bruto = guardado.payload as { t: string; name?: unknown; topic?: unknown; icon?: { inline?: unknown } }
    if (bruto.t !== "space.meta" || typeof bruto.name !== "string") return null
    return {
      name: bruto.name,
      ...(typeof bruto.topic === "string" ? { topic: bruto.topic } : {}),
      ...(typeof bruto.icon?.inline === "string" ? { icon: bruto.icon.inline } : {}),
      // The timestamp it was recorded with, not the payload's: this is what the guard
      // in `upsertSpaceMeta` uses to decide, and the two must agree.
      updatedAt: guardado.at,
    }
  }

  /**
   * Give a channel a name, description, and icon.
   *
   * The identifier does not change: it is the key of the MLS group, and changing
   * it would mean switching groups and leaving everyone behind. This is the label,
   * not the address.
   *
   * The icon travels in `inline`, exactly like the profile avatar, and for the
   * same painful reason: `url` is capped at 2048 characters in the schema, and a
   * real icon exceeds it. A payload that does not validate is discarded ENTIRELY
   * by the receiver and counts as an ignored event. A series of ignored events
   * marks the channel deaf, which triggers the repair that clears history.
   */
  async updateSpaceMeta(channel: string, next: { name: string; topic?: string; icon?: string }): Promise<void> {
    if (!this.#groups.has(channel)) throw new Error("not a member of this channel", { cause: { channel } })
    // The guard lives here, not just in the interface: hiding a button does not
    // stop anyone from calling the bridge. What protects is to refuse to publish.
    if (!this.mayEditChannel(channel)) throw new Error("only an administrator may edit this channel", { cause: { channel } })
    const nome = next.name.trim()
    if (!nome) throw new Error("the channel needs a name")

    await this.send(channel, {
      t: "space.meta",
      name: nome,
      ...(next.topic?.trim() ? { topic: next.topic.trim() } : {}),
      ...(next.icon
        ? {
            icon: {
              url: "",
              inline: next.icon,
              key: "",
              nonce: "",
              digest: "",
              kind: "image" as const,
              name: "icone",
              mediaType: next.icon.slice(5, next.icon.indexOf(";")) || "image/png",
              byteLength: next.icon.length,
            },
          }
        : {}),
      updatedAt: this.#carimboSeguinte(this.vault.contents.spaceMeta[channel]?.at),
    })
  }

  /**
   * The closed rooms of a channel.
   *
   * Closing a room hides it, it does not delete it: what was said there stays in
   * the vault, and messages that continue to arrive with that identifier continue
   * to be stored. This exists so there is a way to bring it back. Without this,
   * closing was irreversible once the application restarted, and "hiding" came to
   * mean "losing".
   */
  closedRoomsOf(channel: string): SalaListada[] {
    const guardadas = this.vault.contents.channelRooms[channel] ?? {}
    const salas: SalaListada[] = []
    for (const [room, entrada] of Object.entries(guardadas)) {
      const bruto = entrada.payload as {
        t: string
        name?: unknown
        category?: unknown
        kind?: unknown
        layout?: unknown
        position?: unknown
        closed?: unknown
        removed?: unknown
      }
      if (bruto.t !== "channel.meta" || typeof bruto.name !== "string" || bruto.closed !== true) continue
      // A deleted room is not a closed room: it does not reopen, and is not offered
      // for reopening. The entry stays stored as a tombstone.
      if (bruto.removed === true) continue
      salas.push({
        room,
        name: bruto.name,
        category: this.#categoriaDaSala(channel, bruto.category, entrada.at),
        kind: bruto.kind === "voice" ? "voice" : "text",
        ...(typeof bruto.layout === "string" && bruto.layout ? { layout: bruto.layout } : {}),
        position: typeof bruto.position === "number" ? bruto.position : 0,
        updatedAt: entrada.at,
      })
    }
    return salas.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
  }

  /**
   * The category of a room, accounting for tombstones (phase 1f, 28/10/2026).
   *
   * A category exists by declaration or by having rooms that name it. Deleting a
   * category rewrites the rooms that the deleter SEES, and puts a tombstone on
   * the declaration. A room that the deleter did not have (from another admin,
   * still to arrive, or republished from their vault on startup) would bring the
   * category back with no declaration: this is from the report of the founder of
   * channel Orwell, "I delete categories and they keep coming back".
   *
   * The rule: a room whose timestamp is BEFORE the tombstone of its category
   * has no category. A room published AFTER the tombstone with that name keeps
   * it: someone is creating the category again, and that counts.
   */
  #categoriaDaSala(channel: string, categoria: unknown, carimboDaSala: number): string {
    if (typeof categoria !== "string" || categoria === "") return ""
    const declarada = this.vault.contents.channelCategories?.[channel]?.[categoria]
    const lapide = (declarada?.payload as { t?: unknown; removed?: unknown } | undefined)?.removed === true
    if (lapide && declarada && declarada.at > carimboDaSala) return ""
    return categoria
  }

  /**
   * The AFK room of this channel, if there is one (2/11/2026). See `SalaAfk` in
   * the protocol.
   *
   * Only one account. Two marked at the same time (two admins, two devices
   * without network) resolve here, and the same across all devices: the most
   * recent declaration wins, and on a tie the larger identifier wins. Only an
   * open voice room can be AFK; a closed or deleted one stops being AFK without
   * anyone having to unmark it.
   */
  #salaAfkDe(channel: string): { room: string; minutos: number; at: number } | null {
    let vencedora: { room: string; minutos: number; at: number } | null = null
    for (const [room, entrada] of Object.entries(this.vault.contents.channelRooms[channel] ?? {})) {
      const bruto = entrada.payload as { t?: unknown; kind?: unknown; closed?: unknown; removed?: unknown; afk?: unknown }
      if (bruto.t !== "channel.meta" || bruto.kind !== "voice" || bruto.closed === true || bruto.removed === true) continue
      const lido = SalaAfk.safeParse(bruto.afk)
      if (!lido.success) continue
      if (vencedora && (entrada.at < vencedora.at || (entrada.at === vencedora.at && room < vencedora.room))) continue
      vencedora = { room, minutos: lido.data.minutos, at: entrada.at }
    }
    return vencedora
  }

  /** The AFK room of a channel, for the call and for the clock. See `#salaAfkDe`. */
  salaAfk(channel: string): { room: string; minutos: number } | null {
    const afk = this.#salaAfkDe(channel)
    return afk ? { room: afk.room, minutos: afk.minutos } : null
  }

  /**
   * The rooms of a channel, ordered by category and position.
   *
   * Read from the vault. A channel with no declared rooms has none: the interface
   * shows it as it always has, with just a chat, and that is what keeps channels
   * before this working.
   */
  roomsOf(channel: string): SalaListada[] {
    const guardadas = this.vault.contents.channelRooms[channel] ?? {}
    const afk = this.#salaAfkDe(channel)
    const salas: SalaListada[] = []
    for (const [room, entrada] of Object.entries(guardadas)) {
      const bruto = entrada.payload as {
        t: string
        name?: unknown
        category?: unknown
        kind?: unknown
        layout?: unknown
        position?: unknown
        closed?: unknown
        removed?: unknown
      }
      if (bruto.t !== "channel.meta" || typeof bruto.name !== "string" || bruto.closed === true) continue
      if (bruto.removed === true) continue
      salas.push({
        room,
        name: bruto.name,
        category: this.#categoriaDaSala(channel, bruto.category, entrada.at),
        kind: bruto.kind === "voice" ? "voice" : "text",
        ...(typeof bruto.layout === "string" && bruto.layout ? { layout: bruto.layout } : {}),
        position: typeof bruto.position === "number" ? bruto.position : 0,
        ...(afk && afk.room === room ? { afk: { minutos: afk.minutos } } : {}),
        updatedAt: entrada.at,
      })
    }
    return salas.sort(
      (a, b) => a.category.localeCompare(b.category) || a.position - b.position || a.name.localeCompare(b.name),
    )
  }

  /**
   * Create or change a room inside a channel.
   *
   * Only whoever administers the channel, for the same reason as the name: a room
   * is shared structure, and shared structure without an owner is structure that
   * anyone can mess up. The room's identifier does not change. Renaming a room
   * would lose the messages that belong to it.
   */
  /**
   * The declared categories in this channel, in order.
   *
   * Only the declared ones. Categories that exist because rooms name them
   * continue to come out of the room list, as they always have. This list is for
   * those that have no rooms yet, and to order them all.
   */
  categoriesOf(channel: string): { category: string; position: number; roles: string[]; updatedAt: number }[] {
    const guardadas = this.vault.contents.channelCategories?.[channel] ?? {}
    const categorias: { category: string; position: number; roles: string[]; updatedAt: number }[] = []
    for (const [category, entrada] of Object.entries(guardadas)) {
      const bruto = entrada.payload as { t: string; position?: unknown; roles?: unknown; removed?: unknown }
      if (bruto.t !== "channel.category" || bruto.removed === true) continue
      categorias.push({
        category,
        position: typeof bruto.position === "number" ? bruto.position : 0,
        /**
         * The roles that see this category. Absent is an empty list, and empty
         * means EVERYONE. Never nobody.
         *
         * The distinction is decided here and is the cheapest to change. What is
         * stored in today's vaults does not have this field. Reading absence as
         * "nobody sees" would hide all categories that already exist from
         * everyone on the first startup after this version.
         */
        roles: Array.isArray(bruto.roles) ? bruto.roles.filter((papel): papel is string => typeof papel === "string") : [],
        // The vault's timestamp, for the reason in `SalaListada.updatedAt`.
        updatedAt: entrada.at,
      })
    }
    return categorias.sort((a, b) => a.position - b.position || a.category.localeCompare(b.category))
  }

  /**
   * The tombstones of the categories in this channel: the ones that were deleted,
   * with the tombstone's timestamp (3/11/2026).
   *
   * For the interface, which combines the vault with what arrives in memory:
   * without knowing a category was deleted, a republish from before the tombstone
   * (the category, or a room that still named it) would bring it back to the
   * screen. This is the "deleting a category does not delete" from 26/10/2026,
   * in the interface's second half. Outside of `categoriesOf`, which the core uses
   * to republish only the live ones.
   */
  categoryTombstonesOf(channel: string): { category: string; position: number; roles: string[]; updatedAt: number; removed: true }[] {
    const guardadas = this.vault.contents.channelCategories?.[channel] ?? {}
    const lapides: { category: string; position: number; roles: string[]; updatedAt: number; removed: true }[] = []
    for (const [category, entrada] of Object.entries(guardadas)) {
      const bruto = entrada.payload as { t: string; removed?: unknown }
      if (bruto.t === "channel.category" && bruto.removed === true) {
        lapides.push({ category, position: 0, roles: [], updatedAt: entrada.at, removed: true })
      }
    }
    return lapides
  }

  /**
   * Declare a category, or remove it from the declared list.
   *
   * Removing it is NOT deleting the category: if there are rooms with that name,
   * they still group and the category still appears. What this undoes is only the
   * declaration, i.e., what kept it alive while empty. Deleting the category for
   * real still means rewriting the `category` field of each room, which is the
   * only thing that defines it.
   *
   * `roles` says who SEES the rooms in this category, and empty is everyone.
   * **This is not an access guard and this method does not pretend to be.** There
   * is nothing to refuse here, because the key of public rooms is the channel
   * key and all members have it. What is published is an arrangement preference
   * that honest clients follow, the same status as `position`, and the opposite
   * of `expel`. See the `roles` field in `channel.category`.
   */
  async upsertCategory(
    channel: string,
    next: {
      category: string
      position?: number
      roles?: string[]
      removed?: boolean
      /**
       * The gesture is just reordering (drag in the sidebar). A tombstoned
       * category that no live room names is not republished: the new declaration
       * would beat the tombstone by timestamp and the deleted category would come
       * back to everyone (phase 1f, hypothesis 2).
       */
      reordenar?: boolean
    },
  ): Promise<void> {
    if (!this.#groups.has(channel)) throw new Error("not a member of this channel", { cause: { channel } })
    // `manage rooms` (1.2), which whoever has `rename` has (`IMPLICATIONS`): nobody loses anything.
    if (!this.may(channel, "gerirsalas")) throw new Error("only an administrator may edit this channel", { cause: { channel } })
    const nome = next.category.trim()
    if (!nome) throw new Error("the category needs a name")
    if (next.reordenar && !next.removed) {
      const guardada = this.vault.contents.channelCategories?.[channel]?.[nome]
      const comLapide = (guardada?.payload as { removed?: unknown } | undefined)?.removed === true
      if (comLapide && !this.roomsOf(channel).some((sala) => sala.category === nome)) return
    }
    await this.send(channel, {
      t: "channel.category",
      category: nome,
      position: next.position ?? 0,
      /**
       * Absent is empty, and empty is everyone.
       *
       * Absent is NOT "leave as it was": a `channel.category` is the whole
       * declaration of the category and the most recent wins, as in the profile
       * and rooms. Whoever republishes the position without saying anything about
       * roles is saying there are no roles. This is what we want, or dragging a
       * category in the sidebar would silently inherit a restriction that nobody
       * asked for there. Whoever wants to keep the restriction sends it again,
       * and that is what the properties sheet does.
       */
      roles: next.roles ?? [],
      removed: next.removed ?? false,
      updatedAt: this.#carimboSeguinte(this.vault.contents.channelCategories?.[channel]?.[nome]?.at),
    })
  }

  async upsertRoom(
    channel: string,
    next: {
      room: string
      name: string
      category?: string
      kind?: "text" | "voice"
      /** How the room is read. See `layout` in `channel.meta`. */
      layout?: string
      position?: number
      closed?: boolean
      removed?: boolean
      /** This room is the AFK room of the channel. See `SalaAfk`. Only in a voice room. */
      afk?: { minutos: number }
    },
  ): Promise<void> {
    if (!this.#groups.has(channel)) throw new Error("not a member of this channel", { cause: { channel } })
    // `manage rooms` in THIS room (1.2): an overlap can remove it in just one room.
    if (!this.may(channel, "gerirsalas", next.room)) {
      throw new Error("only an administrator may edit this channel", { cause: { channel } })
    }
    const nome = next.name.trim()
    if (!nome) throw new Error("the room needs a name")
    /**
     * The default room closes, but is not deleted. Invariant.
     *
     * It is the room with an empty identifier, and it is where everything said
     * before there were rooms lives. What makes it indispensable is the present,
     * not the past: it is where ANY message that arrives without a label falls,
     * and it is where messages from a deleted room begin to be read. Deleting it
     * would take the floor from those two cases, and the second is precisely what
     * this function just created.
     *
     * The guard lives here, in the core, not on the screen that hides the button:
     * the screen only decides what is offered, and the bridge is callable by any
     * client.
     */
    if (next.removed && next.room === "") {
      throw new Error("the default room cannot be deleted")
    }
    /**
     * And the QUESTION ROOM is not declared: the identifier is reserved.
     *
     * The list of rooms in a channel comes from `channel.meta` messages from other
     * members, so it is one of two remote paths through which an arbitrary room
     * identifier enters (the other is `voice.move` in `call.ts`). A room declared
     * with the sentinel's name put people announcing themselves with
     * `room: "?quem"`. For a victim on 0.3.3 in the same room those announcements
     * read as the goodbye that the original bug was: the other device of the same
     * account erased from the screen of whoever is there. See `SALA_DA_PERGUNTA`.
     *
     * The guard lives here for the same reason as the one above: the screen only
     * decides what is offered, and the bridge is callable by any client.
     */
    if (next.room === SALA_DA_PERGUNTA) {
      throw new Error("that room id is reserved", { cause: { room: SALA_DA_PERGUNTA } })
    }
    /*
      The AFK room is a voice room, and only a voice room. Refused here, not just
      on screen, for the usual reason: the bridge is callable by any client. A
      closed or deleted room also does not become AFK (see `#salaAfkDe`), but that
      is not a refusal: it is what closing means.
    */
    if (next.afk && (next.kind ?? "text") !== "voice") {
      throw new Error("only a voice room can be the afk room", { cause: { channel } })
    }
    const afk = next.afk && !next.closed && !next.removed ? SalaAfk.parse(next.afk) : undefined
    await this.send(channel, {
      t: "channel.meta",
      room: next.room,
      name: nome,
      category: next.category?.trim() ?? "",
      kind: next.kind ?? "text",
      ...(next.layout ? { layout: next.layout } : {}),
      position: next.position ?? 0,
      closed: next.closed ?? false,
      removed: next.removed ?? false,
      ...(afk ? { afk } : {}),
      updatedAt: this.#carimboSeguinte(this.vault.contents.channelRooms[channel]?.[next.room]?.at),
    })
    /*
      At most one AFK room per channel, and marking one unmarks the others.

      After publishing the new one, not before: if the network goes down
      midway, the channel ends up with two marked and `#salaAfkDe` picks the most
      recent one, which is what we wanted. The other way it ends up with none.
    */
    if (afk) {
      for (const [outra, entrada] of Object.entries(this.vault.contents.channelRooms[channel] ?? {})) {
        if (outra === next.room) continue
        if ((entrada.payload as { afk?: unknown }).afk === undefined) continue
        await this.#publicarSala(channel, outra, undefined, { semAfk: true })
      }
    }
  }

  // ---------------------------------------------------------------- pinned
  //
  // A pinned message is state OF THE ROOM, not an act on the message: it lives in
  // the `channel.meta` that the room already had, as an optional field, and never
  // in its own `t`. See `pinned` in the protocol, where the reason is written in
  // full.
  //
  // Three things follow from this that this block has to get right:
  //
  // 1. **Publishing a pin is republishing the room.** The record is the whole
  //    declaration, so what comes out of here has to repeat the name, category,
  //    position, and tombstones as they are. Rebuilt from the vault, never made up.
  //    Making it up would have renamed the room for everyone when pinning.
  // 2. **The default room may never have been declared**, and it is where most
  //    chat lives. There we publish the factory record, which is what the interface
  //    already draws: `DEFAULT_ROOM` in the protocol, so there are not two copies
  //    of the same name disagreeing.
  // 3. **A copy of the text travels with the pin.** Whoever arrives later will
  //    never open the original message, and the channel's history has a cap:
  //    without the copy, "pinned" was a list of identifiers pointing to nothing.

  /**
   * The pinned messages in a room, from oldest to newest.
   *
   * From the vault AND from what is still waiting to be stored, for the reason
   * `#fundadorConhecido` already wrote: a `channel.meta` that just arrived gains
   * disk only at the drain, and whoever reads this is a screen that already got
   * the event. Reading only the disk made the pin appear with a flush delay, i.e.,
   * look like the click did not stick.
   */
  pinnedOf(channel: string, room: string): PinnedMessage[] {
    const guardada = this.vault.contents.channelRooms[channel]?.[room]
    let quando = guardada?.at ?? -1
    let fixadas = fixadasDe(guardada?.payload)
    for (const pendente of this.#pendingRooms) {
      if (pendente.channel !== channel || pendente.room !== room) continue
      if (pendente.at < quando) continue
      quando = pendente.at
      // The same rule as the save, on purpose in the same form: absent keeps what we
      // knew, and without `pin` the proposal does not count.
      const propostas = pendente.podeFixar ? fixadasDe(pendente.payload) : undefined
      fixadas = propostas ?? fixadas
    }
    return fixadas ?? []
  }

  /** Whether this account can pin and unpin messages in this channel. */
  mayPin(channel: string): boolean {
    return this.may(channel, "fixar")
  }

  /**
   * Pin a message at the top of a room.
   *
   * The text copy is made HERE and cut to `PINNED_BODY_MAX`, with the
   * identifier alongside: whoever has the original message reads it from there,
   * and the copy is what is left for whoever does not have it. That is everyone
   * who arrived after it was said.
   *
   * Pinning the same message twice does not duplicate it: it replaces the
   * previous pin in the same spot. This is not convenience, it is what keeps two
   * clicks from wasting two of the twenty spots on the same thing.
   */
  async pinMessage(
    channel: string,
    room: string,
    message: { id: string; sender: string; body: string; sentAt: number },
  ): Promise<void> {
    if (!this.#groups.has(channel)) throw new Error("not a member of this channel", { cause: { channel } })
    /**
     * Real refusal, not the hidden button.
     *
     * The interface does not offer the action to whoever does not have the
     * responsibility, and that is teaching, not protection: the bridge is
     * callable by any client. The guard lives here, and the second half of it
     * lives in `#recordPayload`. Whoever gets past this one is still ignored by
     * whoever receives.
     */
    if (!this.mayPin(channel)) throw new Error("you may not pin in this channel", { cause: { channel } })

    const fixadas = this.pinnedOf(channel, room).filter((fixada) => fixada.id !== message.id)
    if (fixadas.length >= MAX_PINNED) {
      throw new Error("the room has the maximum of pinned messages", { cause: { max: MAX_PINNED } })
    }
    fixadas.push({
      id: message.id,
      sender: message.sender,
      // Cut by whoever pins, not by the schema: a schema that truncated would leave
      // the sender convinced they published the whole text.
      body: message.body.slice(0, PINNED_BODY_MAX),
      sentAt: message.sentAt,
      pinnedAt: Date.now(),
      pinnedBy: this.identity.address,
    })
    await this.#publicarSala(channel, room, fixadas)
  }

  /** Remove a message from the top of the room. The other half of the same responsibility. */
  async unpinMessage(channel: string, room: string, id: string): Promise<void> {
    if (!this.#groups.has(channel)) throw new Error("not a member of this channel", { cause: { channel } })
    if (!this.mayPin(channel)) throw new Error("you may not pin in this channel", { cause: { channel } })

    const fixadas = this.pinnedOf(channel, room)
    const restantes = fixadas.filter((fixada) => fixada.id !== id)
    // Nothing to say is nothing to publish: a room republish from an unpin that
    // did not unpin anything is a message encrypted by mistake.
    if (restantes.length === fixadas.length) return
    await this.#publicarSala(channel, room, restantes)
  }

  /**
   * Republish the room with the list of pinned messages it now has.
   *
   * The room goes as it is in the vault, field by field. The same rebuild as
   * `republishRooms`, and for the same reason: what is stored came from the
   * network and may have extra fields or wrong types. A payload that does not
   * validate is discarded entirely and silently on the other side.
   *
   * `closed` and `removed` go as they are. Pinning does not reopen a closed room,
   * and does not resurrect a deleted one: that would be changing two things with
   * one gesture.
   */
  async #publicarSala(
    channel: string,
    room: string,
    pinned: PinnedMessage[] | undefined,
    opcoes: { semAfk?: boolean; perms?: Sobreposicao[] } = {},
  ): Promise<void> {
    const bruto = this.vault.contents.channelRooms[channel]?.[room]?.payload as
      | {
          t?: unknown
          name?: unknown
          category?: unknown
          kind?: unknown
          layout?: unknown
          position?: unknown
          closed?: unknown
          removed?: unknown
          afk?: unknown
        }
      | undefined
    const declarada = bruto?.t === "channel.meta" && typeof bruto.name === "string" ? bruto : undefined
    // The AFK mark goes with the rest, for the reason `layout` has here below:
    // whoever receives replaces the whole room. `semAfk` is the path that unmarks it.
    const afk = opcoes.semAfk ? undefined : SalaAfk.safeParse(declarada?.afk).data

    /**
     * The default room publishes at factory; a room we don't know about does not.
     *
     * The first one always exists, even if no one declared it, and is where
     * everything falls that is said without a label: publishing it with the
     * factory record leaves it exactly as it was on everyone's screen. The
     * second is a room whose `channel.meta` never reached us, inventing a
     * name for it would rename it for everyone, with the authority of the most
     * recent write, because of a click that was about something else.
     */
    if (!declarada && room !== DEFAULT_ROOM.room) {
      throw new Error("this room was never published", { cause: { channel } })
    }

    await this.send(channel, {
      t: "channel.meta",
      room,
      name: declarada ? (declarada.name as string) : DEFAULT_ROOM.name,
      // The category that holds today: one with a tombstone more recent than the
      // room does not come back if a message is pinned (phase 1f).
      category: this.#categoriaDaSala(channel, declarada?.category, this.vault.contents.channelRooms[channel]?.[room]?.at ?? 0),
      kind: declarada?.kind === "voice" ? "voice" : "text",
      /**
       * The layout goes with the rest, and the reason is what is in `republishRooms`.
       *
       * The receiver REPLACES the room with the most recent declaration, only the
       * list of pinned messages is merged, and that is why only it can be missing
       * without cost. A `channel.meta` without `layout` does not say "do not touch
       * the layout": it says the room has none. Without this line, pinning a message
       * in a ticket room broke the frame for everyone, and whoever pinned it never
       * knew why.
       */
      ...(typeof declarada?.layout === "string" && declarada.layout ? { layout: declarada.layout } : {}),
      position: typeof declarada?.position === "number" ? declarada.position : DEFAULT_ROOM.position,
      closed: declarada?.closed === true,
      removed: declarada?.removed === true,
      ...(pinned ? { pinned } : {}),
      ...(afk && declarada?.kind === "voice" ? { afk } : {}),
      // Absent means "does not speak about overlays": the receiver keeps the ones it had.
      ...(opcoes.perms !== undefined ? { perms: opcoes.perms } : {}),
      updatedAt: this.#carimboSeguinte(this.vault.contents.channelRooms[channel]?.[room]?.at),
    })
  }

  // ---------------------------------------------------------------- tickets
  //
  // A ticket is not an entity stored anywhere: it is a collection of messages
  // with the same mark, folded by `ticketsOf`. No table exists, neither here nor
  // on the server, and that is what makes a ticket frame cost exactly what a
  // conversation costs, not one extra byte of metadata for the server to store.

  /**
   * The ticket frame of a room, as this account reads it.
   *
   * "As this account reads it" is not a precaution about writing: whoever has
   * `atender` decides by `powersOf`, which knows the foundation of the channel
   * and the roles recorded IN THIS vault. Two devices with different histories
   * reach different frames, and neither is wrong, it is the same consequence
   * of persistent secrecy that publication votes already assume.
   */
  ticketsOf(channel: string, room: string): Ticket[] {
    return ticketsOf(
      entradasDoCanal(this.vault.contents, channel),
      room,
      (address) => this.powersOf(channel, address).includes("atender"),
      // The tombstone of a closed ticket (phase 3) counts only from who moderates.
      (address) => this.mayModerate(channel, address),
    )
  }

  /**
   * Delete a closed ticket (phase 3). Only who moderates, and only if closed.
   *
   * Close first, as a room closes before being deleted: closing undoes itself,
   * deleting does not. The tombstone is a message from the ticket with `removed`,
   * and the body says what happened in full, for whoever does not know the field.
   */
  async deleteTicket(channel: string, room: string, ticket: string): Promise<void> {
    if (!this.#groups.has(channel)) throw new Error("not a member of this channel", { cause: { channel } })
    if (!this.mayModerate(channel)) throw new Error("you may not moderate in this channel", { cause: { channel } })
    const alvo = this.ticketsOf(channel, room).find((entrada) => entrada.id === ticket)
    if (alvo?.state !== "closed") throw new Error("only a closed ticket can be deleted", { cause: { channel } })
    const at = Date.now()
    await this.send(channel, {
      t: "message",
      ...(room ? { room } : {}),
      id: crypto.randomUUID(),
      sentAt: at,
      body: `Eliminou o ticket ${alvo.subject ? `"${alvo.subject}"` : "este ticket"}.`,
      attachments: [],
      links: [],
      mentions: [],
      ticket: { id: ticket, removed: true, at },
    })
  }

  // --------------------------------------------------------------- apelidos

  /** The nicknames of this channel, by address (phase 3). See `apelidos.ts`. */
  nicknamesOf(channel: string): Record<string, string> {
    return apelidosDoCanal(
      this.vault.contents,
      channel,
      this.#pendingApelidos.filter((pendente) => pendente.channel === channel),
    )
  }

  /**
   * Change someone's nickname in this channel. Empty removes it.
   *
   * The person changes their own; another's, only who moderates. The guard here
   * is on sending; the receiver judges again, against the authenticated sender
   * (`#apelidoAceite`). The body says what happened in full, for whoever does
   * not know the `apelido` field.
   */
  async setNickname(channel: string, subject: string, nick: string): Promise<void> {
    if (!this.#groups.has(channel)) throw new Error("not a member of this channel", { cause: { channel } })
    if (this.#eDirecta(channel) || this.#eMural(channel)) {
      throw new Error("a nickname belongs to a channel", { cause: { channel } })
    }
    const eu = this.identity.address
    if (subject !== eu && !this.mayModerate(channel)) {
      throw new Error("you may not moderate in this channel", { cause: { channel } })
    }
    const apelido = nick.trim()
    if (apelido.length > APELIDO_MAX) throw new Error("the nickname is too long", { cause: { max: APELIDO_MAX } })
    const publicado = this.vault.contents.directory[subject]?.payload["displayName"]
    const nome = typeof publicado === "string" && publicado.trim() !== "" ? publicado : subject
    const corpo =
      subject === eu
        ? apelido
          ? `Passou a usar o apelido "${apelido}" neste canal.`
          : "Deixou de usar apelido neste canal."
        : apelido
          ? `Mudou o apelido de ${nome} para "${apelido}".`
          : `Tirou o apelido a ${nome}.`
    const at = Date.now()
    await this.send(channel, {
      t: "message",
      id: crypto.randomUUID(),
      sentAt: at,
      body: corpo,
      attachments: [],
      links: [],
      mentions: [],
      apelido: { subject, nick: apelido, at },
    })
  }

  /**
   * Open a ticket. Anyone in the channel can, and that is the whole point.
   *
   * A ticket room exists to receive complaints from whoever does not command:
   * requiring responsibility to open one would turn the frame into an
   * administration task list, which is a different product.
   *
   * The body is written to read on its own, like invites, and for the same
   * reason: in a client that does not know the `ticket` field, this sentence
   * is all that remains, and it must say what happened without any button to press.
   */
  async openTicket(channel: string, room: string, subject: string): Promise<string> {
    if (!this.#groups.has(channel)) throw new Error("not a member of this channel", { cause: { channel } })
    const assunto = subject.trim()
    if (!assunto) throw new Error("the ticket needs a subject")
    const id = crypto.randomUUID()
    const at = Date.now()
    await this.send(channel, {
      t: "message",
      ...(room ? { room } : {}),
      id: crypto.randomUUID(),
      sentAt: at,
      body: `Abriu um ticket: ${assunto}`,
      attachments: [],
      links: [],
      mentions: [],
      ticket: { id, subject: assunto, state: "open", at },
    })
    return id
  }

  /**
   * Who can decide the state of this ticket: who attends, or who opened it.
   *
   * It lives here and not on the screen because the bridge is callable by any
   * client, the screen only decides what is OFFERED. It is the same division
   * as `upsertRoom`, and the same reason why the tombstone of the default room
   * is refused in the core.
   *
   * The second half of this guard is in `ticketsOf`, on the read side, and both
   * are needed: this one prevents our client from publishing what is not valid,
   * and that one prevents another's from convincing us of what they published.
   */
  mayDecideTicket(channel: string, room: string, ticket: string): boolean {
    if (this.may(channel, "atender")) return true
    const alvo = this.ticketsOf(channel, room).find((entrada) => entrada.id === ticket)
    return alvo !== undefined && alvo.opener === this.identity.address
  }

  /**
   * Change the state of a ticket.
   *
   * `open` · `working` · `closed`, and nothing else: a state this core does not
   * know is a state it cannot draw, and publishing it would ask everyone to
   * discount it on read.
   */
  async setTicketState(channel: string, room: string, ticket: string, state: TicketState): Promise<void> {
    if (!this.#groups.has(channel)) throw new Error("not a member of this channel", { cause: { channel } })
    if (!TICKET_STATES.includes(state)) throw new Error("unknown ticket state", { cause: { state } })
    if (!this.mayDecideTicket(channel, room, ticket)) {
      throw new Error("only an attendant or the author may change the ticket", { cause: { channel } })
    }
    const assunto = this.ticketsOf(channel, room).find((entrada) => entrada.id === ticket)?.subject ?? ""
    const onde = assunto ? `"${assunto}"` : "este ticket"
    const corpo =
      state === "closed" ? `Fechou o ticket ${onde}.` : state === "working" ? `Pôs o ticket ${onde} em curso.` : `Reabriu o ticket ${onde}.`
    const at = Date.now()
    await this.send(channel, {
      t: "message",
      ...(room ? { room } : {}),
      id: crypto.randomUUID(),
      sentAt: at,
      body: corpo,
      attachments: [],
      links: [],
      mentions: [],
      ticket: { id: ticket, state, at },
    })
  }

  /**
   * Take a ticket for yourself, and move it to working in the same gesture.
   *
   * Two things in one message because they are one decision, saying you take
   * a ticket is saying it stopped waiting. Splitting them gave two clicks for
   * one intent, and a state you could get stuck in.
   *
   * Only who has `atender`, and here there is no exception for who opened it:
   * closing your own complaint is one thing, taking on work for yourself inside
   * another person's frame is another.
   */
  async takeTicket(channel: string, room: string, ticket: string): Promise<void> {
    if (!this.#groups.has(channel)) throw new Error("not a member of this channel", { cause: { channel } })
    if (!this.may(channel, "atender")) throw new Error("you may not attend tickets in this channel", { cause: { channel } })
    const assunto = this.ticketsOf(channel, room).find((entrada) => entrada.id === ticket)?.subject ?? ""
    const at = Date.now()
    await this.send(channel, {
      t: "message",
      ...(room ? { room } : {}),
      id: crypto.randomUUID(),
      sentAt: at,
      body: `Passou a atender o ticket ${assunto ? `"${assunto}"` : "este ticket"}.`,
      attachments: [],
      links: [],
      mentions: [],
      ticket: { id: ticket, assignee: this.identity.address, state: "working", at },
    })
  }

  /**
   * Drop a ticket, without closing it.
   *
   * The empty string is the affirmation that no one is attending, and it is
   * different from saying nothing, see `assignee` in `TicketMark`. Without this,
   * whoever took a ticket by mistake could only get rid of it by closing it.
   */
  async releaseTicket(channel: string, room: string, ticket: string): Promise<void> {
    if (!this.#groups.has(channel)) throw new Error("not a member of this channel", { cause: { channel } })
    if (!this.may(channel, "atender")) throw new Error("you may not attend tickets in this channel", { cause: { channel } })
    const assunto = this.ticketsOf(channel, room).find((entrada) => entrada.id === ticket)?.subject ?? ""
    const at = Date.now()
    await this.send(channel, {
      t: "message",
      ...(room ? { room } : {}),
      id: crypto.randomUUID(),
      sentAt: at,
      body: `Largou o ticket ${assunto ? `"${assunto}"` : "este ticket"}.`,
      attachments: [],
      links: [],
      mentions: [],
      ticket: { id: ticket, assignee: "", at },
    })
  }

  /**
   * Reply inside a ticket.
   *
   * It is a message like any other, what ties it to the ticket is the mark,
   * and that is all. A client that does not know it reads the entire conversation
   * in sequence, which is what it is underneath.
   */
  async replyToTicket(channel: string, room: string, ticket: string, body: string): Promise<void> {
    if (!this.#groups.has(channel)) throw new Error("not a member of this channel", { cause: { channel } })
    const texto = body.trim()
    if (!texto) throw new Error("the reply needs text")
    const at = Date.now()
    await this.send(channel, {
      t: "message",
      ...(room ? { room } : {}),
      id: crypto.randomUUID(),
      sentAt: at,
      body: texto,
      attachments: [],
      links: [],
      mentions: [],
      ticket: { id: ticket, at },
    })
  }

  /**
   * Republish the rooms of this channel, for whoever just joined.
   *
   * Same problem as the profile, and for the same reason: the `channel.meta` of
   * each room was encrypted in an epoch that whoever just arrived has no access
   * to, persistent secrecy is exactly that. Without this, whoever joins sees
   * the channel and nothing else: no text rooms, no voice rooms, no categories.
   * They see an empty place where others are talking.
   *
   * Only who organizes can publish `channel.meta`, so only who administrates
   * does this, for the others it is a non-event, and that is why the failure
   * silences instead of breaking.
   *
   * It costs one message per room and happens when the group grows, which is
   * rare. The profile pays the same since it exists.
   */
  /** The saved overlays of this place, if we could write them now; otherwise nothing. */
  #sobreposicoesQuePossoDizer(channel: string, lugar: Lugar): Sobreposicao[] | undefined {
    const guardadas =
      lugar.sala !== undefined
        ? sobreposicoesDe(this.vault.contents.channelRooms[channel]?.[lugar.sala]?.payload)
        : sobreposicoesDe(this.vault.contents.channelCategories?.[channel]?.[lugar.categoria ?? ""]?.payload)
    if (!guardadas || guardadas.length === 0 || this.#eDirecta(channel)) return undefined
    return podeSobrepor(this.#estadoDePermissoes(channel), this.identity.address, lugar, guardadas, guardadas) ? guardadas : undefined
  }

  async republishRooms(channel: string): Promise<void> {
    if (!this.#groups.has(channel)) return
    if (!this.mayEditChannel(channel)) return
    await this.#enviarSalas(channel)
  }

  /**
   * The live categories of this channel, with the original stamp, for whoever joined.
   *
   * The body that `republishAuthority` used, set aside for the rotation
   * (`#revezarSalas`) to use as well. With the original date for the usual reason:
   * a new date would beat a published tombstone still on the way.
   */
  async #enviarCategorias(channel: string): Promise<void> {
    const categorias: Payload[] = []
    for (const categoria of this.categoriesOf(channel)) {
      // Overlays go to whoever joins, but only from who could write them: the
      // receiver throws away the others, and a silence leaves them as they were.
      const perms = this.#sobreposicoesQuePossoDizer(channel, { categoria: categoria.category })
      categorias.push({
        t: "channel.category",
        category: categoria.category,
        position: categoria.position,
        roles: categoria.roles,
        ...(perms ? { perms } : {}),
        removed: false,
        updatedAt: this.vault.contents.channelCategories?.[channel]?.[categoria.category]?.at ?? 1,
      })
    }
    await this.sendBatch(channel, categorias)
  }

  /** The body of `republishRooms`, without the guard of who organizes. See `#revezarSalas`. */
  async #enviarSalas(channel: string): Promise<void> {
    const guardadas = this.vault.contents.channelRooms[channel] ?? {}
    // All in one vault save (`#enviarEmLote`).
    const salas: Payload[] = []
    for (const [room, entrada] of Object.entries(guardadas)) {
      const bruto = entrada.payload as {
        t?: unknown
        name?: unknown
        category?: unknown
        kind?: unknown
        layout?: unknown
        position?: unknown
        closed?: unknown
        removed?: unknown
        afk?: unknown
      }
      if (bruto.t !== "channel.meta" || typeof bruto.name !== "string") continue
      // The AFK mark, so whoever joins knows which room is AFK. See `layout` below.
      const afk = bruto.kind === "voice" ? SalaAfk.safeParse(bruto.afk).data : undefined
      /**
       * Rebuilt field by field, and not resent as is.
       *
       * What is in the vault came from the network and may have extra fields or
       * wrong types; a payload that does not validate is discarded entirely and
       * silently on the other end, counts as an ignored event, and three ignored
       * events declare the channel deaf. Rebuilding ensures what leaves here is
       * always valid.
       *
       * `closed` and `removed` go as they are: whoever arrives must receive the
       * current state of the room, not a version without the decisions taken
       * in the meantime.
       *
       * **And the pinned messages go with them, which is the reason this is
       * republishing and not cleanup.** What was pinned was pinned in an epoch
       * that whoever just arrived has no access to: without this line, whoever
       * joins sees the room with the right name and an empty top, and has no way
       * to know it is not. It is the same defect as a feed with no posts and a
       * channel with no rooms, in the place where it is least noticed, no one
       * finds an empty top strange.
       *
       * The copy of the text travels inside each pinned message, and that is why
       * this arrives: whoever joins cannot open the original message, and there
       * is no summary to bring it to them.
       *
       * Absent when there is nothing pinned, and never an empty list out of habit:
       * an empty list is an AFFIRMATION ("there is nothing"), and this republishing
       * goes through who organizes the room, who may not be who pins. Saying what
       * you do not know would unpin by mistake.
       *
       * **And only who has `fixar` says them.** Who organizes the room may not have
       * that responsibility, they are two, and that is why they are two, and the
       * receiver throws away a `pinned` from who does not have it. Sending it anyway
       * would waste bytes on an affirmation that no one would accept; omitting it
       * leaves the list of who receives as it was, which is the right reading of
       * a silence.
       */
      const fixadas = this.mayPin(channel) ? fixadasDe(entrada.payload) : undefined
      // The overlays, by the rule of pinned messages: only from who could write them.
      const perms = this.#sobreposicoesQuePossoDizer(channel, { sala: room })
      salas.push({
        t: "channel.meta",
        room,
        name: bruto.name,
        // The category that holds today (phase 1f). Whoever just joined does not
        // receive the tombstone of a deleted category (`republishAuthority` sends only
        // the live ones), and the room with the old name would bring it back.
        category: this.#categoriaDaSala(channel, bruto.category, entrada.at),
        kind: bruto.kind === "voice" ? "voice" : "text",
        /**
         * The layout goes with the rest, and missing it was the lesson from this
         * session once more: whoever joins a channel will never open the
         * `channel.meta` that was encrypted before they had a place there, and
         * this republishing is the only thing that tells them. Without this line,
         * a ticket room arrived to whoever joins as a text room, and stayed that
         * way forever, because nothing else comes to tell them.
         */
        ...(typeof bruto.layout === "string" && bruto.layout ? { layout: bruto.layout } : {}),
        position: typeof bruto.position === "number" ? bruto.position : 0,
        closed: bruto.closed === true,
        removed: bruto.removed === true,
        ...(fixadas && fixadas.length > 0 ? { pinned: fixadas } : {}),
        ...(perms ? { perms } : {}),
        ...(afk ? { afk } : {}),
        updatedAt: entrada.at,
      })
    }
    await this.sendBatch(channel, salas)
  }

  /**
   * And the posts, which is the same wound in the place where it is most noticed.
   *
   * Each person's feed is a channel, and a friend joins it when the friendship is
   * made. Everything posted there before that was encrypted in epochs that friend
   * will never have: for them, the feed of whoever just accepted starts empty and
   * only comes to life in the next post. No one understands this as cryptography,    * it reads as "they have nothing posted".
   *
   * The decrypted history is in the vault of who posted, so the fix is to say it
   * again. Only themselves: someone else's feed does not republish, and is not
   * even tried, because the sender comes authenticated by MLS and what left here
   * would stay signed by us on another person's feed.
   *
   * Idempotent by design: the original `id` and `postedAt` travel untouched, the
   * vault of who receives refuses a post it already has (`appendHistory`) and the
   * interface collapses copies that are already in view (`colapsarCopias`). The
   * three say the same thing in different places, and it is on purpose: the promise
   * was made here and whoever keeps it is there.
   *
   * **What was deleted does not republish.** A tombstone is not a state of the
   * feed, it is an entry in the history like any other, and this method read the
   * history looking for posts without ever looking at the tombstones next to them.
   * The result was the worst a promise can be: deleting took the post off all
   * screens, and the next entry in the feed said it again to whoever had not yet
   * heard it deleted. Whoever pressed the button never knew.
   *
   * Two truths about the limits. Photos may have been dumped from the vault by
   * media budget, and in that case the post comes back without them: a caption
   * without a photo is worse than the entire post and much better than an empty
   * feed. And the most recent ones republish down to the cap below, not the
   * entire archive, whoever arrives gets a feed, not a biography, and each of
   * these goes through MLS like any message.
   */
  async republishPosts(channel: string): Promise<Reenvio> {
    // Not in another person's feed: there only what the owner posts counts. In
    // rooms yes (S1): whoever joined a space got zero posts (S0).
    if (this.#eMural(channel) && channel !== this.feedChannel) return semReenvio()
    if (channel === this.canalDaConta || this.#eDirecta(channel)) return semReenvio()
    if (!this.#groups.has(channel)) return semReenvio()

    const guardadas = entradasDoCanal(this.vault.contents, channel)
    /**
     * Ours, and only the ones that still stand.
     *
     * The tombstone counts if it is ours: in our feed, we are the one who posts,
     * and a `redact` from another on a post of ours is something any member of
     * the group can write and no honest client would honor. It is the same rule
     * the interface applies when reading, see `feedOf`.
     */
    const apagadas = new Set(
      guardadas
        .filter(
          (entrada) =>
            entrada.sender === this.identity.address && (entrada.payload as { t?: unknown }).t === "redact",
        )
        .map((entrada) => (entrada.payload as { target?: unknown }).target)
        .filter((alvo): alvo is string => typeof alvo === "string"),
    )
    const minhas = guardadas.filter(
      (entrada) =>
        entrada.sender === this.identity.address &&
        (entrada.payload as { t?: unknown }).t === "post" &&
        !apagadas.has(String((entrada.payload as { id?: unknown }).id)),
    )
    /*
      In rooms, only where all leaves can deduplicate (§4.6, finding 1 of the
      0.7.0 review). A 0.6.0 deduplicates the post only against what it still
      has in history, and has the conversation at the same cap of 400: each post
      that is not there anymore comes in again and pushes the conversation out.
      In our feed it always runs, because it is what 0.6.0 already did.
    */
    if (channel !== this.feedChannel) {
      if (minhas.length === 0) return semReenvio()
      if (!this.#todasAsFolhasReenviam(channel)) return { falhas: 0, retido: true }
    }

    // Failed sends are counted: whoever calls only marks the resend done with zero (finding 2).
    let falhas = 0
    const falhou = (): void => {
      falhas += 1
    }
    for (const entrada of minhas.slice(-POSTS_REPUBLICADOS)) {
      const bruto = entrada.payload as {
        id?: unknown
        room?: unknown
        postedAt?: unknown
        title?: unknown
        caption?: unknown
        media?: unknown
        links?: unknown
        tags?: unknown
        poll?: unknown
      }
      if (typeof bruto.id !== "string" || typeof bruto.caption !== "string") continue

      /**
       * Rebuilt field by field, for the reason written in `republishRooms`: what
       * is in the vault came from the network, and a payload that does not
       * validate is discarded entirely on the other end, counts as an ignored
       * event, and too many ignored events declare the channel deaf. A broken post
       * cannot take the others with it, so each send fails on its own.
       */
      await this.send(channel, {
        t: "post",
        id: bruto.id,
        postedAt: typeof bruto.postedAt === "number" ? bruto.postedAt : entrada.at,
        caption: bruto.caption,
        media: Array.isArray(bruto.media) ? (bruto.media as never[]) : [],
        links: Array.isArray(bruto.links) ? (bruto.links as never[]) : [],
        tags: Array.isArray(bruto.tags) ? bruto.tags.filter((t) => typeof t === "string") : [],
        ...(typeof bruto.room === "string" ? { room: bruto.room } : {}),
        ...(typeof bruto.title === "string" && bruto.title ? { title: bruto.title } : {}),
        /*
          And the poll, if the post is one.

          Without this line, whoever joined the feed would get the post but not
          the poll it is: the caption with the question written out in full, and
          nothing to press. The field goes raw and `send` validates it with the
          schema; a poll that does not pass counts as no poll, by the `catch` of
          `Poll`, and the caption arrives anyway.
        */
        ...(bruto.poll ? { poll: bruto.poll as never } : {}),
      }).catch(falhou)
    }

    /**
     * And the list of friends we show, if we show it (phase 5).
     *
     * Whoever just joined the feed does not decrypt the one that is there.
     * With the original `updatedAt`, which is the same act said again; only
     * with whoever is still a friend, by the rule of `setShownFriends`. An
     * empty list does not repeat: whoever arrives now never saw any, and there
     * is nothing to erase. Here no one is removed from the feed (this runs on
     * its own, in the middle of an admission): with someone in there who is not
     * a friend, the list does not go out.
     */
    if (channel === this.feedChannel) await this.#listaParaOFeed(channel, true).catch(falhou)

    /**
     * And the votes that belong to us, for the same reason and with the same limit.
     *
     * When someone joins the feed, they don't decrypt the post or anything that was said
     * above it, votes included. The post comes back; the votes must come back
     * after it, otherwise the voting reaches whoever just joined with zero in all options
     * and the first thing they see is an incorrect count.
     *
     * **Only ours, and this is a constraint not a design choice.** The
     * sender is authenticated by MLS: a vote from someone else resent from here
     * would be signed by us on the wall, meaning we'd vote on behalf of another person. It's
     * the same wall that `republishPosts` already had for posts and that
     * `republishAuthority` has for the foundation. The result is honestly
     * partial and is stated in `docs/PENDENTES.md`: whoever arrives sees the voting, sees the
     * vote of whoever posted, and doesn't see others' until each of them speaks up
     * again.
     *
     * **With the original `id`**, and that's what does the work: the vault of whoever
     * receives refuses an entry they already have from the same sender with the same `id`
     * (`appendHistory`), and without it the channel history, which has a cap,
     * would fill up with copies of the same vote until pushing out what doesn't
     * repeat. That's how a gravestone got lost once.
     *
     * **And with the original `at`**, which today is defense not remedy: the `id` already
     * prevents the copy from entering, so the new date never gets recorded
     * by anyone who already has the vote. It stays this way because a resend is the SAME
     * action, and timestamping it again would write a date that nobody chose,
     * a lie that only deduplication is hiding. See `republishAuthority`,
     * where the original date is remedy not defense.
     *
     * And it's safe to repeat all this: the count is a table from voter to
     * option, not a counter. The same vote said twice is still one
     * vote.
     */
    const votacoes = new Set(
      minhas
        .filter((entrada) => (entrada.payload as { poll?: unknown }).poll)
        .map((entrada) => String((entrada.payload as { id?: unknown }).id)),
    )
    if (votacoes.size === 0) return { falhas, retido: false }

    const meusVotos = guardadas.filter((entrada) => {
      if (entrada.sender !== this.identity.address) return false
      const bruto = entrada.payload as { t?: unknown; vote?: unknown; target?: unknown }
      // A reaction without `vote` is a thumbs up, and thumbs up are not resent:
      // this fix is about voting, and expanding it to likes would pass off as repair
      // a decision nobody made.
      return bruto.t === "post.reaction" && typeof bruto.vote === "number" && votacoes.has(String(bruto.target))
    })

    for (const entrada of meusVotos.slice(-VOTOS_REPUBLICADOS)) {
      const bruto = entrada.payload as { id?: unknown; target?: unknown; vote?: unknown; remove?: unknown }
      if (typeof bruto.id !== "string" || typeof bruto.target !== "string") continue
      if (typeof bruto.vote !== "number") continue
      await this.send(channel, {
        t: "post.reaction",
        id: bruto.id,
        target: bruto.target,
        emoji: "",
        at: entrada.at,
        remove: bruto.remove === true,
        vote: bruto.vote,
      }).catch(falhou)
    }
    return { falhas, retido: false }
  }

  /**
   * How long a member without a role waits before taking turns in rooms for whoever just entered.
   *
   * An interval, not a value: with twenty members online, a fixed value
   * would put all twenty speaking at the same instant, and none would hear the others in time
   * to stay quiet. Static for tests.
   */
  static REVEZAMENTO_DAS_SALAS_MS = { de: 2_000, ate: 6_000 }

  /**
   * How much longer the turn-taking waits when whoever manages the channel is already speaking.
   *
   * The cascade from whoever manages says the foundation, the roles, and one assignment per
   * person with a role before the categories and rooms (`republishAuthority`).
   * In `!984` there are 80 assignments, each with the turn of its group and a vault recording:
   * the rooms came out 14 s after the commit, well after turn-taking.
   * Whoever hears the cascade start waits for it, and only speaks if it doesn't finish.
   */
  static REVEZAMENTO_ATRAS_DE_QUEM_ARRUMA_MS = 30_000

  /** How many foreign `channel.meta` and `channel.category` were heard, per channel. See `#revezarSalas`. */
  #salasOuvidas = new Map<string, number>()
  /** How many times the cascade from whoever manages the channel starting was heard, per channel. See `#ouviuQuemArruma`. */
  #arrumacaoOuvida = new Map<string, number>()
  /** The turn-takings waiting their turn, one per channel. */
  #revezamentos = new Map<string, ReturnType<typeof setTimeout>>()

  /**
   * The rooms and categories, said by a member WITHOUT a role to whoever just
   * entered (report from the owner on 2/11/2026: "users on mobile aren't seeing the
   * rooms of the communities").
   *
   * `republishRooms` only comes from whoever manages the channel. With nobody from
   * administration online, whoever entered depended only on anti-entropy reports, which
   * sometimes don't arrive: measured in
   * `apps/server/src/salas-sem-administrador.test.ts`, the person was stuck for minutes
   * with a room of four, not knowing who founded the channel. In the common room this is
   * the rule not the exception: you join through the page, any time, almost
   * always on mobile.
   *
   * **It doesn't change anyone's authority**, and here's why:
   *
   * - whoever receives a `channel.meta` or a `channel.category` never asked the
   *   sender whether they manage the channel (see receiving `channel.meta`); the
   *   guard for `republishRooms` is only on the sender side. A malicious member already today
   *   can post a room; this gives them nothing they don't already have;
   * - what's in the vault goes, with the ORIGINAL timestamp: it loses against any
   *   more recent change, and doesn't bring back anything someone deleted;
   * - pinned rooms only go from whoever has `fixar`, as in `republishRooms`, and whoever
   *   receives throws away those from people who don't have it;
   * - the foundation, roles, and banner DO NOT go: those are `republishAuthority`, and
   *   signing someone else's foundation would be taking their channel.
   *
   * And it doesn't repeat what someone else already said. Waits a random time within
   * `REVEZAMENTO_DAS_SALAS_MS`; if in that time they heard rooms or categories from
   * someone else (the admin, or the first member taking a turn), they stay quiet.
   * Whoever manages the channel doesn't wait and doesn't go through here: they already said it.
   */
  #revezarSalas(channel: string): void {
    if (!this.#groups.has(channel) || this.mayEditChannel(channel)) return
    if (channel === this.canalDaConta || this.#eDirecta(channel) || this.#eMural(channel)) return
    if (this.#revezamentos.has(channel)) return
    if (this.roomsOf(channel).length === 0 && this.categoriesOf(channel).length === 0) return
    const ouvidasAntes = this.#salasOuvidas.get(channel) ?? 0
    const arrumacaoAntes = this.#arrumacaoOuvida.get(channel) ?? 0
    const { de, ate } = Session.REVEZAMENTO_DAS_SALAS_MS
    const espera = de + Math.floor(Math.random() * Math.max(0, ate - de))
    /*
      At most twice: the normal turn and, if during it they heard whoever manages the channel
      start the cascade (the foundation, a role, an assignment), a second,
      long, waiting for their rooms to arrive. Before (3/11/2026, `!984`),
      turn-taking only stayed quiet when it heard rooms, and the admin's came
      after 80 assignments: each join received the rooms four times, one
      from whoever manages and the others from vaults that could be delayed.
    */
    const vez = (ms: number, jaEsperouPorQuemArruma: boolean): void => {
      this.#revezamentos.set(
        channel,
        setTimeout(() => {
          this.#revezamentos.delete(channel)
          if (this.#connection !== "online" || !this.#groups.has(channel)) return
          if ((this.#salasOuvidas.get(channel) ?? 0) !== ouvidasAntes) return
          if (!jaEsperouPorQuemArruma && (this.#arrumacaoOuvida.get(channel) ?? 0) !== arrumacaoAntes) {
            vez(Session.REVEZAMENTO_ATRAS_DE_QUEM_ARRUMA_MS, true)
            return
          }
          // Categories before rooms, in the order of `republishAuthority`:
          // a room that arrives before its category draws without a group.
          void this.#enviarCategorias(channel)
            .catch(() => {})
            .then(() => this.#enviarSalas(channel))
            .catch(() => {})
        }, ms),
      )
    }
    vez(espera, false)
  }

  /** Someone other than us said a room or category: turn-taking for this channel stays quiet. */
  #ouviuSalas(channel: string, sender: string): void {
    if (sender !== this.identity.address) this.#salasOuvidas.set(channel, (this.#salasOuvidas.get(channel) ?? 0) + 1)
  }

  /**
   * Whoever manages the channel started the cascade (foundation, roles, assignments, banner):
   * their rooms come after, and turn-taking waits for them. Only from whoever can
   * say them (`renomear`, like `republishRooms`); from anyone else it doesn't count.
   */
  #ouviuQuemArruma(channel: string, sender: string): void {
    if (sender === this.identity.address || this.#eDirecta(channel)) return
    if (!this.powersOf(channel, sender).includes("renomear")) return
    this.#arrumacaoOuvida.set(channel, (this.#arrumacaoOuvida.get(channel) ?? 0) + 1)
  }

  /** Stop turn-takings waiting: the connection ended, and the next join asks for them again. */
  #pararRevezamentos(): void {
    for (const relogio of this.#revezamentos.values()) clearTimeout(relogio)
    this.#revezamentos.clear()
  }

  /**
   * Republish who manages the channel, for whoever just entered.
   *
   * The twin of `republishRooms`, for the heaviest thing the channel has. The
   * rooms were an empty space; this is the whole channel with no known owner, and
   * a channel with no known owner used to give everything to everybody.
   *
   * The root is the same and worth stating: `room.created`, `space.meta`,
   * `role.define`, and `role.assign` are published once each, and once only at
   * foundation or management, always in an epoch before whoever gets
   * invited later arrives. Persistent secrecy does the rest: whoever arrives doesn't decrypt
   * any of it and, unlike the history, nobody says it again. The channel
   * was left, for that person, with no owner, no name, and no roles.
   *
   * **The order here is not management, it's the guard.** The foundation goes first and goes
   * alone, because the receiving guards for `role.define` and `role.assign`
   * ask `#mandaEm` at the moment of saving: a role read before the
   * foundation is known is a role refused. First who manages, then what they managed.
   *
   * Each one only republishes what's theirs to, and the assertion is the same as
   * required from whoever publishes the first time: the foundation only from whoever has it,
   * the roles from whoever manages them, the banner from whoever manages the channel. For others
   * this is a no-event.
   *
   * What this opens, stated completely: with a republish circulating, a
   * malicious member can try to publish their own `room.created` to
   * claim ownership among those who don't know anyone yet, before there was nothing
   * to race. They lose the race by design: whoever invites puts this in the socket queue
   * at the same instant they commit the join, and the other only finds out
   * someone joined when that commit reaches them. And "first one wins"
   * closes the door to second attempts, see `channelFounder`.
   *
   * Idempotent for everyone who already knows: the foundation record is not
   * replaced, and the rest saves by timestamp and rewrites the same as before.
   */
  async republishAuthority(channel: string): Promise<void> {
    if (!this.#groups.has(channel)) return

    /**
     * The foundation, and only from whoever founded it.
     *
     * Republishing someone else's foundation would sign it with OUR key, the sender
     * is authenticated by MLS and is the one recorded. That is: it would be taking
     * the channel while trying to fix it, and in foreign vaults it would stay
     * lying forever, because the first record is the one that counts.
     */
    if (this.founderOf(channel) === this.identity.address) {
      // Fail here and the rest aborts: without the foundation saved on the other end,
      // everything that comes after would be refused by the receiving guards. It comes back
      // at the next join or the next connection.
      await this.send(channel, {
        t: "room.created",
        // Derived from the identifier, as in `claimFounder`: the channel name
        // lives in `space.meta`, and this field was never read by anyone.
        name: channel.replace(/^!/, "").split(":")[0] ?? channel,
        createdAt: Date.now(),
      })
    }

    // Only the founder and `admin` republish everything: delegation (1.2) doesn't manage
    // roles above it, and the receiver would refuse half of them.
    if (this.#mandaEm(channel, this.identity.address)) {
      /**
       * The roles defined, rebuilt field by field for the reason of
       * `republishRooms`: what's in the vault came from the network, and a payload that
       * doesn't validate is discarded entirely on the other end and counts as an ignored event.
       *
       * With the original timestamp not with now. A new timestamp would make this
       * republish beat a deletion published meanwhile and still
       * in transit, resurrecting, with the powers it had, a role someone
       * just deleted.
       */
      for (const papel of this.rolesOf(channel)) {
        // The `rank` only if the role had it: a role from before 1.2 comes out equal to what it was.
        const comRank = typeof (this.vault.contents.channelRoles[channel]?.[papel.role]?.payload as { rank?: unknown } | undefined)?.rank === "number"
        await this.send(channel, {
          t: "role.define",
          role: papel.role,
          name: papel.name,
          powers: papel.powers,
          ...(papel.colour ? { colour: papel.colour } : {}),
          position: papel.position,
          ...(comRank ? { rank: papel.rank } : {}),
          removed: false,
          definedAt: this.vault.contents.channelRoles[channel]?.[papel.role]?.at ?? 1,
        })
      }
      // The `@todos`, if someone defined it (1.2). Same rule as the timestamp.
      const todos = this.todosOf(channel)
      if (todos.definido) {
        await this.send(channel, {
          t: "role.define",
          role: CARGO_TODOS,
          name: "todos",
          powers: todos.powers,
          position: 0,
          rank: 0,
          removed: false,
          definedAt: this.vault.contents.channelRoles[channel]?.[CARGO_TODOS]?.at ?? 1,
        })
      }
      // The built-in role name, if someone changed it. Same rule as the timestamp.
      const embutido = this.adminRole(channel)
      if (embutido) {
        await this.send(channel, {
          t: "role.define",
          role: ADMIN_ROLE,
          name: embutido.name,
          powers: [...POWERS],
          ...(embutido.colour ? { colour: embutido.colour } : {}),
          position: 0,
          removed: false,
          definedAt: this.vault.contents.channelRoles[channel]?.[ADMIN_ROLE]?.at ?? 1,
        })
      }

      /**
       * And who has them. The two saves together, the new one and the list of
       * admins from the old format, resolved per person in `rolesFor`,
       * which knows which one counts.
       *
       * An empty list is an answer and goes the same: that's how you say someone
       * was removed, and staying quiet would leave whoever joins see an old
       * admin through the old format entry.
       */
      const comPapel = new Set([
        ...Object.keys(this.vault.contents.channelMemberRoles[channel] ?? {}),
        ...(this.vault.contents.channelAdmins[channel] ?? []),
      ])
      const atribuicoes: Payload[] = []
      for (const address of comPapel) {
        /*
          With the ORIGINAL timestamp (F11), like the `role.define` above and for the same
          reason: with the time now, this resend would beat a change made
          meanwhile and still in transit, and give someone back a role they'd
          had taken away. With no saved timestamp (an assignment from an old vault,
          or from the old format admin list), goes with 1: loses against any
          timestamped assignment, and only counts for those who know nothing.
        */
        atribuicoes.push({
          t: "role.assign",
          subject: address,
          roles: this.rolesFor(channel, address),
          assignedAt: this.vault.contents.channelMemberRolesAt?.[channel]?.[address]?.at ?? 1,
        })
      }
      // All in one vault save, not one each (`#enviarEmLote`).
      await this.sendBatch(channel, atribuicoes)
    }

    if (this.mayEditChannel(channel)) {
      // Categories before the banner, and the banner last: it carries
      // the icon, it's the only one that can exceed the max size of a send, and a
      // failure here can't pull along what still had to be published.
      await this.#enviarCategorias(channel)

      const meta = this.spaceMeta(channel)
      if (meta) {
        await this.send(channel, {
          t: "space.meta",
          name: meta.name,
          ...(meta.topic ? { topic: meta.topic } : {}),
          // The icon travels `inline`, in the same form that `updateSpaceMeta`
          // gives it and for the same reason: `url` is capped at 2048 in the schema, and
          // a payload that doesn't validate is discarded ENTIRELY by whoever receives.
          ...(meta.icon
            ? {
                icon: {
                  url: "",
                  inline: meta.icon,
                  key: "",
                  nonce: "",
                  digest: "",
                  kind: "image" as const,
                  name: "icone",
                  mediaType: meta.icon.slice(5, meta.icon.indexOf(";")) || "image/png",
                  byteLength: meta.icon.length,
                },
              }
            : {}),
          updatedAt: this.vault.contents.spaceMeta[channel]?.at ?? 1,
        })
      }
    }
  }

  // ------------------------------------------------- resend of our own (S1)

  /**
   * The comments, likes, and votes of ours, said again to whoever arrived (S1, §3).
   *
   * Whoever joins a channel doesn't decrypt anything said before their spot. The
   * wall comes back through `republishPosts`; what was said ABOVE it didn't come back, and
   * whoever arrived saw posts without comments and voting with zero votes. Only the
   * author can say again what's theirs: MLS authenticates who sends, and a
   * comment from someone else resent from here would get our name. Anti-entropy
   * with authorship (S4) solves what belongs to others.
   *
   * With the original `id`, timestamp, and target: whoever already has them refuses the
   * copy (`appendHistory` deduplicates by `tipo|autor|id`), and the rollup counts one per
   * author. Only what still stands: a comment we deleted doesn't come back, and of
   * each vote and like only the latest goes (the one that counts in the rollup).
   *
   * **Everything only where all leaves know how to deduplicate** (§4.6, finding 1 of the
   * 0.7.0 review). Comments, because a 0.5.7 saves each resend as a
   * new entry. Likes and votes too, even though a 0.6.0 deduplicates them: only against
   * what it still has in the history, and with the conversation at the same cap of 400. Eleven
   * accounts resending two hundred likes each pulled the entire
   * channel conversation out of a 0.6.0 vault. Votes from our voting in our own feed already
   * go through `republishPosts`, as in 0.6.0. See `#todasAsFolhasReenviam`.
   *
   * @returns the failures, and whether it stopped sending because we don't know who's there
   *   (`retido`), so the caller can try again.
   */
  async republishEngagement(channel: string): Promise<Reenvio> {
    if (!this.#groups.has(channel) || channel === this.canalDaConta) return semReenvio()
    const eu = this.identity.address
    const minhas = porOrdemDoServidor(entradasDoCanal(this.vault.contents, channel)).filter((entrada) => entrada.sender === eu)
    const apagadas = new Set(
      minhas
        .filter((entrada) => entrada.payload.t === "redact")
        .map((entrada) => entrada.payload["target"])
        .filter((alvo): alvo is string => typeof alvo === "string"),
    )

    // The last like and last vote of each target: that's what the rollup counts.
    const ultimas = new Map<string, StoredChatMessage>()
    for (const entrada of minhas) {
      if (entrada.payload.t !== "post.reaction") continue
      const alvo = entrada.payload["target"]
      if (typeof alvo !== "string") continue
      const tipo = typeof entrada.payload["vote"] === "number" ? "voto" : "gosto"
      ultimas.set(`${tipo}|${alvo}`, entrada)
    }
    const comentarios = minhas.filter(
      (entrada) =>
        entrada.payload.t === "post.comment" &&
        typeof entrada.payload["id"] === "string" &&
        !apagadas.has(entrada.payload["id"]),
    )
    if (ultimas.size === 0 && comentarios.length === 0) return semReenvio()
    if (!this.#todasAsFolhasReenviam(channel)) return { falhas: 0, retido: true }

    let falhas = 0
    const falhou = (): void => {
      falhas += 1
    }
    for (const entrada of [...ultimas.values()].slice(-Session.REACCOES_REENVIADAS)) {
      const bruto = entrada.payload as { id?: unknown; target?: unknown; emoji?: unknown; at?: unknown; remove?: unknown; vote?: unknown }
      if (typeof bruto.id !== "string" || typeof bruto.target !== "string") continue
      await this.send(channel, {
        t: "post.reaction",
        id: bruto.id,
        target: bruto.target,
        emoji: typeof bruto.emoji === "string" ? bruto.emoji : "",
        at: typeof bruto.at === "number" ? bruto.at : entrada.at,
        remove: bruto.remove === true,
        ...(typeof bruto.vote === "number" ? { vote: bruto.vote } : {}),
      }).catch(falhou)
    }
    for (const entrada of comentarios.slice(-Session.COMENTARIOS_REENVIADOS)) {
      const bruto = entrada.payload as { id?: unknown; target?: unknown; body?: unknown; postedAt?: unknown }
      if (typeof bruto.id !== "string" || typeof bruto.target !== "string" || typeof bruto.body !== "string") continue
      await this.send(channel, {
        t: "post.comment",
        id: bruto.id,
        target: bruto.target,
        body: bruto.body,
        postedAt: typeof bruto.postedAt === "number" ? bruto.postedAt : entrada.at,
      }).catch(falhou)
    }
    return { falhas, retido: false }
  }

  /**
   * Our actions in tickets, said again to whoever arrived (S1, §3).
   *
   * Whoever joined a ticket room saw an empty board: the openings, the
   * state decisions, and who's attending were said before their spot. Each one says
   * their actions again (the message with the ticket mark that carries subject,
   * state, or who's attending), with the original `id` and timestamp. Simple
   * replies don't: they follow the rule of messages, and whoever joins doesn't read the conversation
   * from before their spot.
   *
   * Only where all leaves know how to deduplicate (§4.6): a ticket is a `message`,
   * and a 0.5.7 showed each resend as a new message.
   *
   * @returns like `republishEngagement`.
   */
  async republishTickets(channel: string): Promise<Reenvio> {
    if (!this.#groups.has(channel) || channel === this.canalDaConta) return semReenvio()
    const eu = this.identity.address
    const minhas = porOrdemDoServidor(entradasDoCanal(this.vault.contents, channel)).filter((entrada) => entrada.sender === eu)
    const apagadas = new Set(
      minhas
        .filter((entrada) => entrada.payload.t === "redact")
        .map((entrada) => entrada.payload["target"])
        .filter((alvo): alvo is string => typeof alvo === "string"),
    )
    const actos = minhas.filter((entrada) => {
      if (entrada.payload.t !== "message") return false
      const marca = entrada.payload["ticket"] as Record<string, unknown> | undefined
      if (!marca || typeof marca !== "object") return false
      if (typeof entrada.payload["id"] !== "string" || apagadas.has(entrada.payload["id"])) return false
      return marca["subject"] !== undefined || marca["state"] !== undefined || marca["assignee"] !== undefined
    })
    if (actos.length === 0) return semReenvio()
    if (!this.#todasAsFolhasReenviam(channel)) return { falhas: 0, retido: true }
    let falhas = 0
    for (const entrada of actos.slice(-Session.ACTOS_DE_TICKET_REENVIADOS)) {
      const bruto = entrada.payload as { id?: unknown; body?: unknown; room?: unknown; sentAt?: unknown; ticket?: unknown }
      const marca = bruto.ticket as Record<string, unknown>
      if (typeof bruto.id !== "string" || typeof marca["id"] !== "string") continue
      await this.send(channel, {
        t: "message",
        id: bruto.id,
        body: typeof bruto.body === "string" ? bruto.body : "",
        sentAt: typeof bruto.sentAt === "number" ? bruto.sentAt : entrada.at,
        attachments: [],
        links: [],
        mentions: [],
        ...(typeof bruto.room === "string" ? { room: bruto.room } : {}),
        // Rebuilt field by field, for the reason of `republishRooms`: a payload
        // that doesn't validate is discarded entirely on the other end.
        ticket: {
          id: marca["id"],
          ...(typeof marca["subject"] === "string" ? { subject: marca["subject"] } : {}),
          ...(typeof marca["state"] === "string" ? { state: marca["state"] as never } : {}),
          ...(typeof marca["assignee"] === "string" ? { assignee: marca["assignee"] } : {}),
          at: typeof marca["at"] === "number" ? marca["at"] : entrada.at,
        } as never,
      }).catch(() => {
        falhas += 1
      })
    }
    return { falhas, retido: false }
  }

  /** Caps for resending our own, per channel and per pass. Static for tests. */
  static REACCOES_REENVIADAS = 200
  static COMENTARIOS_REENVIADOS = 200
  static ACTOS_DE_TICKET_REENVIADOS = 100

  /**
   * The full resend of our own, on a channel: the wall, the comments, likes, and
   * votes, and the tickets. In this order: what gets commented before the comment.
   *
   * Saves the accounts to who's already been told (`reenviadoPara`), so the
   * next connection only repeats where someone new arrived, and **only with zero failed sends
   * and the connection standing** (finding 2 of the 0.7.0 review): a failed send
   * is someone who didn't receive, and calling the channel told was never telling it again. What
   * didn't send because not all leaves announced yet (§4.6) stays in `reenvioPorFazer`
   * and goes on its own when we know (`soOsCondicionados`): without repeating the wall of our own feed,
   * which already went.
   */
  async #reenviarDoProprio(channel: string, soOsCondicionados = false): Promise<void> {
    if (channel === this.canalDaConta || channel === this.#commonRoom || this.#eDirecta(channel)) return
    return this.#umaDeCadaVez(`reenvio|${channel}`, async () => {
      const grupo = this.#groups.get(channel)
      if (!grupo || estaRemovido(grupo) || this.#connection !== "online") return
      const contas = [...new Set([...memberAddresses(grupo.state.ratchetTree).values()].map(String))].sort()
      let falhas = 0
      let retido = false
      const somar = async (passo: () => Promise<Reenvio>): Promise<void> => {
        const feito = await passo().catch(() => ({ falhas: 1, retido: false }))
        falhas += feito.falhas
        retido ||= feito.retido
      }
      // The wall of our own feed (and the votes from our voting) always goes: that's what
      // 0.6.0 already did. In rooms, `republishPosts` waits for the leaves.
      const doFeed = channel === this.feedChannel
      if (!doFeed || !soOsCondicionados) await somar(() => this.republishPosts(channel))
      await somar(() => this.republishEngagement(channel))
      await somar(() => this.republishTickets(channel))
      const porFazer = new Set(this.vault.contents.reenvioPorFazer ?? [])
      if (retido || falhas > 0) porFazer.add(channel)
      else porFazer.delete(channel)
      this.vault.contents.reenvioPorFazer = [...porFazer]
      if (!soOsCondicionados && falhas === 0 && this.#connection === "online") {
        this.vault.contents.reenviadoPara = { ...this.vault.contents.reenviadoPara, [channel]: contas }
      }
      this.#memoriaPorGravar = true
      this.#gravarJa()
    })
  }

  /** Whether the conditional resend for this channel is waiting to know who's there. */
  #reenvioPendente(channel: string): boolean {
    return this.vault.contents.reenvioPorFazer?.includes(channel) ?? false
  }

  /**
   * On connection and every ten minutes: resend the wall and comments to anyone
   * who has not yet received them (`reenviadoPara`). This ensures members who
   * join with the author offline, or while a resend was failing, still get the
   * wall and comments. If nobody new joined, there is no harm in resending.
   *
   * **One channel per pass** (finding 5 from the 0.7.0 review). On first
   * connection after update, `reenviadoPara` is empty in all channels, and
   * running 28 at once meant thousands of MLS sends in a row. Channels queue by
   * name order; each pass picks up from where the last one ended, whether it
   * finished or failed, and a failing channel does not block others. A member
   * joining a channel does not wait for the queue: the group grows and that
   * channel's resend fires right away.
   */
  async #reenviarOndeFaltar(): Promise<void> {
    const canais = [...this.#groups.keys()].sort()
    const depois = canais.findIndex((canal) => canal > this.#ultimoReenvioDaFila)
    const fila = depois < 0 ? canais : [...canais.slice(depois), ...canais.slice(0, depois)]
    for (const channel of fila) {
      if (this.#connection !== "online") return
      if (channel === this.canalDaConta || channel === this.#commonRoom || this.#eDirecta(channel)) continue
      const grupo = this.#groups.get(channel)
      if (!grupo) continue
      const contas = new Set([...memberAddresses(grupo.state.ratchetTree).values()].map(String))
      const ditas = new Set(this.vault.contents.reenviadoPara?.[channel] ?? [])
      const falta = [...contas].some((conta) => conta !== this.identity.address && !ditas.has(conta))
      // Only queue those waiting if we already know they can leave: without this,
      // a channel with a 0.6.0 leaf would repeat the wall on each pass.
      const condicionados = !falta && this.#reenvioPendente(channel) && this.#todasAsFolhasReenviam(channel)
      if (!falta && !condicionados) continue
      this.#ultimoReenvioDaFila = channel
      await this.#reenviarDoProprio(channel, condicionados).catch(() => {})
      return
    }
  }

  /** The last channel the resend queue ran. Memory only: after reload, the queue starts over. */
  #ultimoReenvioDaFila = ""

  /**
   * Whether all LIVE leaves in this channel announced they can deduplicate resends (§4.6).
   *
   * By device signal with `CAPACIDADE_REENVIO`, which each device sends once per
   * channel and again when the channel grows. A leaf with no known device key, or
   * that never announced, counts as 0.6.0: unknown, and the unknown do not resend.
   *
   * **Excluding dead leaves** (finding 13 from the 0.7.0 review). A deaf or
   * abandoned device never announces, and resend would wait for it forever. Dead is a
   * leaf that opened nothing in the current epoch (`#folhasMortas`) AND this device
   * has not heard from it for `FOLHA_CALADA_MS` (`aparelhoVistoNoCanal`, counted from
   * when it first observes the channel). Both conditions, not just the first: in a
   * newly born epoch nothing has opened yet, and that is exactly when (the channel
   * grew) resend runs. Only the first would mark 0.6.0 leaves alive as dead, and
   * resend would crash into them.
   */
  #todasAsFolhasReenviam(channel: string): boolean {
    return this.#todasAsFolhasDisseram(channel, this.vault.contents.capacidadesNoCanal?.[channel] ?? {})
  }

  /**
   * Whether all leaves in the channel (minus dead ones, see above) are capable.
   * The question `#todasAsFolhasReenviam` asks, for any capability announced in
   * the device signal; role delegation (1.2) asks the same.
   */
  #todasAsFolhasDisseram(channel: string, capazes: Readonly<Record<string, number>>): boolean {
    const grupo = this.#groups.get(channel)
    if (!grupo) return false
    const arvore = grupo.state.ratchetTree
    const meu = toBase64(this.identity.deviceSigningPublicKey)
    const mortasPorConta = new Map<string, string[] | null>()
    for (const [folha, conta] of memberAddresses(arvore)) {
      const chave = deviceKeyAtLeaf(arvore, folha)
      if (!chave) return false
      const base64 = toBase64(chave)
      if (base64 === meu || capazes[base64] !== undefined) continue
      const endereco = String(conta)
      if (!mortasPorConta.has(endereco)) mortasPorConta.set(endereco, this.#folhasMortas(channel, grupo, endereco))
      if (this.#calada(channel, base64, mortasPorConta.get(endereco) ?? null)) continue
      return false
    }
    return true
  }

  /** Whether a leaf that never announced is dead for §4.6. See `#todasAsFolhasReenviam`. */
  #calada(channel: string, aparelho: string, mortasDaConta: string[] | null): boolean {
    if (mortasDaConta === null || !mortasDaConta.includes(aparelho)) return false
    const agora = Date.now()
    let desde = this.vault.contents.canalObservadoDesde?.[channel]
    if (desde === undefined) {
      desde = agora
      this.vault.contents.canalObservadoDesde = { ...this.vault.contents.canalObservadoDesde, [channel]: agora }
      this.#memoriaPorGravar = true
    }
    const visto = this.vault.contents.aparelhoVistoNoCanal?.[channel]?.[aparelho] ?? 0
    return agora - Math.max(desde, visto) >= Session.FOLHA_CALADA_MS
  }

  /**
   * How long a leaf that never announced must stay silent before it stops
   * blocking resend. Fourteen days: a live 0.6.0 speaks much sooner than that
   * (publishes profile when channel grows, writes, announces to siblings), and in
   * fourteen days 0.6.0 leaves have updated. Static for tests.
   */
  static FOLHA_CALADA_MS = 14 * 24 * 3_600_000

  /**
   * Announce in this channel that this device deduplicates resends (§4.6), and
   * request profiles if `pedirPerfis` (F10). Via device signal: an expired
   * `typing`, which all clients know and none display.
   */
  async #anunciarReenvio(channel: string, pedirPerfis = false): Promise<void> {
    if (channel === this.canalDaConta || channel === this.#commonRoom || !this.#groups.has(channel)) return
    // In a direct there is no wall or tickets to resend: only the profile request goes.
    if (this.#eDirecta(channel) && !pedirPerfis) return
    // With no connection nothing goes out, and a failed send wasted the ratchet for nothing.
    if (this.#connection !== "online") return
    await this.#sinalDeAparelho(channel, pedirPerfis)
    this.vault.contents.reenvioAnunciado = { ...this.vault.contents.reenvioAnunciado, [channel]: Date.now() }
    // The same signal carries `CAPACIDADE_PERMISSOES` since 1.2.
    this.vault.contents.permissoesAnunciadas = { ...this.vault.contents.permissoesAnunciadas, [channel]: Date.now() }
    this.#memoriaPorGravar = true
    this.#gravarJa()
  }

  /** On connection: announce resend in channels where this device has not yet done so. */
  async #anunciarReenvioEmFalta(): Promise<void> {
    for (const channel of [...this.#groups.keys()]) {
      if (this.#connection !== "online") return
      // A device that announced before 1.2 announces again, once, for the permissions model.
      const jaDisse =
        this.vault.contents.reenvioAnunciado?.[channel] !== undefined &&
        this.vault.contents.permissoesAnunciadas?.[channel] !== undefined
      if (jaDisse || this.#eDirecta(channel)) continue
      await this.#anunciarReenvio(channel).catch(() => {})
    }
  }

  /**
   * A device said in a channel that it deduplicates resends. Record it, and if
   * resend was waiting for this in that channel, try now.
   */
  #notarReenvio(channel: string, deviceKey: Uint8Array): void {
    if (!this.vault.unlocked) return
    const chave = toBase64(deviceKey)
    const doCanal = this.vault.contents.capacidadesNoCanal?.[channel] ?? {}
    if (doCanal[chave] === undefined) {
      this.vault.contents.capacidadesNoCanal = {
        ...this.vault.contents.capacidadesNoCanal,
        [channel]: maisRecentes({ ...doCanal, [chave]: Date.now() }, Session.CAPACIDADES_POR_CANAL, (at) => at),
      }
      this.#memoriaPorGravar = true
      this.#gravarJa()
    }
    if (this.#reenvioPendente(channel) && this.#todasAsFolhasReenviam(channel) && this.#connection === "online") {
      void this.#reenviarDoProprio(channel, true).catch(() => {})
    }
  }

  /** A device said in a channel that it reads the permissions model (1.2). See `delegacaoDeCargos`. */
  #notarPermissoes(channel: string, deviceKey: Uint8Array): void {
    if (!this.vault.unlocked) return
    const chave = toBase64(deviceKey)
    const doCanal = this.vault.contents.conhecemPermissoes?.[channel] ?? {}
    if (doCanal[chave] !== undefined) return
    this.vault.contents.conhecemPermissoes = {
      ...this.vault.contents.conhecemPermissoes,
      [channel]: maisRecentes({ ...doCanal, [chave]: Date.now() }, Session.CAPACIDADES_POR_CANAL, (at) => at),
    }
    this.#memoriaPorGravar = true
    this.#gravarJa()
  }

  /** How many announced devices to remember per channel. The cap of leaves that matter, with headroom. */
  static CAPACIDADES_POR_CANAL = 512

  /**
   * F10: someone in this channel shows up without a name. Request profiles, at
   * most once per channel every `PEDIDO_DE_PERFIS_MS`.
   *
   * Via device signal with `CAPACIDADE_PEDE_PERFIS`: whoever reads it publishes
   * their profile in this channel. A 0.5.7 client drops the field and does not
   * respond; there is no worse than today.
   */
  async #pedirPerfisEmFalta(): Promise<void> {
    for (const channel of [...this.#groups.keys()]) {
      if (this.#connection !== "online") return
      if (channel === this.canalDaConta || channel === this.#commonRoom) continue
      const grupo = this.#groups.get(channel)
      if (!grupo) continue
      const contas = new Set([...memberAddresses(grupo.state.ratchetTree).values()].map(String))
      const semNome = contasSemPerfil(contas, this.identity.address, this.vault.contents.directory)
      if (semNome.length === 0) continue
      // Once per each new nameless account in this channel, not every ten minutes:
      // see `perfisPedidos` in the vault.
      const jaPedidos = new Set(this.vault.contents.perfisPedidos?.[channel] ?? [])
      if (semNome.every((conta) => jaPedidos.has(conta))) continue
      if (!this.#podeAgora(this.#perfisPedidos, channel, Session.PEDIDO_DE_PERFIS_MS)) continue
      await this.#anunciarReenvio(channel, true).catch(() => {})
      this.vault.contents.perfisPedidos = { ...this.vault.contents.perfisPedidos, [channel]: semNome }
    }
  }

  /** When profiles were requested in each channel. Memory only. */
  #perfisPedidos = new Map<string, number>()

  /** Between two profile requests in the same channel. Static for tests. */
  static PEDIDO_DE_PERFIS_MS = 10 * 60_000

  /** Between two answers to profile requests in the same channel (`perfisDadosEm`). Static for tests. */
  static PERFIS_DADOS_MS = 24 * 3_600_000

  /**
   * F10: a member of this channel requested profiles. Respond by publishing ours
   * here, only when someone is listening (finding 4 from the 0.7.0 review).
   *
   * Without these guards, the request was a way to make all accounts in a
   * channel publish their profile (up to 124 KB with avatar) in a loop: just
   * repeat it. Respond only if all three hold:
   *
   * 1. there is an account in the channel that was not there when our profile
   *    last went out (`perfilPublicadoPara`): whoever was there already has it,
   *    or lost it on their own, and their request is not enough to repeat it to
   *    everyone;
   * 2. we did not respond in this channel in the last 24 hours (`perfisDadosEm`,
   *    in the vault: a reload does not unlock the door again);
   * 3. the request is not stale: one that arrives from recovery with `seq` below
   *    what was already read before this connection already had its turn.
   */
  #responderAPedidoDePerfis(channel: string, sender: string, seq: number, aoVivo: boolean): void {
    if (!this.vault.unlocked || sender === this.identity.address || this.#bloqueadoAqui(channel, sender)) return
    const grupo = this.#groups.get(channel)
    if (!grupo) return
    const agora = Date.now()
    const responde = podeResponderAPedidoDePerfis({
      eu: this.identity.address,
      contas: [...memberAddresses(grupo.state.ratchetTree).values()].map(String),
      ditas: this.vault.contents.perfilPublicadoPara?.[channel],
      ultimaResposta: this.vault.contents.perfisDadosEm?.[channel],
      agora,
      seq,
      aoVivo,
      lidoAntesDaLigacao: this.#lastSeqAntesDaLigacao[channel],
    })
    if (!responde) return
    this.vault.contents.perfisDadosEm = maisRecentes(
      { ...this.vault.contents.perfisDadosEm, [channel]: agora },
      Session.CAPACIDADES_POR_CANAL,
      (at) => at,
    )
    this.#memoriaPorGravar = true
    this.#gravarJa()
    void this.publishProfile([channel], true).catch(() => {})
  }

  /** The `lastSeq` of each channel when this connection started. See `#responderAPedidoDePerfis`. */
  #lastSeqAntesDaLigacao: Record<string, number> = {}

  // ---------------------------------------------------------------- profile

  async updateProfile(next: Omit<StoredProfile, "activity" | "updatedAt"> & { activity?: string }): Promise<void> {
    /*
      The chosen state enters the profile only if it is one that publishes (phase
      1h). "online" is the absence of state, and "invisible" does not publish: being
      invisible means not being announced. An unknown value drops.
    */
    const { activity, ...resto } = next
    const profile: StoredProfile = {
      ...resto,
      ...(activity === "ocupado" || activity === "ausente" ? { activity } : {}),
      updatedAt: Date.now(),
    }
    await this.vault.update((contents) => {
      contents.profile = profile
    })
    await this.publishProfile()
    // And to other devices on the account, so they show the same (phase 1e). Without
    // a name it does not go: an empty profile would erase the main one.
    if (profile.displayName) this.#enviarEstado(this.#payloadDoPerfil(profile))
  }

  /**
   * The `profile` payload of a saved profile: what goes to each channel and, since
   * phase 1e, to the account channel. Same payload in both places, on purpose: all
   * clients know it, and an old sibling in the account channel reads it and
   * ignores it, instead of rejecting it (five rejections in a row marked the
   * channel as deaf).
   */
  #payloadDoPerfil(profile: StoredProfile, channel?: string): Payload {
    /*
      The wall secret (D1) goes in each direct and channel, never in the common
      room: the common room holds the entire account on the server, operator
      included, and the secret there would give them the address of each wall and,
      through subscriptions, who follows whom. That is what the opaque address
      exists not to reveal.
      */
    const mural = channel !== undefined && channel === this.#commonRoom ? undefined : this.#segredoDoMuralEmTexto()
    return {
      t: "profile",
      displayName: profile.displayName,
      ...(mural ? { mural } : {}),
      donations: profile.donations.map((entry) => ({
        kind: entry.kind as "url" | "iban" | "paypal" | "kofi" | "liberapay" | "bitcoin" | "monero" | "other",
        label: entry.label,
        value: entry.value,
      })),
      updatedAt: profile.updatedAt,
      // The chosen state (phase 1h). Until now it stayed out, and "busy" only showed
      // on its own device. Away is "online".
      ...(profile.activity === "ocupado" || profile.activity === "ausente" ? { activity: profile.activity } : {}),
      ...(profile.statusText ? { statusText: profile.statusText } : {}),
      ...(profile.bio ? { bio: profile.bio } : {}),
      ...(profile.email ? { email: profile.email } : {}),
      ...(profile.avatarDataUrl
        ? {
            avatar: {
              // The data URL goes in `inline`, never in `url`. `url` is capped at 2048
              // characters in the schema and any real avatar exceeds it, which made the
              // receiver reject the entire payload (name included) and count the event as
              // ignored, three ignored events mark the channel deaf and trigger the cascade
              // of resets that erase history for forward secrecy. `inline` accepts 4 MB and is
              // the field the reader looks for (useDirectory).
              url: "",
              inline: profile.avatarDataUrl,
              key: "",
              nonce: "",
              digest: "",
              kind: "image" as const,
              name: "avatar",
              mediaType: "image/*",
              byteLength: profile.avatarDataUrl.length,
            },
          }
        : {}),
    }
  }

  /**
   * Push the profile into every channel we belong to.
   *
   * There is no profile endpoint to PUT to. The cost of that is honest: someone
   * who has never shared a channel with us cannot see our name or picture at
   * all. That is the same trade as the rest of the system, applied consistently.
   */
  /**
   * @param force publish even where this exact version already went out. Only
   *   for a channel whose membership just changed, where somebody new may be
   *   listening who never received it.
   *
   * @returns the channels where the profile did NOT go out, which is why this
   *   now returns something instead of `void`.
   *
   *   **The reason is a repair round that burned itself out for nothing.** The two
   *   ways this fails, `#send` with no connection, and the vault full refusing
   *   write, are both inside the per-channel `try/catch` down here, on purpose: a
   *   channel we cannot send to must not block others. But the effect was this
   *   method resolved successfully even when nothing went out, and whoever called
   *   it to repair profiles recorded the round as done on zero publications, with no
   *   second chance.
   *
   *   Who needs to know, asks: empty list means "went out everywhere". A channel
   *   SKIPPED because it already has this version is not a failure and does not
   *   appear here, it went out, just on another day.
   *
   *   **And with no `displayName` ALL fail**, which is the second part of the same
   *   fix: there is nothing to publish, so nothing is published, and saying "it went
   *   well" was the round considering itself done on a profile nobody ever had.
   *   Whoever publishes on their own ignores this for free; whoever repairs cannot.
   */
  async publishProfile(channels: string[] = this.channels, force = false): Promise<string[]> {
    const profile = this.profile
    /*
      With no name, the profile goes out in OUR wall only, and nowhere else: it
      carries the wall secret (D1), and a nameless account also has friends. Whoever
      receives it checks that the secret's address is from the channel it arrived in,
      and learns it is the wall of who sent it (`#fichaDoMuralQueChegou`). In other
      channels a nameless profile says nothing to anyone, and does not go out.
    */
    const semNome = !profile.displayName
    const meuMural = this.#identity !== null ? this.feedChannel : ""
    if (semNome && (!meuMural || !channels.includes(meuMural))) return [...channels]

    const falhados: string[] = []
    for (const channel of channels) {
      if (semNome && channel !== meuMural) {
        falhados.push(channel)
        continue
      }
      // Republishing an unchanged profile is pure cost: at ~124 KB with an
      // avatar, on every connection and every epoch change, to every channel,
      // it was almost the entire content of a live server's database and it
      // pushed real messages out of the capped local timeline. `updatedAt` only
      // moves when the user actually edits their profile.
      if (!force && this.vault.contents.publishedProfileAt[channel] === profile.updatedAt) continue

      try {
        await this.send(channel, this.#payloadDoPerfil(profile, channel))
        // Only after the send succeeded: a failed publish must be retried, not
        // remembered as done.
        const grupo = this.#groups.get(channel)
        const contas = grupo ? [...new Set([...memberAddresses(grupo.state.ratchetTree).values()].map(String))].sort() : []
        await this.vault.update((contents) => {
          contents.publishedProfileAt[channel] = profile.updatedAt
          // F10: the accounts that received it, so a profile request only answers when
          // there is someone new. See `#responderAPedidoDePerfis`.
          contents.perfilPublicadoPara = { ...contents.perfilPublicadoPara, [channel]: contas }
        })
      } catch {
        // A channel we cannot currently send to. It will pick up the profile on the
        // next update, and whoever called knows, which is the difference between a
        // repair that repeats and one that burns out for nothing.
        falhados.push(channel)
        /*
          F10: a forced send that fails is a profile someone new does not have.
          Forget the version published in this channel makes the next connection
          (`publishProfile()` without force) resend it. Without this, the channel
          showed as published and the profile never went out again to who joined.
        */
        if (force && this.vault.contents.publishedProfileAt[channel] !== undefined) {
          const { [channel]: _esquecido, ...resto } = this.vault.contents.publishedProfileAt
          this.vault.contents.publishedProfileAt = resto
          this.#memoriaPorGravar = true
          this.#gravarJa()
        }
      }
    }
    return falhados
  }

  // ---------------------------------------------------------------- invites

  /**
   * Mint an invite link for a channel.
   *
   * The code exists only in the link. The server is told its hash and the policy
   * — when it stops working, how many times it may be used — and nothing else,
   * so a breach of its database yields no working invite.
   *
   * Be clear-eyed about what a link is: a bearer secret. Whoever holds it, or
   * whoever it gets forwarded to, can ask to join. That is a real loosening
   * compared with naming someone by address, and it is the reason expiry and a
   * use limit exist at all.
   */
  async createInvite(channel: string, policy: InvitePolicy = {}): Promise<string> {
    return (await this.criarConvite(channel, policy)).longa
  }

  /**
   * Mint an invite and return both links: the long one, which always works, and
   * the short one (`/c#<código curto>.<código>`), when the server gave a short code in `invite.created`
   * (`CAPACIDADE_LIGACOES_CURTAS`). The interface shows the short one when available (1.0 "Arca", slice
   * 5b-2). `createInvite` keeps its usual form, the long one, for those already
   * reading it.
   */
  async criarConvite(channel: string, policy: InvitePolicy = {}): Promise<{ longa: string; curta: string | null }> {
    if (!this.#groups.has(channel)) throw new Error("not a member of this channel", { cause: { channel } })
    // Minting a link is inviting in the open, broader than naming someone, not
    // narrower, so it asks the same responsibility. See `invite`.
    if (!this.may(channel, "convidar")) throw new Error("you may not invite in this channel", { cause: { channel } })

    // 16 characters in base32 (80 bits) since 1.0: the code must fit in the short
    // link. Earlier ones (24 bytes in base64url) still work.
    const code = novoCodigoDoConvite()
    const codeHash = toBase64(sha256(new TextEncoder().encode(code)))
    // The channel name, sealed with the code (slice 5c): with opaque addresses, the
    // address tells nothing to who opens the link, and the name only lives encrypted
    // inside the channel. The server keeps the seal without being able to open it.
    // See `nomeDoConvite`.
    const nomeDoCanal = this.spaceMeta(channel)?.name
    const selo = nomeDoCanal
      ? selarNomeDoConvite(code, { canal: nomeDoCanal, ...(this.profile.displayName ? { quem: this.profile.displayName } : {}) })
      : undefined

    this.#send({
      t: "invite.create",
      channel,
      codeHash,
      expiresAt: policy.expiresInSeconds ? Math.floor(Date.now() / 1000) + policy.expiresInSeconds : null,
      maxUses: policy.maxUses ?? null,
      // The PUBLIC key of the proof: the joiner must sign with the private one, which
      // only comes from the link's code. See `prova-do-convite.ts` (1.0 slice 2).
      codeKey: toBase64(chaveDaProvaDoConvite(code).publica),
      ...(selo ? { selo } : {}),
    })
    const criado = await this.#await("invite.created")

    // Remember what we minted. This list is the only thing that distinguishes a
    // genuine invitation from one a stranger registered for a channel they are
    // not in — the server accepts `invite.create` from any account, so it can
    // vouch for nothing.
    await this.vault.update((contents) => {
      contents.mintedInvites[codeHash] = { channel, createdAt: Date.now() }
    })

    // The channel travels in the link so the joiner's client knows where to
    // point. Both it and the code live in the fragment: see `formatInviteLink`.
    // The short one does not carry the channel: who opens it asks the server for
    // it by short code (`resolverConvite`).
    const servidor = homeserverOf(this.identity)
    const codigoCurto = criado.t === "invite.created" ? criado.codigoCurto : undefined
    return {
      longa: formatInviteLink(servidor, channel, code),
      curta: codigoCurto ? formatShortInviteLink(servidor, codigoCurto, code) : null,
    }
  }

  /**
   * A short invite link, resolved to the long form (1.0 "Arca", slice 5b-2).
   *
   * Sends to the server only the short code (`invite.resolve`, which does not
   * consume a use). The response brings the channel and the `codeHash`. The
   * invite code stays here, and that is what validates the response: the
   * `codeHash` must be the `sha256` of the code that the link carried. If not,
   * the link has the short code of one invite and the code of another (copied in
   * pieces, or on purpose), and stops here, before any `invite.redeem`: no use
   * is consumed.
   *
   * The `codeHash` is verified instead of the public key of the proof because
   * `invite.resolved` only brings the hash (slice 4). For this purpose they are
   * equivalent: both come only from the code, both were given to the server by
   * whoever created the invite, and a different code yields neither. The proof
   * itself is verified by the server on `invite.redeem`, against the public key.
   *
   * Returns the canonical long invite link (`formatInviteLink`), which is what
   * the rest of the app already knows how to follow: show the channel, check if
   * we are already there, redeem.
   */
  async resolverConvite(link: string): Promise<string> {
    const lida = parseShortInviteLink(link)
    if (!lida) throw new Error("that is not a valid invite link")
    // As in `redeemInvite`: the short code exists only on the device of whoever issued it.
    if (!sameHomeserver(lida.server, homeserverOf(this.identity))) {
      throw new Error("that invite is from another server")
    }
    // A server without this capability does not respond to `invite.resolve`, and
    // the user would wait ten seconds for a timeout.
    if (!this.#serverCapabilities.includes(CAPACIDADE_LIGACOES_CURTAS)) {
      throw new Error("this server does not open short invite links")
    }

    this.#send({ t: "invite.resolve", codigo: lida.codigoCurto })
    // The two responses are matched by short code, in a single queue. See the
    // dispatch of waits in `#onFrame`.
    const resposta = await this.#await("invite.resolved", 10_000, lida.codigoCurto)
    if (resposta.t === "invite.unresolved") {
      throw new Error(
        // The cap (per account or per server) resets in a minute, and the message says
        // so. The other three are from `invite.rejected`.
        resposta.reason === "rate-limited"
          ? "too many invite lookups"
          : resposta.reason === "expired"
            ? "that invite expired"
            : resposta.reason === "exhausted"
              ? "that invite reached its limit"
              : "that invite no longer exists",
      )
    }
    if (resposta.t !== "invite.resolved") throw new Error("that invite no longer exists")

    const esperado = toBase64(sha256(new TextEncoder().encode(lida.code)))
    if (resposta.codeHash !== esperado) throw new Error("this invite link is wrong")
    // The seal came in the same response: it opens right away, and the lookup does
    // not ask the server again (`nomeDoConvite` reads from here first).
    const nome = resposta.selo ? abrirSeloDoConvite(lida.code, resposta.selo) : null
    this.#nomesDosConvites.set(esperado, nome)
    return formatInviteLink(lida.server, resposta.channel, lida.code)
  }

  /** Seals already opened (or that did not open), by `codeHash`. Memory only. */
  readonly #nomesDosConvites = new Map<string, NomeDoConvite | null>()

  /**
   * The channel name from an invite, opened from the seal with the code of the
   * link (1.0 "Arca", slice 5c; see `selo-do-convite.ts`).
   *
   * Receives the long link (the short arrives here already resolved). Asks the
   * server for the seal by `codeHash` (`invite.selo`), unless the short link
   * resolution already brought it. `null` when there is no name to show: server
   * without `CAPACIDADE_SELO_DO_CONVITE`, invite from another server, old invite
   * without seal, seal that does not open (corrupted or tampered), or server that
   * did not respond. Never throws: the name is for the lookup, and its absence
   * does not stop anything.
   *
   * The name is still text from whoever created the invite. The seal proves it
   * came from whoever had the code, not that it is true.
   */
  async nomeDoConvite(link: string): Promise<NomeDoConvite | null> {
    const lida = parseInviteLink(link)
    if (!lida) return null
    const codeHash = toBase64(sha256(new TextEncoder().encode(lida.code)))
    if (this.#nomesDosConvites.has(codeHash)) return this.#nomesDosConvites.get(codeHash) ?? null
    if (!sameHomeserver(lida.server, homeserverOf(this.identity))) return null
    if (!this.#serverCapabilities.includes(CAPACIDADE_SELO_DO_CONVITE)) return null
    try {
      this.#send({ t: "invite.selo", codeHash })
      const resposta = await this.#await("invite.selo.result", 5_000, codeHash)
      const nome = resposta.t === "invite.selo.result" && resposta.selo ? abrirSeloDoConvite(lida.code, resposta.selo) : null
      this.#nomesDosConvites.set(codeHash, nome)
      return nome
    } catch {
      return null
    }
  }

  async listInvites(channel: string): Promise<StoredInvite[]> {
    this.#send({ t: "invite.list", channel })
    const frame = await this.#await("invite.list.result")
    return frame.t === "invite.list.result" ? frame.invites : []
  }

  async revokeInvite(codeHash: string): Promise<void> {
    this.#send({ t: "invite.revoke", codeHash })
  }

  /**
   * STUN and TURN servers for a call, from our own homeserver.
   *
   * Empty when the operator runs none, and the caller falls back to a public
   * STUN — which works on forgiving networks, fails behind symmetric NAT and
   * CGNAT, and tells a third party the time and IP of every call.
   */
  async iceServers(): Promise<{ urls: string[]; username?: string | undefined; credential?: string | undefined }[]> {
    /**
     * Keep trying, because giving up here breaks the entire call.
     *
     * `#send` throws immediately when the socket is not open, and this catch
     * treated that as "old homeserver" and returned an empty list. It takes just
     * the connection reconnecting at the instant someone enters a call, a matter
     * of seconds, and common on mobile or satellite links, for the call to start
     * without a relay server. Whoever ends up that way reaches whoever they can
     * reach directly and no one else, with nothing on screen to say so.
     *
     * Three attempts over two seconds cover a reconnection; a homeserver that
     * does not know the request keeps returning an empty list on the first try,
     * and in that case the follow-up attempts cost two seconds once per call.
     */
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      if (tentativa > 0) await new Promise((resolve) => setTimeout(resolve, 1000))
      try {
        this.#send({ t: "ice.servers" })
      } catch {
        continue
      }
      try {
        const frame = await this.#await("ice.servers.result")
        if (frame.t === "ice.servers.result") return frame.servers
      } catch {
        // No response: a homeserver that does not know the request, or the connection
        // dropping between send and response. Both deserve another try.
      }
    }
    return []
  }

  // ------------------------------------------------------------------- sfu
  //
  // Media signalling with the SERVER, not with other participants. It lives at
  // the gateway level (`wire.ts`) and not in MLS payloads, because with SFU you
  // negotiate with the relay, and the relay is not a group member, has no key,
  // and cannot read an encrypted payload even if it wanted to.
  //
  // None of this runs until `hello.ok` announces the `sfu` capability. See
  // `suportaSfu`, and the rule it guards: server first, client second.

  /**
   * A request to the SFU, and the response to THIS request.
   *
   * The tag is generated here and echoed by the gateway. A counter, not random:
   * the tag only needs to tell requests from this connection apart from each
   * other, it is not secret, not identity, and nothing on the other side keeps
   * it. What it prevents is a response being delivered to the wrong request, and
   * for that a number that never repeats in this session is enough.
   *
   * An `sfu.error` with the same tag rejects this request and no other: a full
   * call cannot break the transport that was already connecting.
   */
  async #pedirSfu(
    frame: PedidoSfuSemEtiqueta,
    esperado: ServerFrame["t"],
    timeoutMs = 15_000,
  ): Promise<ServerFrame> {
    const ref = `s${this.#sfuEtiqueta++}`
    return new Promise<ServerFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#sfuPendentes.delete(ref)
        reject(new Error("the server did not answer in time", { cause: { kind: esperado } }))
      }, timeoutMs)

      this.#sfuPendentes.set(ref, {
        esperado,
        resolver: (resposta) => {
          clearTimeout(timer)
          this.#sfuPendentes.delete(ref)
          resolve(resposta)
        },
        rejeitar: (erro) => {
          clearTimeout(timer)
          this.#sfuPendentes.delete(ref)
          reject(erro)
        },
      })

      try {
        this.#send({ ...frame, ref })
      } catch (erro) {
        clearTimeout(timer)
        this.#sfuPendentes.delete(ref)
        reject(erro as Error)
      }
    })
  }

  /**
   * Enter a room call and receive what it is saying.
   *
   * The first frame of all, and it has to be: `device.load()` from
   * `mediasoup-client` needs the router's `rtpCapabilities` BEFORE any
   * transport exists. It is also where the server does admission, the usual
   * `#mayReach`, the same one that keeps the history and live encryption.
   *
   * `producers` brings who is already there talking. Without them, someone
   * joining late would only hear from those who speak AFTER them, the classic
   * bug of entering a room and finding it empty while everyone is talking.
   */
  async sfuEntrarNoAmbito(
    channel: string,
    scope: string,
  ): Promise<{
    rtpCapabilities: unknown
    producers: { id: string; kind: "audio" | "video"; address: UserAddress; fonte?: FonteDeMedia | undefined }[]
  }> {
    const frame = await this.#pedirSfu({ t: "sfu.scope.join", channel, scope }, "sfu.scope.joined")
    if (frame.t !== "sfu.scope.joined") throw new Error("unexpected answer from the server", { cause: { kind: frame.t } })
    // The address comes from the wire as a string and the tag is ours, as everywhere
    // in this file: the server does not have the type, and the schema validates it.
    return {
      rtpCapabilities: frame.rtpCapabilities,
      producers: frame.producers.map((cada) => ({ ...cada, address: cada.address as UserAddress })),
    }
  }

  /**
   * Leave the call, dropping transports, producers, and consumers.
   *
   * Does not wait for a response, and that is not careless: the gateway sends
   * none. The path where calls actually end is the socket dropping, a closed
   * tab sends no frame, and it is the server's `#drop` that handles that. This
   * is the clean exit, for when it exists.
   */
  sfuSairDoAmbito(channel: string, scope: string): void {
    // An exit that breaks because the connection already dropped is not an error:
    // the server dropped everything it had to drop when the socket died.
    try {
      this.#send({ t: "sfu.scope.leave", channel, scope })
    } catch {
      // No connection means nothing to tell anyone.
    }
  }

  async sfuCriarTransporte(
    channel: string,
    scope: string,
    direction: "envio" | "recepcao",
  ): Promise<{ id: string; iceParameters: unknown; iceCandidates: unknown; dtlsParameters: unknown }> {
    const frame = await this.#pedirSfu(
      { t: "sfu.transport.create", channel, scope, direction },
      "sfu.transport.created",
    )
    if (frame.t !== "sfu.transport.created") throw new Error("unexpected answer from the server", { cause: { kind: frame.t } })
    return {
      id: frame.transport,
      iceParameters: frame.iceParameters,
      iceCandidates: frame.iceCandidates,
      dtlsParameters: frame.dtlsParameters,
    }
  }

  async sfuLigarTransporte(transport: string, dtlsParameters: unknown): Promise<void> {
    await this.#pedirSfu({ t: "sfu.transport.connect", transport, dtlsParameters }, "sfu.transport.connected")
  }

  /**
   * Add a stream to the call, saying where it comes from.
   *
   * The `source` travels because with SFU there is no reserved slot: two videos
   * from the same person, face and screen, are two producers indistinguishable
   * by `kind`, and whoever receives them needs to know which goes to the stage
   * and which goes to the card. Optional in the schema, for a server reading an
   * old client; always supplied by this client, which knows what it is sending.
   */
  async sfuProduzir(
    transport: string,
    kind: "audio" | "video",
    rtpParameters: unknown,
    fonte?: FonteDeMedia,
  ): Promise<string> {
    const frame = await this.#pedirSfu(
      { t: "sfu.produce", transport, kind, rtpParameters, ...(fonte ? { fonte } : {}) },
      "sfu.produced",
    )
    if (frame.t !== "sfu.produced") throw new Error("unexpected answer from the server", { cause: { kind: frame.t } })
    return frame.producer
  }

  /**
   * Remove a stream from the call without leaving it.
   *
   * Stop sharing the screen: the transport stays, the microphone stays, and one
   * producer of three dies. Without this the server would keep announcing to
   * arrivals a stream that no longer exists, and whoever was watching would be
   * stuck with the last frame frozen forever, with no error anywhere.
   */
  async sfuFecharProdutor(producer: string): Promise<void> {
    await this.#pedirSfu({ t: "sfu.produce.close", producer }, "sfu.produce.closed")
  }

  async sfuConsumir(
    transport: string,
    producer: string,
    rtpCapabilities: unknown,
  ): Promise<{ id: string; producerId: string; kind: "audio" | "video"; rtpParameters: unknown }> {
    const frame = await this.#pedirSfu({ t: "sfu.consume", transport, producer, rtpCapabilities }, "sfu.consumed")
    if (frame.t !== "sfu.consumed") throw new Error("unexpected answer from the server", { cause: { kind: frame.t } })
    return { id: frame.consumer, producerId: frame.producer, kind: frame.kind, rtpParameters: frame.rtpParameters }
  }

  /**
   * "I installed decryption: send it."
   *
   * Without this there is no call. The consumer is born paused because between
   * `consume` and installing the decryption transform there is a window, and
   * what passes through arrives encrypted at the decoder, which reads it as
   * noise, and noise is indistinguishable from a fault for whoever listens.
   *
   * `timeoutMs` is a parameter so tests can measure the case where the response
   * does not come without waiting fifteen seconds for it.
   */
  async sfuRetomar(transport: string, consumer: string, timeoutMs?: number): Promise<void> {
    await this.#pedirSfu({ t: "sfu.resume", transport, consumer }, "sfu.resumed", timeoutMs)
  }

  /**
   * "I am not watching that anymore: stop sending it to me."
   *
   * The counterpart to `sfuRetomar`, and the piece that makes "Stop watching" a
   * shared screen save the server's bandwidth instead of just saving decryption
   * on this side. The consumer stays running, paused, and the next "Watch" is an
   * `sfuRetomar` on the same object. See `sfu.pause` in the protocol.
   *
   * `timeoutMs` is a parameter for the same reason as in `sfuRetomar`: so tests
   * can measure a response that does not come.
   */
  async sfuPausar(transport: string, consumer: string, timeoutMs?: number): Promise<void> {
    await this.#pedirSfu({ t: "sfu.pause", transport, consumer }, "sfu.paused", timeoutMs)
  }

  /**
   * "The picture I receive through this consumer is broken: request a keyframe." (Phase M2)
   *
   * No response and no wait: the server ignores an extra request in silence.
   * Only to a server announcing `CAPACIDADE_SFU_FOTOGRAMA_CHAVE`; to an older
   * one nothing is sent (it would refuse the frame with a `bad-frame`). A broken
   * connection also does not: the request is lost, and the watchdog asks again.
   */
  sfuPedirFotogramaChave(transport: string, consumer: string): void {
    if (!this.#serverCapabilities.includes(CAPACIDADE_SFU_FOTOGRAMA_CHAVE)) return
    try {
      this.#send({ t: "sfu.keyframe", transport, consumer })
    } catch {
      // No connection: nothing to do, nothing to say.
    }
  }

  /**
   * An `sfu.*` frame that arrived from the server.
   *
   * @returns whether this frame was for us, and if so no one else touches it.
   *
   * Runs BEFORE the type-based queue in `#onFrame`, and the order is not
   * neutral: a late response to a request already given up would find another's
   * queue and be consumed by it in silence, delivering to a request the response
   * of another, which is exactly the fault the tag exists to prevent.
   */
  #onSfu(frame: ServerFrame): boolean {
    if (!frame.t.startsWith("sfu.")) return false

    if (frame.t === "sfu.producer.new" || frame.t === "sfu.producer.closed") {
      this.emit(
        "sfu",
        frame.t === "sfu.producer.new"
          ? {
              t: "producer.new",
              channel: frame.channel,
              scope: frame.scope,
              producer: frame.producer,
              kind: frame.kind,
              address: frame.address as UserAddress,
              // Absent when the server is before video. Whoever reads treats the absence as
              // the `kind` dictates; inventing a value here would strip that reading of the
              // information that there was none.
              ...(frame.fonte ? { fonte: frame.fonte } : {}),
            }
          : { t: "producer.closed", channel: frame.channel, scope: frame.scope, producer: frame.producer },
      )
      return true
    }

    const ref = "ref" in frame ? frame.ref : undefined
    const pedido = ref === undefined ? undefined : this.#sfuPendentes.get(ref)

    if (frame.t === "sfu.error") {
      if (pedido) {
        /*
          The server's message arrives intact to whoever asked. Translating it to
          "internal error" along the way makes the person retry forever, because
          nothing on screen says the problem is not theirs.

          And it carries the CODE with it, inside the type. It was a `new Error(message)`,
          and the code would die here: on the side of whoever asked, a server refusal
          looked the same as a timeout. That difference is what decides whether a request
          repeats, see `RecusaDoSfu`, and the `#consumir` of the engine, which is where
          that distinction started to pay off.
        */
        pedido.rejeitar(new RecusaDoSfu(frame.code, frame.message))
        return true
      }
      // No tag, or from a request already given up. No one is waiting for it, and
      // throwing it away in silence was losing the only clue that the server refused
      // something, the case of `sem-sfu` against a server that announced the
      // capability and then lost the worker.
      this.emit("status", {
        detail: `${frame.code}: ${frame.message}`,
        level: "error",
        code: "server-error",
        route: "log",
      })
      return true
    }

    // A response whose tag does not match any request, or matches a request waiting
    // for something else, is not delivered: delivering it would be matching by shape,
    // which is what the tag came to replace.
    if (pedido && pedido.esperado === frame.t) pedido.resolver(frame)
    return true
  }

  /** Fail media requests that were left waiting. See `#failPending`. */
  #falharSfuPendentes(reason: string): void {
    const pedidos = [...this.#sfuPendentes.values()]
    this.#sfuPendentes.clear()
    for (const pedido of pedidos) pedido.rejeitar(new Error(reason))
  }

  /**
   * Ask the homeserver to read a page and say what it declares.
   *
   * Only the device of whoever publishes reaches here, and only after they tried
   * themselves, what comes out of here travels inside the encrypted message,
   * and whoever reads it still does not talk to the site or the server. The cost
   * is that the server sees which links are published, and that is why this path
   * is second, not first.
   *
   * A homeserver that does not know the request sends nothing, and the timeout
   * is the answer: return empty and whoever publishes writes it by hand, as
   * before this existed.
   */
  async previewLink(url: string): Promise<{
    title?: string
    description?: string
    siteName?: string
    image?: string
  }> {
    this.#send({ t: "link.preview", url })
    const frame = await this.#await("link.preview.result", 20_000)
    if (frame.t !== "link.preview.result" || !frame.ok) throw new Error("could not read the page")
    return {
      ...(frame.title === undefined ? {} : { title: frame.title }),
      ...(frame.description === undefined ? {} : { description: frame.description }),
      ...(frame.siteName === undefined ? {} : { siteName: frame.siteName }),
      ...(frame.image === undefined ? {} : { image: frame.image }),
    }
  }

  /**
   * Redeem a link.
   *
   * We publish a fresh key package with the request rather than relying on the
   * pool, so the joiner is never blocked by an empty one — and so the package
   * used is definitely one whose private half we hold.
   */
  async redeemInvite(link: string): Promise<void> {
    // The short link resolves to the long form first, then follows the same path. See `resolverConvite`.
    const parsed = parseInviteLink(parseShortInviteLink(link) ? await this.resolverConvite(link) : link)
    if (!parsed) throw new Error("that is not a valid invite link")
    // `invite.redeem` is local to a homeserver: the code's hash only exists in
    // the table of the server that minted it. Sending it to ours would tell
    // our server about a secret that is none of its business, and get nowhere.
    // The UI says this more kindly before it ever calls here; this is the floor.
    if (!sameHomeserver(parsed.server, homeserverOf(this.identity))) {
      throw new Error("that invite is from another server")
    }

    const [generated] = await generateKeyPackages(this.identity, 1)
    if (!generated) throw new Error("could not prepare the entry")
    this.#keyPackages.set(toBase64(generated.wire), exportKeyPackage(generated))
    this.#keyPackagesDirty = true
    await this.flush()

    const codeHash = toBase64(sha256(new TextEncoder().encode(parsed.code)))
    const keyPackage = toBase64(generated.wire)
    this.#send({
      t: "invite.redeem",
      codeHash,
      keyPackage,
      // Proof that we have the link, not just the hash that is in the server's
      // database. See `prova-do-convite.ts` (1.0 slice 2).
      prova: provarCodigoDoConvite(parsed.code, { codeHash, address: this.identity.address, keyPackage }),
    })

    this.emit("status", {
      detail: "Pedido enviado. Falta alguém do canal estar online para te deixar entrar.",
      level: "info",
      code: "invite-sent",
      // The prompt already said this the instant the link was submitted; a
      // second toast for the same act is noise.
      route: "log",
    })
  }

  /**
   * Somebody redeemed a code for a channel we are in: add them.
   *
   * This is the part no server can do. It runs on a member's device because
   * only a member holds the keys to produce the commit — which also means an
   * invite link only works while at least one member is connected.
   */
  async #admit(channel: string, address: string, keyPackage: Uint8Array, codeHash: string): Promise<void> {
    const group = this.#groups.get(channel)
    if (!group) return

    /**
     * Only honour a request against a code this device actually issued.
     *
     * Without this check the flow was a complete break of the product's central
     * promise: the server accepts `invite.create` from any authenticated
     * account for any channel id, so a stranger could mint an invite for a room
     * they had never been in, redeem it, and be committed into the group by the
     * first member online. Channel ids make that trivially targetable — a feed
     * channel is derived from the owner's public address.
     *
     * The server cannot fix this; it holds no group keys and cannot tell a
     * member from anyone else. The check has to live here, against local
     * evidence of our own act.
     */
    const minted = this.vault.contents.mintedInvites[codeHash]
    if (!minted || minted.channel !== channel) {
      this.emit("status", {
        detail: "Pedido de entrada ignorado: o convite não foi emitido por ti.",
        level: "error",
        code: "invite-not-mine",
        // Somebody else's mistake, or somebody else's attempt. Nothing to do
        // about it — but it belongs in the log, precisely because it might be
        // an attempt.
        route: "log",
        channel,
      })
      return
    }

    try {
      // One commit at a time, PER CHANNEL, same sequence as `#invite`, same reason.
      // Here the key package arrives inside the frame itself, so there is no server
      // trip to keep out of the queue: the method is the block. The package chain,
      // before spending it on a commit: the link is the only gate through which a
      // package arrives without passing claim, and the check is the same
      // (`#pacotesAdmissiveis`). A package that does not close, or from another
      // account, does not enter.
      const pacote = decodeKeyPackage(keyPackage)
      const cadeia = credentialOfKeyPackage(pacote)
      if (cadeia === undefined || cadeia.address !== address) {
        this.emit("status", {
          detail: `Pedido de entrada ignorado: a chave de convite de ${address} não verifica.`,
          level: "error",
          code: "keypackage-invalid",
          route: "log",
          channel,
        })
        return
      }
      const aparelho = toBase64(cadeia.deviceKey)
      /*
        The link gate checks the manifest, as claim already did. Without this, a
        revoked device that still has the account key would generate a package
        with valid chain and enter by link, over the manifest that removed it
        (docs/PENDENTES.md, slice 3). Without manifest (old server, account that
        never published), the chain arrives as in claim.
      */
      const foraDe = (lido: DeviceManifest | null): boolean =>
        lido !== null && !lido.devices.some((device) => toBase64(device.deviceKey) === aparelho)
      let manifesto = await this.#manifestoPara(address)
      // The short cache runs for five minutes: a phone paired recently is not yet in
      // the remembered manifest, and was silently rejected (M3). Before refusing, read
      // again.
      if (foraDe(manifesto)) manifesto = await this.#manifestoFresco(address)
      if (estaRevogado(this.vault.contents, address, aparelho) || foraDe(manifesto)) {
        this.emit("status", {
          detail: `Pedido de entrada ignorado: o aparelho de ${address} não está na conta.`,
          level: "error",
          code: "device-not-in-account",
          route: "log",
          channel,
        })
        return
      }
      let estadoNoRetrato = false
      const commitou = await this.#commitar(channel, async (atual, tentativa) => {
        // On a retry, another member might have already admitted it: done. It is the
        // DEVICE of the package that is searched, not the address: another device of
        // the same account in the tree is not this one.
        const arvore = atual.state.ratchetTree
        const esteAparelho = leavesOf(arvore, address as UserAddress).some((folha) => {
          const chave = deviceKeyAtLeaf(arvore, folha)
          return chave !== undefined && toBase64(chave) === aparelho
        })
        if (tentativa > 1 && esteAparelho) return null
        const juntado = await this.#juntarComRetrato(channel, atual, [pacote])
        estadoNoRetrato = juntado.estadoNoRetrato
        const result = juntado.result
        return { commit: result.commit, session: result.session, welcome: { bytes: result.welcome, recipient: address } }
      })
      if (!commitou) return
      this.#announceLocalEpoch(channel, estadoNoRetrato ? "entregue" : undefined)
      this.emit("status", {
        detail: `${address} entrou por convite`,
        level: "info",
        code: "member-joined",
        // Worth knowing, never worth interrupting for: it goes to the bell.
        route: "notice",
        channel,
        actor: address,
      })
    } catch {
      // Most likely another member got there first, in which case the joiner is
      // already in and there is nothing to report.
    }
  }

  // ----------------------------------------------------------------- social

  /**
   * The channel carrying this account's posts.
   *
   * Derived from the account id rather than assigned by a server, so anyone who
   * knows an address knows where to ask — and no server decides who owns a feed.
   */
  /**
   * Choose whether channel-mates are told this connection exists.
   *
   * Applied immediately when connected and remembered for every future
   * handshake. It hides you from PEOPLE, never from the server: the gateway
   * has to know you are here to hand you your messages, and the interface
   * says exactly that where the choice is made.
   */
  setVisible(visible: boolean): void {
    this.#visible = visible
    if (this.#socket?.readyState === 1) {
      try {
        this.#send({ t: "presence.set", visible })
      } catch {
        // Offline: the next handshake carries the choice.
      }
    }
    /**
     * And becoming visible again is the return to foreground that the interface
     * knows how to say today: reconcile (F9). Not before a minute since the last
     * pass, so a switch pressed three times does not make three passes.
     */
    if (visible && this.#connection === "online" && Date.now() - this.#ultimaSincronia >= 60_000) {
      void this.#sincronizar().catch(() => {})
    }
  }

  get visible(): boolean {
    return this.#visible
  }

  /** What the connected server said it can do, verbatim from hello.ok. */
  get serverCapabilities(): string[] {
    return [...this.#serverCapabilities]
  }

  /**
   * Does this server relay media through an SFU?
   *
   * The gate to all SFU passage, and the only one: whoever builds the call
   * engine asks this and builds the usual mesh if the answer is no. Absent means
   * NO, without exception, an old server says nothing on the subject, and "said
   * nothing" must read as "does not have", never as "maybe has". The alternative
   * was a new client trying to negotiate a gate that does not exist and staying
   * "connecting" forever against the server that worked until yesterday.
   *
   * A getter, not a stored field: `#serverCapabilities` is rewritten at each
   * `hello.ok`, so a server reverting to a version without SFU closes this gate
   * on the next reconnection without anyone having to remember.
   *
   * Does not decide anything on its own, on purpose. The choice of engine is up
   * to whoever builds the bridge (`apps/web/src/bridge.ts` and its mirror in
   * Electron), because that is where you know which object to build; here you
   * only answer the question.
   */
  get suportaSfu(): boolean {
    return this.#serverCapabilities.includes(CAPACIDADE_SFU)
  }

  /**
   * Does this server accept more than one device per account and keep
   * manifests?
   *
   * The same gate as `suportaSfu`, for the same reason: absent means NO, and
   * against a server that does not announce this, the client does not send
   * `manifest.publish` or `manifest.get`, because an unknown `t` is a refused
   * frame.
   */
  get suportaAparelhos(): boolean {
    return this.#serverCapabilities.includes(CAPACIDADE_APARELHOS)
  }

  /**
   * Does this server serve key packages in a bundle, per device of the
   * manifest?
   *
   * Own gate, not `suportaAparelhos`, because server 0.2.3 announces `devices`
   * without bundling: see `CAPACIDADE_BUNDLE`. Against those that do not
   * announce it, the invite requests a package as it always has and checks its
   * chain the same way.
   */
  get suportaBundle(): boolean {
    return this.#serverCapabilities.includes(CAPACIDADE_BUNDLE)
  }

  /**
   * Does this server have pairing boxes?
   *
   * Same gate as the others: missing means NO, and against a server that does
   * not advertise it this client sends no `pair.*` messages and does not show
   * the add-device button. See `CAPACIDADE_EMPARELHAMENTO`.
   */
  get suportaEmparelhamento(): boolean {
    return this.#serverCapabilities.includes(CAPACIDADE_EMPARELHAMENTO)
  }

  /**
   * Does this device have the account key?
   *
   * This decides whether it can add (and someday remove) devices. A paired
   * device answers no, and the interface tells it where to do that.
   */
  get temChaveDeConta(): boolean {
    return this.#identity !== null && temChaveDeConta(this.#identity)
  }

  /**
   * How many days the connected server keeps events, if it said so.
   *
   * Informational for now. What will use it is epoch key sharing between
   * devices (docs/PLANO_MULTIDISPOSITIVO.md, §3.4): storing keys for
   * ciphertext the server already deleted buys nothing.
   */
  get serverRetentionDays(): number | undefined {
    return this.#serverRetentionDays
  }

  /**
   * Publish the device manifest for this account, if it does not have one yet.
   *
   * Asks first and publishes second, and the order matters: two devices of the
   * same account connecting at the same time (the day there are two) both see
   * "there is none", both publish v1, and the server stores the first and
   * rejects the second with `stale-version`, which is the right outcome, so
   * the rejection does not count against anyone. v1 is always that one device
   * alone; pairing adds the second one, with v2.
   *
   * A device that already has a manifest and is in it does not republish: it
   * stores the version it saw, so the vault anti-rewind anchor is filled for
   * the account itself too.
   *
   * **A device that already has a manifest and is NOT in it adds itself to it.**
   * Since the claim in the bundle exists, the manifest decides who is admitted:
   * a device the account does not list does not enter any channel through an
   * invite from a new client. Today such a device is born in one way only, from
   * importing a vault exported before device keys existed (`loadIdentity` forges
   * a new one), and without this that account would become unshared in silence.
   * This device has the account key, so the authority to say it is here; what
   * gets published is the manifest that was there plus this device, not this
   * device alone, so two vaults of the same account do not erase each other on
   * each connection. Above `APARELHOS_POR_CONTA` the oldest by `addedAt` goes
   * out, the same rule as the server table.
   *
   * What this is NOT: pairing. When revocation exists (block G), a device
   * removed from the manifest by another cannot be put back this way; it is
   * noted in docs/PENDENTES.md, so whoever does block G can close it at the
   * same time.
   */
  async #garantirManifesto(): Promise<void> {
    if (!this.suportaAparelhos) return
    const identity = this.identity
    /**
     * The gate: without the account key no manifest gets published, and it is
     * not an error. A paired device is in the manifest because whoever paired it
     * put it there (v2 published by the computer BEFORE the certificate); it has
     * nothing to sign another with, and it must not: that is what makes
     * revocation work (docs/PLANO_MULTIDISPOSITIVO.md §10).
     */
    if (!temChaveDeConta(identity)) return
    /**
     * "Did not read" and "does not exist" are different things, and here the
     * difference is the whole account. This publishes the next version signed by
     * the account key, and the server accepts it for being larger: if a
     * `manifest.get` that expired (the bucket ran out, the server went silent)
     * counted as "no manifest", what got published was THIS device alone on top
     * of a manifest with others, and the others were shut out of all future
     * invites. Without a read, nothing gets published; the next connection tries
     * again.
     */
    const proprio = toBase64(identity.deviceSigningPublicKey)
    /*
      A device this vault knows is revoked does not go back in. The server
      with `CAPACIDADE_REVOGACAO` already rejects it (at login and at manifest);
      this is the same rule on this side, for a server that does not have it.
    */
    if (estaRevogado(this.vault.contents, identity.address, proprio)) return
    const leitura = await this.#lerManifesto(identity.address, 10_000)
    if (!leitura.lido) return
    const existente = leitura.manifesto
    if (existente !== null && existente.devices.some((device) => toBase64(device.deviceKey) === proprio)) return
    /*
      Account full: do not add. Adding would force cutting by the cap to remove
      another device, and the cut device would add itself again on the next
      connection: that was the cap ping-pong (docs/PENDENTES.md). The server
      no longer revokes it (it only revokes what comes in the `revoke` list, see
      `aparelhosRevogados`), but the cycle kept going. To make room you revoke
      one, on purpose (`revokeDevice`).
    */
    if (existente !== null && existente.devices.length >= APARELHOS_POR_CONTA) {
      this.emit("status", {
        detail: "este aparelho não está no manifesto da conta, e a conta já tem o máximo de aparelhos",
        level: "error",
        code: "manifest-full",
        route: "log",
      })
      return
    }
    await this.#publicarManifestoCom(existente, [identity.deviceSigningPublicKey])
  }

  // ------------------------------------------------------------- revocation

  /**
   * Remove a device from this account: manifest without it, leaf out of every
   * channel, and `device.revoke` in each channel. See `revogacao.ts`.
   *
   * Only on a device with the account key, and never the device itself. Revoking
   * cuts read access from the next epoch onward; what the device already had,
   * it keeps.
   *
   * Throws with stable English key (see `revogarAparelho`). After the manifest
   * goes out, a channel that fails does not stop the others; at the end it
   * throws `device-revoke-incomplete` with the channels in `cause`, and calling
   * again resumes without publishing another manifest.
   */
  async revokeDevice(deviceKey: string): Promise<void> {
    const relatorio = await revogarAparelho(this.#portaDeRevogacao(), deviceKey)
    // The short memory of the guards must see the manifest without the device now.
    this.#manifestosRecentes.delete(this.identity.address)
    if (relatorio.falhas.length > 0) {
      throw new Error("device-revoke-incomplete", { cause: { channels: canaisComFalha(relatorio) } })
    }
  }

  #portaDeRevogacao(): SessaoParaRevogar {
    const identity = this.identity
    return {
      address: identity.address,
      chaveDeConta: temChaveDeConta(identity) ? identity.signingPrivateKey : undefined,
      chaveDesteAparelho: identity.deviceSigningPublicKey,
      servidorRevoga: this.#serverCapabilities.includes(CAPACIDADE_REVOGACAO),
      lerManifestoProprio: () => this.#lerManifesto(identity.address, 10_000),
      versaoVista: () => deviceManifestSeen(this.vault.contents, identity.address),
      publicarManifesto: async (wire, revogar) => {
        this.#send({ t: "manifest.publish", manifest: wire, revoke: [...revogar] })
        const veredicto = await this.#await("manifest.published").catch(() => null)
        if (veredicto === null || veredicto.t !== "manifest.published") return { ok: false, reason: SEM_RESPOSTA }
        if (!veredicto.ok) return { ok: false, reason: veredicto.reason ?? "refused" }
        await this.#lembrarManifesto(identity.address, veredicto.version)
        return { ok: true }
      },
      // All groups, the account channel included (I1): `channels` removes it,
      // because it is the list for the interface, and the revoked leaf kept
      // reading the state.
      canais: () => [...this.#groups.keys()],
      tirarFolha: (canal, aparelho) => this.#tirarFolhaDoAparelho(canal, aparelho),
      enviar: async (canal, payload) => {
        await this.send(canal, payload)
      },
      lembrarRevogado: (aparelho) =>
        this.vault.update((contents) => {
          notarRevogado(contents, identity.address, aparelho)
        }),
      esquecerRevogado: (aparelho) =>
        this.vault.update((contents) => {
          esquecerRevogado(contents, identity.address, aparelho)
        }),
      jaRevogado: (aparelho) => estaRevogado(this.vault.contents, identity.address, aparelho),
      canaisAvisados: (aparelho) => canaisAvisados(this.vault.contents, aparelho),
      lembrarAvisado: (aparelho, canal) =>
        this.vault.update((contents) => {
          notarAvisado(contents, aparelho, canal)
        }),
    }
  }

  /**
   * Remove ONE leaf from the account itself in a channel: the one for the
   * revoked device.
   *
   * The twin of `#unseat`, which removes all leaves from an address; here only
   * the one the credential says is this device, and the others from the account
   * stay. In the group queue by `#commitar`, and one commit only (`umSoCommit`):
   * the single removal brings UpdatePath because of the patch to `ts-mls`, and
   * that is what makes the next epoch not derive from the one the revoked
   * device has.
   */
  async #tirarFolhaDoAparelho(channel: string, aparelho: Uint8Array): Promise<boolean> {
    if (!this.#groups.has(channel)) return false
    const chave = toBase64(aparelho)
    const removeu = await this.#commitar(channel, async (group) => {
      const arvore = group.state.ratchetTree
      const folhas = leavesOf(arvore, this.identity.address).filter((folha) => {
        const k = deviceKeyAtLeaf(arvore, folha)
        return k !== undefined && toBase64(k) === chave
      })
      if (folhas.length === 0) return null
      const removal = await removeMembers(group, folhas)
      return { commit: umSoCommit(removal.commits), session: removal.session }
    })
    if (removeu) this.#announceLocalEpoch(channel)
    return removeu
  }

  /**
   * Publish the next manifest: what was there plus these keys.
   *
   * The only function that signs manifests, and serves both paths: the device
   * itself adding itself (`#garantirManifesto`) and pairing adding the phone
   * (`emparelharComoAnfitriao`). Signature, monotone version, cap of four and
   * anti-rewind anchor all come from here, once. The cap is
   * `aparelhosDoManifestoSeguinte`, which cuts by the oldest of the OTHERS and
   * never by this device: a manifest without the key of who signs it is the
   * account hiding from itself.
   *
   * The version is the last one this device saw from its own account, plus one.
   * It was fixed at `1`, and that locked the account: as soon as there was a v2
   * (or the server lost track and this vault remembered more), each connection
   * published a v1 the server rejects forever with `stale-version`. With an
   * existing manifest, its version is what counts: `#lerManifesto` just stored
   * it as seen.
   *
   * @returns the version published, or `null` if the server did not accept it
   * or this device does not have the account key.
   */
  async #publicarManifestoCom(existente: DeviceManifest | null, novas: Uint8Array[]): Promise<number | null> {
    const identity = this.identity
    if (!temChaveDeConta(identity)) return null
    const agora = Math.floor(Date.now() / 1000)
    const version = (deviceManifestSeen(this.vault.contents, identity.address) ?? 0) + 1
    const devices = aparelhosDoManifestoSeguinte(existente?.devices ?? [], novas, identity.deviceSigningPublicKey, agora)
    this.#send({
      t: "manifest.publish",
      manifest: signDeviceManifest(identity.signingPrivateKey, {
        address: identity.address,
        version,
        devices,
        signedAt: agora,
      }),
    })
    const veredicto = await this.#await("manifest.published").catch(() => null)
    if (veredicto === null || veredicto.t !== "manifest.published" || !veredicto.ok) return null
    await this.#lembrarManifesto(identity.address, veredicto.version)
    return veredicto.version
  }

  // --------------------------------------------------------- emparelhamento

  /**
   * The devices in this account, from the manifest, for the Settings list.
   *
   * `null` when there is no manifest to say so: server without `devices`,
   * account that never published one, or a read that did not arrive. The
   * interface then shows only this device, which is what we know. No names:
   * the manifest does not have them, and making them up here would be writing
   * on the screen what no one said.
   */
  async aparelhosDaConta(): Promise<{ deviceKey: string; addedAt: number; esteAparelho: boolean }[] | null> {
    const identity = this.identity
    const manifesto = await this.deviceManifestOf(identity.address)
    if (manifesto === null) return null
    const proprio = toBase64(identity.deviceSigningPublicKey)
    return manifesto.devices.map((device) => {
      const deviceKey = toBase64(device.deviceKey)
      return { deviceKey, addedAt: device.addedAt, esteAparelho: deviceKey === proprio }
    })
  }

  /** The pairing in progress on this device, from one of the two sides, or none. */
  #anfitriao: AnfitriaoDeEmparelhamento | null = null
  #convidado: ConvidadoDeEmparelhamento | null = null

  /**
   * Add a device to this account: open the box and show the QR.
   *
   * This is the side that HAS the account. Resolves with the link (for the QR
   * and to copy) when the server confirms the box; from then on everything
   * comes through the `pair` event: `ligado`, `sas` with the words, `concluido`
   * or `falhou`. The person responds to the words with `confirmarSas()` or
   * `recusarSas()`.
   *
   * One at a time: starting another cancels the previous one.
   */
  async emparelharComoAnfitriao(): Promise<{ pairId: string; link: string }> {
    const identity = this.identity
    if (!temChaveDeConta(identity)) throw new Error("this device has no account key")
    if (!this.suportaEmparelhamento) throw new Error("this server cannot pair devices")
    if (this.#connection !== "online") throw new Error("no connection to the server")
    this.#anfitriao?.cancelar()

    const anfitriao = new AnfitriaoDeEmparelhamento(
      identity,
      homeserverOf(identity),
      formatPairLink,
      (frame) => this.#send(frame),
      (evento) => this.emit("pair", evento),
      {
        confirmarEspaco: async () => {
          const leitura = await this.#lerManifesto(identity.address, 10_000)
          if (!leitura.lido) throw new Error("manifesto")
          /*
            The cap refuses, it does not expel.

            With the account full, adding the fifth device meant removing one
            from the manifest, and what came out was the oldest, the computer
            itself, added the day the account was born. Worse: if a paired phone
            came out, it has no account key to put itself back and there is no
            revocation to bring it back. Refuse it here, before there is a
            certificate, which is the only time refusing costs nothing.
          */
          if ((leitura.manifesto?.devices.length ?? 0) >= APARELHOS_POR_CONTA) throw new Error("manifesto-cheio")
        },
        publicarManifestoCom: async (deviceKey) => {
          // "Did not read" is not "does not exist", here as in `#garantirManifesto`:
          // without a read nothing gets published, because publishing over what was
          // not seen would erase the account's other devices.
          const leitura = await this.#lerManifesto(identity.address, 10_000)
          if (!leitura.lido) throw new Error("manifesto por ler")
          const version = await this.#publicarManifestoCom(leitura.manifesto, [identity.deviceSigningPublicKey, deviceKey])
          if (version === null) throw new Error("manifesto recusado")
          // The short memory of the guards must see the new manifest now, or else
          // `#faltam` does not find the missing phone for five minutes.
          this.#manifestosRecentes.delete(identity.address)
        },
        assentar: async (deviceKey) => {
          await this.#assentarAparelho(deviceKey)
          // And the account channel, if the phone said in `pronto` it knows to be there.
          await this.#cuidarDoCanalDaConta().catch(() => {})
        },
        // The snapshot of the account state, behind the certificate (phase 5).
        estado: () => this.#estadoParaEmparelhar(),
        capacidades: (deviceKey, capacidades) => {
          if (capacidades.includes(CAPACIDADE_ESTADO_DA_CONTA)) {
            this.#notarAparelhoComEstado(deviceKey, capacidades.includes(CAPACIDADE_CHAVE_DE_CONTA))
          }
        },
      },
    )
    this.#anfitriao = anfitriao
    return new Promise((resolve, reject) => {
      const desligar = this.on("pair", (evento) => {
        if (evento.fase === "aguarda") {
          desligar()
          resolve({ pairId: evento.pairId, link: evento.link })
        } else if (evento.fase === "falhou") {
          desligar()
          reject(new Error(evento.razao))
        }
      })
      anfitriao.abrir()
    })
  }

  /**
   * Join THIS device to an account that lives on another: the phone side.
   *
   * The vault must be open and with no account. There is no `Session` connected
   * (no identity yet): the guest runs on its own socket to the link server.
   * When the certificate arrives and closes, the vault is written in DEVICE form
   * (`accountPublicKey`, `deviceCert`, device key; **never `signingPrivateKey`**)
   * and the `certificado` event comes out. The interface then loads the identity,
   * connects, and calls `concluirEmparelhamento()`.
   */
  emparelharComoConvidado(link: string): void {
    const lido = parsePairLink(link)
    if (!lido) {
      this.emit("pair", { fase: "falhou", razao: "link-invalido" })
      return
    }
    const cofre = this.vault.contents
    if (cofre.signingPrivateKey || cofre.accountPublicKey) {
      throw new Error("this vault already holds an account")
    }
    this.#convidado?.cancelar()
    const convidado = new ConvidadoDeEmparelhamento(lido, gatewayUrlDe, sameHomeserver, (evento) => {
      if (evento.fase === "certificado") {
        // The vault writes BEFORE the interface hears the event, so whoever hears it
        // can load the identity right after.
        void convidado.resultado
          .then((resultado) =>
            this.vault.update((contents) => {
              contents.accountPublicKey = toBase64(resultado.accountKey)
              contents.deviceCert = toBase64(resultado.deviceCert)
              contents.deviceSigningPrivateKey = toBase64(resultado.deviceSigningPrivateKey)
              contents.homeserver = resultado.homeserver
              contents.identityCreatedAtMinute = Math.floor(Date.now() / 60_000)
              // The account state, if it came (phase 5): in the same `update`, so the
              // first `connect()` already finds it in the vault.
              if (resultado.estado) aplicarEstadoDeConta(contents, resultado.address, resultado.estado)
            }),
          )
          .then(() => this.emit("pair", evento))
          .catch(() => this.emit("pair", { fase: "falhou", razao: "sem-ligacao" }))
        return
      }
      this.emit("pair", evento)
    })
    this.#convidado = convidado
    convidado.ligar(this.#versaoDaApp)
  }

  /** The person confirmed the six words on this screen, whichever side. */
  async confirmarSas(): Promise<void> {
    if (this.#anfitriao && !this.#anfitriao.acabou) await this.#anfitriao.confirmarSas()
    else this.#convidado?.confirmarSas()
  }

  /** The person said the words are not the same. */
  recusarSas(): void {
    this.#anfitriao?.recusarSas()
    this.#convidado?.recusarSas()
  }

  cancelarEmparelhamento(): void {
    this.#anfitriao?.cancelar()
    this.#convidado?.cancelar()
    this.#anfitriao = null
    this.#convidado = null
  }

  /**
   * The phone is connected with published keys: tell the computer it can seat
   * this device, and close the box.
   */
  concluirEmparelhamento(): void {
    this.#convidado?.pronto()
    this.#convidado = null
  }

  // ------------------------------------------------- juntar contas (fase 8.2)

  /**
   * The main account certificate, waiting for steps 2 and 3 of "Join another
   * account". Memory only: until step 3 the vault is still the secondary one,
   * entire.
   */
  #juntar: { cofre: CofreDeAparelho; secundaria: string } | null = null

  /**
   * "Join another account", step 1: pair THIS device with the main account,
   * without dropping the secondary (phase 8.2, `docs/planos/definicoes-0-9.md`).
   *
   * The usual pairing, from the guest side, with one difference: the
   * certificate is NOT written to the vault. It stays in memory (`#juntar`), and
   * the session keeps being the secondary one, connected, to notify contacts and
   * channels with its key (step 2). Only in step 3 does the vault switch
   * accounts.
   *
   * So pairing that fails (link expired, network, "they are not") did not notify
   * anyone and did not erase anything: the vault was not touched. And the main
   * computer only publishes the device in the manifest after `pronto`, which
   * only comes at the end of step 3.
   *
   * An account does not join itself: a certificate with this account's address
   * closes the box (`mesma-conta`).
   */
  emparelharParaJuntar(link: string): void {
    const lido = parsePairLink(link)
    if (!lido) {
      this.emit("pair", { fase: "falhou", razao: "link-invalido" })
      return
    }
    const secundaria = this.identity.address
    this.#convidado?.cancelar()
    this.#juntar = null
    /** The box closes by `mesma-conta`: its `cancelado` is not the reason the person needs to read. */
    let calado = false
    const convidado = new ConvidadoDeEmparelhamento(lido, gatewayUrlDe, sameHomeserver, (evento) => {
      if (calado) return
      if (evento.fase !== "certificado") {
        /*
          The box fell after the certificate (the main computer gave up, or ran
          out of time waiting for `pronto`): there is no one left to publish this
          device in the manifest. The certificate leaves memory, and step 3
          refuses, instead of putting on disk a device the account does not know.
        */
        if (evento.fase === "falhou") this.#juntar = null
        this.emit("pair", evento)
        return
      }
      void convidado.resultado
        .then((resultado) => {
          if (resultado.address === secundaria) {
            calado = true
            this.#convidado = null
            convidado.cancelar()
            this.emit("pair", { fase: "falhou", razao: "mesma-conta" })
            return
          }
          this.#juntar = { cofre: resultado, secundaria }
          this.emit("pair", evento)
        })
        .catch(() => this.emit("pair", { fase: "falhou", razao: "sem-ligacao" }))
    })
    this.#convidado = convidado
    convidado.ligar(this.#versaoDaApp)
  }

  /** The main account this device paired with to join, or none. */
  get contaParaJuntar(): string | null {
    return this.#juntar?.cofre.address ?? null
  }

  /**
   * "Join another account", step 2: the secondary says goodbye, with its key.
   *
   * By the plan order, and each step before the next:
   *
   * 1. A live direct chat with each friend (open what is missing): the friend
   *    gets the notice through it, even if they never talked.
   * 2. The notice (`sucessora` in a `message`, signed with `autoria`) in each
   *    direct and in each channel, including the common room. Not the feed: who
   *    is there are the friends, and they already get it in the direct.
   * 3. `unfriend` each friendship.
   * 4. Exit all channels (`leaveAllChannels`), directs and feed included, so
   *    the account is not left on anyone's member list.
   *
   * A notice that fails does not stop the rest: what decides is the exit. If
   * any channel is left not exited, it throws, and step 3 does not run: the
   * account stays on this device, as in "Delete account" (`prepareAccountDeletion`).
   * Repeat tries to notify again (whoever receives stores the succession once)
   * and tries only what is left.
   *
   * The time limit: the main computer waits for `pronto` one minute after the
   * certificate. An account with many channels can pass that, and then the
   * pairing falls and starts over from the beginning.
   */
  async juntarAvisar(): Promise<void> {
    const juntar = this.#juntar
    if (!juntar) throw new Error("there is no account to join")
    this.#exigirCaixaAberta()
    const presos = await this.#despedirParaJuntar(juntar.cofre.address)
    if (presos.length > 0) {
      throw new Error("could not leave every channel, nothing was deleted", { cause: { canais: presos.length } })
    }
  }

  async #despedirParaJuntar(principal: string): Promise<string[]> {
    const amigos = friendsOfTies(this.friendTies())
    for (const amigo of amigos) {
      if (this.#directaViva(amigo)) continue
      await this.openDirect(amigo).catch(() => {})
    }
    const corpo = corpoDaSucessao(principal)
    for (const canal of this.channels) {
      if (this.#eMural(canal)) continue
      const at = Date.now()
      await this.send(canal, {
        t: "message",
        id: crypto.randomUUID(),
        sentAt: at,
        body: corpo,
        attachments: [],
        links: [],
        mentions: [],
        sucessora: { para: principal, at },
      }).catch(() => {})
    }
    for (const amigo of amigos) await this.unfriend(amigo).catch(() => {})
    return this.leaveAllChannels()
  }

  /**
   * "Join another account", step 3: the secondary key goes out, and this
   * device becomes the main one.
   *
   * The new vault is born PROVISIONAL (`Vault.criarProvisorio`, core 1j): the
   * certificate is written there, the identity loads and the session connects
   * with it, and only then the provisional goes to disk over the secondary, in
   * one write. That write erases the secondary key. No archive of the old
   * account.
   *
   * Only after that does `pronto` go out to the main computer, which publishes
   * the device in the manifest and seats it in its channels. And the main
   * account stores that it joined the secondary (`conta.juntadas`), so its
   * devices accept on their own invites "for who succeeded @secondary".
   *
   * A failure before the write drops the provisional: the disk keeps the
   * secondary (already without friends or channels), and the vault stays closed.
   */
  async juntarTrocar(passphrase: string | null): Promise<{ address: string }> {
    const juntar = this.#juntar
    if (!juntar) throw new Error("there is no account to join")
    this.#exigirCaixaAberta()
    const { cofre, secundaria } = juntar
    this.disconnect()
    try {
      /*
        Order matters, and it is by the interface: between `reset()` and
        `loadIdentity()` the session has no identity, and the screen that asks
        for something in that window gets "no identity loaded". So the key
        derivation (the slow step) runs BEFORE `reset()`, with the old account
        still in memory, and from there to `loadIdentity()` there is no wait at
        all for network or disk: the provisional vault writes in memory.
      */
      await this.vault.criarProvisorio(passphrase)
      this.reset()
      await this.vault.update((contents) => {
        contents.accountPublicKey = toBase64(cofre.accountKey)
        contents.deviceCert = toBase64(cofre.deviceCert)
        contents.deviceSigningPrivateKey = toBase64(cofre.deviceSigningPrivateKey)
        contents.homeserver = cofre.homeserver
        contents.identityCreatedAtMinute = Math.floor(Date.now() / 60_000)
        if (cofre.estado) aplicarEstadoDeConta(contents, cofre.address, cofre.estado)
      })
      this.loadIdentity()
      await this.connect()
      await this.vault.confirmarProvisorio()
    } catch (erro) {
      this.disconnect()
      this.reset()
      this.vault.descartarProvisorio()
      this.cancelarEmparelhamento()
      this.#juntar = null
      throw new Error("the account could not be switched", { cause: erro })
    }
    this.#juntar = null
    this.concluirEmparelhamento()
    const juntadas = comContaJuntada(this.preferencias(), secundaria)
    if (juntadas !== null) await this.definirPreferencia(PREFERENCIA_CONTAS_JUNTADAS, juntadas).catch(() => {})
    return { address: cofre.address }
  }

  /**
   * The main computer still waiting for `pronto`? If it gave up (or ran out of
   * time), it no longer publishes this device in the manifest: the device would
   * enter the account without being seated in any channel. Refuse before, and
   * the account stays here.
   */
  #exigirCaixaAberta(): void {
    if (this.#convidado?.caixaAberta) return
    this.#juntar = null
    throw new Error("the other device stopped waiting, nothing was deleted")
  }

  /** Drop "Join another account" before step 3. The vault did not change. */
  cancelarJuntar(): void {
    this.#juntar = null
    this.cancelarEmparelhamento()
  }

  // --------------------------------------- successions received (phase 8.2)

  /** The accounts that became others, as this account received them. See `sucessao.ts`. */
  sucessoes(): Record<string, RegistoDeSucessao> {
    return sucessoesDoCofre(this.vault.contents, this.#pendingSucessoes)
  }

  #avisarSucessoes(): void {
    if (!this.vault.unlocked) return
    this.emit("sucessoes", { sucessoes: this.sucessoes() })
  }

  /**
   * Dismiss an offer without taking action: `friend`, a channel, or `*` for
   * all. The offer no longer shows on this device.
   */
  async marcarSucessao(de: string, feito: string): Promise<void> {
    let mudou = false
    await this.vault.update((contents) => {
      mudou = marcarSucessaoFeita(contents, de, feito)
    })
    if (mudou) this.#avisarSucessoes()
  }

  /** The record of an offer, or the error the screen displays. */
  #sucessaoDe(de: string): RegistoDeSucessao {
    const registo = this.sucessoes()[de]
    if (!registo) throw new Error("this account did not become another", { cause: { address: de } })
    return registo
  }

  /**
   * "Add?": the friend request to the main device, with a tap (phase 8.2).
   *
   * It's a request like any other: the main device accepts or not. It never
   * joins on its own, because a "became" is only the old key's word.
   */
  async adicionarSucessora(de: string): Promise<void> {
    const { para } = this.#sucessaoDe(de)
    if (para !== this.identity.address) {
      const dm = await this.openDirect(para)
      await this.sendFriendRequest(dm)
    }
    await this.marcarSucessao(de, "amigo")
  }

  /**
   * "Invite?": the admin invites the main device to a channel where the
   * secondary device was (phase 8.2). The invite says who it succeeds, and a
   * main device that joined the secondary accepts it on its own.
   *
   * The main device being there already is not an error: the offer closes anyway.
   */
  async convidarSucessora(de: string, channel: string): Promise<void> {
    const { para } = this.#sucessaoDe(de)
    try {
      await this.invite(channel, para, undefined, { sucessao: de })
    } catch (erro) {
      if ((erro as Error).message !== "that person is already in this channel") throw erro
    }
    await this.marcarSucessao(de, channel)
  }

  /**
   * Seat a new device of this account in each channel where this one is.
   *
   * `#seatInvite` of the OWN address, not `invite`: `invite` requires the
   * responsibility to invite, and this is not inviting anyone, it's the account
   * taking the seat the manifest already gives it. `#faltam` sees the new device
   * with no leaf and the claim asks only for its packets. The common room stays
   * out: the phone joins on its own through the card (`#entrarComCartao`).
   *
   * Best effort, one channel at a time, and patient: the phone just published
   * its keys and the server may not have them all yet. A channel where the
   * device is already there ("already in this room") is not an error; a channel
   * with no keys for the device (`AparelhoSemChaves`) waits and tries two more
   * times.
   */
  async #assentarAparelho(deviceKey: Uint8Array): Promise<void> {
    const chave = toBase64(deviceKey)
    const comum = this.#commonRoom
    for (const canal of this.channels) {
      if (canal === comum) continue
      for (let tentativa = 0; tentativa < 3; tentativa++) {
        const group = this.#groups.get(canal)
        if (!group) break
        const tree = group.state.ratchetTree
        const jaLa = leavesOf(tree, this.identity.address).some((folha) => {
          const k = deviceKeyAtLeaf(tree, folha)
          return k !== undefined && toBase64(k) === chave
        })
        if (jaLa) break
        try {
          await this.#seatInvite(canal, this.identity.address)
          break
        } catch (erro) {
          if (erro instanceof AparelhoSemChaves && tentativa < 2) {
            await new Promise((resolve) => setTimeout(resolve, 3_000))
            continue
          }
          if ((erro as Error).message !== "that person is already in this channel") this.#falhaDeLugar(canal, "assentar o aparelho novo", erro)
          break
        }
      }
    }
  }

  /**
   * Store in the vault the version of a manifest we just saw, unless it rolls back.
   *
   * Via `vault.update`, which writes to disk. The first version of this wrote
   * to `vault.contents` and called `flush()`, and `flush` returns without
   * writing when no channel is dirty: the rollback guard lived in memory and
   * died with the page, and all tests passed because they asserted on the live
   * object. We only write when the version changes, because `#persist` re-encrypts
   * the entire vault.
   *
   * @returns `false` if `version` rolls back below the seen value; equal is not a rollback.
   */
  async #lembrarManifesto(address: string, version: number): Promise<boolean> {
    const vista = deviceManifestSeen(this.vault.contents, address)
    if (vista !== undefined && version < vista) return false
    if (vista === version) return true
    await this.vault.update((contents) => {
      noteDeviceManifest(contents, address, version)
    })
    return true
  }

  /**
   * The device manifest of an account, verified, or `null`.
   *
   * `null` in four cases the caller handles the same way: the server does not
   * announce the feature, the account never published one, the server did not
   * respond in time (the `manifest.get` bucket timed out, and the gateway stays
   * silent instead of refusing), or what came is no good. "No good" covers the
   * signature (the server cannot forge it, and this is what proves it on each
   * read) and ROLLBACK: a manifest with a version below the highest this device
   * has ever seen from this account is an old manifest that the server may serve
   * to those who have not seen the new one, and we do not use it. The seen
   * version lives in the vault, by address, and only goes up.
   *
   * Does not yet decide admissions: that is the claim in bundle, in the next
   * slice. Today it is what the account calls on itself when it connects, and
   * what a script calls to see what the server serves.
   */
  async deviceManifestOf(address: string): Promise<DeviceManifest | null> {
    const leitura = await this.#lerManifesto(address, 10_000)
    return leitura.lido ? leitura.manifesto : null
  }

  /**
   * Reading a manifest that tells "not read" from "none".
   *
   * `lido: false` when the server does not announce the feature, when it stayed
   * silent on time (the `manifest.get` bucket timed out; it stays silent instead
   * of refusing), or when what came is no good (signature, address, rollback):
   * none of this says what the account has, and whoever decides by it (the
   * manifest itself when connecting, `#garantirManifesto`) cannot decide.
   * `lido: true` with `null` is the server saying the account never published one.
   *
   * The reply matches by ADDRESS (tag of the `#await` and key in the queue at
   * `#onFrame`), like recovery pages by channel and claim by address: two
   * reads in flight with one discarded by the bucket would swap the other's
   * reply, and an admissions guard for one person would decide by the manifest
   * of another.
   */
  async #lerManifesto(
    address: string,
    prazoMs: number,
  ): Promise<{ lido: true; manifesto: DeviceManifest | null } | { lido: false }> {
    if (!this.suportaAparelhos) return { lido: false }
    this.#send({ t: "manifest.get", address })
    const resposta = await this.#await("manifest.result", prazoMs, address).catch(() => null)
    if (resposta === null || resposta.t !== "manifest.result" || resposta.address !== address) return { lido: false }
    if (resposta.manifest === null) return { lido: true, manifesto: null }
    const manifesto = await this.#verificarManifesto(address, resposta.manifest)
    return manifesto === null ? { lido: false } : { lido: true, manifesto }
  }

  /**
   * The half of `deviceManifestOf` that does not go to the server: verify a
   * manifest we already have (from `manifest.result`, or from `keypackage.claimed`
   * in bundle), apply the rollback guard, and record what is no good.
   */
  async #verificarManifesto(address: string, wire: DeviceManifestWire): Promise<DeviceManifest | null> {
    const verificado = verifyDeviceManifest(wire)
    if (!verificado.ok || verificado.manifest.address !== address) {
      this.emit("status", {
        detail: `o servidor serviu um manifesto de aparelhos inválido para ${address}: ${verificado.ok ? "endereço trocado" : verificado.reason}`,
        level: "error",
        code: "manifest-invalid",
        route: "log",
      })
      return null
    }
    if (!(await this.#lembrarManifesto(address, verificado.manifest.version))) {
      this.emit("status", {
        detail: `o servidor serviu um manifesto de aparelhos velho para ${address}: v${verificado.manifest.version}, já vista v${deviceManifestSeen(this.vault.contents, address)}`,
        level: "error",
        code: "manifest-rollback",
        route: "log",
      })
      return null
    }
    return verificado.manifest
  }

  /**
   * This account's feed: `moradaDoMural(segredo, servidor)` (1.0 "Arca", slice
   * 3, decision D1). Only those with the secret know it: the account's devices
   * and anyone sharing a direct chat or channel with it (the secret travels in
   * the profile).
   *
   * Empty on a paired device that has not yet received the secret (a snapshot
   * from a principal before slice 3): no channel has this address, and
   * `ensureFeed` refuses to create.
   */
  get feedChannel(): string {
    const segredo = this.#segredoDoMural()
    return segredo ? moradaDoMural(segredo, parseAddress(this.identity.address).server) : ""
  }

  /**
   * The secret of the profile (32 bytes): the one from the vault; or, with the
   * account key, derived from it and stored; or what a device published on
   * their profile.
   *
   * **Derived from the key, not random.** Two devices with the account key
   * (a vault exported and imported elsewhere) would arrive at two different
   * secrets and two different profiles. Derived (`sha256("orwell/mural/segredo/v1" ‖ chave)`), both reach the
   * same one. The receiver of the secret does not reach the key: it is a hash.
   */
  #segredoDoMural(): Uint8Array | null {
    if (!this.vault.unlocked || this.#identity === null) return null
    const c = this.vault.contents
    if (c.segredoDoMural) return fromBase64(c.segredoDoMural)
    const identity = this.#identity
    let segredo: Uint8Array | null = null
    if (temChaveDeConta(identity)) {
      const etiqueta = new TextEncoder().encode("orwell/mural/segredo/v1")
      const entrada = new Uint8Array(etiqueta.length + identity.signingPrivateKey.length)
      entrada.set(etiqueta)
      entrada.set(identity.signingPrivateKey, etiqueta.length)
      segredo = sha256(entrada)
    } else {
      const doIrmao = c.muraisDosOutros?.[identity.address]
      if (doIrmao) segredo = fromBase64(doIrmao)
    }
    if (segredo === null) return null
    c.segredoDoMural = toBase64(segredo)
    this.#memoriaPorGravar = true
    this.#gravarJa()
    return segredo
  }

  /** The feed secret in base64url, for the profile and for siblings. */
  #segredoDoMuralEmTexto(): string | undefined {
    const segredo = this.#segredoDoMural()
    return segredo ? toBase64(segredo) : undefined
  }

  async ensureFeed(): Promise<string> {
    const channel = this.feedChannel
    if (!channel) throw new Error("this device does not know the account feed yet")
    if (!this.#groups.has(channel)) {
      /*
        A feed the vault already knows does not get created again (Error 349,
        November 2, 2026).
        
        A device just paired brings in the snapshot the feed anchor
        (`lastSeq`), but the group arrives later, in the Welcome the main device
        sent it. The first pass through friends runs as soon as the connection
        opens, and sometimes before that Welcome: `ensureFeed` would then create
        a new group with the same address. It was a true refound, only on this
        side: the server does not accept the epoch 0 commit of an opaque address,
        but it accepts the messages, and they came out encrypted for a group
        no one else has. And the person read "the channel lost state" when
        nothing was lost.
        
        We wait for the group, as in direct messages (`openDirect`), and ask for
        a seat if it does not arrive. Only a feed with no history at all is born
        here.
        */
      if (this.#cofreConheceOCanal(channel)) {
        await this.#esperarPeloGrupo(channel)
        if (!this.#groups.has(channel)) throw new Error("this device does not know the account feed yet")
        return channel
      }
      this.#fichaAoNascer.set(channel, { tipo: "mural", dono: this.identity.address })
      await this.createSpaceChannel(channel)
    }
    return channel
  }

  /** The vault knows this channel: it has its anchor or history. Creating a group here would refound it. */
  #cofreConheceOCanal(channel: string): boolean {
    return (
      this.vault.unlocked &&
      (this.vault.contents.lastSeq[channel] !== undefined || entradasDoCanal(this.vault.contents, channel).length > 0)
    )
  }

  // ----------------------------------------- account state (phase 5, F13)

  /*
    What travels between devices of the same account: reads, preferences, archive,
    blocks, and the shown friends list. Two paths:

    - the pairing snapshot (level M), assembled in `#estadoParaEmparelhar` and
      applied by the invited device before the first `connect()`;
    - the account channel (level L), `moradaDaConta` (until 0.9, `!self-<id>`),
      an MLS group with only leaves of this account, where deltas `estado.*` go.

    The merge rule is in `vault.ts` (`fundir*`): the newest timestamp wins per
    key. So each payload is idempotent, and the same payload serves as delta and
    full replacement (`#enviarEstadoCompleto`).

    **Who enters the account channel, and who stays out.** Whoever creates it is
    the device with the account key, and only invites leaves that announced
    themselves (`aparelhosComEstado`): by the `pronto` of pairing, or by the
    device signal (`#sinalDeAparelho`) that a 0.5.8 device sends on each
    connection while it is not there. **A 0.5.7 leaf of the same account is not
    invited.** It does not know the `estado.*` payloads: it would reject them,
    count them toward deafness, and the seat request that follows is the repair
    that brings the history. And the channel appeared as a conversation with
    nothing inside. The price, stated: the channel Welcome goes to the ADDRESS,
    and the server delivers it to all account connections, 0.5.7 included. It
    does not open it (no packet), records it as dead and asks for a seat from
    time to time (with backoff up to six hours, for thirty days); who answers
    is this device, which sees that no one who announced themselves is missing
    and does nothing. Measured in `session.estado.test.ts`.
  */

  /**
   * The account channel: `moradaDaConta(chave de conta, servidor)` (1.0 "Arca", slice 3).
   * The server stops seeing `self-<id>`. Whoever has the account key calculates it and
   * stores it in the vault; a paired device receives it in the pairing snapshot,
   * and never calculates it.
   *
   * Empty on a paired device without it (a snapshot from before slice 3):
   * no channel has this address, and the device stays out of the account channel.
   */
  get canalDaConta(): string {
    if (!this.vault.unlocked) return ""
    const c = this.vault.contents
    if (c.moradaDaConta) return c.moradaDaConta
    const identity = this.identity
    if (!temChaveDeConta(identity)) return ""
    const morada = moradaDaConta(identity.signingPrivateKey, parseAddress(identity.address).server)
    c.moradaDaConta = morada
    this.#memoriaPorGravar = true
    this.#gravarJa()
    return morada
  }

  /** Read marks, by channel: the time of the last read. This was `enclave.lastRead` from the interface. */
  lidas(): Readonly<Record<string, number>> {
    if (!this.vault.unlocked) return {}
    return { ...this.vault.contents.lidas }
  }

  /**
   * Mark a channel as read up to `at`, and tell the other devices.
   *
   * Only goes up: a mark earlier than what the channel already has changes
   * nothing (another device's may have arrived first). Stores in the vault batch
   * (`FLUSH_MS`), not in its own write: opening channels is the most frequent
   * gesture in the app, and each own write re-encrypted the entire vault. The
   * delta goes to the account channel `LIDAS_MS` after the last mark, with all
   * that changed in the meantime.
   *
   * @throws "read mark channel is invalid" (`cause: { channel }`).
   * @throws "read mark time is invalid" (`cause: { channel, at }`).
   */
  async marcarLido(channel: string, at: number): Promise<void> {
    if (typeof channel !== "string" || channel.length === 0 || channel.length > 255) {
      throw new Error("read mark channel is invalid", { cause: { channel } })
    }
    if (!Number.isFinite(at) || at < 0) throw new Error("read mark time is invalid", { cause: { channel, at } })
    if (fundirLidas(this.vault.contents, { [channel]: limitarMarcaDeLido(at) }).length === 0) return
    /*
      The "pending send" goes to the vault with the mark, in the same batch (M2).
      The delta only goes `LIDAS_MS` after; closing the app in between left the
      mark stored and the other devices in the dark until the next change. With
      "pending send", the next connection sends the full state. It goes when the
      delta passes, and only if no other failure put it on the list in the meantime
      (`#falhasDeEstado`).
      */
    if (this.#groups.has(this.canalDaConta) && !this.vault.contents.estadoPorEnviar) {
      this.vault.contents.estadoPorEnviar = true
      this.#lidasPuseramPorEnviar = this.#falhasDeEstado
    }
    this.#gravarEstado()
    this.emit("lidas", { lidas: this.lidas() })
    this.#lidasPorEnviar.add(channel)
    if (this.#lidasTimer) clearTimeout(this.#lidasTimer)
    this.#lidasTimer = setTimeout(() => {
      this.#lidasTimer = undefined
      const marcas = this.vault.unlocked ? this.vault.contents.lidas ?? {} : {}
      const delta: Record<string, number> = {}
      for (const canal of this.#lidasPorEnviar) {
        const marca = marcas[canal]
        if (marca !== undefined) delta[canal] = marca
      }
      this.#lidasPorEnviar.clear()
      const puseram = this.#lidasPuseramPorEnviar
      this.#lidasPuseramPorEnviar = null
      if (Object.keys(delta).length === 0) return
      void this.#enviarEstadoAgora({ t: "estado.lidas", lidas: delta }).then((passou) => {
        if (!passou || puseram === null || puseram !== this.#falhasDeEstado) return
        if (!this.vault.unlocked || !this.vault.contents.estadoPorEnviar) return
        /*
          A new mark while this delta was in flight: it has not yet gone, and
          "pending send" is for it too. It stays, and passes to its delta, which
          removes it when that one passes.
        */
        if (this.#lidasPorEnviar.size > 0 || this.#lidasTimer !== undefined) {
          this.#lidasPuseramPorEnviar ??= puseram
          return
        }
        delete this.vault.contents.estadoPorEnviar
        this.#gravarEstado()
      })
    }, Session.LIDAS_MS)
  }

  /** The `#falhasDeEstado` from when reads marked "pending send", or `null` if it was not them. */
  #lidasPuseramPorEnviar: number | null = null
  /** How many times a state send failed in this session. See `#marcarEstadoPorEnviar`. */
  #falhasDeEstado = 0

  /** How much read marks pile up before we send them to the other devices. Static for tests. */
  static LIDAS_MS = 2_000
  #lidasPorEnviar = new Set<string>()
  #lidasTimer: ReturnType<typeof setTimeout> | undefined

  /** Interface preferences, by key. The core stores and passes them; it does not read them. */
  preferencias(): Readonly<Record<string, string>> {
    if (!this.vault.unlocked) return {}
    return Object.fromEntries(Object.entries(this.vault.contents.preferencias ?? {}).map(([chave, marca]) => [chave, marca.valor]))
  }

  /**
   * Store a preference, and tell the other devices.
   *
   * @throws "preference key is invalid" (`cause: { chave }`): the key is
   *   lowercase, digits, `.`, `_` and `-`, up to 64 (`CHAVE_DE_PREFERENCIA`).
   * @throws "preference value is too long" (`cause: { chave, comprimento }`).
   * @throws "too many preferences" (`cause: { tecto }`): a new key above `PREFERENCIAS_MAX`.
   * @throws "preference time is invalid" (`cause: { chave, at }`).
   *
   * `at` is to seed: the interface sends what the browser already had with a
   * low mark (1), so a choice the account already won keeps it. Without `at`,
   * the mark is "now", above the earlier one. With `at`, it never goes above
   * "now", and a mark that loses to what is there changes nothing and does not travel.
   */
  async definirPreferencia(chave: string, valor: string, at?: number): Promise<void> {
    if (typeof chave !== "string" || !CHAVE_DE_PREFERENCIA.test(chave)) throw new Error("preference key is invalid", { cause: { chave } })
    if (typeof valor !== "string" || valor.length > PREFERENCIA_MAX_CARACTERES) {
      throw new Error("preference value is too long", { cause: { chave, comprimento: String(valor).length } })
    }
    const actuais = this.vault.contents.preferencias ?? {}
    const actual = actuais[chave]
    if (at !== undefined && (!Number.isFinite(at) || at < 0)) throw new Error("preference time is invalid", { cause: { chave, at } })
    if (actual?.valor === valor) return
    if (actual === undefined && Object.keys(actuais).length >= PREFERENCIAS_MAX) {
      throw new Error("too many preferences", { cause: { tecto: PREFERENCIAS_MAX } })
    }
    // Strictly above the earlier one: two choices in the same millisecond do not tie.
    const marca = {
      valor,
      at: at === undefined ? Math.max(Date.now(), (actual?.at ?? 0) + 1) : Math.min(Math.floor(at), Date.now()),
    }
    if (fundirPreferencias(this.vault.contents, { [chave]: marca }).length === 0) return
    this.#gravarEstado()
    this.emit("preferencias", { preferencias: this.preferencias() })
    this.#enviarEstado({ t: "estado.preferencias", preferencias: { [chave]: marca } })
  }

  /**
   * The person's archive: the channels they archived, with the time.
   *
   * Not `archivedChannels()`, which are channels the account was removed from.
   * This is the gesture of tidying up a live conversation, and the interface
   * decides what it shows with it (an archived direct reappears when a new
   * message arrives, for example: compare the time here with the last message).
   */
  arquivo(): Readonly<Record<string, number>> {
    if (!this.vault.unlocked) return {}
    const marcas: Record<string, number> = {}
    for (const [channel, marca] of Object.entries(this.vault.contents.arquivo ?? {})) {
      if (marca.arquivado) marcas[channel] = marca.at
    }
    return marcas
  }

  /**
   * Archive a conversation, and tell the other devices. It does not leave the
   * channel or delete anything.
   *
   * `at` is the time of the action, when it was not now: the migration of `localStorage`
   * passes the time when the conversation closed in that browser. The marker is
   * `min(at, agora)`. Storing "now" would hide today's message in a direct that closed
   * yesterday, and would override an unarchive that another device did in the
   * meantime. A marker that loses to an existing one changes nothing.
   *
   * @throws "archive channel is invalid" (`cause: { channel }`).
   * @throws "archive time is invalid" (`cause: { channel, at }`).
   */
  async arquivar(channel: string, at?: number): Promise<void> {
    if (at !== undefined && (!Number.isFinite(at) || at < 0)) throw new Error("archive time is invalid", { cause: { channel, at } })
    this.#marcarArquivo(channel, true, at)
  }

  /** Unarchive a conversation, and tell the other devices. */
  async desarquivar(channel: string): Promise<void> {
    this.#marcarArquivo(channel, false)
  }

  /** @throws "archive channel is invalid" (`cause: { channel }`). */
  #marcarArquivo(channel: string, arquivado: boolean, at?: number): void {
    if (typeof channel !== "string" || channel.length === 0 || channel.length > 255) {
      throw new Error("archive channel is invalid", { cause: { channel } })
    }
    const actual = this.vault.contents.arquivo?.[channel]
    // Unarchiving what was never archived leaves no mark.
    if (actual === undefined ? !arquivado : actual.arquivado === arquivado) return
    const agora = Date.now()
    const marca = {
      arquivado,
      at: at === undefined || at >= agora ? Math.max(agora, (actual?.at ?? 0) + 1) : Math.floor(at),
    }
    if (fundirArquivo(this.vault.contents, { [channel]: marca }).length === 0) return
    this.#gravarEstado()
    this.emit("arquivo", { arquivo: this.arquivo() })
    this.#enviarEstado({ t: "estado.arquivo", arquivo: { [channel]: marca } })
  }

  /** What changed in account state goes in the vault batch, like own messages. */
  #gravarEstado(): void {
    this.#memoriaPorGravar = true
    this.#agendarGravacao()
  }

  /**
   * A delta to the account channel. Without waiting, and with no error to the
   * caller.
   *
   * Without an account channel there is no one to tell, and nothing to store:
   * the day the channel is born, whoever enters it receives the full state.
   * With a channel and no network, the mark `estadoPorEnviar` stays, and the
   * next connection sends the full state: since each payload carries the newest
   * mark per key, the full state covers all deltas that did not go out.
   */
  #enviarEstado(payload: Payload): void {
    void this.#enviarEstadoAgora(payload)
  }

  /**
   * A new card, for siblings (slice 3). A direct message or feed this device
   * recognized: a paired device cannot recognize them on its own (the direct
   * message is a DH with the account key). Rooms don't go: without a card a
   * channel is a room. The account channel doesn't either: siblings already know it.
   *
   * Cards from the same instant join in one payload, and the send goes after the
   * vault write that stored them (this is called from inside it).
   */
  #anunciarFicha(canal: string, ficha: FichaDoCanal): void {
    if (ficha.tipo === "sala" || ficha.tipo === "conta") return
    const vazia = this.#fichasPorAnunciar.size === 0
    this.#fichasPorAnunciar.set(canal, ficha)
    if (!vazia) return
    queueMicrotask(() => {
      const fichas = Object.fromEntries(this.#fichasPorAnunciar)
      this.#fichasPorAnunciar.clear()
      this.#enviarEstado({ t: "estado.fichas", fichas })
    })
  }

  #fichasPorAnunciar = new Map<string, FichaDoCanal>()

  /** The cards that go to siblings: the direct messages and feeds, newest first does not matter (there are few). */
  #fichasParaOsIrmaos(): Record<string, FichaDoCanal> {
    const fichas: Record<string, FichaDoCanal> = {}
    for (const [canal, ficha] of Object.entries(this.vault.contents.fichasDosCanais ?? {})) {
      if (ficha.tipo !== "directa" && ficha.tipo !== "mural") continue
      if (Object.keys(fichas).length >= FICHAS_MAX) break
      fichas[canal] = { ...ficha }
    }
    return fichas
  }

  /**
   * Profiles of other people, for siblings (profiles between devices). Each
   * one passes through the wire schema: a twisted name from an old vault stays
   * out, and does not take others with it.
   */
  #perfisParaOsIrmaos(): PerfisDeOutros {
    const perfis: PerfisDeOutros = {}
    for (const [address, perfil] of Object.entries(perfisParaOsIrmaos(this.vault.contents, this.identity.address, PERFIS_MAX))) {
      // The address too: the map key has the shape of a wire address.
      const lido = PerfisDeOutros.safeParse({ [address]: perfil })
      if (lido.success && lido.data[address]) perfis[address] = lido.data[address]
    }
    return perfis
  }

  /**
   * The directory got a new version of another person's profile, from them
   * (a `profile` payload in a channel): siblings get to know (profiles between
   * devices). Called from inside the vault write that stored it.
   *
   * Only a GREATER version counts. The same profile arrives many times (each
   * person republishes it when a channel grows, and in each channel we share),
   * and the same version already went, or also reached siblings.
   */
  #perfilQueMudou(contents: VaultContents, address: string, antes: number | undefined): void {
    if (this.#identity === null || address === this.identity.address) return
    const guardado = contents.directory[address]
    if (!guardado || guardado.parcial || (antes !== undefined && guardado.at <= antes)) return
    const perfil = perfilQueViaja(guardado.payload)
    if (!perfil || perfil.updatedAt <= (this.#perfisDitos.get(address) ?? 0)) return
    this.#perfisPorAnunciar.add(address)
    /*
      Burst cut: profiles from the same window go in one payload. The clock does
      not restart for each new profile, so a flood (a large room republishing
      when we join) does not delay the send forever.
    */
    if (this.#perfisTimer !== undefined) return
    this.#perfisTimer = setTimeout(() => {
      this.#perfisTimer = undefined
      this.#anunciarPerfis()
    }, Session.PERFIS_RAJADA_MS)
  }

  /** Profiles waiting for the burst, for siblings, in `estado.fichas` (see the schema). */
  #anunciarPerfis(): void {
    const enderecos = [...this.#perfisPorAnunciar]
    this.#perfisPorAnunciar.clear()
    if (this.#identity === null || !this.vault.unlocked) return
    const perfis: PerfisDeOutros = {}
    for (const address of enderecos) {
      const guardado = this.vault.contents.directory[address]
      const perfil = guardado && !guardado.parcial ? perfilQueViaja(guardado.payload) : null
      if (!perfil || perfil.updatedAt <= (this.#perfisDitos.get(address) ?? 0)) continue
      const lido = PerfisDeOutros.safeParse({ [address]: perfil })
      if (!lido.success || !lido.data[address]) continue
      perfis[address] = lido.data[address]
      this.#perfisDitos.set(address, perfil.updatedAt)
      if (Object.keys(perfis).length >= PERFIS_MAX) break
    }
    if (Object.keys(perfis).length === 0) return
    /*
      An `estado.fichas` with empty tokens: a sibling before this reads it,
      discards profiles and raises no error (see `PAYLOADS_DE_ESTADO`). Offline,
      it stays "pending send", and the entire state on the next connection carries
      all profiles.
    */
    this.#enviarEstado({ t: "estado.fichas", fichas: {}, perfis })
  }

  #perfisPorAnunciar = new Set<string>()
  #perfisTimer: ReturnType<typeof setTimeout> | undefined
  /**
   * The highest version this device has ever reported to siblings or heard from them,
   * per person. Memory only: after restart, each person's first new version goes out
   * once more.
   */
  #perfisDitos = new Map<string, number>()
  /** The batch of profiles to siblings. Static for tests. */
  static PERFIS_RAJADA_MS = 2_000

  /** Same, with the outcome: `true` if the delta went to the account channel. */
  async #enviarEstadoAgora(payload: Payload): Promise<boolean> {
    // May arrive from a timer after the session drops the identity.
    if (this.#identity === null || !this.vault.unlocked) return false
    const canal = this.canalDaConta
    if (!this.#groups.has(canal)) return false
    if (this.#connection !== "online") {
      this.#marcarEstadoPorEnviar()
      return false
    }
    try {
      // Only for a group that is truly the account's (B1). Dubious, stays pending send.
      const grupo = await this.#canalDaContaConfiavel()
      if (grupo === null) throw new Error("account-channel-untrusted", { cause: { channel: canal } })
      await this.send(canal, payload)
      return true
    } catch {
      this.#marcarEstadoPorEnviar()
      return false
    }
  }

  #marcarEstadoPorEnviar(): void {
    this.#falhasDeEstado += 1
    if (!this.vault.unlocked || this.vault.contents.estadoPorEnviar) return
    this.vault.contents.estadoPorEnviar = true
    this.#gravarEstado()
  }

  /**
   * The entire state to the account channel: one payload per type, only those with content.
   *
   * Runs when the channel grows (newcomer has nothing) and when deltas remained unsent.
   * Large maps are trimmed to the most recent marks (`maisRecentes`) to fit within the
   * schema limit.
   */
  async #enviarEstadoCompleto(): Promise<void> {
    const canal = this.canalDaConta
    if (!this.#groups.has(canal) || !this.vault.unlocked) return
    // The entire state goes only to a group that is truly the account's (B1).
    if ((await this.#canalDaContaConfiavel()) === null) {
      this.#marcarEstadoPorEnviar()
      return
    }
    const c = this.vault.contents
    const payloads: Payload[] = []
    const lidas = maisRecentes(c.lidas ?? {}, LIDAS_MAX, (at) => at)
    if (Object.keys(lidas).length > 0) payloads.push({ t: "estado.lidas", lidas })
    const arquivo = maisRecentes(c.arquivo ?? {}, ARQUIVO_MAX, (marca) => marca.at)
    if (Object.keys(arquivo).length > 0) payloads.push({ t: "estado.arquivo", arquivo })
    const bloqueio = maisRecentes(marcasDeBloqueio(c), BLOQUEIO_MAX, (marca) => marca.at)
    if (Object.keys(bloqueio).length > 0) payloads.push({ t: "estado.bloqueio", bloqueio })
    const preferencias = maisRecentes(c.preferencias ?? {}, PREFERENCIAS_MAX, (marca) => marca.at)
    if (Object.keys(preferencias).length > 0) payloads.push({ t: "estado.preferencias", preferencias })
    const lista = c.shownFriends?.[this.identity.address]
    if (lista) payloads.push({ t: "estado.amigos-mostrados", shown: lista.shown, updatedAt: lista.updatedAt })
    // The profile, with the avatar (phase 1e): this is how it reaches the new device
    // when it didn't fit, or didn't arrive, in the pairing snapshot.
    if (c.profile.displayName) payloads.push(this.#payloadDoPerfil(c.profile))
    // The tokens from direct messages and posts (slice 3), for the sibling that lost them.
    const fichas = this.#fichasParaOsIrmaos()
    /*
      Only if tokens are present. The post secret comes along, but by itself it's not
      worth a payload: the new device already got it in the snapshot, and a silent
      account channel is what the sibling deafness detector expects (I5).
    */
    /*
      And the profiles of other people, in the same payload (profiles across devices):
      the full set covers unsent deltas. Without tokens, they go with empty tokens,
      which is how an older sibling reads them without raising an error.
    */
    const perfis = this.#perfisParaOsIrmaos()
    const comPerfis = Object.keys(perfis).length > 0
    if (Object.keys(fichas).length > 0 || comPerfis) {
      const segredoDoMural = Object.keys(fichas).length > 0 ? this.#segredoDoMuralEmTexto() : undefined
      payloads.push({ t: "estado.fichas", fichas, ...(segredoDoMural ? { segredoDoMural } : {}), ...(comPerfis ? { perfis } : {}) })
    }
    // The open reports, for the sibling that joined after them.
    payloads.push(...payloadsDasDenuncias(denunciasParaOsIrmaos(c)))
    try {
      for (const payload of payloads) await this.send(canal, payload)
      if (c.estadoPorEnviar) {
        delete c.estadoPorEnviar
        this.#gravarEstado()
      }
    } catch {
      this.#marcarEstadoPorEnviar()
    }
  }

  /**
   * A `estado.*` payload from a sibling device, merging into the vault.
   *
   * Only from the own account: the account channel has only its leaves, and a
   * different sender is a tree that shouldn't exist and is not obeyed.
   */
  #aoEstado(sender: string, senderDeviceKey: Uint8Array, payload: Payload): void {
    if (sender !== this.identity.address || !this.vault.unlocked) return
    /*
      A leaf this vault knows is revoked does not affect the state. It may still
      be in the channel (removal failed or hasn't arrived yet): what it says after
      revocation is not merged.
    */
    if (estaRevogado(this.vault.contents, sender, toBase64(senderDeviceKey))) return
    const c = this.vault.contents
    let mudou = false
    switch (payload.t) {
      case "estado.lidas":
        if (fundirLidas(c, limitarMarcasDeLido(payload.lidas)).length > 0) {
          mudou = true
          this.emit("lidas", { lidas: this.lidas() })
        }
        break
      case "estado.arquivo":
        if (fundirArquivo(c, payload.arquivo).length > 0) {
          mudou = true
          this.emit("arquivo", { arquivo: this.arquivo() })
        }
        break
      case "estado.preferencias": {
        const mudaram = fundirPreferencias(c, payload.preferencias)
        if (mudaram.length > 0) {
          mudou = true
          this.emit("preferencias", { preferencias: this.preferencias() })
        }
        // A sibling chose to join the common room: this device joins too.
        // `ensureCommonRoom` does nothing for those already there.
        if (mudaram.includes(PREFERENCIA_SALA_COMUM) && this.querSalaComum()) void this.ensureCommonRoom().catch(() => {})
        break
      }
      case "estado.bloqueio": {
        const { bloqueados, desbloqueados } = fundirBloqueio(c, payload.bloqueio)
        mudou = bloqueados.length + desbloqueados.length > 0
        for (const address of bloqueados) this.emit("bloqueio", { address, bloqueado: true })
        for (const address of desbloqueados) this.emit("bloqueio", { address, bloqueado: false })
        // Welcomes the block filter left unopened come back, as in the `unblock` here.
        // Friendship does not return: the other device ended it.
        if (desbloqueados.length > 0) void this.resyncWelcomes().catch(() => {})
        break
      }
      case "estado.amigos-mostrados":
        mudou = fundirAmigosMostrados(c, this.identity.address, payload)
        break
      case "estado.fichas": {
        /*
          The tokens a sibling acknowledged (slice 3). Only from here and the snapshot
          are tokens accepted: the account itself says so. The first from each
          channel stays, as always.
        */
        let novas = false
        for (const [canal, ficha] of Object.entries(payload.fichas)) if (registarFicha(c, canal, ficha)) novas = true
        if (payload.segredoDoMural && !c.segredoDoMural) {
          c.segredoDoMural = payload.segredoDoMural
          novas = true
        }
        mudou = novas
        // The UI rereads tokens with each channel list.
        if (novas) this.emit("channels", { channels: this.channels })
        /*
          The profiles of other people a sibling learned about (profiles across devices).
          Only a higher version enters (`fundirPerfisDeOutros`). The version is recorded:
          this device won't send it to siblings again.
        */
        if (payload.perfis) {
          for (const [address, perfil] of Object.entries(payload.perfis)) {
            if (perfil.updatedAt > (this.#perfisDitos.get(address) ?? 0)) this.#perfisDitos.set(address, perfil.updatedAt)
          }
          const mudaram = fundirPerfisDeOutros(c, this.identity.address, payload.perfis)
          if (mudaram.length > 0) {
            mudou = true
            this.emit("perfis", { enderecos: mudaram })
          }
        }
        /*
          The reports a sibling opened (reports completion): they have the account key,
          this device may not. They enter once per id, by reading here: each device
          reads independently.
        */
        if (payload.denuncias) {
          const canais = fundirDenuncias(c, payload.denuncias)
          if (canais.length > 0) mudou = true
          for (const canal of canais) this.emit("status", { detail: "", code: "denuncia-recebida", channel: canal })
        }
        break
      }
      case "profile":
        /*
          The profile another account device edited (phase 1e). The most recent wins
          (`adoptarPerfil`); whoever adopts it republishes it on channels, so a channel
          where the other device didn't publish sees the same face.
        */
        if (
          adoptarPerfil(c, {
            displayName: payload.displayName,
            activity: payload.activity,
            donations: payload.donations,
            statusText: payload.statusText,
            bio: payload.bio,
            email: payload.email,
            avatarDataUrl: payload.avatar?.inline,
            updatedAt: payload.updatedAt,
          })
        ) {
          mudou = true
          this.emit("perfil", { profile: c.profile })
          void this.publishProfile().catch(() => {})
        }
        break
      default:
        // Another `t` in the account channel (the device signal, a newer version):
        // nothing to merge.
        return
    }
    if (mudou) this.#gravarEstado()
  }

  /**
   * The snapshot for the device being paired (level M).
   *
   * Each ledger entry passes through the schema one by one: a malformed entry from
   * an old vault is left out and doesn't take the entire snapshot with it.
   */
  #estadoParaEmparelhar(): EstadoDeConta | null {
    if (!this.vault.unlocked) return null
    const c = this.vault.contents
    const amizades: EstadoDeConta["amizades"] = {}
    for (const canal of canaisComEntradas(c)) {
      if (Object.keys(amizades).length >= LIVRO_CANAIS_MAX) break
      const entradas: EntradaDoLivro[] = []
      for (const entrada of this.#livroDoCanal(canal)) {
        const lida = EntradaDoLivro.safeParse({
          seq: entrada.seq,
          sender: entrada.sender,
          t: entrada.payload.t,
          sentAt: entrada.payload["sentAt"],
          note: entrada.payload["note"],
          withdrawn: entrada.payload["withdrawn"] === true ? true : undefined,
        })
        if (lida.success) entradas.push(lida.data)
      }
      if (entradas.length > 0) amizades[canal] = entradas.slice(-LIVRO_ENTRADAS_MAX)
    }
    const lista = c.shownFriends?.[this.identity.address]
    /*
      The profile passes through the schema separately, like each ledger entry: a
      malformed profile from an old vault (a name over the limit) is left out and
      doesn't take the entire snapshot with it. No name, no profile to send.
    */
    const lido = c.profile.displayName ? PerfilDaConta.safeParse(c.profile) : null
    const perfil = lido?.success ? lido.data : undefined
    const perfis = this.#perfisParaOsIrmaos()
    return {
      v: 1,
      amizades,
      bloqueio: maisRecentes(marcasDeBloqueio(c), BLOQUEIO_MAX, (marca) => marca.at),
      ...(lista ? { amigosMostrados: { shown: lista.shown, updatedAt: lista.updatedAt } } : {}),
      arquivo: maisRecentes(c.arquivo ?? {}, ARQUIVO_MAX, (marca) => marca.at),
      lidas: maisRecentes(c.lidas ?? {}, LIDAS_MAX, (at) => at),
      preferencias: maisRecentes(c.preferencias ?? {}, PREFERENCIAS_MAX, (marca) => marca.at),
      // The profile, so the new device starts with it (phase 1e). No name, no profile.
      ...(perfil ? { perfil } : {}),
      // The opaque addresses (slice 3), which the new device cannot compute.
      fichas: this.#fichasParaOsIrmaos(),
      ...(this.#segredoDoMuralEmTexto() ? { segredoDoMural: this.#segredoDoMuralEmTexto() } : {}),
      ...(this.canalDaConta ? { moradaDaConta: this.canalDaConta } : {}),
      /*
        The names of other people, without avatars (profiles across devices). Without
        this the new device would see everyone as "No name" until each person publishes
        again, and offline people don't publish.
      */
      ...(perfis && Object.keys(perfis).length > 0 ? { perfis } : {}),
    }
  }

  /**
   * A device of this account says it can be in the account channel.
   *
   * Via pairing ready or device signal. It goes in the vault by device key; whoever
   * has the account key will check next if they need to invite it. `comChave`: the
   * signal said `CAPACIDADE_CHAVE_DE_CONTA`, and that factors into who creates the
   * channel (I4).
   */
  #notarAparelhoComEstado(deviceKey: Uint8Array, comChave = false): void {
    if (!this.vault.unlocked) return
    const chave = toBase64(deviceKey)
    if (chave === toBase64(this.identity.deviceSigningPublicKey)) return
    const c = this.vault.contents
    if (c.aparelhosComEstado?.[chave] === undefined) {
      c.aparelhosComEstado = maisRecentes({ ...c.aparelhosComEstado, [chave]: Date.now() }, Session.APARELHOS_LEMBRADOS_NO_COFRE, (at) => at)
      this.#gravarEstado()
    }
    // The time of the last signal, not the first: a device with the key that stops
    // connecting stops counting toward the choice (`CRIADOR_VALE_MS`).
    if (comChave) {
      c.aparelhosComChave = maisRecentes({ ...c.aparelhosComChave, [chave]: Date.now() }, Session.APARELHOS_LEMBRADOS_NO_COFRE, (at) => at)
      this.#gravarEstado()
    }
    if (!this.temChaveDeConta) return
    // Together: multiple signals on the same connection (one per recovered channel) count as one pass.
    if (this.#canalDaContaTimer) clearTimeout(this.#canalDaContaTimer)
    this.#canalDaContaTimer = setTimeout(() => {
      this.#canalDaContaTimer = undefined
      if (this.#connection === "online") void this.#cuidarDoCanalDaConta().catch(() => {})
    }, 1_000)
  }
  #canalDaContaTimer: ReturnType<typeof setTimeout> | undefined

  /**
   * The device signal: a `typing` with `until` already past and the capabilities.
   *
   * All clients know `typing`, none show it when born expired, and an older client
   * discards the `capacidades` field without error. Opens like any event, so also
   * resets the deafness count for whoever receives it. Serves two things: tell siblings
   * this device can enter the account channel, and prove this leaf is alive when a
   * sibling asks for space (F16, `#folhasMortas`).
   */
  async #sinalDeAparelho(channel: string, pedirPerfis = false): Promise<void> {
    const capacidades = [
      CAPACIDADE_ESTADO_DA_CONTA,
      ...(this.temChaveDeConta ? [CAPACIDADE_CHAVE_DE_CONTA] : []),
      CAPACIDADE_REENVIO,
      CAPACIDADE_SINCRONIA,
      CAPACIDADE_PERMISSOES,
      ...(pedirPerfis ? [CAPACIDADE_PEDE_PERFIS] : []),
    ]
    // `until: 0`, not "now minus one" (M4): with the clock of whoever receives it
    // running slow, "now minus one" would still be future there and looked "typing".
    await this.send(channel, { t: "typing", until: 0, capacidades })
  }

  /**
   * A device outside the account channel: announce itself.
   *
   * On a channel where another leaf of this account exists (the feed, preferably), so
   * the device with the key hears it, live or on the next recovery. Once per connection,
   * and only while not in the account channel.
   *
   * Also a device WITH the account key, when it's not the one creating the channel
   * (I4): says it has the key, so siblings with the key know who creates, and enters
   * by Welcome like the others.
   */
  async #anunciarAparelho(): Promise<void> {
    if (!this.suportaBundle || this.#groups.has(this.canalDaConta)) return
    const eu = this.identity.address as UserAddress
    const meu = toBase64(this.identity.deviceSigningPublicKey)
    for (const canal of new Set([this.feedChannel, ...this.#groups.keys()])) {
      if (canal === this.#commonRoom) continue
      const grupo = this.#groups.get(canal)
      if (!grupo || estaRemovido(grupo)) continue
      const arvore = grupo.state.ratchetTree
      const irmaos = leavesOf(arvore, eu).filter((folha) => {
        const chave = deviceKeyAtLeaf(arvore, folha)
        return chave !== undefined && toBase64(chave) !== meu
      })
      if (irmaos.length === 0) continue
      await this.#sinalDeAparelho(canal)
      return
    }
  }

  /** How many announced devices are remembered: the manifest limit, with room for revoked ones. */
  static readonly APARELHOS_LEMBRADOS_NO_COFRE = 32

  /**
   * What runs on connection: the account channel (whoever has the key), the announcement
   * (whoever doesn't), and the state left unsent.
   */
  async #estadoAoLigar(): Promise<void> {
    if (!this.vault.unlocked) return
    if (this.temChaveDeConta) await this.#cuidarDoCanalDaConta().catch(() => {})
    // Those left out (no key, or has it but isn't the creator) announce themselves.
    if (!this.#groups.has(this.canalDaConta)) await this.#anunciarAparelho().catch(() => {})
    if (this.vault.contents.estadoPorEnviar && this.#groups.has(this.canalDaConta)) await this.#enviarEstadoCompleto()
  }

  /** When each device was last invited to the account channel. Memory only. */
  #convitesAoCanalDaConta = new Map<string, number>()
  /** Between attempts to invite the same device to the account channel. Static for tests. */
  static CANAL_DA_CONTA_TRAVAO_MS = 10 * 60_000

  /**
   * Create the account channel if needed, and invite whoever announced and is missing.
   *
   * Only the device with the account key. With no siblings announced there's no
   * channel: a single-device account pays nothing for this. Invite via claim with
   * `devices`, only announced devices in the manifest: that keeps 0.5.7 leaves out.
   * Throttled per device, because a device that never connects has no packets on the server.
   */
  async #cuidarDoCanalDaConta(): Promise<void> {
    return this.#umaDeCadaVez("canal-da-conta", () => this.#cuidarDoCanalDaContaAgora())
  }

  async #cuidarDoCanalDaContaAgora(): Promise<void> {
    if (!this.suportaBundle || !this.vault.unlocked || this.#connection !== "online" || !this.temChaveDeConta) return
    const eu = this.identity.address
    const meu = toBase64(this.identity.deviceSigningPublicKey)
    const anunciados = this.vault.contents.aparelhosComEstado ?? {}
    const canal = this.canalDaConta
    if (!this.#groups.has(canal) && Object.keys(anunciados).every((chave) => chave === meu)) return
    const manifesto = await this.#manifestoPara(eu)
    if (manifesto === null) return
    const capazes = manifesto.devices
      .map((device) => toBase64(device.deviceKey))
      .filter((chave) => chave !== meu && anunciados[chave] !== undefined)
    if (!this.#groups.has(canal)) {
      if (capazes.length === 0) return
      // Only one device creates it (I4): the one with the lowest key among those with the account key, and only if the channel does not yet exist on the server.
      if (!this.#criaOCanalDaConta(manifesto)) return
      if (await this.#canalJaUsado(canal)) return
      await this.#criarCanalDaConta()
    }
    // Siblings only invite each other to a group that really belongs to the account (B1).
    const grupo = await this.#canalDaContaConfiavel()
    if (!grupo) return
    const arvore = grupo.state.ratchetTree
    const presentes = new Set(
      leavesOf(arvore, eu as UserAddress)
        .map((folha) => deviceKeyAtLeaf(arvore, folha))
        .filter((chave): chave is Uint8Array => chave !== undefined)
        .map((chave) => toBase64(chave)),
    )
    const agora = Date.now()
    const faltam = capazes.filter((chave) => {
      if (presentes.has(chave)) return false
      const tentado = this.#convitesAoCanalDaConta.get(chave)
      return tentado === undefined || agora - tentado >= Session.CANAL_DA_CONTA_TRAVAO_MS
    })
    if (faltam.length === 0) return
    for (const chave of faltam) this.#convitesAoCanalDaConta.set(chave, agora)
    try {
      const reclamados = await this.#reclamarPacotes(eu, faltam, manifesto)
      await this.#seatInvite(canal, eu, reclamados)
    } catch (erro) {
      if (erro instanceof AparelhoSemChaves || (erro as Error).message === "that person is already in this channel") return
      this.#falhaDeLugar(canal, "canal da conta", erro)
    }
  }

  /**
   * Is this the device that creates the account channel? (I4, revision of slot 1.)
   *
   * The rule is deterministic and the same on all devices: among devices in the manifest that hold the account key (this one, and those that announced it in the device signal less than `CRIADOR_VALE_MS` ago), the one with the lowest device key creates it (in base64url string order). The others announce themselves and join via Welcome. With only one device holding the key, it is that one, as before.
   */
  #criaOCanalDaConta(manifesto: DeviceManifest): boolean {
    const meu = toBase64(this.identity.deviceSigningPublicKey)
    const comChave = this.vault.contents.aparelhosComChave ?? {}
    const agora = Date.now()
    const candidatos = manifesto.devices
      .map((device) => toBase64(device.deviceKey))
      .filter((chave) => chave === meu || (comChave[chave] !== undefined && agora - comChave[chave] < Session.CRIADOR_VALE_MS))
    if (!candidatos.includes(meu)) candidatos.push(meu)
    return candidatos.sort()[0] === meu
  }

  /** How long a sibling's signal "I have the account key" counts toward choosing who creates it. */
  static CRIADOR_VALE_MS = 30 * 24 * 60 * 60_000

  /**
   * Does the server already have events in this channel? Before creating it (I4): a sibling with the key may have created it without our knowing, and a second group with the same name would be an account channel split in two. Without an answer, count it as used: create it on the next connection, not blindly.
   */
  async #canalJaUsado(canal: string): Promise<boolean> {
    this.#send({ t: "channel.backfill", channel: canal, afterSeq: -1, limit: 1 })
    try {
      const page = await this.#await("channel.backfill.page", 10_000, canal)
      return page.t !== "channel.backfill.page" || page.events.length > 0
    } catch {
      return true
    }
  }

  /**
   * The account channel group, with only this leaf. No `room.created`, no profile, no rooms: it is not a space, and nobody sees it.
   */
  async #criarCanalDaConta(): Promise<void> {
    const canal = this.canalDaConta
    this.#fichaAoNascer.set(canal, { tipo: "conta" })
    const nosso = await createChannel(this.identity, canal)
    await this.#persistGroup(canal, nosso)
    this.#epocaAoLigar.set(canal, epochOf(nosso))
    this.#noteMembership(canal)
    await this.flush()
    this.#send({ t: "channel.subscribe", channels: [canal] })
  }

  /**
   * Is there a leaf in the group that does not belong to this account? (B1, revision of slot 1.)
   *
   * An empty leaf does not count. A leaf with a credential that cannot be read counts as alien: the account channel has no leaves from old clients.
   */
  #folhaDeOutraConta(grupo: GroupSession): boolean {
    const arvore = grupo.state.ratchetTree
    const eu = this.identity.address
    for (let folha = 0; folha * 2 < arvore.length; folha++) {
      if (arvore[folha * 2]?.nodeType !== "leaf") continue
      if (addressAtLeaf(arvore, folha) !== eu) return true
    }
    return false
  }

  /**
   * Can this device speak in the account channel group? (B1, revision of slot 1.)
   *
   * The server is not trustworthy: it claims that `!self-` is from the account, but a compromised server could let another account step into it and invite us. Someone joining a group with this name that is not ours sends it the entire state, and the device with the account key invites siblings there. So every leaf must be from this account, from a device that the manifest lists, and that the vault does not know is revoked.
   *
   * - `alheio`: there is a leaf from another account. The group is not ours.
   * - `fora-do-manifesto`: a device that the account does not declare (read fresh before refusing, so a recent pairing does not count as such).
   * - `revogado`: a device that this vault knows is revoked.
   * - `sem-manifesto`: the manifest was not read. Nothing is decided.
   */
  async #confiarNoCanalDaConta(
    grupo: GroupSession,
  ): Promise<"ok" | "alheio" | "fora-do-manifesto" | "revogado" | "sem-manifesto"> {
    if (this.#folhaDeOutraConta(grupo)) return "alheio"
    const eu = this.identity.address
    const arvore = grupo.state.ratchetTree
    const chaves: string[] = []
    for (const folha of leavesOf(arvore, eu as UserAddress)) {
      const chave = deviceKeyAtLeaf(arvore, folha)
      if (chave === undefined) return "alheio"
      chaves.push(toBase64(chave))
    }
    if (chaves.some((chave) => estaRevogado(this.vault.contents, eu, chave))) return "revogado"
    let manifesto = await this.#manifestoPara(eu)
    const faltaAlguma = (lido: DeviceManifest): boolean =>
      chaves.some((chave) => !lido.devices.some((device) => toBase64(device.deviceKey) === chave))
    if (manifesto !== null && faltaAlguma(manifesto)) manifesto = await this.#manifestoFresco(eu)
    if (manifesto === null) return "sem-manifesto"
    return faltaAlguma(manifesto) ? "fora-do-manifesto" : "ok"
  }

  /**
   * The account channel, only if it is trustworthy. An alien group is dropped (with the warning in the log); a doubtful one stays, silent, until the next verdict.
   */
  async #canalDaContaConfiavel(): Promise<GroupSession | null> {
    const canal = this.canalDaConta
    const grupo = this.#groups.get(canal)
    if (!grupo) return null
    const veredicto = await this.#confiarNoCanalDaConta(grupo)
    if (veredicto === "ok") return grupo
    if (veredicto === "alheio") {
      await this.#largarGrupo(canal, true)
      this.#avisarCanalDaContaAlheio(canal, veredicto)
    }
    return null
  }

  #avisarCanalDaContaAlheio(canal: string, razao: string): void {
    this.emit("status", {
      detail: `canal da conta recusado: ${razao}`,
      level: "error",
      code: "account-channel-foreign",
      route: "log",
      channel: canal,
    })
  }

  /** The manifest read now, without the short memory of `#manifestoPara`. */
  async #manifestoFresco(address: string): Promise<DeviceManifest | null> {
    this.#manifestosRecentes.delete(address)
    return this.#manifestoPara(address)
  }

  /** The last time the account channel was repaired at a sibling's request. Memory only. */
  #reparacaoDoCanalDaConta = 0

  /**
   * A device from this account requested a seat in the account channel (F16 in the account channel).
   *
   * ANY leaf from the account that is there answers, not just the one on the device with the key (I5 of slot 1 revision): the deaf device might be precisely the one with the key, and it would never get repaired. Restoring a seat does not need the account key: the claim asks only for missing devices, and `#pacotesAdmissiveis` accepts only those in the manifest. Inviting those who announced themselves and are missing remains with whoever has the key (`#cuidarDoCanalDaConta`).
   *
   * Waits for proof of life from siblings (`PROVA_DE_VIDA_MS`), removes only leaves that did not signal in the current epoch and invites them again. Once a minute: a 0.5.7 leaf with dead Welcome requests a seat now and then, and it cannot cost a repair every time.
   */
  async #repararCanalDaConta(): Promise<void> {
    const agora = Date.now()
    if (agora - this.#reparacaoDoCanalDaConta < REJOIN_TURN_MS * 20) return
    this.#reparacaoDoCanalDaConta = agora
    await new Promise((resolve) => setTimeout(resolve, Session.PROVA_DE_VIDA_MS))
    const canal = this.canalDaConta
    // Only in a group that really is the account channel (B1).
    const grupo = await this.#canalDaContaConfiavel()
    if (!grupo) return
    const eu = this.identity.address
    const mortas = this.#folhasMortas(canal, grupo, eu)
    if (mortas !== null && mortas.length > 0) {
      const manifesto = await this.#manifestoPara(eu)
      if (manifesto !== null) {
        const reclamados = await this.#reclamarPacotes(eu, mortas, manifesto)
        await this.#unseat(canal, eu, mortas)
        await this.#seatInvite(canal, eu, reclamados)
      }
    }
    await this.#cuidarDoCanalDaConta()
  }

  /** Post to the feed. Returns the post `id`. */
  async post(caption: string, tags: string[] = [], extras: PostExtras = {}): Promise<string> {
    const title = extras.title?.trim()
    const id = crypto.randomUUID()
    await this.send(await this.ensureFeed(), {
      t: "post",
      id,
      postedAt: Date.now(),
      caption,
      media: extras.media ?? [],
      links: extras.links ?? [],
      tags,
      // An empty title is the absence of a title, not whitespace: the field is optional and this is how it stays out of what goes in the thread.
      ...(title ? { title } : {}),
      // And the poll, when the post is one. Absent is absent: a normal post does not carry the field in the thread.
      ...(extras.poll ? { poll: extras.poll } : {}),
    })
    return id
  }

  /**
   * A like or dislike on a post, sent to the feed of whoever posted it, which is the group where the post exists.
   *
   * One message per action, and the most recent from each person is what counts. Switching thumbs means sending the other; removing the vote is `remove`. There is no counter here being incremented, because there is no one to trust with the sum, see `post.reaction` in the protocol.
   */
  async reactToPost(channel: string, target: string, emoji: string, remove = false): Promise<void> {
    await this.send(channel, {
      t: "post.reaction",
      id: crypto.randomUUID(),
      target,
      emoji,
      at: Date.now(),
      remove,
    })
  }

  /**
   * Vote in a poll, or remove the vote.
   *
   * Goes to the channel where the poll was posted, the feed of who posted it, or the conversation where the message is, because that is where the people who saw it are. A vote sent elsewhere reaches no one.
   *
   * **One event per action, and never a counter.** The total comes from summing the votes this device has, and each person counts once: the count is a table of voter to option, not a number that someone increments. This is what makes resending harmless, the same vote stated ten times is still one vote, and why the vote is attributable. See `post.reaction.vote`.
   *
   * `emoji` is empty on purpose: this makes an old client read it as a reaction that is no thumb, and so ignore it, rather than add it to the post's likes.
   *
   * Switching option means sending another vote; the most recent from each person is what counts, by the timestamp of who sends it.
   */
  async voteOnPoll(channel: string, target: string, option: number, remove = false): Promise<void> {
    await this.send(channel, {
      t: "post.reaction",
      id: crypto.randomUUID(),
      target,
      emoji: "",
      at: Date.now(),
      remove,
      vote: option,
    })
  }

  /** A comment, to the same group and for the same reason. */
  async commentOnPost(channel: string, target: string, body: string): Promise<void> {
    await this.send(channel, {
      t: "post.comment",
      id: crypto.randomUUID(),
      target,
      postedAt: Date.now(),
      body,
    })
  }

  async acceptFollower(address: string): Promise<void> {
    // Before creating the feed: the refusal cannot leave side effects.
    if (this.isBlocked(address)) throw new Error("that person is blocked")
    await this.seat(await this.ensureFeed(), address)
  }

  /**
   * Put someone in a channel and keep them there, the only entry point any caller should use.
   *
   * MLS makes adding a member a purely local commit: the moment we add them they are in our tree, whether or not they ever process the welcome. So "already in the group" describes two opposite situations, someone who is reading along, and someone who has no idea the channel exists because their invitation evaporated. Treating both as an error is what left a person staring at "já está neste canal" with no way forward, on the very button meant to fix it.
   *
   * So: a member who has never said a word here is re-seated (their dead leaf removed, a fresh one added against a new key package, producing a welcome they can actually open), and a member who is demonstrably present is a success, the goal was that they be in the channel, and they are.
   *
   * "Demonstrably present" is the whole hinge, and it used to be read from the chat history: has this person ever posted here? On a feed that question has one answer forever, no. Readers do not post into somebody else's feed; only the owner does. So every reader of every feed looked inert, and each pass of the bootstrap or the circle repair re-seated a member who was reading perfectly well. A re-seat is not free: it rekeys the group, and forward secrecy then denies the new seat every post made before it. That is exactly how one founder stopped seeing another founder's posts: the repair was the thing doing the damage, and it ran again on every reconnect.
   *
   * The honest test is cryptographic: has anything this person sealed to this channel ever come out on this device? A silent reader still answers yes, because joining changes the epoch and every member republishes their profile into the channel when it does. Never having been heard from at all therefore means the seat really is dead, and re-seating costs nothing, there was nothing they could have read anyway.
   */
  async seat(channel: string, address: string): Promise<SeatOutcome> {
    // A block applies to personal channels: without this, reconciliation and `repairInvite` would seat again whoever blocked. See `block`.
    if (this.#bloqueadoAqui(channel, address)) throw new Error("that person is blocked")
    const group = this.#groups.get(channel)
    if (group && [...memberAddresses(group.state.ratchetTree).values()].includes(address as UserAddress)) {
      // `live` is having broadcast AND no device missing: an account with one device speaking and another without a leaf yet has a seat to give, and `#invite` gives only that one. Proof of life is still per PERSON (`transmitters` by address); dropping it to the device, so a dead device does not live in another's shadow, is block F of the plan and stays in docs/PENDENTES.md.
      if (hasTransmitted(this.vault.contents, channel, address)) {
        if (!(await this.#haLugarPorDar(group, address))) return "live"
        await this.#seatInvite(channel, address)
        return "invited"
      }
      // Silence only means a dead seat once this device has heard *somebody*
      // here. On a vault upgraded from before this record existed the honest
      // answer is "I do not know yet", and guessing wrong costs a healthy
      // member every post ever made. Evidence arrives within minutes; the
      // repair can wait that long, and a genuinely dead seat still heals
      // through the reader's own rejoin request and the welcome resync.
      if (!hasTransmitterEvidence(this.vault.contents, channel)) return "unproven"
      await this.#reseat(channel, address)
      return "reseated"
    }
    // No guard: seating is repair, and runs on any member. See `invite`.
    await this.#seatInvite(channel, address)
    return "invited"
  }

  /**
   * Take the dead leaf back and hand out a fresh seat.
   *
   * **This does NOT walk the group queue, and it is on purpose.** The two halves already walk it internally, each in its turn; putting it here too was the trap written in `docs/PENDENTES.md` before this was fixed: `#unseat` would wait for a queue that the very `#reseat` that called it would be holding, and the channel would freeze forever, with no error and no warning, because a promise that never resolves is indistinguishable from slow work. The rule that stands: the queue embraces the LEAVES of the call tree, never what composes them.
   *
   * The cost of two times instead of one is that a send can slip between removal and admission. It is the certain cost: the two are independent commits, and a message encrypted in the in-between epoch opens perfectly for whoever is there.
   *
   * **The KEY PACKAGE IS CLAIMED FIRST, and without it nothing is committed.** Until October 6, 2026 the order was remove then fetch the new seat: the destruction was unconditional and the restoration was hopeful. If the second failed, the account with no packages at hand, the ten seconds of `#await("keypackage.claimed")` exhausted, no package to verify the chain, the person was OUT of the channel, and their next request is refused because they are no longer a member (`#answerRejoinAgora` requires them to be in the tree). Now the claim runs first: without a package, this throws and the leaf stays where it is, which is the state before repair and not a worse state than that.
   *
   * **And it is claim, not admit.** Admitting before removing was what is refused in `PersonProfile`, admission refuses those already in the tree, so it forced two leaves for the same person, and half the messages encrypted to a seat they cannot open. Claiming does not touch the tree: it spends a package on the server, and that is the only cost if removal fails next.
   */
  async #reseat(channel: string, address: string): Promise<void> {
    const grupo = this.#groups.get(channel)
    if (!grupo) throw new Error("not a member of this channel", { cause: { channel } })
    /*
      **Only the dead leaf, when we know which one it is (F16, phase 5).** An account with two devices where one went deaf lost BOTH leaves on each seat request: the healthy device was out until it opened the new Welcome, and everything said in the meantime was unreadable to it forever. Now, when some of the account's leaves signaled in the current epoch (`#folhasMortas`), we remove only the rest and re-seat only that rest, by claim with `devices`. When we cannot tell (leaf without device key, account without manifest, no leaf with signal, or all with signal), we do what we always did: all of them.
      */
    const mortas = this.#folhasMortas(channel, grupo, address)
    const folhas = leavesOf(grupo.state.ratchetTree, address as UserAddress).length
    if (mortas !== null && mortas.length > 0 && mortas.length < folhas) {
      const manifesto = await this.#manifestoPara(address)
      if (manifesto !== null) {
        const reclamados = await this.#reclamarPacotes(address, mortas, manifesto)
        await this.#unseat(channel, address, mortas)
        await this.#seatInvite(channel, address, reclamados)
        return
      }
    }
    /*
      Without `devices`: what will be removed are ALL leaves of this account (see `#unseat`), so what is requested is the entire manifest batch and not just what is missing. The prior manifest goes along so `#pacotesAdmissiveis` can check what the server served against what the account declared.
      */
    const reclamados = await this.#reclamarPacotes(address, undefined, await this.#manifestoPara(address))
    // The removal is `#unseat`, which already saves before the commit goes out and does nothing when there is no leaf to remove. The same thing was written here, and two copies of an invariant this heavy is one too many.
    await this.#unseat(channel, address)
    await this.#seatInvite(channel, address, reclamados)
  }

  /**
   * Leaves of an account that did not signal in the current epoch, by device key (F16).
   *
   * Alive is a leaf from which a payload encrypted IN the epoch the group is in was opened (`#vivoNaEpoca`). A deaf leaf stayed in a prior epoch (missed a commit) or on a branch that is not this one, and what it encrypts does not open here in the current epoch: it cannot pass as alive. A healthy one that has been silent since the last commit would pass as dead, and that is why proof of life exists: whoever gets a seat request from the account itself answers with the device signal (`#provarVida`), and whoever decides waits `PROVA_DE_VIDA_MS`.
   *
   * This device's leaf never counts as dead: it is in the group's epoch by definition, and MLS does not let anyone unseat themselves.
   *
   * @returns `null` when there is a leaf without a device key (you don't know what to request).
   */
  #folhasMortas(channel: string, grupo: GroupSession, address: string): string[] | null {
    const arvore = grupo.state.ratchetTree
    const epoca = epochOf(grupo)
    const vivos = this.#vivoNaEpoca.get(channel)
    const meu = toBase64(this.identity.deviceSigningPublicKey)
    const mortas: string[] = []
    for (const folha of leavesOf(arvore, address as UserAddress)) {
      const chave = deviceKeyAtLeaf(arvore, folha)
      if (chave === undefined) return null
      const texto = toBase64(chave)
      if (address === this.identity.address && texto === meu) continue
      if (vivos?.get(texto) !== epoca) mortas.push(texto)
    }
    return mortas
  }

  /**
   * Which device opened a payload in each channel, and in which epoch (F16).
   *
   * Memory only: answers "is this leaf alive NOW?", and after a reload the honest answer is "I do not know", which is the old path.
   */
  #vivoNaEpoca = new Map<string, Map<string, bigint>>()

  #notarVivo(channel: string, deviceKey: Uint8Array, epoca: bigint | undefined): void {
    if (epoca === undefined) return
    let porAparelho = this.#vivoNaEpoca.get(channel)
    if (!porAparelho) {
      porAparelho = new Map()
      this.#vivoNaEpoca.set(channel, porAparelho)
    }
    const chave = toBase64(deviceKey)
    const vista = porAparelho.get(chave)
    if (vista === undefined || epoca > vista) porAparelho.set(chave, epoca)
    this.#notarVisto(channel, chave)
  }

  /**
   * And when, on this device's clock: what separates a dead leaf from one silent for a while, for §4.6 (`#calada`). In the vault, because fourteen days do not fit in a session; at most one write per device per hour, and saved with the next batch, without asking for its own save.
   */
  #notarVisto(channel: string, aparelho: string): void {
    if (!this.vault.unlocked) return
    const agora = Date.now()
    const doCanal = this.vault.contents.aparelhoVistoNoCanal?.[channel] ?? {}
    if (agora - (doCanal[aparelho] ?? 0) < 3_600_000) return
    this.vault.contents.aparelhoVistoNoCanal = {
      ...this.vault.contents.aparelhoVistoNoCanal,
      [channel]: maisRecentes({ ...doCanal, [aparelho]: agora }, Session.CAPACIDADES_POR_CANAL, (at) => at),
    }
    this.#memoriaPorGravar = true
  }

  /**
   * How long the responder to a seat request from an account with multiple leaves waits for the healthy devices to signal. Static for tests.
   */
  static PROVA_DE_VIDA_MS = 3_000

  /** When this device requested a seat in each channel (`requestRejoin`). See `#provarVida`. */
  #lugaresPedidosPorMim = new Map<string, number>()

  /**
   * A seat request from OUR account in a channel we are in: if we did not request it, say this leaf is alive (F16).
   *
   * It is a sibling that went deaf. Whoever answers will remove leaves from the account that did not signal, and this one, healthy, cannot go with it. The signal is encrypted in the epoch this device has: if it is itself behind, it does not pass as alive, and that is right.
   */
  #provarVida(channel: string): void {
    const grupo = this.#groups.get(channel)
    if (!grupo || estaRemovido(grupo)) return
    const pedido = this.#lugaresPedidosPorMim.get(channel)
    if (pedido !== undefined && Date.now() - pedido < REJOIN_TURN_MS * 20) return
    void this.#sinalDeAparelho(channel).catch(() => {})
  }

  /** A seat repair that failed where no one expects it. For diagnosis. */
  #falhaDeLugar(channel: string, qual: string, erro: unknown): void {
    const mensagem = erro instanceof Error ? erro.message : String(erro)
    this.emit("status", {
      detail: semEnderecos(`${channel}: ${qual} por atender (${mensagem})`),
      level: "error",
      code: "reseat-failed",
      route: "log",
      channel,
    })
  }

  /** When this device last answered a rejoin, per "channel|address". */
  #rejoinAnswered = new Map<string, number>()
  /**
   * Who was a member of each channel in the last epoch we saw. See `#noteMembership`.
   *
   * Used to keep only the leaf count, and the count does not tell "someone joined" from "the makeup changed". The `folhas` stays separate from `enderecos` because an account holds as many leaves as devices since 0.3.0, and the two counts stopped being the same thing.
   */
  #memberCounts = new Map<string, MembrosVistos>()

  /**
   * Answer somebody's rejoin request — unless another member gets there first.
   *
   * Every member of the channel receives the same request at the same moment,
   * and the old handler had all of them commit a remove-and-add immediately.
   * MLS accepts exactly one commit per epoch: the others are invalid, and any
   * device that had already applied a losing one is now on a group that shares
   * an id with its channel-mates and nothing else. That is a fork, and it is
   * silent: the room looks merely quiet, profiles never decrypt (so names fall
   * back to the raw address and avatars to an initial), and a friend drops out
   * of the circle. `!lagar-do-ze:orwell.pt` collected six welcomes for one
   * member inside one minute — which is what a rejoin request answered by
   * every member at once looks like from the server's side.
   *
   * So: members take turns in address order, and each one checks — after its
   * turn comes round — whether the epoch has already moved. If it has, someone
   * ahead in the queue has already seated them and there is nothing left to do.
   */
  async #answerRejoin(channel: string, address: string): Promise<void> {
    // One admission at a time PER CHANNEL. `#umaDeCadaVez` already serialized, but per person: two nearly simultaneous requests both entered here, read the same tree, and both committed over the same epoch. MLS accepts one; the other Welcome describes a group no one else has, and the person who gets it is alone in a room with the right name. Measured symptom: two requests, one usable invite.
    return this.#umaDeCadaVez(`rejoin|${channel}`, () => this.#answerRejoinAgora(channel, address))
  }

  async #answerRejoinAgora(channel: string, address: string): Promise<void> {
    const group = this.#groups.get(channel)
    if (!group) return
    if (address === this.identity.address) {
      // A sibling of ours. In channels with other people, those people re-seat him (and this leaf already gave proof of life, in `#onFrame`). In the account channel there is no one else: any leaf from the account that is there repairs it (I5). Except the echo of the request itself, which also reaches whoever asked: a deaf seat repairs nothing, and only wasted the brake of a repair for real (one from a sibling asking next). The echo is spent here, once.
      if (channel === this.canalDaConta) {
        const pedido = this.#lugaresPedidosPorMim.get(channel)
        if (pedido !== undefined && Date.now() - pedido < REJOIN_TURN_MS * 20) {
          this.#lugaresPedidosPorMim.delete(channel)
          return
        }
        await this.#repararCanalDaConta()
      }
      return
    }
    // A new seat in a personal channel to someone who blocked is a seat given. See `block`.
    if (this.#bloqueadoAqui(channel, address)) return

    // A reconnecting device asks once per session; several sessions in a row
    // must not each cost the channel a rekey.
    const key = `${channel}|${address}`
    const answered = this.#rejoinAnswered.get(key)
    if (answered !== undefined && Date.now() - answered < REJOIN_TURN_MS * 20) return

    const members = [...memberAddresses(group.state.ratchetTree).values()].map(String)

    // A rejoin repairs a seat; it does not grant one. Without this check the
    // path fell through to `#reseat`, which, finding no leaf to remove, simply
    // invited the caller in. One unauthenticated frame naming a feed id (derived
    // from any public address) was therefore enough to be seated in a private
    // channel by the first honest member online, permanently.
    //
    // `#admit` has carried the equivalent guard from the start, with a comment
    // calling its absence a complete break of the product's central promise.
    // The same reasoning applies here and the guard was simply missing.
    // A common room is open by definition: a new arrival is not yet a member,
    // and that is precisely why they are asking. In any other room this guard
    // applies, and it is what stops a frame in the thread from seating someone
    // who was never there.
    if (!members.includes(address) && channel !== this.#commonRoom) return

    // Position in the queue: how many members sort before us. Deterministic
    // and computed from the tree both sides already agree on, so no two
    // members claim the same turn.
    const turn = members.filter((member) => member !== address && member < this.identity.address).length
    const epochBefore = epochOf(group)
    /*
      With several leaves on the account, we expect at least a proof of life
      from the healthy devices on it (F16): this is what lets `#reseat` remove
      only the deaf leaf. With a single leaf, the wait is the usual one.
    */
    const folhasDaConta = leavesOf(group.state.ratchetTree, address as UserAddress).length
    const espera = Math.max(turn * REJOIN_TURN_MS, folhasDaConta > 1 ? Session.PROVA_DE_VIDA_MS : 0)
    if (espera > 0) await new Promise((resolve) => setTimeout(resolve, espera))

    const current = this.#groups.get(channel)
    if (!current) return
    // Somebody ahead of us committed while we waited. Their commit is the
    // repair; a second one on top of it would be the fork.
    if (epochOf(current) !== epochBefore) return

    /**
     * The throttle marks ADMISSIONS, not attempts.
     *
     * The timestamp was written on entry, before any work. A failed attempt,      * and they failed, because the person had not yet published key packages,      * closed the door for sixty seconds, and the next tries came at fifteen
     * and forty-five: both within the window, both discarded silently. The
     * first one that could be served was more than ninety seconds later.
     */
    await this.#reseat(channel, address)
    this.#rejoinAnswered.set(key, Date.now())
    /*
      The caller lost what was said to the dead leaf, and a reseat does not
      make the channel grow (one leaf goes out, another from the same account
      comes in), so the growth cascade does not run. What it needs most is the
      banner: with the opaque address (slice 3), the room name exists only in
      `space.meta`, and without it the room appeared with forty characters.
    */
    if (channel !== this.canalDaConta) {
      void this.republishAuthority(channel)
        .catch(() => {})
        .then(() => this.republishRooms(channel))
        .catch(() => {})
    }
  }

  /**
   * Community mode: everyone with an account here is a friend.
   *
   * The operator turned this on for a server whose users all know each other,
   * so the request/accept dance is pure friction. Idempotent by construction —
   * `seat` re-seats the inert and leaves the active alone — so it can run on
   * every connect without spending anybody's key packages needlessly.
   */
  async syncCommunity(): Promise<string[]> {
    // The one-shot bootstrap for the founding accounts, not a server mode: no
    // account list is ever requested, and this is inert everywhere else.
    const others = bootstrapPeersFor(this.identity.address)
    if (others.length === 0 || this.vault.contents.bootstrapDone === true) return others
    const feed = await this.ensureFeed()
    // "Done" means every one of them is demonstrably reading this feed —
    // nothing weaker. The flag used to be written unconditionally, right after
    // a loop that swallowed every failure: one peer offline or out of key
    // packages when this first ran, and the bootstrap was recorded as finished
    // with that friendship never made. It could then never run again, on any
    // connect, for ever. That is precisely how one founding account
    // never got a seat in another's feed.
    let complete = true
    for (const address of others) {
      try {
        // Through the rate limiter, not around it: an unfinished bootstrap now
        // retries on every connect, and without the brake that would claim a
        // key package per peer per reconnect from people who are not there.
        if ((await this.repairInvite(feed, address)) !== "live") complete = false
      } catch {
        // Out of key packages, or away: the next connect tries again.
        complete = false
      }
    }
    if (complete) {
      await this.vault.update((contents) => {
        contents.bootstrapDone = true
      })
    }
    return others
  }

  /**
   * Invite someone into a channel on the circle-repair path, at most once per
   * cooldown per pair.
   *
   * Key package lifecycle, stated once because it is the whole story here:
   * a pool of 20 is published at connect; an inviter CLAIMS one (server hands
   * it out and deletes it); the claim seals a welcome to that package; the
   * invitee JOINS with the matching private half and BURNS it locally. Every
   * repair attempt therefore spends one package of someone who may never be
   * online to top up — so unattended reconnects must not be allowed to drain
   * the pool. Returns false when the brake held.
   */
  async repairInvite(channel: string, address: string, force = false): Promise<RepairOutcome> {
    /*
      One at a time per (channel, person), and the throttle read inside (I7
      of the 2026-10-20 revision). The live connection has many triggers that
      can request the same repair at the same time (periodic reconciliation,
      presence lighting up, a Welcome, the direct becoming only): read out
      here, two saw the throttle open, each claimed packages and gave two
      leaves to the same account.
      */
    /*
      The manual (`force`) has its own queue (N8 of the revision): putting it
      together with the automatic one in progress returned "cooldown" or its
      outcome to whoever hit the button. It runs after the automatic one, and
      the `seat` inside does not recommit anyone who already got seated.
      */
    if (force) {
      const emCurso = this.#emCurso.get(`repair|${channel}|${address}`)
      return this.#umaDeCadaVez(`repair-manual|${channel}|${address}`, async () => {
        await emCurso?.catch(() => {})
        return this.#repairInviteAgora(channel, address, true)
      })
    }
    return this.#umaDeCadaVez(`repair|${channel}|${address}`, () => this.#repairInviteAgora(channel, address, force))
  }

  async #repairInviteAgora(channel: string, address: string, force: boolean): Promise<RepairOutcome> {
    // Before the throttle and the claim: fixing the seat of someone who blocked
    // costs nothing and is not recorded as an attempt. See `block`.
    if (this.#bloqueadoAqui(channel, address)) throw new Error("that person is blocked")
    // Manual repair always runs: the brake exists to protect someone else's
    // key packages from an unattended reconnect loop, not to make a person
    // sit out six hours after pressing a button.
    if (!force && !mayRepair(this.vault.contents.repairAttempts, address, channel)) return "cooldown"
    /*
      The attempt is recorded BEFORE the claim (I7). Recorded after, a
      reconciliation that died mid-way (connection drops, app closes) would
      have spent the package with no throttle at all, and the next one would
      spend another. What costs nothing (`live`, `unproven`) returns the old
      timestamp, to avoid throttling for no reason.
      */
    const chave = `${address}|${channel}`
    const anterior = this.vault.contents.repairAttempts[chave]
    await this.vault.update((contents) => {
      contents.repairAttempts[chave] = Date.now()
    })
    // `force` lifts the cooldown and nothing else. It used to jump straight to
    // `#reseat`, skipping the one check that tells a dead seat from a working
    // one — so pressing "Reparar" on a friend who was reading perfectly well
    // rekeyed the channel and took every earlier post away from them. The
    // person pressing the button is entitled to an attempt *now*; they are not
    // entitled to a verdict the cryptography contradicts.
    let outcome: RepairOutcome
    try {
      outcome = await this.seat(channel, address)
    } catch (error) {
      // A missing device with no packages is not the transient race of "the
      // account has no keys": it might never come back, and without a throttle
      // this repeated per friend on each connection, with three attempts and three
      // seconds wait each, forever. Counts as an attempt spent.
      if (!(error instanceof AparelhoSemChaves)) {
        // Failed without spending any package: the timestamp goes back to what it was (N1).
        if (this.#nadaSeGastou(error)) await this.#reporTravao(chave, anterior)
        throw error
      }
      outcome = "device-unreachable"
    }
    // Only what spent counts: `live` and `unproven` claimed nothing, and the
    // timestamp goes back to what it was. A `seat` that throws keeps the attempt
    // recorded, because it may have thrown after the claim.
    if (outcome !== "invited" && outcome !== "reseated" && outcome !== "device-unreachable") {
      await this.#reporTravao(chave, anterior)
    }
    return outcome
  }

  /**
   * If a seat failure is one that spent no package (N1 of the revision).
   *
   * Without a connection, the claim never left; without packages on the other
   * side, the server had nothing to give. In these two cases the six-hour
   * throttle protects nothing and only delays repair. An expired deadline is
   * different: the server may have served the package and the response got
   * lost, and there the timestamp stays.
   */
  #nadaSeGastou(erro: unknown): boolean {
    if (this.#connection !== "online") return true
    const mensagem = erro instanceof Error ? erro.message : ""
    return mensagem === "no connection to the server" || mensagem === "that person has no invite keys"
  }

  /** The timestamp of a throttle goes back to what it was before the attempt, or deleted if there was none. */
  async #reporTravao(chave: string, anterior: number | undefined): Promise<void> {
    await this.vault.update((contents) => {
      if (anterior === undefined) delete contents.repairAttempts[chave]
      else contents.repairAttempts[chave] = anterior
    })
  }

  /**
   * Everything this device can do, alone, about a channel it cannot read.
   *
   * Three acts, none of which needs the missing keys: forget the invitations
   * written off for this channel, ask the server to re-deliver whatever it
   * still holds, and tell the channel's members that this seat is dead. The
   * repair itself is somebody else's commit — this is the request for it.
   *
   * Deliberately not exposed to the interface. A button that asks a person to
   * repair their own membership is an admission that the system does not
   * converge on its own; this runs by itself, the moment the deafness detector
   * is sure, and nobody has to know it happened.
   */
  async repairChannel(channel: string): Promise<void> {
    await this.resyncWelcomes(channel)
    this.requestRejoin(channel)
  }

  /**
   * Ask the channel's members for a fresh seat, out of band.
   *
   * Used when this device can no longer decrypt a channel it belongs to —
   * the one situation the in-channel paths cannot express, because they all
   * require the very key material that is missing.
   */
  requestRejoin(channel: string): void {
    // Stored, so this device does not report as alive on its own request when the
    // echo of it arrives as `channel.rejoin`. See `#provarVida`.
    this.#lugaresPedidosPorMim.set(channel, Date.now())
    try {
      this.#send({ t: "channel.rejoin.request", channel })
    } catch {
      // Offline. The deafness detector asks again on the next connect.
    }
  }

  // ------------------------------------------------- sync with the live connection

  /**
   * How often reconciliation runs while the connection is open (F9).
   *
   * Until October 20, 2026 it only ran at connection time. A connection that
   * stayed open for days (a computer that never sleeps) would fix nothing during
   * those days: an accept that arrived via recovery, a paired device, a lost
   * place. Static for tests.
   */
  static SINCRONIA_MS = 10 * 60_000

  // ------------------------------------------------- anti-entropy (S4)
  //
  // Gate and hooks only. Logic is in `sincronia/pedido.ts`,
  // `sincronia/relato.ts`, `sincronia/eleicao.ts` and `sincronia/resumo.ts`.

  #antiEntropia: AntiEntropia | null = null

  /**
   * Off, this session sends no reports, answers no requests and applies no
   * telemetry: that is what a 0.5.7 client does. For tests that act as old
   * client, and for diagnostics. On by default.
   */
  antiEntropiaLigada = true

  /** Created the first time, because it needs the identity. */
  get #anti(): AntiEntropia {
    this.#antiEntropia ??= new AntiEntropia(this.#portaDaAntiEntropia())
    return this.#antiEntropia
  }

  /** The accounts linked now, by server presence. Memory only: the connection restarts it. */
  #presentes = new Set<string>()

  // ------------------------------------------- history across devices (1.0 "Arca")
  //
  // Bridge only. Rules are in `historico/historico.ts` and `historico/conteudo.ts`.

  #historicoDosIrmaos: HistoricoEntreAparelhos | null = null
  /** The verdict of the account's channel, stored one minute per epoch: the history clock asks every two seconds. */
  #contaConfiavelAte: { epoca: bigint; ate: number } | null = null
  /** The signal key of the account's channel, by epoch. */
  #chaveDoSinalDaConta: ChaveDoSinal | null = null

  get #historico(): HistoricoEntreAparelhos {
    this.#historicoDosIrmaos ??= new HistoricoEntreAparelhos(this.#portaDoHistorico())
    return this.#historicoDosIrmaos
  }

  /** The history that came from a sibling, now: for the interface to read it on open. */
  historicoEntreAparelhos(): EventoDoHistorico {
    if (!this.vault.unlocked || this.#identity === null) {
      return { aTrazer: false, feitas: 0, total: 0, media: null, canais: [], inicial: false }
    }
    return this.#historico.estado()
  }

  /** For tests: the numbers in the history thread. */
  get estatisticasDoHistorico(): HistoricoEntreAparelhos["estatisticas"] {
    return this.#historico.estatisticas
  }

  #portaDoHistorico(): PortaDoHistorico {
    const grupoDaConta = (): GroupSession | undefined => {
      const canal = this.canalDaConta
      return canal ? this.#groups.get(canal) : undefined
    }
    return {
      eu: () => this.#quemRelata(),
      conteudo: () => (this.vault.unlocked && this.#identity !== null ? this.vault.contents : null),
      canalDaConta: () => (this.#identity !== null ? this.canalDaConta : ""),
      contaPronta: async () => {
        const grupo = grupoDaConta()
        if (!grupo) return false
        const epoca = epochOf(grupo)
        const memoria = this.#contaConfiavelAte
        if (memoria && memoria.epoca === epoca && memoria.ate > Date.now()) return true
        const confiavel = (await this.#canalDaContaConfiavel()) !== null
        this.#contaConfiavelAte = confiavel ? { epoca, ate: Date.now() + 60_000 } : null
        return confiavel
      },
      folhasDaConta: () => {
        const grupo = grupoDaConta()
        if (!grupo) return []
        const arvore = grupo.state.ratchetTree
        const chaves: string[] = []
        for (const folha of leavesOf(arvore, this.identity.address as UserAddress)) {
          const chave = deviceKeyAtLeaf(arvore, folha)
          if (chave) chaves.push(toBase64(chave))
        }
        return chaves
      },
      derivarChave: async () => {
        const grupo = grupoDaConta()
        if (!grupo) return null
        const epoca = epochOf(grupo)
        if (this.#chaveDoSinalDaConta?.epoca === epoca) return this.#chaveDoSinalDaConta
        this.#chaveDoSinalDaConta = await derivarChaveDoSinal(grupo, this.canalDaConta)
        return this.#chaveDoSinalDaConta
      },
      podeSinalizar: () => this.#connection === "online" && this.#serverCapabilities.includes(CAPACIDADE_SINAL_EFEMERO),
      enviarSinal: (sinal, ref) => this.#send({ t: "channel.sinal", channel: this.canalDaConta, sinal, ref }),
      gravar: (mudar) => {
        if (!this.vault.unlocked) return
        mudar(this.vault.contents)
        this.#memoriaPorGravar = true
        this.#agendarGravacao()
      },
      temGrupo: (canal) => this.#groups.has(canal),
      bloqueado: (canal, autor) => autor !== this.identity.address && this.#bloqueadoAqui(canal, autor),
      lugar: (canal) => this.#lugarDaConta(canal),
      emitir: (evento) => this.emit("historico", evento),
      agora: () => Date.now(),
    }
  }

  /**
   * The first seat of the ACCOUNT in a channel, for a sibling: what came from
   * another sibling first (it is older than this device's), then this one's.
   * `null`: the account has had the channel from the start (founded it, or it
   * is a direct). `undefined`: unknown.
   */
  #lugarDaConta(canal: string): { seq: number; em: number } | null | undefined {
    const contents = this.vault.contents
    const doIrmao = contents.historico?.lugares
    if (doIrmao && Object.hasOwn(doIrmao, canal)) return doIrmao[canal] ?? null
    if (this.#eDirecta(canal) || contents.channelFounder[canal]?.address === this.identity.address) return null
    return (contents as unknown as CofreDaSincronia).sincronia?.lugares?.[canal]
  }

  #quemRelata(): QuemRelata {
    const identidade = this.identity
    return {
      address: identidade.address,
      aparelho: identidade.deviceSigningPublicKey,
      assinar: (mensagem) => signWithDevice(identidade, mensagem),
    }
  }

  /**
   * The chain of a device, by its leaf in this channel's tree: the ACCOUNT key
   * and the certificate it signed over the device. `null` if the author has no
   * leaf with this device (left, or never was here).
   */
  #cadeiaDeNoCanal(canal: string, autor: string, aparelho: string): { k: string; x: string } | null {
    const g = this.#groups.get(canal)
    if (!g) return null
    const arvore = g.state.ratchetTree
    for (const folha of leavesOf(arvore, autor as UserAddress)) {
      const credencial = credentialAtLeaf(arvore, folha)
      if (credencial && toBase64(credencial.deviceKey) === aparelho) {
        return { k: toBase64(credencial.accountKey), x: toBase64(credencial.signature) }
      }
    }
    return null
  }

  /**
   * The report, assembled from the vault and ready to show before leaving
   * (`docs/planos/denuncias-design.md`, §4.4 and §5).
   *
   * Reads vault entries as they are, not `history()`: `history()` removes the
   * mention of everyone who lacks the permission, and a changed payload no
   * longer matches the authorship the author signed. Moderation counts as in
   * the interface (`mayModerate`, by the sender of each tombstone).
   *
   * `temCopia` asks the server who the founder is (`#fundadorDaCopia`), the
   * `origin` (this account's server, by default). Without network, it is
   * `false`.
   *
   * Rejects with "this message cannot be reported" if the message is not in
   * the vault, is mine, was deleted by the author or removed by moderation.
   */
  async prepararDenuncia(alvo: AlvoDaDenuncia, origem = origemDoServidorDe(this.identity.address)): Promise<DenunciaPreparada> {
    const canal = alvo.canal
    const historico = entradasDoCanal(this.vault.contents, canal).filter((entrada) => !entrada.herdado)
    const preparada = construirDenuncia({
      canal,
      sala: alvo.sala,
      alvo,
      historico,
      eu: this.#quemRelata(),
      cadeiaDe: (autor, aparelho) => this.#cadeiaDeNoCanal(canal, autor, aparelho),
      modera: (quem) => this.mayModerate(canal, quem),
    })
    if (!preparada) throw new Error("this message cannot be reported", { cause: { channel: canal } })
    preparada.temCopia = (await this.#fundadorDaCopia(canal, preparada.denunciado, origem)) !== null
    return preparada
  }

  /**
   * The founder the copy goes to, and the account key to seal it, or `null`
   * if there is no copy (§6.2 and §9b). The server says who the founder is;
   * this device only refuses:
   *
   * - in a direct conversation (the "founder" is one of the two);
   * - with no server reply, or no founder (channel without owner, or founder
   *   no longer in the channel);
   * - when the founder is the reported or who reports;
   * - when the key is not the founder's address key, or does not match the
   *   credential of their leaf in this channel's tree, when they are there.
   *   A server that swapped the key would read the copy.
   */
  async #fundadorDaCopia(canal: string, denunciado: string, origem: string): Promise<{ fundador: string; chave: Uint8Array } | null> {
    if (this.#eDirecta(canal)) return null
    let resposta: { fundador: string | null; chaveDeConta: string | null }
    try {
      resposta = await pedirFundador(origem, this.identity, canal)
    } catch {
      return null
    }
    const { fundador, chaveDeConta } = resposta
    if (fundador === null || chaveDeConta === null) return null
    if (fundador === denunciado || fundador === this.identity.address) return null
    const chave = fromBase64(chaveDeConta)
    try {
      if (accountIdFromSigningKey(chave) !== parseAddress(fundador).localPart) return null
    } catch {
      return null
    }
    const g = this.#groups.get(canal)
    if (g) {
      const arvore = g.state.ratchetTree
      for (const folha of leavesOf(arvore, fundador as UserAddress)) {
        const credencial = credentialAtLeaf(arvore, folha)
        if (credencial && toBase64(credencial.accountKey) !== chaveDeConta) return null
      }
    }
    return { fundador, chave }
  }

  /**
   * Sends the prepared report, with the person's choice, to `origin` (the server
   * of this account). It goes to our copy (`itens`) and, when `#fundadorDaCopia`
   * allows it, to the sealed copy sent to the founder: without messages from
   * whoever reported, and from the time only the day (`conteudoDaCopia`). The
   * founder checks himself again here, and we do not rely on `temCopia` from
   * preparation. A copy that does not fit in the limit, or that does not seal
   * (an invalid key), does not go, and the report proceeds.
   *
   * For reason 1 we do not ask for a note or good faith (§9b, art. 16.º, n.º 2
   * of DSA): they go empty, whatever the interface sends.
   *
   * The founder's list is remade here from `itens`, and the `itensDoFundador`
   * that arrives is not read: in Electron the prepared one comes from the
   * renderer, which is not trusted, and a message from whoever reported put in
   * it would go to the founder.
   *
   * Throws with the keys from `enviarPedidoAssinado`.
   */
  async denunciar(preparada: DenunciaPreparada, escolha: EscolhaDaDenuncia, origem: string, versao: string): Promise<{ ok: true }> {
    const destino = await this.#fundadorDaCopia(preparada.canal, preparada.denunciado, origem)
    let copia: CopiaSelada | null = null
    if (destino) {
      const paraOFundador = { ...preparada, itensDoFundador: semAsMinhas(preparada.itens, this.identity.address) }
      try {
        copia = selarCopia(destino.chave, conteudoDaCopia(paraOFundador, escolha))
      } catch {
        // A key that does not seal (invalid, or low order): the copy falls, never
        // the report.
        copia = null
      }
    }
    const corpo = corpoDaDenuncia(preparada, escolha, versao, {
      fundador: copia && destino ? destino.fundador : null,
      copia,
    })
    return enviarDenuncia(origem, this.identity, corpo)
  }

  /**
   * Reads the report inbox of this account (`/_enclave/denuncia/caixa`).
   *
   * Copies open with the ACCOUNT key (`signingPrivateKey`), and come back with
   * the `conteudo`. On a device without it (paired), they come back sealed,
   * without `conteudo`, and are not marked seen: they stay on the server for
   * the device that has it. An opened copy, or one that does not open (tampered,
   * or from another account), is marked seen on the next request, and the server
   * deletes it. Decisions come back as they are, and are not marked seen here.
   *
   * The seen ids stay in the vault (`caixaVista`), not in memory: a restart
   * between the read and the next request doesn't bring the same copy again.
   *
   * Throws with the keys from `enviarPedidoAssinado`.
   */
  async lerCaixaDeDenuncias(origem = origemDoServidorDe(this.identity.address)): Promise<ItemDaCaixaLido[]> {
    const { ditos, lidos, vistos } = await this.#lerCaixaSemMarcar(origem)
    await this.vault.update((contents) => this.#marcarVistos(contents, ditos, vistos))
    return lidos
  }

  /**
   * The suspension notice of this account, read from `origin` (this account's
   * server), or `null` with no notice. By signed request: works without
   * gateway connection. Gives up after 10 s with "the server did not answer
   * in time"; other errors are from `lerSuspensao`.
   */
  avisoDeSuspensao(origem = origemDoServidorDe(this.identity.address)): Promise<AvisoDeSuspensao | null> {
    let prazo: ReturnType<typeof setTimeout> | undefined
    const esgotado = new Promise<never>((_, rejeitar) => {
      prazo = setTimeout(() => rejeitar(new Error("the server did not answer in time")), 10_000)
    })
    return Promise.race([lerSuspensao(origem, this.identity), esgotado]).finally(() => clearTimeout(prazo))
  }

  /**
   * Asks for review of this account's suspension, with the person's note, to
   * `origin` (this account's server). Throws with the keys from `pedirRevisao`.
   */
  pedirRevisao(nota: string, origem = origemDoServidorDe(this.identity.address)): Promise<{ ok: true }> {
    return pedirRevisao(origem, this.identity, nota)
  }

  /** The inbox read, without touching the vault: what we told the server, what came back, and what is left to tell. */
  async #lerCaixaSemMarcar(origem: string): Promise<{ ditos: string[]; lidos: ItemDaCaixaLido[]; vistos: string[] }> {
    const ditos = [...(this.vault.contents.caixaVista ?? [])]
    const itens = await lerCaixa(origem, this.identity, ditos)
    const chave = this.identity.signingPrivateKey
    const vistos: string[] = []
    const lidos = itens.map((item): ItemDaCaixaLido => {
      if (item.tipo !== "copia" || chave === undefined) return item
      vistos.push(item.id)
      return { ...item, conteudo: abrirCopia(chave, item) }
    })
    return { ditos, lidos, vistos }
  }

  /** Takes the ids already told to the server from the vault, and puts the ones seen now. The cap is from the request (200). */
  #marcarVistos(contents: VaultContents, ditos: readonly string[], vistos: readonly string[]): void {
    const jaDitos = new Set(ditos)
    const fica = (contents.caixaVista ?? []).filter((id) => !jaDitos.has(id))
    for (const id of vistos) if (!fica.includes(id)) fica.push(id)
    if (fica.length > 0) contents.caixaVista = fica.slice(-200)
    else delete contents.caixaVista
  }

  /**
   * Reads the inbox and stores in the vault the copies that arrived (§6.2):
   * each item verified on this device (`denunciaRecebidaDe`), the report in
   * `denuncias[canal]`, once per id. Store and mark as seen go in the same vault
   * write: an id is never marked as seen without the report stored. For each
   * channel with a new report, a status `denuncia-recebida` with the channel,
   * and nothing else.
   *
   * Decisions about reports this account made (art. 16.º, n.º 5 of DSA) go to
   * `denunciasFeitas`, once per id, in the same write that marks them as seen:
   * a decision is never told to the server without being stored. For each new
   * decision, a status `denuncia-decidida` with the `decisao` and nothing else
   * (not the number, not the channel, not facts).
   *
   * Runs 5 s after connecting and then every hour (`#armarCaixa`). One at a time:
   * asked while one is running, returns that one.
   *
   * Throws with the keys from `enviarPedidoAssinado`.
   */
  recolherDenuncias(origem = origemDoServidorDe(this.identity.address)): Promise<void> {
    if (this.#recolhaEmCurso) return this.#recolhaEmCurso
    const recolha = this.#recolher(origem).finally(() => {
      if (this.#recolhaEmCurso === recolha) this.#recolhaEmCurso = null
    })
    this.#recolhaEmCurso = recolha
    return recolha
  }

  async #recolher(origem: string): Promise<void> {
    const { ditos, lidos, vistos } = await this.#lerCaixaSemMarcar(origem)
    const novas: DenunciaRecebida[] = []
    for (const item of lidos) {
      if (item.tipo !== "copia" || !item.conteudo) continue
      const conteudo = item.conteudo
      novas.push(
        await denunciaRecebidaDe(item.id, conteudo, (autor, aparelho, cadeia) =>
          this.#aparelhoConfiavel(conteudo.canal, autor, aparelho, cadeia),
        ),
      )
    }
    // `#lerCaixaSemMarcar` marks only copies as seen: decisions are marked here,
    // in the same write that stores them.
    const decisoes = lidos.filter((item): item is Extract<ItemDaCaixaLido, { tipo: "decisao" }> => item.tipo === "decisao")
    const vistosAgora = [...vistos, ...decisoes.map((item) => item.id)]
    const canais = new Set<string>()
    const decididas: ("suspensa" | "sem-accao")[] = []
    const guardadas: DenunciaRecebida[] = []
    // Copies this device does not open (no account key): stay on the server for
    // the device that has it, and are only counted here.
    const porAbrir = lidos.filter((item) => item.tipo === "copia" && !item.conteudo)
    await this.vault.update((contents) => {
      for (const denuncia of novas) {
        const doCanal = (contents.denuncias ??= {})[denuncia.canal] ?? []
        if (doCanal.some((guardada) => guardada.id === denuncia.id)) continue
        contents.denuncias[denuncia.canal] = [...doCanal, denuncia]
        canais.add(denuncia.canal)
        guardadas.push(denuncia)
      }
      this.#contarPorAbrir(contents, porAbrir)
      for (const item of decisoes) {
        const feitas = (contents.denunciasFeitas ??= [])
        if (feitas.some((feita) => feita.numeroLocal === item.id)) continue
        feitas.push({ numeroLocal: item.id, canal: item.canal, dia: item.dia, decisao: item.decisao })
        decididas.push(item.decisao)
      }
      this.#marcarVistos(contents, ditos, vistosAgora)
    })
    for (const canal of canais) this.emit("status", { detail: "", code: "denuncia-recebida", channel: canal })
    for (const decisao of decididas) this.emit("status", { detail: "", code: "denuncia-decidida", decisao })
    // The ones this device opened go already open to siblings, by the account
    // channel: a paired device doesn't have the key to open them.
    for (const payload of payloadsDasDenuncias(guardadas)) this.#enviarEstado(payload)
  }

  /**
   * Rewrites `copiasPorAbrir` with the copies that the mailbox brought and this
   * device did not open, minus those that already arrived from a sibling.
   */
  #contarPorAbrir(contents: VaultContents, porAbrir: readonly ItemDaCaixaLido[]): void {
    const jaCa = new Set(Object.values(contents.denuncias ?? {}).flatMap((lista) => lista.map((d) => d.id)))
    const mapa: Record<string, string> = {}
    for (const item of porAbrir) if (!jaCa.has(item.id)) mapa[item.id] = item.canal
    if (Object.keys(mapa).length > 0) contents.copiasPorAbrir = mapa
    else delete contents.copiasPorAbrir
  }

  /**
   * How many copies of this channel are on the server waiting for the device with the
   * account key. Only on a paired device does it rise above zero. From the vault.
   */
  denunciasPorAbrir(canal: string): number {
    return Object.values(this.vault.contents.copiasPorAbrir ?? {}).filter((de) => de === canal).length
  }

  /** Reports stored for a channel, most recent first. Copies: readers do not modify the vault. */
  denunciasDe(canal: string): DenunciaRecebida[] {
    return structuredClone(this.vault.contents.denuncias?.[canal] ?? []).reverse()
  }

  /** Mark a report as read. A non-existent id does nothing. */
  async marcarDenunciaLida(id: string): Promise<void> {
    const porCanal = this.vault.contents.denuncias ?? {}
    const canal = Object.keys(porCanal).find((c) => porCanal[c]!.some((d) => d.id === id && !d.lida))
    if (canal === undefined) return
    await this.vault.update((contents) => {
      for (const denuncia of contents.denuncias?.[canal] ?? []) if (denuncia.id === id) denuncia.lida = true
    })
  }

  /** When the mailbox first syncs after startup. */
  static CAIXA_PRIMEIRA_MS = 5_000
  /** And then, how often. */
  static CAIXA_MS = 60 * 60_000

  #armarCaixa(): void {
    this.#desarmarCaixa()
    const ler = (): void => {
      if (this.#connection !== "online") return
      // A failed sync retries at the next interval; it logs the error message only,
      // so a mailbox that never syncs does not go silent.
      void this.recolherDenuncias().catch((error: unknown) => {
        this.emit("status", {
          detail: error instanceof Error ? error.message : "erro desconhecido",
          level: "error",
          code: "denuncia-caixa-falhou",
          route: "log",
        })
      })
    }
    this.#caixaPrimeira = soltar(setTimeout(ler, Session.CAIXA_PRIMEIRA_MS))
    this.#caixaRelogio = soltar(setInterval(ler, Session.CAIXA_MS))
  }

  #desarmarCaixa(): void {
    if (this.#caixaPrimeira !== null) clearTimeout(this.#caixaPrimeira)
    if (this.#caixaRelogio !== null) clearInterval(this.#caixaRelogio)
    this.#caixaPrimeira = null
    this.#caixaRelogio = null
  }

  #portaDaAntiEntropia(): PortaDaAntiEntropia {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const sessao = this
    const grupo = (canal: string): GroupSession | undefined => this.#groups.get(canal)
    return {
      get eu() {
        return sessao.#quemRelata()
      },
      conteudo: () => this.vault.contents,
      podeSinalizar: () => this.#connection === "online" && this.#serverCapabilities.includes(CAPACIDADE_SINAL_EFEMERO),
      elegivel: (canal) => {
        const g = grupo(canal)
        return this.antiEntropiaLigada && canal !== this.canalDaConta && g !== undefined && !estaRemovido(g)
      },
      ehDirecta: (canal) => this.#eDirecta(canal),
      membros: (canal) => this.membersOf(canal).map(String),
      folhas: (canal) => {
        const g = grupo(canal)
        if (!g) return []
        const arvore = g.state.ratchetTree
        const folhas = []
        for (const [indice, address] of memberAddresses(arvore)) {
          const chave = deviceKeyAtLeaf(arvore, indice)
          if (chave) folhas.push({ indice, address: String(address), aparelho: toBase64(chave) })
        }
        return folhas
      },
      epocaAtual: (canal) => {
        const g = grupo(canal)
        return g ? epochOf(g) : undefined
      },
      derivarChave: async (canal) => {
        const g = grupo(canal)
        return g ? derivarChaveDoSinal(g, canal) : null
      },
      lugar: (canal) => this.#lugarParaSincronia(canal),
      ancora: (canal) => this.vault.contents.lastSeq[canal] ?? -1,
      enviarSinal: (canal, sinal, ref) => this.#send({ t: "channel.sinal", channel: canal, sinal, ref }),
      enviarRelatos: async (canal, relatos) => {
        await this.send(canal, { t: "typing", until: 0, relatos })
      },
      gravarRelatado: (canal, seq, autor, payload) => this.#gravarRelatado(canal, seq, autor, payload),
      escoar: () => this.flush(),
      marcarParaGravar: () => {
        this.#memoriaPorGravar = true
        this.#agendarGravacao()
      },
      aparelhoConfiavel: (canal, autor, aparelho, cadeia) => this.#aparelhoConfiavel(canal, autor, aparelho, cadeia),
      cadeiaDe: (canal, autor, aparelho) => this.#cadeiaDeNoCanal(canal, autor, aparelho),
      bloqueado: (canal, autor) => autor !== this.identity.address && this.#bloqueadoAqui(canal, autor),
      online: (address) => this.#presentes.has(address),
      agora: () => Date.now(),
      gravarAnexo: (canal, autor, alvo, indice, anexo) => this.#gravarAnexo(canal, autor, alvo, indice, anexo),
      bytesDoVideo: (sha) => this.#videos.bytes(sha),
      servirVideo: (canal, sha, q, vez) => this.#videos.servir(canal, sha, q, vez),
      esperarVideo: (canal, anexo) => this.#videos.esperar(canal, [anexo]),
      aoMudar: (canal) => {
        if (canal === this.canalDaConta || !this.#groups.has(canal)) return
        this.emit("sincronia", this.#anti.estadoDoCanal(canal))
      },
      // Profiles to third parties, only in the common room (3/11/2026). See `#pedirPerfisNaSalaComum`.
      perfisATerceiros: (canal) => canal === this.#commonRoom,
      perfisParaRelatar: (canal, contas) => perfisParaRelatar(this.vault.contents, canal, contas, this.identity.address),
      republicarPerfil: (canal) => {
        if (!this.#podeAgora(this.#perfisRepublicadosAPedido, canal, Session.PEDIDO_DE_PERFIS_MS)) return
        void this.publishProfile([canal], true).catch(() => {})
      },
      aoPerfisRelatados: (_canal, perfis) => {
        // Without the portrait bytes it is `parcial`, like the Welcome portrait: has the name, missing the photo.
        const leves = perfis.filter((perfil) => perfil.leve)
        if (leves.length > 0 && this.vault.unlocked) {
          for (const { autor, versao } of leves) {
            const guardado = this.vault.contents.directory[autor]
            if (guardado && guardado.payload["updatedAt"] === versao) this.vault.contents.directory[autor] = { ...guardado, parcial: true }
          }
          this.#memoriaPorGravar = true
          this.#agendarGravacao()
        }
        this.emit("perfis", { enderecos: perfis.map((perfil) => perfil.autor) })
      },
    }
  }

  /** When this device published its profile in the common room at someone's request. Memory only. */
  #perfisRepublicadosAPedido = new Map<string, number>()

  /**
   * Request the missing names in the common room (3/11/2026).
   *
   * Someone entering through the common room gate (the card) does not receive a portrait, and whoever
   * was offline when the account entered never gets told the name: a new account
   * saw "No name" for everyone who was not online. We ask those there
   * (`pedirPerfis` in anti-entropy): one responds with the profiles that the
   * authors signed, and those on the list who are online publish their own.
   *
   * A little after entering or coming online, and with some randomness: the
   * profiles that online members republish as the room grows arrive first, and in a
   * wave of accounts logging in at the same time each answered request heals also
   * the others, who read it before their turn. That heals the accounts that are ALREADY
   * without a name: each updated client requests it on login.
   */
  #pedirPerfisNaSalaComum(): void {
    const sala = this.#commonRoom
    if (!sala || this.#pedidoDePerfisNaSalaComum !== null) return
    const espera = Session.ESPERA_DO_PEDIDO_DE_PERFIS_MS + Math.random() * Session.ACASO_DO_PEDIDO_DE_PERFIS_MS
    this.#pedidoDePerfisNaSalaComum = setTimeout(() => {
      this.#pedidoDePerfisNaSalaComum = null
      if (this.#connection !== "online" || !this.vault.unlocked || !this.#groups.has(sala)) return
      const eu = this.identity.address
      const diretorio = this.vault.contents.directory
      const semNome = [...new Set(this.membersOf(sala).map(String))].filter(
        (conta) => conta !== eu && !diretorio[conta]?.payload["displayName"],
      )
      if (semNome.length > 0) void this.#anti.pedirPerfis(sala, semNome).catch(() => {})
    }, espera)
  }

  #pedidoDePerfisNaSalaComum: ReturnType<typeof setTimeout> | null = null

  /** Before requesting common room names, plus randomness on top. Static for tests. */
  static ESPERA_DO_PEDIDO_DE_PERFIS_MS = 5_000
  static ACASO_DO_PEDIDO_DE_PERFIS_MS = 10_000

  /**
   * The bytes of a requested attachment, already verified against authorship (S5, §5.4):
   * in place of the marker, in the vault. The vault average budget still applies:
   * if space runs short, the next eviction picks the oldest.
   */
  async #gravarAnexo(canal: string, autor: string, alvo: string, indice: number, anexo: Record<string, unknown>): Promise<void> {
    await this.vault.update((contents) => {
      for (const entrada of entradasDoCanal(contents, canal)) {
        if (entrada.sender !== autor || entrada.payload["id"] !== alvo) continue
        const novo = comAnexo(entrada.payload, indice, anexo)
        if (novo) entrada.payload = novo as typeof entrada.payload
      }
    })
  }

  // ------------------------------------------------- video from publications
  //
  // Bridge only. Rules are in `videos.ts`, and the format in `video.ts`
  // of the protocol.

  #videosDaSessao: VideosDaSessao | null = null

  get #videos(): VideosDaSessao {
    this.#videosDaSessao ??= new VideosDaSessao({
      conteudo: () => this.vault.contents,
      guardarNoCofre: async (sha, b64) => {
        let ficou = false
        await this.vault.update((contents) => {
          ficou = guardarVideo(contents, sha, b64, Date.now())
        })
        return ficou
      },
      apagarDoCofre: async (sha) => {
        if (videoNoCofre(this.vault.contents, sha) === null) return
        await this.vault.update((contents) => {
          apagarVideo(contents, sha)
        })
      },
      enviarParte: (canal, video) => this.send(canal, { t: "typing", until: 0, video }),
      emitir: (evento) => this.emit("video", evento),
      aoChegar: (canal, sha, completo, aparelho) => this.#antiEntropia?.aoVideo(canal, sha, completo, aparelho),
    })
    return this.#videosDaSessao
  }

  /**
   * Publish with a video: the publication first (with the thumbnail, which everyone
   * sees right away), then the chunks. Returns the publication `id`.
   *
   * One upload at a time: with another in progress, throws `ERROS_DO_VIDEO.ocupado`
   * before publishing. Cancelled or failed mid-way, same thing: the
   * publication is deleted, bytes leave memory and vault, and the error propagates
   * (`cancelado` or `falhou`, with the original error in `cause`). A publication
   * without all its bytes is useless to everyone, and retrying would create another.
   */
  async publicarVideo(caption: string, tags: string[], extras: PostExtras, video: VideoAPublicar): Promise<string> {
    if (this.#publicandoVideo || this.#videos.aEnviar) throw new Error("a video upload is already in progress")
    /*
      Set before the first `await`: `aEnviar` only flips inside
      `enviarPartes`, after `preparar` and `post`. Two successive calls would
      both pass; the second would publish, fail on chunks and `esquecer`
      it would delete bytes from the upload in progress, if the file was the same.
    */
    this.#publicandoVideo = true
    try {
      return await this.#publicarVideo(caption, tags, extras, video)
    } finally {
      this.#publicandoVideo = false
    }
  }

  #publicandoVideo = false

  async #publicarVideo(caption: string, tags: string[], extras: PostExtras, video: VideoAPublicar): Promise<string> {
    const { anexo, sha } = await this.#videos.preparar(video)
    let feed: string
    let id: string
    try {
      feed = await this.ensureFeed()
      id = await this.post(caption, tags, { ...extras, media: [...(extras.media ?? []), anexo] })
    } catch (erro) {
      // The publication never went out: the bytes that `preparar` saved are useless to anyone. Bytes from another live publication remain.
      if (!videoEmUso(this.vault.contents, sha)) await this.#videos.esquecer(sha)
      throw erro
    }
    try {
      await this.#videos.enviarPartes(feed, sha)
    } catch (erro) {
      await this.#videos.esquecer(sha)
      await this.deletePost(id).catch(() => {})
      if (erro instanceof Error && erro.message === ERROS_DO_VIDEO.cancelado) throw erro
      throw new Error("the video upload failed", { cause: { erro: erro instanceof Error ? erro.message : String(erro) } })
    }
    return id
  }

  /**
   * A publication was deleted by its author: the videos in it that no other
   * live publication uses leave memory and vault. The publication may still
   * be waiting on save (deleted right after publishing).
   */
  #largarVideosDe(channel: string, sender: string, target: string): void {
    const shas = new Set<string>()
    const juntar = (entrada: { sender: string; payload: { t: string; [chave: string]: unknown } }): void => {
      if (entrada.sender !== sender || entrada.payload.t !== "post" || entrada.payload["id"] !== target) return
      for (const sha of resumosDosVideos(entrada.payload["media"])) shas.add(sha)
    }
    for (const entrada of entradasDoCanal(this.vault.contents, channel)) juntar(entrada)
    for (const pendente of this.#pendingHistory) if (pendente.channel === channel) juntar(pendente.entry)
    if (shas.size > 0) void this.#videos.largarDaPublicacao(channel, target, [...shas])
  }

  /** Cancel the current video upload. Says whether there was one. */
  cancelarEnvioDeVideo(): boolean {
    return this.#videos.cancelarEnvio()
  }

  /** What this device has of a video, by summary. */
  estadoDoVideo(sha: string): EstadoDoVideo {
    return this.#videos.estado(sha)
  }

  /** The bytes of a video (from memory or vault), or `null`. */
  bytesDoVideo(sha: string): Uint8Array | null {
    return this.#videos.bytes(sha)
  }

  // ------------------------------------------------- snapshot and interface (S5)

  /**
   * This device's first place in a channel (§2.5): the `seq` of the Welcome that
   * seated us and the server time of that commit. `null` for whoever founded the channel,
   * for the account channel, for direct messages, and for a channel from before this version (the vault did not
   * save the time): the interface does not mark what it does not know.
   */
  lugarEm(channel: string): { seq: number; em: number } | null {
    // In a direct message both talk from the start: there is no "you entered here".
    if (channel === this.canalDaConta || this.#eDirecta(channel)) return null
    /*
      The history that came from a sibling brings the conversation from before
      this device's place: the marker becomes the account's (the sibling's), or none.
    */
    const doIrmao = this.vault.contents.historico?.lugares
    if (doIrmao && Object.hasOwn(doIrmao, channel)) return doIrmao[channel] ?? null
    return (this.vault.contents as unknown as CofreDaSincronia).sincronia?.lugares?.[channel] ?? null
  }

  /** The sync state of each channel (except the account one), for Diagnostics. */
  estadoDaSincronia(): SincroniaDoCanal[] {
    return this.channels.filter((canal) => canal !== this.canalDaConta).map((canal) => this.#anti.estadoDoCanal(canal))
  }

  /**
   * Request the bytes of an attachment that this device only has by name (§5.4). `alvo`
   * is the `id` of the message or publication, `indice` the position of the attachment (in
   * `attachments`, or in `media` of a publication). Never throws.
   */
  pedirAnexo(channel: string, alvo: string, indice: number): Promise<DesfechoDoAnexo> {
    if (this.#connection !== "online") return Promise.resolve({ ok: false, motivo: "sem-ligacao" })
    return this.#anti.pedirAnexo(channel, alvo, indice).catch((): DesfechoDoAnexo => ({ ok: false, motivo: "ninguem" }))
  }

  /** Give up on an attachment request (waiting in queue, or running). Says whether there was one. */
  cancelarAnexo(channel: string, alvo: string, indice: number): boolean {
    return this.#anti.cancelarAnexo(channel, alvo, indice)
  }

  /** For tests: the snapshot of this channel is still being requested. */
  instantaneoPorPedir(channel: string): boolean {
    return this.#anti.instantaneoPorPedir(channel)
  }

  /** Save this device's first place in a channel (see `lugarEm`). Only if not already set. */
  #guardarLugar(channel: string, seq: number, em: number): void {
    const cofre = this.vault.contents as unknown as CofreDaSincronia
    cofre.sincronia ??= {}
    if (cofre.sincronia.lugares?.[channel] !== undefined) return
    cofre.sincronia.lugares = { ...cofre.sincronia.lugares, [channel]: { seq, em } }
  }

  /**
   * This device's place in a channel, for the place rule (§5.3): the `seq` of the
   * Welcome that seated us. Founders have everything (-1). No record (old vault, Welcome without `seq`),
   * the first `seq` we have: erring stays on the side of not receiving.
   */
  #lugarParaSincronia(canal: string): number {
    const contents = this.vault.contents
    const lugar = contents.seatSince?.[canal]
    if (lugar !== undefined) return lugar
    if (contents.channelFounder[canal]?.address === this.identity.address) return -1
    let menor = Number.POSITIVE_INFINITY
    for (const entrada of entradasDoCanal(contents, canal)) if (entrada.seq >= 0 && entrada.seq < menor) menor = entrada.seq
    return Number.isFinite(menor) ? menor : (contents.lastSeq[canal] ?? -1)
  }

  /**
   * A report that was verified, saved as if from the server: with the
   * author and source `seq`, by the same `#recordPayload` (the checks from the
   * sender run there, against the author).
   */
  #gravarRelatado(canal: string, seq: number, autor: string, payload: Payload): void {
    /*
      A source `seq` that another event already holds in this vault: the server
      gave it twice (lost the end of the table, or came back from a backup, and
      `MAX(seq) + 1` repeated numbers). Saved without it, with the order mark
      just before it.
    */
    const ocupado = seq >= 0 && entradasDoCanal(this.vault.contents, canal).some((entrada) => entrada.seq === seq)
    const antes = this.#pendingHistory.length
    if (ocupado) this.#recordPayload(canal, -1, autor, payload, seq - 1)
    else this.#recordPayload(canal, seq, autor, payload)
    /*
      Marked as reported: a report's `seq` is not signed, and the
      server event with that `seq` (a gap that recovery fills later)
      wins it in the vault (`cederSeqRelatado`, in `vault.ts`).
    */
    for (let i = antes; i < this.#pendingHistory.length; i++) this.#pendingHistory[i]!.entry.relatada = true
    // The author sent nothing now: a report does not prove their place works.
    this.#pendingTransmitters.pop()
    this.emit("message", { channel: canal, seq, sender: autor as UserAddress, payload: this.#comMencoesConferidas(canal, autor, payload) })
  }

  /**
   * Whether this device speaks for this account, for a report (§4.1): not revoked,
   * and in the tree of this channel with this account, or with the chain closed and the
   * manifest READ listing them (`aparelhoPeloManifesto`). An account without
   * a manifest counts by the chain; a manifest that could not be read, does not.
   */
  async #aparelhoConfiavel(canal: string, autor: string, aparelho: string, cadeia: { k?: string; x?: string }): Promise<boolean> {
    if (estaRevogado(this.vault.contents, autor, aparelho)) return false
    const g = this.#groups.get(canal)
    if (g) {
      const arvore = g.state.ratchetTree
      for (const folha of leavesOf(arvore, autor as UserAddress)) {
        const chave = deviceKeyAtLeaf(arvore, folha)
        if (chave && toBase64(chave) === aparelho) return true
      }
    }
    if (!cadeia.k || !cadeia.x) return false
    let fecha = false
    try {
      fecha = verifyDeviceChain({
        address: autor,
        accountKey: fromBase64(cadeia.k),
        deviceKey: fromBase64(aparelho),
        signature: fromBase64(cadeia.x),
      })
    } catch {
      fecha = false
    }
    if (!fecha) return false
    return aparelhoPeloManifesto(await this.#leituraDoManifesto(autor), aparelho)
  }

  /**
   * The manifest of an account, telling if it was read. `#manifestoPara` returns `null` both
   * for "does not exist" and "did not read"; only what was read stays remembered, and that is how
   * they are told apart. No bundles on the server means no manifest to read.
   */
  async #leituraDoManifesto(address: string): Promise<{ lido: boolean; manifesto: DeviceManifest | null }> {
    if (!this.suportaBundle) return { lido: true, manifesto: null }
    await this.#manifestoPara(address)
    const lembrado = this.#manifestosRecentes.get(address)
    if (lembrado === undefined || Date.now() - lembrado.em >= MANIFESTO_LEMBRADO_MS) return { lido: false, manifesto: null }
    return { lido: true, manifesto: lembrado.manifesto }
  }

  /** Diagnostics (§8.2): the level 0 summary of this device, in the window `desde` (by default, our place). */
  resumoDoCanal(canal: string, desde?: number): ResumoNivel0 {
    return this.#anti.resumoDoCanal(canal, desde)
  }

  /** Diagnostics: what anti-entropy sent, received and refused this session. */
  get estatisticasDaSincronia(): EstatisticasDaSincronia {
    return this.#anti.estatisticas
  }

  /** Report the summary of a channel now, outside the triggers (the benchmark script and tests). */
  async anunciarResumo(canal: string): Promise<boolean> {
    return this.#anti.enviarResumo(canal)
  }

  /** The reconciliation clock, armed while there is a connection. */
  #relogioDeSincronia: ReturnType<typeof setInterval> | null = null
  /** When the last full pass ran, to avoid repeating it right away when returning to the foreground. */
  #ultimaSincronia = 0
  /** One pass at a time. */
  #sincroniaEmCurso: Promise<void> | null = null
  /** When we repaired each pair for their presence to light up. See `REPARAR_PAR_MS`. */
  #presencasReparadas = new Map<string, number>()
  /** When we asked for a seat in each channel, to avoid asking twice in the same minute. */
  #lugaresPedidos = new Map<string, number>()
  /**
   * This connection's invite keys are already on the server.
   *
   * Asking for a seat before that means asking the responder to spend a key package
   * we don't have: the Welcome that came would die like the last one. `#handshake`
   * turns this on after restoring the keys; the connection drop turns it off.
   */
  #chavesProntas = false

  /** Arm the reconciliation clock. Disarms the previous one, if any. */
  #armarSincronia(): void {
    this.#desarmarSincronia()
    this.#relogioDeSincronia = setInterval(() => {
      if (this.#connection !== "online") return
      void this.#sincronizar().catch(() => {})
    }, Session.SINCRONIA_MS)
  }

  #desarmarSincronia(): void {
    if (this.#relogioDeSincronia === null) return
    clearInterval(this.#relogioDeSincronia)
    this.#relogioDeSincronia = null
  }

  /**
   * One full reconciliation pass: friendships, invites, seats, devices.
   *
   * Everything here has its own throttle, and that's why it can run every ten
   * minutes: `repairInvite` doesn't spend anyone's key packages more than once
   * in six hours per channel, and who's already reading isn't touched. One at a
   * time: two passes in parallel would claim the same package twice.
   */
  async #sincronizar(): Promise<void> {
    /*
      If requested while one is running, another runs after, and only one. The one
      running may have read the vault before what triggered this request (for example,
      `#backfillMissed` finishing), and returning its promise would lose that reason.
      Multiple requests during the same pass yield one.
    */
    if (this.#sincroniaEmCurso) {
      this.#sincronizarDeNovo = true
      return this.#sincroniaEmCurso
    }
    const passagem = (async () => {
      do {
        this.#sincronizarDeNovo = false
        this.#ultimaSincronia = Date.now()
        await this.syncFriendships().catch(() => {})
        await this.syncChannelInvites().catch(() => {})
        this.#pedirLugares(null)
        await this.#assentarAparelhosEmFalta().catch(() => {})
        await this.#cuidarDoCanalDaConta().catch(() => {})
        // S1: announce the resend where it's missing, tell again what is ours to
        // whoever arrived, and ask for profiles of whoever shows up without a name (F10).
        await this.#anunciarReenvioEmFalta().catch(() => {})
        await this.#reenviarOndeFaltar().catch(() => {})
        await this.#pedirPerfisEmFalta().catch(() => {})
        this.#pedirPerfisNaSalaComum()
        // S4: the summary of the chosen one, where there were events since the last time.
        await this.#anti.aPassagem([...this.#groups.keys()]).catch(() => {})
      } while (this.#sincronizarDeNovo && this.#connection === "online")
    })()
    this.#sincroniaEmCurso = passagem
    try {
      await passagem
    } finally {
      this.#sincroniaEmCurso = null
    }
  }

  /** A pass requested while another was running. See `#sincronizar`. */
  #sincronizarDeNovo = false

  /**
   * Run reconciliation now, by caller priority.
   *
   * For returning to the foreground, when the bridge can report it. Today the one
   * who says it is `setVisible(true)`, which is the closest the interface gets.
   */
  async sincronizarAgora(): Promise<void> {
    if (this.#connection !== "online") return
    await this.#sincronizar()
  }

  /**
   * Someone's presence lit up: repair what we owe them, only them (F9).
   *
   * This is when repair can succeed: the Welcome we send them opens now, and the
   * seat request we make has someone to answer it. Once per person every ten
   * minutes, so a flickering presence doesn't pay a repair per flicker.
   */
  #aoVerOnline(address: string): void {
    if (address === this.identity.address || this.#connection !== "online") return
    // Anti-entropy (S4) has its own caps; the repair below is what has the ten-minute throttle.
    void this.#anti.aoVerOnline(address, [...this.#groups.keys()]).catch(() => {})
    if (!this.#podeAgora(this.#presencasReparadas, address, REPARAR_PAR_MS)) return
    void this.#reconciliarAmizades(address).catch(() => {})
    this.#pedirLugares(address)
  }

  /**
   * Ask for a seat in each channel where we lost it (F3).
   *
   * Two sources. Channels from `lugaresPorPedir`, where a Welcome died and no
   * other came. And feeds of friends we don't have a group with: the friendship
   * says we should be there, and the seat either never opened or was lost. The
   * server only passes the request from who has a seat there or a Welcome to open
   * (`#mayAsk`), and whoever answers only reseats who is in the tree (`#answerRejoinAgora`):
   * asking where you shouldn't is a discarded frame, nothing more.
   *
   * `soPar` limits to that person's channels: the direct with them and their feed.
   */
  #pedirLugares(soPar: string | null): void {
    if (!this.vault.unlocked) return
    const canais = new Set<string>()
    const agora = Date.now()
    const guardados = this.vault.contents.lugaresPorPedir ?? {}
    // Only what CHANGES, and what leaves: the rest stays as `update` finds it (N5).
    const proximos: Record<string, LugarPorPedir> = {}
    const expirados: string[] = []
    let mudou = false
    for (const [canal, bruto] of Object.entries(guardados)) {
      // A vault from version 1 of this stored only the time. Read it as a first attempt.
      const lugar: LugarPorPedir = typeof bruto === "number" ? { desde: bruto, tentativas: 0, proxima: 0 } : bruto
      /*
        Thirty days and done (M1): the server's retention already removed the Welcome
        that gave the right to ask, and asking forever was a frame refused on each
        connection of each device.
      */
      if (agora - lugar.desde > LUGAR_POR_PEDIR_MS || this.#groups.has(canal)) {
        expirados.push(canal)
        mudou = true
        continue
      }
      if (soPar !== null && this.#parDoCanal(canal) !== soPar && this.#donoDoFeed(canal) !== soPar) continue
      /*
        And spaced out (M1): one minute, two, four, up to six hours between requests.
        The peer's presence lighting up overrides this (`soPar`), because that's
        where the request has someone to answer it.
      */
      if (soPar === null && agora < lugar.proxima) continue
      canais.add(canal)
      proximos[canal] = {
        desde: lugar.desde,
        tentativas: lugar.tentativas + 1,
        proxima: agora + Math.min(60_000 * 2 ** lugar.tentativas, 6 * 60 * 60_000),
      }
      mudou = true
    }
    if (mudou) {
      void this.vault
        .update((contents) => {
          /*
            Merged WITHIN the write, not replaced (N5 of the revision): a Welcome that
            dies between the read above and this write stores its seat in the middle,
            and replacing the whole map would erase it.
          */
          const fundido = { ...contents.lugaresPorPedir, ...proximos }
          for (const canal of expirados) delete fundido[canal]
          contents.lugaresPorPedir = fundido
        })
        .catch(() => {})
    }
    for (const amigo of this.#amigosVivos()) {
      if (soPar !== null && amigo !== soPar) continue
      const feed = this.#feedDe(amigo)
      if (feed && !this.#groups.has(feed)) canais.add(feed)
    }
    for (const canal of canais) this.#pedirLugar(canal)
  }

  /** A seat request, at most one per channel per minute. */
  #pedirLugar(channel: string): void {
    if (!this.#podeAgora(this.#lugaresPedidos, channel, REJOIN_TURN_MS * 20)) return
    this.requestRejoin(channel)
  }

  /**
   * Give seats to devices missing in channels that already exist (F6, 20/10/2026).
   *
   * Pairing seats the new device in channels that existed then (`#assentarAparelho`).
   * A channel or direct created AFTER only had the device that created it, and the
   * mobile never saw them. This runs after creating a channel (just that one) and in
   * each reconciliation pass (all).
   *
   * Only our address: the peer seats their own devices. The check is `#haLugarPorDar`,
   * which only goes to the server for a manifest, and the manifest is remembered
   * (`#manifestoPara`).
   */
  async #assentarAparelhosEmFalta(soCanal?: string): Promise<void> {
    if (!this.suportaBundle) return
    const eu = this.identity.address
    const meuAparelho = toBase64(this.identity.deviceSigningPublicKey)
    const canais = soCanal !== undefined ? [soCanal] : [...this.#groups.keys()]
    for (const canal of canais) {
      if (canal === this.#commonRoom) continue
      // The account channel only takes devices that announced themselves: it's
      // `#cuidarDoCanalDaConta` that invites them, and a 0.5.7 leaf stays out.
      if (canal === this.canalDaConta) continue
      const grupo = this.#groups.get(canal)
      if (!grupo || estaRemovido(grupo)) continue
      /*
        Only OUR devices (I8 of the revision). A direct's peer seats their own devices,
        running this on their side: two seating the same device spent two packages and
        gave two leaves.

        With a throttle: the same `repairAttempts` as the repair, with its own key,
        six hours per (account, channel). A device that never connects has no packages
        on the server, and without throttle each pass spent three claims per channel.
      */
      const chaveDoTravao = `${canal}|aparelho`
      if (!mayRepair(this.vault.contents.repairAttempts, eu, chaveDoTravao)) continue
      try {
        if (!(await this.#haLugarPorDar(grupo, eu))) continue
        /*
          Among devices of the same account, the turn goes by device key order,
          like in `#honrarSaidaAgora`: who's first seats and the others, seeing the
          epoch change, do nothing. Without this the PC and laptop seat the same
          mobile at the same time.
        */
        const arvore = grupo.state.ratchetTree
        const irmaos = leavesOf(arvore, eu as UserAddress)
          .map((folha) => deviceKeyAtLeaf(arvore, folha))
          .filter((chave): chave is Uint8Array => chave !== undefined)
          .map((chave) => toBase64(chave))
        const vez = irmaos.filter((chave) => chave < meuAparelho).length
        if (vez > 0) {
          const epocaAntes = epochOf(grupo)
          await new Promise((resolve) => setTimeout(resolve, vez * REJOIN_TURN_MS))
          const agora = this.#groups.get(canal)
          if (!agora || epochOf(agora) !== epocaAntes || !(await this.#haLugarPorDar(agora, eu))) continue
        }
        const anteriorDoTravao = this.vault.contents.repairAttempts[`${eu}|${chaveDoTravao}`]
        await this.vault.update((contents) => {
          contents.repairAttempts[`${eu}|${chaveDoTravao}`] = Date.now()
        })
        try {
          await this.#seatInvite(canal, eu)
        } catch (erro) {
          // Like in `repairInvite` (N1): no connection, or no packages at all, nothing is spent.
          if (!(erro instanceof AparelhoSemChaves) && this.#nadaSeGastou(erro)) {
            await this.#reporTravao(`${eu}|${chaveDoTravao}`, anteriorDoTravao)
          }
          throw erro
        }
      } catch (erro) {
        // A device with no keys now has them in six hours, by the throttle.
        // Who's already there (a run alongside another repair) is the outcome we wanted.
        if ((erro as Error).message !== "that person is already in this channel" && !(erro instanceof AparelhoSemChaves)) {
          this.#falhaDeLugar(canal, "assentar aparelho em falta", erro)
        }
      }
    }
  }

  // --------------------------------------------------------- lugar perdido

  /**
   * How long to wait after our leaf leaves a group before dropping it (F7).
   *
   * A removal isn't always the end: a reseat (`#reseat`) removes a account's leaves
   * and puts them back next, with a new Welcome. Dropping the channel on the first
   * commit erased history for whoever was only being repaired. After this time
   * without a Welcome that opens, the exit is for real. Static for tests.
   */
  static SAIDA_GRACA_MS = 30_000

  /** Pending exits, per channel. See `SAIDA_GRACA_MS`. */
  #saidasPorConfirmar = new Map<string, ReturnType<typeof setTimeout>>()

  /**
   * Our leaf left this group: someone else's commit removed us (F7).
   *
   * ts-mls says this in `groupActiveState` (`removedFromGroup`), and nobody was
   * reading it: the channel stayed in the list, deaf forever, and deafness asked
   * to rejoin the person who just expelled us. Now we wait for grace and drop it.
   */
  #fomosRemovidos(channel: string): void {
    if (this.#saidasPorConfirmar.has(channel)) return
    this.#saidasPorConfirmar.set(
      channel,
      setTimeout(() => {
        this.#saidasPorConfirmar.delete(channel)
        void this.#largarSeRemovido(channel).catch(() => {})
      }, Session.SAIDA_GRACA_MS),
    )
  }

  #limparSaidasPorConfirmar(): void {
    for (const relogio of this.#saidasPorConfirmar.values()) clearTimeout(relogio)
    this.#saidasPorConfirmar.clear()
  }

  /**
   * The grace period for exits, armed again for each group we were removed from.
   *
   * At the end of `#handshake`, after recovery and `welcome.resync`: the Welcome
   * from a reseat done while we were gone already had a path to us, and the full
   * grace starts here (I2).
   */
  #rearmarSaidas(): void {
    for (const [canal, grupo] of this.#groups) if (estaRemovido(grupo)) this.#fomosRemovidos(canal)
  }

  async #largarSeRemovido(channel: string): Promise<void> {
    const grupo = this.#groups.get(channel)
    // Meanwhile a Welcome that opened came in: it was a reseat, and the group is different.
    if (!grupo || !estaRemovido(grupo)) return
    // No connection: the reseat Welcome may be waiting on the server, we don't drop it.
    // The next `#handshake` end rearms the full grace period (I2).
    if (this.#connection !== "online") return
    await this.#largarGrupo(channel, false)
    this.emit("status", {
      detail: "you are no longer a member of this channel",
      level: "info",
      code: "channel-removed",
      route: "toast",
      channel,
    })
  }

  /**
   * Ask for pending invitations again, after forgetting the ones this device
   * had written off.
   *
   * The deadlock this breaks: a welcome that could not be opened is recorded
   * as dead and skipped for ever, while the sender's repair sees us already
   * in their group and re-invites nobody. Neither side is wrong and nothing
   * moves. Clearing the mark and asking again is the way out, and it is the
   * person pressing "Reparar" who decides to take it.
   */
  async resyncWelcomes(channel?: string): Promise<void> {
    await this.vault.update((contents) => {
      contents.deadWelcomes = channel
        ? contents.deadWelcomes.filter((mark) => !mark.startsWith(`v2|${channel}|`))
        : []
    })
    this.#send({ t: "welcome.resync" })
  }

  /** Amend a post's caption. Readers fold this over the original — and only
   * honour it when it comes from the post's own author. */
  async editPost(target: string, caption: string): Promise<void> {
    await this.send(this.feedChannel, {
      t: "edit",
      id: crypto.randomUUID(),
      target,
      editedAt: Date.now(),
      body: caption,
    })
  }

  /** Ask readers' devices to drop a post. A request, not an erasure: whoever
   * already holds it, holds it — pretending otherwise would be a lie. */
  async deletePost(target: string): Promise<void> {
    await this.send(this.feedChannel, { t: "redact", id: crypto.randomUUID(), target, redactedAt: Date.now() })
  }

  /**
   * The same request, for a comment, and therefore with the channel first.
   *
   * Our comment lives in the feed of who published it, which isn't ours: it's the
   * only place where the people who read it are. `deletePost` always goes to
   * `feedChannel` because our post only exists there; a comment would go to a group
   * where nobody has the comment to delete.
   *
   * Who deletes what isn't decided here and can't be decided here: the payload is
   * the same `redact` any group member can send. The rule, only the author, is
   * enforced by whoever reads, against the sender authenticated by MLS. See `engagementOf`.
   */
  async deleteComment(channel: string, target: string): Promise<void> {
    await this.send(channel, { t: "redact", id: crypto.randomUUID(), target, redactedAt: Date.now() })
  }

  /**
   * Fix a message already said, in the channel where it was said.
   *
   * The payload is the same `edit` as the feed and the receive path already stored
   * it for any channel, what was missing was someone to send it and someone to
   * apply it on read (`comEmendas`, in the interface). Until now, typing wrong in
   * a channel meant typing it forever.
   *
   * No time window, by the owner's decision on August 12, 2026, and with the edited
   * mark always in sight: what you gain by fixing a typo can't be paid for with a
   * channel that changes under whoever read it without noticing.
   *
   * Who sends what isn't decided here and can't be decided here: any group member
   * can send this with someone else's message id. The rule, only the author, is
   * enforced by whoever reads, against the sender authenticated by MLS.
   */
  async editMessage(channel: string, target: string, body: string): Promise<void> {
    await this.send(channel, { t: "edit", id: crypto.randomUUID(), target, editedAt: Date.now(), body })
  }

  /**
   * Ask other devices to drop a message.
   *
   * Request, not deletion, exactly like the feed: whoever read it, read it, and
   * an altered client ignores this with no consequence. What actually happens is it
   * leaves the screen of whoever honors the request and the vault of whoever applies
   * it. Saying otherwise to whoever taps the button would be the easiest lie to tell
   * and the worst to discover.
   */
  async deleteMessage(channel: string, target: string): Promise<void> {
    /*
      Someone else's message is only deleted by who has `moderar` (phase 3).

      The guard looks at the author this vault knows. Without the message in the vault
      (just sent and not yet saved, or outside history) it lets through: the tombstone
      is a request, and whoever gets it judges it against the sender and the roles they
      know (`dobrarConversa`). Refusing an unknown target here would stop the author from
      deleting what they just said.
    */
    const autor = this.#autorDaMensagem(channel, target)
    if (autor !== undefined && autor !== this.identity.address && !this.mayModerate(channel)) {
      throw new Error("only the author or a moderator may delete this message", { cause: { channel } })
    }
    await this.send(channel, { t: "redact", id: crypto.randomUUID(), target, redactedAt: Date.now() })
  }

  /** The sender of message `target` in this channel, by the vault. Absent if the vault doesn't have it. */
  #autorDaMensagem(channel: string, target: string): string | undefined {
    for (const entrada of entradasDoCanal(this.vault.contents, channel)) {
      const payload = entrada.payload as { t?: unknown; id?: unknown }
      if (payload.t === "message" && payload.id === target) return entrada.sender
    }
    return undefined
  }

  /**
   * If this person moderates this channel: delete others' messages, close tickets,
   * and change nicknames (phase 3). By default, this account.
   *
   * The power `moderar`, with one exception that doesn't depend on any role: a
   * direct conversation and a feed have no moderation. A direct has no foundation,
   * and `powersOf` gives whoever is in a channel without foundation what undoes
   * itself; without this exception, each of the two people hid the other's messages.
   * Folds ask this by the sender of each tombstone, so the rule must be the same
   * on both sides.
   */
  mayModerate(channel: string, address: string = this.identity.address): boolean {
    if (this.#eDirecta(channel) || this.#eMural(channel)) return false
    return this.powersOf(channel, address).includes("moderar")
  }

  // ---------------------------------------------------------------- amizades

  /**
   * Friendship is mutual, and becomes mutual through one act alone.
   *
   * Each person's feed is an MLS group they own (`moradaDoMural`), and reading
   * someone's feed means having a seat in that group, not a row in a permissions
   * table, but actually holding the keys. A friendship is therefore TWO seats, and
   * only the owner of each feed can grant theirs: two commits, one in each tree.
   *
   * This raises one design question: the requester is not present when the other
   * person accepts. There were two paths forward.
   *
   * The first was for the request to carry the invite with it, so acceptance would
   * be immediate on both sides. We rejected it for two reasons, the second decisive.
   * First: from the moment I request, the other person holds what they need to enter
   * my feed, and nothing stops them using it before they hit reject, requesting
   * becomes giving. Second: it would not work. An invite is not a key that spends
   * itself; joining an MLS group requires a commit from a member, and the only
   * guaranteed member of my feed is me. The invite would wait for me to be online.
   * We paid the full price in privacy and bought no immediacy to justify it.
   *
   * What we built is the second path: acceptance is what generates the seat back.
   * The accepter seats the requester in their feed at once and announces it; the
   * requester seats the accepter as soon as they know, live if online, or during
   * the next reconciliation, reading from vault not memory. Between those two moments
   * the friendship exists on one side only, and that is the cost: the accepter is
   * already read, the requester is not yet reading. Nothing here pretends otherwise.
   */

  /**
   * Who we are talking to in a channel, when the answer is unique.
   *
   * The MLS tree first, because it is fact not convention: two members, one who is
   * not me, and that answers the question, and answers correctly even when the
   * other person is on a different homeserver, something the channel name cannot do
   * (the name carries my server, not theirs). The name serves as a fallback for a
   * channel this device has left and no longer has keys for.
   *
   * In a room the answer is `null`, and that is correct: our message there has no
   * single recipient.
   */
  #parDoCanal(channel: string): string | null {
    const group = this.#groups.get(channel)
    if (group) {
      // By ACCOUNT not by leaf: an account with two devices has two leaves, and
      // counting leaves would turn a direct with two-device pair into a "room".
      // Then our ledger acts would have no recipient and the fold would lose our own
      // request (measured 20/10/2026, F2).
      const membros = [...new Set([...memberAddresses(group.state.ratchetTree).values()].map(String))]
      const outros = membros.filter((membro) => membro !== this.identity.address)
      if (membros.length === 2 && outros.length === 1) return outros[0] ?? null
      if (membros.length > 2) return null
    }
    const ficha = this.fichaDoCanal(channel)
    return ficha.tipo === "directa" ? (ficha.par ?? null) : null
  }

  /**
   * All friendship events this device has stored, in arrival order.
   *
   * Read from vault not memory: what decides if someone gets a seat in my feed must
   * survive closing the app, which is exactly when acceptance arrives and no one is
   * watching. Between channels there is no global order, and we do not need one, a
   * direct lives in the conversation of both, and that is one thing.
   *
   * **Within each channel, by SERVER ORDER** (`#porOrdemDoServidor`), not by the
   * order things entered the array. See the reason and the cost.
   */
  #friendEvents(): FriendEvent[] {
    const eventos: FriendEvent[] = []
    for (const channel of canaisComEntradas(this.vault.contents)) {
      for (const entrada of this.#livroDoCanal(channel)) {
        // The vault stores payloads with no guaranteed shape (a newer version may have
        // written them). We narrow here to what the fold reads.
        const sentAt = entrada.payload["sentAt"]
        const note = entrada.payload["note"]
        // Withdrawal is a rejection with this field set: without it copied, the fold
        // would read "I rejected their request" where we said "I withdraw mine".
        const withdrawn = entrada.payload["withdrawn"]
        eventos.push({
          channel,
          sender: entrada.sender,
          payload: {
            t: entrada.payload.t,
            ...(typeof sentAt === "number" ? { sentAt } : {}),
            ...(typeof note === "string" ? { note } : {}),
            ...(withdrawn === true ? { withdrawn: true } : {}),
          },
        })
      }
    }
    return eventos
  }

  /**
   * The ledger acts of a channel's friendships, in server order.
   *
   * From the channel state (`estadoDoCanal`), which also holds those inherited from
   * pairing (phase S2: they were `livroHerdado`, separate). The conversation enters
   * the fold only to give order: an old send of ours with no `seq` or `apos` takes
   * the key of the highest `seq` seen before it (see `dobras.ts`).
   */
  #livroDoCanal(channel: string): StoredChatMessage[] {
    return this.#porOrdemDoServidor(entradasDoCanal(this.vault.contents, channel)).filter((entrada) =>
      isFriendPayload(entrada.payload),
    )
  }

  /**
   * A channel's entries in SERVER ORDER, with our sends in their place.
   *
   * **What this fixes.** The two folds that decide access, friendships and invites
   *, consume in array order, and the array is not ordered: `appendHistory` pushes
   * to the end, and it is the path for EVERYTHING the server delivers, live or
   * recovered. A `friend.remove` with `seq` 5 recovered from a gap after an `accept`
   * with `seq` 50 already stored ends up after it in the array and before it in
   * time: the fold reads accept→remove and declares a live friendship undone. With
   * invites the form is the same and the consequence is different: an `inviteReply`
   * read before the `invite` it answers falls through the `if (!tie) continue` in
   * `foldInviteTies` and is never considered again, so the accepter receives no seat.
   *
   * **Why this does NOT reopen the door that `foldFriendTies` closes on `sentAt`.**
   * `sentAt` is written by the sender, and ordering by it would let someone date a
   * `friend.accept` before a rejection. `seq` is from the SERVER: the number by which
   * it orders the channel, the number by which MLS commits apply (`#recuperarUmaVez`
   * reads strictly by `seq`), and the same number recovery uses as anchor. Whoever
   * picks it already picks the order we deliver everything in; what they can no
   * longer do is lie about their position.
   *
   * **Our sends have no `seq`** (`-1`: they never go around the server) **and do not
   * go to the end.** Putting them at the end would open a new door and measure it:
   * our request followed by their rejection would read rejection→request, and a
   * rejected request would reappear pending. They take by key the HIGHEST `seq` seen
   * up to where they are, which is what we know about when they happened; JS `sort`
   * is stable, so they tie with that event and end up after it, in insertion order.
   */
  #porOrdemDoServidor(entradas: readonly StoredChatMessage[]): StoredChatMessage[] {
    // The rule lives in `dobras.ts` since phase S1, for all folds.
    return porOrdemDoServidor(entradas)
  }

  /** The last state we emitted from `amizades`, to avoid repeating it. */
  #impressaoDasAmizades = ""
  #amizadesAgendadas = false

  /**
   * Signal the interface that ties may have changed.
   *
   * In a microtask, not now: the caller is often inside `vault.update`, in the
   * middle of a write. The fold runs once per batch, and only emits an event if the
   * result is different, because the interface redraws the bell and Friends screen
   * on each one.
   */
  #avisarAmizades(): void {
    if (this.#amizadesAgendadas) return
    this.#amizadesAgendadas = true
    queueMicrotask(() => {
      this.#amizadesAgendadas = false
      if (!this.vault.unlocked) return
      const ties = [...this.friendTies().values()]
      const impressao = JSON.stringify(ties)
      if (impressao === this.#impressaoDasAmizades) return
      this.#impressaoDasAmizades = impressao
      this.emit("amizades", { ties })
    })
  }

  /** The state of each connection, folded from the events that made it. */
  friendTies(): Map<string, FriendTie> {
    return foldFriendTies(this.#friendEvents(), this.identity.address, (channel) => this.#parDoCanal(channel))
  }

  /** Pending requests, most recent first. */
  openFriendRequests(): FriendTie[] {
    return openRequestsOf(this.friendTies())
  }

  /** Our outgoing requests awaiting response, the ones we can cancel. */
  sentFriendRequests(): FriendTie[] {
    return sentRequestsOf(this.friendTies())
  }

  /** A friend request travels inside a channel the two already share — there
   * is deliberately no server-side mailbox to drop notes into. */
  async sendFriendRequest(channel: string, note?: string): Promise<void> {
    return this.#umaDeCadaVez(`friend|${channel}`, async () => {
      // A withdrawal on the same direct comes first: joining both in the same
      // promise (what `#umaDeCadaVez` does for the same key) would leave the
      // second act undone, silently.
      await this.#emCurso.get(`cancelar|${channel}`)?.catch(() => {})
      return this.#sendFriendRequest(channel, note)
    })
  }

  async #sendFriendRequest(channel: string, note?: string): Promise<void> {
    const par = this.#parDoCanal(channel)
    // Requesting friendship from someone we blocked is undoing the block
    // without saying so: we unblock first, on purpose, by our own act.
    if (par && this.isBlocked(par)) throw new Error("that person is blocked")
    const tie = par ? this.friendTies().get(par) : undefined

    /**
     * Requesting from someone who already requested us is accepting.
     *
     * It is what anyone would expect: two crossed requests make a friendship, not
     * two waits ignoring each other. And it is honest to treat it as acceptance
     * not as a special case, the requester is saying yes, and the other request
     * was already there to be answered.
     */
    if (par && (tie?.link === "pedido-recebido" || tie?.link === "cruzado")) {
      return this.#acceptFriend(tie.channel, par)
    }
    // Already friends: nothing to request, and a new request would only make noise.
    if (tie?.link === "amigos") return

    /**
     * One request at a time, and the answer frees the next.
     *
     * The request would go every time the button was tapped, and each is a
     * channel message and a notification on the other end. Tap five times sent
     * five identical requests.
     *
     * The truth lives in the channel history, not in a variable: it survives
     * restarting the app, which is exactly when an impatient person tries again.
     * Our outstanding request blocks, and a rejection frees it, because a
     * rejected request has been answered and trying again later is a new request,
     * not insisting on the same one.
     */
    if (tie?.link === "pedido-enviado") {
      throw new Error("a friend request is already pending")
    }
    // No known recipient, a request made in a room, has no fold to guard it, and
    // the old check runs to read that channel's history.
    if (!par) {
      const historico = this.#porOrdemDoServidor(entradasDoCanal(this.vault.contents, channel))
      for (let i = historico.length - 1; i >= 0; i--) {
        const entrada = historico[i]
        if (!entrada) continue
        if (entrada.payload.t === "friend.accept" || entrada.payload.t === "friend.decline") break
        if (entrada.payload.t === "friend.request") {
          if (entrada.sender === this.identity.address) {
            throw new Error("a friend request is already pending")
          }
          break
        }
      }
    }
    await this.send(channel, { t: "friend.request", sentAt: Date.now(), ...(note ? { note } : {}) })
  }

  /**
   * Accept a request. This is the only path by which a friendship is accepted.
   *
   * It is unique on purpose: acceptance happens from the Friends screen and from
   * the notification center, and a second path would diverge on the first change
   *, and what diverges here is not a label, it is who holds what keys.
   *
   * Order matters too. The seat first, the announcement after: if the announcement
   * fails, the other person has the seat but does not know they owe one back, and
   * the request stays unanswered on our side, visible, and so recoverable with
   * another button tap. The opposite, an announcement sent without a seat given,
   * would leave both convinced of a friendship that does not exist.
   *
   * Does not resolve until the seat is given. The caller counts on this to only
   * remove the request from the screen after it is done: a request that vanishes
   * from optimism and fails after leaves no trace anywhere and there is no way to
   * recover it.
   *
   * Tap twice and get the same as tapping once. `#umaDeCadaVez` joins simultaneous
   * clicks to the same promise, `seat` does not recommit someone already there, and
   * an announced friendship is not announced again.
   */
  async acceptFriend(channel: string, address: string): Promise<void> {
    return this.#umaDeCadaVez(`friend|${channel}`, () => this.#acceptFriend(channel, address))
  }

  async #acceptFriend(channel: string, address: string): Promise<void> {
    const jaAmigos = this.friendTies().get(address)?.link === "amigos"
    // Between the seat given and the accept echoed the fold does not yet say
    // "friends": the rule for the friends feed (`#intrusosNoFeed`) must let it through.
    this.#aAceitar.add(address)
    try {
      // The act: this person now has a seat in my feed. `seat` leaves someone who is
      // already there alone and restores someone who is there but dead, so it is safe
      // to repeat.
      await this.acceptFollower(address)
      if (jaAmigos) return
      await this.#anunciarAceite(channel)
    } finally {
      this.#aAceitar.delete(address)
    }
  }

  /** In a live direct: my last act is a withdrawal and theirs, next, is an accept. See M1. */
  #aceiteOrfao(channel: string, peer: string): boolean {
    if (!this.#eDirecta(channel) || !this.#groups.has(channel)) return false
    const actos = this.#porOrdemDoServidor(entradasDoCanal(this.vault.contents, channel)).filter((entrada) =>
      isFriendPayload(entrada.payload),
    )
    let meuUltimo = -1
    let deleUltimo = -1
    actos.forEach((entrada, indice) => {
      if (entrada.sender === this.identity.address) meuUltimo = indice
      else if (entrada.sender === peer) deleUltimo = indice
    })
    if (meuUltimo < 0 || deleUltimo < meuUltimo) return false
    const meu = actos[meuUltimo]?.payload
    return meu?.t === "friend.decline" && meu["withdrawn"] === true && actos[deleUltimo]?.payload.t === "friend.accept"
  }

  /** The person being accepted now: has a seat in the feed and the fold does not yet know. */
  #aAceitar = new Set<string>()

  async #anunciarAceite(channel: string): Promise<void> {
    // Courtesy, and what closes the friendship on their side: this announcement is
    // what tells the requester they owe a seat back.
    await this.send(channel, { t: "friend.accept", acceptedAt: Date.now() })
  }

  /**
   * Reject a request.
   *
   * Grants no access, in any sense, there is nothing here that seats anyone
   * anywhere, and that is how it must stay. What it does is close the request: it
   * leaves our screens because the fold stops counting it, and it leaves their side
   * because the requester stops waiting for an answer that will not come, and can
   * request again later, which an eternally pending request denied them.
   */
  async declineFriend(channel: string): Promise<void> {
    await this.send(channel, { t: "friend.decline", declinedAt: Date.now() })
  }

  /**
   * Withdraw our request before it gets an answer.
   *
   * A rejection with `withdrawn`: closes OUR request, both sides, and touches
   * nothing else. In a crossed request theirs stays unanswered, because they
   * requested and no one answered them.
   *
   * Over the direct, even if the request was made in a room: it is in the direct
   * that the recipient is one and authenticated, and the fold on both sides reaches
   * the same person over any channel. An archived direct (we were removed from it)
   * has no group to encrypt over, and we open another, as in `unfriend`.
   *
   * In queue with the request, not next to it: `cancelar|<canal>` waits for the
   * `friend|<canal>` in progress, and the request waits for the withdrawal. One key
   * would join them in the same promise (`#umaDeCadaVez`) and the second act would
   * resolve without leaving.
   *
   * The ledger (`livroPorConfirmar`, the echo with `seq`, resend to latecomers)
   * treats it as an act, because it is one: it is a friendship payload.
   *
   * @throws "there is no friend request to cancel" if we have no open request:
   *   nothing to cancel, and saying so is better than sending noise.
   */
  async cancelFriendRequest(address: string): Promise<void> {
    /*
      Only `pedido-enviado`, not `cruzado` (phase 3 revision). In a crossed one, a
      0.5.x client reads the withdrawal as rejection of THEIR request, and closes it
      for them; and on our side a crossed one resolves to friendship in reconciliation,
      which is what both asked for. What we offer in a crossed one is accept or reject.
    */
    const tie = this.friendTies().get(address)
    if (tie?.link !== "pedido-enviado") throw new Error("there is no friend request to cancel")
    const pedidoNumaSala = !this.#eDirecta(tie.channel) && this.#groups.has(tie.channel) ? tie.channel : null
    const channel = this.#directaViva(address) ?? (await this.openDirect(address))
    return this.#umaDeCadaVez(`cancelar|${channel}`, async () => {
      await this.#emCurso.get(`friend|${channel}`)?.catch(() => {})
      // Read again in there: whoever waited their turn may have seen the request close
      // in the meantime (accepted, rejected, or withdrawn by another tap).
      if (this.friendTies().get(address)?.link !== "pedido-enviado") return
      /*
        A request made in a room (before directs) was a request to everyone there:
        in each one's fold, a `friend.request` from someone in a room opens a request
        from that person. Removing it only over the direct would leave the others with
        it open. It also goes to the room, first.
      */
      if (pedidoNumaSala && !this.#salaComPedidoAberto(pedidoNumaSala)) {
        await this.send(pedidoNumaSala, { t: "friend.decline", declinedAt: Date.now(), withdrawn: true }).catch(() => {})
      }
      await this.send(channel, { t: "friend.decline", declinedAt: Date.now(), withdrawn: true })
    })
  }

  /**
   * End the friendship, both seats, not one.
   *
   * A friendship ended halfway is worse than none: the interface says it ended and
   * the access goes on. Except the two seats are not within one person's reach. The
   * seat of this person in MY feed I remove myself, and that is a commit: fact,
   * immediate, no client undoes it. My seat in their feed only their device can
   * remove, and that is where `friend.remove` goes, the other client honors it by
   * removing my leaf, just as this one honors theirs.
   *
   * What stands said to not promise more: what was once read, was read. Leaving an
   * MLS group works going forward, and whoever already received publications keeps them.
   */
  async unfriend(address: string): Promise<void> {
    const feed = await this.ensureFeed()
    await this.#unseat(feed, address)
    // Over the channel where the connection lived, and if there is none we open one:
    // the remove request is the only part of this that needs to get there.
    // The direct where the connection lived may be archived (we were removed):
    // no group to send the remove over, we open another (N3).
    // And a direct where they are not seated (they left, or the seat is dead) does
    // not work either: the remove would go to no one. `openDirect` fixes their seat.
    const channel = this.#directaViva(address) ?? (await this.openDirect(address))
    await this.send(channel, { t: "friend.remove", removedAt: Date.now() })
    /**
     * And our leaf in their feed, asked for by us (F5, 20/10/2026).
     *
     * `friend.remove` only cuts live: the other client removes us from their feed
     * when they read it in the moment (`#onFriendPayload`). With them offline, they
     * would read it in recovery, which does not react to friendship events, and we
     * would keep reading the feed of someone who ended the friendship with us.
     * `member.left` has no such flaw: `#applyEvent` honors it live AND in recovery.
     * No network, the leave waits for `syncFriendships`, which repeats it while the
     * feed is still here.
     */
    await this.#sairDoFeedDe(address).catch((erro: unknown) => this.#falhaDeLugar(this.#feedDe(address) ?? address, "saída do feed", erro))
    // Someone who stopped being a friend no longer appears in the list we show.
    await this.#tirarDaListaMostrada(address).catch(() => {})
  }

  /**
   * A feed for an account, by address, if we know it (D1): ours, or the owner's
   * shared with us in a profile (`muraisDosOutros`). Without it, `null`: someone
   * who does not share a direct or channel with the owner does not know the address.
   */
  #feedDe(address: string): string | null {
    if (this.#identity !== null && address === this.#identity.address) return this.feedChannel || null
    const segredo = this.vault.unlocked ? this.vault.contents.muraisDosOutros?.[address] : undefined
    if (!segredo) return null
    try {
      return moradaDoMural(fromBase64(segredo), parseAddress(address).server)
    } catch {
      return null
    }
  }

  /** An account's feed for the interface: the same as `#feedDe`, or `null`. */
  muralDe(address: string): string | null {
    return this.#feedDe(address)
  }

  /** The owner of a feed, by channel, or `null` if the channel is not a feed. */
  #donoDoFeed(channel: string): string | null {
    const ficha = this.fichaDoCanal(channel)
    return ficha.tipo === "mural" ? (ficha.dono ?? null) : null
  }

  /**
   * Leave someone's feed for real: the `member.left` and only then drop it.
   *
   * It is `leaveChannel`, which waits for the server receipt before leaving the
   * group. No group means nothing to do; no network, it fires and the group stays,
   * for the next pass of `syncFriendships` to ask the leave again.
   */
  async #sairDoFeedDe(address: string): Promise<void> {
    const feedDele = this.#feedDe(address)
    if (!feedDele || feedDele === this.feedChannel || !this.#groups.has(feedDele)) return
    await this.leaveChannel(feedDele)
  }

  // ------------------------------------------------------------- bloquear

  /**
   * Friends in the fold, excluding blocked ones. This is the set that grants seats.
   *
   * During a block, the person does not count as a friend for anything that grants access
   * (feed repair, feed seat request, displayed list),
   * even if the fold still says "friends" because the removal hasn't propagated yet.
   */
  #amigosVivos(): string[] {
    return friendsOfTies(this.friendTies()).filter((amigo) => !this.isBlocked(amigo))
  }

  /**
   * Does someone in this room have an open request TO us (`request-received` or
   * `crossed`)? A 0.5.x client reads a cancellation in the room as a refusal of
   * their request: sending it there would close a request that nobody refused. In that
   * case the cancellation goes only via the direct channel (core review).
   */
  #salaComPedidoAberto(sala: string): boolean {
    const grupo = this.#groups.get(sala)
    if (!grupo) return false
    const ties = this.friendTies()
    for (const membro of new Set([...memberAddresses(grupo.state.ratchetTree).values()].map(String))) {
      if (membro === this.identity.address) continue
      const link = ties.get(membro)?.link
      if (link === "pedido-recebido" || link === "cruzado") return true
    }
    return false
  }

  /** A direct channel with a group and the person seated there: the only way an act reaches them. */
  #directaViva(address: string): string | null {
    const tie = this.friendTies().get(address)
    for (const canal of [tie?.channel, this.#directaCom(address)]) {
      if (!canal || !this.#eDirecta(canal)) continue
      const grupo = this.#groups.get(canal)
      if (grupo && [...memberAddresses(grupo.state.ratchetTree).values()].map(String).includes(address)) return canal
    }
    return null
  }

  /**
   * Does a blocked person have this local part?
   *
   * For channel names, where the server there is the one who created the
   * channel and not the person's: a direct channel between two accounts on different
   * servers has the server of only one. The local part is the summary of the account key,
   * the same on any server, and it is by this that we compare (phase 3 review).
   */
  #bloqueadoPorParteLocal(parteLocal: string): boolean {
    if (!this.vault.unlocked) return false
    for (const address of Object.keys(this.vault.contents.blocked ?? {})) {
      try {
        if (parseAddress(address).localPart === parteLocal) return true
      } catch {
        // A malformed entry blocks no one.
      }
    }
    return false
  }

  /** If this account blocked this address on this device. See `blocked` in the vault. */
  isBlocked(address: string): boolean {
    return this.vault.unlocked && this.vault.contents.blocked?.[address] !== undefined
  }

  /** Who is blocked on this device, from most recent block to oldest. */
  blocked(): { address: string; at: number }[] {
    if (!this.vault.unlocked) return []
    return Object.entries(this.vault.contents.blocked ?? {})
      .map(([address, at]) => ({ address, at }))
      .sort((a, b) => b.at - a.at)
  }

  /**
   * A PERSONAL channel of this person, where a block takes effect: my feed, their feed,
   * our direct channel.
   *
   * Shared rooms are deliberately left out. There are other people there, and
   * what they say is part of a conversation that is not just ours: silencing their
   * messages would break the conversation for readers, and removing their seat is the power
   * of whoever administers the room, not of whoever blocks.
   */
  #bloqueadoAqui(channel: string, address: string): boolean {
    if (!this.isBlocked(address)) return false
    if (channel === this.feedChannel) return true
    if (this.#donoDoFeed(channel) === address) return true
    return this.#eDirecta(channel) && this.#parDoCanal(channel) === address
  }

  /**
   * Block someone (phase 3 of the friendship plan, 20/10/2026).
   *
   * Four acts, in this order, and the order is the safeguard:
   *
   *  1. Save to the vault. First, so that nothing that runs after (a
   *     reconciliation, a Welcome arriving, a `repairInvite` in flight) seats
   *     whoever we just blocked: `seat`, `openDirect` and
   *     `#acceptWelcome` read this.
   *  2. Remove them from my feed (`#unseat`). Called here, OUTSIDE any
   *     `#umaDeCadaVez`: the `#unseat` uses the group queue, and entering it from
   *     within another pass would close it on itself (see there).
   *  3. Undo the connection, if one is live, via the direct channel (`friend.remove`). This
   *     puts the fold on both sides into "undone", and an undone connection
   *     is not repaired by anyone. Only if the direct channel is still live: opening a
   *     new direct channel with the blocked person would be the opposite of what was asked.
   *  4. Leave their feed (`member.left`, via `leaveChannel`), as
   *     `unfriend` does.
   *
   * From 2 onwards, the network can fail, and the block still holds: the filter
   * for what comes in is local and already in place. What was left undone,
   * reconciliation does on the next connection (`#reconciliarAmizades`).
   *
   * What it does NOT do: erase history, leave shared rooms, or tell them
   * they were blocked. On their end they see a friendship undone, which is what it is.
   */
  async block(address: string): Promise<void> {
    if (address === this.identity.address) throw new Error("you cannot block yourself")
    try {
      if (parseAddress(address).sigil !== "@") throw new Error("not an account")
    } catch {
      throw new Error("that is not an account address")
    }
    /*
      The time is that of this gesture, not of an earlier block that the vault still
      has (phase 5): between devices the most recent timestamp wins, and a block
      redone with the old time would lose against an unblock done meanwhile on
      the other device.
    */
    const marca = Math.max(Date.now(), (this.vault.contents.desbloqueados?.[address] ?? 0) + 1)
    await this.vault.update((contents) => {
      contents.blocked = { ...contents.blocked, [address]: marca }
      if (contents.desbloqueados?.[address] !== undefined) {
        const { [address]: _desbloqueado, ...outros } = contents.desbloqueados
        contents.desbloqueados = outros
      }
    })
    // To the account's other devices: the filter for what comes in now applies there too.
    this.#enviarEstado({ t: "estado.bloqueio", bloqueio: { [address]: { bloqueado: true, at: marca } } })
    const falhas: unknown[] = []
    await this.#unseat(this.feedChannel, address).catch((erro: unknown) => falhas.push(erro))
    await this.#cortarComBloqueado(address).catch((erro: unknown) => falhas.push(erro))
    await this.#sairDoFeedDe(address).catch((erro: unknown) => falhas.push(erro))
    await this.#tirarDaListaMostrada(address).catch(() => {})
    for (const erro of falhas) this.#falhaDeLugar(this.feedChannel, "bloqueio", erro)
  }

  /** The `friend.remove` to whoever is blocked, if there is a live tie and a direct channel. See `block`. */
  async #cortarComBloqueado(address: string): Promise<void> {
    const tie = this.friendTies().get(address)
    if (!tie || tie.severed || tie.link === "nenhum") return
    // Only via a direct channel where they are seated: in a group where they no longer are,
    // the removal would go nowhere and the fold on this side would say "undone" on its own.
    const directa = this.#directaViva(address)
    if (!directa) return
    await this.send(directa, { t: "friend.remove", removedAt: Date.now() })
  }

  /** A Welcome for the direct channel with someone blocked, or for their feed. See `#acceptWelcome`. */
  #welcomeDeBloqueado(channel: string): boolean {
    return this.#fichaDeBloqueado(this.fichaDoCanal(channel))
  }

  /** The slip is from a direct channel with someone blocked, or from their wall. */
  #fichaDeBloqueado(ficha: FichaDoCanal): boolean {
    // The wall owner or the direct channel peer, by the slip; and compared by
    // local part, because the channel server is the one who created it (see
    // `#bloqueadoPorParteLocal`).
    const outro = ficha.tipo === "mural" ? ficha.dono : ficha.tipo === "directa" ? ficha.par : undefined
    if (!outro || outro === this.identity.address) return false
    try {
      return this.#bloqueadoPorParteLocal(parseAddress(outro).localPart)
    } catch {
      return false
    }
  }

  /**
   * The address of the direct channel with this person, if this device knows it: the slip from
   * the vault, or an address already calculated in this session (before the group exists).
   * It does not calculate anything: the calculation needs the peer's public key, which
   * may have to come from the server. See `#moradaDaDirectaCom`.
   */
  #directaCom(address: string): string | null {
    if (!this.vault.unlocked) return null
    let semGrupo: string | null = null
    for (const [canal, ficha] of Object.entries(this.vault.contents.fichasDosCanais ?? {})) {
      if (ficha.tipo !== "directa" || ficha.par !== address) continue
      // With two slips for the same peer (a development vault with the old and opaque form),
      // the one that has a group.
      if (this.#groups.has(canal)) return canal
      semGrupo ??= canal
    }
    return semGrupo ?? this.#directasCalculadas.get(address) ?? null
  }

  /** The addresses of direct channels calculated in this session, by peer. Memory only: the slip is what stays. */
  #directasCalculadas = new Map<string, string>()

  /**
   * The address of the direct with this person, calculated if needed.
   *
   * `moradaDirecta(chave privada de conta, chave pública do par)`. **Only whoever has the account key calculates it.** A paired device
   * receives addresses from the vault (the pairing snapshot and the `estado.fichas` of the
   * account channel) and never calculates them; for a person the account has never
   * talked to, it refuses with a stable key (Error 609), and the conversation
   * opens on the device with the key.
   *
   * The peer's public key comes from the cheapest source that has it: the MLS
   * credential of a leaf in a group we share, and only then the device manifest
   * that the server keeps (`#chaveDaContaDe`). The source does not need to be trusted:
   * `moradaDirecta` verifies that the key matches the address (the account id is its hash),
   * and a swapped key is rejected there.
   */
  async #moradaDaDirectaCom(address: string): Promise<{ morada: string; reclamados?: PacotesReclamados }> {
    const conhecida = this.#directaCom(address)
    if (conhecida) return { morada: conhecida }
    const identity = this.identity
    if (!temChaveDeConta(identity)) throw new Error("this device cannot start a new conversation")
    let chave = await this.#chaveDaContaDe(address)
    /*
      Without a manifest (a server without devices, or an account that never
      published one), the key comes from the credential of a key package of theirs. Claimed
      packages are not lost: they are the ones from the next seat.
    */
    let reclamados: PacotesReclamados | undefined
    if (!chave) {
      reclamados = await this.#reclamarPacotes(address, undefined, null).catch(() => undefined)
      const pacote = reclamados?.pacotes[0]?.pacote
      chave = pacote ? (credentialOfKeyPackage(pacote)?.accountKey ?? null) : null
    }
    if (!chave) throw new Error("the other account is not known to the server")
    const morada = moradaDirecta(identity.signingPrivateKey, chave, identity.address, address)
    this.#directasCalculadas.set(address, morada)
    return reclamados ? { morada, reclamados } : { morada }
  }

  /**
   * The public key of someone's ACCOUNT: from the tree of a group we share,
   * or from their device manifest on the server. `null` without either.
   */
  async #chaveDaContaDe(address: string): Promise<Uint8Array | null> {
    for (const grupo of this.#groups.values()) {
      const chave = memberAccountKey(grupo, address as UserAddress)
      if (chave) return chave
    }
    /*
      An account that just connected publishes the manifest an instant after
      `auth.ok` (`#garantirManifesto` does not wait). Whoever opens the conversation
      at that moment read "not there": three reads, with a short backoff.
    */
    if (!this.suportaAparelhos) return null
    for (const espera of [0, 250, 750]) {
      if (espera > 0) await new Promise((resolve) => setTimeout(resolve, espera))
      const leitura = await this.#lerManifesto(address, 10_000)
      if (leitura.lido && leitura.manifesto) return leitura.manifesto.accountKey
      // "Did not read" does not improve with waiting: the bucket or the timeout. Only "not there" retries.
      if (!leitura.lido) return null
    }
    return null
  }

  /**
   * What a channel that arrives from outside is, deduced from what this device knows, without
   * trusting anyone (slice 3). `null` when not deduced: without a slip, a
   * channel is a room (`fichaDoCanal`), and the slip can arrive later (the account channel,
   * the profile of whoever owns the wall).
   *
   * - The account channel's address is from the vault.
   * - A direct channel: the group has two accounts, and the address is what the DH of the two
   *   keys gives. Only with the account key; on a paired device it arrives via
   *   `estado.fichas`.
   * - A wall: the address is from a wall secret the owner gave us
   *   (`muraisDosOutros`), or our own.
   */
  #fichaDeduzida(channel: string, grupo: GroupSession): FichaDoCanal | null {
    if (!this.vault.unlocked || this.#identity === null) return null
    const guardada = this.vault.contents.fichasDosCanais?.[channel]
    if (guardada) return guardada
    if (channel === this.canalDaConta) return { tipo: "conta" }
    const identity = this.#identity
    const contas = [...new Set([...memberAddresses(grupo.state.ratchetTree).values()].map(String))]
    const outros = contas.filter((conta) => conta !== identity.address)
    const [par] = outros
    if (outros.length === 1 && par && temChaveDeConta(identity)) {
      const chave = memberAccountKey(grupo, par as UserAddress)
      try {
        if (chave && moradaDirecta(identity.signingPrivateKey, chave, identity.address, par) === channel) return { tipo: "directa", par }
      } catch {
        // A key that is not the address key gives no direct channel.
      }
    }
    const dono = this.#donoDaMoradaDeMural(channel)
    if (dono) return { tipo: "mural", dono }
    return null
  }

  /**
   * Someone's profile brought their wall secret (D1): if we already have the group
   * with this address without a slip (the Welcome arrived before the profile), it becomes
   * their wall.
   */
  #fichaDoMuralQueChegou(contents: VaultContents, dono: string): void {
    const morada = this.#feedDe(dono)
    if (!morada || !this.#groups.has(morada) || contents.fichasDosCanais?.[morada]) return
    const ficha: FichaDoCanal = { tipo: "mural", dono }
    if (registarFicha(contents, morada, ficha)) this.#anunciarFicha(morada, ficha)
  }

  /**
   * Whose wall has this address, by the secrets we know (ours included). Also
   * profiles that arrived and still wait for batch save (`#pendingDirectory`): the wall's
   * Welcome often arrives right after the owner's profile, before the batch goes to the vault,
   * and without this the wall would enter as a room (and the bell would say "You were added to #…").
   */
  #donoDaMoradaDeMural(channel: string): string | null {
    if (this.#identity === null) return null
    if (this.feedChannel && channel === this.feedChannel) return this.#identity.address
    for (const dono of Object.keys(this.vault.contents.muraisDosOutros ?? {})) {
      if (this.#feedDe(dono) === channel) return dono
    }
    for (const { address, payload } of this.#pendingDirectory) {
      const segredo = (payload as { mural?: unknown }).mural
      if (typeof segredo !== "string") continue
      try {
        if (moradaDoMural(fromBase64(segredo), parseAddress(address).server) === channel) return address
      } catch {
        // A malformed secret is no one's wall.
      }
    }
    return null
  }

  /**
   * Unblock: erase the mark and ask for Welcomes again.
   *
   * Welcomes that arrived during the block were ignored without being marked dead
   * (`#acceptWelcome`), and the server delivers them again on request. The friendship
   * does not restore by itself: the block undid it, and restoring it is a new
   * request from one of the two.
   *
   * **And if the removal never left?** Without a live direct channel, the block had no way
   * to send the `friend.remove`, and the fold stays "friends". Erasing the
   * mark would let the next reconciliation give them back their seat in my feed: an
   * unblock that restored the friendship by itself (phase 3 review). So,
   * in that case, we undo the friendship here for real (`unfriend`, which opens a
   * direct channel if needed), before asking for Welcomes.
   */
  async unblock(address: string): Promise<void> {
    if (!this.isBlocked(address)) return
    // The block time, to restore it as it was if the unblock fails.
    const bloqueadoEm = this.vault.contents.blocked?.[address] ?? Date.now()
    // The unblock mark, for merging between devices (phase 5): above the block.
    const desbloqueadoEm = Math.max(Date.now(), bloqueadoEm + 1)
    await this.vault.update((contents) => {
      if (contents.blocked) delete contents.blocked[address]
      contents.desbloqueados = { ...contents.desbloqueados, [address]: desbloqueadoEm }
    })
    if (this.friendTies().get(address)?.link === "amigos") {
      /*
        Without network the removal does not go out, and the mark is already erased: the
        next reconciliation would seat them again (core review). Restore the mark and
        say: unblock stays undone until there is a connection to do it right.
      */
      try {
        await this.unfriend(address)
      } catch (erro) {
        await this.vault.update((contents) => {
          contents.blocked = { ...contents.blocked, [address]: bloqueadoEm }
          if (contents.desbloqueados?.[address] !== undefined) {
            const { [address]: _desbloqueado, ...outros } = contents.desbloqueados
            contents.desbloqueados = outros
          }
        })
        throw erro
      }
    }
    // Only after the unblock takes effect here: one that failed above is not told to anyone.
    this.#enviarEstado({ t: "estado.bloqueio", bloqueio: { [address]: { bloqueado: false, at: desbloqueadoEm } } })
    // Without network, the request does not go out; the server delivers pending
    // Welcomes on each handshake, so the next connection will bring them anyway.
    await this.resyncWelcomes().catch(() => {})
  }

  // --------------------------------------------- the displayed friends list

  /**
   * Show friends a list of my friends, or stop showing (phase 5).
   *
   * Opt-in: nothing goes out without this call, and an empty list means stop showing.
   * Only live friends enter: a name that stopped being a friend meanwhile, or was
   * blocked, leaves the list silently, because the choice was to show FRIENDS and
   * they no longer are one. Duplicates count once. An empty list with none shown before
   * sends nothing: there is nothing to stop showing.
   *
   * Goes only to MY feed, which is where my friends are and no one else.
   * Never in the `profile`, which goes to all rooms.
   *
   * **Does not go out each call, and it is because of 0.5.x clients** (phase 3 review).
   * Each list is a payload they reject, and five rejected in a row in a quiet
   * feed makes them deaf: the thirty-second deafness window does not limit rhythm, just
   * duration. The choice is saved to the vault already; what goes out is
   * only the LAST one, `LISTA_MS` after the last call. And more than
   * `LISTAS_SEGUIDAS_MAX` in a row without another event in the feed do not go out: they
   * wait for the next event (`#listasSeguidas`). The promise resolves when the
   * list goes out or waits for that event.
   *
   * **A feed is of friends** (coordinator decision 20/10/2026, for the owner
   * to fix if they want). An old follower, an ex-friend whose removal failed, or
   * a blocked person with the device off can still be seated in my
   * feed, and the list would reach them. Before it goes out, whoever is there without being a friend
   * is removed (`#unseat`), old followers included. Those with a crossed request and those being
   * accepted right now stay (`#aAceitar`).
   *
   * @throws "too many friends to show" above five hundred, the schema cap:
   *   silent cut would choose who called who stays out.
   * @throws "your feed has people who are not friends" if someone who is not
   *   a friend stays in the feed (without network to remove them). Nothing goes out then.
   */
  async setShownFriends(list: readonly string[]): Promise<void> {
    if (!(await this.#guardarListaPedida(list))) return
    return this.#esperarPelaLista()
  }

  /** The choice, in the vault, now. Returns whether there is something to go out. */
  async #guardarListaPedida(list: readonly string[]): Promise<boolean> {
    const vivos = new Set(this.#amigosVivos())
    const lista = [...new Set(list)].filter((address) => vivos.has(address))
    if (lista.length > MAX_AMIGOS_MOSTRADOS) throw new Error("too many friends to show")
    const anterior = this.vault.contents.shownFriends?.[this.identity.address]
    if (lista.length === 0 && (anterior === undefined || anterior.shown.length === 0)) return false
    // Strictly above the previous: two calls in the same millisecond cannot
    // tie and leave the reader with the first.
    const updatedAt = Math.max(Date.now(), (anterior?.updatedAt ?? 0) + 1)
    await this.vault.update((contents) => {
      guardarListaMostrada(contents, { author: this.identity.address, shown: lista, updatedAt })
    })
    /*
      To the account's other devices, via the account channel, now (phase 5). The feed
      also carries it when it goes out, but only after `LISTA_MS` and never more
      than three in a row: the account channel has no 0.5.7 clients to protect.
    */
    this.#enviarEstado({ t: "estado.amigos-mostrados", shown: lista, updatedAt })
    return true
  }

  /** Waits for the list to be shown (or for its queue). See `setShownFriends`. */
  #esperarPelaLista(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.#listaEspera.push({ resolve, reject })
      this.#agendarLista(Session.LISTA_MS)
    })
  }

  /** How long to wait after the last call before the list is shown. Static for tests. */
  static LISTA_MS = 3_000
  /** How many lists in a row can be shown in the feed without another event in between. See `#listasSeguidas`. */
  static LISTAS_SEGUIDAS_MAX = 3

  #listaTimer: ReturnType<typeof setTimeout> | undefined
  #listaEspera: { resolve: () => void; reject: (erro: Error) => void }[] = []
  /**
   * How many `friends.shown` in a row have been shown in my feed with nothing else in between.
   *
   * A 0.5.x client counts each as a rejected payload, and five of them make it
   * silent. Any other event it opens (a post, a comment, a commit) resets the
   * count, and that's when it goes back to zero. Lists from my OTHER device count
   * too: for the old one they are rejected the same way. In the vault (`listasSeguidas`),
   * to survive a reload.
   */
  get #listasSeguidas(): number {
    return this.vault.unlocked ? (this.vault.contents.listasSeguidas ?? 0) : 0
  }
  set #listasSeguidas(valor: number) {
    if (!this.vault.unlocked || (this.vault.contents.listasSeguidas ?? 0) === valor) return
    this.vault.contents.listasSeguidas = valor
    this.#memoriaPorGravar = true
    this.#agendarGravacao()
  }
  /** The list was not shown because the feed already has too many lists in a row. In the vault. */
  get #listaPorEnviar(): boolean {
    return this.vault.unlocked && this.vault.contents.listaPorEnviar === true
  }
  set #listaPorEnviar(valor: boolean) {
    if (!this.vault.unlocked || this.#listaPorEnviar === valor) return
    if (valor) this.vault.contents.listaPorEnviar = true
    else delete this.vault.contents.listaPorEnviar
    this.#memoriaPorGravar = true
    this.#agendarGravacao()
  }

  #agendarLista(espera: number): void {
    if (this.#listaTimer) clearTimeout(this.#listaTimer)
    this.#listaTimer = setTimeout(() => {
      this.#listaTimer = undefined
      void this.#enviarListaMostrada()
    }, espera)
  }

  /** Nothing else in my feed but lists: a post, a commit, an event from someone else. */
  #outroEventoNoFeed(): void {
    this.#listasSeguidas = 0
    if (this.#listaPorEnviar) {
      this.#listaPorEnviar = false
      this.#agendarLista(Session.LISTA_MS)
    }
  }

  /** The list to the feed, if it can be shown. Resolves or rejects whoever was waiting. */
  async #enviarListaMostrada(): Promise<void> {
    const espera = this.#listaEspera
    this.#listaEspera = []
    try {
      await this.#listaParaOFeed(this.feedChannel, false)
      for (const quem of espera) quem.resolve()
    } catch (erro) {
      // No connection: the list did not go out but the choice is in the vault. It waits,
      // and the next connection sends it (see the end of `#handshake`).
      if (this.#connection !== "online" || (erro as Error).message === "no connection to the server") this.#listaPorEnviar = true
      for (const quem of espera) quem.reject(erro as Error)
    }
  }

  /**
   * My list to the feed: only live friends, with its `updatedAt`.
   *
   * `reemissao` is the `republishPosts`, which runs on its own when the feed grows:
   * we don't remove anyone from the feed there (a destructive automatic commit in the
   * middle of an admission), and with someone who is not a friend inside, the list
   * does not go out.
   */
  async #listaParaOFeed(feed: string, reemissao: boolean): Promise<void> {
    if (!this.vault.unlocked) return
    const minha = this.vault.contents.shownFriends?.[this.identity.address]
    if (!minha) return
    if (reemissao && minha.shown.length === 0) return
    if (!this.#groups.has(feed)) {
      if (minha.shown.length === 0) return
      await this.ensureFeed()
    }
    if (!(await this.#soAmigosNoFeed(feed, !reemissao))) {
      if (reemissao) return
      throw new Error("your feed has people who are not friends")
    }
    const vivos = new Set(this.#amigosVivos())
    const shown = minha.shown.filter((address) => vivos.has(address))
    if (this.#listasSeguidas >= Session.LISTAS_SEGUIDAS_MAX) {
      this.#listaPorEnviar = true
      return
    }
    await this.send(feed, { t: "friends.shown", shown, updatedAt: minha.updatedAt })
  }

  /** Who is in my feed and cannot read the list: not a friend, not being accepted. */
  #intrusosNoFeed(feed: string): string[] {
    const grupo = this.#groups.get(feed)
    if (!grupo) return []
    const ties = this.friendTies()
    const contas = new Set([...memberAddresses(grupo.state.ratchetTree).values()].map(String))
    contas.delete(this.identity.address)
    return [...contas].filter((conta) => {
      if (this.isBlocked(conta)) return true
      /*
        Stays who is a friend, who has a cross-request (resolves into friendship) and who
        is being accepted NOW (`#aAceitar`, between the place and the echo of the accept).
        A `request-received` alone does not (core review): it would be enough for an
        old follower to ask for friendship to keep reading the list.
      */
      const link = ties.get(conta)?.link
      return link !== "amigos" && link !== "cruzado" && !this.#aAceitar.has(conta)
    })
  }

  /** Only friends in the feed? With `tirar`, removes the others before responding. */
  async #soAmigosNoFeed(feed: string, tirar: boolean): Promise<boolean> {
    if (tirar) {
      for (const intruso of this.#intrusosNoFeed(feed)) await this.#unseat(feed, intruso).catch(() => {})
    }
    return this.#intrusosNoFeed(feed).length === 0
  }

  /**
   * The list that an account shows, if it shows it and if we are friends.
   *
   * Only live friends: whoever ended the friendship, or was blocked, stopped showing us
   * anything, and the copy that stayed in the vault is not shown. Our own is the
   * choice we made, so the interface can edit it. No overlap with my list: "mutual
   * friends" does not exist, by the owner's decision.
   */
  shownFriendsOf(address: string): { shown: string[]; updatedAt: number } | null {
    if (!this.vault.unlocked) return null
    const guardada = this.vault.contents.shownFriends?.[address]
    if (!guardada) return null
    if (address !== this.identity.address) {
      if (this.isBlocked(address) || this.friendTies().get(address)?.link !== "amigos") return null
    }
    return { shown: [...guardada.shown], updatedAt: guardada.updatedAt }
  }

  /** Remove someone from the list we show, if they are on it: one send, and only then. */
  async #tirarDaListaMostrada(address: string): Promise<void> {
    const minha = this.vault.contents.shownFriends?.[this.identity.address]
    if (!minha?.shown.includes(address)) return
    // The choice changes in the vault already; the output follows the rule of `setShownFriends`,
    // without blocking the caller (a block, a cut) for seconds of waiting.
    if (await this.#guardarListaPedida(minha.shown.filter((outro) => outro !== address))) {
      void this.#esperarPelaLista().catch(() => {})
    }
  }

  /**
   * Honor someone's departure, one at a time.
   *
   * What it does is `#unseat`; what this method adds is the queue. All members
   * receive the same `member.left` at the same instant, and if all commit the
   * removal at the same time MLS accepts one and the others end up with a state
   * nobody else has. That is the fracture, and it is silent: the room just seems
   * quiet. It is described entirely in `#answerRejoin`, which took the same hit
   * because of a rejoin request, and the fix is the same because the problem is
   * the same.
   *
   * The turn is calculated from the tree, which both sides already have equal,
   * so nobody argues over another's turn. Whoever gets to their turn and sees the
   * epoch changed knows someone ahead already did it, and does nothing.
   *
   * **Everyone waits at least one turn, including the first**, and it is the only
   * difference from `#answerRejoin`: this also runs during message recovery, and
   * committing in the middle of a batch left the rest of the batch deciphering
   * against keys that no longer exist. That is the same care the tombstone takes
   * by deferring itself, here with the clock that the queue already forces it to have.
   *
   * **Two things here are NOT proven, and they stay stated as suspicion.** The
   * test has two accounts, and with two the turn is always zero: what is measured
   * is that the leaf goes out, not that the queue prevents concurrent commits with
   * three or more members. And the recovery path - honoring a departure replayed from
   * history - also has no test. Both in `docs/PENDENTES.md`.
   */
  async #honrarSaida(channel: string, address: string): Promise<void> {
    return this.#umaDeCadaVez(`saida|${channel}|${address}`, () => this.#honrarSaidaAgora(channel, address))
  }

  async #honrarSaidaAgora(channel: string, address: string): Promise<void> {
    const group = this.#groups.get(channel)
    if (!group || address === this.identity.address) return
    // Already left, or never was. Repeating is harmless, and it needs to be: the
    // event stays in the channel and passes again on each recovery.
    if (leafIndexOf(group.state.ratchetTree, address as UserAddress) === undefined) return
    /*
      The departure is recorded HERE, on all devices that heard it, not just the
      one that won the turn to commit it (I6 of the 20/10/2026 review). It was
      only there: the other device of the same account saw the direct become one
      person, did not know why, and `#directaSozinha` would invite again whoever
      had left. In the vault, because each connection's reconciliation reads the
      same marker.
      */
    await this.vault.update((contents) => {
      contents.saidasHonradas = { ...contents.saidasHonradas, [`${channel}|${address}`]: Date.now() }
    })

    const membros = [...memberAddresses(group.state.ratchetTree).values()].map(String)
    const vez = membros.filter((membro) => membro !== address && membro < this.identity.address).length
    const epochAntes = epochOf(group)
    await new Promise((resolve) => setTimeout(resolve, (vez + 1) * REJOIN_TURN_MS))

    const agora = this.#groups.get(channel)
    if (!agora) return
    // Someone ahead of us already committed the removal. A second commit on top
    // of it is the fracture that the queue exists to prevent.
    if (epochOf(agora) !== epochAntes) return
    await this.#unseat(channel, address)
  }

  /**
   * Remove someone's leaf from one of our channels.
   *
   * The removal half that `#reseat` does before seating again, here alone
   * because ending a friendship is just that. No leaf to remove does nothing -
   * which makes repeating the operation harmless, and it needs to be: it comes
   * by a button and comes by a message from the other side.
   *
   * **Inside the group queue, since August 16th.** This used to run alongside it:
   * read the tree, ground the commit, and wrote over whatever had appeared in the
   * meantime. The `#persistGroup` is a set with no condition, so whoever writes
   * last wins and the other's work disappears - that is the third bug of
   * `#umDeCadaVezNoGrupo`, the WRITE one: a commit published and then undone
   * leaves this device one epoch behind forever. It is measured in the twin
   * of this path (`#invite`, in `session.corrida.test.ts`), which is the same
   * sequence with a server round trip in the middle widening its window.
   */
  /**
   * @param soAparelhos only the leaves of these devices (base64url of the key), not all
   *   of the account: it is the F16, the silent leaf without the healthy ones. This
   *   device's leaf never enters, because MLS does not let anyone remove themselves.
   */
  async #unseat(channel: string, address: string, soAparelhos?: readonly string[]): Promise<void> {
    /*
      The queue embraces the entire sequence - read, commit, save, publish - and
      cannot embrace less than that: it is between reading and saving that state
      is lost.
      
      **Never call this from INSIDE another pass through the queue.** It comes by
      four doors - `unfriend`, `#reseat`, `#onFriendPayload` and `#honrarSaida`
      - and the last two are born in `#applyEvent`, which also uses the queue.
      Today none of them hold it: `#applyEvent` releases it before dispatching
      the `member.left` branch, and dispatches it with `void`. Swapping that
      `void` for an `await` inside the queued block closes the queue on itself
      and the channel stops forever - it does not error, does not warn, and the
      symptom is a room that goes silent.
      */
    if (!this.#groups.has(channel)) return
    const removeu = await this.#commitar(channel, async (group) => {
      // All leaves: see `expel`. Ending a friendship by the first leaf left the other
      // end reading by the second device. No leaf - never was, or someone else removed it
      // while we waited - there is nothing to do.
      const arvore = group.state.ratchetTree
      const escolhidos = soAparelhos === undefined ? null : new Set(soAparelhos)
      const meu = toBase64(this.identity.deviceSigningPublicKey)
      const folhas = leavesOf(arvore, address as UserAddress).filter((folha) => {
        if (escolhidos === null) return true
        const chave = deviceKeyAtLeaf(arvore, folha)
        if (chave === undefined) return false
        const texto = toBase64(chave)
        return escolhidos.has(texto) && !(address === this.identity.address && texto === meu)
      })
      if (folhas.length === 0) return null
      const removal = await removeMembers(group, folhas)
      /**
       * All commits, and in order.
       *
       * A removal is two - see `removeMembers`, where it is explained why - and
       * sending only the first is the difference between a friendship ended and a
       * friendship that the interface says is ended while the person keeps reading
       * everything. This is how it appeared, with two accounts for real. Today it
       * is one, and `umSoCommit` refuses loudly the day it stops being one.
       */
      return { commit: umSoCommit(removal.commits), session: removal.session }
    })
    // Outside the queue on purpose: this triggers republishes that call `send`, and
    // `send` goes back to the queue. Inside it would be four operations waiting for a
    // turn that whoever asked them is still holding.
    if (removeu) this.#announceLocalEpoch(channel)
  }

  /**
   * Close what stayed open while this device was away.
   *
   * This is the other half of the path chosen, and the one that pays its cost:
   * whoever asked was not connected when the other accepted, and the place back
   * is given now. Reads from the vault, so the obligation survives closing the
   * app, staying months without opening it, and the acceptance notice having left
   * the memory window long ago.
   *
   * Runs after `#catchUp`, which is expected, and it is what brings the acceptance
   * that arrived in the meantime to the vault. **But does NOT run after
   * `#backfillMissed`:** that is launched with `void` two lines above, so this
   * function reads the vault before the rebuild has put anything there. What it
   * costs is one cycle of delay: a `friend.remove` recovered by backfill is
   * handled on the next connection, not this one.
   *
   * Two things, in this order. Cross-requests resolve into friendship - both asked,
   * both said yes, and waiting for a button was waiting for nothing. And then each
   * friendship made guarantees the place that goes with it in our feed - never to
   * someone whose is broken, because a broken tie does not enter `friendsOfTies`,
   * which is what stops the friendship from remaking itself behind whoever broke it.
   *
   * **What is NOT here, and why not:** there is no automatic unseating. It is said
   * entirely in the body, and the pending item is in `docs/PENDENTES.md`.
   */
  async syncFriendships(): Promise<void> {
    return this.#reconciliarAmizades(null)
  }

  /**
   * The body of `syncFriendships`, for all pairs or just one.
   *
   * Just one pair when the trigger is from that pair: a Welcome from one of its
   * directs or feeds, its presence lighting up (F9). Going through all in those
   * cases would waste a `manifest.get` and a claim per friend to fix one person.
   */
  async #reconciliarAmizades(soPar: string | null): Promise<void> {
    // Nobody blocked enters any of these steps: a block is not undone by
    // reconciliation. See `block`, and the own step below.
    const cruzados = [...this.friendTies().values()].filter(
      (tie) => tie.link === "cruzado" && (soPar === null || tie.peer === soPar) && !this.isBlocked(tie.peer),
    )
    for (const tie of cruzados) {
      try {
        await this.acceptFriend(tie.channel, tie.peer)
      } catch {
        // No network, or no key package on the other side: the next connection retries.
      }
    }

    const amigos = this.#amigosVivos().filter(
      (amigo) => (soPar === null || amigo === soPar) && !this.isBlocked(amigo),
    )
    /*
      **THERE IS NO AUTOMATIC UNSEATING HERE, and the decision is from October 6th, 2026.**
      
      There was, for a few hours: a loop that read `tie.severed` from the fold and called
      `#unseat` on each. It was removed because the condition in which the fold is wrong
      is REAL and is produced by this very code: the fold consumes by ARRAY ORDER
      (on purpose - see `foldFriendTies`), `appendHistory` pushes to the end without
      sorting, and a `friend.remove` recovered AFTER a `request`/`accept` of higher `seq`
      already saved reads as the last act of a live tie. The result was a destructive
      commit, automatic, without warning, in a friendship that did not end - and that
      `repairInvite` never restores, because a broken tie does not enter `friendsOfTies`.
      
      The disorder at the root is fixed (`#friendEvents` sorts by server `seq`), but
      a destructive automatic action does not hang on top of a fix from the same round:
      it needs its own proof. What prompted the request - a `friend.remove` recovered
      by backfill staying forever without effect on this side - goes back to open, and
      is recorded in `docs/PENDENTES.md` with the exact condition.
      
      What CONTINUES to cut it is the live path (`#onFriendPayload`), which does not
      depend on any fold: it is an event authenticated by MLS, handled once, when it arrives.
      */
    /**
     * The directs, for the same reason as the feeds.
     *
     * Whoever loses their place in a one-on-one has no other door: the server only
     * lets you open a direct that was never used, the "add" in the interface excludes
     * directs, and place repair only ran on feeds. On October 18th, 2026 the
     * production base had four directs with only one person subscribed, and because
     * friendship requests travel inside the direct, whoever was left out received no
     * request and each send of theirs brought a silent refusal.
     *
     * By the same `repairInvite`, with the same six-hour brake per person and channel:
     * whoever is already reading is not touched ("live"), whoever has no place gets a
     * new Welcome, and a device with no leaf gets only what is missing.
     *
     * Only live ties. A broken friendship, or a request that never existed, gives no
     * place: reseating whoever cut would undo the cut on top of it.
     */
    const lacos = this.friendTies()
    for (const [channel, group] of this.#groups) {
      if (!this.#eDirecta(channel)) continue
      const peer = this.#parDoCanal(channel)
      if (!peer) continue
      if (soPar !== null && peer !== soPar) continue
      const tie = lacos.get(peer)
      /**
       * A direct opened by "Message", with no friendship request, has no tie at all,
       * and that was exactly the one left out: on October 19th, 2026 the four directs
       * stuck in production were from people who had never been friends. The only
       * direct that is not repaired is one from a broken friendship: reseating whoever
       * cut would undo the cut.
       */
      if (tie?.severed || this.isBlocked(peer)) continue
      /**
       * Only those who do NOT have a leaf. A seated pair that has not yet spoken is
       * not a dead place: in a direct with a pending request, the other side might
       * simply be away for two days. `seat` would treat them as silent with proof
       * of life (our own send counts as the channel's sender, see `#recordPayload`)
       * and would do a `#reseat` every six hours: would remove their leaf, burn their
       * key packages, and when they returned, leave them without everything that had
       * been encrypted before. Caught in the October 19th, 2026 review, before it
       * happened to anyone.
       */
      const sentado = [...memberAddresses(group.state.ratchetTree).values()].map(String).includes(peer)
      if (sentado) {
        // Back here (opened the direct again): their departure is over.
        if (this.#saiuPorVontade(channel, peer)) {
          await this.vault.update((contents) => {
            if (contents.saidasHonradas) delete contents.saidasHonradas[`${channel}|${peer}`]
          })
        }
        continue
      }
      // Left by their choice: reseating them would undo their departure (I6).
      if (this.#saiuPorVontade(channel, peer)) continue
      try {
        /**
         * The request that went out before the other had a place is not read: a
         * message before someone's seat stays behind by design (`anteriorAoNossoLugar`).
         * Measured on October 18th, 2026. It would repeat here, just after seating
         * the person; since October 20th whoever repeats it is the growth of the direct
         * (`#agendarUltimoActo`), which runs in this case and in all others where
         * someone comes in late, and repeats the act that counts (request, accept
         * or cut) not just the request. Repeating it here too would send two.
         */
        await this.repairInvite(channel, peer)
      } catch {
        // Away, or no key packages: the next connection tries again.
      }
    }

    /**
     * The feeds of whoever ended the friendship, or of whoever we ended it with (F5).
     *
     * We still have their feed group: either our departure did not go out (no network
     * in `unfriend`), or the cut came from recovery, which does not react to friendship
     * events. We ask for departure ourselves, with `member.left`, and they honor it
     * live and in recovery. This removes OUR access and nothing else: automatic unseating
     * of others stays out, for the reason written above.
     */
    for (const tie of lacos.values()) {
      if ((!tie.severed || tie.link === "amigos") && !this.isBlocked(tie.peer)) continue
      if (soPar !== null && tie.peer !== soPar) continue
      const feedDele = this.#feedDe(tie.peer)
      if (!feedDele || !this.#groups.has(feedDele)) continue
      try {
        await this.#sairDoFeedDe(tie.peer)
      } catch {
        // No network: the next pass asks again.
      }
    }

    /**
     * An accept to a request we withdrew, arrived by recovery (core review). Live
     * it is `#onFriendPayload` that answers; what came from behind stays for here:
     * tie in "none", my last act in the direct is a `withdrawn` and theirs, AFTER
     * that, a `friend.accept`. It is a 0.5.x client that gave us a place in their
     * feed: the cut, and get out of there.
     */
    for (const tie of lacos.values()) {
      if (soPar !== null && tie.peer !== soPar) continue
      if (tie.link !== "nenhum" || tie.severed || this.isBlocked(tie.peer)) continue
      if (!this.#aceiteOrfao(tie.channel, tie.peer)) continue
      try {
        await this.#sendPayload(tie.channel, { t: "friend.remove", removedAt: Date.now() })
        await this.#sairDoFeedDe(tie.peer)
      } catch {
        // No network: the next pass sees the same thing and tries again.
      }
    }

    /**
     * What a block left undone, no network (phase 3).
     *
     * This is not the automatic unseating that the note above refuses: that would read the fold,
     * which can be wrong. This reads the blocked list, which is an explicit decision
     * by whoever uses this device, stored in their vault. Removing it from
     * my feed and breaking the link fulfills that decision all the way through.
     */
    for (const { address } of this.blocked()) {
      if (soPar !== null && address !== soPar) continue
      const meuFeed = this.#groups.get(this.feedChannel)
      try {
        if (meuFeed && leavesOf(meuFeed.state.ratchetTree, address as UserAddress).length > 0) {
          await this.#unseat(this.feedChannel, address)
        }
        await this.#cortarComBloqueado(address)
        await this.#tirarDaListaMostrada(address)
      } catch {
        // No network: the next pass tries again.
      }
    }

    if (amigos.length === 0) return
    const feed = await this.ensureFeed()
    for (const amigo of amigos) {
      try {
        // Through the brake, not around it: each attempt costs a key package
        // from someone who may not be here to replace them, and this runs at every
        // connection. `repairInvite` does nothing to those already reading.
        await this.repairInvite(feed, amigo)
      } catch {
        // Away, or no key packages: the next connection tries again.
      }
    }
  }

  /**
   * What this device does, live, with a friendship event that arrives.
   *
   * Live only: during message recovery these events all pass through
   * again, and reacting to each would do work for states that were already
   * replaced, a `friend.accept` followed, further along in the same
   * recovery, by the `friend.remove` that undid it. What handles what came before
   * is `syncFriendships`, which runs once over the final state.
   */
  async #onFriendPayload(channel: string, sender: string, payload: Payload): Promise<void> {
    if (payload.t === "friend.accept") {
      // They accepted our request: the slot back is now. The fold decides
      // whether the acceptance is good, one nobody asked for is not worth a slot.
      if (this.friendTies().get(sender)?.link !== "amigos") {
        /*
          An accept to a request we withdrew: it's a 0.5.x client, which read the
          cancellation as no refusal and kept seeing the request (see
          `docs/PENDENTES.md`). On their side the friendship was made and our
          slot in their feed given. We respond with the break, directly, and
          leave their feed: the old one stays "undone" and takes our slot.
        */
        const ultimo = this.#meusActosNoCanal(channel).pop()?.payload
        if (ultimo?.t === "friend.decline" && ultimo["withdrawn"] === true) {
          const directa = this.#eDirecta(channel) ? channel : this.#directaViva(sender)
          if (directa) await this.#sendPayload(directa, { t: "friend.remove", removedAt: Date.now() })
          await this.#sairDoFeedDe(sender).catch(() => {})
        }
        return
      }
      await this.acceptFollower(sender)
    } else if (payload.t === "friend.request") {
      const laco = this.friendTies().get(sender)?.link
      // They asked us after we already asked them: both sides said yes.
      if (laco === "cruzado") await this.acceptFriend(channel, sender)
      /**
       * Someone we're already friends with asks us for friendship: they lost the
       * state on their side (F4, 20/10/2026). They joined the direct late, or their vault
       * cut off the accept, and for them we're in "none". We respond with the
       * accept, which they read against the request they just made.
       *
       * Safe on our side by design: the fold only lets our accept count
       * against their open request, and a request to someone who's already a friend
       * opens nothing (`foldFriendTies`). Once per pair every ten
       * minutes, so a client that repeats requests doesn't get free echo.
       */
      else if (laco === "amigos" && !this.#desfeitaNoutroAparelho(channel) && this.#podeAgora(this.#aceitesReenviados, sender, REPARAR_PAR_MS)) {
        // The same timestamp as the accept we already gave, if there is one in this direct: it's the
        // same act stated again, not a new act for the bell (I5).
        const anterior = this.#meusActosNoCanal(channel).filter((entrada) => entrada.payload.t === "friend.accept").pop()
        const acceptedAt = typeof anterior?.payload["acceptedAt"] === "number" ? anterior.payload["acceptedAt"] : Date.now()
        await this.#sendPayload(channel, { t: "friend.accept", acceptedAt })
      }
    } else if (payload.t === "friend.decline" && payload.withdrawn === true) {
      /**
       * They withdrew the request they made us: the interface removes it from the bell.
       *
       * A notice, not a notification: nobody is notified that they no longer have
       * a request, and a refusal does not notify either. Live only, like this whole
       * method; when opening the app, the bell rebuilds from the fold, and a
       * cancelled request is no longer there.
       */
      this.emit("status", {
        detail: "friend request withdrawn",
        level: "info",
        code: "friend-withdrawn",
        route: "log",
        channel,
        actor: sender,
      })
    } else if (payload.t === "friend.remove") {
      // They ended the friendship. They already removed our slot from their feed; this is the
      // other side of the same break, and without it the friendship would stay half-undone, // with this person still able to read everything we publish.
      await this.#unseat(await this.ensureFeed(), sender)
      // And the friends list we show stops naming them.
      await this.#tirarDaListaMostrada(sender).catch(() => {})
    }
  }

  /** When we responded with accept to a request from someone already a friend, per pair. See `#onFriendPayload`. */
  #aceitesReenviados = new Map<string, number>()
  /** Resends of the last act to do, per direct. See `#agendarUltimoActo`. */
  #ultimosActosAgendados = new Map<string, ReturnType<typeof setTimeout>>()

  /** Is there a friendship act of ours on the way in this direct, still outside the vault? See `#reenviarUltimoActo`. */
  #actoEmVoo(channel: string): boolean {
    if (this.#emCurso.has(`friend|${channel}`) || this.#emCurso.has(`cancelar|${channel}`)) return true
    const marcas = this.vault.contents.livroPorConfirmar ?? {}
    return Object.values(marcas).some((marca) => marca.channel === channel && isFriendPayload(marca.payload))
  }

  /** Our friendship acts in this channel, in server order. */
  #meusActosNoCanal(channel: string): StoredChatMessage[] {
    return this.#porOrdemDoServidor(entradasDoCanal(this.vault.contents, channel)).filter(
      (entrada) => entrada.sender === this.identity.address && isFriendPayload(entrada.payload),
    )
  }

  /**
   * Did another device of ours undo this friendship after the last accept (M3)?
   *
   * The fold would say it in most cases; this guards the automatic accept
   * against the window where the break from the other device entered the vault
   * with `seq` above the accept and the fold does not yet have it as the last act.
   */
  #desfeitaNoutroAparelho(channel: string): boolean {
    const meus = this.#meusActosNoCanal(channel)
    const ultimoAceite = meus.filter((entrada) => entrada.payload.t === "friend.accept").pop()
    return meus.some((entrada) => entrada.payload.t === "friend.remove" && entrada.seq > (ultimoAceite?.seq ?? -1))
  }

  /** If an action blocked by `key` can run now, and marks it if it can. */
  #podeAgora(marcas: Map<string, number>, chave: string, intervaloMs: number): boolean {
    const agora = Date.now()
    const ultima = marcas.get(chave)
    if (ultima !== undefined && agora - ultima < intervaloMs) return false
    marcas.set(chave, agora)
    return true
  }

  /**
   * How long to wait, after a direct grows, before repeating the last act.
   *
   * A reseat is two commits (remove and add), and a recovery can bring
   * several in a row. Waiting a bit joins them into one resend, done when the
   * tree has stopped. Static so tests can shorten it.
   */
  static REENVIO_MS = 1_000

  /**
   * Who joins a direct late reads the friendship state (F4, 20/10/2026).
   *
   * A message said before someone has a slot is not read on their side (persistent
   * secrecy). The request, accept or break that left while
   * the other was out of the tree, or in a dead slot, were lost to them:
   * both sides diverged and nothing brought them back together. Now, when the
   * direct grows, each side repeats its last act that matters, encrypted in the
   * new epoch, which whoever just joined reads.
   *
   * Scheduled, not immediate: see `REENVIO_MS`. Direct only, because that's where the
   * state of a friendship lives and has only one destination.
   */
  #agendarUltimoActo(channel: string): void {
    if (!this.#eDirecta(channel)) return
    const anterior = this.#ultimosActosAgendados.get(channel)
    if (anterior) clearTimeout(anterior)
    this.#ultimosActosAgendados.set(
      channel,
      setTimeout(() => {
        this.#ultimosActosAgendados.delete(channel)
        void this.#reenviarUltimoActo(channel).catch((erro: unknown) => this.#falhaDeLugar(channel, "reenvio do estado da amizade", erro))
      }, Session.REENVIO_MS),
    )
  }

  /**
   * Our last act in this direct, again, if it's still true.
   *
   * Only if the fold on this side confirms it, and that's what makes it safe: a
   * request that was already refused does not repeat (would reopen it), an accept only repeats
   * with the friendship made, a break only with the link undone. A refusal does not repeat:
   * it closes a request that, for whoever joined late, never was open.
   */
  async #reenviarUltimoActo(channel: string): Promise<void> {
    if (!this.#groups.has(channel) || !this.vault.unlocked) return
    const par = this.#parDoCanal(channel)
    if (!par) return
    /*
      An act of ours on the way in this direct (a request, an accept, a
      cancellation waiting for echo) is not yet in the vault, and the "last act"
      read now would be the one before it. That's how a cancellation got lost
      (e2e-amizade-ui, 20/10/2026): the resend read the request as last,
      repeated it after the cancellation, and the request reopened on both sides. With
      an act in flight, we wait and try again.
    */
    if (this.#actoEmVoo(channel)) {
      this.#agendarUltimoActo(channel)
      return
    }
    const meus = this.#meusActosNoCanal(channel)
    const ultimo = meus[meus.length - 1]?.payload
    const laco = this.friendTies().get(par)
    if (!ultimo || !laco) return
    /*
      The ORIGINAL payload, with the timestamp of when it was made (I5 of the revision). A
      new timestamp at each resend was a new act for the interface, which does the
      notification by timestamp (`facc:${canal}:${acceptedAt}`): each direct
      growth touched the bell again for the same friendship.
    */
    /*
      A cancellation repeats as an act, only with the link in "none" (phase 1
      of the friendship plan). Whoever joined late may have read the request and not the
      cancellation, and was left with an open request that no longer exists. In no other
      state: if they meanwhile asked, the loop is "request-received", and a
      repeated cancellation in a 0.5.x client (which reads refusal) would close
      their request, which nobody refused.
    */
    const repetivel =
      (ultimo.t === "friend.request" && laco.link === "pedido-enviado") ||
      (ultimo.t === "friend.accept" && laco.link === "amigos") ||
      (ultimo.t === "friend.remove" && laco.severed) ||
      (ultimo.t === "friend.decline" && ultimo["withdrawn"] === true && laco.link === "nenhum" && !laco.severed)
    if (repetivel) await this.#sendPayload(channel, structuredClone(ultimo) as unknown as Payload)
  }

  // ------------------------------------------- invites to a channel

  /**
   * To invite is to send an invite. To enter is another act, and it belongs to the inviter.
   *
   * The design is the same as friendship, and it's the design that encryption forces. Nobody
   * enters a group MLS on their own: for someone to be admitted, a member has to
   * commit the add and send them a welcome. So "only by accepting do they join" cannot
   * be the person admitting themselves, what can be, and is what's here, is the invite
   * being a MESSAGE, accepting being saying yes, and the admission being a second act
   * by the device of whoever invited.
   *
   * The invite travels in the direct conversation of the two, not in a room or on the
   * server. Three reasons, and all three count:
   *
   * 1. It's where the person will look. A direct conversation appears on the
   *    Friends page, rises to the top of the list when something arrives there, and gets read. An
   *    invite that lands somewhere nobody visits is an invite that never arrives.
   * 2. It has only one recipient, and authenticated by MLS. The fold knows who the
   *    invite is from without trusting any field written by the sender.
   * 3. It costs nothing to an old client. See `ChannelInvite` in the protocol:
   *    this travels inside `message`, not as a new `t` that an outdated client
   *    would discard, counting ignored events until they declare the
   *    channel deaf, which triggers a reseat and takes history with it.
   *
   * **The cost, stated because it's real:** time can pass between accepting and being admitted.
   * Whoever accepts does not enter that instant; they enter when the device of
   * whoever invited them is online to commit it, live if they're here now, and otherwise
   * in the reconciliation of the next connection (`syncChannelInvites`),
   * which reads from the vault, not from memory. It's the same truth that Friends already tells
   * whoever accepts a request with the other person offline, and it says it in the same
   * words instead of pretending it's instant.
   *
   * Only whoever invited can admit, not any member. Any member has no way to know
   * the invite existed, it travelled in a conversation they don't belong to, and the
   * alternative was a rejoin request giving entry to someone who was never in the channel, which is
   * exactly the gap that `#answerRejoin` closed. Between an accept authenticated by MLS
   * and a message authenticated only by the server's word, use the first.
   */

  /**
   * All the invite messages this device has saved, in order of
   * arrival.
   *
   * Comes from the vault, not from memory, for the same reason as `#friendEvents`: what
   * decides if someone enters a channel has to survive closing the app,
   * which is precisely when an accept arrives and nobody is watching.
   *
   * **And in SERVER order within each channel** (`#porOrdemDoServidor`),
   * like friendships and with more reason: this fold decides who enters
   * a channel, and a response read before the invite it answers is discarded
   * forever by the `if (!tie) continue` in `foldInviteTies`.
   */
  #inviteEvents(): InviteEvent[] {
    const eventos: InviteEvent[] = []
    for (const channel of canaisComEntradas(this.vault.contents)) {
      for (const entrada of this.#porOrdemDoServidor(entradasDoCanal(this.vault.contents, channel))) {
        // The vault stores payloads with no guaranteed shape (a newer version may have
        // written them). We narrow here to what the fold reads.
        const convite = entrada.payload["invite"]
        const resposta = entrada.payload["inviteReply"]
        const payload: InviteEvent["payload"] = {
          t: entrada.payload.t,
          ...(convite && typeof convite === "object" ? { invite: convite as InviteEvent["payload"]["invite"] } : {}),
          ...(resposta && typeof resposta === "object"
            ? { inviteReply: resposta as InviteEvent["payload"]["inviteReply"] }
            : {}),
        }
        if (!isInvitePayload(payload)) continue
        eventos.push({ channel, sender: entrada.sender, payload })
      }
    }
    return eventos
  }

  /** The state of each invite, folded from the messages that made it. */
  channelInvites(): Map<string, InviteTie> {
    // The peer of each direct comes from the vault record, not from the shape: with
    // opaque addresses the address no longer says who's there (1.0 "Arca", slice 2).
    return foldInviteTies(this.#inviteEvents(), this.identity.address, Date.now(), (canal) => {
      const ficha = this.fichaDoCanal(canal)
      return ficha.tipo === "directa" && ficha.par ? [this.identity.address, ficha.par] : null
    })
  }

  /** The invites made to me that still wait for my answer. */
  pendingChannelInvites(): InviteTie[] {
    return pendingInvitesOf(this.channelInvites())
  }

  async #inviteToChannel(channel: string, address: string, note?: string, extra: { sucessao?: string } = {}): Promise<void> {
    // The direct conversation is created on first use, and the other person
    // enters it by being half the channel, it's not an invite. See `openDirect`.
    const dm = await this.openDirect(address)

    /**
     * Inviting twice does not make two invites.
     *
     * The truth is in the history, not in a variable: it survives restarting the
     * app, which is precisely when an impatient person tries again. An invite still
     * pending, waiting for response, or already accepted and waiting for the
     * slot, blocks the next one. A refused or expired one does not: trying again later
     * is a new invite, not insistence on the same one.
     */
    const aberto = this.channelInvites().get(inviteKey(channel, address))
    if (aberto?.mine && (aberto.state === "pendente" || aberto.state === "aceite")) return

    /**
     * The channel name, and the same resource the interface uses when there isn't one.
     *
     * A channel created by the app does not publish any introduction, the name
     * the person wrote becomes an identifier and nothing else, and without this resource
     * the invite would say "I invite you to !lagar-do-ze:orwell.pt", which is
     * channelizing turned into prose. See `shortName` in the interface: it's the same
     * rule, and has to stay that way.
     */
    const nome = this.spaceMeta(channel)?.name ?? channel.replace(/^!/, "").split(":")[0]
    const onde = nome ? `"${nome}"` : channel
    /**
     * The body is written to read on its own.
     *
     * In a client that knows the `invite` field, this comes with the
     * accept and decline buttons. In one that doesn't, this sentence remains, and the person
     * knows they were invited and by whom, instead of getting an
     * empty message or nothing at all.
     */
    const corpo = note?.trim() ? `Convido-te para ${onde}.\n\n${note.trim()}` : `Convido-te para ${onde}.`
    await this.send(dm, {
      t: "message",
      id: crypto.randomUUID(),
      sentAt: Date.now(),
      body: corpo,
      attachments: [],
      links: [],
      mentions: [],
      invite: { channel, at: Date.now(), ...(nome ? { name: nome } : {}), ...(extra.sucessao ? { sucessao: extra.sucessao } : {}) },
    })
  }

  /**
   * Accept an invite. This is the only path by which an invite is accepted.
   *
   * It's unique on purpose, like `acceptFriend`: you accept from the conversation and from
   * the notification center, and a second path would diverge from the first
   * at the first change, and what diverges here is not a label, it's who enters
   * which channel.
   *
   * Does not resolve until the response is actually sent. The caller relies
   * on this to only remove the invite from the screen after it's done: an invite
   * that disappears by optimism and fails next leaves no trace anywhere,    * whoever invited stays waiting forever, and whoever accepted thinks they did.
   *
   * What this does NOT do is enter the channel, because it can't. See the section note.
   */
  async acceptChannelInvite(dmChannel: string, target: string): Promise<void> {
    return this.#umaDeCadaVez(`convite|${target}|${dmChannel}`, () =>
      this.#answerChannelInvite(dmChannel, target, true),
    )
  }

  /**
   * Decline an invite.
   *
   * Gives no access, in any sense. What it does is close the invite: it leaves
   * the screens on this side because the fold stops counting it, and leaves the other side
   * because whoever invited stops waiting for an answer that won't come,    * and can invite again later, something an eternally pending invite denied them. It's the same
   * choice that `declineFriend` makes, and for the same reason.
   */
  async declineChannelInvite(dmChannel: string, target: string): Promise<void> {
    return this.#umaDeCadaVez(`convite|${target}|${dmChannel}`, () =>
      this.#answerChannelInvite(dmChannel, target, false),
    )
  }

  async #answerChannelInvite(dmChannel: string, target: string, accepted: boolean): Promise<void> {
    const tie = this.channelInvites().get(inviteKey(target, this.#parDoCanal(dmChannel) ?? ""))
    // Responding to an invite that doesn't exist is responding to nothing, and the fold
    // on the other side would discard the response anyway. Saying so is better than
    // sending a message nobody will read as a response.
    if (!tie || tie.mine || tie.target !== target) throw new Error("that invite no longer exists")
    if (tie.state === "caducado") throw new Error("that invite expired")
    // Already answered: clicking twice does the same as clicking once, and a
    // second response would not undo the first on the other side.
    if (tie.state !== "pendente") return

    const onde = tie.name ? `"${tie.name}"` : target
    /**
     * The response is visible, and this is where it diverges from friendship.
     *
     * A `friend.decline` is not seen: it closes the request and nothing else, and discretion
     * is possible because the REQUEST is also invisible, it's not a sentence, it's an
     * act. Here the invite is a private message, written and read as a
     * message; a conversation where one side speaks and the other's response is
     * invisible is not a conversation. And there's a gain that discretion cost: whoever
     * invited tells a "no" from silence, instead of simply watching the invite
     * disappear.
     *
     * The decline is stated as the button that makes it, "not now", and not as a
     * judgment about the channel or about whoever invited.
     */
    await this.send(dmChannel, {
      t: "message",
      id: crypto.randomUUID(),
      sentAt: Date.now(),
      body: accepted ? `Aceitei o convite para ${onde}.` : `Por agora não vou entrar em ${onde}.`,
      attachments: [],
      links: [],
      mentions: [],
      inviteReply: { channel: target, accepted, at: Date.now() },
    })
  }

  /**
   * Fulfill the seat that an acceptance left pending.
   *
   * Idempotent by design, and must be: arrives via a live message and via
   * reconciliation of each connection. Whoever is already there does not get
   * invited again, `#invite` refuses them, and refusing would be an error
   * that spreads for nothing.
   */
  /**
   * Accept on its own the invite to whoever succeeded a merged account (phase 8.2).
   *
   * It is the "the main account's device requests entry on its own" from the plan.
   * Only when all three come together: the invite is for this account and is
   * unanswered; it says it is for whoever succeeded @secondary; and this account
   * really did merge @secondary (the `conta.juntadas` preference, which travels to
   * all devices of the account through the account channel). A succession invite
   * for an account we did not merge is an invite like any other, and waits for
   * a tap.
   */
  async #aceitarConviteDaSucessao(tie: InviteTie): Promise<void> {
    if (tie.mine || tie.state !== "pendente" || !tie.sucessao) return
    if (!contasJuntadas(this.preferencias()).includes(tie.sucessao)) return
    await this.acceptChannelInvite(tie.channel, tie.target)
  }

  async #honourInvite(tie: InviteTie): Promise<void> {
    if (!tie.mine || tie.state !== "aceite") return
    const group = this.#groups.get(tie.target)
    // We are no longer members of the channel: there is no seat we can give.
    if (!group) return
    if (!(await this.#haLugarPorDar(group, tie.peer))) return
    /**
     * The authority is read AGAIN, at the moment of the act.
     *
     * Days pass between inviting and admitting, and in those days the authority
     * to invite may have been withdrawn. Admitting anyway would publish a
     * seat that this client no longer has the power to give, and would do so
     * alone, with no one clicking anything. When this happens the invite
     * remains unfulfilled and eventually expires, which is the honest way out: the
     * "expired" state appears on both sides and we invite whoever can.
     */
    if (!this.may(tie.target, "convidar")) return
    await this.#seatInvite(tie.target, tie.peer)
  }

  /**
   * What this device does, live, with a response to an invite.
   *
   * Live only, for the same reason as `#onFriendPayload`: during message recovery
   * these events all pass through again, and reacting to each would do work for
   * states already replaced. Whoever handles what came before is `syncChannelInvites`,
   * which runs once on the final state.
   */
  async #onInvitePayload(dmChannel: string, sender: string, payload: Payload): Promise<void> {
    if (payload.t !== "message") return
    // An invite for whoever succeeded an account that THIS account merged (phase 8.2).
    if (payload.invite?.sucessao) {
      const tie = this.channelInvites().get(inviteKey(payload.invite.channel, sender))
      if (tie) await this.#aceitarConviteDaSucessao(tie)
      return
    }
    const resposta = payload.inviteReply
    if (!resposta?.accepted) return
    // The fold decides whether the acceptance counts, one that nobody invited does not
    // earn a seat, and an expired invite does not either.
    const tie = this.channelInvites().get(inviteKey(resposta.channel, sender))
    if (!tie || tie.channel !== dmChannel) return
    await this.#honourInvite(tie)
  }

  /**
   * Close invites that remained open while we were away.
   *
   * This is the other half of the design, and it pays the cost: whoever invited
   * was not connected when the other accepted, and the seat is given only now. Reads from
   * the vault, so the obligation survives closing the app and the acceptance
   * notice leaving the memory window long ago.
   *
   * Runs after message recovery on purpose: it is what brings the acceptance
   * that arrived in the meantime into the vault. Before that, there would be
   * nothing to read.
   */
  async syncChannelInvites(): Promise<void> {
    // Invites for whoever succeeded a merged account, that arrived while
    // this device was away (phase 8.2). See `#aceitarConviteDaSucessao`.
    for (const tie of this.pendingChannelInvites()) {
      await this.#aceitarConviteDaSucessao(tie).catch(() => {})
    }
    for (const tie of acceptedInvitesOf(this.channelInvites())) {
      try {
        await this.#honourInvite(tie)
      } catch {
        // No network, or no key package on the other side: the next connection retries.
        // And if it never succeeds, the invite expires, see `INVITE_TTL_MS`.
      }
    }
  }

  /**
   * The direct channel with one person, created on first use.
   *
   * The address is `moradaDirecta` (1.0 "Arca", slice 3): the digest of the DH of the two
   * account keys. Both sides arrive at the same address without talking, and the server
   * cannot compute it. If both open at the same instant, the debut
   * is arbitrated on the server (1g, `#esperarSePerdeuAEstreia`): with an opaque
   * address, the debut goes to whoever asks first.
   */
  async openDirect(address: string): Promise<string> {
    // Opening a direct to someone we blocked would give them a new seat. See `block`.
    if (this.isBlocked(address)) throw new Error("that person is blocked")
    // The opaque address (1.0 "Arca", slice 3): the one the vault already knows, or the DH
    // of the two account keys. See `#moradaDaDirectaCom`.
    const { morada: channel, reclamados } = await this.#moradaDaDirectaCom(address)
    // One at a time per channel: two clicks ("Message" and "Request friend",
    // or a double click) would create two groups and the second would refound the channel
    // on the server with the Welcome of the first already on its way to the peer.
    await this.#umaDeCadaVez(`dm|${channel}`, async () => {
      /*
        Phase 1g: the debut is claimed on the server BEFORE creating the group.

        Without this, both sides opening the direct at the same instant (two crossed
        friend requests) would each create their own MLS group with the same name, and
        each would write to theirs without the other reading it. The server already arbitrates
        the debut of a channel (`channel.claim`): the first to ask keeps it.
        Whoever loses creates nothing and waits for the Welcome from the winner.
      */
      /*
        A device without the account key only knows addresses that already exist (the slip
        came via the vault): the group belongs to the device that created it, and this one enters
        via Welcome. Creating a second group here at the same address would refound an
        opaque direct, which the server refuses (slice 4). We wait for the Welcome,
        and then request a seat, like whoever loses the debut.
      */
      if (!this.#groups.has(channel) && !this.temChaveDeConta) {
        await this.#esperarPeloGrupo(channel)
        if (!this.#groups.has(channel)) throw new Error("this device has not received this conversation yet")
        return
      }
      if (!this.#groups.has(channel)) await this.#esperarSePerdeuAEstreia(channel, address)
      const group = this.#groups.get(channel)
      if (!group) {
        this.#fichaAoNascer.set(channel, { tipo: "directa", par: address })
        await this.createSpaceChannel(channel)
        // A conversation between two has no roles, and the second person is not an
        // invite: they are half the channel. See `invite`.
        try {
          await this.#seatInvite(channel, address, reclamados)
        } catch (erro) {
          /*
            F12: the other side opened the same direct at the same time, and their Welcome
            arrived between creating and sitting. We ended up in their group, where they already
            are: there is nothing to sit, and the direct is open. See the tiebreak
            in `#acceptWelcome`.
          */
          if ((erro as Error).message === "that person is already in this channel") return
          throw erro
        }
        return
      }
      /**
       * The group exists and the peer is not there: the first opening created the channel and
       * seating failed (no keys from the other side, for example), and later openings
       * returned the channel without trying again. Everything written there
       * stayed unreadable to the other, silently (October 19, 2026). Through
       * `repairInvite`, with a six-hour brake: a repeated click does not spend
       * anyone's keys.
       */
      const sentado = [...memberAddresses(group.state.ratchetTree).values()].map(String).includes(address)
      if (!sentado) await this.repairInvite(channel, address).catch(() => {})
    })
    return channel
  }

  /**
   * How long whoever lost the debut of a direct waits for the Welcome from
   * whoever won it, on each of the two attempts. Static for tests.
   *
   * The winner still has to claim the other side's keys and make the commit,
   * and that can take up to three attempts of 1.5 s (`#reclamarPacotes`).
   */
  static ESPERA_DA_ESTREIA_MS = 8_000

  /**
   * Phase 1g: claim the debut of the direct and, if it goes to the peer, wait
   * for their Welcome instead of creating a second group with the same name.
   *
   * Two attempts: the first waits; the second requests a seat (`requestRejoin`),
   * in case the winner created the group and could not seat us. If both fail,
   * the caller creates the group as before: a direct that never opens is worse
   * than a race, and the leftover race is resolved in the tiebreak of `#acceptWelcome`.
   *
   * A server without the capability, or that does not respond to `channel.claim`,
   * allows creation: it is the behavior before this phase.
   */
  /**
   * Wait for a channel's Welcome, then request a seat and wait again.
   * See `ESPERA_DA_ESTREIA_MS`. `pedirJa`: the channel was already used and no Welcome
   * is on the way, so the seat request goes right away.
   */
  async #esperarPeloGrupo(channel: string, pedirJa = false): Promise<void> {
    const entrou = (): boolean => this.#groups.has(channel)
    for (let tentativa = 0; tentativa < 2 && !entrou(); tentativa++) {
      if (tentativa > 0 || pedirJa) this.requestRejoin(channel)
      const fim = Date.now() + Session.ESPERA_DA_ESTREIA_MS
      while (!entrou() && Date.now() < fim) await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  async #esperarSePerdeuAEstreia(channel: string, par: string): Promise<void> {
    // Only against a server that arbitrates the debut between the two accounts of the name.
    // See `CAPACIDADE_ESTREIA_DA_DIRECTA`.
    if (!this.#serverCapabilities.includes(CAPACIDADE_ESTREIA_DA_DIRECTA)) return
    let resposta: ServerFrame
    try {
      this.#send({ t: "channel.claim", channel })
      resposta = await this.#await("channel.claim.result")
    } catch {
      return
    }
    if (resposta.t !== "channel.claim.result" || resposta.channel !== channel) return
    // The debut is ours (or our other device's, which has the same address):
    // we create it. An already used channel with our debut is a lost state, and
    // `createSpaceChannel` handles it as it always has.
    if (resposta.mine) {
      /*
        Slice 3: an opaque direct already used, whose group this device lost (a
        `forgetChannel`, a restored vault). Creating would refound it, and the server
        does not allow that (no one refounds an opaque address, slice 4). We request a seat
        from the peer, as in a room. Without a response, the conversation waits for them.
      */
      if (eMoradaOpaca(channel) && resposta.empty === false) {
        await this.#esperarPeloGrupo(channel, true)
        if (!this.#groups.has(channel)) throw new Error("this conversation is waiting for the other person")
      }
      return
    }
    // The debut belongs to a different account than the peer: no Welcome is coming.
    if (resposta.owner !== par) return
    await this.#esperarPeloGrupo(channel, eMoradaOpaca(channel) && resposta.empty === false)
    if (!this.#groups.has(channel)) {
      this.emit("status", {
        detail: `${channel}: o Welcome de quem abriu a conversa não chegou a tempo; esta conversa foi criada deste lado`,
        level: "info",
        code: "directa-sem-estreia",
        route: "log",
        channel,
      })
    }
  }

  // --------------------------------------------------------------- catch-up

  /**
   * Replay everything that happened while this device was away.
   *
   * Not a history feature — a correctness one. A membership commit issued while
   * we were offline is never delivered live, and without it the group stays on
   * an old epoch: every subsequent message fails to decrypt, for good, and the
   * app simply appears to have stopped working. Ordinary messages arriving out
   * of order are recoverable; a missed commit is not.
   *
   * Events are applied strictly in `seq` order, because that is the order the
   * server assigned and the order commits must be applied in.
   */
  async #catchUp(channels: string[]): Promise<void> {
    for (const channel of channels) {
      // One channel per try: a vault that refuses a write must cost that
      // channel its replay and nothing more. Nineteen healthy channels used
      // to be abandoned because the twentieth was broken — and the twentieth
      // was replayed first again on the next attempt.
      try {
        await this.#catchUpChannel(channel)
      } catch (error) {
        this.emit("status", {
          detail: `${channel}: recuperação interrompida (${(error as Error).message})`,
          level: "error",
          code: "catchup-failed",
          route: "log",
          channel,
        })
      }
    }
  }

  /**
   * Recover a channel, one recovery at a time per channel.
   *
   * **A second call with one already running does not wait for it: asks it for
   * another pass and leaves.** Waiting would lock itself: a Welcome that arrives
   * INSIDE a recovery page makes `#acceptWelcome` recover the same channel, and
   * the recovery is the one waiting for that Welcome. The extra pass starts at
   * the anchor the first one left, so it sees what it could not see.
   *
   * Two running at the same time on the same channel, what happened before, would ask for
   * the same pages and apply the same events twice; the second would fail
   * each one and count them as deaf.
   */
  async #catchUpChannel(channel: string): Promise<void> {
    const emCurso = this.#recuperacoes.get(channel)
    if (emCurso) {
      emCurso.repetir = true
      return
    }
    /*
      THE CONNECTION GENERATION, stamped at entry, and it is what makes this `finally`
      inert when it is no longer from this connection.

      The defect, measured by reading: the `#recuperacoes.delete` was guarded by
      the identity of `state`, and the rest of the `finally` was not guarded by anything.
      `#onClose` already rejects pending waits (`#failPending`), so the page wait
      dies with the socket, but the work that comes AFTER it does not die: the page
      already received is up to a hundred events to decipher and record, and that
      lasts longer than the 500 to 1000 ms of `#scheduleReconnect`. The `finally`
      then ran INSIDE the new connection and did `#recuperacoesPorFazer.delete` of a
      channel whose new recovery had not yet run: the gate opened and live frames
      went back to advancing the epoch over what was left to read, which is
      defect M1 described in `#portaoFechado`.

      Rejecting waits on close does not fix this, and that is why the guard stays:
      what runs after the wait is not a wait.
    */
    const geracao = this.#geracaoDaLigacao
    const estado = { repetir: false, promessa: Promise.resolve() }
    this.#recuperacoes.set(channel, estado)
    estado.promessa = (async () => {
      try {
        // Three passes maximum: whoever asks for another one is whoever changed something
        // (a Welcome, a gap live), and a broken channel cannot put this
        // asking for pages in a loop.
        for (let volta = 0; volta < 3; volta++) {
          estado.repetir = false
          await this.#recuperarUmaVez(channel)
          if (!estado.repetir) break
        }
      } finally {
        if (this.#recuperacoes.get(channel) === estado) this.#recuperacoes.delete(channel)
        /*
          And the `finally` ENTIRE is inert when the connection is no longer this one.

          Everything that follows touches a connection's state: the "to recover" mark,
          the gate, the deferred card. On a connection that is already dead none of
          this is ours, the new connection set its marks, and erasing them is opening the
          gate of a channel it has not yet read. See the stamp above.
        */
        if (geracao === this.#geracaoDaLigacao) {
          this.#recuperacoesPorFazer.delete(channel)
          // A recovery that ends with no gap read everything the server has: what
          // was ahead of our epoch either entered or was garbage. Without this,
          // whoever saw it never published a card again until restart.
          if (!this.#buracos.has(channel)) this.#epocaFuturaVista.delete(channel)
          /*
            And the gate opens: what arrived live while this ran applies
            now, in `seq` order.

            In the `finally` on purpose, and that is what makes it the cap of the gate:
            a recovery that exhausted the 40 pages, that hit a silent server,
            or that threw, leaves the channel usable anyway. See
            `#largarRetidas`.
          */
          await this.#largarRetidas(channel)
          /*
            And what was left unread in earlier connections, one gap at a time.

            AFTER the gate and off the path that `connect()` waits for, and both
            were measured. Inside the gate, each gap is a request for one
            event against a cap of 60 backfills per minute per account
            (`Gateway.BACKFILLS_POR_MINUTO`) that normal recovery of two delayed channels
            already breaks, and above the cap the server DOES NOT RESPOND AT ALL.
            In the exact case that produces gaps, then, the first request fell
            silent, the wait died on timeout, and the price was the gate closed and
            startup stuck that entire timeout per channel, in exchange for nothing.

            Fire and forget: a gap that does not recover stays in the list, which is
            where it lives. See `#pedirLacunas`.
          */
          void this.#pedirLacunas(channel, geracao).catch(() => {})
          // The card that was left unpublished while this ran. If we are still
          // behind, `#publicarCartao` defers it again.
          if (this.#cartaoAdiado && channel === this.#commonRoom) this.#agendarCartao(channel)
          // Whoever entered while we were away: once, now, in the epoch of now.
          // See the growth in `#applyEvent`. Off the path that `connect()` waits for.
          if (this.#connection === "online" && this.#crescidosNaRecuperacao.delete(channel)) this.#dizerAQuemEntrou(channel)
        }
      }
    })()
    return estado.promessa
  }

  /**
   * Subscribed channels whose recovery has not yet run on this connection.
   *
   * While a channel is here, or being recovered, its live frames
   * WAIT: they do not touch the anchor (`#ancoraPresa`) and since October 5, 2026
   * they also do not apply (`#portaoFechado`).
   */
  #recuperacoesPorFazer = new Set<string>()
  /**
   * Run `fn` with these channels marked for recovery, and unmark them at the end.
   *
   * The mark is set before subscribing and only leaves when the channel's recovery
   * ends (`#catchUpChannel`). Between one and the other there is code that can throw
   *, a socket that dies, an event listener, and a mark that got stuck
   * would hold the channel's anchor until the next connection: everything that arrived
   * live would enter and nothing would go to disk. The `finally` is what prevents it. A
   * recovery already running on the channel continues to hold the anchor on its own
   * (`#recuperacoes`).
   */
  async #comRecuperacaoPorFazer(canais: string[], fn: () => Promise<void>): Promise<void> {
    /*
      THE GENERATION, for the same reason as in `#catchUpChannel`, and found by
      the test written for that.

      `fn()` is all of `#catchUp`, and it can get stuck long after
      the socket dies: a page already received is up to a hundred events to decipher and record.
      Without the guard, this `finally`, which runs when `fn()` finally
      wakes, would erase the marks the NEW CONNECTION had set, and the gate of
      all channels would open at once, before any new recovery had
      run. It is defect M1 in full, not per channel.
    */
    const geracao = this.#geracaoDaLigacao
    for (const canal of canais) this.#recuperacoesPorFazer.add(canal)
    try {
      await fn()
    } finally {
      if (geracao === this.#geracaoDaLigacao) {
        for (const canal of canais) this.#recuperacoesPorFazer.delete(canal)
        /*
          And the gate opens here for whoever never got recovered.
          
          `#catchUpChannel` releases the retained frames of each channel at the end of its
          turn, which is the normal path. This is the network: `fn()` can throw midway,           a socket that dies, a vault that refuses a write, and the channels that got
          left behind in the queue never got their turn. Without this, their frames
          would stay retained in memory until the next connection, which is trading
          a loss for an oversight.
          */
        for (const canal of canais) await this.#largarRetidas(canal)
      }
    }
  }

  /** The recovery running on each channel. See `#catchUpChannel`. */
  #recuperacoes = new Map<string, { repetir: boolean; promessa: Promise<void> }>()
  /**
   * Live frames already applied with the anchor pinned, per channel.
   *
   * The recovery that follows requests them again from the server, it starts at the anchor,
   * and the anchor has not moved. Applying them a second time fails (the generation is spent)
   * and each failure counts as a deafness; skipping them means knowing they already entered.
   */
  #consumidasAoVivo = new Map<string, Map<number, boolean>>()

  /**
   * Can the anchor of this channel move with what arrives live?
   *
   * It cannot as long as there is recovery to do or running: what lies between
   * the anchor and the live frame has not been read yet, and it might be a commit.
   */
  #ancoraPresa(channel: string): boolean {
    // And with a hole already open too: a readable live frame says nothing about
    // what stayed between the anchor and it. Only a recovery, which reads everything in
    // order, can move the anchor past a hole.
    return this.#recuperacoesPorFazer.has(channel) || this.#recuperacoes.has(channel) || this.#buracos.has(channel)
  }

  /**
   * Can the live commits in this channel apply now, or must they wait?
   *
   * **This fixes the bug from 5 October 2026, and it is a different question
   * from `#ancoraPresa`.** That one held the anchor and let application pass-its own header
   * said so-and that is how real messages were lost:
   *
   *   1. subscribing opens live commits for ALL channels at once, and recovery
   *      runs one channel at a time;
   *   2. a live commit on a channel whose turn has not come yet applied
   *      immediately and advanced the group epoch;
   *   3. the client stores the current epoch and two (`retainKeysForEpochs: 2`),
   *      so at the third commit applied this way, messages from the epoch you were
   *      in would no longer open;
   *   4. and a frame that does not open because it is from a past epoch was worth
   *      `"lido"`: the anchor passed over it and it was never requested again, with
   *      bytes still on the server.
   *
   * Now it waits: `#reterAoVivo` stores it by `seq` and `#largarRetidas` applies it when
   * recovery of this channel ends. The script that measures this is `scripts/e2e-ordem-das-epocas.mjs`,
   * and without the gate it loses all 110 mensagens.
   *
   * **AN OPEN GAP DOES NOT CLOSE THE GATE, and it is on purpose.** A gap can last
   * the entire connection (`TENTATIVAS_POR_BURACO` are three connections), and a gate with no
   * defined opening point is a hung connection. What the gap does is hold the
   * anchor, which is what prevents loss; application passes, as it always has.
   *
   * **THE FULL COST.** Holding others' commits delays our ability to SEND on this
   * channel: it depends on the epoch we have, and whoever is ahead refuses it.
   * Three things limit this, and none is a guess:
   *
   * - echoes of our OWN sends and commits never pass through here-they exit at
   *   `#onFrame` in the comparison of `ref`, before the gate-so nothing this device
   *   publishes waits;
   * - the gate opens at the end of channel recovery, and recovery is limited
   *   (40 p pages, 10 s wait per page);
   * - and sending DURING a multi-epoch recovery did not work before this anyway:
   *   recovery advances the epoch by pages, and a message encrypted in a middle
   *   epoch is refused by whoever is ahead. What the gate changes is that there
   *   is no longer a shortcut of a live commit putting us at the head. Trading
   *   that for not losing messages is the decision, and it is written here for
   *   whoever wants to undo it to know what it costs.
   */
  #portaoFechado(channel: string): boolean {
    return (
      this.#recuperacoesPorFazer.has(channel) ||
      this.#recuperacoes.has(channel) ||
      // And WHILE IT EMPTIES, which is the third gate and the one that was missing. See
      // `#aLargar`.
      this.#aLargar.has(channel)
    )
  }

  /**
   * Channels draining RIGHT NOW. The gate stays closed while they are here.
   *
   * **This was how the gate fix reintroduced the loss it fixes.**
   * `#catchUpChannel` erases the two marks BEFORE calling `#largarRetidas`,
   * so during the whole draining the gate was open: any frame that
   * arrived live applied right away and wrote the anchor (`#rememberSeq`,
   * and `Vault.update` mutates the live object synchronously, before I/O). The
   * next cycle loop reread the anchor from the live vault, found it already at
   * the frame's `seq`, and sent away with `continue` everything in between, no skipped, no gap, no report, and the
   * next connection asking from there. Anchor at 9, retained 10 to 20, a frame 21
   * live between 11 and 12: nine messages lost in silence, and if any
   * is `handshake` it is a skipped commit, which is the case with no way back in the header
   * of `#catchUp`. Just ONE frame, and draining a large batch takes seconds,    * one MLS decryption plus one vault rewrite per loop.
   *
   * With this, what arrives live during draining stays retained and enters
   * in order in the next batch, which is what the `#largarRetidas` loop repeats
   * while the map has things in it again.
   */
  #aLargar = new Set<string>()

  /**
   * Live frames waiting their turn for the channel, by `seq`. See `#portaoFechado`.
   *
   * The `minuto` travels with them because that is what the server says about the age of the
   * event, and that is how a gap knows when it expires. See `#anotarLacuna`.
   */
  #retidasAoVivo = new Map<string, Map<number, { kind: string; ciphertext: string; minuto: number }>>()

  /** Bytes of `ciphertext` retained per channel. See `RETIDAS_BYTES_POR_CANAL`. */
  #bytesRetidos = new Map<string, number>()

  /**
   * How many live frames retain per channel before the cap gives in.
   *
   * Counting FRAMES is not enough, and that is why there is a byte budget on the side: a
   * `channel.event` can bring 12 MiB, so a recovery of a photo feed with the author
   * publishing thirty times that minute retained about 240 MB
   * with the counter at 30/500, and the map is per channel, no aggregate cap. On a
   * phone or in a renderer that is the app dead from lack of memory.
   */
  static readonly RETIDAS_POR_CANAL = 500

  /** Bytes of `ciphertext` retained per channel before the cap gives in. */
  static readonly RETIDAS_BYTES_POR_CANAL = 8_000_000

  /**
   * And the AGGREGATE cap, summing all channels.
   *
   * Twenty delayed channels at the same time is the normal case for a laptop that
   * has been closed for days, and twenty times the cap per channel does not fit in
   * any memory worth defending.
   */
  static readonly RETIDAS_BYTES_TOTAL = 24_000_000

  /**
   * Retain this live frame, if the gate is closed.
   *
   * **Returns whether the frame stays AT THE DOOR, retained, or thrown out at the cap.** It is not
   * "whether I saved it": at the cap it gets thrown out, and throwing out is both "not apply
   * now" and retaining. The difference matters in `#onFrame`, which is who applies what
   * this function does not keep.
   *
   * Welcome is never retained, and that is not a cosmetic exception: a Welcome that
   * arrives WITHIN a recovery page does `#acceptWelcome` recover the
   * same channel, and it is the recovery that waits for that Welcome. Retaining it
   * closed the loop on itself, see the header of `#catchUpChannel`.
   *
   * **SYNCHRONOUS, and that is not style: it is the order of frames.** The place in the group queue
   * is marked at the moment of the call, and what guarantees it is no `await`
   * anywhere between `#onFrame` and `#applyEvent`, see the note on
   * `#umDeCadaVezNoGrupo`. While this was `async`, the cap emptied the batch
   * here inside with `await` and put a pause point in that path; now
   * it throws out, which is instant, and the chain is synchronous again.
   */
  #reterAoVivo(
    channel: string,
    seq: number,
    kind: string,
    ciphertext: string,
    minuto: number,
  ): boolean {
    if (kind === "welcome" || !this.#portaoFechado(channel)) return false
    const retidas = this.#retidasAoVivo.get(channel) ?? new Map<number, { kind: string; ciphertext: string; minuto: number }>()
    /*
      The SAME `seq` twice counts ONCE, and the sum of bytes must know it.

      The map is indexed by `seq`: a repeated frame, a relay resending it, a
      server serving it twice, REPLACES the entry and the map does not grow.
      The sum grew: it summed the length of the new without subtracting the old,
      so it drifted upward and never came back. A cap hit by bytes that
      are no longer retained is a batch thrown out for no reason, and in the other five
      places the accounting is in step with the map.
    */
    const anterior = retidas.get(seq)
    const bytes = ciphertext.length - (anterior?.ciphertext.length ?? 0)
    const noCanal = this.#bytesRetidos.get(channel) ?? 0
    let total = 0
    for (const quanto of this.#bytesRetidos.values()) total += quanto
    /*
      THE CAP THROWS OUT, and does not release the batch.
      
      Releasing a batch from the future over a recovery halfway through recreated the
      original defect with another name: the anchor did not move, but the COMMITS from that
      batch moved the epoch forward, and the next pages, enciphered in the
      middle epochs, stopped opening by `retainKeysForEpochs: 2` and counted as
      `skipped`.
      
      **BUT IT LEAVES A MARK, and this is what was missing.** The old argument was what
      `connect()` uses for retained from a dead connection: the anchor never moved
      past a retained frame, so the next recovery asks for them again. The sentence that held it,       "while the gate is closed `#ancoraPresa` is too", **stopped being true when `#aLargar`
      entered `#portaoFechado`**: during draining the gate is closed and
      `#ancoraPresa` is NOT, because `#catchUpChannel` already erased the two marks that
      it reads. Measured: anchor 100, retained 101 to 105, 101 touches and writes the
      anchor, and during that `await` 106 arrives with 10 MB; the cap erased the
      maps and returned, the loop ended at 105, and 106 was never asked for again, no
      `skipped`, no gap, no hole. If it were `handshake`, it was a
      skipped commit.
      
      So a hole opens in the OLDEST of what gets thrown out, the
      current frame included: the anchor stays pinned before it (`#ancoraPresa` reads
      `#buracos`) and the recovery that the hole launches reads everything again in order.
      This is fixed from here and not from `#aLargar` in `#ancoraPresa`, because this
      also covers the cap hitting during a recovery. `#buracoAoVivo` is
      synchronous and no `await` enters between `#onFrame` and `#applyEvent`,
      so calling it here does not break the order of frames.
      
      **At the AGGREGATE cap throw out the batch of THIS channel, not the largest.** With
      the per-channel cap at a third of the aggregate, whoever bursts it is always a set
      and not a channel; choosing the victim by size was putting a
      eviction policy here to spare a server call that costs nothing. The bad case of this
      choice is a channel with little retained staying with nothing while others fill the
      account, and it still does not lose a single message, because recovery
      starts at the anchor and now there is a hole holding it. This is noted, with the
      report naming it.
      */
    if (
      (anterior === undefined && retidas.size >= Session.RETIDAS_POR_CANAL) ||
      noCanal + bytes > Session.RETIDAS_BYTES_POR_CANAL ||
      total + bytes > Session.RETIDAS_BYTES_TOTAL
    ) {
      // The current one included: it is both thrown out as those in the map,
      // and at a cap that hits on the first frame it is the only thing that gets lost.
      const maisAntigo = Math.min(seq, ...retidas.keys())
      this.#retidasAoVivo.delete(channel)
      this.#bytesRetidos.delete(channel)
      this.emit("status", {
        detail: `${channel}: o portão cedeu no tecto (${retidas.size} tramas e ${noCanal} bytes neste canal, ${total} bytes em todos) e o lote retido foi deitado fora; abriu-se um buraco no evento ${maisAntigo} e a recuperação volta a pedi-lo ao servidor`,
        level: "info",
        code: "portao-no-tecto",
        route: "log",
        channel,
      })
      this.#buracoAoVivo(channel, maisAntigo)
      return true
    }
    retidas.set(seq, { kind, ciphertext, minuto })
    this.#retidasAoVivo.set(channel, retidas)
    this.#bytesRetidos.set(channel, noCanal + bytes)
    return true
  }

  /**
   * How many loops the draining does before giving up and opening a hole.
   *
   * The loop repeats while new frames arrive live, and a channel talking
   * faster than this device decrypts cannot hold `connect()`
   * forever, it is the one that waits for this, for `#catchUp`.
   */
  static readonly VOLTAS_DO_PORTAO = 20

  /**
   * Apply what stayed retained, in order of `seq`, with the gate STILL CLOSED.
   *
   * Called when recovery of the channel ends, no matter how it ends,
   * even badly: a page the server did not answer, the 40 pages
   * used up, a vault that refused a write. That is what makes this the CAP of
   * the gate, not a success point: the channel becomes usable again even
   * when recovery did not reach the end.
   *
   * **The gate stays closed while this runs** (`#aLargar`), and the loop repeats
   * while the map has things in it again: what arrives live during
   * draining stays retained and enters in order in the next batch, instead of
   * applying ahead of it and taking the anchor with it. Entry into `#aLargar`
   * is also the reentrancy guard, because `#portaoFechado` reads it up there.
   *
   * **The position is a LOCAL cursor and not the vault anchor, and it is the belt.** Rereading the
   * anchor each loop was reading a value that something else might have moved,    * `#rememberSeq` live, a hole launching a new recovery, and an anchor
   * that jumps over retained still not applied loses them for real if the
   * process dies in that window.
   *
   * **The anchor moves only past what touches it.** A retained frame with
   * `seq` above `cursor + 1` has unread events behind it, because
   * recovery did not reach there. It applies, that is what makes the channel usable,    * but the anchor STAYS, and a hole opens for what is in between to be
   * asked again. Letting the anchor jump here was reintroducing the defect through the
   * door of the fix.
   *
   * **And THE CONNECTION GENERATION, stamped on entry: this is the THIRD place.**
   * `#catchUpChannel` and `#comRecuperacaoPorFazer` already stamped it; this is the
   * only one of the three that READS AND ERASES the retained maps inside a loop with
   * `await` in between, and did not check anything each loop. The defect, by reading:
   * draining of generation 1 gets stuck in an `await`, one MLS decryption plus one
   * vault rewrite per frame, which in a large batch takes seconds -, the
   * socket dies, reconnection of 500 to 1000 ms runs, `connect()` clears retained and
   * marks channels again, new frames arrive and get retained. The old draining wakes up, reads
   * `#retidasAoVivo.get(channel)` and they are THE RETAINED OF THE
   * NEW CONNECTION: it applies them with the old cursor before the new recovery has run, and
   * the commits from that batch move the epoch forward without having read what is in between. It is
   * defect M1 again, by the hand of draining, and it is exactly what the cap
   * of `#reterAoVivo` refuses to do.
   *
   * The stamp is read at the top of each loop AND inside the loop before each
   * application, because each application is an `await`. Exit with `return` and not
   * `break`: what comes after the loop writes `#buracos` and can launch a
   * recovery, and none of that is of this connection. What stays unapplied is not
   * lost, the anchor did not move past it, and recovery of the new connection
   * starts at the anchor.
   */
  async #largarRetidas(channel: string): Promise<void> {
    // And this is also the reentrancy guard: `#aLargar` enters `#portaoFechado`.
    if (this.#portaoFechado(channel)) return
    const primeiras = this.#retidasAoVivo.get(channel)
    if (!primeiras || primeiras.size === 0) return

    const geracao = this.#geracaoDaLigacao
    this.#aLargar.add(channel)
    try {
      let buracoEm: number | undefined
      /*
        The anchor as IT WOULD BE, tracked here and not reread from the vault.

        It moves only by what touches it and FREEZES at the first hole, which is what
        the old code got by rereading the vault, because the vault anchor also
        does not move after a `semAncora`. The difference is that rereading it was reading a
        value that a live frame could have moved, and then everything in between
        the two positions went out with `continue` without a word.
      */
      let ancora = this.vault.contents.lastSeq[channel] ?? -1
      let voltas = 0
      while (voltas++ < Session.VOLTAS_DO_PORTAO) {
        // The connection is no longer this one: what is in the map was retained by it, and the
        // cursor with which it would apply is from a vault that has since restarted the
        // count. See the stamp in the header.
        if (geracao !== this.#geracaoDaLigacao) return
        const retidas = this.#retidasAoVivo.get(channel)
        if (!retidas || retidas.size === 0) break
        this.#retidasAoVivo.delete(channel)
        this.#bytesRetidos.delete(channel)
        for (const [seq, trama] of [...retidas.entries()].sort(([a], [b]) => a - b)) {
          // And again here, because each application is an `await`: the connection can
          // die between two frames of the same batch.
          if (geracao !== this.#geracaoDaLigacao) return
          // Recovery already read this: it started at the anchor and read in order. The generation
          // is spent, and applying again only produces a failure that counts as deafness.
          if (seq <= ancora) continue
          // With a hole already open, NOTHING else touches the anchor: what is in between
          // stays unread, and letting it move was passing over it.
          const semAncora = buracoEm !== undefined || seq > ancora + 1
          if (semAncora) buracoEm ??= ancora + 1
          await this.#aplicarAoVivo(channel, seq, trama.kind, trama.ciphertext, trama.minuto, semAncora)
          /*
            It moves when it touched, and only then.

            If `#aplicarAoVivo` could not apply this frame, it opened a hole itself
            (`#buracoAoVivo`) and from then on `#ancoraPresa`
            holds the vault anchor in all loops that follow, so this
            cursor can move one step ahead of it without consequence: what decides
            if the anchor gets written is `#ancoraPresa`, and it is already pinned.
          */
          if (!semAncora) ancora = seq
        }
      }
      /*
        Loops exhausted and data remains: discard it and open the hole where
        the cursor ended up.
        
        Leaving it in the map was worse: the gate opens next, the first live
        frame applies and carries the anchor over it, and it is never
        requested again. Discarded, the anchor stays put, the hole holds it,
        and recovery launched by the hole reads everything again in order,         same reasoning as the cap above.
        */
      if ((this.#retidasAoVivo.get(channel)?.size ?? 0) > 0) {
        this.#retidasAoVivo.delete(channel)
        this.#bytesRetidos.delete(channel)
        buracoEm ??= ancora + 1
      }
      // After applying, not before: `#buracoAoVivo` may launch a new recovery,
      // and that must find retained items already in `#consumidasAoVivo` to avoid
      // reopening them.
      if (buracoEm !== undefined) this.#buracoAoVivo(channel, buracoEm)
    } finally {
      /*
        And the gate opens. In `finally`: a vault write that refuses keeps the
        channel usable anyway, which is the rule for this entire path.

        **By generation, and this is the door that the stamp would open if we
        did not close it here.** On a connection that has died, the entry to
        `#aLargar` that this drain put there was already taken by `#aLargar.clear()`
        from `connect()`, and what is there, if there is anything, belongs to
        the drain of the NEW connection. Deleting it would open the gate mid-drain,
        which is the bug that this file just fixed, by correction's hand.
      */
      if (geracao === this.#geracaoDaLigacao) this.#aLargar.delete(channel)
    }
  }

  // ------------------------------------------------------------------ lacunas

  /**
   * How many gaps are stored per channel. See `lacunas` in the vault.
   *
   * The cap exists because this lives in the vault, which is encrypted in full
   * on every write: an endless list would cost its size on every received
   * message. When it overflows, the OLDEST ones are lost, they are closest to
   * expiring in the server's retention, so they are least worth requesting.
   */
  static readonly LACUNAS_POR_CANAL = 200

  /**
   * How many gaps are requested again per channel per connection.
   *
   * Each request is a `channel.backfill` of one event, and the server counts
   * 60 backfills per minute per account (`Gateway.BACKFILLS_POR_MINUTO`), a
   * cap that normal recovery of three lagging channels already burns through
   * almost entirely. Requesting few per connection is what keeps this from
   * stalling the real recovery, which matters most.
   */
  static readonly LACUNAS_POR_LIGACAO = 10

  /**
   * How many times the SAME gap is requested before we stop requesting it.
   *
   * **Without this they were always the same ones, never the others.** Requests
   * went for the oldest (`slice(0, …)`), and a gap from an epoch whose keys are
   * already discarded NEVER yields proof: it stayed in the list forever and
   * consumed the ten slots of all subsequent connections, so the remaining 190
   *, including recent ones, the only ones with any chance of opening, never
   * got a try.
   *
   * Stop requesting, but DO NOT remove from the list: the list is the record
   * of loss, and that is its purpose. Pruning by server retention removes it.
   *
   * In memory and per process, like `#insistirNoBuraco`: restarting the app
   * restores the attempts, which is what we want, what was missing may have
   * arrived meanwhile, and restarting costs one request.
   */
  static readonly TENTATIVAS_POR_LACUNA = 3

  /**
   * How many pages recovery of this channel has consumed on this connection.
   *
   * Used by `#pedirLacunas` to know when to stop: the server cap is 60
   * backfills per minute per account, and a channel that just burned forty
   * pages has no budget for ten single-event requests on things that probably
   * will not open.
   */
  #paginasGastas = new Map<string, number>()

  /** How many times each gap was requested this session, by `canal|seq`. */
  #lacunasPedidas = new Map<string, number>()

  /** Above this, the channel's recovery has burned through its backfills budget. */
  static readonly PAGINAS_ANTES_DE_LACUNAS = 20

  /**
   * How long to wait for a response to a gap request.
   *
   * **Ten seconds, SAME as others, and the reason is the queue of `#await`.** It was
   * at three-"silence is the likely answer, and waiting longer does not make it
   * more useful"-and that broke FIFO pairing: the queue is by `tipo|canal`, and
   * rests on no one leaving early. With three waiters on the same key at 3 s,
   * 10 s and 10 s, the expiry of `setTimeout` makes `splice` in the middle of the queue
   * and **its response goes to the next waiter**. Measured by read: one event
   * page from the gap is delivered to `#recuperarUmaVez`, which accepts it, does `cursor = 7`
   * and `avancar(7)`-and `avancar` erases the `#buracos` when `aberto.seq <= seq`, so **closes a
   * legitimate gap without proof**. With `more: true` the channel restarts from 7,
   * and each failure along the way counts toward deafness, which is the road to
   * the reseat that loses the history.
   *
   * The cost the short timeout feared is already paid another way: the `#pedirLacunas`
   * runs AFTER the gate and outside the path that `connect()` waits for (see its header),
   * so a ten-second silence does not stop any startup.
   */
  static readonly PRAZO_DA_LACUNA = 10_000

  /** Gaps awaiting the next vault write. See `#drainRecords`. */
  #lacunasPorGravar: { channel: string; seq: number; minuto: number }[] = []

  /**
   * The lowest epoch this device knows it ever had in each channel, per connection.
   *
   * **It is the floor that separates "I lost this" from "this was never mine",
   * and the question is about epoch, not `seq`.** Set in three places, always
   * with the same answer, where was the group when this device started watching it:
   *
   * - on connect, for each restored channel: the epoch where the connection
   *   found it, which is where the previous connection left it;
   * - on accepting a Welcome: the epoch of the place it gives;
   * - on entering by card: the epoch of the entry commit.
   *
   * In memory and per connection on purpose. The question it answers, "did I have
   * the key to this?", can only be answered honestly about what this connection
   * saw; a loss caused on a previous connection goes unnamed, which is the old
   * behavior and not a regression. The opposite, assume everything with `seq`
   * above our place was ours, was tested against the old client's script and
   * gave a reported loss to someone who had just entered by card, with thirty
   * days of server requests behind it.
   */
  #epocaAoLigar = new Map<string, bigint>()

  /**
   * How many gaps were recorded in each channel this connection. For diagnostics.
   *
   * In memory on purpose: the question it answers is "how much did this
   * connection lose", and that makes no sense across connections. What
   * persists is the list, in the vault.
   */
  #saltadosNaLigacao = new Map<string, number>()

  /**
   * An event that the anchor will pass without having read. Named, counted, and reported.
   *
   * **Does not touch the silence counter, and that is the more important half of this.**
   * `#undecryptable` is what declares a channel silent, and behind silence comes
   * `repairChannel` → reentry request → reseat, which is a remove followed by an add:
   * the channel history vanishing for persistent secrecy. Counting these messages
   * declared channels silent where someone had just joined, it is the decision
   * of August 16, 2026, `docs/PENDENTES.md`, and stands in full. What reaches here
   * already left the silence path with a `return`.
   *
   * What this does is what was missing: name the thing. Silent discard is what
   * let this bug last for months.
   */
  #anotarLacuna(channel: string, seq: number, minuto: number): void {
    this.#lacunasPorGravar.push({ channel, seq, minuto })
    const total = (this.#saltadosNaLigacao.get(channel) ?? 0) + 1
    this.#saltadosNaLigacao.set(channel, total)
    this.emit("status", {
      detail: `${channel}: o evento ${seq} não se leu e a âncora passou-lhe por cima (epoch já deixada para trás); ${total} nesta ligação`,
      level: "error",
      code: "epoca-saltada",
      // Diagnostic, not a balloon: it is a loss the person cannot undo, and a
      // warning per lost message in a lagging channel was a wall for them. What
      // we want is a place to read it, with channel and `seq`.
      route: "log",
      channel,
    })
  }

  /**
   * The gaps to be written, for a vault write. With pruning.
   *
   * Pruning is by AGE, not count: the server keeps events for `retentionDays`
   * days (announced in `hello.ok`), and a gap older than that is a request that
   * will never get an answer. When the server does not say how many days it keeps,
   * use `PODA_DE_LACUNAS`, the same number the home server uses by default.
   */
  #escreverLacunas(contents: VaultContents): void {
    const porCanal = { ...(contents.lacunas ?? {}) }
    for (const { channel, seq, minuto } of this.#lacunasPorGravar) {
      const lista = porCanal[channel] ?? []
      if (!lista.some((lacuna) => lacuna.seq === seq)) porCanal[channel] = [...lista, { seq, minuto }]
    }
    this.#lacunasPorGravar = []

    const dias = this.#serverRetentionDays ?? Session.PODA_DE_LACUNAS
    const limite = Math.floor(Date.now() / 60_000) - dias * 24 * 60
    for (const canal of Object.keys(porCanal)) {
      const vivas = (porCanal[canal] ?? [])
        .filter((lacuna) => lacuna.minuto >= limite)
        .sort((antes, depois) => antes.seq - depois.seq)
        .slice(-Session.LACUNAS_POR_CANAL)
      if (vivas.length > 0) porCanal[canal] = vivas
      else delete porCanal[canal]
    }

    if (Object.keys(porCanal).length > 0) contents.lacunas = porCanal
    else delete contents.lacunas
  }

  /** Days of retention to assume when the server does not announce them. See `#escreverLacunas`. */
  static readonly PODA_DE_LACUNAS = 30

  /**
   * Request again what went unread, one gap at a time.
   *
   * **Runs AFTER the gate opens, outside the path that `connect()` waits for.**
   * It was inside the gate for a few hours, on October 5, 2026, and that was
   * wrong on both axes: the server cap is 60 backfills per minute per account,
   * and above it responds NOTHING, so in the exact case that creates gaps, two
   * lagging channels that already overflow the cap, the first request fell silent
   * and the wait died at the timeout. The price was the gate closed and startup
   * stalled for that whole timeout, per channel, in exchange for nothing.
   *
   * The timeout is short for this reason (`PRAZO_DA_LACUNA`): silence is the
   * likely answer, and waiting ten seconds for it does not make it more useful.
   *
   * **Honesty about the odds this will work.** A message from an epoch this
   * group has left behind does not open again: persistent secrecy is the feature,
   * and the keys are discarded. What this catches is the case where the gap was
   * recorded during a pass that advanced the group and later recovery put it in
   * the right place, and above all, the gap stops being invisible, which was
   * the problem. So we request little (`LACUNAS_POR_LIGACAO`), the MOST RECENT ones,
   * with a cap on attempts (`TENTATIVAS_POR_LACUNA`), and do not spend anything
   * on a channel that just burned its backfills budget (`PAGINAS_ANTES_DE_LACUNAS`).
   *
   * `geracao` is from the connection that requested it: this runs outside the
   * `await` of whoever called it, so it may wake in a new connection, and then
   * has nothing to request or write. See the stamp in `#catchUpChannel`.
   *
   * **ONE INSTANCE PER CHANNEL, and the stamp was not enough.** It protects
   * against the next connection, not against two instances of the SAME generation,
   * and those happen by a path that exists: `#catchUpChannel` finishes and launches
   * one; a `recoverable` frame opens a hole, which launches `#catchUp`, which
   * finishes and launches the second. Both request the same gaps in parallel,    * same order, same vault, put two waiters on the same `#await` key (which is
   * what drives the answer swap described in `PRAZO_DA_LACUNA`) and burn attempts
   * at double speed, against a cap of three per gap. The queue merges them into
   * one, in the spirit of `#umaDeCadaVez` that was already there for invites.
   */
  async #pedirLacunas(channel: string, geracao: number): Promise<void> {
    return this.#umaDeCadaVez(`lacunas|${channel}`, () => this.#pedirLacunasAgora(channel, geracao))
  }

  async #pedirLacunasAgora(channel: string, geracao: number): Promise<void> {
    if (geracao !== this.#geracaoDaLigacao) return
    const lacunas = this.vault.contents.lacunas?.[channel]
    if (!lacunas || lacunas.length === 0) return
    /*
      A channel that burned its backfills budget does not request gaps.
      
      Real recovery comes first: it reads events that STILL OPEN, and these
      requests are, at best, a second chance for events that probably no longer
      open. Burning the cap on them would stall the only thing that matters.
      */
    if ((this.#paginasGastas.get(channel) ?? 0) >= Session.PAGINAS_ANTES_DE_LACUNAS) return
    const ancora = this.vault.contents.lastSeq[channel] ?? -1
    const lidas: number[] = []

    /*
      BY MOST RECENT, and with a cap on attempts.
      
      Requests went for the oldest, and a gap that never yielded proof stayed in
      the list consuming the same slot in all connections: always the same ten,
      and the other up to 190 were never tried, recent ones included, the only
      ones this device may still have the epoch for. See `TENTATIVAS_POR_LACUNA`.
      */
    const porPedir = [...lacunas]
      .sort((antes, depois) => depois.seq - antes.seq)
      .filter((lacuna) => (this.#lacunasPedidas.get(`${channel}|${lacuna.seq}`) ?? 0) < Session.TENTATIVAS_POR_LACUNA)
      .slice(0, Session.LACUNAS_POR_LIGACAO)

    for (const lacuna of porPedir) {
      // The connection may have dropped mid-request, and the next one restarts the
      // count: what would be written from here is from a connection that no longer is.
      if (geracao !== this.#geracaoDaLigacao) break
      // Above the anchor is not a gap: it is something normal recovery will still
      // request, and requesting it here would burn the cap twice for the same event.
      if (lacuna.seq > ancora) continue
      const chave = `${channel}|${lacuna.seq}`
      this.#lacunasPedidas.set(chave, (this.#lacunasPedidas.get(chave) ?? 0) + 1)
      this.#send({ t: "channel.backfill", channel, afterSeq: lacuna.seq - 1, limit: 1 })
      let page
      try {
        page = await this.#await("channel.backfill.page", Session.PRAZO_DA_LACUNA, channel)
      } catch {
        // The server went silent, backfills cap, or a room it no longer knows. It
        // waits for the next connection, which is where this lives.
        return
      }
      if (page.t !== "channel.backfill.page" || page.channel !== channel) return
      const evento = page.events[0]
      // The server no longer has the event: retention passed it by. It leaves the
      // list, because insisting asks forever for what never comes.
      if (!evento || evento.seq !== lacuna.seq) {
        lidas.push(lacuna.seq)
        continue
      }
      const desfecho = await this.#applyEventSafely(channel, evento.kind, evento.ciphertext, evento.seq, false, evento.receivedAtMinute)
      /*
        Leaves the list only when ENTERED THE GROUP'S EPOCH, not when "no error".
        The difference took a race to discover.
        
        `"lido"` is ambiguous by design (see `Desfecho`): it covers an event
        that opened in a past epoch we still have, and covers one that did not
        open and on which this connection cannot claim it was ours, the floor
        of `#epocaAoLigar` rises with each connection, so the SAME gap stops
        being `saltado` on the next connection. Accepting `"lido"` made the list
        erase itself on the second connection, which is erasing the record of a
        real loss in silence: exactly the bug this list exists to fix.
        
        The price, accepted: a gap that opens in a past epoch still retained stays
        in the list and is requested again on the next connection. It costs one
        event request, is capped by `LACUNAS_POR_LIGACAO`, and pruning by
        retention takes it within the days the server keeps.
        */
      if (desfecho === "prova") lidas.push(lacuna.seq)
    }

    if (lidas.length === 0) return
    // And not the write either, if the connection is no longer this one: what was
    // read is read, but the vault belongs to whoever is connected now. See the stamp
    // in `#catchUpChannel`.
    if (geracao !== this.#geracaoDaLigacao) return
    await this.vault.update((contents) => {
      const lista = (contents.lacunas?.[channel] ?? []).filter((lacuna) => !lidas.includes(lacuna.seq))
      if (!contents.lacunas) return
      if (lista.length > 0) contents.lacunas[channel] = lista
      else delete contents.lacunas[channel]
      if (Object.keys(contents.lacunas).length === 0) delete contents.lacunas
    })
  }

  /** A live frame applied with the anchor held. `prova`: see `Desfecho`. */
  #consumidaAoVivo(channel: string, seq: number, prova: boolean): void {
    const vistas = this.#consumidasAoVivo.get(channel) ?? new Map<number, boolean>()
    vistas.set(seq, prova)
    // A cap, so a channel held for too long does not grow without end. The oldest
    // are ones recovery already passed.
    if (vistas.size > 2_000) {
      const maisAntiga = Math.min(...vistas.keys())
      vistas.delete(maisAntiga)
    }
    this.#consumidasAoVivo.set(channel, vistas)
  }

  /**
   * A hole seen live: the anchor stays, and we go fetch what is missing.
   *
   * Once per hole per connection: if there is already a hole open on this
   * connection ahead of this one, recovery already stopped at it and would
   * stop again. With recovery running, ask it for one more loop, the hole may
   * be in a page it already read.
   */
  #buracoAoVivo(channel: string, seq: number): void {
    if (!this.#groups.has(channel)) return
    const aberto = this.#buracos.get(channel)
    if (aberto !== undefined && aberto.seq <= seq && aberto.geracao === this.#geracaoDaLigacao) return
    if (aberto === undefined || aberto.seq > seq) {
      this.#buracos.set(channel, { seq, tentativas: 0, geracao: this.#geracaoDaLigacao })
    }
    const emCurso = this.#recuperacoes.get(channel)
    if (emCurso) {
      emCurso.repetir = true
      return
    }
    // Startup recovery for this channel has not run yet: it will start at the
    // anchor, which did not move, and recovery catches it.
    if (this.#recuperacoesPorFazer.has(channel)) return
    void this.#catchUp([channel])
  }

  async #recuperarUmaVez(channel: string): Promise<void> {
    /*
      Two positions, not one: `cursor` is how far we read, `anchor` is how far we
      can write. They move together, except after an epoch hole not yet proven
      trash, then we read ahead looking for proof and the anchor waits.
      */
    let ancora = this.vault.contents.lastSeq[channel] ?? -1
    let cursor = ancora
    let guard = 0
    /** The seq of an epoch hole to be proven. */
    let suspeito: number | undefined
    let esperar = false

    const avancar = (seq: number): void => {
      ancora = seq
      // The open hole fell behind, it entered, proved trash, or we gave up on it.
      // Only this way it closes: a page that never reached it does not close it.
      const aberto = this.#buracos.get(channel)
      if (aberto !== undefined && aberto.seq <= seq) this.#buracos.delete(channel)
    }
    const provarLixo = (seq: number): void => {
      if (suspeito === undefined) return
      this.emit("status", {
        detail: `${channel}: o buraco de epoch no evento ${suspeito} era lixo (o evento ${seq} entrou na epoch do grupo)`,
        level: "info",
        code: "epoch-garbage",
        route: "log",
        channel,
      })
      suspeito = undefined
      avancar(seq)
    }

    // Bounded so a channel with an enormous backlog cannot hold the
    // connection open indefinitely; the rest arrives on the next connect.
    while (guard++ < 40) {
      // Counted per channel and per connection: this count is what `#pedirLacunas`
      // reads to know if backfills budget remains. See `PAGINAS_ANTES_DE_LACUNAS`.
      this.#paginasGastas.set(channel, (this.#paginasGastas.get(channel) ?? 0) + 1)
      this.#send({ t: "channel.backfill", channel, afterSeq: cursor, limit: 100 })

      let page
      try {
        // By channel tag: a silent question about ANOTHER channel left this wait
        // catching its page, and the `break` below sent this channel away without a
        // word. See key pairing in `#onFrame`.
        page = await this.#await("channel.backfill.page", 10_000, channel)
      } catch {
        break
      }
      if (page.t !== "channel.backfill.page" || page.channel !== channel) break
      if (page.events.length === 0) break

      /*
        The anchor advanced over everything, including what hadn't been read.
        
        The reason was sound, an unreadable event can't be re-fetched and
        re-failed on every reconnect, forever, but the cost was high and
        nobody measured it: the skipped event was NEVER requested again, not on
        another connection or another day. For a message, it meant a message lost
        in silence. For a commit, it meant the epoch wouldn't advance on this
        device, and with it all following messages became unreadable, until
        deafness was declared and a reseat would wipe the history.
        
        Now the distinction is made: what won't read is skipped (no second read
        possible), what won't enter pauses reading here and waits for the next
        connection, three times before giving up. See `docs/PENDENTES.md`, 15
        August 2026.
        
        **An EPOCH hole is the exception, and we can discard it because it's junk.**
        Any account with a place in the common room leaves there a thread of one of
        its groups with whatever epoch it wants. Here recovery reads everything in
        order from the anchor, so a missing commit before the hole would have entered
        or paused reading further back: if after the hole something enters IN THE
        GROUP'S EPOCH, the channel stayed on our branch and the hole was junk.
        Without proof until the end of what the server has, it's treated as it
        always was.
        */
      for (const event of page.events) {
        cursor = event.seq
        // Already entered live, with the anchor locked. See `#consumidasAoVivo`.
        const consumida = this.#consumidasAoVivo.get(channel)?.get(event.seq)
        let desfecho: Desfecho
        if (consumida !== undefined) {
          desfecho = consumida ? "prova" : "lido"
        } else {
          desfecho = await this.#applyEventSafely(channel, event.kind, event.ciphertext, event.seq, false, event.receivedAtMinute)
        }

        if (desfecho === "buraco") {
          suspeito ??= event.seq
          continue
        }
        if (desfecho === "recuperavel") {
          // An app that failed pauses reading here, with or without a hole to prove
          // behind it: what comes after waits for it.
          if (suspeito !== undefined || this.#insistirNoBuraco(channel, event.seq)) {
            if (suspeito !== undefined) cursor = event.seq - 1
            esperar = true
            break
          }
          avancar(event.seq)
          continue
        }
        /*
          Didn't read, and we had a place when it was announced: mark it PENDING.

          The anchor advances after, as always, stopping on it would put recovery
          in a loop on the same event. What stops happening is passing over it in
          silence. See `#anotarLacuna` and `Outcome`.
        */
        if (desfecho === "saltado") this.#anotarLacuna(channel, event.seq, event.receivedAtMinute)
        if (suspeito !== undefined) {
          // What enters a past epoch proves nothing, and won't be opened again next
          // time: the generation was already spent.
          if (desfecho === "prova") provarLixo(event.seq)
          continue
        }
        avancar(event.seq)
      }

      if (suspeito === undefined) await this.#rememberSeq(channel, ancora)
      if (esperar || !page.more) break
    }

    if (suspeito !== undefined) {
      // Until the end of what the server has, and nothing entered in the group's
      // epoch: it's the usual hole, with the usual retry attempts.
      if (!this.#insistirNoBuraco(channel, suspeito)) avancar(cursor)
      await this.#rememberSeq(channel, ancora)
    }
  }

  /**
   * Apply one event and never throw.
   *
   * The decode sits inside the guard on purpose: `fromBase64` rejects a single
   * bad character, so a truncated or mangled ciphertext — which any relay can
   * produce, deliberately or not — used to take down the entire connection
   * instead of the one event it belongs to.
   */
  async #applyEventSafely(
    channel: string,
    kind: string,
    ciphertext: string,
    seq: number,
    aoVivo = false,
    minuto?: number,
  ): Promise<Desfecho> {
    let bytes: Uint8Array
    try {
      bytes = fromBase64(ciphertext)
    } catch (error) {
      /*
        Text that isn't base64 will never be base64. Asking for it again tomorrow
        gives exactly the same error, so skipping is the only way out, and it's
        a refusal we can make final without judging anything.
      */
      this.emit("status", {
        detail: `${channel}: evento ${seq} ilegível e descartado (${(error as Error).message})`,
        level: "error",
        code: "event-failed",
        route: "log",
        channel,
      })
      return "permanente"
    }

    try {
      const desfecho: { prova: boolean; saltado?: boolean } = { prova: false }
      await this.#applyEvent(channel, kind, bytes, seq, aoVivo, desfecho, minuto)
      if (desfecho.prova) return "prova"
      // Three outcomes, not two: see `Outcome`. What didn't read and should have
      // opened isn't "read".
      return desfecho.saltado ? "saltado" : "lido"
    } catch (error) {
      if (error instanceof BuracoDeEpoca) {
        // One line per hole, not one per thread: on a channel that ran without us
        // these come dozens per minute, all saying the same thing.
        if (this.#buracoAnunciado.get(channel) !== seq) {
          this.#buracoAnunciado.set(channel, seq)
          this.emit("status", {
            detail: `${channel}: buraco de epoch no evento ${seq} (${error.message}); a âncora fica em ${this.vault.contents.lastSeq[channel] ?? -1}`,
            level: "info",
            code: "epoch-gap",
            route: "log",
            channel,
          })
        }
        return "buraco"
      }
      /*
        Here the text read fine and the APPLICATION failed, and that's a different
        story: the most common cause is an epoch this device doesn't have yet,         the commit that created it is on its way, or behind a `welcome.resync`
        that hasn't come back. It's recoverable by nature, and whoever treats it
        as final loses the message forever.
        */
      this.emit("status", {
        detail: `${channel}: evento ${seq} não entrou (${(error as Error).message})`,
        level: "error",
        code: "event-failed",
        route: "log",
        channel,
      })
      return "recuperavel"
    }
  }

  /**
   * Is it worth asking for the event that failed to apply again?
   *
   * One hole per channel, which is what matters: reading stops at the first, and
   * while it doesn't enter nothing that comes after matters.
   *
   * The limit exists to not restart the loop the old comment talked about. And
   * it lives in memory on purpose: closing and reopening the app gives back the
   * three attempts, which is what we want, what was missing may have arrived
   * meanwhile, and retrying costs one request.
   */
  /** The last epoch hole reported to diagnostics, per channel. */
  #buracoAnunciado = new Map<string, number>()

  #insistirNoBuraco(channel: string, seq: number): boolean {
    const anterior = this.#buracos.get(channel)
    const mesmoBuraco = anterior?.seq === seq
    // Finding the same hole on the same connection doesn't count: nothing changed
    // between one pass and the next, and burning attempts on it would be giving up
    // without ever having waited.
    if (mesmoBuraco && anterior.geracao === this.#geracaoDaLigacao) return true

    const tentativas = mesmoBuraco ? anterior.tentativas + 1 : 1
    if (tentativas >= TENTATIVAS_POR_BURACO) {
      this.#buracos.delete(channel)
      return false
    }
    this.#buracos.set(channel, { seq, tentativas, geracao: this.#geracaoDaLigacao })
    return true
  }

  /**
   * `defer`: the write goes out in the next vault window (`Vault.updateEmBreve`),
   * and the caller doesn't wait for it. It's the live path: an entry in `!984`
   * was ~115 events and ~115 vault writes in full, and that's what froze the app
   * (slow-after-enter, 4/11/2026). Recovery keeps writing page by page and
   * waiting, because it decides where the next one starts.
   */
  async #rememberSeq(channel: string, seq: number, adiar = false): Promise<void> {
    const advanced = (this.vault.contents.lastSeq[channel] ?? -1) < seq
    if (
      !advanced &&
      this.#pendingHistory.length === 0 &&
      this.#pendingDirectory.length === 0 &&
      this.#pendingSpaceMeta.length === 0 &&
      this.#pendingAuthority.length === 0 &&
      this.#pendingRoleDefs.length === 0 &&
      this.#pendingRooms.length === 0 &&
      this.#pendingCategories.length === 0 &&
      this.#pendingTransmitters.length === 0 &&
      this.#pendingShownFriends.length === 0 &&
      this.#pendingAutoriasDosPerfis.length === 0 &&
      !this.#memoriaPorGravar &&
      // And the gaps, which are the reason this list exists: it happened in this
      // project to write into live content and the write to go out early because
      // "nothing is dirty", with tests asserting about memory. A gap that doesn't
      // reach disk is the same silent loss it exists to name.
      this.#lacunasPorGravar.length === 0
    )
      return
    /*
      The groups to write go in the SAME write as the anchor, and that's the fix.

      The anchor went alone: the vault is rewritten in full, but `contents.groups`
      was only updated by `flush`, which runs a second and a half later. This
      write put on disk the anchor already past the commit next to the group
      BEFORE it. Reloading in that window left the two things mismatched forever:
      recovery starts after the commit, and the group never sees it. One of the
      three epochs in the common room on 12/9/2026 came in through here.

      Serializing the group here costs little next to what was already paid, the
      whole vault is encrypted on each write, and leaves the order guaranteed by
      the write itself: the `seq` event was already applied in memory when this
      runs, so the group going to disk is always at `seq` or after.
    */
    if (advanced) {
      const vistas = this.#consumidasAoVivo.get(channel)
      if (vistas) {
        for (const vista of [...vistas.keys()]) if (vista <= seq) vistas.delete(vista)
        if (vistas.size === 0) this.#consumidasAoVivo.delete(channel)
      }
    }
    const grupos = [...this.#dirty]
    this.#dirty.clear()
    const escrever = (contents: VaultContents): void => {
      if (advanced) contents.lastSeq[channel] = seq
      // History rides in the same write. The vault re-encrypts wholesale on
      // every update, so an extra write per message would double the cost for
      // nothing — the payload just gets a little bigger.
      this.#drainRecords(contents)
      this.#escreverGrupos(contents, grupos)
    }
    if (adiar) {
      /*
        The mutation already entered content, with the anchor and groups at the
        same moment. A write that fails leaves it that way in memory, and the
        next one carries it; the dirty marks reset as in the waiting path, and
        the failure is said in the log, as `#onFrame` would say it.
      */
      void this.vault.updateEmBreve(escrever).catch((erro: unknown) => {
        for (const canal of grupos) this.#dirty.add(canal)
        this.emit("status", {
          detail: `gravação do cofre adiada: ${(erro as Error)?.message ?? String(erro)}`,
          level: "error",
          code: "event-failed",
          route: "log",
        })
      })
      return
    }
    try {
      await this.vault.update(escrever)
    } catch (erro) {
      // The same marks that `flush` resets, for the same reason: work stays undone
      // and the next write carries it.
      for (const canal of grupos) this.#dirty.add(canal)
      throw erro
    }
  }

  /** The in-memory state of these channels, for inside a vault write. */
  #escreverGrupos(contents: VaultContents, canais: string[]): void {
    for (const canal of canais) {
      const session = this.#groups.get(canal)
      if (!session) continue
      contents.groups[canal] = toBase64(exportSession(session))
      // The channel card enters with the first group written: the one who created
      // it here, or the one inferred from the group (slice 3). With none, it doesn't
      // write: the channel is a room until the card arrives (account's channel,
      // owner's profile).
      const ficha = this.#fichaAoNascer.get(canal) ?? this.#fichaDeduzida(canal, session)
      this.#fichaAoNascer.delete(canal)
      if (ficha && registarFicha(contents, canal, ficha)) this.#anunciarFicha(canal, ficha)
    }
  }

  /** The commits to confirm, for inside a vault write. See `pendingCommits`. */
  #escreverPorConfirmar(contents: VaultContents): void {
    const porCanal: NonNullable<VaultContents["pendingCommits"]> = {}
    for (const [canal, lista] of this.#commitsPorConfirmar) {
      porCanal[canal] = lista.map((nosso) => ({
        commit: toBase64(nosso.commit),
        base: nosso.base.toString(),
        group: toBase64(exportSession(nosso.session)),
        ...(nosso.welcome ? { welcome: toBase64(nosso.welcome.bytes), recipient: nosso.welcome.recipient } : {}),
      }))
    }
    if (Object.keys(porCanal).length > 0) contents.pendingCommits = porCanal
    else delete contents.pendingCommits
  }

  // -------------------------------------------------------- history records

  /**
   * Chat-visible payloads waiting for the next vault write.
   *
   * Buffered rather than written so persistence piggybacks on writes that were
   * happening anyway: `#rememberSeq` for received events (one write per live
   * event, one per backfill page) and `flush()` for our own sends.
   */
  #pendingHistory: { channel: string; entry: StoredChatMessage }[] = []
  /**
   * Consecutive undecryptable events per channel.
   *
   * A channel whose messages keep failing is not quiet — it is unreadable to
   * this device, usually because the group was re-created elsewhere and our
   * seat belongs to a group that no longer speaks. Silence and deafness look
   * identical from the outside, and telling a person "nothing new" while
   * their friend posts hourly is the worst answer this app can give. Counting
   * makes the difference observable; anything above the threshold is reported
   * and offered a repair.
   */
  #undecryptable = new Map<string, FalhasSeguidas>()
  /** Channels we already asked to re-enter this session. */
  #rejoinAsked = new Set<string>()
  #pendingDirectory: { address: string; at: number; payload: StoredChatMessage["payload"] }[] = []
  /**
   * Who founded each channel, and who they named.
   *
   * The founder is the sender of the FIRST `room.created` of the channel,    * authenticated by MLS, so nobody can claim to be founder of someone else's
   * channel. The first, not the last, or they could publish another to take
   * the channel.
   *
   * Roles are applied by each client, not imposed by anyone. They work against
   * mistake and against the server; against a member who changes their own
   * client, they don't, that member writes anyway, and the only real barrier
   * stays being membership in the group. It's stated in the threat model and
   * must stay stated in anything the interface promises.
   */
  #pendingAuthority: (
    | { channel: string; kind: "founder"; address: string; seq: number; payload: StoredChatMessage["payload"] }
    | { channel: string; kind: "roles"; address: string; roles: string[]; at: number; seq: number; por: string; autoria?: unknown }
  )[] = []
  /** The authorships of profiles per channel, waiting for the next write. See `autoriasDosPerfis` in vault. */
  #pendingAutoriasDosPerfis: { channel: string; address: string; u: number; autoria: unknown; mural: boolean }[] = []
  /**
   * Roles defined waiting for the next write.
   *
   * Like rooms, and for the same reason: we care about the newest definition,
   * not the series, and a role must be on screen before the connection opens.
   */
  #pendingRoleDefs: { channel: string; role: string; at: number; seq: number; por: string; payload: StoredChatMessage["payload"] }[] = []
  /**
   * Rooms waiting for the next write.
   *
   * `podeFixar` is the only authority guard for this queue, and it travels
   * here because this is where we still know WHO sent it: the write won't know.
   * See `#recordPayload`, where it's decided, and `#drainRecords`, where it's
   * enforced.
   */
  #pendingRooms: {
    channel: string
    room: string
    at: number
    seq: number
    por: string
    payload: StoredChatMessage["payload"]
    podeFixar: boolean
    /** Whether the `perms` that arrives can be written (1.2). See `#podeSobreporDe`. */
    podeSobrepor: boolean
  }[] = []
  #pendingCategories: {
    channel: string
    category: string
    at: number
    seq: number
    por: string
    payload: StoredChatMessage["payload"]
    podeSobrepor: boolean
  }[] = []
  /** Channels the server already refused. One warning per channel, not one per frame. */
  #orfaos = new Set<string>()

  /** Channel presentations waiting for the next write. See `spaceMeta`. */
  #pendingSpaceMeta: { channel: string; at: number; seq: number; por: string; payload: StoredChatMessage["payload"] }[] = []
  /** Openings-from-a-member waiting for the next vault write. */
  #pendingTransmitters: { channel: string; address: string }[] = []
  /** Shown friend lists waiting for the next write. See `friends.shown`. */
  #pendingShownFriends: { author: string; shown: string[]; updatedAt: number }[] = []

  #recordPayload(channel: string, seq: number, sender: string, payload: Payload, apos?: number): void {
    // Anything that came out of the group at all proves this member's seat is
    // live — the profile they republish on every epoch counts exactly as much
    // as a post, and for a feed reader it is the only thing there is.
    this.#pendingTransmitters.push({ channel, address: sender })
    // A send of ours without echo gets marked with the order: the highest `seq`
    // we saw when it left (see `apos` in vault and `dobras.ts`).
    const marcaDeOrdem = seq < 0 && apos !== undefined && apos >= 0 ? { apos } : {}
    if (payload.t === "message") {
      this.#pendingHistory.push({ channel, entry: { seq, sender, ...marcaDeOrdem, at: payload.sentAt, payload } })
      const apelido = this.#apelidoAceite(channel, sender, seq, payload)
      if (apelido) this.#pendingApelidos.push({ channel, ...apelido })
      const sucessao = this.#sucessaoRecebida(channel, sender, seq, payload)
      if (sucessao) this.#pendingSucessoes.push(sucessao)
    } else if (payload.t === "post") {
      this.#pendingHistory.push({ channel, entry: { seq, sender, ...marcaDeOrdem, at: payload.postedAt, payload } })
      // The parts of a video arrive before the post is in the vault.
      this.#videos.esperar(channel, payload.media)
    } else if (payload.t === "edit" || payload.t === "redact") {
      // Amendments must outlive the session or a reload would resurrect the
      // original: the fold that applies them reads from this same history.
      const at = payload.t === "edit" ? payload.editedAt : payload.redactedAt
      this.#pendingHistory.push({ channel, entry: { seq, sender, ...marcaDeOrdem, at, payload } })
      if (payload.t === "redact") this.#largarVideosDe(channel, sender, payload.target)
    } else if (payload.t === "post.comment" || payload.t === "post.reaction") {
      // For the same reason as amendments: the likes and comments of a post are
      // worked out from the history, and not storing them made them vanish on
      // reload while the post stayed.
      const at = payload.t === "post.comment" ? payload.postedAt : payload.at
      this.#pendingHistory.push({ channel, entry: { seq, sender, ...marcaDeOrdem, at, payload } })
    } else if (isFriendPayload(payload)) {
      // A pending request that vanished on reload would look like it was ignored, // worse for both people than remembering it.
      //
      // The refusal and the cut are here for the same reason, and a stronger one: the
      // state of each friendship comes from this history, and it's from here that
      // reconciliation reads who it owes a place in the feed. A forgotten refusal
      // on reload would reopen the request; a forgotten cut would make reconciliation
      // reseat who had been removed.
      const at =
        payload.t === "friend.request"
          ? payload.sentAt
          : payload.t === "friend.accept"
            ? payload.acceptedAt
            : payload.t === "friend.decline"
              ? payload.declinedAt
              : payload.t === "friend.remove"
                ? payload.removedAt
                : Date.now()
      this.#pendingHistory.push({ channel, entry: { seq, sender, ...marcaDeOrdem, at, payload } })
    } else if (payload.t === "profile") {
      // Profiles go to the directory, not the timeline: only the freshest one
      // matters, and duplicating avatars into history would eat the media
      // budget for something that is not a message.
      this.#pendingDirectory.push({ address: sender, at: payload.updatedAt || Date.now(), payload })
      // The authorship of this profile in THIS channel, for the Welcome portrait (phase 1 of 1.1). See `autoriasDosPerfis`.
      if (payload.autoria !== undefined && channel !== this.canalDaConta) {
        this.#pendingAutoriasDosPerfis.push({
          channel,
          address: sender,
          u: payload.updatedAt,
          autoria: payload.autoria,
          mural: payload.mural !== undefined,
        })
      }
    } else if (payload.t === "friends.shown") {
      /*
        Only from the feed of the PROFILE's own author, and it's the whole guard
        for this payload. The list belongs to who shows it, and their feed is the
        only channel where only they write these things and only their friends
        read them. Coming from another channel (a room, a direct, a third person's
        feed) is noise from someone trying to put a list in someone else's mouth,
        and it falls here.
        */
      if (this.#donoDoFeed(channel) === sender) {
        this.#pendingShownFriends.push({ author: sender, shown: [...payload.shown], updatedAt: payload.updatedAt })
      }
    } else if (payload.t === "room.created") {
      // The first wins, forever: a second `room.created` is noise from someone
      // trying to take the channel, and that's how we refuse it. It goes to vault
      // in the same write as the rest, see `channelFounder`.
      this.#pendingAuthority.push({ channel, kind: "founder", address: sender, seq, payload })
      this.#ouviuQuemArruma(channel, sender)
    } else if (payload.t === "role.assign") {
      // Only the sender can name. Without this, any member would declare themselves
      // admin with a phrase in the thread.
      //
      // With the stamp of who granted it and the `seq` (F11): the higher stamp wins,
      // and `seq` breaks ties. See `channelMemberRolesAt`.
      this.#ouviuQuemArruma(channel, sender)
      if (this.#autoridadeAceita(channel, sender, payload)) {
        this.#pendingAuthority.push({
          channel,
          kind: "roles",
          address: payload.subject,
          roles: payload.roles,
          at: payload.assignedAt,
          seq,
          por: sender,
          // For the Welcome portrait to remake the payload and prove who granted it (phase 1 of 1.1).
          ...(payload.autoria !== undefined ? { autoria: payload.autoria } : {}),
        })
      }
    } else if (payload.t === "role.define") {
      // Only the sender defines roles. Without this guard any member could create a
      // role with all powers and give it to themselves.
      //
      // The built-in role enters too, from 2/11/2026 onwards, but only by name and
      // color: `powersOf` doesn't read the stored powers of `admin`, and `rolesOf`
      // doesn't list it, so emptying or deleting it here changes nothing. See
      // `defineRole` and `adminRole`.
      this.#ouviuQuemArruma(channel, sender)
      if (this.#autoridadeAceita(channel, sender, payload)) {
        this.#pendingRoleDefs.push({ channel, role: payload.role, at: payload.definedAt || Date.now(), seq, por: sender, payload })
      }
    } else if (payload.t === "channel.meta") {
      this.#ouviuSalas(channel, sender)
      // A room inside the channel. The most recent write wins, like everything else
      // that describes the channel and not a person.
      //
      // **With one exception, and it's the list of pinned.** Organizing the room
      // doesn't need any authority here, it never did, and changing that now was
      // another task, but pinning needs `pin`. Without this guard, the hidden
      // button in the interface was all the protection there was: any member put
      // what they wanted at the top of everyone's room with a `channel.meta` in
      // hand. The decision is made here, where the sender comes authenticated by
      // MLS, and it's carried out in the write.
      this.#pendingRooms.push({
        channel,
        room: payload.room,
        at: payload.updatedAt || Date.now(),
        seq,
        por: sender,
        payload,
        podeFixar: this.powersOf(channel, sender).includes("fixar"),
        podeSobrepor:
          payload.perms !== undefined &&
          this.#podeSobreporDe(
            channel,
            sender,
            { sala: payload.room },
            sobreposicoesDe(this.vault.contents.channelRooms[channel]?.[payload.room]?.payload),
            payload.perms,
          ),
      })
    } else if (payload.t === "channel.category") {
      this.#ouviuSalas(channel, sender)
      // A declared category. Same rule as everything else that describes the channel,
      // not a person: the most recent write wins.
      this.#pendingCategories.push({
        channel,
        category: payload.category,
        at: payload.updatedAt || Date.now(),
        seq,
        por: sender,
        payload,
        podeSobrepor:
          payload.perms !== undefined &&
          this.#podeSobreporDe(
            channel,
            sender,
            { categoria: payload.category },
            sobreposicoesDe(this.vault.contents.channelCategories?.[channel]?.[payload.category]?.payload),
            payload.perms,
          ),
      })
    } else if (payload.t === "space.meta") {
      // For the same reason as the profile: we want the most recent one, not the series, and
      // a repeated icon in the history would consume the media budget that belongs to messages.
      this.#pendingSpaceMeta.push({ channel, at: payload.updatedAt || Date.now(), seq, por: sender, payload })
      this.#ouviuQuemArruma(channel, sender)
    }
  }

  /**
   * Whether an action on roles (`role.define`, `role.assign`) is valid, depending on who
   * makes it (1.2). The founder and `admin` as always (`#mandaEm`); everyone else by
   * the delegation rule (`podeGerirCargo`, `podeAtribuir`): only roles below
   * them, and never more power than they have. Without looking at the delegation gate
   * (`delegacaoDeCargos`): the rule is the same in all new clients, and that is
   * what makes them reach the same state.
   *
   * Same question at live arrival, in telemetry, and in the Welcome snapshot.
   */
  #autoridadeAceita(channel: string, sender: string, payload: Readonly<Record<string, unknown>>): boolean {
    if (this.#mandaEm(channel, sender)) return true
    if (this.#eDirecta(channel)) return false
    const estado = this.#estadoDePermissoes(channel)
    if (payload["t"] === "role.assign") {
      const subject = typeof payload["subject"] === "string" ? payload["subject"] : ""
      const roles = Array.isArray(payload["roles"]) ? (payload["roles"] as unknown[]).filter((r): r is string => typeof r === "string") : []
      return podeAtribuir(estado, sender, subject, this.rolesFor(channel, subject), roles)
    }
    if (payload["t"] === "role.define") {
      const role = typeof payload["role"] === "string" ? payload["role"] : ""
      if (role === ADMIN_ROLE) return false
      const guardado = this.vault.contents.channelRoles[channel]?.[role]?.payload as Record<string, unknown> | undefined
      const fundido = fundirCargoAntigo(guardado, payload)
      const depois =
        fundido["removed"] === true
          ? undefined
          : { powers: poderesConhecidos(fundido["powers"]), rank: role === CARGO_TODOS ? -1 : typeof fundido["rank"] === "number" ? fundido["rank"] : 0 }
      return podeGerirCargo(estado, sender, role, { depois })
    }
    return false
  }

  /** Whether `sender` could change the overlays of this place from `before` to `after`. See `podeSobrepor`. */
  #podeSobreporDe(
    channel: string,
    sender: string,
    lugar: Lugar,
    antes: readonly Sobreposicao[] | undefined,
    depois: readonly Sobreposicao[],
  ): boolean {
    if (this.#eDirecta(channel)) return false
    return podeSobrepor(this.#estadoDePermissoes(channel), sender, lugar, antes, depois)
  }

  /** Nicknames already judged, waiting for the next write (phase 3). See `apelidos.ts`. */
  #pendingApelidos: ({ channel: string; subject: string } & RegistoDeApelido)[] = []
  /** Account successions already judged, waiting for the next write (phase 8.2). See `sucessao.ts`. */
  #pendingSucessoes: SucessaoRecebida[] = []

  /**
   * The succession that this message announces, if valid (phase 8.2, "Merge accounts").
   *
   * Only the sender's own succession counts, authenticated by MLS: the message says
   * "this account is now...", and "this account" is who signed it. Nobody says
   * for someone else that they changed accounts. Our own departure does not count either
   * (this account is leaving), nor an account saying it became itself, nor the account channel.
   *
   * `eraAmigo` is judged now, on arrival: the secondary account ends the friendship right
   * after the notice, and it is because it was a friend that the invite is offered.
   */
  #sucessaoRecebida(channel: string, sender: string, seq: number, payload: unknown): SucessaoRecebida | null {
    const sucessora = sucessoraDaMensagem(payload)
    if (!sucessora) return null
    if (channel === this.canalDaConta || sender === this.identity.address || sucessora.para === sender) return null
    const eraAmigo = friendsOfTies(this.friendTies()).includes(sender)
    return { de: sender, para: sucessora.para, at: sucessora.at, seq, canal: channel, eraAmigo }
  }

  /**
   * The nickname that this message changes, if whoever sent it could change it.
   *
   * Judged on receipt, with the roles this vault knows: the person themselves,
   * or whoever moderates. Direct messages and feeds have no nicknames. See `apelidos.ts`, where
   * it explains why we judge at write time, not at read time.
   */
  #apelidoAceite(
    channel: string,
    sender: string,
    seq: number,
    payload: unknown,
  ): ({ subject: string } & RegistoDeApelido) | null {
    const apelido = apelidoDaMensagem(payload)
    if (!apelido) return null
    if (this.#eDirecta(channel) || this.#eMural(channel)) return null
    if (apelido.subject !== sender && !this.mayModerate(channel, sender)) return null
    return { subject: apelido.subject, valor: apelido.nick, at: apelido.at, seq, por: sender }
  }

  #drainRecords(contents: VaultContents): void {
    /*
      The name, rooms, categories, roles, and profile of a board owner
      can break a provisional direct message (`#directaProvisoria`). The interface
      rereads the records each time the channel list changes: if the response changed,
      the list comes out again, otherwise the interface would keep the old one.
    */
    const provisoriasAntes = this.#chaveDasProvisorias()
    this.#drenarRegistos(contents)
    if (this.#chaveDasProvisorias() !== provisoriasAntes) queueMicrotask(() => this.emit("channels", { channels: this.channels }))
  }

  #drenarRegistos(contents: VaultContents): void {
    if (this.#pendingHistory.some(({ entry }) => isFriendPayload(entry.payload))) this.#avisarAmizades()
    for (const { channel, entry } of this.#pendingHistory) appendHistory(contents, channel, entry)
    this.#pendingHistory = []
    for (const { channel, subject, ...proposta } of this.#pendingApelidos) registarApelido(contents, channel, subject, proposta)
    this.#pendingApelidos = []
    let sucessoesMudaram = false
    for (const recebida of this.#pendingSucessoes) if (registarSucessao(contents, recebida)) sucessoesMudaram = true
    this.#pendingSucessoes = []
    if (sucessoesMudaram) queueMicrotask(() => this.#avisarSucessoes())
    for (const { address, at, payload } of this.#pendingDirectory) {
      const antes = contents.directory[address]?.at
      upsertDirectory(contents, address, payload, at)
      this.#fichaDoMuralQueChegou(contents, address)
      this.#perfilQueMudou(contents, address, antes)
    }
    this.#pendingDirectory = []
    for (const { channel, address, u, autoria, mural } of this.#pendingAutoriasDosPerfis) {
      const doCanal = contents.autoriasDosPerfis?.[channel] ?? {}
      // The most recent version, like the directory.
      if (doCanal[address] && doCanal[address].u > u) continue
      doCanal[address] = { u, autoria: structuredClone(autoria), ...(mural ? { mural: true as const } : {}) }
      contents.autoriasDosPerfis = { ...contents.autoriasDosPerfis, [channel]: doCanal }
    }
    this.#pendingAutoriasDosPerfis = []
    for (const lista of this.#pendingShownFriends) guardarListaMostrada(contents, lista)
    this.#pendingShownFriends = []
    for (const { channel, at, seq, por, payload } of this.#pendingSpaceMeta) {
      // The rule for all timestamped records: the timestamp wins, and `seq`
      // breaks ties (`venceCarimbo`, in `dobras.ts`).
      if (venceCarimbo(contents.spaceMeta[channel], { at, seq })) {
        contents.spaceMeta[channel] = { at, payload: structuredClone(payload), ...comSeq(seq), por }
      }
    }
    this.#pendingSpaceMeta = []
    for (const { channel, room, at, seq, por, payload, podeFixar, podeSobrepor } of this.#pendingRooms) {
      const doCanal = contents.channelRooms[channel] ?? {}
      const actual = doCanal[room]
      if (venceCarimbo(actual, { at, seq })) {
        /**
         * The room is replaced; the pinned list is MERGED. Two different rules
         * on the same record, and each one has its reason.
         *
         * The name, category, position, and tombstones are the room: the most
         * recent write wins, because it is the full declaration. The pinned list
         * does not come in the declaration, it only comes when someone talks about it, and
         * therefore absent means "this does not discuss pins", never
         * "unpin everything". Without this distinction, changing the room name would
         * unpin what was there, and whoever changed the name would never know.
         *
         * And it comes with authority: a `pinned` from someone who lacks `fixar` is
         * dropped, without taking the rest of the room with it. Rejecting the entire record
         * would be worse, someone with `renomear` but no `fixar` would stop being able
         * to rename the room if someone else changed it by mistake.
         */
        const anteriores = fixadasDe(actual?.payload)
        const propostas = podeFixar ? fixadasDe(payload) : undefined
        const fixadas = propostas ?? anteriores
        const proximo = structuredClone(payload) as Record<string, unknown>
        if (fixadas) proximo["pinned"] = fixadas
        else delete proximo["pinned"]
        // The overlays (1.2), by the same rule: absent keeps what is there, from someone who cannot drops it.
        const perms = sobreposicoesAGuardar(sobreposicoesDe(actual?.payload), sobreposicoesDe(payload), podeSobrepor)
        if (perms) proximo["perms"] = structuredClone(perms)
        else delete proximo["perms"]
        doCanal[room] = { at, payload: proximo as StoredChatMessage["payload"], ...comSeq(seq), por }
      }
      contents.channelRooms[channel] = doCanal
    }
    this.#pendingRooms = []
    for (const { channel, category, at, seq, por, payload, podeSobrepor } of this.#pendingCategories) {
      // `?? {}` on the field itself: a vault written before declared categories
      // has no map, and reads as "none declared".
      const doCanal = contents.channelCategories?.[channel] ?? {}
      const actual = doCanal[category]
      if (venceCarimbo(actual, { at, seq })) {
        // The overlays (1.2): absent keeps what is there, from someone who cannot drops it. See rooms, above.
        const proximo = structuredClone(payload) as Record<string, unknown>
        const perms = sobreposicoesAGuardar(sobreposicoesDe(actual?.payload), sobreposicoesDe(payload), podeSobrepor)
        if (perms) proximo["perms"] = structuredClone(perms)
        else delete proximo["perms"]
        doCanal[category] = { at, payload: proximo as StoredChatMessage["payload"], ...comSeq(seq), por }
      }
      contents.channelCategories = { ...(contents.channelCategories ?? {}), [channel]: doCanal }
    }
    this.#pendingCategories = []
    for (const { channel, role, at, seq, por, payload } of this.#pendingRoleDefs) {
      const doCanal = contents.channelRoles[channel] ?? {}
      const actual = doCanal[role]
      /*
        An old writer (without `rank`) only speaks about what they know: the rank and the
        new powers stay (`fundirCargoAntigo`). And at the same timestamp (republishing
        an action with the original date) the new writer's copy wins,
        whether it arrives first or last.
      */
      const fundido = fundirCargoAntigo(actual?.payload as Record<string, unknown> | undefined, payload as Record<string, unknown>)
      const maisCompleto =
        actual !== undefined &&
        actual.at === at &&
        typeof fundido["rank"] === "number" &&
        typeof (actual.payload as { rank?: unknown }).rank !== "number"
      if (venceCarimbo(actual, { at, seq }) || maisCompleto) {
        doCanal[role] = { at, payload: structuredClone(fundido) as StoredChatMessage["payload"], ...comSeq(seq), por }
      }
      contents.channelRoles[channel] = doCanal
    }
    this.#pendingRoleDefs = []
    for (const entrada of this.#pendingAuthority) {
      const { channel, address } = entrada
      if (entrada.kind === "founder") {
        const seq = entrada.seq
        /**
         * The first one seen wins, and it is not replaced.
         *
         * The rule used to be "lowest `seq` wins", which looks like server ordering
         * but is not: our own outgoing messages arrive here with `seq` equal to -1,
         * because they never loop back and never get a real number.
         * Lower than any true sequence, so anyone could claim a channel already founded
         * by publishing their own record, and their client would accept it immediately.
         *
         * Not replacing has an assumed cost: two nearly simultaneous records
         * can leave clients with different owners. It is rare, a channel founds once,
         * and it is preferable to a rule that can be fooled by a number that does not mean what it looks like.
         */
        if (!contents.channelFounder[channel]) {
          contents.channelFounder[channel] = { address, seq, payload: structuredClone(entrada.payload) }
        }
      } else {
        /**
         * The entire list, not a change.
         *
         * The new entry takes effect for this person, and the administrator list
         * from the old format stops being read for them, see
         * `rolesFor`. That is what makes removing someone take effect when loading
         * a vault written before roles: summing both lists would resurrect them by the old one.
         */
        // F11: the timestamp of who assigned wins, and `seq` breaks ties.
        aplicarAtribuicao(contents, channel, address, entrada.roles, {
          at: entrada.at,
          seq: entrada.seq,
          por: entrada.por,
          ...(entrada.autoria !== undefined ? { autoria: entrada.autoria } : {}),
        })
      }
    }
    this.#pendingAuthority = []
    for (const { channel, address } of this.#pendingTransmitters) noteTransmitter(contents, channel, address)
    this.#pendingTransmitters = []
    // And gaps go in the SAME write, for the usual reason: the vault is
    // encrypted in full each time it is saved, and a write just for this would double
    // the cost of each received message. See `#escreverLacunas`.
    this.#escreverLacunas(contents)
  }

  /** Stored history for a channel, oldest first. A copy: the vault's is live. */
  history(channel: string, limit?: number): StoredChatMessage[] {
    // Both lists (conversation and state log), in server order. Without the actions
    // inherited from pairing: this device never decrypted them, and the interface never had them (phase S2).
    const list = entradasDoCanal(this.vault.contents, channel).filter((entrada) => !entrada.herdado)
    const copia = structuredClone(limit === undefined ? list : list.slice(-limit))
    // Mentions of everyone only from whoever has the permission (`#comMencoesConferidas`).
    for (const entrada of copia) entrada.payload = this.#comMencoesConferidas(channel, entrada.sender, entrada.payload)
    return copia
  }

  /** The stored notification log, a copy. */
  notificationsSnapshot(): StoredNotification[] {
    return structuredClone(this.vault.contents.notifications)
  }

  async saveNotifications(entries: StoredNotification[]): Promise<void> {
    await this.vault.update((contents) => {
      contents.notifications = entries
    })
  }

  /** Every profile the vault remembers, keyed by address. */
  directorySnapshot(): Record<string, StoredPeerProfile> {
    return structuredClone(this.vault.contents.directory)
  }

  /**
   * Walk backwards once, for whatever still decrypts.
   *
   * Almost everything below `lastSeq` is gone for good — receiving it consumed
   * those ratchet generations. What this recovers is the narrow slice that
   * raced the last shutdown: events applied in memory but never flushed, still
   * inside the ratchet's out-of-order window of the *persisted* state. Each
   * event gets its own try/catch; failures are expected and silent.
   */
  async backfillBefore(channel: string, beforeSeq?: number, limit = 100): Promise<number> {
    const group = this.#groups.get(channel)
    const bound = beforeSeq ?? this.#oldestKnownSeq(channel)
    if (!group || bound === undefined || bound <= 0) return 0

    this.#send({ t: "channel.backfill", channel, beforeSeq: bound, limit })
    let page
    try {
      // By the channel label, like in `#catchUpChannel`: the two waits
      // share the same queue and can be in flight at the same time.
      page = await this.#await("channel.backfill.page", 10_000, channel)
    } catch {
      return 0
    }
    if (page.t !== "channel.backfill.page" || page.channel !== channel) return 0

    const recovered: StoredChatMessage[] = []
    const apelidosRecuperados: ({ subject: string } & RegistoDeApelido)[] = []
    const sucessoesRecuperadas: SucessaoRecebida[] = []
    const profiles: { address: string; at: number; payload: StoredChatMessage["payload"] }[] = []
    const listas: { author: string; shown: string[]; updatedAt: number }[] = []

    for (const event of [...page.events].sort((a, b) => a.seq - b.seq)) {
      // Never re-apply old commits: only application messages can carry chat.
      if (event.kind !== "application") continue
      /*
        And NOTHING FROM `bound` onwards, which is what this requested.

        Without this line the SERVER would choose the position of the event in the history
        of this device: `mergeOlderHistory` PREPENDS the page (`[...fresh,
        ...existing]`) and filters only by unknown `seq`, and the friendship fold
        consumes by array order, not by timestamp, on purpose, because
        timestamps are from the sender (see `foldFriendTies`). A `friend.remove`
        delivered in a backfill page would end up OLDER than the
        `request` and `accept` that follow it, was undone by them, the connection
        went back to "friends", and `syncFriendships` reseated in the feed whoever had been
        removed, with the `seq` marked as known, so neutralized
        permanently.

        The gate was CLOSED before October 5, 2026, because backfill did not
        rebuild `decline` or `remove`; it was the fix for those two that
        opened it. It closes here, where the contract is stated: a backfill page
        brings what is older than `bound`, and what is not does not enter.
      */
      if (event.seq >= bound) continue
      // An action of ours from the log without receipt (I3): written by the same path as
      // the others, with the `seq` from this page.
      if (event.kind === "application" && this.#reconhecerLivroNosso(channel, event.seq, fromBase64(event.ciphertext))) continue
      /*
        One event at a time, PER CHANNEL. See `#umDeCadaVezNoGrupo`.
        
        **This is the only group change that reuses a key, and it was here that
        key reuse was measured.** The others, `#invite`, `#unseat`,
        `expel`, `#admit`, commit, and a commit ADVANCES the epoch: the
        security tree is born again from zero and the generation with it, so
        what a lost write of theirs throws away is the account of an epoch already ended. This
        does not commit. It receives application messages, which leave the epoch
        where it was, and so a lost write restores a generation LOWER in
        the epoch where we are encrypting now.
        
        What we saw, with this call outside the queue: Ana's ratchet went to 1,
        a send used generation 1 and left it at 2, the backfill woke up and
        wrote back the state it had read, generation 1, and the
        next message was encrypted with generation 1 again. Same epoch, same leaf,
        same generation: the SAME key, and the same nonce minus the four bytes of
        `reuse_guard`. RFC 9420 §6.3.1 writes this case in full,         "a client MUST keep persistent state as to where in the key schedule it
        is; if this persistent state is lost or corrupted, a client might reuse a
        generation that has already been used, causing reuse of a key/nonce
        pair", and the reuse_guard exists precisely to cover it. Cover is not authorize:
        it is 2^-32 per pair of messages separating this from a broken AEAD, and
        the repeated message is always lost, because whoever receives already
        spent that generation and refuses the second without complaint.
        
        Once PER EVENT, not once around the whole loop: a page is a hundred
        messages to decrypt, and holding the channel during the entire page was
        paying with stuck writes exactly what `#umDeCadaVezNoGrupo` warns
        in its own header. So a live send passes between two events, which is
        what it already did in `#applyEvent`.
        */
      try {
        const result = await this.#umDeCadaVezNoGrupo(channel, async () => {
          // Read HERE INSIDE, and it is this move that is the whole fix: read
          // outside, the state that rereads is no longer what the send left.
          const live = this.#groups.get(channel)
          if (!live) return null
          const aberto = await receive(live, fromBase64(event.ciphertext))
          await this.#persistGroup(channel, aberto.session)
          return aberto
        })
        // The channel ceased to exist mid-page, dropped, deleted. There is
        // nowhere to recover to.
        if (!result) break
        if (result.kind !== "payload") continue
        // Same filter as the live path: what someone blocked said in a
        // direct channel does not enter the vault behind. See `#applyEvent`.
        if (result.sender !== this.identity.address && this.#bloqueadoAqui(channel, result.sender)) continue
        const payload = result.payload
        if (payload.t === "message") {
          recovered.push({ seq: event.seq, sender: result.sender, at: payload.sentAt, payload })
          // The nickname travels in this message and cannot go only to the history:
          // the conversation has a cap, and the record does not (phase 3, `apelidos.ts`).
          const apelido = this.#apelidoAceite(channel, result.sender, event.seq, payload)
          if (apelido) apelidosRecuperados.push(apelido)
          // And the account succession, for the same reason (phase 8.2, `sucessao.ts`).
          const sucessao = this.#sucessaoRecebida(channel, result.sender, event.seq, payload)
          if (sucessao) sucessoesRecuperadas.push(sucessao)
        } else if (payload.t === "post") {
          recovered.push({ seq: event.seq, sender: result.sender, at: payload.postedAt, payload })
        } else if (payload.t === "edit" || payload.t === "redact") {
          const at = payload.t === "edit" ? payload.editedAt : payload.redactedAt
          recovered.push({ seq: event.seq, sender: result.sender, at, payload })
        } else if (payload.t === "post.comment" || payload.t === "post.reaction") {
          const at = payload.t === "post.comment" ? payload.postedAt : payload.at
          recovered.push({ seq: event.seq, sender: result.sender, at, payload })
        } else if (isFriendPayload(payload)) {
          /*
            ALL FOUR, not two. This is where a declined or ended friendship
            came back as a pending request.

            `friend.decline` and `friend.remove` were dropped: the live path
            (`#recordPayload`) keeps all four, and the comment there
            explains why, "a forgotten decline on reload reopened the
            request", but this rebuild, which runs on any
            device that falls behind, only rebuilt the request and the acceptance.
            Result: `foldFriendTies` read the request without the decline that closed it and
            put it back in Friends as if it were waiting for a response.
            Worse with `friend.remove`, which is what stops reconciliation from
            reseating in the feed anyone who was already removed.

            By `isFriendPayload` and not by a list written by hand here: it is the
            same function that decides this on the live path and in the fold, and two
            lists of "payloads that change a friendship" was a guarantee they
            would diverge again.
          */
          const at =
            payload.t === "friend.request"
              ? payload.sentAt
              : payload.t === "friend.accept"
                ? payload.acceptedAt
                : payload.t === "friend.decline"
                  ? payload.declinedAt
                  : payload.t === "friend.remove"
                    ? payload.removedAt
                    : 0
          recovered.push({ seq: event.seq, sender: result.sender, at, payload })
        } else if (payload.t === "profile") {
          profiles.push({ address: result.sender, at: payload.updatedAt || 0, payload })
        } else if (payload.t === "friends.shown" && this.#donoDoFeed(channel) === result.sender) {
          // By the same guard as the live path. See `#recordPayload`.
          listas.push({ author: result.sender, shown: [...payload.shown], updatedAt: payload.updatedAt })
        }
      } catch {
        // Our own message, or a generation already consumed. Both expected.
      }
    }

    if (recovered.length > 0 || profiles.length > 0 || listas.length > 0) {
      // One vault write for the whole page.
      let sucessoesMudaram = false
      await this.vault.update((contents) => {
        mergeOlderHistory(contents, channel, recovered)
        for (const { subject, ...proposta } of apelidosRecuperados) registarApelido(contents, channel, subject, proposta)
        for (const recebida of sucessoesRecuperadas) if (registarSucessao(contents, recebida)) sucessoesMudaram = true
        for (const { address, at, payload } of profiles) {
          const antes = contents.directory[address]?.at
          upsertDirectory(contents, address, payload, at)
          this.#fichaDoMuralQueChegou(contents, address)
          this.#perfilQueMudou(contents, address, antes)
        }
        for (const lista of listas) guardarListaMostrada(contents, lista)
      })
      if (sucessoesMudaram) this.#avisarSucessoes()
    }
    /*
      Returns what STAYED, not what was decrypted.

      In a channel at the cap (`HISTORY_MAX_PER_CHANNEL`, 400) this is zero, and saying it is
      the point: `mergeOlderHistory` prepends the page and `enforceHistoryLimits` does
      `splice(0, …)` in the same mutation, so the entries just prepended
      are exactly the ones the cut takes. Returning `recovered.length` made the
      call claim it had gone well, and the rebuild of friendships, which is
      the reason this exists, was a silent no-op in all full channels.

      The fix for RECOVERY itself is another conversation (a channel at the cap has
      nowhere to store what is older than the cap), and is in
      `docs/PENDENTES.md`. What fixes here is the lie.
    */
    const guardados = new Set(entradasDoCanal(this.vault.contents, channel).map((entrada) => entrada.seq))
    return recovered.filter((entrada) => guardados.has(entrada.seq)).length
  }

  #oldestKnownSeq(channel: string): number | undefined {
    // Both lists, without the ones inherited from pairing: their `seq` was read
    // by another device, and says nothing about what this one already read.
    let oldest: number | undefined
    for (const entry of entradasDoCanal(this.vault.contents, channel)) {
      if (entry.seq < 0 || entry.herdado) continue
      if (oldest === undefined || entry.seq < oldest) oldest = entry.seq
    }
    if (oldest !== undefined) return oldest
    const last = this.vault.contents.lastSeq[channel]
    return last === undefined ? undefined : last + 1
  }

  /** The room common to the whole server, if this one has one. Announced in `hello`. */
  #commonRoom: string | null = null

  /** The name of the common room on this server, so the interface can tell it apart. */
  get commonRoom(): string | null {
    return this.#commonRoom
  }

  /**
   * The common room that the server announces, accepted only if it really is a room.
   *
   * This is not type hygiene, it is the only defense that exists here. `#answerRejoin`
   * refuses entry to anyone who was never in a channel, and makes an exception for the
   * common room: whoever arrives is not yet a member and that is exactly why
   * they ask. But the identifier for that exception comes in `hello`, meaning it is
   * CHOSEN BY THE SERVER, which is the only piece of this system
   * that nobody grants authority over who belongs in a group.
   *
   * Concrete scenario: whoever takes the gateway announces `commonRoom` equal to the
   * private conversation between two people, or someone's feed. Both identifiers
   * come from public addresses (`feedChannelOf`, `openDirect`), so there is no
   * need to guess anything. Then a throwaway account just sends a
   * `channel.rejoin.request` to the first honest member online sitting
   * there, permanently, with the invite leaving their client, not the server.
   *
   * Refusing feeds and DMs closes the case where the target is derivable from the address, which is
   * what turns the attack from general to directed. What is left unclosed is said
   * in the report: a hostile server can point the exception to a
   * private room whose identifier it knows, and it knows all the ones it routes.
   */
  #acceptCommonRoom(announced: string | undefined): string | null {
    if (!announced) return null
    const sufixo = `:${homeserverOf(this.identity)}`
    if (!announced.startsWith("!") || !announced.endsWith(sufixo)) return null
    const nome = announced.slice(1, announced.length - sufixo.length)
    // Only one room: not direct, not board, not account channel, by the record.
    if (nome.length === 0 || this.tipoDoCanal(announced) !== "sala") return null
    return announced
  }

  /** Does the account want to be in the common room? Without a choice made, yes. See `salaComum.ts`. */
  querSalaComum(): boolean {
    return querSalaComum(this.preferencias())
  }

  /**
   * Choose whether the account joins the common room, and join if the answer is yes.
   *
   * At signup, before the first connection: with `false`, the handshake end no longer joins. Later, via the "Join Orwell channel" button: with `true`, join immediately (or request a seat and keep trying, as always). This choice syncs to other devices on the account like any preference.
   *
   * `false` does not remove anyone from the room: use `leaveChannel` for that, which also writes the choice.
   */
  async escolherSalaComum(entrar: boolean): Promise<void> {
    await this.definirPreferencia(PREFERENCIA_SALA_COMUM, entrar ? SALA_COMUM_ENTRAR : SALA_COMUM_FORA)
    if (entrar) await this.ensureCommonRoom()
  }

  /**
   * Join the room where everyone on this server is.
   *
   * The server announces the name and decides who creates it, but does not create it: it has no group keys, and that is the product's premise. Hence the two paths: whoever wins the arbitration creates the group, whoever loses requests entry from the winner and waits for an online member to admit them.
   *
   * Idempotent: anyone already there exits on the first line.
   */
  async ensureCommonRoom(): Promise<void> {
    /**
     * One attempt at a time, and this is the missing piece.
     *
     * Two run on their own without anyone requesting them: the handshake end calls this, and the app calls it again after reconnecting. Without queuing, both would draw a blank at the same time, one would enter, the other would get nothing and request a seat from members. Someone there would then admit someone who had already entered, with a remove followed by an add, and the Welcome of that admission would replace beneath them the group they were already in. Measured: two `channel.groupinfo.take` calls, two entries, one re-adoption, and the profile of whoever was already there published in an epoch they never saw.
     *
     * The queue combines calls instead of chaining them (see `#umaDeCadaVez`), which is what we want here: the second has no work to do if the first already entered.
     */
    return this.#umaDeCadaVez("sala-comum", () => this.#ensureCommonRoomAgora())
  }

  async #ensureCommonRoomAgora(): Promise<void> {
    const sala = this.#commonRoom
    if (!sala) return
    if (this.#groups.has(sala)) {
      /**
       * Now inside: check whether the gate is set for whoever comes next.
       *
       * A blank drawn is only repaid by whoever drew it, and whoever drew it may have closed the app in the middle. In a silent room, where the epoch does not advance for weeks, that gap does not repair itself and the room again depends on someone being awake, which is exactly what this came to solve.
       *
       * Here, not on arrival: at this point catch-up has run, so the blank we publish describes the current epoch and not one that already passed. An old blank placed over the good one sends everyone who arrives into the void.
       */
      if (!this.#salaComumTemCartao) {
        this.#salaComumTemCartao = true
        this.#agendarCartao(sala)
      }
      this.#pararDeInsistir()
      return
    }

    /*
      The account said no (at signup, or leaving the channel): we do not join, and we do not retry. Here, not in the caller, because four call this (the handshake end, the retry, the denial, and the choice) and all must obey the same answer. Anyone already inside left on the line above: the choice does not remove anyone from the room. See `salaComum.ts`.
      */
    if (!this.querSalaComum()) {
      this.#pararDeInsistir()
      return
    }

    /**
     * While we are not inside, there is always a next attempt.
     *
     * The retry arm used to live at the end of the request-a-seat branch, so any early exit killed the retry for the rest of the connection: `#send` throwing with the socket reconnecting, the timeout waiting for the response, or `#failPending` resolving the wait with an error frame during a drop. The person stayed out with nothing scheduled and nothing on screen, until restarting the app.
     *
     * In a `finally`, then, not on the happy path. Exiting from inside the group is the only end, and `#pararDeInsistir` is what marks it.
     */
    try {
      await this.#tentarEntrarNaSalaComum(sala)
    } finally {
      if (!this.#groups.has(sala)) this.#insistirNaSalaComum()
    }
  }

  async #tentarEntrarNaSalaComum(sala: string): Promise<void> {

    this.#send({ t: "channel.claim", channel: sala })
    let resposta
    try {
      resposta = await this.#await("channel.claim.result")
    } catch {
      // Older server, or connection dropping. The next connection tries.
      return
    }
    if (resposta.t !== "channel.claim.result") return

    /**
     * Creating requires both things: that the creation is ours AND that nothing has been created.
     *
     * `mine` alone is not enough, because the claim is stored on the server and whoever made it still has it after losing the group state, reinstalled the browser, imported the account, hit "start over rooms", or the server declared a restart and the client dropped everything on its own. Creating then makes a SECOND MLS group with the same ID, and everyone who was there goes deaf with no error anywhere: exactly the silent collision this room came to solve, repeated on the other side.
     *
     * `empty` absent is a server before this. It also does not create: the doubt is resolved in favor of not breaking everyone's room.
     */
    if (resposta.mine && resposta.empty === true) {
      /**
       * `createSpace` not `createSpaceChannel`: the common channel is a people channel, and such a channel is born with the rooms that explain it.
       *
       * This does not touch the arbitration, whoever creates is still decided by the two conditions above, and this branch stays the same branch. What changes is only what happens AFTER the group exists, and each room fails on its own in there: a publication that does not go out does not undo the channel for everyone.
       */
      await this.createSpace(sala, Session.SALAS_DO_CANAL_COMUM)
      // The gate is set in the same gesture that creates the room, and it is set right away: whoever arrives next enters without needing to find anyone awake.
      await this.#publicarCartao(sala).catch(() => {})
      this.#pararDeInsistir()
      this.emit("status", {
        detail: "Criaste a sala comum deste servidor. Quem entrar a seguir vai pedir-te para o admitir.",
        level: "info",
        code: "channel-joined",
        route: "log",
        channel: sala,
      })
      return
    }

    /**
     * The gate that opens on its own, and the one we try first.
     *
     * The path below depends on there being an awake member the exact instant the request passes. Two accounts registered in the middle of the night on a server where nobody was connected ended up locked out for four days because of that, and nobody on the other side could know. See `#entrarComCartao`.
     */
    if (await this.#entrarComCartao(sala)) return

    // No blank: the room may not even exist yet, or the blank may have been drawn by someone else at the same instant. Request a seat, and request again, see `#insistirNaSalaComum`. Do not subscribe: the server no longer allows it for anyone without a seat, and it is not needed, the Welcome that admits someone is directed by name and arrives anyway.
    this.#send({ t: "channel.rejoin.request", channel: sala })

    /**
     * Say what happened, not what was expected to happen.
     *
     * The message from here was optimistic and only one: "request sent", and that was it, forever. The server now tells how many members the request reached, and zero is the information that was missing, no one is online who can admit, which is different from being ignored by someone who is.
     */
    let ouviram: number | null = null
    try {
      const recibo = await this.#await("channel.rejoin.sent")
      if (recibo.t === "channel.rejoin.sent") ouviram = recibo.ouviram
    } catch {
      // Older server, or connection dropping. Without a receipt, the old text stays, and the retry remains scheduled anyway.
    }

    this.emit("status", {
      detail:
        ouviram === 0
          ? "Pedido de entrada na sala comum enviado, mas não está ninguém online para o aceitar. Fica a tentar sozinho."
          : "Pedido de entrada na sala comum enviado. Falta alguém que já lá esteja aceitar.",
      level: "info",
      code: "channel-joined",
      route: "log",
      channel: sala,
    })
  }

  /**
   * Join the common room without asking permission.
   *
   * Draw the blank that is there (`GroupInfo` with external setup), build a commit that adds to the tree, and get inside. No Welcome, no admission, no waiting for an awake member. What replaces someone's authorization is the policy of the room itself, which is open to any account on this server by policy taken, and it is the server that enforces it, by only storing and only delivering a blank for the channel it announces as common.
   *
   * **The blank is single-use, and that is the piece that stops bifurcation.** Two arriving at the same instant would produce two commits for the same epoch, of which the room accepts only one: the other would have a group with the right name and nobody inside, writing to the void with no symptom. Because the server delivers the blank once and deletes it, the second does not get it and falls to the path below, which retries until there is a blank again.
   *
   * @returns whether we joined. `false` means try the old path.
   */
  async #entrarComCartao(sala: string): Promise<boolean> {
    // A server that does not store blanks does not answer this request, and waiting ten seconds for the timeout of a response that will not come delays entry for everyone against any server before this.
    if (!this.#serverCapabilities.includes("common-room-groupinfo")) return false

    /**
     * The key we use to enter, verified BEFORE we request the gate.
     *
     * Our key package, which burns like any other: the leaf we are about to occupy is built from it, and keeping the private half after use is a secret debt with no reward.
     *
     * This used to be read AFTER the `take`, and the `take` is irreversible: the server delivers the blank once and deletes it. A vault with no keys, the handshake reset failed, and it fails silently on purpose to not drop the connection, would draw the room's gate, could not use it, and return `false`. The room was left without any blank because of someone who never even entered, and the worst part is the retry repeats: at 15s, at 30s, at 60s and then every two minutes, each attempt burning the blank another member just reposted. While that app was open, the gate vanished as soon as it appeared, and with no one online to admit via the path below, no one else entered.
     */
    const [primeira] = [...this.#keyPackages.entries()]
    if (!primeira) return false

    this.#send({ t: "channel.groupinfo.take", channel: sala })

    let cartao
    try {
      const resposta = await this.#await("channel.groupinfo")
      if (resposta.t !== "channel.groupinfo" || !resposta.info) return false
      cartao = fromBase64(resposta.info)
    } catch {
      // Older server, or connection dropping. The path below works.
      return false
    }

    const [id, guardada] = primeira
    const par = importKeyPackage(guardada)

    let entrada
    try {
      entrada = await joinChannelExternally(sala, cartao, par.publicPackage, par.privatePackage)
    } catch {
      // A blank that does not open is a spent blank, from another epoch, or junk. None of this fixes here: the path below requests a seat and retries.
      return false
    }
    if (entrada.resync) {
      this.emit("status", {
        detail: `${sala}: este aparelho já estava na árvore; a entrada tira a folha antiga (resync)`,
        level: "info",
        code: "rejoin-resync",
        route: "log",
        channel: sala,
      })
    }

    // Spent already, whether the commit went or not: the leaf it built may have gone to the wire, and a key package does not use twice.
    this.#keyPackages.delete(id)
    this.#keyPackagesDirty = true

    /*
      The commit goes out, and only with the verdict do we enter. See `#commitar`.
      
      It used to be applied, stored, and followed by the next blank before the server said anything. Someone arriving at the same time and admitted by a member would produce another commit for the same epoch, and each would be on their branch; the next blank, published over a commit that might not enter, would send anyone coming next to that branch.
      
      Without the "pending" record that member commits have: there is no group to return to if the echo is lost. If the commit entered and the echo did not arrive, the leaf stays in the tree and the next entry gets it via `resync`.
      */
    let lugar: number
    try {
      lugar = await this.#umDeCadaVezNoGrupo(sala, async () => {
        const nosso: CommitNosso = { commit: entrada.commit, base: epochOf(entrada.session) - 1n, session: entrada.session }
        const seq = await this.#publicarCommit(sala, nosso, false)
        await this.#persistGroup(sala, entrada.session)
        this.vault.contents.seatSince = { ...this.vault.contents.seatSince, [sala]: seq }
        /*
          And the epoch of the seat, which here is the line that stops a false positive we measured: a frame another member encrypted in the epoch BEFORE this commit and the server numbered after it has `seq` above our seat and epoch below ours. It was never ours. See `#epocaAoLigar`.
          */
        this.#epocaAoLigar.set(sala, epochOf(entrada.session))
        await this.flush()
        return seq
      })
    } catch {
      await this.flush().catch(() => {})
      return false
    }

    await this.#comRecuperacaoPorFazer([sala], async () => {
      this.#send({ t: "channel.subscribe", channels: [sala] })
      // Right away, not after a second and a half: the gate we just used is now spent, and someone who closes the app right after entering left the room without any. The delay is to collapse bursts of commits, and this is not a burst, it is the only moment when the room is guaranteed to have no gate. And only now, with the commit accepted: before this the blank described an epoch that might never exist.
      await this.#publicarCartao(sala).catch(() => {})
      /*
        The check for denials only against a server without the rule of one commit per epoch. With it, the echo is proof that this commit IS the epoch's commit: there is no phantom branch to deny, and frames that arrive encrypted in the epoch before are just from those who have not yet applied our entry, which were exactly what made a newcomer forget the room and join again.
        */
      if (!this.#serverCapabilities.includes(CAPACIDADE_UM_COMMIT_POR_EPOCA)) this.#entradaExternaPorConfirmar.set(sala, 0)
      this.#pararDeInsistir()
      this.#announceLocalEpoch(sala)
      this.emit("channels", { channels: this.channels })
      this.emit("status", {
        detail: `entrou em ${sala} (evento ${lugar})`,
        level: "info",
        code: "channel-joined",
        route: "log",
        channel: sala,
      })
      await this.#catchUp([sala]).catch(() => {})
    })
    await this.publishProfile([sala]).catch(() => {})
    this.#pedirPerfisNaSalaComum()
    return true
  }

  /**
   * Repost the common room's blank, once per burst.
   *
   * Published whenever the epoch advances, because a blank is only good for the epoch it describes. During a catch-up that is several commits in a row, and a blank per commit is the entire tree going to the server as many times as it changed, all but the last one waste. The delay collapses the burst and publishes the state it ended in.
   *
   * Only for the common room, and it is the server that checks it again: the blank of a private channel would be its key left at the door.
   */
  #cartaoTimer: ReturnType<typeof setTimeout> | null = null
  #agendarCartao(canal: string): void {
    if (canal !== this.#commonRoom) return
    if (this.#cartaoTimer) return
    this.#cartaoTimer = setTimeout(() => {
      this.#cartaoTimer = null
      void this.#publicarCartao(canal).catch(() => {})
    }, Session.CARTAO_ATRASO_MS)
  }

  static readonly CARTAO_ATRASO_MS = 1_500

  async #publicarCartao(canal: string): Promise<void> {
    if (canal !== this.#commonRoom) return
    const grupo = this.#groups.get(canal)
    if (!grupo) return
    /*
      Someone who knows they are behind does not post a blank.
      
      A blank describes the epoch of who publishes it. Published by a member stuck in an epoch the room already left, it sends everyone who arrives into a dead branch, the common room had on 12/9/2026 a blank in epoch 16 with members in 17. Someone posting that way was someone connecting and reading in `hello.ok` that a blank was missing, confident recovery was up to date; it was not. What we know here: an epoch gap to close, a recovery running, or frames seen from an epoch ahead of ours. When recovery ends, try again.
      */
    if (this.#atrasadoEm(canal, grupo)) {
      this.#cartaoAdiado = true
      return
    }
    this.#cartaoAdiado = false
    this.#send({ t: "channel.groupinfo.put", channel: canal, info: toBase64(await publishableGroupInfo(grupo)) })
  }

  /** A blank was not posted because we are behind. See `#publicarCartao`. */
  #cartaoAdiado = false
  /** The highest epoch seen in a frame ahead of the group, per channel. See `BuracoDeEpoca`. */
  #epocaFuturaVista = new Map<string, bigint>()

  #atrasadoEm(canal: string, grupo: GroupSession): boolean {
    return this.#buracos.has(canal) || this.#recuperacoes.has(canal) || (this.#epocaFuturaVista.get(canal) ?? -1n) > epochOf(grupo)
  }

  /**
   * Entries via blank that have not yet proved themselves, and the frames that deny them.
   *
   * An external commit built on a blank that no longer described the room is rejected by those inside, silently, and whoever built it stays convinced they entered. The symptom is the opposite of deafness: instead of the channel being ahead of us, it is behind, with everything arriving live encrypted in an epoch BEFORE ours. No one in the world has that combination for real.
   *
   * Single-use blanks make this rare; rare is not never, and a silent phantom is precisely what this product cannot have. Three live frames are enough to conclude, and the exit is to drop the imaginary seat and go back through the gate.
   */
  /** The server said in `hello.ok` that the common room has a gate posted. */
  #salaComumTemCartao = false
  #entradaExternaPorConfirmar = new Map<string, number>()
  static readonly FANTASMA_LIMITE = 3

  /**
   * A live frame encrypted before our seat, in a room we just joined via blank: the room is behind us, and a room does not go backwards. At the third one, drop the imaginary seat and go back to the gate.
   *
   * Only count what arrives LIVE. The catch-up of someone entering is done, almost all, from history before their seat, it is what any healthy entry has behind it, and counting it would undo all good entries.
   */
  #contarDesmentido(canal: string, aoVivo: boolean): void {
    if (!aoVivo) return
    const vistos = this.#entradaExternaPorConfirmar.get(canal)
    if (vistos === undefined) return

    const total = vistos + 1
    this.#entradaExternaPorConfirmar.set(canal, total)
    if (total < Session.FANTASMA_LIMITE) return

    this.#entradaExternaPorConfirmar.delete(canal)
    void (async () => {
      await this.forgetChannel(canal)
      this.#pararDeInsistir()
      await this.ensureCommonRoom()
    })().catch(() => {})
  }

  /** Base wait between retries for entry. Doubles up to the limit. */
  static readonly REJOIN_RETRY_MS = 15_000
  static readonly REJOIN_RETRY_CEILING_MS = 120_000
  #salaComumTimer: ReturnType<typeof setTimeout> | null = null
  #salaComumTentativas = 0

  /**
   * Request entry to the common room again, until someone admits.
   *
   * The request is a frame and that is it: the server does not store it and it only reaches those subscribed the exact instant it passes. Two consequences, both observed:
   *
   * - whoever arrives at the same time as the creator requests before there is anyone to respond. The frame passes in a room where nobody listens yet and dies there.
   * - whoever arrives when no one is online requests to an empty room. When a member shows up, half an hour later, there is nothing to tell them.
   *
   * In both cases the request was made once per connection, and the person stayed out until restarting the app, with nothing on screen to explain it. Retrying costs a small frame, first every fifteen seconds and then fewer times each go, up to a limit of two minutes.
   */
  #insistirNaSalaComum(): void {
    if (this.#salaComumTimer) return
    const espera = Math.min(
      Session.REJOIN_RETRY_MS * 2 ** this.#salaComumTentativas,
      Session.REJOIN_RETRY_CEILING_MS,
    )
    this.#salaComumTentativas += 1
    this.#salaComumTimer = setTimeout(() => {
      this.#salaComumTimer = null
      // Through the front gate: request again also recovers the room that was left requested by someone who never got to create it (see `Store.claimChannel`).
      void this.ensureCommonRoom().catch(() => {})
    }, espera)
  }

  #pararDeInsistir(): void {
    this.#salaComumTentativas = 0
    if (this.#salaComumTimer) {
      clearTimeout(this.#salaComumTimer)
      this.#salaComumTimer = null
    }
  }

  /** Channels already given their one backwards look this run. */
  #backfilled = new Set<string>()

  async #backfillMissed(channels: string[]): Promise<void> {
    for (const channel of channels) {
      if (this.#backfilled.has(channel)) continue
      this.#backfilled.add(channel)
      try {
        await this.backfillBefore(channel)
      } catch {
        // Recovery is best-effort by definition; the timeline shows a divider.
      }
    }
  }

  /**
   * Apply one event, live or replayed.
   *
   * Shared by both paths deliberately: a commit must be handled identically
   * whether it arrives in real time or hours later, and having two copies of
   * this logic is how they drift apart.
   */
  async #applyEvent(
    channel: string,
    kind: string,
    ciphertext: Uint8Array,
    seq: number,
    aoVivo = false,
    /**
     * Written here, and read by whoever decides the anchor. See `Desfecho`.
     *
     * `prova`: entered in the epoch the group is in. `saltado`: did not enter, and we had a seat in the channel when it was announced, it is a gap, not noise.
     */
    desfecho?: { prova: boolean; saltado?: boolean },
    /** The server minute for this event (`receivedAtMinute`). Only Welcome uses it: it is the time of the seat. */
    minuto?: number,
  ): Promise<void> {
    if (kind === "welcome") {
      await this.#acceptWelcome(channel, ciphertext, seq, minuto)
      return
    }
    // An act of ours from the ledger that left no receipt, coming back through recovery (I3).
    // It does not decrypt from this side, and it is not deafness: record it and done.
    if (kind === "application" && this.#reconhecerLivroNosso(channel, seq, ciphertext)) return

    /*
      One event at a time, PER CHANNEL. See `#umDeCadaVezNoGrupo`.
      
      Opening an event means reading the group state, decrypting from it, and
      writing back the state that resulted. Between read and write there is
      async cryptographic work, and frames arriving from the server do not wait
      for each other: each one's `#onFrame` is fired with `void`, and catch-up
      runs alongside the ones coming live.
      
      Two reads in flight at the same time break the channel two ways, both
      measured: the second decrypts against a state the first already replaced
      (a message encrypted in the new epoch opened with the old key, which gives
      "invalid tag" and nothing more), and the second's write clobbers the first
      (the commit applied and then undone, leaving the device one epoch behind
      forever). In both cases the message vanishes without complaint.
      */
    let adoptado: CommitNosso | undefined
    let epocaAntes: bigint | undefined
    const result = await this.#umDeCadaVezNoGrupo(channel, async () => {
      // Read HERE INSIDE, not before entering the queue: whoever waited their turn
      // must read the state left by whoever went ahead, or the queue serves no purpose.
      const group = this.#groups.get(channel)
      if (!group) return null
      epocaAntes = epochOf(group)
      /*
        A commit of OURS that got no verdict and ended up in anyway.

        MLS does not let anyone process their own commit: it arrives from the
        server and gets rejected like any foreign commit that does not decrypt,
        and this device stayed one epoch behind the whole channel. We recognize
        it by the bytes, which the server returns unchanged, and apply the group
        we saved with it. See `#publicarCommit`.
      */
      if (kind === "handshake") {
        const nosso = this.#tirarPorConfirmar(channel, ciphertext, epochOf(group))
        if (nosso) {
          await this.#persistGroup(channel, nosso.session)
          adoptado = nosso
          return { kind: "epoch" as const, session: nosso.session, epoch: epochOf(nosso.session) }
        }
      }
      const aberto = await receive(group, ciphertext)
      await this.#persistGroup(channel, aberto.session)
      return aberto
    })
    if (!result) return
    if (
      desfecho &&
      (result.kind === "epoch" || (result.kind === "payload" && declaredEpoch(ciphertext) === epocaAntes))
    ) {
      desfecho.prova = true
    }
    if (adoptado) {
      // The Welcome from an admission that got no verdict only comes out now, when
      // we know the commit backing it exists for everyone, and before we record it,
      // for the reason in `#commitar`.
      if (adoptado.welcome) {
        // No wait: this runs in the receive queue, which a rate-limit pause (S6) was
        // blocking. No pause means it goes out immediately, before recording, like in
        // `#commitar`.
        this.#enviarWelcome(channel, adoptado.welcome).catch(() => {
          // No connection: see `#commitar`.
        })
      }
      await this.flush()
    }

    const futuro = result.kind === "ignored" && result.epochDoFrame !== undefined && result.epochDoFrame > epochOf(result.session)
    if (futuro && seq >= 0 && seq < (this.vault.contents.seatSince?.[channel] ?? -1)) {
      /*
        Ahead in epoch, but before our place: no gap at all.

        Only happens in a channel rebuilt by someone who lost state, same
        identifier, new group with epochs restarting, where what remains of the
        old group has higher epochs than the new one. Treating it as a gap would
        stall recovery for anyone readmitted right at the first old event, and
        each old event is another gap. See `seatSince` in the vault.
      */
      return
    }

    if (result.kind === "ignored" && anteriorAoNossoLugar(result)) {
      /*
        Neither symptom nor health: a frame that is before our place.
        
        Counting it was the bug. When someone joins a channel they receive, in
        catch-up, all the history before their place, and forward secrecy
        guarantees that NONE of it decrypts, five messages said before someone
        arrives are exactly `DEAF_FAILURES`, in a perfectly healthy join. The
        second check did not save it: `desde` only resets on success, and in a
        quiet channel there is none, so the series opened by the history stayed
        open indefinitely and an unreadable frame thirty seconds later declared
        the channel deaf. After that comes `repairChannel`, the rejoin request,
        the reseat of whoever responds, and reseat is a remove followed by an
        add, meaning the channel history vanishes for whoever got "repaired".
        Silent damage, and from a normal join.
        
        Do not count it and do not clear the count: a frame that could never
        decrypt is not proof of any disease, and it is not proof that we hear
        either.
        */
      this.#contarDesmentido(channel, aoVivo)
      /*
        **TWO THINGS THAT WERE COLLAPSED INTO ONE ARE SEPARATED HERE.**

        "Do not count toward deafness" and "mark as read" are not the same
        decision, and until October 5, 2026 they were the same line. The first
        is right and stays intact, it is the August 16 decision, written in
        `docs/PENDENTES.md`: counting this declared channels deaf where someone
        had just joined, and deafness brings a repair that drags the history.
        The second was wrong: an event said AFTER we had our place, which does
        not decrypt because our epoch moved ahead of it, is a lost message, and
        `return`ing here marked it read, with the anchor passing over it forever.
        
**THE DISTINCTION IS EPOCH, NOT `seq`, AND THIS WAS WRONG.** The first
        version compared `seq` against `seatSince`, and `seatSince` is a sequence
        number: it measured against the old client script and gave a false
        positive right away. Someone joining by card commits in epoch E; a frame
        another member encrypted in epoch E-1 and the server numbered AFTER our
        commit has `seq` above `seatSince` and epoch below ours, it was never
        ours, it would never decrypt, and it was announced as a loss. It is the
        August 16 trap again, in another form: declare a problem for someone who
        just joined.
        
What we ask now is the right question: **DID THIS DEVICE EVER HAVE THIS
        EPOCH?** The floor is the epoch at which this device found the channel
        when it connected, or the epoch at which it joined, if it joined
        mid-connection. Above the floor, we had the key and this should have
        decrypted: loss. Below it, either it is before our place or before this
        connection, and in neither case can we say it was ours. See
        `#epocaAoLigar`.
        
Err on the side of not accusing: a loss that a prior connection caused
        and this one finds is not named. It is the old behavior in that case, not
        a regression, and the opposite would ask the server, for thirty days,
        for events that were never for this device.
        
None of this touches the deafness counter: whoever reads it is the next
        block, and this path exits without going through it, exactly as it did
        before.
      */
      const piso = this.#epocaAoLigar.get(channel)
      if (desfecho && seq >= 0 && piso !== undefined && result.epochDoFrame !== undefined && result.epochDoFrame >= piso) {
        desfecho.saltado = true
      }
      return
    }

    if (result.kind === "epoch" && estaRemovido(result.session)) {
      // We were removed. Nothing that follows (republish, repair) is ours: wait for
      // grace and drop the channel. See `#fomosRemovidos`.
      this.#fomosRemovidos(channel)
      return
    }

    if (result.kind === "ignored" && estaRemovido(result.session)) {
      // Out of the group, nothing decrypts, and that is not deafness: it is the
      // exit. Counting would trigger a rejoin request to whoever removed us (F7).
      // This is also usually how removal arrives: ts-mls cannot apply a commit that
      // removes us (see `receive` in the crypto package), and it marks it there.
      this.#fomosRemovidos(channel)
      return
    }

    if (result.kind === "ignored") {
      // Our own echoes and replayed handshakes land here too, so one failure
      // means nothing; a run of them means the seat is dead.
      const estado = this.#undecryptable.get(channel) ?? { falhas: 0, desde: Date.now() }
      estado.falhas += 1
      this.#undecryptable.set(channel, estado)
      // Past the threshold, ask for a new seat, once per channel per session,
      // because the answer arrives as a welcome, not as a reply. See DEAF_FAILURES:
      // counting is not enough, it has to hurt for a while.
      const surdo = surdezConfirmada(estado, Date.now())
      if (surdo && !this.#rejoinAsked.has(channel)) {
        this.#rejoinAsked.add(channel)
        // Everything this side can do about it, at once — and without asking
        // anybody. Asking only the members was half a remedy: the invitation
        // this device had already written off stayed written off, so a welcome
        // the server was still holding could never be tried again, and the two
        // sides waited for each other for ever.
        void this.repairChannel(channel).catch(() => {})
        this.emit("status", {
          detail: `${channel}: este dispositivo perdeu o acesso. Pedido de reentrada enviado aos membros.`,
          level: "info",
          code: "channel-deaf",
          // The repair is already under way and Amigos says so, with a button.
          // Shouting it at every login helps nobody: it is a state, not news.
          route: "log",
          channel,
        })
      }
      /*
        Counted as deafness AND reported as a gap, in that order.

        Counted, because a place on a dead branch only sees frames ahead and this
        count is what asks for a new place. Reported as a gap, because the most
        common case is not a dead branch: it is a commit we have not read yet,
        and recovery from the anchor will bring it. See `BuracoDeEpoca`.
      */
      if (futuro && result.epochDoFrame !== undefined) {
        const vista = this.#epocaFuturaVista.get(channel)
        if (vista === undefined || vista < result.epochDoFrame) this.#epocaFuturaVista.set(channel, result.epochDoFrame)
        throw new BuracoDeEpoca(result.epochDoFrame, epochOf(result.session))
      }
    } else {
      this.#undecryptable.delete(channel)
      this.#rejoinAsked.delete(channel)
      // A frame that decrypts is proof our place is the same as everyone else's. It
      // closes the observation opened by a card join.
      this.#entradaExternaPorConfirmar.delete(channel)
    }

    // The epoch changed under us: the card on the server no longer describes this
    // room, and whoever arrives with it is out. Reset it.
    if (result.kind === "epoch") this.#agendarCartao(channel)
    // Any event that decrypts in my feed also decrypts on an old client, and
    // resets their failed count. See `#listasSeguidas`.
    if (channel === this.feedChannel && (result.kind === "epoch" || result.kind === "payload")) {
      // A list from my other device is, to an old client, one more failure: it
      // counts, and does not reset.
      if (result.kind === "payload" && result.payload.t === "friends.shown" && result.sender === this.identity.address) {
        this.#listasSeguidas += 1
      } else {
        this.#outroEventoNoFeed()
      }
    }

    if (result.kind === "payload") {
      // Which device, and at which epoch: proof of life for the F16. See `#folhasMortas`.
      this.#notarVivo(channel, result.senderDeviceKey, declaredEpoch(ciphertext))
      // And for anti-entropy election (S4), live only: live is "gave a signal recently".
      if (aoVivo) this.#anti.notarVivo(toBase64(result.senderDeviceKey))
      // The device signal of a sibling: he knows he is in the account channel.
      if (
        result.sender === this.identity.address &&
        result.payload.t === "typing" &&
        result.payload.capacidades?.includes(CAPACIDADE_ESTADO_DA_CONTA)
      ) {
        this.#notarAparelhoComEstado(result.senderDeviceKey, result.payload.capacidades.includes(CAPACIDADE_CHAVE_DE_CONTA))
      }
      /*
        The device signal of any member, in any channel (S1, §4.6): it
        deduplicates resend, or requests profiles (F10). Live and in recovery:
        whoever announced themselves while we were away counts the same.
      */
      if (result.payload.t === "typing" && result.payload.capacidades && channel !== this.canalDaConta) {
        const capacidades = result.payload.capacidades
        this.#anti.notarCapacidades(channel, toBase64(result.senderDeviceKey), capacidades)
        if (
          capacidades.includes(CAPACIDADE_REENVIO) &&
          toBase64(result.senderDeviceKey) !== toBase64(this.identity.deviceSigningPublicKey)
        ) {
          this.#notarReenvio(channel, result.senderDeviceKey)
        }
        if (capacidades.includes(CAPACIDADE_PEDE_PERFIS)) this.#responderAPedidoDePerfis(channel, result.sender, seq, aoVivo)
        if (capacidades.includes(CAPACIDADE_PERMISSOES)) this.#notarPermissoes(channel, result.senderDeviceKey)
      }
      /*
        The account channel is not a conversation: what comes there is state
        merging into the vault, and nothing else. No history, no `message`, no
        ledger, live or in recovery.
      */
      if (channel === this.canalDaConta) {
        this.#aoEstado(result.sender, result.senderDeviceKey, result.payload)
        return
      }
      /*
        The block filter, AFTER decrypting (phase 3). It could not be before:
        the event has to pass through the group for the ratchet to advance, or
        the next one would not decrypt and the channel would go deaf from a
        block.
        
        In a direct with someone we blocked, in her feed or in ours, what she
        says does not record, does not broadcast and does not reach
        `#onFriendPayload`: no message, no friend request, no buzz, no call. In
        shared rooms it passes (see `#bloqueadoAqui`). The exit also passes
        (`member.left`, which only removes her) and the channel tomb (which only
        closes it): refusing them would leave her in there.
        */
      if (
        result.payload.t !== "member.left" &&
        result.payload.t !== "space.removed" &&
        result.sender !== this.identity.address &&
        this.#bloqueadoAqui(channel, result.sender)
      ) {
        return
      }
      if (result.payload.t.startsWith("voice.")) {
        /**
         * Call signaling only works live.
         *
         * This was already said in a comment: replaying old signaling was
         * worse than useless because it would try to negotiate with someone who
         * hung up hours ago, and then it only checked `seq >= 0`, which
         * excludes our own echoes and nothing else. The whole channel history
         * went through.
         *
         * The effect was visible: joining an empty call immediately created a
         * connection to someone who had announced themselves in the morning, sat
         * in "calling" for 25 seconds and disappeared with a network error. It
         * was reported as a bug many times before we understood what it was.
         */
        if (seq >= 0 && aoVivo) {
          /*
            Move and disconnect only obey the sender (2/11/2026, "like in
            Discord"). The request runs without asking the moved person anything,
            and so whoever can do it has to be checked here, where the sender
            comes authenticated by MLS. Without this, any member with a modified
            client could remove someone from a call. Our own messages do not go
            through here (their `seq` is negative).
          */
          if (result.payload.t === "voice.move" && !this.#podeMoverDe(channel, result.sender, result.payload)) return
          this.emit("voice", { channel, from: result.sender, payload: result.payload })
        }
        return
      }
      if (result.payload.t === "typing") {
        // Anti-entropy reports (S4), live AND in recovery: they are content.
        if (result.payload.relatos) {
          void this.#anti.aoRelatos(channel, seq, result.payload.relatos, toBase64(result.senderDeviceKey))
        }
        // One chunk of video from a post, live and in recovery. See `videos.ts`.
        if (result.payload.video) void this.#videos.aoParte(channel, result.payload.video, toBase64(result.senderDeviceKey))
        /**
         * Writing only works live, and for the same reason as signaling above.
         *
         * Replaying this from a backfill would light someone's typing indicator
         * who typed this morning, for the duration of the timeout, and every
         * time the app opened. The `return` is what keeps this out of
         * `#recordPayload` and the `message` event: it never goes to disk and
         * never enters the conversation.
         */
        if (seq >= 0 && aoVivo) {
          this.emit("typing", {
            channel,
            from: result.sender,
            room: result.payload.room ?? "",
            until: result.payload.until,
          })
        }
        return
      }
      if (result.payload.t === "buzz") {
        /**
         * A buzz is only felt in the moment.
         *
         * Without this cut, a backfill would shake the screen once for each
         * stored buzz, yesterday's whole conversation, in one go, when the app
         * opened. It is the same trap as the typing signal taken to the worst
         * case, because this one has motion and sound stuck to it.
         */
        if (seq >= 0 && aoVivo) this.emit("buzz", { channel, from: result.sender, at: result.payload.at })
        return
      }
      if (result.payload.t === "member.left") {
        /**
         * Someone left: remove their leaf, which is the only way the exit exists.
         *
         * **MLS does not let anyone remove themselves** (RFC 9420 §12.2: a
         * commit that removes the leaf of whoever signs it is invalid), so
         * whoever is leaving can only REQUEST. This is where the exit happens,
         * and it is this side's commit that advances the epoch and closes the
         * future to whoever left. Without this, leaving was a local gesture by
         * the departing person: they vanished from their own screen and stayed
         * in everyone else's list, with the keys still working. This was how
         * account deletion left the person visible in the channel.
         *
         * To the sender only. MLS authenticates who sent it, and what gets
         * removed is their leaf: no matter how much a modified client sends this,
         * there is nothing here that removes anyone else.
         *
         * Backward compatible too, like the tomb. If everyone was offline when
         * the exit was published, it runs in the catch-up of whoever comes back
         *, or the leaf would stay forever for a calendar reason. `#honrarSaida`
         * does nothing if the leaf is already gone, so replaying it a thousand
         * times costs one tree read.
         */
        const quemSaiu = result.sender
        void this.#honrarSaida(channel, quemSaiu).catch((erro: unknown) => {
          // The next connection re-reads the event and tries again: it stays in the channel.
          // But it is reported, and removal is the same `removeMembers` as a rejoin.
          this.#falhaDeLugar(channel, "saída", erro)
        })
        return
      }
      if (result.payload.t === "space.removed") {
        /**
         * The channel tomb: whoever receives it drops the channel.
         *
         * This is where "delete" happens for everyone who did not delete it,          * and what happens is exactly the same as what happens to someone who
         * leaves by choice. No server takes part in this: the tomb traveled
         * encrypted inside the group like any message.
         *
         * Backward compatible, and not just live. Someone who was offline when
         * the channel ended receives it in catch-up, and has to honor it the
         * same, or the channel would stay alive forever for whoever was away.
         *
         * We do not ask the publisher if they could: `#mandaEm` and roles are
         * group state each client reads for themselves, but the sender comes
         * authenticated by MLS and the choice to leave a channel is always ours.
         * Refusing here would be staying in a channel that no longer exists for
         * the others.
         *
         * Deferred until after recording, like the friendship path below and for
         * the same reason: dropping the group mid-batch would decrypt the rest
         * of the batch against keys that no longer exist.
         */
        const nome = this.spaceMeta(channel)?.name ?? channel
        void this.flush()
          .then(() => this.forgetChannel(channel))
          .then(() => {
            // A channel that disappeared silently would be indistinguishable from a crash.
            // Say what happened. Messages do NOT stay: `forgetChannel` just erased this
            // channel's history (`#largarGrupo(canal, true)`). The message lives in the
            // interface catalog (`avisosDoNucleo.channelDeleted`), chosen by `code`; the
            // name goes in `detail`, after the key, because the channel has been forgotten
            // and the interface can no longer read it.
            this.emit("status", {
              detail: `channel-deleted: ${nome}`,
              level: "info",
              code: "channel-deleted",
              route: "toast",
              channel,
            })
          })
          .catch(() => {
            // The next connection brings the tomb again: it stays in the channel.
          })
        return
      }
      if (result.payload.t === "device.revoke") {
        /**
         * An account removed one of its devices. It counts if the account's KEY
         * (read from the leaf's credential it came from) signed it: a lone
         * device cannot revoke its siblings. It stays in the vault, and the
         * admit gates (`#pacotesAdmissiveis`, `#admit`) start refusing that
         * leaf. We do not remove the leaf from here: whoever revokes already
         * does it, and each member committing the same removal was a fork per
         * channel.
         *
         * Backward compatible: a catch-up that brings it counts the same.
         */
        const lida = lerRevogacao(
          result.payload,
          result.sender,
          // From the tree of the message's epoch, like the sender (see `receive` in the crypto package).
          result.senderAccountKey,
        )
        if (!lida.ok) {
          this.emit("status", {
            detail: `${channel}: revogação de aparelho recusada (${lida.razao})`,
            level: "error",
            code: "device-revoke-invalid",
            route: "log",
            channel,
          })
        } else if (notarRevogado(this.vault.contents, result.sender, lida.aparelho)) {
          this.#memoriaPorGravar = true
          this.#agendarGravacao()
          this.#manifestosRecentes.delete(result.sender)
          if (result.sender === this.identity.address && lida.aparelho === toBase64(this.identity.deviceSigningPublicKey)) {
            this.emit("status", {
              detail: "este aparelho foi tirado da conta noutro aparelho",
              level: "error",
              code: "device-revoked",
              route: "toast",
            })
          }
        }
      }
      // Queue the chat-visible payloads for the vault write that `#rememberSeq`
      // is about to do anyway. Ephemeral kinds (typing, signalling) never land
      // on disk, and voice.* already returned above.
      this.#recordPayload(channel, seq, result.sender, result.payload)
      // A friendship that arrives live closes live. See `#onFriendPayload` for why
      // it is live only, and `syncFriendships` for what came before.
      if (aoVivo && seq >= 0 && result.sender !== this.identity.address && isFriendPayload(result.payload)) {
        const payload = result.payload
        const sender = result.sender
        // After recording: the vault fold reads from the vault, and reacting before it
        // would decide over a state missing exactly this event.
        void this.flush()
          .then(() => this.#onFriendPayload(channel, sender, payload))
          .catch(() => {
            // The next connection reconciles. An error here must not take the channel down with it.
          })
      }
      // And a live accepted invite becomes a live room through the same path and for the same reasons. See `#onInvitePayload` and `syncChannelInvites`.
      if (aoVivo && seq >= 0 && result.sender !== this.identity.address && isInvitePayload(result.payload)) {
        const payload = result.payload
        const sender = result.sender
        void this.flush()
          .then(() => this.#onInvitePayload(channel, sender, payload))
          .catch(() => {
            // The next connection reconciles, and the invite only expires after two weeks: plenty of chances to retry.
          })
      }
      /*
        The invite for someone who took over a joined account (phase 8.2) also during recovery, not just live. This happens every day: the inviter opens the direct message and sends the invite right after, and this device enters the direct through Welcome and reads the invite during recovery. Replying here does not decide on old state: `#aceitarConviteDaSucessao` rereads the fold and only accepts an invite still pending.
        */
      if (!aoVivo && seq >= 0 && result.sender !== this.identity.address && result.payload.t === "message" && result.payload.invite?.sucessao) {
        const payload = result.payload
        const sender = result.sender
        void this.flush()
          .then(() => this.#onInvitePayload(channel, sender, payload))
          .catch(() => {})
      }
      this.emit("message", { channel, seq, sender: result.sender, payload: this.#comMencoesConferidas(channel, result.sender, result.payload), ...(aoVivo ? { aoVivo: true as const } : {}) })
    } else if (result.kind === "epoch") {
      this.emit("epoch", { channel, epoch: result.epoch.toString() })
      // An epoch change is a membership change: whoever just joined has never
      // seen our profile — it was published before they held keys. Re-publish
      // into this channel so new members get names and avatars now, not on
      // our next reconnect. Epochs are rare; the cost is one sealed profile.
      //
      // Only when the group actually GREW, though. An epoch also advances when
      // somebody leaves, is re-seated, or a key rotates, and republishing on all
      // of those is what turned a 124 KB profile into the bulk of the server's
      // storage: every commit made every member republish to every channel.
      const grew = this.#noteMembership(channel)
      // The newcomer does not read telemetry from conversation before this commit (S4). See `piso`.
      if (grew && seq >= 0) this.#anti.aoCrescer(channel, seq)
      // A direct message that ended up with just us because another device committed (F9).
      if (aoVivo) this.#directaSozinha(channel)
      // In the account channel, the newcomer gets the entire state, nothing else.
      if (grew && channel === this.canalDaConta) {
        void this.#enviarEstadoCompleto().catch(() => {})
      } else if (grew) {
        // Live only: during recovery old changes all go through again, and what matters is the current state. See `#agendarUltimoActo`.
        if (aoVivo) this.#agendarUltimoActo(channel)
        /*
          During recovery, once per channel, at the end of it (3/11/2026, "login seems very slow").
          
          Each change triggered the entire cascade (profile, authority, rooms, roles, forwarding, what is ours), and during recovery old changes all go through: someone who was away while eight accounts joined the common room said everything eight times. Each send takes the group's turn and writes the vault entirely before leaving (the nonce rule, in `#cifrarEEnviar`), and recovery waits for the same turn for each event: with whoever fixes the common room, 67 sends in series below the gate, plus one more second on login (`scripts/medir-login.mjs`).
          
          Once is enough: it leaves on the current epoch, which everyone who joined deciphers, and it says the current state, which is what matters.
          */
        if (!aoVivo && this.#recuperacoes.has(channel)) this.#crescidosNaRecuperacao.add(channel)
        else this.#dizerAQuemEntrou(channel)
        // And the rooms, if we do not fix the channel and nobody who would fix it tells them.
        this.#revezarSalas(channel)
      }
    }
  }

  /**
   * What we tell a newcomer to a channel: the profile, the authority, the rooms and the roles, forwarding and what is ours. Send and forget.
   */
  #dizerAQuemEntrou(channel: string): void {
    void this.publishProfile([channel], true).catch(() => {})
    // And who runs the channel, for the exact same reason and with more weight: without this, a newcomer does not know who founded the channel, and what would have been done with that ignorance is written in `republishAuthority`. Authority first, then rooms: order is the guard.
    void this.republishAuthority(channel)
      .catch(() => {})
      .then(() => this.republishRooms(channel))
      .catch(() => {})
      // The newcomer learns that we deduplicate forwarding (§4.6).
      .then(() => this.#anunciarReenvio(channel))
      .catch(() => {})
      // And what is ours, for the same reason as the other three: someone who just joined cannot decipher anything in there. The wall, comments, likes and votes, and tickets (S1).
      .then(() => this.#reenviarDoProprio(channel))
      .catch(() => {})
  }

  /**
   * Channels that grew during recovery and have not yet told the newcomer. They leave at the end of the channel recovery, once. A channel whose recovery ended without a connection stays here until the next recovery.
   */
  #crescidosNaRecuperacao = new Set<string>()

  /**
   * An epoch left this direct with just our account: repair the pair, only it (F9).
   *
   * Without this the direct would stay like this until the next connection, and everything written in it would go to nobody. Through `repairInvite`, with a six-hour brake. With wait and new tree read: the epoch may be half a reseating done by another device of ours, which puts the pair back right after, and two doing it would waste a key package. Not when we removed it because they left (`#honrarSaida`): leaving a direct is on them.
   */
  #directaSozinha(channel: string): void {
    if (!this.#eDirecta(channel)) return
    const so = (): boolean => {
      const grupo = this.#groups.get(channel)
      if (!grupo || estaRemovido(grupo)) return false
      const contas = new Set([...memberAddresses(grupo.state.ratchetTree).values()].map(String))
      return contas.size === 1 && contas.has(this.identity.address)
    }
    if (!so()) return
    const par = this.#parDoCanal(channel)
    if (!par || par === this.identity.address || this.#saiuPorVontade(channel, par)) return
    setTimeout(() => {
      if (!so() || this.#connection !== "online") return
      if (this.friendTies().get(par)?.severed) return
      void this.repairInvite(channel, par).catch(() => {})
    }, REJOIN_TURN_MS * 2)
  }

  /** If this person left this channel by their own request (`member.left`). See `#honrarSaidaAgora`. */
  #saiuPorVontade(channel: string, address: string): boolean {
    return this.vault.contents.saidasHonradas?.[`${channel}|${address}`] !== undefined
  }

  /**
   * Tell the UI that the composition of this channel changed by OUR action.
   *
   * The `epoch` event was only sent on the path of received events, that is, for whoever suffers the change and never for whoever makes it. Visible result: when someone invited another person, they did not see the people list update, the invited person appeared to everyone except the inviter, until they reloaded the page.
   *
   * The local commit is already applied when this runs; it just needs to be counted.
   */
  /**
   * @param retrato the channel state already went through Welcome (phase 1 of 1.1):
   *   `"entregue"` on the side of the inviter, when the portrait went complete and all new leaves read it; `"recebido"` on the side of the newcomer and they applied it.
   *   On `"entregue"` skip republishing authority, rooms and our profile (they already went). On `"recebido"` skip authority, rooms and turn-taking: someone who just joined only repeated to others what they already have (before 1.1 they had nothing and repeated nothing). The profile of the newcomer goes out the same way: the others do not have it.
   */
  #announceLocalEpoch(channel: string, retrato?: "entregue" | "recebido"): void {
    const group = this.#groups.get(channel)
    if (!group) return
    if (channel === this.feedChannel) this.#outroEventoNoFeed()
    const cresceu = this.#noteMembership(channel)
    this.emit("epoch", { channel, epoch: epochOf(group).toString() })
    this.emit("channels", { channels: this.channels })

    // Our commits never come back to us on the events path, so the common room card must be restored here: without it, an admission or expulsion made by this device left on the server a card that no longer described the room, and whoever arrived next entered into a void.
    this.#agendarCartao(channel)

    /**
     * And republishing, which here is what counts, because this is the INVITER path.
     *
     * Republishing over there runs on the path of received events, and our commits are never sent back to us: the inviter applies it locally and comes through here. Result, before this: in a channel of two people, the founder and the invitee, which is how almost all channels start, there was no third party to republish anything, and the invitee had no owner, no name and no roles until the founder reconnected. And it was in that wait that they could expel the person who invited them.
     *
     * `#noteMembership` consumes the change, so it must be read here: the receive path would not see it anymore. Only when it grew, an expulsion or a role removed also touch the epoch, and republishing in all of them once filled the server with repeated profiles.
     *
     * It leaves after the commit and welcome, not before: the first thing `send` does is encrypt, which yields the turn already, and whoever called this still has socket writes to do in the same tick.
     */
    // In the account channel, the newcomer has no state at all: they get the entire one, and nothing from the cascade of channels (authority, rooms, profile, wall).
    if (cresceu && channel === this.canalDaConta) {
      void this.#enviarEstadoCompleto().catch(() => {})
      return
    }
    if (cresceu) {
      // Someone who just joined a direct reads the friendship state. See `#agendarUltimoActo`.
      this.#agendarUltimoActo(channel)
      const comEstado = retrato === undefined
      void (comEstado ? this.republishAuthority(channel) : Promise.resolve())
        .catch(() => {})
        .then(() => (comEstado ? this.republishRooms(channel) : undefined))
        .catch(() => {})
        // And the name, which was left out when this was written.
        //
        // The receive path republishes three things when the channel grows: authority, rooms and PROFILE. Here two were republished. Since this is the INVITER path, the result was that the invitee published their profile on subscribe, and that is why the inviter saw their name, but never received the name of the person who invited them.
        //
        // What they saw in the name's place was the `shortAddress`, the first word of the address. Words like that look like nicknames, and that is why the symptom came back as "the name does not match" instead of "there is no name": nobody suspects "bebobbus". It is pinned down by `fundador.test.ts`.
        //
        // Deliberately last: authority is the guard and goes first on the wire, the name is cosmetic and can wait one tick.
        .then(() => (retrato === "entregue" ? undefined : this.publishProfile([channel], true)))
        .catch(() => {})
        // The newcomer learns that we deduplicate forwarding (§4.6).
        .then(() => this.#anunciarReenvio(channel))
        .catch(() => {})
        // And what is ours, for the same reason as the other three: the wall, comments, likes and votes, and tickets (S1).
        .then(() => this.#reenviarDoProprio(channel))
        .catch(() => {})
      // And the rooms, if we do not fix the channel and nobody who would fix it tells them.
      if (retrato !== "recebido") this.#revezarSalas(channel)
    }
  }

  /**
   * Track who belongs to a channel, and report whether anybody new arrived.
   *
   * Cheap and deliberately not persisted: after a restart the first epoch change republishes once, which is the safe direction to be wrong in, somebody who joined gets a name, instead of nobody getting one.
   *
   * The decision itself is `chegouAlguemNovo`, pure and exported: it compared only the TOTAL of leaves, and an equal total read as "nobody joined". What stays here is the write of what we saw.
   */
  #noteMembership(channel: string): boolean {
    const group = this.#groups.get(channel)
    if (!group) return false
    const agora = [...memberAddresses(group.state.ratchetTree).values()]
    const antes = this.#memberCounts.get(channel)
    this.#memberCounts.set(channel, { folhas: agora.length, enderecos: new Set<string>(agora) })
    return chegouAlguemNovo(antes, agora)
  }

  // --------------------------------------------------------------- inbound

  async #onFrame(frame: ServerFrame): Promise<void> {
    // First the media frames, and the order is deliberate: they match by TAG, and the queue below matches by type. Letting the queue see an `sfu.*` first gave it a chance to deliver another's reply to one request, the defect the tag came to prevent. See `#onSfu`.
    if (this.#onSfu(frame)) return
    // And the pairing ones, matched by `pairId` by the host's state machine, which knows what step we are on. See `emparelhar.ts`.
    if (this.#anfitriao !== null && this.#anfitriao.receber(frame)) {
      if (this.#anfitriao.acabou) this.#anfitriao = null
      return
    }

    // The ephemeral signals of account sync (S4). See `sincronia/pedido.ts`. Those in the account channel are from device history: anti-entropy does not run there.
    if (frame.t === "channel.sinal") {
      if (frame.channel !== "" && frame.channel === this.canalDaConta) void this.#historico.aoSinal(frame)
      else void this.#anti.aoSinal(frame)
      return
    }
    if (frame.t === "channel.sinal.rejected") {
      if (frame.channel !== "" && frame.channel === this.canalDaConta) this.#historico.aoRecusa(frame)
      else this.#anti.aoRecusa(frame)
      return
    }

    /*
      Recovery pages match by CHANNEL, not by arrival order.
      
      The type queue rests on a premise the server does not meet: that everything asked gets answered. `channel.backfill` is discarded silently when `#mayReach` says no, a room the server no longer knows, the same state that turns on "this room no longer exists", and when `BACKFILLS_POR_MINUTO` passes, which a device with three channels behind hits without effort, because `#catchUpChannel` asks up to forty pages per channel.
      
      One silent question was enough to misalign the whole queue: from then on each page ended up waiting for the EARLIER one, which saw it from another channel and broke without a word. Measured: with two invites waiting, which anyone gets after a day away, because each welcome does its own catch-up, the HEALTHY channel ended up with the anchor unwritten, and its wait died of timeout ten seconds later. A channel recovering badly is an epoch that does not advance, and everything unreadable comes after.
      
      `#onClose` has the other half of this same trap written in a comment, from a socket that died. This one needs none.
      
      It is the same choice `#sfuPendentes` made by tag: when the reply shape does not distinguish it, match by what does.
      */
    // And replies to the key package claim match by ADDRESS, for the same reason: two invites in flight on the same socket swapped replies.
    const chave =
      frame.t === "channel.backfill.page"
        ? `${frame.t}|${frame.channel}`
        : frame.t === "keypackage.claimed" || frame.t === "manifest.result"
          ? `${frame.t}|${frame.address}`
          : frame.t.startsWith("pair.") && "pairId" in frame
            ? `${frame.t}|${frame.pairId}`
            : // The two replies to `invite.resolve` in the same queue, by short code: whoever asks waits for one or the other, and two resolutions in flight do not swap replies. See `resolverConvite`.
              frame.t === "invite.resolved" || frame.t === "invite.unresolved"
              ? `invite.resolved|${frame.codigo}`
              : // By `codeHash`, for the same reason. See `nomeDoConvite`.
                frame.t === "invite.selo.result"
                ? `${frame.t}|${frame.codeHash}`
                : frame.t
    const queue = this.#pending.get(chave)
    if (queue && queue.length > 0) {
      const waiter = queue.shift() as (frame: ServerFrame) => void
      if (queue.length === 0) this.#pending.delete(chave)
      waiter(frame)
      return
    }

    if (frame.t === "error" && frame.code === "account-suspended") {
      /*
        The account is suspended on this server (reports, §8). Reconnecting gives the same refusal: disconnect right now, no reconnect. The notice reads from the signed request, which does not need the gate; without it, the status comes out the same.
        */
      const detail = frame.message
      this.#leituraDaSuspensao = this.avisoDeSuspensao()
        .catch(() => null)
        .then((aviso) => {
          this.emit("status", {
            detail,
            level: "error",
            code: "account-suspended",
            route: "toast",
            ...(aviso ? { aviso } : {}),
          })
        })
      this.disconnect()
      return
    }

    if (frame.t === "error" && frame.code === "device-revoked") {
      /*
        The server refused this device: the account removed it from the manifest on another device. It is not a network failure, and reconnecting gives the same refusal: disconnect for real, and the UI says why.
        */
      this.emit("status", {
        detail: "este aparelho foi tirado da conta noutro aparelho",
        level: "error",
        code: "device-revoked",
        route: "toast",
      })
      this.disconnect()
      return
    }

    if (frame.t === "error") {
      // Server error frames are protocol mechanics in English ("unparseable
      // frame", "authenticate first"). A person can act on none of them, and
      // during a reconnect storm they arrive in bursts — so they go to the
      // log. A fatal one is different: the connection is being dropped for a
      // reason worth knowing, like this address being bound to another key.
      this.emit("status", {
        detail: `${frame.code}: ${frame.message}`,
        level: "error",
        code: "server-error",
        route: frame.fatal ? "toast" : "log",
      })
      return
    }

    if (frame.t === "keypackage.low") {
      // The nudge can land in the same tick as a disconnect; topping up then
      // throws on a dead socket. The pool is refilled at the next connect
      // anyway, so this is a lost opportunity, never an error.
      await this.topUpKeyPackages(20).catch(() => {})
      return
    }

    if (frame.t === "channel.rejected" && frame.reason === "rate-limited") {
      this.#aoRecusaPorRitmo(frame.channel, frame.ref, frame.retryAfterMs)
      return
    }
    // Another refusal of our send: it was not accepted, but got a reply. Slow mode moves to the next (S6); slow mode stays.
    if (frame.t === "channel.rejected" && frame.ref !== undefined) this.#libertarVezDe(frame.ref)

    if (frame.t === "channel.rejected" && frame.reason === "stale-epoch") {
      /*
        Our commit arrived late to the epoch: another won it. No place is lost, and we do not tell the person, it is mechanics that `#commitar` solves on its own. Only the send with this `ref` learns it; others in the channel do not.
        */
      const espera = frame.ref !== undefined ? this.#confirmacoes.get(frame.ref) : undefined
      if (frame.ref !== undefined) this.#ownRefs.delete(frame.ref)
      if (espera) espera.reject(new EpocaVelhaNoServidor(frame.epoch))
      return
    }

    if (frame.t === "channel.rejected" && frame.reason === "update-required") {
      /*
        The server does not accept commits or cards from this connection because it did not announce `commit-after-echo`. This client always announces it, so this is a defect in us or a server talking nonsense: diagnosis, and never the warning of "you lost your place". Whoever waits for this send learns it now, instead of wasting the timeout.
        */
      const espera = frame.ref !== undefined ? this.#confirmacoes.get(frame.ref) : undefined
      if (frame.ref !== undefined) this.#ownRefs.delete(frame.ref)
      if (espera) espera.reject(new AtualizacaoExigida())
      this.emit("status", {
        detail: `${frame.channel}: o servidor recusou um commit ou cartão desta ligação (update-required)`,
        level: "error",
        code: "update-required",
        route: "log",
        channel: frame.channel,
      })
      return
    }

    if (frame.t === "channel.rejected" && frame.reason === "stale-groupinfo") {
      /*
        Our card from an epoch the channel already left. The server did not keep it, and rightly so: whoever entered with it would end up alone in a dead branch. Diagnosis only, whoever is ahead restores the right card.
        */
      this.emit("status", {
        detail: `${frame.channel}: cartão de entrada recusado por ser de uma epoch passada (o canal vai na ${frame.epoch ?? "?"})`,
        level: "info",
        code: "groupinfo-rejected",
        route: "log",
        channel: frame.channel,
      })
      return
    }

    if (frame.t === "channel.rejected") {
      /**
       * We wrote to a channel where the server does not recognize us as a member.
       *
       * This was silent both ways: the server discarded it, and from here everything looked fine, the message entered local history and the screen said yes. It happens to someone who has a room the server no longer knows, and it is how an assumed admin got stuck in a computer for ten minutes without anybody knowing.
       *
       * Said once per channel, not per frame: in a call it would be dozens per second, and the notice would become unreadable.
       */
      // The caller waiting for this channel's receipt learns right away instead of
      // waiting ten seconds for an echo that will never come.
      this.#falharConfirmacoes("this device has no seat in this channel", frame.channel)
      if (!this.#orfaos.has(frame.channel)) {
        this.#orfaos.add(frame.channel)
        this.emit("status", {
          detail:
            "Esta sala já não existe no servidor, ou este dispositivo perdeu o lugar nela. O que escreveres aqui não chega a ninguém — sai da sala e pede para te convidarem outra vez.",
          level: "error",
          code: "channel-orphaned",
          route: "toast",
          channel: frame.channel,
        })
      }
      return
    }

    if (frame.t === "channel.rejoin") {
      // A peer requesting a seat: this sheet says it is alive, so the responder
      // will not be hit with theirs (F16).
      if (frame.address === this.#identity?.address) this.#provarVida(frame.channel)
      // Somebody in a channel we hold says their seat stopped working. Give
      // them a new one — but only if nobody closer to the front of the queue
      // does it first. See `#answerRejoin`.
      void this.#answerRejoin(frame.channel, frame.address).catch((erro: unknown) => {
        // Silently swallowed until 12/9/2026, and the shared room repair was failing
        // with no one knowing why: a `removeMembers` throwing due to a missing patch
        // on the server. No one expects this, so the place to report it is diagnostics
        // without the full address of the caller.
        this.#falhaDeLugar(frame.channel, "reentrada", erro)
      })
      return
    }

    if (frame.t === "presence") {
      // Relayed live and kept only in whoever is listening; the session holds
      // no roster. A reconnect starts clean and the server re-tells it.
      this.emit("presence", { address: frame.address as UserAddress, online: frame.online })
      // Whoever came online now is who can receive what we owe them. See `#aoVerOnline`.
      if (frame.online) this.#presentes.add(frame.address)
      else this.#presentes.delete(frame.address)
      if (frame.online) this.#aoVerOnline(frame.address)
      return
    }

    if (frame.t === "invite.request") {
      await this.#admit(frame.channel, frame.address, fromBase64(frame.keyPackage), frame.codeHash)
      return
    }

    if (frame.t === "invite.rejected") {
      const reason =
        frame.reason === "expired"
          ? "that invite expired"
          : frame.reason === "exhausted"
            ? "that invite reached its limit"
            : frame.reason === "rate-limited"
              ? "too many invite requests"
              : "that invite no longer exists"
      // The one invite status a person asked for: they pasted a link a
      // moment ago and it did not work.
      this.emit("status", { detail: reason, level: "error", code: "invite-rejected", route: "toast" })
      return
    }

    if (frame.t !== "channel.event") return

    // Our own send, echoed back. Already applied locally.
    // Accepted: drops out of retries, and the slow mode of that bucket ends (S6).
    if (frame.ref) this.#aoEcoDoEnvio(frame.ref)
    if (frame.ref && this.#ownRefs.delete(frame.ref)) {
      // This is where we know the server accepted it: it recorded and returned it
      // with our reference. The caller waiting for the receipt has it.
      const espera = this.#confirmacoes.get(frame.ref)
      // The echo `seq` for the send stored with -1 (S1).
      const eco = this.#ecos.get(frame.ref)
      if (eco) {
        this.#ecos.delete(frame.ref)
        this.#confirmarEco(eco.channel, eco.chave, frame.seq, eco.marca)
      }
      if (espera) espera.resolve(frame.seq)
      // No one waiting: the timeout passed. If it was from the log, save it now (I3).
      else if (frame.kind === "application") this.#reconhecerLivroNosso(frame.channel, frame.seq, fromBase64(frame.ciphertext))
      return
    }

    /*
      The gate comes before applying, not after.

      While recovery of this channel has not finished, this thread waits: what
      lies between the anchor and it has not been read yet, and applying it now
      could advance the epoch over messages that fail to open. See
      `#portaoFechado`, which is where the bug this fixes is documented.
    */
    if (this.#reterAoVivo(frame.channel, frame.seq, frame.kind, frame.ciphertext, frame.receivedAtMinute)) return

    /*
      Only application messages arriving live are saved with the vault window
      (`#rememberSeq` with `adiar`). A commit or a Welcome saves right away, and
      the disk follows the epoch at the instant it changes (`session.particao`, M2).
      Draining the held messages (`#largarRetidas`) also saves right away: it
      decides where the next recovery begins, and its guarantees are tied to each
      write (`session.portao`).
    */
    await this.#aplicarAoVivo(frame.channel, frame.seq, frame.kind, frame.ciphertext, frame.receivedAtMinute, false, frame.kind === "application")
  }

  /**
   * Apply a frame live and decide what to do with the anchor.
   *
   * Shared intentionally by the live path (`#onFrame`) and by the one draining
   * held messages (`#largarRetidas`): two copies of this logic would risk
   * diverging, and this decides whether messages are lost.
   *
   * `semAncora` is the case of the gate cap: the frame is applied but the anchor
   * does not move, because there are unread events behind it. See `#largarRetidas`.
   */
  async #aplicarAoVivo(
    channel: string,
    seq: number,
    kind: string,
    ciphertext: string,
    minuto: number,
    semAncora = false,
    adiar = false,
  ): Promise<void> {
    /*
      A frame from a channel we do not yet have: the Welcome is on its way or
      opening (a caller who requested entry by invite hears the channel before
      being in it). The anchor does not move for it: recovery that Welcome does
      on entry starts at the seat and brings this frame. Moving the anchor would
      skip it forever, and with it the `space.meta` that names the room (slice 3:
      with the opaque address, without it the room has no name).
    */
    if (kind !== "welcome" && !this.#groups.has(channel)) return
    const recusa = await this.#applyEventSafely(channel, kind, ciphertext, seq, true, minuto)
    /*
      The anchor moves past unread frames but never over ones that have not
      arrived.
      
      A frame unreadable forever (`true` with `ignored`, or `permanente`) passes:
      leaving it behind would request it again at each connection without ever
      seeing what comes after. One that can still arrive (`recuperavel`: a missing
      epoch, or a failed apply) is a hole, and the anchor stays before it. This
      is how the shared room lost commits forever: the frame from the next epoch
      arrived, `receive` returned `ignored`, and the anchor moved past it and past
      the commit that explained it.
      */
    if (recusa === "recuperavel" || recusa === "buraco") {
      this.#buracoAoVivo(channel, seq)
      return
    }
    // Not read, and we had a seat when it was announced. The anchor moves next
    // that prevents the loop, but what was lost stays noted. See `#anotarLacuna`.
    if (recusa === "saltado") this.#anotarLacuna(channel, seq, minuto)
    if (this.#ancoraPresa(channel) || semAncora) {
      this.#consumidaAoVivo(channel, seq, recusa === "prova")
      /*
        With a hole open and no recovery running, a frame that arrived in the
        group epoch is reason for another pass: it can prove the hole was junk.
        Without this the anchor would be stuck until the next connection.
      */
      if (recusa === "prova" && this.#buracos.has(channel) && !this.#recuperacoes.has(channel) && !this.#recuperacoesPorFazer.has(channel)) {
        void this.#catchUp([channel])
      }
      return
    }
    await this.#rememberSeq(channel, seq, adiar)
    // "ignored" results are deliberately silent: a hostile relay can inject junk
    // at will, and surfacing every drop would turn that into a channel straight
    // to the user.
  }

  /**
   * Apply the channel snapshot from the Welcome (phase 1 of 1.1,
   * `docs/planos/estado-cifrado-plano.md`). Returns whether it saved anything.
   *
   * **Does not trust the inviter.** Each item goes through `receberItem`, with
   * the rules of telemetry: a type with authorship, the schema, the device
   * signature over the channel and author, the device in the tree or account and
   * not revoked, the block, the tombstone, "we already have". Then through the
   * usual guards, because it saves via the same `#recordPayload` as a live event,
   * in the name of the AUTHOR not the inviter:
   *
   * - exactly one founder: the only valid `room.created`, or if multiple arrive
   *   (inviter added a second), the one whose leaf 0 in the tree, which inviter
   *   cannot choose (`escolherFundador`); otherwise none;
   * - roles and assignments only from who commands (`#mandaEm`), in the order that
   *   makes them true: the founder, then who the founder made admin;
   * - pinned items only from who has `fixar`; profile only from who has a leaf.
   *
   * A profile that arrived without the snapshot bytes (the cap cut) stays
   * `parcial`, for the profile request to complete when someone connects.
   */
  async #aplicarRetrato(channel: string, extensoes: EntradaPorWelcome["extensoes"], seq: number): Promise<boolean> {
    if (channel === this.canalDaConta) return false
    const bytes = retratoDasExtensoes(extensoes)
    if (!bytes) return false
    const retrato = lerRetrato(bytes, channel)
    if (!retrato) {
      this.emit("status", { detail: `${channel}: o retrato do Welcome não se lê`, level: "info", code: "retrato-ilegivel", route: "log", channel })
      return false
    }
    try {
      const eu = this.identity.address
      const membros = new Set(this.membersOf(channel).map(String))
      const conteudo = this.vault.contents
      const temos = new Set(itensDoCanal(conteudo, channel, { membros: [...membros], proprio: eu, comApagados: true }).map((item) => item.chave))
      // A `parcial` profile (reported by a peer, without the snapshot) is not "we already have": the snapshot one is complete.
      for (const [address, guardado] of Object.entries(conteudo.directory)) {
        if (guardado.parcial) temos.delete(`perfil|${address}|${typeof guardado.payload["updatedAt"] === "number" ? guardado.payload["updatedAt"] : guardado.at}`)
      }
      const lapides = lapidesDoCanal(conteudo, channel)
      const itemDe = (autor: string, payload: StoredPayload): ItemDoResumo | null => {
        if (payload.t !== "profile") return itemDoPayload(autor, payload, channel)
        const versao = typeof payload["updatedAt"] === "number" ? payload["updatedAt"] : 0
        return { tipo: "perfil", balde: autor, chave: `perfil|${autor}|${versao}` }
      }
      type Aceite = Extract<VeredictoDoRelato, { ok: true }>
      const aceites: Aceite[] = []
      const recusas: Record<string, number> = {}
      const recusar = (razao: string): void => {
        recusas[razao] = (recusas[razao] ?? 0) + 1
      }
      for (const item of retrato.itens) {
        // The profile only from who has a leaf; we know ours.
        if (item.p["t"] === "profile" && (item.a === eu || !membros.has(item.a))) {
          recusar("membro")
          continue
        }
        const veredicto = await receberItem(item, {
          canal: channel,
          seqDaTrama: seq,
          lugar: seq,
          jaTemos: (chave) => temos.has(chave),
          apagado: (doResumo, autor, payload) => itemApagado(lapides, doResumo.tipo, autor, payload),
          itemDe,
          aparelhoConfiavel: (autor, aparelho, cadeia) => this.#aparelhoConfiavel(channel, autor, aparelho, cadeia),
          bloqueado: (autor) => autor !== eu && this.#bloqueadoAqui(channel, autor),
        })
        if (!veredicto.ok) {
          recusar(veredicto.razao)
          continue
        }
        temos.add(veredicto.item.chave)
        aceites.push(veredicto)
      }

      let gravados = 0
      const aplicados: Aceite[] = []
      const gravar = (aceite: Aceite): void => {
        this.#recordPayload(channel, aceite.seq, aceite.autor, aceite.payload as unknown as Payload)
        // The author did not transmit anything now: a snapshot does not prove their seat works.
        this.#pendingTransmitters.pop()
        gravados += 1
        aplicados.push(aceite)
      }

      // The founding first, and only one: it is what `#mandaEm` asks next.
      const fundacoes = aceites.filter((aceite) => aceite.payload["t"] === "room.created")
      if (fundacoes.length > 0) {
        const escolhido =
          this.#fundadorConhecido(channel) === null
            ? escolherFundador(
                fundacoes.map((aceite) => aceite.autor),
                this.#contaNaFolhaZero(channel),
              )
            : null
        const fundacao = escolhido ? fundacoes.find((aceite) => aceite.autor === escolhido) : undefined
        if (fundacao) {
          gravar(fundacao)
          await this.flush()
        }
        for (let i = fundacao ? 1 : 0; i < fundacoes.length; i++) recusar("fundador")
      }

      // Roles and assignments, until no more pass: who commands may have been made
      // admin by an item in the same snapshot.
      let autoridade = aceites.filter((aceite) => aceite.payload["t"] === "role.define" || aceite.payload["t"] === "role.assign")
      for (let mexeu = true; mexeu && autoridade.length > 0; ) {
        mexeu = false
        for (const aceite of [...autoridade]) {
          if (!this.#autoridadeAceita(channel, aceite.autor, aceite.payload)) continue
          gravar(aceite)
          await this.flush()
          autoridade = autoridade.filter((outro) => outro !== aceite)
          mexeu = true
        }
      }
      for (let i = 0; i < autoridade.length; i++) recusar("manda-em")

      // The rest: categories, rooms, banner and profiles, with the powers already known.
      const leves: { address: string; versao: unknown }[] = []
      const resto = aceites
        .filter((aceite) => !["room.created", "role.define", "role.assign"].includes(aceite.payload["t"] as string))
        .sort((a, b) => ordemDeAplicacao({ s: a.seq, a: a.autor, p: a.payload }) - ordemDeAplicacao({ s: b.seq, a: b.autor, p: b.payload }))
      for (const aceite of resto) {
        gravar(aceite)
        const avatar = aceite.payload["avatar"] as { evicted?: unknown } | undefined
        if (aceite.payload["t"] === "profile" && avatar?.evicted === true) leves.push({ address: aceite.autor, versao: aceite.payload["updatedAt"] })
      }
      await this.flush()
      if (leves.length > 0) {
        await this.vault.update((contents) => {
          for (const { address, versao } of leves) {
            const guardado = contents.directory[address]
            if (guardado && guardado.payload["updatedAt"] === versao) contents.directory[address] = { ...guardado, parcial: true }
          }
        })
      }
      /*
        Each saved item goes to the interface as an event, as a report
        (`#gravarRelatado`): who hears `message` (the interface directory, tests)
        sees the same as if the author had said it live. And profiles with
        `perfis`, for the interface to reread the vault directory.
      */
      for (const aceite of aplicados) {
        this.emit("message", {
          channel,
          seq: aceite.seq,
          sender: aceite.autor as UserAddress,
          payload: this.#comMencoesConferidas(channel, aceite.autor, aceite.payload as unknown as Payload),
        })
      }
      const perfis = aplicados.filter((aceite) => aceite.payload["t"] === "profile").map((aceite) => aceite.autor)
      if (perfis.length > 0) this.emit("perfis", { enderecos: perfis })
      const razoes = Object.entries(recusas)
        .map(([razao, n]) => `${razao} ${n}`)
        .join(", ")
      this.emit("status", {
        detail: `${channel}: retrato do Welcome, ${gravados} de ${retrato.itens.length} itens${razoes ? ` (recusados: ${razoes})` : ""}`,
        level: "info",
        code: "retrato-aplicado",
        route: "log",
        channel,
      })
      return gravados > 0
    } catch (erro) {
      this.emit("status", {
        detail: `${channel}: o retrato do Welcome não se aplicou (${(erro as Error).message})`,
        level: "info",
        code: "retrato-falhou",
        route: "log",
        channel,
      })
      return false
    }
  }

  /** The account of leaf 0 of this channel: the one who created the group, if still there. See `escolherFundador`. */
  #contaNaFolhaZero(channel: string): string | null {
    const grupo = this.#groups.get(channel)
    if (!grupo) return null
    const conta = addressAtLeaf(grupo.state.ratchetTree, 0)
    return conta ? String(conta) : null
  }

  /**
   * Join a channel we were invited to.
   *
   * We must find the private half of whichever key package the inviter claimed.
   * Trying each is cheap and means the server never has to tell us which one it
   * handed out — one less thing it needs to know.
   */
  async #acceptWelcome(channel: string, welcome: Uint8Array, seq = -1, minuto?: number): Promise<void> {
    // The server re-delivers pending welcomes at every handshake, because it
    // cannot know which were consumed. The filter is the welcome's own bytes,
    // never the channel: an invitation to a channel we ALREADY hold is
    // precisely how a re-created ("forked") channel heals — the sender lost
    // their group state, built a new group under the same id, and this is our
    // seat in it. Skipping those was the reason a broken circle stayed broken.
    // Re-delivered old welcomes cannot open (their key package was burned on
    // first use), fail once, and are remembered as dead from then on.
    // Versioned: marks written by the pre-handshake race were recorded with
    // an empty keyring and mean nothing. Bumping the prefix voids them all
    // without a migration, so anyone poisoned by that bug simply recovers.
    const mark = `v2|${channel}|${toBase64(sha256(welcome)).slice(0, 16)}`
    if (this.vault.contents.deadWelcomes.includes(mark)) return
    /*
      A Welcome to the direct with who we blocked, or to their feed, does not
      open (phase 3). And does not die: the server delivers it again at each
      handshake, and that lets unblock recover it (`unblock` → `resyncWelcomes`).
      Opening it would enter a channel of theirs, which is what the block refuses;
      burning it would lose the seat forever.
    */
    // By the local side, not by the address the channel name suggests: the server
    // in a direct's name is the creator's. See `#bloqueadoPorParteLocal`.
    if (this.#welcomeDeBloqueado(channel)) return
    const hadChannel = this.#groups.has(channel)
    for (const [id, stored] of this.#keyPackages) {
      const pair = importKeyPackage(stored)
      try {
        const { session, extensoes } = await joinChannelComExtensoes(channel, welcome, pair.publicPackage, pair.privatePackage)
        /*
          The account channel is only accepted with leaves of this account, from
          devices in the manifest (B1). The server says the same, and it is not
          trusted. Refused, the Welcome dies (a newer Welcome gets its turn), and
          the packet burns the same way: already spent by the inviter. No manifest
          read means no decision: waits for the next delivery.
        */
        if (channel === this.canalDaConta) {
          const veredicto = await this.#confiarNoCanalDaConta(session)
          if (veredicto !== "ok") {
            if (veredicto === "sem-manifesto") return
            this.#keyPackages.delete(id)
            this.#keyPackagesDirty = true
            await this.vault.update((contents) => {
              contents.deadWelcomes = [...contents.deadWelcomes, mark].slice(-200)
            })
            this.#avisarCanalDaContaAlheio(channel, veredicto)
            return
          }
        }
        /*
          What the channel is (slice 3), inferred from the group that just
          arrived. An opaque address does not say who owns it, so the block
          filter above catches it only with a record; here catches the inferred
          direct and bulletin board. Does not die, for the same reason as the
          filter above.
          */
        const deduzida = hadChannel ? null : this.#fichaDeduzida(channel, session)
        if (deduzida && this.#fichaDeBloqueado(deduzida)) return
        if (deduzida) this.#fichaAoNascer.set(channel, deduzida)
        /*
          F12: both sides opened the same direct at the same time. Each created
          its own group and seated the other, and each one's Welcome reaches the
          other. Adopting both would swap groups on both sides: each would end up
          in the other's group, and neither would read what the other wrote. The
          group with the SMALLER address wins, by the same rule on both sides:
          the winner keeps its own and refuses this Welcome; the loser adopts.
          The rule is in `desempateDaDirecta.ts` (phase 1g), with why the old one
          swaps both groups.
        */
        const desempate = hadChannel ? this.#desempateDaDirecta(channel, session, seq) : null
        if (desempate === "manter-o-nosso") {
          this.#keyPackages.delete(id)
          this.#keyPackagesDirty = true
          await this.vault.update((contents) => {
            contents.deadWelcomes = [...contents.deadWelcomes, mark].slice(-200)
          })
          return
        }
        // The one who loses the race adopts, and what was already written stayed in the old group (F12, finding 6).
        const perdeuACorrida = desempate === "adoptar-o-do-vencedor"
        await this.#persistGroup(channel, session)
        // Burn it: a key package is single-use, and keeping the private half
        // after the join is pure forward-secrecy liability.
        this.#keyPackages.delete(id)
        this.#keyPackagesDirty = true
        // Before writing it: is this Welcome the first entry, or a reseat?
        const jaTinhaLugar = this.vault.contents.seatSince?.[channel] !== undefined
        // The seat starts here, and the vault saves it with the group. See `seatSince`.
        if (seq >= 0) this.vault.contents.seatSince = { ...this.vault.contents.seatSince, [channel]: seq }
        /*
          The time of the seat, for the interface (S5): the server's, to the
          minute; without it, now. Only on first entry. An old member without
          `lugares` (before this version) who is reseated did not enter here:
          saving the reseat would put "You joined here" in the middle of the
          conversation they had read.
          */
        if (seq >= 0 && channel !== this.canalDaConta && !hadChannel && !jaTinhaLugar) {
          this.#guardarLugar(channel, seq, minuto !== undefined ? minuto * 60_000 : Date.now())
        }
        // An archived channel (we were removed from it) becomes a live channel again.
        if (this.vault.contents.canaisArquivados?.[channel] !== undefined) {
          const { [channel]: _arquivado, ...outros } = this.vault.contents.canaisArquivados
          this.vault.contents.canaisArquivados = outros
        }
        // With a seat again: no more seat to request here. See `lugaresPorPedir`.
        if (this.vault.contents.lugaresPorPedir?.[channel] !== undefined) {
          const { [channel]: _pedido, ...resto } = this.vault.contents.lugaresPorPedir
          this.vault.contents.lugaresPorPedir = resto
        }
        // And the seat epoch, which is the question of who decides what counts as loss:
        // nothing below this was from this device. See `#epocaAoLigar`.
        this.#epocaAoLigar.set(channel, epochOf(session))
        await this.flush()
        /*
          The channel snapshot from the Welcome (phase 1 of 1.1), BEFORE the
          subscribe: the first `channels` already carries the rooms, name, who
          founded and roles, with no one connected. Each item goes through the
          guards of `receberItem` and `#mandaEm`; the inviter is not trusted.
          Never throws: we are inside the key loop, and an error here would make
          the next packet try with this one already spent.
        */
        const retratoAplicado = await this.#aplicarRetrato(channel, extensoes, seq)
        const readopted = hadChannel
        // To recover before subscribing, for the reason in `#handshake` and the
        // mark comes out at the end, recovery runs or not: held, it would pin the anchor
        // of this channel until the next connection (see `#comRecuperacaoPorFazer`).
        await this.#comRecuperacaoPorFazer([channel], async () => {
          this.#send({ t: "channel.subscribe", channels: [channel] })
          this.#announceLocalEpoch(channel, retratoAplicado ? "recebido" : undefined)
          this.emit("channels", { channels: this.channels })
          this.emit("status", {
            detail: readopted ? `${channel}: ligação restabelecida com chaves novas` : `entrou em ${channel}`,
            level: "info",
            code: readopted ? "channel-readopted" : "channel-joined",
            // The channel appearing in the sidebar is the notification, and the
            // shell already writes a bell entry for a room that arrives. A toast
            // per welcome is what turned a login with pending invitations into a
            // wall of popups.
            route: "log",
            channel,
          })
          // Anything sent into the channel between our invitation and this
          // subscribe was broadcast while nobody was listening on our side — a
          // friend request fired right after the invite, a first message, a
          // post. Pull it now instead of leaving it for the next reconnect.
          // Replayed welcome/commit events fail harmlessly, as they already do
          // on ordinary catch-up.
          await this.#catchUp([channel]).catch(() => {})
        })
        // No profile to publish or friendship to reconcile on the account channel. The
        // state of this device already went there via `#announceLocalEpoch` above
        // (entry is growth), for peers to merge.
        if (channel === this.canalDaConta) return
        await this.publishProfile([channel])
        // The one who entered states their summary, and the others respond with theirs (S4).
        void this.#anti.aoWelcome(channel).catch(() => {})
        // A peer joining a direct channel repeats their last friendship action:
        // what they said before this channel may not have arrived (F4).
        this.#agendarUltimoActo(channel)
        // And reconciles that pair alone: this Welcome signals that the bond with
        // them moved (F9). The rest of the friends wait their turn.
        const par = this.#eDirecta(channel) ? this.#parDoCanal(channel) : this.#donoDoFeed(channel)
        if (par && par !== this.identity.address) {
          void this.#reconciliarAmizades(par).catch(() => {})
        }
        if (perdeuACorrida) void this.#reenviarDepoisDaCorrida(channel).catch(() => {})
        return
      } catch {
        // Wrong key package for this welcome. Try the next.
      }
    }

    // A verdict is only meaningful with a loaded keyring. Without one this
    // is the race, not a dead invitation: say nothing and let the next
    // attempt decide.
    if (this.#keyPackages.size === 0) return

    // Every private half was tried and none fits: this invitation can never
    // open. Record the exact bytes so it is skipped in silence from now on —
    // a *newer* welcome for the same channel still gets its chance — and say
    // it once, quietly. The other side's repair is what actually fixes this,
    // by re-inviting against a fresh key package.
    await this.vault.update((contents) => {
      contents.deadWelcomes = [...contents.deadWelcomes, mark].slice(-200)
      /**
       * The channel stays pending in the vault (F3, 20/10/2026).
       *
       * The warning said the other person would invite us back alone, and in a
       * direct channel that was false: on their side we stay in the tree, and
       * their repair only touches who has no leaf. We know the channel died, so
       * we request another one, and retry until we join. Unless this device
       * still lacks the channel: with a live group, an old Welcome that does not
       * open is just an old Welcome.
       */
      if (!this.#groups.has(channel)) {
        contents.lugaresPorPedir = { ...contents.lugaresPorPedir, [channel]: { desde: Date.now(), tentativas: 0, proxima: 0 } }
      }
    })
    // With keys published, request right away; before that, the requester is the
    // end of `#handshake`, so the responder has something to give us.
    if (this.#chavesProntas && !this.#groups.has(channel)) this.#pedirLugar(channel)
    this.emit("status", {
      detail: "an invitation to this channel can no longer be opened, a new seat was requested",
      level: "info",
      code: "welcome-dead",
      // Mechanics with an automatic repair behind it, and Amigos shows the
      // state per person. Accumulated dead welcomes are exactly the pile that
      // greeted people with a dozen popups at login.
      route: "log",
      channel,
    })
  }

  /**
   * F12 and phase 1g: is this Welcome the other half of a direct channel both
   * sides opened at the same time? And if so, which group survives?
   *
   * Read what the pure rule requires (`desempateDaDirecta`): who created each
   * group (leaf 0), whether the peer has a seat in ours, and the `seq` of
   * their last message in ours against the Welcome's.
   */
  #desempateDaDirecta(channel: string, doWelcome: GroupSession, seqDoWelcome: number): DesempateDaDirecta {
    if (!this.#eDirecta(channel)) return null
    const nosso = this.#groups.get(channel)
    if (!nosso || estaRemovido(nosso)) return null
    const eu = this.identity.address
    const par = this.#parDoCanal(channel)
    if (!par) return null
    const contasNossas = new Set([...memberAddresses(nosso.state.ratchetTree).values()].map(String))
    /*
      Only who is already in the tree. A pending seat does not count: measured
      at this phase, the winner's seat could fail next (the server refuses the
      commit if the loser rebuilt the channel first), and who had refused the
      Welcome because of it stayed alone in their group.
    */
    const parNoNosso = contasNossas.has(par)
    let ultimaDoPar = -1
    const guardadas = [
      ...entradasDoCanal(this.vault.contents, channel),
      ...this.#pendingHistory.filter((pendente) => pendente.channel === channel).map((pendente) => pendente.entry),
    ]
    for (const entrada of guardadas) {
      if (entrada.sender === par && entrada.seq > ultimaDoPar) ultimaDoPar = entrada.seq
    }
    return desempateDaDirecta({
      eu,
      par,
      criadorDoNosso: memberAddresses(nosso.state.ratchetTree).get(0),
      criadorDoWelcome: memberAddresses(doWelcome.state.ratchetTree).get(0),
      parNoNosso,
      ultimaDoPar,
      seqDoWelcome,
    })
  }

  /**
   * F12, finding 6 from the 0.7.0 review: we lost the direct race and adopted
   * the peer's group. What we wrote before that was encrypted in our group,
   * which the peer never opened: to them, it does not exist.
   *
   * Say it again in the adopted group, exactly as stored and with the same
   * `id`: who already has it refuses the copy (`appendHistory` deduplicates by
   * `chaveDoEvento`), and our vault does too. Only what has `id`; friendship
   * actions do not, and replaying the last action (`#agendarUltimoActo`) plus
   * reconciliation (`syncFriendships`, next) handle them. The channel is new by
   * definition of the race, so these are few entries.
   */
  async #reenviarDepoisDaCorrida(channel: string): Promise<void> {
    const eu = this.identity.address
    const nossas = porOrdemDoServidor(entradasDoCanal(this.vault.contents, channel)).filter(
      (entrada) => entrada.sender === eu && typeof entrada.payload["id"] === "string",
    )
    for (const entrada of nossas) {
      await this.send(channel, structuredClone(entrada.payload) as unknown as Payload).catch(() => {})
    }
    await this.syncFriendships().catch(() => {})
  }

  /**
   * Channels this device is deaf to: events keep arriving and none of them
   * open. Reported to the interface so it can say so and offer the repair,
   * instead of rendering an empty feed as if nothing had been published.
   */
  deafChannels(threshold = DEAF_FAILURES): string[] {
    const agora = Date.now()
    // The account channel is not in the interface list, and its repair stands alone.
    const proprio = this.#identity !== null ? this.canalDaConta : null
    return [...this.#undecryptable.entries()]
      .filter(([channel, estado]) => channel !== proprio && surdezConfirmada(estado, agora, threshold))
      .map(([channel]) => channel)
  }

  /** Channels whose invitation could not be opened, for the UI's diagnostics. */
  deadWelcomeChannels(): string[] {
    const proprio = this.#identity !== null ? this.canalDaConta : null
    return [
      ...new Set(
        this.vault.contents.deadWelcomes
          .filter((mark) => mark.startsWith("v2|"))
          .map((mark) => mark.slice(3, mark.lastIndexOf("|")))
          .filter((channel) => channel !== proprio),
      ),
    ]
  }

  // ------------------------------------------------------------ persistence

  static readonly FLUSH_MS = 1500
  #flushTimer: ReturnType<typeof setTimeout> | null = null
  #dirty = new Set<string>()
  #keyPackagesDirty = false

  /**
   * Mark a group as changed and schedule a write.
   *
   * Group state changes on every message and each write re-encrypts the whole
   * vault, so writing synchronously would re-encrypt the local database per
   * message. Coalescing keeps that bounded; the trade is a crash window of up to
   * `FLUSH_MS`, which MLS tolerates far better than a torn write.
   */
  async #persistGroup(channel: string, session: GroupSession): Promise<void> {
    this.#groups.set(channel, session)
    this.#dirty.add(channel)
    this.#agendarGravacao()
  }

  /**
   * A flush in the next microtask, with no one waiting for it. Several
   * requests at the same instant give one. See the end of `#sendPayload`.
   */
  #gravarJa(): void {
    if (this.#gravacaoJaAgendada) return
    this.#gravacaoJaAgendada = true
    queueMicrotask(() => {
      this.#gravacaoJaAgendada = false
      void this.flush().catch((erro: unknown) => this.#falhaAoGravar(erro))
    })
  }
  #gravacaoJaAgendada = false

  /** Batch flush `FLUSH_MS` later, if none is already scheduled. */
  #agendarGravacao(): void {
    if (this.#flushTimer) return
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null
      // The failure must be handled HERE, and there is nowhere else to handle it:
      // no one is waiting for this promise. See `#falhaAoGravar`.
      void this.flush().catch((erro: unknown) => this.#falhaAoGravar(erro))
    }, Session.FLUSH_MS)
  }

  /**
   * The flush timer, disarmed.
   *
   * It exists in two places, exit and drop secrets, and the decision is the
   * same in both: whoever closes the door does not leave a clock running behind.
   */
  #cancelarFlushAdiado(): void {
    if (!this.#flushTimer) return
    clearTimeout(this.#flushTimer)
    this.#flushTimer = null
  }

  /**
   * A recording that failed with no one waiting for the promise.
   *
   * The timer-delayed flush has no one to wait for it: `#persistGroup`
   * drops it with a `void` and moves on. Without this, a vault rejection,    * and realistically it's IndexedDB full, on an account uploading photos, would show up
   * as `unhandledrejection` in the live app, not just in tests. What the
   * user saw was nothing: no warning, no write, and messages disappearing
   * on every reload.
   *
   * We don't retry here on purpose. The `flush` resets dirty marks
   * before throwing, so the work stays undone and the next change
   * sets another timer, which is the right moment, because that's when
   * there's more to write. Retrying 1,5 em 1,5 segundos against a full disk
   * would waste battery getting the same rejection, and one warning per second.
   *
   * The full-disk message interrupts because only the user can fix it
   * (delete photos, or conversations). Everything else, a vault already closed, which is what
   * remains in a timer that escapes `disconnect()`, is mechanical, and
   * mechanics go to the log. Same rules as `#connected`, with
   * invite keys and catch-up.
   */
  #falhaAoGravar(erro: unknown): void {
    const mensagem = erro instanceof Error ? erro.message : String(erro)
    const cheio = mensagem.includes("storage is full")
    this.emit("status", {
      detail: cheio ? mensagem : `não foi possível guardar no cofre: ${mensagem}`,
      level: "error",
      code: "persist-failed",
      route: cheio ? "toast" : "log",
    })
  }

  async flush(): Promise<void> {
    // Key packages are tracked separately from groups. They change without any
    // group changing — publishing a batch, or burning one on a join — and an
    // early return that only looked at `#dirty` meant their private halves were
    // never written. The symptom is brutal and silent: the pool on the server
    // looks healthy, but after a restart no invitation can be accepted, because
    // the half needed to answer a Welcome was never persisted.
    if (
      this.#dirty.size === 0 &&
      !this.#keyPackagesDirty &&
      !this.#commitsPorConfirmarSujos &&
      this.#pendingHistory.length === 0 &&
      this.#pendingDirectory.length === 0 &&
      /*
        And the other six, which `#drainRecords` drains two lines below.

        The list was halfway: these six were missing, and a newly received
        channel presentation, role or room could wait for a write that this
        guard was skipping because "nothing is dirty". It is the same trap the
        gaps note describes, left standing beside it. The guard in
        `#rememberSeq` has the full list: these two run together, and whoever
        adds a `#pending…` must add it in both places.
      */
      this.#pendingSpaceMeta.length === 0 &&
      this.#pendingAuthority.length === 0 &&
      this.#pendingRoleDefs.length === 0 &&
      this.#pendingRooms.length === 0 &&
      this.#pendingCategories.length === 0 &&
      this.#pendingTransmitters.length === 0 &&
      this.#pendingShownFriends.length === 0 &&
      this.#pendingAutoriasDosPerfis.length === 0 &&
      !this.#memoriaPorGravar &&
      // And the gaps. The September trap was exactly this: write to live content
      // and `flush` exit early because nothing is dirty, with all tests asserting
      // about memory and disk saying the opposite.
      this.#lacunasPorGravar.length === 0
    ) {
      /*
        Nothing dirty does not mean nothing to write: the live path already
        put groups and anchor in content, and writing them may be deferred
        (`#rememberSeq` with `adiar`). A `flush` always ends with disk equal
        to memory, and some depend on it: the send that just spent a ratchet
        generation, the page exit, the app close.
      */
      await this.vault.gravarAdiada()
      return
    }

    const pending = [...this.#dirty]
    this.#dirty.clear()
    this.#keyPackagesDirty = false
    const commitsSujos = this.#commitsPorConfirmarSujos
    this.#commitsPorConfirmarSujos = false
    const memoriaSuja = this.#memoriaPorGravar
    this.#memoriaPorGravar = false

    try {
      await this.vault.update((contents) => {
        this.#drainRecords(contents)
        this.#escreverGrupos(contents, pending)
        if (commitsSujos) this.#escreverPorConfirmar(contents)
        contents.pendingKeyPackages = [...this.#keyPackages.values()].map((stored) => ({
          wire: toBase64(stored.wire),
          initPrivateKey: toBase64(stored.initPrivateKey),
          hpkePrivateKey: toBase64(stored.hpkePrivateKey),
          signaturePrivateKey: toBase64(stored.signaturePrivateKey),
        }))
      })
    } catch (error) {
      /**
       * A failed write must leave the work outstanding, not consumed.
       *
       * The dirty set was cleared before the write — so a rejection (a full
       * IndexedDB quota is the realistic one, on an account carrying real
       * photos) used to mean the channel was quietly dropped from the list of
       * things to save. Its group state had already advanced in memory, and
       * the only copy of that advance now lived in a tab that could be closed
       * at any moment. Putting the marks back means the next flush tries
       * again, and the caller still learns it failed.
       */
      for (const channel of pending) this.#dirty.add(channel)
      this.#keyPackagesDirty = true
      if (commitsSujos) this.#commitsPorConfirmarSujos = true
      if (memoriaSuja) this.#memoriaPorGravar = true
      throw error
    }
  }

  /**
   * The in-memory vault has what the disk does not: our own message, already
   * drained to memory and left for batching. See the end of `#sendPayload`.
   */
  #memoriaPorGravar = false

  /**
   * Rebuild every group from the vault.
   *
   * A blob that fails to decode is dropped rather than fatal: one corrupt
   * channel must not stop the app from opening the other twenty.
   */
  async restore(): Promise<{ restored: string[]; failed: string[] }> {
    const contents = this.vault.contents
    const restored: string[] = []
    const failed: string[] = []

    for (const [channel, blob] of Object.entries(contents.groups)) {
      /*
        What is already live in memory does not get replaced by what is in
        the vault.
        
        This runs on every connection, not just the first. Everything the
        vault has came out of memory, so memory is always equal or ahead, and
        restoring the vault over it would undo, on every network drop, what had
        been applied since the last write. A commit undone that way leaves the
        device one epoch behind with the anchor already past it: the partition.
        */
      if (this.#groups.has(channel)) {
        restored.push(channel)
        continue
      }
      try {
        this.#groups.set(channel, await importSession(channel, fromBase64(blob)))
        restored.push(channel)
      } catch {
        failed.push(channel)
      }
    }

    for (const [channel, lista] of Object.entries(contents.pendingCommits ?? {})) {
      // Like the groups: what is live in memory is what counts.
      if (this.#commitsPorConfirmar.has(channel) || !this.#groups.has(channel)) continue
      const epocaDoGrupo = epochOf(this.#groups.get(channel) as GroupSession)
      const vivos: CommitNosso[] = []
      for (const guardado of lista) {
        try {
          const base = BigInt(guardado.base)
          // Built on an epoch the group already left: never joins again.
          if (base < epocaDoGrupo) continue
          vivos.push({
            commit: fromBase64(guardado.commit),
            base,
            session: await importSession(channel, fromBase64(guardado.group)),
            ...(guardado.welcome && guardado.recipient
              ? { welcome: { bytes: fromBase64(guardado.welcome), recipient: guardado.recipient } }
              : {}),
          })
        } catch {
          // Unreadable: one commit short of confirmed, and never a channel short.
        }
      }
      if (vivos.length > 0) this.#commitsPorConfirmar.set(channel, vivos)
    }

    for (const stored of contents.pendingKeyPackages) {
      this.#keyPackages.set(stored.wire, {
        wire: fromBase64(stored.wire),
        initPrivateKey: fromBase64(stored.initPrivateKey),
        hpkePrivateKey: fromBase64(stored.hpkePrivateKey),
        signaturePrivateKey: fromBase64(stored.signaturePrivateKey),
      })
    }

    return { restored, failed }
  }

  /** The live group for a channel, for the voice layer's key derivation. */
  groupFor(channel: string): GroupSession | undefined {
    return this.#groups.get(channel)
  }

  /**
   * Who is in a channel.
   *
   * Read from the ratchet tree, not from a server-side roster. That makes it the
   * authoritative answer rather than a claim: these are exactly the people
   * holding keys that can decrypt the channel, so the list cannot be padded by a
   * server wanting to slip an extra reader in, nor trimmed to hide one.
   */
  membersOf(channel: string): UserAddress[] {
    const group = this.#groups.get(channel)
    if (!group) return []
    // PEOPLE, not leaves. `memberAddresses` is per leaf and repeats the address
    // of someone with two devices: the member list showed the same person twice,
    // with the same React `key`, and the footer said "2 people" for one. Who
    // wants leaves has `memberAddresses` and `leavesOf`.
    return [...memberAccounts(group.state.ratchetTree).keys()].sort()
  }

  /**
   * Media key material for one participant in a channel's current epoch.
   *
   * Keying on the MLS epoch means every membership change rekeys the media too:
   * somebody removed from the channel mid-call cannot decode what follows.
   */
  async mediaKey(channel: string, address: UserAddress, folha?: number): Promise<MediaKeyMaterial | null> {
    const group = this.#groups.get(channel)
    if (!group) return null

    /*
     * The key is for the LEAF, that is the device, not the account.
     *
     * It was `leafIndexOf`, the first leaf of the account: two devices of the
     * same account in the same call derived the same key and same `senderId`,
     * and each reserved counters in its vault starting from zero. The same
     * nonces with the same key in AES-GCM reveal the XOR of the texts and let
     * you forge frames (found on 2 November 2026).
     *
     *  - for ourselves: our leaf, always;
     *  - for who we hear: the leaf the frame declares in the header (`folha`),
     *    only if it is really a leaf OF THIS account. A consumer of Alice
     *    never accepts Bruno's leaf key;
     *  - no `folha`: the first one, which is the key of a single-device account
     *    and of a 1.0.5 sender (who always encrypts with the first leaf of the
     *    account).
     */
    const folhas = leavesOf(group.state.ratchetTree, address)
    if (folhas.length === 0) return null
    const nossa = group.state.privatePath.leafIndex
    let senderId: number
    if (folha !== undefined) {
      if (!folhas.includes(folha)) return null
      senderId = folha
    } else {
      senderId = folhas.includes(nossa) ? nossa : folhas[0]!
    }

    const keyId = Number(group.state.groupContext.epoch % 65_536n)
    return { keyId, senderId, material: await deriveSframeKeyMaterial(group, keyId, senderId) }
  }

  /**
   * Reserve a block of SFrame counters for this key, and write it.
   *
   * The media key derives from the channel epoch and our leaf index, and
   * neither changes when the app closes. A sender built on the next startup
   * would start counting from zero and repeat, with the same key, every nonce
   * it had already used, in AES-GCM a repeated nonce reveals the XOR of the
   * two texts and lets you forge authenticated frames.
   *
   * Write the END of the block before using it, not the counter as it goes:
   * writing to the vault fifty times per second is not an option. A crash
   * mid-call costs the rest of the block, which is exactly what you want to
   * lose, what must never happen is reusing a counter.
   *
   * The header limit is 2^48. With blocks of one million, and fifty frames
   * per second, each block lasts almost six hours of speech and leaves room
   * for two hundred eighty million blocks per key.
   */
  async reservarContadorSframe(channel: string, keyId: number): Promise<number> {
    const chave = `${channel}|${keyId}`
    const reservas = (this.vault.contents.sframeReservas ??= {})
    const inicio = reservas[chave] ?? 0
    reservas[chave] = inicio + RESERVA_SFRAME
    await this.flush()
    return inicio
  }

  // ----------------------------------------------------------------- plumbing

  /**
   * Send, or admit the connection is gone.
   *
   * The socket can die without a close event ever reaching us — a suspended
   * machine, a server restarted underneath, a half-open TCP connection that
   * nothing has noticed yet. Previously the remembered state still said
   * "online", the indicator stayed green, and every send threw an error the
   * user could do nothing with. The socket's own readyState is the truth, so
   * discovering it is stale is the moment to say so and start reconnecting.
   */
  /**
   * Send a frame to the server.
   *
   * Typed, and that is the only reason the signature is not `unknown`: a
   * malformed frame would pass compilation and the server would silently drop
   * it. This happened with `{ t: "channel.subscribe", channel }` instead of
   * `channels: [channel]`, and the result was a shared room where only the
   * creator could join, with no error anywhere.
   */
  #send(frame: ClientFrame): void {
    if (this.#socket?.readyState === 1) {
      this.#socket.send(JSON.stringify(frame))
      return
    }

    if (this.#connection === "online") {
      this.#setConnection("reconnecting", "the connection dropped")
      // Fires `#onClose`, which schedules the retry. Closing an already-dead
      // socket is harmless.
      this.#socket?.close()
      this.#socket = null
      if (!this.#deliberateClose) this.#onClose()
    }

    throw new Error("no connection to the server")
  }

  /**
   * Fail everything still waiting on a reply, and forget it.
   *
   * Called when the socket goes away. Every waiter it holds is a promise
   * somebody is awaiting; leaving them to time out ten seconds later, against
   * a connection that no longer exists, is how one dropped socket derailed the
   * frame pairing of the next one.
   */
  #failPending(reason: string): void {
    const queues = [...this.#pending.values()]
    this.#pending.clear()
    for (const queue of queues) {
      for (const waiter of queue) waiter({ t: "error", code: "disconnected", message: reason, fatal: false })
    }
    // Receipts-to-come die with the socket that would bring them. Letting them
    // time out against a connection that is already gone is the trap this entire
    // function exists to avoid.
    this.#falharConfirmacoes(reason)
    // And the media ones, not in that map. Without this, a call negotiating
    // against a socket that just died would sit for fifteen seconds pretending to
    // negotiate, and what you saw was "connecting" staring at nothing.
    this.#falharSfuPendentes(reason)
  }

  #await(kind: ServerFrame["t"], timeoutMs = 10_000, etiqueta?: string): Promise<ServerFrame> {
    const chave = etiqueta === undefined ? kind : `${kind}|${etiqueta}`
    return new Promise((resolve, reject) => {
      // The QUEUE per frame type, never a single slot: two concurrent waits on
      // the same kind used to silently overwrite each other, and the loser
      // sat out its ten seconds to die as "tempo esgotado". The server
      // processes a connection's frames in order and replies in order, so
      // first-asked, first-answered pairs them correctly.
      const waiter = (frame: ServerFrame): void => {
        clearTimeout(timer)
        resolve(frame)
      }
      const timer = setTimeout(() => {
        const queue = this.#pending.get(chave)
        if (queue) {
          const index = queue.indexOf(waiter)
          if (index >= 0) queue.splice(index, 1)
          if (queue.length === 0) this.#pending.delete(chave)
        }
        reject(new Error("the server did not answer in time", { cause: { kind } }))
      }, timeoutMs)

      const queue = this.#pending.get(chave) ?? []
      queue.push(waiter)
      this.#pending.set(chave, queue)
    })
  }
}

function homeserverOf(identity: Identity): string {
  return identity.address.slice(identity.address.indexOf(":") + 1)
}

function gatewayUrl(identity: Identity): string {
  return gatewayUrlDe(homeserverOf(identity))
}

/** The gateway of a server by name. Plain ws only for loopback development; everything else must be TLS. */
function gatewayUrlDe(host: string): string {
  const scheme = isLoopbackHost(host) ? "ws" : "wss"
  return `${scheme}://${host}/_enclave/gateway`
}
