import { moradaDeTeste } from "../testes/moradas.js"
import { importSession, leafIndexOf, memberAddresses } from "@enclave/crypto"
import { fromBase64, type UserAddress } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { REJOIN_TURN_MS, Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * Two real accounts, a real relay, and what happens when two events from
 * the same channel arrive at once.
 *
 * All other files in this folder test one session alone against a
 * socket that responds by script. That covers almost everything and not this: what
 * is measured here is what the client does with TWO events from the same
 * channel in flight at the same time, and for that you need someone on the other side
 * producing them with real encryption.
 *
 * The relay below is the server part that matters to this question, sequence number
 * per channel, subscriptions, key package reserve, and the forwarding
 * of a welcome only to its recipients. It copies the `#relay` from `gateway.ts`,
 * including the detail that costs most: the sender's `ref` goes in the broadcast to
 * EVERYONE, and it is only from whoever wrote it that the client recognizes it.
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

interface Frame {
  t: string
  [key: string]: unknown
}

interface Evento {
  seq: number
  kind: string
  ciphertext: string
  recipient?: string | undefined
  ref?: string | undefined
}

/**
 * How many frames this relay delivers before shutting off the tap.
 *
 * **It is not decoration, and the number was measured.** With a broken channel, the client
 * enters a cascade that feeds itself: events stop opening,
 * deafness is declared, `repairChannel` requests `welcome.resync`, the server
 * delivers all the welcomes again, each welcome triggers a full channel catch-up, and the
 * catch-up produces more events that do not open. A mutation race caught
 * this: a test with a 120 s timeout ran for 909 s,
 * because the vitest timeout marks the failure but does not stop the work left in
 * the timer queue.
 *
 * A suite that hangs is a suite that stops running. With a cap, the
 * relay falls silent and the test fails on the assertion that matters, in seconds. The
 * tests in this file, with the channel healthy, use less than two hundred frames.
 */
const TRAMAS_MAXIMAS = 3_000

/**
 * The timeout that measures a deadlock, and why this number.
 *
 * The two sections it guards run in tens of MILLISECONDS with a healthy queue
 *, measured: 46 ms output with four sends alongside. Five seconds are
 * two orders of magnitude of headroom, which is what a loaded machine needs
 * (see `docs/RETOMAR.md`, where three nearby tests blow timeouts for this reason), and
 * still catch a deadlock in five seconds instead of holding the suite
 * until the vitest limit.
 */
const PRAZO_MS = 5_000

/** The server, stripped down to what this test needs. */
class Rele {
  readonly eventos = new Map<string, Evento[]>()
  readonly pools = new Map<string, string[]>()
  readonly ligacoes = new Set<FakeSocket>()
  entregues = 0
  /** Address whose key package claims get held back. See the `case`. */
  reterClaimsPara: string | null = null
  readonly retidas: (() => void)[] = []

  libertarClaims(): void {
    this.reterClaimsPara = null
    const presas = this.retidas.splice(0, this.retidas.length)
    for (const responder of presas) responder()
  }

  frame(socket: FakeSocket, frame: Frame): void {
    switch (frame.t) {
      case "hello":
        socket.entregar({ t: "hello.ok", version: 1, capabilities: [] })
        return
      case "auth.begin":
        socket.address = frame.address as string
        socket.entregar({ t: "auth.challenge", nonce: "AAAA" })
        return
      case "auth.finish":
        socket.entregar({ t: "auth.ok", address: socket.address })
        return
      case "channel.subscribe":
        for (const canal of frame.channels as string[]) socket.canais.add(canal)
        return
      case "channel.unsubscribe":
        for (const canal of frame.channels as string[]) socket.canais.delete(canal)
        return
      case "keypackage.publish": {
        const anterior = frame.replace ? [] : (this.pools.get(socket.address ?? "") ?? [])
        this.pools.set(socket.address ?? "", [...anterior, ...(frame.packages as string[])])
        return
      }
      case "keypackage.claim": {
        const pool = this.pools.get(frame.address as string) ?? []
        const pacote = pool.shift() ?? null
        const responder = (): void =>
          socket.entregar({ t: "keypackage.claimed", address: frame.address, keyPackage: pacote })
        /*
          Holding the response is what makes a race MEASURABLE instead of
          probable. Claiming a key package is the only server roundtrip in the
          middle of an invite, and it opens the window between the invite reading
          the tree and the invite committing. With the response in hand, the test
          decides what happens in that window instead of hoping it does.

          Only for the requested address: in the same test another member is
          inviting someone, and it is exactly that invite that must run while
          this one waits.
        */
        if (this.reterClaimsPara === frame.address) this.retidas.push(responder)
        else responder()
        return
      }
      case "channel.send": {
        const canal = frame.channel as string
        const log = this.eventos.get(canal) ?? []
        const evento: Evento = {
          seq: log.length,
          kind: frame.kind as string,
          ciphertext: frame.ciphertext as string,
          recipient: frame.recipient as string | undefined,
          ref: frame.ref as string | undefined,
        }
        log.push(evento)
        this.eventos.set(canal, log)
        this.difundir(canal, evento)
        return
      }
      case "channel.backfill": {
        const canal = frame.channel as string
        const log = this.eventos.get(canal) ?? []
        const depois = (frame.afterSeq as number | undefined) ?? -1
        // Like `store.after`: a welcome meant for someone else does not enter anyone's
        // page.
        const visiveis = log.filter(
          (evento) =>
            evento.seq > depois && (evento.recipient === undefined || evento.recipient === socket.address),
        )
        const pagina = visiveis.slice(0, (frame.limit as number | undefined) ?? 50)
        socket.entregar({
          t: "channel.backfill.page",
          channel: canal,
          events: pagina.map((evento) => ({
            seq: evento.seq,
            kind: evento.kind,
            ciphertext: evento.ciphertext,
            receivedAtMinute: 0,
          })),
          more: pagina.length < visiveis.length,
        })
        return
      }
      case "welcome.resync": {
        for (const [canal, log] of this.eventos) {
          for (const evento of log) {
            if (evento.kind === "welcome" && evento.recipient === socket.address) {
              socket.entregar(this.#comoEvento(canal, evento))
            }
          }
        }
        return
      }
      default:
        return
    }
  }

  difundir(canal: string, evento: Evento): void {
    for (const ligacao of this.ligacoes) {
      if (!ligacao.address) continue
      if (evento.recipient) {
        if (ligacao.address !== evento.recipient) continue
      } else if (!ligacao.canais.has(canal)) continue
      ligacao.entregar(this.#comoEvento(canal, evento))
    }
  }

  #comoEvento(canal: string, evento: Evento): Frame {
    return {
      t: "channel.event",
      channel: canal,
      seq: evento.seq,
      kind: evento.kind,
      ciphertext: evento.ciphertext,
      receivedAtMinute: 0,
      ...(evento.ref !== undefined ? { ref: evento.ref } : {}),
    }
  }
}

let rele = new Rele()

class FakeSocket {
  address: string | null = null
  readonly canais = new Set<string>()
  readyState = 0
  /**
   * The relay this socket was born with, not the one on the table now.
   *
   * This cost an afternoon. A session does not die with the test that created
   * it, it keeps reconnection timers, write timers, and key package refresh
   * timers running. If the socket read the `rele` variable when talking, those
   * old sessions would start talking to the NEXT test's relay: they would
   * publish key packages, which the next test would claim and use to add someone
   * to a tree they did not belong to. The result was a test that sometimes passed
   * in seven seconds and sometimes stood for nine hundred seconds grinding
   * cryptography for nothing.
   */
  readonly #rele = rele
  readonly #listeners = new Map<string, ((event: unknown) => void)[]>()

  constructor(readonly url: string) {
    this.#rele.ligacoes.add(this)
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
    this.#rele.frame(this, JSON.parse(raw) as Frame)
  }

  entregar(frame: unknown): void {
    // See TRAMAS_MAXIMAS: past the limit the relay goes silent, so a cascade does not
    // drag the whole suite down with it.
    if (this.#rele.entregues++ > TRAMAS_MAXIMAS) return
    setTimeout(() => this.#fire("message", { data: JSON.stringify(frame) }), 0)
  }

  close(): void {
    this.readyState = 3
    this.#rele.ligacoes.delete(this)
    this.#fire("close", {})
  }

  #fire(kind: string, event: unknown): void {
    for (const handler of [...(this.#listeners.get(kind) ?? [])]) handler(event)
  }
}

async function settle(times = 200): Promise<void> {
  for (let index = 0; index < times; index++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Real time, not `settle`.
 *
 * `settle` yields the turn n times and comes back almost immediately, it measures
 * microtasks, not the clock. There are paths here that wait for the clock on
 * purpose (`#honrarSaida` counts `REJOIN_TURN_MS` per place before touching the tree), and
 * a test that tried to measure them with `settle` would finish before what it
 * wanted to measure had even started, and pass, without measuring anything.
 */
function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * An explicit timeout, because the failure measured here is NOTHING HAPPENS.
 *
 * A queue closed on itself does not throw, does not log, does not warn: it
 * returns a promise that never resolves. Without a timeout, the test that hit
 * it would hang until the vitest limit, and a suite that hangs is a suite that
 * stops running. See `TRAMAS_MAXIMAS` at the top, which is the same lesson from
 * the other side. With a timeout, the deadlock fails in seconds and says what
 * it is.
 */
async function dentroDe<T>(prazoMs: number, oQue: string, trabalho: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const prazo = new Promise<never>((_, rejeitar) => {
    timer = setTimeout(
      () => rejeitar(new Error(`${oQue}: nada em ${prazoMs} ms — a fila do canal fechou-se sobre si própria`)),
      prazoMs,
    )
  })
  try {
    return await Promise.race([trabalho, prazo])
  } finally {
    clearTimeout(timer)
  }
}

/** Sessions open in this test, to close them before the next one starts. */
let abertas: Session[] = []

/** A real counter. The vault comes with it: see `cremalheira`. */
async function conta(): Promise<Conta> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  abertas.push(session)
  const { address } = await session.createIdentity("localhost:8448")
  await session.connect()
  await settle(20)
  return { session, address, vault }
}

interface Conta {
  session: Session
  address: string
  vault: Vault
}

function mensagem(corpo: string) {
  return {
    t: "message" as const,
    id: crypto.randomUUID(),
    sentAt: Date.now(),
    body: corpo,
    attachments: [],
    mentions: [],
    links: [],
  }
}

beforeEach(() => {
  rele = new Rele()
  abertas = []
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  // Without this, each test leaves three sessions alive grinding cryptography and
  // insisting with timers for the rest of the run. See `#rele` in the socket:
  // it is the other half of the same trap.
  for (const session of abertas) session.disconnect()
  abertas = []
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})

const CANAL = moradaDeTeste("lagar")

/**
 * Where the sender's ratchet goes, read from the VAULT.
 *
 * Nothing here touches private fields of the session: the test owns the `Vault` it
 * passed in, `flush()` is public, and what gets written is the state of the entire
 * group. From it comes the epoch and the generation of our own leaf in the secret
 * tree, which is, in MLS, half the pair (key, nonce) with which each application
 * message is sealed. The other half is the generation; the leaf is the person.
 *
 * This is the ruler that measures reuse, and it has to be this one: counting
 * lost messages shows the symptom, and there are many ways to lose a message.
 * A generation that GOES BACKWARDS within the same epoch is the failure itself,
 * stated in the terms of RFC 9420 §6.3.1.
 */
async function cremalheira(quem: Conta): Promise<{ epoch: number; gen: number }> {
  await quem.session.flush()
  const blob = quem.vault.contents.groups[CANAL]
  if (!blob) throw new Error(`${quem.address} não tem grupo gravado para ${CANAL}`)
  const gravada = await importSession(CANAL, fromBase64(blob))
  const folha = leafIndexOf(gravada.state.ratchetTree, quem.address as UserAddress)
  if (folha === undefined) throw new Error(`${quem.address} não tem folha em ${CANAL}`)
  // Leaf to tree node in the secret tree: leaves are the even indices.
  const no = gravada.state.secretTree[folha * 2]
  if (!no) throw new Error("árvore de segredos sem o nó da nossa folha")
  return { epoch: Number(gravada.state.groupContext.epoch), gen: no.application.generation }
}

/** Who is in the tree of this channel, as seen from the vault of the one asking. */
async function membros(quem: Conta): Promise<string[]> {
  await quem.session.flush()
  const blob = quem.vault.contents.groups[CANAL]
  if (!blob) throw new Error(`${quem.address} não tem grupo gravado para ${CANAL}`)
  const gravada = await importSession(CANAL, fromBase64(blob))
  return [...memberAddresses(gravada.state.ratchetTree).values()].map(String)
}

/** Ana founds the channel, Bento joins, and returns what Bento sees. */
async function canalComDois(): Promise<{
  ana: Conta
  bento: Conta
  carlos: Conta
  vistas: string[]
}> {
  const ana = await conta()
  const bento = await conta()
  const carlos = await conta()

  await ana.session.createSpaceChannel(CANAL)
  await settle(20)
  await ana.session.seat(CANAL, bento.address)
  await settle(60)

  const vistas: string[] = []
  bento.session.on("message", (evento) => {
    if (evento.payload.t === "message") vistas.push(evento.payload.body)
  })
  return { ana, bento, carlos, vistas }
}

/**
 * The message that goes missing when both apps are open and connected.
 *
 * Reported by the owner on 14 August 2026: she wrote, it appeared on her screen, and
 * on his it did not. No error, no warning, and with the event present on the
 * server-which is what made this so hard to explain.
 *
 * There are two bugs, one on each side of the wire, and they are the same thing: read the
 * group state, do cryptographic work, and write it again-with
 * another operation doing the same thing next to it, on the state you read.
 *
 * **Encrypting.** Two overlapping sends read the same ratchet and produce the
 * SAME generation. Whoever receives opens one and refuses the other with "Desired gen in the
 * past". On the screen of whoever wrote them both appear, because our own
 * send enters the local history without going through MLS. That is the whole report, told
 * by the cryptography.
 *
 * **Decrypting.** The trace, pulled from `#applyEvent` with a temporary log:
 *
 * ```
 * entra seq=5 kind=handshake   epochLido=1
 * entra seq=7 kind=application epochLido=1   ← starts before the commit ends
 * sai   seq=7 kind=ignored     razao=rejected: Error: invalid tag
 * sai   seq=5 kind=epoch       epochEscrita=2
 * ```
 *
 * The message was encrypted in epoch 2 e opened with the key of epoch 1, because
 * it read the group state before the commit that was being applied next to it
 * replaced it.
 *
 * In both cases nobody complains: a `receive` that fails does NOT throw-it is
 * handled inside `receive` and returned as `ignored`. The read anchor
 * moves past the message and it is never asked from any server again.
 *
 * The peaceful cases here are not filler: without them, a channel split top to bottom
 * would pass the other two with flying colors.
 */
describe("duas coisas ao mesmo tempo no mesmo canal", () => {
  it("dois envios sobrepostos: quem recebe tem de ver os dois", async () => {
    /*
      No one needs to write fast for this to happen. The "is typing" signal goes
      out without `await` every few seconds of writing, and the same goes for
      `republishRooms` and `publishProfile` when someone enters the channel.
      Either one catches the message midway, and it is always the message that
      goes missing: the other half of the pair is a signal no one notices is gone.
    */
    const { ana, vistas } = await canalComDois()

    await Promise.all([
      ana.session.send(CANAL, mensagem("primeira")),
      ana.session.send(CANAL, mensagem("segunda")),
    ])
    await settle(80)

    // Both appear on the screen of whoever wrote them, and that is why she swears
    // she sent them. What is measured here is the other side.
    expect(ana.session.history(CANAL).filter((item) => item.payload.t === "message")).toHaveLength(2)
    expect(vistas).toContain("primeira")
    expect(vistas).toContain("segunda")
  }, 60_000)

  it("um envio de cada vez continua a chegar — o caso pacífico", async () => {
    const { ana, vistas } = await canalComDois()

    await ana.session.send(CANAL, mensagem("primeira"))
    await settle(40)
    await ana.session.send(CANAL, mensagem("segunda"))
    await settle(40)

    expect(vistas).toEqual(["primeira", "segunda"])
  }, 60_000)

  it("com o commit já assente, a mensagem seguinte chega — o outro caso pacífico", async () => {
    const { ana, carlos, vistas } = await canalComDois()

    await ana.session.send(CANAL, mensagem("uma de cada vez"))
    await settle(40)
    expect(vistas).toContain("uma de cada vez")

    // Carlos joins (a commit, which changes the epoch), and we wait for it to be
    // applied before saying anything else.
    await ana.session.seat(CANAL, carlos.address)
    await settle(80)
    await ana.session.send(CANAL, mensagem("com tempo pelo meio"))
    await settle(80)

    expect(vistas).toContain("com tempo pelo meio")
  }, 60_000)

  it("e com o commit ainda a ser aplicado, também — era aqui que ela desaparecia", async () => {
    const { ana, carlos, vistas } = await canalComDois()

    await ana.session.send(CANAL, mensagem("uma de cada vez"))
    await settle(40)
    expect(vistas).toContain("uma de cada vez")

    // The only difference from the test above: nothing is waited for between the
    // commit and the message. It is what happens whenever someone joins a channel
    // while people are talking, both events come from the server milliseconds
    // apart, and the second catches the first midway.
    await ana.session.seat(CANAL, carlos.address)
    await ana.session.send(CANAL, mensagem("logo a seguir ao commit"))
    await settle(120)

    expect(vistas).toContain("logo a seguir ao commit")
  }, 60_000)
})

/**
 * Changes to the GROUP alongside a send, the rest of the same failure.
 *
 * The `describe` above closed the two paths that the per-channel queue already
 * held: encrypt (`#sendPayload`) and decrypt (`#applyEvent`). Left out were all
 * the ones that change the group with the same sequence, read `#groups`, wait
 * for cryptography, and write with `#persistGroup`, which is an unconditional
 * `set`. Two of these sequences overlapped always give the same thing: whoever
 * writes last wins, and the other's work vanishes without complaint.
 *
 * **What was proven here, different from what was suspected.** It was written
 * in `docs/PENDENTES.md` that the danger of these paths was the sender's ratchet
 * going backward, and with it the nonce. By measuring, it is not: `#invite`,
 * `#unseat`, `expel` and `#admit` COMMIT, and a commit advances the epoch.
 * The new epoch brings a new secret tree and generations starting from zero,
 * so the lost write from one of them throws away the count of an epoch that is
 * already over, and that does not get encrypted again. What they do wrong is
 * the opposite: the commit that was PUBLISHED gets undone at home, and the device
 * stays one epoch behind the entire channel, forever.
 *
 * The one that reuses the key is `backfillBefore`, which does not commit
 * anything, it only opens application messages, which leave the epoch where it
 * was. There the lost write puts back a generation lower IN THE EPOCH BEING
 * ENCRYPTED. It is the case that RFC 9420 §6.3.1 describes to justify the
 * `reuse_guard`, and it runs in `void` every connection, alongside all the
 * traffic.
 *
 * The three tests measure different things on purpose, the generation, the epoch,
 * and the channel staying alive, and none catches what the other catches. Swapping
 * them, or measuring all three from the same place, lets two failures through out
 * of three.
 */
describe("mexer no grupo enquanto se conversa", () => {
  it("recuperar mensagens ao lado de um envio não pode recuar a cremalheira", async () => {
    const { ana, bento, vistas } = await canalComDois()

    // History to recover from. Bento writes it: backfill brings application
    // messages from others, which is what does not touch the epoch.
    for (let indice = 0; indice < 6; indice++) {
      await bento.session.send(CANAL, mensagem(`antiga-${indice}`))
      await settle(20)
    }

    const antes = await cremalheira(ana)

    /*
      Recovery and a send at the same time, which is what happens every
      connection: `connect()` dispatches `#backfillMissed` with `void` and
      returns control, so the app is up and the person can write while a
      hundred-message page is decrypted underneath.
    */
    await Promise.all([
      ana.session.backfillBefore(CANAL),
      ana.session.send(CANAL, mensagem("primeira")),
    ])
    await settle(150)
    const depois = await cremalheira(ana)

    // The proof, and it is this: in the same epoch the generation only moves
    // forward. With recovery outside the queue, Ana would be spending the
    // generation and ending up with it unspent, same epoch, same number.
    expect(depois.epoch).toBe(antes.epoch)
    expect(depois.gen).toBeGreaterThan(antes.gen)

    // And the consequence, measured from the other side of the wire. The next
    // message was sealed with a generation Bento had already spent: he refuses it
    // in silence, and it does not exist for anyone except whoever wrote it.
    await ana.session.send(CANAL, mensagem("segunda"))
    await settle(150)
    expect(vistas).toContain("primeira")
    expect(vistas).toContain("segunda")
  }, 90_000)

  it("um convite não pode commitar a partir de uma árvore que já mudou", async () => {
    const { ana, bento, carlos, vistas } = await canalComDois()
    const david = await conta()

    /*
      The invite window, held open by hand.
      
      `#invite` read the tree, went to the server to fetch a key package, and
      committed based on what it had read BEFORE the roundtrip. Between those
      two things anything can happen: a send from us, and, what this test does
      , a commit from another member applied by `#applyEvent`. The invite would
      wake up and commit on a dead epoch.
      */
    rele.reterClaimsPara = david.address
    const convite = ana.session.seat(CANAL, david.address)
    await settle(20)

    // Bento adds Carlos. It is a real commit, and Ana applies it: the channel
    // changed epoch underneath the invite waiting for response.
    await bento.session.seat(CANAL, carlos.address)
    await settle(120)
    const noMeio = await cremalheira(ana)

    rele.libertarClaims()
    await convite
    await settle(200)
    const depois = await cremalheira(ana)

    /*
      One epoch, and exactly one, counted from where Ana was WHEN she committed.
      Committing from the old tree gives the same number and a different state
      , a fork, which is the costliest failure in this file because it has no
      symptom: both sides think they are in epoch 2 and neither opens what the
      other seals.
    */
    expect(depois.epoch).toBe(noMeio.epoch + 1)

    // And stated from the other side of the wire, which is where this would show:
    // if Ana had forked, nothing she wrote from here on would open in Bento's
    // device.
    await ana.session.send(CANAL, mensagem("depois do convite"))
    await settle(200)
    expect(vistas).toContain("depois do convite")
  }, 90_000)

  /**
   * The trap on the other side: the queue closing on itself.
   *
   * Leaving a channel makes `#honrarSaida` fire in ALL members, and it calls
   * `#unseat`, which now waits for the group queue. The path starts in
   * `#applyEvent`, which also uses the queue. Today it escapes for two reasons,
   * and both are fragile: `#applyEvent` releases the queue before hitting the
   * `member.left` branch, and dispatches it with `void`. Anyone who swaps that
   * `void` for an `await` inside the queued block puts the operation waiting on
   * itself, the same path it was called from is holding the queue, and the
   * channel stops forever.
   *
   * A deadlock is not stated, it is measured by what stops happening: if the
   * queue closes, the final send never goes out and this test dies on the timeout
   * instead of on an assertion. It is the only honest way to catch it.
   */
  it("honrar uma saída no meio da conversa não fecha a fila do canal", async () => {
    const { ana, carlos, vistas } = await canalComDois()
    await ana.session.seat(CANAL, carlos.address)
    await settle(120)
    expect(await membros(ana)).toContain(carlos.address)

    // Carlos leaves while Ana writes. The departure is published as a message in
    // the channel, so the instant it is honored is a traffic instant, which is
    // exactly why this started to hurt: `#honrarSaida` fires by itself in ALL
    // members every time anyone leaves.
    const trabalho: Promise<unknown>[] = [carlos.session.leaveChannel(CANAL)]
    for (let indice = 0; indice < 4; indice++) {
      trabalho.push(
        (async () => {
          await settle(indice * 5)
          await ana.session.send(CANAL, mensagem(`durante-${indice}`))
        })(),
      )
    }
    await dentroDe(PRAZO_MS, "a saída e os envios ao lado dela", Promise.all(trabalho))

    /*
      The clock, not `settle`. `#honrarSaida` counts `REJOIN_TURN_MS` per place
      ahead in the queue BEFORE touching the tree, everyone waits at least one
      turn, including the first. Without waiting here in real time, this test
      would finish before the `#unseat` it wants to measure had started, and
      would pass without measuring anything.
    */
    await esperar(REJOIN_TURN_MS * 3)
    await settle(200)

    /*
      The leaf is gone. This is the proof that the path ran TO THE END: it went
      through the group queue, committed and wrote. A deadlock would leave the
      leaf exactly where it was, silent, and the only visible difference would be
      a room that goes quiet in a few minutes.
    */
    expect(await membros(ana)).not.toContain(carlos.address)

    // And the channel keeps accepting work, with a timeout: this is what a queue
    // closed on itself would never allow.
    await dentroDe(PRAZO_MS, "o envio a seguir à saída", ana.session.send(CANAL, mensagem("depois da saída")))
    await settle(200)
    expect(vistas).toContain("depois da saída")
  }, 120_000)
})
