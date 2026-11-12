import type { Payload, UserAddress } from "@enclave/protocol"
import { ambitoDaChamada, TECTO_DA_MUSICA } from "@enclave/protocol"
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest"
import { Call, midDaMusica, ultimoMidDeAudio, type CallBridge, type MediaKeyMaterial, type Participant } from "./call.js"
import { MotorSfu, type ConsumidorDeMedia, type DispositivoDeMedia, type ProdutorDeMedia, type TransporteDeMedia } from "./call-sfu.js"

/**
 * MUSIC in the call: the producer is born and dies, independent of the
 * microphone.
 *
 * Phase 9 of `docs/planos/definicoes-0-9.md`. Two halves, like screen audio:
 * on SFU it's its own producer, source `musica`, stereo Opus; on the mesh it's
 * an extra audio m-line, reserved in the first offer between two clients who
 * said `musica`. The mesh doubles mimic Chromium in the two rules that decide
 * slot order (see `call.ecra-som.test.ts`).
 */

// ------------------------------------------------------------ duplos comuns

const dormir = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function faixa(kind: "audio" | "video", id = `${kind}-${Math.random()}`): MediaStreamTrack {
  return { kind, id, enabled: true, readyState: "live", stop: vi.fn(), onended: null } as unknown as MediaStreamTrack
}

class FluxoFalso {
  readonly id: string
  readonly #faixas: MediaStreamTrack[]
  constructor(faixas: MediaStreamTrack[] = [], id = `fluxo-${Math.random()}`) {
    this.#faixas = [...faixas]
    this.id = id
  }
  getTracks(): MediaStreamTrack[] {
    return [...this.#faixas]
  }
  getVideoTracks(): MediaStreamTrack[] {
    return this.#faixas.filter((f) => f.kind === "video")
  }
  getAudioTracks(): MediaStreamTrack[] {
    return this.#faixas.filter((f) => f.kind === "audio")
  }
  getTrackById(id: string): MediaStreamTrack | null {
    return this.#faixas.find((f) => f.id === id) ?? null
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
const BRUNO = "@bruno:enclave.test" as UserAddress
const CHANNEL = "!geral:enclave.test"

function ponteBase(selfAddress: UserAddress, entregar?: (payload: Payload) => Promise<void>): CallBridge & { sent: Payload[] } {
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

// ------------------------------------------------------------ mesh doubles

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

/** A client without music: its frames carry neither `musica` nor `aTocar`. */
function semMusica(payload: Payload): Payload {
  const copia = { ...payload } as Record<string, unknown>
  delete copia["musica"]
  delete copia["aTocar"]
  return copia as unknown as Payload
}

beforeEach(() => {
  FakePeerConnection.instances = []
  ;(globalThis as unknown as { MediaStream: unknown }).MediaStream = FluxoFalso
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection)
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: async () => new FluxoFalso([faixa("audio", "mic")], "captura") },
  })
})

async function doisNaMalha(opcoes: { brunoSemMusica?: boolean } = {}) {
  let bruno: Call
  const daAlice = ponteBase(ALICE, (payload) => bruno.handleSignal(CHANNEL, ALICE, payload))
  const alice = new Call(daAlice)
  const doBruno = ponteBase(BRUNO, (payload) =>
    alice.handleSignal(CHANNEL, BRUNO, opcoes.brunoSemMusica ? semMusica(payload) : payload),
  )
  bruno = new Call(doBruno)
  await alice.join(CHANNEL)
  await bruno.join(CHANNEL)
  return { alice, bruno, daAlice, doBruno }
}

// ------------------------------------------------------------ malha

describe("a música na malha", () => {
  it("quem oferece reserva o lugar da música entre o microfone e o som do ecrã, e di-lo na oferta", async () => {
    const { daAlice } = await doisNaMalha()
    const ligacao = FakePeerConnection.instances[0]!
    expect(ligacao.ordem).toEqual(["transceiver:video", "track:audio", "transceiver:audio", "transceiver:audio"])
    const oferta = ligacao.localDescription!.sdp
    // The screen audio stays last; music is second-to-last.
    expect(midDaMusica(oferta)).toBe("2")
    expect(ultimoMidDeAudio(oferta)).toBe("3")
    expect(daAlice.sent.find((p) => p.t === "voice.offer")).toMatchObject({ musica: true, ecraSom: true })
  })

  it("com um cliente sem música não há lugar a mais: a ligação é a da 0.8", async () => {
    const { daAlice } = await doisNaMalha({ brunoSemMusica: true })
    const ligacao = FakePeerConnection.instances[0]!
    expect(ligacao.ordem).toEqual(["transceiver:video", "track:audio", "transceiver:audio"])
    expect(daAlice.sent.find((p) => p.t === "voice.offer")).not.toHaveProperty("musica")
  })

  it("partilhar põe a faixa no lugar da música, com o tecto dela, sem oferta nova; parar tira-a", async () => {
    const { alice, daAlice } = await doisNaMalha()
    const ofertas = daAlice.sent.filter((p) => p.t === "voice.offer").length
    const ligacao = FakePeerConnection.instances[0]!
    const lugar = ligacao.transceivers.find((t) => t.mid === midDaMusica(ligacao.localDescription!.sdp))!
    const musica = faixa("audio", "musica")

    expect(await alice.partilharMusica(musica, "Abertura")).toBe(true)
    expect(lugar.sender.faixa).toBe(musica)
    expect(lugar.sender.parametros.encodings[0]?.maxBitrate).toBe(TECTO_DA_MUSICA)
    expect((musica as MediaStreamTrack & { contentHint?: string }).contentHint).toBe("music")
    expect(daAlice.sent.filter((p) => p.t === "voice.offer")).toHaveLength(ofertas)
    expect(daAlice.sent.filter((p) => p.t === "voice.join").at(-1)).toMatchObject({ aTocar: "Abertura" })

    await alice.pararMusica()
    expect(lugar.sender.faixa).toBeNull()
    expect(daAlice.sent.filter((p) => p.t === "voice.join").at(-1)).not.toHaveProperty("aTocar")
    // The track is from the player: stopping the share doesn't stop it.
    expect(musica.stop).not.toHaveBeenCalled()
  })

  it("quem responde também toca, pelo lugar que adoptou", async () => {
    const { bruno } = await doisNaMalha()
    const doBruno = FakePeerConnection.instances[1]!
    const oferta = doBruno.remoteDescription!.sdp
    const lugar = doBruno.transceivers.find((t) => t.mid === midDaMusica(oferta))!
    expect(lugar.direction).toBe("sendrecv")
    const musica = faixa("audio", "musica-do-bruno")
    expect(await bruno.partilharMusica(musica, "Fado")).toBe(true)
    expect(lugar.sender.faixa).toBe(musica)
    // And his microphone stays in the microphone's place.
    expect(doBruno.transceivers.find((t) => t.porAddTrack && t.kind === "audio")!.sender.faixa?.id).toBe("mic")
  })

  it("calar o microfone NÃO pára a música, e parar a música não toca no microfone", async () => {
    const { alice } = await doisNaMalha()
    const ligacao = FakePeerConnection.instances[0]!
    const lugar = ligacao.transceivers.find((t) => t.mid === midDaMusica(ligacao.localDescription!.sdp))!
    const microfone = ligacao.transceivers.find((t) => t.porAddTrack)!.sender.faixa!
    const musica = faixa("audio", "musica")
    await alice.partilharMusica(musica, "Abertura")

    alice.setMuted(true)
    expect(alice.musica).toEqual({ aTocar: "Abertura" })
    expect(lugar.sender.faixa).toBe(musica)
    expect(musica.enabled).toBe(true)

    alice.setMuted(false)
    await alice.pararMusica()
    expect(microfone.enabled).toBe(true)
    expect(ligacao.transceivers.find((t) => t.porAddTrack)!.sender.faixa).toBe(microfone)
  })

  it("do outro lado, a música vai para um fluxo só dela, e só enquanto ela DISSER que toca", async () => {
    const { alice } = await doisNaMalha()
    let vistos: Participant[] = []
    alice.on("participants", (evento) => {
      vistos = evento.participants
    })
    const ligacao = FakePeerConnection.instances[0]!
    const sdp = ligacao.remoteDescription!.sdp
    const voz = new FluxoFalso([faixa("audio", "voz-do-bruno")], "fluxo-do-bruno")
    const doMicrofone = ligacao.transceivers.find((t) => t.porAddTrack)!
    const daMusica = ligacao.transceivers.find((t) => t.mid === midDaMusica(sdp))!
    ligacao.ontrack?.({ track: voz.getTracks()[0], streams: [voz], receiver: {}, transceiver: doMicrofone })
    const musica = faixa("audio", "musica-do-bruno")
    ligacao.ontrack?.({ track: musica, streams: [new FluxoFalso([musica])], receiver: {}, transceiver: daMusica })

    // The slot always arrives; without `aTocar` there's no music to draw.
    expect(vistos[0]?.musica).toBeNull()
    await alice.handleSignal(CHANNEL, BRUNO, {
      t: "voice.join",
      at: Date.now(),
      video: false,
      sframe: false,
      alone: false,
      ecraSom: true,
      musica: true,
      aTocar: "Fado",
    })
    expect(vistos[0]?.aTocar).toBe("Fado")
    expect(vistos[0]?.musica?.getTracks().map((f) => f.id)).toEqual(["musica-do-bruno"])
    // Their voice stays alone on their card.
    expect(vistos[0]?.stream?.getTracks().map((f) => f.id)).toEqual(["voz-do-bruno"])

    // Pause or stop: the announcement stops saying `aTocar`, and the signal turns off.
    await alice.handleSignal(CHANNEL, BRUNO, {
      t: "voice.join",
      at: Date.now(),
      video: false,
      sframe: false,
      alone: false,
      ecraSom: true,
      musica: true,
    })
    expect(vistos[0]?.aTocar).toBeNull()
    expect(vistos[0]?.musica).toBeNull()
  })

  it("mudar de faixa só muda o anúncio: a faixa e o lugar são os mesmos", async () => {
    const { alice, daAlice } = await doisNaMalha()
    const musica = faixa("audio", "musica")
    await alice.partilharMusica(musica, "Um")
    const estados: unknown[] = []
    alice.on("music", (evento) => estados.push(evento.estado))
    alice.mudarATocar("Dois")
    alice.mudarATocar(null)
    await dormir()
    expect(estados).toEqual([{ aTocar: "Dois" }, { aTocar: null }])
    expect(daAlice.sent.filter((p) => p.t === "voice.join").at(-1)).not.toHaveProperty("aTocar")
  })

  it("um nome comprido corta-se no tecto do esquema, e o anúncio continua a sair", async () => {
    const { alice, daAlice } = await doisNaMalha()
    await alice.partilharMusica(faixa("audio"), "x".repeat(500))
    const nome = (daAlice.sent.filter((p) => p.t === "voice.join").at(-1) as { aTocar?: string }).aTocar
    expect(nome?.length).toBe(200)
    expect(nome?.endsWith("…")).toBe(true)
  })

  it("fora de uma chamada não começa, e diz porquê", async () => {
    const alice = new Call(ponteBase(ALICE))
    const erros: string[] = []
    alice.on("error", (evento) => erros.push(evento.detail))
    expect(await alice.partilharMusica(faixa("audio"))).toBe(false)
    expect(erros).toEqual(["you are not in a call"])
  })

  it("sair da chamada esquece a música sem parar a faixa", async () => {
    const { alice } = await doisNaMalha()
    const musica = faixa("audio")
    await alice.partilharMusica(musica, "Um")
    const estados: unknown[] = []
    alice.on("music", (evento) => estados.push(evento.estado))
    await alice.leave()
    expect(alice.musica).toBeNull()
    expect(estados).toEqual([null])
    expect(musica.stop).not.toHaveBeenCalled()
  })
})

// ------------------------------------------------------------ SFU

/** The `mediasoup-client` mock, with the `appData` that carries the source. */
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
    return {
      id,
      on: (evento: "connect" | "produce", ouvinte: never) => {
        if (evento === "connect") aoLigar = ouvinte
        else aoProduzir = ouvinte
      },
      produce: async (opcoes): Promise<ProdutorDeMedia> => {
        // Like `mediasoup-client`: the sender is born before the offer and goes to `onRtpSender` (SEC-02).
        const emissor = comCifra() as RTCRtpSender
        opcoes.onRtpSender?.(emissor)
        const ligar = aoLigar
        aoLigar = null
        if (ligar) await new Promise<void>((resolve, reject) => ligar({ dtlsParameters: {} }, resolve, reject))
        produzidos.push({ fonte: String(opcoes.appData?.["fonte"]), codecOptions: opcoes.codecOptions })
        const feito = await new Promise<{ id: string }>((resolve, reject) =>
          aoProduzir?.({ kind: opcoes.track.kind as "audio" | "video", rtpParameters: {}, appData: opcoes.appData ?? {} }, resolve, reject),
        )
        return { id: feito.id, rtpSender: emissor, close: () => fechadosLocais.push(feito.id) }
      },
      consume: async (opcoes): Promise<ConsumidorDeMedia> => ({
        id: opcoes.id,
        producerId: opcoes.producerId,
        track: faixa(opcoes.kind, `consumida-${opcoes.producerId}`),
        rtpReceiver: comCifra() as RTCRtpReceiver,
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

let produzidos: { fonte: string; codecOptions: unknown }[] = []
let fechadosLocais: string[] = []

function ponteSfu(opcoes: { recusarMusica?: boolean } = {}) {
  const pedidos: { fonte?: string | undefined }[] = []
  const fechados: string[] = []
  let proximo = 0
  const base = ponteBase(ALICE)
  const ponte: CallBridge = {
    ...base,
    sfu: {
      suportaSfu: () => true,
      criarDispositivo: () => new DispositivoFalso(),
      async sfuEntrarNoAmbito() {
        return { rtpCapabilities: {}, producers: [] }
      },
      sfuSairDoAmbito() {},
      async sfuCriarTransporte(_canal, _ambito, sentido) {
        return { id: `t-${sentido}`, iceParameters: {}, iceCandidates: [], dtlsParameters: {} }
      },
      async sfuLigarTransporte() {},
      async sfuProduzir(_transporte, _kind, _rtp, fonte) {
        pedidos.push({ fonte })
        // Today the gateway refuses: the link does not yet know `musica`.
        if ((fonte as string) === "musica" && opcoes.recusarMusica) throw new Error("unparseable frame")
        return `p${proximo++}`
      },
      async sfuFecharProdutor(produtor) {
        fechados.push(produtor)
      },
      async sfuConsumir(_transporte, produtor) {
        return { id: `c-${produtor}`, producerId: produtor, kind: "audio", rtpParameters: {} }
      },
      async sfuRetomar() {},
      async sfuPausar() {},
    },
  }
  return { ponte, pedidos, fechados, enviados: base.sent }
}

/** A sender or receiver where the cipher hangs, as Chromium provides it. */
const comCifra = (): unknown => ({
  createEncodedStreams: () => ({ readable: new ReadableStream(), writable: new WritableStream() }),
})

describe("a música por SFU", () => {
  beforeEach(() => {
    produzidos = []
    fechadosLocais = []
    // Without media cipher, the call falls into the mesh (see `cifraDeMediaEmFalta`).
    class MotorQueCifra {
      createEncodedStreams(): unknown {
        return { readable: new ReadableStream(), writable: new WritableStream() }
      }
    }
    vi.stubGlobal("RTCRtpSender", MotorQueCifra)
    vi.stubGlobal("RTCRtpReceiver", MotorQueCifra)
  })

  it('nasce como produtor próprio, fonte `musica`, Opus estéreo a 64 kbps; e morre com "Parar"', async () => {
    const { ponte, pedidos, fechados } = ponteSfu()
    const alice = new Call(ponte)
    await alice.join(CHANNEL)
    expect(pedidos.map((p) => p.fonte)).toEqual(["microfone"])

    expect(await alice.partilharMusica(faixa("audio", "musica"), "Abertura")).toBe(true)
    expect(pedidos.map((p) => p.fonte)).toEqual(["microfone", "musica"])
    expect(produzidos.at(-1)).toEqual({
      fonte: "musica",
      codecOptions: expect.objectContaining({ opusStereo: true, opusMaxAverageBitrate: TECTO_DA_MUSICA }),
    })

    await alice.pararMusica()
    expect(fechados).toEqual(["p1"])
    expect(fechadosLocais).toEqual(["p1"])
    expect(alice.musica).toBeNull()
  })

  it("é independente do microfone: calar não fecha a música, e parar a música não fecha o microfone", async () => {
    const { ponte, fechados } = ponteSfu()
    const alice = new Call(ponte)
    await alice.join(CHANNEL)
    await alice.partilharMusica(faixa("audio", "musica"), "Abertura")

    alice.setMuted(true)
    await dormir()
    expect(fechados).toEqual([])
    expect(alice.musica).toEqual({ aTocar: "Abertura" })

    await alice.pararMusica()
    expect(fechados).toEqual(["p1"])
  })

  it("um servidor que não a leva: a chamada continua, e a pessoa sabe que a música não sai", async () => {
    const { ponte } = ponteSfu({ recusarMusica: true })
    const alice = new Call(ponte)
    const erros: string[] = []
    alice.on("error", (evento) => erros.push(evento.detail))
    await alice.join(CHANNEL)

    expect(await alice.partilharMusica(faixa("audio"), "Abertura")).toBe(false)
    expect(erros).toEqual(["this call server does not carry music"])
    expect(alice.musica).toBeNull()
  })

  /*
   * SEC-02: music goes through the same `#produzir`. Without our key (we were
   * removed from the channel mid-call), the producer never reaches the server,
   * and the person reads 448 instead of "the server does not take music", which
   * would be a lie.
   */
  it("sem a cifra pronta, a música não sai, e a pessoa lê o código da cifra", async () => {
    // No retries: what we measure here is abandonment (4/11/2026). Retries are
    // proven in the engine (`call-sfu.test.ts`).
    const esperas = MotorSfu.ESPERAS_DA_CIFRA_MS
    MotorSfu.ESPERAS_DA_CIFRA_MS = []
    onTestFinished(() => {
      MotorSfu.ESPERAS_DA_CIFRA_MS = esperas
    })
    const { ponte, pedidos } = ponteSfu()
    let semChave = false
    const alice = new Call({ ...ponte, mediaKey: async (...args) => (semChave ? null : ponte.mediaKey(...args)) })
    const erros: string[] = []
    alice.on("error", (evento) => erros.push(evento.detail))
    await alice.join(CHANNEL)

    semChave = true
    expect(await alice.partilharMusica(faixa("audio"), "Abertura")).toBe(false)
    expect(pedidos.map((p) => p.fonte)).toEqual(["microfone"])
    expect(erros).toEqual(["the call media could not be encrypted"])
    expect(alice.musica).toBeNull()
  })

  it("do outro lado, a música de alguém chega num fluxo só dela, com o nome do roster", async () => {
    const { ponte } = ponteSfu()
    const alice = new Call(ponte)
    let vistos: Participant[] = []
    alice.on("participants", (evento) => {
      vistos = evento.participants
    })
    await alice.join(CHANNEL)
    const ambito = ambitoDaChamada(CHANNEL, "")
    await alice.handleSignal(CHANNEL, BRUNO, {
      t: "voice.join",
      at: Date.now(),
      video: false,
      sframe: true,
      alone: false,
      aTocar: "Fado",
    })
    await alice.handleSfuAviso({ t: "producer.new", channel: CHANNEL, scope: ambito, producer: "pv", address: BRUNO, fonte: "microfone" })
    await alice.handleSfuAviso({ t: "producer.new", channel: CHANNEL, scope: ambito, producer: "pm", address: BRUNO, fonte: "musica" })

    const bruno = vistos.find((cada) => cada.address === BRUNO)!
    expect(bruno.aTocar).toBe("Fado")
    expect(bruno.musica?.getTracks().map((f) => f.id)).toEqual(["consumida-pm"])
    expect(bruno.stream?.getTracks().map((f) => f.id)).toEqual(["consumida-pv"])

    await alice.handleSfuAviso({ t: "producer.closed", channel: CHANNEL, scope: ambito, producer: "pm" })
    expect(vistos.find((cada) => cada.address === BRUNO)?.musica).toBeNull()
  })
})
