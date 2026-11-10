/**
 * MSN-style notifications: "Ana is online" (requested by the owner and community, 2 November
 * 2026, item 6).
 *
 * When a friend comes online, a notification shows their picture and name, plays a short
 * sound (`amigo-online`), and tapping opens the private conversation with that person.
 *
 * The rules, and why each one:
 *
 * - **Only on arrival.** The server says "connected" and "disconnected". A "connected" from
 *   someone already connected (a second device, a repeat) is not arrival.
 * - **Nothing for those already there.** On startup, the server lists who is online, one
 *   presence per person. These are people who were already there: ten notifications at once
 *   when opening the app would be noise. The thing that ends that startup phase is the same
 *   gate as the call ring (`createCallRingGate`, in `lib/sounds.ts`), because the problem is
 *   the same: the snapshot of what existed already arrives as new events.
 * - **Once per friend every 30 minutes.** A network that drops and comes back minute to
 *   minute cannot notify minute to minute.
 * - **Never for someone who is "Invisible".** There is no rule to write here: someone
 *   invisible does not announce themselves (`setVisible`), and the server does not tell
 *   anyone they connected. Without "connected", there is no notification.
 * - **"Busy", "Paused", and muted conversations silence notifications**, like they silence
 *   other notifications. Muted means the private conversation with that person.
 */

/** Once per friend in this window. */
export const INTERVALO_DO_AVISO_MS = 30 * 60_000

/**
 * Friend notifications, one per event (requested by the owner, 3 November 2026): came
 * online, joined a voice room, started screen sharing, joined a community. The 30-minute
 * window counts per friend AND per type: Ana coming online does not silence Ana in a voice
 * room a minute later.
 */
export type TipoDeAvisoDeAmigo = "online" | "voz" | "ecra" | "comunidade"

export interface VigiaDosAmigos {
  /**
   * A presence from the server. Returns `true` when it is an arrival that can notify: was
   * offline, is now online, and the connection is no longer opening.
   *
   * During startup (`aAssentar`), the presence is saved anyway: that is what makes the next
   * announcement of the same person not count as arrival.
   */
  chegou(quem: string, online: boolean, agora: number, aAssentar: boolean): boolean
  /**
   * Marks the notification for this person, if the window allows. Returns `false` when
   * they already had a notification of this type less than `INTERVALO_DO_AVISO_MS` ago.
   */
  registar(quem: string, agora: number, tipo?: TipoDeAvisoDeAmigo): boolean
  /** The connection dropped: who was online is no longer known. */
  desligou(): void
}

export function criarVigiaDosAmigos(): VigiaDosAmigos {
  const online = new Set<string>()
  const ultimoAviso = new Map<string, number>()
  return {
    chegou(quem, estaOnline, _agora, aAssentar) {
      if (!estaOnline) {
        online.delete(quem)
        return false
      }
      const jaEstava = online.has(quem)
      online.add(quem)
      return !jaEstava && !aAssentar
    },
    registar(quem, agora, tipo = "online") {
      const chave = `${tipo} ${quem}`
      const antes = ultimoAviso.get(chave)
      if (antes !== undefined && agora - antes < INTERVALO_DO_AVISO_MS) return false
      ultimoAviso.set(chave, agora)
      return true
    },
    desligou() {
      // The 30-minute window stays: reconnecting cannot restore notifications.
      online.clear()
    },
  }
}

/** What we know at the moment of arrival. */
export interface ContextoDoAmigo {
  /** The toggle "Notify when a friend comes online" (Notifications). */
  ligado: boolean
  /** A friend in reality: feed slots swapped, and the friendship remains. */
  eAmigo: boolean
  /** "Busy": the person asked not to be interrupted. */
  ocupado: boolean
  /** Notifications are paused ("Pause"). */
  pausado: boolean
  /** The private conversation with this friend is muted. */
  silenciado: boolean
  /** The vault is open. When closed, there are no names or faces to show. */
  desbloqueado: boolean
}

/** Does this friend's arrival notification fit the person's preferences? */
export function avisoDoAmigoCabe(contexto: ContextoDoAmigo): boolean {
  return (
    contexto.desbloqueado &&
    contexto.ligado &&
    contexto.eAmigo &&
    !contexto.ocupado &&
    !contexto.pausado &&
    !contexto.silenciado
  )
}
