/**
 * Where a session status is allowed to land, as one pure decision.
 *
 * The rule this file exists to enforce: a toast is an INTERRUPTION, and the
 * only two things that justify interrupting somebody are (a) the result of
 * something they just asked for and (b) an error they can act on. Everything
 * else the session says. channels restored, keys rolled, a welcome adopted,
 * a repair attempted, a relay complaining in English. is mechanics. Mechanics
 * belong in the diagnostic log, which is exactly where they are now sent.
 *
 * Before this existed every `status` event became a toast. Logging in with a
 * handful of rooms and half-finished friendships produced a column of popups
 * in the corner describing plumbing: entries into channels the person never
 * asked to enter, epochs, expired invitations being cleaned up. The complaint
 * that started this was "spam de informação com cards popup", and it was a
 * fair description of what the app did.
 *
 * Kept pure so the startup burst can be replayed in a test, event by event,
 * and the answer checked. no React, no timers, no session.
 */

import { eMoradaOpaca, type AvisoDeSuspensao } from "@enclave/protocol"
import { strings, translateError } from "../strings.js"
import { chaveDoServidor } from "./codigosDeErro.js"

export type StatusLevel = "info" | "error"

/** Where the source says this belongs. Absent means "decide by severity". */
export type StatusRoute = "toast" | "notice" | "log"

export interface SessionStatus {
  detail: string
  level: StatusLevel
  code?: string | undefined
  route?: StatusRoute | undefined
  channel?: string | undefined
  actor?: string | undefined
  /** Only in `account-suspended`: the suspension warning, when the core read it. */
  aviso?: AvisoDeSuspensao | undefined
  /** Only in `denuncia-decidida`: the decision on a report that this account made. */
  decisao?: "suspensa" | "sem-accao" | undefined
}

export interface RoutingContext {
  now: number
  /**
   * When the current connection came up, or 0 before the first one.
   *
   * Everything in the seconds after a connection is mechanics: restoring
   * groups, replaying what was missed, adopting welcomes that piled up while
   * the device was away. None of it is news, and all of it used to arrive at
   * once.
   */
  connectedAt: number
  /** Key → when a toast for it was last allowed through. */
  lastToastAt: ReadonlyMap<string, number>
}

export type StatusDecision =
  | { target: "toast"; detail: string; level: StatusLevel; key: string }
  | { target: "notice"; detail: string; code: string; channel?: string; actor?: string }
  | { target: "log"; reason: "routed" | "quiet-window" | "coalesced" }

/**
 * The phrase shown for a core warning, chosen by `code`.
 *
 * The `detail` comes written for the log (in English, or in a Portuguese phrase
 * with the channel and numbers inside), and reached the screen as is. For codes
 * that have a phrase in the catalog, that is what is shown, in the reader's
 * language. Errors come out with the code ("Error 349"), like the others; the
 * data the phrase uses comes from here, not from the core text. The others fall
 * into `detail`, as always.
 */
export function fraseDoStatus(status: SessionStatus, labelFor: (channel: string) => string): string | null {
  switch (status.code) {
    case "channel-removed":
      return strings.avisosDoNucleo.channelRemoved(status.channel ? labelFor(status.channel) : "?")
    case "welcome-dead":
      return strings.avisosDoNucleo.welcomeDead
    case "channel-deleted": {
      // The core forgets the channel before warning: the name comes in `detail`, after the key.
      const nome = /^channel-deleted: (.+)$/s.exec(status.detail)?.[1]
      return strings.avisosDoNucleo.channelDeleted(nome ?? (status.channel ? labelFor(status.channel) : "?"))
    }
    case "server-error": {
      // "code: phrase", from the `error` fatal on the server. See `CHAVES_DO_SERVIDOR`.
      const codigo = /^([^:\s]+):/.exec(status.detail)?.[1] ?? ""
      return translateError(chaveDoServidor(codigo), { codigo })
    }
    case "channels-unreadable": {
      const quantos = Number.parseInt(status.detail, 10)
      return translateError("some channels could not be read", Number.isFinite(quantos) ? { quantos } : {})
    }
    case "channel-forked": {
      // A channel with no name has its address as the banner. An opaque address never
      // goes to the screen (Error 349): with no name, the phrase comes out without it.
      const nome = status.channel ? labelFor(status.channel) : ""
      const canal = status.channel ?? ""
      const eAMorada = eMoradaOpaca(canal) && (nome === canal || canal.startsWith(`!${nome}:`))
      return translateError("this channel was recreated", nome && !eAMorada ? { nome } : {})
    }
    case "identity-obsolete":
      return translateError("this account is no longer valid on this server")
    case "channel-orphaned":
      return translateError("this channel no longer exists here")
    case "invite-rejected":
      return translateError(chaveDoConviteRecusado(status.detail))
    case "device-revoked":
      // The account removed this device from another device. The UI takes the person to the gate.
      return translateError("device-revoked")
    case "account-suspended":
      // The account is suspended on this server. The interface shows the full warning.
      return translateError("account-suspended")
    case "account-channel-foreign":
      // Goes to the log (`route: "log"`); the phrase serves those who read it in a report.
      return translateError("account-channel-foreign")
    default:
      return null
  }
}

/**
 * The key of a refused invite.
 *
 * Core 0.5.7 states the reason in a Portuguese phrase; the key is what is
 * asked for in the phase 5 report (diff to `session.ts`). Accepts both, so
 * the interface does not depend on the order the two changes land.
 */
function chaveDoConviteRecusado(detalhe: string): string {
  if (detalhe === "that invite expired" || detalhe === "Esse convite expirou.") return "that invite expired"
  if (detalhe === "that invite reached its limit" || detalhe === "Esse convite já atingiu o limite de utilizações.") {
    return "that invite reached its limit"
  }
  // INV-02: above the rescue caps. No usage was spent.
  if (detalhe === "too many invite requests") return "too many invite requests"
  return "that invite no longer exists"
}

/** How long after a connection comes up mechanics stay quiet. */
export const QUIET_WINDOW_MS = 6_000
/** How long the same kind of toast waits before it may interrupt again. */
export const COALESCE_MS = 10_000

/**
 * Decide, for one status event, whether it interrupts, rings the bell, or is
 * only written to the log.
 *
 * `key` on a toast decision is what the caller records in `lastToastAt`; the
 * code is preferred over the wording so a message that names a different
 * channel each time still coalesces as one kind of event.
 */
export function routeStatus(status: SessionStatus, context: RoutingContext): StatusDecision {
  // No route from the source: an older client-core, or a path nobody has
  // classified yet. Severity is the honest fallback — an error still shows.
  const route: StatusRoute = status.route ?? (status.level === "error" ? "toast" : "log")

  if (route === "log") return { target: "log", reason: "routed" }
  if (route === "notice") {
    return {
      target: "notice",
      detail: status.detail,
      code: status.code ?? "status",
      ...(status.channel ? { channel: status.channel } : {}),
      ...(status.actor ? { actor: status.actor } : {}),
    }
  }

  const key = status.code ?? status.detail

  /**
   * The silence window, deliberately asymmetric.
   *
   * Info toasts are suppressed while a connection settles, because nothing
   * a person asked for arrives in the first seconds of one. Errors are not:
   * "part of this account cannot be read here" is exactly the thing that must
   * survive a policy written to make the app quieter. The one exception is the
   * server's own error frames, which arrive in bursts during a reconnect and
   * say nothing anyone can act on — the connection banner already covers them.
   */
  const settling = context.connectedAt > 0 && context.now - context.connectedAt < QUIET_WINDOW_MS
  if (settling && (status.level === "info" || status.code === "server-error")) {
    return { target: "log", reason: "quiet-window" }
  }

  // The same kind of event twice in ten seconds is one event as far as anyone
  // reading the corner of the screen is concerned.
  const last = context.lastToastAt.get(key)
  if (last !== undefined && context.now - last < COALESCE_MS) {
    return { target: "log", reason: "coalesced" }
  }

  return { target: "toast", detail: status.detail, level: status.level, key }
}
