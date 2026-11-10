import {
  DENUNCIAS_POR_PAYLOAD_MAX,
  DenunciaDaConta,
  levaAutoria,
  verificarAutoria,
  type ConteudoDaCopia,
  type ItemRelatado,
  type Motivo,
  type Payload,
} from "@enclave/protocol"
import { normalizar } from "./sincronia/relato.js"
import type { DenunciaRecebida, ItemDaDenunciaRecebida, VaultContents } from "./vault.js"

/**
 * A copy opened by the founder, stored as it is kept in the vault
 * (`docs/planos/denuncias-design.md`, §5 to §7).
 *
 * The reporter builds the copy, and can lie. So the founder
 * verifies each item again, like the server: the author's signature on the
 * channel, and the device that signed for that account. An item that does not
 * verify is shown anyway, marked "Not verified".
 */

/** Whether the device speaks for the author's account (the tree, or the chain and manifest). From the session. */
export type AparelhoConfiavel = (autor: string, aparelho: string, cadeia: { k?: string; x?: string }) => Promise<boolean>

/** Whether the item is what the author signed, on this channel, with one of their devices. Never throws. */
export async function itemVerificado(canal: string, item: ItemRelatado, confiavel: AparelhoConfiavel): Promise<boolean> {
  try {
    if (!levaAutoria(item.p["t"])) return false
    const normal = normalizar(item.p)
    if (!normal) return false
    const autoria = verificarAutoria(canal, item.a, normal)
    if (!autoria.ok) return false
    const cadeia = { ...(item.k !== undefined ? { k: item.k } : {}), ...(item.x !== undefined ? { x: item.x } : {}) }
    return await confiavel(item.a, autoria.aparelho, cadeia)
  } catch {
    return false
  }
}

function doisDigitos(n: number): string {
  return String(n).padStart(2, "0")
}

function anexosDe(p: Readonly<Record<string, unknown>>): ItemDaDenunciaRecebida["anexos"] {
  const lista = p["attachments"]
  if (!Array.isArray(lista)) return []
  return lista.map((anexo: unknown) => {
    const a = (typeof anexo === "object" && anexo !== null ? anexo : {}) as Record<string, unknown>
    const tamanho = a["byteLength"]
    return {
      name: typeof a["name"] === "string" ? a["name"] : "",
      mediaType: typeof a["mediaType"] === "string" ? a["mediaType"] : "",
      ...(typeof tamanho === "number" && Number.isSafeInteger(tamanho) && tamanho >= 0 ? { byteLength: tamanho } : {}),
    }
  })
}

/** The author's `sentAt`, when it is a readable instant. */
function instanteDe(p: Readonly<Record<string, unknown>>): number | null {
  const sentAt = p["sentAt"]
  return typeof sentAt === "number" && Number.isFinite(sentAt) && !Number.isNaN(new Date(sentAt).getTime()) ? sentAt : null
}

/**
 * The report to store. Items go by the author's order (`sentAt`): in the copy
 * the `s` is -1, on purpose (§5, no gap marker). An item without `sentAt` goes
 * at the end, by copy order.
 */
export async function denunciaRecebidaDe(
  id: string,
  conteudo: ConteudoDaCopia,
  confiavel: AparelhoConfiavel,
): Promise<DenunciaRecebida> {
  const verificadas = await Promise.all(conteudo.itens.map((item) => itemVerificado(conteudo.canal, item, confiavel)))
  const itens = conteudo.itens.map((item, indice) => {
    const quando = instanteDe(item.p)
    const data = quando === null ? null : new Date(quando)
    const body = item.p["body"]
    return {
      quando,
      item: {
        autor: item.a,
        dia: data ? `${data.getUTCFullYear()}-${doisDigitos(data.getUTCMonth() + 1)}-${doisDigitos(data.getUTCDate())}` : "",
        hora: data ? `${doisDigitos(data.getUTCHours())}:${doisDigitos(data.getUTCMinutes())}` : "",
        texto: typeof body === "string" ? body : "",
        anexos: anexosDe(item.p),
        verificada: verificadas[indice] === true,
        denunciada: indice === conteudo.denunciada,
      } satisfies ItemDaDenunciaRecebida,
    }
  })
  // `sort` is stable: ties and items without `sentAt` stay by copy order.
  itens.sort((a, b) => (a.quando === b.quando ? 0 : a.quando === null ? 1 : b.quando === null ? -1 : a.quando - b.quando))
  return {
    id,
    canal: conteudo.canal,
    ...(conteudo.sala !== undefined ? { sala: conteudo.sala } : {}),
    dia: conteudo.dia,
    motivo: conteudo.motivo as Motivo,
    nota: conteudo.nota,
    denunciado: conteudo.denunciado,
    alvo: conteudo.alvo,
    itens: itens.map((entrada) => entrada.item),
    lida: false,
  }
}

// ------------------------------------------- between account devices

/** How many reports go in the full state to a sibling: the most recent ones. */
export const DENUNCIAS_PARA_OS_IRMAOS_MAX = 50

/**
 * The payloads that carry `denuncias` to siblings, over the account channel: a
 * `estado.fichas` with empty cards, which a 1.3.0 sibling reads without objection and
 * from which it drops reports. Up to `DENUNCIAS_POR_PAYLOAD_MAX` per
 * payload. Without the `lida`: reading is per device. A report that does not
 * pass the thread schema (a twisted vault) is left out on its own.
 */
export function payloadsDasDenuncias(denuncias: readonly DenunciaRecebida[]): Payload[] {
  const noFio: DenunciaDaConta[] = []
  for (const { lida: _lida, ...denuncia } of denuncias) {
    const lida = DenunciaDaConta.safeParse(denuncia)
    if (lida.success) noFio.push(lida.data)
  }
  const payloads: Payload[] = []
  for (let i = 0; i < noFio.length; i += DENUNCIAS_POR_PAYLOAD_MAX) {
    payloads.push({ t: "estado.fichas", fichas: {}, denuncias: noFio.slice(i, i + DENUNCIAS_POR_PAYLOAD_MAX) })
  }
  return payloads
}

/** The vault's reports for the full state: the most recent by day, up to the cap, by arrival order. */
export function denunciasParaOsIrmaos(contents: VaultContents, tecto = DENUNCIAS_PARA_OS_IRMAOS_MAX): DenunciaRecebida[] {
  const todas = Object.values(contents.denuncias ?? {}).flat()
  if (todas.length <= tecto) return todas
  const corte = new Set([...todas].sort((a, b) => (a.dia < b.dia ? 1 : a.dia > b.dia ? -1 : 0)).slice(0, tecto))
  return todas.filter((d) => corte.has(d))
}

/**
 * Joins to the vault the reports that a sibling opened, once per id, by reading. The
 * copy that was waiting here (`copiasPorAbrir`) stops being. Returns the
 * channels that gained a report.
 */
export function fundirDenuncias(contents: VaultContents, chegadas: readonly DenunciaDaConta[]): string[] {
  const canais = new Set<string>()
  const jaCa = new Set(Object.values(contents.denuncias ?? {}).flatMap((lista) => lista.map((d) => d.id)))
  for (const chegada of chegadas) {
    if (contents.copiasPorAbrir) {
      delete contents.copiasPorAbrir[chegada.id]
      if (Object.keys(contents.copiasPorAbrir).length === 0) delete contents.copiasPorAbrir
    }
    if (jaCa.has(chegada.id)) continue
    jaCa.add(chegada.id)
    const porCanal = (contents.denuncias ??= {})
    porCanal[chegada.canal] = [...(porCanal[chegada.canal] ?? []), doFio(chegada)]
    canais.add(chegada.canal)
  }
  return [...canais]
}

/** The thread's vault form: without optional keys as `undefined`, and by reading. */
function doFio(d: DenunciaDaConta): DenunciaRecebida {
  return {
    id: d.id,
    canal: d.canal,
    ...(d.sala !== undefined ? { sala: d.sala } : {}),
    dia: d.dia,
    motivo: d.motivo,
    nota: d.nota,
    denunciado: d.denunciado,
    alvo: d.alvo,
    itens: d.itens.map((item) => ({
      autor: item.autor,
      dia: item.dia,
      hora: item.hora,
      texto: item.texto,
      anexos: item.anexos.map((a) => ({
        name: a.name,
        mediaType: a.mediaType,
        ...(a.byteLength !== undefined ? { byteLength: a.byteLength } : {}),
      })),
      verificada: item.verificada,
      denunciada: item.denunciada,
    })),
    lida: false,
  }
}
