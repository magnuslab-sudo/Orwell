import { addMembers, createChannel, decodeKeyPackage, encryptPayload, generateKeyPackages } from "@enclave/crypto"
import { fromBase64, generateIdentity, identityFromPrivateKey, parseServerName, toBase64, type FriendTie, type Payload } from "@enclave/protocol"
import { ed25519 } from "@noble/curves/ed25519.js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Session } from "./session.js"
import { entradasDoCanal, Vault, type VaultBackend } from "./vault.js"
import { canalComFicha, moradaNova } from "../testes/moradas.js"

/**
 * **A declined friendship cannot reappear as a pending request.**
 *
 * `backfillBefore` reconstructs what fell behind, and runs on any device that
 * lags, a closed laptop, a phone with no signal. Until October 5, 2026 it
 * reconstructed two of four friendship events: `friend.request` and
 * `friend.accept`. The other two were dropped.
 *
 * The LIVE path (`#recordPayload`) handles all four, and its comment already
 * said why, "a forgotten decline on reload would reopen the request; a
 * forgotten break would make reconciliation reseat who had been removed". The
 * reconstruction did not, so the state depended on which path the events had
 * entered this device by.
 *
 * What is measured here: Bento receives a request and a decline through
 * `backfillBefore`, and his Friends do NOT show any pending request.
 */

class MemoryBackend implements VaultBackend {
  bytes: Uint8Array | null = null
  readonly supportsOsProtection = false
  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    this.bytes = bytes
  }
  async clear(): Promise<void> {
    this.bytes = null
  }
}

interface Sent {
  t: string
  [key: string]: unknown
}

class FakeSocket {
  static last: FakeSocket | null = null
  static reply: (frame: Sent) => unknown[] | undefined = () => undefined

  readyState = 0
  readonly sent: Sent[] = []
  readonly #listeners = new Map<string, ((event: unknown) => void)[]>()

  constructor(readonly url: string) {
    FakeSocket.last = this
    setTimeout(() => {
      this.readyState = 1
      this.#fire("open", {})
    }, 0)
  }

  addEventListener(kind: string, handler: (event: unknown) => void, options?: { once?: boolean }): void {
    const wrapped = options?.once
      ? (event: unknown): void => {
          this.removeEventListener(kind, wrapped)
          handler(event)
        }
      : handler
    this.#listeners.set(kind, [...(this.#listeners.get(kind) ?? []), wrapped])
  }

  removeEventListener(kind: string, handler: (event: unknown) => void): void {
    this.#listeners.set(kind, (this.#listeners.get(kind) ?? []).filter((item) => item !== handler))
  }

  send(raw: string): void {
    const frame = JSON.parse(raw) as Sent
    this.sent.push(frame)
    for (const reply of FakeSocket.reply(frame) ?? []) {
      setTimeout(() => this.#fire("message", { data: JSON.stringify(reply) }), 0)
    }
  }

  empurrar(frame: unknown): void {
    setTimeout(() => this.#fire("message", { data: JSON.stringify(frame) }), 0)
  }

  close(): void {
    this.readyState = 3
    this.#fire("close", {})
  }

  #fire(kind: string, event: unknown): void {
    for (const handler of [...(this.#listeners.get(kind) ?? [])]) handler(event)
  }
}

const CANAL = moradaNova()
const CASA = parseServerName("localhost:8448")

function respostaBase(frame: Sent): unknown[] | undefined {
  if (frame.t === "hello") return [{ t: "hello.ok", version: 1, capabilities: [], retentionDays: 30 }]
  if (frame.t === "auth.begin") return [{ t: "auth.challenge", nonce: "AAAA" }]
  if (frame.t === "auth.finish") return [{ t: "auth.ok", address: "@x:localhost:8448" }]
  if (frame.t === "channel.send") {
    return [
      {
        t: "channel.event",
        channel: frame.channel,
        seq: 900 + Math.floor(Math.random() * 90),
        kind: frame.kind,
        ciphertext: frame.ciphertext,
        receivedAtMinute: 0,
        ...(frame.ref !== undefined ? { ref: frame.ref } : {}),
      },
    ]
  }
  // Normal recovery brings nothing: what matters is what `backfillBefore`
  // reconstructs, and it gets called by hand lower down.
  if (frame.t === "channel.backfill" && frame.afterSeq !== undefined) {
    return [{ t: "channel.backfill.page", channel: frame.channel, more: false, events: [] }]
  }
  return undefined
}

let abertas: Session[] = []

async function assentar(vezes = 60): Promise<void> {
  for (let i = 0; i < vezes; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

async function bentoLigado(): Promise<{ session: Session; vault: Vault; socket: FakeSocket; backend: MemoryBackend }> {
  const backend = new MemoryBackend()
  const vault = new Vault(backend)
  await vault.create("frase-passe")
  const session = new Session(vault)
  abertas.push(session)
  await session.createIdentity("localhost:8448")
  await session.connect()
  await assentar(20)
  const socket = FakeSocket.last
  if (!socket) throw new Error("sem socket")
  return { session, vault, socket, backend }
}

/**
 * THE SAME VAULT, READ FROM DISK. This is where the fix is measured.
 *
 * The core of this fix is "it is from the vault that `#friendEvents` reads",
 * and asserting about `vault.contents` in memory does not measure that: it has
 * happened in this project to write the live content and the save comes out
 * early with "nothing is dirty", all tests green and the disk saying something
 * else. The gaps file does this well since October 5, 2026, and this one now
 * does the same.
 */
async function reabrir(backend: MemoryBackend): Promise<{ session: Session; vault: Vault }> {
  const vault = new Vault(backend)
  await vault.unlock("frase-passe")
  const session = new Session(vault)
  abertas.push(session)
  session.loadIdentity()
  return { session, vault }
}

function keyPackagesPublicados(socket: FakeSocket): Uint8Array[] {
  const publicacao = socket.sent.find((frame) => frame.t === "keypackage.publish")
  const wires = publicacao?.packages as string[] | undefined
  if (!wires || wires.length < 1) throw new Error("o Bento não publicou key packages")
  return wires.map(fromBase64)
}

/**
 * Ana and Bento in a two-member channel, and what she said to him there.
 *
 * Two members on purpose: it is from the tree that `#parDoCanal` figures out who
 * the conversation is with, and that answer is what makes the friendship fold
 * work without a direct record in the vault.
 */
async function conversaDaAna(socket: FakeSocket, ditos: Payload[]): Promise<{
  ana: string
  welcome: string
  eventos: { seq: number; kind: "application"; ciphertext: string; receivedAtMinute: number }[]
}> {
  const ana = generateIdentity(CASA)
  let grupo = await createChannel(ana, CANAL)

  const pacote = keyPackagesPublicados(socket)[0]
  if (!pacote) throw new Error("faltam key packages do Bento")
  const convite = await addMembers(grupo, [decodeKeyPackage(pacote)])
  grupo = convite.session

  const eventos: { seq: number; kind: "application"; ciphertext: string; receivedAtMinute: number }[] = []
  for (const [indice, dito] of ditos.entries()) {
    const cifrado = await encryptPayload(grupo, dito)
    grupo = cifrado.session
    eventos.push({
      seq: 1 + indice,
      kind: "application",
      ciphertext: toBase64(cifrado.ciphertext),
      receivedAtMinute: Math.floor(Date.now() / 60_000),
    })
  }

  return { ana: ana.address, welcome: toBase64(convite.welcome), eventos }
}

beforeEach(() => {
  FakeSocket.reply = respostaBase
  FakeSocket.last = null
  abertas = []
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  for (const session of abertas) session.disconnect()
  abertas = []
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})

describe("a reconstrução das amizades", () => {
  it("os quatro acontecimentos chegam ao cofre, e não dois", async () => {
    const { session, vault, socket, backend } = await bentoLigado()
    const conversa = await conversaDaAna(socket, [
      { t: "friend.request", sentAt: 1_700_000_000_000 },
      { t: "friend.accept", acceptedAt: 1_700_000_000_001 },
      { t: "friend.decline", declinedAt: 1_700_000_000_002 },
      { t: "friend.remove", removedAt: 1_700_000_000_003 },
    ])

    socket.empurrar({
      t: "channel.event",
      channel: CANAL,
      seq: 0,
      kind: "welcome",
      ciphertext: conversa.welcome,
      receivedAtMinute: 0,
    })
    await assentar(200)
    expect(session.channels).toContain(CANAL)

    FakeSocket.reply = (frame) => {
      const base = respostaBase(frame)
      if (frame.t === "channel.backfill" && frame.beforeSeq !== undefined) {
        return [{ t: "channel.backfill.page", channel: CANAL, more: false, events: conversa.eventos }]
      }
      return base
    }
    // Four, not two. It was `2` before this fix, and the two that were dropped
    // were exactly the ones that CLOSE a link.
    expect(await session.backfillBefore(CANAL, 10)).toBe(4)
    await assentar(60)
    await session.flush()
    session.disconnect()
    await assentar(40)

    // FROM DISK, not from memory: see `reabrir`.
    const voltou = await reabrir(backend)
    const guardados = entradasDoCanal(voltou.vault.contents, CANAL).map((entrada) => entrada.payload.t)
    expect(guardados).toContain("friend.request")
    expect(guardados).toContain("friend.accept")
    expect(guardados).toContain("friend.decline")
    expect(guardados).toContain("friend.remove")

    /*
      Why `friend.decline` is measured by VAULT and not by the fold.
      
      `foldFriendTies` has a rule on purpose: each side only closes the OTHER's
      request (see the `case "friend.decline"` there). A decline from Ana closes
      a request from Bento, and a request from Bento leaves this device with `seq`
      -1, it never goes round the server, so it never comes in a recovery page.
      Whoever has one of OUR declines arriving here is a second device of the same
      account, and that is the next slice.
      
      What this fix ensures is its job: that the event is SAVED, because it is
      from the vault that `#friendEvents` reads. Without it, a friendship's state
      depended on which path the events had entered this device by.
      */
  }, 120_000)

  it("uma amizade desfeita não volta a aparecer como amizade", async () => {
    const { session, vault, socket } = await bentoLigado()
    const conversa = await conversaDaAna(socket, [
      { t: "friend.request", sentAt: 1_700_000_000_000 },
      { t: "friend.accept", acceptedAt: 1_700_000_000_001 },
      { t: "friend.remove", removedAt: 1_700_000_000_002 },
    ])

    socket.empurrar({
      t: "channel.event",
      channel: CANAL,
      seq: 0,
      kind: "welcome",
      ciphertext: conversa.welcome,
      receivedAtMinute: 0,
    })
    await assentar(200)

    FakeSocket.reply = (frame) => {
      const base = respostaBase(frame)
      if (frame.t === "channel.backfill" && frame.beforeSeq !== undefined) {
        return [{ t: "channel.backfill.page", channel: CANAL, more: false, events: conversa.eventos }]
      }
      return base
    }
    expect(await session.backfillBefore(CANAL, 10)).toBe(3)
    await assentar(60)

    expect(entradasDoCanal(vault.contents, CANAL).map((entrada) => entrada.payload.t)).toContain("friend.remove")
    // Without the `friend.remove`, reconciliation would reseat in the feed who had
    // already been removed. See `syncFriendships`.
    const tie = session.friendTies().get(conversa.ana)
    expect(tie?.link).not.toBe("amigos")
    expect(tie?.severed).toBe(true)
  }, 120_000)

  /**
   * **THE SERVER DOES NOT CHOOSE THE EVENT'S POSITION, and this gate was the fix
   * above that opened it.**
   *
   * `mergeOlderHistory` PREFIXES the page (`[...fresh, ...existing]`) and filters
   * only by unknown `seq`; the friendship fold consumes by ARRAY ORDER and not by
   * timestamps, on purpose, because timestamps come from the sender. Put the two
   * together and a `friend.remove` delivered in a backfill page, with `seq` above
   * the requested limit, becomes older than the `request` and `accept` already
   * saved: the fold reads it first, the `request` that comes after erases its
   * `severed`, and the removed person counts as a live link again, with `seq`
   * marked as known, so never delivered in the right place again.
   *
   * Before October 5, 2026 this gate was CLOSED, because backfill did not
   * reconstruct `decline` or `remove`. It closes where the contract holds: a
   * backfill page brings what is older than the limit, and the rest does not
   * enter.
   *
   * **What is asserted is the ORDER, not the final state, and that is an
   * argument for the guard, not a property of prefixing.** IN THIS fixture the
   * state with the event in the wrong place equals the state without it, because
   * the page brings only the break and what is saved has the last word in the
   * fold; measuring the state could not tell them apart, so we measure the order.
   * In general it is not true that prefixing is harmless: with a `remove` saved
   * and a `request` prefixed in front of it, the state CHANGES. What is asserted,
   * then, is what the guard ensures, the array gets `seq` in order, which is the
   * premise the fold lives on, and what its absence cost: `seq` gets marked as
   * known, which neutralizes the event for good, because once misplaced it is
   * never delivered in the right place again.
   */
  it("uma página com eventos acima do limite não entra, e a ordem do cofre fica de pé", async () => {
    const { session, vault, socket } = await bentoLigado()
    const conversa = await conversaDaAna(socket, [
      { t: "friend.request", sentAt: 1_700_000_000_000 },
      { t: "friend.remove", removedAt: 1_700_000_000_001 },
    ])
    const [pedido, corte] = conversa.eventos
    if (!pedido || !corte) throw new Error("faltam eventos")

    socket.empurrar({
      t: "channel.event",
      channel: CANAL,
      seq: 0,
      kind: "welcome",
      ciphertext: conversa.welcome,
      receivedAtMinute: 0,
    })
    await assentar(200)

    // First, the request by an honest path: it gets saved, and the oldest entry
    // in the channel becomes `seq` 1.
    FakeSocket.reply = (frame) => {
      const base = respostaBase(frame)
      if (frame.t === "channel.backfill" && frame.beforeSeq !== undefined) {
        return [{ t: "channel.backfill.page", channel: CANAL, more: false, events: [pedido] }]
      }
      return base
    }
    expect(await session.backfillBefore(CANAL, 10)).toBe(1)
    await assentar(60)
    expect(session.friendTies().get(conversa.ana)?.link).toBe("pedido-recebido")

    /*
      And now the break, in a page asked with the limit at the oldest (1) and
      served with `seq` 2, above it. It is the kind of page a wrong or hostile
      server can serve, and needs nothing more than to choose what goes in it.
    */
    FakeSocket.reply = (frame) => {
      const base = respostaBase(frame)
      if (frame.t === "channel.backfill" && frame.beforeSeq !== undefined) {
        return [{ t: "channel.backfill.page", channel: CANAL, more: false, events: [corte] }]
      }
      return base
    }
    expect(await session.backfillBefore(CANAL)).toBe(0)
    await assentar(60)

    const guardadas = entradasDoCanal(vault.contents, CANAL)
    expect(guardadas.map((entrada) => entrada.payload.t)).not.toContain("friend.remove")
    // The fold's premise, stated in full: the array's order is the `seq` order.
    // Without the guard this was `[2, 1]`.
    expect(guardadas.map((entrada) => entrada.seq)).toEqual([1])
  }, 120_000)

  /**
   * **IN A CHANNEL AT THE CAP, THE BOOK ENTERS THE SAME; and what is returned is
   * what stayed.**
   *
   * Until October 20, 2026 this was a no-op, and the test measured its honesty:
   * the cap took entries just prefixed and the call returned zero. Since the sync
   * audit's F1, the book (friendships and invites) does not count toward the cap,
   * so what the reconstruction brings STAYS, and that is what the number says. The
   * paragraph below is the story of why the number is what stayed and not what was
   * decoded, and it still holds.
   *
   * `enforceHistoryLimits` does `splice(0, list.length - 400)` in the SAME
   * mutation that `mergeOlderHistory` prefixed the page, and the entries just
   * prefixed are exactly what the cut removes. `backfillBefore` returned
   * `recovered.length`, what it decoded, not what stayed, so the call claimed
   * it had gone well and friendship reconstruction was a silent no-op on all full
   * channels.
   *
   * Recovery itself is not fixed here (a channel at the cap has nowhere to save
   * what is older than the cap, and that is in `docs/PENDENTES.md`). What is
   * fixed is the lie.
   */
  it("num canal no tecto o livro entra na mesma, e devolve o que ficou", async () => {
    const { session, vault, socket } = await bentoLigado()
    const conversa = await conversaDaAna(socket, [
      { t: "friend.request", sentAt: 1_700_000_000_000 },
      { t: "friend.remove", removedAt: 1_700_000_000_001 },
    ])

    socket.empurrar({
      t: "channel.event",
      channel: CANAL,
      seq: 0,
      kind: "welcome",
      ciphertext: conversa.welcome,
      receivedAtMinute: 0,
    })
    await assentar(200)

    // The channel full to the cap, with all `seq` above the backfill's.
    await vault.update((contents) => {
      contents.history[CANAL] = Array.from({ length: 400 }, (_item, indice) => ({
        seq: 100 + indice,
        sender: "@ana:localhost:8448",
        at: indice,
        payload: { t: "message", id: `cheio-${indice}`, sentAt: indice, body: "x", attachments: [], mentions: [] },
      }))
    })

    FakeSocket.reply = (frame) => {
      const base = respostaBase(frame)
      if (frame.t === "channel.backfill" && frame.beforeSeq !== undefined) {
        return [{ t: "channel.backfill.page", channel: CANAL, more: false, events: conversa.eventos }]
      }
      return base
    }
    // Decoded two and saved both: they are from the book, and the book does not
    // count toward the cap. Before F1 they were zero, cut in the same step they entered.
    expect(await session.backfillBefore(CANAL)).toBe(2)
    await assentar(60)
    expect(entradasDoCanal(vault.contents, CANAL).length).toBe(402)
    expect(entradasDoCanal(vault.contents, CANAL).map((entrada) => entrada.payload.t)).toContain("friend.remove")
  }, 120_000)

  /**
   * **THE FOLD READS BY SERVER ORDER, NOT BY ARRAY ORDER.**
   *
   * The guard of the test above closes the gate through which a PAGE entered out
   * of place. This measures the other one, which prefixing does not have:
   * `appendHistory` PUSHES TO THE END without sorting, and everything the server
   * delivers goes through it, live, by recovery, and by a gap request
   * (`#pedirLacunas`, which asks one event at a time, long after the rest of the
   * channel is saved).
   *
   * A `friend.remove` with `seq` 1 saved AFTER a `request` with `seq` 2 ends up
   * after it in the array and before it in time. The fold read request→remove and
   * called a link UNDONE that never ended, and with the loop to reseat that was
   * in `syncFriendships` for a few hours, that was a destructive, automatic commit
   * with no warning. The loop is gone (`docs/PENDENTES.md`); the disorder is
   * fixed here, at the root, because it affects more than that.
   *
   * **And our sends do not go to the end**, which was the obvious alternative and
   * is measured in the second half of this test: one OUR request (`seq` -1, never
   * goes round the server) followed by their decline would read decline→request,
   * and a declined request reappeared as pending.
   */
  it("um corte de `seq` mais baixo guardado depois não desfaz uma ligação viva", async () => {
    const { session, vault } = await bentoLigado()
    const ANA = "@ana:localhost:8448"
    /*
      Written to the vault by hand, and it is the honest way to measure it: what
      is asserted is what `#friendEvents` does with an unsorted array, and the
      path that produces it (`appendHistory`, by a gap asked later) is named in
      the header. Making it happen inside would force building a hole and a gap
      request to measure a two-line read.
    */
    await vault.update((contents) => {
      contents.history[CANAL] = [
        { seq: 2, sender: ANA, at: 2, payload: { t: "friend.request", sentAt: 2 } },
        { seq: 1, sender: ANA, at: 1, payload: { t: "friend.remove", removedAt: 1 } },
      ]
    })

    const tie = session.friendTies().get(ANA)
    // Without the sort this was `severed: true` and `link: "nenhum"`: the cut read
    // after the request it precedes.
    expect(tie?.severed).toBe(false)
    expect(tie?.link).toBe("pedido-recebido")
  }, 120_000)

  it("um pedido nosso não salta para trás de uma recusa que lhe respondeu", async () => {
    const { session, vault } = await bentoLigado()
    const eu = session.identity.address
    const BERTA = "@berta:localhost:8448"
    // A direct conversation by the RECORD: it is from there the fold gets who was
    // one of our sends, and this channel is not one this device has. See `#parDoCanal`.
    const DM = canalComFicha(vault.contents, { tipo: "directa", par: BERTA })
    await vault.update((contents) => {
      contents.history[DM] = [
        { seq: -1, sender: eu, at: 1, payload: { t: "friend.request", sentAt: 1 } },
        { seq: 20, sender: BERTA, at: 2, payload: { t: "friend.decline", declinedAt: 2 } },
      ]
    })

    // Request and then declined: nothing waiting for a reply. With the `seq` -1 at
    // the END, the decline read first, and it only closes the other side's request,
    // so our request opened again as `request-sent`.
    expect(session.friendTies().get(BERTA)?.link).toBe("nenhum")
  }, 120_000)

  /**
   * **A withdrawal (`decline` with `withdrawn`) reads by server order, like the
   * other acts** (phase 1 of the friendship plan, 10/20/2026).
   *
   * Saved before the request it cancels, read by array order, left the request
   * open forever: on our side a "Sent" that does not close, on her side a request
   * to answer that was already taken back.
   */
  it("um cancelamento guardado antes do pedido que cancela fecha-o na mesma", async () => {
    const { session, vault } = await bentoLigado()
    const eu = session.identity.address
    const DORA = "@dora:localhost:8448"
    const DM = canalComFicha(vault.contents, { tipo: "directa", par: DORA })
    await vault.update((contents) => {
      contents.history[DM] = [
        // Ours: both with the echo's `seq`, the withdrawal ahead in the array.
        { seq: 12, sender: eu, at: 2, payload: { t: "friend.decline", declinedAt: 2, withdrawn: true } },
        { seq: 11, sender: eu, at: 1, payload: { t: "friend.request", sentAt: 1 } },
      ]
      contents.history[CANAL] = [
        // Hers, by the same disorder.
        { seq: 3, sender: "@ana:localhost:8448", at: 4, payload: { t: "friend.decline", declinedAt: 4, withdrawn: true } },
        { seq: 2, sender: "@ana:localhost:8448", at: 3, payload: { t: "friend.request", sentAt: 3 } },
      ]
    })
    // Without sorting, this was `request-sent`: the withdrawal read before the request.
    expect(session.friendTies().get(DORA)?.link).toBe("nenhum")
    expect(session.sentFriendRequests()).toEqual([])
    expect(session.friendTies().get("@ana:localhost:8448")?.link).toBe("nenhum")
    expect(session.openFriendRequests()).toEqual([])
  }, 120_000)

  it("um pedido cruzado não se cancela: aceita-se ou recusa-se", async () => {
    const { session, vault } = await bentoLigado()
    const eu = session.identity.address
    const EVA = "@eva:localhost:8448"
    const DM = canalComFicha(vault.contents, { tipo: "directa", par: EVA })
    await vault.update((contents) => {
      contents.history[DM] = [
        { seq: 1, sender: eu, at: 1, payload: { t: "friend.request", sentAt: 1 } },
        { seq: 2, sender: EVA, at: 2, payload: { t: "friend.request", sentAt: 2 } },
      ]
    })
    expect(session.friendTies().get(EVA)?.link).toBe("cruzado")
    await expect(session.cancelFriendRequest(EVA)).rejects.toThrow("there is no friend request to cancel")
  }, 120_000)

  /**
   * The block filter also in reconstruction: what someone blocked said in the
   * direct does not enter the vault behind (`backfillBefore`).
   */
  it("a reconstrução não guarda o que um bloqueado disse na directa", async () => {
    const { session, vault, socket } = await bentoLigado()
    const eu = session.identity.address
    const ana = generateIdentity(CASA)
    const DM = canalComFicha(vault.contents, { tipo: "directa", par: ana.address })
    let grupo = await createChannel(ana, DM)
    const pacote = keyPackagesPublicados(socket)[0]
    if (!pacote) throw new Error("faltam key packages do Bento")
    const convite = await addMembers(grupo, [decodeKeyPackage(pacote)])
    grupo = convite.session
    const eventos: { seq: number; kind: "application"; ciphertext: string; receivedAtMinute: number }[] = []
    for (const [indice, dito] of ([
      { t: "friend.request", sentAt: 1 },
      { t: "message", id: "m-bloqueada-1", sentAt: 2, body: "olá", attachments: [], mentions: [], links: [] },
    ] as Payload[]).entries()) {
      const cifrado = await encryptPayload(grupo, dito)
      grupo = cifrado.session
      eventos.push({ seq: 1 + indice, kind: "application", ciphertext: toBase64(cifrado.ciphertext), receivedAtMinute: 0 })
    }
    socket.empurrar({ t: "channel.event", channel: DM, seq: 0, kind: "welcome", ciphertext: toBase64(convite.welcome), receivedAtMinute: 0 })
    await assentar(200)
    expect(session.channels).toContain(DM)
    await session.block(ana.address)

    FakeSocket.reply = (frame) => {
      const base = respostaBase(frame)
      if (frame.t === "channel.backfill" && frame.beforeSeq !== undefined) {
        return [{ t: "channel.backfill.page", channel: DM, more: false, events: eventos }]
      }
      return base
    }
    expect(await session.backfillBefore(DM, 10)).toBe(0)
    await assentar(60)
    expect(entradasDoCanal(vault.contents, DM).map((entrada) => entrada.payload.t)).toEqual([])
    expect(session.openFriendRequests()).toEqual([])
  }, 120_000)

  /**
   * **A withdrawal in flight is not run over by the request resend**
   * (e2e-friendship-ui, 10/20/2026: failed 3 in 6 runs under load).
   *
   * The direct grows (another Ana device enters) while Bento's withdrawal waits
   * for the echo. The resend of the last act (`#reenviarUltimoActo`) read the
   * request as last, because the withdrawal was not in the vault yet, and
   * repeated it AFTER the withdrawal: the request reopened on both sides, with
   * the same `sentAt`, and Bento's interface hid it by judging it withdrawn.
   */
  it("com um cancelamento à espera do eco, a directa a crescer não repete o pedido", async () => {
    const reenvio = Session.REENVIO_MS
    Session.REENVIO_MS = 20
    try {
      const { session, socket, vault } = await bentoLigado()
      const eu = session.identity.address
      const ana = generateIdentity(CASA)
      const DM = canalComFicha(vault.contents, { tipo: "directa", par: ana.address })
      let grupo = await createChannel(ana, DM)
      const pacote = keyPackagesPublicados(socket)[0]
      if (!pacote) throw new Error("faltam key packages do Bento")
      const convite = await addMembers(grupo, [decodeKeyPackage(pacote)])
      grupo = convite.session
      socket.empurrar({ t: "channel.event", channel: DM, seq: 0, kind: "welcome", ciphertext: toBase64(convite.welcome), receivedAtMinute: 0 })
      await assentar(200)
      expect(session.channels).toContain(DM)

      await session.sendFriendRequest(DM)
      await assentar(200)
      expect(session.friendTies().get(ana.address)?.link).toBe("pedido-enviado")

      // From here the server saves what it receives and does not echo: the withdrawal waits.
      const retidos: Sent[] = []
      FakeSocket.reply = (frame) => {
        if (frame.t === "channel.send" && frame.channel === DM && frame.kind === "application") {
          retidos.push(frame)
          return []
        }
        return respostaBase(frame)
      }
      const cancelamento = session.cancelFriendRequest(ana.address)
      for (let volta = 0; volta < 200 && retidos.length === 0; volta++) await assentar(1)
      expect(retidos).toHaveLength(1)

      // The direct grows: a second Ana device enters, in one of her commits.
      const telemovel = identityFromPrivateKey(ana.signingPrivateKey, CASA, ed25519.utils.randomSecretKey())
      const [doTelemovel] = await generateKeyPackages(telemovel, 1)
      if (!doTelemovel) throw new Error("sem pacote do telemóvel")
      const crescimento = await addMembers(grupo, [doTelemovel.publicPackage])
      socket.empurrar({ t: "channel.event", channel: DM, seq: 1_999, kind: "handshake", ciphertext: toBase64(crescimento.commit), receivedAtMinute: 0 })
      await new Promise((resolve) => setTimeout(resolve, Session.REENVIO_MS * 10))
      await assentar(100)
      // Only the withdrawal left: the request was not repeated over it.
      expect(retidos.map((frame) => frame.ciphertext)).toHaveLength(1)

      // The echo arrives, and the withdrawal is done.
      const [enviado] = retidos
      FakeSocket.reply = respostaBase
      socket.empurrar({ t: "channel.event", channel: DM, seq: 2_000, kind: "application", ciphertext: enviado?.ciphertext, ref: enviado?.ref, receivedAtMinute: 0 })
      await cancelamento
      await assentar(100)
      expect(session.friendTies().get(ana.address)?.link).toBe("nenhum")
    } finally {
      Session.REENVIO_MS = reenvio
    }
  }, 120_000)

  it("o cancelamento recuperado por backfill chega ao cofre com o campo, e o pedido não fica por responder", async () => {
    const { session, socket, backend } = await bentoLigado()
    const conversa = await conversaDaAna(socket, [
      { t: "friend.request", sentAt: 1_700_000_000_000 },
      { t: "friend.decline", declinedAt: 1_700_000_000_001, withdrawn: true },
    ])
    socket.empurrar({ t: "channel.event", channel: CANAL, seq: 0, kind: "welcome", ciphertext: conversa.welcome, receivedAtMinute: 0 })
    await assentar(200)
    FakeSocket.reply = (frame) => {
      const base = respostaBase(frame)
      if (frame.t === "channel.backfill" && frame.beforeSeq !== undefined) {
        return [{ t: "channel.backfill.page", channel: CANAL, more: false, events: conversa.eventos }]
      }
      return base
    }
    expect(await session.backfillBefore(CANAL, 10)).toBe(2)
    await assentar(60)
    await session.flush()
    session.disconnect()
    await assentar(40)

    const voltou = await reabrir(backend)
    const cancelamento = entradasDoCanal(voltou.vault.contents, CANAL).find((entrada) => entrada.payload.t === "friend.decline")
    expect(cancelamento?.payload["withdrawn"]).toBe(true)
    expect(voltou.session.openFriendRequests()).toEqual([])
    expect(voltou.session.friendTies().get(conversa.ana)?.link).toBe("nenhum")
  }, 120_000)

  /**
   * **AND THE SAME DISORDER IN INVITES, where what's lost is a spot.**
   *
   * `foldInviteTies` discards a response that finds no invite (`if (!tie)
   * continue`), and it's a safety guard: without it, just saying "accept" to an
   * invite nobody made would do. Read out of order, that guard eats a valid
   * acceptance, and there's no second read, because reconciliation
   * (`syncChannelInvites`) runs over the same fold in all later connections.
   * Who accepted never shows up, and nothing on the screen says so.
   *
   * The shape is measured with the two events of real `seq`, which is the case
   * of a SECOND device on the same account: there our own invite comes through
   * the server, with its number, and might arrive after the response.
   */
  it("uma resposta a convite guardada antes do convite não perde o lugar", async () => {
    const { session, vault } = await bentoLigado()
    const eu = session.identity.address
    const DM = canalComFicha(vault.contents, { tipo: "directa", par: "@clara:localhost:8448" })
    const SALA = moradaNova()
    const agora = Date.now()
    await vault.update((contents) => {
      contents.history[DM] = [
        {
          seq: 2,
          sender: "@clara:localhost:8448",
          at: agora,
          payload: { t: "message", id: "r1", sentAt: agora, body: "", inviteReply: { channel: SALA, accepted: true, at: agora } },
        },
        {
          seq: 1,
          sender: eu,
          at: agora,
          payload: { t: "message", id: "c1", sentAt: agora, body: "", invite: { channel: SALA, at: agora } },
        },
      ]
    })

    const convite = [...session.channelInvites().values()][0]
    expect(convite?.target).toBe(SALA)
    // Without sorting this was "pending": the accept fell through the `if (!tie)` and
    // the seat was never given.
    expect(convite?.state).toBe("aceite")
  }, 120_000)
})

/**
 * **An accept that did not go out is not saved as done** (F2, audit 10/20/2026).
 *
 * `#sendPayload` saved the payload to the vault BEFORE sending it, and `#send`
 * throws without a link. A `friend.accept` with the socket closed stayed in the
 * vault: the fold on this side said "friends", the other side never knew, and
 * the request vanished from the screen with no way to retry it. Now the book is
 * saved with the server's echo, and with its `seq`.
 */
describe("o livro só se grava com o eco do servidor", () => {
  it("aceitar com o socket fechado deixa o pedido por responder, e aceitar outra vez envia", async () => {
    const { session, vault, socket } = await bentoLigado()
    const conversa = await conversaDaAna(socket, [{ t: "friend.request", sentAt: 1_700_000_000_000 }])
    socket.empurrar({ t: "channel.event", channel: CANAL, seq: 0, kind: "welcome", ciphertext: conversa.welcome, receivedAtMinute: 0 })
    await assentar(200)
    const pedido = conversa.eventos[0]
    if (!pedido) throw new Error("sem pedido")
    socket.empurrar({ t: "channel.event", channel: CANAL, ...pedido })
    await assentar(200)
    expect(session.friendTies().get(conversa.ana)?.link).toBe("pedido-recebido")

    // The seat in the feed is not what is measured here: it is taken for granted.
    vi.spyOn(session, "acceptFollower").mockResolvedValue()

    socket.close()
    await expect(session.acceptFriend(CANAL, conversa.ana)).rejects.toThrow("no connection to the server")
    await session.flush()
    expect(session.friendTies().get(conversa.ana)?.link).toBe("pedido-recebido")
    expect(entradasDoCanal(vault.contents, CANAL).map((entrada) => entrada.payload.t)).not.toContain("friend.accept")

    // The link comes back on its own, and accepting again is accepting for real.
    const fim = Date.now() + 10_000
    while (Date.now() < fim && !(FakeSocket.last !== socket && session.connection === "online")) await assentar(20)
    const nova = FakeSocket.last
    if (!nova || nova === socket) throw new Error("a ligação não voltou")
    await assentar(100)
    const antes = nova.sent.filter((frame) => frame.t === "channel.send" && frame.channel === CANAL).length
    await session.acceptFriend(CANAL, conversa.ana)
    expect(nova.sent.filter((frame) => frame.t === "channel.send" && frame.channel === CANAL).length).toBe(antes + 1)
    expect(session.friendTies().get(conversa.ana)?.link).toBe("amigos")
    // Saved with the echo's `seq`, not with -1.
    const aceite = entradasDoCanal(vault.contents, CANAL).find((entrada) => entrada.payload.t === "friend.accept")
    expect(aceite?.seq).toBeGreaterThanOrEqual(900)
  }, 120_000)
})

/**
 * **Phase 1d: loops leave the core by an event, and one crossed with the arrival
 * order reversed gives "friends".**
 *
 * The owner's report (10/27/2026): two requests in the same second, and the bell
 * showing "accepted" and "pending" at the same time. The cause was the second
 * fold, the one on screen messages. The interface started reading ties from here
 * (`friendTies` and the `friendships` event); what is measured is that the event
 * leaves, and leaves with the fold's state by server order, even when Ana's accept
 * arrives live BEFORE her request, which only comes by recovery.
 */
describe("o evento `amizades`", () => {
  it('um cruzado com o aceite ao vivo antes do pedido recuperado: o último evento diz "amigos"', async () => {
    const { session, vault, socket } = await bentoLigado()
    const conversa = await conversaDaAna(socket, [
      { t: "friend.request", sentAt: 1_700_000_000_000 },
      { t: "friend.accept", acceptedAt: 1_700_000_000_001 },
    ])
    socket.empurrar({ t: "channel.event", channel: CANAL, seq: 0, kind: "welcome", ciphertext: conversa.welcome, receivedAtMinute: 0 })
    await assentar(200)
    expect(session.channels).toContain(CANAL)

    // Bento's request, which left in the same second as hers (the echo's `seq`).
    const eu = session.identity.address
    await vault.update((contents) => {
      contents.history[CANAL] = [{ seq: 1, sender: eu, at: 1, payload: { t: "friend.request", sentAt: 1_700_000_000_000 } }]
    })
    const [pedido, aceite] = conversa.eventos.map((evento) => ({ ...evento, seq: evento.seq + 1 }))
    if (!pedido || !aceite) throw new Error("faltam eventos da Ana")

    const avisos: FriendTie[][] = []
    session.on("amizades", ({ ties }) => avisos.push(ties))

    // Her accept, live, first.
    socket.empurrar({ t: "channel.event", channel: CANAL, ...aceite })
    await assentar(200)
    await session.flush()
    // Her request, then, via recovery.
    FakeSocket.reply = (frame) => {
      const base = respostaBase(frame)
      if (frame.t === "channel.backfill" && frame.beforeSeq !== undefined) {
        return [{ t: "channel.backfill.page", channel: CANAL, more: false, events: [pedido] }]
      }
      return base
    }
    await session.backfillBefore(CANAL, 10)
    await assentar(60)
    await session.flush()
    await assentar(20)

    expect(entradasDoCanal(vault.contents, CANAL).map((entrada) => entrada.payload.t)).toEqual(
      expect.arrayContaining(["friend.request", "friend.accept"]),
    )
    expect(avisos.length).toBeGreaterThan(0)
    const ultimo = avisos.at(-1)?.find((tie) => tie.peer === conversa.ana)
    expect(ultimo?.link).toBe("amigos")
    expect(session.friendTies().get(conversa.ana)?.link).toBe("amigos")
    expect(session.openFriendRequests()).toEqual([])
  }, 120_000)

  it("uma mensagem que não é de amizade não emite nada", async () => {
    const { session, socket } = await bentoLigado()
    const conversa = await conversaDaAna(socket, [{ t: "message", id: "m-amizades-1", sentAt: 1, body: "olá", attachments: [], mentions: [], links: [] }])
    socket.empurrar({ t: "channel.event", channel: CANAL, seq: 0, kind: "welcome", ciphertext: conversa.welcome, receivedAtMinute: 0 })
    await assentar(200)
    const avisos: unknown[] = []
    session.on("amizades", (evento) => avisos.push(evento))
    const dito = conversa.eventos[0]
    if (!dito) throw new Error("sem mensagem")
    socket.empurrar({ t: "channel.event", channel: CANAL, ...dito })
    await assentar(200)
    await session.flush()
    expect(avisos).toEqual([])
  }, 120_000)
})

/**
 * **An entry from the ledger whose echo arrives late, or only during recovery, goes into the vault** (I3).
 *
 * The ledger writes only with the echo. Without it, an echo that arrived after
 * the receipt deadline (10 s) was discarded, and recovery ignores our outgoing
 * messages (they don't decrypt on this side): the entry stayed on the server, the
 * other side read it, and this device never did. The flag in the vault
 * (`livroPorConfirmar`) recognizes it by the bytes.
 */
describe("o livro por confirmar", () => {
  async function comPedido(): Promise<{ session: Session; vault: Vault; socket: FakeSocket; ana: string }> {
    const { session, vault, socket } = await bentoLigado()
    const conversa = await conversaDaAna(socket, [{ t: "friend.request", sentAt: 1_700_000_000_000 }])
    socket.empurrar({ t: "channel.event", channel: CANAL, seq: 0, kind: "welcome", ciphertext: conversa.welcome, receivedAtMinute: 0 })
    await assentar(200)
    const pedido = conversa.eventos[0]
    if (!pedido) throw new Error("sem pedido")
    socket.empurrar({ t: "channel.event", channel: CANAL, ...pedido })
    await assentar(200)
    expect(session.friendTies().get(conversa.ana)?.link).toBe("pedido-recebido")
    vi.spyOn(session, "acceptFollower").mockResolvedValue()
    return { session, vault, socket, ana: conversa.ana }
  }

  const prazo = Session.CONFIRM_MS
  afterEach(() => {
    Session.CONFIRM_MS = prazo
  })

  it("um eco que chega depois do prazo grava o aceite com o seq dele", async () => {
    const { session, vault, socket, ana } = await comPedido()
    let retido: Sent | null = null
    FakeSocket.reply = (frame) => {
      if (frame.t === "channel.send" && frame.channel === CANAL && frame.kind === "application") {
        retido = frame
        return []
      }
      return respostaBase(frame)
    }
    Session.CONFIRM_MS = 200
    await expect(session.acceptFriend(CANAL, ana)).rejects.toThrow("the server did not confirm the send")
    expect(session.friendTies().get(ana)?.link).toBe("pedido-recebido")
    expect(Object.keys(vault.contents.livroPorConfirmar ?? {})).toHaveLength(1)

    const tarde = retido as Sent | null
    if (!tarde) throw new Error("o aceite não saiu")
    socket.empurrar({ t: "channel.event", channel: CANAL, seq: 777, kind: "application", ciphertext: tarde.ciphertext, ref: tarde.ref, receivedAtMinute: 0 })
    await assentar(100)
    await session.flush()
    expect(session.friendTies().get(ana)?.link).toBe("amigos")
    expect(entradasDoCanal(vault.contents, CANAL).find((entrada) => entrada.payload.t === "friend.accept")?.seq).toBe(777)
    expect(Object.keys(vault.contents.livroPorConfirmar ?? {})).toHaveLength(0)
  }, 120_000)

  it("um eco que nunca chegou entra pela recuperação da ligação seguinte", async () => {
    const { session, vault, socket, ana } = await comPedido()
    let retido: Sent | null = null
    FakeSocket.reply = (frame) => {
      if (frame.t === "channel.send" && frame.channel === CANAL && frame.kind === "application") {
        retido = frame
        return []
      }
      return respostaBase(frame)
    }
    Session.CONFIRM_MS = 200
    await expect(session.acceptFriend(CANAL, ana)).rejects.toThrow("the server did not confirm the send")
    const perdido = retido as Sent | null
    if (!perdido) throw new Error("o aceite não saiu")

    // The connection drops; the next recovery restores the channel, and the server has the accept there.
    FakeSocket.reply = (frame) => {
      if (frame.t === "channel.backfill" && frame.channel === CANAL && frame.afterSeq !== undefined) {
        return [
          {
            t: "channel.backfill.page",
            channel: CANAL,
            more: false,
            events: [{ seq: 888, kind: "application", ciphertext: perdido.ciphertext, receivedAtMinute: 0 }],
          },
        ]
      }
      return respostaBase(frame)
    }
    socket.close()
    const fim = Date.now() + 10_000
    while (Date.now() < fim && session.friendTies().get(ana)?.link !== "amigos") await assentar(20)
    await session.flush()
    expect(session.friendTies().get(ana)?.link).toBe("amigos")
    expect(entradasDoCanal(vault.contents, CANAL).find((entrada) => entrada.payload.t === "friend.accept")?.seq).toBe(888)
  }, 120_000)
})

/**
 * **The group writes to disk before the message leaves; the own message, right after.**
 *
 * Since phase 4 review (20/10/2026) the order is this, and the test measures it:
 * GROUP writes before the message leaves (it's the nonce, and can't wait), and
 * HISTORY writes only after it leaves, in a write scheduled for the next
 * microtask, without blocking the send and without waiting for the `FLUSH_MS`
 * batch. Not before it leaves, because a send that threw would leave a phantom
 * message in the vault.
 *
 * Telemetry from the field: on WebKit, closing the tab 300 ms after sending lost
 * the own message from local history in 3 of 10 runs. The batch reopened that
 * door in a round (`scripts/e2e-separadores.mjs` failed on all three engines),
 * and that's why `Date` is frozen here: no batch timer runs, and the message has
 * to be on disk anyway. What we read is the SAME vault opened from disk
 * (`reabrir`), not memory.
 */
describe("a mensagem própria e o lote de gravação", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("o grupo gasto grava antes de sair, e a mensagem logo a seguir, sem esperar pelo lote", async () => {
    const { session, vault, socket, backend } = await bentoLigado()
    const conversa = await conversaDaAna(socket, [])
    socket.empurrar({ t: "channel.event", channel: CANAL, seq: 0, kind: "welcome", ciphertext: conversa.welcome, receivedAtMinute: 0 })
    await assentar(200)
    expect(session.channels).toContain(CANAL)
    await session.flush()
    const grupoAntes = vault.contents.groups[CANAL]

    vi.useFakeTimers({ toFake: ["Date"] })
    const antes = Date.now()
    await session.send(CANAL, { t: "message", id: "propria-1", body: "não me percas", sentAt: antes, attachments: [] } as never)
    // Only microtasks and the echo's turn: the clock didn't move, the batch didn't run.
    await assentar(20)
    expect(Date.now() - antes).toBeLessThan(Session.FLUSH_MS)

    const voltou = await reabrir(backend)
    expect(entradasDoCanal(voltou.vault.contents, CANAL).map((entrada) => entrada.payload["body"])).toContain("não me percas")
    // And the group on disk is already what encrypted the message (the generation is spent).
    expect(voltou.vault.contents.groups[CANAL]).toBeDefined()
    expect(voltou.vault.contents.groups[CANAL]).not.toBe(grupoAntes)
  }, 120_000)

  it("um envio que não sai não deixa mensagem nenhuma no cofre, e o grupo gasto fica gravado", async () => {
    const { session, vault, socket, backend } = await bentoLigado()
    const conversa = await conversaDaAna(socket, [])
    socket.empurrar({ t: "channel.event", channel: CANAL, seq: 0, kind: "welcome", ciphertext: conversa.welcome, receivedAtMinute: 0 })
    await assentar(200)
    await session.flush()
    const grupoAntes = vault.contents.groups[CANAL]

    socket.close()
    await expect(
      session.send(CANAL, { t: "message", id: "fantasma-1", body: "não saí", sentAt: Date.now(), attachments: [] } as never),
    ).rejects.toThrow("no connection to the server")
    await session.flush()
    const voltou = await reabrir(backend)
    // No phantom: resending from the outbox doesn't write a second copy.
    expect(entradasDoCanal(voltou.vault.contents, CANAL).map((entrada) => entrada.payload["id"])).not.toContain("fantasma-1")
    // And the spent ratchet is on disk: resending encrypts with the next key.
    expect(voltou.vault.contents.groups[CANAL]).not.toBe(grupoAntes)
  }, 120_000)
})
