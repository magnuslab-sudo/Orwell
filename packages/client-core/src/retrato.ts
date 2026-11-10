import {
  ANEXO_DO_PERFIL,
  assinarAutoria,
  partirRetrato,
  verificarAutoria,
  type CandidatoDoRetrato,
  type ItemRelatado,
  type RetratoPartido,
} from "@enclave/protocol"
import { normalizar, type QuemRelata } from "./sincronia/relato.js"
import type { StoredPayload, VaultContents } from "./vault.js"

/**
 * The channel portrait in Welcome, from the vault side (phase 1 of
 * `docs/planos/estado-cifrado-plano.md`). The format and crop are in
 * `retrato.ts` of the protocol; reception is `receberItem` (`sincronia/relato.ts`)
 * with session guards. Here stays what is pure: assemble candidates
 * from the vault, and pick the founder from what arrived.
 */

/** The built-in role (`ADMIN_ROLE` in `session.ts`): not defined, so it does not go. */
const PAPEL_EMBUTIDO = "admin"

/** What assembly needs to know from the session. */
export interface FonteDoRetrato {
  canal: string
  eu: QuemRelata
  conteudo: VaultContents
  /** The accounts with a sheet in the tree of this channel, after the commit that seats the newcomer. */
  membros: readonly string[]
  /** Our profile, as it goes out to this channel (`#payloadDoPerfil`), or `null` without a name. */
  perfilProprio: StoredPayload | null
  /** Our powers in this channel: what we can sign again in our name. */
  fundador: boolean
  gerePapeis: boolean
  arruma: boolean
  fixa: boolean
  /** The roles of a person, by the session rule (`rolesFor`). */
  cargosDe: (address: string) => string[]
}

export interface RetratoMontado extends RetratoPartido {
  /**
   * Whether the portrait carries ALL the state that the invite cascade would carry (the
   * foundation, the roles, the assignments, the categories, the rooms, and the banner).
   * Only then the cascade jumps (`#announceLocalEpoch`). Other people's profiles do not
   * count: they never came from the invite cascade.
   */
  completo: boolean
}

/** A payload with authorship to verify for this author in this channel, or `null`. */
function verificado(canal: string, autor: string, payload: StoredPayload | undefined): Record<string, unknown> | null {
  if (!payload || payload["autoria"] === undefined) return null
  const normal = normalizar(payload)
  if (!normal) return null
  return verificarAutoria(canal, autor, normal).ok ? { ...normal, autoria: payload["autoria"] } : null
}

/** The same payload, now signed by us. `null` if the schema rejects it. */
function assinadoPorNos(canal: string, eu: QuemRelata, payload: Record<string, unknown>): Record<string, unknown> | null {
  const { autoria: _antiga, ...sem } = payload
  const normal = normalizar(sem)
  if (!normal) return null
  try {
    return { ...normal, autoria: assinarAutoria({ canal, autor: eu.address, payload: normal, aparelho: eu.aparelho, assinar: eu.assinar }) }
  } catch {
    // A dumped attachment: its summary is no longer calculated.
    return null
  }
}

/** The profile without portrait bytes: the lightweight form, which still verifies. */
function semBytesDoRetrato(payload: Record<string, unknown>): Record<string, unknown> | null {
  const retrato = payload[ANEXO_DO_PERFIL] as Record<string, unknown> | undefined
  if (!retrato || typeof retrato !== "object" || retrato["evicted"] === true) return null
  return {
    ...payload,
    [ANEXO_DO_PERFIL]: {
      evicted: true,
      name: typeof retrato["name"] === "string" ? retrato["name"] : "",
      mediaType: typeof retrato["mediaType"] === "string" ? retrato["mediaType"] : "",
    },
  }
}

/**
 * Another person's profile, rebuilt from the vault with the authorship they set on THIS
 * channel, and verified. `null` if there is no profile, if the authorship is from another version
 * or does not verify: in that case only the person themselves can confirm it.
 */
function perfilAssinado(conteudo: VaultContents, canal: string, membro: string): Record<string, unknown> | null {
  const guardado = conteudo.directory[membro]
  const autoria = conteudo.autoriasDosPerfis?.[canal]?.[membro]
  if (!guardado || !autoria || guardado.payload["updatedAt"] !== autoria.u) return null
  const { mural: _mural, autoria: _outra, ...base } = guardado.payload as Record<string, unknown>
  const mural = autoria.mural ? conteudo.muraisDosOutros?.[membro] : undefined
  if (autoria.mural && !mural) return null
  return verificado(canal, membro, { ...base, ...(mural ? { mural } : {}), autoria: autoria.autoria } as unknown as StoredPayload)
}

/**
 * The profiles of these accounts that we can report to whoever requested them (the common room,
 * 3/11/2026): each one with the authorship of who wrote it, in lightweight form (without portrait
 * bytes, which still verify). Never ours: that gets published.
 */
export function perfisParaRelatar(conteudo: VaultContents, canal: string, contas: readonly string[], eu: string): ItemRelatado[] {
  const itens: ItemRelatado[] = []
  for (const conta of new Set(contas)) {
    if (conta === eu) continue
    const perfil = perfilAssinado(conteudo, canal, conta)
    if (perfil) itens.push({ s: -1, a: conta, p: semBytesDoRetrato(perfil) ?? perfil })
  }
  return itens
}

/**
 * The portrait candidates, from the vault of whoever invites, and the portrait
 * capped within the limit.
 *
 * Each entry carries the ORIGINAL authorship, if it verifies. If it does not verify (written
 * before the authorship, or modified by the vault, like the pinned ones merged in a room),
 * it is signed by us only if we could publish it now: the foundation only by who founded it,
 * roles and assignments by who manages roles, categories, rooms and the banner by who arranges
 * them. It is the same rule as `republishAuthority`. Anything else stays out, and the portrait
 * is not complete.
 */
export function montarRetrato(fonte: FonteDoRetrato, geradoEm: number, tecto?: number): RetratoMontado {
  const { canal, eu, conteudo } = fonte
  const essenciais: CandidatoDoRetrato[] = []
  let faltam = 0

  const juntar = (
    autor: string,
    seq: number | undefined,
    payload: StoredPayload | undefined,
    podemos: boolean,
    refazer?: () => Record<string, unknown>,
  ): void => {
    const original = verificado(canal, autor, payload)
    if (original) {
      essenciais.push({ item: { s: seq !== undefined && seq >= 0 ? seq : -1, a: autor, p: original } })
      return
    }
    const base = refazer ? refazer() : payload
    const nosso = podemos && base ? assinadoPorNos(canal, eu, base) : null
    if (nosso) essenciais.push({ item: { s: -1, a: eu.address, p: nosso } })
    else faltam += 1
  }

  // The foundation.
  const fundacao = conteudo.channelFounder[canal]
  if (fundacao) {
    // Without the stored payload (an old vault), rebuilt as `republishAuthority` does.
    juntar(fundacao.address, fundacao.seq, fundacao.payload, fonte.fundador && fundacao.address === eu.address, () =>
      fundacao.payload
        ? (fundacao.payload as Record<string, unknown>)
        : { t: "room.created", name: canal.replace(/^!/, "").split(":")[0] ?? canal, createdAt: geradoEm },
    )
  }

  // The defined roles and the assignments.
  for (const guardado of Object.values(conteudo.channelRoles[canal] ?? {})) {
    if (guardado.payload["role"] === PAPEL_EMBUTIDO) continue
    juntar(guardado.por ?? "", guardado.seq, guardado.payload, fonte.gerePapeis)
  }
  const carimbos = conteudo.channelMemberRolesAt?.[canal] ?? {}
  const comPapel = new Set([...Object.keys(conteudo.channelMemberRoles[canal] ?? {}), ...(conteudo.channelAdmins[canal] ?? [])])
  for (const sujeito of comPapel) {
    const carimbo = carimbos[sujeito]
    const guardados = conteudo.channelMemberRoles[canal]?.[sujeito]
    // The payload rebuilt with the original timestamp and the authorship of who assigned it (F11).
    const original: StoredPayload | undefined =
      carimbo?.por !== undefined && guardados && carimbo.autoria !== undefined
        ? { t: "role.assign", subject: sujeito, roles: [...guardados], assignedAt: carimbo.at, autoria: carimbo.autoria }
        : undefined
    juntar(carimbo?.por ?? "", carimbo?.seq, original, fonte.gerePapeis, () => ({
      t: "role.assign",
      subject: sujeito,
      roles: fonte.cargosDe(sujeito),
      assignedAt: carimbo?.at ?? 1,
    }))
  }

  // The categories, the rooms and the sign.
  for (const guardado of Object.values(conteudo.channelCategories?.[canal] ?? {})) {
    juntar(guardado.por ?? "", guardado.seq, guardado.payload, fonte.arruma)
  }
  for (const guardado of Object.values(conteudo.channelRooms[canal] ?? {})) {
    juntar(guardado.por ?? "", guardado.seq, guardado.payload, fonte.arruma, () => {
      // The pinned ones only from whoever has the pin permission: whoever receives would drop them anyway.
      const { pinned, ...resto } = guardado.payload as Record<string, unknown>
      return fonte.fixa && pinned !== undefined ? { ...resto, pinned } : resto
    })
  }
  const letreiro = conteudo.spaceMeta[canal]
  if (letreiro) juntar(letreiro.por ?? "", letreiro.seq, letreiro.payload, fonte.arruma)

  // The profiles: ours, signed now, and those of members with authorship from this channel.
  const perfis: CandidatoDoRetrato[] = []
  const comoCandidato = (autor: string, p: Record<string, unknown>): CandidatoDoRetrato => {
    const leve = semBytesDoRetrato(p)
    return { item: { s: -1, a: autor, p }, ...(leve ? { leve: { s: -1, a: autor, p: leve } } : {}) }
  }
  if (fonte.perfilProprio) {
    const nosso = assinadoPorNos(canal, eu, fonte.perfilProprio)
    if (nosso) perfis.push(comoCandidato(eu.address, nosso))
  }
  for (const membro of new Set(fonte.membros)) {
    if (membro === eu.address) continue
    const refeito = perfilAssinado(conteudo, canal, membro)
    if (refeito) perfis.push(comoCandidato(membro, refeito))
  }

  const partido = partirRetrato(canal, [...essenciais, ...perfis], geradoEm, tecto)
  const cortadosEssenciais = partido.cortados.filter((item) => item.p["t"] !== "profile").length
  return { ...partido, completo: faltam === 0 && cortadosEssenciais === 0 }
}

/**
 * The founder that a portrait can yield, from among the `room.created` entries that passed
 * verification: the distinct authors, in the order they arrived.
 *
 * One only: that is it. More than one means whoever invites added a second foundation
 * (an honest client adds only the one it has), and the order is theirs, so it decides nothing.
 * The tiebreaker is leaf 0 of the tree, which belongs to whoever created the group and
 * whoever invites cannot choose; without that tiebreaker, the portrait yields no founder,
 * and whoever joins stays as before 1.1, waiting for someone to tell them.
 */
export function escolherFundador(autores: readonly string[], naFolhaZero: string | null): string | null {
  const distintos = [...new Set(autores)]
  if (distintos.length <= 1) return distintos[0] ?? null
  return naFolhaZero !== null && distintos.includes(naFolhaZero) ? naFolhaZero : null
}

/** The order of application: what decides who goes first. */
export function ordemDeAplicacao(item: ItemRelatado): number {
  switch (item.p["t"]) {
    case "room.created":
      return 0
    case "role.define":
    case "role.assign":
      return 1
    case "channel.category":
      return 2
    case "channel.meta":
      return 3
    case "space.meta":
      return 4
    default:
      return 5
  }
}
