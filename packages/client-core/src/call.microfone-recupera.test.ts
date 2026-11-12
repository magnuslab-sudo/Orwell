/**
 * The microphone that dies silently comes back on its own, without leaving the
 * call (4/11/2026).
 *
 * The owner's report: "I stopped hearing a user. Looks like Orwell stopped
 * capturing my mic. I left and came back and it fixed it." Measured on real
 * Chromium (`scripts/mic-recupera-evidencia/`): when capture dies (raw track
 * ended, `AudioContext` suspended, worklet crashed), the track that the sender
 * has stays `live`, and the call sends silence with no error.
 *
 * Here, in the entire SFU `Call`: the monitor spots the death, the `Call` asks
 * for the microphone again WITH THE SAME DEVICE, and the new track enters the
 * same sender (`replaceTrack`), already encrypted. Nothing leaves the call, and
 * the log says what happened with a reason code.
 */
import type { Payload, UserAddress } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { VigiaDoMicrofone } from "./audio/vigia-do-microfone.js"
import { Call, type CallBridge, type MediaKeyMaterial } from "./call.js"
import { MotorSfu, type ConsumidorDeMedia, type DispositivoDeMedia, type ProdutorDeMedia, type TransporteDeMedia } from "./call-sfu.js"

interface FaixaFalsa extends MediaStreamTrack {
  readyState: MediaStreamTrackState
  muted: boolean
}

let faixasCriadas = 0
function faixa(kind: "audio" | "video" = "audio"): FaixaFalsa {
  const id = `${kind}-${++faixasCriadas}`
  const f = {
    kind,
    id,
    enabled: true,
    readyState: "live" as MediaStreamTrackState,
    muted: false,
    stop: vi.fn(() => {
      f.readyState = "ended"
    }),
    onended: null,
    applyConstraints: async () => {},
  }
  return f as unknown as FaixaFalsa
}

class FluxoFalso {
  readonly #faixas: MediaStreamTrack[]
  constructor(faixas: MediaStreamTrack[] = []) {
    this.#faixas = [...faixas]
  }
  getTracks(): MediaStreamTrack[] {
    return [...this.#faixas]
  }
  getAudioTracks(): MediaStreamTrack[] {
    return this.#faixas.filter((f) => f.kind === "audio")
  }
  getVideoTracks(): MediaStreamTrack[] {
    return this.#faixas.filter((f) => f.kind === "video")
  }
  addTrack(f: MediaStreamTrack): void {
    if (!this.#faixas.includes(f)) this.#faixas.push(f)
  }
  removeTrack(f: MediaStreamTrack): void {
    const i = this.#faixas.indexOf(f)
    if (i >= 0) this.#faixas.splice(i, 1)
  }
}

const ALICE = "@alice:enclave.test" as UserAddress
const CHANNEL = "!geral:enclave.test"

/** A Chromium sender, with the cipher attached and the swapped track counted. */
/** The DTLS state of the send that new senders carry. See "the send that doesn't connect". */
let estadoDoEnvio: string | null = null

class Emissor {
  transport =
    estadoDoEnvio === null
      ? undefined
      : { state: estadoDoEnvio, iceTransport: { state: "checking", addEventListener: () => {} }, addEventListener: () => {} }
  cifrado = false
  faixa: MediaStreamTrack | null = null
  trocas: (MediaStreamTrack | null)[] = []
  createEncodedStreams(): unknown {
    this.cifrado = true
    return { readable: new ReadableStream(), writable: new WritableStream() }
  }
  async replaceTrack(nova: MediaStreamTrack | null): Promise<void> {
    this.trocas.push(nova)
    this.faixa = nova
  }
}

class DispositivoFalso implements DispositivoDeMedia {
  readonly rtpCapabilities = {}
  readonly produtores: { fonte: string; emissor: Emissor; faixa: MediaStreamTrack }[] = []
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
    return {
      id,
      on: (evento: "connect" | "produce", ouvinte: never) => {
        if (evento === "connect") aoLigar = ouvinte
        else aoProduzir = ouvinte
      },
      produce: async (opcoes): Promise<ProdutorDeMedia> => {
        const emissor = new Emissor()
        emissor.faixa = opcoes.track
        opcoes.onRtpSender?.(emissor as unknown as RTCRtpSender)
        const ligar = aoLigar
        aoLigar = null
        if (ligar) await new Promise<void>((resolve, reject) => ligar({ dtlsParameters: {} }, resolve, reject))
        const feito = await new Promise<{ id: string }>((resolve, reject) =>
          aoProduzir?.({ kind: opcoes.track.kind as "audio" | "video", rtpParameters: {}, appData: opcoes.appData ?? {} }, resolve, reject),
        )
        this.produtores.push({ fonte: String(opcoes.appData?.["fonte"]), emissor, faixa: opcoes.track })
        return {
          id: feito.id,
          rtpSender: emissor as unknown as RTCRtpSender,
          // The `Producer.replaceTrack` of `mediasoup-client`: the same sender.
          replaceTrack: ({ track }) => emissor.replaceTrack(track),
          close: () => {},
        }
      },
      consume: async (opcoes): Promise<ConsumidorDeMedia> => ({
        id: opcoes.id,
        producerId: opcoes.producerId,
        track: faixa(opcoes.kind as "audio"),
        rtpReceiver: new Emissor() as unknown as RTCRtpReceiver,
        close: () => {},
      }),
      close: () => {},
    }
  }
  createSendTransport(o: { id: string }): TransporteDeMedia {
    return this.#transporte(o.id)
  }
  createRecvTransport(o: { id: string }): TransporteDeMedia {
    return this.#transporte(o.id)
  }
}

function ponte(dispositivo: DispositivoFalso): CallBridge {
  let proximo = 0
  return {
    selfAddress: ALICE,
    async sendSignal() {},
    async mediaKey(): Promise<MediaKeyMaterial | null> {
      return { keyId: 1, senderId: 0, material: new Uint8Array(28) }
    },
    async reservarContadorSframe(): Promise<number> {
      return 0
    },
    sfu: {
      suportaSfu: () => true,
      criarDispositivo: () => dispositivo,
      async sfuEntrarNoAmbito() {
        return { rtpCapabilities: {}, producers: [] }
      },
      sfuSairDoAmbito() {},
      async sfuCriarTransporte(_canal, _ambito, sentido) {
        return { id: `t-${sentido}`, iceParameters: {}, iceCandidates: [], dtlsParameters: {} }
      },
      async sfuLigarTransporte() {},
      async sfuProduzir() {
        return `p${proximo++}`
      },
      async sfuFecharProdutor() {},
      async sfuConsumir(_transporte, produtor) {
        return { id: `c-${produtor}`, producerId: produtor, kind: "audio", rtpParameters: {} }
      },
      async sfuRetomar() {},
      async sfuPausar() {},
    },
  }
}

let pedidos: MediaStreamConstraints[] = []
let capturas: FaixaFalsa[] = []
let recusarCaptura = 0

beforeEach(() => {
  vi.useFakeTimers()
  pedidos = []
  capturas = []
  estadoDoEnvio = null
  recusarCaptura = 0
  ;(globalThis as unknown as { MediaStream: unknown }).MediaStream = FluxoFalso
  vi.stubGlobal("RTCRtpSender", Emissor)
  vi.stubGlobal("RTCRtpReceiver", Emissor)
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: async (pedido: MediaStreamConstraints) => {
        pedidos.push(pedido)
        if (recusarCaptura > 0) {
          recusarCaptura--
          throw Object.assign(new Error("Could not start audio source"), { name: "NotReadableError" })
        }
        const crua = faixa()
        capturas.push(crua)
        return new FluxoFalso([crua])
      },
    },
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function naChamada(opcoes: { aparelho?: string } = {}) {
  const dispositivo = new DispositivoFalso()
  const call = new Call(ponte(dispositivo))
  // Without the voice chain (Node has no AudioWorklet): the raw track is what goes out.
  if (opcoes.aparelho) call.audioSettings = { inputDeviceId: opcoes.aparelho }
  const diagnosticos: string[] = []
  const erros: string[] = []
  const locais: (MediaStream | null)[] = []
  call.on("diagnostic", (evento) => diagnosticos.push(evento.detail ? `${evento.code}:${evento.detail}` : evento.code))
  call.on("error", (evento) => erros.push(evento.detail))
  call.on("local", (evento) => locais.push(evento.stream))
  await call.join(CHANNEL)
  const voz = dispositivo.produtores.find((produtor) => produtor.fonte === "microfone")!
  return { call, dispositivo, voz, diagnosticos, erros, locais }
}

describe("o microfone que morre calado", () => {
  it("a faixa crua a terminar: volta a pedir o MESMO aparelho e troca a faixa no mesmo emissor, sem sair", async () => {
    const { call, voz, diagnosticos, erros, locais } = await naChamada({ aparelho: "auscultadores" })
    const primeira = capturas[0]!
    expect(voz.faixa).toBe(primeira)

    // The device vanished (in the browser this is the track's `ended`).
    primeira.readyState = "ended"
    await vi.advanceTimersByTimeAsync(VigiaDoMicrofone.PERIODO_MS + 10)

    expect(pedidos).toHaveLength(2)
    expect((pedidos[1]!.audio as MediaTrackConstraints).deviceId).toEqual({ exact: "auscultadores" })
    const nova = capturas[1]!
    expect(voz.emissor.trocas).toEqual([nova])
    // The cipher is the same: attached once, on the sender.
    expect(voz.emissor.cifrado).toBe(true)
    expect(call.channel).toBe(CHANNEL)
    expect(locais.at(-1)?.getAudioTracks()).toEqual([nova])
    expect(diagnosticos).toContain("call-microfone-terminou")
    expect(diagnosticos.some((linha) => linha.startsWith("call-microfone-recuperado:terminou"))).toBe(true)
    expect(erros).toEqual([])
  })

  it("muted durante 3 s também se recupera; um silêncio da pessoa (mute na app) não", async () => {
    const { call, voz, diagnosticos } = await naChamada()
    call.setMuted(true)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(pedidos).toHaveLength(1)

    call.setMuted(false)
    capturas[0]!.muted = true
    await vi.advanceTimersByTimeAsync(VigiaDoMicrofone.CALADO_MS + 2 * VigiaDoMicrofone.PERIODO_MS)

    expect(pedidos).toHaveLength(2)
    expect(voz.emissor.trocas).toEqual([capturas[1]])
    expect(diagnosticos.some((linha) => linha.startsWith("call-microfone-calado"))).toBe(true)
  })

  it("a faixa nova herda o silêncio de quem se tinha calado", async () => {
    const { call } = await naChamada()
    call.setMuted(true)
    capturas[0]!.readyState = "ended"
    await vi.advanceTimersByTimeAsync(VigiaDoMicrofone.PERIODO_MS + 10)

    expect(capturas[1]!.enabled).toBe(false)
  })

  it("se o aparelho não abrir, tenta outra vez com espera, e só no fim diz o 412", async () => {
    const { call, voz, diagnosticos, erros } = await naChamada()
    recusarCaptura = 2
    capturas[0]!.readyState = "ended"
    await vi.advanceTimersByTimeAsync(VigiaDoMicrofone.PERIODO_MS + 10)
    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 10)

    expect(pedidos).toHaveLength(4)
    expect(voz.emissor.trocas).toEqual([capturas[1]])
    expect(diagnosticos.filter((linha) => linha.startsWith("call-microfone-nao-reabriu"))).toHaveLength(2)
    expect(erros).toEqual([])
    expect(call.channel).toBe(CHANNEL)

    // And when it never opens: the attempts end, the person reads why, and the call stays.
    recusarCaptura = 99
    capturas[1]!.readyState = "ended"
    await vi.advanceTimersByTimeAsync(60_000)
    expect(erros).toEqual(["could not open the microphone"])
    expect(diagnosticos).toContain("call-microfone-desistiu")
    expect(call.channel).toBe(CHANNEL)
  })

  it("um microfone que morre sem parar não fica num ciclo: ao fim de quatro mortes num minuto, pára e diz o 452", async () => {
    const { erros, diagnosticos } = await naChamada()
    for (let morte = 0; morte < 6; morte++) {
      capturas.at(-1)!.readyState = "ended"
      await vi.advanceTimersByTimeAsync(VigiaDoMicrofone.PERIODO_MS + 10)
    }
    expect(pedidos).toHaveLength(5)
    expect(erros).toEqual(["the microphone keeps stopping"])
    expect(diagnosticos).toContain("call-microfone-em-ciclo:5 em 60 s")
  })

  it("sair da chamada desliga a vigia: uma faixa parada por nós não é uma morte", async () => {
    const { call } = await naChamada()
    await call.leave()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(pedidos).toHaveLength(1)
  })
})

// ------------------------------------------------------------ and on the mesh

/*
 * The mesh doubles, the ones in `call.musica.test.ts`, with the `getSenders`
 * that recovery uses to find the voice sender in each pair.
 */
class FakeSender {
  faixa: MediaStreamTrack | null = null
  parametros: { encodings: { maxBitrate?: number }[]; transactionId: string } = { encodings: [{}], transactionId: "t1" }
  get track(): MediaStreamTrack | null {
    return this.faixa
  }
  async replaceTrack(f: MediaStreamTrack | null): Promise<void> {
    this.faixa = f
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
  mid: string | null = null
  direction: string
  porAddTrack = false
  constructor(
    public kind: string,
    init?: { direction?: string },
  ) {
    this.direction = init?.direction ?? "sendrecv"
  }
}

function sdpDe(linhas: { kind: string; mid: string }[]): string {
  return ["v=0", ...linhas.flatMap((l) => [`m=${l.kind} 9 UDP/TLS/RTP/SAVPF 111`, `a=mid:${l.mid}`])].join("\r\n") + "\r\n"
}

function linhasDe(sdp: string): { kind: string; mid: string }[] {
  const saida: { kind: string; mid: string }[] = []
  for (const linha of sdp.split("\r\n")) {
    if (linha.startsWith("m=")) saida.push({ kind: linha.slice(2).split(" ")[0]!, mid: "" })
    if (linha.startsWith("a=mid:")) saida[saida.length - 1]!.mid = linha.slice(6)
  }
  return saida
}

class FakePeerConnection {
  static instances: FakePeerConnection[] = []
  localDescription: { type: string; sdp: string } | null = null
  remoteDescription: { type: string; sdp: string } | null = null
  connectionState = "new"
  ordem: string[] = []
  transceivers: FakeTransceiver[] = []
  ontrack: ((event: unknown) => void) | null = null
  onicecandidate: ((event: unknown) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  constructor(public config: unknown) {
    FakePeerConnection.instances.push(this)
  }
  addTransceiver(kind: string, init?: { direction?: string }): FakeTransceiver {
    this.ordem.push(`transceiver:${kind}`)
    const t = new FakeTransceiver(kind, init)
    this.transceivers.push(t)
    return t
  }
  addTrack(track: MediaStreamTrack): FakeSender {
    this.ordem.push(`track:${track.kind}`)
    const vazio = this.transceivers.find((t) => t.kind === track.kind && t.sender.faixa === null && t.mid === null)
    if (vazio) {
      vazio.sender.faixa = track
      return vazio.sender
    }
    const t = new FakeTransceiver(track.kind)
    t.porAddTrack = true
    t.sender.faixa = track
    this.transceivers.push(t)
    return t.sender
  }
  getTransceivers(): FakeTransceiver[] {
    return this.transceivers
  }
  getSenders(): FakeSender[] {
    return this.transceivers.map((t) => t.sender)
  }
  async createOffer(): Promise<{ type: string; sdp: string }> {
    this.transceivers.forEach((t, indice) => (t.mid ??= String(indice)))
    return { type: "offer", sdp: sdpDe(this.transceivers.map((t) => ({ kind: t.kind, mid: t.mid! }))) }
  }
  async createAnswer(): Promise<{ type: string; sdp: string }> {
    return { type: "answer", sdp: this.remoteDescription!.sdp }
  }
  async setLocalDescription(d: { type: string; sdp: string }): Promise<void> {
    this.localDescription = d
  }
  async setRemoteDescription(d: { type: string; sdp: string }): Promise<void> {
    this.remoteDescription = d
    if (d.type !== "offer") return
    for (const linha of linhasDe(d.sdp)) {
      const livre = this.transceivers.find((t) => t.porAddTrack && t.kind === linha.kind && t.mid === null)
      if (livre) livre.mid = linha.mid
      else {
        const novo = new FakeTransceiver(linha.kind, { direction: "recvonly" })
        novo.mid = linha.mid
        this.transceivers.push(novo)
      }
    }
  }
  async addIceCandidate(): Promise<void> {}
  close(): void {}
}

describe("na malha, o microfone que morre também volta", () => {
  it("a faixa nova entra no emissor da voz de cada par, sem oferta nova", async () => {
    vi.stubGlobal("RTCPeerConnection", FakePeerConnection)
    FakePeerConnection.instances = []
    const BRUNO = "@bruno:enclave.test" as UserAddress
    const base = (eu: UserAddress, entregar: (payload: Payload) => Promise<void>): CallBridge => ({
      selfAddress: eu,
      async sendSignal(_canal, payload) {
        await entregar(payload)
      },
      async mediaKey(): Promise<MediaKeyMaterial | null> {
        return { keyId: 1, senderId: 0, material: new Uint8Array(28) }
      },
      async reservarContadorSframe(): Promise<number> {
        return 0
      },
    })
    let bruno: Call
    const ofertas: string[] = []
    const alice = new Call(
      base(ALICE, async (payload) => {
        if (payload.t === "voice.offer") ofertas.push(payload.t)
        await bruno.handleSignal(CHANNEL, ALICE, payload)
      }),
    )
    bruno = new Call(base(BRUNO, (payload) => alice.handleSignal(CHANNEL, BRUNO, payload)))
    await alice.join(CHANNEL)
    await bruno.join(CHANNEL)
    const ligacao = FakePeerConnection.instances[0]!
    const daVoz = ligacao.transceivers.find((t) => t.porAddTrack && t.kind === "audio")!
    const velha = capturas[0]!
    expect(daVoz.sender.faixa).toBe(velha)
    const antes = ofertas.length

    velha.readyState = "ended"
    await vi.advanceTimersByTimeAsync(VigiaDoMicrofone.PERIODO_MS + 10)

    expect(daVoz.sender.faixa).toBe(capturas[2])
    expect(ofertas).toHaveLength(antes)
    expect(alice.channel).toBe(CHANNEL)
  })
})

describe("o envio que não liga (relato de 4/11/2026, 14:15)", () => {
  it("o transporte de envio preso em connecting: a media refaz-se sozinha, sem sair, e a voz sai noutro produtor", async () => {
    estadoDoEnvio = "connecting"
    const { call, dispositivo, diagnosticos, erros } = await naChamada()
    expect(dispositivo.produtores.filter((p) => p.fonte === "microfone")).toHaveLength(1)

    // The new transport connects: reconstruction is last.
    estadoDoEnvio = "connected"
    await vi.advanceTimersByTimeAsync(MotorSfu.PRAZO_DO_ENVIO_MS + 10)

    expect(diagnosticos.some((l) => l.startsWith("sfu-envio-sem-ligacao:dtls connecting"))).toBe(true)
    expect(diagnosticos).toContain("call-sfu-envio-parado")
    expect(diagnosticos.some((l) => l.startsWith("call-sfu-refazer"))).toBe(true)
    expect(dispositivo.produtores.filter((p) => p.fonte === "microfone")).toHaveLength(2)
    // The same capture: the microphone was not asked for again.
    expect(pedidos).toHaveLength(1)
    expect(call.channel).toBe(CHANNEL)
    expect(erros).toEqual([])

    await vi.advanceTimersByTimeAsync(60_000)
    expect(dispositivo.produtores.filter((p) => p.fonte === "microfone")).toHaveLength(2)
  })

  it("uma rede que nunca deixa ligar: três refazeres num minuto, e depois diz-se o 433", async () => {
    estadoDoEnvio = "connecting"
    const { diagnosticos, erros } = await naChamada()
    await vi.advanceTimersByTimeAsync(5 * (MotorSfu.PRAZO_DO_ENVIO_MS + 10))
    expect(diagnosticos.filter((l) => l === "call-sfu-envio-parado")).toHaveLength(3)
    expect(diagnosticos).toContain("call-sfu-envio-desistiu")
    expect(erros).toEqual(["the call media failed"])
  })
})
