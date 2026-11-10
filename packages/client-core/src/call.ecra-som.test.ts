import type { Payload, UserAddress } from "@enclave/protocol"
import { TECTO_DO_SOM_DO_ECRA } from "@enclave/protocol"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  Call,
  primeiroMidDeVideo,
  tectoDoEcra,
  ultimoMidDeAudio,
  type CallBridge,
  type MediaKeyMaterial,
  type Participant,
} from "./call.js"

/**
 * The sound of screen sharing, in the mesh and in the browser request.
 *
 * The defect reported by the owner in 0.8.0: "screen shares are not
 * transmitting audio". It stopped at the FIRST step: `getDisplayMedia` asked for
 * `audio: false`, and sound never existed. Behind that, nothing knew how to
 * carry it: the SFU engine only produced the image, the server refused an audio
 * screen, and the mesh had no place for it. These tests cover the request and
 * the mesh; the SFU engine is in `call-sfu.test.ts`, the server in
 * `media.test.ts`.
 *
 * The connection duplicate mimics Chromium in the TWO rules that decide
 * everything (both measured on 26 October 2026 in a real Chromium):
 *
 *  - `addTrack` reuses an empty transceiver of the same type;
 *  - when applying an offer, only a transceiver created by `addTrack` is
 *    associated with an m-line; other m-lines get a new transceiver.
 */

// -------------------------------------------------------------------- stubs

class FakeSender {
  faixa: MediaStreamTrack | null = null
  trocas: (MediaStreamTrack | null)[] = []
  parametros: { encodings: { maxBitrate?: number }[]; transactionId: string } = { encodings: [{}], transactionId: "t1" }
  get track(): MediaStreamTrack | null {
    return this.faixa
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

  /** Like Chromium: an empty transceiver of the same type is reused. */
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

  /** Like Chromium: only a transceiver from `addTrack` associates with an m-line. */
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

function faixa(kind: "audio" | "video", id = `${kind}-${Math.random()}`, readyState = "live"): MediaStreamTrack {
  return { kind, id, enabled: true, readyState, stop: vi.fn(), onended: null } as unknown as MediaStreamTrack
}

class FluxoFalso {
  readonly id: string
  readonly #faixas: MediaStreamTrack[]
  constructor(faixas: MediaStreamTrack[] = [], id = "fluxo-construido") {
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
}

const ALICE = "@alice:enclave.test" as UserAddress
const BRUNO = "@bruno:enclave.test" as UserAddress
const CHANNEL = "!geral:enclave.test"

function ponte(
  selfAddress: UserAddress,
  entregar?: (payload: Payload) => Promise<void>,
  extra: Partial<CallBridge> = {},
): CallBridge & { sent: Payload[] } {
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
    ...extra,
  }
}

/** A 0.8.0 client: its frames do not carry `ecraSom`. */
function semEcraSom(payload: Payload): Payload {
  const copia = { ...payload } as Record<string, unknown>
  delete copia["ecraSom"]
  return copia as unknown as Payload
}

let pedidos: unknown[] = []
let captura: () => MediaStream

beforeEach(() => {
  FakePeerConnection.instances = []
  pedidos = []
  captura = () => new FluxoFalso([faixa("video", "ecra-v"), faixa("audio", "ecra-a")], "ecra-local") as unknown as MediaStream
  ;(globalThis as unknown as { MediaStream: unknown }).MediaStream = FluxoFalso
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection)
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: async () => new FluxoFalso([faixa("audio", "mic")], "captura"),
      getDisplayMedia: async (pedido: unknown) => {
        pedidos.push(pedido)
        return captura()
      },
    },
  })
})

async function dois(opcoes: { brunoAntigo?: boolean; aliceAntiga?: boolean } = {}): Promise<{
  alice: Call
  bruno: Call
  daAlice: ReturnType<typeof ponte>
  doBruno: ReturnType<typeof ponte>
}> {
  let bruno: Call
  const daAlice = ponte(ALICE, (payload) =>
    bruno.handleSignal(CHANNEL, ALICE, opcoes.aliceAntiga ? semEcraSom(payload) : payload),
  )
  const alice = new Call(daAlice)
  const doBruno = ponte(BRUNO, (payload) =>
    // An old Alice does not read Bruno's `ecraSom`: for her he does not say it.
    alice.handleSignal(CHANNEL, BRUNO, opcoes.brunoAntigo || opcoes.aliceAntiga ? semEcraSom(payload) : payload),
  )
  bruno = new Call(doBruno)
  await alice.join(CHANNEL)
  await bruno.join(CHANNEL)
  return { alice, bruno, daAlice, doBruno }
}

// -------------------------------------------------------------------- testes

describe("o pedido ao browser", () => {
  it("pede o som do ecrã, sem o tratamento da voz, e oferece a caixa do som do sistema", async () => {
    const { alice } = await dois()
    expect(await alice.startScreenShare()).toBe(true)

    // It was `audio: false`: sound did not exist before asking. It stopped here.
    expect(pedidos[0]).toMatchObject({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      systemAudio: "include",
    })
  })

  it("pede ao browser que tire o som da própria página do som do sistema", async () => {
    // Without this the loopback catches the call audio, and everyone hears themselves delayed.
    const { alice } = await dois()
    await alice.startScreenShare()
    // INSIDE `audio`: it is a track constraint (spec Screen Capture, Chrome 140+).
    // At the top of the request Chrome ignores it, and that is where it was.
    expect(pedidos[0]).toMatchObject({ audio: { restrictOwnAudio: true } })
    expect(pedidos[0]).not.toHaveProperty("restrictOwnAudio")
  })

  it("não cala o separador partilhado para quem partilha", async () => {
    const { alice } = await dois()
    await alice.startScreenShare()
    expect(pedidos[0]).toMatchObject({ audio: { suppressLocalAudioPlayback: false } })
  })

  it("mostra de volta só a imagem: o nosso som não toca no nosso palco", async () => {
    const { alice } = await dois()
    let mostrado: MediaStream | null = null
    alice.on("screen", (evento) => {
      mostrado = evento.stream
    })
    await alice.startScreenShare()

    expect(mostrado).not.toBeNull()
    expect(mostrado!.getAudioTracks()).toHaveLength(0)
    expect(mostrado!.getVideoTracks().map((f) => f.id)).toEqual(["ecra-v"])
    expect(alice.screenStream).toBe(mostrado)
  })

  it("uma faixa de som que nasce terminada (Electron no macOS sem permissão) diz-se, e a imagem segue", async () => {
    const { alice } = await dois()
    captura = () =>
      new FluxoFalso([faixa("video", "ecra-v"), faixa("audio", "ecra-a", "ended")], "ecra-local") as unknown as MediaStream
    const erros: string[] = []
    alice.on("error", (evento) => erros.push(evento.detail))

    expect(await alice.startScreenShare()).toBe(true)

    expect(erros).toEqual(["the system did not give the screen sound"])
    const ligacao = FakePeerConnection.instances[0]!
    // No audio place received the dead track.
    const lugaresDeAudio = ligacao.transceivers.filter((t) => t.kind === "audio" && !t.porAddTrack)
    expect(lugaresDeAudio.every((t) => t.sender.faixa === null)).toBe(true)
  })

  it("sem som e com um anfitrião que não o sabe dar, a pessoa sabe que vai mudo", async () => {
    let bruno: Call
    const daAlice = ponte(ALICE, (payload) => bruno.handleSignal(CHANNEL, ALICE, payload), {
      somDoEcraDisponivel: async () => false,
    })
    const alice = new Call(daAlice)
    bruno = new Call(ponte(BRUNO, (payload) => alice.handleSignal(CHANNEL, BRUNO, payload)))
    await alice.join(CHANNEL)
    await bruno.join(CHANNEL)
    captura = () => new FluxoFalso([faixa("video", "ecra-v")], "ecra-local") as unknown as MediaStream
    const erros: string[] = []
    alice.on("error", (evento) => erros.push(evento.detail))

    expect(await alice.startScreenShare()).toBe(true)
    expect(erros).toEqual(["this system cannot share the screen sound"])
  })

  it("uma partilha largada enquanto se prepara o som não deixa a faixa parada no lugar do som (N4)", async () => {
    const { alice } = await dois()
    // The share is dropped mid `#somDoEcraDe`: the same window the wait for the
    // host opens, but without depending on the clock.
    const som = faixa("audio", "ecra-a")
    Object.defineProperty(som, "contentHint", {
      set: () => {
        void alice.stopScreenShare()
      },
    })
    captura = () => new FluxoFalso([faixa("video", "ecra-v"), som], "ecra-local") as unknown as MediaStream

    expect(await alice.startScreenShare()).toBe(false)
    expect(alice.somDoEcra).toBeNull()
    expect(alice.screenStream).toBeNull()
  })

  /*
    Bug from 2/11/2026: "in the browser when screen sharing starts, audio does
    not pass through". The speaker checkbox in Chrome's selector cannot be set by
    code (it shows unchecked across the whole screen, and almost never exists in a
    window). Sharing would go silent and no one said a word: the sharer thought
    the audio was going through.
    */
  it("sem som num browser, a pessoa sabe que vai mudo, e a imagem segue", async () => {
    const { alice } = await dois()
    captura = () => new FluxoFalso([faixa("video", "ecra-v")], "ecra-local") as unknown as MediaStream
    const erros: string[] = []
    alice.on("error", (evento) => erros.push(evento.detail))

    expect(await alice.startScreenShare()).toBe(true)
    expect(erros).toEqual(["the browser did not give the screen sound"])
    expect(alice.screenStream).not.toBeNull()
  })

  it("com som no browser não há aviso nenhum", async () => {
    const { alice } = await dois()
    const erros: string[] = []
    alice.on("error", (evento) => erros.push(evento.detail))
    expect(await alice.startScreenShare()).toBe(true)
    expect(erros).toEqual([])
  })

  it("na aplicação, sem som e com um anfitrião que o sabe dar, não se fala do browser", async () => {
    let bruno: Call
    const daAlice = ponte(ALICE, (payload) => bruno.handleSignal(CHANNEL, ALICE, payload), {
      somDoEcraDisponivel: async () => true,
    })
    const alice = new Call(daAlice)
    bruno = new Call(ponte(BRUNO, (payload) => alice.handleSignal(CHANNEL, BRUNO, payload)))
    await alice.join(CHANNEL)
    await bruno.join(CHANNEL)
    captura = () => new FluxoFalso([faixa("video", "ecra-v")], "ecra-local") as unknown as MediaStream
    const erros: string[] = []
    alice.on("error", (evento) => erros.push(evento.detail))

    expect(await alice.startScreenShare()).toBe(true)
    expect(erros).not.toContain("the browser did not give the screen sound")
  })
})

describe("o som do ecrã na malha", () => {
  it("quem oferece reserva o lugar do som DEPOIS das faixas locais, e di-lo na oferta", async () => {
    const { daAlice } = await dois()
    const ligacao = FakePeerConnection.instances[0]!

    // Microphone first: otherwise its `addTrack` would grab the empty slot.
    // Between the two, the music track (phase 9): audio becomes the last track.
    expect(ligacao.ordem).toEqual(["transceiver:video", "track:audio", "transceiver:audio", "transceiver:audio"])
    const microfone = ligacao.transceivers.find((t) => t.porAddTrack)!
    expect(microfone.sender.faixa?.id).toBe("mic")
    expect(daAlice.sent.find((p) => p.t === "voice.offer")).toMatchObject({ ecraSom: true })
  })

  it("quem responde adopta os lugares da oferta, e passa a enviar por eles", async () => {
    await dois()
    const doBruno = FakePeerConnection.instances[1]!
    const oferta = doBruno.remoteDescription!.sdp

    const imagem = doBruno.transceivers.find((t) => t.mid === primeiroMidDeVideo(oferta))!
    const som = doBruno.transceivers.find((t) => t.mid === ultimoMidDeAudio(oferta))!
    expect(imagem.direction).toBe("sendrecv")
    expect(som.direction).toBe("sendrecv")
    // E o microfone dele continua no m-line do microfone.
    expect(som.sender.faixa).toBeNull()
  })

  it("partilhar põe a imagem E o som nos lugares, sem oferta nova", async () => {
    const { alice, daAlice } = await dois()
    const ofertas = daAlice.sent.filter((p) => p.t === "voice.offer").length
    await alice.startScreenShare()

    const ligacao = FakePeerConnection.instances[0]!
    expect(ligacao.transceivers[0]!.sender.faixa?.id).toBe("ecra-v")
    const lugarDoSom = ligacao.transceivers.at(-1)!
    expect(lugarDoSom.kind).toBe("audio")
    expect(lugarDoSom.sender.faixa?.id).toBe("ecra-a")
    // Audio has its own cap, and the video track lowers it.
    expect(lugarDoSom.sender.parametros.encodings[0]?.maxBitrate).toBe(TECTO_DO_SOM_DO_ECRA)
    expect(ligacao.transceivers[0]!.sender.parametros.encodings[0]?.maxBitrate).toBe(tectoDoEcra(1, true))
    expect(daAlice.sent.filter((p) => p.t === "voice.offer")).toHaveLength(ofertas)

    // Stopping removes both.
    await alice.stopScreenShare()
    expect(lugarDoSom.sender.faixa).toBeNull()
    expect(ligacao.transceivers[0]!.sender.faixa).toBeNull()
  })

  it("quem responde também partilha com som, pelos lugares que adoptou", async () => {
    const { bruno } = await dois()
    await bruno.startScreenShare()

    const doBruno = FakePeerConnection.instances[1]!
    const oferta = doBruno.remoteDescription!.sdp
    expect(doBruno.transceivers.find((t) => t.mid === primeiroMidDeVideo(oferta))!.sender.faixa?.id).toBe("ecra-v")
    expect(doBruno.transceivers.find((t) => t.mid === ultimoMidDeAudio(oferta))!.sender.faixa?.id).toBe("ecra-a")
  })

  it("com um cliente antigo não há lugar do som: a ligação é a de antes", async () => {
    const { alice, daAlice } = await dois({ brunoAntigo: true })
    const ligacao = FakePeerConnection.instances[0]!

    expect(ligacao.ordem).toEqual(["transceiver:video", "track:audio"])
    expect(daAlice.sent.find((p) => p.t === "voice.offer")).not.toHaveProperty("ecraSom")

    // Sharing still works, just without audio for him.
    expect(await alice.startScreenShare()).toBe(true)
    expect(ligacao.transceivers[0]!.sender.faixa?.id).toBe("ecra-v")
  })

  it('o som que chega vai para o fluxo do ECRÃ, e só se vê (e ouve) depois do "Ver"', async () => {
    const { alice } = await dois()
    let vistos: Participant[] = []
    alice.on("participants", (evento) => {
      vistos = evento.participants
    })
    const ligacao = FakePeerConnection.instances[0]!
    const voz = new FluxoFalso([faixa("audio", "voz-do-bruno")], "fluxo-do-bruno")
    const imagem = faixa("video", "imagem-do-bruno")
    const som = faixa("audio", "som-do-bruno")
    ligacao.ontrack?.({ track: voz.getTracks()[0], streams: [voz], receiver: {}, transceiver: undefined })
    ligacao.ontrack?.({ track: imagem, streams: [], receiver: {}, transceiver: ligacao.transceivers[0] })
    ligacao.ontrack?.({ track: som, streams: [], receiver: {}, transceiver: ligacao.transceivers.at(-1) })

    await alice.handleSignal(CHANNEL, BRUNO, {
      t: "voice.join",
      at: Date.now(),
      video: false,
      sframe: false,
      alone: false,
      screen: true,
      ecraSom: true,
    })
    expect(vistos[0]?.screen).toBeNull()

    await alice.aceitarEcra(BRUNO)
    expect(vistos[0]?.screen?.getTracks().map((f) => f.id).sort()).toEqual(["imagem-do-bruno", "som-do-bruno"])
    // His voice stays on his tile, alone.
    expect(vistos[0]?.stream?.getTracks().map((f) => f.id)).toEqual(["voz-do-bruno"])

    // "Stop viewing": the stage exits, and audio exits with it.
    await alice.recusarEcra(BRUNO)
    expect(vistos[0]?.screen).toBeNull()
  })

  it("de um cliente antigo, uma faixa de áudio sem fluxo é lida como antes (a voz)", async () => {
    const { alice } = await dois({ brunoAntigo: true })
    let vistos: Participant[] = []
    alice.on("participants", (evento) => {
      vistos = evento.participants
    })
    const ligacao = FakePeerConnection.instances[0]!
    ligacao.ontrack?.({ track: faixa("audio", "voz-antiga"), streams: [], receiver: {}, transceiver: undefined })

    expect(vistos[0]?.stream?.getTracks().map((f) => f.id)).toEqual(["voz-antiga"])
  })
})

describe("o sinal e o gesto do som do ecrã", () => {
  it("diz que o som sai enquanto sai, e deixa de o dizer ao parar", async () => {
    const { alice } = await dois()
    const estados: unknown[] = []
    alice.on("screen-sound", (evento) => estados.push(evento.estado))
    expect(alice.somDoEcra).toBeNull()

    await alice.startScreenShare()
    expect(alice.somDoEcra).toBe("a-sair")

    await alice.stopScreenShare()
    expect(alice.somDoEcra).toBeNull()
    expect(estados).toEqual(["a-sair", null])
  })

  it("sem som na captura não há sinal nenhum", async () => {
    const { alice } = await dois()
    captura = () => new FluxoFalso([faixa("video", "ecra-v")], "ecra-local") as unknown as MediaStream
    const estados: unknown[] = []
    alice.on("screen-sound", (evento) => estados.push(evento.estado))
    await alice.startScreenShare()
    expect(alice.somDoEcra).toBeNull()
    expect(estados).toEqual([])
  })

  it("calar o som do ecrã desliga a faixa, sem renegociar, e não toca no microfone", async () => {
    const { alice, daAlice } = await dois()
    await alice.startScreenShare()
    const ofertas = daAlice.sent.filter((p) => p.t === "voice.offer").length
    const ligacao = FakePeerConnection.instances[0]!
    const lugarDoSom = ligacao.transceivers.at(-1)!
    const som = lugarDoSom.sender.faixa!
    const estados: unknown[] = []
    alice.on("screen-sound", (evento) => estados.push(evento.estado))

    alice.setSomDoEcraCalado(true)
    expect(som.enabled).toBe(false)
    expect(alice.somDoEcra).toBe("calado")
    // Same track in the same slot: silence, not an empty slot.
    expect(lugarDoSom.sender.faixa).toBe(som)
    expect(daAlice.sent.filter((p) => p.t === "voice.offer")).toHaveLength(ofertas)
    const microfone = ligacao.transceivers.find((t) => t.porAddTrack)!.sender.faixa!
    expect(microfone.enabled).toBe(true)

    alice.setSomDoEcraCalado(false)
    expect(som.enabled).toBe(true)
    expect(estados).toEqual(["calado", "a-sair"])
  })

  it("calar o microfone não cala o som do ecrã", async () => {
    const { alice } = await dois()
    await alice.startScreenShare()
    alice.setMuted(true)
    expect(alice.somDoEcra).toBe("a-sair")
  })
})

describe("o som do ecrã pelo mid", () => {
  it("Firefox: o som que chega COM um fluxo sintético é reconhecido pelo mid", async () => {
    const { alice } = await dois()
    let vistos: Participant[] = []
    alice.on("participants", (evento) => {
      vistos = evento.participants
    })
    const ligacao = FakePeerConnection.instances[0]!
    // The answer is already applied: `remoteDescription` has the mids.
    const lugarDoMicrofone = ligacao.transceivers.find((t) => t.porAddTrack)!
    const lugarDoSom = ligacao.transceivers.at(-1)!
    expect(lugarDoSom.mid).toBe(ultimoMidDeAudio(ligacao.remoteDescription!.sdp))

    const voz = faixa("audio", "voz-do-bruno")
    const som = faixa("audio", "som-do-bruno")
    // Firefox gives a stream to both, which is why missing stream alone does not work.
    ligacao.ontrack?.({ track: voz, streams: [new FluxoFalso([voz], "f1")], receiver: {}, transceiver: lugarDoMicrofone })
    ligacao.ontrack?.({ track: som, streams: [new FluxoFalso([som], "f2")], receiver: {}, transceiver: lugarDoSom })

    expect(vistos[0]?.stream?.getTracks().map((f) => f.id)).toEqual(["voz-do-bruno"])
  })
})

describe("quem oferece é antigo e quem responde partilha", () => {
  it("a imagem vai pelo lugar adoptado, sem lugar do som e sem erro", async () => {
    const { bruno, doBruno } = await dois({ aliceAntiga: true })
    const erros: string[] = []
    bruno.on("error", (evento) => erros.push(evento.detail))
    const daBruno = FakePeerConnection.instances[1]!
    const oferta = daBruno.remoteDescription!.sdp
    // Old Alice did not reserve the audio slot: just one audio in the offer.
    expect(ultimoMidDeAudio(oferta)).toBeNull()

    expect(await bruno.startScreenShare()).toBe(true)
    expect(daBruno.transceivers.find((t) => t.mid === primeiroMidDeVideo(oferta))!.sender.faixa?.id).toBe("ecra-v")
    // Audio did not go anywhere: not to the microphone, not to a new slot.
    const microfone = daBruno.transceivers.find((t) => t.porAddTrack && t.kind === "audio")!
    expect(microfone.sender.faixa?.id).toBe("mic")
    expect(daBruno.transceivers.some((t) => t.sender.faixa?.id === "ecra-a")).toBe(false)
    expect(doBruno.sent.some((p) => p.t === "voice.offer")).toBe(false)
    expect(erros).toEqual([])
  })
})

describe("o tecto do ecrã conta com o som", () => {
  it("com som, a imagem desce 64 kbps; o piso não desce", () => {
    expect(tectoDoEcra(1, true)).toBe(2_500_000 - TECTO_DO_SOM_DO_ECRA)
    expect(tectoDoEcra(4, true)).toBe(1_250_000 - TECTO_DO_SOM_DO_ECRA)
    expect(tectoDoEcra(0, true)).toBe(2_500_000 - TECTO_DO_SOM_DO_ECRA)
    expect(tectoDoEcra(100, true)).toBe(300_000)
    // No audio, same as always.
    expect(tectoDoEcra(4)).toBe(1_250_000)
  })

  it("lê os lugares de uma SDP: o primeiro vídeo e o último áudio", () => {
    const sdp = sdpDe([
      { kind: "video", mid: "0" },
      { kind: "audio", mid: "1" },
      { kind: "audio", mid: "2" },
    ])
    expect(primeiroMidDeVideo(sdp)).toBe("0")
    expect(ultimoMidDeAudio(sdp)).toBe("2")
    // A single audio is the microphone: there is no audio slot.
    expect(ultimoMidDeAudio(sdpDe([{ kind: "video", mid: "0" }, { kind: "audio", mid: "1" }]))).toBeNull()
    expect(primeiroMidDeVideo(sdpDe([{ kind: "audio", mid: "0" }]))).toBeNull()
  })
})
