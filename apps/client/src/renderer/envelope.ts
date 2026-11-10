/**
 * Remake the error that the main process put in the envelope.
 *
 * The other side is in `main/envelope.ts`, with the full reason: an error that
 * crosses IPC raw loses the key, the name and the detail, and the interface showed
 * "Error 900" at each refusal. Here the envelope becomes the `Error` again that the
 * web bridge throws, with the same `message`, the same `name` and the same `cause`.
 *
 * On the renderer side and not the `preload`, on purpose: an error that the `preload`
 * threw would cross the `contextBridge`, and the `contextBridge` only copies the
 * message. The name and the detail died on the way again.
 *
 * The form is repeated and not imported from the main process, by the rule of
 * `bridge.ts`: the renderer does not load code from there.
 */

interface ErroEmEnvelope {
  ok: false
  chave: string
  detalhe: unknown
  nome: string
}

/**
 * Is it an error envelope? Only with `ok: false` AND a `chave`.
 *
 * Both conditions, not just the first: there are handlers that already answered
 * `{ ok: false }` as a normal response (the skipped update that did not save, screen
 * settings outside macOS). Those stay responses.
 */
function ehErroEmEnvelope(valor: unknown): valor is ErroEmEnvelope {
  return (
    typeof valor === "object" &&
    valor !== null &&
    (valor as { ok?: unknown }).ok === false &&
    typeof (valor as { chave?: unknown }).chave === "string"
  )
}

/** Throw the error from the envelope, or return the response as it came. */
export function desembrulhar<T>(resposta: T): T {
  if (!ehErroEmEnvelope(resposta)) return resposta
  const erro = new Error(resposta.chave, resposta.detalhe === null ? undefined : { cause: resposta.detalhe })
  erro.name = resposta.nome
  throw erro
}

const ehPromessa = (valor: unknown): valor is PromiseLike<unknown> =>
  typeof valor === "object" && valor !== null && typeof (valor as { then?: unknown }).then === "function"

/**
 * The whole host, with each request unwrapping the response.
 *
 * In one place, not request by request: there are more than eighty operations, and
 * one that got forgotten would show "Error 900" again with no one noticing.
 *
 * By `Proxy` and not by copy: this way the host is read at the moment of use, as
 * before, and not a snapshot of it taken at startup. An operation that the `preload`
 * does not bring keeps reading as `undefined`.
 *
 * Only PROMISES are touched. Synchronous reads of channels return their envelope
 * (`{ ok, valor }` or `{ ok, erro }`) and the bridge handles it; the `on.*` return
 * the cancel function. So `on` is not walked.
 */
export function desembrulharAnfitriao<T extends object>(anfitriao: T): T {
  // The same function and the same branch on each read, so `a.b === a.b` stays true
  // on the side of whoever uses it.
  const embrulhadas = new WeakMap<object, unknown>()

  const embrulhar = (valor: object, dono: object): unknown => {
    const feita = embrulhadas.get(valor)
    if (feita) return feita
    const nova =
      typeof valor === "function"
        ? (...argumentos: unknown[]) => {
            const resposta = Reflect.apply(valor, dono, argumentos)
            return ehPromessa(resposta) ? Promise.resolve(resposta).then(desembrulhar) : resposta
          }
        : ramo(valor)
    embrulhadas.set(valor, nova)
    return nova
  }

  /*
    The target of the `Proxy` is an EMPTY object, and the real one stays aside.
    
    What the `contextBridge` exposes can come frozen, and a `Proxy` on a frozen
    object can only return the original value of each property: it is a rule of the
    language, and would throw `TypeError` at the first read. With an empty target
    that rule does not apply, and the traps reroute everything to the real one.
    */
  const ramo = (no: object): object => {
    const ler = (nome: string | symbol): unknown => {
      const valor: unknown = Reflect.get(no, nome)
      if (nome === "on" || valor === null || (typeof valor !== "object" && typeof valor !== "function")) return valor
      return embrulhar(valor, no)
    }
    return new Proxy(
      {},
      {
        get: (_alvo, nome) => ler(nome),
        has: (_alvo, nome) => Reflect.has(no, nome),
        ownKeys: () => Reflect.ownKeys(no),
        getOwnPropertyDescriptor: (_alvo, nome) => {
          const original = Reflect.getOwnPropertyDescriptor(no, nome)
          if (!original) return undefined
          // Configurable, because the property does not exist on the empty target.
          return { configurable: true, enumerable: original.enumerable ?? true, writable: false, value: ler(nome) }
        },
      },
    )
  }

  return ramo(anfitriao) as T
}
