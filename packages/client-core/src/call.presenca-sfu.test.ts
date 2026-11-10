import type { Payload, UserAddress } from "@enclave/protocol"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  Call,
  PRESENCA_REAFIRMADA_MS,
  PRESENCA_VALIDA_MS,
  type CallBridge,
  type MediaKeyMaterial,
} from "./call.js"
import type {
  ConsumidorDeMedia,
  DispositivoDeMedia,
  ParametrosDoTransporte,
  ProdutorDeMedia,
  TransporteDeMedia,
} from "./call-sfu.js"

/**
 * Anyone who leaves without saying goodbye must leave the screens of others.
 *
 * In an SFU call the participant list comes from the encrypted roster
 * (`#anunciarPorSfu`), and the roster was only cleaned by a `voice.leave`. But
 * `voice.leave` is the goodbye of someone who PRESSES disconnect: close the tab,
 * reload the page, kill the app or lose the network do not announce anything,  * there is no `beforeunload` anywhere in this repository, and with SFU there is also
 * no ICE drop per person that serves as a warning, because the connection is one and is
 * to the server. The gateway, when the socket falls, closes the PRODUCERS
 * (`sfu.producer.closed`): kills the stream, not the person. And a person in the roster
 * without a stream draws exactly like someone who has not yet spoken, `connected:
 * false`, the eternal card saying "connecting".
 *
 * The two halves stuck here are the two responses, and they are deliberately
 * different from each other:
 *
 *   immediate, the presence announcement from the server (`presence`, `online: false`),
 *               which already existed and reached the bridges without ever touching the roster;
 *   slow     , expiry by heartbeat, in case neither the goodbye nor
 *               the announcement arrived (a server that lost connection to another, a
 *               federation in the middle of a partition).
 *
 * The window is the SAME one that the sidebar uses for outside presences
 * (`PRESENCA_VALIDA_MS`), and is derived from the heartbeat rhythm instead of written
 * by hand: the fault from 18 August 2026 was precisely two halves
 * asserting things about each other with no link between them.
 */

// -------------------------------------------------------------------- stubs

class FakePeerConnection {
  static instances: FakePeerConnection[] = []
  localDescription: { type: string; sdp: string } | null = null
  connectionState = "new"
  ontrack: ((event: unknown) => void) | null = null
  onicecandidate: ((event: unknown) => void) | null = null
  onconnectionstatechange: (() => void) | null = null

  constructor() {
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
  async setRemoteDescription(): Promise<void> {}
  async addIceCandidate(): Promise<void> {}
  close(): void {}
}

function fakeStream(): MediaStream {
  const audio = { kind: "audio", enabled: true, stop: vi.fn() }
  return {
    getTracks: () => [audio],
    getAudioTracks: () => [audio],
    getVideoTracks: () => [],
  } as unknown as MediaStream
}

const ALICE = "@alice:s" as UserAddress
const BRUNO = "@bruno:s" as UserAddress
const CARLA = "@carla:s" as UserAddress
const CANAL = "!geral:s"

/** The `mediasoup-client` pretending. Only what is needed to set up the call. */
class DispositivoFalso implements DispositivoDeMedia {
  readonly rtpCapabilities = { codecs: [] }
  async load(): Promise<void> {}
  canProduce(): boolean {
    return true
  }
  #transporte(id: string): TransporteDeMedia {
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
        const emissor = {
          createEncodedStreams: () => ({ readable: new ReadableStream(), writable: new WritableStream() }),
        } as unknown as RTCRtpSender
        opcoes.onRtpSender?.(emissor)
        await fecharDtls()
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
          rtpReceiver: {
            createEncodedStreams: () => ({ readable: new ReadableStream(), writable: new WritableStream() }),
          } as unknown as RTCRtpReceiver,
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

/** A bridge with SFU, which is the only path where the roster exists. */
function ponte(selfAddress: UserAddress): Ponte {
  const sent: Payload[] = []
  const pedidosSfu: string[] = []
  return {
    selfAddress,
    sent,
    pedidosSfu,
    async sendSignal(_canal, payload) {
      sent.push(payload)
    },
    async mediaKey(): Promise<MediaKeyMaterial | null> {
      return { keyId: 41, senderId: 0, material: new Uint8Array(32).fill(7) }
    },
    async reservarContadorSframe(): Promise<number> {
      return 0
    },
    sfu: {
      suportaSfu: () => true,
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
      // The symmetric case. Missing, any path that reached `largarEcraDe` would blow
      // up with "sfuPausar is not a function", caught by the method's own
      // `try/catch` and reduced to a diagnosis: green on the call that never
      // happened. These tests are not typechecked by anyone.
      async sfuPausar(_t, consumidor) {
        pedidosSfu.push(`pause:${consumidor}`)
      },
    },
  }
}

/** A join announcement, like the one that travels encrypted inside MLS. */
function anuncioDe(): Payload {
  return { t: "voice.join", at: Date.now(), video: false, sframe: true, alone: false } as Payload
}

beforeEach(() => {
  FakePeerConnection.instances = []
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection)
  class MotorQueCifra {
    createEncodedStreams(): unknown {
      return { readable: new ReadableStream(), writable: new WritableStream() }
    }
  }
  vi.stubGlobal("RTCRtpSender", MotorQueCifra)
  vi.stubGlobal("RTCRtpReceiver", MotorQueCifra)
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
      addTrack(): void {}
      removeTrack(): void {}
    },
  )
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: async () => fakeStream() },
  })
})

describe("o aviso de presença do servidor tira quem se desligou do roster", () => {
  it("um `online: false` apaga a pessoa e a lista sai sem ela", async () => {
    const pAlice = ponte(ALICE)
    const alice = new Call(pAlice)
    const listas: string[][] = []
    alice.on("participants", (evento) => listas.push(evento.participants.map((cada) => cada.address)))

    await alice.join(CANAL)
    await alice.handleSignal(CANAL, BRUNO, anuncioDe())
    await alice.handleSignal(CANAL, CARLA, anuncioDe())
    expect(listas.at(-1)).toEqual([BRUNO, CARLA])

    // What the gateway says when Bruno's socket drops: the person disconnected.
    // Nothing more comes, his `voice.leave` never went out, and never will.
    alice.desligouSeDoServidor(BRUNO)

    expect(listas.at(-1)).toEqual([CARLA])

    await alice.leave()
  })

  it("apagar quem não está no roster é inócuo, e não redesenha nada", async () => {
    // Almost everyone who disconnects from the server was not in any call. An
    // announcement for each of those would be React redrawing the entire call on
    // account of someone it does not care about.
    const pAlice = ponte(ALICE)
    const alice = new Call(pAlice)
    const listas: string[][] = []
    alice.on("participants", (evento) => listas.push(evento.participants.map((cada) => cada.address)))

    await alice.join(CANAL)
    await alice.handleSignal(CANAL, BRUNO, anuncioDe())
    const anunciosAte = listas.length

    alice.desligouSeDoServidor(CARLA)

    expect(listas.length).toBe(anunciosAte)
    expect(listas.at(-1)).toEqual([BRUNO])

    await alice.leave()
  })

  it("e fora de uma chamada não rebenta", () => {
    // The presence warning always arrives, whether in a call or not.
    const alice = new Call(ponte(ALICE))
    expect(() => alice.desligouSeDoServidor(BRUNO)).not.toThrow()
  })
})

describe("a caducidade pelo batimento, para quando nem o aviso chegou", () => {
  it("quem deixa de se reafirmar desaparece passada a janela", async () => {
    vi.useFakeTimers()
    try {
      const pAlice = ponte(ALICE)
      const alice = new Call(pAlice)
      const listas: string[][] = []
      alice.on("participants", (evento) => listas.push(evento.participants.map((cada) => cada.address)))

      await alice.join(CANAL)
      await alice.handleSignal(CANAL, BRUNO, anuncioDe())
      expect(listas.at(-1)).toEqual([BRUNO])

      // One full heartbeat after the window has closed: the sweep is periodic, and
      // the guarantee is "leave", not "leave to the millisecond".
      await vi.advanceTimersByTimeAsync(PRESENCA_VALIDA_MS + PRESENCA_REAFIRMADA_MS + 1)

      expect(listas.at(-1)).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it("quem se reafirma dentro da janela FICA", async () => {
    vi.useFakeTimers()
    try {
      const pAlice = ponte(ALICE)
      const alice = new Call(pAlice)
      const listas: string[][] = []
      alice.on("participants", (evento) => listas.push(evento.participants.map((cada) => cada.address)))

      await alice.join(CANAL)
      await alice.handleSignal(CANAL, BRUNO, anuncioDe())

      // Two heartbeat cycles, and Bruno's reaffirmation in between, which is what a
      // speaking person actually produces, every `PRESENCA_REAFIRMADA_MS`.
      await vi.advanceTimersByTimeAsync(PRESENCA_REAFIRMADA_MS * 2)
      expect(listas.at(-1)).toEqual([BRUNO])
      await alice.handleSignal(CANAL, BRUNO, anuncioDe())
      await vi.advanceTimersByTimeAsync(PRESENCA_REAFIRMADA_MS * 2)

      // Without the reaffirmation, here it would already be 200 s and he would have
      // left. Expelling someone who is actually in the call is the worse failure: a
      // speaking person disappearing from everyone else's screen.
      expect(listas.at(-1)).toEqual([BRUNO])
    } finally {
      vi.useRealTimers()
    }
  })

  it("o varrimento não sobrevive ao `leave()`", async () => {
    vi.useFakeTimers()
    try {
      const pAlice = ponte(ALICE)
      const alice = new Call(pAlice)
      const listas: string[][] = []
      alice.on("participants", (evento) => listas.push(evento.participants.map((cada) => cada.address)))

      await alice.join(CANAL)
      await alice.handleSignal(CANAL, BRUNO, anuncioDe())

      await alice.leave()

      // No clock in this call keeps ticking after it ends. A surviving sweep would be
      // an `announce` from a call that no longer exists, the same family as the
      // phantom connection that erased its successor.
      expect(vi.getTimerCount()).toBe(0)

      const anunciosAte = listas.length
      await vi.advanceTimersByTimeAsync(PRESENCA_VALIDA_MS * 3)
      expect(listas.length).toBe(anunciosAte)
    } finally {
      vi.useRealTimers()
    }
  })
})
