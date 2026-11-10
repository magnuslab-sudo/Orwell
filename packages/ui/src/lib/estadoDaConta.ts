import { useSyncExternalStore } from "react"
import type { EnclaveBridge } from "../bridge.js"
import { DM_CLOSED_KEY, readClosedDirects, writeClosedDirects, type ClosedDirects } from "./directs.js"
import { ligarPreferenciasDaConta } from "./preferenciasDaConta.js"
import { ligarPrivacidadeDaConta } from "./privacidadeDaConta.js"
import { esquecerLidasPorSala } from "./porLerPorSala.js"

/**
 * The account state the interface reads and writes: read marks, archived
 * conversations, and preferences.
 *
 * **Where it comes from (phase 5).** From the session, through the bridge
 * (`bridge.estado`). The core stores it in the vault and sends it to sibling
 * devices through the account channel. Before it lived in this browser's
 * `localStorage` (`enclave.lastRead`, `enclave.dmClosed`), and that is why
 * opening a channel on the phone did not mark it as read on the computer.
 *
 * **Two modes.**
 *  - `local`: before the account opens, and with a host that does not bring
 *    `estado` (a preload from another version). Reads and writes `localStorage`,
 *    like before. It is also the mode for tests that set up the interface with
 *    a fake bridge without `estado`.
 *  - `account`: after `ligarEstadoDaConta`. Reads from the session, writes to
 *    the session, and listens to what comes from siblings.
 *
 * **The migration happens once.** On first connection with the new version, what
 * was in the browser goes through the session (`marcarLido`, `arquivar`) and the
 * old key deletes itself. It only deletes after everything is in: a failure
 * midway leaves the key, and the next connection retries (the session only moves
 * marks up, so retrying breaks nothing).
 *
 * A module, not a React context: the read mark is read outside the tree
 * (`usePorLer`, at the instant the "unread" line draws), and both reads must see
 * the same thing.
 */

export const LAST_READ_KEY = "enclave.lastRead"

export type LastRead = Record<string, number>

/** Tolerant reading: missing key, broken JSON, or garbage all return `{}`. */
export function readLastRead(storage: Pick<Storage, "getItem"> = localStorage): LastRead {
  try {
    const raw = storage.getItem(LAST_READ_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {}
    const clean: LastRead = {}
    for (const [channel, at] of Object.entries(parsed)) {
      if (typeof at === "number" && Number.isFinite(at)) clean[channel] = at
    }
    return clean
  } catch {
    return {}
  }
}

export function writeLastRead(lastRead: LastRead, storage: Pick<Storage, "setItem"> = localStorage): void {
  try {
    storage.setItem(LAST_READ_KEY, JSON.stringify(lastRead))
  } catch {
    // Storage full or locked. Counts hold in this session.
  }
}

export interface EstadoDaConta {
  /** The timestamp of the last read message, per channel. */
  readonly lidas: Readonly<LastRead>
  /** The archived conversations ("closed" in Friends), with the time. */
  readonly arquivo: Readonly<ClosedDirects>
  /** The preferences that travel. Empty in local mode. */
  readonly preferencias: Readonly<Record<string, string>>
}

type Ligacao = {
  estado: NonNullable<EnclaveBridge["estado"]>
  aoFalhar: (erro: Error) => void
}

let ligacao: Ligacao | null = null
/** The state in `account` mode. */
let daConta: EstadoDaConta = { lidas: {}, arquivo: {}, preferencias: {} }
/** The last state read from `localStorage` in local mode, with the raw text it came from. */
let doBrowser: { lidas: string | null; arquivo: string | null; estado: EstadoDaConta } | null = null
const ouvintes = new Set<() => void>()

function armazem(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage
  } catch {
    return undefined
  }
}

function cru(chave: string): string | null {
  try {
    return armazem()?.getItem(chave) ?? null
  } catch {
    return null
  }
}

/**
 * The state now. Stable between two reads without change, like
 * `useSyncExternalStore` requires: in local mode the last read is kept, by raw
 * text, and only re-read when the text changed.
 */
export function lerEstadoDaConta(): EstadoDaConta {
  if (ligacao !== null) return daConta
  const lidas = cru(LAST_READ_KEY)
  const arquivo = cru(DM_CLOSED_KEY)
  if (doBrowser === null || doBrowser.lidas !== lidas || doBrowser.arquivo !== arquivo) {
    const s = armazem()
    doBrowser = {
      lidas,
      arquivo,
      estado: {
        lidas: s ? readLastRead(s) : {},
        arquivo: s ? readClosedDirects(s) : {},
        preferencias: {},
      },
    }
  }
  return doBrowser.estado
}

function avisar(): void {
  for (const ouvinte of [...ouvintes]) ouvinte()
}

export function aoMudarEstadoDaConta(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte)
  return () => {
    ouvintes.delete(ouvinte)
  }
}

/** The state as React state. Redraws when it changes, here or on a sibling. */
export function useEstadoDaConta(): EstadoDaConta {
  return useSyncExternalStore(aoMudarEstadoDaConta, lerEstadoDaConta, lerEstadoDaConta)
}

function mudarDaConta(parcial: Partial<EstadoDaConta>): void {
  daConta = { ...daConta, ...parcial }
  avisar()
}

/**
 * Mark a channel as read up to `at`.
 *
 * Only goes up, in both modes: the mark from another device may have arrived
 * first, and an older mark cannot undo their read. In account mode the mark
 * shows right away on screen and goes to the session; an error (720, 721) goes
 * to `aoFalhar`, which shows it with code.
 */
export function marcarLido(channel: string, at: number): void {
  const actual = lerEstadoDaConta().lidas[channel]
  if (actual !== undefined && actual >= at) return
  if (ligacao === null) {
    writeLastRead({ ...lerEstadoDaConta().lidas, [channel]: at })
    avisar()
    return
  }
  mudarDaConta({ lidas: { ...daConta.lidas, [channel]: at } })
  const { estado, aoFalhar } = ligacao
  void estado.marcarLido(channel, at).catch((erro: Error) => {
    /*
      Hidden on owner's orders (October 28, 2026): Error 720 ("read mark
      channel is invalid") appeared as a warning to read-only users. The read
      mark is a sync detail between devices; missing one breaks nothing visible.
      It stays in the diagnostic log and pending tasks (`docs/planos/depois-da-1-0.md`)
      until we find the cause.
    */
    if (erro.message === "read mark channel is invalid") {
      console.warn("Erro 720 oculto: marca de lido recusada", { channel, cause: erro.cause })
      return
    }
    aoFalhar(erro)
  })
}

/**
 * Archive a conversation at time `at`.
 *
 * The time belongs to whoever closes it, already carrying the precaution from
 * `closeDirect` (the newest message, if the sender's clock runs ahead). The
 * session records its own time; here we keep the larger of the two, so the
 * conversation doesn't reopen immediately after closing.
 */
export function arquivar(channel: string, at: number): void {
  if (ligacao === null) {
    writeClosedDirects({ ...lerEstadoDaConta().arquivo, [channel]: at })
    avisar()
    return
  }
  mudarDaConta({ arquivo: { ...daConta.arquivo, [channel]: Math.max(at, daConta.arquivo[channel] ?? 0) } })
  const { estado, aoFalhar } = ligacao
  void estado.arquivar(channel).catch(aoFalhar)
}

/** Remove a conversation from the archive. */
export function desarquivar(channel: string): void {
  const actual = lerEstadoDaConta().arquivo
  if (!(channel in actual)) return
  const seguinte = { ...actual }
  delete seguinte[channel]
  if (ligacao === null) {
    writeClosedDirects(seguinte)
    avisar()
    return
  }
  mudarDaConta({ arquivo: seguinte })
  const { estado, aoFalhar } = ligacao
  void estado.desarquivar(channel).catch(aoFalhar)
}

/**
 * Store a preference that syncs. Does nothing without a connection: the
 * `localStorage` stays local to this device (see `preferenciasDaConta.ts`),
 * and what syncs travels on the next connection.
 *
 * With `at`, it's a seed (low mark): can lose to the account's existing choice.
 * Doesn't hit the screen yet; if it wins, it comes back via `on.preferencias`.
 */
export function definirPreferenciaDaConta(chave: string, valor: string, at?: number): void {
  if (ligacao === null || daConta.preferencias[chave] === valor) return
  if (at === undefined) mudarDaConta({ preferencias: { ...daConta.preferencias, [chave]: valor } })
  const { estado, aoFalhar } = ligacao
  const pedido = at === undefined ? estado.definirPreferencia(chave, valor) : estado.definirPreferencia(chave, valor, at)
  void pedido.catch(aoFalhar)
}

/** The larger of each side: a local mark still in transit to the session never goes down. */
function fundirLidas(chegadas: Readonly<LastRead>, locais: Readonly<LastRead>): LastRead {
  const saida: LastRead = { ...chegadas }
  for (const [channel, at] of Object.entries(locais)) {
    if ((saida[channel] ?? -1) < at) saida[channel] = at
  }
  return saida
}

/**
 * The session's archive decides WHO is archived; the larger local time stays
 * (the precaution from `closeDirect`).
 */
function fundirArquivo(chegado: Readonly<ClosedDirects>, local: Readonly<ClosedDirects>): ClosedDirects {
  const saida: ClosedDirects = {}
  for (const [channel, at] of Object.entries(chegado)) saida[channel] = Math.max(at, local[channel] ?? 0)
  return saida
}

/**
 * Switch to account mode: migrate what the browser had, read from the session, and listen.
 *
 * Called when the account opens (`App`, in `ready` state). Returns the function that
 * goes back to local mode (on lock, on unmount). Without `bridge.estado` stays in
 * local mode and returns an empty function.
 */
export async function ligarEstadoDaConta(
  bridge: Pick<EnclaveBridge, "estado" | "on"> & { channels: Pick<EnclaveBridge["channels"], "list"> },
  aoFalhar: (erro: Error) => void,
): Promise<() => void> {
  const estado = bridge.estado
  if (!estado) return () => {}
  desligarEstadoDaConta()
  /*
    Reads start with what local mode showed, never empty: until the session
    responds, each read channel counted as unread again.
  */
  const lidasLocais = lerEstadoDaConta().lidas
  const minha: Ligacao = { estado, aoFalhar }
  ligacao = minha
  daConta = { lidas: { ...lidasLocais }, arquivo: {}, preferencias: {} }
  const largar: (() => void)[] = []
  const desligar = (): void => {
    for (const fn of largar.splice(0)) fn()
    if (ligacao === minha) {
      ligacao = null
      doBrowser = null
      avisar()
    }
  }

  // Listen first: changes a sibling makes during the read don't get lost.
  largar.push(
    bridge.on.lidas?.(({ lidas }) => {
      if (ligacao === minha) mudarDaConta({ lidas: fundirLidas(lidas, daConta.lidas) })
    }) ?? (() => {}),
    bridge.on.arquivo?.(({ arquivo }) => {
      if (ligacao === minha) mudarDaConta({ arquivo: fundirArquivo(arquivo, daConta.arquivo) })
    }) ?? (() => {}),
    bridge.on.preferencias?.(({ preferencias }) => {
      if (ligacao === minha) mudarDaConta({ preferencias: { ...preferencias } })
    }) ?? (() => {}),
  )

  /*
    Without the initial read we don't know what the account already has: this
    device's preferences don't go up on that connection (they would override the account).
  */
  let leu = false
  try {
    await migrar(estado, () => bridge.channels.list())
    const [lidas, arquivo, preferencias] = await Promise.all([estado.lidas(), estado.arquivo(), estado.preferencias()])
    if (ligacao !== minha) return desligar
    mudarDaConta({
      lidas: fundirLidas(lidas, daConta.lidas),
      arquivo: fundirArquivo(arquivo, daConta.arquivo),
      preferencias: { ...preferencias },
    })
    leu = true
  } catch (erro) {
    aoFalhar(erro as Error)
  }
  if (ligacao === minha) {
    largar.push(
      ligarPreferenciasDaConta(lerEstadoDaConta, aoMudarEstadoDaConta, definirPreferenciaDaConta, { semear: leu }),
      // Privacy (phase 4): the same path, in a separate module.
      ligarPrivacidadeDaConta(lerEstadoDaConta, aoMudarEstadoDaConta, definirPreferenciaDaConta, { semear: leu }),
    )
  }
  return desligar
}

/** Go back to local mode without dropping listeners from the caller. For tests and for locking. */
export function desligarEstadoDaConta(): void {
  if (ligacao === null) return
  ligacao = null
  doBrowser = null
  daConta = { lidas: {}, arquivo: {}, preferencias: {} }
  avisar()
}

/**
 * The one-time migration from `localStorage` to the session.
 *
 * Everything in there enters through the session's normal door, and only then
 * the key leaves. A mark that fails (channel with bad name, for example: 720)
 * can't block migration forever, so a refusal with a known key counts as handled;
 * only a failure of another kind (the bridge, the vault) leaves the key for the
 * next connection.
 *
 * **Only channels this account knows.** The keys are from the browser, not the
 * account: after "Delete account", the new account in this browser would inherit
 * the reads and archive from the old one, and spread its `!dm-<a>.<b>` across
 * siblings. The rest gets wiped with the key.
 *
 * **The archive carries the browser's time.** Saving "now" hid today's message
 * in a direct closed yesterday, and overrode the unarchive another device did meantime.
 */
async function migrar(estado: NonNullable<EnclaveBridge["estado"]>, canais: () => Promise<string[]>): Promise<void> {
  const s = armazem()
  if (!s) return
  if (cru(LAST_READ_KEY) === null && cru(DM_CLOSED_KEY) === null) return
  const conhecidos = new Set(await canais())
  const tratar = async (fazer: () => Promise<unknown>, recusaConhecida: string): Promise<void> => {
    try {
      await fazer()
    } catch (erro) {
      if ((erro as Error)?.message !== recusaConhecida && (erro as Error)?.message !== "read mark time is invalid") throw erro
    }
  }
  if (cru(LAST_READ_KEY) !== null) {
    for (const [channel, at] of Object.entries(readLastRead(s))) {
      if (!conhecidos.has(channel)) continue
      await tratar(() => estado.marcarLido(channel, at), "read mark channel is invalid")
    }
    apagar(s, LAST_READ_KEY)
  }
  if (cru(DM_CLOSED_KEY) !== null) {
    for (const [channel, at] of Object.entries(readClosedDirects(s))) {
      if (!conhecidos.has(channel)) continue
      // `readClosedDirects` only yields finite numbers; a negative one is garbage, goes to 0.
      await tratar(() => estado.arquivar(channel, Math.max(0, at)), "archive channel is invalid")
    }
    apagar(s, DM_CLOSED_KEY)
  }
}

/**
 * Forget this browser's marks. After "Delete account": they belong to the account
 * that just ended, and the next account in this browser can't inherit them.
 */
export function esquecerEstadoDoBrowser(): void {
  const s = armazem()
  if (!s) return
  apagar(s, LAST_READ_KEY)
  apagar(s, DM_CLOSED_KEY)
  // Room marks are also from this browser and the account that just ended.
  esquecerLidasPorSala()
  doBrowser = null
  avisar()
}

function apagar(s: Pick<Storage, "removeItem">, chave: string): void {
  try {
    s.removeItem(chave)
  } catch {
    // Storage is blocked. The key stays, and migration reruns without harm.
  }
}
