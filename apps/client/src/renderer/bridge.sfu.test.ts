import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The DESKTOP bridge actually wires SFU to the call engine.
 *
 * The criterion for these tests is not "the core works", that's proven in
 * `packages/client-core`, with mutations. It's **erase the wiring line, the test
 * dies.**
 *
 * This is where the gap lived. Until August 17, 2026 only `apps/web` delivered
 * the SFU path: in the installed app all calls ran over mesh against any server,
 * even with `hello.ok` advertising the capability. **Nothing broke**, and that's
 * what makes this gap expensive to find, a feature that simply doesn't happen
 * doesn't complain. It was in this bridge that we found `applyMediaPrefs` was
 * never implemented, and that noise suppression never worked in the installed
 * app, not ever.
 *
 * So the `Call` here is the REAL one, not a mock that logs what you pass. A mock
 * proves the bridge wrote a field; what matters is proving a call made in the
 * installed app actually goes through SFU.
 */

/** The `mediasoup-client` faking it, the one from HOST, which is what the bridge injects. */
const dispositivos: DispositivoFalso[] = []

class DispositivoFalso {
  readonly rtpCapabilities = { codecs: [] }
  /** What the router negotiates. See `MotorSfu.podeVideo`. */
  static video = true
  constructor() {
    dispositivos.push(this)
  }
  async load(): Promise<void> {}
  canProduce(kind: "audio" | "video"): boolean {
    return kind === "audio" || DispositivoFalso.video
  }
  #transporte(id: string): unknown {
    let aoLigar: ((d: { dtlsParameters: unknown }, feito: () => void, falhou: (e: Error) => void) => void) | null = null
    let aoProduzir:
      | ((
          d: { kind: string; rtpParameters: unknown; appData: Record<string, unknown> },
          feito: (r: { id: string }) => void,
          falhou: (e: Error) => void,
        ) => void)
      | null = null

    // The `connect` and `produce` of `mediasoup-client` MUST fire: they're what
    // crosses signaling. A fake silent would measure an assembly that never talks
    // to the server, and pass with a bridge delivering nothing.
    const fecharDtls = async (): Promise<void> => {
      const ligar = aoLigar
      aoLigar = null
      if (ligar) await new Promise<void>((resolve, reject) => ligar({ dtlsParameters: {} }, resolve, reject))
    }

    return {
      id,
      on: (evento: string, ouvinte: unknown) => {
        if (evento === "connect") aoLigar = ouvinte as typeof aoLigar
        else aoProduzir = ouvinte as typeof aoProduzir
      },
      produce: async (opcoes: {
        track: { kind: string }
        appData?: Record<string, unknown>
        onRtpSender?: (emissor: unknown) => void
      }) => {
        // Like `mediasoup-client`: the sender is born before the offer and goes to `onRtpSender` (SEC-02).
        const emissor = emissorFalso()
        opcoes.onRtpSender?.(emissor)
        await fecharDtls()
        // The `kind` comes from the track and `appData` is echoed, like in the real
        // library: that's how the source crosses IPC to the gateway.
        const feito = await new Promise<{ id: string }>((resolve, reject) =>
          aoProduzir?.(
            { kind: opcoes.track.kind, rtpParameters: {}, appData: opcoes.appData ?? {} },
            resolve,
            reject,
          ),
        )
        return { id: feito.id, rtpSender: emissor, close: () => {} }
      },
      consume: async (opcoes: { id: string; producerId: string }) => {
        await fecharDtls()
        return {
          id: opcoes.id,
          producerId: opcoes.producerId,
          track: { kind: "audio" },
          rtpReceiver: emissorFalso(),
          close: () => {},
        }
      },
      close: () => {},
    }
  }
  createSendTransport(o: { id: string }): unknown {
    return this.#transporte(o.id)
  }
  createRecvTransport(o: { id: string }): unknown {
    return this.#transporte(o.id)
  }
}

/**
 * What the cipher hangs on the transform: it just needs to accept the request.
 *
 * It's also the `RTCRtpSender` of this engine, see `beforeEach`. Both roles are
 * the same object on purpose: in a real browser, the sender the producer
 * delivers IS an instance of the engine's `RTCRtpSender`. Separating them would
 * leave the test bench claiming this Electron can't encrypt while delivering
 * senders that can, and in that gap fit the bug that later gave
 * `createEncodedStreams is not a function` in production.
 */
class EmissorComCifra {
  createEncodedStreams(): { readable: ReadableStream; writable: WritableStream } {
    return { readable: new ReadableStream(), writable: new WritableStream() }
  }
}

function emissorFalso(): unknown {
  return new EmissorComCifra()
}

vi.mock("mediasoup-client", () => ({ Device: DispositivoFalso }))
vi.mock("@enclave/ui", () => ({ registerSystemNoticeHost: () => {} }))

/** Peer-to-peer connections that the mesh builds. With SFU they must be zero. */
class LigacaoFalsa {
  static instancias: LigacaoFalsa[] = []
  connectionState = "new"
  localDescription: unknown = null
  ontrack: unknown = null
  onicecandidate: unknown = null
  onconnectionstatechange: unknown = null
  constructor() {
    LigacaoFalsa.instancias.push(this)
  }
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
  async setLocalDescription(d: unknown): Promise<void> {
    this.localDescription = d
  }
  async setRemoteDescription(): Promise<void> {}
  async addIceCandidate(): Promise<void> {}
  close(): void {}
}

/** The Electron host: the other process, pretending. */
function anfitriao(): {
  pedidos: string[]
  capacidade: boolean
  avisar: (aviso: unknown) => void
  aVoz: (evento: unknown) => void
  /** The state of the server connection, along the path where it arrives. */
  aLigacao: (state: string) => void
  inscritos: string[]
  sinais: unknown[]
} {
  const pedidos: string[] = []
  const inscritos: string[] = []
  const sinais: unknown[] = []
  let aoAviso: ((carga: unknown) => void) | null = null
  let aoVoz: ((carga: unknown) => void) | null = null
  let aoLigar: ((carga: unknown) => void) | null = null

  const nada = (): (() => void) => (): void => {}
  const host = {
    pedidos,
    inscritos,
    sinais,
    capacidade: false,
    avisar: (aviso: unknown) => aoAviso?.(aviso),
    /** A `voice.*` from someone else, along the path where it actually arrives. */
    aVoz: (evento: unknown) => aoVoz?.(evento),
    aLigacao: (state: string) => aoLigar?.({ state }),
    vault: {},
    identity: {},
    session: {},
    channels: {},
    social: {},
    notifications: {},
    notify: { show: async () => ({ shown: false }) },
    invites: {},
    profile: {},
    voice: {
      signal: async (_canal: string, carga: unknown) => {
        sinais.push(carga)
        return { ok: true }
      },
      key: async () => ({ keyId: 41, senderId: 0, material: new Uint8Array(32).fill(7) }),
      reservarContador: async () => 0,
      setActive: async () => ({ ok: true }),
      ice: async () => [],
    },
    sfu: {
      suporta: async (): Promise<boolean> => {
        pedidos.push("suporta?")
        return host.capacidade
      },
      entrar: async (channel: string, scope: string) => {
        pedidos.push(`entrar:${channel}:${scope}`)
        return { rtpCapabilities: { codecs: [] }, producers: [] }
      },
      sair: async (channel: string, scope: string) => {
        pedidos.push(`sair:${channel}:${scope}`)
        return { ok: true }
      },
      criarTransporte: async (_c: string, _s: string, direction: string) => {
        pedidos.push(`transporte:${direction}`)
        return { id: `t-${direction}`, iceParameters: {}, iceCandidates: [], dtlsParameters: {} }
      },
      ligarTransporte: async (transport: string) => {
        pedidos.push(`ligar:${transport}`)
        return { ok: true }
      },
      produzir: async (transport: string, _kind: string, _rtp: unknown, fonte?: string) => {
        pedidos.push(`produzir:${transport}:${fonte ?? "sem-fonte"}`)
        return `p-${fonte ?? "nosso"}`
      },
      fecharProdutor: async (producer: string) => {
        pedidos.push(`fechar:${producer}`)
        return { ok: true }
      },
      consumir: async (_t: string, producer: string) => {
        pedidos.push(`consumir:${producer}`)
        return { id: `c-${producer}`, producerId: producer, kind: "audio" as const, rtpParameters: {} }
      },
      retomar: async (_t: string, consumer: string) => {
        pedidos.push(`retomar:${consumer}`)
        return { ok: true }
      },
    },
    on: {
      message: nada(),
      epoch: nada(),
      status: nada(),
      connection: (handler: (carga: unknown) => void) => {
        inscritos.push("connection")
        aoLigar = handler
        return () => {
          aoLigar = null
        }
      },
      channels: nada(),
      presence: nada(),
      typing: nada(),
      buzz: nada(),
      voice: (handler: (carga: unknown) => void) => {
        aoVoz = handler
        return () => {
          aoVoz = null
        }
      },
      noticeOpen: nada(),
      windowState: nada(),
      ecraPedido: nada(),
      sfu: (handler: (carga: unknown) => void) => {
        inscritos.push("sfu")
        aoAviso = handler
        return () => {
          aoAviso = null
        }
      },
    },
  }
  return host
}

const CANAL = "!geral:s"

let host: ReturnType<typeof anfitriao>

const { createDesktopBridge } = await import("./bridge.js")

beforeEach(() => {
  dispositivos.length = 0
  LigacaoFalsa.instancias = []
  host = anfitriao()
  Object.defineProperty(window, "enclaveHost", { value: host, writable: true, configurable: true })

  const faixa = { kind: "audio", enabled: true, stop: vi.fn() }
  vi.stubGlobal("RTCPeerConnection", LigacaoFalsa)
  vi.stubGlobal("RTCRtpSender", EmissorComCifra)
  vi.stubGlobal("RTCRtpReceiver", EmissorComCifra)
  DispositivoFalso.video = true
  vi.stubGlobal(
    "MediaStream",
    class {
      readonly tracks: { kind: string }[]
      constructor(tracks: { kind: string }[] = []) {
        this.tracks = [...tracks]
      }
      getTracks(): { kind: string }[] {
        return [...this.tracks]
      }
      addTrack(faixa: { kind: string }): void {
        if (!this.tracks.includes(faixa)) this.tracks.push(faixa)
      }
      removeTrack(faixa: { kind: string }): void {
        const onde = this.tracks.indexOf(faixa)
        if (onde >= 0) this.tracks.splice(onde, 1)
      }
    },
  )
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: async () => ({
        getTracks: () => [faixa],
        getAudioTracks: () => [faixa],
        getVideoTracks: () => [],
      }),
    },
  })
})

describe("com a capacidade anunciada, a aplicação instalada usa o SFU", () => {
  it("negoceia com o servidor, e não constrói malha nenhuma", async () => {
    host.capacidade = true
    const bridge = createDesktopBridge()

    await bridge.call.join(CANAL)

    // The full path, built by IPC: enter the scope, both transports,
    // and our voice on air. Without the `sfu:` line in the bridge this is an empty list.
    expect(host.pedidos).toContain("transporte:envio")
    expect(host.pedidos).toContain("transporte:recepcao")
    expect(host.pedidos.some((cada) => cada.startsWith("entrar:"))).toBe(true)
    expect(host.pedidos).toContain("produzir:t-envio:microfone")

    // And the mesh did not run: zero `RTCPeerConnection` objects built by this
    // code. Without this second half the test passed with a client that
    // did both things at the same time.
    expect(LigacaoFalsa.instancias).toEqual([])

    await bridge.call.leave()
  })
})

/**
 * The connection comes back, and the bridge orders the media path to be rebuilt.
 *
 * When the socket dies, the gateway drops everything that connection had in
 * the media engine. The session reconnects by itself and rebuilds what it can;
 * media was not on that list. Without this line the person's producer dies in
 * the router and nobody recreates it: they stay in the encrypted roster of others,  * heartbeat knows nothing about media, and reappear on their screens WITHOUT
 * STREAM, "connecting..." forever, while they keep hearing each other.
 */
describe("a ligação que volta refaz o caminho de media, também na aplicação", () => {
  it("depois de uma queda, a chamada é montada outra vez pelo IPC", async () => {
    host.capacidade = true
    const bridge = createDesktopBridge()
    await bridge.call.join(CANAL)

    const antes = host.pedidos.length
    host.aLigacao("reconnecting")
    host.aLigacao("online")
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The full path again, not half: without `produce` the person comes back
    // silent, which is the fault this fixes.
    const depois = host.pedidos.slice(antes)
    expect(depois.some((cada) => cada.startsWith("entrar:"))).toBe(true)
    expect(depois).toContain("transporte:envio")
    expect(depois).toContain("transporte:recepcao")
    expect(depois).toContain("produzir:t-envio:microfone")

    await bridge.call.leave()
  })

  it("e um `online` que não vem depois de uma queda não desmonta nada", async () => {
    host.capacidade = true
    const bridge = createDesktopBridge()
    await bridge.call.join(CANAL)

    host.aLigacao("online")
    await new Promise((resolve) => setTimeout(resolve, 0))
    const antes = host.pedidos.length

    // The server restates the state without anything having failed. Rebuilding there would
    // tear down and put back up a call that works.
    host.aLigacao("online")
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(host.pedidos.slice(antes)).toEqual([])

    await bridge.call.leave()
  })
})

describe("os avisos do SFU chegam ao motor de chamada", () => {
  it("quem entra DEPOIS de nós é consumido, e não fica em silêncio", async () => {
    host.capacidade = true
    const bridge = createDesktopBridge()

    await bridge.call.join(CANAL)
    const antes = host.pedidos.length

    // The gateway announces a new stream. This is the only path where it
    // arrives: the encrypted roster says who is in the call, but who says
    // there is new media to route is the server, because it routes it.
    host.avisar({
      t: "producer.new",
      channel: CANAL,
      scope: (host.pedidos.find((cada) => cada.startsWith("entrar:")) ?? "").split(":").pop(),
      producer: "p-outro",
      kind: "audio",
      address: "@outro:s",
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    /*
      Without subscribing to `on.sfu`, the call connects, you hear anyone already
      there, and nobody who joins AFTER is heard, never, and **without an error
      anywhere**. It is the quietest failure in this layer: all green, and half the
      call is silent.

      **The `ligar:t-recepcao` is in the middle, and it is the right behavior.** The
      `connect` event from `mediasoup-client` is lazy: it fires on the first `produce`
      or `consume`, not on transport creation. A receive transport where nothing is
      ever consumed never closes DTLS, there is nothing to carry, and that is why
      the first person heard is also the one who pays for the connection. See the
      comment on `#criarTransporte` in `call-sfu.ts`.

      The whole order is intentional, not just the presence of consume: `retomar`
      MUST come last, because the consumer starts paused and anything passing before
      the decryption is installed arrives encrypted at the decoder.
    */
    expect(host.pedidos.slice(antes)).toEqual(["consumir:p-outro", "ligar:t-recepcao", "retomar:c-p-outro"])

    await bridge.call.leave()
  })

  it("a ponte inscreve-se mesmo no acontecimento `sfu` do anfitrião", () => {
    // The assertion that kills the test if someone deletes `host.on.sfu(…)`. The one above
    // measures what happens AFTER the listener exists; this one measures that it does.
    createDesktopBridge()
    // The order is the order of the lines in `bridge.ts`, and the entire thing is
    // asserted: one more or one fewer subscription shows up here before it shows
    // up in a call.
    expect(host.inscritos).toEqual(["sfu", "connection"])
  })
})

/**
 * The mandatory proof: a server WITHOUT SFU keeps working exactly as it does
 * today in the installed app.
 *
 * This is not a compatibility formality. The deployment rule is server first,
 * client second, the same as restarting the device chain, and it only works
 * if a new client against a server without SFU is INDISTINGUISHABLE from the
 * old client. And the installed app is the only client that does not fix itself
 * with an F5: a version that negotiates with a port that does not exist stays
 * broken until someone reinstalls.
 */
describe("um servidor SEM SFU: a aplicação instalada faz malha, como sempre", () => {
  it("constrói a ligação par-a-par, e não toca no caminho do SFU", async () => {
    host.capacidade = false
    const bridge = createDesktopBridge()

    await bridge.call.join(CANAL)
    // Someone else announces themselves, along the path where announcements
    // actually arrive. This is what makes the mesh negotiate; without someone on
    // the other end there is no peer to build and the test measures nothing.
    host.aVoz({
      channel: CANAL,
      from: "@bruno:s",
      payload: { t: "voice.join", at: Date.now(), video: false, sframe: true, alone: true },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The proof is twofold, and both halves are needed. That the mesh ran:
    expect(LigacaoFalsa.instancias.length).toBeGreaterThan(0)
    expect(host.sinais.some((cada) => (cada as { t?: string }).t === "voice.offer")).toBe(true)

    /*
      And the SFU was never touched. Without this second half the test would pass
      with a client doing both at once, the worst failure possible, because it
      works in tests and breaks the call for whoever is on the other end.
      
      Asking for the capability is the only request that could have happened, and
      it must have: it is the gate closing. What cannot exist is a `entrar:`, a
      `transporte:`, or a `produzir:`.
      */
    expect(host.pedidos).toEqual(["suporta?"])

    await bridge.call.leave()
  })

  it("e um servidor que anda para trás fecha o portão sozinho, na mesma ponte", async () => {
    // A rollback in production, an old container starting up, a media worker
    // that died. The bridge is the SAME object, the app did not restart, and the
    // only thing that changed is on the other side of IPC.
    host.capacidade = true
    const bridge = createDesktopBridge()

    await bridge.call.join(CANAL)
    expect(host.pedidos).toContain("transporte:envio")
    await bridge.call.leave()

    host.capacidade = false
    const antes = host.pedidos.length

    await bridge.call.join(CANAL)

    /*
      Not a single media request beyond the capability question. This is what a
      capability stored at bridge construction cannot do: we asked once, it was
      "yes" forever, and the next call negotiates with an engine that no longer exists.
      This is why the answer is a promise read on each entry instead of a boolean
      read on startup.
    */
    expect(host.pedidos.slice(antes)).toEqual(["suporta?"])
    // And screen sharing becomes possible again, which is how you see the
    // engine actually crashed and not just that nobody asked it for anything.
    expect(bridge.call.podePartilharEcra).toBe(true)

    await bridge.call.leave()
  })
})

/**
 * Screen sharing in the installed app, via SFU.
 *
 * Phase 3.3 left this spelled out as a known loss: "screen sharing in the
 * installed app will REFUSE when the server has SFU, and that is by design,  * but it means whoever installs this against a server with SFU loses the
 * sharing they had yesterday". This is the end of that window, measured along
 * the path the installed app uses: IPC.
 *
 * **What can only be measured here** is the source crossing the boundary. The
 * producer's `appData` is an object that IPC's `structuredClone` copies, and
 * a source lost along the way would show a screen announced as camera, on
 * the 190 by 128 card of whoever is watching, with the edges cut.
 */
describe("a partilha de ecrã na aplicação instalada", () => {
  /** The screen capture that the renderer's `getDisplayMedia` returns. */
  function ecraFalso(): unknown {
    const video = { kind: "video", enabled: true, stop: vi.fn(), onended: null }
    return {
      id: "ecra-falso",
      getTracks: () => [video],
      getAudioTracks: () => [],
      getVideoTracks: () => [video],
    }
  }

  function comSelector(): { aberturas: () => number } {
    let aberturas = 0
    const anterior = navigator.mediaDevices
    vi.stubGlobal("navigator", {
      mediaDevices: {
        ...anterior,
        getDisplayMedia: async () => {
          aberturas += 1
          return ecraFalso()
        },
      },
    })
    return { aberturas: () => aberturas }
  }

  it("produz o ecrã pelo SFU, com a fonte a atravessar o IPC", async () => {
    host.capacidade = true
    const selector = comSelector()
    const bridge = createDesktopBridge()

    await bridge.call.join(CANAL)
    expect(await bridge.call.startScreenShare()).toBe(true)

    expect(selector.aberturas()).toBe(1)
    // The source reached the main process. Without it, the gateway reads the `kind` and
    // calls it a camera, which is what a lost `appData` in IPC would produce.
    expect(host.pedidos).toContain("produzir:t-envio:ecra")

    await bridge.call.leave()
  })

  it("parar de partilhar atravessa o IPC, e não morre no renderer", async () => {
    host.capacidade = true
    comSelector()
    const bridge = createDesktopBridge()

    await bridge.call.join(CANAL)
    await bridge.call.startScreenShare()
    await bridge.call.stopScreenShare()

    expect(host.pedidos).toContain("fechar:p-ecra")

    await bridge.call.leave()
  })

  it("contra um servidor que só encaminha voz, continua a recusar antes do selector", async () => {
    // The Phase 3.3 refusal did not go away: its reason changed, and now it is about
    // THIS server instead of about the entire path.
    host.capacidade = true
    DispositivoFalso.video = false
    const selector = comSelector()
    const bridge = createDesktopBridge()

    await bridge.call.join(CANAL)
    expect(await bridge.call.startScreenShare()).toBe(false)
    expect(selector.aberturas()).toBe(0)

    await bridge.call.leave()
  })
})
