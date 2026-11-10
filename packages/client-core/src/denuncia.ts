import { abrirComConta, selarParaConta } from "@enclave/crypto"
import {
  ConteudoDaCopia,
  CopiaSelada,
  RespostaDaCaixa,
  RespostaDaSuspensao,
  RespostaDoFundador,
  ROTAS_DA_DENUNCIA,
  fromBase64,
  mensagemDoPedido,
  signWithDevice,
  toBase64,
  type AvisoDeSuspensao,
  type CorpoDaDenuncia,
  type Identity,
  type ItemDaCaixa,
  type Motivo,
  type PedidoAssinado,
  type RotaDaDenuncia,
} from "@enclave/protocol"
import type { DenunciaPreparada } from "./denuncia-construir.js"

/**
 * The signed request for reports, from the caller's side.
 *
 * Routes are HTTP, without gateway session: the device signs the request and carries
 * the chain that links it to the account. The server verifies in
 * `apps/server/src/pedido-assinado.ts`.
 */
export function assinarPedido(identidade: Identity, rota: RotaDaDenuncia, corpo: unknown, agora = Date.now()): PedidoAssinado {
  const nonce = toBase64(crypto.getRandomValues(new Uint8Array(16)))
  const semAssinatura = {
    endereco: identidade.address,
    aparelho: toBase64(identidade.deviceSigningPublicKey),
    cadeia: { k: toBase64(identidade.credential.accountKey), x: toBase64(identidade.credential.signature) },
    emitido: agora,
    nonce,
    rota,
    corpo,
  }
  return { v: 1, ...semAssinatura, as: toBase64(signWithDevice(identidade, mensagemDoPedido(semAssinatura))) }
}

/**
 * Sends the request to `origem + pedido.rota`, by the telemetry pattern (`relato.ts`).
 *
 * Errors are keys from `lib/codigosDeErro.ts` of the interface.
 */
export async function enviarPedidoAssinado<R>(origem: string, pedido: PedidoAssinado, buscar: typeof fetch = fetch): Promise<R> {
  let resposta: Response
  try {
    resposta = await buscar(`${origem}${pedido.rota}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pedido),
      // The caller is identified in the signature, nowhere else.
      credentials: "omit",
      referrerPolicy: "no-referrer",
    })
  } catch {
    throw new Error("could not reach the homeserver")
  }
  if (resposta.status === 429) throw new Error("too many reports sent")
  if (resposta.status === 401) {
    const erro = await resposta.json().catch(() => undefined)
    if ((erro as { error?: unknown } | undefined)?.error === "stale-request") throw new Error("the device clock is off")
  }
  if (!resposta.ok) throw new Error("the server did not take the report")
  return (await resposta.json()) as R
}

/**
 * Sends the report to `ROTAS_DA_DENUNCIA.enviar`, signed by this device.
 *
 * The server always responds `{}`, whether the reported account exists or not. Errors are those
 * from `enviarPedidoAssinado`.
 */
export async function enviarDenuncia(
  origem: string,
  identidade: Identity,
  corpo: CorpoDaDenuncia,
  buscar: typeof fetch = fetch,
): Promise<{ ok: true }> {
  await enviarPedidoAssinado<unknown>(origem, assinarPedido(identidade, ROTAS_DA_DENUNCIA.enviar, corpo), buscar)
  return { ok: true }
}

/** What the person chooses in the form (§4). */
export interface EscolhaDaDenuncia {
  motivo: Motivo
  nota: string
  boaFe: boolean
  contacto?: { nome: string; email: string } | undefined
}

/**
 * The report body, built from the prepared data and the choice. For reason 1, no note or
 * good faith is requested (§9b, art. 16.º, n.º 2 of DSA): they stay empty, whatever
 * the interface sends.
 */
export function corpoDaDenuncia(
  preparada: DenunciaPreparada,
  escolha: EscolhaDaDenuncia,
  versao: string,
  copia: { fundador: string | null; copia: CopiaSelada | null },
): CorpoDaDenuncia {
  const semPedido = escolha.motivo === 1
  return {
    v: 1,
    motivo: escolha.motivo,
    nota: semPedido ? "" : escolha.nota,
    boaFe: semPedido ? false : escolha.boaFe,
    ...(escolha.contacto ? { contacto: escolha.contacto } : {}),
    canal: preparada.canal,
    ...(preparada.sala !== undefined ? { sala: preparada.sala } : {}),
    denunciado: preparada.denunciado,
    alvo: preparada.alvo,
    itens: preparada.itens.map((item) => item.item),
    denunciada: preparada.denunciada,
    versao,
    fundador: copia.fundador,
    copia: copia.copia,
  }
}

/** UTC, `YYYY-MM-DD`. */
function diaUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * What goes inside the seal to the founder (§5 and §6.2): items without the reporter's
 * messages (`itensDoFundador`), and from the timestamp only the day, in UTC. No version,
 * no device, no contact, no good faith. `denunciada` now appears in this list, which is
 * shorter than ours.
 *
 * The `s` of each item (the server sequence, which nobody signed) becomes -1: gaps in
 * numbering showed where the reporter's messages were, and the copy carries no gap marker (§5).
 */
export function conteudoDaCopia(preparada: DenunciaPreparada, escolha: EscolhaDaDenuncia, agora = Date.now()): ConteudoDaCopia {
  const itens = preparada.itensDoFundador
  return {
    v: 1,
    motivo: escolha.motivo,
    nota: escolha.motivo === 1 ? "" : escolha.nota,
    canal: preparada.canal,
    ...(preparada.sala !== undefined ? { sala: preparada.sala } : {}),
    denunciado: preparada.denunciado,
    alvo: preparada.alvo,
    itens: itens.map((item) => ({ ...item.item, s: -1 })),
    denunciada: preparada.denunciada < 0 ? -1 : itens.findIndex((item) => item.denunciada),
    dia: diaUtc(agora),
  }
}

/**
 * Seals the copy with the founder's account key, bound to the channel (the AAD): the
 * server cannot put it in the inbox as belonging to a different channel. `null` if it
 * exceeds the `CopiaSelada` size limit (the report goes through without a copy).
 */
export function selarCopia(chaveDeConta: Uint8Array, conteudo: ConteudoDaCopia): CopiaSelada | null {
  const selado = selarParaConta(chaveDeConta, conteudo.canal, new TextEncoder().encode(JSON.stringify(conteudo)))
  const copia = { v: 1 as const, e: toBase64(selado.e), n: toBase64(selado.n), c: toBase64(selado.c) }
  return CopiaSelada.safeParse(copia).success ? copia : null
}

/**
 * Opens a copy of the inbox with the account private key. `null` if it is not for this
 * account, if it was tampered with, if it is not a valid copy, or if it names a different
 * channel than the inbox's. Never throws.
 */
export function abrirCopia(chavePrivadaDeConta: Uint8Array, item: Extract<ItemDaCaixa, { tipo: "copia" }>): ConteudoDaCopia | null {
  try {
    const selado = { e: fromBase64(item.copia.e), n: fromBase64(item.copia.n), c: fromBase64(item.copia.c) }
    const aberto = abrirComConta(chavePrivadaDeConta, item.canal, selado)
    if (!aberto) return null
    const lido = ConteudoDaCopia.safeParse(JSON.parse(new TextDecoder().decode(aberto)))
    return lido.success && lido.data.canal === item.canal ? lido.data : null
  } catch {
    return null
  }
}

/**
 * Asks the server who the founder of `canal` is, and their account key. Both become
 * `null` when no copy is possible (§6.2). Errors are those from `enviarPedidoAssinado`,
 * and "could not read the report inbox" for a response that cannot be read.
 */
export async function pedirFundador(
  origem: string,
  identidade: Identity,
  canal: string,
  buscar: typeof fetch = fetch,
): Promise<{ fundador: string | null; chaveDeConta: string | null }> {
  const resposta = await enviarPedidoAssinado<unknown>(origem, assinarPedido(identidade, ROTAS_DA_DENUNCIA.fundador, { canal }), buscar)
  const lida = RespostaDoFundador.safeParse(resposta)
  if (!lida.success) throw new Error("could not read the report inbox")
  return lida.data
}

/**
 * Reads this account's inbox. `vistos` are the ids this account already stored, and that
 * the server deletes; anything not mentioned comes back in the next request. Errors are
 * those from `enviarPedidoAssinado`, and "could not read the report inbox" for a
 * response that cannot be read.
 */
export async function lerCaixa(
  origem: string,
  identidade: Identity,
  vistos: readonly string[],
  buscar: typeof fetch = fetch,
): Promise<ItemDaCaixa[]> {
  const resposta = await enviarPedidoAssinado<unknown>(
    origem,
    assinarPedido(identidade, ROTAS_DA_DENUNCIA.caixa, { vistos: [...vistos] }),
    buscar,
  )
  const lida = RespostaDaCaixa.safeParse(resposta)
  if (!lida.success) throw new Error("could not read the report inbox")
  return lida.data.itens
}

/** An inbox item as the session returns it: the copy, opened when this device has the account key. */
export type ItemDaCaixaLido = ItemDaCaixa & {
  /** Only in copies. `undefined`: this device does not have the account key. `null`: it did not open. */
  conteudo?: ConteudoDaCopia | null
}

/**
 * The suspension notice for this account (`ROTAS_DA_DENUNCIA.suspensao`), or `null`
 * if the server has none. Via signed request: a suspended account does not enter the gateway,
 * and reads the reason here. Errors are those from `enviarPedidoAssinado`, and
 * "could not read the report inbox" for a response that cannot be read.
 */
export async function lerSuspensao(origem: string, identidade: Identity, buscar: typeof fetch = fetch): Promise<AvisoDeSuspensao | null> {
  const resposta = await enviarPedidoAssinado<unknown>(origem, assinarPedido(identidade, ROTAS_DA_DENUNCIA.suspensao, {}), buscar)
  const lida = RespostaDaSuspensao.safeParse(resposta)
  if (!lida.success) throw new Error("could not read the report inbox")
  return lida.data.aviso
}

/**
 * Requests a review of this account's suspension (`ROTAS_DA_DENUNCIA.revisao`), with the
 * person's note. A refusal (account not suspended, note empty, exceeds the 3 per day limit)
 * is "the server did not take the review request". Without network and with the clock wrong,
 * errors from `enviarPedidoAssinado`.
 */
export async function pedirRevisao(origem: string, identidade: Identity, nota: string, buscar: typeof fetch = fetch): Promise<{ ok: true }> {
  try {
    await enviarPedidoAssinado<unknown>(origem, assinarPedido(identidade, ROTAS_DA_DENUNCIA.revisao, { nota }), buscar)
  } catch (erro) {
    const mensagem = (erro as Error | undefined)?.message
    if (mensagem === "the server did not take the report" || mensagem === "too many reports sent") {
      throw new Error("the server did not take the review request")
    }
    throw erro
  }
  return { ok: true }
}
