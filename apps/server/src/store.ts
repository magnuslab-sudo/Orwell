import {
  ALFABETO_DO_CODIGO_CURTO,
  APARELHOS_POR_CONTA,
  aparelhosRevogados,
  CODIGO_CURTO_CARACTERES,
  COFRE_BALDE_BYTES,
  DeviceManifestWire,
  fromBase64,
  toBase64,
  verifyDeviceManifest,
  type ManifestoRecusado,
  type ServerName,
} from "@enclave/protocol"
import { randomBytes } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"
import { epochDeCartao, epochDeCommit } from "./cabecalho-mls.js"
import { currentMinute, currentSecond, type StoredEvent } from "./db.js"

/** What happened to an event we tried to store. See `appendEvent`. */
export type EventoGuardado =
  /**
   * `repetido`: the same commit, byte for byte, was already stored in this
   * channel (a resend from a client that missed the echo). `event` is the original;
   * nothing was written, and the caller will not broadcast it again.
   */
  | { ok: true; event: StoredEvent; repetido: boolean }
  /** A commit for an epoch the channel has already left. `epoch` is the channel's. */
  | { ok: false; reason: "stale-epoch"; epoch: number }
  /** A recipient in an event that is not Welcome. See `appendEvent`. */
  | { ok: false; reason: "recipient-not-welcome" }

/** What happened to an entry card we tried to store. See `putGroupInfo`. */
export type CartaoGuardado =
  | { ok: true }
  /** From an epoch other than the channel's. `epoch` is the channel's. */
  | { ok: false; reason: "stale-groupinfo"; epoch: number }
  /** Not a GroupInfo for this channel, and useless to whoever picked it up. */
  | { ok: false; reason: "illegible" }

/**
 * One commit per epoch: the rule, in one place only, because it runs in two (live
 * in `appendEvent` and over history in `inicializarEpochs`). Two copies of it would
 * mean a startup that disagrees with what the server would do live.
 *
 * - No memory of the channel: accept, and the next is `epoch + 1`.
 * - `epoch` equal to the next one: it is the commit we were waiting for.
 * - `epoch` 0 with `refundavel`: the group rebuilt under the same name, and the
 *   channel starts over. The caller decides who may re-found (`Gateway.#podeRefundar`).
 * - Everything else is refused: a second commit for an epoch that already had one,
 *   and a commit for an epoch ahead. That comes from a branch the server did not
 *   accept (an old client that applied its own anyway), from an old group with the
 *   same name, or from a forged header; jumping there would make it official and
 *   lock the real group.
 *
 * @returns the next epoch after accepting the commit, or `undefined` if it is
 * refused.
 */
function aceitarCommit(proxima: number | undefined, epoch: number, refundavel: boolean): number | undefined {
  if (proxima === undefined || epoch === proxima) return epoch + 1
  if (epoch === 0 && refundavel) return 1
  return undefined
}

/**
 * All database access, in one place.
 *
 * Keeping every query here means the set of things this server can learn is
 * auditable by reading a single file. If a feature needs a query that is not in
 * here, that is the moment to ask whether the feature is worth the metadata.
 */
/** An entry to write to the vault, with content already decoded from base64. See `Store.cofrePut`. */
export interface EntradaParaOCofre {
  chave: string
  conteudo: Uint8Array
  versaoEsperada?: number | undefined
}

/** The caps that apply to a scope, decided by the gateway (channel or account). */
export interface LimitesDoEscopo {
  entradaMaxBytes: number
  entradas: number
  bytes: number
}

/** The counters for a scope. See `cofres_meta` in `db.ts`. */
export interface MetaDoCofre {
  versaoGlobal: number
  bytes: number
  entradas: number
  lapides: number
  podadoAte: number
}

export interface ResultadoDoPut {
  aceites: { chave: string; versao: number }[]
  recusadas: { chave: string; razao: "versao" | "tecto" | "acolchoamento"; versao?: number }[]
  versaoGlobal: number
  /** The bytes accepted, for metrics. Not sent on the wire. */
  bytesAceites: number
}

/** With `versao`, the tombstone went in with that version; with `razao`, it did not. `versaoActual` is the key's version afterwards. */
export type ResultadoDoDel =
  | { versao: number; razao?: undefined; versaoActual: number; versaoGlobal: number }
  | { versao?: undefined; razao: "versao" | "inexistente"; versaoActual: number; versaoGlobal: number }

export interface PaginaDoCofre {
  versaoGlobal: number
  completo: boolean
  ate: number
  mais: boolean
  entradas: { chave: string; versao: number; conteudo: Uint8Array }[]
  lapides: { chave: string; versao: number }[]
}

/** How many welcomes to keep per user and channel. See `pruneSupersededWelcomes`. */
const WELCOMES_GUARDADOS = 5

/**
 * Suspended right now (`suspensoes`): `activa` and the end still to come, or no end.
 * The `?` is the current second. The VPS script (`scripts/denuncias.mjs`) has the
 * same rule written by hand.
 */
const SUSPENSA_AGORA = "activa = 1 AND (ate_second IS NULL OR ate_second > ?)"

export class Store {
  #db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.#db = db
  }

  /**
   * node:sqlite has no transaction helper, and a half-applied write here means a
   * desynchronised MLS group, so the rollback path is explicit.
   */
  #transaction<T>(work: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE")
    try {
      const result = work()
      this.#db.exec("COMMIT")
      return result
    } catch (error) {
      this.#db.exec("ROLLBACK")
      throw error
    }
  }

  // ------------------------------------------------------------------ accounts

  /**
   * The account key stored at first login, or `undefined` if the account
   * never logged in. Read-only: this is what the signed abuse-report request checks against
   * (`pedido-assinado.ts`), and that path never writes to the database.
   */
  signingKeyOf(address: string): Uint8Array | undefined {
    const row = this.#db.prepare("SELECT signing_key FROM accounts WHERE address = ?").get(address) as
      | { signing_key: Uint8Array }
      | undefined
    return row === undefined ? undefined : new Uint8Array(row.signing_key)
  }

  /**
   * First login registers the key; later logins must match it.
   *
   * The address is a hash of the signing key, so a mismatch means either a hash
   * collision or someone trying to take over an address. Both get rejected.
   */
  registerOrVerifyAccount(address: string, signingKey: Uint8Array): boolean {
    const existing = this.#db.prepare("SELECT signing_key FROM accounts WHERE address = ?").get(address) as
      | { signing_key: Uint8Array }
      | undefined

    if (!existing) {
      this.#db
        .prepare("INSERT INTO accounts (address, signing_key, created_minute) VALUES (?, ?, ?)")
        .run(address, signingKey, currentMinute())
      return true
    }

    return equalBytes(signingKey, existing.signing_key)
  }

  /**
   * The device this account is currently using.
   *
   * Called after the challenge is satisfied, never before: registering a device
   * before the proof would let anyone write into another user's rows.
   *
   * **Up to `APARELHOS_POR_CONTA` rows per account, and above that the oldest
   * goes.** Until September 22, 2026 there was a `DELETE` here that kept the
   * table to one row: each login wiped the previous device. That is what made
   * the server enforce one device per account, and multi-device removes it.
   *
   * Rotation preserves the behavior for a user who reinstalls from scratch: a new
   * vault is a new device key, so a new row, and without rotation the fifth
   * reinstall would be rejected by an invisible limit. The oldest goes by
   * `added_minute`, which is when the device was ADDED, not the last time it was
   * used: storing "last seen" would put each machine's usage pattern into this
   * table, which is exactly the metadata it does not keep. Logging in again from the same
   * device does not change its age.
   *
   * Nothing depends on what stays here, and it bears saying: whoever validates a
   * leaf validates the chain it carries, and an account's list of active devices
   * is the manifest it signed (`device_manifests`), not this table.
   * This is what the server knows; that is what the account says.
   */
  registerDevice(address: string, deviceKey: Uint8Array): void {
    this.#transaction(() => {
      this.#db
        .prepare("INSERT OR IGNORE INTO devices (address, device_key, added_minute) VALUES (?, ?, ?)")
        .run(address, deviceKey, currentMinute())
      // The `rowid` breaks ties between two devices added in the same minute: the one
      // written first is the oldest.
      this.#db
        .prepare(
          `DELETE FROM devices WHERE address = ? AND rowid IN (
             SELECT rowid FROM devices WHERE address = ?
             ORDER BY added_minute ASC, rowid ASC
             LIMIT max(0, (SELECT count(*) FROM devices WHERE address = ?) - ?)
           )`,
        )
        .run(address, address, address, APARELHOS_POR_CONTA)
    })
  }

  /** The device keys this account registered, from oldest to newest. */
  devicesOf(address: string): Uint8Array[] {
    const rows = this.#db
      .prepare("SELECT device_key FROM devices WHERE address = ? ORDER BY added_minute ASC, rowid ASC")
      .all(address) as { device_key: Uint8Array }[]
    return rows.map((row) => row.device_key)
  }

  /**
   * Store the device manifest for an account, if it deserves to be stored.
   *
   * Both guards live HERE and not in the gateway, by the same rule as `appendEvent`:
   * this is the only place a manifest enters the database, and the check and the
   * write happen in the same transaction, with no path around them. The signature
   * (`verifyDeviceManifest`: the account signed this, and the address is the
   * hash of that account) prevents the server from storing what the account did
   * not say; a strictly greater version keeps an old manifest from overwriting a
   * new one, and keeps a race between two devices publishing the same version from
   * having two winners.
   *
   * What is NOT checked here, and belongs to the gateway: that the address is
   * the authenticated connection's. The database does not know who is connected.
   *
   * The stored text is the wire text as it arrived, not a rewrite: this is what
   * `manifestOf` returns, and anyone receiving it verifies it again byte for
   * byte.
   *
   * **Revocation starts here.** Each device that was in the stored manifest, is
   * missing from the new one, AND appears in `revogar` (the `revoke` list from
   * `manifest.publish`) goes into `revoked_devices`, and its unclaimed key packages
   * are deleted: they leave the bundle and the single claim at the same moment
   * they leave the manifest. A manifest that lists an already-revoked device is
   * rejected (`revoked-device`): revocation is forever, and this prevents
   * auto-add (`#garantirManifesto` on the client) from putting back a device
   * that another device removed. `revogados` tells the caller which devices just
   * left, so it can close their connections.
   *
   * What leaves without appearing in `revogar` just leaves: that is the cap-driven
   * trim from a 0.5.7 client that does not send the list and does not want to revoke anyone.
   * See `aparelhosRevogados`.
   */
  putDeviceManifest(
    raw: unknown,
    revogar?: readonly string[],
  ):
    | { ok: true; version: number; revogados: string[] }
    | { ok: false; reason: ManifestoRecusado["reason"] | "stale-version" | "revoked-device" } {
    const verificado = verifyDeviceManifest(raw)
    if (!verificado.ok) return verificado
    const { wire } = verificado
    return this.#transaction(() => {
      const atual = this.#db.prepare("SELECT version FROM device_manifests WHERE address = ?").get(wire.address) as
        | { version: number }
        | undefined
      if (atual !== undefined && wire.version <= atual.version) return { ok: false as const, reason: "stale-version" as const }
      if (wire.devices.some((device) => this.isDeviceRevoked(wire.address, device.deviceKey))) {
        return { ok: false as const, reason: "revoked-device" as const }
      }
      const revogados = aparelhosRevogados(this.deviceManifestOf(wire.address), wire, revogar)
      const minuto = currentMinute()
      for (const chave of revogados) {
        this.#db
          .prepare("INSERT OR IGNORE INTO revoked_devices (address, device_key, revoked_minute) VALUES (?, ?, ?)")
          .run(wire.address, chave, minuto)
        this.#db
          .prepare("DELETE FROM key_packages WHERE address = ? AND device = ? AND claimed = 0")
          .run(wire.address, fromBase64(chave))
      }
      this.#db
        .prepare(
          `INSERT INTO device_manifests (address, version, manifest, published_minute) VALUES (?, ?, ?, ?)
           ON CONFLICT(address) DO UPDATE SET version = excluded.version, manifest = excluded.manifest, published_minute = excluded.published_minute`,
        )
        .run(wire.address, wire.version, JSON.stringify(wire), minuto)
      return { ok: true as const, version: wire.version, revogados }
    })
  }

  /**
   * Whether the account removed this device from its manifest. See `revoked_devices`.
   *
   * `deviceKey` in base64url (manifest form) or bytes (login form). A device that
   * never appeared in a manifest is NOT revoked: it is the phone that was just paired and
   * logs in before the computer publishes the manifest that lists it (`emparelhar.ts`:
   * the manifest is published only after `pronto`).
   */
  isDeviceRevoked(address: string, deviceKey: string | Uint8Array): boolean {
    const chave = typeof deviceKey === "string" ? deviceKey : toBase64(deviceKey)
    return (
      this.#db.prepare("SELECT 1 AS x FROM revoked_devices WHERE address = ? AND device_key = ?").get(address, chave) !==
      undefined
    )
  }

  // ------------------------------------------------------------------ suspensions

  /**
   * Whether the account is suspended now (`suspensoes`, abuse reports §8). The gateway
   * checks it at login, in each `channel.send`, and in each key package request:
   * a query by primary key. A suspension with an end (`ate_second`) stops
   * counting the next second, with no one having to lift it.
   */
  estaSuspensa(address: string): boolean {
    return this.#db.prepare(`SELECT 1 AS x FROM suspensoes WHERE address = ? AND ${SUSPENSA_AGORA}`).get(address, currentSecond()) !== undefined
  }

  /**
   * Suspend the account over abuse report `denuncia` (or none: an order from an
   * authority, an operator decision). Only the VPS script calls this, run by a
   * person: nothing on the server suspends on its own. Suspending an already-suspended or
   * lifted account overwrites. `ateSecond` is the last second of suspension, or
   * `null`: until review.
   */
  suspender(address: string, denuncia: number | null, ateSecond: number | null = null): void {
    this.#db
      .prepare(
        `INSERT INTO suspensoes (address, activa, denuncia, at_second, ate_second) VALUES (?, 1, ?, ?, ?)
         ON CONFLICT (address) DO UPDATE SET activa = 1, denuncia = excluded.denuncia, at_second = excluded.at_second,
           ate_second = excluded.ate_second`,
      )
      .run(address, denuncia, currentSecond(), ateSecond)
  }

  /**
   * Lift the suspension. Does not delete the row, and `at_second` stays: it says
   * when the suspension started. When it was lifted is in the notice (`revisao`).
   */
  levantar(address: string): void {
    this.#db.prepare("UPDATE suspensoes SET activa = 0 WHERE address = ?").run(address)
  }

  /** The accounts suspended right now, in order. Same rule as `estaSuspensa`. */
  suspensas(): string[] {
    return (
      this.#db.prepare(`SELECT address FROM suspensoes WHERE ${SUSPENSA_AGORA} ORDER BY address`).all(currentSecond()) as {
        address: string
      }[]
    ).map(
      (linha) => linha.address,
    )
  }

  /** The possession generation of this device, or zero if never imported. See `device_posse`. */
  posseDoAparelho(address: string, deviceKey: Uint8Array): number {
    const row = this.#db
      .prepare("SELECT geracao FROM device_posse WHERE address = ? AND device_key = ?")
      .get(address, toBase64(deviceKey)) as { geracao: number } | undefined
    return row?.geracao ?? 0
  }

  /**
   * Raise the possession generation of this device, for the import with this tag.
   *
   * The same tag again raises nothing: it is the same copy with two connections.
   * `subiu` tells the caller if there are other copies to close.
   */
  assumirPosse(address: string, deviceKey: Uint8Array, marca: string): { geracao: number; subiu: boolean } {
    const chave = toBase64(deviceKey)
    const atual = this.#db
      .prepare("SELECT geracao, marca FROM device_posse WHERE address = ? AND device_key = ?")
      .get(address, chave) as { geracao: number; marca: string } | undefined
    if (atual?.marca === marca) return { geracao: atual.geracao, subiu: false }
    this.#db
      .prepare(
        `INSERT INTO device_posse (address, device_key, geracao, marca) VALUES (?, ?, 1, ?)
         ON CONFLICT(address, device_key) DO UPDATE SET geracao = geracao + 1, marca = excluded.marca`,
      )
      .run(address, chave, marca)
    return { geracao: this.posseDoAparelho(address, deviceKey), subiu: true }
  }

  /** The most recent manifest this account published, as it came, or `null`. */
  deviceManifestOf(address: string): DeviceManifestWire | null {
    const row = this.#db.prepare("SELECT manifest FROM device_manifests WHERE address = ?").get(address) as
      | { manifest: string }
      | undefined
    if (!row) return null
    // What is in the database passed through `verifyDeviceManifest` on entry. The
    // read goes through the schema again anyway: a row written by hand in the database
    // by an operator should not come out of here as if it were a manifest.
    const parsed = DeviceManifestWire.safeParse(JSON.parse(row.manifest))
    return parsed.success ? parsed.data : null
  }

  // -------------------------------------------------------------------- events

  /**
   * Append to a channel under a per-channel monotonic counter.
   *
   * The counter is what gives clients a total order without trusting anyone's
   * clock. `BEGIN IMMEDIATE` takes the write lock up front so two concurrent
   * senders cannot both read the same max and collide on the primary key.
   *
   * **And one commit per epoch.** This is the only place an event enters the
   * database (the gateway and federation both go through here), and that is why
   * the rule lives here and not in the caller: the check and the write happen in
   * the same transaction, with no path around it. A rejected commit is not stored,
   * and the caller does not broadcast it. See `aceitarCommit`.
   *
   * What counts as a commit is the CONTENT, not the declared `kind`: the client
   * hands to MLS everything that is not Welcome, and a commit sent as `application`
   * would be applied anyway. Proposals, application messages, and Welcomes pass
   * without an epoch check: they do not move the group forward.
   *
   * `refundavel`: whether an epoch 0 commit from this send can restart the channel
   * (the group rebuilt with the same identifier, which is what a client does to
   * its feed and conversations when it loses state, and what `#acceptWelcome`
   * describes as the way a rebuilt channel heals). The caller decides, because it knows
   * who sent it: see `Gateway.#podeRefundar`.
   */
  appendEvent(
    input: {
      channel: string
      kind: string
      ciphertext: Uint8Array
      recipient?: string | undefined
    },
    politica: { refundavel: boolean },
  ): EventoGuardado {
    // Recipient only on a Welcome. A directed event reaches only the address it names,
    // and backfill shows it only to that address: on a Welcome that is what we want; on
    // a commit it would be a commit that counts for the channel epoch but other members
    // never see, and on a message a channel with gaps nobody knows about. No client
    // sends it; it is refused without touching the database.
    if (input.recipient !== undefined && input.kind !== "welcome") {
      return { ok: false, reason: "recipient-not-welcome" }
    }

    return this.#transaction(() => {
      // A Welcome goes to the client's `#acceptWelcome`, never to MLS.
      const epoch = input.kind === "welcome" ? undefined : epochDeCommit(input.ciphertext, input.channel)
      if (epoch !== undefined) {
        const atual = this.epochDoCanal(input.channel)
        // A resend of an already-accepted commit is that commit, not a late one, and
        // it is checked BEFORE the rule, because re-founding would catch a resend of the
        // founder's epoch 0 commit and restart the channel.
        if (atual !== undefined && epoch !== atual) {
          const original = this.#commitGuardado(input.channel, input.ciphertext)
          if (original) return { ok: true as const, event: original, repetido: true }
        }
        const proxima = aceitarCommit(atual, epoch, politica.refundavel)
        if (proxima === undefined) {
          // Refusal only happens with memory of the channel, so `atual` is defined.
          return { ok: false as const, reason: "stale-epoch" as const, epoch: atual as number }
        }
        this.#gravarEpoch(input.channel, proxima)
        this.#descartarCartaoVencido(input.channel, proxima)
      }

      const row = this.#db
        .prepare("SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM events WHERE channel = ?")
        .get(input.channel) as { next: number } | undefined

      const seq = row?.next ?? 0
      const minute = currentMinute()

      this.#db
        .prepare(
          "INSERT INTO events (channel, seq, kind, ciphertext, recipient, received_minute) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(input.channel, seq, input.kind, input.ciphertext, input.recipient ?? null, minute)

      // Marks that this channel has been used; retention does not erase it. See
      // `channelNeverUsed`.
      this.#db.prepare("INSERT OR IGNORE INTO channel_activity (channel) VALUES (?)").run(input.channel)

      return {
        ok: true as const,
        repetido: false,
        event: {
          channel: input.channel,
          seq,
          kind: input.kind,
          ciphertext: toBase64(input.ciphertext),
          recipient: input.recipient ?? null,
          receivedAtMinute: minute,
        },
      }
    })
  }

  /**
   * The event already stored in this channel with exactly these bytes, if any.
   *
   * Called only for a commit that the rule would refuse, which is rare. The
   * `length(...)` goes first so SQLite does not read the large blobs from
   * application messages just to find they have the wrong size.
   */
  #commitGuardado(channel: string, ciphertext: Uint8Array): StoredEvent | undefined {
    const row = this.#db
      .prepare(
        `SELECT channel, seq, kind, ciphertext, recipient, received_minute
           FROM events
          WHERE channel = ? AND kind != 'welcome' AND length(ciphertext) = ? AND ciphertext = ?
          ORDER BY seq DESC
          LIMIT 1`,
      )
      .get(channel, ciphertext.length, ciphertext) as
      | { channel: string; seq: number; kind: string; ciphertext: Uint8Array; recipient: string | null; received_minute: number }
      | undefined
    if (!row) return undefined
    return {
      channel: row.channel,
      seq: row.seq,
      kind: row.kind,
      ciphertext: toBase64(row.ciphertext),
      recipient: row.recipient,
      receivedAtMinute: row.received_minute,
    }
  }

  /** The epoch at which this channel accepts the next commit, or `undefined` with no memory of it. */
  epochDoCanal(channel: string): number | undefined {
    const row = this.#db.prepare("SELECT epoch FROM channel_epochs WHERE channel = ?").get(channel) as
      | { epoch: number }
      | undefined
    return row?.epoch
  }

  #gravarEpoch(channel: string, proxima: number): void {
    this.#db
      .prepare(
        `INSERT INTO channel_epochs (channel, epoch) VALUES (?, ?)
         ON CONFLICT (channel) DO UPDATE SET epoch = excluded.epoch`,
      )
      .run(channel, proxima)
  }

  /**
   * Remove from the database the card that no longer describes the channel epoch.
   *
   * A card only works for the epoch it describes: a client joining with it builds a
   * commit for that epoch, and that commit gets refused. Left here, `hello.ok`
   * would keep saying there is a card, no member would publish another (that is
   * the question the client asks it), and the next newcomer would spend a key
   * package on a dead card.
   */
  #descartarCartaoVencido(channel: string, proxima: number): void {
    const row = this.#db.prepare("SELECT info FROM group_infos WHERE channel = ?").get(channel) as
      | { info: Uint8Array }
      | undefined
    if (row && epochDeCartao(row.info, channel) !== proxima) {
      this.#db.prepare("DELETE FROM group_infos WHERE channel = ?").run(channel)
    }
  }

  /**
   * Give an epoch to channels that do not have one yet, from the stored commits.
   *
   * Runs at startup, and exists for the first run: a database from before this
   * table has every commit and no epoch memory, and without this the first commit
   * from each channel would be accepted at any epoch; in other words, the next
   * lagging member would break the room again.
   *
   * The `aceitarCommit` rule run over history, in arrival order, not
   * the highest number found, and, in a channel that can be re-founded, only from
   * the LAST re-founding: the last epoch 0 commit, by `seq`.
   *
   * Why the last re-founding, not the rule from the start: before this table the
   * server kept every commit, so the history of a feed rebuilt under the same name
   * has the whole old group behind the new one, and sometimes a late commit from
   * the old one AFTER the re-founding (G1 0..20, G2 0, G1 21). The group that stayed
   * is the one from the last re-founding: outside the common room only the founder commits at
   * epoch 0, once per group, so the last epoch 0 commit is the start of the last
   * group.
   *
   * Why no skipping, here too: for the same reason, a group's history is
   * contiguous from its start (retention cuts by age, and so only from the start,
   * which is "no memory"). A commit ahead of it is from another group with the
   * same name, the late G1 21, which with skipping would give 22 and lock G2 at 1.
   * Without decrypting there is no way to tell apart a late commit from the old group
   * that lands EXACTLY on the new group's next epoch (G2 0, then a G1 stuck at 1): it counts. The
   * number still comes out right whenever the new group gets there too, and the case
   * needs an old member stuck at epoch 1 committing after the re-founding. It is the
   * least bad option: the safe alternative (refuse everything until the first live commit)
   * would leave the channel without memory, which is what lets a lagging member break
   * the room.
   *
   * In the common room there is no re-founding, here either: it is only ever created
   * empty, and a late epoch 0 commit there is a join through an old card. It gets
   * the highest epoch plus one from its contiguous history.
   *
   * Idempotent: a channel that already has a row is not touched. A channel with no
   * readable commits stays without a row, and is read again at the next startup
   * (they are only handshakes, and there are few).
   *
   * Cards for ALL channels are reviewed at the end, for the same reason
   * `#descartarCartaoVencido` exists.
   *
   * @param refundavel whether this channel's history can contain re-foundings. The
   * history does not say who sent each commit, so it is per channel: `buildServer`
   * passes all but the common room, including group channels rebuilt before the
   * deploy, which are no longer re-founded live.
   * @returns how many channels gained an epoch.
   */
  inicializarEpochs(refundavel: (channel: string) => boolean): number {
    return this.#transaction(() => {
      const linhas = this.#db
        .prepare(
          `SELECT channel, ciphertext FROM events
            WHERE kind = 'handshake' AND channel NOT IN (SELECT channel FROM channel_epochs)
            ORDER BY channel, seq`,
        )
        .all() as { channel: string; ciphertext: Uint8Array }[]

      const commitsPorCanal = new Map<string, number[]>()
      for (const { channel, ciphertext } of linhas) {
        const epoch = epochDeCommit(ciphertext, channel)
        if (epoch === undefined) continue
        const epochs = commitsPorCanal.get(channel) ?? []
        epochs.push(epoch)
        commitsPorCanal.set(channel, epochs)
      }

      let ganharam = 0
      for (const [channel, epochs] of commitsPorCanal) {
        const inicio = refundavel(channel) ? Math.max(0, epochs.lastIndexOf(0)) : 0
        let proxima: number | undefined
        for (const epoch of epochs.slice(inicio)) proxima = aceitarCommit(proxima, epoch, false) ?? proxima
        if (proxima === undefined) continue
        this.#gravarEpoch(channel, proxima)
        ganharam += 1
      }

      const comCartao = this.#db.prepare("SELECT channel FROM group_infos").all() as { channel: string }[]
      for (const { channel } of comCartao) {
        const proxima = this.epochDoCanal(channel)
        if (proxima !== undefined) this.#descartarCartaoVencido(channel, proxima)
      }
      return ganharam
    })
  }

  /**
   * Events after a given sequence number, oldest first.
   *
   * Order matters more here than anywhere else in this file: MLS commits must
   * be applied in the order they were issued, or the group state diverges. The
   * per-channel `seq` assigned at append time is that order.
   */
  /** Every local account address. Only ever reached in community mode. */
  localAccounts(): string[] {
    return (this.#db.prepare("SELECT address FROM accounts").all() as { address: string }[]).map(
      (row) => row.address,
    )
  }

  /**
   * Trim accumulated welcomes, keeping the latest per user and channel.
   *
   * It exists because a legitimate re-invite claims a new key package and builds a
   * welcome against it: the old one stops opening, and left here it would be
   * redelivered at every login and always fail, the cycle of "no key package
   * matches".
   *
   * It used to keep only ONE, and that premise holds only among honest invites. A forged
   * welcome does not claim any key package: it does not break the legitimate one,
   * it only buries it under a higher `seq`. That alone, from a channel member,
   * was enough to lock someone out forever: the invite had been sent, the server
   * had accepted it, and it never showed up again. Keeping a few instead of one keeps
   * the cycle closed and takes the power to bury away from a single frame.
   */
  pruneSupersededWelcomes(): number {
    const result = this.#db
      .prepare(
        `DELETE FROM events
           WHERE kind = 'welcome' AND recipient IS NOT NULL
             AND seq NOT IN (
               SELECT seq FROM events recentes
                WHERE recentes.recipient = events.recipient
                  AND recentes.channel = events.channel
                  AND recentes.kind = 'welcome'
                ORDER BY recentes.seq DESC
                LIMIT ${WELCOMES_GUARDADOS}
             )`,
      )
      .run()
    return Number(result.changes ?? 0)
  }

  /**
   * Directed welcomes waiting for one address, across every channel.
   *
   * A welcome is how someone learns a channel exists at all, so it cannot be
   * pulled per-channel like everything else, and an offline invitee used to
   * simply never receive it. Delivered at every handshake; already-consumed
   * ones fail silently on the client, which beats the server guessing.
   *
   * ALL that remain are delivered, not just the latest per channel. The client's
   * tolerance for a welcome that does not open is what spares the server from guessing
   * which one is good, and not guessing is what prevents a forged welcome
   * from burying the legitimate one. See `pruneSupersededWelcomes`.
   */
  pendingWelcomes(forAddress: string, limit: number): StoredEvent[] {
    const rows = this.#db
      .prepare(
        `SELECT channel, seq, kind, ciphertext, recipient, received_minute
           FROM events
          WHERE recipient = ? AND kind = 'welcome'
          ORDER BY channel ASC, seq DESC
          LIMIT ?`,
      )
      .all(forAddress, limit) as {
      channel: string
      seq: number
      kind: string
      ciphertext: Uint8Array
      recipient: string | null
      received_minute: number
    }[]
    return rows.map((row) => ({
      channel: row.channel,
      seq: row.seq,
      kind: row.kind,
      ciphertext: toBase64(row.ciphertext),
      recipient: row.recipient,
      receivedAtMinute: row.received_minute,
    }))
  }

  catchUp(channel: string, afterSeq: number, limit: number, forAddress: string): StoredEvent[] {
    const rows = this.#db
      .prepare(
        `SELECT channel, seq, kind, ciphertext, recipient, received_minute
           FROM events
          WHERE channel = ? AND seq > ? AND (recipient IS NULL OR recipient = ?)
          ORDER BY seq ASC
          LIMIT ?`,
      )
      .all(channel, afterSeq, forAddress, limit) as {
      channel: string
      seq: number
      kind: string
      ciphertext: Uint8Array
      recipient: string | null
      received_minute: number
    }[]

    return rows.map((row) => ({
      channel: row.channel,
      seq: row.seq,
      kind: row.kind,
      ciphertext: toBase64(row.ciphertext),
      recipient: row.recipient,
      receivedAtMinute: row.received_minute,
    }))
  }

  backfill(channel: string, beforeSeq: number | undefined, limit: number, forAddress: string): StoredEvent[] {
    const rows = this.#db
      .prepare(
        `SELECT channel, seq, kind, ciphertext, recipient, received_minute
           FROM events
          WHERE channel = ? AND seq < ? AND (recipient IS NULL OR recipient = ?)
          ORDER BY seq DESC
          LIMIT ?`,
      )
      .all(channel, beforeSeq ?? Number.MAX_SAFE_INTEGER, forAddress, limit) as {
      channel: string
      seq: number
      kind: string
      ciphertext: Uint8Array
      recipient: string | null
      received_minute: number
    }[]

    return rows.reverse().map((row) => ({
      channel: row.channel,
      seq: row.seq,
      kind: row.kind,
      ciphertext: toBase64(row.ciphertext),
      recipient: row.recipient,
      receivedAtMinute: row.received_minute,
    }))
  }

  /**
   * Delete anything past the retention window.
   *
   * Not a housekeeping job: a privacy control. Data that no longer exists
   * cannot be seized, subpoenaed or leaked, and there is no legitimate reason
   * for a relay to hold ciphertext it has already delivered.
   */
  expireEvents(retentionDays: number): number {
    if (retentionDays <= 0) {
      return this.#db.prepare("DELETE FROM events").run().changes as number
    }
    const cutoff = currentMinute() - retentionDays * 24 * 60
    return this.#db.prepare("DELETE FROM events WHERE received_minute < ?").run(cutoff).changes as number
  }

  // ------------------------------------------------------------- subscriptions

  subscribe(channel: string, address: string): void {
    this.#db.prepare("INSERT OR IGNORE INTO subscriptions (channel, address) VALUES (?, ?)").run(channel, address)
  }

  unsubscribe(channel: string, address: string): void {
    this.#db.prepare("DELETE FROM subscriptions WHERE channel = ? AND address = ?").run(channel, address)
  }

  localSubscribers(channel: string): string[] {
    const rows = this.#db.prepare("SELECT address FROM subscriptions WHERE channel = ?").all(channel) as {
      address: string
    }[]
    return rows.map((row) => row.address)
  }

  /**
   * Has this account subscribed to this channel before?
   *
   * The server cannot read the ratchet tree, so it cannot know who is truly a
   * member. What it can do is refuse to serve an account that was never seated
   * here by any path, which is the difference between "anyone with an address"
   * and "someone who was once let in". See `mayReach` in the gateway.
   */
  isSubscribed(channel: string, address: string): boolean {
    const row = this.#db
      .prepare("SELECT 1 AS ok FROM subscriptions WHERE channel = ? AND address = ? LIMIT 1")
      .get(channel, address) as { ok: number } | undefined
    return row !== undefined
  }

  /** Is there a welcome in this channel addressed to this account? */
  hasWelcomeFor(channel: string, address: string): boolean {
    const row = this.#db
      .prepare("SELECT 1 AS ok FROM events WHERE channel = ? AND recipient = ? AND kind = 'welcome' LIMIT 1")
      .get(channel, address) as { ok: number } | undefined
    return row !== undefined
  }

  /**
   * How long the designated creator has to create the channel before the role passes
   * to whoever arrives next.
   *
   * Creating an MLS group and publishing the first message takes seconds; two
   * minutes is enough slack for a bad connection and short enough that a dead room
   * does not stay dead for a whole day.
   */
  static readonly CLAIM_GRACE_SECONDS = 120

  /**
   * Claim the creation of a channel. The first to ask wins.
   *
   * Wins, but not forever. The claim used to be permanent, and the server cannot
   * know whether it was honored: it cannot create the group or join it. Then all it took was
   * for the winner not to create the room (closed the app, creation failed, lost
   * the connection in the middle) for the identifier to stay claimed and empty:
   * everyone who arrived afterwards got `mine: false`, asked to join a group that does
   * not exist, and the server's common room became unreachable forever, without
   * a single error anywhere.
   *
   * So the claim expires, but only while the channel is still unused. From the
   * moment there is a message inside, the group exists and the designated creator
   * no longer matters.
   *
   * @returns the address of the designated creator: the caller itself if it
   * won, someone else if it arrived late.
   */
  /**
   * Set the entry card for a channel, replacing what was there.
   *
   * Replace, don't accumulate: only the most recent one matters, because a card
   * is valid for the epoch it describes and the previous one no longer lets
   * anyone in. Whether THIS channel can have a card is decided by the gateway,
   * and the answer is always the same: the common channel and no other.
   *
   * **Only the card for the channel's epoch.** It used to replace whatever was there,
   * and a lagging member would put its epoch's card on top of the good one:
   * the common room once had an external commit made from an epoch 6 card while
   * the group was at 13, and whoever entered that way opened another branch. A
   * card from an epoch in the FUTURE also doesn't go in: it describes a commit
   * this server refused, and whoever picked it up would join a branch only that
   * commit's author knows. With no memory of the channel's epoch, it goes in as
   * it used to.
   *
   * A card that can't be read, or that belongs to another group, doesn't either.
   * It would help no one (the client rejects it before using it), and
   * storing it would cost the newcomer two things: the good card it hides,
   * and the pickup, which is single-use.
   */
  putGroupInfo(channel: string, info: Uint8Array): CartaoGuardado {
    return this.#transaction(() => {
      const epoch = epochDeCartao(info, channel)
      if (epoch === undefined) return { ok: false as const, reason: "illegible" as const }
      const proxima = this.epochDoCanal(channel)
      if (proxima !== undefined && epoch !== proxima) {
        return { ok: false as const, reason: "stale-groupinfo" as const, epoch: proxima }
      }
      this.#db
        .prepare(
          `INSERT INTO group_infos (channel, info, at_minute) VALUES (?, ?, ?)
           ON CONFLICT (channel) DO UPDATE SET info = excluded.info, at_minute = excluded.at_minute`,
        )
        .run(channel, info, currentMinute())
      return { ok: true as const }
    })
  }

  /**
   * Take the card, and leave it taken.
   *
   * One delivery and the card is gone. This is what stops two newcomers arriving
   * at the same moment from taking the same card: the two commits that would follow
   * would race for the same epoch, the room would accept one, and the other
   * would end up with a group only it knows, with the right name and no one
   * inside. See `group.externo.test.ts`, which measures exactly this.
   *
   * The card replenishes itself: whoever joins publishes the next one, and any
   * member that connects publishes one if it's missing.
   */
  takeGroupInfo(channel: string): Uint8Array | undefined {
    return this.#transaction(() => {
      const row = this.#db.prepare("SELECT info FROM group_infos WHERE channel = ?").get(channel) as
        | { info: Uint8Array }
        | undefined
      if (!row) return undefined
      this.#db.prepare("DELETE FROM group_infos WHERE channel = ?").run(channel)
      return row.info
    })
  }

  /** Is a card waiting for the next newcomer? So a member doesn't publish over it. */
  hasGroupInfo(channel: string): boolean {
    const row = this.#db.prepare("SELECT 1 AS ok FROM group_infos WHERE channel = ? LIMIT 1").get(channel) as
      | { ok: number }
      | undefined
    return row !== undefined
  }

  claimChannel(channel: string, owner: string): string {
    return this.#transaction(() => {
      const now = currentSecond()
      const row = this.#db.prepare("SELECT owner, at_second FROM channel_claims WHERE channel = ?").get(channel) as
        | { owner: string; at_second: number }
        | undefined

      const caducou = now - (row?.at_second ?? now) >= Store.CLAIM_GRACE_SECONDS && this.channelNeverUsed(channel)
      if (row && !caducou) return row.owner

      this.#db
        .prepare(
          `INSERT INTO channel_claims (channel, owner, at_second) VALUES (?, ?, ?)
           ON CONFLICT (channel) DO UPDATE SET owner = excluded.owner, at_second = excluded.at_second`,
        )
        .run(channel, owner, now)
      return owner
    })
  }

  /**
   * Nothing is said in this channel, and nothing ever has been.
   *
   * This is what a channel looks like at the moment its creator makes it, and
   * letting any account subscribe to these is what keeps channel creation
   * working without handing out third-party feeds.
   *
   * Both halves are needed. "No events" alone doesn't tell a new channel from a
   * private room whose thirty days retention has deleted: after a month of silence,
   * any account in the world could subscribe to it again and write inside (and
   * five frames of garbage are enough for each member to declare itself deaf and
   * for the history to be lost to forward secrecy). The activity marker is not erased
   * by retention, and it's what closes that.
   */
  channelNeverUsed(channel: string): boolean {
    const event = this.#db.prepare("SELECT 1 AS ok FROM events WHERE channel = ? LIMIT 1").get(channel) as
      | { ok: number }
      | undefined
    if (event !== undefined) return false
    const past = this.#db.prepare("SELECT 1 AS ok FROM channel_activity WHERE channel = ? LIMIT 1").get(channel) as
      | { ok: number }
      | undefined
    return past === undefined
  }

  addChannelPeer(channel: string, server: ServerName): void {
    this.#db.prepare("INSERT OR IGNORE INTO channel_peers (channel, server) VALUES (?, ?)").run(channel, server)
  }

  channelPeers(channel: string): ServerName[] {
    const rows = this.#db.prepare("SELECT server FROM channel_peers WHERE channel = ?").all(channel) as {
      server: string
    }[]
    return rows.map((row) => row.server as ServerName)
  }

  // -------------------------------------------------------------- key packages

  /**
   * Store key packages for an account, assigned to a device.
   *
   * `device` is the public key of the device that signs the leaves of these
   * packages, or `null` when unknown (client 0.2.3 with no chain at login).
   *
   * **`replace` deletes those of THIS device and those with `device IS NULL`.** Those
   * of other devices stay: they're from another machine with its own pool and
   * its own private halves, and deleting them would make that machine
   * uninvitable until it connects again. Rows with no device are from before
   * September 22, 2026, or from a client with no chain, and they're deleted
   * because they may be from a reinstalled vault whose private half was lost:
   * serving one of those is the worst failure there is (the invite is accepted,
   * the package is spent, and the user never gets in; see `keypackage.publish`
   * in wire.ts). A client that says `replace` is saying "what was here, I can
   * no longer open", and what has no declared owner counts as its own.
   */
  publishKeyPackages(address: string, packages: Uint8Array[], replace = false, device: Uint8Array | null = null): void {
    const insert = this.#db.prepare("INSERT INTO key_packages (address, package, device) VALUES (?, ?, ?)")
    this.#transaction(() => {
      // Dropping the old batch is the client's call, not ours: only it knows
      // whether it still holds the private halves.
      if (replace) {
        if (device === null) {
          this.#db.prepare("DELETE FROM key_packages WHERE address = ? AND claimed = 0 AND device IS NULL").run(address)
        } else {
          this.#db
            .prepare("DELETE FROM key_packages WHERE address = ? AND claimed = 0 AND (device = ? OR device IS NULL)")
            .run(address, device)
        }
      }
      for (const pkg of packages) insert.run(address, pkg, device)
    })
  }

  /**
   * Hand out exactly one key package, then burn it.
   *
   * Serving the same package twice would let two groups derive the same init
   * secret, which silently breaks forward secrecy for both. The read and the
   * mark are one transaction so a race cannot produce a double-serve.
   *
   * With `device`, a package from THAT device and no other: rows with no device
   * don't count, because we don't know who they're from. Without `device`, the
   * usual behavior: the most recent for the account, whatever device it's from.
   * This is what a `keypackage.claim` without `bundle` gets, and it spends one.
   */
  claimKeyPackage(address: string, device?: Uint8Array): Uint8Array | undefined {
    return this.#transaction(() => this.#reclamarUm(address, device))
  }

  /**
   * Read and mark for a claim, WITHOUT a transaction: the caller opens one.
   * `device === null` means "only those with no device"; `undefined` means "from
   * anyone".
   */
  #reclamarUm(address: string, device: Uint8Array | null | undefined): Uint8Array | undefined {
    // Newest first. An older package is likelier to be one whose owner has
    // since reinstalled and lost the private half, and serving one of those
    // fails in the worst possible way: the invitation is accepted, the package
    // is consumed, and the person silently never joins.
    const row = (
      device === undefined
        ? this.#db
            .prepare("SELECT id, package FROM key_packages WHERE address = ? AND claimed = 0 ORDER BY id DESC LIMIT 1")
            .get(address)
        : device === null
          ? this.#db
              .prepare(
                "SELECT id, package FROM key_packages WHERE address = ? AND device IS NULL AND claimed = 0 ORDER BY id DESC LIMIT 1",
              )
              .get(address)
          : this.#db
              .prepare(
                "SELECT id, package FROM key_packages WHERE address = ? AND device = ? AND claimed = 0 ORDER BY id DESC LIMIT 1",
              )
              .get(address, device)
    ) as { id: number; package: Uint8Array } | undefined
    if (!row) return undefined

    this.#db.prepare("UPDATE key_packages SET claimed = 1 WHERE id = ?").run(row.id)
    return row.package
  }

  /**
   * One package per device in the account's manifest, all in the same transaction.
   *
   * **The manifest decides, and the `devices` table is not consulted.** The table
   * is what the server saw at logins, rotated by age; the manifest is
   * what the account signed. A device that the account lists and that rotation
   * has already removed from the table is still served; one that's in the table
   * and the account doesn't list is not. This is the only reading that's
   * consistent with the client, which checks each package against the manifest
   * and never against a table it can't see. (Closes C3 in docs/PENDENTES.md.)
   *
   * `devices`, if given, restricts to the requested devices, and a request that
   * isn't in the manifest is ignored: the inviter only asks for the devices
   * missing from its tree, so it doesn't spend packages of devices already there.
   *
   * **Partial failure policy:** a device from the manifest with no package to
   * claim is not an error. The devices with packages get in, and the inviting client
   * repairs the rest via `seat` when the device publishes again. When NONE of
   * the requested devices has a package, the most recent with no device is served (`device IS
   * NULL`): this is the pool from before September 22, 2026, and the credential
   * inside says which device it is, which the client checks against the
   * manifest. We don't fall back to "the most recent from any device" because
   * that would spend a package from a device already in the tree, which the
   * client would throw away.
   *
   * Without a manifest, the account is a single-device account (or from a client
   * that never published one), and the answer is the singular claim's answer.
   */
  claimBundle(
    address: string,
    devices?: string[],
  ): { manifest: DeviceManifestWire | null; packages: { deviceKey: string; keyPackage: Uint8Array }[]; fallback: Uint8Array | undefined } {
    return this.#transaction(() => {
      const manifest = this.deviceManifestOf(address)
      if (manifest === null) return { manifest: null, packages: [], fallback: this.#reclamarUm(address, undefined) }

      const pedidos = devices === undefined ? null : new Set(devices)
      const packages: { deviceKey: string; keyPackage: Uint8Array }[] = []
      for (const { deviceKey } of manifest.devices) {
        if (pedidos !== null && !pedidos.has(deviceKey)) continue
        const keyPackage = this.#reclamarUm(address, fromBase64(deviceKey))
        if (keyPackage) packages.push({ deviceKey, keyPackage })
      }
      if (packages.length > 0) return { manifest, packages, fallback: undefined }
      return { manifest, packages, fallback: this.#reclamarUm(address, null) }
    })
  }

  /**
   * How many unclaimed packages the account, or one of its devices, has.
   *
   * With `device`, count those from that device AND those with no device: for a
   * 0.2.3 client whose entire pool has no device, this is the only answer that
   * doesn't make it re-upload twenty packages on every connect after seeing zero.
   */
  availableKeyPackages(address: string, device?: Uint8Array): number {
    const row = (
      device === undefined
        ? this.#db.prepare("SELECT COUNT(*) AS count FROM key_packages WHERE address = ? AND claimed = 0").get(address)
        : this.#db
            .prepare(
              "SELECT COUNT(*) AS count FROM key_packages WHERE address = ? AND claimed = 0 AND (device = ? OR device IS NULL)",
            )
            .get(address, device)
    ) as { count: number } | undefined
    return row?.count ?? 0
  }

  // ------------------------------------------------------------------ invites

  /**
   * Store an invite and return its short code (slice 4 of 1.0).
   *
   * The same hash again in the same channel (a client retrying the request)
   * returns the code it already had, and gives it one if it's an invite from
   * before the column. The same hash in another channel doesn't touch the
   * existing row and returns nothing: an invite's code belongs to whoever can
   * see the invite, and a client registering someone else's hash in another
   * channel is not that client.
   */
  createInvite(input: {
    codeHash: string
    channel: string
    expiresAt: number | null
    maxUses: number | null
    /** The public key of the code proof, or nothing (a 0.9.x client). See `prova-do-convite.ts`. */
    codeKey?: string
    /** The sealed channel name, or nothing. The server doesn't read it. See `selo-do-convite.ts`. */
    selo?: string
  }): string | undefined {
    return this.#transaction(() => {
      this.#db
        .prepare(
          `INSERT INTO invites (code_hash, channel, expires_at, max_uses, created_second, code_key, selo) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (code_hash) DO NOTHING`,
        )
        .run(input.codeHash, input.channel, input.expiresAt, input.maxUses, currentSecond(), input.codeKey ?? null, input.selo ?? null)
      const linha = this.#db.prepare("SELECT channel, short_code FROM invites WHERE code_hash = ?").get(input.codeHash) as
        | { channel: string; short_code: string | null }
        | undefined
      if (!linha || linha.channel !== input.channel) return undefined
      return linha.short_code ?? this.#darCodigoCurto(input.codeHash)
    })
  }

  /**
   * Draw a free short code and write it to this invite's row.
   *
   * The unique index is the referee: a code that already exists makes the UPDATE
   * fail, and we draw another. With 31^8 codes and a small server's live invites,
   * a collision is rare and two in a row rarer still; the attempt limit exists
   * so a flaw in the draw doesn't turn into an endless loop.
   */
  #darCodigoCurto(codeHash: string): string {
    const gravar = this.#db.prepare("UPDATE invites SET short_code = ? WHERE code_hash = ?")
    for (let tentativa = 0; tentativa < 16; tentativa++) {
      const codigo = sortearCodigoCurto()
      try {
        gravar.run(codigo, codeHash)
        return codigo
      } catch (error) {
        if (!String((error as Error).message).includes("UNIQUE")) throw error
      }
    }
    throw new Error("could not find a free short invite code")
  }

  /**
   * The invite for a short code, if it is still valid: channel and hash.
   *
   * Same rules as `redeemInvite` (deadline, uses), without spending anything.
   * An expired invite is deleted when found, as there.
   */
  resolveShortCode(
    codigo: string,
  ):
    | { ok: true; channel: string; codeHash: string; selo?: string }
    | { ok: false; reason: "unknown" | "expired" | "exhausted" } {
    const row = this.#db
      .prepare("SELECT code_hash, channel, expires_at, max_uses, uses, selo FROM invites WHERE short_code = ?")
      .get(codigo) as
      | { code_hash: string; channel: string; expires_at: number | null; max_uses: number | null; uses: number; selo: string | null }
      | undefined
    if (!row) return { ok: false, reason: "unknown" }
    const recusa = this.#conviteQueJaNaoVale(row)
    if (recusa) return { ok: false, reason: recusa }
    return { ok: true, channel: row.channel, codeHash: row.code_hash, ...(row.selo === null ? {} : { selo: row.selo }) }
  }

  /**
   * The seal of an invite by `codeHash`, if the invite is still valid (1.0
   * "Arca", slice 5c). This is the path for the long link, which has no short
   * code. Same rules as `resolveShortCode`, without spending anything. `undefined`
   * for an invite that doesn't exist, that is no longer valid, or with no seal:
   * to the caller, all three look the same.
   */
  seloDoConvite(codeHash: string): string | undefined {
    const row = this.#db
      .prepare("SELECT code_hash, expires_at, max_uses, uses, selo FROM invites WHERE code_hash = ?")
      .get(codeHash) as
      | { code_hash: string; expires_at: number | null; max_uses: number | null; uses: number; selo: string | null }
      | undefined
    if (!row || this.#conviteQueJaNaoVale(row)) return undefined
    return row.selo ?? undefined
  }

  /** Deadline and uses, like in `redeemInvite`. An expired invite is deleted when found. */
  #conviteQueJaNaoVale(row: {
    code_hash: string
    expires_at: number | null
    max_uses: number | null
    uses: number
  }): "expired" | "exhausted" | null {
    if (row.expires_at !== null && row.expires_at <= currentSecond()) {
      this.#db.prepare("DELETE FROM invites WHERE code_hash = ?").run(row.code_hash)
      return "expired"
    }
    if (row.max_uses !== null && row.uses >= row.max_uses) return "exhausted"
    return null
  }

  revokeInvite(codeHash: string): void {
    this.#db.prepare("DELETE FROM invites WHERE code_hash = ?").run(codeHash)
  }

  /**
   * Minute of the last storage reset, if there was one.
   *
   * Written by hand by whoever wipes the database; read at every `hello`. It's the
   * only reliable sign that the client's state became orphaned: the server
   * doesn't know which MLS groups exist (the keys are in each user's vault), and so it
   * has no other way to say so.
   */
  resetAtMinute(): number | undefined {
    return this.#minuteMarker("reset_at_minute")
  }

  /**
   * Minute from which only new accounts count.
   *
   * Different from `resetAtMinute`, and the difference is the point: clearing
   * storage leaves accounts standing and only takes away their rooms; this
   * declares the earlier identities themselves obsolete. It's for cutting off
   * a set of accounts all at once (after a test phase, for example, when old
   * files have been imported around and no one knows which is which) without
   * relying on each user to delete theirs by hand.
   *
   * Written by hand by whoever does the cut. The client compares it to the
   * birth date of the identity it has in the vault.
   */
  accountsResetAtMinute(): number | undefined {
    return this.#minuteMarker("accounts_reset_at_minute")
  }

  #minuteMarker(key: string): number | undefined {
    const row = this.#db.prepare("SELECT value FROM server_meta WHERE key = ?").get(key) as
      | { value: string }
      | undefined
    if (!row) return undefined
    const n = Number(row.value)
    return Number.isFinite(n) && n >= 0 ? n : undefined
  }

  /** Which channel an invite belongs to, so the gateway can check who may revoke it. */
  channelOfInvite(codeHash: string): string | undefined {
    const row = this.#db.prepare("SELECT channel FROM invites WHERE code_hash = ?").get(codeHash) as
      | { channel: string }
      | undefined
    return row?.channel
  }

  listInvites(
    channel: string,
  ): { codeHash: string; expiresAt: number | null; maxUses: number | null; uses: number; codigoCurto?: string }[] {
    const rows = this.#db
      .prepare(
        "SELECT code_hash, expires_at, max_uses, uses, short_code FROM invites WHERE channel = ? ORDER BY created_second DESC",
      )
      .all(channel) as {
      code_hash: string
      expires_at: number | null
      max_uses: number | null
      uses: number
      short_code: string | null
    }[]
    return rows.map((row) => ({
      codeHash: row.code_hash,
      expiresAt: row.expires_at,
      maxUses: row.max_uses,
      uses: row.uses,
      // Missing, not `null`, in an invite from before the column: the wire schema
      // is `optional`, and a 0.9 client never saw the field.
      ...(row.short_code === null ? {} : { codigoCurto: row.short_code }),
    }))
  }

  /**
   * Spend one use of an invite, if it is still valid.
   *
   * The check and the increment are one transaction: two people redeeming the
   * last use of a code at the same instant must not both succeed, or "max uses"
   * would be advisory rather than a limit.
   */
  redeemInvite(
    codeHash: string,
    /**
     * The code proof, checked against the invite's key (`code_key`, NULL in a
     * 0.9.x invite) BEFORE spending the use. A false proof answers `unknown`, like an
     * invite that doesn't exist: the answer doesn't tell someone who only has the
     * hash that the invite is there. See `prova-do-convite.ts`.
     */
    provaValida: (codeKey: string | null) => boolean = () => true,
  ): { ok: true; channel: string } | { ok: false; reason: "unknown" | "expired" | "exhausted" } {
    return this.#transaction(() => {
      const row = this.#db
        .prepare("SELECT channel, expires_at, max_uses, uses, code_key FROM invites WHERE code_hash = ?")
        .get(codeHash) as
        | { channel: string; expires_at: number | null; max_uses: number | null; uses: number; code_key: string | null }
        | undefined

      if (!row) return { ok: false as const, reason: "unknown" as const }
      if (!provaValida(row.code_key)) return { ok: false as const, reason: "unknown" as const }

      if (row.expires_at !== null && row.expires_at <= currentSecond()) {
        // Expired codes are deleted on discovery rather than left to accumulate.
        this.#db.prepare("DELETE FROM invites WHERE code_hash = ?").run(codeHash)
        return { ok: false as const, reason: "expired" as const }
      }

      if (row.max_uses !== null && row.uses >= row.max_uses) {
        return { ok: false as const, reason: "exhausted" as const }
      }

      this.#db.prepare("UPDATE invites SET uses = uses + 1 WHERE code_hash = ?").run(codeHash)
      return { ok: true as const, channel: row.channel }
    })
  }

  expireInvites(): number {
    return this.#db
      .prepare("DELETE FROM invites WHERE expires_at IS NOT NULL AND expires_at <= ?")
      .run(currentSecond()).changes as number
  }

  /** Who is in charge of creating this channel, if anyone is. */
  claimantOf(channel: string): string | undefined {
    const row = this.#db.prepare("SELECT owner FROM channel_claims WHERE channel = ?").get(channel) as
      | { owner: string }
      | undefined
    return row?.owner
  }

  /**
   * Delete claims that no longer decide anything.
   *
   * A claim past its grace period, on a channel that's still unused,
   * is inert: `claimChannel` writes over it at the next request, and so deleting
   * it changes nothing about who wins. What changes is that the table stops
   * growing forever (and it grows faster since the unused-channel
   * tolerance started consulting claims) (see `#mayOpen` in the gateway).
   *
   * A claim on a channel ALREADY USED stays where it is. It costs nothing
   * and it's not worth the risk: it's what the client reads so it doesn't create
   * a second MLS group with the same identifier.
   */
  expireChannelClaims(): number {
    const cutoff = currentSecond() - Store.CLAIM_GRACE_SECONDS
    return this.#db
      .prepare(
        `DELETE FROM channel_claims
           WHERE at_second <= ?
             AND channel NOT IN (SELECT channel FROM channel_activity)
             AND channel NOT IN (SELECT channel FROM events)`,
      )
      .run(cutoff).changes as number
  }

  // ---------------------------------------------------------------- federation

  /** Returns false if this (origin, nonce) was already seen, i.e. a replay. */
  recordNonce(origin: ServerName, nonce: string): boolean {
    const result = this.#db
      .prepare("INSERT OR IGNORE INTO federation_nonces (origin, nonce, seen_second) VALUES (?, ?, ?)")
      .run(origin, nonce, currentSecond())
    return result.changes === 1
  }

  expireNonces(windowSeconds: number): void {
    this.#db.prepare("DELETE FROM federation_nonces WHERE seen_second < ?").run(currentSecond() - windowSeconds)
  }

  cachePeerKey(server: ServerName, keyId: string, publicKey: Uint8Array, validUntil: number): void {
    this.#db
      .prepare(
        `INSERT INTO peer_keys (server, key_id, public_key, valid_until) VALUES (?, ?, ?, ?)
         ON CONFLICT (server, key_id) DO UPDATE SET public_key = excluded.public_key, valid_until = excluded.valid_until`,
      )
      .run(server, keyId, publicKey, validUntil)
  }

  peerKey(server: ServerName, keyId: string): Uint8Array | undefined {
    const row = this.#db
      .prepare("SELECT public_key FROM peer_keys WHERE server = ? AND key_id = ? AND valid_until > ?")
      .get(server, keyId, currentSecond()) as { public_key: Uint8Array } | undefined
    return row?.public_key
  }

  enqueueOutbound(destination: ServerName, payload: string): void {
    this.#db
      .prepare("INSERT INTO outbox (destination, payload, next_try) VALUES (?, ?, ?)")
      .run(destination, payload, currentSecond())
  }

  dueOutbound(limit: number): { id: number; destination: ServerName; payload: string; attempts: number }[] {
    const rows = this.#db
      .prepare("SELECT id, destination, payload, attempts FROM outbox WHERE next_try <= ? ORDER BY id LIMIT ?")
      .all(currentSecond(), limit) as { id: number; destination: string; payload: string; attempts: number }[]
    return rows.map((row) => ({ ...row, destination: row.destination as ServerName }))
  }

  completeOutbound(id: number): void {
    this.#db.prepare("DELETE FROM outbox WHERE id = ?").run(id)
  }

  /** Exponential backoff, abandoning after 12 tries (~a day of retries). */
  deferOutbound(id: number, attempts: number): void {
    if (attempts >= 12) {
      this.#db.prepare("DELETE FROM outbox WHERE id = ?").run(id)
      return
    }
    const delay = Math.min(2 ** attempts, 3600)
    this.#db
      .prepare("UPDATE outbox SET attempts = ?, next_try = ? WHERE id = ?")
      .run(attempts + 1, currentSecond() + delay, id)
  }

  // ------------------------------------------------------------------- cofre

  /** The counters for a scope, or zeros if it has no vault yet. */
  #metaDoCofre(escopo: string): MetaDoCofre {
    const row = this.#db
      .prepare("SELECT versao_global, bytes, entradas, lapides, podado_ate FROM cofres_meta WHERE escopo = ?")
      .get(escopo) as
      | { versao_global: number; bytes: number; entradas: number; lapides: number; podado_ate: number }
      | undefined
    if (!row) return { versaoGlobal: 0, bytes: 0, entradas: 0, lapides: 0, podadoAte: 0 }
    return {
      versaoGlobal: row.versao_global,
      bytes: row.bytes,
      entradas: row.entradas,
      lapides: row.lapides,
      podadoAte: row.podado_ate,
    }
  }

  #gravarMetaDoCofre(escopo: string, meta: MetaDoCofre): void {
    this.#db
      .prepare(
        `INSERT INTO cofres_meta (escopo, versao_global, bytes, entradas, lapides, podado_ate) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (escopo) DO UPDATE SET versao_global = excluded.versao_global, bytes = excluded.bytes,
           entradas = excluded.entradas, lapides = excluded.lapides, podado_ate = excluded.podado_ate`,
      )
      .run(escopo, meta.versaoGlobal, meta.bytes, meta.entradas, meta.lapides, meta.podadoAte)
  }

  #linhaDoCofre(escopo: string, chave: string): { versao: number; tamanho: number; lapide: boolean } | undefined {
    const row = this.#db
      .prepare("SELECT versao, length(conteudo) AS tamanho, lapide FROM cofres WHERE escopo = ? AND chave = ?")
      .get(escopo, chave) as { versao: number; tamanho: number; lapide: number } | undefined
    return row ? { versao: row.versao, tamanho: row.tamanho, lapide: row.lapide === 1 } : undefined
  }

  /**
   * Write entries to a vault in a single transaction.
   *
   * Each entry goes through this order, and the first to fail is the reason:
   * padding (multiple of `COFRE_BALDE_BYTES`), cap per entry, CAS
   * (`versaoEsperada` equal to the current version of the key, 0 if it does not
   * exist), and room in the scope (live entries and live bytes). A refused one
   * changes nothing; the others go in. Each accepted one gets the next version of
   * the scope, and two entries with the same key in the same frame are two
   * consecutive writes.
   *
   * The server does not read the content, or try to: it measures it.
   */
  cofrePut(escopo: string, entradas: readonly EntradaParaOCofre[], limites: LimitesDoEscopo): ResultadoDoPut {
    return this.#transaction(() => {
      const meta = this.#metaDoCofre(escopo)
      const aceites: ResultadoDoPut["aceites"] = []
      const recusadas: ResultadoDoPut["recusadas"] = []
      let bytesAceites = 0
      const minuto = currentMinute()
      const escrever = this.#db.prepare(
        `INSERT INTO cofres (escopo, chave, versao, conteudo, lapide, epoch, at_minute) VALUES (?, ?, ?, ?, 0, NULL, ?)
         ON CONFLICT (escopo, chave) DO UPDATE SET versao = excluded.versao, conteudo = excluded.conteudo, lapide = 0,
           epoch = NULL, at_minute = excluded.at_minute`,
      )
      for (const entrada of entradas) {
        const tamanho = entrada.conteudo.length
        if (tamanho === 0 || tamanho % COFRE_BALDE_BYTES !== 0) {
          recusadas.push({ chave: entrada.chave, razao: "acolchoamento" })
          continue
        }
        if (tamanho > limites.entradaMaxBytes) {
          recusadas.push({ chave: entrada.chave, razao: "tecto" })
          continue
        }
        const actual = this.#linhaDoCofre(escopo, entrada.chave)
        const versaoActual = actual?.versao ?? 0
        if (entrada.versaoEsperada !== undefined && entrada.versaoEsperada !== versaoActual) {
          recusadas.push({ chave: entrada.chave, razao: "versao", versao: versaoActual })
          continue
        }
        const viva = actual !== undefined && !actual.lapide
        const entradasDepois = meta.entradas + (viva ? 0 : 1)
        const bytesDepois = meta.bytes - (viva ? actual.tamanho : 0) + tamanho
        if (entradasDepois > limites.entradas || bytesDepois > limites.bytes) {
          recusadas.push({ chave: entrada.chave, razao: "tecto" })
          continue
        }
        meta.versaoGlobal += 1
        meta.entradas = entradasDepois
        meta.bytes = bytesDepois
        if (actual?.lapide) meta.lapides -= 1
        escrever.run(escopo, entrada.chave, meta.versaoGlobal, entrada.conteudo, minuto)
        aceites.push({ chave: entrada.chave, versao: meta.versaoGlobal })
        bytesAceites += tamanho
      }
      if (aceites.length > 0) this.#gravarMetaDoCofre(escopo, meta)
      return { aceites, recusadas, versaoGlobal: meta.versaoGlobal, bytesAceites }
    })
  }

  /**
   * Delete an entry, leaving a tombstone with a new version.
   *
   * The tombstone stays so a delta reader knows the entry is gone.
   * So the scope doesn't grow forever from writes and deletes of new keys,
   * tombstones above `lapidesMax` are pruned from oldest to newest, and
   * `podado_ate` remembers the highest version pruned: whoever asks for a delta
   * from before it gets the whole vault (`cofreGet`, `completo`).
   */
  cofreDel(escopo: string, chave: string, versaoEsperada: number | undefined, lapidesMax: number): ResultadoDoDel {
    return this.#transaction(() => {
      const meta = this.#metaDoCofre(escopo)
      const actual = this.#linhaDoCofre(escopo, chave)
      const versaoActual = actual?.versao ?? 0
      if (versaoEsperada !== undefined && versaoEsperada !== versaoActual) {
        return { razao: "versao" as const, versaoActual, versaoGlobal: meta.versaoGlobal }
      }
      if (!actual || actual.lapide) return { razao: "inexistente" as const, versaoActual, versaoGlobal: meta.versaoGlobal }
      meta.versaoGlobal += 1
      meta.entradas -= 1
      meta.bytes -= actual.tamanho
      meta.lapides += 1
      this.#db
        .prepare(
          "UPDATE cofres SET versao = ?, conteudo = ?, lapide = 1, epoch = NULL, at_minute = ? WHERE escopo = ? AND chave = ?",
        )
        .run(meta.versaoGlobal, new Uint8Array(0), currentMinute(), escopo, chave)
      if (meta.lapides > lapidesMax) {
        const aPodar = meta.lapides - lapidesMax
        const podadas = this.#db
          .prepare("SELECT chave, versao FROM cofres WHERE escopo = ? AND lapide = 1 ORDER BY versao LIMIT ?")
          .all(escopo, aPodar) as { chave: string; versao: number }[]
        const apagar = this.#db.prepare("DELETE FROM cofres WHERE escopo = ? AND chave = ?")
        for (const podada of podadas) {
          apagar.run(escopo, podada.chave)
          if (podada.versao > meta.podadoAte) meta.podadoAte = podada.versao
        }
        meta.lapides -= podadas.length
      }
      this.#gravarMetaDoCofre(escopo, meta)
      return { versao: meta.versaoGlobal, versaoActual: meta.versaoGlobal, versaoGlobal: meta.versaoGlobal }
    })
  }

  /**
   * A page of what changed in a scope since `desdeVersao`, in version order.
   *
   * **The whole vault (`completo`) in three cases:** asked from 0; asked from
   * before tombstones already pruned (the delta would no longer say what left); or
   * asked from a version this scope never issued (the server was wiped or
   * restored from a backup: the caller has state that no longer exists here,
   * and must be told).
   *
   * **By pages:** a page's content doesn't exceed `orcamentoBytes` (there's always
   * at least one row) or `maxLinhas`. First read just versions and sizes, so
   * we don't load into memory what won't fit; then the content of what fits.
   * `ate` is the highest version in the page, and the next page is requested from there.
   */
  cofreGet(escopo: string, desdeVersao: number, orcamentoBytes: number, maxLinhas: number): PaginaDoCofre {
    const meta = this.#metaDoCofre(escopo)
    const completo = desdeVersao === 0 || desdeVersao < meta.podadoAte || desdeVersao > meta.versaoGlobal
    const desde = completo ? 0 : desdeVersao
    const cabecas = this.#db
      .prepare("SELECT versao, length(conteudo) AS tamanho FROM cofres WHERE escopo = ? AND versao > ? ORDER BY versao LIMIT ?")
      .all(escopo, desde, maxLinhas + 1) as { versao: number; tamanho: number }[]
    let usados = 0
    let corte = 0
    for (const cabeca of cabecas.slice(0, maxLinhas)) {
      if (corte > 0 && usados + cabeca.tamanho > orcamentoBytes) break
      usados += cabeca.tamanho
      corte += 1
    }
    const mais = corte < cabecas.length
    const ate = corte === 0 ? meta.versaoGlobal : mais ? (cabecas[corte - 1] as { versao: number }).versao : meta.versaoGlobal
    const linhas =
      corte === 0
        ? []
        : (this.#db
            .prepare("SELECT chave, versao, conteudo, lapide FROM cofres WHERE escopo = ? AND versao > ? AND versao <= ? ORDER BY versao")
            .all(escopo, desde, (cabecas[corte - 1] as { versao: number }).versao) as {
            chave: string
            versao: number
            conteudo: Uint8Array
            lapide: number
          }[])
    const entradas: PaginaDoCofre["entradas"] = []
    const lapides: PaginaDoCofre["lapides"] = []
    for (const linha of linhas) {
      if (linha.lapide === 1) lapides.push({ chave: linha.chave, versao: linha.versao })
      else entradas.push({ chave: linha.chave, versao: linha.versao, conteudo: linha.conteudo })
    }
    return { versaoGlobal: meta.versaoGlobal, completo, ate, mais, entradas, lapides }
  }

  /** The versions of the scopes that have a vault, from among these. Those without stay out (version 0). */
  cofreVersoes(escopos: readonly string[]): { escopo: string; versaoGlobal: number }[] {
    if (escopos.length === 0) return []
    const rows = this.#db
      .prepare(
        "SELECT escopo, versao_global FROM cofres_meta WHERE versao_global > 0 AND escopo IN (SELECT value FROM json_each(?)) ORDER BY escopo",
      )
      .all(JSON.stringify(escopos)) as { escopo: string; versao_global: number }[]
    return rows.map((row) => ({ escopo: row.escopo, versaoGlobal: row.versao_global }))
  }

  /** The counters for a scope, for tests and for the operator. No content. */
  cofreContadores(escopo: string): MetaDoCofre {
    return this.#metaDoCofre(escopo)
  }

  /**
   * Sweep of vaults for channels with no subscribers (decision D7).
   *
   * Off by default: only runs if the operator sets `ENCLAVE_COFRE_GC_DIAS`
   * (see `app.ts`). Each pass looks at every `canal:` scope: with someone
   * subscribed, clear the mark; with no one and no mark, mark the minute; with
   * no one and the mark older than `dias`, delete the channel vault. `conta:`
   * scopes are not swept: an account does not cease to exist on this server,
   * and its vault is its own.
   *
   * @returns how many channel vaults were deleted.
   */
  varrerCofres(agoraMinuto: number, dias: number): number {
    if (dias <= 0) return 0
    return this.#transaction(() => {
      const metas = this.#db
        .prepare("SELECT escopo, sem_subscritores_desde FROM cofres_meta WHERE escopo LIKE 'canal:%'")
        .all() as { escopo: string; sem_subscritores_desde: number | null }[]
      const temSubscritores = this.#db.prepare("SELECT 1 AS ok FROM subscriptions WHERE channel = ? LIMIT 1")
      const marcar = this.#db.prepare("UPDATE cofres_meta SET sem_subscritores_desde = ? WHERE escopo = ?")
      let apagados = 0
      for (const meta of metas) {
        const canal = meta.escopo.slice("canal:".length)
        if (temSubscritores.get(canal) !== undefined) {
          if (meta.sem_subscritores_desde !== null) marcar.run(null, meta.escopo)
          continue
        }
        if (meta.sem_subscritores_desde === null) {
          marcar.run(agoraMinuto, meta.escopo)
          continue
        }
        if (agoraMinuto - meta.sem_subscritores_desde >= dias * 24 * 60) {
          this.#db.prepare("DELETE FROM cofres WHERE escopo = ?").run(meta.escopo)
          this.#db.prepare("DELETE FROM cofres_meta WHERE escopo = ?").run(meta.escopo)
          apagados += 1
        }
      }
      return apagados
    })
  }
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number)
  return diff === 0
}

/**
 * A random short code, from the 31 symbols in `ALFABETO_DO_CODIGO_CURTO`.
 *
 * By rejection, not by remainder: 256 is not a multiple of 31, and `byte % 31`
 * would give the first nine symbols extra probability. A byte only counts if it's less
 * than 248 (31 × 8, the largest multiple that fits), and the remainder from
 * that is uniform. We lose a byte in every 32, and ask for twice as many to
 * almost never have to ask again.
 */
const SIMBOLOS = ALFABETO_DO_CODIGO_CURTO.length
const TECTO_SEM_VIES = Math.floor(256 / SIMBOLOS) * SIMBOLOS

function sortearCodigoCurto(): string {
  let codigo = ""
  while (codigo.length < CODIGO_CURTO_CARACTERES) {
    for (const byte of randomBytes(CODIGO_CURTO_CARACTERES * 2)) {
      if (byte >= TECTO_SEM_VIES) continue
      codigo += ALFABETO_DO_CODIGO_CURTO[byte % SIMBOLOS]
      if (codigo.length === CODIGO_CURTO_CARACTERES) break
    }
  }
  return codigo
}
