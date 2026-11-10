import type { CorpoDaDenuncia, ItemRelatado } from "@enclave/protocol"
import { toBase64 } from "@enclave/protocol"
import { dobrarConversa, porOrdemDoServidor, type OpcoesDaConversa } from "./dobras.js"
import { payloadSemBytes, prepararItem, type QuemRelata } from "./sincronia/relato.js"
import type { StoredChatMessage } from "./vault.js"

/**
 * The report built from the vault (`docs/planos/denuncias-design.md`, §5).
 *
 * Pure: receives the channel history and returns what leaves the device. Each item
 * is the ORIGINAL payload, with the author's signature (proof from §7) and without the bytes
 * of attachments. Our copy carries all messages; the founder's goes without those
 * from the reporter, and without a gap marker, because a gap also says where
 * it was.
 */

/** The reported message, up to 10 before and up to 5 after (`ITENS_POR_DENUNCIA_MAX` = 16). */
export const CONTEXTO_ANTES = 10
export const CONTEXTO_DEPOIS = 5
/** When reporting a person with no message: their last ones in the conversation. */
export const ULTIMAS_DA_PESSOA = 10

export interface AlvoDaDenuncia {
  canal: string
  sala?: string | undefined
  pessoa: string
  mensagem?: { id: string } | undefined
}

export interface ItemPreparado {
  item: ItemRelatado
  autor: string
  /** UTC, `YYYY-MM-DD`, from the author's `sentAt`. */
  dia: string
  /** UTC, `HH:MM`, from the author's `sentAt`. */
  hora: string
  texto: string
  anexos: { name: string; mediaType: string; byteLength?: number }[]
  denunciada: boolean
}

export interface DenunciaPreparada {
  canal: string
  sala?: string | undefined
  denunciado: string
  alvo: CorpoDaDenuncia["alvo"]
  /** Our copy: all of them, by seq. */
  itens: ItemPreparado[]
  /** Without those from the reporter, without gap markers. */
  itensDoFundador: ItemPreparado[]
  /** Index in `itens`; -1 when reporting the person. */
  denunciada: number
  /** Decided in Task 5; always `false` here. */
  temCopia: boolean
}

type Campos = Record<string, unknown>

const campos = (entrada: StoredChatMessage): Campos => entrada.payload as unknown as Campos
const idDe = (entrada: StoredChatMessage): unknown => campos(entrada)["id"]
/** The room of a message. Without `room` it is the default room (`DEFAULT_ROOM.room`, ""). */
const salaDe = (entrada: StoredChatMessage): string => {
  const room = campos(entrada)["room"]
  return typeof room === "string" ? room : ""
}

/**
 * The messages to carry, by seq.
 *
 * With message: it, up to `CONTEXTO_ANTES` before and `CONTEXTO_DEPOIS` after, from
 * its room. Without message: the last `ULTIMAS_DA_PESSOA` from the person (in the
 * target room, if given). Empty if the message is not in the history or is not from
 * the named person. Does not judge moderation: that is for `construirDenuncia`.
 */
export function seleccionarContexto(historico: readonly StoredChatMessage[], alvo: AlvoDaDenuncia): StoredChatMessage[] {
  const ditas = porOrdemDoServidor(historico).filter((entrada) => entrada.payload.t === "message")
  if (alvo.mensagem) {
    const denunciada = ditas.find((entrada) => idDe(entrada) === alvo.mensagem?.id)
    if (!denunciada || denunciada.sender !== alvo.pessoa) return []
    const sala = salaDe(denunciada)
    const daSala = ditas.filter((entrada) => salaDe(entrada) === sala)
    const indice = daSala.indexOf(denunciada)
    return daSala.slice(Math.max(0, indice - CONTEXTO_ANTES), indice + 1 + CONTEXTO_DEPOIS)
  }
  const daPessoa = ditas.filter(
    (entrada) => entrada.sender === alvo.pessoa && (alvo.sala === undefined || salaDe(entrada) === alvo.sala),
  )
  return daPessoa.slice(-ULTIMAS_DA_PESSOA)
}

/** The founder's list: without messages from `eu`, and with nothing in their place. */
export function semAsMinhas(itens: readonly ItemPreparado[], eu: string): ItemPreparado[] {
  return itens.filter((item) => item.autor !== eu && item.item.a !== eu)
}

function doisDigitos(n: number): string {
  return String(n).padStart(2, "0")
}

function carimbo(ms: number): { dia: string; hora: string } {
  const data = new Date(ms)
  return {
    dia: `${data.getUTCFullYear()}-${doisDigitos(data.getUTCMonth() + 1)}-${doisDigitos(data.getUTCDate())}`,
    hora: `${doisDigitos(data.getUTCHours())}:${doisDigitos(data.getUTCMinutes())}`,
  }
}

/** The size of an attachment, if it is a finite non-negative number. */
function tamanhoDe(anexo: unknown): number | undefined {
  if (typeof anexo !== "object" || anexo === null) return undefined
  const tamanho = (anexo as Campos)["byteLength"]
  return typeof tamanho === "number" && Number.isFinite(tamanho) && tamanho >= 0 ? tamanho : undefined
}

function anexosDe(payload: Campos): { name: string; mediaType: string; byteLength?: number }[] {
  const lista = payload["attachments"]
  if (!Array.isArray(lista)) return []
  return lista.map((anexo: unknown) => {
    const a = (typeof anexo === "object" && anexo !== null ? anexo : {}) as Campos
    const tamanho = tamanhoDe(anexo)
    return {
      name: typeof a["name"] === "string" ? a["name"] : "",
      mediaType: typeof a["mediaType"] === "string" ? a["mediaType"] : "",
      ...(tamanho !== undefined ? { byteLength: tamanho } : {}),
    }
  })
}

/**
 * The size back for each attachment in the item (§5: name, type and size).
 *
 * `payloadSemBytes` leaves only the dump marker, and sync needs it
 * that way. Here the size comes back, copied from the original. The signature still
 * checks: the signed form only reads the name and type of each attachment.
 */
function comTamanhos(p: Campos, original: Campos): Campos {
  const saida = p["attachments"]
  const antes = original["attachments"]
  if (!Array.isArray(saida) || !Array.isArray(antes)) return p
  return {
    ...p,
    attachments: saida.map((anexo: unknown, indice) => {
      const tamanho = tamanhoDe(antes[indice])
      if (tamanho === undefined || typeof anexo !== "object" || anexo === null) return anexo
      return { ...(anexo as Campos), byteLength: tamanho }
    }),
  }
}

/**
 * Build the report, or `null` ("this message cannot be reported"): the message
 * is not in the vault, is not from the named person, is from the reporter,
 * was deleted by the author, or was removed by moderation.
 *
 * `modera` asks the same question that the interface asks `dobrarConversa`: what
 * each honest app hides is not reported and does not go in context. A message
 * without a signature (before S4) goes anyway, unverified: the server marks it
 * "not verified", and never refuses it for that (§7).
 */
export function construirDenuncia(opts: {
  canal: string
  sala?: string | undefined
  alvo: AlvoDaDenuncia
  historico: readonly StoredChatMessage[]
  eu: QuemRelata
  cadeiaDe: (autor: string, aparelho: string) => { k: string; x: string } | null
  modera?: OpcoesDaConversa["modera"]
}): DenunciaPreparada | null {
  const { canal, alvo, eu } = opts
  if (alvo.pessoa === eu.address) return null

  // What the conversation shows: without those deleted by the author and without moderated ones.
  // The payloads that go are the originals (the signed ones), never the folded ones.
  const visiveis = new Set<unknown>()
  for (const dita of dobrarConversa(opts.historico, { modera: opts.modera })) {
    if ((dita.payload as unknown as Campos)["moderada"] !== true) visiveis.add(idDe(dita))
  }
  const historico = opts.historico.filter((entrada) => entrada.payload.t === "message" && visiveis.has(idDe(entrada)))

  const escolhidas = seleccionarContexto(historico, alvo)
  const denunciada = alvo.mensagem ? escolhidas.findIndex((entrada) => idDe(entrada) === alvo.mensagem?.id) : -1
  if (alvo.mensagem && denunciada < 0) return null

  const itens = escolhidas.map((entrada, indice): ItemPreparado => {
    const payload = campos(entrada)
    const autoria = payload["autoria"] as { ap?: unknown } | undefined
    const aparelho = typeof autoria?.ap === "string" ? autoria.ap : entrada.sender === eu.address ? toBase64(eu.aparelho) : null
    const cadeia = aparelho ? opts.cadeiaDe(entrada.sender, aparelho) : null
    const fonte = { autor: entrada.sender, seq: entrada.seq, payload: entrada.payload }
    const preparado: ItemRelatado = prepararItem(canal, fonte, eu, cadeia) ?? {
      // Without signature and from someone else (or mine, with an attachment already dumped):
      // goes unverified, and the server marks it "not verified".
      s: entrada.seq >= 0 ? entrada.seq : -1,
      a: entrada.sender,
      p: payloadSemBytes(payload),
    }
    const item: ItemRelatado = { ...preparado, p: comTamanhos(preparado.p, payload) }
    const sentAt = typeof payload["sentAt"] === "number" ? payload["sentAt"] : entrada.at
    return {
      item,
      autor: entrada.sender,
      ...carimbo(sentAt),
      texto: typeof payload["body"] === "string" ? payload["body"] : "",
      anexos: anexosDe(payload),
      denunciada: indice === denunciada,
    }
  })

  const sala = alvo.mensagem ? salaDe(escolhidas[denunciada]!) : (alvo.sala ?? opts.sala ?? "")

  return {
    canal,
    ...(sala !== "" ? { sala } : {}),
    denunciado: alvo.pessoa,
    alvo: alvo.mensagem ? { tipo: "mensagem", id: alvo.mensagem.id } : { tipo: "pessoa" },
    itens,
    itensDoFundador: semAsMinhas(itens, eu.address),
    denunciada,
    temCopia: false,
  }
}
