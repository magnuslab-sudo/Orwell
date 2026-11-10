import { bytesEmClaroDoVp8, importSframeKey, SframeReceiver, SframeSender } from "@enclave/crypto"
import type { UserAddress } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CifraDeMedia, type MaterialDeChave } from "./media-sframe.js"
import { servirCifraDeMedia, type EscopoDoWorker } from "./media-sframe-worker.js"

/**
 * Media cipher with two devices on the same account, with video.
 *
 * Two halves of 1.0.6, on both paths (insertable streams and worker):
 *
 *  1. Alice's two devices in the same call each encrypt with the key from
 *     THEIR leaf (see `Session.mediaKey`). Anyone listening has to open both:
 *     a person's key chain now has one entry per leaf, and the key is chosen
 *     by the `keyId`/`senderId` pair the frame declares. Before, it chose by
 *     `keyId` alone, and the second device's frames went to the first device's key
 *     and were rejected.
 *  2. A video frame goes out with the VP8 header in cleartext, so the SFU and
 *     Chrome know what's a keyframe (see `bytesEmClaroDoVp8`).
 */

const EU = "@eu:enclave.test" as UserAddress
const ALICE = "@alice:enclave.test" as UserAddress
const CANAL = "!sala:enclave.test"

function material(byte: number, keyId: number, senderId: number): MaterialDeChave {
  return { keyId, senderId, material: new Uint8Array(28).fill(byte) }
}

/** Alice's leaves: the laptop at 3, the phone at 5. The first is 3. */
const FOLHAS: Record<number, MaterialDeChave> = { 3: material(30, 41, 3), 5: material(50, 41, 5) }

function fonte(criarWorkerDeCifra?: () => Worker) {
  const pedidas: (number | undefined)[] = []
  return {
    pedidas,
    fonte: {
      selfAddress: EU,
      mediaKey: async (_canal: string, address: UserAddress, folha?: number) => {
        if (address === EU) return material(1, 41, 0)
        if (address !== ALICE) return null
        pedidas.push(folha)
        return folha === undefined ? FOLHAS[3]! : (FOLHAS[folha] ?? null)
      },
      reservarContadorSframe: async () => 0,
      ...(criarWorkerDeCifra ? { criarWorkerDeCifra } : {}),
    },
  }
}

type FrameDeTeste = { data: ArrayBuffer; type?: string }

function fluxos(): { ponta: RTCRtpReceiver; empurrar: (frame: FrameDeTeste) => void; saida: Uint8Array[] } {
  const saida: Uint8Array[] = []
  let controlador!: ReadableStreamDefaultController<FrameDeTeste>
  const readable = new ReadableStream<FrameDeTeste>({
    start(controller) {
      controlador = controller
    },
  })
  const writable = new WritableStream<FrameDeTeste>({
    write(frame) {
      saida.push(new Uint8Array(frame.data))
    },
  })
  const ponta = { createEncodedStreams: () => ({ readable, writable }) } as unknown as RTCRtpReceiver
  return { ponta, saida, empurrar: (frame) => controlador.enqueue(frame) }
}

async function assentar(condicao: () => boolean, voltas = 400): Promise<void> {
  for (let volta = 0; volta < voltas && !condicao(); volta++) await new Promise((r) => setTimeout(r, 1))
}

async function emissor(chave: MaterialDeChave): Promise<SframeSender> {
  return new SframeSender(await importSframeKey(chave.material, chave.keyId, chave.senderId))
}

function vp8(chave: boolean, marca: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(40).fill(marca)
  bytes[0] = chave ? 0x10 : 0x31
  return bytes
}

class PontaInsertable {
  createEncodedStreams(): unknown {
    throw new Error("as pontas destes testes trazem os seus fluxos")
  }
}

beforeEach(() => {
  vi.stubGlobal("RTCRtpSender", PontaInsertable)
  vi.stubGlobal("RTCRtpReceiver", PontaInsertable)
})
afterEach(() => vi.unstubAllGlobals())

/** Speak from both devices, interleaved, and return how many frames went out. */
async function falarPelosDois(empurrar: (frame: FrameDeTeste) => void, voltas: number): Promise<number> {
  const portatil = await emissor(FOLHAS[3]!)
  const telemovel = await emissor(FOLHAS[5]!)
  let enviados = 0
  for (let volta = 0; volta < voltas; volta++) {
    // Both start at counter 0: it's exactly the case in the report.
    empurrar({ data: (await portatil.encrypt(new Uint8Array([3, volta]) as Uint8Array<ArrayBuffer>)).buffer })
    empurrar({ data: (await telemovel.encrypt(new Uint8Array([5, volta]) as Uint8Array<ArrayBuffer>)).buffer })
    enviados += 2
    await new Promise((r) => setTimeout(r, 2))
  }
  return enviados
}

describe("dois aparelhos da mesma conta, pelas insertable streams", () => {
  it("quem ouve abre os frames dos dois aparelhos, cada um com a chave da sua folha", async () => {
    const { fonte: f, pedidas } = fonte()
    const diagnosticos: string[] = []
    const cifra = new CifraDeMedia(f, (code) => diagnosticos.push(code))
    cifra.canal = CANAL
    const receptor = fluxos()
    expect(await cifra.protegerReceptor(receptor.ponta, ALICE)).toBe(true)

    await falarPelosDois(receptor.empurrar, 30)
    await assentar(() => receptor.saida.filter((f) => f[0] === 5).length >= 25)

    const doPortatil = receptor.saida.filter((frame) => frame[0] === 3).length
    const doTelemovel = receptor.saida.filter((frame) => frame[0] === 5).length
    expect(doPortatil).toBe(30)
    // The phone's first frame asks for leaf 5's key; from then on it opens.
    expect(doTelemovel).toBeGreaterThanOrEqual(25)
    expect(pedidas).toContain(5)
    expect(diagnosticos).toContain("sframe-chave-recuperada")
    expect(diagnosticos).not.toContain("sframe-decifra-parada")
    // Both leaves stay in the chain, each with its own replay window.
    expect(cifra.receptoresDe(ALICE)).toBe(2)
  })

  it("a rotação de epoch roda as DUAS folhas da pessoa", async () => {
    const { fonte: f, pedidas } = fonte()
    const cifra = new CifraDeMedia(f)
    cifra.canal = CANAL
    const receptor = fluxos()
    await cifra.protegerReceptor(receptor.ponta, ALICE)
    await falarPelosDois(receptor.empurrar, 3)
    await assentar(() => cifra.receptoresDe(ALICE) === 2)
    pedidas.length = 0
    await cifra.rodar([ALICE])
    // Both known leaves, and the leaf the person has now (`undefined`):
    // someone relocated to another leaf can't be left out (3/11/2026).
    expect(new Set(pedidas)).toEqual(new Set([undefined, 3, 5]))
  })
})

describe("dois aparelhos da mesma conta, pelo worker", () => {
  function workerComServico(): { worker: Worker; escopo: EscopoDoWorker } {
    const paraOWorker: ((evento: { data: unknown }) => void)[] = []
    const paraOPrincipal: ((evento: MessageEvent) => void)[] = []
    const escopo: EscopoDoWorker = {
      onrtctransform: null,
      addEventListener: (_tipo, ouvinte) => paraOWorker.push(ouvinte),
      postMessage: (mensagem) =>
        setTimeout(() => {
          for (const ouvinte of paraOPrincipal) ouvinte({ data: mensagem } as MessageEvent)
        }, 0),
    }
    servirCifraDeMedia(escopo)
    const worker = {
      addEventListener: (_tipo: string, ouvinte: (evento: MessageEvent) => void) => paraOPrincipal.push(ouvinte),
      postMessage: (mensagem: unknown) =>
        setTimeout(() => {
          for (const ouvinte of paraOWorker) ouvinte({ data: mensagem })
        }, 0),
      terminate: () => {},
    } as unknown as Worker
    return { worker, escopo }
  }

  class PontaComTransform {
    #transform: unknown = null
    get transform(): unknown {
      return this.#transform
    }
    set transform(valor: unknown) {
      this.#transform = valor
    }
  }

  function motorComWorker(): { opcoes: () => unknown } {
    vi.stubGlobal("RTCRtpSender", PontaComTransform)
    vi.stubGlobal("RTCRtpReceiver", PontaComTransform)
    let opcoes: unknown
    vi.stubGlobal(
      "RTCRtpScriptTransform",
      class {
        constructor(_worker: Worker, options: unknown) {
          opcoes = options
        }
      },
    )
    return { opcoes: () => opcoes }
  }

  it("abre os dois aparelhos", async () => {
    const { opcoes } = motorComWorker()
    const { worker, escopo } = workerComServico()
    const { fonte: f } = fonte(() => worker)
    const diagnosticos: string[] = []
    const cifra = new CifraDeMedia(f, (code) => diagnosticos.push(code))
    cifra.canal = CANAL
    expect(cifra.caminho).toBe("worker")
    expect(await cifra.protegerReceptor(new PontaComTransform() as unknown as RTCRtpReceiver, ALICE)).toBe(true)

    const receptor = fluxos()
    const { readable, writable } = (receptor.ponta as unknown as { createEncodedStreams: () => TransformStream }).createEncodedStreams()
    escopo.onrtctransform?.({ transformer: { readable, writable, options: opcoes() } as never })

    await falarPelosDois(receptor.empurrar, 30)
    await assentar(() => receptor.saida.filter((f) => f[0] === 5).length >= 20)
    expect(receptor.saida.filter((frame) => frame[0] === 3).length).toBe(30)
    expect(receptor.saida.filter((frame) => frame[0] === 5).length).toBeGreaterThanOrEqual(20)
    expect(diagnosticos).toContain("sframe-chave-recuperada")
  })

  it("um fotograma de vídeo sai com o cabeçalho do VP8 em claro, e o som no formato de sempre", async () => {
    const { opcoes } = motorComWorker()
    const { worker, escopo } = workerComServico()
    const { fonte: f } = fonte(() => worker)
    const cifra = new CifraDeMedia(f)
    cifra.canal = CANAL
    expect(await cifra.protegerEmissor(new PontaComTransform() as unknown as RTCRtpSender)).toBe(true)

    const saida = fluxos()
    const { readable, writable } = (saida.ponta as unknown as { createEncodedStreams: () => TransformStream }).createEncodedStreams()
    escopo.onrtctransform?.({ transformer: { readable, writable, options: opcoes() } as never })

    const chave = vp8(true, 9)
    saida.empurrar({ data: chave.slice().buffer, type: "key" })
    saida.empurrar({ data: new Uint8Array([1, 2, 3]).buffer })
    await assentar(() => saida.saida.length === 2)
    expect([...saida.saida[0]!.subarray(0, 10)]).toEqual([...chave.subarray(0, 10)])
    expect(saida.saida[1]![10]).toBe(0) // version 0, header first

    // And it opens on the other side.
    const nossa = material(1, 41, 0)
    const aberto = await new SframeReceiver(await importSframeKey(nossa.material, nossa.keyId, nossa.senderId)).decrypt(
      saida.saida[0] as Uint8Array<ArrayBuffer>,
    )
    expect(aberto && [...aberto]).toEqual([...chave])
  })
})

describe("o vídeo pelas insertable streams", () => {
  it("sai com o cabeçalho do VP8 em claro, chave e diferencial", async () => {
    const { fonte: f } = fonte()
    const cifra = new CifraDeMedia(f)
    cifra.canal = CANAL
    const saida = fluxos()
    expect(await cifra.protegerEmissor(saida.ponta as unknown as RTCRtpSender)).toBe(true)
    const chave = vp8(true, 4)
    const diferencial = vp8(false, 6)
    saida.empurrar({ data: chave.slice().buffer, type: "key" })
    saida.empurrar({ data: diferencial.slice().buffer, type: "delta" })
    await assentar(() => saida.saida.length === 2)
    expect([...saida.saida[0]!.subarray(0, bytesEmClaroDoVp8(chave))]).toEqual([...chave.subarray(0, 10)])
    expect([...saida.saida[1]!.subarray(0, bytesEmClaroDoVp8(diferencial))]).toEqual([...diferencial.subarray(0, 3)])
  })
})
