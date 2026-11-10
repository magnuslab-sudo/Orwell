import { z } from "zod"

/**
 * The short code for invite links (1.0 "Arca", slice 4).
 *
 * `https://orwell.pt/c#<8 caracteres>` instead of
 * `https://orwell.pt/app/convite#!<canal>:<servidor>/<código>`. The server gives the
 * code to whoever creates the invite (`invite.created.codigoCurto`) and, when an
 * authenticated account asks, resolves it to the channel and the invite's `codeHash`
 * (`invite.resolve`). The code stays in the fragment, so it never reaches the server's
 * logs or the referer.
 *
 * **The alphabet has no characters that look alike**: no `0`/`o`, no
 * `1`/`l`/`i`. It has 31 symbols, lowercase, because the code is also read
 * aloud and copied by hand from a screen. Eight characters give
 * 31^8, close to 2^39.6: too little for a long-lived secret, and enough for one
 * that lives for days and resolves under a per-account cap and a global server cap
 * (`Gateway.RESOLUCOES_POR_MINUTO`). Whoever guesses a code gets what the
 * link gives: the right to ask the members for entry, and they remain the
 * only ones who let people in.
 */
export const ALFABETO_DO_CODIGO_CURTO = "23456789abcdefghjkmnpqrstuvwxyz"

/** How many characters a short code has. */
export const CODIGO_CURTO_CARACTERES = 8

const FORMA_DO_CODIGO_CURTO = new RegExp(`^[${ALFABETO_DO_CODIGO_CURTO}]{${CODIGO_CURTO_CARACTERES}}$`)

/** A short code, as it travels: eight lowercase characters from the alphabet. */
export const CodigoCurto = z.string().regex(FORMA_DO_CODIGO_CURTO, "expected a short invite code")

/** True only for a short code already in wire form. */
export function eCodigoCurto(texto: string): boolean {
  return FORMA_DO_CODIGO_CURTO.test(texto)
}

/**
 * A code typed by a person, put into wire form, or `null`.
 *
 * Strips the spaces and hyphens of someone who copied it in pieces, and lowercases
 * it. It does not swap a `0` for an `o` or a `1` for an `l`: the alphabet has
 * neither, and guessing which one it was would be inventing a code.
 */
export function normalizarCodigoCurto(texto: string): string | null {
  const limpo = texto.replace(/[\s-]/g, "").toLowerCase()
  return eCodigoCurto(limpo) ? limpo : null
}
