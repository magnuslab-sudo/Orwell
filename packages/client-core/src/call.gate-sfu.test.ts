import type { Payload, UserAddress } from "@enclave/protocol"
import { ambitoDaChamada, PESSOAS_COM_ECRA } from "@enclave/protocol"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Call, type CallBridge, type MediaKeyMaterial } from "./call.js"
import type {
  ConsumidorDeMedia,
  DispositivoDeMedia,
  ParametrosDoTransporte,
  ProdutorDeMedia,
  TransporteDeMedia,
} from "./call-sfu.js"

/**
 * The gate: with SFU no mesh line runs, and without SFU everything runs as it
 * did yesterday.
 *
 * This is the mandatory guarantee of Phase 2, and it is not a formality of
 * compatibility. The deployment rule is server first, client later, the same
 * as device chain restart, and it only works if a new client against a server
 * without SFU is INDISTINGUISHABLE from the old client. A client that assumes
 * SFU because its version knows how to do it will negotiate with a gate that
 * does not exist, and what the person sees is a call that never connects
 * against the same server that worked yesterday.
 *
 * The least obvious case is the third, and it is what forces the question down
 * to `join` instead of staying in bridge construction: **a server can go
 * backwards.** A rollback in production, an old container coming up, a media
 * worker that died, and the next call must go back to the mesh on its own,
 * without anyone remembering to close anything.
 */

class FakePeerConnection {
  static instances: FakePeerConnection[] = []
  localDescription: { type: string; sdp: string } | null = null
  remoteDescription: unknown = null
  connectionState = "new"
  closed = false
  ontrack: ((event: unknown) => void) | null = null
  onicecandidate: ((event: unknown) => void) | null = null
  onconnectionstatechange: (() => void) | null = null

  constructor(public config: unknown) {
    FakePeerConnection.instances.push(this)
  }
  addTrack(): unknown {
    return {}
  }
  addTransceiver(): unknown {
    return { sender: {} }
  }
  async createOffer(): Promise<{ type: string; sdp: string }> {
    return { type: "offer", sdp: "v=0\r\n" }
  }
  async createAnswer(): Promise<{ type: string; sdp: string }> {
    return { type: "answer", sdp: "v=0\r\n" }
  }
  async setLocalDescription(d: { type: string; sdp: string }): Promise<void> {
    this.localDescription = d
  }
  async setRemoteDescription(d: unknown): Promise<void> {
    this.remoteDescription = d
  }
  async addIceCandidate(): Promise<void> {}
  close(): void {
    this.closed = true
  }
}

function fakeStream(): MediaStream {
  const audio = { kind: "audio", enabled: true, stop: vi.fn() }
  return {
    getTracks: () => [audio],
    getAudioTracks: () => [audio],
    getVideoTracks: () => [],
  } as unknown as MediaStream
}

/** A screen capture pretending: a video track, which is what it has. */
function fluxoDeEcra(): MediaStream {
  const video = { kind: "video", enabled: true, stop: vi.fn(), onended: null }
  return {
    id: "ecra-falso",
    getTracks: () => [video],
    getAudioTracks: () => [],
    getVideoTracks: () => [video],
  } as unknown as MediaStream
}

const ALICE = "@alice:s" as UserAddress
const BRUNO = "@bruno:s" as UserAddress
const CANAL = "!geral:s"

/** The `mediasoup-client` pretending. Only what is needed to set up the call. */
class DispositivoFalso implements DispositivoDeMedia {
  readonly rtpCapabilities = { codecs: [] }
  /**
   * What the ROUTER negotiates, not what this device can do.
   *
   * Static because the bridge builds a new device on each call; whoever wants
   * it fake sets it fake before entering. Fake is a Phase 2 homeserver, router
   * with Opus only, and that is where screen sharing must refuse BEFORE
   * opening the system selector.
   */
  static video = true
  async load(): Promise<void> {}
  canProduce(kind: "audio" | "video"): boolean {
    return kind === "audio" || DispositivoFalso.video
  }
  #transporte(id: string): TransporteDeMedia {
    /*
     * The two returns from `mediasoup-client` that go through signaling: the
     * `connect` (DTLS) and the `produce`. The fake MUST fire them, otherwise
     * the test measures a setup that never talks to the server, and would pass
     * with a client that produced nothing.
     */
    let aoLigar: ((d: { dtlsParameters: unknown }, feito: () => void, falhou: (e: Error) => void) => void) | null = null
    let aoProduzir:
      | ((
          d: { kind: "audio" | "video"; rtpParameters: unknown; appData: Record<string, unknown> },
          feito: (r: { id: string }) => void,
          falhou: (e: Error) => void,
        ) => void)
      | null = null

    const fecharDtls = async (): Promise<void> => {
      const ligar = aoLigar
      aoLigar = null
      if (ligar) await new Promise<void>((resolve, reject) => ligar({ dtlsParameters: {} }, resolve, reject))
    }

    return {
      id,
      on: (evento: "connect" | "produce", ouvinte: never) => {
        if (evento === "connect") aoLigar = ouvinte
        else aoProduzir = ouvinte
      },
      produce: async (opcoes): Promise<ProdutorDeMedia> => {
        // Like `mediasoup-client`: the sender is born before the offer and goes to `onRtpSender` (SEC-02).
        const emissor = { createEncodedStreams: () => ({ readable: new ReadableStream(), writable: new WritableStream() }) } as unknown as RTCRtpSender
        opcoes.onRtpSender?.(emissor)
        await fecharDtls()
        // The `kind` comes from the track and the `appData` is echoed, as in the real
        // library: a double that always said "audio" hid the entire screen.
        const feito = await new Promise<{ id: string }>((resolve, reject) =>
          aoProduzir?.(
            { kind: opcoes.track.kind as "audio" | "video", rtpParameters: {}, appData: opcoes.appData ?? {} },
            resolve,
            reject,
          ),
        )
        return { id: feito.id, rtpSender: emissor, close: () => {} }
      },
      consume: async (opcoes): Promise<ConsumidorDeMedia> => {
        await fecharDtls()
        return {
          id: opcoes.id,
          producerId: opcoes.producerId,
          track: { kind: "audio" } as MediaStreamTrack,
          rtpReceiver: { createEncodedStreams: () => ({ readable: new ReadableStream(), writable: new WritableStream() }) } as unknown as RTCRtpReceiver,
          close: () => {},
        }
      },
      close: () => {},
    }
  }
  createSendTransport(o: ParametrosDoTransporte): TransporteDeMedia {
    return this.#transporte(o.id)
  }
  createRecvTransport(o: ParametrosDoTransporte): TransporteDeMedia {
    return this.#transporte(o.id)
  }
}

interface Ponte extends CallBridge {
  sent: Payload[]
  pedidosSfu: string[]
}

/**
 * A bridge with optional SFU.
 *
 * `temSfu` is read on EACH `join`, not stored: that is what lets the test
 * stage a server rollback in the middle of the same object's life, which is
 * what actually happens when an old container comes back up.
 */
function ponte(
  selfAddress: UserAddress,
  entregar: (payload: Payload) => Promise<void>,
  temSfu: () => boolean | Promise<boolean>,
): Ponte {
  const sent: Payload[] = []
  const pedidosSfu: string[] = []
  return {
    selfAddress,
    sent,
    pedidosSfu,
    async sendSignal(_canal, payload) {
      sent.push(payload)
      await entregar(payload)
    },
    async mediaKey(): Promise<MediaKeyMaterial | null> {
      return { keyId: 41, senderId: 0, material: new Uint8Array(32).fill(7) }
    },
    async reservarContadorSframe(): Promise<number> {
      return 0
    },
    sfu: {
      suportaSfu: temSfu,
      criarDispositivo: () => new DispositivoFalso(),
      async sfuEntrarNoAmbito(canal, ambito) {
        pedidosSfu.push(`scope.join:${canal}:${ambito}`)
        return { rtpCapabilities: {}, producers: [] }
      },
      sfuSairDoAmbito(canal, ambito) {
        pedidosSfu.push(`scope.leave:${canal}:${ambito}`)
      },
      async sfuCriarTransporte(_c, _a, sentido) {
        pedidosSfu.push(`transport.create:${sentido}`)
        return { id: `t-${sentido}`, iceParameters: {}, iceCandidates: [], dtlsParameters: {} }
      },
      async sfuLigarTransporte(transporte) {
        pedidosSfu.push(`transport.connect:${transporte}`)
      },
      async sfuProduzir(_t, _kind, _rtp, fonte) {
        pedidosSfu.push(`produce:${fonte ?? "sem-fonte"}`)
        return `p-${fonte ?? "nosso"}`
      },
      async sfuFecharProdutor(produtor) {
        pedidosSfu.push(`produce.close:${produtor}`)
      },
      async sfuConsumir(_t, produtor) {
        pedidosSfu.push(`consume:${produtor}`)
        return { id: `c-${produtor}`, producerId: produtor, kind: "audio" as const, rtpParameters: {} }
      },
      async sfuRetomar(_t, consumidor) {
        pedidosSfu.push(`resume:${consumidor}`)
      },
      // The symmetric one, for the same reason as in `call.presenca-sfu.test.ts`:
      // a double without it gives "sfuPausar is not a function" inside
      // `largarEcraDe`, which the `try/catch` there converts to a diagnosis and
      // leaves the test green.
      async sfuPausar(_t, consumidor) {
        pedidosSfu.push(`pause:${consumidor}`)
      },
    },
  }
}

beforeEach(() => {
  FakePeerConnection.instances = []
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection)
  /*
    Cipher on the prototype: the gate asks if THIS engine knows how to cipher
    before choosing the SFU, and a `class {}` and a Firefox. With it, the
    entire "WITH SFU" block measured the mesh and said the SFU worked.
  */
  class MotorQueCifra {
    createEncodedStreams(): unknown {
      return { readable: new ReadableStream(), writable: new WritableStream() }
    }
  }
  vi.stubGlobal("RTCRtpSender", MotorQueCifra)
  vi.stubGlobal("RTCRtpReceiver", MotorQueCifra)
  DispositivoFalso.video = true
  vi.stubGlobal(
    "MediaStream",
    class {
      readonly tracks: MediaStreamTrack[]
      constructor(tracks: MediaStreamTrack[] = []) {
        this.tracks = [...tracks]
      }
      getTracks(): MediaStreamTrack[] {
        return [...this.tracks]
      }
      getVideoTracks(): MediaStreamTrack[] {
        return this.tracks.filter((faixa) => faixa.kind === "video")
      }
      addTrack(faixa: MediaStreamTrack): void {
        if (!this.tracks.includes(faixa)) this.tracks.push(faixa)
      }
      removeTrack(faixa: MediaStreamTrack): void {
        const onde = this.tracks.indexOf(faixa)
        if (onde >= 0) this.tracks.splice(onde, 1)
      }
    },
  )
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: async () => fakeStream() },
  })
})

describe("um servidor SEM SFU continua a funcionar exactamente como hoje", () => {
  it("constrói a malha e negoceia par a par, como sempre", async () => {
    let bruno: Call
    const pAlice = ponte(ALICE, (p) => bruno.handleSignal(CANAL, ALICE, p), () => false)
    const alice = new Call(pAlice)
    const pBruno = ponte(BRUNO, (p) => alice.handleSignal(CANAL, BRUNO, p), () => false)
    bruno = new Call(pBruno)

    await alice.join(CANAL)
    await bruno.join(CANAL)

    // The proof is twofold, and both halves are needed. That the mesh ran:
    expect(FakePeerConnection.instances.length).toBeGreaterThan(0)
    expect(pAlice.sent.some((p) => p.t === "voice.offer") || pBruno.sent.some((p) => p.t === "voice.offer")).toBe(true)

    // And that the SFU was NEVER touched. Without this second half, the test
    // passed with a client that did both things at the same time.
    expect(pAlice.pedidosSfu).toEqual([])
    expect(pBruno.pedidosSfu).toEqual([])

    await alice.leave()
    await bruno.leave()
  })

  it("e uma ponte sem `sfu` nenhum comporta-se do mesmo modo", async () => {
    // The oldest server in this repository, and an Electron from a version that
    // never heard of this. "Did not say" must read as "does not have".
    const sent: Payload[] = []
    const call = new Call({
      selfAddress: ALICE,
      async sendSignal(_c, payload) {
        sent.push(payload)
      },
      async mediaKey(): Promise<MediaKeyMaterial | null> {
        return { keyId: 41, senderId: 0, material: new Uint8Array(32) }
      },
      async reservarContadorSframe(): Promise<number> {
        return 0
      },
    })

    await call.join(CANAL)

    expect(sent.filter((p) => p.t === "voice.join")).toHaveLength(1)
    expect(call.active).toBe(true)

    await call.leave()
  })
})

describe("um servidor COM SFU não constrói malha nenhuma", () => {
  it("negoceia com o servidor e não com o par", async () => {
    let bruno: Call
    const pAlice = ponte(ALICE, (p) => bruno.handleSignal(CANAL, ALICE, p), () => true)
    const alice = new Call(pAlice)
    const pBruno = ponte(BRUNO, (p) => alice.handleSignal(CANAL, BRUNO, p), () => true)
    bruno = new Call(pBruno)

    await alice.join(CANAL)
    await bruno.join(CANAL)

    // Zero `RTCPeerConnection` built by this code: the ones that exist are from
    // `mediasoup-client`, and those are on its side.
    expect(FakePeerConnection.instances).toEqual([])
    // And no offer. The category of defect that lived in simultaneous
    // negotiations has no way to appear.
    expect([...pAlice.sent, ...pBruno.sent].some((p) => p.t === "voice.offer")).toBe(false)

    await alice.leave()
    await bruno.leave()
  })

  it("entra no âmbito da sala, com o resumo que o servidor sabe validar", async () => {
    const pAlice = ponte(ALICE, async () => {}, () => true)
    const alice = new Call(pAlice)

    await alice.join(CANAL, { room: "musica" })

    // The scope is calculated by the client and must match the one of whoever
    // is in the same room, otherwise they fall into different routers and cannot
    // hear each other, with the call saying it is connected on both sides.
    expect(pAlice.pedidosSfu[0]).toBe(`scope.join:${CANAL}:${ambitoDaChamada(CANAL, "musica")}`)

    await alice.leave()
  })

  it("faz os dois transportes e põe a voz no ar", async () => {
    const pAlice = ponte(ALICE, async () => {}, () => true)
    const alice = new Call(pAlice)

    await alice.join(CANAL)

    expect(pAlice.pedidosSfu).toContain("transport.create:envio")
    expect(pAlice.pedidosSfu).toContain("transport.create:recepcao")
    expect(pAlice.pedidosSfu).toContain("produce:microfone")

    await alice.leave()
  })

  it("o voice.join continua a sair: é o roster, e o servidor não o lê", async () => {
    const pAlice = ponte(ALICE, async () => {}, () => true)
    const alice = new Call(pAlice)

    await alice.join(CANAL)

    // Presence does not change planes. Whoever is in the call, silent or not,
    // keeps traveling encrypted inside the MLS, and that is why the server knows
    // there is a call and does not know who is there by room.
    expect(pAlice.sent.filter((p) => p.t === "voice.join")).toHaveLength(1)

    await alice.leave()
  })

  it("desenha quem está na chamada a partir do roster cifrado", async () => {
    const pAlice = ponte(ALICE, async () => {}, () => true)
    const alice = new Call(pAlice)
    const listas: string[][] = []
    alice.on("participants", (evento) => listas.push(evento.participants.map((cada) => cada.address)))

    await alice.join(CANAL)
    await alice.handleSignal(CANAL, BRUNO, { t: "voice.join", at: Date.now(), video: false, sframe: true, alone: true })

    expect(listas.at(-1)).toEqual([BRUNO])

    // And `voice.leave` removes them. With SFU there is no ICE drop to do that for
    // us: there is a connection, to the server, and it does not drop because
    // someone leaves.
    await alice.handleSignal(CANAL, BRUNO, { t: "voice.leave", at: Date.now() })
    expect(listas.at(-1)).toEqual([])

    await alice.leave()
  })

  /**
   * Whoever enters a call that is already running did NOT hear the announcement
   * of who is there.
   *
   * The `#comecarAnuncio` comment already said this in full, "arrived before
   * there were ears, and whoever is there has no reason to repeat it", and
   * the mesh solves it with periodic announcement. The SFU path threw the
   * periodic announcement away, claiming "whoever introduces people is the
   * gateway, with `sfu.producer.new`".
   *
   * The claim has a hole, and this test is it. The gateway introduces
   * PRODUCERS, which is media; whoever is in the call, silent or not, with
   * video or without it, keeps traveling in the encrypted roster, and
   * `#anunciarPorSfu` draws from the roster, not the flows. Without a response
   * to the announcement of whoever arrives, their roster stays empty forever.
   *
   * What was seen in the app, measured on August 16, 2026: the second to enter
   * received 674 frames, deciphered 674, and the screen said "waiting for
   * someone to enter". The sound came to them encrypted, opened, and died at
   * the decoder gate, because without a card on screen there is no element to
   * tap. A silent call with all lights green, which is the fault that this
   * entire file exists to prevent.
   */
  it("quem já lá estava responde a quem chega, senão o recém-chegado fica cego", async () => {
    let bruno: Call
    const pAlice = ponte(ALICE, async (p) => bruno.handleSignal(CANAL, ALICE, p), () => true)
    const alice = new Call(pAlice)
    const pBruno = ponte(BRUNO, async (p) => alice.handleSignal(CANAL, BRUNO, p), () => true)
    bruno = new Call(pBruno)

    const vistosPorBruno: string[][] = []
    bruno.on("participants", (evento) => vistosPorBruno.push(evento.participants.map((cada) => cada.address)))
    const vistosPorAlice: string[][] = []
    alice.on("participants", (evento) => vistosPorAlice.push(evento.participants.map((cada) => cada.address)))

    await alice.join(CANAL)
    await bruno.join(CANAL)
    // The response goes out without waiting for it, announcing cannot delay
    // frame processing. Two event loop turns arrive.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(vistosPorBruno.at(-1)).toEqual([ALICE])
    expect(vistosPorAlice.at(-1)).toEqual([BRUNO])

    /*
     * And responds ONCE, not in ping-pong.
     *
     * The response is a `voice.join` like any other: if each announcement
     * generated another announcement, two clients in a call would send frames
     * to each other forever, and the `sfu.*` per minute cap would close the
     * call on its own after a while. What stops it is novelty, respond to
     * whoever is not yet in the roster, and no one else.
     */
    expect(pAlice.sent.filter((cada) => cada.t === "voice.join")).toHaveLength(2)
    expect(pBruno.sent.filter((cada) => cada.t === "voice.join")).toHaveLength(2)

    await alice.leave()
    await bruno.leave()
  })

  it("ignora uma oferta de um cliente de malha, e di-lo no registo", async () => {
    const pAlice = ponte(ALICE, async () => {}, () => true)
    const alice = new Call(pAlice)
    const diagnosticos: string[] = []
    alice.on("diagnostic", (evento) => diagnosticos.push(evento.code))

    await alice.join(CANAL)
    await alice.handleSignal(CANAL, BRUNO, {
      t: "voice.offer",
      to: ALICE,
      sdp: "v=0\r\n",
      video: false,
    })

    // There is no interoperability between a mesh client and an SFU client in the
    // same call, and responding would set up a second connection for the same
    // person. Ignoring is the honest possible behavior, but let it be said,
    // because on the other side someone will see "connecting" until they give up.
    expect(FakePeerConnection.instances).toEqual([])
    expect(diagnosticos).toContain("call-sfu-oferta-de-malha")

    await alice.leave()
  })

  it("larga os transportes à saída", async () => {
    const pAlice = ponte(ALICE, async () => {}, () => true)
    const alice = new Call(pAlice)

    await alice.join(CANAL)
    await alice.leave()

    // The `startsWith` threw away exactly the part that matters: the scope. Leaving
    // someone else's scope, or a made-up scope, satisfied it the same, and it is
    // a leave that does not release any transport of whoever left. What is
    // required is to leave EXACTLY what you entered.
    const entrada = pAlice.pedidosSfu.find((cada) => cada.startsWith("scope.join:"))
    expect(entrada).toBeDefined()
    expect(pAlice.pedidosSfu).toContain(`scope.leave:${entrada?.slice("scope.join:".length) ?? ""}`)
  })
})

/**
 * The screen share button came into being (Phase 3.3), and screen sharing by
 * SFU is not yet.
 *
 * The SFU path does not negotiate any video and `#anunciarPorSfu` returns
 * `screen: null` on purpose. Without this refusal, clicking share in an SFU
 * call would open the system selector, light up the system recording mark,
 * tell everyone `screen: true` in the announcement, and show a single pixel
 * to no one, because there is no peer where the track could go. The worst way
 * for a feature not to exist is to exist halfway and no one knows which.
 *
 * What is proved here is the effect, not the flag: the system dialog is NOT
 * opened.
 */
describe("com SFU, o ecrã passa pelo servidor — e recusa quando não há caminho", () => {
  it("abre o selector, produz o ecrã pelo SFU, e anuncia-o no roster", async () => {
    /*
     * What this phase changed, measured end to end. Until now it refused
     * BEFORE the selector, because the SFU path did not negotiate video: the
     * button opened the system sheet, lit the recording mark and did not deliver
     * a pixel. Now it does, a new producer in the transport that already
     * exists.
     */
    let selectorAberto = 0
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => fakeStream(),
        getDisplayMedia: async () => {
          selectorAberto += 1
          return fluxoDeEcra()
        },
      },
    })

    const pAlice = ponte(ALICE, async () => {}, () => true)
    const alice = new Call(pAlice)
    const queixas: string[] = []
    alice.on("error", (evento) => queixas.push(evento.detail))

    await alice.join(CANAL)
    expect(await alice.startScreenShare()).toBe(true)

    expect(selectorAberto).toBe(1)
    expect(alice.sharingScreen).toBe(true)
    // The producer leaves with the SOURCE stated: without it, on the other side
    // the screen is indistinguishable from a camera and ends up in the 190 by 128
    // card.
    expect(pAlice.pedidosSfu).toContain("produce:ecra")
    // And the encrypted roster carries the mark, which is what lights the signal
    // next to the name. The flow and the roster are two halves and both are needed.
    expect(pAlice.sent.some((p) => p.t === "voice.join" && p.screen === true)).toBe(true)
    // The only complaint is audio: this fake screen doesn't carry a sound track,
    // which is a browser with the selector box unchecked (error 445, 2/11/2026).
    expect(queixas).toEqual(["the browser did not give the screen sound"])

    await alice.leave()
  })

  it("parar de partilhar fecha o produtor no servidor, e deixa a chamada de pé", async () => {
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: async () => fakeStream(), getDisplayMedia: async () => fluxoDeEcra() },
    })

    const pAlice = ponte(ALICE, async () => {}, () => true)
    const alice = new Call(pAlice)
    await alice.join(CANAL)
    await alice.startScreenShare()

    await alice.stopScreenShare()

    // The frame is what tells the server to notify everyone watching that it ended.
    // Without it, the last frame freezes on everyone's screen.
    expect(pAlice.pedidosSfu).toContain("produce.close:p-ecra")
    expect(alice.sharingScreen).toBe(false)
    // And the call continues: `scope.leave` only exits when you actually leave.
    expect(pAlice.pedidosSfu.filter((cada) => cada.startsWith("scope.leave"))).toHaveLength(0)

    await alice.leave()
  })

  it("contra um servidor que só encaminha voz, recusa ANTES de abrir o selector", async () => {
    /*
     * The rejection didn't disappear: it changed reasons. It's no longer "the SFU
     * path doesn't carry video", it's "THIS server doesn't", and the router answers
     * based on the capabilities that `scope.joined` brought. A Phase 2 homeserver
     * negotiates Opus and nothing else.
     */
    let selectorAberto = 0
    DispositivoFalso.video = false
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => fakeStream(),
        getDisplayMedia: async () => {
          selectorAberto += 1
          return fluxoDeEcra()
        },
      },
    })

    const pAlice = ponte(ALICE, async () => {}, () => true)
    const alice = new Call(pAlice)
    const queixas: string[] = []
    alice.on("error", (evento) => queixas.push(evento.detail))

    await alice.join(CANAL)
    const anunciosAntes = pAlice.sent.filter((p) => p.t === "voice.join").length

    expect(await alice.startScreenShare()).toBe(false)

    // No selector, no capture, no announcement saying there's a screen.
    expect(selectorAberto).toBe(0)
    expect(alice.sharingScreen).toBe(false)
    expect(pAlice.sent.filter((p) => p.t === "voice.join")).toHaveLength(anunciosAntes)
    expect(pAlice.sent.some((p) => p.t === "voice.join" && "screen" in p)).toBe(false)
    // And it doesn't stay silent: a silent rejection is indistinguishable from a broken button.
    expect(queixas).toHaveLength(1)

    await alice.leave()
  })

  it("e a interface sabe disso ANTES de alguém carregar no botão", async () => {
    // Same reason `LIMITE_DE_PARTILHA` is static: a button that offers itself and
    // then refuses is worse than a button that doesn't offer at all.
    DispositivoFalso.video = false
    const pAlice = ponte(ALICE, async () => {}, () => true)
    const alice = new Call(pAlice)

    await alice.join(CANAL)
    expect(alice.podePartilharEcra).toBe(false)
    await alice.leave()

    // The same client, against a server that already routes video.
    DispositivoFalso.video = true
    await alice.join(CANAL)
    expect(alice.podePartilharEcra).toBe(true)
    await alice.leave()
  })

  it("a OITO ainda partilha, que na malha já era recusa", async () => {
    /*
     * The case that separates the two caps, and without it the mutation goes
     * unnoticed: at eight people, the mesh refused (it's six) and the SFU allows
     * (it's `PESSOAS_COM_ECRA`). A test that only measured the refusal up there
     * would pass with the mesh number read here, 12 is greater than 6 and 11, and
     * both readings refuse. The mutation suite caught it.
     */
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: async () => fakeStream(), getDisplayMedia: async () => fluxoDeEcra() },
    })

    const pAlice = ponte(ALICE, async () => {}, () => true)
    const alice = new Call(pAlice)
    await alice.join(CANAL)
    for (let numero = 0; numero < 7; numero++) {
      await alice.handleSignal(CANAL, `@gente${numero}:s` as UserAddress, {
        t: "voice.join",
        at: Date.now(),
        video: false,
        sframe: true,
        alone: false,
      })
    }

    expect(await alice.startScreenShare()).toBe(true)
    expect(pAlice.pedidosSfu).toContain("produce:ecra")

    await alice.leave()
  })

  it("a VINTE ainda partilha, e à 21.ª recusa antes de abrir o selector", async () => {
    /*
     * The number written, not read from `PESSOAS_COM_ECRA`: it was 11 until
     * 3/11/2026 and became 20 with the load test (`docs/planos/limites-media-relatorio.md`).
     * A test that reads the constant passes with whatever number is there.
     */
    let selectorAberto = 0
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => fakeStream(),
        getDisplayMedia: async () => {
          selectorAberto += 1
          return fluxoDeEcra()
        },
      },
    })
    const entra = (chamada: Call, numero: number) =>
      chamada.handleSignal(CANAL, `@gente${numero}:s` as UserAddress, {
        t: "voice.join",
        at: Date.now(),
        video: false,
        sframe: true,
        alone: false,
      })

    // Twenty with Alice: sharing.
    const pAlice = ponte(ALICE, async () => {}, () => true)
    const alice = new Call(pAlice)
    await alice.join(CANAL)
    for (let numero = 0; numero < 19; numero++) await entra(alice, numero)
    expect(await alice.startScreenShare()).toBe(true)
    expect(selectorAberto).toBe(1)
    await alice.leave()

    // Twenty-one with Alice: refusal, and the selector closes.
    const pOutra = ponte(ALICE, async () => {}, () => true)
    const outra = new Call(pOutra)
    const queixas: { detail: string; cause?: unknown }[] = []
    outra.on("error", (evento) => queixas.push(evento))
    await outra.join(CANAL)
    for (let numero = 0; numero < 20; numero++) await entra(outra, numero)
    expect(await outra.startScreenShare()).toBe(false)
    expect(selectorAberto).toBe(1)
    expect(queixas[0]?.cause).toMatchObject({ pessoas: 21, tecto: 20, caminho: "servidor" })
    await outra.leave()
  })

  it("recusa numa chamada grande de mais, com a razão física do SFU e não a da malha", async () => {
    /*
     * The cap changed both number and physics. In the mesh it was six, because
     * whoever shared sent one copy per person; here it's `PESSOAS_COM_ECRA`, because
     * whoever shares sends one copy and the server delivers it to everyone. The old
     * statement, "the screen goes directly to each person, with no server in
     * between", became false on this call, and a false statement sends you looking
     * for the bug in the wrong place.
     */
    let selectorAberto = 0
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => fakeStream(),
        getDisplayMedia: async () => {
          selectorAberto += 1
          return fluxoDeEcra()
        },
      },
    })

    const pAlice = ponte(ALICE, async () => {}, () => true)
    const alice = new Call(pAlice)
    const queixas: { detail: string; cause?: unknown }[] = []
    alice.on("error", (evento) => queixas.push(evento))

    await alice.join(CANAL)
    // The roster fills up: these are the `voice.join` events from everyone already
    // there, which is where the count of people on an SFU call comes from.
    for (let numero = 0; numero < PESSOAS_COM_ECRA; numero++) {
      await alice.handleSignal(CANAL, `@gente${numero}:s` as UserAddress, {
        t: "voice.join",
        at: Date.now(),
        video: false,
        sframe: true,
        alone: false,
      })
    }

    expect(await alice.startScreenShare()).toBe(false)
    expect(selectorAberto).toBe(0)
    // The reason is from the server ("one outbound per person"), not the mesh: it's
    // the `path` that the statement reads.
    expect(queixas[0]?.detail).toBe("the call is too large to share a screen")
    expect(queixas[0]?.cause).toMatchObject({ tecto: PESSOAS_COM_ECRA, caminho: "servidor" })

    await alice.leave()
  })
})

/**
 * The same question, answered as a PROMISE, which is how the installed app
 * answers it.
 *
 * In the browser the session lives in the same process and `suportaSfu` is an
 * immediate read. In the installed app it lives in the main process, across
 * the IPC boundary, and there's no synchronous read that reaches it: the
 * desktop bridge answers with a promise.
 *
 * **And a promise is an object, and an object is always true.** A gate written
 * without `await` passes through this entire file, all tests above use the
 * synchronous form, and sends the installed app to SFU against EVERY server,
 * including ones with no media engine at all. The symptom is the worst possible:
 * a call that negotiates with a port that doesn't exist, on the only client that
 * doesn't recover with an F5.
 */
describe("a capacidade respondida por promessa, como no Electron", () => {
  it("promessa de NÃO é malha, e não um objecto verdadeiro", async () => {
    let bruno: Call
    const pAlice = ponte(ALICE, (p) => bruno.handleSignal(CANAL, ALICE, p), () => Promise.resolve(false))
    const alice = new Call(pAlice)
    const pBruno = ponte(BRUNO, (p) => alice.handleSignal(CANAL, BRUNO, p), () => Promise.resolve(false))
    bruno = new Call(pBruno)

    await alice.join(CANAL)
    await bruno.join(CANAL)

    // The same double check as the first test in this file: the mesh ran, and the
    // SFU was never touched.
    expect(FakePeerConnection.instances.length).toBeGreaterThan(0)
    expect(pAlice.sent.some((p) => p.t === "voice.offer") || pBruno.sent.some((p) => p.t === "voice.offer")).toBe(true)
    expect(pAlice.pedidosSfu).toEqual([])
    expect(pBruno.pedidosSfu).toEqual([])

    await alice.leave()
    await bruno.leave()
  })

  it("promessa de SIM entra por SFU, na mesma", async () => {
    const pAlice = ponte(ALICE, async () => {}, () => Promise.resolve(true))
    const alice = new Call(pAlice)

    await alice.join(CANAL)

    expect(pAlice.pedidosSfu).toContain("transport.create:envio")
    // And the SFU engine really is up, not just the requests: the voice came from
    // it, with the source that only the new path writes.
    expect(pAlice.pedidosSfu).toContain("produce:microfone")

    await alice.leave()
  })

  it("e um servidor que anda para trás fecha o portão na mesma, com a resposta lenta", async () => {
    // The rollback, through the installed app path. The delay is intentional: a
    // response that arrives on the same tick hides a forgotten `await`, because a
    // resolved promise is still an object but the test passes by luck of ordering
    // elsewhere. It doesn't pass here any other way.
    let temSfu = true
    const pAlice = ponte(ALICE, async () => {}, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      return temSfu
    })
    const alice = new Call(pAlice)

    await alice.join(CANAL)
    expect(pAlice.pedidosSfu.length).toBeGreaterThan(0)
    await alice.leave()

    temSfu = false
    const antes = pAlice.pedidosSfu.length
    await alice.join(CANAL)

    // No more media request. And the second half, without which this proves nothing:
    // the MESH came back to work. "No request" is also what you see in a connection
    // that broke mid-way, and an announcement from someone is what tells the two
    // cases apart, with an engine you don't build peer connections, without it
    // you do.
    expect(pAlice.pedidosSfu).toHaveLength(antes)
    await alice.handleSignal(CANAL, BRUNO, { t: "voice.join", at: Date.now(), video: false, sframe: true, alone: false })
    expect(FakePeerConnection.instances.length).toBeGreaterThan(0)

    await alice.leave()
  })
})

describe("um servidor que anda para trás", () => {
  it("a chamada seguinte volta à malha, sem ninguém fechar nada à mão", async () => {
    let temSfu = true
    const pAlice = ponte(ALICE, async () => {}, () => temSfu)
    const alice = new Call(pAlice)

    await alice.join(CANAL)
    expect(pAlice.pedidosSfu.length).toBeGreaterThan(0)
    await alice.leave()

    // The old container comes back up; the media worker died. The client is the
    // same object, and the only thing that changed is on the other end of the wire.
    temSfu = false
    FakePeerConnection.instances = []
    const antes = pAlice.pedidosSfu.length

    await alice.join(CANAL)

    // No more media request, and the mesh back to work.
    expect(pAlice.pedidosSfu).toHaveLength(antes)
    expect(pAlice.sent.filter((p) => p.t === "voice.join")).toHaveLength(2)

    await alice.leave()
  })
})
