import { z } from "zod"
import { AssinaturaEd25519, ChaveEd25519, canonicoTolerante, ItemRelatado } from "./autoria.js"

/**
 * Reports (`docs/planos/denuncias-design.md`): the HTTP routes and the
 * signed request that authenticates them.
 *
 * The routes are HTTP and bypass the gateway, so no session says who is calling.
 * The reporter proves it in the body itself: the device signs the
 * request, and the chain (the account signed the device key) links that
 * signature to the address. The server checks everything without keeping session state;
 * the `nonce` and the `emitido` window block replay.
 *
 * All live under `/_enclave/*`, which is what Caddy passes to the server.
 */
export const ROTAS_DA_DENUNCIA = {
  enviar: "/_enclave/denuncia",
  fundador: "/_enclave/denuncia/fundador",
  caixa: "/_enclave/denuncia/caixa",
  suspensao: "/_enclave/denuncia/suspensao",
  revisao: "/_enclave/denuncia/revisao",
} as const

export type RotaDaDenuncia = (typeof ROTAS_DA_DENUNCIA)[keyof typeof ROTAS_DA_DENUNCIA]

export const PedidoAssinado = z.object({
  v: z.literal(1),
  endereco: z.string().max(300),
  /** The public key of the device that signs `as`. */
  aparelho: ChaveEd25519,
  /** The chain: `k` is the account key, `x` its signature over the device. */
  cadeia: z.object({ k: ChaveEd25519, x: AssinaturaEd25519 }),
  /** Milliseconds since the Unix epoch. */
  emitido: z.number().int().nonnegative(),
  /** 16 bytes in base64url. */
  nonce: z.string().length(22),
  rota: z.string().max(64),
  corpo: z.unknown(),
  as: AssinaturaEd25519,
})
export type PedidoAssinado = z.infer<typeof PedidoAssinado>

const ROTULO_DO_PEDIDO = "orwell-pedido-assinado-v1\0"

/**
 * The bytes the device signs:
 * `"orwell-pedido-assinado-v1\0"` + `canonicoTolerante({ endereco, aparelho, emitido, nonce, rota, corpo })`.
 *
 * The route is signed so a request made to one route can't be used on another. The
 * chain is not signed: it's verified on its own, against the address.
 */
export function mensagemDoPedido(pedido: Omit<PedidoAssinado, "as" | "v">): Uint8Array {
  const { endereco, aparelho, emitido, nonce, rota, corpo } = pedido
  return new TextEncoder().encode(ROTULO_DO_PEDIDO + canonicoTolerante({ endereco, aparelho, emitido, nonce, rota, corpo }))
}

/** How far ahead of or behind the server clock a request can be. */
export const JANELA_DO_PEDIDO_MS = 15 * 60_000

/**
 * The report reasons, in form order. The text for each one lives
 * in the UI (`packages/ui`); only the number travels here.
 */
export const MOTIVOS = [1, 2, 3, 4, 5, 6, 7, 8] as const
export type Motivo = (typeof MOTIVOS)[number]
/** They go to the front of the queue, and the alert recalls DSA article 18 (inform the police or the public prosecutor). */
export const MOTIVOS_PRIORITARIOS: readonly Motivo[] = [1, 2]
/** The reported message, up to 10 before and up to 5 after. */
export const ITENS_POR_DENUNCIA_MAX = 16
export const NOTA_MAX = 2000

/** The founder's copy, sealed on the device to the founder's key. The server can't open it. */
export const CopiaSelada = z.object({
  v: z.literal(1),
  /** The ephemeral X25519 key of the seal, in base64url (43 characters). */
  e: ChaveEd25519,
  n: z.string().length(32),
  c: z.string().max(600_000),
})
export type CopiaSelada = z.infer<typeof CopiaSelada>

/** The `corpo` of the signed request to `ROTAS_DA_DENUNCIA.enviar`. */
export const CorpoDaDenuncia = z.object({
  v: z.literal(1),
  motivo: z.number().int().min(1).max(8),
  nota: z.string().max(NOTA_MAX),
  boaFe: z.boolean(),
  contacto: z.object({ nome: z.string().max(120), email: z.string().max(254) }).optional(),
  canal: z.string().max(300),
  sala: z.string().max(64).optional(),
  denunciado: z.string().max(300),
  alvo: z.discriminatedUnion("tipo", [
    z.object({ tipo: z.literal("mensagem"), id: z.string().max(64) }),
    z.object({ tipo: z.literal("pessoa") }),
  ]),
  itens: z.array(ItemRelatado).min(0).max(ITENS_POR_DENUNCIA_MAX),
  /** The index in `itens` of the reported message; -1 when reporting a person. */
  denunciada: z.number().int().min(-1),
  versao: z.string().max(40),
  fundador: z.string().max(300).nullable(),
  copia: CopiaSelada.nullable(),
})
export type CorpoDaDenuncia = z.infer<typeof CorpoDaDenuncia>

/** UTC, `YYYY-MM-DD`. */
const Dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/**
 * What goes inside the seal of the founder's copy (§5 and §6.2).
 *
 * Nothing that identifies the reporter: none of the reporter's messages (`itensDoFundador`), no
 * version, no device, no contact, and of the time only the `dia` (UTC). `denunciada`
 * is the index in this copy's `itens`, not in ours.
 */
export const ConteudoDaCopia = z.object({
  v: z.literal(1),
  motivo: z.number().int().min(1).max(8),
  nota: z.string().max(NOTA_MAX),
  canal: z.string().max(300),
  sala: z.string().max(64).optional(),
  denunciado: z.string().max(300),
  alvo: CorpoDaDenuncia.shape.alvo,
  itens: z.array(ItemRelatado).max(ITENS_POR_DENUNCIA_MAX),
  denunciada: z.number().int().min(-1),
  dia: Dia,
})
export type ConteudoDaCopia = z.infer<typeof ConteudoDaCopia>

/** A mailbox id: lowercase letters, digits and hyphens (`d-<number>` for decisions). */
export const IdDaCaixa = z.string().min(1).max(64).regex(/^[a-z0-9-]+$/)

/** What an account's mailbox delivers: a copy sealed to the founder, or the decision to the reporter. */
export const ItemDaCaixa = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("copia"), id: IdDaCaixa, canal: z.string().max(300), copia: CopiaSelada }),
  z.object({
    tipo: z.literal("decisao"),
    id: IdDaCaixa,
    denuncia: z.number().int(),
    decisao: z.enum(["suspensa", "sem-accao"]),
    /** The reported channel. The reporter already knows it: nothing new leaks. */
    canal: z.string().max(300),
    /** UTC, `YYYY-MM-DD`: the day the report ARRIVED (that's how the reporter recognizes it), not the day it closed. */
    dia: Dia,
  }),
])
export type ItemDaCaixa = z.infer<typeof ItemDaCaixa>

/** The `corpo` of the signed request to `ROTAS_DA_DENUNCIA.fundador`. */
export const PedidoDoFundador = z.object({ canal: z.string().max(300) })
export type PedidoDoFundador = z.infer<typeof PedidoDoFundador>

/** Both `null` when no copy is possible, for any reason. */
export const RespostaDoFundador = z.object({ fundador: z.string().nullable(), chaveDeConta: ChaveEd25519.nullable() })
export type RespostaDoFundador = z.infer<typeof RespostaDoFundador>

/** The `corpo` of the signed request to `ROTAS_DA_DENUNCIA.caixa`: the ids already stored, which the server deletes. */
export const PedidoDaCaixa = z.object({ vistos: z.array(z.string().max(64)).max(200) })
export type PedidoDaCaixa = z.infer<typeof PedidoDaCaixa>

/** At most 50 per request: the rest come in the next one. */
export const ITENS_DA_CAIXA_MAX = 50
export const RespostaDaCaixa = z.object({ itens: z.array(ItemDaCaixa).max(ITENS_DA_CAIXA_MAX) })
export type RespostaDaCaixa = z.infer<typeof RespostaDaCaixa>

/**
 * An account's suspension notice (§8 and §9b; DSA article 17(3)): the
 * measure, its duration and scope; the facts and their source; that no automated means were used;
 * the rule or clause applied; and the review. The external routes
 * (the courts and ANACOM) are stated by the UI.
 *
 * Written by a person, through the VPS script (`ArquivoDeDenuncias.escreverAviso`),
 * and read by the suspended account at `ROTAS_DA_DENUNCIA.suspensao`.
 */
export const AvisoDeSuspensao = z.object({
  v: z.literal(1),
  endereco: z.string().max(300),
  motivo: z.number().int().min(1).max(8),
  medida: z.literal("suspensao-da-conta"),
  /** Dia, `YYYY-MM-DD`. */
  desde: z.string().max(40),
  /** Day, `YYYY-MM-DD`; `null` means until the review. */
  ate: z.string().max(40).nullable(),
  ambito: z.string().max(300),
  factos: z.string().max(2000),
  origem: z.enum(["denuncia", "autoridade", "operador"]),
  semMeiosAutomaticos: z.literal(true),
  norma: z.string().max(300),
  revisao: z.object({
    /** ISO 8601 of the last review request, or `null`. */
    pedida: z.string().max(40).nullable(),
    decisao: z.enum(["pendente", "mantida", "levantada"]),
    nota: z.string().max(2000),
  }),
})
export type AvisoDeSuspensao = z.infer<typeof AvisoDeSuspensao>

/** The response from `ROTAS_DA_DENUNCIA.suspensao`: `null` when there's no notice. */
export const RespostaDaSuspensao = z.object({ aviso: AvisoDeSuspensao.nullable() })
export type RespostaDaSuspensao = z.infer<typeof RespostaDaSuspensao>

/** The `corpo` of the signed request to `ROTAS_DA_DENUNCIA.revisao`. */
export const PedidoDeRevisao = z.object({ nota: z.string().min(1).max(NOTA_MAX) })
export type PedidoDeRevisao = z.infer<typeof PedidoDeRevisao>
