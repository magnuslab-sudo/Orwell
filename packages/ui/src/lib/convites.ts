import { foldInviteTies, inviteKey, type InviteTie } from "@enclave/protocol"
import type { ChatMessage } from "../types.js"
import { fichaNaInterface } from "./tipoDoCanal.js"

/**
 * The state of invites for the interface, folded from the same place the core
 * folds its own: the messages that arrived.
 *
 * It exists for the reason that `friendship.ts` already gives, and weighs even
 * more here: if they diverged, it would not be a sign in the wrong place, it
 * would be the interface saying one thing about who joins what channel and the
 * core saying another. The fold is the same function, imported from the protocol.
 */
export interface Convites {
  /** Invites that others sent me and still wait for my answer. */
  abertos: InviteTie[]
  ties: Map<string, InviteTie>
}

/**
 * `messages` must come in order of arrival, which is how the interface stores them.
 *
 * `agora` comes in as an argument and does not come from `Date.now()` inside
 * here so the timeout can be tested without waiting fourteen days, and so the
 * list does not change underneath a render because the clock moved forward in
 * the middle.
 */
export function convitesDe(messages: ChatMessage[], me: string | null, agora = Date.now()): Convites {
  if (!me) return { abertos: [], ties: new Map() }
  const ties = foldInviteTies(
    // The loose form the interface stores payloads in is not the form the fold
    // declares. `t` always arrives; the two fields arrive when they exist, and the
    // fold decides what to do with them.
    messages.map((message) => ({
      channel: message.channel,
      sender: message.sender,
      payload: {
        t: message.payload.t,
        ...(message.payload.invite ? { invite: message.payload.invite } : {}),
        ...(message.payload.inviteReply ? { inviteReply: message.payload.inviteReply } : {}),
      },
    })),
    me,
    agora,
    // The pair for each direct message comes from the vault entry, as in the core.
    (canal) => {
      const ficha = fichaNaInterface(canal)
      return ficha.tipo === "directa" && ficha.par ? [me, ficha.par] : null
    },
  )
  const abertos = [...ties.values()].filter((tie) => !tie.mine && tie.state === "pendente").sort((a, b) => b.at - a.at)
  return { abertos, ties }
}

/** The invite from a message, if it is one. See `inviteKey`. */
export function conviteDaMensagem(convites: Convites, message: ChatMessage, me: string | null): InviteTie | null {
  const alvo = message.payload.invite?.channel
  if (!alvo || !me) return null
  // The key is (channel, the other person), and the other person is the sender
  // when the invite is not ours. Our own invite is already indexed by the
  // recipient, who is the pair of the conversation; it is found by the target
  // channel.
  if (message.sender !== me) return convites.ties.get(inviteKey(alvo, message.sender)) ?? null
  return [...convites.ties.values()].find((tie) => tie.target === alvo && tie.channel === message.channel) ?? null
}

/**
 * The invites I accepted whose channel has not arrived yet: the person said yes,
 * and who invited them has not seated them yet (was offline, or has not reached
 * their device yet). This is what the sidebar shows gray, "waiting for someone
 * from the channel".
 *
 * `accepted` stays `accepted` in the fold until the timeout, even after joining
 * and leaving the channel (past the timeout the fold already says `expired`).
 * So two cuts: the channel is already here, and the channel was here AFTER the
 * invite (`known`: those seen this session, those archived and waits made to
 * disk, each with its own time). Without the second, someone who left a channel
 * they were invited to via would see the "waiting" line for the channel they
 * just left come back.
 */
export function aceitesAEspera(
  convites: Convites,
  canais: readonly string[],
  /** Channel → the last time we were there, or stopped waiting for it. */
  conhecidos: ReadonlyMap<string, number>,
): InviteTie[] {
  return [...convites.ties.values()]
    .filter(
      (tie) =>
        !tie.mine &&
        tie.state === "aceite" &&
        !canais.includes(tie.target) &&
        // An invite made AFTER the last time we were there is a new invite, and we wait for it again.
        !((conhecidos.get(tie.target) ?? -Infinity) >= tie.at),
    )
    .sort((a, b) => b.at - a.at)
}
