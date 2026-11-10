import { importSframeKey, SframeSender } from "@enclave/crypto"
import type { UserAddress } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CifraDeMedia, type FonteDeChaves } from "./media-sframe.js"
import { servirCifraDeMedia, type EscopoDoWorker, type OrdemDeCifra } from "./media-sframe-worker.js"

/**
 * SEC-03 (external audit of 1.1.0): the key of someone leaving the channel was never forgotten.
 *
 * With `mediaKey` returning `null` (the account has no sheet in the tree),
 * `receptorDe` would `continue` and the cached chain would stay. Both decoders
 * accept any cached key matching `keyId` and `senderId`, so frames the removed
 * person kept encrypting with the old key would open. The worker had a `forget`
 * command and nothing called it.
 *
 * Here we measure encryption alone, in both paths: insertable streams (main
 * thread decrypts) and the worker (with true `servirCifraDeMedia` on the other
 * side). And the distinction that the "voice without key" fix of 3/11/2026 made
 * and must not be lost: anyone who CHANGED sheets stays a member; only anyone
 * with NO sheet at all is removed.
 */

const EU = "@eu:s" as UserAddress
const BRUNO = "@bruno:s" as UserAddress
const CARLA = "@carla:s" as UserAddress

/** The material of a seed: stable, to encrypt on the test side with the same key. */
const material = (semente: number): Uint8Array => new Uint8Array(32).fill(semente)

/**
 * The channel tree, from here: per person, their sheet and key seed in this
 * epoch. No entry means having no sheet.
 */
type Arvore = Map<UserAddress, { folha: number; semente: number; keyId: number }>

function fonteDe(arvore: Arvore, worker?: Worker): FonteDeChaves {
  return {
    selfAddress: EU,
    mediaKey: async (_canal, address, folha) => {
      const quem = arvore.get(address)
      if (!quem) return null
      if (folha !== undefined && folha !== quem.folha) return null
      return { keyId: quem.keyId, senderId: quem.folha, material: material(quem.semente) }
    },
    reservarContadorSframe: async () => 0,
    ...(worker ? { criarWorkerDeCifra: () => worker } : {}),
  }
}

/** Frames encrypted as the removed person would encrypt them: with the key they already had. */
async function quadrosDe(semente: number, keyId: number, folha: number, quantos = 3): Promise<Uint8Array[]> {
  const emissor = new SframeSender(await importSframeKey(material(semente), keyId, folha))
  const saida: Uint8Array[] = []
  for (let i = 0; i < quantos; i++) saida.push(await emissor.encrypt(new Uint8Array([i, 7, 7, 7])))
  return saida
}

/** An insertable streams receiver with both endpoints in the test's hands. */
function receptor(): { ponta: RTCRtpReceiver; empurrar: (bytes: Uint8Array) => void; saida: Uint8Array[] } {
  const saida: Uint8Array[] = []
  let controlador!: ReadableStreamDefaultController<{ data: ArrayBuffer }>
  const readable = new ReadableStream<{ data: ArrayBuffer }>({
    start(controller) {
      controlador = controller
    },
  })
  const writable = new WritableStream<{ data: ArrayBuffer }>({
    write(frame) {
      saida.push(new Uint8Array(frame.data))
    },
  })
  return {
    ponta: { createEncodedStreams: () => ({ readable, writable }) } as unknown as RTCRtpReceiver,
    saida,
    empurrar: (bytes) => controlador.enqueue({ data: bytes.slice().buffer as ArrayBuffer }),
  }
}

const escoar = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("quem fica sem folha nenhuma, pela thread principal", () => {
  beforeEach(() => {
    class Ponta {
      createEncodedStreams(): unknown {
        throw new Error("as pontas destes testes trazem os seus fluxos")
      }
    }
    vi.stubGlobal("RTCRtpSender", Ponta)
    vi.stubGlobal("RTCRtpReceiver", Ponta)
  })

  it("perde TODAS as chaves, e os quadros cifrados com a chave antiga deixam de abrir", async () => {
    const arvore: Arvore = new Map([
      [EU, { folha: 0, semente: 1, keyId: 41 }],
      [BRUNO, { folha: 1, semente: 2, keyId: 41 }],
      [CARLA, { folha: 2, semente: 3, keyId: 41 }],
    ])
    const cifra = new CifraDeMedia(fonteDe(arvore))
    cifra.canal = "!c:s"
    const daCarla = receptor()
    expect(await cifra.protegerReceptor(daCarla.ponta, CARLA)).toBe(true)

    // Before: her frames open.
    for (const quadro of await quadrosDe(3, 41, 2)) daCarla.empurrar(quadro)
    await escoar()
    expect(daCarla.saida).toHaveLength(3)

    // A transition epoch (carla with the new key), and the removal.
    arvore.set(EU, { folha: 0, semente: 11, keyId: 42 })
    arvore.set(BRUNO, { folha: 1, semente: 12, keyId: 42 })
    arvore.set(CARLA, { folha: 2, semente: 13, keyId: 42 })
    expect(await cifra.rodar([BRUNO, CARLA])).toEqual([])
    expect(cifra.receptoresDe(CARLA)).toBe(2)

    arvore.set(EU, { folha: 0, semente: 21, keyId: 43 })
    arvore.set(BRUNO, { folha: 1, semente: 22, keyId: 43 })
    arvore.delete(CARLA)
    expect(await cifra.rodar([BRUNO])).toEqual([CARLA])

    // Zero keys, whatever the roster: carla was not even in the list.
    expect(cifra.receptoresDe(CARLA)).toBe(0)
    // And the two-key window applies only to those staying in the tree.
    expect(cifra.receptoresDe(BRUNO)).toBe(2)

    // Carla's frames, with either of the two keys she had, no longer open.
    for (const quadro of await quadrosDe(3, 41, 2)) daCarla.empurrar(quadro)
    for (const quadro of await quadrosDe(13, 42, 2)) daCarla.empurrar(quadro)
    await escoar()
    expect(daCarla.saida).toHaveLength(3)

    // And asking for the key again does not bring it back: the monitor asks for it and the session says no.
    await cifra.receptorDe(CARLA, 2)
    expect(cifra.receptoresDe(CARLA)).toBe(0)
  })

  it("quem MUDOU de folha continua membro: não perde as chaves", async () => {
    const arvore: Arvore = new Map([
      [EU, { folha: 0, semente: 1, keyId: 41 }],
      [CARLA, { folha: 2, semente: 3, keyId: 41 }],
    ])
    const cifra = new CifraDeMedia(fonteDe(arvore))
    cifra.canal = "!c:s"
    expect(await cifra.protegerReceptor(receptor().ponta, CARLA)).toBe(true)

    // Reseated: sheet 2 is no longer hers, sheet 1 is. The account has a sheet.
    arvore.set(EU, { folha: 0, semente: 11, keyId: 42 })
    arvore.set(CARLA, { folha: 1, semente: 13, keyId: 42 })
    expect(await cifra.rodar([CARLA])).toEqual([])
    expect(cifra.receptoresDe(CARLA)).toBeGreaterThan(0)
  })

  it("e quem volta a ter folha depois de ser removido volta a abrir, no MESMO receptor", async () => {
    const arvore: Arvore = new Map([
      [EU, { folha: 0, semente: 1, keyId: 41 }],
      [CARLA, { folha: 2, semente: 3, keyId: 41 }],
    ])
    const cifra = new CifraDeMedia(fonteDe(arvore))
    cifra.canal = "!c:s"
    const daCarla = receptor()
    expect(await cifra.protegerReceptor(daCarla.ponta, CARLA)).toBe(true)

    // The reseat is two commits: first remove, then seat on another sheet.
    arvore.set(EU, { folha: 0, semente: 11, keyId: 42 })
    arvore.delete(CARLA)
    expect(await cifra.rodar([CARLA])).toEqual([CARLA])
    expect(cifra.receptoresDe(CARLA)).toBe(0)

    arvore.set(EU, { folha: 0, semente: 21, keyId: 43 })
    arvore.set(CARLA, { folha: 1, semente: 23, keyId: 43 })
    expect(await cifra.rodar([CARLA])).toEqual([])

    for (const quadro of await quadrosDe(23, 43, 1)) daCarla.empurrar(quadro)
    await escoar()
    expect(daCarla.saida).toHaveLength(3)
  })
})

describe("quem fica sem folha nenhuma, pelo worker", () => {
  // The property on PROTOTYPE, like in the three engines (see `media-sframe.worker.test.ts`).
  class PontaComTransform {
    #transform: unknown = null
    get transform(): unknown {
      return this.#transform
    }
    set transform(valor: unknown) {
      this.#transform = valor
    }
  }

  /** The true `servirCifraDeMedia`, with async messages as in a browser. */
  function workerComServico(): { worker: Worker; escopo: EscopoDoWorker; rasto: string[] } {
    const paraOWorker: ((evento: { data: unknown }) => void)[] = []
    const paraOPrincipal: ((evento: MessageEvent) => void)[] = []
    const rasto: string[] = []
    const escopo: EscopoDoWorker = {
      onrtctransform: null,
      addEventListener: (_tipo, ouvinte) => paraOWorker.push(ouvinte),
      postMessage: (mensagem) =>
        setTimeout(() => {
          if ("eco" in mensagem) rasto.push(`ack:${mensagem.eco}`)
          for (const ouvinte of paraOPrincipal) ouvinte({ data: mensagem } as MessageEvent)
        }, 0),
    }
    servirCifraDeMedia(escopo)
    const worker = {
      addEventListener: (_tipo: string, ouvinte: (evento: MessageEvent) => void) => paraOPrincipal.push(ouvinte),
      postMessage: (mensagem: OrdemDeCifra) =>
        setTimeout(() => {
          rasto.push(mensagem.t === "esquecer" ? `esquecer:${mensagem.address}` : `ordem:${mensagem.t}`)
          for (const ouvinte of paraOWorker) ouvinte({ data: mensagem })
        }, 0),
      terminate: () => {},
    } as unknown as Worker
    return { worker, escopo, rasto }
  }

  /** Pass frames through the receiver transformation that the worker builds. */
  async function passarPor(escopo: EscopoDoWorker, address: UserAddress, quadros: Uint8Array[]): Promise<number> {
    let abertos = 0
    const readable = new ReadableStream<{ data: ArrayBuffer }>({
      start(controlador) {
        for (const bytes of quadros) controlador.enqueue({ data: bytes.slice().buffer as ArrayBuffer })
        controlador.close()
      },
    })
    const writable = new WritableStream<{ data: ArrayBuffer }>({
      write() {
        abertos++
      },
    })
    escopo.onrtctransform?.({ transformer: { readable, writable, options: { papel: "receptor", address } } })
    await escoar()
    return abertos
  }

  beforeEach(() => {
    vi.stubGlobal("RTCRtpSender", PontaComTransform)
    vi.stubGlobal("RTCRtpReceiver", PontaComTransform)
    vi.stubGlobal(
      "RTCRtpScriptTransform",
      class {
        constructor(
          readonly worker: Worker,
          readonly options: unknown,
        ) {}
      },
    )
  })

  it("o worker recebe o `esquecer` e confirma-o antes de a rotação acabar, e recusa os quadros antigos", async () => {
    const { worker, escopo, rasto } = workerComServico()
    const arvore: Arvore = new Map([
      [EU, { folha: 0, semente: 1, keyId: 41 }],
      [CARLA, { folha: 2, semente: 3, keyId: 41 }],
    ])
    const cifra = new CifraDeMedia(fonteDe(arvore, worker))
    cifra.canal = "!c:s"
    expect(await cifra.protegerReceptor(new PontaComTransform() as unknown as RTCRtpReceiver, CARLA)).toBe(true)

    // Before: the worker opens her frames.
    expect(await passarPor(escopo, CARLA, await quadrosDe(3, 41, 2))).toBe(3)

    arvore.set(EU, { folha: 0, semente: 11, keyId: 42 })
    arvore.delete(CARLA)
    expect(await cifra.rodar([])).toEqual([CARLA])

    // The `forget` reached the worker and was confirmed BEFORE `rotate` returned.
    const onde = rasto.indexOf(`esquecer:${CARLA}`)
    expect(onde).toBeGreaterThanOrEqual(0)
    expect(rasto.slice(onde).some((passo) => passo.startsWith("ack:"))).toBe(true)
    expect(cifra.receptoresDe(CARLA)).toBe(0)

    // And the worker no longer opens anything with the old key.
    expect(await passarPor(escopo, CARLA, await quadrosDe(3, 41, 2))).toBe(0)
  })
})
