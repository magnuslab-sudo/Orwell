import {
  ANEXO_DO_PERFIL,
  CHAVES_DE_ANEXOS,
  eRetratoDoPerfil,
  fromBase64,
  levaAutoria,
  Payload,
  toBase64,
  verificarAutoria,
  verifyDeviceChain,
  type CorpoDaDenuncia,
  type ItemRelatado,
} from "@enclave/protocol"
import type { DenunciaGuardada } from "./denuncia.js"
import type { Store } from "./store.js"

/**
 * The authenticity proof of each item in a report
 * (`docs/planos/denuncias-design.md`, §7).
 *
 * The reporter hands over other people's text. The server does not read it to judge,
 * but verifies that each item is what the author signed, on the channel the report
 * names, with a device that speaks for that account. This is what separates "Bruno
 * said this" from "Ana says Bruno said this".
 *
 * An item without proof never causes the report to be rejected: it is stored with
 * the reason, and the reviewer decides with that in front of them.
 */

export type RazaoDoVeredicto =
  | "verificada"
  | "sem-autoria"
  | "esquema"
  | "assinatura-invalida"
  | "cadeia-invalida"
  | "aparelho-desconhecido"
  | "aparelho-revogado"

export interface VeredictoDoItem {
  indice: number
  autor: string
  veredicto: RazaoDoVeredicto
  /** The device that signed, when the signature checks out (even if revoked: reviewers want to know which). */
  aparelho?: string
}

/**
 * The payload as the schema sees it, so the signed form matches the author's.
 *
 * Attachments arrive without bytes (the `evicted` marker, with the size included
 * when the reporter knew it). The schema asks for `byteLength`; the signed form
 * only reads the name and the type, so a missing size passes as 0 without changing
 * anything that is verified.
 */
function paraOEsquema(p: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const copia: Record<string, unknown> = { ...p }
  for (const chave of CHAVES_DE_ANEXOS) {
    const lista = p[chave]
    if (!Array.isArray(lista)) continue
    copia[chave] = lista.map((anexo: unknown) => {
      if (typeof anexo !== "object" || anexo === null) return anexo
      const campos = anexo as Record<string, unknown>
      return typeof campos["byteLength"] === "number" ? campos : { ...campos, byteLength: 0 }
    })
  }
  return copia
}

type ProvaDoItem = Omit<VeredictoDoItem, "indice" | "autor"> & {
  /** The payload as the schema parsed it, when the schema accepts it, without bytes: this is what gets stored. */
  normal?: Record<string, unknown>
}

/**
 * An attachment as stored: the name, the type and the size the reporter sent,
 * and the eviction marker if it had one. Nothing else (§5): no bytes
 * (`inline`, `poster`, `partes`), no blob path and keys (`url`, `key`, `nonce`,
 * `digest`), no `kind` that the schema set by default. The server does not trust
 * the reporter's device for this: a child abuse report must not put the material
 * on our disk.
 */
function anexoParaGuardar(original: unknown): Record<string, unknown> {
  if (typeof original !== "object" || original === null) return {}
  const anexo = original as Record<string, unknown>
  const tamanho = anexo["byteLength"]
  return {
    ...(typeof anexo["name"] === "string" ? { name: anexo["name"] } : {}),
    ...(typeof anexo["mediaType"] === "string" ? { mediaType: anexo["mediaType"] } : {}),
    ...(typeof tamanho === "number" && Number.isSafeInteger(tamanho) && tamanho >= 0 ? { byteLength: tamanho } : {}),
    ...(anexo["evicted"] === true ? { evicted: true } : {}),
  }
}

/**
 * The payload to store. `lido` is what the schema read (without keys it does not
 * know about, and that nobody signed), or the original when the schema rejects it.
 * In either case, attachments are rebuilt from the ORIGINAL by `anexoParaGuardar`,
 * and link cards lose their thumbnail. The proof does not change: the signed form
 * only reads the name and type of each attachment, never the thumbnail.
 */
function paraGuardar(original: Readonly<Record<string, unknown>>, lido: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const saida: Record<string, unknown> = { ...lido }
  for (const chave of CHAVES_DE_ANEXOS) {
    const antes = original[chave]
    if (Array.isArray(antes)) saida[chave] = antes.map(anexoParaGuardar)
  }
  if (eRetratoDoPerfil(original, ANEXO_DO_PERFIL)) {
    const retrato = original[ANEXO_DO_PERFIL]
    if (typeof retrato === "object" && retrato !== null) saida[ANEXO_DO_PERFIL] = anexoParaGuardar(retrato)
  }
  const links = saida["links"]
  if (Array.isArray(links)) {
    saida["links"] = links.map((cartao: unknown) => {
      if (typeof cartao !== "object" || cartao === null) return cartao
      const { thumbnail: _miniatura, ...resto } = cartao as Record<string, unknown>
      return resto
    })
  }
  return saida
}

/**
 * From cheapest to most expensive:
 *
 * 1. A type that carries authorship, and a payload the schema accepts.
 * 2. The device's signature over the channel, the author and the payload form.
 * 3. The device is not revoked. This comes before membership: a revoked device
 *    leaves the manifest and the tree, and without this the reason would just
 *    be "unknown".
 * 4. The device speaks for the account: the `k`/`x` chain ends at the address,
 *    or, without a chain, the account registered it on this server.
 * 5. If there is a manifest, the device is in it.
 */
function provarItem(store: Store, canal: string, item: ItemRelatado): ProvaDoItem {
  if (!levaAutoria(item.p["t"])) return { veredicto: "esquema" }
  const lido = Payload.safeParse(paraOEsquema(item.p))
  if (!lido.success) return { veredicto: "esquema" }
  const normal = lido.data as Record<string, unknown>
  const guardar = paraGuardar(item.p, normal)
  const com = (veredicto: RazaoDoVeredicto, aparelho?: string): ProvaDoItem => ({
    veredicto,
    ...(aparelho !== undefined ? { aparelho } : {}),
    normal: guardar,
  })

  const autoria = verificarAutoria(canal, item.a, normal)
  if (!autoria.ok) return com(autoria.razao === "sem-autoria" ? "sem-autoria" : "assinatura-invalida")
  const aparelho = autoria.aparelho

  if (store.isDeviceRevoked(item.a, aparelho)) return com("aparelho-revogado", aparelho)

  if (item.k !== undefined || item.x !== undefined) {
    if (item.k === undefined || item.x === undefined) return com("cadeia-invalida", aparelho)
    const fecha = verifyDeviceChain({
      address: item.a,
      accountKey: fromBase64(item.k),
      deviceKey: fromBase64(aparelho),
      signature: fromBase64(item.x),
    })
    if (!fecha) return com("cadeia-invalida", aparelho)
  } else if (!store.devicesOf(item.a).some((chave) => toBase64(chave) === aparelho)) {
    return com("aparelho-desconhecido", aparelho)
  }

  const manifesto = store.deviceManifestOf(item.a)
  if (manifesto && !manifesto.devices.some((entrada) => entrada.deviceKey === aparelho)) {
    return com("aparelho-desconhecido", aparelho)
  }
  return com("verificada", aparelho)
}

function provarSemLancar(store: Store, canal: string, item: ItemRelatado): ProvaDoItem {
  try {
    return provarItem(store, canal, item)
  } catch (erro) {
    // A malformed payload that still passed the schema (a number that canonical JSON
    // does not encode): no proof, and the report goes ahead. Only the error message,
    // never the item content.
    console.error(`enclave: a prova de um item da denúncia falhou: ${(erro as Error)?.message ?? "erro"}`)
    return { veredicto: "esquema" }
  }
}

/** The verdict for one item, on the channel the report names. Never throws. */
export function verificarItem(store: Store, canal: string, item: ItemRelatado): VeredictoDoItem["veredicto"] {
  return provarSemLancar(store, canal, item).veredicto
}

/**
 * The proof for the entire report, and the items to store.
 *
 * `geral` is "verified" only when the proof covers what is reported (§7: the named
 * author wrote that text). With a message target: the `denunciada` item checks out,
 * is from the reported account, has the target id and is in the room the report
 * names. With a person target: all of that person's items check out, and there is at least one.
 *
 * Items to store carry the schema-parsed payload whenever the schema accepts it:
 * a key that nobody signed does not sit next to a "verified". And none carries bytes
 * or attachment secrets (`paraGuardar`), accepted or not.
 */
export function provarDenuncia(
  store: Store,
  corpo: CorpoDaDenuncia,
): { verificacao: DenunciaGuardada["verificacao"]; itens: ItemRelatado[] } {
  const provas = corpo.itens.map((item) => provarSemLancar(store, corpo.canal, item))
  const veredictos = provas.map(({ normal: _normal, ...veredicto }, indice): VeredictoDoItem => ({
    indice,
    autor: corpo.itens[indice]!.a,
    ...veredicto,
  }))
  let verificada: boolean
  if (corpo.alvo.tipo === "mensagem") {
    const prova = provas[corpo.denunciada]
    const sala = prova?.normal?.["room"]
    verificada =
      prova?.veredicto === "verificada" &&
      corpo.itens[corpo.denunciada]!.a === corpo.denunciado &&
      prova.normal?.["id"] === corpo.alvo.id &&
      (typeof sala === "string" ? sala : "") === (corpo.sala ?? "")
  } else {
    const daPessoa = veredictos.filter((item) => item.autor === corpo.denunciado)
    verificada = daPessoa.length > 0 && daPessoa.every((item) => item.veredicto === "verificada")
  }
  // Every item goes out without bytes, even one the schema rejected.
  const itens = corpo.itens.map((item, indice) => ({ ...item, p: provas[indice]!.normal ?? paraGuardar(item.p, item.p) }))
  return { verificacao: { geral: verificada ? "verificada" : "nao-verificada", itens: veredictos }, itens }
}

/** Only the verification (see `provarDenuncia`). */
export function verificarDenuncia(store: Store, corpo: CorpoDaDenuncia): DenunciaGuardada["verificacao"] {
  return provarDenuncia(store, corpo).verificacao
}
