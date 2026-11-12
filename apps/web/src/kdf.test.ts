import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { argon2id } from "@noble/hashes/argon2.js"

/**
 * The key that comes out of the Worker is the SAME as what came out of the main thread.
 *
 * **This is the test you cannot skip.** Moving where Argon2id runs is touching the
 * line that opens the vault: a different derivation, other parameters, another
 * implementation, another encoding of the phrase, throws no error. It gives a key
 * that does not decrypt, and the app tells "wrong password" to whoever typed the
 * right one. Everyone is locked out of their own account, and the symptom points
 * to the wrong place.
 *
 * That is why the proof is direct: derive by both paths, with the same
 * material and the same salt, and compare byte for byte.
 *
 * Here with CHEAP parameters, on purpose: what is measured is the equality of
 * the two paths, not the cost. Who ties the cost and parameters for real is
 * `packages/client-core/testes/kdf-a-serio.test.ts`, which runs Argon2id with
 * 64 MiB and fails if anyone lowers the memory. They are the two halves of the same
 * guarantee: there that the parameters are expensive, here that the thread change
 * did not touch them.
 */
const BARATO = { t: 1, m: 256, p: 1, dkLen: 32 } as const
const SAL = new Uint8Array(16).fill(7)
const FRASE = "a frase-passe de quem já tem conta"

/**
 * A fake Worker that runs the REAL file.
 *
 * jsdom has no Workers, and the browser's message mechanism is not what
 * matters here to measure. What matters is that the Worker's BODY, the file that
 * goes to production, produces the same key that the main thread produced. A
 * double that reimplemented that body would prove the TEST is correct, not
 * that the worker is.
 *
 * That is why `kdf-worker.ts` is imported for real (it registers itself on `self.onmessage`
 * on load), and this double delivers the message to it and catches the answer it
 * returns via `self.postMessage`.
 */
await import("./kdf-worker.js")
const registado = (globalThis as { onmessage?: ((evento: MessageEvent) => void) | null }).onmessage
if (!registado) throw new Error("o kdf-worker não se registou: o teste não tem o que medir")
const corpoDoWorker: (evento: MessageEvent) => void = registado

class WorkerFalso {
  onmessage: ((evento: MessageEvent) => void) | null = null
  onerror: ((evento: unknown) => void) | null = null
  onmessageerror: ((evento: unknown) => void) | null = null
  static ultimo: WorkerFalso | null = null
  static falhaAoCriar = false
  /** How many were created and how many were buried. See the `finally`. */
  static criados = 0
  static terminados = 0
  /**
   * The worker that WebKit kills under memory pressure: accepts the message and
   * NEVER responds, without firing any `error`. It is the death that gives no warning.
   */
  static mudo = false
  /** The worker that dies and says so: fires `error` instead of responding. */
  static atira = false

  constructor() {
    WorkerFalso.ultimo = this
    WorkerFalso.criados += 1
  }

  postMessage(pedido: { id: number; frase: string; sal: Uint8Array; parametros: typeof BARATO }): void {
    if (WorkerFalso.mudo) return
    if (WorkerFalso.atira) {
      queueMicrotask(() => this.onerror?.({}))
      return
    }
    const respostas: unknown[] = []
    const alvo = globalThis as unknown as { postMessage: (dados: unknown, transferir?: unknown) => void }
    const original = alvo.postMessage
    alvo.postMessage = (dados: unknown): void => void respostas.push(dados)
    try {
      corpoDoWorker({ data: pedido } as MessageEvent)
    } finally {
      alvo.postMessage = original
    }
    queueMicrotask(() => this.onmessage?.({ data: respostas[0] } as MessageEvent))
  }

  terminate(): void {
    WorkerFalso.terminados += 1
  }
}

beforeEach(() => {
  vi.resetModules()
  WorkerFalso.ultimo = null
  WorkerFalso.falhaAoCriar = false
  WorkerFalso.criados = 0
  WorkerFalso.terminados = 0
  WorkerFalso.mudo = false
  WorkerFalso.atira = false
  vi.stubGlobal(
    "Worker",
    class {
      constructor() {
        if (WorkerFalso.falhaAoCriar) throw new Error("sem workers aqui")
        return new WorkerFalso() as unknown as Worker
      }
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("a chave do cofre não muda por mudar de thread", () => {
  it("o Worker e a @noble/hashes derivam a mesma chave, do mesmo material e do mesmo sal", async () => {
    const { derivarNoWorker } = await import("./kdf.js")

    const doWorker = await derivarNoWorker(FRASE, SAL, BARATO)
    const daNoble = argon2id(new TextEncoder().encode(FRASE), SAL, BARATO)

    expect(doWorker).toHaveLength(32)
    // Byte for byte, not "similar": this is what guarantees that vaults that already
    // exist keep opening.
    expect([...doWorker]).toEqual([...daNoble])
  })

  it("e continuam iguais com outra frase e outro sal: não é coincidência de um caso", async () => {
    const { derivarNoWorker } = await import("./kdf.js")

    const outroSal = new Uint8Array(16).fill(200)
    const doWorker = await derivarNoWorker("outra frase inteiramente", outroSal, BARATO)
    const daNoble = argon2id(new TextEncoder().encode("outra frase inteiramente"), outroSal, BARATO)

    expect([...doWorker]).toEqual([...daNoble])
    // And two different phrases do not give the same key, or else the test above
    // would pass with an implementation that always returned the same thing.
    const primeira = await derivarNoWorker(FRASE, SAL, BARATO)
    expect([...doWorker]).not.toEqual([...primeira])
  })

  it("os parâmetros são os que lhe chegam, e nunca uns escolhidos lá dentro", async () => {
    const { derivarNoWorker } = await import("./kdf.js")

    // Two different sets of parameters must give different keys. A
    // worker that ignored what it receives and used its own would give the same, and that
    // is exactly the fault that locks everyone out of the account.
    const comUmaPassagem = await derivarNoWorker(FRASE, SAL, { t: 1, m: 256, p: 1, dkLen: 32 })
    const comDuas = await derivarNoWorker(FRASE, SAL, { t: 2, m: 256, p: 1, dkLen: 32 })
    expect([...comUmaPassagem]).not.toEqual([...comDuas])
    expect([...comDuas]).toEqual([...argon2id(new TextEncoder().encode(FRASE), SAL, { t: 2, m: 256, p: 1, dkLen: 32 })])
  })
})

describe("e sem Worker deriva na mesma", () => {
  it("num motor que não o consegue criar, a chave sai igual pela thread principal", async () => {
    WorkerFalso.falhaAoCriar = true
    const { derivarNoWorker } = await import("./kdf.js")

    const derivada = await derivarNoWorker(FRASE, SAL, BARATO)

    // The screen freezes, which is the old fault. What cannot happen is the
    // gate refusing to open an account that exists.
    expect([...derivada]).toEqual([...argon2id(new TextEncoder().encode(FRASE), SAL, BARATO)])
  })

  it("e um Worker que morre a dizê-lo também não tranca ninguém de fora", async () => {
    WorkerFalso.atira = true
    const { derivarNoWorker } = await import("./kdf.js")

    const derivada = await derivarNoWorker(FRASE, SAL, BARATO)
    expect([...derivada]).toEqual([...argon2id(new TextEncoder().encode(FRASE), SAL, BARATO)])
  })
})

/**
 * The death that gives no warning, and the limit that catches it.
 *
 * It is the case of the old phone: WebKit kills the worker under memory pressure (the
 * Argon2id asks it for 64 MiB in there) and fires no event. Without a limit, the
 * promise hangs, `Vault.unlock` never returns, and the gate stays at "opening…"
 * forever, a reload makes no difference. It is worse than the freeze
 * that the Worker came to fix, because the freeze at least ended.
 */
describe("um Worker que morre em silêncio", () => {
  it("cai no tecto e a chave sai na mesma, pela thread principal", async () => {
    vi.useFakeTimers()
    try {
      WorkerFalso.mudo = true
      const { derivarNoWorker } = await import("./kdf.js")

      const promessa = derivarNoWorker(FRASE, SAL, BARATO)
      // Before the limit gives up: seven seconds are normal, and a
      // tight limit would make a slow device derive twice.
      await vi.advanceTimersByTimeAsync(30_000)
      let jaRespondeu = false
      void promessa.then(() => (jaRespondeu = true))
      await Promise.resolve()
      expect(jaRespondeu).toBe(false)

      await vi.advanceTimersByTimeAsync(31_000)
      const derivada = await promessa
      expect([...derivada]).toEqual([...argon2id(new TextEncoder().encode(FRASE), SAL, BARATO)])
    } finally {
      vi.useRealTimers()
    }
  })

  it("e o worker calado é enterrado: o pedido seguinte arranca outro em vez de esperar pelo mesmo silêncio", async () => {
    vi.useFakeTimers()
    try {
      WorkerFalso.mudo = true
      const { derivarNoWorker } = await import("./kdf.js")

      const promessa = derivarNoWorker(FRASE, SAL, BARATO)
      await vi.advanceTimersByTimeAsync(61_000)
      await promessa
      expect(WorkerFalso.terminados).toBeGreaterThanOrEqual(1)

      WorkerFalso.mudo = false
      await derivarNoWorker(FRASE, SAL, BARATO)
      expect(WorkerFalso.criados).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("o worker não fica a viver entre derivações", () => {
  it("cada derivação enterra o seu: nem worker morto por matar, nem frase-passe num heap esquecido", async () => {
    const { derivarNoWorker } = await import("./kdf.js")

    await derivarNoWorker(FRASE, SAL, BARATO)
    expect(WorkerFalso.criados).toBe(1)
    expect(WorkerFalso.terminados).toBeGreaterThanOrEqual(1)

    await derivarNoWorker(FRASE, SAL, BARATO)
    expect(WorkerFalso.criados).toBe(2)
  })
})
