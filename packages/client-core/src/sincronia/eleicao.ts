/**
 * Who speaks, and how much (phase S4 of absolute sync,
 * `docs/planos/2026-10-20-sincronia-absoluta.md`, §4.4).
 *
 * Three components, all offline and without their own clock (the clock comes as
 * a parameter, for testing):
 *
 * - **Election.** For each request, the caller chooses who answers: the lowest
 *   live leaf in the MLS tree, among those that can answer. All
 *   members see the same tree, so the choice is the same everywhere.
 * - **Suppression.** Anyone wanting to answer a summary with theirs waits for
 *   `posição × 2 s`; if they see a summary equal to theirs in the meantime, they stay silent.
 * - **Caps and backoff.** Per minute, below the server's
 *   (`TECTOS_DO_SINAL` in `apps/server/src/config.ts`: 120 sinais per connection,
 *   16 KiB per signal, 4 MiB per channel), and exponential backoff when the
 *   server refuses on rate limit (`sinal-rate-limited`, `sinal-channel-busy`).
 */

/** A leaf of the MLS tree of a channel. */
export interface Folha {
  /** The leaf index. Election picks the lowest. */
  indice: number
  /** A conta. */
  address: string
  /** The device key, in base64url. */
  aparelho: string
}

/**
 * The numbers, each with its reason. Static and mutable only for tests to
 * lower them; no one else touches them.
 */
export const TECTOS_DA_SINCRONIA = {
  /**
   * A leaf is live if it sent a signal (live event or ephemeral signal) in
   * the last 120 s, or if the account is connected to the server (§4.4).
   */
  vidaMs: 120_000,
  /** No reply to a request in 15 s, move to the next leaf (§4.4). */
  esperaDoPedidoMs: 15_000,
  /** At most three leaves per request; then wait for the next batch. */
  tentativasPorPedido: 3,
  /** The deletion step: position in the list times this (§4.4). */
  passoDaSupressaoMs: 2_000,
  /**
   * A trigger summary per channel every 20 s, at most (three per minute).
   * The spec said one per minute (§4.4); at one per minute, a connection that
   * drops and comes back in the same minute would wait up to 60 s, and the goal
   * with both devices connected is 30 s. A trigger above the cap does not get
   * lost: it goes out when the interval allows (one per channel waiting), because
   * the reconnection is the trigger that repairs it. The server closes at 120
   * signals per minute.
   */
  intervaloEntreResumosMs: 20_000,
  /**
   * And in response to a summary different from ours, separately: the response
   * is what repairs the other side, and cannot wait a minute behind a trigger.
   * A summary equal to the last one sent less than a minute ago does not go out
   * again, regardless of type: it says nothing new.
   */
  respostasPorCanalPorMinuto: 2,
  /** Requests (levels 1, 2 and items) per channel and per minute, and overall (§4.4). */
  pedidosPorCanalPorMinuto: 6,
  pedidosPorMinuto: 30,
  /**
   * Signals per minute, overall. The server closes at 120 per connection: half
   * leaves the other half to whoever needs it more (another separator of the
   * same account).
   */
  sinaisPorMinuto: 60,
  /**
   * The largest signal that goes out, in base64url characters. The server refuses
   * above 16 KiB; 12 KiB leaves room for the header and cipher.
   */
  sinalMaxCaracteres: 12 * 1024,
  /**
   * Bytes of OUTGOING signals per channel and per minute, as the server counts
   * them: the size of each signal times the copies it delivers (one per each
   * other connection in the channel). The server refuses above 4 MiB per channel,
   * summing ALL members; half leaves the other half to others.
   */
  bytesDeSinalPorCanalPorMinuto: 2 * 1024 * 1024,
  /** Bytes of reports per channel and per minute (§4.4: 1 MB). */
  bytesDeRelatoPorCanalPorMinuto: 1024 * 1024,
  /** A report frame has at most this much JSON (§4.4: 256 KB; with room for cipher and padding). */
  bytesPorTramaDeRelato: 192 * 1024,
  /** Reports stored on the server per channel and per day (§4.4: 4 MB). */
  bytesDeRelatoPorCanalPorDia: 4 * 1024 * 1024,
  /** Exponential backoff starts here when the refusal does not say how long to wait. */
  recuoInicialMs: 1_000,
  /** And does not exceed this. */
  recuoMaximoMs: 5 * 60_000,
}

/**
 * The leaves that can respond, in election order.
 *
 * Excluded: those on the same device, those that cannot respond, those dead. If
 * `comDados` is provided, only those that showed they have the data (§4.4, point 3).
 */
export function candidatos(
  folhas: readonly Folha[],
  opcoes: {
    proprio: string
    capaz: (folha: Folha) => boolean
    viva: (folha: Folha) => boolean
    comDados?: (folha: Folha) => boolean
  },
): Folha[] {
  return folhas
    .filter(
      (folha) =>
        folha.aparelho !== opcoes.proprio &&
        opcoes.capaz(folha) &&
        opcoes.viva(folha) &&
        (opcoes.comDados ? opcoes.comDados(folha) : true),
    )
    .sort((a, b) => a.indice - b.indice)
}

/** The elected leaf on attempt `tentativa` (0 is the first), or `null`. */
export function eleger(lista: readonly Folha[], tentativa = 0): Folha | null {
  if (tentativa >= TECTOS_DA_SINCRONIA.tentativasPorPedido) return null
  return lista[tentativa] ?? null
}

/**
 * How long the requester waits to respond to a summary with theirs. The position
 * is the rank of this device's leaf in the responder list, including it.
 */
export function esperaDeSupressao(folhas: readonly Folha[], proprio: string): number {
  const ordenadas = [...folhas].sort((a, b) => a.indice - b.indice)
  const posicao = ordenadas.findIndex((folha) => folha.aparelho === proprio)
  return Math.max(0, posicao) * TECTOS_DA_SINCRONIA.passoDaSupressaoMs
}

/** Who sent the signal, and when. Memory only: after reload, the honest answer is "I don't know". */
export class Vivacidade {
  #vistos = new Map<string, number>()

  notar(aparelho: string, agora: number): void {
    const antes = this.#vistos.get(aparelho)
    if (antes === undefined || antes < agora) this.#vistos.set(aparelho, agora)
  }

  viva(aparelho: string, agora: number): boolean {
    const visto = this.#vistos.get(aparelho)
    return visto !== undefined && agora - visto <= TECTOS_DA_SINCRONIA.vidaMs
  }
}

/**
 * A cap per one-minute sliding window, per key. Each expense has a cost
 * (1 to count signals, bytes to count bytes).
 */
export class TectoPorMinuto {
  #gastos = new Map<string, { em: number; custo: number }[]>()
  readonly #janelaMs: number

  constructor(janelaMs = 60_000) {
    this.#janelaMs = janelaMs
  }

  #vivos(chave: string, agora: number): { em: number; custo: number }[] {
    const lista = (this.#gastos.get(chave) ?? []).filter((gasto) => agora - gasto.em < this.#janelaMs)
    if (lista.length === 0) this.#gastos.delete(chave)
    else this.#gastos.set(chave, lista)
    return lista
  }

  usado(chave: string, agora: number): number {
    return this.#vivos(chave, agora).reduce((soma, gasto) => soma + gasto.custo, 0)
  }

  /** How many ms until the oldest expense for this key leaves the window (0 if there is none). */
  liberaEm(chave: string, agora: number): number {
    const lista = this.#vivos(chave, agora)
    const primeiro = lista[0]
    return primeiro === undefined ? 0 : Math.max(0, primeiro.em + this.#janelaMs - agora)
  }

  /** If it fits, spend and say yes. If not, spend nothing. */
  gastar(chave: string, custo: number, tecto: number, agora: number): boolean {
    if (this.usado(chave, agora) + custo > tecto) return false
    const lista = this.#gastos.get(chave)
    if (lista) lista.push({ em: agora, custo })
    else this.#gastos.set(chave, [{ em: agora, custo }])
    return true
  }
}

/**
 * The backoff after a server refusal, per channel.
 *
 * `retryAfterMs` is how long until the server bucket has room; without it,
 * start at `recuoInicialMs`. Each following refusal doubles the wait, up to
 * `recuoMaximoMs`. The server does not confirm a signal that goes through, so
 * the count restarts when a minute passes without refusal after the wait ends.
 */
export class Recuo {
  #estado = new Map<string, { ate: number; seguidas: number }>()

  recusado(chave: string, agora: number, retryAfterMs?: number | undefined): number {
    const anterior = this.#estado.get(chave)
    // A refusal much later than the previous one (a minute after the wait ends) restarts the count.
    const seguidas = anterior !== undefined && agora - anterior.ate < 60_000 ? anterior.seguidas + 1 : 1
    const base = retryAfterMs ?? TECTOS_DA_SINCRONIA.recuoInicialMs
    const espera = Math.min(TECTOS_DA_SINCRONIA.recuoMaximoMs, base * 2 ** (seguidas - 1))
    this.#estado.set(chave, { ate: agora + espera, seguidas })
    return espera
  }

  passou(chave: string): void {
    this.#estado.delete(chave)
  }

  bloqueado(chave: string, agora: number): boolean {
    const estado = this.#estado.get(chave)
    return estado !== undefined && agora < estado.ate
  }
}
