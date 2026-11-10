import { importSframeKey, SframeSender } from "@enclave/crypto"
import type { UserAddress } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CifraDeMedia, type MaterialDeChave } from "./media-sframe.js"
import { servirCifraDeMedia, type EscopoDoWorker, type RespostaDeCifra } from "./media-sframe-worker.js"

/**
 * Phase M2: VIDEO decipher that fails and opens again alerts once, in both
 * paths. That's what lets whoever watches ask for a keyframe as soon as the key
 * comes back (the decoder lost the chain in the meantime).
 */

const EU = "@eu:enclave.test" as UserAddress
const OUTRO = "@outro:enclave.test" as UserAddress
const chave: MaterialDeChave = { keyId: 1, senderId: 3, material: new Uint8Array(28).fill(9) }
const outraChave: MaterialDeChave = { ...chave, material: new Uint8Array(28).fill(8) }

type Quadro = { data: ArrayBuffer; type?: string }
function fluxos() {
  const saida: Quadro[] = []
  let controlador!: ReadableStreamDefaultController<Quadro>
  const readable = new ReadableStream<Quadro>({ start: (c) => void (controlador = c) })
  const writable = new WritableStream<Quadro>({ write: (q) => void saida.push(q) })
  return { readable, writable, saida, empurrar: (q: Quadro) => controlador.enqueue(q) }
}
const assentar = () => new Promise((resolve) => setTimeout(resolve, 15))

/** Two frames that don't open (other key), then three that open, and one audio in between. */
async function sequencia(): Promise<Quadro[]> {
  const certo = new SframeSender(await importSframeKey(chave.material, chave.keyId, chave.senderId))
  const errado = new SframeSender(await importSframeKey(outraChave.material, outraChave.keyId, outraChave.senderId))
  const v = (b: Uint8Array): Quadro => ({ data: b.buffer as ArrayBuffer, type: "delta" })
  return [
    v(await errado.encrypt(new Uint8Array([1, 2, 3]))),
    v(await errado.encrypt(new Uint8Array([1, 2, 3]))),
    { data: (await certo.encrypt(new Uint8Array([7, 7, 7]))).buffer as ArrayBuffer },
    v(await certo.encrypt(new Uint8Array([4, 5, 6]))),
    v(await certo.encrypt(new Uint8Array([4, 5, 6]))),
    v(await certo.encrypt(new Uint8Array([4, 5, 6]))),
  ]
}

describe("a decifra de vídeo que volta", () => {
  beforeEach(() => {
    class Ponta {
      createEncodedStreams(): unknown {
        throw new Error("as pontas destes testes trazem os seus fluxos")
      }
    }
    vi.stubGlobal("RTCRtpSender", Ponta)
    vi.stubGlobal("RTCRtpReceiver", Ponta)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("na thread principal avisa uma vez, quando o primeiro fotograma volta a abrir", async () => {
    const cifra = new CifraDeMedia({ selfAddress: EU, mediaKey: async () => chave, reservarContadorSframe: async () => 0 })
    cifra.canal = "!sala:enclave.test"
    const voltas: UserAddress[] = []
    cifra.aoVoltarOVideo = (address) => void voltas.push(address)
    const f = fluxos()
    const ponta = { createEncodedStreams: () => ({ readable: f.readable, writable: f.writable }) } as unknown as RTCRtpReceiver
    expect(await cifra.protegerReceptor(ponta, OUTRO)).toBe(true)
    for (const quadro of await sequencia()) f.empurrar(quadro)
    await assentar()
    expect(f.saida).toHaveLength(4)
    expect(voltas).toEqual([OUTRO])
  })

  it("no worker manda video-voltou uma vez", async () => {
    const ouvintes: ((evento: { data: unknown }) => void)[] = []
    const respostas: RespostaDeCifra[] = []
    const escopo: EscopoDoWorker = {
      onrtctransform: null,
      addEventListener: (_t, o) => void ouvintes.push(o),
      postMessage: (m) => void respostas.push(m),
    }
    servirCifraDeMedia(escopo)
    ouvintes.forEach((o) => o({ data: { t: "receptor", eco: 1, address: OUTRO, chaves: [chave] } }))
    await assentar()
    const f = fluxos()
    escopo.onrtctransform?.({ transformer: { readable: f.readable, writable: f.writable, options: { papel: "receptor", address: OUTRO } } })
    for (const quadro of await sequencia()) f.empurrar(quadro)
    await assentar()
    expect(f.saida).toHaveLength(4)
    expect(respostas.filter((r) => r.t === "video-voltou")).toEqual([{ t: "video-voltou", address: OUTRO }])
  })
})
