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
   * It is not the account, and cannot be: two tabs for the same person are two
   * transports, two flows and two bandwidth costs, and the engine must tell them
   * apart to drop one without dropping the other. Opaque on purpose
   *, the engine does nothing with it but compare.
   */
  readonly id: string
  /** Set only once a signature has been verified. Never before. */
  address: string | null
  /**
   * The key of the DEVICE that signed the challenge, when the chain came in
   * `auth.begin`; `null` on login without chain (the account key hitting
   * the address directly, the path for scripts). It is the one that signs the sheets
   * of key packages from this connection, and that is why it serves to assign them
   * to a device when the client does not state it (0.2.3) and to check what
   * it says when it does.
   */
  deviceKey: Uint8Array | null
  /**
   * Address claimed at auth.begin, still unproven, with the key it named.
   *
   * `signingKey` is the key that must sign the challenge, the device's, when
   * the chain came. `accountKey` is the one the address resolves to, and that is the one the
   * account table stores: it is the one that defines the account, and does not change
   * when switching devices.
   */
  pending: { address: string; signingKey: Uint8Array; accountKey: Uint8Array; comCadeia: boolean } | null
  /** Nonce we handed out, pending signature. Single-use. */
  challenge: Uint8Array | null
  channels: Set<string>
  /**
   * The TEMPORARY slots in the common room, by channel, with the instant they
   * expire (INV-01). Born in `channel.groupinfo.take` and serve only one
   * thing: send the external commit that this card allows. They are not
   * `channels`: they receive no traffic, do not read history, do not count toward
   * `#isSeated`, and `channel.subscribe` does not promote them. What promotes them is the
   * accepted external commit (see `#relay`).
   */
  lugaresTemporarios: Map<string, number>
  /** Whether this connection may be announced to channel-mates. The server
   * still knows it is here — it must, to deliver anything. */
  visible: boolean
  /**
   * The calls this connection entered, by scope key.
   *
   * The pair `(canal, sala)` is stored whole instead of being split again from
   * the key: the key exists for comparison, and a `split` on it is the line
   * that one day accepts a channel with the separator in it and returns something else.
   */
  sfu: Map<string, { channel: string; scope: string }>
  /**
   * Whether this connection stated in `hello` that it only applies its own commit after the echo
   * (`commit-after-echo`). Without this we do not accept commits or cards from it,    * see `#confiavelParaCommits`.
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
 * 1 MiB — and dropped it as *fatal*, closing the connection. A post carrying
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
 * The call router key: the pair `(canal, âmbito)`, summarized.
 *
 * **The channel is part of the key, and that is the entire point of this function.** The
 * scope is chosen by the CLIENT, it is a summary they calculate and send, so
 * two clients from different channels can send the same one. If the key were
 * only the scope, both would land in the same router and hear each other: a person
 * would join a call in a channel they were never admitted to, without forging anything,
 * without breaking encryption, by sending a frame with the correct summary. With the
 * channel in there, that attack requires access to the channel itself, which is exactly what
 * `#mayReach` already verified one line before.
 *
 * **The channel length goes up front, and the summary does not skip it.** A
 * hand-picked separator, a slash, a space, a NUL, solves the problem
 * until the day an identifier contains it, and then `("a|b", "c")`
 * and `("a", "b|c")` become the same call. Summarizing the concatenation does not
 * fix anything, because the summary of two identical strings is identical: what fixes it is
 * the length up front, which makes the read unique no matter what comes after. It is worth saying
 * because the summary GIVES THE APPEARANCE of solving it, and that
 * is the kind of line that passes review without anyone stopping it.
 *
 * The summary serves another purpose, and is enough to justify it: it gives a key of
 * fixed length to maps, instead of one that grows with the channel name.
 *
 * It costs one SHA-256 per frame, and the biggest payer is a call entry,  * once per person.
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
   * `CAPACIDADE_SFU` today: **announcing a capability is a promise**, and
   * the client who hears it stops building the mesh and starts negotiating with an SFU.
   * If the worker is not there, nobody connects to anybody, and the failure shows up in the
   * call, far from the line that lied.
   *
   * A predicate and not a boolean, and not an environment variable, for exactly that reason:
   * a mediasoup worker can die after starting, and at that moment the
   * answer to this question changes. The truth is the state of the engine,
   * read at the moment of `hello`, not a decision made at startup.
   */
  #sfuDePe: () => boolean = () => false

  /**
   * Declare the media engine when Phase 1 sets one up for it.
   *
   * Hung after construction for the same reason as `attachFederation`: the
   * worker is born separately from the gateway and the gateway should not create it.
   */
  declararSfu(estaDePe: () => boolean): void {
    this.#sfuDePe = estaDePe
  }

  #motor: MotorDeMedia | undefined

  /**
   * Attach the media engine and declare the capability based on its state.
   *
   * One call and not two, to make sure there is no way to announce the capability without
   * having an engine: the promise and the thing promised come from the same line. The
   * `declararSfu` still exists separately because a test has to be able to
   * exercise the capability gate without spinning up a subprocess.
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
      // Stores the entry card to the common room and hands it to whoever arrives. Without
      // this announced, a new client does not waste time asking for something this
      // server does not know about: they ask members for a slot, as they always have.
      "common-room-groupinfo",
      // Accepts ONE commit per epoch on each channel and rejects the others to the author with
      // `channel.rejected` `stale-epoch`, and only stores the card from the channel's epoch.
      // A client who hears it can wait for the echo of their commit before
      // applying it: the echo now means "this is the commit from this epoch".
      "commit-per-epoch",
      // Accepts more than one device per account and stores the signed manifest
      // that lists them (`manifest.publish`/`manifest.get`). A client who hears it
      // publishes their manifest on connecting; one who does not hear it sends neither
      // of the two frames. See `CAPACIDADE_APARELHOS`.
      CAPACIDADE_APARELHOS,
      // Serves key packages in a bundle, one per device from the manifest, to whoever
      // ASKS with `bundle: true`. Never to anyone who does not ask: see `CAPACIDADE_BUNDLE`.
      CAPACIDADE_BUNDLE,
      // Has pairing boxes: `pair.open` from an account, `pair.join` from a
      // connection without an account, and `pair.send` forwarded without reading. A client
      // who does not hear it does not show the add device button. See
      // `CAPACIDADE_EMPARELHAMENTO`.
      CAPACIDADE_EMPARELHAMENTO,
      // A device that the account removed from the manifest does not connect, does not complain,
      // does not publish key packages, and never returns to any of the account's manifests. A
      // client who does not hear it revokes anyway (removes the leaf from the channels), but
      // should say the device can still connect. See `CAPACIDADE_REVOGACAO`.
      CAPACIDADE_REVOGACAO,
      // Forwards `channel.sinal` to other members connected on a channel, without
      // storing it. Only to connections that announced it in `hello`. See
      // `CAPACIDADE_SINAL_EFEMERO` and `#sinal`.
      CAPACIDADE_SINAL_EFEMERO,
      // The start of a live stream is arbitrated by the server. In 1.0 the stream
      // has an opaque address and falls into general arbitration (the first to ask); the
      // capability is announced because the client reads it to know whether to claim
      // before creating. See `CAPACIDADE_ESTREIA_DA_DIRECTA` and `channel.claim`.
      CAPACIDADE_ESTREIA_DA_DIRECTA,
      // Accepts opaque addresses and starts them on first request. See
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
      // Stores the encrypted vault of channels and accounts (`cofre.put`,
      // `cofre.get`, `cofre.del`), only for connections that announce it in `hello`.
      // See `CAPACIDADE_COFRE_CIFRADO` and `#cofre`.
      CAPACIDADE_COFRE_CIFRADO,
      ...(this.config.communityMode ? ["community"] : []),
      // And the keyframe request from whoever is watching, only with the SFU up (Phase M2).
      ...(this.#sfuDePe() ? [CAPACIDADE_SFU, CAPACIDADE_SFU_FOTOGRAMA_CHAVE] : []),
    ]
  }

  /**
   * How often the server sends a control ping to each connection.
   *
   * The nginx in front of orwell.pt cuts a silent websocket after one hour
   * (`proxy_read_timeout 1h`), and a client that does not speak for an hour would
   * be cut and reconnected every hour. Each reconnection ran the profile repair loop
   * across all channels: measured in production on October 18, 2026, two messages per
   * channel per hour per idle person. Ping is a control frame: the browser responds with pong
   * on its own, and neither one reaches the client code.
   */
  static BATIMENTO_MS = 30_000

  /** The text of the `error` `versao-antiga`, in STE100. */
  static readonly FRASE_VERSAO_ANTIGA = "Há uma versão nova do Orwell. Recarrega a página, ou descarrega a versão nova."

  /**
   * The text of the `error` `account-suspended` (reports, §8), for the app that does not
   * know the code. The one that does shows "Error 218" and the full warning.
   */
  static readonly FRASE_CONTA_SUSPENSA = "A tua conta está suspensa neste servidor. Abre a app para ler o motivo e pedir revisão."

  /**
   * How often `fecharSuspensas` runs (`app.ts`): a connection opened before the suspension,
   * and that sends nothing, closes in at most one minute. Read once at server startup.
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
    // meant letting a third party take the slot of whoever fell.
    if (this.#caixas.size > 0) this.#largarCaixas(connection)
    // Media releases BEFORE everything else and without waiting: each
    // hung transport is worker memory that never comes back, and a socket
    // that drops is the normal path to exit a call, not the exception. It is
    // `void` because `close` does not wait on anyone's promises; the `catch`
    // exists because an uncaught rejection here would crash the entire process
    // over a call that had already ended.
    if (connection.sfu.size > 0) void this.#largarMedia(connection).catch(() => {})
    // Only the last VISIBLE connection of an account going away means offline —
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
   * cost at its floor, presence exists only in this process's memory — no
   * table, no history, no timestamps, no federation fan-out — and it is only
   * ever told to people who already share a channel with you, who could
   * observe much of it anyway by watching your messages arrive.
   */
  #announcePresence(connection: Connection, online: boolean): void {
    if (!connection.address) return
    // An invisible connection announces nothing — except the moment it turns
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
   * The server is a blind transport: it forwards `pair.send` from one connection to
   * the other and has no way to open what passes through. What it learns is the
   * `pairId` (the summary of the secret, which never goes backward until it does), that an
   * authenticated account opened the box, that a connection without an account joined, and
   * when. **None of this is written to the database**: no table, no row, and
   * a box dies at `pair.close`, at the close of either connection,
   * or after ten minutes.
   */
  #caixas = new Map<string, CaixaDeEmparelhamento>()

  /**
   * Ten minutes: the time it takes to pull the phone out of your pocket and aim the camera,
   * with room to spare to paste the link by hand.
   *
   * It is not `readonly` for one reason alone: the deadline test (`gateway.test.ts`)
   * shortens it so it does not have to wait ten minutes, and restores it. Nothing
   * in production writes to it.
   */
  static PAIR_TTL_MS = 10 * 60_000

  /**
   * Live boxes at the same time, in the whole process. Each is an object in
   * memory and a timer; 256 is well above what a small server
   * has in pairings happening at the same instant, and it is an absolute cap
   * against anyone opening boxes in a loop with multiple accounts. It is not `readonly` for
   * the reason of `PAIR_TTL_MS`: the cap test lowers it and restores it.
   */
  static PAIR_CAIXAS_VIVAS = 256

  /**
   * Opens per account and per minute. Six, like the cards: a person opens
   * one, and maybe another if the first expires. Anyone opening more is automating.
   */
  static readonly PAIR_ABERTURAS_POR_MINUTO = 6

  /**
   * Joins per CONNECTION and per minute, because whoever joins has no account. It is
   * the cap for anyone trying to guess `pairId`s: six per connection and the connection
   * closes, and a `pairId` is 132 bits, so guessing is not a risk to manage;
   * the cap exists so the attempt does not cost CPU from anyone.
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
    // A timer does not keep the process alive because of a box: a server
    // shutting down shuts down, and the box dies with it.
    caixa.prazo.unref?.()
    this.#caixas.set(pairId, caixa)
    this.#send(connection, { t: "pair.opened", pairId })
  }

  #juntarACaixa(connection: Connection, pairId: string): void {
    // Per CONNECTION: whoever joins has no account. Above the cap the connection
    // closes, because a connection without an account insisting has nothing else
    // to do here.
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
    // The host's own connection joining itself is not a box
    // with two sides: it is a mistake, and treat it as a full box.
    if (caixa.convidado !== null || caixa.anfitriao === connection) {
      this.#send(connection, { t: "pair.rejected", pairId, reason: "full" })
      /*
        The box closes and alerts both participants. A third connection with the
        correct `pairId` means someone else has the secret (saw the QR, got the
        link), and the SAS would catch it; but leaving the box open would let
        the person confirm words in a pairing that a third party knows the secret
        to. Restarting costs a new QR.
      */
      this.#queimarCaixa(caixa, "intruder")
      return
    }
    caixa.convidado = connection
    this.#send(caixa.anfitriao, { t: "pair.joined", pairId })
    this.#send(connection, { t: "pair.joined", pairId })
  }

  /**
   * Close a box and alert the participants, except whoever closed it.
   *
   * `quemFechou` is the connection that sent `pair.close` and does not need to
   * hear the echo; in other cases (timeout, intruder, crash) both sides get
   * notified.
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
    // **Pairing exceptions only.** The device joining a box does not yet have an
    // account: it only has the QR secret. `pair.join` passes without an account,
    // counted per connection (`#dentroDoTecto` by `connection.id`) and rejected
    // without fatality if the box does not exist. `pair.send` and `pair.close`
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
      One account per socket (AUTH-02, external audit to 1.1.0). Login passed
      without an account, and it also passed WITH an account: a second
      `auth.begin` set `address` to null and left this connection's channels,
      media and presence unchanged, and the `auth.finish` from another account
      inherited everything. `#isSeated` reads `connection.channels`, so the new
      account subscribed to the old one's channels and the subscription went to
      disk under its name.
      
      Refuse instead of clearing: no client does a second login on the same
      socket (the `Session` opens a new socket on each `connect()`, "Switch
      account" reloads the page, and the device pairing enters on a different
      socket from the box). Clearing would keep a code path nobody uses and
      would have to drop channels, media, boxes, buckets and presence without
      forgetting any.
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
    // A suspended account after connecting (reports, §8) leaves on the next frame,
    // whatever it is, except ping: suspension refuses the whole connection, not
    // just sending. One that sends nothing leaves via `fecharSuspensas`.
    if (connection.address && frame.t !== "ping" && this.store.estaSuspensa(connection.address)) {
      this.#fecharSuspensa(connection)
      return
    }

    switch (frame.t) {
      case "hello":
        // Version first, before trusting any capability: an app this server rejects
        // gets nothing from this connection. The message is for the app that does not
        // know the code (0.9 cached shows the `message` as is); 1.0 translates the
        // code. See `eVersaoAntiga`.
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
        // Stated by the client and trusted. Not a security boundary: a lying client
        // can lock the channel here, but a hostile member can already do it with a
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
          // The archive window, stated to the client so it does not guess it. See
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
        // A half chain is refused and not treated as missing: falling into the old
        // path would give an error about the key not matching the address, and point
        // to the wrong place to look for the fault.
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
        // One frame, one unit: the template already caps at 512 channels at a time,
        // and the client subscribes once per connection. Counting per channel would
        // penalize who has many rooms and reconnects on bad network.
        if (!this.#dentroDoTecto("subscricoes", connection.address as string, Gateway.SUBSCRICOES_POR_MINUTO)) return
        const sentados: string[] = []
        for (const channel of frame.channels) {
          // Subscribing to someone else's feed used to hand over their whole
          // ciphertext stream plus their presence. The id is derivable from a
          // public address, so knowing it proves nothing.
          //
          // `#mayReach`, never `#mayAsk`: the common room's openness is a right
          // to ask, and a subscription is not asking. A newcomer needs none of
          // it either — the Welcome that admits them is addressed to them by
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
        // harmless — the client treats them as set membership.
        this.#announcePresence(connection, true)
        for (const peer of this.#onlinePeersOf(connection)) {
          this.#send(connection, { t: "presence", address: peer, online: true })
        }
        // The versions of the vaults in the channels it joined, so the client only
        // asks for what changed. Only to who announced the vault, and always, even if
        // empty: whoever waits for it knows it arrived. See `cofre.versoes`.
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
          Two buckets (S6 revision): messages and commits with Welcomes. In
          one, an account syncing (anti-entropy, a burst of likes) would fill
          the minute, and the expulsion that followed would wait for it: an
          expelled one kept reading until there was room.
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
          // until a short page arrives — dropping the tail would leave it on a
          // stale epoch, which is the failure this whole path exists to prevent.
          more: events.length === frame.limit,
        })
        return
      }

      case "keypackage.publish": {
        const quem = connection.address as string
        if (this.#recusarRevogado(connection)) return
        if (!this.#dentroDoTecto("keypackages", quem, Gateway.KEYPACKAGES_POR_MINUTO)) return
        // The device for these packets is the one that signed the challenge for this login
        // (the same key signs the leaves: `signatureKeyPair` in group.ts), and ONLY that
        // one. The `device` the client declares is checked and never trusted: if it were
        // trusted in login without a chain, any account could invent a device per packet
        // and the five-hundred limit per device would cease to exist. Without a chain, packets
        // have no device (NULL) and the limit is for the whole account. A declared one that
        // does not match the login is a lie or a mistake, and we report it: assigning packets
        // to the wrong device means serving them to someone who will not open them.
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
        // `replace` deletes the claims before writing, so it never adds to what is
        // already there and is the recovery path for who filled the vault. Without it,
        // there is an absolute cap, PER DEVICE: each machine has its own pool and its
        // own cap.
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
        // Two caps, and the global one is what counts against guessing: accounts are
        // made in an instant, and a per-account cap would multiply by the number of
        // them. The global one is large for who uses connections for real and small for
        // who sweeps 31^8 codes. A code that hits does not open anything by itself: it
        // gives the right to ask members for entry, like the long connection.
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
        // The seal of the long connection (1.0 "Ark", slice 5c). The `codeHash` has
        // 256 bits and does not guess, so the per-account cap is enough (the global
        // one in `invite.resolve` is against who sweeps 8-character codes and does not
        // need to be spent here). Above the cap, or without an invite, it goes without
        // seal: the request says "one channel", and the redeem decides the rest.
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
          Code proof (1.0 "Ark", slice 2). An invite with `code_key` only
          redeems with the signature of the key derived from the code, over this
          request and this account: the `codeHash`, which is in the base, no
          longer suffices. An invite without `code_key` (from a 0.9.x client)
          does not redeem at all: its hash is in the base, and taking it would
          let in whoever had a copy of the table. In 1.0 there are no 0.9.x
          clients.
          */
        const quem = connection.address as string
        /*
          INV-02 (external audit to 1.1.0): redeem amplified traffic without a
          cap. The `keyPackage` size already comes limited by the template
          (`TAMANHO_MAXIMO_DO_KEY_PACKAGE`); here we check the shape, repeated
          requests and rate, all BEFORE spending a use.
        */
        if (lerCabecalhoMls(fromBase64(frame.keyPackage))?.formato !== "key_package") {
          this.#send(connection, { t: "error", code: "bad-frame", message: "keyPackage is not an MLS key package", fatal: false })
          return
        }
        const canalDoConvite = this.store.channelOfInvite(frame.codeHash)
        // The same request again, when the first one already reached connected members:
        // they already have it, and broadcasting again is just traffic. If it reached
        // nobody, it passes: that is how you try again.
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
          audit to 1.1.0). Until now it subscribed already, "so the Welcome has
          somewhere to land", and that gave whoever had the live cipher to this
          connection the history and write access to the channel before any
          member accepts it, and forever if nobody accepts.

          The Welcome needs no subscription: it is directed (`broadcast` with
          `recipient` ignores channels) and stays stored for `welcome.resync` of
          who is disconnected. The proof of admission is that Welcome, sent by
          who has a seat in the channel; from then on `#isSeated` lets it through
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
        // Arbitration, and nothing else: the server tells who gets to create the group
        // and does not create it or join it. Without this, several people arriving at
        // the same time each create their own group with the same id and all end up
        // alone in a room with the right name.
        /*
          In 1.0 only opaque addresses and the common room are claimed, and the
          first to ask gets them. An opaque address (25 bytes random or derived
          from secrets) names nobody and does not guess, so there is no name to
          store: the guards of 0.9 (only accounts of `!dm-a.b`, `!feed-x` and
          `!self-x` claimed those channels, phase 1g) left with the old shape.
          An old shape is not claimed at all (`#formaFechada`), and the response
          does not say who had it.
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
          // Being the operator is not enough to create: who lost the vault and came back
          // still is one, and would create a second group with the same id. This is what
          // the client needs to know not to do it.
          empty: this.store.channelNeverUsed(frame.channel),
        })
        return
      }

      case "channel.groupinfo.put": {
        // The gate that separates a public room from an open door: the card only exists
        // for the channel that THIS server announces as common. Storing it for another
        // channel would leave its key under the mat, because whoever picks it up gets
        // in without anyone inviting them.
        if (!this.#ehSalaComum(frame.channel)) return
        // And only who has a seat there can put it. A forged card does not survive
        // validation by whoever uses it (the signature is checked against the leaf of
        // who signed it), but an OLD card, put back by a stranger over the good one,
        // would send everyone arriving to a dead epoch.
        if (!this.#isSeated(connection, frame.channel)) return
        // An old connection does not publish a card, and nothing is told to it: the
        // `put` comes out on its own each common room epoch. See `#confiavelParaCommits`.
        if (!this.#confiavelParaCommits(connection)) return
        // And only the card of the epoch the channel is in (see `Store.putGroupInfo`).
        // Refusal by epoch is told to who published it; refusal of an unreadable card
        // is not, like the two gates above: no honest client produces it, and there is
        // nothing it can do with the response.
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
        // An old client does not lift the card: it came in with a commit that is not
        // accepted, and spent the door for whoever came next. It gets the "no card"
        // answer as always, and `eabfd6c` then asks members for a seat.
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
          Lifting the card is NOT joining (INV-01, external audit to 1.1.0).

          The external commit that follows must be able to go out, and without a
          seat `#relay` refuses it. Until now this gave the usual mark,
          `connection.channels`, and that mark was enough for the next
          `channel.subscribe` to write the subscription to disk: whoever lifted
          the card and never did the commit (ran out of key packages, the card no
          longer described the room, or simply did not want to) got a permanent
          seat in the common room, reading history and writing garbage to it.

          Now it is a TEMPORARY seat, apart from channels, that only lets out
          the external commit of this card, and expires. It is the commit
          accepted as the epoch commit that promotes the seat to subscription
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
        // Only from own account. The signature already ensures that who publishes has
        // the account key of the address named in the manifest, so this is not a
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
        // The devices this manifest revoked and are connected now leave right away, not
        // on the next connection: until then they could claim packets, publish others,
        // and ask for a seat in channels.
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
        // Who started the channel can also ask (1.0 "Ark", slice 3). The creator of a
        // group never gets a Welcome, and so after losing state (a `forgetChannel`, a
        // restored vault) and subscription, the server did not see them seated. With the
        // old shape they would recreate the channel by name; an opaque address does not
        // recreate (slice 4), and asking members for a seat is the only way back. Only
        // this request: members check the tree (`#answerRejoin`), and whoever is not
        // there gets no seat.
        if (!this.#mayAsk(connection, frame.channel) && this.store.claimantOf(frame.channel) !== connection.address) return
        {
          const ouviram = this.broadcast(frame.channel, {
            t: "channel.rejoin",
            channel: frame.channel,
            address: connection.address as string,
          })
          // Tell how many it reached. Zero is a useful answer: it means nobody online is
          // able to admit, and it is different from being ignored by who is.
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
        // To the OTHER side, and only it. The server does not open the payload: it does
        // not have the key, and the template already measured its size.
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
   * per channel (`canal|<canal>`, cost in bytes of output). Each entry is an
   * expense with its timestamp; worth 60 s. Apart from `#tectos` because these
   * say how much is left to have a seat (`retryAfterMs`), and bytes are not
   * units.
   */
  #baldesDoSinal = new Map<string, { at: number; custo: number }[]>()

  /** The counts per minute, with no content. See `metricasDoSinal`. */
  #metricasDoSinal = new MetricasDoSinal()

  /** The bytes stored per channel and per day, with no names. See `metricasDoDisco`. */
  #metricasDoDisco = new MetricasDoDisco()

  /** Rejections for sends by rate, per minute, with no names. See `metricasDosEnvios`. */
  #metricasDosEnvios = new MetricasDosEnvios()

  /**
   * Rejections for sends by rate, minute by minute, per bucket, and connections
   * closed for not stopping (S6 review). No channels or accounts, like
   * `metricasDoSinal`: process totals only, last 60 minutes.
   */
  metricasDosEnvios(): { actual: MinutoDeEnvios; anteriores: MinutoDeEnvios[] } {
    return this.#metricasDosEnvios.ler(Date.now())
  }

  /**
   * Disk used by channels today and yesterday, in bytes of encrypted data stored
   * (application events). To measure the cost of sync reports (S4):
   * the server does not know which event is a report (it is a `typing` encrypted like
   * the rest), so it counts everything stored, and the report appears as the
   * excess over a normal day. No channel names or accounts: just the count of
   * channels, the total, the largest, and how many exceeded 4 MiB.
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
   * How long until this bucket has room for `custo`, in ms. Zero means "room now".
   * Does not consume quota.
   */
  #esperaDoBalde(chave: string, custo: number, tecto: number, agora: number): number {
    const vivos = (this.#baldesDoSinal.get(chave) ?? []).filter((gasto) => agora - gasto.at < 60_000)
    if (vivos.length === 0) this.#baldesDoSinal.delete(chave)
    else this.#baldesDoSinal.set(chave, vivos)
    let usado = vivos.reduce((soma, gasto) => soma + gasto.custo, 0)
    if (usado + custo <= tecto) return 0
    // Spending is in arrival order: oldest out first.
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
    // Like in `#dentroDoTecto`: a map that only grows is a leak. Per-channel buckets
    // are left after the channel goes silent; swept when large.
    if (this.#baldesDoSinal.size > 4096) {
      for (const [outra, lista] of this.#baldesDoSinal) {
        const ultimo = lista[lista.length - 1]
        if (!ultimo || agora - ultimo.at >= 60_000) this.#baldesDoSinal.delete(outra)
      }
    }
  }

  /**
   * An ephemeral signal: verify, count, pass to other connected members, and
   * forget.
   *
   * **What is verified, in this order:** the connection announced capacity; the
   * connection is subscribed to the channel (that is what the server knows about
   * who has room, and it does not cost a database read); the size fits under the
   * operator cap; the connection has room in its bucket; the channel has room in
   * its outgoing bucket. Buckets are only charged when everything passes.
   *
   * **What is NOT done:** store, retry for offline users, federate, or
   * decide who responds to whom. `#mayReach` is not called, because it can
   * debut and claim a channel, and a signal leaves no trace.
   *
   * **Who receives:** all other connections subscribed to the channel that
   * announced capacity, including other devices of the same account (each
   * is a leaf and has its own index). The sender does not receive echo.
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
   * Tell the sender the signal did not go through, and close only those who
   * keep trying.
   *
   * Rejection never closes on first attempt. Counted per connection and per
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

  /** Content bytes per page of `cofre.entradas`: 5.4 MiB in base64, under 12 MiB of frame. */
  static readonly COFRE_PAGINA_BYTES = 4 * 1024 * 1024
  /** Lines per page of `cofre.entradas`. */
  static readonly COFRE_PAGINA_LINHAS = 1024

  /** Vault counts per minute, with no scopes or accounts. See `metricasDoCofre`. */
  #metricasDoCofre = new MetricasDoCofre()

  /**
   * Vault counts, minute by minute: writes, reads, bytes, rejections
   * by code and by reason. **No scopes, no accounts, no connections**, for the
   * same reason as `metricasDoSinal`: one record per channel would reveal which
   * channels are being accessed and when. Process totals, in memory, last 60 minutes.
   */
  metricasDoCofre(): { actual: MinutoDoCofre; anteriores: MinutoDoCofre[] } {
    return this.#metricasDoCofre.ler(Date.now())
  }

  /**
   * Vault frames `cofre.*`: verify, count, store, or serve.
   *
   * **What we verify, in order:** the connection announced the capability; the
   * scope belongs to the caller (`canal:` per `#mayReach`, the same guard as
   * `channel.send` and `channel.backfill`; `conta:` only the account itself, with
   * the device to revoke); the account has room in the read or write bucket. We only
   * spend from the bucket when everything passes. The limits for each entry (size,
   * padding, CAS, room in scope) come from the `Store` and arrive entry by entry in
   * the result, without rejecting the frame.
   *
   * **What we do NOT do:** read the content, decide authority (a `role.assign` in
   * the vault only counts if the client accepts it), federate, or write anywhere
   * who read what.
   *
   * The write guard for the 3rd is only this. The write key tied to the commit
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
   * Tell the other connections to whom the scope matters that the version went up.
   *
   * `canal:` to connections subscribed to the channel; `conta:` to the other devices of
   * the account. Only to who announced the vault, and never to who wrote (already
   * has the result). It teaches the server nothing it did not know: the
   * subscriptions and the connections are his.
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
   * Tell the requester the vault frame did not go through, and close only those
   * who keep trying. Same form as `#recusarSinal`.
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
   * Media frames per account and per minute.
   *
   * The account, so the number is not arbitrary: joining a call that already has
   * sixteen people costs one `scope.join`, two `transport.create`, two
   * `transport.connect`, one `produce`, fifteen `consume` and fifteen `resume`,    * thirty-six frames in a burst. And each person who joins after costs two more
   * to each of those already there.
   *
   * Three hundred give headroom for about eight complete entries in a full room
   * per minute, which is far more than one person would do, and still set a cap:
   * without it, an automated client could spawn routers and transports at socket
   * speed, and each transport is memory in a subprocess not shared with anyone
   * else on this machine. Cap against automation, not against heavy use, like the
   * rest of this section.
   */
  static readonly SFU_POR_MINUTO = 300

  /** Connections by `id`, to identify a flow without scanning the set. */
  #porId = new Map<string, Connection>()

  /**
   * All frames `sfu.*`, with the two common guards in front.
   *
   * Guard order matters. **Engine first, then cap:**
   * a server with no SFU has to tell everyone always "I do not route media", not
   * "too many requests" on the tenth attempt, the second answer sends people
   * looking for the fault in the wrong place and they wait a minute for it.
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
      // Engine rejection passes through here intact. Anything else is a fault
      // on our side, and the client does not hear what broke inside:
      // we say it did not work, with a code that sets it apart
      // from a legitimate rejection.
      if (erro instanceof RecusaDeMedia) this.#recusarSfu(connection, erro.codigo, erro.message, ref)
      else this.#recusarSfu(connection, "interno", "o motor de media não conseguiu atender o pedido", ref)
    }
  }

  async #despacharSfu(connection: Connection, frame: FrameSfu, motor: MotorDeMedia, ref: string | undefined): Promise<void> {
    switch (frame.t) {
      case "sfu.scope.join": {
        // **This line admits, not the SFU.** The engine has no membership model at all, // it does not know what a channel is, let alone who is in one.
        // It is the `#mayReach` of always, the same one that guards history and live
        // encryption, that decides if there is a call. Nobody produces or consumes
        // in a scope the engine would not allow.
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
            // A producer whose owner no longer has a connection is a flow dying.
            // Announcing it without an address would force the client to handle a case
            // it cannot treat; omitting it is the truth, it will disappear shortly.
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
        // From here on, frames name a TRANSPORT, not a channel, and the
        // guard changes nature: the engine verifies, and it knows a
        // transport only by the owner who created it. `#mayReach` already ran when the
        // transport was born, and running again would add nothing, this
        // server does not learn of expulsions by design (see `#isSeated`).
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
            // declare it has it inferred from the `kind` inside, and echoing what
            // the client wrote left the other side not knowing what to do with the flow.
            { t: "sfu.producer.new", channel: par.channel, scope: par.scope, producer: id, kind: frame.kind, address: connection.address as string, fonte },
            connection,
          )
        }
        return
      }

      /*
       * Stop sharing the screen, without leaving the call.
       *
       * Names a PRODUCER, not a channel, so the guard is the same as
       * the other frames of this kind: the engine verifies, and it knows a
       * producer only by the owner of the transport where it was born. Without that
       * check, an identifier from elsewhere would silence the screen of someone else.
       */
      case "sfu.produce.close": {
        const { ambito: chave, fechados } = await motor.fecharProdutor(connection.id, frame.producer)
        this.#send(connection, { t: "sfu.produce.closed", producer: frame.producer, ...(ref !== undefined ? { ref } : {}) })
        const par = connection.sfu.get(chave)
        if (par) {
          // One announcement per closed producer: closing the screen image closes its
          // audio too, and anyone listening must know it by the same frame.
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
        The symmetric one, and it is what makes "Stop viewing" save server bandwidth.
        Without it, someone who stopped viewing a screen closed their consumer and
        the worker kept routing the image to a transport that no longer reads it.
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
   * The viewer requests a keyframe (Phase M2). See `sfu.keyframe` in the protocol.
   *
   * Outside `#sfu` on purpose: that bucket (`SFU_POR_MINUTO`) is for
   * frames that set up the call, and keyframe requests consuming it left an
   * entry in the call with no room. This has its own, and EVERYTHING that goes
   * wrong here ends in silence: engine down, bucket full, transport not ours,
   * cap per consumer. A keyframe rejection was a response per second to someone
   * already viewing poorly.
   */
  #pedirFotogramaChave(connection: Connection, frame: Extract<FrameSfu, { t: "sfu.keyframe" }>): void {
    const motor = this.#motor
    if (!motor || !motor.estaDePe()) return
    if (!this.#dentroDoTecto("sfu-keyframe", connection.address as string, Gateway.FOTOGRAMAS_CHAVE_POR_MINUTO)) return
    try {
      motor.pedirFotogramaChave(connection.id, frame.transport, frame.consumer)
    } catch {
      // Transport of another connection, or already closed: say nothing to anyone.
    }
  }

  /**
   * How many `sfu.keyframe` an account can send per minute, all consumers summed.
   *
   * The cap that counts is the engine's, one per second per consumer. This is the
   * top one: 240 gives four broken images at once, each requesting at max rate,
   * and cuts a client that opens consumers just to request.
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
   * Called from `#drop`, the normal exit path from a call, used much
   * more than `sfu.scope.leave`, because a closed tab sends no frame.
   * If this fails silently, the others see the person in the call forever and
   * the worker keeps their transports.
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

    // A device the account removed from the roster does not enter, no matter how
    // good the chain: the certificate does not expire, and the roster says who
    // still speaks for the account. Before the challenge, like the other rejections:
    // there is nothing to prove. A device not yet in the roster enters (it is the
    // phone paired before `pronto`); only one that was there and left is rejected.
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
    // Changing devices cannot change the account, if it did, the address would
    // stop being a hash of a key and become a name stored next to it, which is
    // exactly what this system does not have.
    if (!this.store.registerOrVerifyAccount(pending.address, pending.accountKey)) {
      this.#send(connection, { t: "error", code: "address-taken", message: "address bound to another key", fatal: true })
      return
    }
    // Suspended (reports, §8): the signature is good, so we say why.
    // Before possession and device enrollment: a suspended account writes nothing.
    if (this.store.estaSuspensa(pending.address)) {
      this.#fecharSuspensa(connection)
      return
    }
    /*
      Which copy of this device speaks for it (see `auth.finish` in the
      protocol). After the signature: bumping the generation revokes possession
      from the other copy, and only whoever proved the key can request it.

      The copy that takes over closes other connections with the same key right
      now, not on the next connection: with both online, both would encrypt with
      the same ratchet. A copy arriving with a generation below the current one is
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
        // Only connections with a chain know their device; a client without a chain signs with the account key, and there is no device copy to compare.
        if (outra.deviceKey && toBase64(outra.deviceKey) === toBase64(pending.signingKey)) this.#fecharCopiaSubstituida(outra)
      }
    } else if (posse.posse < geracao) {
      this.#fecharCopiaSubstituida(connection)
      return
    }
    this.store.registerDevice(pending.address, pending.signingKey)

    connection.address = pending.address
    // With a chain, `signingKey` is the device's; without a chain it is the account's, and the connection has no known device. See `Connection.deviceKey`.
    connection.deviceKey = pending.comCadeia ? pending.signingKey : null
    this.#send(connection, { t: "auth.ok", address: pending.address, posse: geracao })
    // The vault version of the account itself, right after `auth.ok`: it is the only scope known before any subscription. See `cofre.versoes`.
    if (connection.cofreCifrado) {
      this.#send(connection, { t: "cofre.versoes", cofres: this.store.cofreVersoes([`conta:${pending.address}`]) })
    }

    // Per device: the pool that matters to this connection is its own. Counting the entire account would report "twenty" to a second device with zero.
    const remaining = this.store.availableKeyPackages(pending.address, connection.deviceKey ?? undefined)
    if (remaining < 10) this.#send(connection, { t: "keypackage.low", remaining })

    // Invitations that arrived while this account was offline are NOT pushed
    // here: at this instant the client has not yet restored its vault, so it
    // holds no private key halves and every welcome would fail — and be
    // remembered as unopenable. It asks for them itself (welcome.resync) once
    // its keyring is loaded.
  }

  // ------------------------------------------------------------------ relay

  /**
   * ICE servers for a call, with a credential that expires.
   *
   * coturn's `use-auth-secret` mode: the username is `<expiry>:<anything>` and
   * the password is base64(HMAC-SHA1(secret, username)). The secret stays here.
   * A credential is good for `turnTtl` seconds — long enough to place a call,
   * short enough that a leaked one is worthless — which is the difference
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
      // The name must be unique per account. It was `<expiry>:orwell` for everyone, and coturn quotas are PER USER: with a shared name, a three-person call exhausted the quota for all at once and the relay started returning 486 to anyone joining later, even to those already there when renegotiating. Symptom: "the third person joined and dropped, and I never heard them again".
      //
      // We use the account id, which is already an opaque hash: it adds nothing the server does not know, and tells nothing to anyone observing TURN traffic.
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
   * Without a limit, this is a traffic amplifier under our server's identity:
   * an account makes us hit someone else's site hundreds of times a second, and
   * the target sees our IP, not theirs. The limit is per account, not per
   * connection, counting by connection would invite opening ten.
   */
  static readonly PREVIEWS_PER_MINUTE = 20
  static readonly PREVIEWS_AT_ONCE = 2

  /** Timestamps of recent requests, per account. Memory only, and only the current minute. */
  #previewHits = new Map<string, number[]>()
  #previewInFlight = new Map<string, number>()

  /**
   * Limits per account and per minute, following the pattern of `#previewHits`
   * above.
   *
   * Every frame counted here leaves a PERMANENT mark in the database at the
   * request of whoever sends it, a subscription, a report, an invite, a key
   * package, and none of them had a limit. One audit filled the tables from a
   * single account with no effort at all.
   *
   * None of these numbers is reachable by someone using the product: the client
   * subscribes once per connection, publishes twenty key packages when it runs
   * low, and creates invites one by one. These are limits against automation,
   * not against heavy use.
   *
   * What this is NOT about: `channel_activity` continues to grow one record per
   * channel ever started, and is not cleaned on purpose, it is that mark that
   * stops a private room from reappearing as newly created to someone whose
   * retention has deleted its events (see `channelNeverUsed`). What limits it
   * is the cap on debuts, not a cleanup job.
   */
  /**
   * Content frames per account and per minute.
   *
   * The `channel.send` was the only frame that wrote to the database with no
   * limit at all, and it writes the most: each one records a line in `events`
   * with up to `MAX_FRAME_BYTES` of encrypted text, and triggers federated
   * routing to peers. An account with space could fill it at socket speed.
   *
   * Six hundred per minute is ten per second, sustained. Someone typing fast
   * does two or three; a voice call does more, because signaling goes through
   * here, three people joining an eight-person call is tens of frames in a
   * burst, and that is why the number is not sixty like the others. A limit
   * against automation, not against heavy use, like everything else in this
   * section.
   */
  static readonly ENVIOS_POR_MINUTO = 600

  /**
   * Commits and Welcomes per account and per minute, in a separate bucket from
   * messages.
   *
   * An admission costs a commit and a Welcome; a removal costs a commit. One
   * hundred twenty per minute is sixty admissions, far more than one person or
   * a full room does, and it is still a limit against automation. Separate so
   * that sync never delays a removal (S6 review).
   */
  static readonly ENVIOS_HANDSHAKE_POR_MINUTO = 120

  /**
   * Refusals per rate per CONNECTION and per minute before closing it.
   *
   * A client that announces `send-refused` stops at the first refusal and moves
   * to one send at a time; the burst already in flight when the refusal arrives
   * is all that can be refused next, and it is tens. A client that ignores the
   * refusal and keeps sending is using the server as a punching bag: each
   * refusal is work and a frame back. Above this, fatal `error` and close, like
   * signals (`signal-refusals`).
   */
  static readonly ENVIO_RECUSAS_ATE_FECHAR = 300

  /**
   * History requests per account and per minute.
   *
   * Each one reads from the database and returns up to a limit of events; it
   * writes nothing, but reads a lot, and it is the path for downloading an
   * entire channel in a loop. Sixty is one reconciliation per second, far above
   * what a client does, it asks when connecting and when coming back online.
   */
  static readonly BACKFILLS_POR_MINUTO = 60

  /**
   * The three frames that only READ, and which is why they went unnoticed.
   *
   * None of them writes anything, which is why they were left out when limits
   * were added, the criterion then was "leaves a mark in the database". The
   * criterion was wrong: what an account with space can do with no limit is
   * occupy the process, and this server is just one.
   *
   * - `welcome.resync` reads up to two hundred pending invites and writes them
   *   all to the socket. Repeated at network speed, it is the most expensive
   *   frame here: a query with `ORDER BY` on the events table and up to two
   *   hundred outgoing messages per request.
   * - `ice.servers` is a TURN credential factory: each request signs a new HMAC
   *   with the coturn secret and returns a credential valid for `turnTtl`.
   *   Without a limit, an account collects thousands in a minute and hands them
   *   out to anyone, the relay pays the traffic.
   * - `directory.list` returns, in community mode, ALL local accounts. It is
   *   the entire list of who lives here, in one frame, with no repeat limit.
   *
   * Sixty per minute, like the other read buckets: the client asks for a resync
   * once per connection, servers ask for ICE when joining a call, and the
   * directory when opening the people screen. None of these numbers is reachable
   * by someone using the product.
   */
  static readonly RESYNCS_POR_MINUTO = 60
  static readonly ICE_POR_MINUTO = 60
  static readonly DIRECTORIOS_POR_MINUTO = 60
  /**
   * Device manifests, published or requested, per account and per minute.
   *
   * One bucket for both, and sixty like the other read buckets: a client asks
   * for its own when connecting and publishes it once in the account lifetime,
   * and will ask for each person it invites. Publishing costs a signature check
   * and a write; requesting costs a one-line read. Neither is reachable by
   * someone using the product.
   */
  static readonly MANIFESTOS_POR_MINUTO = 60

  static readonly ESTREIAS_POR_MINUTO = 60
  /**
   * Entry cards redeemed per account and per minute.
   *
   * Low on purpose. Each redemption deletes the card, so requesting it in a
   * loop is the way to keep the room without a door and lock everyone out. A
   * legitimate entry uses one; client retry uses another every two minutes at
   * worst.
   */
  static readonly CARTOES_POR_MINUTO = 6
  /**
   * How long the temporary seat of whoever redeemed the card is valid (INV-01).
   * The client assembles the external commit right after `take`, in less than a
   * second; two minutes give leeway to a slow machine and bad network.
   */
  static LUGAR_TEMPORARIO_MS = 2 * 60_000
  static readonly SUBSCRICOES_POR_MINUTO = 60
  static readonly CONVITES_POR_MINUTO = 30
  /**
   * Short code resolutions per account and per minute. Someone opens one
   * connection, maybe two; twelve gives leeway for pasting several in a row.
   */
  static readonly RESOLUCOES_POR_MINUTO = 12
  /**
   * And on the whole server, summed across all accounts. The limit matters: with
   * a thousand active invites, hitting a code by chance asks on average 31^8 /
   * 1000 tries, close to 850 million; at 600 per minute that is over two and a
   * half years non-stop. The price: whoever sweeps burns everyone's limit, and
   * someone with a real connection gets `rate-limited` that minute and tries
   * next. The long connection does not go through here and keeps opening.
   */
  static readonly RESOLUCOES_DO_SERVIDOR_POR_MINUTO = 600
  static readonly KEYPACKAGES_POR_MINUTO = 30
  /**
   * The limits of `invite.redeem` (INV-02, external audit at 1.1.0).
   *
   * Each redemption costs one use, writes to the database and broadcasts to all
   * connected members of the channel, and had no limit. Someone redeems one
   * connection, maybe two; twelve per account is the resolution limit. Per
   * invite, thirty accounts per minute: a shared connection in a big group,
   * opening at the same time. Per channel, sixty, summed across its invites. On
   * the whole server, six hundred, like resolutions: accounts are made in an
   * instant, and a per-account limit alone would multiply by the number of
   * them. Above any one limit, `invite.rejected` is `rate-limited`, without
   * spending the use.
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
   * the Welcome, never from here. Ten minutes, the pairing box deadline: time
   * for someone in the channel to see the request.
   */
  static PENDENTE_MS = 10 * 60_000
  /** Pending requests live in the whole process. Above this the oldest are removed. */
  static readonly PENDENTES_MAXIMO = 10_000
  /**
   * The cap on the output queue of each connection, in bytes (INV-02).
   *
   * The `#send` used to write without checking `bufferedAmount`: a connection
   * that does not read (network stuck, a hostile client that stops reading on
   * purpose) made the server hold in memory everything the channel said. Above
   * the cap the connection closes at once (`terminate`, because a `close` would
   * stay behind the queue), and counts in `metricasDosEnvios`.
   *
   * The policy, and why nothing breaks: we only measure the queue BEFORE each
   * write, so a large single frame (a history page, a post with a photo) always
   * gets through; whoever closes comes back and recovers from history, asked
   * page by page at the client's pace; and voice call media does not go here
   * (it goes over WebRTC), so only the call drops for someone who stopped
   * reading the signaling 64 MiB ago. Five frames at maximum size waiting.
   */
  static FILA_MAXIMA_BYTES = 64 * 1024 * 1024
  /**
   * Unpublished key packages an account can have waiting.
   *
   * The client keeps twenty and refills at forty. Five hundred is more than
   * enough for any honest variant and an absolute limit for others, and
   * `replace: true`, which deletes old ones, still always gets through: whoever
   * for some reason filled the vault recovers it on its own next connection.
   */
  static readonly KEYPACKAGES_EM_ESPERA = 500

  #tectos = new Map<string, number[]>()

  /**
   * A send above the limit: refused, and told to whoever sent it. Never silent.
   *
   * Until 21/10/2026 it was a silent `return`. The client marked the send as
   * done, nobody got it, and the next send in the same minute also failed,
   * anti-entropy reports included: 1,800 sends in a row from one account left 45
   * % of likes and all votes undelivered, and whoever asked for what was missing
   * got silence from the response and gave up after three tries (S6 of absolute
   * sync, `sincronia-ritmo.test.ts`).
   *
   * To whoever announced `CAPACIDADE_ENVIO_RECUSADO`: `channel.rejected` with
   * `rate-limited`, the `ref` and when there is space. The client retries. To an
   * old client: an `error` with code `rate-limited`, which it puts in
   * diagnostics and does not read as loss of seat (an unknown `channel.rejected`
   * told it "this room no longer exists").
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
    // A client that does not stop: the connection closes, and counts (S6 review).
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
   * Spend a unit from the limit, or say there is none left.
   *
   * @returns `false` when the account exceeded this bucket's limit this minute.
   */
  #dentroDoTecto(balde: string, quem: string, porMinuto: number): boolean {
    const agora = Date.now()
    const chave = `${balde}|${quem}`
    const recentes = (this.#tectos.get(chave) ?? []).filter((carimbo) => agora - carimbo < 60_000)
    this.#tectos.set(chave, recentes)
    if (recentes.length >= porMinuto) return false
    recentes.push(agora)
    // A map that only grows is a memory leak with another name: one entry per account and per bucket, for the lifetime of the process. Cleanup costs a pass and only runs when the map is already large.
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
   * Fetch what the page says about itself, at the request of whoever publishes.
   *
   * What does NOT happen here is as important as what does: we do not write
   * anywhere that an address was requested or by whom. Storing that would
   * rebuild, on the server side, the read log that the entire product exists
   * not to have, and Fastify's `logger` is off for the same reason.
   *
   * The refusal is always the same phrase. Telling "private address" from "did
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
   * reading, writing or administering a channel — which is the whole distance
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
   * A channel's roles, who can remove, invite, rename, move, travel encrypted
   * like any other message, and each client applies them from the group state.
   * This server does not read them, and that is what stops a compromised server
   * from promoting itself to admin of anything.
   *
   * The honest consequence: when someone is removed from an MLS group, this
   * server does not find out. Their subscription stays active, they keep
   * receiving cipher they no longer decrypt, and they can still write frames to
   * the channel that no one else opens, and a series of those makes each member
   * declare the channel deaf, which triggers repair that deletes history for
   * future secrecy. It is the same weakness the threat model describes for the
   * common room, for the same reason.
   *
   * Closing it from here would need a frame telling the server to stop serving
   * an account on a channel, and that frame does not exist on purpose: without
   * knowing who administers, the server would have to take it from any member,    * that is, it would give everyone the power to remove everyone from the
   * channel's routing, permanently and without appeal. A weapon that kills the
   * channel for all, to cover a risk that encryption already reduced to noise.
   * What protects whoever was removed is that the epoch moved forward, not this
   * server.
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
    // Still full: the oldest leave (the Map keeps insertion order).
    for (const outra of this.#pendentes.keys()) {
      if (this.#pendentes.size <= Gateway.PENDENTES_MAXIMO) break
      this.#pendentes.delete(outra)
    }
  }

  /** Does this connection have a temporary seat expiring in this channel? Expired ones leave here. */
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
    // No name grants a seat: in 0.9 the owner had a seat in `!feed-<id>` just for the name being theirs. The opaque board of 1.0 belongs to the owner because they claimed it first, and from then on by subscription.
    if (this.store.isSubscribed(channel, address)) return true
    return this.store.hasWelcomeFor(channel, address)
  }

  /**
   * Can this account open this channel for the first time?
   *
   * The tolerance for an unopened channel exists for its creator: between "I made
   * this room" and "I said something in it" there is nothing here, and rejecting
   * that moment would close a gap that does not exist. What was missing was an
   * anchor to an identity.
   *
   * Without an anchor, "never been used" was enough, and since `!feed-<id>` and
   * `!dm-<a>.<b>` from 0.9 were computed from public addresses, any authenticated
   * account could reach the feed or conversation of anyone else BEFORE first use
   * and sit there forever, because the subscription is persisted. Measured with
   * real traffic: live ciphertext, backfill, presence, and forged frames in
   * someone else's channel, which is what makes every member declare it deaf and
   * takes the history with forward secrecy. It is the same kind of gap that
   * `#isSeated` closed, entry through another door.
   *
   * The anchor in 1.0:
   * - opaque address (`eMoradaOpaca`), whether direct, wall, account or room: who
   *   claimed it. This is the arbitration that `channel.claim` already does, and
   *   the first to ask gets it: exactly what channel creation needs. The address
   *   names no one and cannot be guessed, and that is what replaces the 0.9 name
   *   guards (the owner of `!feed-`, both sides of `!dm-`).
   * - the common room: the same arbitration, by the address that `hello` announces.
   * - a closed form never opens for anyone. See `#formaFechada`.
   */
  /**
   * Is this channel a form that no longer opens?
   *
   * Everything that is not opaque address or the common room: `!dm-a.b`, `!feed-x`,
   * `!self-x` and `!<nome>` of the 0.9. Closing them is what prevents the name from
   * coming back into play (and from reporting who talks to whom). The common room
   * stays out because it is one case only, with the address that the server
   * announces on `hello`, and the operator chooses it. It closes the debut and
   * does not expel anyone: that is why the cut erases the database, and no old
   * subscription survives.
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
    // The cap comes before the decision because the decision leaves a mark: opening
    // a channel stores a subscription or a claim, requested by someone who has no
    // seat anywhere yet. See `#dentroDoTecto`.
    if (!this.#dentroDoTecto("estreias", connection.address, Gateway.ESTREIAS_POR_MINUTO)) return false
    return this.#mayOpen(connection.address, channel)
  }

  /**
   * May this account ASK the members of this channel to let it in?
   *
   * Wider than `#mayReach`, and only by the common room — which is the whole of
   * the decision taken about it. Without this there was a closed circle: to ask
   * for a seat you had to be reachable, and to be reachable you had to already
   * have one. Whoever arrived after the room existed stayed out for ever, in
   * silence: the request left the client and died here.
   *
   * Note what this opens and what it does not. It carries a request to the
   * members, who are the only ones who can admit anybody, and it stops there.
   * It does NOT hand over the room's ciphertext, its invite codes, its live
   * traffic, or the presence of everyone connected to this server — the first
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

  /** The guarantee that `hello` must bring for this connection to commit. */
  static readonly COMMIT_DEPOIS_DO_ECO = "commit-after-echo"

  /**
   * Can this connection send commits and cards?
   *
   * Only if `hello` said `commit-after-echo`. Clients before 13/9/2026
   * (bundle `eabfd6c`) apply their commit BEFORE sending it: when they lose the
   * race for the epoch they end up alone in E+1, and the next commit or card they
   * publish comes from that branch. Accepting any of them made the server follow
   * one person's branch and locked the room for everyone.
   *
   * No Welcomes either: the old bundle sends them right after the commit that
   * did not go in, and accepting them put you on the branch of that separator
   * (see `#relay`).
   *
   * **All in silence, no `channel.rejected`.** The `eabfd6c` does not distinguish
   * rejection reasons: any failure fails the sends waiting for receipt on that
   * channel (including `leaveChannel`, which was delivered) and shows "This room
   * no longer exists… leave the room and ask to be invited again"
   * (session.ts:7075-7101 of that commit). Since the card publishes itself at
   * each epoch, each old separator received that advice right after deploy.
   * A commit without echo, by contrast, does nothing to it: commits send without
   * waiting for receipt (`#markOwn`, :2092-2099, and :1964, :4305, :5201, :6474),
   * the reference stays in a set capped at 512, and there is no repeat or cycle.
   * What makes it update is the new version alert (`version-watch.ts`, every three
   * minutes and on returning to the separator).
   *
   * Everything else does not go through here: messages, proposals, history and calls
   * keep working for those who have not yet upgraded.
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
    // A rejection persists; silence does not. Whoever writes to a channel where they
    // have no seat learns it, instead of continuing to talk to the void with
    // everything looking fine on their side.
    const sentado = this.#mayReach(connection, frame.channel)
    const ciphertext = fromBase64(frame.ciphertext)
    // A temporary seat (the lifted card) only lets out the external commit of that
    // card. See `Connection.lugaresTemporarios`.
    const commitDoCartao =
      frame.kind === "handshake" &&
      this.#temLugarTemporario(connection, frame.channel) &&
      ehCommitExterno(ciphertext, frame.channel)
    const entradaPeloCartao = !sentado && commitDoCartao
    if (!sentado && !entradaPeloCartao) {
      this.#send(connection, { t: "channel.rejected", channel: frame.channel, reason: "no-seat" })
      return
    }

    // Not the Welcome either. The old bundle sends the commit and Welcome in a row,
    // without waiting for verdict: the commit stays out, and the Welcome, delivered,
    // made the invitee swap the group for the E+1 branch that only that separator has, // and end up deaf in silence, because the real messages, in epoch E, count for them
    // as before their seat. They are not stored or delivered.
    if (frame.kind === "welcome" && !this.#confiavelParaCommits(connection)) return

    // Not a commit, no matter what `kind` is declared (the client gives to MLS
    // everything that is not Welcome). Discarded before touching the database, and
    // IN SILENCE, see `#confiavelParaCommits` for why the silence.
    if (frame.kind !== "welcome" && !this.#confiavelParaCommits(connection) && ehCommit(ciphertext)) return

    const guardado = this.store.appendEvent(
      { channel: frame.channel, kind: frame.kind, ciphertext, recipient: frame.recipient },
      /*
        Live, no epoch 0 commit restarts a channel. In 0.9 the name gave that right
        to the owner of `!feed-x` and both sides of `!dm-a.b`; an opaque address
        names no one, and the server does not tell a direct from a room. Opening
        refound to whoever opened the channel opened it to the room creator too,
        who with an epoch 0 commit broke it for all. Whoever lost the group asks
        for a seat (`channel.rejoin.request`, part 3); a locked channel unlocks
        with `scripts/destrancar-canal.mjs`.
        */
      { refundavel: false },
    )

    // A commit for an epoch the channel already left: told only to who sent it,
    // with their `ref` and the epoch the channel is in. It is not stored, not
    // broadcast, not federated, reaching another member would give them a choice
    // between two futures for the group. See `Store.appendEvent`.
    if (!guardado.ok && guardado.reason === "recipient-not-welcome") {
      // A malformed frame, not a channel rejection: there is no contract for this
      // because no client sends it. Same error as a frame that does not parse, and
      // the connection stays.
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
    // The directed Welcome is the admission: the pending request for that account ended.
    if (frame.kind === "welcome" && frame.recipient !== undefined) this.#pendentes.delete(chaveDoPendente(frame.channel, frame.recipient))
    /*
      The external commit was accepted as THE commit of the epoch: it is proof of
      entry to the common room, and it is only here that the temporary seat becomes
      a subscription. Before the echo, so the echo reaches it by the usual path.

      Also when the account was ALREADY seated (common-room-resync, 5/11/2026): the
      subscription is per-account and survives device swap, and then `#relay` let
      the commit pass as from a member, without putting THIS connection in the channel.
      The echo went only to `connection.channels`, the author did not see it, and after
      ten seconds they gave the commit up for lost and went back to the card, once per
      minute, each retry accepted and the room epoch rising. Whoever just joined by card
      is in the channel, wherever the authorization comes from.
    */
    if (commitDoCartao) {
      connection.lugaresTemporarios.delete(frame.channel)
      connection.channels.add(frame.channel)
      this.store.subscribe(frame.channel, connection.address as string)
    }
    if (frame.kind === "application" && !guardado.repetido) this.#metricasDoDisco.guardado(Date.now(), frame.channel, ciphertext.length)

    // Resend of an already accepted commit, the echo was lost in a socket drop.
    // The author gets the echo that did not reach them: the original event, with the
    // `ref` of this send, because that is what they wait for. The others already had
    // it, and peers did too.
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
      The echo is the verdict, and whoever sent it must have it, never silence.
      
      The `broadcast` delivers to whoever is in `connection.channels`, and a
      connection can be seated (the account's durable subscription, Welcome) without
      being there: a device that has not yet subscribed to the channel on this
      connection. The send was accepted and broadcast to others; the author was
      missing the only answer they wait for. The directed Welcome stays without echo,
      as always.
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
   * A directed frame — in practice a Welcome — deliberately ignores the
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
    // Without `bundle`, the response is the usual one and costs a package: `keyPackages`
    // and `manifest` do not go, not even empty. The bundle is requested, never offered
    // (`CAPACIDADE_BUNDLE`). With `bundle`, the singular is the first of the bundle
    // or the one for unknown device that `claimBundle` served in its place, for a
    // reader who only knows the singular to keep having a package.
    let resposta: Extract<ServerFrame, { t: "keypackage.claimed" }> = { t: "keypackage.claimed", address, keyPackage: null }
    try {
      const home = parseAddress(address).server
      if (home === this.config.serverName) {
        // A suspended account is not invited (reports, §8): the response is an empty
        // pool, and nothing is used.
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
            // A 0.2.3 peer responds with only the singular: the bundle goes empty and the
            // manifest `null`, which is "there is nothing more than this".
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
   * Own code (`device-revoked`) not `bad-device-cert`: the chain is good, and what
   * the person needs to know is something else (this device was removed from the
   * account on another device). A 0.5.7 client handles any fatal code the same way,
   * so the new code does not break it.
   */
  #fecharRevogado(connection: Connection): void {
    this.#send(connection, { t: "error", code: "device-revoked", message: "this device was removed from the account", fatal: true })
    connection.socket.close()
  }

  /**
   * Close the connection of a suspended account (reports, §8). Fatal: the app does
   * not reconnect by itself, and reads the alert through the signed request, which
   * needs no session (`ROTAS_DA_DENUNCIA.suspensao`).
   */
  #fecharSuspensa(connection: Connection): void {
    this.#send(connection, { t: "error", code: "account-suspended", message: Gateway.FRASE_CONTA_SUSPENSA, fatal: true })
    connection.socket.close()
  }

  /**
   * Close connections of suspended accounts that are still open: those that send
   * no frame do not pass the dispatch guard. Runs minute by minute (`app.ts`).
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
   * The guard for key package frames: a revoked device does not use them.
   *
   * Login already rejects it, and `manifest.publish` closes its connections; this
   * is the third door, for the frame that arrives between the two (a connection
   * opened before revocation, with frames in flight).
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

/** The key of a pending request: the channel length at the head, by the reason of `chaveDeAmbito`. */
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

/** A day of disk, unnamed. See `metricasDoDisco`. */
export interface DiaDoDisco {
  /** AAAA-MM-DD, UTC. */
  dia: string
  canais: number
  bytes: number
  maiorCanal: number
  /** Channels that stored more than 4 MiB this day: the cap for client reports (§4.4 of the plan). */
  acimaDe4MiB: number
}

/**
 * Bytes stored per channel on the current day, in memory. Channel names live only
 * during the day and never leave here: `ler` returns numbers.
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

/** The counts of one minute of signals. Numbers only. */
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

/** One minute of send rejections by rate. See `MetricasDosEnvios`. */
interface MinutoDeEnvios {
  minuto: number
  recusas: { envios: number; "envios-handshake": number }
  /** Connections closed for exceeding `ENVIO_RECUSAS_ATE_FECHAR`. */
  fechos: number
  /** Connections disconnected because the output queue exceeded `Gateway.FILA_MAXIMA_BYTES` (INV-02). */
  lentas: number
}

/**
 * Counts per minute of send rejections by rate, in memory, unnamed. Same form
 * as `MetricasDoSinal`: tells if the cap is right and if some client is hammering,
 * without saying who or where.
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
 * Counts per minute of ephemeral signals, in memory.
 *
 * **No content, on purpose:** no channel, account or connection. One record per
 * channel would say which channels talk and when, which is the metadata the server
 * takes care not to collect. Process totals are enough to see if caps are right and
 * if there is a storm.
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

/** Vault counts per minute. Numbers only. */
export interface MinutoDoCofre {
  minuto: number
  /** Entries accepted in `cofre.put`. */
  escritas: number
  bytesEscritos: number
  /** Tombstones that entered `cofre.del`. */
  apagadas: number
  /** Pages served in `cofre.get`. */
  leituras: number
  bytesLidos: number
  /** Entries rejected within a result, by reason. */
  entradasRecusadas: Partial<Record<RazaoDeRecusaDaEntrada, number>>
  /** Entire frames rejected, by code, and locks by abuse. */
  recusas: Partial<Record<CodigoDeRecusaDoCofre | typeof CODIGO_COFRE_ABUSO, number>>
}

/**
 * Vault counts per minute, in memory. No scopes, no accounts, no
 * connections: same rule as `MetricasDoSinal`. Enough to check if caps
 * are right and if a client is hammering, without saying who or where.
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
