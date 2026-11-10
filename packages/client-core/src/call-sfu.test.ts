import { TECTO_DA_CAMARA, TECTO_DO_ECRA, TECTO_DO_SOM_DO_ECRA, type FonteDeMedia, type UserAddress } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  AJUSTES_DE_CIFRA,
  MotorSfu,
  OPCOES_DO_SOM_DO_ECRA,
  RecusaDoSfu,
  type ConsumidorDeMedia,
  type DispositivoDeMedia,
  type ParametrosDoTransporte,
  type ProdutorDeMedia,
  type SinalizacaoSfu,
  type TransporteDeMedia,
} from "./call-sfu.js"
import { CifraDeMedia, type MaterialDeChave } from "./media-sframe.js"

/**
 * SFU engine assembled dry, with `mediasoup-client` pretending.
 *
 * Pretending on purpose, not lazily: what these tests measure is CALL ORDER-
 * that decryption is installed before the stream moves, that each request gets
 * its tag, that encryption hooks into the right object-and none of that needs
 * media flowing. Media flowing is tested elsewhere, with real browsers, in
 * `scripts/sfu-ao-vivo.mjs`.
 *
 * The split is deliberate. A test that needs a browser runs once a day; one
 * that doesn't runs on every commit, and that's what catches a line swap on
 * the day someone swaps them.
 */

const EU = "@eu:s" as UserAddress
const OUTRO = "@outro:s" as UserAddress
const TERCEIRO = "@terceiro:s" as UserAddress

/** A fake media key, but with the exact shape of a real one. */
function material(byte: number, keyId = 41): MaterialDeChave {
  return { keyId, senderId: 1, material: new Uint8Array(32).fill(byte) }
}

/** The log of everything that happened, in order. The order is read from it. */
class Diario {
  readonly passos: string[] = []
  escrever(passo: string): void {
    this.passos.push(passo)
  }
  indice(passo: string): number {
    return this.passos.indexOf(passo)
  }
}

class SinalizacaoFalsa implements SinalizacaoSfu {
  produtoresIniciais: { id: string; kind: "audio" | "video"; address: UserAddress; fonte?: FonteDeMedia }[] = []
  /** The transports created, by direction, to verify there are two and distinct. */
  readonly criados: { sentido: string; id: string }[] = []
  readonly ligados: string[] = []
  readonly produzidos: { transport: string; kind: string; fonte?: FonteDeMedia }[] = []
  readonly retomados: string[] = []
  /** The consumers the server was told to pause. See `sfu.pause`. */
  readonly pausados: string[] = []
  /** The consumer for which the pause (or resume) is refused by the server. */
  falharPausaDe: string | null = null
  readonly saidas: { channel: string; scope: string }[] = []
  /** The producers the server reported closed. See `pararEcra`. */
  readonly fechados: string[] = []
  falharConsumoDe: string | null = null
  /** The error code for `falharConsumoDe` refusal. Defaults to the dead producer. */
  codigoDaRecusaDoConsumo = "produtor-desconhecido"
  /** The consumer whose resume the server refuses for being full (`servidor-cheio`). */
  servidorCheioAoRetomar: string | null = null
  /** The source whose production the server refuses for being full (`servidor-cheio`). */
  servidorCheioAoProduzir: FonteDeMedia | null = null
  /**
   * The producer whose consumption FAILS, rather than being refused.
   *
   * The distinction decides whether the engine retries: a `RecusaDoSfu` is a
   * response (the server heard and said no, and the second response is the same),
   * a bare `Error` is a request that might not have arrived. Without both in the
   * pair, the retry path cannot be exercised.
   */
  falharConsumoDeComErro: string | null = null
  /** The server's refusal of a `produce`, as a full call would produce it. */
  recusarProducaoDe: FonteDeMedia | null = null
  /**
   * A server before October 2026: refuses screen audio with `fonte-incoerente`
   * (a screen could only be video) and accepts the image.
   */
  recusarSomDoEcra = false
  /** Holds the screen audio `produce` until opened: the share/stop race. */
  travaDoSomDoEcra: Promise<void> | null = null
  /** What each consumer returns. A video yields a video track. */
  tipoDoConsumo = new Map<string, "audio" | "video">()

  constructor(private readonly diario: Diario) {}

  async sfuEntrarNoAmbito(
    channel: string,
    scope: string,
  ): Promise<{
    rtpCapabilities: unknown
    producers: { id: string; kind: "audio" | "video"; address: UserAddress; fonte?: FonteDeMedia }[]
  }> {
    this.diario.escrever("scope.join")
    return { rtpCapabilities: { codecs: [{ mimeType: "audio/opus" }] }, producers: this.produtoresIniciais }
  }

  sfuSairDoAmbito(channel: string, scope: string): void {
    this.diario.escrever("scope.leave")
    this.saidas.push({ channel, scope })
  }

  async sfuCriarTransporte(
    _channel: string,
    _scope: string,
    direction: "envio" | "recepcao",
  ): Promise<{ id: string; iceParameters: unknown; iceCandidates: unknown; dtlsParameters: unknown }> {
    const id = `t-${direction}`
    this.criados.push({ sentido: direction, id })
    this.diario.escrever(`transport.create:${direction}`)
    return { id, iceParameters: { usernameFragment: "u" }, iceCandidates: [], dtlsParameters: { role: "auto" } }
  }

  async sfuLigarTransporte(transport: string): Promise<void> {
    this.diario.escrever(`transport.connect:${transport}`)
    this.ligados.push(transport)
  }

  async sfuProduzir(
    transport: string,
    kind: "audio" | "video",
    _rtpParameters: unknown,
    fonte?: FonteDeMedia,
  ): Promise<string> {
    const somDoEcra = fonte === "ecra" && kind === "audio"
    this.diario.escrever(`produce:${somDoEcra ? "ecra-som" : (fonte ?? "sem-fonte")}`)
    if (somDoEcra && this.travaDoSomDoEcra) await this.travaDoSomDoEcra
    if (somDoEcra && this.recusarSomDoEcra) {
      throw new RecusaDoSfu("fonte-incoerente", "um fluxo de audio não pode vir de um ecrã")
    }
    if (this.servidorCheioAoProduzir && this.servidorCheioAoProduzir === fonte) {
      throw new RecusaDoSfu("servidor-cheio", "o servidor já envia 300 de 300 Mbit/s de vídeo")
    }
    if (this.recusarProducaoDe && this.recusarProducaoDe === fonte) {
      // How the server refuses: with the physical phrase in full, which is what
      // reaches the screen of whoever tried.
      throw new Error("já há um ecrã a ser partilhado nesta chamada")
    }
    this.produzidos.push({ transport, kind, ...(fonte ? { fonte } : {}) })
    return somDoEcra ? "produtor-ecra-som" : `produtor-${fonte ?? kind}`
  }

  async sfuFecharProdutor(producer: string): Promise<void> {
    this.diario.escrever(`produce.close:${producer}`)
    this.fechados.push(producer)
  }

  async sfuConsumir(
    _transport: string,
    producer: string,
  ): Promise<{ id: string; producerId: string; kind: "audio" | "video"; rtpParameters: unknown }> {
    /*
      * A REFUSAL, not a network failure: what the server returns when the producer
      * no longer exists in this call (`produtor-desconhecido` in `media.ts`). The
      * pair must say which of the two it is, because that distinction is exactly
      * what decides whether the engine retries the request. While this was a bare
      * `Error`, the difference did not exist on this side.
    */
    if (this.falharConsumoDe === producer) {
      throw new RecusaDoSfu(this.codigoDaRecusaDoConsumo, "esse fluxo não existe nesta chamada")
    }
    // The failure, which is what retries. See `falharConsumoDeComErro`.
    if (this.falharConsumoDeComErro === producer) throw new Error("o pedido não chegou")
    this.diario.escrever(`consume:${producer}`)
    return {
      id: `c-${producer}`,
      producerId: producer,
      kind: this.tipoDoConsumo.get(producer) ?? "audio",
      rtpParameters: {},
    }
  }

  async sfuRetomar(_transport: string, consumer: string): Promise<void> {
    this.diario.escrever(`resume:${consumer}`)
    if (this.servidorCheioAoRetomar === consumer) throw new RecusaDoSfu("servidor-cheio", "o servidor está cheio")
    if (this.falharPausaDe === consumer) throw new RecusaDoSfu("consumidor-desconhecido", "esse fluxo não existe")
    this.retomados.push(consumer)
  }

  /**
   * The frame that closes the tap on the server. See `sfu.pause` in the protocol.
   *
   * Logged to the diary like all the others, because the diary shows what the
   * server was told to do-and what this slice needs to prove is that "Stop
   * watching" gets there, not just that the stage closed on our side.
   */
  async sfuPausar(_transport: string, consumer: string): Promise<void> {
    this.diario.escrever(`pause:${consumer}`)
    if (this.falharPausaDe === consumer) throw new RecusaDoSfu("consumidor-desconhecido", "esse fluxo não existe")
    this.pausados.push(consumer)
  }
}

/** An `RTCRtpSender`/`Receiver` pretending, with encoded streams pretending. */
/** An `outbound-rtp` record with only the fields the product reads. */
interface RegistoDeSaida {
  type: string
  kind?: string
  qualityLimitationReason?: string
  frameHeight?: number
}

/**
 * What happened at one end: whether encryption stayed there, and whether the
 * track was removed from it.
 *
 * Outside the end, in a `WeakMap`, because the end looks like a browser object
 * and what the engine sees of it must be just that.
 */
const estadoDaPonta = new WeakMap<object, { cifrada: boolean; semFaixa: boolean }>()

function pontaDeCifra(
  diario: Diario,
  nome: string,
  estatisticas?: () => RegistoDeSaida[] | undefined,
  recusarCifra = false,
): RTCRtpSender & RTCRtpReceiver {
  let codificacoes: Record<string, unknown>[] = [{}]
  const estado = { cifrada: false, semFaixa: false }
  const ponta = {
    createEncodedStreams: () => {
      // Chromium's refusal when streams can no longer be opened.
      if (recusarCifra) throw new Error("InvalidStateError: Too late to create encoded streams")
      diario.escrever(`cifra-instalada:${nome}`)
      estado.cifrada = true
      return { readable: new ReadableStream(), writable: new WritableStream() }
    },
    // Remove the track from the sender: without a track the encoder produces nothing.
    replaceTrack: async (nova: MediaStreamTrack | null) => {
      if (nova === null) {
        estado.semFaixa = true
        diario.escrever(`faixa-retirada:${nome}`)
      } else {
        // Microphone recovery (4/11/2026): the new track in the same sender.
        diario.escrever(`faixa-trocada:${nome}:${estado.cifrada ? "sframe" : "EM-CLARO"}`)
      }
    },
    // Priority (2/11/2026): the engine writes it to the sender after it's born.
    getParameters: () => ({ encodings: codificacoes.map((c) => ({ ...c })) }),
    setParameters: async (parametros: { encodings?: Record<string, unknown>[] }) => {
      codificacoes = parametros.encodings ?? []
      diario.escrever(`prioridade:${nome}:${String(codificacoes[0]?.["priority"])}`)
    },
    /**
     * The SENDER's `getStats()`, where `qualityLimitationReason` comes from.
     *
     * Throws when no one gave it reports, and that's the right behavior for the
     * pair: a sender just born, which hasn't encoded a single frame yet, is a real
     * case and the read must handle it without crashing.
     */
    getStats: async (): Promise<RTCStatsReport> => {
      const registos = estatisticas?.()
      if (!registos) throw new Error(`o emissor ${nome} ainda não tem estatísticas`)
      // The real report is iterable via `forEach`, and that's all the code reads.
      return { forEach: (visitar: (registo: unknown) => void) => registos.forEach(visitar) } as unknown as RTCStatsReport
    },
  }
  estadoDaPonta.set(ponta, estado)
  return ponta as unknown as RTCRtpSender & RTCRtpReceiver
}

class TransporteFalso implements TransporteDeMedia {
  #aoLigar: ((dados: { dtlsParameters: unknown }, feito: () => void, falhou: (erro: Error) => void) => void) | null = null
  #aoProduzir:
    | ((
        dados: { kind: "audio" | "video"; rtpParameters: unknown; appData: Record<string, unknown> },
        feito: (resultado: { id: string }) => void,
        falhou: (erro: Error) => void,
      ) => void)
    | null = null
  fechado = false
  readonly opcoesDeCodec: Record<string, unknown>[] = []
  /** The encoding caps requested, in order. See `TECTO_POR_FONTE`. */
  readonly codificacoes: { maxBitrate?: number }[][] = []
  /** The producers this transport made, and whether they're already closed. */
  readonly produtores: { id: string; fonte: unknown; fechado: boolean; emissor: RTCRtpSender }[] = []
  /** The last track each source took to `produce`. */
  readonly faixas = new Map<string, MediaStreamTrack>()
  /**
   * What this transport's `getStats()` returns.
   *
   * `null` is a transport that can't respond-what in the real library is one
   * that never closed DTLS. See `MotorSfu.latencia`.
   */
  estatisticas: { type: string; nominated?: boolean; currentRoundTripTime?: number }[] | null = null
  /**
   * What `getStats()` on the SENDER for each source returns, by source.
   *
   * By source, not by transport, because that's where the question is asked:
   * quality limitation is at the encoder, and there's one per stream. See
   * `MotorSfu.limiteDeVideo`.
   */
  readonly estatisticasDoEmissor = new Map<string, RegistoDeSaida[]>()

  constructor(
    readonly id: string,
    private readonly diario: Diario,
    readonly opcoes: ParametrosDoTransporte,
  ) {}

  on(evento: "connect" | "produce", ouvinte: never): void {
    if (evento === "connect") this.#aoLigar = ouvinte
    else this.#aoProduzir = ouvinte
  }

  /**
   * Sources whose sender refuses encryption (`createEncodedStreams` throws).
   *
   * Grouped by SOURCE (`microphone`, `camera`, `screen`, `music`; screen audio is also
   * `screen`), because the engine decides what to do with a refusal per source.
   */
  recusarCifraDe = new Set<string>()
  /**
   * A handler that does not call `onRtpSender`, like `Chrome74` in
   * `mediasoup-client`: the sender exists, but no one delivers it in time.
   */
  semOnRtpSender = false

  async produce(opcoes: {
    track: MediaStreamTrack
    codecOptions?: Record<string, unknown>
    encodings?: { maxBitrate?: number }[]
    appData?: Record<string, unknown>
    onRtpSender?: (emissor: RTCRtpSender) => void
  }): Promise<ProdutorDeMedia> {
    if (opcoes.codecOptions) this.opcoesDeCodec.push(opcoes.codecOptions)
    if (opcoes.encodings) this.codificacoes.push(opcoes.encodings)
    /*
     * The sender is born with the transceiver, BEFORE there is an offer, DTLS, producer
     * on the server, or a single packet. It is the `addTransceiver` of the `Chrome111`
     * handler in `mediasoup-client`, which delivers the sender to `onRtpSender` right
     * after, synchronously. The mock does the same, in the same order.
     */
    const fonteDoEmissor = String(opcoes.appData?.["fonte"])
    this.faixas.set(fonteDoEmissor, opcoes.track)
    const emissor = pontaDeCifra(
      this.diario,
      `emissor:${fonteDoEmissor}`,
      () => this.estatisticasDoEmissor.get(fonteDoEmissor),
      this.recusarCifraDe.has(fonteDoEmissor),
    )
    if (opcoes.onRtpSender && !this.semOnRtpSender) opcoes.onRtpSender(emissor)
    // `mediasoup-client` only closes DTLS on the first produce or consume, and the
    // mock reproduces that lazy behavior, otherwise the tests would measure an order
    // that the real library does not have.
    await this.#fecharDtls()
    /*
     * The `kind` comes from the RANGE, as in the real library, and `appData` is
     * echoed exactly. A mock that always said "audio" would hide half of this
     * phase: a screen producer announced as voice would not be consumed by anyone
     * as video.
     */
    const resultado = await new Promise<{ id: string }>((resolve, reject) =>
      this.#aoProduzir?.(
        { kind: opcoes.track.kind as "audio" | "video", rtpParameters: {}, appData: opcoes.appData ?? {} },
        resolve,
        reject,
      ),
    )
    const registo = { id: resultado.id, fonte: opcoes.appData?.["fonte"], fechado: false, emissor }
    this.produtores.push(registo)
    /*
     * From here on, there is RTP: the server has the producer and DTLS is closed.
     * The mock writes it to the log, with the sender state at that moment. A
     * plaintext packet is this step without encryption there.
     */
    const estado = estadoDaPonta.get(emissor)
    if (!estado?.semFaixa) this.diario.escrever(`rtp:${fonteDoEmissor}:${estado?.cifrada ? "sframe" : "EM-CLARO"}`)
    return {
      id: resultado.id,
      rtpSender: emissor,
      close: () => {
        registo.fechado = true
        this.diario.escrever(`produtor.close:${resultado.id}`)
      },
    }
  }

  async consume(opcoes: { id: string; producerId: string; kind: "audio" | "video" }): Promise<ConsumidorDeMedia> {
    await this.#fecharDtls()
    return {
      id: opcoes.id,
      producerId: opcoes.producerId,
      track: { kind: opcoes.kind, id: `faixa-${opcoes.producerId}` } as MediaStreamTrack,
      rtpReceiver: pontaDeCifra(this.diario, opcoes.producerId),
      close: () => {},
    }
  }

  async getStats(): Promise<RTCStatsReport> {
    const registos = this.estatisticas
    if (!registos) throw new Error("este transporte não tem estatísticas")
    // The real report is iterable via `forEach`, and that's all the code reads.
    return { forEach: (visitar: (registo: unknown) => void) => registos.forEach(visitar) } as unknown as RTCStatsReport
  }

  async #fecharDtls(): Promise<void> {
    if (!this.#aoLigar) return
    const ligar = this.#aoLigar
    this.#aoLigar = null
    await new Promise<void>((resolve, reject) => ligar({ dtlsParameters: { role: "client" } }, resolve, reject))
  }

  close(): void {
    this.fechado = true
  }
}

class DispositivoFalso implements DispositivoDeMedia {
  carregadoCom: unknown = null
  readonly transportes: TransporteFalso[] = []
  readonly rtpCapabilities = { codecs: [{ mimeType: "audio/opus" }] }
  /**
   * What this router negotiates, from the side of whoever loaded the device.
   *
   * Mock is a Phase 2 server: router with Opus only. This difference decides
   * whether screen sharing exists in this call, and a mock that always said yes
   * would hide the case that matters.
   */
  video = true

  constructor(private readonly diario: Diario) {}

  canProduce(kind: "audio" | "video"): boolean {
    return kind === "audio" || this.video
  }

  async load(opcoes: { routerRtpCapabilities: unknown }): Promise<void> {
    this.diario.escrever("device.load")
    this.carregadoCom = opcoes.routerRtpCapabilities
  }

  /** See `TransporteFalso.recusarCifraDe`. Shared with the send transport. */
  readonly recusarCifraDe = new Set<string>()
  /** Ver `TransporteFalso.semOnRtpSender`. */
  semOnRtpSender = false

  createSendTransport(opcoes: ParametrosDoTransporte): TransporteDeMedia {
    const transporte = new TransporteFalso(opcoes.id, this.diario, opcoes)
    transporte.recusarCifraDe = this.recusarCifraDe
    transporte.semOnRtpSender = this.semOnRtpSender
    this.transportes.push(transporte)
    return transporte
  }

  /** Producers that stayed ACTIVE without encryption on the sender. Must always be zero. */
  desprotegidosActivos(): string[] {
    return this.transportes
      .flatMap((transporte) => transporte.produtores)
      .filter((produtor) => !produtor.fechado && !estadoDaPonta.get(produtor.emissor)?.cifrada)
      .map((produtor) => produtor.id)
  }

  createRecvTransport(opcoes: ParametrosDoTransporte): TransporteDeMedia {
    const transporte = new TransporteFalso(opcoes.id, this.diario, opcoes)
    this.transportes.push(transporte)
    return transporte
  }
}

function faixa(kind: "audio" | "video" = "audio"): MediaStreamTrack {
  return { kind, enabled: true, stop: () => {} } as MediaStreamTrack
}

interface Montagem {
  motor: MotorSfu
  sinalizacao: SinalizacaoFalsa
  dispositivo: DispositivoFalso
  diario: Diario
  cifra: CifraDeMedia
  diagnosticos: { code: string; detail?: string }[]
  chaves: Map<string, MaterialDeChave | null>
  /** The refusals that the engine told the person about. See `aoRecusar`. */
  recusas: Error[]
  /** The voice that gave up on encryption for good. See `aoPerderAVoz`. */
  vozPerdida: Error[]
}

/**
 * The engine, set up.
 *
 * `ecrasAceites` says whose screen this engine was told to watch. **Empty
 * by default, which is the correct new state**: since October 5, 2026, a
 * screen producer is not consumed without a choice. It was automatic, and the receiver
 * got 2.5 Mbps imposed with no way to refuse. Tests that want the screen to
 * arrive say so, and that difference makes the rule visible in each one.
 */
function montar(ecrasAceites: UserAddress[] = []): Montagem {
  const diario = new Diario()
  const sinalizacao = new SinalizacaoFalsa(diario)
  const dispositivo = new DispositivoFalso(diario)
  const diagnosticos: { code: string; detail?: string }[] = []
  const recusas: Error[] = []
  const vozPerdida: Error[] = []
  const chaves = new Map<string, MaterialDeChave | null>([
    [EU, material(1)],
    [OUTRO, material(2)],
    [TERCEIRO, material(3)],
  ])

  const cifra = new CifraDeMedia({
    selfAddress: EU,
    mediaKey: async (_canal, address) => chaves.get(address) ?? null,
    reservarContadorSframe: async () => 1000,
  })

  const motor = new MotorSfu({
    sinalizacao,
    cifra,
    criarDispositivo: () => dispositivo,
    aoDiagnosticar: (code, detail) => diagnosticos.push(detail === undefined ? { code } : { code, detail }),
    aoMudar: () => {},
    verOEcraDe: (quem) => ecrasAceites.includes(quem),
    aoRecusar: (erro) => recusas.push(erro),
    aoPerderAVoz: (erro) => vozPerdida.push(erro),
  })

  return { motor, sinalizacao, dispositivo, diario, cifra, diagnosticos, chaves, recusas, vozPerdida }
}

beforeEach(() => {
  /*
   * The `MediaStream` that Node does not have, now with tracks coming and going.
   *
   * The engine stopped building one stream per read and now MAINTAINS one per
   * person, editing its tracks. Changing a `srcObject` on an element restarts it,
   * and with a shared screen that is visible. A mock that only had a constructor
   * would hide the earlier version of this design.
   */
  ;(globalThis as unknown as { MediaStream: unknown }).MediaStream = class {
    readonly tracks: MediaStreamTrack[]
    constructor(tracks: MediaStreamTrack[] = []) {
      this.tracks = [...tracks]
    }
    getTracks(): MediaStreamTrack[] {
      return [...this.tracks]
    }
    addTrack(faixa: MediaStreamTrack): void {
      if (!this.tracks.includes(faixa)) this.tracks.push(faixa)
    }
    removeTrack(faixa: MediaStreamTrack): void {
      const onde = this.tracks.indexOf(faixa)
      if (onde >= 0) this.tracks.splice(onde, 1)
    }
  }
})

describe("a montagem de uma chamada por SFU", () => {
  it("pede as capacidades ANTES de haver transporte, porque o device.load precisa delas", async () => {
    const { motor, diario } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    // This is why `sfu.scope.join` was added to the vocabulary and is the first
    // frame of all. Without it, `device.load()` would have nowhere to get the
    // router's `rtpCapabilities` from.
    expect(diario.indice("scope.join")).toBeLessThan(diario.indice("device.load"))
    expect(diario.indice("device.load")).toBeLessThan(diario.indice("transport.create:envio"))
  })

  it("faz UM transporte de cada sentido, e não uma ligação por pessoa", async () => {
    const { motor, sinalizacao } = montar()
    sinalizacao.produtoresIniciais = [
      { id: "p-outro", kind: "audio", address: OUTRO },
      { id: "p-terceiro", kind: "audio", address: TERCEIRO },
    ]

    await motor.entrar("#c:s", "a".repeat(43), faixa())

    // In a mesh, three people would be two connections, and with three there are two
    // simultaneous negotiations, which is where the entire family of bugs lived.
    // Here there are two transports, with two people or with fifteen.
    expect(sinalizacao.criados).toEqual([
      { sentido: "envio", id: "t-envio" },
      { sentido: "recepcao", id: "t-recepcao" },
    ])
  })

  it("liga os insertable streams nos DOIS transportes", async () => {
    const { motor, dispositivo } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    // Missing it in one of them gives a call where you speak protected and hear noise,
    // or the opposite: they are different `RTCPeerConnection` objects, and the extension
    // comes from the constructor of each one. Phase 0 proved by difference that without
    // this, `createEncodedStreams()` throws `InvalidStateError`.
    expect(dispositivo.transportes).toHaveLength(2)
    for (const transporte of dispositivo.transportes) {
      expect(transporte.opcoes.additionalSettings).toMatchObject(AJUSTES_DE_CIFRA)
    }
  })

  it("diz as medidas de contenção do lado de quem codifica, e não só ao router", async () => {
    const { motor, dispositivo } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    // Only on the router, Chrome ignores them. Measured in Phase 0 and written in point 4
    // of what it said to assume. Without DTX, Opus sends encoded silence all the time:
    // seventy percent more bandwidth on a two-core machine shared with magnuslab.pt.
    const opcoes = dispositivo.transportes.flatMap((cada) => cada.opcoesDeCodec)
    expect(opcoes).toHaveLength(1)
    expect(opcoes[0]).toMatchObject({ opusDtx: true, opusStereo: false, opusMaxAverageBitrate: 32_000 })
  })

  it("fecha o DTLS de cada transporte, e uma vez só", async () => {
    const { motor, sinalizacao } = montar()
    sinalizacao.produtoresIniciais = [
      { id: "p-outro", kind: "audio", address: OUTRO },
      { id: "p-terceiro", kind: "audio", address: TERCEIRO },
    ]
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    // No packet passes without DTLS. Two people consuming cannot shake hands on the
    // same transport twice: the second would be refused by the engine and what you
    // would see is the second person with no sound.
    expect(sinalizacao.ligados.toSorted()).toEqual(["t-envio", "t-recepcao"])
  })
})

describe("a cifra entra por este caminho", () => {
  it("pendura-se no rtpSender do produtor", async () => {
    const { motor, diario } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    // It is the same surface that the mesh clings to today. What changes with the SFU is
    // the object it comes from, not the encryption.
    expect(diario.passos).toContain("cifra-instalada:emissor:microfone")
  })

  it("a voz sai com prioridade alta, à frente do vídeo", async () => {
    const { motor, diario } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    expect(diario.passos).toContain("prioridade:emissor:microfone:high")
  })

  it("e no rtpReceiver de cada pessoa que se ouve", async () => {
    const { motor, sinalizacao, diario } = montar()
    sinalizacao.produtoresIniciais = [{ id: "p-outro", kind: "audio", address: OUTRO }]
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    expect(diario.passos).toContain("cifra-instalada:p-outro")
  })

  it("com a chave da epoch, uma por pessoa e não uma por chamada", async () => {
    const { motor, sinalizacao, cifra } = montar()
    sinalizacao.produtoresIniciais = [
      { id: "p-outro", kind: "audio", address: OUTRO },
      { id: "p-terceiro", kind: "audio", address: TERCEIRO },
    ]
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    // Each sender has its own key, derived with the index of its leaf. A key for the
    // entire call would decipher everyone with the same material, which is precisely
    // what the MLS exporter does not do.
    expect(cifra.receptoresDe(OUTRO)).toBe(1)
    expect(cifra.receptoresDe(TERCEIRO)).toBe(1)
  })

  /**
   * The most important guarantee in this file.
   *
   * The consumer is born paused on the server side, and `sfu.resume` is what starts it.
   * Between the two, decryption setup must fit. Switching the order gives no error,
   * just half a second of noise in everyone's ear each time a person enters.
   */
  it("instala a decifra ANTES de retomar o fluxo, e nunca ao contrário", async () => {
    const { motor, sinalizacao, diario } = montar()
    sinalizacao.produtoresIniciais = [{ id: "p-outro", kind: "audio", address: OUTRO }]
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    expect(diario.indice("cifra-instalada:p-outro")).toBeGreaterThan(-1)
    expect(diario.indice("resume:c-p-outro")).toBeGreaterThan(-1)
    expect(diario.indice("cifra-instalada:p-outro")).toBeLessThan(diario.indice("resume:c-p-outro"))
  })
})

describe("quem já lá estava e quem chega depois", () => {
  it("apanha os fluxos que já existiam antes de entrarmos", async () => {
    const { motor, sinalizacao } = montar()
    sinalizacao.produtoresIniciais = [{ id: "p-outro", kind: "audio", address: OUTRO }]
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    // Without this, whoever arrives late would only hear those who speak AFTER them:
    // the classic bug of joining a room and finding it empty while everyone talks.
    expect(motor.fluxos().map((cada) => cada.address)).toEqual([OUTRO])
  })

  it("e o fluxo de quem chega a seguir", async () => {
    const { motor, sinalizacao } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())
    expect(motor.fluxos()).toHaveLength(0)

    await motor.produtorNovo("#c:s", "a".repeat(43), "p-terceiro", TERCEIRO)

    expect(motor.fluxos().map((cada) => cada.address)).toEqual([TERCEIRO])
    expect(sinalizacao.retomados).toContain("c-p-terceiro")
  })

  it("não consome o mesmo fluxo duas vezes", async () => {
    const { motor, sinalizacao } = montar()
    sinalizacao.produtoresIniciais = [{ id: "p-outro", kind: "audio", address: OUTRO }]
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    // The notice can arrive on top of what came in `scope.joined`, if the person
    // produces at the exact moment we enter. The same producer twice gives the same
    // voice playing twice with half a second apart: it sounds like an echo and you search
    // in the wrong place for hours.
    await motor.produtorNovo("#c:s", "a".repeat(43), "p-outro", OUTRO)

    expect(sinalizacao.retomados).toEqual(["c-p-outro"])
    expect(motor.fluxos()).toHaveLength(1)
  })

  it("ignora um aviso de outra chamada", async () => {
    const { motor } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    // A notice from a previous call still in flight would put a stream inside the
    // next call, with the voice of whoever was left behind.
    await motor.produtorNovo("#outro:s", "b".repeat(43), "p-x", TERCEIRO)
    await motor.produtorNovo("#c:s", "b".repeat(43), "p-y", TERCEIRO)

    expect(motor.fluxos()).toHaveLength(0)
  })

  it("larga o fluxo de quem sai", async () => {
    const { motor, sinalizacao } = montar()
    sinalizacao.produtoresIniciais = [{ id: "p-outro", kind: "audio", address: OUTRO }]
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    motor.produtorFechado("p-outro")

    expect(motor.fluxos()).toHaveLength(0)
  })

  it("uma pessoa que não se consegue ouvir não derruba a chamada com as outras", async () => {
    const { motor, sinalizacao, diagnosticos } = montar()
    sinalizacao.produtoresIniciais = [
      { id: "p-mau", kind: "audio", address: OUTRO },
      { id: "p-bom", kind: "audio", address: TERCEIRO },
    ]
    sinalizacao.falharConsumoDe = "p-mau"

    await motor.entrar("#c:s", "a".repeat(43), faixa())

    expect(motor.fluxos().map((cada) => cada.address)).toEqual([TERCEIRO])
    // The refusal is written, with the code. Since 4/11/2026 a producer that the
    // server does not know repeats itself (see `call-sfu.corridas.test.ts`, "a
    // server refusal that can be a timeout"): the line is `-recusado`, and
    // `-falhou` only comes if the refusal is final or the producer has died.
    expect(diagnosticos.map((cada) => cada.code)).toContain("sfu-consumo-recusado")
  })
})

describe("a saída", () => {
  it("fecha os dois transportes e diz ao servidor que saiu", async () => {
    const { motor, dispositivo, sinalizacao } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    motor.sair()

    // Closing the transport closes the producers and consumers under it: it is
    // the only call that must happen on the mediasoup-client side.
    //
    // The length first, and it is not pedantry: `[].every(...)` is `true`. Without this
    // line, an `entrar()` that stopped creating transports, or a renamed field,
    // would give a green light to a test whose name promises TWO closed.
    expect(dispositivo.transportes).toHaveLength(2)
    expect(dispositivo.transportes.every((cada) => cada.fechado)).toBe(true)
    expect(sinalizacao.saidas).toEqual([{ channel: "#c:s", scope: "a".repeat(43) }])
    expect(motor.activo).toBe(false)
  })

  it("e não fica com fluxos da chamada anterior", async () => {
    const { motor, sinalizacao } = montar()
    sinalizacao.produtoresIniciais = [{ id: "p-outro", kind: "audio", address: OUTRO }]
    await motor.entrar("#c:s", "a".repeat(43), faixa())
    expect(motor.fluxos()).toHaveLength(1)

    motor.sair()

    expect(motor.fluxos()).toHaveLength(0)
  })
})

describe("a chave da epoch e a janela de duas chaves, por este caminho", () => {
  /**
   * The plan scenario, written as is: A+B in epoch 41, C enters, all move to 42,
   * and the audio DOES NOT cut.
   *
   * What measures it is the number of receivers per person after the rotation: two,
   * the new key and the previous one. With only one, frames from epoch 41 that were
   * still in flight would fail the `keyId` check and be silently discarded, with
   * both faces on screen and the call saying it is connected.
   */
  it("depois de uma entrada, cada pessoa mantém a chave nova E a anterior", async () => {
    const { motor, sinalizacao, cifra, chaves } = montar()
    sinalizacao.produtoresIniciais = [{ id: "p-outro", kind: "audio", address: OUTRO }]
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    expect(cifra.receptoresDe(OUTRO)).toBe(1)

    // C enters: the commit moves everyone from epoch 41 to 42, and each one derives
    // the new key on their own when they apply the commit. Never at the same instant.
    chaves.set(EU, material(11, 42))
    chaves.set(OUTRO, material(12, 42))
    chaves.set(TERCEIRO, material(13, 42))
    await motor.produtorNovo("#c:s", "a".repeat(43), "p-terceiro", TERCEIRO)

    const fora = await cifra.rodar(motor.emissores())

    expect(fora).toEqual([])
    // Two: the one at 42 and the one at 41. This one prevents mute.
    expect(cifra.receptoresDe(OUTRO)).toBe(2)
  })

  it("e quem deixou de ter chave é dito, em vez de ficar a ocupar lugar", async () => {
    const { motor, sinalizacao, cifra, chaves } = montar()
    sinalizacao.produtoresIniciais = [
      { id: "p-outro", kind: "audio", address: OUTRO },
      { id: "p-terceiro", kind: "audio", address: TERCEIRO },
    ]
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    // Kicked out of the channel: the epoch advances and the new key does not derive for them.
    // It is future confidentiality of MLS, not code discipline.
    chaves.set(TERCEIRO, null)

    expect(await cifra.rodar(motor.emissores())).toEqual([TERCEIRO])
  })

  it("sem chave nossa não se conclui nada sobre ninguém", async () => {
    const { motor, sinalizacao, cifra, chaves } = montar()
    sinalizacao.produtoresIniciais = [{ id: "p-outro", kind: "audio", address: OUTRO }]
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    // A channel that this device does not yet have set up returns `null` for
    // everyone. Throwing away the call because of it would be worse than the
    // bug being fixed.
    chaves.set(EU, null)
    chaves.set(OUTRO, null)

    expect(await cifra.rodar(motor.emissores())).toEqual([])
  })
})

/**
 * Encryption is a REQUIREMENT to publish (SEC-02, external audit of 1.1.0).
 *
 * Until 1.2.0 these two tests stated the opposite: "the call works anyway, and
 * it is noted that it is not protected". Without `rtpSender`, or without a key,
 * the producer CAME UP and stayed active with no SFrame, and the only mark was
 * a line in the log (`sfu-sem-rtpsender`, `sfu-emissor-sem-cifra`) that no
 * screen read. With an SFU that is media the server can read: open failure. The
 * tests changed direction because the behavior they described is the finding.
 *
 * Now: encryption is set up BEFORE `produce` (key, counter, worker with
 * ACK), hooked to `onRtpSender` (the sender still has no offer, DTLS or
 * producer on the server), and if any of this fails the producer does not come active.
 */
/**
 * SEC-03 (external audit of 1.1.0): who leaves the channel mid-call.
 *
 * Until 1.2.0 rotation only wrote `call-fora-do-canal`: their keys stayed, their
 * consumers kept playing, and the server kept sending us their media. `revoke`
 * closes the three doors: the keys (in encryption), what you hear and see (the
 * stream) and the tap (pause on the server).
 */
describe("quem sai do canal a meio da chamada", () => {
  async function chamadaComOTerceiro(): Promise<Montagem> {
    const montagem = montar([TERCEIRO])
    montagem.sinalizacao.produtoresIniciais = [
      { id: "p-outro", kind: "audio", address: OUTRO },
      { id: "p-terceiro", kind: "audio", address: TERCEIRO },
      { id: "p-terceiro-cam", kind: "video", address: TERCEIRO, fonte: "camara" },
      { id: "p-terceiro-ecra", kind: "video", address: TERCEIRO, fonte: "ecra" },
    ]
    montagem.sinalizacao.tipoDoConsumo.set("p-terceiro-cam", "video")
    montagem.sinalizacao.tipoDoConsumo.set("p-terceiro-ecra", "video")
    await montagem.motor.entrar("#c:s", "a".repeat(43), faixa())
    return montagem
  }

  it("fica sem chaves, sem fluxo e com a torneira fechada no servidor", async () => {
    const { motor, cifra, chaves, sinalizacao } = await chamadaComOTerceiro()
    expect(motor.fluxos().map((fluxo) => fluxo.address).sort()).toEqual([OUTRO, TERCEIRO].sort())

    chaves.set(TERCEIRO, null)
    const fora = await cifra.rodar(motor.emissores())
    expect(fora).toEqual([TERCEIRO])
    for (const address of fora) await motor.revogar(address)

    expect(cifra.receptoresDe(TERCEIRO)).toBe(0)
    expect(motor.fluxos().map((fluxo) => fluxo.address)).toEqual([OUTRO])
    // Their three streams, voice, camera and screen, stopped on the server.
    expect(sinalizacao.pausados).toEqual(
      expect.arrayContaining(["c-p-terceiro", "c-p-terceiro-cam", "c-p-terceiro-ecra"]),
    )
    // And whoever stays in the channel lost nothing.
    expect(cifra.receptoresDe(OUTRO)).toBe(1)
  })

  it("se o servidor não pausar, o consumidor fecha cá: nada dele fica a tocar", async () => {
    const { motor, chaves, sinalizacao, cifra, diagnosticos } = await chamadaComOTerceiro()
    sinalizacao.falharPausaDe = "c-p-terceiro"

    chaves.set(TERCEIRO, null)
    for (const address of await cifra.rodar(motor.emissores())) await motor.revogar(address)

    expect(motor.fluxos().map((fluxo) => fluxo.address)).toEqual([OUTRO])
    expect(diagnosticos.map((cada) => cada.code)).toContain("sfu-revogado-fechado")
  })

  it("um reassento (sem folha num commit, com outra no seguinte) volta a ouvir-se, no MESMO consumidor", async () => {
    const { motor, chaves, sinalizacao, cifra, diario } = await chamadaComOTerceiro()
    chaves.set(TERCEIRO, null)
    for (const address of await cifra.rodar(motor.emissores())) await motor.revogar(address)
    expect(motor.fluxos().map((fluxo) => fluxo.address)).toEqual([OUTRO])

    // The next commit seats them on another leaf: they have a key again.
    chaves.set(TERCEIRO, material(23, 43))
    expect(await cifra.rodar(motor.emissores())).toEqual([])
    await motor.protegerOsSemChave()

    expect(motor.fluxos().map((fluxo) => fluxo.address).sort()).toEqual([OUTRO, TERCEIRO].sort())
    expect(sinalizacao.retomados.filter((id) => id === "c-p-terceiro")).toHaveLength(2)
    // Decryption was already hooked to the receiver: we do not ask for the streams
    // again (Chromium would throw `InvalidStateError`).
    expect(diario.passos.filter((passo) => passo === "cifra-instalada:p-terceiro")).toHaveLength(1)
    expect(cifra.receptoresDe(TERCEIRO)).toBe(1)
  })
})

describe("a cifra é condição para publicar", () => {
  const MENSAGEM = "the call media could not be encrypted"
  /*
   * No retries, so these tests measure ABANDONMENT: what happens when encryption
   * is not ready right away. Retries have their own block, "encryption that fails
   * tries again". Since 4/11/2026 voice does not crash the entry: entry resolves,
   * and abandonment comes through `aoPerderAVoz`.
   */
  const esperas = MotorSfu.ESPERAS_DA_CIFRA_MS
  beforeEach(() => {
    MotorSfu.ESPERAS_DA_CIFRA_MS = []
  })
  afterEach(() => {
    MotorSfu.ESPERAS_DA_CIFRA_MS = esperas
  })

  it("no caminho certo, a cifra está no emissor antes do produtor existir no servidor, e o primeiro pacote já vai cifrado", async () => {
    const { motor, diario, dispositivo } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa(), faixa("video"))
    await motor.partilharEcra(faixa("video"), faixa())
    await motor.partilharMusica(faixa())

    for (const fonte of ["microfone", "camara", "musica"]) {
      expect(diario.indice(`cifra-instalada:emissor:${fonte}`)).toBeGreaterThanOrEqual(0)
      expect(diario.indice(`cifra-instalada:emissor:${fonte}`)).toBeLessThan(diario.indice(`produce:${fonte}`))
    }
    expect(diario.indice("cifra-instalada:emissor:ecra")).toBeLessThan(diario.indice("produce:ecra"))
    // No packet left without encryption hooked, in any of the five sources.
    expect(diario.passos.filter((passo) => passo.startsWith("rtp:"))).toHaveLength(5)
    expect(diario.passos.filter((passo) => passo.endsWith(":EM-CLARO"))).toEqual([])
    expect(dispositivo.desprotegidosActivos()).toEqual([])
  })

  it("sem chave nossa o microfone não chega a ser produzido, e a voz desiste com o código da cifra", async () => {
    const { motor, diario, dispositivo, chaves, diagnosticos, vozPerdida } = montar()
    chaves.set(EU, null)

    await motor.entrar("#c:s", "a".repeat(43), faixa())
    await vi.waitFor(() => expect(vozPerdida.map((erro) => erro.message)).toEqual([MENSAGEM]))
    expect(diario.passos).not.toContain("produce:microfone")
    expect(dispositivo.desprotegidosActivos()).toEqual([])
    expect(diagnosticos.map((cada) => cada.code)).toContain("sfu-emissor-recusado-sem-cifra")
  })

  it("se a plataforma recusar a cifra no emissor, o microfone fecha cá e no servidor e a faixa sai antes de haver RTP", async () => {
    const { motor, diario, dispositivo, sinalizacao, vozPerdida } = montar()
    dispositivo.recusarCifraDe.add("microfone")

    await motor.entrar("#c:s", "a".repeat(43), faixa())
    await vi.waitFor(() => expect(vozPerdida.map((erro) => erro.message)).toEqual([MENSAGEM]))
    expect(diario.passos).toContain("faixa-retirada:emissor:microfone")
    expect(diario.passos.filter((passo) => passo.startsWith("rtp:"))).toEqual([])
    expect(sinalizacao.fechados).toContain("produtor-microfone")
    expect(dispositivo.desprotegidosActivos()).toEqual([])
  })

  it("um handler que nunca entrega o emissor a tempo (sem onRtpSender) também não deixa o produtor activo", async () => {
    const { motor, dispositivo, sinalizacao, diagnosticos, vozPerdida } = montar()
    dispositivo.semOnRtpSender = true

    await motor.entrar("#c:s", "a".repeat(43), faixa())
    await vi.waitFor(() => expect(vozPerdida.map((erro) => erro.message)).toEqual([MENSAGEM]))
    expect(sinalizacao.fechados).toContain("produtor-microfone")
    expect(dispositivo.desprotegidosActivos()).toEqual([])
    expect(diagnosticos.map((cada) => cada.code)).toContain("sfu-sem-rtpsender")
  })

  it("a câmara recusada fecha só a câmara: a chamada fica, e a pessoa lê porquê", async () => {
    const { motor, dispositivo, sinalizacao, recusas } = montar()
    dispositivo.recusarCifraDe.add("camara")

    await expect(motor.entrar("#c:s", "a".repeat(43), faixa(), faixa("video"))).resolves.toBeUndefined()
    expect(sinalizacao.fechados).toContain("produtor-camara")
    expect(dispositivo.desprotegidosActivos()).toEqual([])
    await vi.waitFor(() => expect(recusas.map((erro) => erro.message)).toContain(MENSAGEM))
  })

  it("o ecrã recusado não fica no ar, e a partilha falha com o código da cifra", async () => {
    const { motor, dispositivo, sinalizacao } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())
    dispositivo.recusarCifraDe.add("ecra")

    await expect(motor.partilharEcra(faixa("video"))).rejects.toThrow(MENSAGEM)
    expect(motor.aPartilharEcra).toBe(false)
    expect(sinalizacao.fechados).toContain("produtor-ecra")
    expect(dispositivo.desprotegidosActivos()).toEqual([])
  })

  it("sem chave a meio da chamada, nem o ecrã nem a música chegam ao servidor", async () => {
    const { motor, diario, dispositivo, chaves } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())
    // We were kicked out of the channel: the session no longer has our key.
    chaves.set(EU, null)

    await expect(motor.partilharEcra(faixa("video"))).rejects.toThrow(MENSAGEM)
    await expect(motor.partilharMusica(faixa())).rejects.toThrow(MENSAGEM)
    expect(diario.passos).not.toContain("produce:ecra")
    expect(diario.passos).not.toContain("produce:musica")
    expect(motor.aTocarMusica).toBe(false)
    expect(dispositivo.desprotegidosActivos()).toEqual([])
  })

  it("o som do ecrã recusado fecha-se, e a imagem segue cifrada", async () => {
    const { motor, dispositivo, sinalizacao, recusas } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())
    // Video and audio are the two screens; we reject whichever is born second.
    const transporte = dispositivo.transportes[0]!
    const original = transporte.produce.bind(transporte)
    transporte.produce = async (opcoes) => {
      if (opcoes.track.kind === "audio") transporte.recusarCifraDe.add("ecra")
      return original(opcoes)
    }

    await expect(motor.partilharEcra(faixa("video"), faixa())).resolves.toBe(true)
    expect(motor.aPartilharEcra).toBe(true)
    expect(motor.aEnviarSomDoEcra).toBe(false)
    expect(sinalizacao.fechados).toContain("produtor-ecra-som")
    expect(dispositivo.desprotegidosActivos()).toEqual([])
    expect(recusas.map((erro) => erro.message)).toContain(MENSAGEM)
  })

  it("a música recusada pela plataforma fecha-se, cá e no servidor", async () => {
    const { motor, dispositivo, sinalizacao } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())
    dispositivo.transportes[0]!.recusarCifraDe.add("musica")

    await expect(motor.partilharMusica(faixa())).rejects.toThrow(MENSAGEM)
    expect(motor.aTocarMusica).toBe(false)
    expect(sinalizacao.fechados).toContain("produtor-musica")
    expect(dispositivo.desprotegidosActivos()).toEqual([])
  })
})

/**
 * The method that does NOT exist-something other than a method that rejects.
 *
 * This block reproduces the absence, not guards against it: the fakes below
 * do not have `createEncodedStreams`, exactly like Firefox and Safari's
 * `RTCRtpSender`, measured on August 17, 2026 in Firefox 153 and WebKit 26.5,
 * `scripts/sfu-cifra-por-motor.mjs`. A test that only measured the guard would
 * pass with the method present, which is the case that was never broken.
 *
 * The difference between the two absences is measured in the same script and
 * deserves to be written here, because it pointed to the cause: in Chromium
 * the method is ALWAYS on both prototypes, and what the missing
 * `encodedInsertableStreams` option produces is `InvalidStateError`, never
 * "is not a function". So a lost option on the way to the constructor could not
 * explain the report, and the engine could.
 */
describe("um motor sem insertable streams", () => {
  /** A Firefox `RTCRtpSender`: identical to Chromium's, except for the method. */
  function pontaSemCifra(): RTCRtpSender & RTCRtpReceiver {
    return {} as unknown as RTCRtpSender & RTCRtpReceiver
  }

  function cifraCom(diagnosticos: { code: string; detail?: string }[]): CifraDeMedia {
    const cifra = new CifraDeMedia(
      {
        selfAddress: EU,
        mediaKey: async () => material(1),
        reservarContadorSframe: async () => 1000,
      },
      (code, detail) => diagnosticos.push(detail === undefined ? { code } : { code, detail }),
    )
    // No channel means no key, and no key means cipher gives up BEFORE reaching the
    // method, the test would pass for the wrong reason, measuring the guard that
    // was already there instead of the one missing.
    cifra.canal = "#c:s"
    return cifra
  }

  it("a cifra do emissor responde que não, em vez de atirar", async () => {
    const diagnosticos: { code: string; detail?: string }[] = []
    const cifra = cifraCom(diagnosticos)

    // Without this fix it REJECTS with `createEncodedStreams is not a function`,
    // which is the exact phrase from the production report.
    await expect(cifra.protegerEmissor(pontaSemCifra())).resolves.toBe(false)
    expect(diagnosticos).toEqual([{ code: "sframe-sem-insertable-streams", detail: "emissor" }])
  })

  it("e a do receptor também, com o seu nome", async () => {
    const diagnosticos: { code: string; detail?: string }[] = []
    const cifra = cifraCom(diagnosticos)

    await expect(cifra.protegerReceptor(pontaSemCifra(), OUTRO)).resolves.toBe(false)
    expect(diagnosticos).toEqual([{ code: "sframe-sem-insertable-streams", detail: "receptor" }])
  })

  it("um emissor que RECUSA leva outro nome, porque é outra avaria", async () => {
    const diagnosticos: { code: string; detail?: string }[] = []
    const cifra = cifraCom(diagnosticos)
    const recusa = {
      createEncodedStreams: () => {
        // Word for word what Chromium throws when the connection was not built with
        // `encodedInsertableStreams`. Measured in the script.
        throw new Error("InvalidStateError: Too late to create encoded streams")
      },
    } as unknown as RTCRtpSender

    await expect(cifra.protegerEmissor(recusa)).resolves.toBe(false)
    expect(diagnosticos[0]?.code).toBe("sframe-cifra-recusada")
    // The whole mechanism: it is what distinguishes "no option in the constructor"
    // from "we already asked for this sender's streams", which is another hunt.
    expect(diagnosticos[0]?.detail).toContain("InvalidStateError")
  })

  it("uma segunda tentativa é uma tentativa a sério, e não uma marca velha", async () => {
    const diagnosticos: { code: string; detail?: string }[] = []
    const cifra = cifraCom(diagnosticos)
    let pedidos = 0
    const emissor = {
      createEncodedStreams: () => {
        pedidos += 1
        if (pedidos === 1) throw new Error("InvalidStateError: Too late to create encoded streams")
        return { readable: new ReadableStream(), writable: new WritableStream() }
      },
    } as unknown as RTCRtpSender

    expect(await cifra.protegerEmissor(emissor)).toBe(false)
    // `#protegidos` is marked BEFORE key derivation, so two simultaneous passes
    // do not ask for the streams twice. A failure must clear the mark, otherwise
    // the next attempt answers "already protected" on a sender running in the clear.
    expect(await cifra.protegerEmissor(emissor)).toBe(true)
    expect(pedidos).toBe(2)
  })

  /*
   * Up to 1.2.0 this claimed the engine set up the call "just fine" with a
   * Firefox sender: the input resolved and `sfu-emissor-sem-cifra` ended up
   * in the log, with the mic on in the clear. The right half works (doesn't
   * crash with `createEncodedStreams is not a function`). The other is finding
   * SEC-02, so it changed: voice gives up with the cipher code and the producer
   * closes. Since 4/11/2026 the failure arrives via `aoPerderAVoz`, after
   * retries (none here), and no longer via input rejection.
   */
  it("e o motor não rebenta a meio da entrada: recusa com o código da cifra e fecha o produtor", async () => {
    const registo = new Diario()
    const sinalizacao = new SinalizacaoFalsa(registo)
    const diagnosticos: { code: string; detail?: string }[] = []
    const dispositivo = new DispositivoFalso(registo)
    const vozPerdida: Error[] = []

    // A Firefox sender delivered by `onRtpSender`: the SFU sets up entirely, and
    // cipher fails on the last line.
    const originalSend = dispositivo.createSendTransport.bind(dispositivo)
    dispositivo.createSendTransport = (opcoes): TransporteDeMedia => {
      const transporte = originalSend(opcoes)
      const original = transporte.produce.bind(transporte)
      transporte.produce = async (op): Promise<ProdutorDeMedia> =>
        original({ ...op, ...(op.onRtpSender ? { onRtpSender: () => op.onRtpSender?.(pontaSemCifra()) } : {}) })
      return transporte
    }

    const motor = new MotorSfu({
      sinalizacao,
      cifra: new CifraDeMedia({
        selfAddress: EU,
        mediaKey: async () => material(1),
        reservarContadorSframe: async () => 1000,
      }),
      criarDispositivo: () => dispositivo,
      verOEcraDe: () => false,
      aoDiagnosticar: (code, detail) => diagnosticos.push(detail === undefined ? { code } : { code, detail }),
      aoMudar: () => {},
      aoPerderAVoz: (erro) => vozPerdida.push(erro),
    })
    const esperas = MotorSfu.ESPERAS_DA_CIFRA_MS
    MotorSfu.ESPERAS_DA_CIFRA_MS = []

    try {
      await motor.entrar("#c:s", "a".repeat(43), faixa())
      await vi.waitFor(() => expect(vozPerdida.map((erro) => erro.message)).toEqual(["the call media could not be encrypted"]))
    } finally {
      MotorSfu.ESPERAS_DA_CIFRA_MS = esperas
    }
    expect(diagnosticos.map((cada) => cada.code)).toContain("sfu-emissor-sem-cifra")
    expect(sinalizacao.fechados).toContain("produtor-microfone")
  })
})

describe("uma chamada sem microfone", () => {
  it("monta-se na mesma e ouve, sem produzir nada", async () => {
    const { motor, sinalizacao } = montar()
    sinalizacao.produtoresIniciais = [{ id: "p-outro", kind: "audio", address: OUTRO }]

    // No track: this is what happens when capture fails and the person chooses to
    // join anyway. Hearing without speaking is half a call; no call is worse.
    await motor.entrar("#c:s", "a".repeat(43), null)

    expect(sinalizacao.produzidos).toEqual([])
    expect(motor.fluxos()).toHaveLength(1)
  })
})

/**
 * Latency to the SFU, the number that was missing.
 *
 * `Call.measureLatency` walks `#peers`, and in an SFU call that map is empty:
 * it returned `null` and the UI fell back to socket ping, which is TCP, while
 * media travels over the ICE path. In a network that pushes media to TURN the
 * two numbers diverge, and what showed was the wrong path.
 *
 * What this block pins down is the reading: the named pair of candidates, the
 * worst of the two transports, and absence stated as absence.
 */
describe("a latência até ao SFU", () => {
  it("lê o par de candidatos nomeado, e ignora os que não vingaram", async () => {
    const { motor, dispositivo } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    dispositivo.transportes[0]!.estatisticas = [
      // A path tried that did not work. The average with it gave 131 ms, which
      // describes nothing: no single packet goes that way.
      { type: "candidate-pair", nominated: false, currentRoundTripTime: 0.24 },
      { type: "candidate-pair", nominated: true, currentRoundTripTime: 0.022 },
      { type: "inbound-rtp" },
    ]

    expect(await motor.latencia()).toBe(22)
  })

  it("devolve o PIOR dos dois transportes, e não a média", async () => {
    const { motor, dispositivo } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    // These are two separate connections, each with its own ICE, and they can
    // settle on different paths. Whoever has the bad connection is whoever arrives
    // late to the conversation, and an average where the good hides the terrible
    // says everything is fine.
    dispositivo.transportes[0]!.estatisticas = [{ type: "candidate-pair", nominated: true, currentRoundTripTime: 0.02 }]
    dispositivo.transportes[1]!.estatisticas = [{ type: "candidate-pair", nominated: true, currentRoundTripTime: 0.08 }]

    expect(await motor.latencia()).toBe(80)
  })

  it("um transporte que ainda não assentou não estraga a medida do outro", async () => {
    const { motor, dispositivo } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    // The receive side only closes DTLS when someone is consumed: in a solo call
    // it fires instead of answers, and that is not a measurement failure.
    dispositivo.transportes[0]!.estatisticas = [{ type: "candidate-pair", nominated: true, currentRoundTripTime: 0.031 }]
    dispositivo.transportes[1]!.estatisticas = null

    expect(await motor.latencia()).toBe(31)
  })

  it("sem medida nenhuma diz ausência, e nunca um zero", async () => {
    const { motor } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    // Zero is a number, and a number draws: a newly set up call would say "0 ms" to
    // anyone looking, which is the easiest lie to believe on this screen.
    expect(await motor.latencia()).toBeNull()
  })
})

/**
 * Video: camera, screen, and the difference between them.
 *
 * In the mesh the screen was distinguished from the camera by PLACE, a
 * transceiver reserved per pair, with `replaceTrack` putting and taking the
 * image without renegotiating. With an SFU there are no places: there are
 * producers, and two videos from the same person are indistinguishable by
 * `kind`. What separates them is the source, and it is what decides the
 * bandwidth cap for each and where each one draws.
 */
describe("a câmara e o ecrã", () => {
  it("põe a câmara na chamada com a fonte dita, e o tecto dela", async () => {
    const { motor, sinalizacao, dispositivo } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa(), faixa("video"))

    expect(sinalizacao.produzidos).toEqual([
      { transport: "t-envio", kind: "audio", fonte: "microfone" },
      { transport: "t-envio", kind: "video", fonte: "camara" },
    ])
    // The cap goes in ENCODING not in codec, which is where VP8 states it, and it
    // is the number the server reads and rejects when it exceeds.
    expect(dispositivo.transportes[0]!.codificacoes).toEqual([[{ maxBitrate: TECTO_DA_CAMARA }]])
  })

  it("não tenta a câmara contra um servidor que só encaminha voz", async () => {
    /*
     * A Phase 2 homeserver announces a router with only Opus. Without this guard
     * `produce` was rejected, `enter` crashed, and whoever had the camera plugged
     * in ended up with NO CALL instead of no camera.
     */
    const { motor, sinalizacao, dispositivo } = montar()
    dispositivo.video = false

    await motor.entrar("#c:s", "a".repeat(43), faixa(), faixa("video"))

    expect(sinalizacao.produzidos.map((cada) => cada.fonte)).toEqual(["microfone"])
    expect(motor.podeVideo).toBe(false)
  })

  it("partilha o ecrã como um produtor NOVO, sem desmontar nada", async () => {
    const { motor, sinalizacao, dispositivo } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    expect(await motor.partilharEcra(faixa("video"))).toBe(true)

    // One transport, two producers. It is renegotiation that the mesh could not
    // do, and that here does not cost a second connection to anyone.
    expect(sinalizacao.criados).toHaveLength(2)
    expect(sinalizacao.produzidos.map((cada) => cada.fonte)).toEqual(["microfone", "ecra"])
    expect(dispositivo.transportes[0]!.codificacoes).toEqual([[{ maxBitrate: TECTO_DO_ECRA }]])
    expect(motor.aPartilharEcra).toBe(true)
  })

  it("cifra o ecrã como cifra a voz", async () => {
    // Screen share is the stream that most resembles a document: what is written
    // there is the kind of thing nobody wants on someone else's server.
    const { motor, diario } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())
    await motor.partilharEcra(faixa("video"))

    expect(diario.passos).toContain("cifra-instalada:emissor:ecra")
  })

  it("recusa partilhar contra um servidor que não negoceia vídeo, sem tocar no servidor", async () => {
    const { motor, sinalizacao, dispositivo, diagnosticos } = montar()
    dispositivo.video = false
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    expect(await motor.partilharEcra(faixa("video"))).toBe(false)
    expect(sinalizacao.produzidos.map((cada) => cada.fonte)).toEqual(["microfone"])
    expect(diagnosticos.map((cada) => cada.code)).toContain("sfu-sem-video")
  })

  it("deixa a recusa do servidor subir, com a frase física intacta", async () => {
    /*
     * The cap is the server's and the phrase is its: "there is already a screen
     * being shared in this call". Swallowing it here and returning `false` gave a
     * button that does nothing, without a word saying why, the most expensive way
     * a product can refuse.
     */
    const { motor, sinalizacao } = montar()
    sinalizacao.recusarProducaoDe = "ecra"
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    await expect(motor.partilharEcra(faixa("video"))).rejects.toThrow("já há um ecrã")
  })

  it("parar de partilhar diz ao SERVIDOR, e só depois fecha o produtor", async () => {
    /*
     * Both halves, and neither is disposable. Without the frame, the server kept
     * announcing to newcomers a stream that no longer exists and whoever was
     * watching was left with the last frame frozen, forever. And order matters:
     * closing first lost the identifier the message carries.
     */
    const { motor, sinalizacao, dispositivo, diario } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())
    await motor.partilharEcra(faixa("video"))

    await motor.pararEcra()

    expect(sinalizacao.fechados).toEqual(["produtor-ecra"])
    expect(diario.indice("produce.close:produtor-ecra")).toBeLessThan(diario.indice("produtor.close:produtor-ecra"))
    expect(dispositivo.transportes[0]!.produtores.find((cada) => cada.fonte === "ecra")?.fechado).toBe(true)
    expect(motor.aPartilharEcra).toBe(false)
  })

  it("pára a captura mesmo quando o servidor não responde", async () => {
    // The OS recording indicator stays on while the producer lives. Leaving it on
    // because a frame didn't arrive is the worse of the two failures.
    const { motor, sinalizacao, dispositivo, diagnosticos } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())
    await motor.partilharEcra(faixa("video"))
    vi.spyOn(sinalizacao, "sfuFecharProdutor").mockRejectedValue(new Error("sem ligação"))

    await motor.pararEcra()

    expect(dispositivo.transportes[0]!.produtores.find((cada) => cada.fonte === "ecra")?.fechado).toBe(true)
    expect(diagnosticos.map((cada) => cada.code)).toContain("sfu-ecra-nao-fechou")
    expect(motor.aPartilharEcra).toBe(false)
  })

  it("não partilha duas vezes o mesmo ecrã", async () => {
    const { motor, sinalizacao } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())
    await motor.partilharEcra(faixa("video"))
    await motor.partilharEcra(faixa("video"))

    expect(sinalizacao.produzidos.filter((cada) => cada.fonte === "ecra")).toHaveLength(1)
  })

  it("larga a partilha ao sair, e não a leva para a chamada seguinte", async () => {
    const { motor } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())
    await motor.partilharEcra(faixa("video"))

    motor.sair()

    expect(motor.aPartilharEcra).toBe(false)
  })
})

/**
 * What arrives, arranged by PERSON, and their screen apart.
 *
 * One person can have three streams arriving at the same time and only one card
 * on screen. The screen goes apart because the stage draws it in `contain` and
 * the mosaic draws faces in `cover`: two places with opposite rules, and a
 * `cover` over a 16:9 monitor cuts exactly the edges, where the tab bar and the
 * editor's side panel live.
 */
describe("os fluxos que chegam, por pessoa", () => {
  it("junta o microfone e a câmara da mesma pessoa num fluxo só", async () => {
    const { motor, sinalizacao } = montar()
    sinalizacao.produtoresIniciais = [
      { id: "p-voz", kind: "audio", address: OUTRO, fonte: "microfone" },
      { id: "p-cara", kind: "video", address: OUTRO, fonte: "camara" },
    ]
    sinalizacao.tipoDoConsumo.set("p-cara", "video")

    await motor.entrar("#c:s", "a".repeat(43), faixa())

    const fluxos = motor.fluxos()
    expect(fluxos).toHaveLength(1)
    expect(fluxos[0]!.stream.getTracks()).toHaveLength(2)
    expect(fluxos[0]!.ecra).toBeNull()
  })

  it("põe o ecrã à parte, e não dentro do cartão da pessoa", async () => {
    // `montar([OUTRO])`: the screen reaches only the caller. See `montar`.
    const { motor, sinalizacao } = montar([OUTRO])
    sinalizacao.produtoresIniciais = [
      { id: "p-voz", kind: "audio", address: OUTRO, fonte: "microfone" },
      { id: "p-ecra", kind: "video", address: OUTRO, fonte: "ecra" },
    ]
    sinalizacao.tipoDoConsumo.set("p-ecra", "video")

    await motor.entrar("#c:s", "a".repeat(43), faixa())

    const [fluxo] = motor.fluxos()
    expect(fluxo!.stream.getTracks()).toHaveLength(1)
    expect(fluxo!.ecra?.getTracks()).toHaveLength(1)
  })

  it('um consumo de ecrã recusado não apaga a oferta: o "Ver" pode voltar a tentar', async () => {
    /*
      * On October 18, 2026 screen share stopped appearing to some participants and
      * no gesture brought it back: the offer left the list before consumption,
      * consumption failed for good, and the "View" bar kept pointing to an offer
      * that no longer existed. A failed request is a truth about THAT request, not
      * about the screen: the offer stands and the next request consumes again.
      */
    const { motor, sinalizacao, diagnosticos } = montar([OUTRO])
    sinalizacao.tipoDoConsumo.set("p-ecra", "video")
    sinalizacao.falharConsumoDe = "p-ecra"
    await motor.entrar("#c:s", "a".repeat(43), faixa())
    // The server still has the screen: it is the list it returns when asked.
    sinalizacao.produtoresIniciais = [{ id: "p-ecra", kind: "video", address: OUTRO, fonte: "ecra" }]

    await motor.produtorNovo("#c:s", "a".repeat(43), "p-ecra", OUTRO, "ecra")
    // Since 4/11/2026 this rejection (`produtor-desconhecido`) repeats; the "See"
    // is a signal and tries right away. With a final rejection, the offer goes back to the list: the
    // case below (`servidor-cheio`) measures that half.
    expect(diagnosticos.map((cada) => cada.code)).toContain("sfu-consumo-recusado")
    expect(motor.fluxos().find((cada) => cada.address === OUTRO)?.ecra ?? null).toBeNull()

    sinalizacao.falharConsumoDe = null
    await motor.consumirOfertasDe(OUTRO)

    expect(motor.fluxos().find((cada) => cada.address === OUTRO)?.ecra?.getTracks()).toHaveLength(1)
  })

  describe("o servidor cheio de transmissões (`servidor-cheio`)", () => {
    it('o "Ver" recusado diz-se à pessoa, a oferta fica, e a chamada continua', async () => {
      const { motor, sinalizacao, recusas } = montar([OUTRO])
      sinalizacao.tipoDoConsumo.set("p-ecra", "video")
      sinalizacao.falharConsumoDe = "p-ecra"
      sinalizacao.codigoDaRecusaDoConsumo = "servidor-cheio"
      await motor.entrar("#c:s", "a".repeat(43), faixa())

      await motor.produtorNovo("#c:s", "a".repeat(43), "p-ecra", OUTRO, "ecra")
      expect(recusas.map((erro) => erro.message)).toEqual(["the server is full of broadcasts"])
      expect(motor.ambito).not.toBeNull()

      sinalizacao.falharConsumoDe = null
      await motor.consumirOfertasDe(OUTRO)
      expect(motor.fluxos().find((cada) => cada.address === OUTRO)?.ecra?.getTracks()).toHaveLength(1)
    })

    it('o "Ver" depois de "Parar de ver" recusado também se diz', async () => {
      const { motor, sinalizacao, recusas } = montar([OUTRO])
      sinalizacao.tipoDoConsumo.set("p-ecra", "video")
      await motor.entrar("#c:s", "a".repeat(43), faixa())
      await motor.produtorNovo("#c:s", "a".repeat(43), "p-ecra", OUTRO, "ecra")
      await motor.largarEcraDe(OUTRO)

      sinalizacao.servidorCheioAoRetomar = "c-p-ecra"
      await motor.consumirOfertasDe(OUTRO)
      expect(recusas.map((erro) => erro.message)).toEqual(["the server is full of broadcasts"])
    })

    it("a câmara recusada ao entrar diz-se, e a voz entra na mesma", async () => {
      const { motor, sinalizacao, recusas } = montar()
      sinalizacao.servidorCheioAoProduzir = "camara"
      await motor.entrar("#c:s", "a".repeat(43), faixa(), faixa("video"))
      expect(recusas.map((erro) => erro.message)).toEqual(["the server is full of broadcasts"])
      expect(sinalizacao.produzidos.map((cada) => cada.fonte)).toEqual(["microfone"])
    })

    it("as outras recusas de consumo continuam só no registo", async () => {
      const { motor, sinalizacao, recusas } = montar([OUTRO])
      sinalizacao.tipoDoConsumo.set("p-ecra", "video")
      sinalizacao.falharConsumoDe = "p-ecra"
      await motor.entrar("#c:s", "a".repeat(43), faixa())
      await motor.produtorNovo("#c:s", "a".repeat(43), "p-ecra", OUTRO, "ecra")
      expect(recusas).toEqual([])
    })
  })

  it("chama câmara a um vídeo que chega sem fonte, e nunca ecrã", async () => {
    /*
     * A server before this phase sends no source. Reading the absence as "screen"
     * put someone's FACE on stage, full screen, even though nobody had shared
     * anything.
     */
    const { motor, sinalizacao } = montar()
    sinalizacao.produtoresIniciais = [{ id: "p-cara", kind: "video", address: OUTRO }]
    sinalizacao.tipoDoConsumo.set("p-cara", "video")

    await motor.entrar("#c:s", "a".repeat(43), faixa())

    const [fluxo] = motor.fluxos()
    expect(fluxo!.ecra).toBeNull()
    expect(fluxo!.stream.getTracks()).toHaveLength(1)
  })

  it("mantém o MESMO objecto de fluxo quando alguém entra na chamada", async () => {
    /*
     * Swapping the `srcObject` of an element restarts it. With audio you hear a
     * click; with a shared screen the image disappears and returns each time
     * someone joins or leaves, which is exactly when the roster changes and the UI
     * redraws.
     */
    const { motor, sinalizacao } = montar([OUTRO])
    sinalizacao.produtoresIniciais = [{ id: "p-ecra", kind: "video", address: OUTRO, fonte: "ecra" }]
    sinalizacao.tipoDoConsumo.set("p-ecra", "video")
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    const antes = motor.fluxos()[0]!.ecra
    await motor.produtorNovo("#c:s", "a".repeat(43), "p-voz-terceiro", TERCEIRO, "microfone")

    expect(motor.fluxos().find((cada) => cada.address === OUTRO)!.ecra).toBe(antes)
  })

  it("tira o ecrã do palco quando quem partilhava pára, e deixa a voz dela", async () => {
    const { motor, sinalizacao } = montar([OUTRO])
    sinalizacao.produtoresIniciais = [
      { id: "p-voz", kind: "audio", address: OUTRO, fonte: "microfone" },
      { id: "p-ecra", kind: "video", address: OUTRO, fonte: "ecra" },
    ]
    sinalizacao.tipoDoConsumo.set("p-ecra", "video")
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    motor.produtorFechado("p-ecra")

    const [fluxo] = motor.fluxos()
    expect(fluxo!.ecra).toBeNull()
    expect(fluxo!.stream.getTracks()).toHaveLength(1)
  })

  /*
   * Until 1.2.0 this test was called "a person with one unencrypted stream among
   * others encrypted does not draw as protected", and asserted that the
   * unencrypted stream ENTERED what you hear, marked `encrypted: false`. It was
   * the receive half of SEC-02 (external audit at 1.1.0, "also review the
   * receiver"): a receiver without decryption plays what the server sends it, and
   * a server that sends media in the clear on behalf of someone was heard as that
   * person. Now it closes: the stream stays stopped at the server and out of what
   * you hear, and the person stays marked by what actually arrives, which is
   * encrypted.
   */
  it("um fluxo cuja decifra a plataforma recusa não entra no que se ouve, e fica parado no servidor", async () => {
    const { motor, sinalizacao, cifra } = montar([OUTRO])
    sinalizacao.produtoresIniciais = [
      { id: "p-voz", kind: "audio", address: OUTRO, fonte: "microfone" },
      { id: "p-ecra", kind: "video", address: OUTRO, fonte: "ecra" },
    ]
    sinalizacao.tipoDoConsumo.set("p-ecra", "video")
    await motor.entrar("#c:s", "a".repeat(43), faixa())
    expect(motor.fluxos()[0]!.encrypted).toBe(true)

    // The platform rejects decryption of the next stream from them, with the key
    // in hand, and it enters unencrypted. (Without KEY is another story: the stream
    // stays stopped and does not enter what you hear. See "the stream from someone
    // who does not have the key yet".)
    vi.spyOn(cifra, "protegerReceptor").mockResolvedValueOnce(false)
    await motor.produtorNovo("#c:s", "a".repeat(43), "p-cara", OUTRO, "camara")

    expect(sinalizacao.retomados).not.toContain("c-p-cara")
    expect(motor.fluxos()[0]!.stream.getTracks().map((faixa) => faixa.id)).not.toContain("faixa-p-cara")
    expect(motor.fluxos()[0]!.encrypted).toBe(true)
  })
})

/**
 * A screen consumes only if we request it, and stops being received if we say so.
 *
 * Owner request on 5 October 2026, after a call with others: *when someone shares
 * the screen, others should enter the stream only if they want to.* It was automatic, any new
 * producer consumed without checking the source, and receivers paid 2.5 Mbps
 * imposed with nowhere to decline: no simulcast or layers, so no small screen version to request.
 *
 * **What we measure is what the SERVER is told to do, not what the screen shows.** The log stores
 * the three frames that control the gate, `consume:<produtor>`, `resume:<consumidor>` and
 * `pause:<consumidor>`, and that's where bandwidth opens and closes. A test looking only at
 * `fluxos()` would pass with the full image streaming from the server, because closing a
 * consumer on the client side tells nobody anything.
 *
 * This was written twice: *"a consumer created and paused already makes the SFU forward the
 * image"*. FALSE: in mediasoup a paused consumer sends no RTP, it's the same guarantee that
 * `consume({ paused: true })` in `media.ts` exists to give between consumption and decryption
 * setup. The slice conclusion does not change (not consuming at all stays the cheapest saving,
 * and it's the common case), but "Stop watching" now PAUSES instead of closing, which is what
 * saves bandwidth for real.
 */
describe("o ecrã que só se vê a pedido", () => {
  it("não pede ao servidor um ecrã que ninguém quis ver", async () => {
    const aceites: UserAddress[] = []
    const { motor, sinalizacao, diario } = montar(aceites)
    sinalizacao.produtoresIniciais = [
      { id: "p-voz", kind: "audio", address: OUTRO, fonte: "microfone" },
      { id: "p-ecra", kind: "video", address: OUTRO, fonte: "ecra" },
    ]
    sinalizacao.tipoDoConsumo.set("p-ecra", "video")

    await motor.entrar("#c:s", "a".repeat(43), faixa())

    // The server's tap closed. This is the line that matters.
    expect(diario.passos).not.toContain("consume:p-ecra")
    expect(sinalizacao.retomados).not.toContain("c-p-ecra")
    // And voice arrived, which is the contrast: what changed is ONLY the screen.
    expect(diario.passos).toContain("consume:p-voz")
    expect(motor.fluxos()[0]!.stream.getTracks()).toHaveLength(1)
    expect(motor.fluxos()[0]!.ecra).toBeNull()

    // And the offer stayed up, so there was something to accept, measured by what
    // it serves, which is a "View" succeeding in consuming it.
    aceites.push(OUTRO)
    await motor.consumirOfertasDe(OUTRO)
    expect(diario.passos).toContain("consume:p-ecra")
  })

  it("a câmara e a voz continuam a chegar sem se pedir nada", async () => {
    // The consent to see them is having joined the call, and that does not change.
    // Without this contrast, the fix could have closed the entire call.
    const { motor, sinalizacao, diario } = montar()
    sinalizacao.produtoresIniciais = [
      { id: "p-voz", kind: "audio", address: OUTRO, fonte: "microfone" },
      { id: "p-cara", kind: "video", address: OUTRO, fonte: "camara" },
    ]
    sinalizacao.tipoDoConsumo.set("p-cara", "video")

    await motor.entrar("#c:s", "a".repeat(43), faixa())

    expect(diario.passos).toContain("consume:p-voz")
    expect(diario.passos).toContain("consume:p-cara")
    expect(motor.fluxos()[0]!.stream.getTracks()).toHaveLength(2)
  })

  it("aceitar pede-o ao servidor, e só então", async () => {
    const aceites: UserAddress[] = []
    const { motor, sinalizacao, diario } = montar(aceites)
    sinalizacao.produtoresIniciais = [{ id: "p-ecra", kind: "video", address: OUTRO, fonte: "ecra" }]
    sinalizacao.tipoDoConsumo.set("p-ecra", "video")
    await motor.entrar("#c:s", "a".repeat(43), faixa())
    expect(diario.passos).not.toContain("consume:p-ecra")

    // The choice BEFORE consuming: it's what `#consumir` reads. `Call` does the
    // same order, and reversed nothing consumes and nobody notices.
    aceites.push(OUTRO)
    await motor.consumirOfertasDe(OUTRO)

    expect(diario.passos).toContain("consume:p-ecra")
    expect(motor.fluxos()[0]!.ecra?.getTracks()).toHaveLength(1)
  })

  it("um ecrã anunciado a meio da chamada também espera pela escolha", async () => {
    // The other entry path: `produtorNovo`, from the gateway notification. Two paths to
    // the same consumption, and a guard in one only was half a guard.
    const aceites: UserAddress[] = []
    const { motor, sinalizacao, diario } = montar(aceites)
    await motor.entrar("#c:s", "a".repeat(43), faixa())
    sinalizacao.tipoDoConsumo.set("p-ecra", "video")

    await motor.produtorNovo("#c:s", "a".repeat(43), "p-ecra", OUTRO, "ecra")
    expect(diario.passos).not.toContain("consume:p-ecra")

    aceites.push(OUTRO)
    await motor.consumirOfertasDe(OUTRO)
    expect(diario.passos).toContain("consume:p-ecra")
  })

  /**
   * "Stop watching" tells the SERVER, and it is the fix for the leak.
   *
   * What was here before closed the consumer on this side and nothing else: the
   * stage closed, decryption stopped, and the worker kept routing the image to
   * a transport that no longer reads it. Each cycle "Watch → Stop watching → Watch"
   * left behind a consumer at 2.5 Mbps, two frames per cycle against a cap of
   * three hundred per minute, meaning close to one hundred fifty leaked consumers
   * per minute, all chargeable to one authenticated member.
   */
  it("largar PAUSA no servidor em vez de fechar, e o palco fecha", async () => {
    const aceites: UserAddress[] = [OUTRO]
    const { motor, sinalizacao, diario } = montar(aceites)
    sinalizacao.produtoresIniciais = [{ id: "p-ecra", kind: "video", address: OUTRO, fonte: "ecra" }]
    sinalizacao.tipoDoConsumo.set("p-ecra", "video")
    await motor.entrar("#c:s", "a".repeat(43), faixa())
    expect(motor.fluxos()[0]!.ecra?.getTracks()).toHaveLength(1)

    aceites.length = 0
    await motor.largarEcraDe(OUTRO)

    // The line that matters: the server was TOLD to stop. Without it, what we saved
    // was decryption, and bandwidth kept leaving the VPS.
    expect(sinalizacao.pausados).toEqual(["c-p-ecra"])
    // And the stage closes: there is no screen stream to draw.
    expect(motor.fluxos().find((cada) => cada.address === OUTRO)?.ecra ?? null).toBeNull()
    // And we did NOT consume again or close anything: the consumer is the same one.
    expect(diario.passos.filter((passo) => passo === "consume:p-ecra")).toHaveLength(1)
  })

  it("ver outra vez RETOMA o mesmo consumidor, sem o consumir de novo", async () => {
    /*
      The second win from pausing instead of closing, measured here: the object
      stayed, with decryption already installed on the receiver, so the next "Watch"
      is one round trip to the server instead of two. Closing forced re-consumption,
      and it was the close that left the consumer leaked.
    */
    const aceites: UserAddress[] = [OUTRO]
    const { motor, sinalizacao, diario } = montar(aceites)
    sinalizacao.produtoresIniciais = [{ id: "p-ecra", kind: "video", address: OUTRO, fonte: "ecra" }]
    sinalizacao.tipoDoConsumo.set("p-ecra", "video")
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    aceites.length = 0
    await motor.largarEcraDe(OUTRO)
    aceites.push(OUTRO)
    const consumosAntes = diario.passos.filter((passo) => passo === "consume:p-ecra").length

    await motor.consumirOfertasDe(OUTRO)

    expect(diario.passos.filter((passo) => passo === "consume:p-ecra")).toHaveLength(consumosAntes)
    expect(sinalizacao.retomados.filter((quem) => quem === "c-p-ecra")).toHaveLength(2)
    // And the image returns to the stage: the track is the SAME one, because
    // `#tirarDoFluxo` only removed it from `MediaStream` and never stopped it.
    expect(motor.fluxos().find((cada) => cada.address === OUTRO)?.ecra?.getTracks()).toHaveLength(1)
  })

  /**
   * The race on the RESUME side, symmetric to the one `#umConsumo` already
   * covered.
   *
   * "Stop watching" runs inside the `sfu.resume` loop: the flow is
   * `resume` → `pause`, the server is paused, and the next line in
   * `#retomarEcra` wrote `pausado: false` over it, the stage returned while
   * the valve was closed. Still rectangle, no image arriving, and "Stop watching"
   * inert: `recusarEcra` fires first when the choice's `delete` returns `false`,
   * and it had already been deleted. Dead end.
   *
   * Reachable with two shares of the same account on two devices, see the test
   * in the second half below. Here we measure the second half of `#retomarEcra`.
   */
  it('uma retomada que aterra depois do "Parar de ver" não devolve a faixa ao palco', async () => {
    const aceites: UserAddress[] = [OUTRO]
    const { motor, sinalizacao } = montar(aceites)
    // Voice goes on purpose: it is what keeps the person in `fluxos()`, so the
    // assertion can say "the stage is closed" instead of "the person vanished".
    sinalizacao.produtoresIniciais = [
      { id: "p-voz", kind: "audio", address: OUTRO, fonte: "microfone" },
      { id: "p-ecra", kind: "video", address: OUTRO, fonte: "ecra" },
    ]
    sinalizacao.tipoDoConsumo.set("p-ecra", "video")
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    aceites.length = 0
    await motor.largarEcraDe(OUTRO)
    aceites.push(OUTRO)

    // Inside the `sfu.resume` loop, the choice undoes itself and the server is
    // told to pause. After this the resume lands.
    const retomarOriginal = sinalizacao.sfuRetomar.bind(sinalizacao)
    sinalizacao.sfuRetomar = async (transporte: string, consumidor: string): Promise<void> => {
      await retomarOriginal(transporte, consumidor)
      if (consumidor !== "c-p-ecra") return
      sinalizacao.sfuRetomar = retomarOriginal
      aceites.length = 0
      await motor.largarEcraDe(OUTRO)
    }

    await motor.consumirOfertasDe(OUTRO)

    // The line that matters. Without re-reading, there was a track here.
    expect(motor.fluxos().find((cada) => cada.address === OUTRO)?.ecra ?? null).toBeNull()

    // And the offer returned to the list: the next "Watch" needs something to
    // accept, or the stage stays closed and there is nothing to tap.
    aceites.push(OUTRO)
    await motor.consumirOfertasDe(OUTRO)
    expect(motor.fluxos().find((cada) => cada.address === OUTRO)?.ecra?.getTracks()).toHaveLength(1)
  })

  it("e uma retomada que aterra depois de sair não escreve na chamada seguinte", async () => {
    // The generation, for the usual reason: between request and response there is
    // room for an exit. Without it, `exit` cleaned everything and resume put back
    // a stream for someone no longer in any call.
    const aceites: UserAddress[] = [OUTRO]
    const { motor, sinalizacao } = montar(aceites)
    sinalizacao.produtoresIniciais = [{ id: "p-ecra", kind: "video", address: OUTRO, fonte: "ecra" }]
    sinalizacao.tipoDoConsumo.set("p-ecra", "video")
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    aceites.length = 0
    await motor.largarEcraDe(OUTRO)
    aceites.push(OUTRO)

    const retomarOriginal = sinalizacao.sfuRetomar.bind(sinalizacao)
    sinalizacao.sfuRetomar = async (transporte: string, consumidor: string): Promise<void> => {
      await retomarOriginal(transporte, consumidor)
      sinalizacao.sfuRetomar = retomarOriginal
      motor.sair()
    }

    await motor.consumirOfertasDe(OUTRO)

    expect(motor.fluxos()).toEqual([])
  })

  /**
   * The second half, and this is what makes the race reachable today.
   *
   * Two shares of the SAME account, two devices logged into the same account,
   * which is how rosters index them. `largarEcraDe` pauses one at a time, and
   * between pausing one and the other there is room for a "Watch": the second
   * pause came AFTER the resume, and closed on the server the valve the person
   * just reopened.
   */
  it('pausar a segunda partilha salta o que um "Ver" pelo meio já retomou', async () => {
    const aceites: UserAddress[] = [OUTRO]
    const { motor, sinalizacao } = montar(aceites)
    sinalizacao.produtoresIniciais = [
      { id: "p-ecra-1", kind: "video", address: OUTRO, fonte: "ecra" },
      { id: "p-ecra-2", kind: "video", address: OUTRO, fonte: "ecra" },
    ]
    sinalizacao.tipoDoConsumo.set("p-ecra-1", "video")
    sinalizacao.tipoDoConsumo.set("p-ecra-2", "video")
    await motor.entrar("#c:s", "a".repeat(43), faixa())
    expect(motor.fluxos().find((cada) => cada.address === OUTRO)?.ecra?.getTracks()).toHaveLength(2)

    // Between the first pause and the second, the person taps "Watch".
    const pausarOriginal = sinalizacao.sfuPausar.bind(sinalizacao)
    sinalizacao.sfuPausar = async (transporte: string, consumidor: string): Promise<void> => {
      await pausarOriginal(transporte, consumidor)
      if (consumidor !== "c-p-ecra-1") return
      aceites.push(OUTRO)
      await motor.consumirOfertasDe(OUTRO)
    }

    aceites.length = 0
    await motor.largarEcraDe(OUTRO)

    // The line that matters: the second was not paused, because it had already
    // been resumed by a more recent request than this one.
    expect(sinalizacao.pausados).toEqual(["c-p-ecra-1"])
    // And both tracks are on the stage, which is the state the last gesture asked for.
    expect(motor.fluxos().find((cada) => cada.address === OUTRO)?.ecra?.getTracks()).toHaveLength(2)
  })

  it("se a pausa falhar, o palco fecha na mesma e o registo di-lo", async () => {
    /*
      The order is on purpose: the person's gesture first, the frame after.
      Whoever taps "Stop watching" must see the image disappear instantly, not
      after a round trip to the server that might not even arrive. What we lose
      when the frame fails is bandwidth savings, and that is recorded, because
      it is the kind of thing you only discover on the invoice.
    */
    const aceites: UserAddress[] = [OUTRO]
    const { motor, sinalizacao, diagnosticos } = montar(aceites)
    sinalizacao.produtoresIniciais = [{ id: "p-ecra", kind: "video", address: OUTRO, fonte: "ecra" }]
    sinalizacao.tipoDoConsumo.set("p-ecra", "video")
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    sinalizacao.falharPausaDe = "c-p-ecra"
    aceites.length = 0
    await motor.largarEcraDe(OUTRO)

    expect(motor.fluxos().find((cada) => cada.address === OUTRO)?.ecra ?? null).toBeNull()
    expect(diagnosticos.map((cada) => cada.code)).toContain("sfu-ecra-nao-pausou")
  })

  /**
   * The race that guarding it in one place let through.
   *
   * Accepted, `sfu.consume` fails by network accident, retry scheduled for one
   * second later. In that second I tap "Stop watching", and `largarEcraDe` finds
   * no consumer to pause, because it does not exist yet, so it does nothing.
   * The retry wakes and installs the consumer: the stage opens, 2.5 Mbps flow in,
   * and my own `aVer` says I am not watching. The guard must be re-read on every
   * attempt.
   */
  it("uma repetição de consumo relê a escolha, e não instala o que já se recusou", async () => {
    vi.useFakeTimers()
    try {
      const aceites: UserAddress[] = [OUTRO]
      const { motor, sinalizacao, diario } = montar(aceites)
      sinalizacao.tipoDoConsumo.set("p-ecra", "video")
      await motor.entrar("#c:s", "a".repeat(43), faixa())

      // The first consumption stumbles on the network, and a stumble, unlike a
      // refusal, retries.
      sinalizacao.falharConsumoDeComErro = "p-ecra"
      await motor.produtorNovo("#c:s", "a".repeat(43), "p-ecra", OUTRO, "ecra")
      expect(diario.passos).not.toContain("consume:p-ecra")

      // Between the failure and the retry, the person taps "Stop watching".
      sinalizacao.falharConsumoDeComErro = null
      aceites.length = 0
      await motor.largarEcraDe(OUTRO)

      // The retry wakes. Without re-reading the guard, the stage would open here.
      await vi.advanceTimersByTimeAsync(MotorSfu.ESPERAS_DO_CONSUMO_MS[0]! + 10)

      expect(diario.passos).not.toContain("consume:p-ecra")
      expect(motor.fluxos().find((cada) => cada.address === OUTRO)?.ecra ?? null).toBeNull()

      // And the offer returned to the list: a "Watch" after this must work, which
      // shows that the brake on `#aConsumir` also lifted.
      aceites.push(OUTRO)
      await motor.consumirOfertasDe(OUTRO)
      expect(diario.passos).toContain("consume:p-ecra")
    } finally {
      vi.useRealTimers()
    }
  })

  it("uma partilha que acaba antes de alguém aceitar deixa de se oferecer", async () => {
    // Without this there would be a "Watch" in the menu that led nowhere: `#consumir`
    // refuses a dead producer, silently.
    const aceites: UserAddress[] = []
    const { motor, sinalizacao, diario } = montar(aceites)
    sinalizacao.produtoresIniciais = [{ id: "p-ecra", kind: "video", address: OUTRO, fonte: "ecra" }]
    sinalizacao.tipoDoConsumo.set("p-ecra", "video")
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    motor.produtorFechado("p-ecra")

    aceites.push(OUTRO)
    await motor.consumirOfertasDe(OUTRO)
    expect(diario.passos).not.toContain("consume:p-ecra")
  })

  it("sair leva as ofertas consigo", async () => {
    const aceites: UserAddress[] = []
    const { motor, sinalizacao, diario } = montar(aceites)
    sinalizacao.produtoresIniciais = [{ id: "p-ecra", kind: "video", address: OUTRO, fonte: "ecra" }]
    sinalizacao.tipoDoConsumo.set("p-ecra", "video")
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    motor.sair()

    // An offer that survived would offer, on the next call, the screen of someone
    // no longer there.
    aceites.push(OUTRO)
    await motor.consumirOfertasDe(OUTRO)
    expect(diario.passos).not.toContain("consume:p-ecra")
  })
})

/**
 * Resolution stepping down, silently.
 *
 * The browser lowers the image on its own when upload capacity runs short, and
 * says so in `qualityLimitationReason` on `outbound-rtp`. The product did not
 * read that field: a person on a bad network appeared to others at 360p with
 * the menu showing 720p, and what they concluded was that the product is poor.
 * Measured in `scripts/sfu-prova-720p/`, where the field was first read and where
 * it is noted that no one in the product saw it.
 *
 * What this block pins is the reading: only the two reasons told to someone,
 * network ahead of processor, height as absence when there is no height, and
 * video separate from audio.
 */
describe("a imagem que sai cortada", () => {
  it("lê a razão e a altura do emissor da câmara", async () => {
    const { motor, dispositivo } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa(), faixa("video"))

    dispositivo.transportes[0]!.estatisticasDoEmissor.set("camara", [
      { type: "outbound-rtp", kind: "video", qualityLimitationReason: "bandwidth", frameHeight: 540 },
    ])

    expect(await motor.limiteDeVideo()).toEqual({ razao: "bandwidth", altura: 540 })
  })

  it("ignora `none` e `other`: só se diz o que a pessoa pode mudar", async () => {
    const { motor, dispositivo } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa(), faixa("video"))
    const emissores = dispositivo.transportes[0]!.estatisticasDoEmissor

    // `none` is the image going out whole. Saying "your image stepped down for no
    // reason" is noise in the shape of a warning.
    emissores.set("camara", [{ type: "outbound-rtp", qualityLimitationReason: "none", frameHeight: 720 }])
    expect(await motor.limiteDeVideo()).toBeNull()

    // `other` is the browser saying it does not know. There is no gesture on the
    // other side of that statement, and a warning without gesture is worse than silence.
    emissores.set("camara", [{ type: "outbound-rtp", qualityLimitationReason: "other", frameHeight: 360 }])
    expect(await motor.limiteDeVideo()).toBeNull()
  })

  it("a rede ganha ao processador quando as duas fontes se queixam", async () => {
    const { motor, dispositivo } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa(), faixa("video"))
    await motor.partilharEcra(faixa("video"))
    const emissores = dispositivo.transportes[0]!.estatisticasDoEmissor

    emissores.set("camara", [{ type: "outbound-rtp", qualityLimitationReason: "cpu", frameHeight: 360 }])
    emissores.set("ecra", [{ type: "outbound-rtp", qualityLimitationReason: "bandwidth", frameHeight: 540 }])

    // They are two encoders complaining about different things, and what we draw
    // is one. Network is what the product knows how to explain and what the person
    // can change; closing a tab returns no bandwidth.
    expect(await motor.limiteDeVideo()).toEqual({ razao: "bandwidth", altura: 540 })
  })

  it("e ganha-lhe também dentro do MESMO relatório", async () => {
    const { motor, dispositivo } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa(), faixa("video"))

    /*
      Two `outbound-rtp` lines in one report, with the processor one first.
      
      This is not a made-up case: it is how an `RTCPeerConnection.getStats()`
      report appears in the mesh, where the same connection carries both streams,
      and it will be how a sender with simulcast looks when it exists. A mutation
      that removed preference here would still pass the test of two sources, there
      the `limiteDeVideo` loop decides, not this line. It is the class of bug where
      two guards say the same thing and only one is measured.
      */
    dispositivo.transportes[0]!.estatisticasDoEmissor.set("camara", [
      { type: "outbound-rtp", kind: "video", qualityLimitationReason: "cpu", frameHeight: 360 },
      { type: "outbound-rtp", kind: "video", qualityLimitationReason: "bandwidth", frameHeight: 540 },
    ])

    expect(await motor.limiteDeVideo()).toEqual({ razao: "bandwidth", altura: 540 })
  })

  it("não confunde a linha do áudio com a do vídeo", async () => {
    const { motor, dispositivo } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa(), faixa("video"))

    dispositivo.transportes[0]!.estatisticasDoEmissor.set("camara", [
      // An `outbound-rtp` for audio never has quality limitation, but nothing stops
      // a browser from putting the field there. Without the `kind` guard, voice
      // lit the image warning.
      { type: "outbound-rtp", kind: "audio", qualityLimitationReason: "bandwidth", frameHeight: 0 },
      { type: "inbound-rtp", kind: "video", qualityLimitationReason: "bandwidth", frameHeight: 180 },
    ])

    expect(await motor.limiteDeVideo()).toBeNull()
  })

  it("uma altura que o browser ainda não declarou vale zero, e não uma medida", async () => {
    const { motor, dispositivo } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa(), faixa("video"))

    dispositivo.transportes[0]!.estatisticasDoEmissor.set("camara", [
      { type: "outbound-rtp", kind: "video", qualityLimitationReason: "bandwidth" },
    ])

    // Zero is absence, and whoever draws must know: "0 lines" is a lie in the shape
    // of a number, and the reason alone already earns the sentence.
    expect(await motor.limiteDeVideo()).toEqual({ razao: "bandwidth", altura: 0 })
  })

  it("sem imagem a sair não há nada a dizer, e um emissor por estrear não rebenta", async () => {
    const { motor } = montar()

    // Voice only: there is no camera or screen producer, so there is no one to ask.
    await motor.entrar("#c:s", "a".repeat(43), faixa())
    expect(await motor.limiteDeVideo()).toBeNull()

    // And with camera but without a single report, the sender just born, the state
    // of the first seconds of all video calls. The double throws, like a `getStats()`
    // that fails, and reading must swallow it.
    const outro = montar()
    await outro.motor.entrar("#c:s", "a".repeat(43), faixa(), faixa("video"))
    expect(await outro.motor.limiteDeVideo()).toBeNull()
  })
})

/**
 * Screen audio over SFU: the defect of 26 October 2026.
 *
 * "Screen shares are not transmitting audio." On this side the engine only knew
 * how to produce the IMAGE of the screen: `partilharEcra(faixa)` received a video
 * track and nothing else. These tests fail with the earlier engine.
 */
describe("o som do ecrã", () => {
  it("vai como produtor PRÓPRIO, com a fonte ecra e o kind áudio, depois da imagem", async () => {
    const { motor, sinalizacao } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    expect(await motor.partilharEcra(faixa("video"), faixa("audio"))).toBe(true)

    expect(sinalizacao.produzidos).toEqual([
      { transport: "t-envio", kind: "audio", fonte: "microfone" },
      { transport: "t-envio", kind: "video", fonte: "ecra" },
      { transport: "t-envio", kind: "audio", fonte: "ecra" },
    ])
    expect(motor.aEnviarSomDoEcra).toBe(true)
  })

  it("em Opus estéreo a 64 kbps, e não com as opções da voz", async () => {
    const { motor, dispositivo } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())
    await motor.partilharEcra(faixa("video"), faixa("audio"))

    const opcoes = dispositivo.transportes[0]!.opcoesDeCodec
    // The first is from the microphone; the last is from screen audio.
    expect(opcoes.at(-1)).toEqual({ ...OPCOES_DO_SOM_DO_ECRA })
    expect(opcoes.at(-1)).toMatchObject({ opusStereo: true, opusMaxAverageBitrate: TECTO_DO_SOM_DO_ECRA })
  })

  it("conta dentro do tecto do ecrã: a imagem desce os 64 kbps do som", async () => {
    const { motor, dispositivo } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())
    await motor.partilharEcra(faixa("video"), faixa("audio"))

    expect(dispositivo.transportes[0]!.codificacoes).toEqual([[{ maxBitrate: TECTO_DO_ECRA - TECTO_DO_SOM_DO_ECRA }]])
  })

  it("sem som, a imagem fica com o tecto inteiro, como antes", async () => {
    const { motor, dispositivo, sinalizacao } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())
    await motor.partilharEcra(faixa("video"))

    expect(dispositivo.transportes[0]!.codificacoes).toEqual([[{ maxBitrate: TECTO_DO_ECRA }]])
    expect(sinalizacao.produzidos.filter((cada) => cada.fonte === "ecra")).toHaveLength(1)
    expect(motor.aEnviarSomDoEcra).toBe(false)
  })

  it("é cifrado como a voz", async () => {
    const { motor, diario } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())
    await motor.partilharEcra(faixa("video"), faixa("audio"))

    // Two senders with screen source, both with encryption pending.
    expect(diario.passos.filter((passo) => passo === "cifra-instalada:emissor:ecra")).toHaveLength(2)
  })

  it("um servidor antigo que o recuse não desfaz a partilha: a imagem segue, e fica dito", async () => {
    const { motor, sinalizacao, diagnosticos } = montar()
    sinalizacao.recusarSomDoEcra = true
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    expect(await motor.partilharEcra(faixa("video"), faixa("audio"))).toBe(true)
    expect(motor.aPartilharEcra).toBe(true)
    expect(motor.aEnviarSomDoEcra).toBe(false)
    expect(diagnosticos.map((cada) => cada.code)).toContain("sfu-ecra-som-recusado")
  })

  it("parar de partilhar fecha o som E a imagem, no servidor e cá", async () => {
    const { motor, sinalizacao, dispositivo } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())
    await motor.partilharEcra(faixa("video"), faixa("audio"))

    await motor.pararEcra()

    expect(sinalizacao.fechados).toEqual(["produtor-ecra-som", "produtor-ecra"])
    const doEcra = dispositivo.transportes[0]!.produtores.filter((cada) => cada.fonte === "ecra")
    expect(doEcra.every((cada) => cada.fechado)).toBe(true)
    expect(motor.aEnviarSomDoEcra).toBe(false)
  })

  it("parar a meio do produce do som: o som que chega tarde fecha-se, cá e no servidor", async () => {
    const { motor, sinalizacao, dispositivo } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())
    let abrir: () => void = () => {}
    sinalizacao.travaDoSomDoEcra = new Promise<void>((resolver) => (abrir = resolver))

    const partilha = motor.partilharEcra(faixa("video"), faixa("audio"))
    // The image is already out; the sound waits for the server.
    await new Promise((resolver) => setTimeout(resolver, 0))
    await motor.pararEcra()
    abrir()
    await partilha

    expect(motor.aPartilharEcra).toBe(false)
    expect(motor.aEnviarSomDoEcra).toBe(false)
    expect(sinalizacao.fechados).toEqual(["produtor-ecra", "produtor-ecra-som"])
    const doEcra = dispositivo.transportes[0]!.produtores.filter((cada) => cada.fonte === "ecra")
    expect(doEcra).toHaveLength(2)
    expect(doEcra.every((cada) => cada.fechado)).toBe(true)
  })

  /**
   * Compatibility: what a 0.7.2 or 0.8.0 client does with screen audio.
   *
   * The RECEIVE path did not change in this fix, and that is why this test
   * speaks for old clients: the producer has source `ecra`, so (1) it only
   * consumes after "Watch", (2) it goes to the SCREEN stream not to the
   * person's card (their voice is not played), and (3) "Stop watching" pauses
   * it with the image. On an old client the stage has `<video muted>`: the sound
   * reaches the stream and does not play. Nothing breaks; it just goes unheard.
   */
  it('quem recebe põe o som no fluxo do ecrã, atrás do "Ver", e o "Parar de ver" pausa-o', async () => {
    const aceites: UserAddress[] = []
    const montagem = montar(aceites)
    const { motor, sinalizacao } = montagem
    sinalizacao.produtoresIniciais = [
      { id: "p-voz", kind: "audio", address: OUTRO, fonte: "microfone" },
      { id: "p-ecra", kind: "video", address: OUTRO, fonte: "ecra" },
      { id: "p-ecra-som", kind: "audio", address: OUTRO, fonte: "ecra" },
    ]
    sinalizacao.tipoDoConsumo.set("p-ecra", "video")
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    // (1) Without "Watch", neither image nor sound consume.
    expect(sinalizacao.retomados).toEqual(["c-p-voz"])
    expect(motor.fluxos()[0]!.ecra).toBeNull()

    aceites.push(OUTRO)
    await motor.consumirOfertasDe(OUTRO)

    // (2) Audio goes with the image, to the stage; voice stays alone on the card.
    const [fluxo] = motor.fluxos()
    expect(fluxo!.stream.getTracks().map((cada) => cada.id)).toEqual(["faixa-p-voz"])
    expect(fluxo!.ecra?.getTracks().map((cada) => cada.kind).sort()).toEqual(["audio", "video"])

    // (3) "Stop watching" pauses both on the server.
    aceites.length = 0
    await motor.largarEcraDe(OUTRO)
    expect(sinalizacao.pausados.sort()).toEqual(["c-p-ecra", "c-p-ecra-som"])
    expect(motor.fluxos()[0]!.ecra).toBeNull()
  })
})

/**
 * The person whose key arrives after consumption starts (owner report, November 3, 2026).
 *
 * Her consumption assembles before this device has her sheet in the channel tree.
 * Before this, the receiver had no decryption, the server opened the tap, the
 * flow entered what you hear, and the person appeared "connected" with encrypted
 * frames reaching the decoder. The key arrived in the next commit and nothing
 * ever hung decryption again: silent until she leaves and comes back.
 */
describe("o fluxo de quem ainda não tem chave", () => {
  it("fica parado e fora do que se ouve, e abre quando a chave chega", async () => {
    const { motor, sinalizacao, diario, diagnosticos, chaves } = montar()
    sinalizacao.produtoresIniciais = [{ id: "p-voz", kind: "audio", address: OUTRO, fonte: "microfone" }]
    chaves.set(OUTRO, null)

    await motor.entrar("#c:s", "a".repeat(43), faixa())

    // Listed in the log by the right name, and nothing moving: no decryption hanging,
    // no tap open on the server, and no flow making the person "connected".
    expect(diagnosticos.map((cada) => cada.code)).toContain("sfu-receptor-sem-chave")
    expect(diario.passos).not.toContain("cifra-instalada:p-voz")
    expect(sinalizacao.retomados).not.toContain("c-p-voz")
    expect(motor.fluxos()).toEqual([])
    // But she stays among those being heard, so rotation can fetch her key.
    expect(motor.emissores()).toEqual([OUTRO])

    // The commit that seats her arrives: rotation runs and setup completes.
    chaves.set(OUTRO, material(2))
    expect(await motor.protegerOsSemChave()).toBe(1)

    expect(diario.indice("cifra-instalada:p-voz")).toBeGreaterThan(-1)
    expect(diario.indice("cifra-instalada:p-voz")).toBeLessThan(diario.indice("resume:c-p-voz"))
    expect(sinalizacao.retomados).toContain("c-p-voz")
    expect(motor.fluxos().map((cada) => [cada.address, cada.encrypted])).toEqual([[OUTRO, true]])
    expect(diagnosticos.map((cada) => cada.code)).toContain("sfu-receptor-protegido-depois")
    // A second pass does nothing: no one is waiting anymore.
    expect(await motor.protegerOsSemChave()).toBe(0)
  })

  it("sem chave ainda, a passagem não abre nada", async () => {
    const { motor, sinalizacao, chaves } = montar()
    sinalizacao.produtoresIniciais = [{ id: "p-voz", kind: "audio", address: OUTRO, fonte: "microfone" }]
    chaves.set(OUTRO, null)
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    expect(await motor.protegerOsSemChave()).toBe(0)
    expect(sinalizacao.retomados).not.toContain("c-p-voz")
    expect(motor.fluxos()).toEqual([])
  })
})

/**
 * A failed cipher tries again (4/11/2026).
 *
 * Owner: "I stopped hearing a user. Looks like Orwell stopped capturing my mic. I left and came
 * back and it fixed." And the order: "If the cipher fails, it has to try again." Until 1.3.0
 * the first sender cipher failure was final: the microphone made the entry fail with 448, and
 * other sources fell. Now each source repeats setup with growing waits, wakes up earlier when
 * the epoch changes, and only gives up at the cap. At no point does a producer come up without
 * the cipher attached: each attempt is a full `#produzir`.
 */
describe("uma cifra que falha tenta outra vez", () => {
  const MENSAGEM = "the call media could not be encrypted"
  const codigos = (diagnosticos: { code: string }[]): string[] => diagnosticos.map((cada) => cada.code)

  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("a voz sem chave não derruba a entrada, e publica cifrada quando a chave chega, sem a pessoa fazer nada", async () => {
    const { motor, diario, dispositivo, chaves, diagnosticos, vozPerdida, sinalizacao } = montar()
    sinalizacao.produtoresIniciais = [{ id: "p-outro", kind: "audio", address: OUTRO }]
    chaves.set(EU, null)

    await motor.entrar("#c:s", "a".repeat(43), faixa())
    // The call is up and you hear who is there; our voice has not sent yet.
    expect(motor.fluxos()).toHaveLength(1)
    expect(diario.passos).not.toContain("produce:microfone")
    expect(codigos(diagnosticos)).toContain("sfu-emissor-cifra-a-repetir")

    // First wait (0.5 s) without key: try, fail, wait longer.
    await vi.advanceTimersByTimeAsync(MotorSfu.ESPERAS_DA_CIFRA_MS[0]!)
    expect(diario.passos).not.toContain("produce:microfone")

    chaves.set(EU, material(1))
    await vi.advanceTimersByTimeAsync(MotorSfu.ESPERAS_DA_CIFRA_MS[1]!)

    expect(diario.indice("cifra-instalada:emissor:microfone")).toBeLessThan(diario.indice("produce:microfone"))
    expect(diario.passos.filter((passo) => passo.endsWith(":EM-CLARO"))).toEqual([])
    expect(dispositivo.desprotegidosActivos()).toEqual([])
    expect(codigos(diagnosticos)).toContain("sfu-emissor-cifra-recuperada")
    expect(vozPerdida).toEqual([])
  })

  it("a mudança de epoch acorda a espera: a voz sai logo, sem esperar pelo relógio", async () => {
    const { motor, diario, chaves } = montar()
    chaves.set(EU, null)
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    chaves.set(EU, material(1))
    motor.cifraPodeTerMudado()
    // Microtasks only: no clock moved.
    await vi.advanceTimersByTimeAsync(0)

    expect(diario.passos).toContain("produce:microfone")
  })

  it("a plataforma que recusa duas vezes e aceita à terceira: dois produtores fechados, o terceiro cifrado", async () => {
    const { motor, dispositivo, sinalizacao, diario, vozPerdida } = montar()
    let recusas = 0
    dispositivo.recusarCifraDe.add("microfone")
    const criar = dispositivo.createSendTransport.bind(dispositivo)
    dispositivo.createSendTransport = (opcoes) => {
      const transporte = criar(opcoes) as TransporteFalso
      const original = transporte.produce.bind(transporte)
      transporte.produce = async (op) => {
        const produtor = await original(op)
        if (String(op.appData?.["fonte"]) === "microfone" && ++recusas === 2) transporte.recusarCifraDe.delete("microfone")
        return produtor
      }
      return transporte
    }

    await motor.entrar("#c:s", "a".repeat(43), faixa())
    await vi.advanceTimersByTimeAsync(MotorSfu.ESPERAS_DA_CIFRA_MS[0]! + MotorSfu.ESPERAS_DA_CIFRA_MS[1]!)

    expect(sinalizacao.fechados.filter((id) => id === "produtor-microfone")).toHaveLength(2)
    expect(diario.passos.filter((passo) => passo === "rtp:microfone:sframe")).toHaveLength(1)
    expect(diario.passos.filter((passo) => passo.endsWith(":EM-CLARO"))).toEqual([])
    expect(dispositivo.desprotegidosActivos()).toEqual([])
    expect(vozPerdida).toEqual([])
  })

  it("só no tecto a voz desiste, com o 448, e nada ficou no ar sem cifra", async () => {
    const { motor, chaves, diagnosticos, vozPerdida, dispositivo, diario } = montar()
    chaves.set(EU, null)
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    const total = MotorSfu.ESPERAS_DA_CIFRA_MS.reduce((soma, espera) => soma + espera, 0)
    await vi.advanceTimersByTimeAsync(total - 1)
    expect(vozPerdida).toEqual([])
    await vi.advanceTimersByTimeAsync(1)

    expect(vozPerdida.map((erro) => erro.message)).toEqual([MENSAGEM])
    expect(codigos(diagnosticos).filter((codigo) => codigo === "sfu-emissor-cifra-a-repetir")).toHaveLength(
      MotorSfu.ESPERAS_DA_CIFRA_MS.length,
    )
    expect(codigos(diagnosticos)).toContain("sfu-emissor-cifra-desistiu")
    expect(diario.passos).not.toContain("produce:microfone")
    expect(dispositivo.desprotegidosActivos()).toEqual([])
  })

  it("sair a meio das tentativas larga-as: nada é produzido depois, e ninguém desiste em nome de uma chamada que acabou", async () => {
    const { motor, chaves, vozPerdida, diario } = montar()
    chaves.set(EU, null)
    await motor.entrar("#c:s", "a".repeat(43), faixa())
    motor.sair()
    chaves.set(EU, material(1))
    await vi.advanceTimersByTimeAsync(60_000)

    expect(diario.passos).not.toContain("produce:microfone")
    expect(vozPerdida).toEqual([])
  })

  it("a câmara, o ecrã e a música também tentam outra vez", async () => {
    const { motor, chaves, diario, recusas, dispositivo } = montar()
    chaves.set(EU, null)
    await motor.entrar("#c:s", "a".repeat(43), faixa(), faixa("video"))
    const ecra = motor.partilharEcra(faixa("video"))
    const musica = motor.partilharMusica(faixa())

    chaves.set(EU, material(1))
    motor.cifraPodeTerMudado()
    await vi.advanceTimersByTimeAsync(0)

    await expect(ecra).resolves.toBe(true)
    await expect(musica).resolves.toBe(true)
    for (const fonte of ["microfone", "camara", "ecra", "musica"]) {
      expect(diario.indice(`cifra-instalada:emissor:${fonte}`)).toBeLessThan(diario.indice(`produce:${fonte}`))
    }
    expect(motor.aPartilharEcra).toBe(true)
    expect(motor.aTocarMusica).toBe(true)
    expect(recusas).toEqual([])
    expect(dispositivo.desprotegidosActivos()).toEqual([])
  })

  it("e o ecrã só falha com o 448 quando as tentativas acabam", async () => {
    const { motor, dispositivo } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())
    dispositivo.recusarCifraDe.add("ecra")

    const ecra = motor.partilharEcra(faixa("video"))
    const resultado = expect(ecra).rejects.toThrow(MENSAGEM)
    await vi.advanceTimersByTimeAsync(MotorSfu.ESPERAS_DA_CIFRA_MS.reduce((soma, espera) => soma + espera, 0))
    await resultado
    expect(motor.aPartilharEcra).toBe(false)
    expect(dispositivo.desprotegidosActivos()).toEqual([])
  })

  it("um fluxo recebido sem decifra tenta outra vez pelo relógio, sem esperar por um commit", async () => {
    const { motor, sinalizacao, chaves, diagnosticos } = montar()
    sinalizacao.produtoresIniciais = [{ id: "p-outro", kind: "audio", address: OUTRO }]
    chaves.set(OUTRO, null)
    await motor.entrar("#c:s", "a".repeat(43), faixa())
    expect(motor.fluxos()).toHaveLength(0)
    expect(sinalizacao.retomados).not.toContain("c-p-outro")

    chaves.set(OUTRO, material(2))
    await vi.advanceTimersByTimeAsync(MotorSfu.ESPERAS_DA_CIFRA_MS[0]!)

    expect(motor.fluxos().map((fluxo) => fluxo.address)).toEqual([OUTRO])
    expect(sinalizacao.retomados).toContain("c-p-outro")
    expect(codigos(diagnosticos)).toContain("sfu-receptor-protegido-depois")
  })

  it("e também pelo commit, como desde a 1.1.1", async () => {
    const { motor, sinalizacao, chaves, cifra } = montar()
    sinalizacao.produtoresIniciais = [{ id: "p-outro", kind: "audio", address: OUTRO }]
    chaves.set(OUTRO, null)
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    chaves.set(OUTRO, material(2))
    await cifra.rodar(motor.emissores())
    await motor.protegerOsSemChave()

    expect(motor.fluxos().map((fluxo) => fluxo.address)).toEqual([OUTRO])
  })
})

/**
 * Swapping voice track on the SAME sender: mic recovery (4/11/2026).
 *
 * The cipher hangs on the sender, not the track. Swapping the track does not ask
 * for encoded flows again (Chromium threw `InvalidStateError`), does not create
 * a producer, and the new track leaves through the same transform.
 */
describe("trocar a faixa do microfone", () => {
  it("entra no mesmo emissor, já cifrado, sem produtor novo", async () => {
    const { motor, diario, sinalizacao } = montar()
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    await expect(motor.trocarFaixaDoMicrofone(faixa())).resolves.toBe(true)

    expect(diario.passos).toContain("faixa-trocada:emissor:microfone:sframe")
    expect(diario.passos.filter((passo) => passo === "cifra-instalada:emissor:microfone")).toHaveLength(1)
    expect(sinalizacao.produzidos).toHaveLength(1)
  })

  it("com a voz ainda à espera da cifra, a faixa nova é a que a próxima tentativa publica", async () => {
    vi.useFakeTimers()
    try {
      const { motor, chaves, dispositivo } = montar()
      chaves.set(EU, null)
      const velha = faixa()
      await motor.entrar("#c:s", "a".repeat(43), velha)
      const nova = faixa()
      await motor.trocarFaixaDoMicrofone(nova)

      chaves.set(EU, material(1))
      motor.cifraPodeTerMudado()
      await vi.advanceTimersByTimeAsync(0)

      const produzido = dispositivo.transportes[0]!.produtores.find((produtor) => produtor.fonte === "microfone")
      expect(produzido).toBeDefined()
      expect(dispositivo.transportes[0]!.faixas.get("microfone")).toBe(nova)
    } finally {
      vi.useRealTimers()
    }
  })
})

/**
 * Send that never connects (owner report 4/11/2026, 14:14 to 14:16 UTC).
 *
 * Room, another room and room again in ~3 s: "sound passes but does not reach the
 * other user", and the log has no sender line. The case did not reproduce live on
 * localhost (`scripts/e2e-troca-de-sala.mjs`). The only fault matching such a log
 * is a send transport that never reaches `connected`: the producer exists on the
 * server, the cipher hangs, the mic measures here, and no packet leaves. Until now
 * the engine only said `failed` and `closed`, and a transport stuck in `connecting`
 * left no trace. Now it says so (`sfu-envio-sem-ligacao`) and `Call` redoes media.
 */
describe("o envio que não liga", () => {
  function comDtls(montagem: Montagem, estado: { state: string }): { mudar: (novo: string) => void } {
    const ouvintes: (() => void)[] = []
    const dtls = {
      get state() {
        return estado.state
      },
      iceTransport: { state: "checking", addEventListener: () => {} },
      addEventListener: (_tipo: string, ouvinte: () => void) => ouvintes.push(ouvinte),
    }
    const criar = montagem.dispositivo.createSendTransport.bind(montagem.dispositivo)
    montagem.dispositivo.createSendTransport = (opcoes) => {
      const transporte = criar(opcoes) as TransporteFalso
      const original = transporte.produce.bind(transporte)
      transporte.produce = async (op) => {
        const produtor = await original(op)
        Object.assign(produtor.rtpSender as object, { transport: dtls })
        return produtor
      }
      return transporte
    }
    return {
      mudar: (novo) => {
        estado.state = novo
        for (const ouvinte of ouvintes) ouvinte()
      },
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("preso em connecting: ao fim do prazo diz-se, com os estados, e pede-se que se refaça", async () => {
    const montagem = montar()
    const paradas: number[] = []
    const motor = new MotorSfu({
      sinalizacao: montagem.sinalizacao,
      cifra: montagem.cifra,
      criarDispositivo: () => montagem.dispositivo,
      aoDiagnosticar: (code, detail) => montagem.diagnosticos.push(detail === undefined ? { code } : { code, detail }),
      aoMudar: () => {},
      verOEcraDe: () => false,
      aoEnvioParado: () => paradas.push(Date.now()),
    })
    comDtls(montagem, { state: "connecting" })
    await motor.entrar("#c:s", "a".repeat(43), faixa())

    await vi.advanceTimersByTimeAsync(MotorSfu.PRAZO_DO_ENVIO_MS - 1)
    expect(paradas).toEqual([])
    await vi.advanceTimersByTimeAsync(1)

    expect(paradas).toHaveLength(1)
    expect(montagem.diagnosticos).toContainEqual({
      code: "sfu-envio-sem-ligacao",
      detail: `dtls connecting · ice checking · ${MotorSfu.PRAZO_DO_ENVIO_MS} ms`,
    })
  })

  it("um envio que liga a tempo não diz nada", async () => {
    const montagem = montar()
    const paradas: number[] = []
    const motor = new MotorSfu({
      sinalizacao: montagem.sinalizacao,
      cifra: montagem.cifra,
      criarDispositivo: () => montagem.dispositivo,
      aoDiagnosticar: (code, detail) => montagem.diagnosticos.push(detail === undefined ? { code } : { code, detail }),
      aoMudar: () => {},
      verOEcraDe: () => false,
      aoEnvioParado: () => paradas.push(Date.now()),
    })
    const dtls = comDtls(montagem, { state: "connecting" })
    await motor.entrar("#c:s", "a".repeat(43), faixa())
    dtls.mudar("connected")
    await vi.advanceTimersByTimeAsync(60_000)
    expect(paradas).toEqual([])
    expect(montagem.diagnosticos.map((cada) => cada.code)).not.toContain("sfu-envio-sem-ligacao")
  })

  it("um envio que cai para failed a meio também pede que se refaça; o closed da nossa saída não", async () => {
    const montagem = montar()
    const paradas: number[] = []
    const motor = new MotorSfu({
      sinalizacao: montagem.sinalizacao,
      cifra: montagem.cifra,
      criarDispositivo: () => montagem.dispositivo,
      aoDiagnosticar: () => {},
      aoMudar: () => {},
      verOEcraDe: () => false,
      aoEnvioParado: () => paradas.push(Date.now()),
    })
    const dtls = comDtls(montagem, { state: "connected" })
    await motor.entrar("#c:s", "a".repeat(43), faixa())
    dtls.mudar("failed")
    expect(paradas).toHaveLength(1)
    motor.sair()
    dtls.mudar("closed")
    await vi.advanceTimersByTimeAsync(60_000)
    expect(paradas).toHaveLength(1)
  })
})
