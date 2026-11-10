import {
  accountIdFromSigningKey,
  podeEstrearCanal,
  fromBase64,
  parseAddress,
  parseClientFrame,
  toBase64,
  verify,
  verifyDeviceChain,
  type ClientFrame,
  type ServerFrame,
  type ServerName,
  CAPACIDADE_APARELHOS,
  CAPACIDADE_BUNDLE,
  CAPACIDADE_COFRE_CIFRADO,
  CAPACIDADE_EMPARELHAMENTO,
  CAPACIDADE_ENVIO_RECUSADO,
  CAPACIDADE_ESTREIA_DA_DIRECTA,
  CAPACIDADE_LIGACOES_CURTAS,
  CAPACIDADE_MORADAS_OPACAS,
  CAPACIDADE_RESGATE_POR_PROVA,
  CAPACIDADE_REVOGACAO,
  CAPACIDADE_SELO_DO_CONVITE,
  CAPACIDADE_SFU,
  CAPACIDADE_SFU_FOTOGRAMA_CHAVE,
  CAPACIDADE_SINAL_EFEMERO,
  CODIGO_COFRE_ABUSO,
  CODIGO_VERSAO_ANTIGA,
  PROTOCOL_VERSION,
  verificarProvaDoConvite,
  type CodigoDeRecusaDoCofre,
  type CodigoDeRecusaDoSinal,
  type RazaoDeRecusaDaEntrada,
} from "@enclave/protocol"
import { createHash, createHmac, randomUUID } from "node:crypto"
import type { WebSocket } from "ws"
import { ehCommit, ehCommitExterno, lerCabecalhoMls } from "./cabecalho-mls.js"
import { ehSalaComum, eVersaoAntiga, tectosDoCofre, tectosDoSinal, type ServerConfig } from "./config.js"
import type { Store } from "./store.js"
import type { Federation } from "./federation.js"
import { fetchLinkPreview } from "./link-preview.js"
import { RecusaDeMedia, type MotorDeMedia } from "./media.js"

/**
 * The client gateway.
 *
 * Connections are the only place this server holds anything resembling
 * user-visible state, and they hold it in memory, for the life of the socket.
 */

interface Connection {
  socket: WebSocket
  /** The clock for control pings on this connection. See `BATIMENTO_MS`. */
  batimento: ReturnType<typeof setInterval> | null
  /**
   * Who this CONNECTION is, for the media engine.
   *
   * It is not the account, and cannot be: two tabs of the same user are two
   * transports, two streams and two bandwidth costs, and the engine must tell
   * them apart to drop one without dropping the other. Opaque on purpose: the
   * engine does nothing with it but compare.
   */
  readonly id: string
  /** Set only once a signature has been verified. Never before. */
  address: string | null
  /**
   * The key of the DEVICE that signed the challenge, when the chain came in
   * `auth.begin`; `null` on a login without a chain (the account key matching
   * the address directly, the path the scripts use). It signs the leaves of
   * this connection's key packages, which is why it can assign them to a
   * device when the client does not say (0.2.3), and check the client's claim
   * when it does.
   */
  deviceKey: Uint8Array | null
  /**
   * Address claimed at auth.begin, still unproven, with the key it named.
   *
   * `signingKey` is the key that must sign the challenge (the device key, when
   * the chain came). `accountKey` is the key the address is a digest of, and
   * the one the accounts table stores: it defines the account, and does not
   * change when the user switches devices.
   */
  pending: { address: string; signingKey: Uint8Array; accountKey: Uint8Array; comCadeia: boolean } | null
  /** Nonce we handed out, pending signature. Single-use. */
  challenge: Uint8Array | null
  channels: Set<string>
  /**
   * The TEMPORARY slots in the common room, by channel, with the instant they
   * expire (INV-01). Created by `channel.groupinfo.take`, they serve one
   * purpose: sending the external commit that this card allows. They are not
   * `channels`: they receive no traffic, do not read history, do not count for
   * `#isSeated`, and `channel.subscribe` does not promote them. Only the
   * accepted external commit promotes them (see `#relay`).
   */
  lugaresTemporarios: Map<string, number>
  /** Whether this connection may be announced to channel-mates. The server
   * still knows it is here: it must, to deliver anything. */
  visible: boolean
  /**
   * The calls this connection entered, by scope key.
   *
   * The pair `(canal, sala)` is stored whole instead of being split back out
   * of the key: the key exists to be compared, and a `split` on it is the line
   * that one day meets a channel with the separator inside and returns
   * something else.
   */
  sfu: Map<string, { channel: string; scope: string }>
  /**
   * Whether this connection said in `hello` that it applies its own commit
   * only after the echo (`commit-after-echo`). Without this we accept no
   * commits or cards from it: see `#confiavelParaCommits`.
   */
  commitDepoisDoEco: boolean
  /**
   * Whether this connection announced `CAPACIDADE_SINAL_EFEMERO` in `hello`. Only these
   * receive `channel.sinal`, and only these can send it: a client that does not
   * announce it never sees a frame it does not know.
   */
  sinalEfemero: boolean
  /**
   * Whether this connection announced `CAPACIDADE_ENVIO_RECUSADO`: only these receive
   * `channel.rejected` with `rate-limited`. See `#recusarEnvioPorRitmo`.
   */
  envioRecusado: boolean
  /**
   * Whether this connection announced `CAPACIDADE_COFRE_CIFRADO` in `hello`. Only these
   * receive `cofre.*` frames (the versions after `auth.ok` and each
   * `channel.subscribe` included), and only these can send them. See `#cofre`.
   */
  cofreCifrado: boolean
}

/**
 * The largest frame this gateway will read.
 *
 * It has to match the WebSocket `maxPayload` in `app.ts`, and for a long time
 * it did not: the socket accepted 12 MiB while this dropped anything over
 * 1 MiB, and dropped it as *fatal*, closing the connection. A post carrying
 * one ordinary photo (the composer allows 3 MB per image, 6 MB per post) got
 * past the socket and died here. The sender saw their post in their own
 * timeline, because the client records and shows it before the frame leaves;
 * nobody else ever received it, and the only outward symptom was a connection
 * that dropped for no visible reason. Two limits describing the same thing
 * must move together.
 */
export const MAX_FRAME_BYTES = 12 * 1024 * 1024

/** All media frames, so dispatch can handle them together. */
type FrameSfu = Extract<ClientFrame, { t: `sfu.${string}` }>

/** A pairing box. See `Gateway.#caixas`. */
interface CaixaDeEmparelhamento {
  readonly pairId: string
  /** The AUTHENTICATED connection that opened: the device that owns the account. */
  readonly anfitriao: Connection
  /** The connection that joined, typically without an account. Only one. */
  convidado: Connection | null
  readonly criadoEm: number
  readonly prazo: ReturnType<typeof setTimeout>
}

/**
 * The call router key: the pair `(canal, âmbito)`, hashed.
 *
 * **The channel is part of the key, and that is the whole point of this
 * function.** The scope is chosen by the CLIENT (it is a hash the client
 * computes and sends), so two clients in different channels can send the same
 * one. If the key were only the scope, both would land in the same router and
 * hear each other: a user would join a call in a channel they were never
 * admitted to, without forging anything or breaking any crypto, just by
 * sending a frame with the right hash. With the channel in the key, that
 * attack requires a seat in the channel, which is exactly what `#mayReach`
 * checked one line earlier.
 *
 * **The channel length goes first, and hashing does not make that optional.**
 * A hand-picked separator (a slash, a space, a NUL) works until the day an
 * identifier contains it, and then `("a|b", "c")` and `("a", "b|c")` become
 * the same call. Hashing the concatenation fixes nothing, because two equal
 * strings hash the same: the length prefix is the fix, since it makes the
 * parse unambiguous whatever follows. Worth saying, because the hash LOOKS
 * like it solves this, and that is the kind of line that passes review
 * without anyone stopping.
 *
 * The hash has another use, and that alone justifies it: it gives the maps a
 * fixed-length key instead of one that grows with the channel name.
 *
 * It costs one SHA-256 per frame, and the main payer is joining a call, once
 * per user.
 */
export function chaveDeAmbito(channel: string, scope: string): string {
  return createHash("sha256").update(`${channel.length}:${channel}:${scope}`).digest("base64url")
}

export class Gateway {
  readonly #connections = new Set<Connection>()
  #federation: Federation | undefined

  constructor(
    private readonly store: Store,
    private readonly config: ServerConfig,
  ) {}

  /** Wired after construction because federation needs to call back into us. */
  attachFederation(federation: Federation): void {
    this.#federation = federation
  }

  /**
   * Is there a media engine running in this process?
   *
   * By default there is not, and that is why `hello.ok` does not announce
   * `CAPACIDADE_SFU` today: **announcing a capability is a promise**, and a
   * client that sees it stops building the mesh and negotiates with an SFU
   * instead. If the worker is not there, nobody connects to anybody, and the
   * failure shows up in the call, far from the line that lied.
   *
   * A predicate, not a boolean and not an environment variable, for exactly
   * that reason: a mediasoup worker can die after starting, and at that moment
   * the answer changes. The truth is the engine's state, read at `hello` time,
   * not a decision made at startup.
   */
  #sfuDePe: () => boolean = () => false

  /**
   * Declare the media engine, once Phase 1 provides one.
   *
   * Attached after construction for the same reason as `attachFederation`: the
   * worker is created apart from the gateway, and the gateway should not know
   * how to create it.
   */
  declararSfu(estaDePe: () => boolean): void {
    this.#sfuDePe = estaDePe
  }

  #motor: MotorDeMedia | undefined

  /**
   * Attach the media engine and declare the capability based on its state.
   *
   * One call, not two, so there is no way to announce the capability without
   * an engine: the promise and the thing promised come from the same line.
   * `declararSfu` still exists on its own because a test must be able to
   * exercise the capability gate without spawning a subprocess.
   */
  attachMedia(motor: MotorDeMedia): void {
    this.#motor = motor
    this.declararSfu(() => motor.estaDePe())
  }

  /**
   * What this server can do, told to the client in `hello.ok`.
   *
   * Read at each `hello` and not stored: see `#sfuDePe`.
   */
  #capacidades(): string[] {
    return [
      "mls",
      "federation",
      "voice-sframe",
      "presence",
      // Stores the common room's entry card and hands it to newcomers. Without
      // this announcement, a new client does not waste time asking for something
      // this server does not know: it asks members for a seat, as it always did.
      "common-room-groupinfo",
      // Accepts ONE commit per epoch on each channel, rejects the others back to
      // their author with `channel.rejected` `stale-epoch`, and stores only the
      // card for the channel's epoch. A client that sees this can wait for the
      // echo of its commit before applying it: the echo now means "this is the
      // commit for this epoch".
      "commit-per-epoch",
      // Accepts more than one device per account and stores the signed manifest
      // that lists them (`manifest.publish`/`manifest.get`). A client that sees
      // this publishes its manifest on connect; one that does not sends neither
      // frame. See `CAPACIDADE_APARELHOS`.
      CAPACIDADE_APARELHOS,
      // Serves key packages as a bundle, one per device in the manifest, to a
      // caller that ASKS with `bundle: true`. Never unasked: see `CAPACIDADE_BUNDLE`.
      CAPACIDADE_BUNDLE,
      // Has pairing boxes: `pair.open` from an account, `pair.join` from a
      // connection without an account, and `pair.send` relayed unread. A client
      // that does not see this hides the "add device" button. See
      // `CAPACIDADE_EMPARELHAMENTO`.
      CAPACIDADE_EMPARELHAMENTO,
      // A device the account removed from the manifest cannot connect, claim or
      // publish key packages, and never gets back into any of the account's
      // manifests. A client that does not see this still revokes (removes the
      // leaf from the channels), but should say the device can still connect.
      // See `CAPACIDADE_REVOGACAO`.
      CAPACIDADE_REVOGACAO,
      // Forwards `channel.sinal` to the other connected members of a channel,
      // without storing it. Only to connections that announced it in `hello`.
      // See `CAPACIDADE_SINAL_EFEMERO` and `#sinal`.
      CAPACIDADE_SINAL_EFEMERO,
      // The server arbitrates the first creation of a DM. In 1.0 the DM has an
      // opaque address and goes through the general arbitration (first to claim
      // wins); the capability stays announced because the client reads it to
      // know whether to claim before creating. See
      // `CAPACIDADE_ESTREIA_DA_DIRECTA` and `channel.claim`.
      CAPACIDADE_ESTREIA_DA_DIRECTA,
      // Accepts opaque addresses and gives them to the first claimer. See
      // `CAPACIDADE_MORADAS_OPACAS` and `#formaFechada`.
      CAPACIDADE_MORADAS_OPACAS,
      // Gives each invite a short code and resolves it (`invite.resolve`). See
      // `CAPACIDADE_LIGACOES_CURTAS`.
      CAPACIDADE_LIGACOES_CURTAS,
      // Verifies the code proof in `invite.redeem`. See `CAPACIDADE_RESGATE_POR_PROVA`.
      CAPACIDADE_RESGATE_POR_PROVA,
      // Stores the channel name seal and returns it (`invite.resolved`,
      // `invite.selo`). See `CAPACIDADE_SELO_DO_CONVITE`.
      CAPACIDADE_SELO_DO_CONVITE,
      // Stores the encrypted vault for channels and accounts (`cofre.put`,
      // `cofre.get`, `cofre.del`), only for connections that announce it in `hello`.
      // See `CAPACIDADE_COFRE_CIFRADO` and `#cofre`.
      CAPACIDADE_COFRE_CIFRADO,
      ...(this.config.communityMode ? ["community"] : []),
      // Plus the viewer's keyframe request, only while the SFU is up (Phase M2).
      ...(this.#sfuDePe() ? [CAPACIDADE_SFU, CAPACIDADE_SFU_FOTOGRAMA_CHAVE] : []),
    ]
  }

  /**
   * How often the server sends a control ping to each connection.
   *
   * The nginx in front of orwell.pt closes an idle websocket after one hour
   * (`proxy_read_timeout 1h`), so a client that stayed silent for an hour was
   * cut and reconnected every hour. Each reconnect ran the profile repair
   * round on every channel: measured on the production database on 18 October
   * 2026, two messages per channel per hour, per idle user. The ping is a
   * control frame: the browser answers with a pong on its own, and neither
   * reaches the client code.
   */
  static BATIMENTO_MS = 30_000

  /** The message for the `error` `versao-antiga`, in STE100. */
  static readonly FRASE_VERSAO_ANTIGA = "Há uma versão nova do Orwell. Recarrega a página, ou descarrega a versão nova."

  /**
   * The message for the `error` `account-suspended` (reports, §8), for an app
   * that does not know the code. One that does shows "Erro 218" and the full
   * notice.
   */
  static readonly FRASE_CONTA_SUSPENSA = "A tua conta está suspensa neste servidor. Abre a app para ler o motivo e pedir revisão."

  /**
   * How often `fecharSuspensas` runs (`app.ts`): a connection opened before
   * the suspension that sends nothing is closed within a minute. Read once,
   * at server startup.
   */
  static VARRER_SUSPENSAS_MS = 60_000

  accept(socket: WebSocket): void {
    const connection: Connection = {
      socket,
      id: randomUUID(),
      batimento: null,
      address: null,
      deviceKey: null,
      pending: null,
      challenge: null,
      channels: new Set(),
      lugaresTemporarios: new Map(),
      visible: true,
      sfu: new Map(),
      commitDepoisDoEco: false,
      sinalEfemero: false,
      envioRecusado: false,
      cofreCifrado: false,
    }
    this.#connections.add(connection)
    this.#porId.set(connection.id, connection)

    connection.batimento = setInterval(() => {
      if (socket.readyState !== socket.OPEN) return
      try {
        socket.ping()
      } catch {
        // Closing: the `close` that follows cleans up the timer.
      }
    }, Gateway.BATIMENTO_MS)

    socket.on("message", (raw: Buffer) => {
      // Oversized frames are dropped before parsing: a JSON parser is an
      // unbounded amount of work handed to an unauthenticated peer.
      if (raw.length > MAX_FRAME_BYTES) {
        this.#send(connection, {
          t: "error",
          code: "frame-too-large",
          message: `frame exceeds ${MAX_FRAME_BYTES} bytes`,
          fatal: true,
        })
        socket.close()
        return
      }
      void this.#dispatch(connection, raw).catch(() => {
        // A handler blew up mid-frame. Say so instead of leaving whatever
        // waiter is on the other side to bleed out its timeout.
        this.#send(connection, { t: "error", code: "internal", message: "frame handling failed", fatal: false })
      })
    })

    socket.on("close", () => this.#drop(connection))
    socket.on("error", () => this.#drop(connection))
  }

  #drop(connection: Connection): void {
    if (connection.batimento) {
      clearInterval(connection.batimento)
      connection.batimento = null
    }
    this.#connections.delete(connection)
    this.#porId.delete(connection.id)
    this.#baldesDoSinal.delete(`ligacao|${connection.id}`)
    // A pairing box with one side missing is useless, and leaving it open
    // would let a third party take the place of the side that dropped.
    if (this.#caixas.size > 0) this.#largarCaixas(connection)
    // Media is released BEFORE everything else, without waiting for it: each
    // dangling transport is worker memory that never comes back, and a socket
    // that drops is the normal way out of a call, not the exception. It is
    // `void` because `close` does not wait on anyone's promises; the `catch`
    // exists because an uncaught rejection here would crash the entire process
    // over a call that had already ended.
    if (connection.sfu.size > 0) void this.#largarMedia(connection).catch(() => {})
    // Only the last VISIBLE connection of an account going away means offline:
    // a second tab or device keeps the person present, but an invisible one
    // does not. It used to count any connection at all, so going invisible in
    // one tab and closing the other left the account permanently green to its
    // channel-mates: a dot that lies about presence is worse than no dot.
    if (connection.address && connection.visible && !this.#stillVisible(connection.address)) {
      this.#announcePresence(connection, false)
    }
  }

  /** Is any surviving connection of this account still announcing itself? */
  #stillVisible(address: string): boolean {
    return [...this.#connections].some((other) => other.address === address && other.visible)
  }

  // --------------------------------------------------------------- presence

  /**
   * Live presence, relayed and immediately forgotten.
   *
   * The trade-off is deliberate and was chosen by the operator: channel-mates
   * now learn from the server when you connect and disconnect. To keep the
   * cost at its floor, presence exists only in this process's memory (no
   * table, no history, no timestamps, no federation fan-out), and it is only
   * ever told to people who already share a channel with you, who could
   * observe much of it anyway by watching your messages arrive.
   */
  #announcePresence(connection: Connection, online: boolean): void {
    if (!connection.address) return
    // An invisible connection announces nothing, except the moment it turns
    // invisible, which is an explicit "offline" the caller passes as false.
    if (!connection.visible && online) return
    const told = new Set<string>()
    for (const other of this.#connections) {
      if (!other.address || other.address === connection.address || told.has(other.address)) continue
      if (![...connection.channels].some((channel) => other.channels.has(channel))) continue
      told.add(other.address)
      this.#send(other, { t: "presence", address: connection.address, online })
    }
  }

  // ---------------------------------------------------------- emparelhamento

  /**
   * A pairing box: two connections and a deadline. In memory only.
   *
   * The server is a blind transport: it relays `pair.send` from one connection
   * to the other and has nothing to open it with. What it learns is the
   * `pairId` (the hash of the secret, which cannot be reversed to it), that an
   * authenticated account opened the box, that a connection without an
   * account joined, and when. **None of this is written to the database**: no table, no row, and
   * a box dies at `pair.close`, at the close of either connection,
   * or after ten minutes.
   */
  #caixas = new Map<string, CaixaDeEmparelhamento>()

  /**
   * Ten minutes: time to take the phone out of a pocket and point the camera,
   * with slack to paste the link by hand.
   *
   * It is not `readonly` for one reason only: the deadline test
   * (`gateway.test.ts`) shortens it to avoid waiting ten minutes, then
   * restores it. Nothing in production writes to it.
   */
  static PAIR_TTL_MS = 10 * 60_000

  /**
   * Boxes alive at once, across the whole process. Each is an in-memory
   * object and a timer; 256 is far above the number of concurrent pairings a
   * small server sees, and it is a hard cap against anyone opening boxes in a
   * loop from several accounts. Not `readonly`, for the same reason as
   * `PAIR_TTL_MS`: the cap test lowers it and restores it.
   */
  static PAIR_CAIXAS_VIVAS = 256

  /**
   * Opens per account per minute. Six, like the cards: a user opens one, and
   * maybe another if the first expires. Anyone opening more is automating.
   */
  static readonly PAIR_ABERTURAS_POR_MINUTO = 6

  /**
   * Joins per CONNECTION per minute, because the joining side has no account.
   * It caps anyone trying to guess `pairId`s: six per connection and the
   * connection is closed. A `pairId` is 132 bits, so guessing is not a risk to
   * manage; the cap exists so the attempts cost nobody CPU.
   */
  static readonly PAIR_JOINS_POR_MINUTO = 6

  /** The box this connection is in, by `pairId`, or nothing. */
  #caixaDe(connection: Connection, pairId: string): CaixaDeEmparelhamento | undefined {
    const caixa = this.#caixas.get(pairId)
    if (!caixa) return undefined
    return caixa.anfitriao === connection || caixa.convidado === connection ? caixa : undefined
  }

  #abrirCaixa(connection: Connection, pairId: string): void {
    const quem = connection.address as string
    if (!this.#dentroDoTecto("pair-aberturas", quem, Gateway.PAIR_ABERTURAS_POR_MINUTO)) {
      this.#send(connection, { t: "pair.rejected", pairId, reason: "rate-limited" })
      return
    }
    // One box per pairId. The second `open` with the same id is either a mistake or
    // someone trying to take another's box: reject it without touching the existing one.
    if (this.#caixas.has(pairId)) {
      this.#send(connection, { t: "pair.rejected", pairId, reason: "exists" })
      return
    }
    if (this.#caixas.size >= Gateway.PAIR_CAIXAS_VIVAS) {
      this.#send(connection, { t: "pair.rejected", pairId, reason: "full" })
      return
    }
    const caixa: CaixaDeEmparelhamento = {
      pairId,
      anfitriao: connection,
      convidado: null,
      criadoEm: Date.now(),
      prazo: setTimeout(() => this.#queimarCaixa(caixa, "expired"), Gateway.PAIR_TTL_MS),
    }
    // A box's timer does not keep the process alive: a server that is shutting
    // down shuts down, and the box dies with it.
    caixa.prazo.unref?.()
    this.#caixas.set(pairId, caixa)
    this.#send(connection, { t: "pair.opened", pairId })
  }

  #juntarACaixa(connection: Connection, pairId: string): void {
    // Per CONNECTION: the joining side has no account. Above the cap the
    // connection is closed, because a connection without an account that keeps
    // trying has nothing else to do here.
    if (!this.#dentroDoTecto("pair-joins", connection.id, Gateway.PAIR_JOINS_POR_MINUTO)) {
      this.#send(connection, { t: "pair.rejected", pairId, reason: "rate-limited" })
      this.#send(connection, { t: "error", code: "rate-limited", message: "too many pair.join", fatal: true })
      connection.socket.close()
      return
    }
    const caixa = this.#caixas.get(pairId)
    if (!caixa) {
      this.#send(connection, { t: "pair.rejected", pairId, reason: "unknown" })
      return
    }
    // The host's own connection joining itself is not a two-sided box: it is a
    // mistake, and is treated as a full box.
    if (caixa.convidado !== null || caixa.anfitriao === connection) {
      this.#send(connection, { t: "pair.rejected", pairId, reason: "full" })
      /*
        And the box is burned, telling both sides in it. A third connection
        with the right `pairId` means someone else has the secret (saw the QR,
        caught the link), and the SAS would catch that anyway; but keeping the
        box open would let the user confirm words in a pairing whose secret a
        third party knows. Starting over costs a new QR.
      */
      this.#queimarCaixa(caixa, "intruder")
      return
    }
    caixa.convidado = connection
    this.#send(caixa.anfitriao, { t: "pair.joined", pairId })
    this.#send(connection, { t: "pair.joined", pairId })
  }

  /**
   * Close a box and tell the sides in it, except the one that closed it.
   *
   * `quemFechou` is the connection that sent `pair.close`, which does not need
   * the echo; in the other cases (timeout, intruder, drop) both sides are told.
   */
  #queimarCaixa(
    caixa: CaixaDeEmparelhamento,
    reason: "closed" | "peer-left" | "expired" | "intruder",
    quemFechou?: Connection,
  ): void {
    if (this.#caixas.get(caixa.pairId) !== caixa) return
    this.#caixas.delete(caixa.pairId)
    clearTimeout(caixa.prazo)
    for (const lado of [caixa.anfitriao, caixa.convidado]) {
      if (!lado || lado === quemFechou) continue
      this.#send(lado, { t: "pair.closed", pairId: caixa.pairId, reason })
    }
  }

  /** When a connection drops, its boxes die and the other side gets notified. */
  #largarCaixas(connection: Connection): void {
    for (const caixa of this.#caixas.values()) {
      if (caixa.anfitriao === connection || caixa.convidado === connection) {
        this.#queimarCaixa(caixa, "peer-left", connection)
      }
    }
  }

  /** Distinct connected addresses sharing at least one channel with this one. */
  #onlinePeersOf(connection: Connection): Set<string> {
    const peers = new Set<string>()
    for (const other of this.#connections) {
      if (!other.address || other.address === connection.address || !other.visible) continue
      if ([...connection.channels].some((channel) => other.channels.has(channel))) peers.add(other.address)
    }
    return peers
  }

  async #dispatch(connection: Connection, raw: Buffer): Promise<void> {
    let frame
    try {
      frame = parseClientFrame(JSON.parse(raw.toString("utf8")))
    } catch {
      this.#send(connection, { t: "error", code: "bad-frame", message: "unparseable frame", fatal: false })
      return
    }

    // Everything past the handshake requires an authenticated address.
    //
    // **The pairing exceptions, and only these.** The phone joining a box has no
    // account yet: it only has the QR secret. `pair.join` passes without an
    // account, counted per connection (`#dentroDoTecto` by `connection.id`),
    // and is rejected non-fatally when the box does not exist. `pair.send` and `pair.close`
    // pass without an account ONLY from someone in a box: from any other
    // connection they are fatal `unauthenticated`, like everything else. `pair.open`
    // is NOT here: the device that opens has the account and proves it first.
    const semConta =
      frame.t === "pair.join" ||
      ((frame.t === "pair.send" || frame.t === "pair.close") && this.#caixaDe(connection, frame.pairId) !== undefined)
    const needsAuth =
      frame.t !== "hello" && frame.t !== "auth.begin" && frame.t !== "auth.finish" && frame.t !== "ping" && !semConta
    if (needsAuth && !connection.address) {
      this.#send(connection, { t: "error", code: "unauthenticated", message: "authenticate first", fatal: true })
      connection.socket.close()
      return
    }
    /*
      One account per socket (AUTH-02, external audit of 1.1.0). Login was
      allowed without an account, and also WITH one: a second
      `auth.begin` set `address` to null and left this connection's channels,
      media and presence unchanged, and the `auth.finish` from another account
      inherited everything. `#isSeated` reads `connection.channels`, so the new
      account subscribed to the old one's channels and the subscription went to
      disk under its name.

      Refuse instead of resetting: no client logs in twice on the same socket
      (the `Session` opens a new socket on each `connect()`, "Switch account"
      reloads the page, and the pairing phone comes in on a different socket
      from the box's). Resetting would keep a path nobody uses, one that would
      have to drop channels, media, boxes, buckets and presence without
      missing any.
    */
    if ((frame.t === "auth.begin" || frame.t === "auth.finish") && connection.address) {
      this.#send(connection, {
        t: "error",
        code: "already-authenticated",
        message: "this connection is already signed in; open a new connection for another account",
        fatal: true,
      })
      connection.socket.close()
      return
    }
    // An account suspended after connecting (reports, §8) is dropped on its
    // next frame, whatever it is, except a ping: suspension refuses the whole
    // connection, not just sending. One that sends nothing is dropped by
    // `fecharSuspensas`.
    if (connection.address && frame.t !== "ping" && this.store.estaSuspensa(connection.address)) {
      this.#fecharSuspensa(connection)
      return
    }

    switch (frame.t) {
      case "hello":
        // Version first, before trusting any capability: an app this server rejects
        // gets nothing from this connection. The message is for an app that does
        // not know the code (a cached 0.9 shows the `message` as is); 1.0
        // translates the code. See `eVersaoAntiga`.
        if (eVersaoAntiga(this.config, frame.versao)) {
          this.#send(connection, {
            t: "error",
            code: CODIGO_VERSAO_ANTIGA,
            message: Gateway.FRASE_VERSAO_ANTIGA,
            fatal: true,
          })
          connection.socket.close()
          return
        }
        // Stated by the client and trusted. Not a security boundary: a client that
        // lies here can lock the channel, but a hostile member can already do so with a
        // forged commit (see THREAT-MODEL). It is a compatibility gate for honest old
        // bundles. See `#confiavelParaCommits`.
        connection.commitDepoisDoEco = frame.capabilities?.includes(Gateway.COMMIT_DEPOIS_DO_ECO) ?? false
        connection.sinalEfemero = frame.capabilities?.includes(CAPACIDADE_SINAL_EFEMERO) ?? false
        connection.envioRecusado = frame.capabilities?.includes(CAPACIDADE_ENVIO_RECUSADO) ?? false
        connection.cofreCifrado = frame.capabilities?.includes(CAPACIDADE_COFRE_CIFRADO) ?? false
        this.#send(connection, {
          t: "hello.ok",
          version: PROTOCOL_VERSION,
          server: this.config.serverName,
          capabilities: this.#capacidades(),
          ...(this.store.resetAtMinute() !== undefined
            ? { resetAtMinute: this.store.resetAtMinute() as number }
            : {}),
          ...(this.store.accountsResetAtMinute() !== undefined
            ? { accountsResetAtMinute: this.store.accountsResetAtMinute() as number }
            : {}),
          // The archive window, told to the client so it does not have to guess. See
          // `hello.ok.retentionDays` in the protocol.
          retentionDays: this.config.retentionDays,
          ...(this.config.commonRoom
            ? {
                commonRoom: this.config.commonRoom,
                commonRoomGroupInfo: this.store.hasGroupInfo(this.config.commonRoom),
              }
            : {}),
        })
        return

      case "auth.begin": {
        // A half chain is refused, not treated as absent: falling back to the old
        // path would raise an error about the key not matching the address, and
        // send whoever debugs it to the wrong place.
        if ((frame.accountKey === undefined) !== (frame.deviceCert === undefined)) {
          this.#send(connection, {
            t: "error",
            code: "bad-device-cert",
            message: "device chain is half present",
            fatal: true,
          })
          return
        }
        const chain =
          frame.accountKey !== undefined && frame.deviceCert !== undefined
            ? { accountKey: fromBase64(frame.accountKey), deviceCert: fromBase64(frame.deviceCert) }
            : undefined
        this.#beginAuth(connection, frame.address, fromBase64(frame.signingKey), chain)
        return
      }

      case "auth.finish":
        this.#finishAuth(connection, frame.signature, { posse: frame.posse ?? 0, marca: frame.assumirPosse })
        return

      case "channel.subscribe": {
        // One frame, one unit: the schema already caps it at 512 channels at a time,
        // and the client subscribes once per connection. Counting per channel would
        // punish users with many rooms who reconnect on a bad network.
        if (!this.#dentroDoTecto("subscricoes", connection.address as string, Gateway.SUBSCRICOES_POR_MINUTO)) return
        const sentados: string[] = []
        for (const channel of frame.channels) {
          // Subscribing to someone else's feed used to hand over their whole
          // ciphertext stream plus their presence. The id is derivable from a
          // public address, so knowing it proves nothing.
          //
          // `#mayReach`, never `#mayAsk`: the common room's openness is a right
          // to ask, and a subscription is not asking. A newcomer needs none of
          // it either: the Welcome that admits them is addressed to them by
          // name and reaches them regardless, and it is that Welcome which then
          // makes this check pass honestly.
          if (!this.#mayReach(connection, channel)) continue
          sentados.push(channel)
          connection.channels.add(channel)
          this.store.subscribe(channel, connection.address as string)
          // A channel hosted elsewhere means we must federate with its home.
          const home = parseAddress(channel).server
          if (home !== this.config.serverName) this.store.addChannelPeer(channel, home)
        }
        // Presence flows both ways at subscribe time, because this is the
        // moment the server learns who counts as a channel-mate. Repeats are
        // harmless: the client treats them as set membership.
        this.#announcePresence(connection, true)
        for (const peer of this.#onlinePeersOf(connection)) {
          this.#send(connection, { t: "presence", address: peer, online: true })
        }
        // The vault versions of the channels it joined, so the client only asks
        // for what changed. Only to connections that announced the vault, and
        // always, even when empty: a client waiting for it knows it arrived.
        // See `cofre.versoes`.
        if (connection.cofreCifrado) {
          this.#send(connection, {
            t: "cofre.versoes",
            cofres: this.store.cofreVersoes(sentados.map((canal) => `canal:${canal}`)),
          })
        }
        return
      }

      case "channel.unsubscribe":
        for (const channel of frame.channels) {
          connection.channels.delete(channel)
          this.store.unsubscribe(channel, connection.address as string)
        }
        return

      case "channel.send": {
        /*
          Two buckets (S6 review): messages, and commits with their Welcomes.
          With a single bucket, an account syncing (anti-entropy, a burst of
          likes) filled the minute, and a removal that followed had to wait:
          a removed member kept reading until there was room.
        */
        const balde = frame.kind === "application" ? "envios" : "envios-handshake"
        const tecto = frame.kind === "application" ? Gateway.ENVIOS_POR_MINUTO : Gateway.ENVIOS_HANDSHAKE_POR_MINUTO
        if (!this.#dentroDoTecto(balde, connection.address as string, tecto)) {
          this.#recusarEnvioPorRitmo(connection, frame, balde, tecto)
          return
        }
        await this.#relay(connection, frame)
        return
      }

      case "channel.backfill": {
        // Thirty days of a stranger's ciphertext used to be one frame away.
        if (!this.#mayReach(connection, frame.channel)) return
        if (!this.#dentroDoTecto("backfills", connection.address as string, Gateway.BACKFILLS_POR_MINUTO)) return
        const events =
          frame.afterSeq !== undefined
            ? this.store.catchUp(frame.channel, frame.afterSeq, frame.limit, connection.address as string)
            : this.store.backfill(frame.channel, frame.beforeSeq, frame.limit, connection.address as string)

        this.#send(connection, {
          t: "channel.backfill.page",
          channel: frame.channel,
          events: events.map((event) => ({
            seq: event.seq,
            kind: event.kind as "application" | "handshake" | "welcome",
            ciphertext: event.ciphertext,
            receivedAtMinute: event.receivedAtMinute,
          })),
          // A full page probably means more behind it. The client keeps asking
          // until a short page arrives: dropping the tail would leave it on a
          // stale epoch, which is the failure this whole path exists to prevent.
          more: events.length === frame.limit,
        })
        return
      }

      case "keypackage.publish": {
        const quem = connection.address as string
        if (this.#recusarRevogado(connection)) return
        if (!this.#dentroDoTecto("keypackages", quem, Gateway.KEYPACKAGES_POR_MINUTO)) return
        // The device for these key packages is the one that signed this login's
        // challenge (the same key signs the leaves: `signatureKeyPair` in
        // group.ts), and ONLY that one. The `device` the client declares is
        // checked, never used as the source: if it were, on a login without a
        // chain any account could invent a device per frame and the cap of five
        // hundred per device would vanish. Without a chain the key packages get
        // no device (NULL) and the cap is the whole account's. A declared device
        // that does not match the login is a lie or a mistake, and we say so:
        // assigning key packages to the wrong device serves them to someone who
        // cannot open them.
        const declarado = frame.device === undefined ? null : fromBase64(frame.device)
        if (declarado !== null && (connection.deviceKey === null || !bytesIguais(declarado, connection.deviceKey))) {
          this.#send(connection, {
            t: "error",
            code: "device-mismatch",
            message: "device does not match the one that signed in",
            fatal: false,
          })
          return
        }
        const device = connection.deviceKey
        // `replace` deletes the unclaimed ones before writing, so it never adds
        // to what is there, and it is the recovery path for a client whose stock
        // is full. Without it there is a hard cap, PER DEVICE: each machine has
        // its own pool and its own cap.
        if (!frame.replace && this.store.availableKeyPackages(quem, device ?? undefined) >= Gateway.KEYPACKAGES_EM_ESPERA) return
        this.store.publishKeyPackages(
          quem,
          frame.packages.map((pkg) => fromBase64(pkg)),
          frame.replace,
          device,
        )
        return
      }

      case "keypackage.claim": {
        if (this.#recusarRevogado(connection)) return
        await this.#claimKeyPackage(connection, frame.address, frame.bundle, frame.devices)
        return
      }

      case "invite.create":
        // Minting invites into a channel you are not in is not useful to you and
        // is useful to somebody else.
        if (!this.#dentroDoTecto("convites", connection.address as string, Gateway.CONVITES_POR_MINUTO)) return
        if (!this.#mayReach(connection, frame.channel)) return
        const codigoCurto = this.store.createInvite({
          codeHash: frame.codeHash,
          channel: frame.channel,
          expiresAt: frame.expiresAt,
          maxUses: frame.maxUses,
          ...(frame.codeKey === undefined ? {} : { codeKey: frame.codeKey }),
          // The size cap is from the schema (`SELO_DO_CONVITE_MAX_CARACTERES`): a larger
          // seal never gets here.
          ...(frame.selo === undefined ? {} : { selo: frame.selo }),
        })
        this.#send(connection, {
          t: "invite.created",
          channel: frame.channel,
          codeHash: frame.codeHash,
          ...(codigoCurto === undefined ? {} : { codigoCurto }),
        })
        return

      case "invite.resolve": {
        // Two caps, and the global one is what stops guessing: accounts are made
        // in an instant, and a per-account cap alone would multiply by their
        // number. The global cap is generous for real link use and tight for
        // anyone sweeping 31^8 codes. A matching code opens nothing by itself:
        // it grants the right to ask members for entry, like the long link.
        const quem = connection.address as string
        if (
          !this.#dentroDoTecto("resolucoes", quem, Gateway.RESOLUCOES_POR_MINUTO) ||
          !this.#dentroDoTecto("resolucoes", "*", Gateway.RESOLUCOES_DO_SERVIDOR_POR_MINUTO)
        ) {
          this.#send(connection, { t: "invite.unresolved", codigo: frame.codigo, reason: "rate-limited" })
          return
        }
        const resolvido = this.store.resolveShortCode(frame.codigo)
        this.#send(
          connection,
          resolvido.ok
            ? {
                t: "invite.resolved",
                codigo: frame.codigo,
                channel: resolvido.channel,
                codeHash: resolvido.codeHash,
                ...(resolvido.selo === undefined ? {} : { selo: resolvido.selo }),
              }
            : { t: "invite.unresolved", codigo: frame.codigo, reason: resolvido.reason },
        )
        return
      }

      case "invite.selo": {
        // The long link's seal (1.0 "Arca", slice 5c). The `codeHash` is 256 bits
        // and cannot be guessed, so the per-account cap is enough (the global cap
        // of `invite.resolve` targets sweeps of 8-character codes and need not be
        // spent here). Above the cap, or with no invite, it goes without a seal:
        // the prompt says "a channel", and the redeem decides the rest.
        const dentro = this.#dentroDoTecto("resolucoes", connection.address as string, Gateway.RESOLUCOES_POR_MINUTO)
        const selo = dentro ? this.store.seloDoConvite(frame.codeHash) : undefined
        this.#send(connection, { t: "invite.selo.result", codeHash: frame.codeHash, ...(selo === undefined ? {} : { selo }) })
        return
      }

      case "invite.revoke": {
        // Revoking by hash alone let anyone cancel anyone's invites. Resolve the
        // hash to its channel first and check the caller belongs there.
        const owning = this.store.channelOfInvite(frame.codeHash)
        if (!owning || !this.#mayReach(connection, owning)) return
        this.store.revokeInvite(frame.codeHash)
        return
      }

      case "invite.list":
        // The server redeems by HASH, and this is the list of hashes: handing it
        // to anyone who can merely reach the channel is handing them entry by a
        // code that was never given to them.
        if (!this.#isSeated(connection, frame.channel)) return
        this.#send(connection, {
          t: "invite.list.result",
          channel: frame.channel,
          invites: this.store.listInvites(frame.channel),
        })
        return

      case "invite.redeem": {
        /*
          The code proof (1.0 "Arca", slice 2). An invite with a `code_key` can
          only be redeemed with a signature by the key derived from the code,
          over this request and this account: the `codeHash`, which is in the
          database, is no longer enough. An invite without a `code_key` (from a
          0.9.x client) cannot be redeemed at all: its hash is in the database,
          and accepting it would let in anyone with a copy of the table. In 1.0
          there are no 0.9.x clients.
        */
        const quem = connection.address as string
        /*
          INV-02 (external audit of 1.1.0): redeem amplified traffic with no
          cap. The `keyPackage` size is already limited by the schema
          (`TAMANHO_MAXIMO_DO_KEY_PACKAGE`); here we check the shape, repeated
          requests and rate, all BEFORE spending a use.
        */
        if (lerCabecalhoMls(fromBase64(frame.keyPackage))?.formato !== "key_package") {
          this.#send(connection, { t: "error", code: "bad-frame", message: "keyPackage is not an MLS key package", fatal: false })
          return
        }
        const canalDoConvite = this.store.channelOfInvite(frame.codeHash)
        // The same request again, when the first one already reached connected
        // members: they have it, and broadcasting it again is just traffic. If it
        // reached nobody, it passes: that is how a client retries.
        if (canalDoConvite !== undefined && (this.#pendenteDe(canalDoConvite, quem)?.ouviram ?? 0) > 0) return
        if (
          !this.#dentroDoTecto("resgates", quem, Gateway.RESGATES_POR_MINUTO) ||
          !this.#dentroDoTecto("resgates-convite", frame.codeHash, Gateway.RESGATES_POR_CONVITE_POR_MINUTO) ||
          (canalDoConvite !== undefined &&
            !this.#dentroDoTecto("resgates-canal", canalDoConvite, Gateway.RESGATES_POR_CANAL_POR_MINUTO)) ||
          !this.#dentroDoTecto("resgates", "*", Gateway.RESGATES_DO_SERVIDOR_POR_MINUTO)
        ) {
          this.#send(connection, { t: "invite.rejected", reason: "rate-limited" })
          return
        }
        const pedido = { codeHash: frame.codeHash, address: quem, keyPackage: frame.keyPackage }
        const result = this.store.redeemInvite(frame.codeHash, (codeKey) =>
          codeKey !== null && frame.prova !== undefined && verificarProvaDoConvite(codeKey, frame.prova, pedido),
        )
        if (!result.ok) {
          this.#send(connection, { t: "invite.rejected", reason: result.reason })
          return
        }

        // Hand the request to the channel's members. The server has spent a use
        // and vouched that the code was valid; it cannot do the admitting.
        const ouviram = this.broadcast(result.channel, {
          t: "invite.request",
          channel: result.channel,
          address: quem,
          keyPackage: frame.keyPackage,
          codeHash: frame.codeHash,
        })
        this.#guardarPendente(result.channel, quem, ouviram)

        /*
          And nothing else: redeem is a REQUEST, not a seat (INV-01, external
          audit of 1.1.0). Until now it subscribed right away, "so the Welcome
          has somewhere to land", and that gave anyone holding the link the
          live ciphertext, the history and write access to the channel before
          any member accepted them, and forever if nobody did.

          The Welcome needs no subscription: it is addressed (`broadcast` with
          `recipient` ignores channels) and is stored for `welcome.resync` if
          the recipient is offline. The proof of admission is that Welcome, sent
          by a member seated in the channel; from then on `#isSeated` lets it through
          (`hasWelcomeFor`), and the client subscribes right after accepting it
          (1.1.x and 1.2.0, `#acceptWelcome`).
        */
        return
      }

      case "directory.list":
        if (!this.#dentroDoTecto("directorio", connection.address as string, Gateway.DIRECTORIOS_POR_MINUTO)) return
        // Silent empty when the mode is off: a client asking is not doing
        // anything wrong, and there is nothing to say.
        this.#send(connection, {
          t: "directory.list.result",
          addresses: this.config.communityMode ? this.store.localAccounts() : [],
        })
        return

      case "channel.claim": {
        // Arbitration, and nothing else: the server says who gets to create the
        // group, and neither creates it nor joins it. Without this, several users
        // arriving at once each create their own group with the same id, and all
        // end up alone in a room with the right name.
        /*
          In 1.0 only opaque addresses and the common room can be claimed, and
          the first to ask gets them. An opaque address (25 random bytes, or
          derived from secrets) names nobody and cannot be guessed, so there is
          no name to keep: the 0.9 guards (only the accounts in `!dm-a.b`,
          `!feed-x` and `!self-x` could claim those channels, phase 1g) went
          away with the old form. An old form cannot be claimed at all
          (`#formaFechada`), and the reply does not say who held it.
        */
        if (this.#formaFechada(frame.channel)) {
          this.#send(connection, {
            t: "channel.claim.result",
            channel: frame.channel,
            owner: "",
            mine: false,
            empty: this.store.channelNeverUsed(frame.channel),
          })
          return
        }
        const owner = this.store.claimChannel(frame.channel, connection.address as string)
        this.#send(connection, {
          t: "channel.claim.result",
          channel: frame.channel,
          owner,
          mine: owner === connection.address,
          // Being the designated creator is not enough to create: a client that
          // lost its vault and came back still is one, and would create a second
          // group with the same id. This is what the client needs to know to
          // avoid that.
          empty: this.store.channelNeverUsed(frame.channel),
        })
        return
      }

      case "channel.groupinfo.put": {
        // The guard that separates a public room from an open door: the card only
        // exists for the channel THIS server announces as common. Storing it for
        // any other channel would leave that channel's key under the mat: whoever
        // picks it up gets in without anyone inviting them.
        if (!this.#ehSalaComum(frame.channel)) return
        // And only a member seated there can put it. A forged card does not survive
        // validation by whoever uses it (the signature is checked against the
        // signer's leaf), but an OLD card, put back by a stranger over the good
        // one, would send every newcomer to a dead epoch.
        if (!this.#isSeated(connection, frame.channel)) return
        // An old connection does not publish a card, and is not told anything: its
        // `put` goes out by itself on every common room epoch. See `#confiavelParaCommits`.
        if (!this.#confiavelParaCommits(connection)) return
        // And only the card for the channel's current epoch (see `Store.putGroupInfo`).
        // An epoch rejection is reported to the publisher; an unreadable card's is
        // not, like the two guards above: no honest client produces one, and it
        // could do nothing with the reply.
        const cartao = this.store.putGroupInfo(frame.channel, fromBase64(frame.info))
        if (!cartao.ok && cartao.reason === "stale-groupinfo") {
          this.#send(connection, {
            t: "channel.rejected",
            channel: frame.channel,
            reason: "stale-groupinfo",
            epoch: cartao.epoch,
          })
        }
        return
      }

      case "channel.groupinfo.take": {
        if (!this.#ehSalaComum(frame.channel)) {
          this.#send(connection, { t: "channel.groupinfo", channel: frame.channel })
          return
        }
        // An old client does not take the card: it would come in with a commit that
        // is not accepted, and use up the door for whoever came next. It gets the
        // usual "no card" answer, and `eabfd6c` then asks members for a seat.
        if (!this.#confiavelParaCommits(connection)) {
          this.#send(connection, { t: "channel.groupinfo", channel: frame.channel })
          return
        }
        if (!this.#dentroDoTecto("cartoes", connection.address as string, Gateway.CARTOES_POR_MINUTO)) return

        const info = this.store.takeGroupInfo(frame.channel)
        if (!info) {
          this.#send(connection, { t: "channel.groupinfo", channel: frame.channel })
          return
        }

        /*
          Taking the card is NOT joining (INV-01, external audit of 1.1.0).

          The external commit that follows must be able to go out, and without a
          seat `#relay` refuses it. Until now this set the usual marker,
          `connection.channels`, and that marker was enough for the next
          `channel.subscribe` to write the subscription to disk: anyone who took
          the card and never sent the commit (ran out of key packages, the card
          no longer matched the room, or simply chose not to) kept a permanent
          seat in the common room, reading history and writing garbage to it.

          Now it is a TEMPORARY seat, apart from the channels, that only lets
          this card's external commit out, and expires. Only the commit,
          accepted as the epoch's commit, promotes the seat to a subscription
          (see `#relay`); `channel.subscribe` never promotes it.
        */
        connection.lugaresTemporarios.set(frame.channel, Date.now() + Gateway.LUGAR_TEMPORARIO_MS)
        this.#send(connection, { t: "channel.groupinfo", channel: frame.channel, info: toBase64(info) })
        return
      }

      case "ice.servers": {
        if (!this.#dentroDoTecto("ice", connection.address as string, Gateway.ICE_POR_MINUTO)) return
        this.#send(connection, { t: "ice.servers.result", servers: this.#iceServers(connection.address) })
        return
      }

      case "link.preview": {
        await this.#previewLink(connection, frame.url)
        return
      }

      case "manifest.publish": {
        const quem = connection.address as string
        if (!this.#dentroDoTecto("manifestos", quem, Gateway.MANIFESTOS_POR_MINUTO)) return
        // Only for the connection's own account. The signature already proves the
        // publisher holds the account key of the address the manifest names, so this is not a
        // cryptographic gate: it is the rule that a connection speaks for an account,
        // and it is what stops one account from spending another's cap.
        if (frame.manifest.address !== quem) {
          this.#send(connection, {
            t: "manifest.published",
            address: frame.manifest.address,
            version: frame.manifest.version,
            ok: false,
            reason: "not-yours",
          })
          return
        }
        const resultado = this.store.putDeviceManifest(frame.manifest, frame.revoke)
        this.#send(connection, {
          t: "manifest.published",
          address: quem,
          version: frame.manifest.version,
          ok: resultado.ok,
          ...(resultado.ok ? {} : { reason: resultado.reason }),
        })
        // Devices this manifest revoked that are connected now are dropped at once,
        // not on their next connect: until then they could claim key packages,
        // publish others, and ask for seats in channels.
        if (resultado.ok && resultado.revogados.length > 0) {
          const revogados = new Set(resultado.revogados)
          for (const outra of this.#connections) {
            if (outra.address !== quem || outra.deviceKey === null) continue
            if (revogados.has(toBase64(outra.deviceKey))) this.#fecharRevogado(outra)
          }
        }
        return
      }

      case "manifest.get": {
        if (!this.#dentroDoTecto("manifestos", connection.address as string, Gateway.MANIFESTOS_POR_MINUTO)) return
        this.#send(connection, {
          t: "manifest.result",
          address: frame.address,
          manifest: this.store.deviceManifestOf(frame.address),
        })
        return
      }

      case "channel.rejoin.request":
        // Handed to the channel's connected members, who are the only ones able to
        // commit a new seat. The server cannot do it and does not try.
        //
        // It can, however, refuse to carry the request from an account that was never
        // in the channel. Without this, one frame naming a public feed id got the sender
        // seated in a private channel by the first member online, permanently. The
        // client refuses too (`#answerRejoin` checks the tree); this stops the request
        // ever reaching an honest member's client.
        //
        // The one frame the common room's openness exists for, and therefore the only
        // one that takes `#mayAsk` instead of `#mayReach`.
        //
        // The channel's creator can also ask (1.0 "Arca", slice 3). A group's creator
        // never gets a Welcome, so after losing its state (a `forgetChannel`, a
        // restored vault) and its subscription, the server did not see it seated.
        // With the old form it refounded the channel by name; an opaque address
        // cannot be refounded (slice 4), and asking a peer for a seat is the only
        // way back. Only this request: members check the tree (`#answerRejoin`),
        // and anyone not in it gets no seat.
        if (!this.#mayAsk(connection, frame.channel) && this.store.claimantOf(frame.channel) !== connection.address) return
        {
          const ouviram = this.broadcast(frame.channel, {
            t: "channel.rejoin",
            channel: frame.channel,
            address: connection.address as string,
          })
          // Say how many it reached. Zero is a useful answer: it means nobody
          // online can admit, which is different from being ignored by those who are.
          this.#send(connection, { t: "channel.rejoin.sent", channel: frame.channel, ouviram })
        }
        return

      case "welcome.resync":
        if (!this.#dentroDoTecto("resyncs", connection.address as string, Gateway.RESYNCS_POR_MINUTO)) return
        for (const event of this.store.pendingWelcomes(connection.address as string, 200)) {
          this.#send(connection, {
            t: "channel.event",
            channel: event.channel,
            seq: event.seq,
            kind: event.kind as "application" | "handshake" | "welcome",
            ciphertext: event.ciphertext,
            receivedAtMinute: event.receivedAtMinute,
          })
        }
        return

      case "presence.set": {
        const wasVisible = connection.visible
        connection.visible = frame.visible
        // Going invisible looks exactly like leaving, because that is the
        // promise: channel-mates see an absence. Coming back announces.
        //
        // "Leaving" only if there is nothing left to see, though: another tab
        // of the same account still announcing itself means the person is still
        // there, and telling their channel-mates otherwise would be a lie in
        // the opposite direction to the one `#drop` used to tell.
        if (wasVisible !== frame.visible && (frame.visible || !this.#stillVisible(connection.address as string))) {
          this.#announcePresence(connection, frame.visible)
        }
        return
      }

      case "voice.leave":
      case "voice.signal":
        return

      case "pair.open":
        this.#abrirCaixa(connection, frame.pairId)
        return
      case "pair.join":
        this.#juntarACaixa(connection, frame.pairId)
        return
      case "pair.send": {
        const caixa = this.#caixaDe(connection, frame.pairId)
        if (!caixa) return
        // To the OTHER side, and only to it. The server does not open the payload:
        // it has no key, and the schema already checked its size.
        const outro = caixa.anfitriao === connection ? caixa.convidado : caixa.anfitriao
        if (outro) this.#send(outro, { t: "pair.message", pairId: frame.pairId, payload: frame.payload })
        return
      }
      case "pair.close": {
        const caixa = this.#caixaDe(connection, frame.pairId)
        if (caixa) this.#queimarCaixa(caixa, "closed", connection)
        return
      }

      case "sfu.scope.join":
      case "sfu.scope.leave":
      case "sfu.transport.create":
      case "sfu.transport.connect":
      case "sfu.produce":
      case "sfu.produce.close":
      case "sfu.consume":
      case "sfu.resume":
      case "sfu.pause":
        await this.#sfu(connection, frame)
        return

      case "sfu.keyframe":
        this.#pedirFotogramaChave(connection, frame)
        return

      case "channel.sinal":
        this.#sinal(connection, frame)
        return

      case "cofre.put":
      case "cofre.get":
      case "cofre.del":
        this.#cofre(connection, frame)
        return

      case "ping":
        this.#send(connection, { t: "pong" })
        return
    }
  }

  // ---------------------------------------------------------- ephemeral signals

  /**
   * The signal buckets: per connection (`ligacao|<id>`, cost 1 per signal) and
   * per channel (`canal|<canal>`, cost in outgoing bytes). Each entry is a
   * spend with its timestamp, valid for 60 s. Kept apart from `#tectos`
   * because these report how long until there is room (`retryAfterMs`), and
   * bytes are not units.
   */
  #baldesDoSinal = new Map<string, { at: number; custo: number }[]>()

  /** The counts per minute, with no content. See `metricasDoSinal`. */
  #metricasDoSinal = new MetricasDoSinal()

  /** The bytes stored per channel and per day, with no names. See `metricasDoDisco`. */
  #metricasDoDisco = new MetricasDoDisco()

  /** Sends rejected for rate, per minute, with no names. See `metricasDosEnvios`. */
  #metricasDosEnvios = new MetricasDosEnvios()

  /**
   * Sends rejected for rate, minute by minute, per bucket, and connections
   * closed for not backing off (S6 review). No channels or accounts, like
   * `metricasDoSinal`: process totals only, last 60 minutes.
   */
  metricasDosEnvios(): { actual: MinutoDeEnvios; anteriores: MinutoDeEnvios[] } {
    return this.#metricasDosEnvios.ler(Date.now())
  }

  /**
   * Disk used by channels today and yesterday, in bytes of stored ciphertext
   * (`application` events). To measure the cost of sync reports (S4): the
   * server does not know which event is a report (it is a `typing`, encrypted
   * like the rest), so it counts everything stored, and reports show up as
   * the excess over a normal day. No channel names or accounts: only the
   * number of channels, the total, the largest, and how many went over 4 MiB.
   */
  metricasDoDisco(): { hoje: DiaDoDisco; ontem: DiaDoDisco | null } {
    return this.#metricasDoDisco.ler(Date.now())
  }

  /**
   * Signal counts, minute by minute, without content: no channels or
   * accounts. Process totals only, in memory, last 60 minutes. They die
   * with the process.
   */
  metricasDoSinal(): { actual: MinutoDeSinais; anteriores: MinutoDeSinais[] } {
    return this.#metricasDoSinal.ler(Date.now())
  }

  /**
   * How long until this bucket has room for `custo`, in ms. Zero means "room
   * now". Spends nothing.
   */
  #esperaDoBalde(chave: string, custo: number, tecto: number, agora: number): number {
    const vivos = (this.#baldesDoSinal.get(chave) ?? []).filter((gasto) => agora - gasto.at < 60_000)
    if (vivos.length === 0) this.#baldesDoSinal.delete(chave)
    else this.#baldesDoSinal.set(chave, vivos)
    let usado = vivos.reduce((soma, gasto) => soma + gasto.custo, 0)
    if (usado + custo <= tecto) return 0
    // Spends are in arrival order: the oldest goes first.
    for (const gasto of vivos) {
      usado -= gasto.custo
      if (usado + custo <= tecto) return Math.max(1, gasto.at + 60_000 - agora)
    }
    return 60_000
  }

  #gastarDoBalde(chave: string, custo: number, agora: number): void {
    const gastos = this.#baldesDoSinal.get(chave) ?? []
    gastos.push({ at: agora, custo })
    this.#baldesDoSinal.set(chave, gastos)
    // As in `#dentroDoTecto`: a map that only grows is a leak. Per-channel
    // buckets outlive the channel going quiet, so it is swept when large.
    if (this.#baldesDoSinal.size > 4096) {
      for (const [outra, lista] of this.#baldesDoSinal) {
        const ultimo = lista[lista.length - 1]
        if (!ultimo || agora - ultimo.at >= 60_000) this.#baldesDoSinal.delete(outra)
      }
    }
  }

  /**
   * An ephemeral signal: check, count, pass to the other connected members,
   * and forget.
   *
   * **What is checked, in this order:** the connection announced the
   * capability; the connection is subscribed to the channel (that is what the
   * server knows about who holds a seat, and it costs no database read); the
   * size fits the operator's cap; the connection has room in its bucket; the
   * channel has room in its outgoing bucket. Buckets are charged only when
   * everything passes.
   *
   * **What is NOT done:** storing, replaying to offline users, federating, or
   * deciding who answers whom. `#mayReach` is not called, because it can
   * create and claim a channel, and a signal leaves no trace.
   *
   * **Who receives it:** every other connection subscribed to the channel
   * that announced the capability, including other devices of the same
   * account (each is a leaf and has its own hash). The sender gets no echo.
   */
  #sinal(connection: Connection, frame: Extract<ClientFrame, { t: "channel.sinal" }>): void {
    const tectos = tectosDoSinal(this.config)
    const agora = Date.now()
    const recusar = (code: CodigoDeRecusaDoSinal, message: string, retryAfterMs?: number): void =>
      this.#recusarSinal(connection, frame, code, message, retryAfterMs, tectos.recusasAteFechar, agora)

    if (!connection.sinalEfemero) {
      recusar("sinal-not-announced", `announce ${CAPACIDADE_SINAL_EFEMERO} in hello to send signals`)
      return
    }
    if (!connection.channels.has(frame.channel)) {
      recusar("sinal-no-seat", "this connection is not subscribed to the channel")
      return
    }
    const tamanho = frame.sinal.length
    if (tamanho > tectos.maxBytes) {
      recusar("sinal-too-large", `signal exceeds ${tectos.maxBytes} bytes`)
      return
    }

    const destinos: Connection[] = []
    for (const outra of this.#connections) {
      if (outra === connection || !outra.address || !outra.sinalEfemero) continue
      if (outra.channels.has(frame.channel)) destinos.push(outra)
    }
    const custo = tamanho * destinos.length
    if (custo > tectos.bytesPorCanalPorMinuto) {
      recusar(
        "sinal-too-large",
        `signal costs ${custo} bytes out to ${destinos.length} members, over ${tectos.bytesPorCanalPorMinuto} per minute`,
      )
      return
    }

    const chaveDaLigacao = `ligacao|${connection.id}`
    const esperaDaLigacao = this.#esperaDoBalde(chaveDaLigacao, 1, tectos.porMinutoPorLigacao, agora)
    if (esperaDaLigacao > 0) {
      recusar("sinal-rate-limited", `more than ${tectos.porMinutoPorLigacao} signals per minute`, esperaDaLigacao)
      return
    }
    const chaveDoCanal = `canal|${frame.channel}`
    const esperaDoCanal = custo === 0 ? 0 : this.#esperaDoBalde(chaveDoCanal, custo, tectos.bytesPorCanalPorMinuto, agora)
    if (esperaDoCanal > 0) {
      recusar("sinal-channel-busy", `channel over ${tectos.bytesPorCanalPorMinuto} signal bytes out per minute`, esperaDoCanal)
      return
    }

    this.#gastarDoBalde(chaveDaLigacao, 1, agora)
    if (custo > 0) this.#gastarDoBalde(chaveDoCanal, custo, agora)
    this.#metricasDoSinal.aceite(agora, tamanho, destinos.length)

    // Serialized once: the same text for everyone.
    const saida: ServerFrame = {
      t: "channel.sinal",
      channel: frame.channel,
      from: connection.address as string,
      sinal: frame.sinal,
    }
    const texto = JSON.stringify(saida)
    for (const destino of destinos) this.#enviarTexto(destino, texto)
  }

  /**
   * Tell the sender the signal did not go through, and close only connections
   * that keep trying.
   *
   * A rejection never closes on the first one. Counted per connection per
   * minute; above `recusasAteFechar`, the connection closes with `error`
   * `sinal-abuse`, fatal.
   */
  #recusarSinal(
    connection: Connection,
    frame: Extract<ClientFrame, { t: "channel.sinal" }>,
    code: CodigoDeRecusaDoSinal,
    message: string,
    retryAfterMs: number | undefined,
    recusasAteFechar: number,
    agora: number,
  ): void {
    this.#metricasDoSinal.recusa(agora, code)
    this.#send(connection, {
      t: "channel.sinal.rejected",
      channel: frame.channel,
      code,
      message,
      ...(frame.ref !== undefined ? { ref: frame.ref } : {}),
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    })
    if (!this.#dentroDoTecto("sinal-recusas", connection.id, recusasAteFechar)) {
      this.#metricasDoSinal.recusa(agora, "sinal-abuse")
      this.#send(connection, { t: "error", code: "sinal-abuse", message: "too many refused signals", fatal: true })
      connection.socket.close()
    }
  }

  // ---------------------------------------------------------- cofre cifrado

  /** Content bytes per page of `cofre.entradas`: 5.4 MiB in base64, under the 12 MiB frame limit. */
  static readonly COFRE_PAGINA_BYTES = 4 * 1024 * 1024
  /** Rows per page of `cofre.entradas`. */
  static readonly COFRE_PAGINA_LINHAS = 1024

  /** Vault counts per minute, with no scopes or accounts. See `metricasDoCofre`. */
  #metricasDoCofre = new MetricasDoCofre()

  /**
   * Vault counts, minute by minute: writes, reads, bytes, rejections
   * by code and by reason. **No scopes, no accounts, no connections**, for the
   * same reason as `metricasDoSinal`: a per-channel record would reveal which
   * channels are being tidied up, and when. Process totals, in memory, last 60 minutes.
   */
  metricasDoCofre(): { actual: MinutoDoCofre; anteriores: MinutoDoCofre[] } {
    return this.#metricasDoCofre.ler(Date.now())
  }

  /**
   * The `cofre.*` frames: check, count, store or serve.
   *
   * **What is checked, in this order:** the connection announced the
   * capability; the scope belongs to the caller (`canal:` through `#mayReach`,
   * the same guard as `channel.send` and `channel.backfill`; `conta:` only the
   * caller's own account, from a device that is not revoked); the account has
   * room in the write or read bucket. The bucket is charged only when
   * everything passes. The per-entry caps (size, padding, CAS, room in the
   * scope) belong to the `Store` and come back entry by entry in the result,
   * without rejecting the frame.
   *
   * **What is NOT done:** reading the content, deciding authority (a
   * `role.assign` in the vault only counts if the client accepts it),
   * federating, or recording anywhere who read what.
   *
   * Phase 3a's write guard is only this. The write key tied to the commit
   * (phase 3c) comes next, with the reason `chave-de-escrita` already reserved.
   */
  #cofre(connection: Connection, frame: Extract<ClientFrame, { t: `cofre.${string}` }>): void {
    const tectos = tectosDoCofre(this.config)
    const agora = Date.now()
    const address = connection.address as string
    const recusar = (code: CodigoDeRecusaDoCofre, message: string, retryAfterMs?: number): void =>
      this.#recusarCofre(connection, frame, code, message, retryAfterMs, tectos.recusasAteFechar, agora)

    if (!connection.cofreCifrado) {
      recusar("cofre-nao-anunciado", `announce ${CAPACIDADE_COFRE_CIFRADO} in hello to use the vault`)
      return
    }

    const escopo = frame.escopo
    const deConta = escopo.startsWith("conta:")
    if (deConta) {
      if (escopo.slice("conta:".length) !== address) {
        recusar("cofre-sem-lugar", "a conta: scope belongs to its own account only")
        return
      }
      if (this.#recusarRevogado(connection)) return
    } else if (!this.#mayReach(connection, escopo.slice("canal:".length))) {
      recusar("cofre-sem-lugar", "this account has no seat in the channel")
      return
    }

    const escrita = frame.t !== "cofre.get"
    const custo = frame.t === "cofre.put" ? frame.entradas.length : 1
    const balde = escrita ? `cofre-escritas|${address}` : `cofre-leituras|${address}`
    const tecto = escrita ? tectos.escritasPorMinuto : tectos.leiturasPorMinuto
    if (custo > tecto) {
      recusar("cofre-ritmo", `${custo} writes in one frame, over ${tecto} per minute`)
      return
    }
    const espera = this.#esperaDoBalde(balde, custo, tecto, agora)
    if (espera > 0) {
      recusar("cofre-ritmo", `more than ${tecto} vault ${escrita ? "writes" : "reads"} per minute`, espera)
      return
    }
    this.#gastarDoBalde(balde, custo, agora)

    const limites = {
      entradaMaxBytes: tectos.entradaMaxBytes,
      entradas: tectos.entradasPorEscopo,
      bytes: deConta ? tectos.bytesPorEscopoDeConta : tectos.bytesPorEscopoDeCanal,
    }
    const ref = frame.ref !== undefined ? { ref: frame.ref } : {}

    switch (frame.t) {
      case "cofre.put": {
        const entradas = frame.entradas.map((entrada) => ({
          chave: entrada.chave,
          conteudo: fromBase64(entrada.conteudo),
          versaoEsperada: entrada.versaoEsperada,
        }))
        const { bytesAceites, ...resultado } = this.store.cofrePut(escopo, entradas, limites)
        this.#metricasDoCofre.escrita(agora, resultado.aceites.length, bytesAceites, resultado.recusadas.map((r) => r.razao))
        this.#send(connection, { t: "cofre.put.result", escopo, ...resultado, ...ref })
        if (resultado.aceites.length > 0) this.#avisarVersaoDoCofre(connection, escopo, resultado.versaoGlobal)
        return
      }
      case "cofre.del": {
        const resultado = this.store.cofreDel(escopo, frame.chave, frame.versaoEsperada, tectos.entradasPorEscopo)
        this.#metricasDoCofre.apagamento(agora, resultado.razao)
        this.#send(connection, {
          t: "cofre.del.result",
          escopo,
          chave: frame.chave,
          versaoGlobal: resultado.versaoGlobal,
          ...(resultado.razao === undefined ? { versao: resultado.versao } : { razao: resultado.razao, versao: resultado.versaoActual }),
          ...ref,
        })
        if (resultado.razao === undefined) this.#avisarVersaoDoCofre(connection, escopo, resultado.versaoGlobal)
        return
      }
      case "cofre.get": {
        const pagina = this.store.cofreGet(escopo, frame.desdeVersao, Gateway.COFRE_PAGINA_BYTES, Gateway.COFRE_PAGINA_LINHAS)
        this.#metricasDoCofre.leitura(
          agora,
          pagina.entradas.reduce((soma, entrada) => soma + entrada.conteudo.length, 0),
        )
        this.#send(connection, {
          t: "cofre.entradas",
          escopo,
          versaoGlobal: pagina.versaoGlobal,
          completo: pagina.completo,
          ate: pagina.ate,
          mais: pagina.mais,
          entradas: pagina.entradas.map((entrada) => ({
            chave: entrada.chave,
            versao: entrada.versao,
            conteudo: toBase64(entrada.conteudo),
          })),
          lapides: pagina.lapides,
          ...ref,
        })
        return
      }
    }
  }

  /**
   * Tell the other connections that care about the scope that its version
   * went up.
   *
   * `canal:` to connections subscribed to the channel; `conta:` to the
   * account's other devices. Only to connections that announced the vault,
   * and never to the writer (it already has the result). It teaches the
   * server nothing new: the subscriptions and connections are its own.
   */
  #avisarVersaoDoCofre(origem: Connection, escopo: string, versaoGlobal: number): void {
    const deConta = escopo.startsWith("conta:")
    const alvo = escopo.slice(deConta ? "conta:".length : "canal:".length)
    const texto = JSON.stringify({ t: "cofre.versoes", cofres: [{ escopo, versaoGlobal }] } satisfies ServerFrame)
    for (const outra of this.#connections) {
      if (outra === origem || !outra.address || !outra.cofreCifrado) continue
      const interessa = deConta ? outra.address === alvo : outra.channels.has(alvo)
      if (interessa) this.#enviarTexto(outra, texto)
    }
  }

  /**
   * Tell the caller the vault frame did not go through, and close only
   * connections that keep trying. Same shape as `#recusarSinal`.
   */
  #recusarCofre(
    connection: Connection,
    frame: { escopo: string; ref?: string | undefined },
    code: CodigoDeRecusaDoCofre,
    message: string,
    retryAfterMs: number | undefined,
    recusasAteFechar: number,
    agora: number,
  ): void {
    this.#metricasDoCofre.recusa(agora, code)
    this.#send(connection, {
      t: "cofre.rejected",
      escopo: frame.escopo,
      code,
      message,
      ...(frame.ref !== undefined ? { ref: frame.ref } : {}),
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    })
    if (!this.#dentroDoTecto("cofre-recusas", connection.id, recusasAteFechar)) {
      this.#metricasDoCofre.recusa(agora, CODIGO_COFRE_ABUSO)
      this.#send(connection, { t: "error", code: CODIGO_COFRE_ABUSO, message: "too many refused vault frames", fatal: true })
      connection.socket.close()
    }
  }

  // -------------------------------------------------------------------- SFU

  /**
   * Media frames per account per minute.
   *
   * The arithmetic, so the number is not arbitrary: joining a call that
   * already has sixteen people costs one `scope.join`, two
   * `transport.create`, two `transport.connect`, one `produce`, fifteen
   * `consume` and fifteen `resume`: thirty-six frames in a burst. And each
   * user who joins later costs two more for each of those already there.
   *
   * Three hundred leave room for about eight full joins into a full room per
   * minute, far more than a user does, and are still a cap: without it, an
   * automated client could spin up routers and transports at socket speed, and
   * each transport is memory in a subprocess shared with nobody else on this
   * machine. A cap against automation, not heavy use, like the rest of this
   * section.
   */
  static readonly SFU_POR_MINUTO = 300

  /** Connections by `id`, to find a stream's owner without scanning the set. */
  #porId = new Map<string, Connection>()

  /**
   * All frames `sfu.*`, with the two common guards in front.
   *
   * Guard order matters. **Engine first, then cap:** a server with no SFU must
   * always tell everyone "I do not route media", not "too many requests" on the
   * tenth try: that second answer sends people looking for the fault in the
   * wrong place, and makes them wait a minute for it.
   */
  async #sfu(connection: Connection, frame: FrameSfu): Promise<void> {
    const ref = "ref" in frame ? frame.ref : undefined
    const motor = this.#motor

    if (!motor || !motor.estaDePe()) {
      this.#recusarSfu(connection, "sem-sfu", "este servidor não encaminha media por um SFU", ref)
      return
    }

    if (!this.#dentroDoTecto("sfu", connection.address as string, Gateway.SFU_POR_MINUTO)) {
      this.#recusarSfu(connection, "demasiados-pedidos", "demasiados pedidos de media neste minuto", ref)
      return
    }

    try {
      await this.#despacharSfu(connection, frame, motor, ref)
    } catch (erro) {
      // An engine rejection reaches this point with its message intact. Anything
      // else is our own bug, and the client is not told what broke inside: we
      // say it failed, with a code that sets it apart from a legitimate rejection.
      if (erro instanceof RecusaDeMedia) this.#recusarSfu(connection, erro.codigo, erro.message, ref)
      else this.#recusarSfu(connection, "interno", "o motor de media não conseguiu atender o pedido", ref)
    }
  }

  async #despacharSfu(connection: Connection, frame: FrameSfu, motor: MotorDeMedia, ref: string | undefined): Promise<void> {
    switch (frame.t) {
      case "sfu.scope.join": {
        // **This line admits, not the SFU.** The engine has no membership model at
        // all: it does not know what a channel is, let alone who is in one. The
        // usual `#mayReach`, the same one that guards the history and the live
        // ciphertext, decides whether there is a call. Nobody produces or consumes
        // in a scope it would not grant.
        if (!this.#mayReach(connection, frame.channel)) {
          this.#recusarSfu(connection, "sem-lugar", "não tens lugar neste canal", ref)
          return
        }
        const chave = chaveDeAmbito(frame.channel, frame.scope)
        const { rtpCapabilities, produtores } = await motor.entrar(chave, connection.id)
        connection.sfu.set(chave, { channel: frame.channel, scope: frame.scope })
        this.#send(connection, {
          t: "sfu.scope.joined",
          channel: frame.channel,
          scope: frame.scope,
          rtpCapabilities,
          producers: produtores.flatMap((produtor) => {
            const dono = this.#porId.get(produtor.dono)?.address
            // A producer whose owner has no connection left is a dying stream.
            // Announcing it without an address would force the client into a case
            // it cannot handle; leaving it out is the truth: it is about to go.
            return dono ? [{ id: produtor.id, kind: produtor.kind, address: dono, fonte: produtor.fonte }] : []
          }),
          ...(ref !== undefined ? { ref } : {}),
        })
        return
      }

      case "sfu.scope.leave": {
        const chave = chaveDeAmbito(frame.channel, frame.scope)
        if (!connection.sfu.has(chave)) return
        const mortos = await motor.sairDoAmbito(connection.id, chave)
        connection.sfu.delete(chave)
        for (const produtor of mortos) {
          this.#anunciarNoAmbito(chave, { t: "sfu.producer.closed", channel: frame.channel, scope: frame.scope, producer: produtor }, connection)
        }
        return
      }

      case "sfu.transport.create": {
        if (!this.#mayReach(connection, frame.channel)) {
          this.#recusarSfu(connection, "sem-lugar", "não tens lugar neste canal", ref)
          return
        }
        const chave = chaveDeAmbito(frame.channel, frame.scope)
        if (!connection.sfu.has(chave)) {
          this.#recusarSfu(connection, "fora-da-chamada", "entra na chamada antes de pedir um transporte", ref)
          return
        }
        // No `as Sentido` on purpose: this way the compiler requires the
        // protocol enum and the engine type to say the same thing. With the cast,
        // a new direction in `wire.ts` that no one taught the engine would pass
        // through here silently and break in production.
        const parametros = await motor.criarTransporte(chave, connection.id, frame.direction)
        this.#send(connection, {
          t: "sfu.transport.created",
          transport: parametros.id,
          direction: frame.direction,
          iceParameters: parametros.iceParameters,
          iceCandidates: parametros.iceCandidates,
          dtlsParameters: parametros.dtlsParameters,
          ...(ref !== undefined ? { ref } : {}),
        })
        return
      }

      case "sfu.transport.connect": {
        // From here on, frames name a TRANSPORT, not a channel, and the guard
        // changes kind: the engine checks, and it knows a transport only by the
        // owner that created it. `#mayReach` already ran when the transport was
        // created, and running it again would add nothing: by design, this
        // server does not learn about removals (see `#isSeated`).
        await motor.ligarTransporte(connection.id, frame.transport, frame.dtlsParameters as never)
        this.#send(connection, { t: "sfu.transport.connected", transport: frame.transport, ...(ref !== undefined ? { ref } : {}) })
        return
      }

      case "sfu.produce": {
        const { id, ambito, fonte } = await motor.produzir(
          connection.id,
          frame.transport,
          frame.kind,
          frame.rtpParameters as never,
          frame.fonte,
        )
        this.#send(connection, { t: "sfu.produced", producer: id, ...(ref !== undefined ? { ref } : {}) })
        const par = connection.sfu.get(ambito)
        if (par) {
          this.#anunciarNoAmbito(
            ambito,
            // The source comes from the ENGINE, not the frame: a client that does not
            // declare it gets it inferred from the `kind` inside, and echoing what the
            // client wrote would leave the other side not knowing what to do with the stream.
            { t: "sfu.producer.new", channel: par.channel, scope: par.scope, producer: id, kind: frame.kind, address: connection.address as string, fonte },
            connection,
          )
        }
        return
      }

      /*
       * Stop sharing the screen, without leaving the call.
       *
       * Names a PRODUCER, not a channel, so the guard is the same as for the
       * other frames of this kind: the engine checks, and it knows a producer
       * only by the owner of the transport it was created on. Without that
       * check, an id picked up elsewhere would stop someone else's screen.
       */
      case "sfu.produce.close": {
        const { ambito: chave, fechados } = await motor.fecharProdutor(connection.id, frame.producer)
        this.#send(connection, { t: "sfu.produce.closed", producer: frame.producer, ...(ref !== undefined ? { ref } : {}) })
        const par = connection.sfu.get(chave)
        if (par) {
          // One announcement per closed producer: closing the screen video also
          // closes its audio, and listeners must learn that the same way.
          for (const producer of fechados) {
            this.#anunciarNoAmbito(
              chave,
              { t: "sfu.producer.closed", channel: par.channel, scope: par.scope, producer },
              connection,
            )
          }
        }
        return
      }

      case "sfu.consume": {
        const consumido = await motor.consumir(connection.id, frame.transport, frame.producer, frame.rtpCapabilities as never)
        this.#send(connection, {
          t: "sfu.consumed",
          consumer: consumido.id,
          producer: consumido.produtor,
          kind: consumido.kind,
          rtpParameters: consumido.rtpParameters,
          ...(ref !== undefined ? { ref } : {}),
        })
        return
      }

      case "sfu.resume": {
        await motor.retomar(connection.id, frame.transport, frame.consumer)
        this.#send(connection, { t: "sfu.resumed", consumer: frame.consumer, ...(ref !== undefined ? { ref } : {}) })
        return
      }

      /*
        The counterpart, and what makes "Stop viewing" save server bandwidth.
        Without it, a user who stopped viewing a screen closed the consumer on
        their side and the worker kept routing the video to a transport that no
        longer reads it.
        See `sfu.pause` in the protocol.
      */
      case "sfu.pause": {
        await motor.pausar(connection.id, frame.transport, frame.consumer)
        this.#send(connection, { t: "sfu.paused", consumer: frame.consumer, ...(ref !== undefined ? { ref } : {}) })
        return
      }
    }
  }

  /**
   * A viewer asks for a keyframe (Phase M2). See `sfu.keyframe` in the protocol.
   *
   * Outside `#sfu` on purpose: that bucket (`SFU_POR_MINUTO`) is for the
   * frames that set up the call, and image requests spending it would leave a
   * call join with no room. This one has its own, and EVERYTHING that goes
   * wrong here ends in silence: engine down, bucket full, a transport that is
   * not ours, the per-consumer cap. A rejection per image request would be one
   * reply per second to someone whose picture is already broken.
   */
  #pedirFotogramaChave(connection: Connection, frame: Extract<FrameSfu, { t: "sfu.keyframe" }>): void {
    const motor = this.#motor
    if (!motor || !motor.estaDePe()) return
    if (!this.#dentroDoTecto("sfu-keyframe", connection.address as string, Gateway.FOTOGRAMAS_CHAVE_POR_MINUTO)) return
    try {
      motor.pedirFotogramaChave(connection.id, frame.transport, frame.consumer)
    } catch {
      // Another connection's transport, or already closed: tell nobody anything.
    }
  }

  /**
   * How many `sfu.keyframe` an account can send per minute, across all its
   * consumers.
   *
   * The cap that matters is the engine's: one per second per consumer. This
   * one sits above it, per account: 240 covers four broken pictures at once,
   * each asking at the maximum rate, and stops a client that opens consumers
   * just to send requests.
   */
  static readonly FOTOGRAMAS_CHAVE_POR_MINUTO = 240

  #recusarSfu(connection: Connection, code: string, message: string, ref: string | undefined): void {
    this.#send(connection, { t: "sfu.error", code, message, ...(ref !== undefined ? { ref } : {}) })
  }

  /** Tell the others who are in this call, and only those. */
  #anunciarNoAmbito(chave: string, frame: ServerFrame, excepto: Connection): void {
    for (const outra of this.#connections) {
      if (outra === excepto || !outra.sfu.has(chave)) continue
      this.#send(outra, frame)
    }
  }

  /**
   * Drop everything a connection has in the engine, and tell the others.
   *
   * Called from `#drop`, the normal way out of a call, used far more than
   * `sfu.scope.leave` because a closed tab sends no frame. If this fails
   * silently, the others see the user in the call forever and the worker keeps
   * their transports.
   */
  async #largarMedia(connection: Connection): Promise<void> {
    const motor = this.#motor
    if (!motor) return
    const ambitos = new Map(connection.sfu)
    connection.sfu.clear()
    for (const { chave, produtores } of await motor.sair(connection.id)) {
      const par = ambitos.get(chave)
      if (!par) continue
      for (const produtor of produtores) {
        this.#anunciarNoAmbito(chave, { t: "sfu.producer.closed", channel: par.channel, scope: par.scope, producer: produtor }, connection)
      }
    }
  }

  // ------------------------------------------------------------------- auth

  /**
   * Challenge-response over the account signing key.
   *
   * No password to phish, no email to correlate, no reset flow to socially
   * engineer. The server stores a public key and a nonce it just generated;
   * neither is worth stealing.
   */
  #beginAuth(
    connection: Connection,
    address: string,
    signingKey: Uint8Array,
    chain?: { accountKey: Uint8Array; deviceCert: Uint8Array } | undefined,
  ): void {
    let parsed
    try {
      parsed = parseAddress(address)
    } catch {
      this.#send(connection, { t: "error", code: "bad-address", message: "malformed address", fatal: true })
      return
    }

    if (parsed.sigil !== "@" || parsed.server !== this.config.serverName) {
      this.#send(connection, { t: "error", code: "wrong-homeserver", message: "not our address", fatal: true })
      return
    }

    // Reject before issuing a challenge: the address is a hash of the key, so a
    // mismatch here means the client is asking us to sign off on someone else's
    // address. There is nothing to look up and nothing to trust.
    //
    // With the chain, the hash is the account key's and what `signingKey` proves is
    // possession of the device it certified. Without the chain, it is the
    // usual direct check: `signingKey` is the account key itself.
    const accountKey = chain ? chain.accountKey : signingKey
    if (accountIdFromSigningKey(accountKey) !== parsed.localPart) {
      this.#send(connection, { t: "error", code: "key-mismatch", message: "key does not match address", fatal: true })
      return
    }

    if (chain && !verifyDeviceChain({ address, accountKey, deviceKey: signingKey, signature: chain.deviceCert })) {
      this.#send(connection, { t: "error", code: "bad-device-cert", message: "device is not this account's", fatal: true })
      return
    }

    // A device the account removed from the manifest cannot log in, however
    // good its chain: the certificate does not expire, and the manifest says
    // who still speaks for the account. Before the challenge, like the other
    // rejections: there is nothing to prove. A device not yet in the manifest
    // gets in (the phone paired before `pronto`); only one that was in it and
    // was removed is rejected.
    // See `Store.isDeviceRevoked`.
    if (chain && this.store.isDeviceRevoked(address, signingKey)) {
      this.#fecharRevogado(connection)
      return
    }

    connection.address = null
    connection.challenge = crypto.getRandomValues(new Uint8Array(32))
    connection.pending = { address, signingKey, accountKey, comCadeia: chain !== undefined }
    this.#send(connection, { t: "auth.challenge", nonce: toBase64(connection.challenge) })
  }

  #finishAuth(connection: Connection, signature: string, posse: { posse: number; marca: string | undefined }): void {
    const pending = connection.pending
    const challenge = connection.challenge

    // Burn the challenge on first use, valid or not. A reusable nonce is a
    // replayable login.
    connection.challenge = null
    connection.pending = null

    if (!pending || !challenge) {
      this.#send(connection, { t: "error", code: "no-challenge", message: "call auth.begin first", fatal: true })
      return
    }

    if (!verify(pending.signingKey, challenge, fromBase64(signature))) {
      this.#send(connection, { t: "error", code: "bad-signature", message: "challenge not satisfied", fatal: true })
      return
    }

    // The account is the account key, and it stays bound to the address forever.
    // Changing devices cannot change the account: if it did, the address would
    // stop being a hash of a key and become a name stored next to it, which is
    // exactly what this system does not have.
    if (!this.store.registerOrVerifyAccount(pending.address, pending.accountKey)) {
      this.#send(connection, { t: "error", code: "address-taken", message: "address bound to another key", fatal: true })
      return
    }
    // Suspended (reports, §8): the signature is good, so we say why.
    // Before ownership and device registration: a suspended account writes nothing.
    if (this.store.estaSuspensa(pending.address)) {
      this.#fecharSuspensa(connection)
      return
    }
    /*
      Which copy of this device speaks for it (see `auth.finish` in the
      protocol). After the signature: bumping the generation takes ownership
      away from the other copy, and only a client that proved the key may ask.

      The copy that takes over closes the other connections with the same key
      at once, not on their next connect: with both connected, both would
      encrypt with the same ratchet. A copy arriving with a generation below the current one is
      treated as revoked (same code, which clients since 0.5.8 already show):
      from its point of view, it was removed from the account on another device.
    */
    let geracao = this.store.posseDoAparelho(pending.address, pending.signingKey)
    if (posse.marca !== undefined) {
      const assumida = this.store.assumirPosse(pending.address, pending.signingKey, posse.marca)
      geracao = assumida.geracao
      // The same mark again is the same copy with another connection: close nothing.
      if (assumida.subiu) for (const outra of this.#connections) {
        if (outra === connection || outra.address !== pending.address) continue
        // Only connections with a chain have a known device; a client without a
        // chain signs with the account key, and there is no device copy to compare.
        if (outra.deviceKey && toBase64(outra.deviceKey) === toBase64(pending.signingKey)) this.#fecharCopiaSubstituida(outra)
      }
    } else if (posse.posse < geracao) {
      this.#fecharCopiaSubstituida(connection)
      return
    }
    this.store.registerDevice(pending.address, pending.signingKey)

    connection.address = pending.address
    // With a chain, `signingKey` is the device key; without one it is the
    // account key, and the connection has no known device. See `Connection.deviceKey`.
    connection.deviceKey = pending.comCadeia ? pending.signingKey : null
    this.#send(connection, { t: "auth.ok", address: pending.address, posse: geracao })
    // The account's own vault version, right after `auth.ok`: it is the only
    // scope known before any subscription. See `cofre.versoes`.
    if (connection.cofreCifrado) {
      this.#send(connection, { t: "cofre.versoes", cofres: this.store.cofreVersoes([`conta:${pending.address}`]) })
    }

    // Per device: the pool that matters to this connection is its own. Counting
    // the whole account would tell a second device with zero that it has "twenty".
    const remaining = this.store.availableKeyPackages(pending.address, connection.deviceKey ?? undefined)
    if (remaining < 10) this.#send(connection, { t: "keypackage.low", remaining })

    // Invitations that arrived while this account was offline are NOT pushed
    // here: at this instant the client has not yet restored its vault, so it
    // holds no private key halves and every welcome would fail, and be
    // remembered as unopenable. It asks for them itself (welcome.resync) once
    // its keyring is loaded.
  }

  // ------------------------------------------------------------------ relay

  /**
   * ICE servers for a call, with a credential that expires.
   *
   * coturn's `use-auth-secret` mode: the username is `<expiry>:<anything>` and
   * the password is base64(HMAC-SHA1(secret, username)). The secret stays here.
   * A credential is good for `turnTtl` seconds: long enough to place a call,
   * short enough that a leaked one is worthless, which is the difference
   * between a relay for our users and an open proxy for the internet.
   *
   * Empty when no TURN is configured. The client then falls back to public STUN
   * and says so; it does not pretend the call will traverse.
   */
  #iceServers(forAddress: string | null): { urls: string[]; username?: string; credential?: string }[] {
    if (this.config.turnUrls.length === 0) return []

    const stun = this.config.turnUrls.filter((url) => url.startsWith("stun:"))
    const turn = this.config.turnUrls.filter((url) => !url.startsWith("stun:"))
    const servers: { urls: string[]; username?: string; credential?: string }[] = []
    if (stun.length > 0) servers.push({ urls: stun })
    if (turn.length > 0 && this.config.turnSecret) {
      const expiry = Math.floor(Date.now() / 1000) + this.config.turnTtl
      // The name must be unique per account. It was `<expiry>:orwell` for
      // everyone, and coturn quotas are PER USER: with a shared name, a
      // three-person call used up everyone's quota at once and the relay began
      // returning 486 to anyone who came later, including those already in the
      // call when they renegotiated. Symptom: "the third one joined and dropped,
      // and I could never hear them again".
      //
      // It carries the account id, which is already an opaque hash: it adds
      // nothing the server does not know, and tells nothing to anyone watching
      // the TURN traffic.
      const quem = (forAddress ?? "anon").replace(/^@/, "").split(":")[0]
      const username = `${expiry}:${quem}`
      const credential = createHmac("sha1", this.config.turnSecret).update(username).digest("base64")
      servers.push({ urls: turn, username, credential })
    }
    return servers
  }

  /**
   * How many previews an account can request per minute, and how many at the
   * same time.
   *
   * Without a cap, this is a traffic amplifier wearing our server's identity:
   * an account makes us hit someone else's site hundreds of times a second,
   * and the target sees our IP, not the account's. The cap is per account, not
   * per connection: counting per connection would invite opening ten.
   */
  static readonly PREVIEWS_PER_MINUTE = 20
  static readonly PREVIEWS_AT_ONCE = 2

  /** Timestamps of recent requests, per account. Memory only, and only the current minute. */
  #previewHits = new Map<string, number[]>()
  #previewInFlight = new Map<string, number>()

  /**
   * Caps per account per minute, on the same pattern as `#previewHits` above.
   *
   * Every frame counted here leaves a PERMANENT mark in the database at the
   * sender's request (a subscription, a claim, an invite, a key package), and
   * none of them had a cap. An audit filled the tables from a single account
   * with no effort at all.
   *
   * None of these numbers is reachable by a user using the product: the
   * client subscribes once per connection, publishes twenty key packages when
   * it runs out, and creates invites one at a time. These are caps against
   * automation, not heavy use.
   *
   * What this does NOT cover: `channel_activity` still grows by one row per
   * channel ever used, and is deliberately never cleaned: that mark is what
   * stops a private room whose events retention deleted from looking freshly
   * created again (see `channelNeverUsed`). What bounds it is the cap on first
   * uses, not a sweeper.
   */
  /**
   * Content frames per account and per minute.
   *
   * `channel.send` was the only frame that wrote to the database with no cap
   * at all, and it writes the most: each one stores a row in `events` with up
   * to `MAX_FRAME_BYTES` of ciphertext, and triggers federated forwarding to
   * peers. An account with a seat could fill the database at socket speed.
   *
   * Six hundred per minute is ten per second, sustained. A fast typist does
   * two or three; a voice call does more, because signaling goes through here:
   * joining an eight-person call is a few dozen frames in a burst, which is
   * why the number is not sixty like the others. A cap against automation,
   * not heavy use, like the rest of this section.
   */
  static readonly ENVIOS_POR_MINUTO = 600

  /**
   * Commits and Welcomes per account per minute, in a bucket separate from
   * messages.
   *
   * An admission costs a commit and a Welcome; a removal, one commit. A
   * hundred and twenty per minute is sixty admissions, far above what a user
   * or a full common room does, and still a cap against automation. Separate so
   * that sync never delays a removal (S6 review).
   */
  static readonly ENVIOS_HANDSHAKE_POR_MINUTO = 120

  /**
   * Rate rejections per CONNECTION per minute before it is closed.
   *
   * A client that announces `envio-recusado` stops at the first rejection and
   * drops to one send at a time; the burst already on the wire when the
   * rejection arrived is all that can be rejected next, and that is a few
   * dozen. A client that ignores the rejection and keeps sending is using the
   * server as a punching bag: each rejection is work plus a frame back. Above
   * this, a fatal `error` and close, as for signals (`sinal-recusas`).
   */
  static readonly ENVIO_RECUSAS_ATE_FECHAR = 300

  /**
   * History requests per account and per minute.
   *
   * Each one reads from the database and returns up to a limit of events; it
   * writes nothing, but reads a lot, and it is the way to download a whole
   * channel over and over. Sixty is one reconciliation per second, far above
   * what a client does: it asks on connect and when coming back online.
   */
  static readonly BACKFILLS_POR_MINUTO = 60

  /**
   * The three frames that only READ, and so went unnoticed.
   *
   * None of them stores anything, which is why they were left out when the
   * caps went in: the criterion then was "leaves a mark in the database". The
   * criterion was wrong: what an account with a seat can do with no cap is
   * hog the process, and this server is a single process.
   *
   * - `welcome.resync` reads up to two hundred pending invites and writes them
   *   all to the socket. Repeated at network speed, it is the most expensive
   *   frame here: a query with `ORDER BY` on the events table and up to two
   *   hundred outgoing messages per request.
   * - `ice.servers` is a TURN credential factory: each request signs a new HMAC
   *   with the coturn secret and returns a credential valid for `turnTtl`.
   *   Without a cap, an account harvests thousands in a minute and hands them
   *   to anyone: the relay pays for the traffic.
   * - `directory.list` returns, in community mode, ALL local accounts. It is
   *   the whole list of who lives here, in one frame, with no repeat limit.
   *
   * Sixty per minute, like the other read buckets: the client asks for the
   * resync once per connection, for the ICE servers when joining a call, and
   * for the directory when opening the people screen. No number here is
   * reachable by a user using the product.
   */
  static readonly RESYNCS_POR_MINUTO = 60
  static readonly ICE_POR_MINUTO = 60
  static readonly DIRECTORIOS_POR_MINUTO = 60
  /**
   * Device manifests, published or requested, per account per minute.
   *
   * One bucket for both, sixty like the other read buckets: a client fetches
   * its own on connect, publishes it once in the account's life, and fetches
   * the manifest of each person it invites. Publishing costs a signature check
   * and a write; fetching costs a one-row read. Neither is reachable by a user
   * using the product.
   */
  static readonly MANIFESTOS_POR_MINUTO = 60

  static readonly ESTREIAS_POR_MINUTO = 60
  /**
   * Entry cards taken per account per minute.
   *
   * Low on purpose. Each take deletes the card, so asking for it in a loop is
   * how to keep the room without a door and everyone locked out. A legitimate
   * join uses one; the client's retries use another every two minutes at worst.
   */
  static readonly CARTOES_POR_MINUTO = 6
  /**
   * How long the temporary seat of a client that took the card lasts (INV-01).
   * The client builds the external commit right after `take`, in under a
   * second; two minutes leave slack for a slow machine and a bad network.
   */
  static LUGAR_TEMPORARIO_MS = 2 * 60_000
  static readonly SUBSCRICOES_POR_MINUTO = 60
  static readonly CONVITES_POR_MINUTO = 30
  /**
   * Short code resolutions per account per minute. A user opens one link,
   * maybe two; twelve leaves slack for pasting several in a row.
   */
  static readonly RESOLUCOES_POR_MINUTO = 12
  /**
   * And for the whole server, across all accounts. The cap's arithmetic: with
   * a thousand live invites, hitting a code at random takes 31^8 / 1000 tries
   * on average, close to 850 million; at 600 per minute that is over two and a
   * half years non-stop. The price, stated: a sweeper uses up everyone's cap,
   * and someone with a real link gets `rate-limited` that minute and tries the
   * next. The long link does not go through here and keeps working.
   */
  static readonly RESOLUCOES_DO_SERVIDOR_POR_MINUTO = 600
  static readonly KEYPACKAGES_POR_MINUTO = 30
  /**
   * The caps of `invite.redeem` (INV-02, external audit of 1.1.0).
   *
   * Each redeem spends a use, writes to the database and is broadcast to all
   * connected members of the channel, and it had no cap. A user redeems one
   * link, maybe two; twelve per account, the same cap as resolutions. Per
   * invite, thirty accounts per minute: a link shared in a big group, opened
   * all at once. Per channel, sixty, across all its invites. For the whole
   * server, six hundred, like resolutions: accounts are made in an instant,
   * and a per-account cap alone would multiply by their number. Above any of
   * them, `invite.rejected` `rate-limited`, without spending the use.
   *
   * Not `readonly` only so tests can lower and restore it.
   */
  static RESGATES_POR_MINUTO = 12
  static RESGATES_POR_CONVITE_POR_MINUTO = 30
  static RESGATES_POR_CANAL_POR_MINUTO = 60
  static RESGATES_DO_SERVIDOR_POR_MINUTO = 600
  /**
   * How long an admission request stays pending (INV-01, INV-02). Memory only,
   * and only to avoid broadcasting the same request twice: the seat comes from
   * the Welcome, never from here. Ten minutes, like the pairing box deadline:
   * time for someone in the channel to see the request.
   */
  static PENDENTE_MS = 10 * 60_000
  /** Live pending requests across the whole process. Above this, the oldest go. */
  static readonly PENDENTES_MAXIMO = 10_000
  /**
   * The cap on each connection's outgoing queue, in bytes (INV-02).
   *
   * `#send` used to write without checking `bufferedAmount`: a connection that
   * does not read (a stuck network, a hostile client that stops reading on
   * purpose) made the server hold in memory everything the channel said.
   * Above the cap the connection is dropped at once (`terminate`, because a
   * `close` would wait behind the queue), and counted in `metricasDosEnvios`.
   *
   * The policy, and why it breaks nothing: the queue is only measured BEFORE
   * each write, so a single large frame (a history page, a post with a photo)
   * always goes through; a dropped client reconnects and catches up from the
   * history, fetched page by page at its own pace; and call media does not go
   * through here (it uses WebRTC), so a call only drops for someone who stopped
   * reading the signaling 64 MiB ago. That is five max-size frames waiting.
   */
  static FILA_MAXIMA_BYTES = 64 * 1024 * 1024
  /**
   * Unused key packages an account can have waiting.
   *
   * The client keeps twenty and goes up to forty before refilling. Five
   * hundred is ample slack for any honest variant and a hard cap for the rest,
   * and `replace: true`, which deletes the old ones, still always gets
   * through: a client whose stock somehow filled up recovers by itself on its
   * next connect.
   */
  static readonly KEYPACKAGES_EM_ESPERA = 500

  #tectos = new Map<string, number[]>()

  /**
   * A send over the cap: rejected, and the sender is told. Never silent.
   *
   * Until 21/10/2026 it was a silent `return`. The client recorded the send as
   * done, nobody received it, and whatever followed in the same minute was
   * dropped too, anti-entropy reports included: 1,800 sends in a row from one
   * account left 45 % of the likes and all the votes undelivered, and a client
   * asking for what was missing got silence back and gave up after three
   * requests (S6 of absolute sync, `sincronia-ritmo.test.ts`).
   *
   * To a client that announced `CAPACIDADE_ENVIO_RECUSADO`: `channel.rejected`
   * with `rate-limited`, the `ref` and when there will be room. The client
   * retries. To an old client: an `error` with code `rate-limited`, which it
   * logs to diagnostics and does not read as losing its seat (an unknown
   * `channel.rejected` told it "this room no longer exists").
   */
  #recusarEnvioPorRitmo(
    connection: Connection,
    frame: { channel: string; ref?: string | undefined },
    balde: "envios" | "envios-handshake",
    tecto: number,
  ): void {
    // Already closing: frames still in flight do not count again.
    if (connection.socket.readyState !== 1) return
    const agora = Date.now()
    this.#metricasDosEnvios.recusa(agora, balde)
    // A client that does not back off: the connection is closed and counted (S6 review).
    if (!this.#dentroDoTecto("envio-recusas", connection.id, Gateway.ENVIO_RECUSAS_ATE_FECHAR)) {
      this.#metricasDosEnvios.fecho(agora)
      this.#send(connection, { t: "error", code: "rate-abuse", message: "too many refused sends", fatal: true })
      connection.socket.close()
      return
    }
    const recentes = this.#tectos.get(`${balde}|${connection.address as string}`) ?? []
    const maisAntigo = recentes[0] ?? agora
    const retryAfterMs = Math.max(1, maisAntigo + 60_000 - agora)
    if (connection.envioRecusado) {
      this.#send(connection, {
        t: "channel.rejected",
        channel: frame.channel,
        reason: "rate-limited",
        retryAfterMs,
        ...(frame.ref !== undefined ? { ref: frame.ref } : {}),
      })
      return
    }
    this.#send(connection, {
      t: "error",
      code: "rate-limited",
      message: `more than ${tecto} sends per minute; this one was not stored (retry in ${retryAfterMs} ms)`,
      fatal: false,
    })
  }

  /**
   * Spend one unit of the cap, or say there is none left.
   *
   * @returns `false` when the account went over this bucket's cap this minute.
   */
  #dentroDoTecto(balde: string, quem: string, porMinuto: number): boolean {
    const agora = Date.now()
    const chave = `${balde}|${quem}`
    const recentes = (this.#tectos.get(chave) ?? []).filter((carimbo) => agora - carimbo < 60_000)
    this.#tectos.set(chave, recentes)
    if (recentes.length >= porMinuto) return false
    recentes.push(agora)
    // A map that only grows is a memory leak by another name: one entry per
    // account per bucket, for the life of the process. Cleanup costs one pass
    // and runs only when the map is already large.
    if (this.#tectos.size > 4096) {
      for (const [outra, carimbos] of this.#tectos) {
        if (carimbos.length === 0 || agora - (carimbos[carimbos.length - 1] as number) >= 60_000) {
          this.#tectos.delete(outra)
        }
      }
    }
    return true
  }

  /**
   * Fetch what the page says about itself, at the poster's request.
   *
   * What does NOT happen here matters as much as what does: nothing records
   * which address was requested, or by whom. Storing that would rebuild, on
   * the server, the reading log the whole product exists not to have, and
   * Fastify's `logger` is off for the same reason.
   *
   * The rejection is always the same message. Telling "private address" from "did
   * not resolve" from "took too long" would hand back, to whoever asked the
   * right way, a map of the internal network drawn from outside.
   */
  async #previewLink(connection: Connection, url: string): Promise<void> {
    const quem = connection.address
    if (!quem) return

    const agora = Date.now()
    const recentes = (this.#previewHits.get(quem) ?? []).filter((carimbo) => agora - carimbo < 60_000)
    const emCurso = this.#previewInFlight.get(quem) ?? 0
    if (recentes.length >= Gateway.PREVIEWS_PER_MINUTE || emCurso >= Gateway.PREVIEWS_AT_ONCE) {
      this.#send(connection, { t: "link.preview.result", url, ok: false, reason: "demasiados pedidos" })
      return
    }
    recentes.push(agora)
    this.#previewHits.set(quem, recentes)
    this.#previewInFlight.set(quem, emCurso + 1)

    try {
      const preview = await fetchLinkPreview(url)
      this.#send(connection, { t: "link.preview.result", url, ok: true, ...preview })
    } catch {
      this.#send(connection, { t: "link.preview.result", url, ok: false, reason: "não foi possível ler a página" })
    } finally {
      const restantes = (this.#previewInFlight.get(quem) ?? 1) - 1
      if (restantes <= 0) this.#previewInFlight.delete(quem)
      else this.#previewInFlight.set(quem, restantes)
    }
  }

  /**
   * Evidence that this account was seated in this channel by SOME path.
   *
   * This server cannot read the MLS ratchet tree, so it cannot decide true
   * membership; that lives in the group and no server can be trusted with it.
   * What it CAN do is stop an account that was never admitted by any path from
   * reading, writing or administering a channel, which is the whole distance
   * between "anyone who can guess an address" and "someone who was let in once".
   *
   * Registration here is open and instant, so before this existed "authenticated
   * account" meant "anybody at all": any account could subscribe to
   * `!feed-<someone>` (the 0.9 feed, derived from a public address), pull
   * thirty days of their ciphertext, watch their presence, forge handshakes into their feed, and
   * revoke their invites.
   */
  /**
   * What this does NOT know, and will not come to know: roles, and removals.
   *
   * A channel's roles (who can remove, invite, rename, move) travel encrypted
   * like any other message, and each client applies them from the group
   * state. This server does not read them, and that is what stops a
   * compromised server from promoting itself to admin of anything.
   *
   * The honest consequence: when someone is removed from an MLS group, this
   * server does not find out. Their subscription stays up, they keep
   * receiving ciphertext they can no longer decrypt, and they can still write
   * frames to the channel that nobody else can open; a run of those makes
   * every member declare the channel deaf, which triggers the repair that
   * deletes history for forward secrecy. It is the same weakness the threat
   * model describes for the common room, for the same reason.
   *
   * Closing it from here would need a frame telling the server to stop
   * serving an account in a channel, and that frame does not exist on
   * purpose: not knowing who administers, the server would have to accept it
   * from any member, giving everyone the power to cut everyone out of the
   * channel's routing, permanently and with no appeal. A weapon that kills the
   * channel for all, to cover a risk the crypto already reduced to noise. What
   * protects against a removed member is the advanced epoch, not this server.
   */
  /** Pending admission requests, keyed by `chaveDoPendente`. See `PENDENTE_MS`. */
  #pendentes = new Map<string, { ate: number; ouviram: number }>()

  #pendenteDe(canal: string, quem: string): { ate: number; ouviram: number } | undefined {
    const chave = chaveDoPendente(canal, quem)
    const pendente = this.#pendentes.get(chave)
    if (pendente && Date.now() > pendente.ate) {
      this.#pendentes.delete(chave)
      return undefined
    }
    return pendente
  }

  #guardarPendente(canal: string, quem: string, ouviram: number): void {
    const agora = Date.now()
    const chave = chaveDoPendente(canal, quem)
    this.#pendentes.delete(chave)
    this.#pendentes.set(chave, { ate: agora + Gateway.PENDENTE_MS, ouviram })
    if (this.#pendentes.size <= Gateway.PENDENTES_MAXIMO) return
    for (const [outra, pendente] of this.#pendentes) if (agora > pendente.ate) this.#pendentes.delete(outra)
    // Still full: the oldest go (the Map keeps insertion order).
    for (const outra of this.#pendentes.keys()) {
      if (this.#pendentes.size <= Gateway.PENDENTES_MAXIMO) break
      this.#pendentes.delete(outra)
    }
  }

  /** Does this connection hold an unexpired temporary seat in this channel? Expired ones are removed here. */
  #temLugarTemporario(connection: Connection, channel: string): boolean {
    const ate = connection.lugaresTemporarios.get(channel)
    if (ate === undefined) return false
    if (Date.now() <= ate) return true
    connection.lugaresTemporarios.delete(channel)
    return false
  }

  #isSeated(connection: Connection, channel: string): boolean {
    const address = connection.address
    if (!address) return false
    if (connection.channels.has(channel)) return true
    // No name grants a seat: in 0.9 the owner had a seat in `!feed-<id>` just
    // because the name was theirs. The opaque wall of 1.0 belongs to its owner
    // because they claimed it first, and from then on through the subscription.
    if (this.store.isSubscribed(channel, address)) return true
    return this.store.hasWelcomeFor(channel, address)
  }

  /**
   * May this account be the FIRST to use this channel?
   *
   * The leeway for a never-used channel exists for its creator: between "I
   * made this room" and "I said something in it" there is nothing here, and
   * refusing that moment would close a hole that does not exist. What was
   * missing was tying it to an identity.
   *
   * Without that, "not used yet" was enough, and since the 0.9 `!feed-<id>`
   * and `!dm-<a>.<b>` were computed from public addresses, any authenticated
   * account could reach anyone's feed or conversation BEFORE its first use
   * and stay seated forever, because the subscription is stored. Measured with
   * real requests: live ciphertext, backfill, presence, and forged frames in
   * someone else's channel, which makes every member declare the channel deaf
   * and takes the history with the repair. It is the same shape of hole that
   * `#isSeated` closed, coming in through another door.
   *
   * The anchor, in 1.0:
   * - an opaque address (`eMoradaOpaca`), whether DM, wall, account or room:
   *   whoever claimed it. This is the arbitration that `channel.claim` already does, and
   *   the first to ask gets it: exactly what channel creation needs. The address
   *   names no one and cannot be guessed, and that is what replaces the 0.9 name
   *   guards (the owner of `!feed-`, both sides of `!dm-`).
   * - the common room: the same arbitration, by the address that `hello` announces.
   * - an old form is never first used, by anyone. See `#formaFechada`.
   */
  /**
   * Is this channel in a form that can no longer be opened?
   *
   * Anything that is neither an opaque address nor the common room: the 0.9
   * `!dm-a.b`, `!feed-x`, `!self-x` and `!<nome>`. Closing them stops the
   * name from granting a seat again (and from revealing who talks to whom).
   * The common room is left out because it is a single case, with the address
   * the server announces in `hello`, chosen by the operator. This closes first
   * use and removes nobody: that is why the cutover wipes the database, so no
   * old subscription survives.
   */
  #formaFechada(channel: string): boolean {
    // The same rule the core uses to reject before asking.
    return !podeEstrearCanal(channel, this.config.commonRoom)
  }

  #mayOpen(address: string, channel: string): boolean {
    if (!this.store.channelNeverUsed(channel)) return false
    if (this.#formaFechada(channel)) return false
    return this.store.claimChannel(channel, address) === address
  }

  /**
   * May this account read, write or subscribe here?
   *
   * Seated, or this account is the one entitled to open a channel that has
   * never been used — see `#mayOpen`, which is where "brand new" stopped being
   * the whole of the answer.
   *
   * "Brand new" means never used, not merely empty — see `channelNeverUsed`.
   * Retention deletes events, so "empty" alone handed a month-old silence the
   * same tolerance as a room created a second ago.
   */
  #mayReach(connection: Connection, channel: string): boolean {
    if (this.#isSeated(connection, channel)) return true
    if (!connection.address) return false
    // The cap comes before the decision because the decision leaves a mark:
    // first use of a channel stores a subscription or a claim, at the request
    // of someone with no seat anywhere yet. See `#dentroDoTecto`.
    if (!this.#dentroDoTecto("estreias", connection.address, Gateway.ESTREIAS_POR_MINUTO)) return false
    return this.#mayOpen(connection.address, channel)
  }

  /**
   * May this account ASK the members of this channel to let it in?
   *
   * Wider than `#mayReach`, and only by the common room, which is the whole of
   * the decision taken about it. Without this there was a closed circle: to ask
   * for a seat you had to be reachable, and to be reachable you had to already
   * have one. Whoever arrived after the room existed stayed out for ever, in
   * silence: the request left the client and died here.
   *
   * Note what this opens and what it does not. It carries a request to the
   * members, who are the only ones who can admit anybody, and it stops there.
   * It does NOT hand over the room's ciphertext, its invite codes, its live
   * traffic, or the presence of everyone connected to this server: the first
   * version of this exception did all four, because the request and the reading
   * went through the same guard. Nor could it be narrowed by frame type alone:
   * a permitted `channel.subscribe` writes a subscription row, and that row is
   * itself evidence of a seat, so the exception would have laundered itself
   * into full access on the very next frame.
   */
  /** Is this the channel that this server announces as common? One question, one place. */
  #ehSalaComum(channel: string): boolean {
    return ehSalaComum(this.config, channel)
  }

  #mayAsk(connection: Connection, channel: string): boolean {
    if (!connection.address) return false
    if (this.config.commonRoom && channel === this.config.commonRoom) return true
    return this.#mayReach(connection, channel)
  }

  /** The guarantee `hello` must carry for this connection to be allowed to commit. */
  static readonly COMMIT_DEPOIS_DO_ECO = "commit-after-echo"

  /**
   * Can this connection send commits and cards?
   *
   * Only if `hello` said `commit-after-echo`. Clients before 13/9/2026
   * (bundle `eabfd6c`) apply their commit BEFORE sending it: when they lose the
   * race for the epoch they are left alone in E+1, and the next commit or card
   * they publish comes from that branch. Accepting any of them made the server
   * follow one user's branch and locked the room for everyone.
   *
   * No Welcomes either: the old bundle sends them right after the commit that
   * did not get in, and whoever accepted one ended up on that tab's branch
   * (see `#relay`).
   *
   * **All silent, with no `channel.rejected`.** `eabfd6c` does not tell
   * rejection reasons apart: any rejection fails the sends awaiting a receipt
   * on that channel (including `leaveChannel`, which was delivered) and shows
   * "Esta sala já não existe… sai da sala e pede para te convidarem outra vez"
   * (session.ts:7075-7101 of that commit). Since the card is published by
   * itself on every epoch, every old tab would get that advice right after the
   * deploy. A commit with no echo, on the other hand, does nothing to it:
   * commits go out without awaiting a receipt (`#markOwn`, :2092-2099, and
   * :1964, :4305, :5201, :6474), the reference sits in a set capped at 512,
   * and there is no retry or loop. What makes it update is the new-version
   * notice (`version-watch.ts`, every three minutes and on returning to the tab).
   *
   * Nothing else goes through here: messages, proposals, history and calls
   * keep working for those who have not updated yet.
   */
  #confiavelParaCommits(connection: Connection): boolean {
    return connection.commitDepoisDoEco
  }

  async #relay(
    connection: Connection,
    frame: { channel: string; kind: "application" | "handshake" | "welcome"; ciphertext: string; recipient?: string | undefined; ref?: string | undefined },
  ): Promise<void> {
    // Writing into a channel you were never admitted to is how three frames of
    // rubbish make every member declare it deaf, cascade into reseats, and take
    // the history with them by forward secrecy.
    //
    // The rejection stays; the silence goes. A client writing to a channel
    // where it has no seat is told so, instead of talking into the void with
    // everything looking fine on its side.
    const sentado = this.#mayReach(connection, frame.channel)
    const ciphertext = fromBase64(frame.ciphertext)
    // A temporary seat (the card that was taken) only lets that card's external
    // commit out. See `Connection.lugaresTemporarios`.
    const commitDoCartao =
      frame.kind === "handshake" &&
      this.#temLugarTemporario(connection, frame.channel) &&
      ehCommitExterno(ciphertext, frame.channel)
    const entradaPeloCartao = !sentado && commitDoCartao
    if (!sentado && !entradaPeloCartao) {
      this.#send(connection, { t: "channel.rejected", channel: frame.channel, reason: "no-seat" })
      return
    }

    // Not the Welcome either. The old bundle sends the commit and the Welcome
    // back to back, without waiting for a verdict: the commit is left out, and
    // the Welcome, once delivered, made the invitee swap the group for the E+1
    // branch only that tab has, and silently go deaf, because the real
    // messages, in epoch E, count for them as older than their seat. It is
    // neither stored nor delivered.
    if (frame.kind === "welcome" && !this.#confiavelParaCommits(connection)) return

    // No commit either, whatever `kind` it declares (the client hands MLS
    // everything that is not a Welcome). Dropped before touching the database,
    // and SILENTLY: see `#confiavelParaCommits` for why.
    if (frame.kind !== "welcome" && !this.#confiavelParaCommits(connection) && ehCommit(ciphertext)) return

    const guardado = this.store.appendEvent(
      { channel: frame.channel, kind: frame.kind, ciphertext, recipient: frame.recipient },
      /*
        Live, no epoch 0 commit restarts a channel. In 0.9 the name gave that
        right to the owner of `!feed-x` and to both sides of `!dm-a.b`; an
        opaque address names nobody, and the server cannot tell a DM from a
        room. Allowing the channel's creator to re-found it would also allow a
        room's creator, who could break it for everyone with an epoch 0 commit.
        A client that lost the group asks for a seat
        (`channel.rejoin.request`, slice 3); a locked channel is unlocked with
        `scripts/destrancar-canal.mjs`.
      */
      { refundavel: false },
    )

    // A commit for an epoch the channel has already left: reported only to its
    // sender, with its `ref` and the channel's current epoch. Not stored, not
    // broadcast, not federated: reaching another member would hand it a choice
    // between two futures for the group. See `Store.appendEvent`.
    if (!guardado.ok && guardado.reason === "recipient-not-welcome") {
      // A malformed frame, not a channel rejection: there is no contract for
      // this because no client sends it. Same error as an unparseable frame,
      // and the connection stays open.
      this.#send(connection, {
        t: "error",
        code: "bad-frame",
        message: "recipient is only for welcome",
        fatal: false,
      })
      return
    }
    if (!guardado.ok) {
      this.#send(connection, {
        t: "channel.rejected",
        channel: frame.channel,
        reason: guardado.reason,
        epoch: guardado.epoch,
        ...(frame.ref !== undefined ? { ref: frame.ref } : {}),
      })
      return
    }
    const stored = guardado.event
    // The addressed Welcome is the admission: that account's pending request is done.
    if (frame.kind === "welcome" && frame.recipient !== undefined) this.#pendentes.delete(chaveDoPendente(frame.channel, frame.recipient))
    /*
      The external commit was accepted as THE commit of the epoch: it is the
      proof of entry to the common room, and only here does the temporary seat
      become a subscription. Before the echo, so the echo reaches it the usual
      way.

      Also when the account was ALREADY seated (sala-comum-resync, 5/11/2026):
      the subscription is per account and survives a device change, so `#relay`
      let the commit through as a member's, without putting THIS connection in
      the channel. The echo went only to `connection.channels`, the author never
      saw it, and after ten seconds gave the commit up for lost and went back to
      the card, once a minute, each round accepted and the room's epoch going
      up. A client that just came in by the card is in the channel, wherever
      the authorization came from.
    */
    if (commitDoCartao) {
      connection.lugaresTemporarios.delete(frame.channel)
      connection.channels.add(frame.channel)
      this.store.subscribe(frame.channel, connection.address as string)
    }
    if (frame.kind === "application" && !guardado.repetido) this.#metricasDoDisco.guardado(Date.now(), frame.channel, ciphertext.length)

    // A resend of a commit already accepted: the echo was lost when a socket
    // dropped. The author gets the echo it missed: the original event, with
    // this send's `ref`, because that is the one it waits for. The others
    // already had it, and so did the peers.
    if (guardado.repetido) {
      this.#send(connection, {
        t: "channel.event",
        channel: stored.channel,
        seq: stored.seq,
        kind: stored.kind as "application" | "handshake" | "welcome",
        ciphertext: stored.ciphertext,
        receivedAtMinute: stored.receivedAtMinute,
        ...(frame.ref !== undefined ? { ref: frame.ref } : {}),
      })
      return
    }

    const eco: ServerFrame = {
      t: "channel.event",
      channel: stored.channel,
      seq: stored.seq,
      kind: stored.kind as "application" | "handshake" | "welcome",
      ciphertext: stored.ciphertext,
      receivedAtMinute: stored.receivedAtMinute,
      ...(frame.ref !== undefined ? { ref: frame.ref } : {}),
    }
    this.broadcast(frame.channel, eco, frame.recipient)
    /*
      The echo is the verdict, and the sender must get it, never silence.

      `broadcast` delivers to connections in `connection.channels`, and a
      connection can be seated (the account's durable subscription, a Welcome)
      without being there: a device that has not subscribed to the channel on
      this connection yet. The send was accepted and broadcast to the others;
      the author was left without the only answer it waits for. The addressed
      Welcome still gets no echo, as always.
    */
    if (frame.recipient === undefined && !connection.channels.has(frame.channel)) this.#send(connection, eco)

    await this.#federation?.fanOut(frame.channel, {
      channel: frame.channel,
      kind: frame.kind,
      ciphertext: frame.ciphertext,
      ...(frame.recipient !== undefined ? { recipient: frame.recipient } : {}),
    })
  }

  /**
   * Deliver to every locally-connected subscriber, or to one named recipient.
   *
   * A directed frame (in practice a Welcome) deliberately ignores the
   * subscription check. An invitation is precisely the message that arrives for
   * a channel you are not yet part of, so requiring a prior subscription would
   * make it impossible to ever be invited to anything.
   */
  /** @returns how many connections received it. See `channel.rejoin.sent`. */
  broadcast(channel: string, message: ServerFrame, recipient?: string | undefined): number {
    let servidas = 0
    for (const connection of this.#connections) {
      if (!connection.address) continue

      if (recipient) {
        if (connection.address !== recipient) continue
      } else if (!connection.channels.has(channel)) {
        continue
      }

      servidas += 1
      this.#send(connection, message)
    }
    return servidas
  }

  async #claimKeyPackage(connection: Connection, address: string, bundle: boolean, devices: string[] | undefined): Promise<void> {
    // A claim is ALWAYS answered. A malformed address or an unreachable
    // federation peer used to throw out of this handler, the reply never
    // left, and the client's waiter sat out its timeout as "tempo esgotado".
    // An unanswerable claim and an empty pool are the same truth to the
    // asker: no key package for that address.
    //
    // Without `bundle`, the reply is the usual one and spends one key package:
    // `keyPackages` and `manifest` are not sent, not even empty. The bundle is
    // requested, never offered (`CAPACIDADE_BUNDLE`). With `bundle`, the
    // singular is the bundle's first entry, or the unknown-device one that
    // `claimBundle` served in its place, so a reader that only knows the
    // singular still gets a key package.
    let resposta: Extract<ServerFrame, { t: "keypackage.claimed" }> = { t: "keypackage.claimed", address, keyPackage: null }
    try {
      const home = parseAddress(address).server
      if (home === this.config.serverName) {
        // A suspended account cannot be invited (reports, §8): the reply is that
        // of an empty pool, and nothing is spent.
        if (this.store.estaSuspensa(address)) {
          resposta = { t: "keypackage.claimed", address, keyPackage: null, ...(bundle ? { keyPackages: [], manifest: null } : {}) }
        } else if (bundle) {
          const { manifest, packages, fallback } = this.store.claimBundle(address, devices)
          const keyPackages = packages.map((p) => ({ deviceKey: p.deviceKey, keyPackage: toBase64(p.keyPackage) }))
          const singular = keyPackages[0]?.keyPackage ?? (fallback ? toBase64(fallback) : null)
          resposta = { t: "keypackage.claimed", address, keyPackage: singular, keyPackages, manifest }
        } else {
          const claimed = this.store.claimKeyPackage(address)
          resposta = { t: "keypackage.claimed", address, keyPackage: claimed ? toBase64(claimed) : null }
        }
      } else if (this.#federation) {
        const remoto = await this.#federation.claimRemote(address, home, bundle ? { bundle, devices } : undefined)
        if (remoto) {
          resposta = {
            t: "keypackage.claimed",
            address,
            keyPackage: remoto.keyPackage,
            // A 0.2.3 peer replies with the singular only: the bundle goes out
            // empty and the manifest `null`, meaning "there is nothing more".
            ...(bundle ? { keyPackages: remoto.keyPackages ?? [], manifest: remoto.manifest ?? null } : {}),
          }
        }
      }
    } catch {
      resposta = { t: "keypackage.claimed", address, keyPackage: null }
    }

    this.#send(connection, resposta)
  }

  /**
   * Close a connection from a revoked device, with the reason stated.
   *
   * Its own code (`device-revoked`), not `bad-device-cert`: the chain is
   * fine, and what the user needs to know is something else (this device was
   * removed from the account on another device). A 0.5.7 client handles any fatal code the same way,
   * so the new code does not break it.
   */
  #fecharRevogado(connection: Connection): void {
    this.#send(connection, { t: "error", code: "device-revoked", message: "this device was removed from the account", fatal: true })
    connection.socket.close()
  }

  /**
   * Close the connection of a suspended account (reports, §8). Fatal: the app
   * does not reconnect by itself, and reads the notice through the signed
   * request, which needs no session (`ROTAS_DA_DENUNCIA.suspensao`).
   */
  #fecharSuspensa(connection: Connection): void {
    this.#send(connection, { t: "error", code: "account-suspended", message: Gateway.FRASE_CONTA_SUSPENSA, fatal: true })
    connection.socket.close()
  }

  /**
   * Close suspended accounts' connections that are still open: those that send
   * no frame never hit the dispatch guard. Runs every minute (`app.ts`).
   * Returns how many it closed.
   */
  fecharSuspensas(): number {
    const suspensas = new Set(this.store.suspensas())
    if (suspensas.size === 0) return 0
    let fechadas = 0
    for (const connection of this.#connections) {
      if (connection.address === null || !suspensas.has(connection.address)) continue
      if (connection.socket.readyState !== 1) continue
      this.#fecharSuspensa(connection)
      fechadas += 1
    }
    return fechadas
  }

  /** A copy of this device that another copy, imported later, replaced. See `#finishAuth`. */
  #fecharCopiaSubstituida(connection: Connection): void {
    this.#send(connection, { t: "error", code: "device-revoked", message: "this copy of the device was replaced by an imported one", fatal: true })
    connection.socket.close()
  }

  /**
   * The guard on key package frames: a revoked device cannot use them.
   *
   * Login already rejects it, and `manifest.publish` closes its connections;
   * this is the third door, for a frame that slips in between the two (a
   * connection opened before the revocation, with frames in flight).
   */
  #recusarRevogado(connection: Connection): boolean {
    if (connection.deviceKey === null || connection.address === null) return false
    if (!this.store.isDeviceRevoked(connection.address, connection.deviceKey)) return false
    this.#fecharRevogado(connection)
    return true
  }

  #send(connection: Connection, frame: ServerFrame): void {
    this.#enviarTexto(connection, JSON.stringify(frame))
  }

  /**
   * Write to the socket, with the queue cap (INV-02). See `FILA_MAXIMA_BYTES`.
   *
   * All writes go through here, including those that serialize once for many
   * (`#sinal`, `#avisarVersaoDoCofre`).
   */
  #enviarTexto(connection: Connection, texto: string): void {
    const socket = connection.socket
    if (socket.readyState !== 1) return
    if (socket.bufferedAmount > Gateway.FILA_MAXIMA_BYTES) {
      this.#metricasDosEnvios.lenta(Date.now())
      socket.terminate()
      return
    }
    socket.send(texto)
  }

  get connectionCount(): number {
    return this.#connections.size
  }
}

export type { Connection, ServerName }

/** The key of a pending request: the channel length first, for the reason given in `chaveDeAmbito`. */
function chaveDoPendente(canal: string, quem: string): string {
  return `${canal.length}:${canal}:${quem}`
}

function bytesIguais(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/** One day of disk use, with no names. See `metricasDoDisco`. */
export interface DiaDoDisco {
  /** AAAA-MM-DD, UTC. */
  dia: string
  canais: number
  bytes: number
  maiorCanal: number
  /** Channels that stored more than 4 MiB that day: the client's report cap (§4.4 of the plan). */
  acimaDe4MiB: number
}

/**
 * Bytes stored per channel on the current day, in memory. Channel names only
 * live for the day and never leave this object: `ler` returns numbers.
 */
class MetricasDoDisco {
  #dia = ""
  #porCanal = new Map<string, number>()
  #ontem: DiaDoDisco | null = null

  #rodar(agora: number): void {
    const dia = new Date(agora).toISOString().slice(0, 10)
    if (dia === this.#dia) return
    if (this.#dia !== "") this.#ontem = this.#resumo()
    this.#dia = dia
    this.#porCanal = new Map()
  }

  #resumo(): DiaDoDisco {
    let bytes = 0
    let maiorCanal = 0
    let acimaDe4MiB = 0
    for (const valor of this.#porCanal.values()) {
      bytes += valor
      if (valor > maiorCanal) maiorCanal = valor
      if (valor > 4 * 1024 * 1024) acimaDe4MiB += 1
    }
    return { dia: this.#dia, canais: this.#porCanal.size, bytes, maiorCanal, acimaDe4MiB }
  }

  guardado(agora: number, canal: string, bytes: number): void {
    this.#rodar(agora)
    this.#porCanal.set(canal, (this.#porCanal.get(canal) ?? 0) + bytes)
  }

  ler(agora: number): { hoje: DiaDoDisco; ontem: DiaDoDisco | null } {
    this.#rodar(agora)
    return { hoje: this.#resumo(), ontem: this.#ontem ? { ...this.#ontem } : null }
  }
}

/** One minute of signal counts. Numbers only. */
export interface MinutoDeSinais {
  /** The minute, in minutes since Unix epoch. */
  minuto: number
  aceites: number
  /** Copies delivered: a signal to five members counts five. */
  entregas: number
  bytesRecebidos: number
  bytesEnviados: number
  recusas: Partial<Record<CodigoDeRecusaDoSinal | "sinal-abuse", number>>
}

/** One minute of sends rejected for rate. See `MetricasDosEnvios`. */
interface MinutoDeEnvios {
  minuto: number
  recusas: { envios: number; "envios-handshake": number }
  /** Connections closed for exceeding `ENVIO_RECUSAS_ATE_FECHAR`. */
  fechos: number
  /** Connections dropped because their outgoing queue exceeded `Gateway.FILA_MAXIMA_BYTES` (INV-02). */
  lentas: number
}

/**
 * Per-minute counts of sends rejected for rate, in memory, with no names. Same
 * shape as `MetricasDoSinal`: shows whether the cap is right and whether some
 * client is hammering, without saying who or where.
 */
class MetricasDosEnvios {
  static readonly MINUTOS_GUARDADOS = 60
  #actual: MinutoDeEnvios = MetricasDosEnvios.#vazio(0)
  #anteriores: MinutoDeEnvios[] = []

  static #vazio(minuto: number): MinutoDeEnvios {
    return { minuto, recusas: { envios: 0, "envios-handshake": 0 }, fechos: 0, lentas: 0 }
  }

  #rodar(agora: number): MinutoDeEnvios {
    const minuto = Math.floor(agora / 60_000)
    if (minuto !== this.#actual.minuto) {
      if (this.#actual.minuto !== 0) {
        this.#anteriores.push(this.#actual)
        if (this.#anteriores.length > MetricasDosEnvios.MINUTOS_GUARDADOS) this.#anteriores.shift()
      }
      this.#actual = MetricasDosEnvios.#vazio(minuto)
    }
    return this.#actual
  }

  recusa(agora: number, balde: "envios" | "envios-handshake"): void {
    this.#rodar(agora).recusas[balde] += 1
  }

  fecho(agora: number): void {
    this.#rodar(agora).fechos += 1
  }

  lenta(agora: number): void {
    this.#rodar(agora).lentas += 1
  }

  ler(agora: number): { actual: MinutoDeEnvios; anteriores: MinutoDeEnvios[] } {
    const actual = this.#rodar(agora)
    return {
      actual: { ...actual, recusas: { ...actual.recusas } },
      anteriores: this.#anteriores.map((m) => ({ ...m, recusas: { ...m.recusas } })),
    }
  }
}

/**
 * Per-minute counts of ephemeral signals, in memory.
 *
 * **No content, on purpose:** no channel, account or connection. A per-channel
 * record would say which channels talk and when, which is exactly the metadata
 * the server works not to collect. Process totals are enough to see whether the
 * caps are right and whether there is a storm.
 */
class MetricasDoSinal {
  static readonly MINUTOS_GUARDADOS = 60
  #actual: MinutoDeSinais = MetricasDoSinal.#vazio(0)
  #anteriores: MinutoDeSinais[] = []

  static #vazio(minuto: number): MinutoDeSinais {
    return { minuto, aceites: 0, entregas: 0, bytesRecebidos: 0, bytesEnviados: 0, recusas: {} }
  }

  #rodar(agora: number): MinutoDeSinais {
    const minuto = Math.floor(agora / 60_000)
    if (minuto !== this.#actual.minuto) {
      if (this.#actual.minuto !== 0) {
        this.#anteriores.push(this.#actual)
        if (this.#anteriores.length > MetricasDoSinal.MINUTOS_GUARDADOS) this.#anteriores.shift()
      }
      this.#actual = MetricasDoSinal.#vazio(minuto)
    }
    return this.#actual
  }

  aceite(agora: number, tamanho: number, destinos: number): void {
    const m = this.#rodar(agora)
    m.aceites += 1
    m.entregas += destinos
    m.bytesRecebidos += tamanho
    m.bytesEnviados += tamanho * destinos
  }

  recusa(agora: number, code: CodigoDeRecusaDoSinal | "sinal-abuse"): void {
    const m = this.#rodar(agora)
    m.recusas[code] = (m.recusas[code] ?? 0) + 1
  }

  ler(agora: number): { actual: MinutoDeSinais; anteriores: MinutoDeSinais[] } {
    const actual = this.#rodar(agora)
    return {
      actual: { ...actual, recusas: { ...actual.recusas } },
      anteriores: this.#anteriores.map((m) => ({ ...m, recusas: { ...m.recusas } })),
    }
  }
}

/** One minute of vault counts. Numbers only. */
export interface MinutoDoCofre {
  minuto: number
  /** Entries accepted in `cofre.put`. */
  escritas: number
  bytesEscritos: number
  /** Tombstones written by `cofre.del`. */
  apagadas: number
  /** Pages served in `cofre.get`. */
  leituras: number
  bytesLidos: number
  /** Entries rejected within a result, by reason. */
  entradasRecusadas: Partial<Record<RazaoDeRecusaDaEntrada, number>>
  /** Whole frames rejected, by code, and connections closed for abuse. */
  recusas: Partial<Record<CodigoDeRecusaDoCofre | typeof CODIGO_COFRE_ABUSO, number>>
}

/**
 * Per-minute vault counts, in memory. **No scopes, no accounts, no
 * connections**: the same rule as `MetricasDoSinal`. Enough to see whether the
 * caps are right and whether a client is hammering, without saying who or where.
 */
class MetricasDoCofre {
  static readonly MINUTOS_GUARDADOS = 60
  #actual: MinutoDoCofre = MetricasDoCofre.#vazio(0)
  #anteriores: MinutoDoCofre[] = []

  static #vazio(minuto: number): MinutoDoCofre {
    return { minuto, escritas: 0, bytesEscritos: 0, apagadas: 0, leituras: 0, bytesLidos: 0, entradasRecusadas: {}, recusas: {} }
  }

  #rodar(agora: number): MinutoDoCofre {
    const minuto = Math.floor(agora / 60_000)
    if (minuto !== this.#actual.minuto) {
      if (this.#actual.minuto !== 0) {
        this.#anteriores.push(this.#actual)
        if (this.#anteriores.length > MetricasDoCofre.MINUTOS_GUARDADOS) this.#anteriores.shift()
      }
      this.#actual = MetricasDoCofre.#vazio(minuto)
    }
    return this.#actual
  }

  escrita(agora: number, aceites: number, bytes: number, razoes: readonly RazaoDeRecusaDaEntrada[]): void {
    const m = this.#rodar(agora)
    m.escritas += aceites
    m.bytesEscritos += bytes
    for (const razao of razoes) m.entradasRecusadas[razao] = (m.entradasRecusadas[razao] ?? 0) + 1
  }

  apagamento(agora: number, razao: RazaoDeRecusaDaEntrada | undefined): void {
    const m = this.#rodar(agora)
    if (razao === undefined) m.apagadas += 1
    else m.entradasRecusadas[razao] = (m.entradasRecusadas[razao] ?? 0) + 1
  }

  leitura(agora: number, bytes: number): void {
    const m = this.#rodar(agora)
    m.leituras += 1
    m.bytesLidos += bytes
  }

  recusa(agora: number, code: CodigoDeRecusaDoCofre | typeof CODIGO_COFRE_ABUSO): void {
    const m = this.#rodar(agora)
    m.recusas[code] = (m.recusas[code] ?? 0) + 1
  }

  ler(agora: number): { actual: MinutoDoCofre; anteriores: MinutoDoCofre[] } {
    const actual = this.#rodar(agora)
    const copia = (m: MinutoDoCofre): MinutoDoCofre => ({ ...m, entradasRecusadas: { ...m.entradasRecusadas }, recusas: { ...m.recusas } })
    return { actual: copia(actual), anteriores: this.#anteriores.map(copia) }
  }
}
