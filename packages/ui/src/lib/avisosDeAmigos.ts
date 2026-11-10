import { PRESENCA_VALIDA_MS } from "./presenca.js"

/**
 * Friend activity that generates a card in MSN, besides "came online" (owner
 * request, November 3, 2026): joined a voice room, started screen share, joined
 * a community.
 *
 * Here we only decide WHEN an update is a new event. Whether it fits the user's
 * choices (actual friend, "Busy", pause, muted, the toggle, the 30 minutes)
 * is decided in `lib/amigosOnline.ts`, the same way as the online alert.
 *
 * ## Voice
 *
 * Presence in a voice room is REAFFIRMED from time to time (`call.ts`): the
 * same "I joined" arrives several times while the person is there. A join is
 * only the first, or the first after presence expires (`PRESENCA_VALIDA_MS`),
 * which is when they closed the laptop and came back.
 *
 * Screen share comes in the same update (`transmite`, phase 1i), so it also
 * reaches people not in the room. Starting is going from "no screen" to "has screen".
 *
 * During connection setup (`aAssentar`) we store what arrives without alerting:
 * these are people already there.
 */
export interface MudancaNaVoz {
  /** The person just joined this room. */
  entrou: boolean
  /** The person started sharing their screen in this room. */
  comecouOEcra: boolean
}

export interface AnuncioDeVoz {
  /** `chaveDaSala(canal, sala)`. */
  sala: string
  quem: string
  entrou: boolean
  /** Shares the screen, per the update. */
  ecra: boolean
  agora: number
  aAssentar: boolean
}

export interface VigiaDaVoz {
  ouvir(anuncio: AnuncioDeVoz): MudancaNaVoz
  /** The person disconnected: they leave all rooms. */
  esquecer(quem: string): void
  /** The connection dropped: what we knew about the rooms no longer holds. */
  desligou(): void
}

const NADA: MudancaNaVoz = { entrou: false, comecouOEcra: false }

export function criarVigiaDaVoz(): VigiaDaVoz {
  const salas = new Map<string, Map<string, { visto: number; ecra: boolean }>>()
  return {
    ouvir({ sala, quem, entrou, ecra, agora, aAssentar }) {
      const naSala = salas.get(sala) ?? new Map<string, { visto: number; ecra: boolean }>()
      const antes = naSala.get(quem)
      if (!entrou) {
        naSala.delete(quem)
        if (naSala.size === 0) salas.delete(sala)
        return NADA
      }
      naSala.set(quem, { visto: agora, ecra })
      salas.set(sala, naSala)
      if (aAssentar) return NADA
      const vivo = antes !== undefined && agora - antes.visto <= PRESENCA_VALIDA_MS
      return {
        entrou: !vivo,
        comecouOEcra: ecra && !(vivo && antes.ecra),
      }
    },
    esquecer(quem) {
      for (const [sala, naSala] of salas) {
        naSala.delete(quem)
        if (naSala.size === 0) salas.delete(sala)
      }
    },
    desligou() {
      salas.clear()
    },
  }
}

/**
 * ## Communities
 *
 * The server only says "joined by invite" (`member-joined`) on the device that
 * admitted the person; other members hear nothing. The signal that reaches
 * everyone is the epoch: each join is a commit. So we compare the member list
 * after each epoch with the previous list.
 *
 * The first list for each community is just a snapshot of who is there, and
 * does not alert: this is the case for opening the app, or for just joining a
 * new community. During connection setup we also just store it.
 */
export interface VigiaDasComunidades {
  /** Those who joined since the last list for this community. */
  membros(canal: string, lista: readonly string[], aAssentar: boolean): string[]
  /** We left the community: the next list is a fresh start. */
  esquecer(canal: string): void
}

export function criarVigiaDasComunidades(): VigiaDasComunidades {
  const conhecidos = new Map<string, Set<string>>()
  return {
    membros(canal, lista, aAssentar) {
      const antes = conhecidos.get(canal)
      conhecidos.set(canal, new Set(lista))
      if (!antes || aAssentar) return []
      return [...new Set(lista)].filter((quem) => !antes.has(quem))
    },
    esquecer(canal) {
      conhecidos.delete(canal)
    },
  }
}
