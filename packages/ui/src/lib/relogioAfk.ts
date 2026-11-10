/**
 * The AFK room timer (owner request on 2/11/2026).
 *
 * "Users move by default to the AFK room if they are in a muted room for
 * 15 minutes." The move is done by the client itself, not the server: the
 * server does not know who is muted (the announcement travels encrypted). The
 * timer runs on this device, for this call. Two devices on the same account
 * each decide for themselves.
 *
 * **What counts as muted: the gesture, and only the gesture.** Mute the
 * microphone or mute all, the two choices that stay saved. "Push to talk" also
 * leaves the microphone closed most of the time, and someone using it is not
 * AFK: so each time they press the key the count restarts (`actividade`). Anyone
 * using push to talk WITHOUT the mute gesture is never moved, because their
 * microphone is not muted by choice.
 *
 * **Restarts from zero** when: the microphone turns back on, the person changes
 * room or channel, or pushes to talk. If channel time changes mid-call, it keeps
 * the same start point with the new time.
 *
 * **Does not move:** outside a call, in a direct message, in a channel with no
 * AFK room, already in the AFK room, sharing the screen, playing music (DJ). In
 * a room with one person it moves the same way: someone alone and silent for
 * 15 minutes is not there either.
 *
 * Pure by design: no React and no bridge. Time comes from `Date.now` and
 * `setTimeout`, which tests swap for fake time.
 */

export interface SituacaoAfk {
  /** The channel of the call. `null` means outside a call. */
  canal: string | null
  /** The voice room of the call. Empty means the channel call. */
  sala: string
  /** The call is a direct message (one-to-one or group). */
  privada: boolean
  /** The AFK room of the call's channel, if any. */
  salaAfk: { room: string; minutos: number } | null
  /** Microphone muted or all muted, by the person's choice. */
  silenciadoPorGesto: boolean
  aPartilharEcra: boolean
  aEmitirMusica: boolean
}

/** Where the timer moves to and from. */
export interface MudancaAfk {
  canal: string
  de: string
  para: string
  minutos: number
}

/** Does this situation count for the AFK room? The full rule, in one function. */
export function contaParaAfk(situacao: SituacaoAfk): boolean {
  if (situacao.canal === null || situacao.privada) return false
  if (!situacao.salaAfk) return false
  if (situacao.sala === situacao.salaAfk.room) return false
  if (!situacao.silenciadoPorGesto) return false
  if (situacao.aPartilharEcra || situacao.aEmitirMusica) return false
  return true
}

const MINUTO_MS = 60_000

export class RelogioAfk {
  #inicio: number | null = null
  #chave: string | null = null
  #situacao: SituacaoAfk | null = null
  #temporizador: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly aoExpirar: (mudanca: MudancaAfk) => void) {}

  /** The call state changed. Call on each change; repeating does no harm. */
  actualizar(situacao: SituacaoAfk): void {
    this.#situacao = situacao
    if (!contaParaAfk(situacao)) {
      this.#limpar()
      return
    }
    const chave = `${situacao.canal}\n${situacao.sala}`
    if (this.#inicio === null || chave !== this.#chave) {
      this.#inicio = Date.now()
      this.#chave = chave
    }
    this.#agendar()
  }

  /** The person pushed to talk: they are there, and the count restarts. */
  actividade(): void {
    if (this.#inicio === null) return
    this.#inicio = Date.now()
    this.#agendar()
  }

  /** How much time is left, in milliseconds, or `null` if the timer is not running. */
  get falta(): number | null {
    const situacao = this.#situacao
    if (this.#inicio === null || !situacao?.salaAfk) return null
    return Math.max(0, this.#inicio + situacao.salaAfk.minutos * MINUTO_MS - Date.now())
  }

  parar(): void {
    this.#limpar()
    this.#situacao = null
  }

  #agendar(): void {
    if (this.#temporizador) clearTimeout(this.#temporizador)
    const falta = this.falta
    if (falta === null) return
    this.#temporizador = setTimeout(() => this.#expirar(), falta)
  }

  #expirar(): void {
    this.#temporizador = null
    const situacao = this.#situacao
    if (!situacao || !contaParaAfk(situacao) || !situacao.canal || !situacao.salaAfk) return
    // Fire once: after moving, the room is AFK and the timer stops counting.
    this.#limpar()
    this.aoExpirar({ canal: situacao.canal, de: situacao.sala, para: situacao.salaAfk.room, minutos: situacao.salaAfk.minutos })
  }

  #limpar(): void {
    if (this.#temporizador) clearTimeout(this.#temporizador)
    this.#temporizador = null
    this.#inicio = null
    this.#chave = null
  }
}
