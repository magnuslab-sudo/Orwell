import { addMembers, createChannel, decodeKeyPackage, encryptPayload, generateKeyPackages } from "@enclave/crypto"
import { fromBase64, generateIdentity, parseServerName, toBase64, type Payload } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * **The application gate: live frames wait their turn on the channel.**
 *
 * The bug this measures was reported by the owner on 5 October 2026,  * real messages gone missing on a device that stayed closed for days, and the chain
 * is about order, not history:
 *
 *   1. subscribing opens live frames from ALL channels at once, and
 *      recovery runs one channel at a time, in order;
 *   2. a live commit applied right away, because `#ancoraPresa` held the
 *      anchor and not the application, its own header said so;
 *   3. the client keeps the current epoch and two (`retainKeysForEpochs: 2`),
 *      so at the third commit applied out of order the messages from the epoch
 *      being in stopped opening;
 *   4. and a frame that cannot open because it is from a past epoch was worth `"lido"`: the
 *      anchor passed over it and it was never asked again, with the
 *      bytes still on the server.
 *
 * Here the server is fake, which makes the race EXACT instead of probable:
 * live commits are pushed the instant the recovery request
 * leaves, so they always arrive before the page is answered. The script
 * `scripts/e2e-ordem-das-epocas.mjs` measures the same against a real server.
 *
 * With the gate reverted (the `#reterAoVivo` in `#onFrame`), this file turns
 * red: the count is 0 de 3 mensagens read.
 */

class MemoryBackend implements VaultBackend {
  bytes: Uint8Array | null = null
  readonly supportsOsProtection = false
  /**
   * The brake on ONE write, to stop a recovery midway.
   *
   * This is what makes the reconnection race EXACT instead of probable: a real
   * recovery gets stuck on decryption and writing the page it already has,
   * and that lasts longer than the 500 to 1000 ms of `#scheduleReconnect`.
   *
   * ONE, not all, on purpose: braking all would also trap the new connection, and
   * what we want to measure is one slow write crossing the boundary between the two.
   * `armed` traps the next one; `held` says it is already trapped, and that is what
   * the test waits for instead of guessing a timeout.
   */
  armado = false
  presa = false
  #largar: (() => void) | null = null
  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    this.bytes = bytes
    if (!this.armado) return
    this.armado = false
    this.presa = true
    await new Promise<void>((resolve) => {
      this.#largar = resolve
    })
    this.presa = false
  }
  largar(): void {
    this.#largar?.()
    this.#largar = null
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

const CANAL = "!contio:localhost:8448"
const CASA = parseServerName("localhost:8448")

function texto(corpo: string): Payload {
  return { t: "message", id: crypto.randomUUID(), sentAt: 1, body: corpo, attachments: [], mentions: [], links: [] }
}

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
  return undefined
}

let abertas: Session[] = []

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

/** The same vault, a new session: this is what measures a next connection. */
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

async function assentar(vezes = 60): Promise<void> {
  for (let i = 0; i < vezes; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * A channel from someone else, the invite for Bento, what was said there in his epoch,
 * and the commits that come after.
 *
 * FOUR commits, not one: `retainKeysForEpochs: 2` keeps the current epoch and two,
 * so one commit applied out of order leaves the previous epoch readable and two more.
 * It is at the third that the oldest one drops.
 */
async function canalComHistoriaECommits(quantasMensagens: number, quantosCommits: number): Promise<{
  welcome: string
  mensagens: { seq: number; ciphertext: string; corpo: string }[]
  commits: { seq: number; ciphertext: string }[]
}> {
  const dono = generateIdentity(CASA)
  let grupo = await createChannel(dono, CANAL)

  const bento = keyPackagesPublicados(FakeSocket.last as FakeSocket)[0]
  if (!bento) throw new Error("faltam key packages do Bento")
  const convite = await addMembers(grupo, [decodeKeyPackage(bento)])
  grupo = convite.session

  // Said AFTER the invite, so in Bento's epoch: he opens this, as long as nothing
  // advances the group before he reads it.
  const mensagens: { seq: number; ciphertext: string; corpo: string }[] = []
  for (let i = 0; i < quantasMensagens; i++) {
    const corpo = `dito ${i}`
    const dito = await encryptPayload(grupo, texto(corpo))
    grupo = dito.session
    mensagens.push({ seq: 1 + i, ciphertext: toBase64(dito.ciphertext), corpo })
  }

  // And the commits, each one with its actor: this is what moves the epoch forward.
  const commits: { seq: number; ciphertext: string }[] = []
  for (let i = 0; i < quantosCommits; i++) {
    const figurante = generateIdentity(CASA)
    const pacotes = await generateKeyPackages(figurante, 1)
    const pacote = pacotes[0]
    if (!pacote) throw new Error("sem pacote para o figurante")
    const commit = await addMembers(grupo, [pacote.publicPackage])
    grupo = commit.session
    commits.push({ seq: 1 + quantasMensagens + i, ciphertext: toBase64(commit.commit) })
  }

  return { welcome: toBase64(convite.welcome), mensagens, commits }
}

/**
 * A channel from someone else, by NAME, and messages said in Bento's epoch.
 *
 * Sibling of the one above, for cases that need two channels at the same time:
 * the reconnection race only mounts with one channel holding the `#catchUp` queue
 * and another being measured. `qualPacote` picks which key package to burn, because
 * a package is single-use and two invites need two.
 */
async function canalDeOutrem(
  canal: string,
  quantasMensagens: number,
  qualPacote: number,
): Promise<{ welcome: string; mensagens: { seq: number; ciphertext: string; corpo: string }[] }> {
  const dono = generateIdentity(CASA)
  let grupo = await createChannel(dono, canal)

  const pacote = keyPackagesPublicados(FakeSocket.last as FakeSocket)[qualPacote]
  if (!pacote) throw new Error(`falta o key package ${qualPacote} do Bento`)
  const convite = await addMembers(grupo, [decodeKeyPackage(pacote)])
  grupo = convite.session

  const mensagens: { seq: number; ciphertext: string; corpo: string }[] = []
  for (let i = 0; i < quantasMensagens; i++) {
    const corpo = `${canal} dito ${i}`
    const dito = await encryptPayload(grupo, texto(corpo))
    grupo = dito.session
    mensagens.push({ seq: 1 + i, ciphertext: toBase64(dito.ciphertext), corpo })
  }

  return { welcome: toBase64(convite.welcome), mensagens }
}

/** A recovery page with these messages, and nothing else before. */
function pagina(canal: string, mensagens: { seq: number; ciphertext: string }[]): unknown {
  return {
    t: "channel.backfill.page",
    channel: canal,
    more: false,
    events: mensagens.map((dito) => ({
      seq: dito.seq,
      kind: "application",
      ciphertext: dito.ciphertext,
      receivedAtMinute: 0,
    })),
  }
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

describe("o portão de aplicação", () => {
  it("quatro commits ao vivo esperam pela recuperação, e nenhuma mensagem se perde", async () => {
    const { session, vault, socket } = await bentoLigado()
    const canal = await canalComHistoriaECommits(3, 4)

    let pedidos = 0
    FakeSocket.reply = (frame) => {
      const base = respostaBase(frame)
      if (base) return base
      if (frame.t === "channel.backfill" && frame.channel === CANAL) {
        pedidos += 1
        const primeiro = pedidos === 1
        void (async () => {
          /*
            Live commits, the moment the recovery request goes out.

            This order is what makes the defect: they arrive before the page, and
            without a gate they apply right away; the group skips four epochs and the
            three messages from Bento's epoch stop opening. With a gate, they stay
            held by `seq` and come in after the page, in the right order.
          */
          if (primeiro) {
            for (const commit of canal.commits) {
              socket.empurrar({
                t: "channel.event",
                channel: CANAL,
                seq: commit.seq,
                kind: "handshake",
                ciphertext: commit.ciphertext,
                receivedAtMinute: 0,
              })
            }
            await assentar(30)
          }
          socket.empurrar({
            t: "channel.backfill.page",
            channel: CANAL,
            more: false,
            events: [
              ...canal.mensagens.map((dito) => ({
                seq: dito.seq,
                kind: "application",
                ciphertext: dito.ciphertext,
                receivedAtMinute: 0,
              })),
              ...canal.commits.map((commit) => ({
                seq: commit.seq,
                kind: "handshake",
                ciphertext: commit.ciphertext,
                receivedAtMinute: 0,
              })),
            ],
          })
        })()
        return undefined
      }
      return undefined
    }

    socket.empurrar({
      t: "channel.event",
      channel: CANAL,
      seq: 0,
      kind: "welcome",
      ciphertext: canal.welcome,
      receivedAtMinute: 0,
    })
    await assentar(400)

    expect(session.channels).toContain(CANAL)

    const lidas = (vault.contents.history[CANAL] ?? [])
      .filter((entrada) => entrada.payload.t === "message")
      .map((entrada) => String(entrada.payload.body))
    expect(lidas).toEqual(canal.mensagens.map((dito) => dito.corpo))

    // And the anchor reached the end: the held commits came in after the page,
    // so nothing was left to request on the next connection.
    expect(vault.contents.lastSeq[CANAL]).toBe(canal.commits[canal.commits.length - 1]?.seq)
  }, 120_000)

  it("o canal continua a poder receber ao vivo depois de o portão abrir", async () => {
    const { session, vault, socket } = await bentoLigado()
    const canal = await canalComHistoriaECommits(2, 1)

    FakeSocket.reply = (frame) => {
      const base = respostaBase(frame)
      if (base) return base
      if (frame.t === "channel.backfill" && frame.channel === CANAL) {
        return [
          {
            t: "channel.backfill.page",
            channel: CANAL,
            more: false,
            events: [
              ...canal.mensagens.map((dito) => ({
                seq: dito.seq,
                kind: "application",
                ciphertext: dito.ciphertext,
                receivedAtMinute: 0,
              })),
              ...canal.commits.map((commit) => ({
                seq: commit.seq,
                kind: "handshake",
                ciphertext: commit.ciphertext,
                receivedAtMinute: 0,
              })),
            ],
          },
        ]
      }
      return undefined
    }

    socket.empurrar({
      t: "channel.event",
      channel: CANAL,
      seq: 0,
      kind: "welcome",
      ciphertext: canal.welcome,
      receivedAtMinute: 0,
    })
    await assentar(300)
    expect(session.channels).toContain(CANAL)
    // The gate already opened: the anchor moved with the page and nothing stayed held.
    expect(vault.contents.lastSeq[CANAL]).toBe(canal.commits[0]?.seq)
  }, 120_000)

  /**
   * **ONE LIVE FRAME IN THE MIDDLE OF DRAINING CANNOT TAKE THE REST OF THE BATCH.**
   *
   * This is the defect the first gate fix brought in through the back door, and the
   * chain is this: `#catchUpChannel` cleared both gate marks BEFORE calling `#largarRetidas`,
   * so during the whole drain the gate was OPEN. The loop reread the anchor from the live
   * vault each time around, and the live vault is mutated synchronously by `Vault.update`.
   * A frame that arrived live between two passes applied right away and wrote the anchor to
   * its `seq`; the next pass read that anchor and sent away everything in between with `continue`.
   *
   * Here: the anchor stops at 3, frames 4 to 7 stay held, and 8 is pushed live the moment
   * the first held one reaches the vault. Without the fix, 5, 6 and 7 vanish, no `saltado`,
   * no gap, no line in the log, and the next connection requests from 8.
   */
  it("uma trama ao vivo a meio do esvaziamento não faz perder o resto do lote", async () => {
    const { session, vault, socket } = await bentoLigado()
    /*
      Twenty held, not four, so the batch is BIGGER than the window where the
      live frame interleaves.
      
      With a short batch the whole drain often fits in one event loop turn, the live frame
      comes in after it, and the defect shows up only as a wrong order in the vault, bad,
      but not what matters. With twenty, the frame comes in the middle and EVERYTHING
      after it is sent away by `continue`: that is the silent loss, which is what we measure.
      */
    const canal = await canalComHistoriaECommits(24, 0)
    const naPagina = canal.mensagens.slice(0, 3)
    const retidas = canal.mensagens.slice(3, 23)
    const aoVivoNoMeio = canal.mensagens[23]
    if (!aoVivoNoMeio) throw new Error("faltam mensagens")

    /*
      The hook: the live frame comes in the moment the FIRST held one reaches
      the vault.

      We measure by the anchor because it is the object of the defect, `#rememberSeq`
      writes it inside `Vault.update`, and it is the value the loop reread. Just one,
      because one is enough.
     */
    const original = vault.update.bind(vault)
    let empurrada = false
    ;(vault as unknown as { update: Vault["update"] }).update = async (mutate) => {
      await original(mutate)
      if (!empurrada && vault.contents.lastSeq[CANAL] === retidas[0]?.seq) {
        empurrada = true
        socket.empurrar({
          t: "channel.event",
          channel: CANAL,
          seq: aoVivoNoMeio.seq,
          kind: "application",
          ciphertext: aoVivoNoMeio.ciphertext,
          receivedAtMinute: 0,
        })
      }
    }

    let pedidos = 0
    FakeSocket.reply = (frame) => {
      const base = respostaBase(frame)
      if (base) return base
      if (frame.t === "channel.backfill" && frame.channel === CANAL) {
        pedidos += 1
        const primeiro = pedidos === 1
        void (async () => {
          // The held frames arrive with the gate closed, before the page is sent:
          // that is why they wait instead of applying.
          if (primeiro) {
            for (const dito of retidas) {
              socket.empurrar({
                t: "channel.event",
                channel: CANAL,
                seq: dito.seq,
                kind: "application",
                ciphertext: dito.ciphertext,
                receivedAtMinute: 0,
              })
            }
            await assentar(30)
          }
          // And the page stops at 3: the rest of the batch is what is held.
          socket.empurrar(pagina(CANAL, primeiro ? naPagina : []))
        })()
        return undefined
      }
      return undefined
    }

    socket.empurrar({
      t: "channel.event",
      channel: CANAL,
      seq: 0,
      kind: "welcome",
      ciphertext: canal.welcome,
      receivedAtMinute: 0,
    })
    await assentar(500)

    expect(session.channels).toContain(CANAL)
    expect(empurrada).toBe(true)
    // ALL, and in order: the three from the page, the four held, and the one that arrived
    // live midway through draining. Without the fix three from the middle are missing.
    const lidas = (vault.contents.history[CANAL] ?? [])
      .filter((entrada) => entrada.payload.t === "message")
      .map((entrada) => String(entrada.payload.body))
    expect(lidas).toEqual(canal.mensagens.map((dito) => dito.corpo))
    expect(vault.contents.lastSeq[CANAL]).toBe(aoVivoNoMeio.seq)
  }, 120_000)

  /**
   * **THE EXPIRATION OF A DEAD RECOVERY DOES NOT OPEN THE GATE ON THE NEW CONNECTION.**
   *
   * The `finally` in `#catchUpChannel` cleared the "to recover" mark without looking at
   * the connection generation. `#onClose` already rejects pending waits, but the work
   * that comes AFTER the wait does not die with the socket: the page already received
   * is up to a hundred events to decrypt and write, and that lasts longer than the 500 to
   * 1000 ms of `#scheduleReconnect`. So `finally` ran inside the new connection and opened
   * the gate for a channel whose new recovery had not run yet; the defect M1, all over again.
   *
   * The test: two channels. The first holds the `#catchUp` queue of the new connection
   * (the server does not reply to its page), the second is the one we measure. The old
   * recovery of the second gets stuck on a vault write, the connection falls, a new one
   * comes up, and only then the write lets go. What we assert is that the live frame
   * that arrives next does NOT come in: it waits its turn on the channel, as it should.
   */
  it("a expiração de uma recuperação velha não abre o portão da ligação nova", async () => {
    const PRIMEIRO = "!fila:localhost:8448"
    const MEDIDO = "!medido:localhost:8448"

    const { session: primeira, backend, socket: socket1 } = await bentoLigado()
    const filaCanal = await canalDeOutrem(PRIMEIRO, 1, 0)
    const medidoCanal = await canalDeOutrem(MEDIDO, 2, 1)
    const naPagina = medidoCanal.mensagens[0]
    const aoVivo = medidoCanal.mensagens[1]
    if (!naPagina || !aoVivo) throw new Error("faltam mensagens")

    // Setup phase: the two entries, and empty pages for all recoveries.
    // Nothing here is what we measure.
    FakeSocket.reply = (frame) => {
      const base = respostaBase(frame)
      if (base) return base
      if (frame.t === "channel.backfill" && typeof frame.channel === "string") {
        return [pagina(String(frame.channel), [])]
      }
      return undefined
    }
    for (const [canal, welcome] of [
      [PRIMEIRO, filaCanal.welcome],
      [MEDIDO, medidoCanal.welcome],
    ] as const) {
      socket1.empurrar({ t: "channel.event", channel: canal, seq: 0, kind: "welcome", ciphertext: welcome, receivedAtMinute: 0 })
      await assentar(200)
    }
    expect(primeira.channels).toEqual(expect.arrayContaining([PRIMEIRO, MEDIDO]))
    primeira.disconnect()
    await assentar(40)

    // And the connection that matters, on the same vault.
    let helos = 0
    const { session, vault } = await reabrir(backend)
    FakeSocket.reply = (frame) => {
      if (frame.t === "hello") helos += 1
      const base = respostaBase(frame)
      if (base) return base
      if (frame.t !== "channel.backfill" || typeof frame.afterSeq !== "number") return undefined
      /*
        The NEW connection doesn't respond to anything: this is how its recovery
        from the first channel stays waiting, and its `#catchUp` never reaches
        the measured channel. This is the exact defect condition, the "pending
        recovery" mark on the measured channel belongs to the new connection, and
        the `finally` in the old one erases it.
        */
      if (helos >= 2) return undefined
      if (frame.channel === MEDIDO) {
        // The brake engages here: writing the anchor that this page triggers gets stuck,
        // and with it the old recovery of this channel.
        backend.armado = true
        return [pagina(MEDIDO, [naPagina])]
      }
      return [pagina(String(frame.channel), [])]
    }

    /*
      Without `await`, and it's the test imitating reality.

      The `connect()` waits for `#catchUp`, and `#catchUp` is precisely what
      will get stuck in the blocked write: waiting for it here was waiting for
      what this test exists to block. In a real application, `connect()` is
      also not awaited by anyone from the moment the connection drops.
    */
    void session.connect().catch(() => {})
    /*
      Until the write is BLOCKED and the anchor of this channel is already at
      the page's `seq`.
      
      Both conditions together, not a timeout: this proves the blocked write
      belongs to this channel's recovery, `Vault.update` mutates the live
      content synchronously and only then writes, so an anchor in the right
      place with a write in progress can only be this one.
      */
    for (let volta = 0; volta < 600 && !(backend.presa && vault.contents.lastSeq[MEDIDO] === naPagina.seq); volta++) {
      await assentar(2)
    }
    expect(backend.presa).toBe(true)
    expect(vault.contents.lastSeq[MEDIDO]).toBe(naPagina.seq)

    // The connection drops, and the new one comes up: `#scheduleReconnect` is 500 to 1000 ms.
    FakeSocket.last?.close()
    for (let volta = 0; volta < 300 && helos < 2; volta++) await new Promise((r) => setTimeout(r, 20))
    expect(helos).toBeGreaterThanOrEqual(2)
    await assentar(120)

    // And only now the write releases: the old recovery's `finally` runs INSIDE
    // the new connection, which is the defect moment.
    backend.largar()
    await assentar(200)

    const socket2 = FakeSocket.last
    if (!socket2) throw new Error("sem socket novo")
    socket2.empurrar({
      t: "channel.event",
      channel: MEDIDO,
      seq: aoVivo.seq,
      kind: "application",
      ciphertext: aoVivo.ciphertext,
      receivedAtMinute: 0,
    })
    await assentar(200)

    // The measured channel's gate stays CLOSED: the flow waits for its turn.
    const corpos = (vault.contents.history[MEDIDO] ?? [])
      .filter((entrada) => entrada.payload.t === "message")
      .map((entrada) => String(entrada.payload.body))
    expect(corpos).not.toContain(aoVivo.corpo)
    expect(vault.contents.lastSeq[MEDIDO]).toBe(naPagina.seq)
  }, 120_000)

  /**
   * **THE GATE CAP OVERFLOWS AND LEAVES A MARK.**
   *
   * The cap erased the maps, emitted a line and returned, without opening a
   * hole. The line claimed the opposite of what happened: it said "recovery
   * asks the server again", and that's only true if the anchor stays behind
   * what was discarded. The argument that supported it, "while the gate is
   * closed, `#ancoraPresa` is too", was true before `#aLargar` entered
   * `#portaoFechado`, and stopped being so: during draining the gate is
   * closed and the anchor is FREE, because the two marks that `#ancoraPresa`
   * reads were already erased by `#catchUpChannel`.
   *
   * The test: the page stops at 3, an 8 MB frame arrives live as `seq` 4 and
   * overflows the cap per channel, and at 5 arrives live after the gate opens.
   * What's claimed is the anchor STAYS at 3, 4 keeps being requested on the
   * next connection, even with 5 applied. Without the hole, 5 writes the
   * anchor and 4 is never requested again: no skip, no gap, no diagnosis. If
   * it were `handshake`, it was a skipped commit.
   */
  it("o tecto do portão abre um buraco no que deita fora", async () => {
    const { session, vault, socket } = await bentoLigado()
    /*
      Four messages for five `seq`, and the count comes from the MLS rack.
      
      The `seq` is from the server and here the test chooses it, but the
      decryption order is not chosen: a skipped generation from the sender
      won't open. So the frame that overflows the cap is a `seq` 4 that
      doesn't match any message, bytes nobody will be able to read, which is
      what gets discarded, and the fourth real message enters as `seq` 5,
      after the three from the page.
      */
    const canal = await canalComHistoriaECommits(4, 0)
    const naPagina = canal.mensagens.slice(0, 3)
    const quarta = canal.mensagens[3]
    if (!quarta) throw new Error("faltam mensagens")
    const depoisDoTecto = { seq: 5, ciphertext: quarta.ciphertext, corpo: quarta.corpo }

    const linhas: string[] = []
    session.on("status", (estado) => {
      if (estado.code === "portao-no-tecto") linhas.push(estado.detail)
    })

    let pedidos = 0
    FakeSocket.reply = (frame) => {
      const base = respostaBase(frame)
      if (base) return base
      if (frame.t === "channel.backfill" && frame.channel === CANAL) {
        pedidos += 1
        const primeiro = pedidos === 1
        void (async () => {
          /*
            The frame that overflows the cap, at the moment the request leaves:
            the gate is closed, so it goes through `#reterAoVivo`, and an 8 MB
            `seq` 4 and one byte doesn't fit in the cap per channel
            (`RETIDAS_BYTES_POR_CANAL`, 8 MB), with the map still empty. This
            is the purest case: the only frame that gets discarded is the
            current one.
            */
          if (primeiro) {
            socket.empurrar({
              t: "channel.event",
              channel: CANAL,
              seq: 4,
              kind: "application",
              ciphertext: "A".repeat(8_000_001),
              receivedAtMinute: 0,
            })
            await assentar(30)
          }
          socket.empurrar(pagina(CANAL, primeiro ? naPagina : []))
        })()
        return undefined
      }
      return undefined
    }

    socket.empurrar({
      t: "channel.event",
      channel: CANAL,
      seq: 0,
      kind: "welcome",
      ciphertext: canal.welcome,
      receivedAtMinute: 0,
    })
    await assentar(400)

    expect(session.channels).toContain(CANAL)
    // The cap gave way, and the diagnosis names the hole: before it only said the
    // batch was discarded.
    expect(linhas.join(" ")).toContain("buraco no evento 4")
    expect(vault.contents.lastSeq[CANAL]).toBe(3)

    // And now 5 live, with the gate already open: it applies, and the anchor does NOT move.
    socket.empurrar({
      t: "channel.event",
      channel: CANAL,
      seq: depoisDoTecto.seq,
      kind: "application",
      ciphertext: depoisDoTecto.ciphertext,
      receivedAtMinute: 0,
    })
    await assentar(200)
    /*
      The write, requested by hand.

      With the anchor blocked by the hole, `#aplicarAoVivo` doesn't call
      `#rememberSeq`, and it's `#rememberSeq` that writes the vault and with
      it drains `#pendingHistory`. In a real application the batch write
      arrives a second and a half later; here we request it, so the assertion
      is about the vault and not about a list to drain.
    */
    await session.flush()

    const corpos = (vault.contents.history[CANAL] ?? [])
      .filter((entrada) => entrada.payload.t === "message")
      .map((entrada) => String(entrada.payload.body))
    expect(corpos).toContain(depoisDoTecto.corpo)
    // Without the hole this would be 5, and 4 would stay behind silently.
    expect(vault.contents.lastSeq[CANAL]).toBe(3)
  }, 120_000)

  /**
   * **A DRAIN DOESN'T CROSS A RECONNECTION.**
   *
   * `#largarRetidas` is the third place that reads connection state inside a
   * cycle with `await` in the middle, and it was the only one of the three
   * without a generation stamp. The defect: generation 1's drain gets stuck in
   * a vault write, the socket dies, the 500 to 1000 ms reconnection runs,
   * `connect()` clears the retained frames and marks the channels again, new
   * frames arrive and get retained, and the old drain wakes up, reads the
   * map, and they are THE NEW CONNECTION'S RETAINED FRAMES. Applying them with
   * the old cursor is advancing the epoch without reading what's in between,
   * which is defect M1 all over again and exactly what the cap refuses to do.
   *
   * The test: the page stops at 1, 2 to 5 get retained, the drain blocks
   * writing the anchor for 3, the connection drops, the new one comes up and
   * DOESN'T respond to the page (so its gate stays closed), 8 and 9 arrive
   * live and get retained, and only then the write releases. What's claimed is
   * 8 and 9 didn't enter by the old drain's hand.
   */
  it("um esvaziamento preso não aplica as retidas da ligação nova", async () => {
    const { session: primeira, backend, socket: socket1 } = await bentoLigado()
    const canal = await canalDeOutrem(CANAL, 9, 0)
    const naPagina = canal.mensagens[0]
    const retidas = canal.mensagens.slice(1, 5)
    const novas = canal.mensagens.slice(7, 9)
    if (!naPagina || retidas.length !== 4 || novas.length !== 2) throw new Error("faltam mensagens")

    // Setup: the entry, and empty pages. Nothing here is what gets measured.
    FakeSocket.reply = (frame) => {
      const base = respostaBase(frame)
      if (base) return base
      if (frame.t === "channel.backfill" && typeof frame.channel === "string") return [pagina(String(frame.channel), [])]
      return undefined
    }
    socket1.empurrar({ t: "channel.event", channel: CANAL, seq: 0, kind: "welcome", ciphertext: canal.welcome, receivedAtMinute: 0 })
    await assentar(200)
    expect(primeira.channels).toContain(CANAL)
    primeira.disconnect()
    await assentar(40)

    // And the connection that matters, on the same vault.
    let helos = 0
    let pedidos = 0
    const { session, vault } = await reabrir(backend)
    FakeSocket.reply = (frame) => {
      if (frame.t === "hello") helos += 1
      const base = respostaBase(frame)
      if (base) return base
      if (frame.t !== "channel.backfill") return undefined
      /*
        The NEW connection doesn't respond: this is how its recovery stays
        waiting, its `#recuperacoes` holds the gate, and frames that arrive live
        get retained in the map that the old drain will find.
      */
      if (helos >= 2) return undefined
      pedidos += 1
      const primeiro = pedidos === 1
      const actual = FakeSocket.last
      void (async () => {
        // The retained frames arrive with the gate closed, before the page is answered.
        if (primeiro && actual) {
          for (const dito of retidas) {
            actual.empurrar({
              t: "channel.event",
              channel: CANAL,
              seq: dito.seq,
              kind: "application",
              ciphertext: dito.ciphertext,
              receivedAtMinute: 0,
            })
          }
          await assentar(30)
        }
        actual?.empurrar(pagina(CANAL, primeiro ? [naPagina] : []))
      })()
      return undefined
    }

    /*
      The brake engages when the anchor reaches the FIRST retained frame: the
      blocked write is then the next frame from the same batch, meaning the
      drain in the middle. It's the same technique as the test above, one step
      further along the path.
      */
    const original = vault.update.bind(vault)
    let armou = false
    ;(vault as unknown as { update: Vault["update"] }).update = async (mutate) => {
      await original(mutate)
      if (!armou && vault.contents.lastSeq[CANAL] === retidas[0]?.seq) {
        armou = true
        backend.armado = true
      }
    }

    // See the note in the test above: waiting here means waiting for what will block.
    void session.connect().catch(() => {})
    for (let volta = 0; volta < 600 && !backend.presa; volta++) await assentar(2)
    expect(backend.presa).toBe(true)
    // The anchor is at the frame whose write got stuck: the drain is in the
    // middle of the batch, with the rest already out of the map and in its local
    // copy.
    expect(vault.contents.lastSeq[CANAL]).toBe(retidas[1]?.seq)

    // The connection drops, and the new one comes up: `#scheduleReconnect` is 500 to 1000 ms.
    FakeSocket.last?.close()
    for (let volta = 0; volta < 300 && helos < 2; volta++) await new Promise((r) => setTimeout(r, 20))
    expect(helos).toBeGreaterThanOrEqual(2)
    await assentar(120)

    // The frames from the NEW connection, which get retained in its map.
    const socket2 = FakeSocket.last
    if (!socket2) throw new Error("sem socket novo")
    for (const dito of novas) {
      socket2.empurrar({
        t: "channel.event",
        channel: CANAL,
        seq: dito.seq,
        kind: "application",
        ciphertext: dito.ciphertext,
        receivedAtMinute: 0,
      })
    }
    await assentar(120)

    // And only now the bulk write: the old drain wakes up INSIDE the new connection.
    backend.largar()
    await assentar(300)

    const corpos = (vault.contents.history[CANAL] ?? [])
      .filter((entrada) => entrada.payload.t === "message")
      .map((entrada) => String(entrada.payload.body))
    // What gets measured: the new connection's retained frames didn't enter by the
    // old drain's hand. Without the stamp, they both enter.
    for (const dito of novas) expect(corpos).not.toContain(dito.corpo)
    // And the old batch stops where the generation changed: the rest doesn't get
    // lost, because the anchor didn't pass over it and the new recovery starts at
    // the anchor.
    expect(vault.contents.lastSeq[CANAL]).toBe(retidas[1]?.seq)
  }, 120_000)
})
