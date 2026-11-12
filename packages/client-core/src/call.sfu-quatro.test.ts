import { Payload, TECTO_DO_AVER, type FonteDeMedia, type UserAddress } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  Call,
  PRESENCA_REAFIRMADA_MS,
  PRESENCA_VALIDA_MS,
  type CallBridge,
  type MediaKeyMaterial,
} from "./call.js"
import {
  MotorSfu,
  RecusaDoSfu,
  type ConsumidorDeMedia,
  type DispositivoDeMedia,
  type ParametrosDoTransporte,
  type ProdutorDeMedia,
  type TransporteDeMedia,
} from "./call-sfu.js"

/**
 * FOUR in a call via SFU, and the fourth must be heard by all three.
 *
 * The SFU path was never exercised above TWO participants: the proofs in
 * `scripts/sfu-prova-fase2/` and `-fase3/` run with one pair, and the
 * eight-person measurement in `scripts/carga-chamada.mjs` is from August 6,
 * 2026, when it was still mesh and SFU did not exist. The production report,
 * three hearing each other and the fourth forever "connecting" to them, falls
 * exactly in that gap.
 *
 * This bench is the path of a client with a gateway pretending to copy,
 * frame by frame, what `apps/server/src/sfu-quatro.test.ts` measured against
 * the real server: whoever joins receives the list of who is already there,
 * whoever produces is announced to ALL the others, and whoever leaves takes
 * their streams with them.
 *
 * **The clock is the instrument.** Each round trip to the server costs a tick,
 * and that is what opens the windows where announcements arrive mid-assembly,
 * where this family of bugs lives.
 */

// ------------------------------------------------------------------ the world

const dormir = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

interface ProdutorNoAmbito {
  id: string
  kind: "audio" | "video"
  address: UserAddress
  fonte: FonteDeMedia
}

interface MembroDoAmbito {
  address: UserAddress
  aoAviso: (aviso: {
    t: "producer.new" | "producer.closed"
    channel: string
    scope: string
    producer: string
    address?: UserAddress
    fonte?: FonteDeMedia
  }) => void
}

/**
 * The gateway pretending: the scopes, the producers, and who gets told what.
 *
 * Copies the rules the real server showed in `sfu-quatro.test.ts`, does not
 * invent them: `scope.join` returns the live producers in the scope with each
 * owner's address; `produce` announces to all other scope members and no one
 * else; `scope.leave` closes the producer streams of whoever is leaving and
 * announces the death.
 */
class Central {
  #ambitos = new Map<string, { membros: Map<string, MembroDoAmbito>; produtores: Map<string, ProdutorNoAmbito> }>()
  #transportes = new Map<string, { chave: string; dono: string }>()
  #proximo = 0
  /** What a round trip to the server costs, in real wall-clock milliseconds. */
  latencia = 0

  /** Everything the gateway did, in order. So the bench can say where it breaks. */
  registo: string[] = []

  #chave(channel: string, scope: string): string {
    return `${channel}|${scope}`
  }

  #ambito(chave: string): { membros: Map<string, MembroDoAmbito>; produtores: Map<string, ProdutorNoAmbito> } {
    let ambito = this.#ambitos.get(chave)
    if (!ambito) {
      ambito = { membros: new Map(), produtores: new Map() }
      this.#ambitos.set(chave, ambito)
    }
    return ambito
  }

  /** A notification to everyone in the scope, except whoever triggered it. Like `#anunciarNoAmbito`. */
  #anunciar(chave: string, excepto: string, aviso: Parameters<MembroDoAmbito["aoAviso"]>[0]): void {
    for (const [id, membro] of this.#ambitos.get(chave)?.membros ?? []) {
      if (id === excepto) continue
      // A socket delivers later, never inside the call that triggered it.
      const destino = membro
      void dormir(this.latencia).then(() => destino.aoAviso(aviso))
    }
  }

  async entrar(
    id: string,
    membro: MembroDoAmbito,
    channel: string,
    scope: string,
  ): Promise<{ rtpCapabilities: unknown; producers: ProdutorNoAmbito[] }> {
    await dormir(this.latencia)
    const chave = this.#chave(channel, scope)
    const ambito = this.#ambito(chave)
    ambito.membros.set(id, membro)
    this.registo.push(`join:${membro.address}`)
    return { rtpCapabilities: {}, producers: [...ambito.produtores.values()] }
  }

  sair(id: string, channel: string, scope: string): void {
    const chave = this.#chave(channel, scope)
    const ambito = this.#ambitos.get(chave)
    if (!ambito?.membros.has(id)) return
    ambito.membros.delete(id)
    for (const [produtorId, produtor] of [...ambito.produtores]) {
      if (this.#donoDoProdutor.get(produtorId) !== id) continue
      ambito.produtores.delete(produtorId)
      this.registo.push(`producer.closed:${produtor.id}`)
      this.#anunciar(chave, id, { t: "producer.closed", channel, scope, producer: produtorId })
    }
  }

  #donoDoProdutor = new Map<string, string>()

  async criarTransporte(id: string, channel: string, scope: string, sentido: "envio" | "recepcao"): Promise<string> {
    await dormir(this.latencia)
    const transporte = `t${this.#proximo++}-${sentido}`
    this.#transportes.set(transporte, { chave: this.#chave(channel, scope), dono: id })
    return transporte
  }

  async produzir(
    id: string,
    address: UserAddress,
    transporte: string,
    kind: "audio" | "video",
    fonte: FonteDeMedia,
  ): Promise<string> {
    await dormir(this.latencia)
    const registo = this.#transportes.get(transporte)
    if (!registo) throw new Error("transporte desconhecido")
    const ambito = this.#ambito(registo.chave)
    const produtor = `p${this.#proximo++}`
    ambito.produtores.set(produtor, { id: produtor, kind, address, fonte })
    this.#donoDoProdutor.set(produtor, id)
    this.registo.push(`produce:${address}:${produtor}`)

    const [channel, scope] = registo.chave.split("|") as [string, string]
    this.#anunciar(registo.chave, id, { t: "producer.new", channel, scope, producer: produtor, address, fonte })
    return produtor
  }

  async fecharProdutor(produtor: string): Promise<void> {
    await dormir(this.latencia)
    for (const [chave, ambito] of this.#ambitos) {
      if (!ambito.produtores.has(produtor)) continue
      ambito.produtores.delete(produtor)
      const [channel, scope] = chave.split("|") as [string, string]
      this.#anunciar(chave, this.#donoDoProdutor.get(produtor) ?? "", {
        t: "producer.closed",
        channel,
        scope,
        producer: produtor,
      })
    }
  }

  /**
   * TIMING refusals, keyed by producer address: the code and how many more times.
   * This is `sfu.consume` that reaches the server out of time (4/11/2026, #984),
   * with a response from a state that has already passed. After that it accepts.
   */
  recusasDoConsumo = new Map<UserAddress, { codigo: string; vezes: number }>()

  async consumir(transporte: string, produtor: string): Promise<{ id: string; kind: "audio" | "video" }> {
    await dormir(this.latencia)
    const registo = this.#transportes.get(transporte)
    if (!registo) throw new Error("transporte desconhecido")
    const ambito = this.#ambito(registo.chave)
    const alvo = ambito.produtores.get(produtor)
    const recusa = alvo ? this.recusasDoConsumo.get(alvo.address) : undefined
    if (recusa && recusa.vezes > 0) {
      recusa.vezes--
      this.registo.push(`consume-recusado:${produtor}:${recusa.codigo}`)
      throw new RecusaDoSfu(recusa.codigo, "esse fluxo não existe nesta chamada")
    }
    // The same refusal as the real engine: a producer that is already dead cannot be consumed.
    if (!alvo) throw new Error("esse fluxo não existe nesta chamada")
    this.registo.push(`consume:${produtor}`)
    return { id: `c-${produtor}-${this.#proximo++}`, kind: alvo.kind }
  }

  async retomar(): Promise<void> {
    await dormir(this.latencia)
  }

  /** Who is who, so the bench can drop a connection by address. */
  #ligacaoDe = new Map<UserAddress, string>()

  registar(address: UserAddress, id: string): void {
    this.#ligacaoDe.set(address, id)
  }

  /**
   * What the gateway does when a socket drops: release this connection's media.
   *
   * This is the `#largarMedia` of `#drop`, not a `sfu.scope.leave`: the streams
   * die and are announced as dead to everyone left, but the ENCRYPTED roster does
   * not know about it. No one called `voice.leave`, and the person stays on
   * everyone else's screen. This difference is what causes the bug.
   */
  largar(address: UserAddress): void {
    const id = this.#ligacaoDe.get(address)
    if (!id) return
    for (const chave of [...this.#ambitos.keys()]) {
      const [channel, scope] = chave.split("|") as [string, string]
      this.sair(id, channel, scope)
    }
  }
}

// ------------------------------------------------------------- the device

/** The `mediasoup-client` pretending. Only what is needed to set up the call. */
class DispositivoFalso implements DispositivoDeMedia {
  readonly rtpCapabilities = { codecs: [] }
  async load(): Promise<void> {}
  canProduce(): boolean {
    return true
  }
  #transporte(id: string): TransporteDeMedia {
    /*
     * The tracks this transport claims as its own.
     *
     * `mediasoup-client` stops a producer's track when it dies, unless whoever
     * produced said `stopTracks: false`. Closing a transport kills the producers
     * under it. A mock that did not copy this rule could not tell the difference
     * between a track that belongs to the engine and one that is borrowed, which
     * is exactly what this proves.
     */
    const minhas: MediaStreamTrack[] = []
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
        // The `mediasoup-client` refusal, word for word: `Transport.produce` throws
        // `InvalidStateError("track ended")` before negotiating anything.
        if (opcoes.track.readyState === "ended") throw new Error("track ended")
        if (opcoes.stopTracks !== false) minhas.push(opcoes.track)
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
          track: { kind: opcoes.kind } as MediaStreamTrack,
          rtpReceiver: {
            createEncodedStreams: () => ({ readable: new ReadableStream(), writable: new WritableStream() }),
          } as unknown as RTCRtpReceiver,
          close: () => {},
        }
      },
      close: () => {
        for (const faixa of minhas.splice(0)) faixa.stop()
      },
    }
  }
  createSendTransport(o: ParametrosDoTransporte): TransporteDeMedia {
    return this.#transporte(o.id)
  }
  createRecvTransport(o: ParametrosDoTransporte): TransporteDeMedia {
    return this.#transporte(o.id)
  }
}

// ------------------------------------------------------------------ a gente

interface Pessoa {
  address: UserAddress
  call: Call
  /** Everything this person put on the wire, in order. */
  enviados: { canal: string; payload: Payload }[]
  /** The last list the UI would draw. */
  listas: {
    address: UserAddress
    connected: boolean
    /** Do we actually have a screen stream from this person? This is the stage. */
    ecra: boolean
    /** She is sharing, whether we asked to see or not? This is the "View" button. */
    oferece: boolean
    /** She said she is seeing OUR screen? This is the "N viewing" counter. */
    aVerONosso: boolean
  }[][]
  diagnosticos: string[]
  /**
   * The consumers that this person ordered the server to PAUSE, in order.
   *
   * This is the only proof that the valve closed on the server side: the stage
   * on this side closes with or without the frame, and what gets lost when it
   * does not arrive is bandwidth that someone pays for while nobody watches. See
   * `sfu.pause` in the protocol.
   */
  pausados: string[]
}

/** The room: people with bridges connected to the same hub and to each other. */
class Sala {
  readonly central = new Central()
  readonly gente: Pessoa[] = []
  /**
   * Who became unreachable without telling anyone.
   *
   * Closing the tab, putting the laptop to sleep or losing network does not send
   * `voice.leave`, and that is exactly when the roster expiry (`#varrerRoster`)
   * is the only thing that removes the person from other people's screens.
   * Without this gate, the bench could only simulate clean exits.
   */
  readonly incomunicaveis = new Set<UserAddress>()
  readonly canal: string
  /**
   * Who each person still does not have media keys from: who asks for them and
   * from whom.
   *
   * This is the leaf that has not yet reached the tree of whoever is asking (the
   * commit that seats someone arrives at each device at its own moment). The
   * peer key: `ana>bruno` is Ana without Bruno's key.
   */
  readonly semChave = new Set<string>()
  /**
   * SFU joins that fail before reaching the server, per person, and with which
   * message. It is the phone's socket dropping again in the middle of the rebuild.
   */
  readonly entradasQueFalham = new Map<UserAddress, string[]>()

  constructor(canal = "!geral:s") {
    this.canal = canal
  }

  criar(nome: string): Pessoa {
    const address = `@${nome}:s` as UserAddress
    const id = `conn-${nome}`
    const listas: Pessoa["listas"] = []
    const enviados: Pessoa["enviados"] = []
    const diagnosticos: string[] = []
    const pausados: string[] = []
    const central = this.central
    const sala = this

    let call: Call
    const ponte: CallBridge = {
      selfAddress: address,
      async sendSignal(canal, payload) {
        // Stored before delivery: there are frames that this bench needs to read
        // on the wire and not by effect, because the effect is on someone else, and
        // the `aVer` list of an announcement can name people who are no longer in the
        // room to receive it. See the block on pruning the screen choice.
        enviados.push({ canal, payload })
        // The server delivers to whoever is subscribed, not to whoever sent it.
        for (const outra of sala.gente) {
          if (outra.address === address) continue
          // Who is unreachable does not send or receive: it is someone's network
          // dying without a goodbye, which is the only way the roster expiry can be
          // measured. See `incomunicaveis`.
          if (sala.incomunicaveis.has(address) || sala.incomunicaveis.has(outra.address)) continue
          const destino = outra
          void dormir(central.latencia).then(() => destino.call.handleSignal(canal, address, payload))
        }
      },
      async mediaKey(_canal, de): Promise<MediaKeyMaterial | null> {
        if (sala.semChave.has(`${address}>${de}`)) return null
        return { keyId: 41, senderId: 0, material: new Uint8Array(32).fill(7) }
      },
      async reservarContadorSframe(): Promise<number> {
        return 0
      },
      sfu: {
        suportaSfu: () => true,
        criarDispositivo: () => new DispositivoFalso(),
        async sfuEntrarNoAmbito(canal, ambito) {
          const falha = sala.entradasQueFalham.get(address)?.shift()
          if (falha !== undefined) {
            await dormir(central.latencia)
            throw new Error(falha)
          }
          return await central.entrar(
            id,
            {
              address,
              aoAviso: (aviso) => {
                void call.handleSfuAviso(aviso)
              },
            },
            canal,
            ambito,
          )
        },
        sfuSairDoAmbito(canal, ambito) {
          central.sair(id, canal, ambito)
        },
        async sfuCriarTransporte(canal, ambito, sentido) {
          const transporte = await central.criarTransporte(id, canal, ambito, sentido)
          return { id: transporte, iceParameters: {}, iceCandidates: [], dtlsParameters: {} }
        },
        async sfuLigarTransporte() {
          await dormir(central.latencia)
        },
        async sfuProduzir(transporte, kind, _rtp, fonte) {
          return await central.produzir(id, address, transporte, kind, fonte ?? "microfone")
        },
        async sfuFecharProdutor(produtor) {
          await central.fecharProdutor(produtor)
        },
        async sfuConsumir(transporte, produtor) {
          const consumido = await central.consumir(transporte, produtor)
          return { id: consumido.id, producerId: produtor, kind: consumido.kind, rtpParameters: {} }
        },
        async sfuRetomar() {
          await central.retomar()
        },
        async sfuPausar(_transporte, consumidor) {
          pausados.push(consumidor)
          await central.retomar()
        },
      },
    }

    central.registar(address, id)
    call = new Call(ponte)
    call.on("participants", (evento) => {
      listas.push(
        evento.participants.map((cada) => ({
          address: cada.address,
          connected: cada.connected,
          ecra: cada.screen !== null,
          oferece: cada.ecraOferecido,
          aVerONosso: cada.aVerONossoEcra,
        })),
      )
    })
    call.on("diagnostic", (evento) => {
      diagnosticos.push(evento.detail ? `${evento.code}:${evento.detail}` : evento.code)
    })
    call.on("error", () => {})

    const pessoa: Pessoa = { address, call, listas, enviados, diagnosticos, pausados }
    this.gente.push(pessoa)
    return pessoa
  }

  /** Let everything that is in flight land. */
  async assentar(voltas = 40): Promise<void> {
    for (let volta = 0; volta < voltas; volta++) await dormir(this.central.latencia)
  }

  async largar(): Promise<void> {
    for (const pessoa of this.gente) await pessoa.call.leave()
  }
}

/** Who this person sees as ONLINE in the last list they drew. */
function ligados(pessoa: Pessoa): string[] {
  return (pessoa.listas.at(-1) ?? [])
    .filter((cada) => cada.connected)
    .map((cada) => cada.address)
    .sort()
}

/** Who this person is actually receiving a shared screen from. */
function comEcra(pessoa: Pessoa): string[] {
  return (pessoa.listas.at(-1) ?? [])
    .filter((cada) => cada.ecra)
    .map((cada) => cada.address)
    .sort()
}

/** Who is OFFERING a screen to them, seen or not: this is the bar with the "View" button. */
function aOferecerEcra(pessoa: Pessoa): string[] {
  return (pessoa.listas.at(-1) ?? [])
    .filter((cada) => cada.oferece)
    .map((cada) => cada.address)
    .sort()
}

/** How many said they are viewing THIS person's screen. This is the "N viewing" counter. */
function espectadores(pessoa: Pessoa): number {
  return (pessoa.listas.at(-1) ?? []).filter((cada) => cada.aVerONosso).length
}

/** Who this person sees on screen, online or "connecting". */
function noEcra(pessoa: Pessoa): string[] {
  return (pessoa.listas.at(-1) ?? []).map((cada) => cada.address).sort()
}

// ------------------------------------------------------------------- stubs

/**
 * A track with STATE, like the browser has.
 *
 * The `readyState` is not decoration: it is what `mediasoup-client` reads to
 * refuse a `produce` with "track ended", and that refusal is what catches anyone
 * who stops a track that is not theirs.
 */
function faixaFalsa(kind: "audio" | "video"): MediaStreamTrack {
  const faixa = {
    kind,
    enabled: true,
    readyState: "live",
    stop(): void {
      faixa.readyState = "ended"
    },
  }
  return faixa as unknown as MediaStreamTrack
}

function fakeStream(): MediaStream {
  const audio = faixaFalsa("audio")
  return {
    getTracks: () => [audio],
    getAudioTracks: () => [audio],
    getVideoTracks: () => [],
  } as unknown as MediaStream
}

beforeEach(() => {
  class SemLigacao {
    localDescription = null
    connectionState = "new"
    ontrack = null
    onicecandidate = null
    onconnectionstatechange = null
    addTrack(): unknown {
      return {}
    }
    addTransceiver(): unknown {
      return { sender: {} }
    }
    async createOffer(): Promise<unknown> {
      return { type: "offer", sdp: "v=0\r\n" }
    }
    async createAnswer(): Promise<unknown> {
      return { type: "answer", sdp: "v=0\r\n" }
    }
    async setLocalDescription(): Promise<void> {}
    async setRemoteDescription(): Promise<void> {}
    async addIceCandidate(): Promise<void> {}
    close(): void {}
  }
  vi.stubGlobal("RTCPeerConnection", SemLigacao)
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
      addTrack(faixa: MediaStreamTrack): void {
        this.tracks.push(faixa)
      }
      removeTrack(faixa: MediaStreamTrack): void {
        const onde = this.tracks.indexOf(faixa)
        if (onde >= 0) this.tracks.splice(onde, 1)
      }
    },
  )
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: async () => fakeStream(),
      // The system selector pretending. A video track with `stop` and
      // `onended` is all that `startScreenShare` touches on it.
      getDisplayMedia: async () => {
        const video = faixaFalsa("video") as MediaStreamTrack & { onended: null }
        video.onended = null
        return {
          id: `ecra-${Math.random().toString(36).slice(2)}`,
          getTracks: () => [video],
          getAudioTracks: () => [],
          getVideoTracks: () => [video],
        } as unknown as MediaStream
      },
    },
  })
})

// -------------------------------------------------------------------- provas

describe("uma chamada de voz a quatro, pelo SFU", () => {
  it("o quarto a entrar é OUVIDO pelos três, e ouve os três", async () => {
    const sala = new Sala()
    const gente = ["ana", "bruno", "carla", "diogo"].map((nome) => sala.criar(nome))

    for (const pessoa of gente) {
      await pessoa.call.join(sala.canal)
      await sala.assentar()
    }
    await sala.assentar()

    for (const pessoa of gente) {
      const outros = gente
        .filter((cada) => cada !== pessoa)
        .map((cada) => cada.address)
        .sort()
      expect(noEcra(pessoa), `${pessoa.address} não vê toda a gente`).toEqual(outros)
      expect(ligados(pessoa), `${pessoa.address} tem alguém eternamente "a ligar"`).toEqual(outros)
    }

    await sala.largar()
  }, 30_000)

  it("e o mesmo com o servidor a demorar uma volta em cada resposta", async () => {
    const sala = new Sala()
    sala.central.latencia = 3
    const gente = ["ana", "bruno", "carla", "diogo"].map((nome) => sala.criar(nome))

    for (const pessoa of gente) {
      await pessoa.call.join(sala.canal)
      await sala.assentar()
    }
    await sala.assentar()

    for (const pessoa of gente) {
      const outros = gente
        .filter((cada) => cada !== pessoa)
        .map((cada) => cada.address)
        .sort()
      expect(ligados(pessoa), `${pessoa.address}: ${JSON.stringify(pessoa.listas.at(-1))}`).toEqual(outros)
    }

    await sala.largar()
  }, 30_000)

  /**
   * The room that was already here before.
   *
   * Leaving and coming back is the most worn path of all, the network fell,
   * the tab closed, the room changed, and it is what crosses old alerts with
   * new ones: the `sfu.producer.closed` from the stream that died arrives after
   * the `producer.new` from the one born, and the encrypted roster has one
   * person with two lives.
   */
  it("quem sai e volta a entrar volta a ser ouvido pelos outros três", async () => {
    const sala = new Sala()
    sala.central.latencia = 2
    const gente = ["ana", "bruno", "carla", "diogo"].map((nome) => sala.criar(nome))

    for (const pessoa of gente) {
      await pessoa.call.join(sala.canal)
      await sala.assentar()
    }
    await sala.assentar()

    const diogo = gente[3]!
    await diogo.call.leave()
    await sala.assentar()

    for (const pessoa of gente.slice(0, 3)) {
      expect(noEcra(pessoa), `${pessoa.address} ainda vê o Diogo`).not.toContain(diogo.address)
    }

    await diogo.call.join(sala.canal)
    await sala.assentar()

    for (const pessoa of gente) {
      const outros = gente
        .filter((cada) => cada !== pessoa)
        .map((cada) => cada.address)
        .sort()
      expect(ligados(pessoa), `${pessoa.address}: ${JSON.stringify(pessoa.listas.at(-1))}`).toEqual(outros)
    }

    await sala.largar()
  }, 30_000)

  /**
   * **The room network flickers, and the server drops the call.**
   *
   * The gateway, when the socket dies, drops EVERYTHING that this connection
   * had in the media engine, scope, transports and producers (`#largarMedia`,
   * from `#drop`). The session reconnects by itself and redoes what it can redo:
   * authenticates, subscribes, recovers what it lost. Media was not on that list.
   *
   * The result is asymmetric, and it is what the owner reported: whoever
   * reconnected stays in everyone's encrypted roster, the heartbeat knows
   * nothing of media and comes back out, but their producer died in the router
   * and nobody recreated it. They reappear on other screens WITHOUT FLOW, which
   * is how you draw someone who entered and has not spoken yet: "connecting…",
   * forever, while everyone else keeps hearing each other.
   *
   * The bench does what the socket does: the server forgets this connection
   * (what `#drop` does), the others receive the death of their flows, and then
   * the call is told that the connection came back.
   */
  it("a rede de um deles pisca, e o caminho de media refaz-se com ela", async () => {
    const sala = new Sala()
    sala.central.latencia = 2
    const gente = ["ana", "bruno", "carla", "diogo"].map((nome) => sala.criar(nome))

    for (const pessoa of gente) {
      await pessoa.call.join(sala.canal)
      await sala.assentar()
    }
    await sala.assentar()

    const diogo = gente[3]!

    // What the gateway does when the socket falls: drops the media from this
    // connection and announces the death of their flows to whoever stayed. The
    // person does NOT leave the encrypted roster, nobody sent `voice.leave`, and
    // their heartbeat comes back.
    sala.central.largar(diogo.address)
    await sala.assentar()

    for (const pessoa of gente.slice(0, 3)) {
      expect(ligados(pessoa), `${pessoa.address} ainda ouve o Diogo`).not.toContain(diogo.address)
      expect(noEcra(pessoa), `${pessoa.address} perdeu o cartão do Diogo`).toContain(diogo.address)
    }

    await diogo.call.ligacaoVoltou()
    await sala.assentar()

    for (const pessoa of gente) {
      const outros = gente
        .filter((cada) => cada !== pessoa)
        .map((cada) => cada.address)
        .sort()
      expect(ligados(pessoa), `${pessoa.address}: ${JSON.stringify(pessoa.listas.at(-1))}`).toEqual(outros)
    }

    await sala.largar()
  }, 30_000)

  it("o socket cai outra vez a meio do refazer: tenta de novo, diz que está a voltar, e não dá o 403", async () => {
    const pausa = Call.PAUSA_ENTRE_REFAZERES_MS
    Call.PAUSA_ENTRE_REFAZERES_MS = 20
    try {
      const sala = new Sala()
      sala.central.latencia = 2
      const gente = ["ana", "bruno", "carla", "diogo"].map((nome) => sala.criar(nome))
      for (const pessoa of gente) {
        await pessoa.call.join(sala.canal)
        await sala.assentar()
      }
      const diogo = gente[3]!
      const erros: string[] = []
      let acabou = false
      diogo.call.on("error", ({ detail }) => erros.push(detail))
      diogo.call.on("ended", () => (acabou = true))

      sala.central.largar(diogo.address)
      await sala.assentar()
      // The first attempt without a connection, the second without an answer, the third gets through.
      sala.entradasQueFalham.set(diogo.address, ["the connection dropped", "the server did not answer in time"])
      const refazer = diogo.call.ligacaoVoltou()
      await sala.assentar(10)
      // The session connected again: the return wakes the wait, and does not queue another rebuild.
      void diogo.call.ligacaoVoltou()
      await refazer
      await sala.assentar()

      expect(erros).toEqual([])
      expect(acabou).toBe(false)
      expect(diogo.diagnosticos.some((linha) => linha.startsWith("call-sfu-a-religar"))).toBe(true)
      expect(diogo.diagnosticos.filter((linha) => linha.startsWith("call-sfu-refazer-tentativa"))).toHaveLength(2)
      expect(diogo.diagnosticos.some((linha) => linha.startsWith("call-sfu-refazer-falhou"))).toBe(false)
      for (const pessoa of gente) {
        const outros = gente
          .filter((cada) => cada !== pessoa)
          .map((cada) => cada.address)
          .sort()
        expect(ligados(pessoa), pessoa.address).toEqual(outros)
      }
      await sala.largar()
    } finally {
      Call.PAUSA_ENTRE_REFAZERES_MS = pausa
    }
  }, 30_000)

  it("três tentativas falhadas: só então o 403, e a chamada acaba", async () => {
    const pausa = Call.PAUSA_ENTRE_REFAZERES_MS
    Call.PAUSA_ENTRE_REFAZERES_MS = 20
    try {
      const sala = new Sala()
      const [ana, bruno] = ["ana", "bruno"].map((nome) => sala.criar(nome)) as [Pessoa, Pessoa]
      await ana.call.join(sala.canal)
      await bruno.call.join(sala.canal)
      await sala.assentar()
      const erros: string[] = []
      let acabou = false
      bruno.call.on("error", ({ detail }) => erros.push(detail))
      bruno.call.on("ended", () => (acabou = true))
      sala.central.largar(bruno.address)
      sala.entradasQueFalham.set(bruno.address, Array(3).fill("the server did not answer in time"))
      await bruno.call.ligacaoVoltou()
      expect(erros).toEqual(["the call dropped and did not come back"])
      expect(acabou).toBe(true)
      expect(bruno.diagnosticos.filter((linha) => linha.startsWith("call-sfu-refazer-tentativa"))).toHaveLength(3)
      await sala.largar()
    } finally {
      Call.PAUSA_ENTRE_REFAZERES_MS = pausa
    }
  }, 30_000)

  it("quem sai a meio das tentativas sai já: não espera pelo resto", async () => {
    const sala = new Sala()
    const [ana, bruno] = ["ana", "bruno"].map((nome) => sala.criar(nome)) as [Pessoa, Pessoa]
    await ana.call.join(sala.canal)
    await bruno.call.join(sala.canal)
    await sala.assentar()
    let acabou = false
    bruno.call.on("ended", () => (acabou = true))
    sala.central.largar(bruno.address)
    // No connection: the wait would be the whole window (30 s).
    sala.entradasQueFalham.set(bruno.address, ["the connection dropped"])
    const refazer = bruno.call.ligacaoVoltou()
    await sala.assentar(10)
    const partiu = Date.now()
    await bruno.call.leave()
    await refazer
    expect(Date.now() - partiu).toBeLessThan(2_000)
    expect(acabou).toBe(true)
    await sala.largar()
  }, 30_000)

  /**
   * And the screen with it.
   *
   * The screen capture survives the socket drop, it is a browser object, not a
   * connection, and with it the operating system's recording indicator, lit.
   * Their producer is what dies in the router. Without the second half of the
   * repair, whoever was sharing would be left with the system indicator on,
   * saying `screen: true` to everyone in `voice.join`, and the stage of the
   * others empty waiting for an image that has no path anymore.
   */
  it("e o ecrã que estava a ser partilhado volta com o resto", async () => {
    const sala = new Sala()
    sala.central.latencia = 2
    const gente = ["ana", "bruno", "carla", "diogo"].map((nome) => sala.criar(nome))

    for (const pessoa of gente) {
      await pessoa.call.join(sala.canal)
      await sala.assentar()
    }
    await sala.assentar()

    const ana = gente[0]!
    expect(await ana.call.startScreenShare()).toBe(true)
    await sala.assentar()

    // All three ASK to view: since October 5, 2026 the screen is not consumed
    // without choice. Without this step there was no flow to lose, and the repair
    // test passed because there was nothing to repair.
    for (const pessoa of gente.slice(1)) await pessoa.call.aceitarEcra(ana.address)
    await sala.assentar()

    for (const pessoa of gente.slice(1)) {
      expect(comEcra(pessoa), `${pessoa.address} não vê o ecrã da Ana`).toEqual([ana.address])
    }

    sala.central.largar(ana.address)
    await sala.assentar()
    await ana.call.ligacaoVoltou()
    await sala.assentar()

    for (const pessoa of gente.slice(1)) {
      expect(comEcra(pessoa), `${pessoa.address} perdeu o ecrã da Ana: ${JSON.stringify(pessoa.listas.at(-1))}`).toEqual(
        [ana.address],
      )
    }
    expect(ana.call.sharingScreen).toBe(true)

    await sala.largar()
  }, 30_000)

  /**
   * The screen by choice, for four, measured by what the SFU routes.
   *
   * Request from the owner on October 5, 2026, after a call with other people:
   * *when someone shares the screen, the others should enter the stream only if
   * they want.* It was automatic, any new producer was consumed without looking
   * at the source, and whoever received it got 2.5 Mbps forced: there is no
   * simulcast or layers (see `media.ts`), so there is no small version of the
   * screen to ask for, and there was nowhere to refuse.
   *
   * **The assertion that counts is the `consume:` in the hub log**, not what
   * `fluxos()` returns: closing a consumer on the client side tells the server
   * nothing, so a test that measured only the stage would pass with the full
   * image coming out of the server and proved nothing. (Here it was written that
   * *"a consumer created and paused already makes the SFU route the image"*,    * that is false: in mediasoup a paused consumer does not send RTP. The
   * conclusion does not change, because what this slice saves in the common case
   * is not consuming at all; what changed was the "Stop viewing", which now
   * PAUSES instead of closing.)
   */
  it("uma partilha a quatro: ninguém recebe o ecrã até o pedir, e quem partilha conta quem vê", async () => {
    const sala = new Sala()
    sala.central.latencia = 2
    const gente = ["ana", "bruno", "carla", "diogo"].map((nome) => sala.criar(nome))

    for (const pessoa of gente) {
      await pessoa.call.join(sala.canal)
      await sala.assentar()
    }
    await sala.assentar()

    const [ana, bruno, carla, diogo] = gente as [Pessoa, Pessoa, Pessoa, Pessoa]
    expect(await ana.call.startScreenShare()).toBe(true)
    await sala.assentar()

    // The screen producer exists on the server, and you know which one it is.
    const produtorDoEcra = sala.central.registo
      .filter((passo) => passo.startsWith(`produce:${ana.address}:`))
      .map((passo) => passo.split(":").at(-1) as string)
      .at(-1) as string
    expect(produtorDoEcra).toBeDefined()

    // ------------------------------------------------------ and nobody receives it
    for (const pessoa of [bruno, carla, diogo]) {
      expect(comEcra(pessoa), `${pessoa.address} recebeu um ecrã que não pediu`).toEqual([])
      // But they know it exists: it is the bar with "X is sharing the screen".
      expect(aOferecerEcra(pessoa), `${pessoa.address} não soube da oferta`).toEqual([ana.address])
    }
    expect(
      sala.central.registo.filter((passo) => passo === `consume:${produtorDoEcra}`),
      "o SFU foi mandado encaminhar o ecrã sem ninguém o pedir",
    ).toEqual([])
    // And whoever is sharing knows that nobody is viewing, which is what matters
    // to know before talking ten minutes to a screen.
    expect(espectadores(ana)).toBe(0)

    // ------------------------------------------------------------ one clicks View
    await bruno.call.aceitarEcra(ana.address)
    await sala.assentar()

    expect(comEcra(bruno)).toEqual([ana.address])
    expect(sala.central.registo.filter((passo) => passo === `consume:${produtorDoEcra}`)).toHaveLength(1)
    // Bruno's announcement says he is viewing, and that is why Ana counts him.
    expect(espectadores(ana), `a Ana não contou o Bruno: ${JSON.stringify(ana.listas.at(-1))}`).toBe(1)

    // ------------------------------------------------- another refusal, and still not receiving
    await carla.call.recusarEcra(ana.address)
    await sala.assentar()

    expect(comEcra(carla)).toEqual([])
    // One request to the server in this whole scene: Bruno's.
    expect(sala.central.registo.filter((passo) => passo === `consume:${produtorDoEcra}`)).toHaveLength(1)
    expect(espectadores(ana)).toBe(1)

    // ------------------------------------------------------- and the third did not respond
    // Diogo did nothing, and that is the most common case: the offer stays, and it
    // costs no bandwidth while nobody clicks.
    expect(comEcra(diogo)).toEqual([])
    expect(aOferecerEcra(diogo)).toEqual([ana.address])

    // --------------------------------------- and whoever was viewing stops viewing
    await bruno.call.recusarEcra(ana.address)
    await sala.assentar()
    expect(comEcra(bruno)).toEqual([])
    // The offer comes back, so you can view again.
    expect(aOferecerEcra(bruno)).toEqual([ana.address])
    expect(espectadores(ana), "a Ana continuou a contar quem já não vê").toBe(0)

    await sala.largar()
  }, 30_000)

  /**
   * The set of screen choices PRUNES, and the list has a cap.
   *
   * `#ecrasAceites` counts distinct people who have already shared and been
   * accepted, not people present. In a permanent voice room with rotation, which
   * is the use case for this app, an afternoon passes through more than sixteen,
   * and the scheme refuses an `aVer` list larger than `TECTO_DO_AVER`.
   *
   * **And refusing here is not a truncated field.** `encodePayload` does
   * `Payload.parse`, so it THROWS: at the seventeenth name `#anunciar` breaks,
   * `reafirmarPresenca` swallows the exception in a diagnostic, no `voice.join`
   * of ours comes back, and at 160 s everyone removes us from the roster by
   * their `#varrerRoster`. We become invisible and inaudible while we keep
   * sending media, and there is no recovery without leaving and coming back.
   *
   * That is why you measure here what GOES ON THE WIRE, `pessoa.enviados`,    * and not the effect on someone else's screen: the defect is precisely the
   * list naming people who are no longer in the room to observe it.
   */
  describe("a escolha de ver um ecrã, quando quem o partilhava sai", () => {
    /** The last `voice.join` that this person put on the wire. */
    const ultimoAnuncio = (pessoa: Pessoa): Extract<Payload, { t: "voice.join" }> => {
      const anuncio = [...pessoa.enviados].reverse().find((saiu) => saiu.payload.t === "voice.join")
      if (!anuncio || anuncio.payload.t !== "voice.join") throw new Error("esta pessoa nunca se anunciou")
      return anuncio.payload
    }

    it("sai do `aVer` quando ela se despede", async () => {
      const sala = new Sala()
      sala.central.latencia = 1
      const [ana, bruno] = ["ana", "bruno"].map((nome) => sala.criar(nome)) as [Pessoa, Pessoa]
      for (const pessoa of [ana, bruno]) {
        await pessoa.call.join(sala.canal)
        await sala.assentar()
      }

      expect(await ana.call.startScreenShare()).toBe(true)
      await sala.assentar()
      await bruno.call.aceitarEcra(ana.address)
      await sala.assentar()
      expect(ultimoAnuncio(bruno).aVer).toEqual([ana.address])

      // Ana says goodbye. Her `voice.leave` removes her from Bruno's roster, and
      // it has to take his choice to view her screen with it.
      await ana.call.leave()
      await sala.assentar()

      // Bruno's next announcement cannot name who is no longer there.
      bruno.enviados.length = 0
      bruno.call.setMuted(true)
      await sala.assentar()
      expect(ultimoAnuncio(bruno).aVer).toBeUndefined()

      await sala.largar()
    }, 30_000)

    it("e também quando o servidor diz que ela se desligou sem se despedir", async () => {
      /*
        The path of someone who closes the tab: there is no `voice.leave`, and
        the server's presence alert is the only thing that arrives. It was the
        third exit gate, and it had no pruning.
      */
      const sala = new Sala()
      sala.central.latencia = 1
      const [ana, bruno] = ["ana", "bruno"].map((nome) => sala.criar(nome)) as [Pessoa, Pessoa]
      for (const pessoa of [ana, bruno]) {
        await pessoa.call.join(sala.canal)
        await sala.assentar()
      }
      expect(await ana.call.startScreenShare()).toBe(true)
      await sala.assentar()
      await bruno.call.aceitarEcra(ana.address)
      await sala.assentar()
      expect(ultimoAnuncio(bruno).aVer).toEqual([ana.address])

      bruno.call.desligouSeDoServidor(ana.address)
      bruno.enviados.length = 0
      bruno.call.setMuted(true)
      await sala.assentar()

      expect(ultimoAnuncio(bruno).aVer).toBeUndefined()

      await sala.largar()
    }, 30_000)

    it("e quando a presença dela caduca no roster", async () => {
      /*
        The fourth gate, and the one that needs the clock: `#varrerRoster` throws
        away anyone who does not reaffirm within `PRESENCA_VALIDA_MS`, and it is
        the safety net for when neither `voice.leave` nor the server's alert
        arrived. The clock is fake with `shouldAdvanceTime`, because this bench
        delivers frames by `setTimeout` and a stopped clock would stop the whole
        call before it existed.
      */
      vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1 })
      try {
        const sala = new Sala()
        sala.central.latencia = 1
        const [ana, bruno] = ["ana", "bruno"].map((nome) => sala.criar(nome)) as [Pessoa, Pessoa]
        for (const pessoa of [ana, bruno]) {
          await pessoa.call.join(sala.canal)
          await sala.assentar()
        }
        expect(await ana.call.startScreenShare()).toBe(true)
        await sala.assentar()
        await bruno.call.aceitarEcra(ana.address)
        await sala.assentar()
        expect(ultimoAnuncio(bruno).aVer).toEqual([ana.address])

        /*
          Ana vanishes without saying goodbye: her network dies, so neither
          `voice.leave` nor her heartbeat reach Bruno. She drops from the room
          without calling `leave()` on purpose, a `voice.leave` would remove her
          from the roster instantly and there would be no expiry to measure.
        */
        sala.incomunicaveis.add(ana.address)
        await vi.advanceTimersByTimeAsync(PRESENCA_VALIDA_MS + PRESENCA_REAFIRMADA_MS)
        expect(bruno.diagnosticos.some((cada) => cada.startsWith("call-presenca-caducou"))).toBe(true)

        /*
          Now we read the stream, with the clock ticking one more beat.

          The heartbeat and the sweep have the same period and start at the same
          instant, so on a shared tick it does not matter which runs first, an
          announcement that goes out immediately before the prune carries Ana away
          with it, and that is not a bug. What must hold true is the announcement
          after the prune.
        */
        bruno.enviados.length = 0
        await vi.advanceTimersByTimeAsync(PRESENCA_REAFIRMADA_MS + 10)
        expect(ultimoAnuncio(bruno).aVer).toBeUndefined()

        /*
          The tap closed on the SERVER, which is what sets this gate apart from
          the other three.

          In the others, media dies with whoever left and the server says so: a
          `voice.leave` brings a `sfu.scope.leave` with it, and a connection that
          drops brings the gateway's `#largarMedia`. Here what expired was the
          ENCRYPTED roster, and on this board Ana still has her producer running
          at the hub, so without this pause we would have a consumer at 2.5 Mbps
          with no way to name it, and with our own `aVer` already saying we are
          not watching it.
        */
        expect(bruno.pausados).toHaveLength(1)

        await ana.call.leave()
        await sala.largar()
      } finally {
        vi.useRealTimers()
      }
    }, 30_000)

    it("e a lista que sai ao fio nunca nomeia quem não está na chamada", async () => {
      /*
        THE INTERSECTION, which is what started to do the count.
        
        Twenty accepted people is the state of a permanent room at end of day,         and accepting does not require the person to be present, which is
        exactly how the bug took shape. While this happened only by prune, a
        `delete` at each exit gate, a forgotten gate would cost the whole call in
        silence: at the seventeenth name `encodePayload` throws from inside
        `#anunciar`, no `voice.join` of ours goes out, and at 160 s everyone
        removes us from the roster.
        
        Now the announcement crosses the choice with both rosters, where
        presence is KNOWN, and the cap can no longer be hit by a missing prune:
        the `slice(0, TECTO_DO_AVER)` stays as a belt over the suspenders. This
        change is what let us drop the prune from the `#drop` gate, which also
        runs on repairs where the person stays.
        
        We measure what GOES ON THE WIRE, `pessoa.enviados`, not the effect on
        another person's screen: the bug is precisely that the list names people
        no longer in the room to see it.
        */
      const sala = new Sala()
      sala.central.latencia = 1
      const [ana, bruno] = ["ana", "bruno"].map((nome) => sala.criar(nome)) as [Pessoa, Pessoa]
      for (const pessoa of [ana, bruno]) {
        await pessoa.call.join(sala.canal)
        await sala.assentar()
      }

      // A real screen, from someone actually in the room: this is the only name that
      // can go on the wire.
      expect(await ana.call.startScreenShare()).toBe(true)
      await sala.assentar()
      await bruno.call.aceitarEcra(ana.address)
      // And twenty choices from people in no room at all.
      for (let i = 0; i < 20; i++) await bruno.call.aceitarEcra(`@quem-${i}:s` as UserAddress)
      await sala.assentar()

      const anuncio = ultimoAnuncio(bruno)
      expect(anuncio.aVer).toEqual([ana.address])
      // The belt, asserted where it lives: the cut stays there, and we never need
      // to apply it.
      expect(anuncio.aVer?.length ?? 0).toBeLessThanOrEqual(TECTO_DO_AVER)
      // The assertion that holds: the announcement must PASS the schema, because
      // `Payload.parse` is what `encodePayload` runs before putting it on the wire.
      expect(() => Payload.parse(anuncio)).not.toThrow()

      await sala.largar()
    }, 30_000)
  })

  it("quatro a entrarem ao mesmo tempo ouvem-se todos", async () => {
    const sala = new Sala()
    sala.central.latencia = 1
    const gente = ["ana", "bruno", "carla", "diogo"].map((nome) => sala.criar(nome))

    await Promise.all(gente.map((pessoa) => pessoa.call.join(sala.canal)))
    await sala.assentar(80)

    for (const pessoa of gente) {
      const outros = gente
        .filter((cada) => cada !== pessoa)
        .map((cada) => cada.address)
        .sort()
      expect(ligados(pessoa), `${pessoa.address}: ${JSON.stringify(pessoa.listas.at(-1))}`).toEqual(outros)
    }

    await sala.largar()
  }, 30_000)
})

/**
 * Someone this device still does not know how to hear (owner report, 3/11/2026).
 *
 * Bruno's consumption is set up on Ana's side before his sheet reaches her
 * tree. Before this the stream came in unencrypted, the interface said
 * "connected", and the key that arrived in the next commit changed nothing: Ana
 * did not hear Bruno until she left and rejoined.
 */
describe("uma recusa de tempo do servidor ao consumo (4/11/2026, #984)", () => {
  /**
   * The owner report across the whole `Call`: "the user hears me but I do not
   * hear them". Ana's first `sfu.consume` to Bruno is refused by the server with
   * `produtor-desconhecido`, and the second is accepted. Until 1.3.0 the refusal
   * was final: Bruno heard Ana, Ana never heard Bruno again until she left and
   * rejoined.
   */
  it("o servidor recusa a primeira vez e aceita a segunda: a Ana passa a ouvir o Bruno sem sair", async () => {
    const sala = new Sala()
    const ana = sala.criar("ana")
    const bruno = sala.criar("bruno")
    sala.central.recusasDoConsumo.set(bruno.address, { codigo: "produtor-desconhecido", vezes: 1 })

    await bruno.call.join(sala.canal)
    await sala.assentar()
    await ana.call.join(sala.canal)
    await sala.assentar()

    // Wait for the first retry, nothing more: no leaving or rejoining. (Bruno's
    // `voice.join` also wakes the retry, and may arrive first.)
    await dormir(MotorSfu.ESPERAS_DO_CONSUMO_MS[0]! + 50)
    await sala.assentar()

    // The refusal was written with the server code and message.
    expect(ana.diagnosticos.some((linha) => linha.startsWith("sfu-consumo-recusado:") && linha.includes("produtor-desconhecido"))).toBe(true)
    expect(sala.central.registo.filter((linha) => linha.startsWith("consume-recusado:"))).toHaveLength(1)
    expect(ligados(bruno)).toEqual([ana.address])
    expect(ligados(ana)).toEqual([bruno.address])
    expect(ana.diagnosticos.some((linha) => linha.startsWith("sfu-consumo-recuperado:"))).toBe(true)
    expect(ana.diagnosticos.some((linha) => linha.startsWith("sfu-consumo-falhou:"))).toBe(false)

    await sala.largar()
  }, 30_000)

  it("enquanto o servidor recusar, o Bruno está na chamada mas não «ligado»", async () => {
    const sala = new Sala()
    const ana = sala.criar("ana")
    const bruno = sala.criar("bruno")
    sala.central.recusasDoConsumo.set(bruno.address, { codigo: "produtor-desconhecido", vezes: 99 })

    await bruno.call.join(sala.canal)
    await sala.assentar()
    await ana.call.join(sala.canal)
    await sala.assentar()

    expect(ana.diagnosticos.some((linha) => linha.startsWith("sfu-consumo-em-falta:") && linha.includes(bruno.address))).toBe(true)
    expect(noEcra(ana)).toEqual([bruno.address])
    expect(ligados(ana)).toEqual([])
    expect(ligados(bruno)).toEqual([ana.address])

    // The server stops refusing: the next retry opens the audio.
    sala.central.recusasDoConsumo.clear()
    await dormir(MotorSfu.ESPERAS_DO_CONSUMO_MS[1]! + MotorSfu.ESPERAS_DO_CONSUMO_MS[0]! + 100)
    await sala.assentar()
    expect(ligados(ana)).toEqual([bruno.address])

    await sala.largar()
  }, 30_000)

  it("uma recusa final continua final: não se repete, e o Bruno fica «sem som»", async () => {
    const sala = new Sala()
    const ana = sala.criar("ana")
    const bruno = sala.criar("bruno")
    sala.central.recusasDoConsumo.set(bruno.address, { codigo: "incompativel", vezes: 99 })

    await bruno.call.join(sala.canal)
    await sala.assentar()
    await ana.call.join(sala.canal)
    await sala.assentar()
    await dormir(MotorSfu.ESPERAS_DO_CONSUMO_MS[0]! + 50)
    await sala.assentar()

    expect(sala.central.registo.filter((linha) => linha.startsWith("consume-recusado:"))).toHaveLength(1)
    expect(ligados(ana)).toEqual([])
    expect(ana.diagnosticos.some((linha) => linha.startsWith("sfu-consumo-falhou:") && linha.includes("incompativel"))).toBe(true)

    await sala.largar()
  }, 30_000)
})

describe("quem entra antes de a chave dele chegar", () => {
  it("não aparece ligado sem chave, e passa a ouvir-se no commit seguinte", async () => {
    const sala = new Sala()
    const ana = sala.criar("ana")
    const bruno = sala.criar("bruno")
    sala.semChave.add(`${ana.address}>${bruno.address}`)

    await bruno.call.join(sala.canal)
    await sala.assentar()
    await ana.call.join(sala.canal)
    await sala.assentar()

    // In the call (the roster says so) but no audio, and we don't pretend there is.
    expect(noEcra(ana)).toEqual([bruno.address])
    expect(ligados(ana)).toEqual([])
    expect(ana.diagnosticos).toContain(`sfu-receptor-sem-chave:${bruno.address}`)
    // Bruno hears Ana: the fault is only on one side.
    expect(ligados(bruno)).toEqual([ana.address])

    // The commit that gives Ana Bruno's sheet: the epoch changes and she rotates the keys.
    sala.semChave.clear()
    await ana.call.rekey(sala.canal)
    await sala.assentar()

    expect(ligados(ana)).toEqual([bruno.address])
    expect(ana.diagnosticos).toContain(`sfu-receptor-protegido-depois:${bruno.address}`)

    await sala.largar()
  }, 30_000)
})

/*
 * SEC-02 across the whole `Call`: encryption is required to publish.
 *
 * Without our key there is no SFrame, and with SFU that was media the server
 * could read. Nothing goes out without encryption, and that did not change.
 * What changed on 4/11/2026 is what happens next: until 1.3.0 join failed right
 * away with 448; now the call stays up (you hear who is there), voice tries
 * again, and publishes when the key arrives. Only at the retry limit does the
 * call drop with 448. It does not drop for mesh, and we measure it: a client on
 * SFU ignores mesh offers (`call-sfu-oferta-de-malha`), so mesh would give a
 * call where nobody hears each other.
 */
describe("a cifra é condição para publicar, no Call", () => {
  const esperas = MotorSfu.ESPERAS_DA_CIFRA_MS
  beforeEach(() => {
    // Short, so the real clock on this board hits the limit.
    MotorSfu.ESPERAS_DA_CIFRA_MS = [20, 20]
  })
  afterEach(() => {
    MotorSfu.ESPERAS_DA_CIFRA_MS = esperas
  })

  it("sem chave nossa, a chamada fica de pé sem a nossa voz, e a voz sai cifrada quando a chave chega", async () => {
    const sala = new Sala()
    const ana = sala.criar("ana")
    const bruno = sala.criar("bruno")
    await bruno.call.join(sala.canal)
    await sala.assentar()
    sala.semChave.add(`${ana.address}>${ana.address}`)

    await ana.call.join(sala.canal)
    await sala.assentar(4)

    // Ana hears Bruno; his voice has not reached the server yet.
    expect(ana.call.channel).toBe(sala.canal)
    expect(ligados(ana)).toEqual([bruno.address])
    expect(sala.central.registo.filter((passo) => passo.startsWith(`produce:${ana.address}:`))).toEqual([])
    expect(ana.diagnosticos.some((linha) => linha.startsWith("sfu-emissor-cifra-a-repetir:microfone"))).toBe(true)

    // The commit that gives her the sheet: the key arrives, and voice plays without Ana doing anything.
    sala.semChave.clear()
    await ana.call.rekey(sala.canal)
    await sala.assentar()

    expect(sala.central.registo.filter((passo) => passo.startsWith(`produce:${ana.address}:`))).toHaveLength(1)
    expect(ana.diagnosticos.some((linha) => linha.startsWith("sfu-emissor-cifra-recuperada:microfone"))).toBe(true)
    expect(ligados(bruno)).toEqual([ana.address])
    expect(ana.call.channel).toBe(sala.canal)

    await sala.largar()
  }, 30_000)

  it("e só no tecto das tentativas a chamada cai com o 448, sem o microfone ter chegado ao servidor", async () => {
    const sala = new Sala()
    const ana = sala.criar("ana")
    const erros: string[] = []
    ana.call.on("error", (evento) => erros.push(evento.detail))
    sala.semChave.add(`${ana.address}>${ana.address}`)

    await ana.call.join(sala.canal)
    await vi.waitFor(() => expect(ana.call.channel).toBeNull(), { timeout: 5_000 })

    expect(erros).toEqual(["the call media could not be encrypted"])
    expect(sala.central.registo.filter((passo) => passo.startsWith(`produce:${ana.address}:`))).toEqual([])
    expect(ana.diagnosticos).toContain("sfu-emissor-recusado-sem-cifra:microfone")
    expect(ana.diagnosticos).toContain("call-sfu-voz-sem-cifra")
  }, 30_000)
})

/*
 * SEC-03 across the whole `Call`: who leaves the channel in the middle of an
 * SFU call.
 *
 * Until 1.2.0 `rekey` only wrote `call-fora-do-canal`: her consumer kept
 * playing, her key stayed, and the server kept sending her media. Here, removal
 * is her session no longer having her sheet (`mediaKey` returns `null`), which
 * is what MLS does after the commit that removes her.
 */
describe("quem sai do canal a meio de uma chamada por SFU", () => {
  it("deixa de se ouvir e de se ver no commit que a tira, e o servidor pára de a mandar", async () => {
    const sala = new Sala()
    const ana = sala.criar("ana")
    const bruno = sala.criar("bruno")
    const carla = sala.criar("carla")
    for (const pessoa of [ana, bruno, carla]) {
      await pessoa.call.join(sala.canal)
      await sala.assentar()
    }
    expect(ligados(ana)).toEqual([bruno.address, carla.address].sort())

    // The commit that removes carla: ana's session no longer has her sheet.
    sala.semChave.add(`${ana.address}>${carla.address}`)
    await ana.call.rekey(sala.canal)
    await sala.assentar()

    expect(ligados(ana)).toEqual([bruno.address])
    expect(ana.diagnosticos).toContain(`call-fora-do-canal:${carla.address}`)
    expect(ana.diagnosticos).toContain(`sfu-revogado:${carla.address}`)
    // The tap closed on the server: her voice consumer is paused.
    expect(ana.pausados.some((consumidor) => consumidor.includes(produtorDe(sala, carla)))).toBe(true)

    await sala.largar()
  }, 30_000)

  it("seja qual for a presença no roster: quem nunca se anunciou também deixa de ser consumido", async () => {
    const sala = new Sala()
    const ana = sala.criar("ana")
    const carla = sala.criar("carla")
    // carla's `voice.join` never reaches ana: she is outside ana's roster, but
    // the server presents her producer and ana consumes it.
    sala.incomunicaveis.add(carla.address)
    await ana.call.join(sala.canal)
    await sala.assentar()
    await carla.call.join(sala.canal)
    await sala.assentar()
    expect(ana.diagnosticos.some((linha) => linha.startsWith("sfu-revogado"))).toBe(false)

    sala.semChave.add(`${ana.address}>${carla.address}`)
    await ana.call.rekey(sala.canal)
    await sala.assentar()

    expect(ana.diagnosticos).toContain(`sfu-revogado:${carla.address}`)
    expect(ana.pausados.some((consumidor) => consumidor.includes(produtorDe(sala, carla)))).toBe(true)

    await sala.largar()
  }, 30_000)

  it("um reassento (sem folha num commit, com outra no seguinte) continua a ouvir-se", async () => {
    const sala = new Sala()
    const ana = sala.criar("ana")
    const carla = sala.criar("carla")
    await ana.call.join(sala.canal)
    await sala.assentar()
    await carla.call.join(sala.canal)
    await sala.assentar()
    expect(ligados(ana)).toEqual([carla.address])

    sala.semChave.add(`${ana.address}>${carla.address}`)
    await ana.call.rekey(sala.canal)
    await sala.assentar()
    expect(ligados(ana)).toEqual([])

    // The next commit seats her in another leaf.
    sala.semChave.clear()
    await ana.call.rekey(sala.canal)
    await sala.assentar()
    expect(ligados(ana)).toEqual([carla.address])

    await sala.largar()
  }, 30_000)
})

/** The device id of this person's microphone, as the hub gave it. */
function produtorDe(sala: Sala, pessoa: Pessoa): string {
  const passo = sala.central.registo.find((cada) => cada.startsWith(`produce:${pessoa.address}:`))
  if (!passo) throw new Error(`${pessoa.address} não produziu nada`)
  return passo.split(":").at(-1)!
}
