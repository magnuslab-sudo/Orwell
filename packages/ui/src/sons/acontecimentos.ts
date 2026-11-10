import { isDirect, isFeed } from "../lib/format.js"
import { mencionaMe } from "../lib/mentions.js"
import { estaSilenciado } from "../lib/silenciados.js"
import type { AppNotification } from "../lib/notifications.js"
import type { TipoDeSom } from "./familia.js"

/**
 * What sound each event makes. One thing only.
 *
 * **Sound follows the alert.** What enters the bell (and thus can exit as
 * a system alert) is decided in `App.tsx` and in `lib/notifications.ts`. This
 * file does not decide again: it receives the bell input and plays its sound.
 *
 * What does not go through the bell has its own function here: tickets,
 * posts, and calls.
 *
 * Any message in a group room does not enter the bell: what matters
 * is what was directed at me, and in a thirty-person room the mention is what
 * says "this is for you". But it makes its own sound, discreet, since November 3,
 * 2026 (owner request): the `channel`. See `somDoCanal`.
 */

/** The sound of a bell entry, or `null`. */
export function somDaNotificacao(kind: AppNotification["kind"]): TipoDeSom | null {
  switch (kind) {
    case "dm-message":
    case "dm-new":
      return "directa"
    case "mention":
    // Being added to a room is the room calling for me: the same family as a mention.
    case "room-added":
      return "mencao"
    case "friend-request":
      return "pedido"
    case "friend-accept":
      return "aceite"
    // Someone who entered through my invite has already entered: nothing to do, nothing to hear.
    // It is the same silence as the system alert verdict (`systemNoticeVerdictOf`).
    case "channel-join":
      return null
    // The call ring already sounded while it was ringing: a missed call is just recorded.
    case "missed-call":
      return null
    // A report on my channel: goes in the bell, no sound. Not urgent at the second.
    case "report-copy":
      return null
    // The verdict on a report I filed: goes in the bell, no sound, like the copy.
    case "report-decision":
      return null
  }
}

/**
 * Does silence mute the sound of this entry? Yes, in a muted place, except for
 * the mention, which keeps ringing (`lib/silenciados.ts`). It is the same rule as the
 * system alert (`systemNoticeVerdictOf`): sound follows the alert.
 */
export function caladaPeloSilencio(kind: AppNotification["kind"], silenciado: boolean): boolean {
  return silenciado && kind !== "mention"
}

/** What this file reads from a message. */
export interface MensagemParaSom {
  channel: string
  sender: string
  /** It arrived live, not during recovery on startup or in a telemetry report. */
  aoVivo?: boolean
  payload: { t: string; room?: unknown; ticket?: unknown; mentions?: unknown }
}

/** The room of a message: "" is the default room. */
export function salaDaMensagem(mensagem: MensagemParaSom): string {
  return typeof mensagem.payload.room === "string" ? mensagem.payload.room : ""
}

/**
 * The sound of a new message in a channel room (owner request, November 3,
 * 2026), or `null`.
 *
 * Plays when a message arrives live from someone else in a group room.
 * Does not play:
 *
 * - for my own messages;
 * - outside a group room: a private conversation has `directa`, the wall
 *   has `publicacao`;
 * - for what is not a written message: profiles, roles, rooms created,
 *   `channel.meta`, reactions, edits. Only `t: "message"`;
 * - for history: recovery on startup and reload, and telemetry reports from
 *   other members, arrive without `aoVivo`;
 * - when I am mentioned: the mention wins, and only it plays (via the bell);
 * - in a ticket: the ticket has its own sound and rules (`somDaMensagem`);
 * - in a muted channel or room (`lib/silenciados.ts`).
 *
 * The room in focus, the 1 and 3 second limits, "Busy", "Invisible" and the
 * pause are handled by the engine (`motor.ts`), like all sounds.
 */
export function somDoCanal(mensagem: MensagemParaSom, eu: string, silenciados: readonly string[] = []): TipoDeSom | null {
  const { payload } = mensagem
  if (mensagem.aoVivo !== true) return null
  if (mensagem.sender === eu) return null
  if (payload.t !== "message") return null
  if (isDirect(mensagem.channel) || isFeed(mensagem.channel)) return null
  if (mencionaMe(Array.isArray(payload.mentions) ? (payload.mentions as string[]) : undefined, eu)) return null
  if (payload.ticket !== undefined && payload.ticket !== null) return null
  if (estaSilenciado(silenciados, mensagem.channel, salaDaMensagem(mensagem))) return null
  return "canal"
}

/** Who opened and who is handling a ticket, according to the core. */
export type QuemDoTicket = (channel: string, room: string, ticket: string) => { opener: string; assignee: string } | null

/**
 * The sound of a message that does not enter the bell: ticket or post.
 *
 * - **New ticket** (the message carries `subject`): plays for those in the room.
 * - **Reply to a ticket**: only for who opened it and who is handling it. A
 *   reply in someone else's ticket is not for me.
 * - **Post** on a friend's wall: the quietest sound, and turned off by
 *   default (`preferencias.ts`).
 *
 * A message that mentions me already makes the mention sound via the bell. Here it
 * stays silent, so one event does not make two sounds.
 */
export function somDaMensagem(
  mensagem: MensagemParaSom,
  eu: string,
  quemDoTicket: QuemDoTicket,
  silenciados: readonly string[] = [],
): TipoDeSom | null {
  if (mensagem.sender === eu) return null
  const { payload } = mensagem
  // In a muted place the ticket and post do not play. The mention does not go through here:
  // it plays via the bell, and there the mute lets it through.
  if (estaSilenciado(silenciados, mensagem.channel, typeof payload.room === "string" ? payload.room : "")) return null
  if (payload.t === "post") return isFeed(mensagem.channel) ? "publicacao" : null
  if (payload.t !== "message") return null
  if (isDirect(mensagem.channel)) return null
  if (mencionaMe(Array.isArray(payload.mentions) ? (payload.mentions as string[]) : undefined, eu)) return null
  const ticket = payload.ticket
  if (!ticket || typeof ticket !== "object") return null
  const marca = ticket as { id?: unknown; subject?: unknown }
  if (typeof marca.id !== "string" || marca.id === "") return null
  if (typeof marca.subject === "string") return "ticket"
  const room = typeof payload.room === "string" ? payload.room : ""
  const quem = quemDoTicket(mensagem.channel, room, marca.id)
  if (!quem) return null
  return quem.opener === eu || quem.assignee === eu ? "ticket" : null
}

/**
 * Sounds for calls: the ring, who joins, leaves or goes live in the voice room, and
 * those for muting. They are the ones the Notifications pause lets through.
 */
const SONS_DA_CHAMADA: ReadonlySet<TipoDeSom> = new Set([
  "chamada",
  "entrou",
  "saiu",
  "ligado",
  "mic-silenciado",
  "mic-ligado",
  "tudo-silenciado",
  "tudo-ligado",
  // Those matching Discord parity (3/11/2026): they all happen inside a
  // call that the person chose to have, or signal that it ended unwillingly.
  "a-chamar",
  "voz-perdida",
  "movido",
  "transmissao-iniciada",
  "transmissao-terminada",
  "espectador-entrou",
  "espectador-saiu",
])

/** The audio state of a call, as `usePrefs` stores it. */
export interface EstadoDoSilencio {
  micMuted: boolean
  soundOff: boolean
}

/**
 * The sound of a mute change, or `null` (point 3, November 2, 2026).
 *
 * "Mute all" overrides the microphone: pressing the microphone with everything
 * muted restores both (`alternarMicrofone`, in `App.tsx`), and what ended was
 * "mute all". The sound tells you that.
 *
 * "Mute all" never mutes its own sound. It mutes call voices and join and
 * leave notifications (`lib/sounds.ts`, `deafened`); these sounds come from the
 * alert engine, which does not read `soundOff`. So the mute all sound plays
 * after everything is muted, and the unmute sound also plays.
 */
export function somDoSilencio(antes: EstadoDoSilencio, depois: EstadoDoSilencio): TipoDeSom | null {
  if (antes.soundOff !== depois.soundOff) return depois.soundOff ? "tudo-silenciado" : "tudo-ligado"
  if (antes.micMuted !== depois.micMuted) return depois.micMuted ? "mic-silenciado" : "mic-ligado"
  return null
}

/**
 * Does the Notifications pause ("Pause", phase 4) mute this sound?
 *
 * Mutes everything except calls. When someone pauses, they want silence for a while, but a
 * call means someone is waiting on the other end right now, and the pause cannot
 * leave the person unaware. Sounds from inside the call (joined, left, live) also
 * go through: they are part of the conversation the person chose to have. Mute
 * sounds go through for the same reason, and because they respond to an action taken now.
 */
export function caladoPelaPausa(tipo: TipoDeSom, pausaAte: number | undefined, agora: number): boolean {
  return !SONS_DA_CHAMADA.has(tipo) && (pausaAte ?? 0) > agora
}

/**
 * Does an incoming call ring? Only in a private conversation.
 *
 * Owner and community request (November 2, 2026, point 7). Before, a voice room
 * in a community also rang once when the first person joined. In an active
 * community that was a phone ring for each conversation that started, and no one
 * was calling anyone. In the room it stays a normal alert: the room line in the
 * sidebar shows who is there (`vozPorSala`). In a private conversation the call
 * is for me, and it rings until I answer (or until `TOQUE_MAXIMO_MS`).
 */
export function tocaOToque(channel: string): boolean {
  return isDirect(channel)
}
