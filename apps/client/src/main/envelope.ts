/**
 * The error from a request, wrapped in an envelope before crossing the IPC.
 *
 * **This fixes the "Error 900" from the installed app.** An `ipcMain.handle` that lets the exception bubble up raw doesn't deliver it to the renderer the way it came out: Electron rewrites the message to `Error invoking remote method
 * 'vault:unlock': Error: wrong passphrase` and throws away the `name` and `cause`. The UI translates an error by the exact KEY (`translateError` in `packages/ui/src/strings.ts`), and that phrase is no key: every refusal from the core reached the screen as an unknown error code.
 *
 * So the error doesn't throw from here. It comes back as a normal response, with the key, name and detail intact, and the renderer bridge turns it back into a `Error` the same as the web bridge throws. See `renderer/envelope.ts`.
 *
 * No `electron` inside here, for the reason of `canais.ts`: so you can measure it without opening a window.
 */

/** What a request returns when it fails. The shape is shared with the renderer. */
export interface ErroEmEnvelope {
  ok: false
  /** The `message` of the original error, which is the error catalog key. */
  chave: string
  /** The `cause` of the original error, if it survives cloning. */
  detalhe: unknown
  /** The `name` of the original error. The interface distinguishes some errors by it. */
  nome: string
}

/**
 * The detail, only if it survives the IPC boundary.
 *
 * What crosses the boundary is cloned, and a `cause` with functions or classes
 * would break cloning inside Electron. Then the requester would not get the error
 * at all: they would get another one, about cloning. Better to lose the detail
 * and keep the key, which is what the interface reads.
 */
function detalheQueAtravessa(causa: unknown): unknown {
  if (causa === undefined || causa === null) return null
  // JSON, not `structuredClone`: Node 24's version accepts things (DOMException,
  // KeyObject) that Electron's IPC serializer might handle differently. What the
  // interface reads from the detail is plain numbers and text.
  try {
    const simples: unknown = JSON.parse(JSON.stringify(causa))
    return simples === undefined ? String(causa) : simples
  } catch {
    return String(causa)
  }
}

/** Any exception, enveloped. */
export function erroEmEnvelope(erro: unknown): ErroEmEnvelope {
  if (erro instanceof Error) {
    return { ok: false, chave: erro.message, detalhe: detalheQueAtravessa(erro.cause), nome: erro.name }
  }
  // Someone threw a string or an object. The key stays, with no proper name.
  return { ok: false, chave: String(erro), detalhe: null, nome: "Error" }
}

/**
 * Wrap a handler with the error envelope.
 *
 * What succeeds exits as it did: handlers that already respond with `{ ok: true }`
 * or a value keep their shape. Only the exception changes path.
 */
export function embrulharErros<A extends unknown[], R>(
  fazer: (...argumentos: A) => R,
): (...argumentos: A) => Promise<Awaited<R> | ErroEmEnvelope> {
  return async (...argumentos: A): Promise<Awaited<R> | ErroEmEnvelope> => {
    try {
      return (await fazer(...argumentos)) as Awaited<R>
    } catch (erro) {
      return erroEmEnvelope(erro)
    }
  }
}
