import type { Payload, UserAddress } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Call, type CallBridge, type MediaKeyMaterial } from "./call.js"

/**
 * Leave a voice room and rejoin with three people.
 *
 * Report from the owner on August 13, 2026: "I leave and rejoin a room and always
 * lose the connection with one of the users". One of three, always, is the signature of one
 * of the two paths in the negotiation, the offerer decides by comparing
 * addresses, and in a group of three the person who returns typically has one peer on each
 * side of that comparison.
 *
 * The `churn-chamada.mjs` covers this with real browsers, and that's what measures the
 * truth about ICE. What it doesn't give is a deterministic scenario where the
 * ORDER is the same on each run: here delivery is synchronous and there's no network
 * to blame. It's the difference between "I couldn't reproduce it" and "it doesn't happen".
 */

// --------------------------------------------------------------------- stubs

/**
 * Who owns the connection being created.
 *
 * The constructor of an `RTCPeerConnection` doesn't know who asked it to be created, and
 * to tear down a connection FROM ONE SIDE ONLY you need to know. The harness marks
 * who is acting before it touches anything; since delivery is awaited, at each
 * moment there is exactly one owner.
 */
let donoActual: UserAddress | null = null

class FakePeerConnection {
  static instances: FakePeerConnection[] = []

  /** Who created this connection. See `donoActual`. */
  dono: UserAddress | null = donoActual

  localDescription: { type: string; sdp: string } | null = null
  remoteDescription: { type: string; sdp: string } | null = null
  connectionState = "new"
  closed = false

  ontrack: ((event: unknown) => void) | null = null
  onicecandidate: ((event: unknown) => void) | null = null
  onconnectionstatechange: (() => void) | null = null

  constructor(public config: unknown) {
    this.dono = donoActual
    FakePeerConnection.instances.push(this)
  }

  /**
   * What the browser does when ICE gives up: `failed`, and the warning.
   *
   * Only from this end. This is the asymmetry we want to measure, a connection can
   * die on one side and stay alive on the other for a long time, and that's where the
   * reports live.
   */
  falhar(): void {
    this.connectionState = "failed"
    this.onconnectionstatechange?.()
  }

  /** The tracks that entered this connection. A connection with none is silent. */
  addedTracks: unknown[] = []

  addTrack(faixa: unknown): unknown {
    this.addedTracks.push(faixa)
    return {}
  }

  async createOffer(): Promise<{ type: string; sdp: string }> {
    return { type: "offer", sdp: "sdp-offer" }
  }

  async createAnswer(): Promise<{ type: string; sdp: string }> {
    this.#respostaPreparada = true
    return { type: "answer", sdp: "sdp-answer" }
  }

  /**
   * An answer only gets set after it's been prepared.
   *
   * It's the browser's rule, and without it this double would accept any order: the
   * bug the owner saw ("cannot set local answer when createAnswer has not
   * been called") couldn't happen here, and the guard that fixes it went untested.
   *
   * `setRemoteDescription` of an offer puts the connection back to waiting for a
   * prepared answer; `createAnswer` prepares it; `setLocalDescription`
   * consumes it. Two interleaved answers use the same preparation, and the
   * second breaks, just like it does for real.
   */
  #respostaPreparada = false

  async setLocalDescription(description: { type: string; sdp: string }): Promise<void> {
    if (description.type === "answer") {
      if (!this.#respostaPreparada) {
        throw new Error("cannot set local answer when createAnswer has not been called")
      }
      this.#respostaPreparada = false
    }
    this.localDescription = description
  }

  async setRemoteDescription(description: { type: string; sdp: string }): Promise<void> {
    if (description.type === "answer" && this.remoteDescription?.type === "answer") {
      throw new Error("cannot set remote answer in state stable")
    }
    if (description.type === "offer") this.#respostaPreparada = false
    this.remoteDescription = description
  }

  async addIceCandidate(): Promise<void> {}

  getReceivers(): unknown[] {
    return []
  }

  getSenders(): unknown[] {
    return []
  }

  close(): void {
    this.closed = true
    this.connectionState = "closed"
  }

  /** What the browser does when ICE settles. Here it's explicit. */
  ligar(): void {
    this.connectionState = "connected"
    this.onconnectionstatechange?.()
  }
}

function fakeStream(): MediaStream {
  const track = {
    kind: "audio",
    enabled: true,
    stop(): void {},
    applyConstraints: async (): Promise<void> => {},
    getSettings: () => ({}),
  } as unknown as MediaStreamTrack
  return {
    getTracks: () => [track],
    getAudioTracks: () => [track],
    getVideoTracks: () => [],
    addTrack(): void {},
    removeTrack(): void {},
  } as unknown as MediaStream
}

beforeEach(() => {
  // False throughout the file: periodic reannouncement fires every five
  // seconds, and waiting for it for real would put five seconds of sleep in a unit test.
  // Synchronous scenarios use no timer and don't notice.
  vi.useFakeTimers()
  FakePeerConnection.instances = []
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection)
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: async () => fakeStream() } })
  vi.stubGlobal("MediaStream", class {
    getTracks(): unknown[] {
      return []
    }
    addTrack(): void {}
  })
})

// ------------------------------------------------------------------ the room

const CANAL = "!geral:s"
const SALA = "voz"

/**
 * Three clients on a bus, the way the server would connect them.
 *
 * Each signal goes to everyone except the sender, which is what a channel
 * does. Delivery is awaited: without that the test would measure its own run
 * instead of measuring the code's.
 */
/**
 * The same, but with the network acting like a network.
 *
 * The bus above delivers in sequence and awaited, so there are never two
 * `handleSignal` running at once. Real bridges do the opposite:
 * `void call.handleSignal(...)`, each incoming signal starts a handler that
 * sits suspended on its `await` while the next one already came in. Add to that
 * independent delays per recipient, and the order between peers disappears.
 *
 * It's the only difference between this file and the product, and that's why
 * a bug that doesn't show up in the deterministic scenario must show up here.
 */
function salaAssincrona(
  enderecos: UserAddress[],
  atrasoDe: (para: UserAddress) => number,
  entrega: (de: UserAddress, para: UserAddress, payload: Payload) => boolean = () => true,
): {
  chamadas: Map<UserAddress, Call>
  ligarTudo: () => void
  paresDe: (endereco: UserAddress) => string[]
  entrar: (endereco: UserAddress, opcoes?: { room?: string }) => Promise<void>
  ligacaoDe: (quem: UserAddress) => FakePeerConnection | undefined
  assentar: () => Promise<void>
} {
  const chamadas = new Map<UserAddress, Call>()
  const leitores = new Map<UserAddress, () => string[]>()
  const emVoo = new Set<Promise<unknown>>()

  for (const endereco of enderecos) {
    const bridge: CallBridge = {
      selfAddress: endereco,
      async sendSignal(canal, payload) {
        for (const [outro, chamada] of chamadas) {
          if (outro === endereco) continue
          // The network drops whatever the test tells it to drop. A lost packet is not an
          // edge case: it's Tuesday.
          if (!entrega(endereco, outro, payload)) continue
          // Neither awaited nor in order between destinations: like in the product.
          const emCaminho = new Promise<void>((resolver) => {
            setTimeout(() => {
              donoActual = outro
              void chamada
                .handleSignal(canal, endereco, payload)
                .catch(() => {})
                .then(() => {
                  donoActual = null
                  resolver()
                })
            }, atrasoDe(outro))
          })
          emVoo.add(emCaminho)
          void emCaminho.then(() => emVoo.delete(emCaminho))
        }
      },
      async mediaKey(): Promise<MediaKeyMaterial | null> {
        return { keyId: 1, senderId: 0, material: new Uint8Array(28) }
      },
      async reservarContadorSframe(): Promise<number> {
        return 0
      },
    }
    const chamada = new Call(bridge)
    chamadas.set(endereco, chamada)
    leitores.set(endereco, seguirPares(chamada))
  }

  /**
   * Only connect what has BOTH sides of the negotiation.
   *
   * Connecting everything that was open was the harness lying: an offer whose
   * answer got lost would be marked as connected, the connection timer
   * would be cancelled, and the scenario we wanted to measure would vanish. No
   * remote description means no candidates, no ICE and no connection, here as in the
   * browser.
   */
  const ligarTudo = (): void => {
    for (const ligacao of FakePeerConnection.instances) {
      if (!ligacao.closed && ligacao.remoteDescription) ligacao.ligar()
    }
  }

  /**
   * Let the network drain, and connect what opened in the meantime.
   *
   * Only advances the clock, never waits on a promise. Waiting on a
   * delivery whose timer hasn't fired yet is guaranteed deadlock: nothing
   * else advances time while waiting, and the delivery never comes. Caught for real: two
   * tests timed out the moment a fix made deliveries generate deliveries in sequence.
   */
  const assentar = async (): Promise<void> => {
    for (let volta = 0; volta < 60 && emVoo.size > 0; volta++) {
      await vi.advanceTimersByTimeAsync(20)
    }
    ligarTudo()
    await vi.advanceTimersByTimeAsync(20)
  }

  /** Join marking the owner, so connections are born with names. */
  const entrar = async (endereco: UserAddress, opcoes: { room?: string } = {}): Promise<void> => {
    donoActual = endereco
    try {
      await chamadas.get(endereco)!.join(CANAL, opcoes)
    } finally {
      donoActual = null
    }
  }

  /** The connection from X to Y, in the order it was created. The last one counts. */
  const ligacaoDe = (quem: UserAddress): FakePeerConnection | undefined =>
    FakePeerConnection.instances.filter((ligacao) => ligacao.dono === quem && !ligacao.closed).at(-1)

  return {
    chamadas,
    ligarTudo,
    paresDe: (endereco) => leitores.get(endereco)!(),
    entrar,
    ligacaoDe,
    assentar,
  }
}

function sala(enderecos: UserAddress[]): {
  chamadas: Map<UserAddress, Call>
  ligarTudo: () => void
  paresDe: (endereco: UserAddress) => string[]
} {
  const chamadas = new Map<UserAddress, Call>()
  const leitores = new Map<UserAddress, () => string[]>()

  for (const endereco of enderecos) {
    const bridge: CallBridge = {
      selfAddress: endereco,
      async sendSignal(canal, payload) {
        for (const [outro, chamada] of chamadas) {
          if (outro === endereco) continue
          await chamada.handleSignal(canal, endereco, payload)
        }
      },
      async mediaKey(): Promise<MediaKeyMaterial | null> {
        return { keyId: 1, senderId: 0, material: new Uint8Array(28) }
      },
      async reservarContadorSframe(): Promise<number> {
        return 0
      },
    }
    const chamada = new Call(bridge)
    chamadas.set(endereco, chamada)
    leitores.set(endereco, seguirPares(chamada))
  }

  // ICE settling, only where both sides negotiated. See the async harness,
  // which explains why this can't connect everything.
  const ligarTudo = (): void => {
    for (const ligacao of FakePeerConnection.instances) {
      if (!ligacao.closed && ligacao.remoteDescription) ligacao.ligar()
    }
  }

  return { chamadas, ligarTudo, paresDe: (endereco) => leitores.get(endereco)!() }
}

/**
 * Who this person has a connection with, by what the INTERFACE receives.
 *
 * Read from the last emitted `participants` not from an internal field: it's
 * exactly the list that draws the cards, and the report is about what you see.
 */
function seguirPares(chamada: Call): () => string[] {
  let ultimo: string[] = []
  chamada.on("participants", ({ participants }) => {
    ultimo = participants.map((participante) => participante.address).sort()
  })
  return () => ultimo
}

/**
 * Push the clock, and let what it woke up run to completion.
 *
 * Periodic reannouncement fires every five seconds. Waiting for it for real
 * would put five seconds of sleep in a unit test; with fake timers it's instant,
 * but what they fire is async and needs microtask turns to settle.
 */
async function avancar(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

afterEach(() => vi.useRealTimers())

const ANA = "@ana:s" as UserAddress
const BRUNO = "@bruno:s" as UserAddress
const CARLA = "@carla:s" as UserAddress

describe("sair de uma sala de voz e voltar a entrar", () => {
  it("os três ficam ligados uns aos outros na primeira entrada", async () => {
    const { chamadas, ligarTudo, paresDe } = sala([ANA, BRUNO, CARLA])

    for (const chamada of chamadas.values()) await chamada.join(CANAL, { room: SALA })
    ligarTudo()

    expect(paresDe(ANA)).toEqual([BRUNO, CARLA])
    expect(paresDe(BRUNO)).toEqual([ANA, CARLA])
    expect(paresDe(CARLA)).toEqual([ANA, BRUNO])
  })

  it("quem sai e volta reencontra os DOIS, e não um só", async () => {
    // The report, letter by letter. `@bruno` is in the middle of alphabetical order:
    // on return, he offers to one peer and waits for the offer from the other, both sides
    // of an address comparison at once.
    const { chamadas, ligarTudo, paresDe } = sala([ANA, BRUNO, CARLA])
    for (const chamada of chamadas.values()) await chamada.join(CANAL, { room: SALA })
    ligarTudo()

    const bruno = chamadas.get(BRUNO)!
    await bruno.leave()
    await bruno.join(CANAL, { room: SALA })
    ligarTudo()

    expect(paresDe(BRUNO)).toEqual([ANA, CARLA])
    expect(paresDe(ANA)).toEqual([BRUNO, CARLA])
    expect(paresDe(CARLA)).toEqual([ANA, BRUNO])
  })

  it("e aguenta sair e voltar quatro vezes seguidas", async () => {
    const { chamadas, ligarTudo, paresDe } = sala([ANA, BRUNO, CARLA])
    for (const chamada of chamadas.values()) await chamada.join(CANAL, { room: SALA })
    ligarTudo()

    const bruno = chamadas.get(BRUNO)!
    for (let volta = 0; volta < 4; volta++) {
      await bruno.leave()
      await bruno.join(CANAL, { room: SALA })
      ligarTudo()
      expect(paresDe(BRUNO), `volta ${volta + 1}`).toEqual([ANA, CARLA])
    }
  })

  it("quem volta com o endereço mais baixo também os reencontra aos dois", async () => {
    // The other end of the comparison: `@ana` never waits for anyone's offer,
    // she offers to both. If one of the paths is broken, one of these two
    // tests passes and the other doesn't.
    const { chamadas, ligarTudo, paresDe } = sala([ANA, BRUNO, CARLA])
    for (const chamada of chamadas.values()) await chamada.join(CANAL, { room: SALA })
    ligarTudo()

    const ana = chamadas.get(ANA)!
    await ana.leave()
    await ana.join(CANAL, { room: SALA })
    ligarTudo()

    expect(paresDe(ANA)).toEqual([BRUNO, CARLA])
  })

  it("quem volta com o endereço mais alto também", async () => {
    const { chamadas, ligarTudo, paresDe } = sala([ANA, BRUNO, CARLA])
    for (const chamada of chamadas.values()) await chamada.join(CANAL, { room: SALA })
    ligarTudo()

    const carla = chamadas.get(CARLA)!
    await carla.leave()
    await carla.join(CANAL, { room: SALA })
    ligarTudo()

    expect(paresDe(CARLA)).toEqual([ANA, BRUNO])
  })
})

describe("a mesma reentrada, com a rede a portar-se como rede", () => {
  /**
   * Different delays per destination, which is the normal case not the extreme: two
   * people on the same call are never the same distance from the server.
   */
  const ATRASOS: Record<string, number> = { "@ana:s": 1, "@bruno:s": 7, "@carla:s": 3 }

  it("quem sai e volta reencontra os dois", async () => {
    const { chamadas, paresDe, assentar } = salaAssincrona([ANA, BRUNO, CARLA], (para) => ATRASOS[para] ?? 1)
    for (const chamada of chamadas.values()) await chamada.join(CANAL, { room: SALA })
    await assentar()

    const bruno = chamadas.get(BRUNO)!
    await bruno.leave()
    await bruno.join(CANAL, { room: SALA })
    await assentar()

    expect(paresDe(BRUNO)).toEqual([ANA, CARLA])
    expect(paresDe(ANA)).toEqual([BRUNO, CARLA])
    expect(paresDe(CARLA)).toEqual([ANA, BRUNO])
  })

  it("e quando a saída e a entrada são coladas uma à outra", async () => {
    // Leave and rejoin without waiting for the leave to finish, which is what a
    // double click does. The internal queue serializes both operations, but the
    // signals they emit travel on independent paths.
    const { chamadas, paresDe, assentar } = salaAssincrona([ANA, BRUNO, CARLA], (para) => ATRASOS[para] ?? 1)
    for (const chamada of chamadas.values()) await chamada.join(CANAL, { room: SALA })
    await assentar()

    const bruno = chamadas.get(BRUNO)!
    const saida = bruno.leave()
    const entrada = bruno.join(CANAL, { room: SALA })
    await Promise.all([saida, entrada])
    await assentar()

    expect(paresDe(BRUNO)).toEqual([ANA, CARLA])
    expect(paresDe(ANA)).toEqual([BRUNO, CARLA])
    expect(paresDe(CARLA)).toEqual([ANA, BRUNO])
  })
})

describe("uma oferta que se perde, numa chamada de três", () => {
  /**
   * The hole the owner described as "whenever there are 3+ members, it doesn't connect
   * so seamlessly".
   *
   * Whoever returns to a room announces themselves, and then only acts in half the cases: to
   * whoever has a bigger address they offer; from whoever has a smaller address they WAIT for
   * an offer. In that half no peer gets created, and where there's no peer there's no
   * connection timer, so the network can drop that offer and there's nothing to notice.
   *
   * With two people this still worked: whoever ends up with no peer at all reannounces
   * themselves every five seconds. With three it stops working, because
   * just ONE live connection is enough to silence the periodic announcement, and the
   * person sees the other in "connecting" while hearing the third perfectly.
   *
   * The test drops the FIRST offer Ana sends to Carla, and nothing else.
   * Without the fix, Carla ends up only with Bruno and there's nothing in the system
   * that makes her look for Ana again.
   */
  it("quem esperava a oferta volta a anunciar-se, e acaba ligado aos dois", async () => {
    let comidas = 0
    const { chamadas, paresDe, assentar } = salaAssincrona(
      [ANA, BRUNO, CARLA],
      () => 1,
      (de, para, payload) => {
        if (payload.t === "voice.offer" && de === ANA && para === CARLA && comidas === 0) {
          comidas++
          return false
        }
        return true
      },
    )
    for (const chamada of chamadas.values()) await chamada.join(CANAL, { room: SALA })
    await assentar()

    const carla = chamadas.get(CARLA)!
    await carla.leave()
    comidas = 0
    await carla.join(CANAL, { room: SALA })
    // Time for periodic reannouncement to run: it's what retries the attempt.
    await assentar()
    // 25s plus margin: how long the connection timer takes to give up on an
    // unanswered offer, and it's the only thing that retries the attempt today.
    await avancar(30_000)
    await assentar()

    console.log("ANA", paresDe(ANA), "BRUNO", paresDe(BRUNO), "CARLA", paresDe(CARLA), "comidas", comidas)
    expect(comidas, "a oferta tem de ter sido mesmo comida").toBe(1)
    expect(paresDe(CARLA)).toEqual([ANA, BRUNO])
    expect(paresDe(ANA)).toEqual([BRUNO, CARLA])
  })
})


/**
 * A connection that dies ON ONE SIDE ONLY, in a three-person call.
 *
 * It's the bug that the twelve previous tests didn't catch, and the reason is that
 * they all tore down connections on both sides at the same time, which is what
 * happens when someone leaves, not what happens when the network cuts.
 *
 * What happens for real: the peer loses the connection with us, does `#drop` with
 * reason "failed", owes us a retry, and reannounces themselves every five
 * seconds. But with the SAME `joinId`, the lifetime id only changes on rejoin, and they
 * didn't rejoin; the network just fell out from under them.
 *
 * On our side, three guards cancel each other out:
 *
 * 1. `#novaVidaDe` compares the `joinId`, sees it's the same, and clears nothing.
 * 2. Resource cleanup requires `alone`, and in a three-person call they still have
 *    the third peer, so `alone: false`.
 * 3. `#offer` gives up right away because the dead peer still has `localDescription`.
 *
 * Twelve announcements later they give up. They see us in "connecting" forever; we
 * see them as connected, because our state is old. It's "I always lose the connection
 * with one of the users" and "with 3+ it doesn't connect so seamlessly",
 * word for word, and **it doesn't reproduce with two people**, because with two
 * whoever ends up with no peer at all has `alone: true` and guard 2 saves them.
 */
describe("uma ligação que morre de um lado só", () => {
  it("o outro lado volta a oferecer, e os dois reencontram-se", async () => {
    const { chamadas, paresDe, entrar, ligacaoDe, assentar } = salaAssincrona(
      [ANA, BRUNO, CARLA],
      () => 1,
    )
    for (const endereco of [ANA, BRUNO, CARLA]) await entrar(endereco, { room: SALA })
    await assentar()
    expect(paresDe(BRUNO)).toEqual([ANA, CARLA])

    /*
      Bruno's connection dies. Only his: Ana still thinks everything is
      fine, which is exactly the state that prevents repair.

      `@ana` < `@bruno`, so Ana is the one who has to offer, and it's her offer
      that the `localDescription` guard refuses to make.
    */
    ligacaoDe(BRUNO)!.falhar()
    await assentar()

    // Bruno reannounces himself every five seconds. We let it happen three times.
    await avancar(16_000)
    await assentar()

    expect(paresDe(BRUNO), "o Bruno tem de reencontrar a Ana").toContain(ANA)
    expect(paresDe(ANA), "e a Ana tem de o ter de volta").toContain(BRUNO)
  })

  it("com duas pessoas isto já se safava, e é por isso que ninguém deu por ele", async () => {
    // The same scenario without the third: whoever dies has NO peer at all, the
    // announcement goes out with `alone: true`, and the other side's resource cleanup fires.
    // This test exists to pin down the difference, not to prove the bug.
    const { paresDe, entrar, ligacaoDe, assentar } = salaAssincrona([ANA, BRUNO], () => 1)
    for (const endereco of [ANA, BRUNO]) await entrar(endereco, { room: SALA })
    await assentar()

    ligacaoDe(BRUNO)!.falhar()
    await assentar()
    await avancar(16_000)
    await assentar()

    expect(paresDe(BRUNO)).toEqual([ANA])
  })
})

/**
 * A signal arriving while the microphone is still opening.
 *
 * `#join` publishes `#channel` and `#room` BEFORE asking for capture, and capture
 * takes time: an IPC hop to the main process to open the permission gate,
 * plus `getUserMedia`, plus the system dialog if it's the first time. That's
 * tens or hundreds of milliseconds where this object says it's in a call and doesn't have a single track.
 *
 * A signal arriving in that window passes all the filters in `handleSignal` and
 * goes to build a peer. `#buildPeer` iterates `this.#local?.getTracks() ?? []`,
 * which at that point is an empty list: a connection is born **with no tracks**,
 * with local description set. From then on the `#offer` guard refuses to remake it
 * forever, the call settles, the card turns green, and no sound passes.
 *
 * Whoever arrives in that window is not hypothetical: anyone in `#perdidos`
 * reannounces themselves every five seconds, and with three or more there's always someone
 * announcing.
 */
describe("um sinal que chega antes de haver microfone", () => {
  it("não deixa nascer uma ligação sem faixas", async () => {
    /*
      Capture takes 50 ms, modest, and faster than reality.
      During that time Ana's announcement reaches Bruno.
    */
    let demorar = 0
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => {
          if (demorar > 0) await new Promise((resolver) => setTimeout(resolver, demorar))
          return fakeStream()
        },
      },
    })

    const { paresDe, entrar, assentar, chamadas } = salaAssincrona([ANA, BRUNO], () => 1)
    await entrar(ANA, { room: SALA })
    await assentar()

    // Bruno joins with slow microphone, and Ana announces on top of it.
    demorar = 50
    const entrada = chamadas.get(BRUNO)!.join(CANAL, { room: SALA })
    await vi.advanceTimersByTimeAsync(5)
    await chamadas.get(ANA)!.handleSignal(CANAL, BRUNO as UserAddress, {
      t: "voice.join",
      at: 1,
      video: false,
      sframe: false,
      alone: true,
      room: SALA,
    } as never)
    await vi.advanceTimersByTimeAsync(60)
    await entrada
    await assentar()

    // Every connection that exists has to carry tracks with it. A silent connection
    // is worse than none: it looks good and won't be remade.
    const mudas = FakePeerConnection.instances.filter(
      (ligacao) => !ligacao.closed && ligacao.addedTracks.length === 0,
    )
    expect(mudas, `${mudas.length} ligações nasceram sem faixas`).toHaveLength(0)
    expect(paresDe(BRUNO)).toEqual([ANA])
  })
})

/**
 * A peer erased by a key that hasn't arrived yet.
 *
 * `rekey` runs on each epoch change and erases whoever can't decrypt. The
 * most common reason for that is not that the person left the channel: it's that the
 * group tree is half a step behind on this end, in the middle of a commit. Short
 * window, and real.
 *
 * The erasure was done with the default reason, a clean exit, which
 * removed the person from `#perdidos` and killed the only path back. The other
 * side got no signal: without `voice.leave`, without ICE drop, they
 * kept seeing us connected while we'd already erased them.
 */
describe("rekey com a árvore meio passo atrasada", () => {
  it("fica a dever a tentativa, em vez de desistir da pessoa", async () => {
    const { chamadas, entrar, assentar, paresDe } = salaAssincrona([ANA, BRUNO, CARLA], () => 1)
    for (const endereco of [ANA, BRUNO, CARLA]) await entrar(endereco, { room: SALA })
    await assentar()

    // The key stops going out to Carla, Ana's tree is behind.
    const ana = chamadas.get(ANA)!
    const bridge = (ana as unknown as { bridge: { mediaKey: unknown } }).bridge
    const original = bridge.mediaKey as (canal: string, quem: string) => Promise<unknown>
    bridge.mediaKey = async (canal: string, quem: string) =>
      quem === CARLA ? null : original.call(bridge, canal, quem)

    await ana.rekey(CANAL)
    await assentar()

    // Once the tree settles, Carla is reachable again.
    bridge.mediaKey = original
    await avancar(16_000)
    await assentar()

    expect(paresDe(ANA), "a Ana tem de reencontrar a Carla").toContain(CARLA)
  })
})

/**
 * Two offers for the same pair at the same time.
 *
 * Reported by the owner on August 14, 2026, with the full error message: "cannot set
 * local answer when createAnswer has not been called", on the second connection, and in
 * both directions. On the third attempt it works, because by then the second offer
 * arrives after the first one is done.
 *
 * `#offer` had per-pair guards from the start; `#answer` did not. Bridges call
 * `handleSignal` without serialization, so two offers for the same pair would interleave
 * `setRemoteDescription`/`createAnswer`/`setLocalDescription` on the same connection,  * and the second one would crash, bubble up to the bridge and become an error on
 * screen, leaving one side without a response.
 */
describe("duas ofertas do mesmo par, ao mesmo tempo", () => {
  it("respondem uma vez e não rebentam", async () => {
    const { chamadas, entrar, assentar, paresDe } = salaAssincrona([ANA, BRUNO], () => 1)
    await entrar(ANA, { room: SALA })
    const ana = chamadas.get(ANA)!

    const erros: string[] = []
    ana.on("error", (evento) => erros.push(evento.detail))

    const oferta = {
      t: "voice.offer",
      at: 1,
      to: ANA,
      sdp: "sdp-offer",
      video: false,
      sframe: false,
      room: SALA,
    }

    // Both at once, the way they arrive when nothing serializes them.
    await Promise.all([
      ana.handleSignal(CANAL, BRUNO, oferta as never),
      ana.handleSignal(CANAL, BRUNO, { ...oferta, at: 2 } as never),
    ])
    await assentar()

    expect(erros, `erro de sinalização: ${erros.join(" · ")}`).toEqual([])
    expect(paresDe(ANA)).toEqual([BRUNO])
  })
})

/**
 * The microphone state announced more than once.
 *
 * Report from the owner on August 14, 2026: "I'm hearing a user whose mute icon is
 * active... it's unpredictable". Unpredictable is the right word for a frame that gets
 * lost sometimes and not others: the state was announced ONCE, at the instant it
 * changed, and that was the only delivery. Lose that frame and the icon stays wrong
 * for everyone for the rest of the call.
 */
describe("o estado do microfone", () => {
  it("é anunciado mais do que uma vez, para um frame perdido não o fixar errado", async () => {
    const { chamadas, entrar, assentar } = salaAssincrona([ANA, BRUNO], () => 1)
    await entrar(ANA, { room: SALA })
    await assentar()

    const ana = chamadas.get(ANA)!
    const anuncios: boolean[] = []
    const bridge = (ana as unknown as { bridge: { sendSignal: (c: string, p: Payload) => Promise<void> } }).bridge
    const original = bridge.sendSignal.bind(bridge)
    bridge.sendSignal = async (canal, payload) => {
      if (payload.t === "voice.join") anuncios.push((payload as { muted?: boolean }).muted ?? false)
      await original(canal, payload)
    }

    ana.setMuted(true)
    await avancar(4_000)
    await assentar()

    // More than one, all saying the same thing.
    expect(anuncios.length).toBeGreaterThan(1)
    expect(anuncios.every((mudo) => mudo)).toBe(true)
  })

  it("e as repetições dizem o estado ACTUAL, não o de quando foram agendadas", async () => {
    // Two quick clicks on the button cannot leave two broadcasts disagreeing
    // with each other.
    const { chamadas, entrar, assentar } = salaAssincrona([ANA, BRUNO], () => 1)
    await entrar(ANA, { room: SALA })
    await assentar()

    const ana = chamadas.get(ANA)!
    const anuncios: boolean[] = []
    const bridge = (ana as unknown as { bridge: { sendSignal: (c: string, p: Payload) => Promise<void> } }).bridge
    const original = bridge.sendSignal.bind(bridge)
    bridge.sendSignal = async (canal, payload) => {
      if (payload.t === "voice.join") anuncios.push((payload as { muted?: boolean }).muted ?? false)
      await original(canal, payload)
    }

    ana.setMuted(true)
    ana.setMuted(false)
    await avancar(4_000)
    await assentar()

    // The last state is "not muted", and that is what the broadcasts must say.
    expect(anuncios.at(-1)).toBe(false)
  })
})

/**
 * Two in the call, the third joins.
 *
 * Report from the owner on August 14, 2026: "two users connect, when the
 * third joins it keeps connecting until it drops".
 *
 * Those already there build the pair for one of them, and that build would turn off
 * the announcement for the other: a connection being born silences the one still waiting
 * to be born. Whoever was on the wrong side of the address comparison, the one
 * expecting the offer instead of making it, would wait for a re-announcement that
 * never came.
 */
describe("o terceiro a entrar numa chamada de dois", () => {
  it("liga-se aos dois, e não fica à espera de um deles", async () => {
    const { entrar, assentar, paresDe } = salaAssincrona([ANA, BRUNO, CARLA], () => 1)

    // The first two, and the call settles between them.
    await entrar(ANA, { room: SALA })
    await entrar(CARLA, { room: SALA })
    await assentar()
    expect(paresDe(ANA)).toEqual([CARLA])

    // Now the third arrives, with the address between the other two: makes an offer to one
    // and waits for an offer from the other, which is the case where this broke.
    await entrar(BRUNO, { room: SALA })
    await assentar()
    await avancar(12_000)
    await assentar()

    expect(paresDe(BRUNO), "o terceiro tem de ficar ligado aos dois").toEqual([ANA, CARLA])
    expect(paresDe(ANA)).toEqual([BRUNO, CARLA])
    expect(paresDe(CARLA)).toEqual([ANA, BRUNO])
  })
})

/**
 * A connection that drops to `disconnected` and stays there.
 *
 * The connection timer was cleared the first time the connection settled and was never
 * rearmed. After that, only `failed` and `closed` opened a path back, but a connection
 * can drop to `disconnected` and stay: network change, Wi-Fi to mobile data, intermittent
 * consent checks. The engine does not always scale that to `failed` in useful time.
 *
 * In that state the person had no timer, did not enter `#perdidos` and got no
 * re-announcement: "connecting" forever, which is what the owner reported.
 */
describe("uma ligação que cai para disconnected", () => {
  it("volta a ter prazo, e a pessoa acaba por ser procurada outra vez", async () => {
    const { entrar, assentar, paresDe, ligacaoDe } = salaAssincrona([ANA, BRUNO], () => 1)
    await entrar(ANA, { room: SALA })
    await entrar(BRUNO, { room: SALA })
    await assentar()
    expect(paresDe(ANA)).toEqual([BRUNO])

    // Drops to `disconnected` and stays there: the engine does not scale to `failed`.
    const ligacao = ligacaoDe(ANA)!
    ligacao.connectionState = "disconnected"
    ligacao.onconnectionstatechange?.()

    // Once the connection timer expires, the person must have been searched for, that is,
    // entered the list of those owed a reconnection attempt, which makes the announcement
    // restart.
    await avancar(30_000)
    await assentar()

    /*
      The hung connection must have been closed.

      That is what the timer does when it gives up: `#drop(…, "falhou")` closes it and
      puts the person in the list of those owed a reconnection attempt, which makes the
      announcement restart. Without the timer rearmed, it stayed open and "connecting"
      forever, and the assertion that matters is exactly this one.
    */
    expect(ligacao.closed, "a ligação pendurada tem de acabar por ser fechada").toBe(true)
  })
})

/**
 * Someone leaves while we are building their connection.
 *
 * `#buildPeer` only writes to `#peers` at the end, after waiting for the ICE servers.
 * `#drop` cleared the build flag but could not cancel the build, and it would finish
 * and resurrect whoever had left: the card back on screen, the twenty-five second timer
 * starting for a connection nobody was going to answer, and the re-announcement chasing
 * someone no longer there.
 *
 * The guard that existed compared the channel, and that does not catch this case: someone
 * who leaves a room and comes back to the same one has the same channel on both sides of
 * the window.
 */
describe("sair a meio de uma construção", () => {
  it("não ressuscita quem saiu", async () => {
    const { chamadas, entrar, assentar, paresDe } = salaAssincrona([ANA, BRUNO], () => 1)
    await entrar(ANA, { room: SALA })
    const ana = chamadas.get(ANA)!

    // The build takes time, as it does for real: the ICE servers come
    // from the homeserver over a network round trip.
    const bridge = (ana as unknown as { bridge: { iceServers?: unknown } }).bridge
    bridge.iceServers = async () => {
      await new Promise((resolver) => setTimeout(resolver, 40))
      return []
    }

    const aConstruir = ana.handleSignal(CANAL, BRUNO, {
      t: "voice.join",
      at: 1,
      video: false,
      sframe: false,
      alone: true,
      room: SALA,
    } as never)
    // And he leaves before the build finishes.
    await ana.handleSignal(CANAL, BRUNO, { t: "voice.leave", at: 2, room: SALA } as never)
    await avancar(80)
    await aConstruir
    await assentar()

    expect(paresDe(ANA), "quem saiu não pode reaparecer").toEqual([])
  })
})

/**
 * A late answer from a lifetime that has already been replaced.
 *
 * `#vidaQueRespondeu` was called BEFORE the pair guard, so a `voice.answer` that arrived
 * late, from a connection to that person that no longer exists, would write the old
 * `joinId` over the good one. The next announcement from that person would be compared
 * against a stale number, `#novaVidaDe` would conclude "new lifetime", and drop the GOOD
 * connection: exactly the bug that `joinId` exists to cure, self-inflicted.
 */
describe("uma resposta que chega tarde", () => {
  it("não faz caducar a vida da ligação que está boa", async () => {
    const { chamadas, entrar, assentar, paresDe } = salaAssincrona([ANA, BRUNO], () => 1)
    await entrar(ANA, { room: SALA })
    await entrar(BRUNO, { room: SALA })
    await assentar()
    expect(paresDe(ANA)).toEqual([BRUNO])

    const ana = chamadas.get(ANA)!

    // An answer from an old lifetime of Bruno, for a connection that no longer
    // exists. It must not leave a trace in the lifetime accounting.
    await ana.handleSignal(CANAL, BRUNO, {
      t: "voice.answer",
      at: 1,
      to: ANA,
      sdp: "sdp-antigo",
      joinId: "vida-que-ja-passou",
      room: SALA,
    } as never)

    // Now Bruno announces himself again with the CURRENT lifetime. If the old
    // `joinId` had been recorded, this would read as a new lifetime and drop everything.
    await ana.handleSignal(CANAL, BRUNO, {
      t: "voice.join",
      at: 2,
      video: false,
      sframe: false,
      alone: false,
      room: SALA,
    } as never)
    await assentar()

    expect(paresDe(ANA), "a ligação boa tem de sobreviver").toEqual([BRUNO])
  })
})

/**
 * The mesh rebuilds too many connections when the third joins.
 *
 * Reproduced on August 16, 2026 against real browsers
 * (`scripts/e2e-chamada-epoch.mjs`, then a directed script): "each one tried
 * exactly two connections -- 2, 2, 3". The extra connection is born and dies in
 * milliseconds, with no description from either side, and the pattern is always the
 * same, whoever joins LAST with the SMALLEST address. It is the case the owner
 * reported live: "two users connect, when the third joins it keeps connecting until
 * it drops".
 *
 * The product's own logs wrote the cause in fifteen milliseconds:
 *
 *   19.977  call-reparar-pedido  @zolly…   → drop → ofereço → peer-new
 *   19.992  call-reparar-pedido  @zolly…   → drop → ofereço → peer-new
 *
 * Two repair requests for THE SAME PAIR, and the second drops the connection that
 * the first ordered to be made. The second request came out before the offer got there:
 * it could not know, and we honored it anyway.
 *
 * The root is the `reparar` field, which comes from `#perdidos`, and `#perdidos`
 * stores TWO different things under the same name:
 *
 *   a) "I am waiting for their offer", written when someone announces and we end up
 *      on the side that waits (`call-espero-oferta`). There was never a connection.
 *   b) "the connection I had with them dropped", written by `#drop(…, "falhou")`.
 *
 * `reparar` means "the connection you think you have with me is dead, throw it away",
 * and only (b) authorizes saying that. In (a) we know nothing about what the other side
 * has, and what they have, at that instant, is the offer we just asked them for,
 * freshly born.
 *
 * Whoever joins last with the smallest address hits this from BOTH sides: the other two
 * are both waiting for their offer and both send their name to them inside `reparar`.
 */
describe("o terceiro a entrar, com o endereço mais baixo", () => {
  /** One connection per ordered pair. Anything more is wasted work. */
  const LUGARES = 6

  it("constrói seis ligações, e não sete", async () => {
    const ATRASO: Record<string, number> = { "@ana:s": 1, "@bruno:s": 3, "@carla:s": 2 }
    const { entrar, assentar, paresDe } = salaAssincrona([ANA, BRUNO, CARLA], (para) => ATRASO[para] ?? 1)
    // The ORDER is what reproduces it. Ana joins last and has the lowest address:
    // the other two end up on the side that waits for her offer.
    for (const endereco of [CARLA, BRUNO]) await entrar(endereco, { room: SALA })
    await assentar()
    await entrar(ANA, { room: SALA })
    await assentar()

    expect(paresDe(ANA), "os três têm de acabar ligados").toEqual([BRUNO, CARLA])
    expect(paresDe(BRUNO)).toEqual([ANA, CARLA])
    expect(paresDe(CARLA)).toEqual([ANA, BRUNO])

    const construidas = FakePeerConnection.instances.length
    expect(construidas, `${construidas} ligações para ${LUGARES} lugares`).toBe(LUGARES)
  })

  /**
   * And the repair request continues to serve what it was written for.
   *
   * The fix narrows `reparar` to those who DROPPED, and a fix that narrows too much
   * erases the mechanism instead of tuning it. This is the scenario from the August 13
   * report, a connection that dies on one side only, requiring that the pair name
   * continue to travel in the announcement.
   */
  it("mas quem cai de um lado só continua a ser pedido de volta", async () => {
    const pedidos: string[] = []
    const { chamadas, entrar, ligacaoDe, assentar } = salaAssincrona([ANA, BRUNO, CARLA], () => 1)
    for (const endereco of [ANA, BRUNO, CARLA]) await entrar(endereco, { room: SALA })
    await assentar()

    // On everyone: whoever receives the request is the pair of the connection that dropped,
    // and which of the two is determined by the order in which Bruno's connections were born.
    for (const chamada of chamadas.values()) {
      chamada.on("diagnostic", ({ code, detail }) => {
        if (code === "call-reparar-pedido") pedidos.push(String(detail))
      })
    }

    // Only Bruno's connection dies. Ana still thinks everything is fine.
    ligacaoDe(BRUNO)!.falhar()
    await assentar()
    await avancar(16_000)
    await assentar()

    expect(pedidos, "o Bruno tem de pedir a reparação à Ana").toContain(BRUNO)
  })
})

/**
 * Joining a call cost 2ⁿ−1 announcements.
 *
 * Whoever has the larger address answers the announcement of whoever has the smallest,  * and the answer is itself an announcement, making all the larger ones answer, whose
 * answers make the even larger ones answer. A growing chain for each subset of addresses,
 * which is the definition of 2ⁿ.
 *
 * Measured in the harness, with entry in descending address order (the bad case: whoever
 * joins is always the smallest, so everyone answers them): 3 people → 7 announcements,
 * 4 → 15, 5 → 31, 6 → 63. Each announcement is a message encrypted by MLS, passed through
 * the per-channel queue in `session.ts`, and multiplied by the number of recipients: 315
 * messages to set up a six-person call.
 *
 * The answer serves for one thing only, tell whoever has the smallest address that we
 * are here, so they will make an offer. To those we already have a pair with, there is
 * nothing to say.
 *
 * The limit becomes what can be justified: one entry per person, plus at most one answer
 * per ordered pair that does not yet exist.
 */
describe("o custo de montar uma chamada", () => {
  const CINCO = ["@a1:s", "@a2:s", "@a3:s", "@a4:s", "@a5:s"] as UserAddress[]
  /** n entries + at most one answer per ordered pair. 5 + 10 = 15. */
  const TECTO = CINCO.length + (CINCO.length * (CINCO.length - 1)) / 2

  it("não cresce a dobrar com cada pessoa a mais", async () => {
    const { chamadas, entrar, assentar } = salaAssincrona(CINCO, () => 1)

    let anuncios = 0
    for (const chamada of chamadas.values()) {
      const ponte = (chamada as unknown as { bridge: CallBridge }).bridge
      const original = ponte.sendSignal.bind(ponte)
      ponte.sendSignal = async (canal, payload) => {
        if (payload.t === "voice.join") anuncios++
        await original(canal, payload)
      }
    }

    // In DESCENDING order: whoever joins always has the smallest address of all,
    // so everyone there answers them. It is the worst case, and it is the normal
    // case, the order of addresses has nothing to do with arrival order.
    for (const endereco of [...CINCO].reverse()) {
      await entrar(endereco, { room: SALA })
      await assentar()
    }

    expect(anuncios, `${anuncios} anúncios para cinco pessoas`).toBeLessThanOrEqual(TECTO)
    // And the mesh closes all the same: one connection per ordered pair, no leftovers.
    const vivas = FakePeerConnection.instances.filter((ligacao) => !ligacao.closed)
    expect(vivas, `${vivas.length} ligações`).toHaveLength(CINCO.length * (CINCO.length - 1))
  })
})
