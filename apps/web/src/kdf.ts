import { argon2id } from "@noble/hashes/argon2.js"
import type { DerivarChaveDoCofre } from "@enclave/client-core"
import type { PedidoDeDerivacao, RespostaDeDerivacao } from "./kdf-worker.js"

/**
 * Derivation of the vault key, in a Worker.
 *
 * Argon2id costs 64 MiB and three passes on purpose, which on a phone
 * is between one and seven seconds. On the main thread, where it always ran
 *, those seconds are a frozen screen: no pixels moving, no response to
 * touch, indistinguishable from a crashed app. It was the second complaint that
 * came from the phone, phrased as "remember password".
 *
 * The work still costs the same; it moves places. See `kdf-worker.ts` for
 * why there is no WASM here.
 *
 * **The fallback is deliberate and silent.** A motor with no `Worker`, a policy
 * that refuses it, a file that does not load: it derives right here, as
 * always. A gate that refused to open because the Worker did not start was
 * trading a slow screen for an unreachable account.
 *
 * **And there is a third death, that gives no warning.** The constructor throwing and the `error`
 * are the two easy ones. The one that matters on an old phone is WebKit KILLING the
 * worker under memory pressure, Argon2id asks it for 64 MiB, without firing
 * any event. Without the limit down below, the promise would hang,
 * `Vault.unlock` would never return, and the gate would stay at "opening…" forever.
 * A reload would make no difference. It is WORSE than the freeze we came to fix,
 * because the freeze at least ended.
 */

/** A request waiting for an answer from the Worker. */
interface AEspera {
  resolver: (chave: Uint8Array) => void
  rejeitar: (erro: Error) => void
}

/**
 * How long to wait for a worker before calling it dead.
 *
 * **Measures death, not slowness.** A normal derivation costs between one and seven
 * seconds on a phone; sixty is a number that no living machine reaches
 * and that any dead machine exceeds. A tight limit would be worse than
 * none: it would make a slow device derive twice, the second time on the thread that
 * draws.
 */
const TECTO_MS = 60_000

let trabalhador: Worker | null = null
let arrancouEFalhou = false
let proximoId = 1
const aEsperar = new Map<number, AEspera>()

/**
 * Discard the current worker. The next request starts another one.
 *
 * **Except when someone is still waiting for it.** The worker is one and shared;
 * `terminate()` fires no `error`, so a request that is still there does not fall on the usual path, it hangs
 * until the 60 s limit, and only then derives on the thread. Two derivations overlapping
 * and the second cost a minute: measured in `scripts/prova-kdf-fronteira.mjs` (61 490 ms).
 */
function enterrar(): void {
  if (aEsperar.size > 0) return
  trabalhador?.terminate()
  trabalhador = null
}

function arrancar(): Worker | null {
  if (trabalhador) return trabalhador
  if (arrancouEFalhou) return null
  try {
    // The form Vite knows: packs the file as a separate module and
    // rewrites this address to the bundle's. CSP already allows
    // `worker-src 'self' blob:`.
    trabalhador = new Worker(new URL("./kdf-worker.js", import.meta.url), { type: "module" })
  } catch {
    arrancouEFalhou = true
    return null
  }
  trabalhador.onmessage = (evento: MessageEvent<RespostaDeDerivacao>): void => {
    const resposta = evento.data
    const espera = aEsperar.get(resposta.id)
    if (!espera) return
    aEsperar.delete(resposta.id)
    if ("erro" in resposta) espera.rejeitar(new Error(resposta.erro))
    else espera.resolver(resposta.chave)
  }
  const morreu = (): void => {
    // The Worker died. Whoever was waiting falls on the usual path, and the
    // next request tries to start another one.
    const pendentes = [...aEsperar.values()]
    aEsperar.clear()
    enterrar()
    for (const espera of pendentes) espera.rejeitar(new Error("kdf worker failed"))
  }
  trabalhador.onerror = morreu
  // A response that cannot be deserialized is a response that never arrives:
  // the same outcome, and without it the call would just hit the cap. No argument, by
  // design, the two events have different shapes and neither matters to us.
  trabalhador.onmessageerror = morreu
  return trabalhador
}

/** Derive it right here. This is what the app has always done, and it is the foundation of everything. */
function derivarNestaThread(frase: string, sal: Uint8Array, parametros: PedidoDeDerivacao["parametros"]): Uint8Array {
  return argon2id(new TextEncoder().encode(frase), sal, parametros)
}

export const derivarNoWorker: DerivarChaveDoCofre = async (frase, sal, parametros) => {
  const worker = arrancar()
  if (!worker) return derivarNestaThread(frase, sal, parametros)
  const id = proximoId++
  let relogio: ReturnType<typeof setTimeout> | undefined
  try {
    return await new Promise<Uint8Array>((resolver, rejeitar) => {
      aEsperar.set(id, { resolver, rejeitar })
      relogio = setTimeout(() => rejeitar(new Error("kdf worker timed out")), TECTO_MS)
      const pedido: PedidoDeDerivacao = { id, frase, sal, parametros }
      worker.postMessage(pedido)
    })
  } catch {
    // Any Worker failure (announced death, silent death, lost message,
    // error inside) falls into the usual path. The screen freezes, which is
    // the old bug, and it beats not opening at all.
    //
    // The worker goes down with the request: if it is not responding, the next
    // request cannot wait for the same silence.
    aEsperar.delete(id)
    enterrar()
    return derivarNestaThread(frase, sal, parametros)
  } finally {
    clearTimeout(relogio)
    /*
      The worker dies on each derivation, even when it runs fine.

      We derive once per session (open the vault) and starting a worker costs
      milliseconds, so there is nothing to save here, and there are two things to
      gain. A worker that does not persist cannot be killed silently between two
      derivations, which is half of the bug above; and the passphrase stops being
      a second copy living in a heap that nobody touches again.
    */
    enterrar()
  }
}
