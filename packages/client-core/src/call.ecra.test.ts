import type { Payload, UserAddress } from "@enclave/protocol"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Call, tectoDoEcra, type CallBridge, type MediaKeyMaterial, type Participant } from "./call.js"

/**
 * Screen sharing, exercised without any browser.
 *
 * What these tests prove, and it is worth being precise about: that the screen
 * slot is reserved before any track, that sharing is a track swap and not a
 * negotiation, that the decision travels in frames that already existed, and
 * that the participant cap refuses instead of letting the call collapse.
 *
 * What they do NOT prove, and no amount of test harnesses would: that two
 * machines for real exchange screen image through a NAT. That is measured live,
 * and is written as pending in `docs/PENDENTES.md`.
 */

// -------------------------------------------------------------------- stubs

/** A sender, with the end where the track enters and exits. */
class FakeSender {
  faixa: MediaStreamTrack | null = null
  /** The tracks that passed through here, in order. `null` is a removal. */
  trocas: (MediaStreamTrack | null)[] = []
  parametros: { encodings: { maxBitrate?: number }[]; transactionId: string }

  constructor(comCodificacao = true) {
    this.parametros = { encodings: comCodificacao ? [{}] : [], transactionId: "t1" }
  }

  async replaceTrack(faixa: MediaStreamTrack | null): Promise<void> {
    this.faixa = faixa
    this.trocas.push(faixa)
  }

  getParameters(): { encodings: { maxBitrate?: number }[]; transactionId: string } {
    return this.parametros
  }

  async setParameters(next: { encodings: { maxBitrate?: number }[] }): Promise<void> {
    this.parametros.encodings = next.encodings
  }
}

class FakeTransceiver {
  sender = new FakeSender()
  constructor(
    public kind: string,
    public init: unknown,
  ) {}
}

class FakePeerConnection {
  static instances: FakePeerConnection[] = []

  localDescription: { type: string; sdp: string } | null = null
  remoteDescription: { type: string; sdp: string } | null = null
  connectionState = "new"
  closed = false
  /** Everything that was added, in order: this is the order of m-lines. */
  ordem: string[] = []
  transceivers: FakeTransceiver[] = []

  ontrack: ((event: unknown) => void) | null = null
  onicecandidate: ((event: unknown) => void) | null = null
  onconnectionstatechange: (() => void) | null = null

  constructor(public config: unknown) {
    FakePeerConnection.instances.push(this)
  }

  addTransceiver(kind: string, init: unknown): FakeTransceiver {
    this.ordem.push(`transceiver:${kind}`)
    const transceptor = new FakeTransceiver(kind, init)
    this.transceivers.push(transceptor)
    return transceptor
  }

  addTrack(track: MediaStreamTrack): unknown {
    this.ordem.push(`track:${track.kind}`)
    return {}
  }

  async createOffer(): Promise<{ type: string; sdp: string }> {
    return { type: "offer", sdp: "v=0\r\no=- oferta\r\n" }
  }

  async createAnswer(): Promise<{ type: string; sdp: string }> {
    return { type: "answer", sdp: "v=0\r\no=- resposta\r\n" }
  }

  async setLocalDescription(d: { type: string; sdp: string }): Promise<void> {
    this.localDescription = d
  }

  async setRemoteDescription(d: { type: string; sdp: string }): Promise<void> {
    this.remoteDescription = d
  }

  async addIceCandidate(): Promise<void> {}

  close(): void {
    this.closed = true
  }

  emitConnected(): void {
    this.connectionState = "connected"
    this.onconnectionstatechange?.()
  }

  /** A track that arrives through the reserved slot, the way a screen would. */
  emitirEcraRemoto(): MediaStream {
    const fluxo = fluxoDeEcra("ecra-do-par")
    this.ontrack?.({
      track: { kind: "video" },
      streams: [],
      receiver: {},
      transceiver: this.transceivers[0],
    })
    return fluxo
  }

  /** A camera, that arrives through a slot that is not the screen slot. */
  emitirCamaraRemota(fluxo: MediaStream): void {
    this.ontrack?.({ track: { kind: "video" }, streams: [fluxo], receiver: {}, transceiver: undefined })
  }
}

function faixaDeVideo(): MediaStreamTrack {
  return { kind: "video", enabled: true, stop: vi.fn(), onended: null } as unknown as MediaStreamTrack
}

/**
 * The `MediaStream` that Node does not have.
 *
 * When a screen track arrives through the reserved slot, `Call` wraps it in a
 * new `MediaStream` to hand to the UI, and in Node that constructor does not
 * exist, so the test would die with "MediaStream is not defined" complaining
 * about the environment, not the code. The double only needs to store tracks
 * and return them.
 */
class FluxoFalso {
  readonly id = "fluxo-construido"
  readonly #faixas: MediaStreamTrack[]
  constructor(faixas: MediaStreamTrack[] = []) {
    this.#faixas = faixas
  }
  getTracks(): MediaStreamTrack[] {
    return this.#faixas
  }
  getVideoTracks(): MediaStreamTrack[] {
    return this.#faixas.filter((faixa) => faixa.kind === "video")
  }
  getAudioTracks(): MediaStreamTrack[] {
    return this.#faixas.filter((faixa) => faixa.kind === "audio")
  }
}
;(globalThis as unknown as { MediaStream?: unknown }).MediaStream ??= FluxoFalso

function fluxoDeEcra(id: string): MediaStream {
  const video = faixaDeVideo()
  return {
    id,
    getTracks: () => [video],
    getAudioTracks: () => [],
    getVideoTracks: () => [video],
  } as unknown as MediaStream
}

function capturaLocal(): MediaStream {
  const audio = { kind: "audio", enabled: true, stop: vi.fn() }
  return {
    id: "captura",
    getTracks: () => [audio],
    getAudioTracks: () => [audio],
    getVideoTracks: () => [],
  } as unknown as MediaStream
}

const ALICE = "@alice:enclave.test" as UserAddress
const BRUNO = "@bruno:enclave.test" as UserAddress
const CHANNEL = "!geral:enclave.test"

function ponte(selfAddress: UserAddress, entregar?: (payload: Payload) => Promise<void>): CallBridge & {
  sent: Payload[]
} {
  const sent: Payload[] = []
  return {
    selfAddress,
    sent,
    async sendSignal(_channel, payload) {
      sent.push(payload)
      await entregar?.(payload)
    },
    async mediaKey(): Promise<MediaKeyMaterial | null> {
      return { keyId: 1, senderId: 0, material: new Uint8Array(28) }
    },
    async reservarContadorSframe(): Promise<number> {
      return 0
    },
  }
}

/** What the system dialog does when someone clicks share. */
let ecraOferecido: (() => Promise<MediaStream>) | null = null

beforeEach(() => {
  FakePeerConnection.instances = []
  ecraOferecido = async () => fluxoDeEcra("ecra-local-1")

  vi.stubGlobal("RTCPeerConnection", FakePeerConnection)
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: async () => capturaLocal(),
      getDisplayMedia: async () => {
        if (!ecraOferecido) throw new Error("sem diálogo")
        return ecraOferecido()
      },
    },
  })
})

describe("o lugar do ecrã", () => {
  /**
   * The decision that structures everything, pinned as a test.
   *
   * The transceiver must be born BEFORE the local tracks. The order of m-lines is
   * the order the transceivers are born in, and both sides must agree on which
   * one is the screen. Reserved after the tracks, a call where one side has a
   * camera and the other does not falls out of sync: whoever has no camera puts
   * the screen on the first video m-line, whoever has it puts the camera there.
   */
  it("é reservado antes de qualquer faixa local, e é o primeiro vídeo da ligação", async () => {
    let bruno: Call
    const daAlice = ponte(ALICE, (payload) => bruno.handleSignal(CHANNEL, ALICE, payload))
    const alice = new Call(daAlice)
    const doBruno = ponte(BRUNO, (payload) => alice.handleSignal(CHANNEL, BRUNO, payload))
    bruno = new Call(doBruno)

    await alice.join(CHANNEL)
    await bruno.join(CHANNEL)

    const ligacao = FakePeerConnection.instances[0]
    expect(ligacao?.ordem[0]).toBe("transceiver:video")
    // A single VIDEO slot. The audio slot that may follow is for screen audio,
    // and is born AFTER the local tracks (see "screen audio in the mesh").
    expect(ligacao?.transceivers.filter((t) => t.kind === "video")).toHaveLength(1)
    // `sendrecv`: whoever reserves the slot wants to send their screen and receive
    // the other's screen on the same m-line, without ever renegotiating.
    expect(ligacao?.transceivers[0]?.init).toMatchObject({ direction: "sendrecv" })
  })

  /**
   * And no renegotiation, which is the half that matters most.
   *
   * This repo has no `onnegotiationneeded`, and screen sharing does not bring
   * it: the SDP that goes out is the same before and after sharing. If someone
   * one day swaps `replaceTrack` for `addTrack`, it will break here.
   */
  it("partilhar não gera descrição nova: a troca é de faixa, não de negociação", async () => {
    let bruno: Call
    const daAlice = ponte(ALICE, (payload) => bruno.handleSignal(CHANNEL, ALICE, payload))
    const alice = new Call(daAlice)
    const doBruno = ponte(BRUNO, (payload) => alice.handleSignal(CHANNEL, BRUNO, payload))
    bruno = new Call(doBruno)

    await alice.join(CHANNEL)
    await bruno.join(CHANNEL)

    const ligacao = FakePeerConnection.instances[0]
    const sdpAntes = ligacao?.localDescription?.sdp
    const ofertasAntes = daAlice.sent.filter((p) => p.t === "voice.offer").length

    // The screen with a name, so we can assert WHICH track came in.
    const ecra = fluxoDeEcra("ecra-desta-troca")
    ecraOferecido = async () => ecra

    expect(await alice.startScreenShare()).toBe(true)

    expect(ligacao?.localDescription?.sdp).toBe(sdpAntes)
    expect(daAlice.sent.filter((p) => p.t === "voice.offer")).toHaveLength(ofertasAntes)
    // The track entered through the reserved slot, and no other slot.
    //
    // It was `not.toBeNull()`, which only said that SOME track was there, and the
    // slot is never empty, because it is reserved at entry with the camera track.
    // In other words: it would pass even if sharing had not swapped anything. Now
    // it says which one, which is the only thing that tells sharing apart from not sharing.
    expect(ligacao?.transceivers[0]?.sender.faixa).toBe(ecra.getVideoTracks()[0])
    expect(ligacao?.ordem.filter((entrada) => entrada.startsWith("track:video"))).toHaveLength(0)
  })

  it("a decisão viaja no anúncio, e a ausência dela é o que diz que acabou", async () => {
    let bruno: Call
    const daAlice = ponte(ALICE, (payload) => bruno.handleSignal(CHANNEL, ALICE, payload))
    const alice = new Call(daAlice)
    const doBruno = ponte(BRUNO, (payload) => alice.handleSignal(CHANNEL, BRUNO, payload))
    bruno = new Call(doBruno)

    await alice.join(CHANNEL)
    await bruno.join(CHANNEL)

    await alice.startScreenShare()
    const aPartilhar = daAlice.sent.filter((p) => p.t === "voice.join").at(-1)
    expect(aPartilhar).toMatchObject({ screen: true, screenStream: "ecra-local-1" })

    await alice.stopScreenShare()
    const parado = daAlice.sent.filter((p) => p.t === "voice.join").at(-1)
    // Omitted, not set to `false`: that is how an old client writes it, and that
    // is how this one keeps looking like it when there is nothing to say.
    expect(parado).not.toHaveProperty("screen")
    // And the track left the slot, leaving it standing for the next one.
    expect(FakePeerConnection.instances[0]?.transceivers[0]?.sender.trocas.at(-1)).toBeNull()
  })
})

describe("o tecto de participantes", () => {
  /**
   * The budget that justifies the cap, measured by itself.
   *
   * The mesh is peer-to-peer: whoever shares sends the image once per person.
   * The upload budget is split, with a cap and a floor.
   */
  it("reparte o orçamento de subida pelos pares, com tecto e piso", () => {
    expect(tectoDoEcra(0)).toBe(2_500_000)
    expect(tectoDoEcra(1)).toBe(2_500_000)
    expect(tectoDoEcra(2)).toBe(2_500_000)
    expect(tectoDoEcra(4)).toBe(1_250_000)
    // Five pairs is a call of six, which is the cap: one megabit each.
    expect(tectoDoEcra(5)).toBe(1_000_000)
    // And it does not go below the floor, because an unreadable screen is not sharing.
    expect(tectoDoEcra(100)).toBe(300_000)
  })

  it("o tecto de saída é escrito no emissor, e não só calculado", async () => {
    let bruno: Call
    const daAlice = ponte(ALICE, (payload) => bruno.handleSignal(CHANNEL, ALICE, payload))
    const alice = new Call(daAlice)
    const doBruno = ponte(BRUNO, (payload) => alice.handleSignal(CHANNEL, BRUNO, payload))
    bruno = new Call(doBruno)

    await alice.join(CHANNEL)
    await bruno.join(CHANNEL)
    await alice.startScreenShare()

    const emissor = FakePeerConnection.instances[0]?.transceivers[0]?.sender
    expect(emissor?.parametros.encodings[0]?.maxBitrate).toBe(tectoDoEcra(1))
  })

  /**
   * Refuse with the reason, instead of letting the call choke silently.
   *
   * At six people whoever shares sends five streams. At 2.5 Mbps each that is
   * 12.5 Mbps of upload, above what a Portuguese home connection usually gives,
   * and what happens when it does not is not a warning: it is the whole call
   * choking, voice included, because the outgoing queue is the same.
   */
  it("acima de seis pessoas recusa, e a frase diz porquê", async () => {
    const daAlice = ponte(ALICE)
    const alice = new Call(daAlice)
    const queixas: { detail: string; cause?: unknown }[] = []
    alice.on("error", (evento) => queixas.push(evento))

    await alice.join(CHANNEL)
    // Six pairs plus us is seven: one above the cap.
    for (let i = 0; i < 6; i += 1) {
      await alice.handleSignal(CHANNEL, `@p${i}:enclave.test` as UserAddress, {
        t: "voice.join",
        at: Date.now(),
        video: false,
        sframe: false,
        alone: true,
      })
    }

    expect(await alice.startScreenShare()).toBe(false)
    expect(alice.sharingScreen).toBe(false)
    const dito = queixas.at(-1)
    // Refusing is not enough: it must say that the image goes straight to each
    // person, which is the physical reason the refusal exists. The key says what,
    // and `cause` carries the numbers and the path to the phrase (see `codigosDeErro`).
    expect(dito?.detail).toBe("the call is too large to share a screen")
    expect(dito?.cause).toEqual({ pessoas: 7, tecto: 6, caminho: "directo" })
  })
})

describe("quando a partilha não chega a começar", () => {
  /**
   * Clicking cancel is not a fault, and cannot look like one.
   *
   * `NotAllowedError` is what the browser returns when you close the selector,
   * and `AbortError` when the page loses focus in the middle. Either one turning
   * into a red message was the product scolding someone who changed their mind.
   */
  it("cancelar o diálogo devolve `false` sem uma única queixa no ecrã", async () => {
    const daAlice = ponte(ALICE)
    const alice = new Call(daAlice)
    const queixas: string[] = []
    alice.on("error", (evento) => queixas.push(evento.detail))
    await alice.join(CHANNEL)

    ecraOferecido = async () => {
      const erro = new Error("Permission denied")
      erro.name = "NotAllowedError"
      throw erro
    }

    expect(await alice.startScreenShare()).toBe(false)
    expect(queixas).toEqual([])
    expect(alice.sharingScreen).toBe(false)
  })

  it("uma falha a sério é dita, e a diferença está no nome do erro", async () => {
    const daAlice = ponte(ALICE)
    const alice = new Call(daAlice)
    const queixas: string[] = []
    alice.on("error", (evento) => queixas.push(evento.detail))
    await alice.join(CHANNEL)

    ecraOferecido = async () => {
      const erro = new Error("hardware em uso")
      erro.name = "NotReadableError"
      throw erro
    }

    expect(await alice.startScreenShare()).toBe(false)
    expect(queixas).toHaveLength(1)
  })
})

describe("parar de partilhar", () => {
  /**
   * The BROWSER button, which is what almost everyone uses.
   *
   * Chrome puts a bar on top of everything with "Stop sharing", and whoever
   * clicks it does not pass through a single line of our code. Without the
   * `onended` handler on the track, the app would keep saying it was sharing,
   * peers would keep the slot open, and on the other side the last frame would
   * be frozen forever.
   */
  it("o botão do próprio browser pára a partilha na aplicação também", async () => {
    const daAlice = ponte(ALICE)
    const alice = new Call(daAlice)
    await alice.join(CHANNEL)

    const fluxo = fluxoDeEcra("ecra-local-1")
    ecraOferecido = async () => fluxo
    expect(await alice.startScreenShare()).toBe(true)

    const faixa = fluxo.getVideoTracks()[0] as MediaStreamTrack & { onended: (() => void) | null }
    expect(faixa.onended).toBeTypeOf("function")

    // This is what the browser does when you click its bar.
    faixa.onended?.()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(alice.sharingScreen).toBe(false)
  })

  it("sair da chamada pára a captura do ecrã, e não a deixa viva sozinha", async () => {
    const daAlice = ponte(ALICE)
    const alice = new Call(daAlice)
    await alice.join(CHANNEL)

    const fluxo = fluxoDeEcra("ecra-local-1")
    ecraOferecido = async () => fluxo
    await alice.startScreenShare()

    await alice.leave()

    expect(alice.sharingScreen).toBe(false)
    // The system recording indicator only clears when the track STOPS. Forgetting
    // to stop the stream without stopping the track left someone's screen being
    // captured after they stopped sharing, which is the worst bug this file could have.
    expect(fluxo.getVideoTracks()[0]?.stop).toHaveBeenCalled()
  })
})

describe("o ecrã que chega do outro lado", () => {
  /**
   * The banner always arrives, with or without sharing, because the slot is
   * reserved on all connections. It is the peer's declaration that decides
   * whether to display it. Drawing the banner instead of the declaration put
   * a black rectangle on everyone's screen for the entire call.
   */
  it("só se mostra depois de o par declarar que está a partilhar", async () => {
    const daAlice = ponte(ALICE)
    const alice = new Call(daAlice)
    let vistos: Participant[] = []
    alice.on("participants", (evento) => {
      vistos = evento.participants
    })
    await alice.join(CHANNEL)
    await alice.handleSignal(CHANNEL, BRUNO, {
      t: "voice.join",
      at: Date.now(),
      video: false,
      sframe: false,
      alone: true,
    })

    const ligacao = FakePeerConnection.instances[0]
    ligacao?.emitirEcraRemoto()

    // The banner is stored and not being displayed.
    expect(vistos[0]?.screen).toBeNull()

    // Now they say they are sharing, and the banner stays stored, because since
    // October 5, 2026 a screen only shows up on request. The bandwidth on the mesh
    // is already spent (the connection is direct and the sender owns it), and what
    // the choice does here is not put on screen what nobody asked to see.
    await alice.handleSignal(CHANNEL, BRUNO, {
      t: "voice.join",
      at: Date.now(),
      video: false,
      sframe: false,
      alone: false,
      screen: true,
      screenStream: "ecra-do-par",
    })
    expect(vistos[0]?.screen).toBeNull()
    // The offer stands: it is what lights up the bar with the "View" button.
    expect(vistos[0]?.ecraOferecido).toBe(true)

    // And on request, the same banner becomes visible.
    await alice.aceitarEcra(BRUNO)
    expect(vistos[0]?.screen).not.toBeNull()

    // And when they stop, the marker goes away, even with the banner still mounted.
    await alice.handleSignal(CHANNEL, BRUNO, {
      t: "voice.join",
      at: Date.now(),
      video: false,
      sframe: false,
      alone: false,
    })
    expect(vistos[0]?.screen).toBeNull()
  })

  /**
   * And the choice GOES AWAY when the person leaves, which is the pruning we
   * were missing.
   *
   * `#ecrasAceites` counted distinct people who shared and were accepted, not
   * people present, in a permanent room with rotation, an afternoon passes
   * through more than sixteen, and `aVer` has a cap of `TECTO_DO_AVER` in the
   * schema. Going over the cap does not give a truncated field: `encodePayload`
   * does `Payload.parse` and THROWS, so the announcement stops going out, and
   * at 160 seconds everyone removes us from the roster. Invisible and inaudible,
   * sending media.
   *
   * This is the mesh gate. The three from the SFU, disconnect, server alert
   * and roster expiry, are in `call.sfu-quatro.test.ts`, with the cap.
   */
  it("a escolha de ver um ecrã sai do anúncio quando a pessoa se despede", async () => {
    const daAlice = ponte(ALICE)
    const alice = new Call(daAlice)
    await alice.join(CHANNEL)
    await alice.handleSignal(CHANNEL, BRUNO, {
      t: "voice.join",
      at: Date.now(),
      video: false,
      sframe: false,
      alone: true,
      screen: true,
      screenStream: "ecra-do-par",
    })

    await alice.aceitarEcra(BRUNO)
    const comEscolha = daAlice.sent.filter((p) => p.t === "voice.join").at(-1)
    expect(comEscolha?.t === "voice.join" && comEscolha.aVer).toEqual([BRUNO])

    // They disconnect. The `#drop` removes what we knew about them, and it must
    // also remove OUR choice, which is the only thing that their reannouncement
    // cannot restore.
    await alice.handleSignal(CHANNEL, BRUNO, { t: "voice.leave", at: Date.now() })

    daAlice.sent.length = 0
    alice.setMuted(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const depois = daAlice.sent.filter((p) => p.t === "voice.join").at(-1)
    expect(depois).toBeDefined()
    expect(depois?.t === "voice.join" && depois.aVer).toBeUndefined()
  })

  /**
   * And whoever leaves and comes back must ask again, which is what the pruning
   * PROTECTS.
   *
   * The announcement's `aVer` stopped depending on pruning, it is intersected
   * with the two rosters inside `#anunciar`, where presence is known, and so
   * pruning was left with one function only, but essential: the choice belongs
   * to that call and that person. Without it, someone who disconnects and
   * re-enters would find their screen opening by itself, without anyone asking
   * for it this time, exactly what this slice came to undo.
   *
   * And that is why pruning lives in `voice.leave` and not at the `#drop`
   * gate: `#drop` also runs on repairs, where the person STAYS.
   */
  it("e quem se despede e volta a entrar não traz a escolha consigo", async () => {
    const daAlice = ponte(ALICE)
    const alice = new Call(daAlice)
    let vistos: Participant[] = []
    alice.on("participants", (evento) => {
      vistos = evento.participants
    })
    await alice.join(CHANNEL)
    const partilha = {
      t: "voice.join" as const,
      at: Date.now(),
      video: false,
      sframe: false,
      alone: true,
      screen: true,
      screenStream: "ecra-do-par",
    }
    await alice.handleSignal(CHANNEL, BRUNO, partilha)
    FakePeerConnection.instances[0]?.emitirEcraRemoto()
    await alice.aceitarEcra(BRUNO)
    expect(vistos.find((cada) => cada.address === BRUNO)?.screen).not.toBeNull()

    await alice.handleSignal(CHANNEL, BRUNO, { t: "voice.leave", at: Date.now() })

    // They return, and share again. The offer stands, the "View" button lights up
    //, and the image does not show until someone clicks it.
    await alice.handleSignal(CHANNEL, BRUNO, { ...partilha, at: Date.now() })
    FakePeerConnection.instances.at(-1)?.emitirEcraRemoto()
    const bruno = vistos.find((cada) => cada.address === BRUNO)
    expect(bruno?.ecraOferecido).toBe(true)
    expect(bruno?.screen).toBeNull()
  })

  it("uma câmara que chegue por outro lugar não é confundida com um ecrã", async () => {
    const daAlice = ponte(ALICE)
    const alice = new Call(daAlice)
    let vistos: Participant[] = []
    alice.on("participants", (evento) => {
      vistos = evento.participants
    })
    await alice.join(CHANNEL)
    await alice.handleSignal(CHANNEL, BRUNO, {
      t: "voice.join",
      at: Date.now(),
      video: true,
      sframe: false,
      alone: true,
      screen: true,
      screenStream: "ecra-do-par",
    })

    const camara = fluxoDeEcra("camara-do-par")
    FakePeerConnection.instances[0]?.emitirCamaraRemota(camara)

    // The id does not match what they announced: it is camera, and goes to `stream`.
    expect(vistos[0]?.stream?.id).toBe("camara-do-par")
    expect(vistos[0]?.screen).toBeNull()
  })
})
