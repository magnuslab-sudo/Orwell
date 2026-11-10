/**
 * Browser errors, stated as error catalog keys.
 *
 * A `DOMException` brings two things: the `name` ("NotAllowedError"), which is
 * stable and the same across all engines, and the `message`, which is from each
 * engine and version ("Permission denied", "The request is not allowed by the
 * user agent..."). The interface translates an error by its exact key, and the
 * engine message is never a key: it would arrive on screen as "Error 900".
 *
 * So the key comes from the `name`. The engine message is not lost: it goes in
 * `cause`, for diagnostics and for reporting.
 *
 * Here in the core and not in the interface, because the call handler (`call.ts`)
 * also catches these errors and must state the same key the interface states.
 */

/**
 * The `name` of each browser error that can reach the screen, and its key.
 *
 * `QuotaExceededError` maps to the vault-full key on purpose: for the reader
 * it is the same thing (this device's storage is full), and the remedy is the
 * same.
 */
export const CHAVES_DOS_ERROS_DO_BROWSER: Readonly<Record<string, string>> = {
  NotAllowedError: "the browser or the system did not allow this",
  // Chrome's old name for the same error.
  PermissionDeniedError: "the browser or the system did not allow this",
  NotFoundError: "no microphone or camera was found",
  DevicesNotFoundError: "no microphone or camera was found",
  NotReadableError: "the microphone or the camera is busy",
  TrackStartError: "the microphone or the camera is busy",
  OverconstrainedError: "no microphone or camera fits",
  AbortError: "the browser stopped the operation",
  InvalidStateError: "the browser was not ready",
  SecurityError: "the browser blocked this for safety",
  NotSupportedError: "this browser cannot do that",
  QuotaExceededError: "vault storage is full",
}

/**
 * Messages that some hosts throw without the right `name`.
 *
 * Electron refuses the microphone with "Permission denied by system", and there
 * are paths (an old `preload`, an error crossing `contextBridge`) where only
 * the message arrives. They are few and stable; the list does not grow by guessing.
 */
const CHAVES_DAS_MENSAGENS_DO_BROWSER: Readonly<Record<string, string>> = {
  "Permission denied": "the browser or the system did not allow this",
  "Permission denied by system": "the browser or the system did not allow this",
  "Permission dismissed": "the browser or the system did not allow this",
}

/** The key of a browser error, or `null` if it is not a known browser error. */
export function chaveDoErroDoBrowser(erro: unknown): string | null {
  if (typeof erro !== "object" || erro === null) return null
  const nome = (erro as { name?: unknown }).name
  if (typeof nome === "string" && Object.hasOwn(CHAVES_DOS_ERROS_DO_BROWSER, nome)) {
    return CHAVES_DOS_ERROS_DO_BROWSER[nome]!
  }
  const mensagem = (erro as { message?: unknown }).message
  if (typeof mensagem === "string" && Object.hasOwn(CHAVES_DAS_MENSAGENS_DO_BROWSER, mensagem)) {
    return CHAVES_DAS_MENSAGENS_DO_BROWSER[mensagem]!
  }
  return null
}

/**
 * A browser error replaced with an `Error` holding the key, and the rest in `cause`.
 *
 * What is not a known browser error comes back as is: a core error already
 * carries its key.
 */
export function comChaveDoBrowser(erro: unknown): unknown {
  const chave = chaveDoErroDoBrowser(erro)
  if (chave === null) return erro
  const { name, message } = erro as { name?: unknown; message?: unknown }
  return new Error(chave, { cause: { nome: String(name ?? ""), mensagem: String(message ?? "") } })
}
