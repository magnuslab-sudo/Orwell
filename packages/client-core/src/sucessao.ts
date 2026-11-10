import type { VaultContents } from "./vault.js"

/**
 * "Merge accounts" (phase 8.2 of 0.9): the secondary account says it is now the primary.
 *
 * **The limit, stated first.** The account is the key, and two keys do not merge into one.
 * What the secondary does, before deleting its key, is tell each direct chat
 * and each channel "this account is now @primary", in a message it signs
 * (the `successor` field of a `message`, in the protocol). Then it dissolves
 * friendships, leaves all channels, and its key is deleted.
 *
 * **On the receiver's side**, this module stores the merge in the vault, ONCE per account.
 * It serves three purposes:
 *
 * - hide the secondary from lists (friends, chats, members): the account no longer
 *   exists, and whoever got the notice stops seeing it;
 * - offer once, "@secondary is now @primary. Add them?" to whoever was their friend,
 *   and "Invite?" to the admin of each channel where they were;
 * - never merge on its own. A "is now" is the word of the old key, and a stolen key
 *   can say the same. So the message says who signed it and asks for a tap.
 *
 * **The first merge of each account is the one that sticks.** A second one to another
 * destination is ignored: anyone with the stolen key could not redirect friends.
 * Later ones to the SAME destination only add channels where they arrived
 * (the secondary sends one per channel).
 *
 * Lives outside `vault.ts` for the same reason as `apelidos.ts`: the field is declared here,
 * by type extension, and an old vault opens without it.
 */

/** What we store about each account that is now another. */
export interface RegistoDeSucessao {
  /** The account that succeeds it (the primary). */
  para: string
  /** The clock of whoever signed, the first time. */
  at: number
  /** The server order the first time (-1 no echo). */
  seq: number
  /** The channels where the merge arrived, for each admin to invite the primary. */
  canais: string[]
  /** The secondary was a friend of this account when the notice came: there is a request to offer. */
  eraAmigo: boolean
  /**
   * What this account has already answered: `friend` (the request to the primary), each channel
   * where it already invited (or said no), or `*` for "no thanks" to everything.
   */
  feitos: string[]
}

/** A merge just arrived, not yet saved. */
export interface SucessaoRecebida {
  de: string
  para: string
  at: number
  seq: number
  canal: string
  eraAmigo: boolean
}

/** The field this module adds to the vault. */
interface ComSucessoes {
  sucessoes?: Record<string, RegistoDeSucessao>
}

function registo(contents: VaultContents): ComSucessoes {
  return contents as VaultContents & ComSucessoes
}

const ENDERECO = /^@[^\s:@]+:[^\s@]+$/

/** The merge that a message carries, already narrowed. The vault stores payloads raw. */
export function sucessoraDaMensagem(payload: unknown): { para: string; at: number } | null {
  if (!payload || typeof payload !== "object") return null
  const { t, sucessora } = payload as { t?: unknown; sucessora?: unknown }
  if (t !== "message" || !sucessora || typeof sucessora !== "object") return null
  const { para, at } = sucessora as Record<string, unknown>
  if (typeof para !== "string" || !ENDERECO.test(para)) return null
  return { para, at: typeof at === "number" && Number.isFinite(at) ? at : 0 }
}

/**
 * Add a merge just arrived to a map. The rule is in the header:
 * the first of each account sticks, and later ones to the same destination only
 * add the channel. Returns whether it changed.
 */
function juntar(mapa: Record<string, RegistoDeSucessao>, recebida: SucessaoRecebida): boolean {
  const antes = mapa[recebida.de]
  if (!antes) {
    mapa[recebida.de] = {
      para: recebida.para,
      at: recebida.at,
      seq: recebida.seq,
      canais: [recebida.canal],
      eraAmigo: recebida.eraAmigo,
      feitos: [],
    }
    return true
  }
  if (antes.para !== recebida.para) return false
  const canais = antes.canais.includes(recebida.canal) ? antes.canais : [...antes.canais, recebida.canal]
  const eraAmigo = antes.eraAmigo || recebida.eraAmigo
  if (canais === antes.canais && eraAmigo === antes.eraAmigo) return false
  mapa[recebida.de] = { ...antes, canais, eraAmigo }
  return true
}

/** Save a merge in the vault. Returns whether it changed. */
export function registarSucessao(contents: VaultContents, recebida: SucessaoRecebida): boolean {
  const cofre = registo(contents)
  const mapa = { ...(cofre.sucessoes ?? {}) }
  if (!juntar(mapa, recebida)) return false
  cofre.sucessoes = mapa
  return true
}

/**
 * The merges this account knows, including ones still waiting for
 * vault save (the session saves in batches, like nicknames).
 */
export function sucessoesDoCofre(
  contents: VaultContents,
  pendentes: readonly SucessaoRecebida[] = [],
): Record<string, RegistoDeSucessao> {
  const mapa = { ...(registo(contents).sucessoes ?? {}) }
  for (const recebida of pendentes) juntar(mapa, recebida)
  return mapa
}

/** Mark a response to a merge: `friend`, a channel, or `*`. Returns whether it changed. */
export function marcarSucessaoFeita(contents: VaultContents, de: string, feito: string): boolean {
  const cofre = registo(contents)
  const antes = cofre.sucessoes?.[de]
  if (!antes || antes.feitos.includes(feito)) return false
  cofre.sucessoes = { ...cofre.sucessoes, [de]: { ...antes, feitos: [...antes.feitos, feito] } }
  return true
}

// ------------------------------------------------- on the primary account side

/**
 * The preference of the account with the accounts it has merged (`["@ana:orwell.pt"]`).
 *
 * A preference, not a new vault field, because it must reach ALL devices of the
 * primary: it travels through the account channel, like the others. It is how a
 * primary's device recognizes an invite "for someone who succeeded @ana" and
 * requests entry on its own.
 */
export const PREFERENCIA_CONTAS_JUNTADAS = "conta.juntadas"

/** The merged accounts, read from the preference. A corrupt preference reads as empty. */
export function contasJuntadas(preferencias: Readonly<Record<string, string>>): string[] {
  const valor = preferencias[PREFERENCIA_CONTAS_JUNTADAS]
  if (!valor) return []
  try {
    const lista: unknown = JSON.parse(valor)
    return Array.isArray(lista) ? lista.filter((item): item is string => typeof item === "string" && ENDERECO.test(item)) : []
  } catch {
    return []
  }
}

/** The preference with one more merged account, or `null` if it was already there. */
export function comContaJuntada(preferencias: Readonly<Record<string, string>>, conta: string): string | null {
  const lista = contasJuntadas(preferencias)
  if (lista.includes(conta)) return null
  return JSON.stringify([...lista, conta])
}

/** The body text of the message, for those who do not know the field (0.9.4 and earlier). */
export function corpoDaSucessao(principal: string): string {
  return `Esta conta passou a ser ${principal}. Esta conta vai ser apagada.`
}
