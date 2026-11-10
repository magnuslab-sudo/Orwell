import { importSframeKey, SframeSender } from "@enclave/crypto"
import type { UserAddress } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CifraDeMedia, type MaterialDeChave } from "./media-sframe.js"
import { servirCifraDeMedia, type EscopoDoWorker } from "./media-sframe-worker.js"
import { VigiaDaDecifra, type AvisoDaDecifra } from "./vigia-da-decifra.js"

/**
 * The audio lost until it goes out and comes back (report from November 2, 2026).
 *
 * "Users sometimes stop hearing the others" and "audio comes back if they leave and
 * rejoin the room". These tests reproduce the shape of the fault through the cipher:
 * a receiver ends up with one person's key chain missing the key from the epoch where
 * they already encrypt, and from then on all their frames fail to decrypt, silently,
 * forever. Only rejoin brings the key back by deriving it.
 */

const EU = "@eu:enclave.test" as UserAddress
const OUTRO = "@outro:enclave.test" as UserAddress
const CANAL = "!sala:enclave.test"

function material(byte: number, keyId: number): MaterialDeChave {
  return { keyId, senderId: 7, material: new Uint8Array(32).fill(byte) }
}

/** A pair of encoded streams, with both ends in the test's hands. */
function fluxos(): {
  ponta: RTCRtpReceiver
  empurrar: (bytes: Uint8Array) => void
  saida: Uint8Array[]
} {
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
  const ponta = { createEncodedStreams: () => ({ readable, writable }) } as unknown as RTCRtpReceiver
  return {
    ponta,
    saida,
    empurrar: (bytes) => controlador.enqueue({ data: bytes.slice().buffer as ArrayBuffer }),
  }
}

/** Wait for the pipeline to settle, without guessing how many microtasks it takes. */
async function assentar(condicao: () => boolean, voltas = 300): Promise<void> {
  for (let volta = 0; volta < voltas && !condicao(); volta++) {
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}

/** The sender on the other end encrypts with the key from the epoch where they are already. */
async function emissorDoOutro(chave: MaterialDeChave): Promise<SframeSender> {
  return new SframeSender(await importSframeKey(chave.material, chave.keyId, chave.senderId))
}

beforeEach(() => {
  // A Chromium browser: insertable streams on both prototypes. This is the engine of the desktop app, where the telemetry occurred.
  class Ponta {
    createEncodedStreams(): unknown {
      throw new Error("as pontas destes testes trazem os seus fluxos")
    }
  }
  vi.stubGlobal("RTCRtpSender", Ponta)
  vi.stubGlobal("RTCRtpReceiver", Ponta)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("uma rotação de epoch a meio da instalação de um receptor", () => {
  /*
   * The race condition, step by step, as in `MotorSfu`:
   *
   *  1. the other peer's microphone feed arrives; `protegerReceptor` asks their
   *     session for the key (on the desktop app, via IPC: the window is at large);
   *  2. before the response, someone joins the channel and the epoch advances 41 → 42;
   *  3. `rekey` runs `rodar(motor.emissores())`, and `emissores()` reads the
   *     consumers already installed: the other peer is not there yet, because they
   *     only arrive after `protegerReceptor` finishes. No one rotates their key;
   *  4. the response from step 1 is the key from 41, and the chain becomes [41];
   *  5. the other peer is already encrypting at 42. Every frame from them fails, forever.
   */
  it("depois da corrida, o som do OUTRO volta sem sair da sala", async () => {
    const chaves = new Map<UserAddress, MaterialDeChave>([
      [EU, material(1, 41)],
      [OUTRO, material(2, 41)],
    ])
    let soltarPergunta!: () => void
    let reterProximaDoOutro = false
    const diagnosticos: { code: string; detail?: string }[] = []

    const cifra = new CifraDeMedia(
      {
        selfAddress: EU,
        mediaKey: async (_canal, address) => {
          // The response is from the moment of the REQUEST, just as with IPC: the main process read the tree and the response is on its way.
          const resposta = chaves.get(address) ?? null
          if (address === OUTRO && reterProximaDoOutro) {
            reterProximaDoOutro = false
            await new Promise<void>((resolve) => {
              soltarPergunta = resolve
            })
          }
          return resposta
        },
        reservarContadorSframe: async () => 0,
      },
      (code, detail) => diagnosticos.push(detail === undefined ? { code } : { code, detail }),
    )
    cifra.canal = CANAL
    expect(await cifra.emissor()).toBeDefined()

    // 1. The other peer's feed installing, with the key request pending.
    reterProximaDoOutro = true
    const receptor = fluxos()
    const instalado = cifra.protegerReceptor(receptor.ponta, OUTRO)
    await assentar(() => soltarPergunta !== undefined)

    // 2. and 3. The epoch advances, and rotation runs with the consumers now present, which still don't include the other peer.
    chaves.set(EU, material(11, 42))
    chaves.set(OUTRO, material(12, 42))
    const rodada = cifra.rodar([])

    // 4. The stale response arrives.
    soltarPergunta()
    expect(await instalado).toBe(true)
    expect(await rodada).toEqual([])

    // 5. The other peer speaks, already at 42.
    const fala = await emissorDoOutro(material(12, 42))
    for (let frame = 0; frame < 50; frame++) {
      receptor.empurrar(await fala.encrypt(new Uint8Array([frame, 1, 2, 3])))
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    await assentar(() => receptor.saida.length > 0)

    // Without recovery, this stays silent forever: it's the "I stopped hearing them".
    expect(receptor.saida.length).toBeGreaterThan(0)
    /*
     * Until 4/11/2026 this also asserted `sframe-key-recovered`: rotation
     * only passed through the roster it received, left the other peer out, and
     * the watchdog saved them. Since SEC-03 rotation also passes through the
     * entire cached chain (to forget who left the channel), so it no longer
     * leaves the other peer behind: the race closes in rotation itself. The
     * watchdog is still proven on the worker path, here below, and in "when
     * this device is the one lagging in the epoch".
     */
    expect(cifra.receptoresDe(OUTRO)).toBe(2)
  })
})

/**
 * Encryption through the insertable streams path, with direct control of the keys.
 *
 * `chaves` is what the session answers RIGHT NOW; changing the map means applying a commit.
 */
function montar(): {
  cifra: CifraDeMedia
  chaves: Map<UserAddress, MaterialDeChave | null>
  diagnosticos: { code: string; detail?: string }[]
  perguntas: () => number
} {
  const chaves = new Map<UserAddress, MaterialDeChave | null>([
    [EU, material(1, 41)],
    [OUTRO, material(2, 41)],
  ])
  const diagnosticos: { code: string; detail?: string }[] = []
  let perguntas = 0
  const cifra = new CifraDeMedia(
    {
      selfAddress: EU,
      mediaKey: async (_canal, address) => {
        if (address === OUTRO) perguntas++
        return chaves.get(address) ?? null
      },
      reservarContadorSframe: async () => 0,
    },
    (code, detail) => diagnosticos.push(detail === undefined ? { code } : { code, detail }),
  )
  cifra.canal = CANAL
  return { cifra, chaves, diagnosticos, perguntas: () => perguntas }
}

async function falar(receptor: ReturnType<typeof fluxos>, chave: MaterialDeChave, frames: number): Promise<void> {
  const fala = await emissorDoOutro(chave)
  for (let frame = 0; frame < frames; frame++) {
    receptor.empurrar(await fala.encrypt(new Uint8Array([frame, 9])))
  }
  // Let the pipeline and key requests settle.
  await new Promise((resolve) => setTimeout(resolve, 20))
}

const codigos = (diagnosticos: { code: string }[]): string[] => diagnosticos.map((cada) => cada.code)

describe("quando é ESTE aparelho que está atrás na epoch", () => {
  it("diz a falta uma vez, e recupera sozinho quando apanha o commit", async () => {
    const { cifra, chaves, diagnosticos } = montar()
    const receptor = fluxos()
    expect(await cifra.protegerReceptor(receptor.ponta, OUTRO)).toBe(true)

    // The other peer is already encrypting at 42; our session still answers with 41.
    await falar(receptor, material(12, 42), 60)
    expect(receptor.saida).toHaveLength(0)
    expect(codigos(diagnosticos).filter((code) => code === "sframe-chave-em-falta")).toHaveLength(1)
    expect(diagnosticos.find((cada) => cada.code === "sframe-chave-em-falta")?.detail).toBe(
      `${OUTRO} · keyId 42 · a nossa 41`,
    )
    // And the stop is recorded, with the reason that distinguishes it from the others.
    expect(diagnosticos.find((cada) => cada.code === "sframe-decifra-parada")?.detail).toBe(`${OUTRO} · sem-chave · 50 frames`)

    // The commit arrives at this device. The request timer must let the next
    // request through, which is the one that brings the new key.
    chaves.set(OUTRO, material(12, 42))
    await new Promise((resolve) => setTimeout(resolve, VigiaDaDecifra.INTERVALO_DOS_PEDIDOS_MS + 20))
    await falar(receptor, material(12, 42), 5)
    await assentar(() => receptor.saida.length > 0)

    expect(receptor.saida.length).toBeGreaterThan(0)
    expect(codigos(diagnosticos)).toContain("sframe-chave-recuperada")
    expect(codigos(diagnosticos)).toContain("sframe-decifra-voltou")
  })
})

describe("o custo da vigia", () => {
  it("cinquenta frames sem chave dão UMA pergunta à sessão, e não cinquenta", async () => {
    const { cifra, perguntas } = montar()
    const receptor = fluxos()
    await cifra.protegerReceptor(receptor.ponta, OUTRO)
    const antes = perguntas()

    // Without the key from 43 anywhere: no one can provide it.
    await falar(receptor, material(13, 43), 50)

    expect(perguntas() - antes).toBe(1)
  })

  it("frames que abrem não perguntam nada nem escrevem nada", async () => {
    const { cifra, diagnosticos, perguntas } = montar()
    const receptor = fluxos()
    await cifra.protegerReceptor(receptor.ponta, OUTRO)
    const antes = perguntas()

    await falar(receptor, material(2, 41), 80)

    expect(receptor.saida).toHaveLength(80)
    expect(perguntas() - antes).toBe(0)
    expect(diagnosticos).toEqual([])
  })

  it("um frame recusado com a chave certa não pede chave, e diz-se com outro nome", async () => {
    const { cifra, diagnosticos, perguntas } = montar()
    const receptor = fluxos()
    await cifra.protegerReceptor(receptor.ponta, OUTRO)
    const antes = perguntas()

    // Same keyId and same sender, with wrong material: the tag does not match.
    await falar(receptor, material(99, 41), 50)

    expect(perguntas() - antes).toBe(0)
    expect(diagnosticos.find((cada) => cada.code === "sframe-decifra-parada")?.detail).toBe(`${OUTRO} · recusado · 50 frames`)
  })
})

describe("a vigia sozinha", () => {
  it("pede logo à primeira, espera o intervalo, e recomeça o relógio quando abre", () => {
    let agora = 0
    const avisos: AvisoDaDecifra[] = []
    const vigia = new VigiaDaDecifra((aviso) => avisos.push(aviso), () => agora)

    vigia.falhou(OUTRO, "sem-chave", 42)
    vigia.falhou(OUTRO, "sem-chave", 42)
    agora = VigiaDaDecifra.INTERVALO_DOS_PEDIDOS_MS - 1
    vigia.falhou(OUTRO, "sem-chave", 42)
    expect(avisos.filter((aviso) => aviso.t === "pedir-chave")).toHaveLength(1)

    agora = VigiaDaDecifra.INTERVALO_DOS_PEDIDOS_MS
    vigia.falhou(OUTRO, "sem-chave", 42)
    expect(avisos.filter((aviso) => aviso.t === "pedir-chave")).toHaveLength(2)

    // Opened before the threshold: nothing to report. The next failure asks immediately.
    vigia.abriu(OUTRO)
    expect(avisos.some((aviso) => aviso.t === "voltou")).toBe(false)
    vigia.falhou(OUTRO, "sem-chave", 43)
    expect(avisos.filter((aviso) => aviso.t === "pedir-chave")).toHaveLength(3)
  })
})

describe("pelo caminho do worker", () => {
  /** The real worker service, with messages crossing asynchronously. */
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

  it("a mesma corrida recupera, com o aviso a atravessar a fronteira", async () => {
    // A Firefox browser: no insertable streams, using the standard port.
    class PontaComTransform {
      #transform: unknown = null
      get transform(): unknown {
        return this.#transform
      }
      set transform(valor: unknown) {
        this.#transform = valor
      }
    }
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

    const { worker, escopo } = workerComServico()
    const chaves = new Map<UserAddress, MaterialDeChave>([
      [EU, material(1, 41)],
      [OUTRO, material(2, 41)],
    ])
    const diagnosticos: { code: string; detail?: string }[] = []
    const cifra = new CifraDeMedia(
      {
        selfAddress: EU,
        mediaKey: async (_canal, address) => chaves.get(address) ?? null,
        reservarContadorSframe: async () => 0,
        criarWorkerDeCifra: () => worker,
      },
      (code, detail) => diagnosticos.push(detail === undefined ? { code } : { code, detail }),
    )
    cifra.canal = CANAL
    expect(cifra.caminho).toBe("worker")

    // The chain installs at 41, and the epoch moves to 42 without rotation
    // reaching the other peer: their frames at 42 arrive before it runs. (Until
    // 4/11/2026 this used `rodar([])`, which left the other peer out; since SEC-03
    // rotation passes through the entire cached chain, so it no longer does.)
    expect(await cifra.protegerReceptor(new PontaComTransform() as unknown as RTCRtpReceiver, OUTRO)).toBe(true)
    chaves.set(EU, material(11, 42))
    chaves.set(OUTRO, material(12, 42))

    // The transformer that the browser would hand to the worker.
    const receptor = fluxos()
    const { readable, writable } = (receptor.ponta as unknown as { createEncodedStreams: () => TransformStream }).createEncodedStreams()
    escopo.onrtctransform?.({ transformer: { readable, writable, options: opcoes } as never })

    await falar(receptor, material(12, 42), 10)
    await assentar(() => receptor.saida.length > 0)
    // The first frame requests, and the request reaches the worker; the rest
    // arrive in time to decrypt.
    await falar(receptor, material(12, 42), 5)
    await assentar(() => receptor.saida.length > 0)

    expect(receptor.saida.length).toBeGreaterThan(0)
    expect(codigos(diagnosticos)).toContain("sframe-chave-recuperada")
  })
})
