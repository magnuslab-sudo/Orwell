import type { FonteDeMedia, UserAddress } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  MotorSfu,
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
 * The races in the SFU path: who arrives in the middle of who is building.
 *
 * The `call-sfu.test.ts` measures the ORDER of a build that goes well. This measures
 * what happens when gateway notifications don't wait for it, which is the normal
 * case, not the exceptional one: the `sfu.producer.new` travels over the
 * server socket, and no one on the other side knows where we are in the build.
 *
 * The family is the same one `call.ts` already logs three times in comments:
 * state indexed by who instead of why, live resources killed by late reports of old
 * resources, and who arrives to race with who leaves. Here the SFU engine takes it.
 */

const EU = "@eu:s" as UserAddress
const ANA = "@ana:s" as UserAddress
const BRUNO = "@bruno:s" as UserAddress

const CANAL = "#c:s"
const AMBITO = "a".repeat(43)

function material(byte: number): MaterialDeChave {
  return { keyId: 41, senderId: 1, material: new Uint8Array(32).fill(byte) }
}

/** A gate you open by hand: the request stays pending until someone releases it. */
class Portao {
  #abrir: (() => void) | null = null
  readonly aberto: Promise<void>
  /** Resolves when someone knocks, so the test knows it's there. */
  readonly bateram: Promise<void>
  #bateu!: () => void

  constructor() {
    this.aberto = new Promise<void>((resolve) => {
      this.#abrir = resolve
    })
    this.bateram = new Promise<void>((resolve) => {
      this.#bateu = resolve
    })
  }

  bater(): Promise<void> {
    this.#bateu()
    return this.aberto
  }

  abrir(): void {
    this.#abrir?.()
  }
}

class SinalizacaoFalsa implements SinalizacaoSfu {
  produtoresIniciais: { id: string; kind: "audio" | "video"; address: UserAddress; fonte?: FonteDeMedia }[] = []
  readonly consumidos: string[] = []
  readonly retomados: string[] = []
  /** The gate holding back the creation of the receive transport, if there is one. */
  portaoDaRecepcao: Portao | null = null
  /** The gate holding back a `sfu.consume` of this producer, if there is one. */
  portaoDoConsumo = new Map<string, Portao>()
  /** Producers the server no longer knows: refuse them like the real engine. */
  mortos = new Set<string>()
  /**
   * How many times MORE consumption of this producer is lost to network accident.
   *
   * A loss, not a refusal: the server answered nothing. That's the whole difference
   * of this policy, and the double has to handle it both ways.
   */
  falhasDeRede = new Map<string, number>()
  /** Producers the server REFUSES: heard, understood, and said no. */
  recusarConsumoDe = new Set<string>()
  /**
   * The same refusal, as it reaches the desktop app renderer: remade by the
   * IPC envelope, an `Error` with name and key, without the class.
   */
  recusarConsumoPeloIpcDe = new Set<string>()
  /**
   * SERVER refusals that may be timing-related (4/11/2026, #984): the code and
   * how many times MORE it refuses. After that it accepts. This is the case of the
   * owner's login, a `sfu.consume` that reaches the server out of time.
   */
  recusasTransitorias = new Map<string, { codigo: string; vezes: number }>()
  /** The same, in `sfu.resume` (the consumer the server doesn't know yet). */
  recusasDaRetoma = new Map<string, { codigo: string; vezes: number }>()
  /** Final refusals, by code: the server says no, and it really is no. */
  recusarConsumoComCodigo = new Map<string, string>()
  /** How many times the server was asked who is on the call (`sfu.scope.join`). */
  entradasNoAmbito = 0
  /** All consume requests that went out, including the ones that failed. */
  readonly pedidosDeConsumo: string[] = []
  /** The server's refusal of a `produce`, with its physical reason. */
  recusarProducaoDe: FonteDeMedia | null = null

  async sfuEntrarNoAmbito(): Promise<{
    rtpCapabilities: unknown
    producers: { id: string; kind: "audio" | "video"; address: UserAddress; fonte?: FonteDeMedia }[]
  }> {
    this.entradasNoAmbito++
    return { rtpCapabilities: { codecs: [{ mimeType: "audio/opus" }] }, producers: [...this.produtoresIniciais] }
  }

  sfuSairDoAmbito(): void {}

  async sfuCriarTransporte(
    _channel: string,
    _scope: string,
    direction: "envio" | "recepcao",
  ): Promise<{ id: string; iceParameters: unknown; iceCandidates: unknown; dtlsParameters: unknown }> {
    if (direction === "recepcao" && this.portaoDaRecepcao) await this.portaoDaRecepcao.bater()
    return { id: `t-${direction}`, iceParameters: {}, iceCandidates: [], dtlsParameters: {} }
  }

  async sfuLigarTransporte(): Promise<void> {}

  async sfuProduzir(_t: string, _kind: "audio" | "video", _rtp: unknown, fonte?: FonteDeMedia): Promise<string> {
    if (this.recusarProducaoDe && this.recusarProducaoDe === fonte) {
      // How the server refuses: with the physical reason spelled out.
      throw new Error("já vão 2 câmaras nesta chamada, que é o que a ligação do servidor aguenta")
    }
    return `produtor-${fonte ?? "nosso"}`
  }

  async sfuFecharProdutor(): Promise<void> {}

  async sfuConsumir(
    _transport: string,
    producer: string,
  ): Promise<{ id: string; producerId: string; kind: "audio" | "video"; rtpParameters: unknown }> {
    const portao = this.portaoDoConsumo.get(producer)
    if (portao) await portao.bater()
    this.pedidosDeConsumo.push(producer)

    const transitoria = this.recusasTransitorias.get(producer)
    if (transitoria && transitoria.vezes > 0) {
      transitoria.vezes--
      throw new RecusaDoSfu(transitoria.codigo, `recusa de ensaio (${transitoria.codigo})`)
    }
    const final = this.recusarConsumoComCodigo.get(producer)
    if (final) throw new RecusaDoSfu(final, `recusa final de ensaio (${final})`)
    if (this.recusarConsumoDe.has(producer)) {
      throw new RecusaDoSfu("incompativel", "este dispositivo não sabe ler o que aquele está a enviar")
    }
    if (this.recusarConsumoPeloIpcDe.has(producer)) {
      const refeito = new Error(new RecusaDoSfu("incompativel", "x").message, { cause: { codigo: "incompativel" } })
      refeito.name = "RecusaDoSfu"
      throw refeito
    }
    const falhas = this.falhasDeRede.get(producer) ?? 0
    if (falhas > 0) {
      this.falhasDeRede.set(producer, falhas - 1)
      // A bare `Error`, which is what arrives when no response comes at all:
      // the `#pedirSfu` timeout, or the socket dropping underneath.
      throw new Error("tempo esgotado à espera de sfu.consumed")
    }
    // The engine's real refusal when the producer is already dead, word for word,
    // with the right type to tell the engine not to retry.
    if (this.mortos.has(producer)) {
      throw new RecusaDoSfu("produtor-desconhecido", "esse fluxo não existe nesta chamada")
    }
    this.consumidos.push(producer)
    return { id: `c-${producer}`, producerId: producer, kind: "audio", rtpParameters: {} }
  }

  async sfuRetomar(_transport: string, consumer: string): Promise<void> {
    const transitoria = this.recusasDaRetoma.get(consumer.replace(/^c-/, ""))
    if (transitoria && transitoria.vezes > 0) {
      transitoria.vezes--
      throw new RecusaDoSfu(transitoria.codigo, `recusa de ensaio (${transitoria.codigo})`)
    }
    // The server refuses to resume a consumer whose producer is dead, the
    // `producerclose` closed it on their end.
    if (this.mortos.has(consumer.replace(/^c-/, ""))) {
      throw new RecusaDoSfu("consumidor-desconhecido", "esse fluxo não existe neste transporte")
    }
    this.retomados.push(consumer)
  }

  /** The frame that closes the tap. Without it, `largarEcraDe` would break inside. */
  readonly pausados: string[] = []
  async sfuPausar(_transport: string, consumer: string): Promise<void> {
    this.pausados.push(consumer)
  }
}

function pontaDeCifra(): RTCRtpSender & RTCRtpReceiver {
  return {
    createEncodedStreams: () => ({ readable: new ReadableStream(), writable: new WritableStream() }),
  } as unknown as RTCRtpSender & RTCRtpReceiver
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
  /** The consumers this transport made, and whether they were already closed. */
  readonly consumidores: { id: string; fechado: boolean }[] = []

  constructor(readonly id: string) {}

  on(evento: "connect" | "produce", ouvinte: never): void {
    if (evento === "connect") this.#aoLigar = ouvinte
    else this.#aoProduzir = ouvinte
  }

  async produce(opcoes: {
    track: MediaStreamTrack
    appData?: Record<string, unknown>
    onRtpSender?: (emissor: RTCRtpSender) => void
  }): Promise<ProdutorDeMedia> {
    // Like `mediasoup-client`: the sender is born before the offer and goes to `onRtpSender` (SEC-02).
    const emissor = pontaDeCifra()
    opcoes.onRtpSender?.(emissor)
    await this.#fecharDtls()
    const resultado = await new Promise<{ id: string }>((resolve, reject) =>
      this.#aoProduzir?.(
        { kind: opcoes.track.kind as "audio" | "video", rtpParameters: {}, appData: opcoes.appData ?? {} },
        resolve,
        reject,
      ),
    )
    return { id: resultado.id, rtpSender: emissor, close: () => {} }
  }

  async consume(opcoes: { id: string; producerId: string; kind: "audio" | "video" }): Promise<ConsumidorDeMedia> {
    await this.#fecharDtls()
    const registo = { id: opcoes.id, fechado: false }
    this.consumidores.push(registo)
    return {
      id: opcoes.id,
      producerId: opcoes.producerId,
      track: { kind: opcoes.kind, id: `faixa-${opcoes.producerId}` } as MediaStreamTrack,
      rtpReceiver: pontaDeCifra(),
      close: () => {
        registo.fechado = true
      },
    }
  }

  async #fecharDtls(): Promise<void> {
    if (!this.#aoLigar) return
    const ligar = this.#aoLigar
    this.#aoLigar = null
    await new Promise<void>((resolve, reject) => ligar({ dtlsParameters: {} }, resolve, reject))
  }

  close(): void {
    this.fechado = true
  }
}

class DispositivoFalso implements DispositivoDeMedia {
  readonly transportes: TransporteFalso[] = []
  readonly rtpCapabilities = { codecs: [{ mimeType: "audio/opus" }] }
  async load(): Promise<void> {}
  canProduce(): boolean {
    return true
  }
  createSendTransport(o: ParametrosDoTransporte): TransporteDeMedia {
    const transporte = new TransporteFalso(o.id)
    this.transportes.push(transporte)
    return transporte
  }
  createRecvTransport(o: ParametrosDoTransporte): TransporteDeMedia {
    const transporte = new TransporteFalso(o.id)
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
  diagnosticos: { code: string; detail?: string }[]
  mudancas: number
}

function montar(): Montagem {
  const sinalizacao = new SinalizacaoFalsa()
  const dispositivo = new DispositivoFalso()
  const diagnosticos: { code: string; detail?: string }[] = []
  const estado = { mudancas: 0 }

  const cifra = new CifraDeMedia({
    selfAddress: EU,
    mediaKey: async (_canal, address) => material(address === EU ? 1 : 2),
    reservarContadorSframe: async () => 1000,
  })

  const motor = new MotorSfu({
    sinalizacao,
    cifra,
    criarDispositivo: () => dispositivo,
    verOEcraDe: () => false,
    aoDiagnosticar: (code, detail) => diagnosticos.push(detail === undefined ? { code } : { code, detail }),
    aoMudar: () => {
      estado.mudancas++
    },
  })

  return {
    motor,
    sinalizacao,
    dispositivo,
    diagnosticos,
    get mudancas() {
      return estado.mudancas
    },
  }
}

beforeEach(() => {
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

// ---------------------------------------------------------------------------

describe("quem começa a falar enquanto ainda estamos a montar", () => {
  /**
   * **The race that leaves a person "dialing" forever.**
   *
   * Between `sfu.scope.join` answering and both transports being up there are
   * two round trips to the server. The gateway does not know this: anyone who
   * enters that window is announced with `sfu.producer.new` like any other, and
   * the engine had no receive transport and silently dropped the alert.
   *
   * There is no second chance: `sfu.scope.joined` was already answered without
   * that producer, which did not exist yet, and the gateway announces each
   * stream exactly ONCE. The person stays in the roster without a stream, which
   * is exactly how you draw someone who joined and has not spoken yet: "dialing…",
   * forever.
   *
   * Two people tapping into the voice room a second apart hits this, which
   * happens when a meeting starts.
   */
  it("não perde o fluxo de quem chega entre o `scope.join` e o transporte de recepção", async () => {
    const { motor, sinalizacao } = montar()
    const portao = new Portao()
    sinalizacao.portaoDaRecepcao = portao

    const entrada = motor.entrar(CANAL, AMBITO, faixa())
    // The engine is now hanging waiting for the receive transport, which is where
    // the window lives.
    await portao.bateram

    await motor.produtorNovo(CANAL, AMBITO, "p-ana", ANA, "microfone")

    portao.abrir()
    await entrada

    expect(motor.fluxos().map((cada) => cada.address)).toEqual([ANA])
  })

  /**
   * The same with the alert arriving before there is even a device yet, the
   * window starts at `sfu.scope.join`, not at the transport.
   */
  it("nem o de quem chega antes de o dispositivo estar carregado", async () => {
    const { motor, sinalizacao } = montar()
    const portao = new Portao()
    sinalizacao.portaoDaRecepcao = portao

    const entrada = motor.entrar(CANAL, AMBITO, faixa())
    await portao.bateram

    await motor.produtorNovo(CANAL, AMBITO, "p-ana", ANA, "microfone")
    await motor.produtorNovo(CANAL, AMBITO, "p-bruno", BRUNO, "microfone")

    portao.abrir()
    await entrada

    expect(motor.fluxos().map((cada) => cada.address).sort()).toEqual([ANA, BRUNO])
  })

  /**
   * And what arrived in the window cannot be consumed TWICE because it also
   * comes in the `scope.joined` list. The same voice twice with half a second
   * between sounds like echo and gets looked for in the wrong place.
   */
  it("e não o consome duas vezes quando ele também vem na lista de quem já lá estava", async () => {
    const { motor, sinalizacao } = montar()
    sinalizacao.produtoresIniciais = [{ id: "p-ana", kind: "audio", address: ANA, fonte: "microfone" }]
    const portao = new Portao()
    sinalizacao.portaoDaRecepcao = portao

    const entrada = motor.entrar(CANAL, AMBITO, faixa())
    await portao.bateram
    await motor.produtorNovo(CANAL, AMBITO, "p-ana", ANA, "microfone")
    portao.abrir()
    await entrada

    expect(sinalizacao.consumidos.filter((cada) => cada === "p-ana")).toHaveLength(1)
  })
})

describe("um fluxo que morre enquanto o estamos a montar", () => {
  /**
   * **The late report that leaves a corpse standing.**
   *
   * `sfu.producer.closed` arrives while `sfu.consume` for that same producer
   * is still going. `produtorFechado` looked for it in the consumers, did not
   * find it, it was not there yet, and gave up without a trace. The consume
   * ended next and installed a consumer of a dead producer: the person has a
   * card saying "connected" and a stream that will never touch anything, and
   * the alert that should clean it up already passed and will not come back.
   *
   * It is the same family as the three bugs that `call.ts` records in comments:
   * an event that describes a resource arrives when the resource does not yet
   * exist on our side, and gets lost.
   */
  it("o aviso de morte não se perde por chegar a meio do consumo", async () => {
    const { motor, sinalizacao } = montar()
    await motor.entrar(CANAL, AMBITO, faixa())

    const portao = new Portao()
    sinalizacao.portaoDoConsumo.set("p-ana", portao)

    const consumo = motor.produtorNovo(CANAL, AMBITO, "p-ana", ANA, "microfone")
    await portao.bateram

    // Ana hung up: the gateway closes her producer and announces it. On our side
    // her consumer does not exist yet.
    motor.produtorFechado("p-ana")

    portao.abrir()
    await consumo

    expect(motor.fluxos()).toEqual([])
  })

  /**
   * And the consumer that was built cannot stay open: a live consumer of a
   * dead producer is memory on our side and a stream the server no longer routes.
   */
  it("e o consumidor que nasceu a meio fecha-se em vez de ficar pendurado", async () => {
    const { motor, sinalizacao, dispositivo } = montar()
    await motor.entrar(CANAL, AMBITO, faixa())

    const portao = new Portao()
    sinalizacao.portaoDoConsumo.set("p-ana", portao)
    const consumo = motor.produtorNovo(CANAL, AMBITO, "p-ana", ANA, "microfone")
    await portao.bateram
    motor.produtorFechado("p-ana")
    portao.abrir()
    await consumo

    const recepcao = dispositivo.transportes.find((cada) => cada.id === "t-recepcao")
    expect(recepcao?.consumidores.every((cada) => cada.fechado)).toBe(true)
  })

  /**
   * After a death alert, the same identifier cannot be consumed again by a
   * late alert: the server refuses it, and what you would gain is one more
   * round trip to the server and a log line saying something failed that you
   * knew would fail.
   */
  it("um `producer.new` em atraso de um produtor já morto não se persegue", async () => {
    const { motor, sinalizacao } = montar()
    await motor.entrar(CANAL, AMBITO, faixa())

    await motor.produtorNovo(CANAL, AMBITO, "p-ana", ANA, "microfone")
    expect(motor.fluxos()).toHaveLength(1)

    motor.produtorFechado("p-ana")
    sinalizacao.mortos.add("p-ana")

    const consumosAte = sinalizacao.consumidos.length
    await motor.produtorNovo(CANAL, AMBITO, "p-ana", ANA, "microfone")

    expect(sinalizacao.consumidos.length).toBe(consumosAte)
    expect(motor.fluxos()).toEqual([])
  })
})

describe("a saída a competir com a entrada", () => {
  /**
   * Leave the call while setup is underway.
   *
   * Happens to people who hit disconnect before the call finishes setting up,
   * and happens on its own when `#entrarPorSfu` in `call.ts` catches an error
   * and calls `#leave` on top of a join still in flight. Without this, the join
   * keeps going and writes the transports AFTER the leave cleaned them up:
   * two transports stay open, with the microphone feeding them, in a call the
   * person already left.
   */
  it("uma saída a meio da entrada não deixa transportes abertos", async () => {
    const { motor, sinalizacao, dispositivo } = montar()
    const portao = new Portao()
    sinalizacao.portaoDaRecepcao = portao

    const entrada = motor.entrar(CANAL, AMBITO, faixa())
    await portao.bateram

    motor.sair()

    portao.abrir()
    await entrada.catch(() => {})

    expect(motor.activo).toBe(false)
    expect(dispositivo.transportes.every((cada) => cada.fechado)).toBe(true)
  })
})

describe("a câmara recusada pelo servidor", () => {
  /**
   * **No video is better than no call.**
   *
   * `podeVideo` already said this for a router that does not negotiate video,
   * and the other half was missing: the server refuses by room limits, two
   * cameras, no more, and those depend on who is there. Between two joins of
   * ours the second slot may have been taken by someone else, which is exactly
   * what happens to someone coming back from a reconnect with the camera on.
   *
   * Without this, `entrar` would break and the person would lose voice, video
   * and call, over a camera.
   */
  it("não derruba a chamada: fica a voz, e a razão fica dita", async () => {
    const { motor, sinalizacao, diagnosticos } = montar()
    sinalizacao.recusarProducaoDe = "camara"

    await motor.entrar(CANAL, AMBITO, faixa("audio"), faixa("video"))

    expect(motor.activo).toBe(true)
    expect(diagnosticos.map((cada) => cada.code)).toContain("sfu-camara-recusada")
    // And the engine stays usable: whoever arrives next will be heard.
    await motor.produtorNovo(CANAL, AMBITO, "p-ana", ANA, "microfone")
    expect(motor.fluxos().map((cada) => cada.address)).toEqual([ANA])
  })

  /**
   * Voice does NOT get the same treatment, and that is deliberate: a call where
   * no one speaks is not a call, and building it fake is worse than not
   * building it.
   */
  it("mas a voz recusada derruba, porque sem voz não há chamada", async () => {
    const { motor, sinalizacao } = montar()
    sinalizacao.recusarProducaoDe = "microfone"

    await expect(motor.entrar(CANAL, AMBITO, faixa("audio"))).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------

/**
 * **The `sfu.consume` that gets lost, and the person who stays "dialing"
 * forever.**
 *
 * The gateway announces each producer exactly ONCE, with no second chance: the
 * `sfu.scope.joined` was already answered before that producer existed. A
 * consume request lost to a network accident would not be asked again, and that
 * person's slot had no sound on the screen of whoever lost the request, not
 * for a few seconds: for the rest of the call.
 *
 * It is the same family as `#anunciadosCedo`, above, and the tombstone of dead
 * producers: an event that arrives once, and a side of ours that drops it. What
 * changes is what you do with it, there it is kept, here it is asked again.
 *
 * **The policy, not the code, was what was missing.** Retrying a REFUSAL is
 * asking the server to say no many times; not retrying a LOSS is the bug we
 * have. The line between them is the shape of the error and never a list of
 * codes: a `RecusaDoSfu` is an answer, and an answer is not retried.
 */
describe("um pedido de consumo que se perde na rede", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** Let all the policy waits run, with slack. */
  async function deixarRepetir(): Promise<void> {
    for (const espera of MotorSfu.ESPERAS_DO_CONSUMO_MS) await vi.advanceTimersByTimeAsync(espera + 1)
  }

  it("volta a ser feito, e a pessoa deixa de ficar sem som para o resto da chamada", async () => {
    const { motor, sinalizacao } = montar()
    await motor.entrar(CANAL, AMBITO, faixa())

    sinalizacao.falhasDeRede.set("p-ana", 1)
    await motor.produtorNovo(CANAL, AMBITO, "p-ana", ANA, "microfone")

    // The entire fix, in these two lines: without retry, Ana is not here now and
    // will not be until someone disconnects.
    expect(motor.fluxos()).toEqual([])
    await deixarRepetir()
    expect(motor.fluxos().map((cada) => cada.address)).toEqual([ANA])
  })

  it("uma recusa do servidor NÃO se repete: a segunda resposta é igual à primeira", async () => {
    const { motor, sinalizacao, diagnosticos } = montar()
    await motor.entrar(CANAL, AMBITO, faixa())

    sinalizacao.recusarConsumoDe.add("p-ana")
    await motor.produtorNovo(CANAL, AMBITO, "p-ana", ANA, "microfone")
    await deixarRepetir()

    expect(sinalizacao.pedidosDeConsumo.filter((cada) => cada === "p-ana")).toHaveLength(1)
    expect(diagnosticos.map((cada) => cada.code)).toContain("sfu-consumo-falhou")
    expect(diagnosticos.map((cada) => cada.code)).not.toContain("sfu-consumo-a-repetir")
  })

  it("e também não quando a recusa atravessou o IPC e perdeu a classe", async () => {
    const { motor, sinalizacao, diagnosticos } = montar()
    await motor.entrar(CANAL, AMBITO, faixa())

    sinalizacao.recusarConsumoPeloIpcDe.add("p-ana")
    await motor.produtorNovo(CANAL, AMBITO, "p-ana", ANA, "microfone")
    await deixarRepetir()

    expect(sinalizacao.pedidosDeConsumo.filter((cada) => cada === "p-ana")).toHaveLength(1)
    expect(diagnosticos.map((cada) => cada.code)).not.toContain("sfu-consumo-a-repetir")
  })

  it("e as tentativas têm fim: ao fim delas desiste, e diz que desistiu", async () => {
    const { motor, sinalizacao, diagnosticos } = montar()
    await motor.entrar(CANAL, AMBITO, faixa())

    sinalizacao.falhasDeRede.set("p-ana", 99)
    await motor.produtorNovo(CANAL, AMBITO, "p-ana", ANA, "microfone")
    await deixarRepetir()
    // And more time, well beyond what the policy has: nothing else can go out.
    await vi.advanceTimersByTimeAsync(60_000)

    /*
      The count comes from the CONSTANT and not from a number written by hand.

      A `toHaveLength(3)` here would start lying on the day someone adds a wait
      to the list, and would lie quietly: it would stay green measuring a policy
      that is no longer what is in the code.
    */
    expect(sinalizacao.pedidosDeConsumo.filter((cada) => cada === "p-ana")).toHaveLength(
      MotorSfu.ESPERAS_DO_CONSUMO_MS.length + 1,
    )
    expect(diagnosticos.filter((cada) => cada.code === "sfu-consumo-falhou")).toHaveLength(1)
    expect(diagnosticos.filter((cada) => cada.code === "sfu-consumo-a-repetir")).toHaveLength(
      MotorSfu.ESPERAS_DO_CONSUMO_MS.length,
    )
  })

  /**
   * **Retry runs on its own, and that is what makes it cheap.**
   *
   * `entrar` consumes the producers from `scope.joined` one by one, with `await`
   * on each. If retries were waited for inside there, a single bad producer
   * would hold up the entire call join during all the waits, and in that time
   * you hear no one, not even the people who are fine. This measures the
   * difference: without advancing a single clock, the call is already up and
   * the people who are fine are already heard.
   */
  it("a entrada não fica à espera das repetições de quem falhou", async () => {
    const { motor, sinalizacao } = montar()
    sinalizacao.produtoresIniciais = [
      { id: "p-ana", kind: "audio", address: ANA, fonte: "microfone" },
      { id: "p-bruno", kind: "audio", address: BRUNO, fonte: "microfone" },
    ]
    sinalizacao.falhasDeRede.set("p-ana", 1)

    await motor.entrar(CANAL, AMBITO, faixa())

    expect(motor.activo).toBe(true)
    expect(motor.fluxos().map((cada) => cada.address)).toEqual([BRUNO])

    // And Ana arrives when her retry runs, without holding anyone up.
    await deixarRepetir()
    expect(motor.fluxos().map((cada) => cada.address).sort()).toEqual([ANA, BRUNO])
  })

  it("um produtor que morre entre duas tentativas não se persegue mais", async () => {
    const { motor, sinalizacao } = montar()
    await motor.entrar(CANAL, AMBITO, faixa())

    sinalizacao.falhasDeRede.set("p-ana", 99)
    await motor.produtorNovo(CANAL, AMBITO, "p-ana", ANA, "microfone")
    const pedidosAte = sinalizacao.pedidosDeConsumo.length

    // Ana hung up while her retry was scheduled.
    motor.produtorFechado("p-ana")
    await deixarRepetir()

    expect(sinalizacao.pedidosDeConsumo.length).toBe(pedidosAte)
  })

  it("sair da chamada não deixa relógios a andar por ela", async () => {
    const { motor, sinalizacao } = montar()
    await motor.entrar(CANAL, AMBITO, faixa())

    sinalizacao.falhasDeRede.set("p-ana", 99)
    await motor.produtorNovo(CANAL, AMBITO, "p-ana", ANA, "microfone")
    const pedidosAte = sinalizacao.pedidosDeConsumo.length

    motor.sair()

    /*
      Keeps track of FORM, and that matters more than the count below.

      A clock hanging in a call that ended is the family of bugs this entire
      file pursues: an event from one life arriving in the next. Counting
      requests measures the symptom; this measures the cause, and stays true if
      one day retry stops asking for anything at all.
    */
    expect(vi.getTimerCount()).toBe(0)

    await deixarRepetir()
    expect(sinalizacao.pedidosDeConsumo.length).toBe(pedidosAte)
  })

  /**
   * While a sequence runs, the same producer does not start another.
   *
   * The gateway may repeat `sfu.producer.new`, it is written in `#aConsumir`,
   * and that is what happens to someone who produces at the exact moment we
   * join. Two threads on the same stream would give the same voice twice with
   * half a second between, which sounds like echo and gets looked for in the
   * wrong place.
   */
  it("um aviso repetido não arranca uma segunda corrente pelo mesmo fluxo", async () => {
    const { motor, sinalizacao } = montar()
    await motor.entrar(CANAL, AMBITO, faixa())

    sinalizacao.falhasDeRede.set("p-ana", 1)
    await motor.produtorNovo(CANAL, AMBITO, "p-ana", ANA, "microfone")
    // The same alert again, with retry still scheduled.
    await motor.produtorNovo(CANAL, AMBITO, "p-ana", ANA, "microfone")
    await deixarRepetir()

    expect(sinalizacao.pedidosDeConsumo.filter((cada) => cada === "p-ana")).toHaveLength(2)
    expect(motor.fluxos().map((cada) => cada.address)).toEqual([ANA])
  })
})

// ---------------------------------------------------------------------------

/**
 * **The refusal that is timing, and the owner who stops hearing someone (4/11/2026, #984).**
 *
 * Log entry from the owner (1.3.0, 16:42:21.769), in the middle of a burst of
 * `channel.meta` with the thread stuck: `sfu-consumo-falhou d7ac2adb-… · the call
 * server refused the request`. The policy said that a response from the server
 * does not repeat, and the consumer of that producer was never called again: "the user
 * hears me but I don't hear them", until they leave and come back.
 *
 * A request that arrives late at the server gets a true response
 * about a state that has passed: the producer that did not exist yet, the
 * consumer that the server no longer has, the transport that changed. These are not
 * final. Final ones are those that do not change by waiting: the device that cannot read the
 * codec, the person with no place in the channel, the server full with the stated limit.
 */
describe("uma recusa do servidor que pode ser de tempo", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  async function deixarRepetir(): Promise<void> {
    for (const espera of MotorSfu.ESPERAS_DO_CONSUMO_MS) await vi.advanceTimersByTimeAsync(espera + 1)
  }

  const codigos = (diagnosticos: { code: string }[]): string[] => diagnosticos.map((cada) => cada.code)
  const ANA_NO_SERVIDOR = { id: "p-ana", kind: "audio" as const, address: ANA, fonte: "microfone" as const }

  it("o SFU recusa a primeira vez e aceita a segunda: o som abre sem sair da chamada", async () => {
    const { motor, sinalizacao, diagnosticos } = montar()
    await motor.entrar(CANAL, AMBITO, faixa())
    sinalizacao.produtoresIniciais = [ANA_NO_SERVIDOR]

    sinalizacao.recusasTransitorias.set("p-ana", { codigo: "produtor-desconhecido", vezes: 1 })
    await motor.produtorNovo(CANAL, AMBITO, "p-ana", ANA, "microfone")
    expect(motor.fluxos()).toEqual([])
    expect(motor.somEmFaltaDe(ANA)).toBe(true)

    await deixarRepetir()

    expect(motor.fluxos().map((cada) => cada.address)).toEqual([ANA])
    expect(sinalizacao.retomados).toContain("c-p-ana")
    expect(motor.somEmFaltaDe(ANA)).toBe(false)
    expect(sinalizacao.pedidosDeConsumo.filter((cada) => cada === "p-ana")).toHaveLength(2)
    // The refusal is written with the server's code and reason, not just the generic key.
    const recusa = diagnosticos.find((cada) => cada.code === "sfu-consumo-recusado")
    expect(recusa?.detail).toContain("p-ana")
    expect(recusa?.detail).toContain("produtor-desconhecido")
    expect(codigos(diagnosticos)).toContain("sfu-consumo-a-repetir")
    expect(codigos(diagnosticos)).toContain("sfu-consumo-em-falta")
    expect(codigos(diagnosticos)).toContain("sfu-consumo-recuperado")
    expect(codigos(diagnosticos)).not.toContain("sfu-consumo-falhou")
  })

  it.each(["transporte-desconhecido", "consumidor-desconhecido", "interno", "ambito-instavel", "demasiados-pedidos", "um-codigo-novo"])(
    "«%s» no consumo repete-se, e o som abre",
    async (codigo) => {
      const { motor, sinalizacao } = montar()
      await motor.entrar(CANAL, AMBITO, faixa())
      sinalizacao.produtoresIniciais = [ANA_NO_SERVIDOR]
      sinalizacao.recusasTransitorias.set("p-ana", { codigo, vezes: 1 })

      await motor.produtorNovo(CANAL, AMBITO, "p-ana", ANA, "microfone")
      await deixarRepetir()

      expect(motor.fluxos().map((cada) => cada.address)).toEqual([ANA])
    },
  )

  it("o `sfu.resume` recusado (o consumidor que o servidor ainda não tinha) também se repete", async () => {
    const { motor, sinalizacao } = montar()
    await motor.entrar(CANAL, AMBITO, faixa())
    sinalizacao.produtoresIniciais = [ANA_NO_SERVIDOR]
    sinalizacao.recusasDaRetoma.set("p-ana", { codigo: "consumidor-desconhecido", vezes: 1 })

    await motor.produtorNovo(CANAL, AMBITO, "p-ana", ANA, "microfone")
    await deixarRepetir()

    expect(sinalizacao.retomados).toContain("c-p-ana")
    expect(motor.fluxos().map((cada) => cada.address)).toEqual([ANA])
  })

  it.each(["incompativel", "sem-lugar", "servidor-cheio", "sentido-errado", "sem-sfu"])(
    "«%s» é final: um pedido só, e diz-se",
    async (codigo) => {
      const { motor, sinalizacao, diagnosticos } = montar()
      await motor.entrar(CANAL, AMBITO, faixa())
      sinalizacao.produtoresIniciais = [ANA_NO_SERVIDOR]
      sinalizacao.recusarConsumoComCodigo.set("p-ana", codigo)

      await motor.produtorNovo(CANAL, AMBITO, "p-ana", ANA, "microfone")
      await deixarRepetir()
      await vi.advanceTimersByTimeAsync(60_000)

      expect(sinalizacao.pedidosDeConsumo.filter((cada) => cada === "p-ana")).toHaveLength(1)
      expect(codigos(diagnosticos)).toContain("sfu-consumo-falhou")
      expect(codigos(diagnosticos)).not.toContain("sfu-consumo-a-repetir")
      expect(diagnosticos.find((cada) => cada.code === "sfu-consumo-falhou")?.detail).toContain(codigo)
    },
  )

  it("um produtor que o servidor já não lista deixa de se pedir: estava mesmo morto", async () => {
    const { motor, sinalizacao, diagnosticos } = montar()
    await motor.entrar(CANAL, AMBITO, faixa())
    // The server does not have it: the call list comes back empty.
    sinalizacao.produtoresIniciais = []
    sinalizacao.recusasTransitorias.set("p-ana", { codigo: "produtor-desconhecido", vezes: 99 })

    await motor.produtorNovo(CANAL, AMBITO, "p-ana", ANA, "microfone")
    await deixarRepetir()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(sinalizacao.entradasNoAmbito).toBeGreaterThan(1)
    expect(sinalizacao.pedidosDeConsumo.filter((cada) => cada === "p-ana")).toHaveLength(1)
    expect(motor.somEmFaltaDe(ANA)).toBe(false)
    expect(codigos(diagnosticos)).toContain("sfu-consumo-falhou")
  })

  it("depois das esperas todas fica à espera de um sinal, e o anúncio da pessoa acorda-o", async () => {
    const { motor, sinalizacao } = montar()
    await motor.entrar(CANAL, AMBITO, faixa())
    sinalizacao.produtoresIniciais = [ANA_NO_SERVIDOR]
    sinalizacao.recusasTransitorias.set("p-ana", { codigo: "interno", vezes: MotorSfu.ESPERAS_DO_CONSUMO_MS.length + 1 })

    await motor.produtorNovo(CANAL, AMBITO, "p-ana", ANA, "microfone")
    await deixarRepetir()
    await vi.advanceTimersByTimeAsync(60_000)
    const pedidos = sinalizacao.pedidosDeConsumo.length
    expect(motor.fluxos()).toEqual([])
    expect(motor.somEmFaltaDe(ANA)).toBe(true)

    // Her `voice.join` arrives (the roster heartbeat, or her toggling mute).
    await motor.pessoaAnunciou(ANA)
    await vi.advanceTimersByTimeAsync(0)

    expect(sinalizacao.pedidosDeConsumo.length).toBe(pedidos + 1)
    expect(motor.fluxos().map((cada) => cada.address)).toEqual([ANA])
  })

  it.each([
    ["a epoch muda", (motor: MotorSfu) => motor.acordarConsumos("epoch")],
    ["o transporte de recepção volta", (motor: MotorSfu) => motor.acordarConsumos("recepcao-voltou")],
    ["chega outro anúncio da mesma pessoa", (motor: MotorSfu) => motor.produtorNovo(CANAL, AMBITO, "p-ana-camara", ANA, "camara")],
  ])("%s: tenta já, sem esperar pelo relógio", async (_nome, sinal) => {
    const { motor, sinalizacao } = montar()
    await motor.entrar(CANAL, AMBITO, faixa())
    sinalizacao.produtoresIniciais = [ANA_NO_SERVIDOR]
    // `interno`, not `produtor-desconhecido`: the latter asks for the list right
    // away, and here you measure the signal on its own.
    sinalizacao.recusasTransitorias.set("p-ana", { codigo: "interno", vezes: 1 })

    await motor.produtorNovo(CANAL, AMBITO, "p-ana", ANA, "microfone")
    expect(sinalizacao.consumidos).not.toContain("p-ana")

    await sinal(motor)
    await vi.advanceTimersByTimeAsync(0)

    expect(sinalizacao.consumidos).toContain("p-ana")
  })

  it("um congelamento longo da thread: o motor pergunta quem lá está, ouve quem faltava e larga quem já saiu", async () => {
    const { motor, sinalizacao, diagnosticos } = montar()
    sinalizacao.produtoresIniciais = [{ id: "p-bruno", kind: "audio", address: BRUNO, fonte: "microfone" }]
    await motor.entrar(CANAL, AMBITO, faixa())
    expect(motor.fluxos().map((cada) => cada.address)).toEqual([BRUNO])

    // During the freeze: Bruno remade the media (the old producer died and the
    // alert was lost) and Ana joined (her alert was lost too).
    sinalizacao.produtoresIniciais = [
      ANA_NO_SERVIDOR,
      { id: "p-bruno-2", kind: "audio", address: BRUNO, fonte: "microfone" },
    ]
    // The thread was stuck for 12 s: wall clock ran and no clock ticked.
    vi.setSystemTime(Date.now() + 12_000)
    await vi.advanceTimersByTimeAsync(MotorSfu.VIGIA_DA_THREAD_MS + 10)

    expect(codigos(diagnosticos)).toContain("sfu-thread-presa")
    expect(sinalizacao.consumidos).toEqual(expect.arrayContaining(["p-ana", "p-bruno-2"]))
    expect(motor.fluxos().map((cada) => cada.address).sort()).toEqual([ANA, BRUNO])
    // The old producer's consumer closed: no "connected" card for a dead stream stays.
    const velho = sinalizacao.consumidos.indexOf("p-bruno")
    expect(velho).toBeGreaterThanOrEqual(0)
    expect(motor.emissores().sort()).toEqual([ANA, BRUNO])
  })

  it("uma resposta que demora (a sessão presa no processo principal) também faz perguntar a lista", async () => {
    const { motor, sinalizacao, diagnosticos } = montar()
    await motor.entrar(CANAL, AMBITO, faixa())
    const portao = new Portao()
    sinalizacao.portaoDoConsumo.set("p-ana", portao)
    const consumo = motor.produtorNovo(CANAL, AMBITO, "p-ana", ANA, "microfone")
    await portao.bateram
    // Meanwhile Bruno came in, and his announcement got stuck with the response.
    sinalizacao.produtoresIniciais = [ANA_NO_SERVIDOR, { id: "p-bruno", kind: "audio", address: BRUNO, fonte: "microfone" }]
    vi.setSystemTime(Date.now() + 10_000)
    portao.abrir()
    await consumo
    await vi.advanceTimersByTimeAsync(0)

    expect(codigos(diagnosticos)).toContain("sfu-resposta-lenta")
    expect(motor.fluxos().map((cada) => cada.address).sort()).toEqual([ANA, BRUNO])
  })

  it("a lista do servidor não volta a pedir os nossos próprios produtores", async () => {
    const { motor, sinalizacao } = montar()
    await motor.entrar(CANAL, AMBITO, faixa())
    // The server lists everything in the scope, including what belongs to us.
    sinalizacao.produtoresIniciais = [{ id: "produtor-microfone", kind: "audio", address: EU, fonte: "microfone" }]

    await motor.ressincronizar("ensaio")

    expect(sinalizacao.pedidosDeConsumo).not.toContain("produtor-microfone")
  })

  it("sair larga as repetições, os sinais e a vigia da thread", async () => {
    const { motor, sinalizacao } = montar()
    await motor.entrar(CANAL, AMBITO, faixa())
    sinalizacao.produtoresIniciais = [ANA_NO_SERVIDOR]
    sinalizacao.recusasTransitorias.set("p-ana", { codigo: "produtor-desconhecido", vezes: 99 })
    await motor.produtorNovo(CANAL, AMBITO, "p-ana", ANA, "microfone")

    motor.sair()

    expect(vi.getTimerCount()).toBe(0)
    expect(motor.somEmFaltaDe(ANA)).toBe(false)
    const pedidos = sinalizacao.pedidosDeConsumo.length
    await motor.pessoaAnunciou(ANA)
    await deixarRepetir()
    expect(sinalizacao.pedidosDeConsumo.length).toBe(pedidos)
  })
})
