/**
 * "Send report": the request to the server, written once for both bridges
 * (the web and the Electron main process).
 *
 * The bridge chooses the destination, never the interface: the address comes from the
 * open account (its server), just like update `open` does not accept any address. The route
 * is in `apps/server/src/relato.ts`.
 *
 * Errors are keys from `lib/codigosDeErro.ts` in the interface: no network is
 * "could not reach the homeserver" (201), caps and refusals are the two report codes (214 and 215).
 */

export const ROTA_DO_RELATO = "/_enclave/relato"

/** The HTTP origin of the server for an account. `http` only on the development loopback, like the gateway. */
export function origemDoServidorDe(endereco: string): string {
  const host = endereco.slice(endereco.indexOf(":") + 1)
  return /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) ? `http://${host}` : `https://${host}`
}

export async function enviarRelato(
  origem: string,
  pedido: { endereco: string; versao: string; texto: string },
  buscar: typeof fetch = fetch,
): Promise<{ ok: true }> {
  let resposta: Response
  try {
    resposta = await buscar(`${origem}${ROTA_DO_RELATO}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pedido),
      // No cookies, no origin from where you came: the report states what it needs
      // to state in the body.
      credentials: "omit",
      referrerPolicy: "no-referrer",
    })
  } catch {
    throw new Error("could not reach the homeserver")
  }
  if (resposta.status === 429) throw new Error("too many logs sent")
  if (!resposta.ok) throw new Error("the server did not take the log")
  return { ok: true }
}
