import { z } from "zod"
import { ItemRelatado } from "./autoria.js"

/**
 * The snapshot of the channel in the Welcome (phase 1 of `docs/planos/estado-cifrado-plano.md`).
 *
 * **The problem.** When someone joins a channel they cannot decrypt anything
 * that was said there before (forward secrecy). The name, the rooms, the
 * categories, the founder, the roles and the member names only reached them if
 * someone online sent them again. With nobody else online, a joiner saw
 * "geral" and nothing else.
 *
 * **The mechanism.** Whoever commits the join puts into the Welcome's `GroupInfo`
 * a private extension (`EXTENSAO_RETRATO`, private use range of RFC 9420
 * §17.3) with the ORIGINAL payloads of the channel state, each one with the
 * authorship of whoever wrote it. The Welcome's `GroupInfo` travels encrypted
 * under the `welcome_secret` (RFC 9420 §12.4.3.1): only the joiner reads it, and
 * the server sees the size and nothing else.
 *
 * **The joiner does not trust the inviter.** Each item goes through
 * `receberItem` in the core, with the same rules as relays: schema,
 * signature, account device, blocking. Roles go through `#mandaEm`. A forged
 * item is a reason to reject, never a foothold.
 *
 * **A 1.0.x client knows nothing of this.** Its `joinGroup` reads only the tree
 * and drops extensions it does not know. The inviter only includes the snapshot
 * when the joiner's leaf declares `EXTENSAO_RETRATO` in its capabilities; and the
 * declaration does not go in `required_capabilities`, which would have evicted old
 * leaves.
 */

/** The extension type: "orwell-retrato-v1", in the private use range (0xF000 to 0xFFFF). */
export const EXTENSAO_RETRATO = 0xf0f0

/** The snapshot cap, in bytes of JSON. A Welcome fits in a 12 MiB frame; this leaves plenty of room. */
export const RETRATO_MAX_BYTES = 256 * 1024

/** The cap on items. */
export const RETRATO_ITENS_MAX = 2000

export const Retrato = z.object({
  v: z.literal(1),
  /** The channel the snapshot describes. A snapshot of another channel does not apply. */
  canal: z.string().min(1).max(300),
  itens: z.array(ItemRelatado).max(RETRATO_ITENS_MAX),
  /** The builder's clock. Diagnostic only: it decides nothing. */
  geradoEm: z.number().int().nonnegative(),
})
export type Retrato = z.infer<typeof Retrato>

/**
 * The priority order for trimming: what decides who is in charge comes before what
 * depends on it, and profiles come last. A type not listed here goes after everything.
 */
const PRIORIDADE: Record<string, number> = {
  "room.created": 0,
  "role.define": 1,
  "role.assign": 2,
  "channel.category": 3,
  "channel.meta": 4,
  "space.meta": 5,
  profile: 6,
}

export function prioridadeDoItem(item: ItemRelatado): number {
  const tipo = item.p["t"]
  return typeof tipo === "string" && tipo in PRIORIDADE ? PRIORIDADE[tipo]! : 7
}

const versaoDoPerfil = (item: ItemRelatado): number => {
  const versao = item.p["updatedAt"]
  return typeof versao === "number" ? versao : 0
}

/**
 * An item to include in the snapshot. `leve` is the smaller alternative of the
 * same item when the full one does not fit: a profile without the picture bytes
 * (the signature still verifies, because it only binds the attachment's name and type).
 */
export interface CandidatoDoRetrato {
  item: ItemRelatado
  leve?: ItemRelatado
}

export interface RetratoPartido {
  retrato: Retrato
  bytes: Uint8Array
  /** The items left out because they do not fit (not even in light form). */
  cortados: ItemRelatado[]
  /** Quantos itens foram na forma leve. */
  aliviados: number
}

const codificador = new TextEncoder()
const bytesDe = (valor: unknown): number => codificador.encode(JSON.stringify(valor)).length

/**
 * Build the snapshot within the cap, trimming by priority: founder, roles,
 * assignments, categories, rooms, banner, and the newest profiles first. An item
 * that does not fit tries its light form; if that does not fit either, it is left
 * out, and the following (smaller) items may still fit.
 */
export function partirRetrato(
  canal: string,
  candidatos: readonly CandidatoDoRetrato[],
  geradoEm: number,
  tecto: number = RETRATO_MAX_BYTES,
): RetratoPartido {
  const ordenados = candidatos
    .map((candidato, indice) => ({ candidato, indice }))
    .sort((a, b) => {
      const pa = prioridadeDoItem(a.candidato.item)
      const pb = prioridadeDoItem(b.candidato.item)
      if (pa !== pb) return pa - pb
      if (pa === PRIORIDADE["profile"]) {
        const va = versaoDoPerfil(a.candidato.item)
        const vb = versaoDoPerfil(b.candidato.item)
        if (va !== vb) return vb - va
      }
      return a.indice - b.indice
    })
  const vazio: Retrato = { v: 1, canal, itens: [], geradoEm }
  let total = bytesDe(vazio)
  const itens: ItemRelatado[] = []
  const cortados: ItemRelatado[] = []
  let aliviados = 0
  for (const { candidato } of ordenados) {
    if (itens.length >= RETRATO_ITENS_MAX) {
      cortados.push(candidato.item)
      continue
    }
    // Each extra item costs its bytes plus a comma.
    const custo = (item: ItemRelatado): number => bytesDe(item) + (itens.length > 0 ? 1 : 0)
    const inteiro = custo(candidato.item)
    if (total + inteiro <= tecto) {
      itens.push(candidato.item)
      total += inteiro
      continue
    }
    if (candidato.leve) {
      const leve = custo(candidato.leve)
      if (total + leve <= tecto) {
        itens.push(candidato.leve)
        total += leve
        aliviados += 1
        continue
      }
    }
    cortados.push(candidato.item)
  }
  const retrato: Retrato = { v: 1, canal, itens, geradoEm }
  const bytes = codificarRetrato(retrato)
  return { retrato, bytes, cortados, aliviados }
}

export function codificarRetrato(retrato: Retrato): Uint8Array {
  return codificador.encode(JSON.stringify(retrato))
}

/**
 * Read a snapshot that arrived in a Welcome for this channel. `null` if it is
 * not a snapshot, exceeds the cap, fails the schema, or is for another channel.
 * Never throws: a malformed snapshot leaves the joiner on the old path, and the
 * Welcome still opens.
 */
export function lerRetrato(bytes: Uint8Array, canal: string): Retrato | null {
  if (bytes.length > RETRATO_MAX_BYTES) return null
  let bruto: unknown
  try {
    bruto = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch {
    return null
  }
  const lido = Retrato.safeParse(bruto)
  if (!lido.success || lido.data.canal !== canal) return null
  return lido.data
}
