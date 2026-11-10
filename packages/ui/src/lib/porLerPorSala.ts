import { useSyncExternalStore } from "react"
import type { ChatMessage } from "../types.js"
import type { LastRead } from "./estadoDaConta.js"
import { isDirect, isFeed } from "./format.js"
import { mencionaMe } from "./mentions.js"
import { estaSilenciado } from "./silenciados.js"

/**
 * What is unread in each ROOM, not just each channel.
 *
 * Owner request from October 27, 2026: each room on the sidebar shows the
 * unread count, and the expanded channel shows the sum.
 *
 * **Why the channel mark is not enough.** The read mark is per channel
 * (`lib/estadoDaConta.ts`), and advances while the channel is open, no matter
 * which room is in front. With only that, a message arriving in room B while
 * reading room A gets marked as read at the same instant, and room B's number
 * never lit up.
 *
 * **What is stored, per channel:**
 *  - `base`: the channel mark as it was when entering the channel. This is
 *    where each room not yet opened on this visit stays.
 *  - `salas`: for each opened room, up to where it was read.
 *  - `fim`: the channel mark that THIS device wrote last. If the channel mark
 *    passes it, another device read the channel, and then the rooms here stop
 *    working and the channel mark works, as before.
 *
 * **And it travels between the account's devices (phase 1i, 28/10/2026).** The
 * mark for each room also goes into the account's read marks, in its own key
 * (`chaveDaLidaDaSala`). The core accepts any key up to 255 characters and
 * merges them by the usual rule, highest wins; a sibling from an earlier
 * version stores it as a mark for a channel that does not exist, and it does
 * no harm. Reading room B on the phone clears its number on the computer. The
 * `fim` rule stands: reading the channel on another device clears the rooms
 * here.
 */

export const LIDAS_POR_SALA_KEY = "enclave.lidasPorSala"

/** The separator between channel and room in the account key: never appears in a name. */
const SEPARADOR_DA_SALA = "\u001f"

/**
 * The key for a room's mark in the account's reads. `null` when it does not
 * fit in 255 characters: that room gets only this device's mark.
 */
export function chaveDaLidaDaSala(canal: string, sala: string): string | null {
  const chave = `${canal}${SEPARADOR_DA_SALA}${sala}`
  return chave.length <= 255 ? chave : null
}

export interface MarcasDoCanal {
  base: number
  fim: number
  salas: Record<string, number>
}

export type LidasPorSala = Record<string, MarcasDoCanal>

/** How many unread in a room, and how many of them are for me. */
export interface PorLerNaSala {
  todas: number
  mencoes: number
}

function armazem(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage
  } catch {
    return null
  }
}

function numero(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isFinite(valor)
}

/** Lenient read: missing key, broken JSON, or garbage gives `{}`. */
function ler(cru: string | null): LidasPorSala {
  try {
    if (!cru) return {}
    const dado = JSON.parse(cru) as unknown
    if (typeof dado !== "object" || dado === null || Array.isArray(dado)) return {}
    const limpo: LidasPorSala = {}
    for (const [canal, marcas] of Object.entries(dado as Record<string, unknown>)) {
      const m = marcas as Partial<MarcasDoCanal> | null
      if (!m || !numero(m.base) || !numero(m.fim) || typeof m.salas !== "object" || m.salas === null) continue
      const salas: Record<string, number> = {}
      for (const [sala, at] of Object.entries(m.salas)) if (numero(at)) salas[sala] = at
      limpo[canal] = { base: m.base, fim: m.fim, salas }
    }
    return limpo
  } catch {
    return {}
  }
}

/**
 * The last read, and the text it came from.
 *
 * Reads again when the stored text changes externally (another separator, or a
 * test that clears storage), and returns the SAME reference while it does not
 * change, which is what `useSyncExternalStore` needs to not draw in a loop.
 */
let actual: LidasPorSala = {}
let cruVisto: string | null | undefined
const ouvintes = new Set<() => void>()

function cruGuardado(): string | null {
  try {
    return armazem()?.getItem(LIDAS_POR_SALA_KEY) ?? null
  } catch {
    return null
  }
}

export function lerLidasPorSala(): LidasPorSala {
  const cru = cruGuardado()
  if (cru !== cruVisto) {
    cruVisto = cru
    actual = ler(cru)
  }
  return actual
}

function gravar(novo: LidasPorSala): void {
  actual = novo
  const texto = JSON.stringify(novo)
  try {
    armazem()?.setItem(LIDAS_POR_SALA_KEY, texto)
    cruVisto = texto
  } catch {
    // Storage full or locked: the counts are good for this visit, and the
    // next read cannot throw away what is in memory.
    cruVisto = cruGuardado()
  }
  for (const ouvinte of ouvintes) ouvinte()
}

/**
 * Enter a channel: store where it was, for rooms that do not open.
 *
 * `marcaDoCanal` is the mark BEFORE this device advances it. If the marks here
 * are still from this device (`marcaDoCanal <= fim`), they stay: it is going
 * back to a channel where a room stayed unread. If another device read the
 * channel in the meantime, start over from the channel mark.
 */
export function entrarNoCanal(canal: string, marcaDoCanal: number): void {
  const lidas = lerLidasPorSala()
  const antes = lidas[canal]
  if (antes && marcaDoCanal <= antes.fim) return
  gravar({ ...lidas, [canal]: { base: marcaDoCanal, fim: marcaDoCanal, salas: {} } })
}

/** The channel mark this device just wrote. See `fim`. */
export function avancouOCanal(canal: string, marcaDoCanal: number): void {
  const lidas = lerLidasPorSala()
  const antes = lidas[canal]
  if (!antes || antes.fim >= marcaDoCanal) return
  gravar({ ...lidas, [canal]: { ...antes, fim: marcaDoCanal } })
}

/** Having the room open is reading it up to `at`. */
export function lerSala(canal: string, sala: string, at: number): void {
  const lidas = lerLidasPorSala()
  const antes = lidas[canal]
  if (!antes) return
  if ((antes.salas[sala] ?? 0) >= at) return
  gravar({ ...lidas, [canal]: { ...antes, salas: { ...antes.salas, [sala]: at } } })
}

/** After "Delete account", like the other marks on this browser. */
export function esquecerLidasPorSala(): void {
  actual = {}
  try {
    armazem()?.removeItem(LIDAS_POR_SALA_KEY)
  } catch {
    // Nothing to do: memory was already cleared.
  }
  cruVisto = cruGuardado()
  for (const ouvinte of ouvintes) ouvinte()
}

export function useLidasPorSala(): LidasPorSala {
  return useSyncExternalStore(
    (ouvinte) => {
      ouvintes.add(ouvinte)
      return () => ouvintes.delete(ouvinte)
    },
    lerLidasPorSala,
    lerLidasPorSala,
  )
}

/**
 * Up to where a room was read. See the module comment for the `fim` rule.
 */
export function marcaDaSala(lidas: LidasPorSala, lastRead: LastRead, canal: string, sala: string): number {
  const doCanal = lastRead[canal] ?? 0
  // The room mark that arrived from the account, read on any device (phase 1i).
  const chave = chaveDaLidaDaSala(canal, sala)
  const daConta = chave !== null ? lastRead[chave] ?? 0 : 0
  const marcas = lidas[canal]
  if (!marcas || doCanal > marcas.fim) return Math.max(doCanal, daConta)
  return Math.max(marcas.base, marcas.salas[sala] ?? 0, daConta)
}

function stampOf(message: ChatMessage): number {
  return message.payload.sentAt ?? message.payload.postedAt ?? 0
}

/**
 * The unread messages of each room, per channel. Pure, to test alone.
 *
 * The guards are those of `countUnreads` (just `message`, never mine), and
 * the open room does not count: it is in front of the person. Only channels
 * with rooms: direct conversations and feeds count in `useUnreads`, as always.
 *
 * `salaDe` says where a message is READ based on the tag it carries (an empty
 * tag or a room that no longer exists reads as the default room).
 */
export function contarPorSala(
  messages: readonly ChatMessage[],
  lastRead: LastRead,
  lidas: LidasPorSala,
  aberta: { canal: string | null; sala: string },
  me: string | null,
  salaDe: (canal: string, etiqueta: string) => string,
  /** What is muted (`lib/silenciados.ts`): there, `@all` does not count as a mention. */
  silenciados: readonly string[] = [],
): Map<string, Map<string, PorLerNaSala>> {
  const porCanal = new Map<string, Map<string, PorLerNaSala>>()
  for (const message of messages) {
    if (message.payload.t !== "message") continue
    if (isDirect(message.channel) || isFeed(message.channel)) continue
    if (me !== null && message.sender === me) continue
    const sala = salaDe(message.channel, (message.payload as { room?: string }).room ?? "")
    if (message.channel === aberta.canal && sala === aberta.sala) continue
    if (stampOf(message) <= marcaDaSala(lidas, lastRead, message.channel, sala)) continue
    let salas = porCanal.get(message.channel)
    if (!salas) porCanal.set(message.channel, (salas = new Map()))
    const conta = salas.get(sala) ?? { todas: 0, mencoes: 0 }
    salas.set(sala, {
      todas: conta.todas + 1,
      mencoes:
        conta.mencoes +
        (me !== null && mencionaMe(message.payload.mentions, me, estaSilenciado(silenciados, message.channel, sala)) ? 1 : 0),
    })
  }
  return porCanal
}
