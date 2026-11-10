import { readHeader } from "@enclave/crypto"
import type { UserAddress } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { caminhoDaCifra, cifraDeMediaEmFalta, CifraDeMedia, type FonteDeChaves } from "./media-sframe.js"
import { servirCifraDeMedia, type EscopoDoWorker, type OrdemDeCifra } from "./media-sframe-worker.js"

/**
 * Encipherment via the standard path: `RTCRtpScriptTransform`, in a worker.
 *
 * That's what opens the SFU to Firefox and Safari. Neither has
 * `createEncodedStreams`; both have this gate, measured 18 August 2026
 * with `scripts/sfu-script-transform-por-motor.mjs`, which counts OPENED
 * frames on the other side (299 and 303, with zero opening when the key is
 * wrong).
 *
 * **Here the main thread connects to the worker FOR REAL, not to a mock.** The
 * `servirCifraDeMedia` that runs in these tests is the same one that runs in
 * the browser, and messages go through the same protocol. A mock worker that
 * answered "ready" to everything would measure `CifraDeMedia` talking to itself
 *, and the half that matters, the one that reuses keys instead of rebuilding
 * senders, lives on the far side.
 */

const ALICE = "alice@casa" as UserAddress
const BRUNO = "bruno@casa" as UserAddress

/** Stable key material, so we can compare what went through. */
const material = (semente: number): Uint8Array => new Uint8Array(28).fill(semente)

/**
 * A mock worker ON THE OUTSIDE, with the real service on the inside.
 *
 * **Messages go through ASYNCHRONOUSLY, like in a browser.** The first version
 * of this delivered them synchronously, and the result was an order test that
 * measured no order at all: remove the `await` that waits for the key before
 * hanging the transform, the line this whole task depends on, and the test
 * stayed green, because synchronous delivery put the key there anyway. A mock
 * too helpful is a bench that measures the mock itself.
 *
 * And the `log` records when the worker RECEIVES the order, not when it's sent.
 * Those are different moments, and the second one doesn't matter: what protects
 * frames is the key being installed, not having been mailed.
 */
function workerComServico(): {
  worker: Worker
  recebidas: OrdemDeCifra[]
  escopo: EscopoDoWorker
  /** Push an order to the worker by hand, without going through `CifraDeMedia`. */
  entregar: (ordem: OrdemDeCifra) => void
} {
  const paraOWorker: ((evento: { data: unknown }) => void)[] = []
  const paraOPrincipal: ((evento: MessageEvent) => void)[] = []
  const recebidas: OrdemDeCifra[] = []

  const maisTarde = (fazer: () => void): void => {
    setTimeout(fazer, 0)
  }

  const escopo: EscopoDoWorker = {
    onrtctransform: null,
    addEventListener: (_tipo, ouvinte) => paraOWorker.push(ouvinte),
    postMessage: (mensagem) =>
      maisTarde(() => {
        for (const ouvinte of paraOPrincipal) ouvinte({ data: mensagem } as MessageEvent)
      }),
  }
  servirCifraDeMedia(escopo)

  const worker = {
    addEventListener: (_tipo: string, ouvinte: (evento: MessageEvent) => void) => paraOPrincipal.push(ouvinte),
    postMessage: (mensagem: OrdemDeCifra) => {
      recebidas.push(mensagem)
      maisTarde(() => {
        // Logged at RECEIPT, and in the same log as the transform: it's the order
        // between the two things that these tests exist to measure.
        rasto.push(`ordem:${mensagem.t}`)
        for (const ouvinte of paraOWorker) ouvinte({ data: mensagem })
      })
    },
    terminate: () => {},
  } as unknown as Worker

  const entregar = (ordem: OrdemDeCifra): void => {
    for (const ouvinte of paraOWorker) ouvinte({ data: ordem })
  }

  return { worker, recebidas, escopo, entregar }
}

/** What was happening, in order. Order is what these tests measure. */
let rasto: string[] = []

/**
 * A media endpoint with the property where the transform hangs.
 *
 * **Accessor on the PROTOTYPE, not an instance field.** That's what the three
 * engines actually have, measured, `Object.getOwnPropertyDescriptor(...).set`
 * exists on all three, and that's what the guard asks, because it decides
 * BEFORE any endpoint is built. An instance field would give a mock that passed
 * the tests and an engine the guard refused: exactly the gap where `class {}`
 * already cost this project dear twice.
 */
class PontaComTransform {
  #transform: unknown = null
  get transform(): unknown {
    return this.#transform
  }
  set transform(valor: unknown) {
    this.#transform = valor
  }
}

function motorSemInsertableStreams(): void {
  // No `createEncodedStreams` in prototypes, HAS `transform`: it's Firefox, and
  // it's the engine this task exists to serve.
  vi.stubGlobal("RTCRtpSender", PontaComTransform)
  vi.stubGlobal("RTCRtpReceiver", PontaComTransform)
  vi.stubGlobal(
    "RTCRtpScriptTransform",
    class {
      constructor(
        readonly worker: Worker,
        readonly options: unknown,
      ) {
        rasto.push(`transformação:${(options as { papel: string }).papel}`)
      }
    },
  )
}

/**
 * A Chromium, and a Chromium has BOTH.
 *
 * **Both, not just the insertable streams.** A mock that had only the
 * `createEncodedStreams` would make the question "which of the two do we
 * pick?" vanish, there aren't two, and the test that says Chromium stays
 * on the measured path would go green even with the preference backwards.
 * Verified by mutation: with the poor mock, swapping the choice order didn't
 * light a single red light.
 */
function motorComInsertableStreams(): void {
  class MotorQueCifraDasDuasManeiras extends PontaComTransform {
    createEncodedStreams(): unknown {
      return { readable: new ReadableStream(), writable: new WritableStream() }
    }
  }
  vi.stubGlobal("RTCRtpSender", MotorQueCifraDasDuasManeiras)
  vi.stubGlobal("RTCRtpReceiver", MotorQueCifraDasDuasManeiras)
  vi.stubGlobal(
    "RTCRtpScriptTransform",
    class {
      constructor(
        readonly worker: Worker,
        readonly options: unknown,
      ) {
        rasto.push(`transformação:${(options as { papel: string }).papel}`)
      }
    },
  )
}

function fonte(worker: Worker | null, chaves = new Map<UserAddress, number>()): FonteDeChaves {
  chaves.set(ALICE, chaves.get(ALICE) ?? 1)
  return {
    selfAddress: ALICE,
    mediaKey: async (_canal, address) => {
      const semente = chaves.get(address)
      if (semente === undefined) return null
      return { keyId: semente, senderId: address === ALICE ? 0 : 1, material: material(semente) }
    },
    reservarContadorSframe: async () => 100,
    ...(worker ? { criarWorkerDeCifra: () => worker } : {}),
  }
}

beforeEach(() => {
  rasto = []
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("a guarda pergunta pelos DOIS caminhos, e basta um", () => {
  it("um motor com insertable streams continua a passar, e escolhe esse caminho", () => {
    motorComInsertableStreams()
    expect(cifraDeMediaEmFalta()).toBeNull()
    // Chromium has BOTH. Switching its path risked the only platform that today
    // enters via SFU to solve the problem for two others.
    expect(caminhoDaCifra(() => ({}) as Worker)).toBe("insertable")
  })

  it("um Firefox COM worker sabe cifrar, e é isto que abre o SFU aos outros motores", () => {
    motorSemInsertableStreams()
    const { worker } = workerComServico()
    expect(cifraDeMediaEmFalta(() => worker)).toBeNull()
    expect(caminhoDaCifra(() => worker)).toBe("worker")
  })

  it("um Firefox SEM worker não sabe cifrar, e a mensagem manda arranjar o host", () => {
    motorSemInsertableStreams()
    const emFalta = cifraDeMediaEmFalta()
    expect(emFalta).not.toBeNull()
    /*
     * The difference the message has to make: an old engine has no fix, but an
     * engine with the API and no worker is THIS code wired wrong. Without this
     * written, the two failures read as the same and the second stayed broken.
     */
    expect(emFalta).toContain("o host não sabe criar o worker")
    expect(caminhoDaCifra()).toBe("nenhum")
  })

  it("um motor sem nenhum dos dois continua a cair para a malha", () => {
    vi.stubGlobal("RTCRtpSender", class {})
    vi.stubGlobal("RTCRtpReceiver", class {})
    expect(cifraDeMediaEmFalta(() => ({}) as Worker)).toContain("sem RTCRtpScriptTransform")
    expect(caminhoDaCifra(() => ({}) as Worker)).toBe("nenhum")
  })
})

describe("a cifra instala-se pelo caminho do worker", () => {
  it("a chave chega ao worker ANTES de a transformação ser pendurada", async () => {
    motorSemInsertableStreams()
    const { worker, recebidas } = workerComServico()
    const cifra = new CifraDeMedia(fonte(worker), (code) => rasto.push(`diag:${code}`))
    cifra.canal = "geral"

    const sender = new PontaComTransform() as unknown as RTCRtpSender
    expect(await cifra.protegerEmissor(sender)).toBe(true)

    /*
     * Order is the substance of this task, not a detail.
     *
     * Once the transformation is running, frames start flowing through it. If the key
     * is not yet in place, the worker discards them, and what you hear on the other
     * end is a silent call with the connection still active, the most expensive failure
     * this project knows how to diagnose.
     */
    expect(rasto.at(-1)).toBe("transformação:emissor")
    expect(rasto.slice(0, -1).every((passo) => passo === "ordem:emissor")).toBe(true)
    expect(rasto).toContain("ordem:emissor")
    expect(sender.transform).not.toBeNull()
  })

  it("o receptor leva o endereço nas opções, que é como o worker escolhe a chave", async () => {
    motorSemInsertableStreams()
    const { worker, recebidas } = workerComServico()
    const cifra = new CifraDeMedia(fonte(worker, new Map([[BRUNO, 7]])))
    cifra.canal = "geral"

    const receptor = new PontaComTransform() as unknown as RTCRtpReceiver
    expect(await cifra.protegerReceptor(receptor, BRUNO)).toBe(true)

    const ordem = recebidas.find((cada) => cada.t === "receptor")
    expect(ordem).toMatchObject({ t: "receptor", address: BRUNO })
    // Same order as the sender, for the same reason: the consumer starts paused and only
    // resumes after this, but the key must be in place first.
    expect(rasto.at(-1)).toBe("transformação:receptor")
    expect(rasto).toContain("ordem:receptor")
  })

  it("uma rotação de epoch leva a chave nova ao worker", async () => {
    motorSemInsertableStreams()
    const { worker, recebidas } = workerComServico()
    const chaves = new Map<UserAddress, number>([[ALICE, 1]])
    const cifra = new CifraDeMedia(fonte(worker, chaves))
    cifra.canal = "geral"

    await cifra.protegerEmissor(new PontaComTransform() as unknown as RTCRtpSender)
    chaves.set(ALICE, 2)
    await cifra.rodar([])

    /*
     * Without this line, the main thread rotates the key but the worker keeps
     * encrypting with the old one: anyone removed from the channel keeps hearing
     * the call, which is exactly what key rotation exists to prevent.
     */
    const emissores = recebidas.filter((cada) => cada.t === "emissor")
    expect(emissores.some((ordem) => ordem.t === "emissor" && ordem.chave.keyId === 1)).toBe(true)
    expect(emissores.at(-1)).toMatchObject({ chave: { keyId: 2 } })
  })

  it("um worker mudo não pendura nada, e não deixa a entrada pendurada", async () => {
    motorSemInsertableStreams()
    // A worker that accepts commands but never replies: a file that didn't load, or
    // a startup error. Without a timeout, the `join` would wait forever with the
    // microphone on and the panel open.
    const mudo = { addEventListener: () => {}, postMessage: () => {}, terminate: () => {} } as unknown as Worker
    const cifra = new CifraDeMedia(fonte(mudo), (code) => rasto.push(`diag:${code}`))
    cifra.canal = "geral"

    vi.useFakeTimers()
    const promessa = cifra.protegerEmissor(new PontaComTransform() as unknown as RTCRtpSender)
    await vi.advanceTimersByTimeAsync(6000)
    vi.useRealTimers()

    expect(await promessa).toBe(false)
    expect(rasto).toContain("diag:sframe-worker-mudo")
    expect(rasto).not.toContain("transformação:emissor")
  })
})

describe("o worker não reconstrói o que já tem", () => {
  /** Pass frames through the transformation the worker installed, and see what comes out. */
  async function passarPor(
    escopo: EscopoDoWorker,
    opcoes: { papel: "emissor" } | { papel: "receptor"; address: UserAddress },
    frames: Uint8Array[],
  ): Promise<Uint8Array[]> {
    const saidos: Uint8Array[] = []
    let fechar: () => void = () => {}
    const readable = new ReadableStream<{ data: ArrayBuffer }>({
      start(controlador) {
        for (const bytes of frames) controlador.enqueue({ data: bytes.slice().buffer })
        fechar = () => controlador.close()
      },
    })
    const writable = new WritableStream<{ data: ArrayBuffer }>({
      write(frame) {
        saidos.push(new Uint8Array(frame.data))
      },
    })
    escopo.onrtctransform?.({ transformer: { readable, writable, options: opcoes } })
    fechar()
    // Let the pipeline drain: these are promises, not timeouts.
    for (let volta = 0; volta < 50 && saidos.length < frames.length; volta++) await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 10))
    return saidos
  }

  const assentar = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10))

  it("a MESMA chave outra vez não recomeça o contador — é a repetição de nonce que isto impede", async () => {
    const { escopo, entregar } = workerComServico()
    const chave = { keyId: 1, senderId: 0, material: material(3) }

    entregar({ t: "emissor", eco: 1, chave, contador: 100 })
    await assentar()
    const primeiros = await passarPor(escopo, { papel: "emissor" }, [new Uint8Array([1, 2, 3])])
    expect(readHeader(primeiros[0]!)?.counter).toBe(100)

    /*
     * The same key again, in a different object, that's how it arrives after
     * crossing the worker boundary.
     *
     * The main thread only sends a new command when the key changes, but "only sends
     * when" is a promise in a different file, and THIS is the line where damage would
     * happen: a rebuilt sender puts the counter back at 100 and wastes every nonce
     * again. In AES-GCM a repeated nonce reveals the XOR of the two plaintexts and
     * lets you forge authenticated frames.
     */
    entregar({ t: "emissor", eco: 2, chave: { ...chave, material: material(3) }, contador: 100 })
    await assentar()
    const segundos = await passarPor(escopo, { papel: "emissor" }, [new Uint8Array([4, 5, 6])])
    expect(readHeader(segundos[0]!)?.counter).toBe(101)
  })

  it("uma chave DIFERENTE monta emissor novo, e começa onde a reserva mandar", async () => {
    const { escopo, entregar } = workerComServico()

    entregar({ t: "emissor", eco: 1, chave: { keyId: 1, senderId: 0, material: material(3) }, contador: 100 })
    await assentar()
    await passarPor(escopo, { papel: "emissor" }, [new Uint8Array([1, 2, 3])])

    // Another epoch, another key material: here rebuilding is correct, and not
    // rebuilding would mean encrypting with the key of someone already gone from
    // the channel.
    entregar({ t: "emissor", eco: 2, chave: { keyId: 2, senderId: 0, material: material(4) }, contador: 500 })
    await assentar()
    const depois = await passarPor(escopo, { papel: "emissor" }, [new Uint8Array([4, 5, 6])])
    expect(readHeader(depois[0]!)?.keyId).toBe(2)
    expect(readHeader(depois[0]!)?.counter).toBe(500)
  })

  it("o que o emissor fecha, o receptor abre — e com a chave errada não abre nada", async () => {
    const chave = { keyId: 1, senderId: 0, material: material(5) }
    const claro = new Uint8Array([9, 8, 7, 6, 5])

    const lado = workerComServico()
    lado.entregar({ t: "emissor", eco: 1, chave, contador: 0 })
    await assentar()
    const cifrados = await passarPor(lado.escopo, { papel: "emissor" }, [claro])
    expect(cifrados).toHaveLength(1)
    expect(cifrados[0]!.length).toBeGreaterThan(claro.length)

    const certo = workerComServico()
    certo.entregar({ t: "receptor", eco: 1, address: BRUNO, chaves: [chave] })
    await assentar()
    const abertos = await passarPor(certo.escopo, { papel: "receptor", address: BRUNO }, cifrados)
    expect(abertos).toHaveLength(1)
    expect([...abertos[0]!]).toEqual([...claro])

    /*
     * The check that makes the green above matter: with the wrong key, the
     * AES-GCM tag doesn't close and no frame comes out. It's the same half
     * the three-engine probe runs with a swapped key.
     */
    const errado = workerComServico()
    errado.entregar({ t: "receptor", eco: 1, address: BRUNO, chaves: [{ ...chave, material: material(6) }] })
    await assentar()
    expect(await passarPor(errado.escopo, { papel: "receptor", address: BRUNO }, cifrados)).toHaveLength(0)
  })
})
