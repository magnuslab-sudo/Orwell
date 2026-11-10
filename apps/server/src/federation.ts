import {
  CLOCK_SKEW_SECONDS,
  FEDERATION_PATH,
  fromBase64,
  parseAddress,
  parseServerName,
  PeerClaimReply,
  signEnvelope,
  signPeerClaim,
  toBase64,
  verifyEnvelope,
  verifyPeerClaim,
  type FederationBody,
  type FederationEnvelope,
  type PeerClaim,
  type ServerName,
} from "@enclave/protocol"
import { currentSecond } from "./db.js"
import type { ServerConfig, ServerKeypair } from "./config.js"
import type { Gateway } from "./gateway.js"
import type { Store } from "./store.js"

/**
 * Server-to-server delivery.
 *
 * The only thing crossing this boundary is a channel id, a payload class and a
 * blob. A peer server learns that *some* member on our side spoke in a channel
 * it also carries. It does not learn which member, what was said, or who else
 * is on our side — that is the whole point of federating this way rather than
 * mirroring Discord's single-operator model N times over.
 */
export class Federation {
  /**
   * Rate limits per origin (FED-01, external audit of 1.1.0), per minute.
   *
   * Counted after the signature: an origin counts only for what it signed for
   * real, and someone who only knows a peer's name does not spend their cap.
   * Over the cap the envelope is refused with `rate-limited` (429 on the route)
   * and does not get stored, does not spread, and does not enroll anyone; the
   * peer retries from the `outbox`, with a fresh nonce each time. 1,200 per
   * origin is twenty deliveries per second from an entire server; 6,000 summed
   * across all origins. Key package requests (which spend one package each)
   * have their own, lower cap.
   *
   * `DIRECTORIAS_POR_ORIGEM_POR_MINUTO` is the cap for fetches to the key
   * directory of a peer, which is the only thing an envelope not yet verified
   * can trigger: without it, a `keyId` made up by an envelope was an HTTPS
   * request from us to the peer per envelope.
   *
   * Not `readonly` only so tests can lower and restore it.
   */
  static ENVELOPES_POR_ORIGEM_POR_MINUTO = 1200
  static ENVELOPES_POR_MINUTO = 6000
  static PEDIDOS_DE_PACOTE_POR_ORIGEM_POR_MINUTO = 120
  static DIRECTORIAS_POR_ORIGEM_POR_MINUTO = 6

  /** Timestamps per bucket, in memory only and only the minute. See `#dentroDoTecto`. */
  readonly #tectos = new Map<string, number[]>()

  constructor(
    private readonly store: Store,
    private readonly config: ServerConfig,
    private readonly key: ServerKeypair,
    private readonly gateway: Gateway,
  ) {}

  // ------------------------------------------------------------------ outbound

  /** Queue a payload for every peer that carries this channel. */
  async fanOut(channel: string, body: FederationBody): Promise<void> {
    const peers = new Set(this.store.channelPeers(channel))

    // A channel is hosted by the server in its address; that server must always
    // receive it, even before anyone has recorded it as a peer.
    try {
      const home = parseAddress(channel).server
      if (home !== this.config.serverName) peers.add(home)
    } catch {
      // Locally-scoped channel id with no homeserver. Nothing to federate.
    }

    for (const peer of peers) {
      if (!this.#allowed(peer)) continue
      this.store.enqueueOutbound(peer, JSON.stringify(body))
    }
  }

  /**
   * Drain the outbox once.
   *
   * Delivery is at-least-once and unordered across peers; MLS tolerates that.
   * Failures back off rather than blocking the queue, so one unreachable peer
   * cannot stall delivery to everyone else.
   */
  async flush(limit = 32): Promise<void> {
    for (const item of this.store.dueOutbound(limit)) {
      const envelope = signEnvelope(
        { keyId: this.key.keyId, privateKey: this.key.privateKey },
        {
          origin: this.config.serverName,
          destination: item.destination,
          issuedAt: currentSecond(),
          nonce: toBase64(crypto.getRandomValues(new Uint8Array(16))),
          body: JSON.parse(item.payload) as FederationBody,
        },
      )

      try {
        const response = await fetch(`https://${item.destination}${FEDERATION_PATH}/send`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(envelope),
          signal: AbortSignal.timeout(15_000),
        })
        if (response.ok) this.store.completeOutbound(item.id)
        else this.store.deferOutbound(item.id, item.attempts)
      } catch {
        this.store.deferOutbound(item.id, item.attempts)
      }
    }
  }

  // ------------------------------------------------------------------- inbound

  /**
   * Accept a payload from a peer, or say precisely why not.
   *
   * Every rejection reason here is a distinct attack being refused: forged
   * origin, misrouted envelope, replayed capture, or a stale clock used to widen
   * the replay window.
   */
  async receive(envelope: FederationEnvelope): Promise<{ ok: true } | { ok: false; reason: string }> {
    const origin = envelope.origin as ServerName
    if (!this.#allowed(origin)) return { ok: false, reason: "not-federated" }
    let acimaDoTecto = false

    // Resolving the key can hit the network, so it happens before the
    // synchronous verification below.
    await this.#ensurePeerKey(origin, envelope.keyId)

    const result = verifyEnvelope(envelope, {
      destination: this.config.serverName,
      resolveKey: (server, keyId) => this.store.peerKey(server, keyId),
      // Only after the signature (FED-01), and once: recordNonce inserts and says
      // if it was new, so the ask and the write do not separate. Before the nonce,
      // the cap of the origin: an envelope over it does not spend anything, and the
      // peer retries with another nonce.
      spendNonce: (server, nonce) => {
        if (
          !this.#dentroDoTecto(`envelopes|${server}`, Federation.ENVELOPES_POR_ORIGEM_POR_MINUTO) ||
          !this.#dentroDoTecto("envelopes|*", Federation.ENVELOPES_POR_MINUTO)
        ) {
          acimaDoTecto = true
          return false
        }
        return this.store.recordNonce(server, nonce)
      },
      nowSeconds: currentSecond(),
    })

    if (acimaDoTecto) return { ok: false, reason: "rate-limited" }
    if (!result.ok) return { ok: false, reason: result.reason }

    // The same rule of one commit per epoch that the gateway applies, and in the
    // same place: `appendEvent` holds it. A late commit from a peer does not get
    // stored or spread, and there is no one to tell it to, because the author is
    // on another server and federation does not say who. The peer sees the refusal
    // and retries from the `outbox`, and the retry is refused again: waste capped
    // at twelve tries, and no branches.
    //
    // What does not apply here is the refusal of commits from old clients
    // (`commit-after-echo`, see `Gateway.#confiavelParaCommits`), and not by
    // mistake: the envelope does not say which connection the commit came from, or
    // whether it vouched for it. A peer of this version already refused those
    // commits at their own gateway before federating them; a peer of an earlier
    // version does not, and that is one of federation's limitations written in
    // the THREAT-MODEL. In production federation is off (empty allowlist).
    const guardado = this.store.appendEvent(
      {
        channel: result.body.channel,
        kind: result.body.kind,
        ciphertext: fromBase64(result.body.ciphertext),
        recipient: result.body.recipient,
      },
      // Never refundable: the envelope does not say who sent the commit, and
      // refunding is only for whoever the channel identifier names.
      { refundavel: false },
    )
    if (!guardado.ok) return { ok: false, reason: guardado.reason }
    // Delivered at least once: the same commit again is already here. Saying yes
    // spares the peer retries, and no one receives it twice.
    if (guardado.repetido) return { ok: true }
    const stored = guardado.event

    // Remember the peer so our own traffic in this channel reaches it.
    this.store.addChannelPeer(result.body.channel, origin)

    this.gateway.broadcast(
      result.body.channel,
      {
        t: "channel.event",
        channel: stored.channel,
        seq: stored.seq,
        kind: stored.kind as "application" | "handshake" | "welcome",
        ciphertext: stored.ciphertext,
        receivedAtMinute: stored.receivedAtMinute,
      },
      result.body.recipient,
    )

    return { ok: true }
  }

  /**
   * Fetch a key package for a user on another homeserver.
   *
   * Signed, and by POST: the request carries the same proof as a delivery
   * envelope carries, because on the other side it spends a key package and a
   * route that spends cannot trust who knocks on its door. See `PeerClaim`.
   */
  async claimRemote(
    address: string,
    home: ServerName,
    bundle?: { bundle: boolean; devices: string[] | undefined },
  ): Promise<PeerClaimReply | undefined> {
    if (!this.#allowed(home)) return undefined
    try {
      const claim = signPeerClaim(
        { keyId: this.key.keyId, privateKey: this.key.privateKey },
        {
          origin: this.config.serverName,
          destination: home,
          issuedAt: currentSecond(),
          nonce: toBase64(crypto.getRandomValues(new Uint8Array(16))),
          address,
        },
        // Outside the signature, on purpose: see `PeerClaim`. Without `bundle`, the
        // request is byte-for-byte the old one.
        bundle?.bundle ? { bundle: true, ...(bundle.devices ? { devices: bundle.devices } : {}) } : {},
      )
      const response = await fetch(`https://${home}${FEDERATION_PATH}/keypackage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(claim),
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) return undefined
      // By the template: a peer that responds with anything else is a peer that did
      // not respond. The manifest inside goes to the client, who verifies it; this
      // server has no reason to trust it and does not need to.
      const body = PeerClaimReply.safeParse(await response.json())
      return body.success ? body.data : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Serve, or refuse, a key package requested by a peer.
   *
   * The same ceremony as `receive`: the key comes from the directory of the
   * server the request names, the destination must be this server, the clock
   * must match, and the nonce works once. Without this, the route would decide
   * by headers that the caller chooses, and the route consumes what it serves.
   */
  async claimForPeer(claim: PeerClaim): Promise<{ ok: true; address: string } | { ok: false; reason: string }> {
    let origin: ServerName
    try {
      origin = parseServerName(claim.origin)
    } catch {
      return { ok: false, reason: "bad-origin" }
    }
    if (!this.#allowed(origin)) return { ok: false, reason: "not-federated" }

    await this.#ensurePeerKey(origin, claim.keyId)

    const result = verifyPeerClaim(claim, {
      destination: this.config.serverName,
      resolveKey: (server, keyId) => this.store.peerKey(server, keyId),
      // Like in `receive`: after the signature, with the origin cap in front.
      spendNonce: (server, nonce) =>
        this.#dentroDoTecto(`pacotes|${server}`, Federation.PEDIDOS_DE_PACOTE_POR_ORIGEM_POR_MINUTO) &&
        this.store.recordNonce(server, nonce),
      nowSeconds: currentSecond(),
    })
    if (!result.ok) return { ok: false, reason: result.reason }
    return { ok: true, address: result.address }
  }

  // -------------------------------------------------------------------- keys

  async #ensurePeerKey(origin: ServerName, keyId: string): Promise<void> {
    if (this.store.peerKey(origin, keyId)) return
    // A network call to fetch an envelope that nobody has verified yet. See
    // `DIRECTORIAS_POR_ORIGEM_POR_MINUTO`. We do not exceed the limit: the
    // envelope fails with `unknown-key`, which is the right response.
    if (!this.#dentroDoTecto(`directorias|${origin}`, Federation.DIRECTORIAS_POR_ORIGEM_POR_MINUTO)) return

    try {
      const response = await fetch(`https://${origin}${FEDERATION_PATH}/keys`, {
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) return

      const directory = (await response.json()) as {
        server: string
        validUntil: number
        keys: Record<string, { key: string }>
      }
      // A server only speaks for itself. Accepting a directory that names
      // someone else would let any peer inject keys for any other.
      if (directory.server !== origin) return

      for (const [id, entry] of Object.entries(directory.keys)) {
        this.store.cachePeerKey(origin, id, fromBase64(entry.key), directory.validUntil)
      }
    } catch {
      // Unreachable peer. The envelope fails with unknown-key, which is correct.
    }
  }

  /** Spend one unit of the bucket this minute, or say there is none left. The template of `Gateway.#dentroDoTecto`. */
  #dentroDoTecto(balde: string, porMinuto: number): boolean {
    const agora = Date.now()
    const recentes = (this.#tectos.get(balde) ?? []).filter((carimbo) => agora - carimbo < 60_000)
    this.#tectos.set(balde, recentes)
    if (recentes.length >= porMinuto) return false
    recentes.push(agora)
    // One entry per origin of the allowlist and per bucket: does not grow
    // without limit, but sweeps the same way when large.
    if (this.#tectos.size > 1024) {
      for (const [outro, carimbos] of this.#tectos) {
        const ultimo = carimbos[carimbos.length - 1]
        if (ultimo === undefined || agora - ultimo >= 60_000) this.#tectos.delete(outro)
      }
    }
    return true
  }

  #allowed(server: ServerName): boolean {
    if (server === this.config.serverName) return false
    // An empty allowlist means federation is OFF, not open to the world.
    //
    // It used to mean the opposite, and the signature on an envelope proves
    // nothing about legitimacy here: the verifying key is fetched from the origin
    // the envelope names, so anyone with a domain could sign their own way in,
    // be registered as a peer of any channel, and receive every future message in
    // it — including the account address in each welcome. A layer that has never
    // run between two real servers should not be reachable by every server.
    if (this.config.allowlist.length === 0) return false
    return this.config.allowlist.includes(server)
  }

  /**
   * Periodic upkeep: expire replay nonces and retention-expired ciphertext.
   *
   * And expired invites, and reports that no longer decide anything. The last
   * two were missing: `Store.expireInvites()` was written from the start and
   * was never called from anywhere, so an invite with a deadline stayed in the
   * database past the deadline, refused when redeemed, yes, but stored anyway,
   * with its hash and channel, indefinitely. An audit counted three thousand.
   * A public method no one calls does not warn anyone: readers of the file
   * assume cleanup happens.
   *
   * This is the retention sweep, not a cap substitute: what stops an account
   * from filling the database is the per-account limit at the gateway.
   */
  sweep(): void {
    this.store.expireNonces(CLOCK_SKEW_SECONDS * 4)
    this.store.expireEvents(this.config.retentionDays)
    this.store.expireInvites()
    this.store.expireChannelClaims()
  }
}
