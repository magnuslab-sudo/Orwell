import { argon2id } from "@noble/hashes/argon2.js"

/**
 * Argon2id for the vault, off the main thread.
 *
 * **It's the SAME implementation the core has always used**, and that's the
 * important decision here. The measured alternative was a WASM compilation of
 * Argon2, three to six times faster, and was rejected for two reasons that
 * matter more than milliseconds:
 *
 * 1. **Security policy.** The `index.html` says `script-src 'self'`, no
 *    `'wasm-unsafe-eval'`. An encrypted messaging app doesn't relax CSP to
 *    save half a second on a screen that appears once per session.
 * 2. **Dependency.** This is the line that derives the vault key: the most
 *    critical one in the entire client. Adding a new third-party library here
 *    costs audit, and it costs forever.
 *
 * What we gain without WASM is what the complaint was: the screen responds.
 * Derivation still costs what it costs (that's the point of KDF), but it costs
 * it HERE, and the main thread is free to draw the progress indicator, accept
 * touch input, and not appear frozen.
 *
 * Parameters come from outside, from `KDF` in `vault.ts`, and are never
 * chosen here: two places deciding this would be a vault that locks with one
 * set and tries to open with another.
 */

/** What goes in: the passphrase, the vault salt, and the parameters the core fixed. */
export interface PedidoDeDerivacao {
  id: number
  frase: string
  sal: Uint8Array
  parametros: { t: number; m: number; p: number; dkLen: number }
}

/** What comes out: the key, or the reason it didn't. */
export type RespostaDeDerivacao = { id: number; chave: Uint8Array } | { id: number; erro: string }

self.onmessage = (evento: MessageEvent<PedidoDeDerivacao>): void => {
  const { id, frase, sal, parametros } = evento.data
  try {
    const chave = argon2id(new TextEncoder().encode(frase), sal, parametros)
    // Transferred, not copied: it's 32 bytes, but one fewer copy of this key in
    // memory.
    ;(self as unknown as Worker).postMessage({ id, chave } satisfies RespostaDeDerivacao, [chave.buffer])
  } catch (caught) {
    ;(self as unknown as Worker).postMessage({ id, erro: (caught as Error).message } satisfies RespostaDeDerivacao)
  }
}
