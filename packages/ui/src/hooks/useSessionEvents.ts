import { useEffect } from "react"
import type { Participant } from "@enclave/client-core"
import { AvisoDeSuspensao } from "@enclave/protocol"
import type { ConnectionState, EnclaveBridge } from "../bridge.js"
import type { ChatMessage } from "../types.js"
import type { SessionStatus } from "../lib/statusPolicy.js"
import { vigiarContextoDeAudio } from "../lib/contextoDeAudio.js"

export interface SessionEventHandlers {
  onMessage: (message: ChatMessage) => void
  /**
   * A status event, whole: severity, a stable code, and where the session
   * thinks it belongs. The shell decides what to do with it — see
   * `lib/statusPolicy.ts` — instead of every event becoming a popup.
   */
  onStatus: (status: SessionStatus) => void
  /** The keys rolled in a channel. The epoch number itself is protocol detail. */
  onEpoch: (channel: string) => void
  onConnection: (state: ConnectionState, detail: string | null) => void
  onChannels: (channels: string[]) => void
  onCallParticipants: (participants: Participant[]) => void
  onCallLocalStream: (stream: MediaStream | null) => void
  /**
   * The screen this account is sharing, or nothing when sharing ends.
   *
   * Separate from `local` because they have different lifespans: microphone and camera
   * are born and die with the call, the screen enters and leaves it as many times as you
   * want. It also comes through when the person who stops sharing is the browser button
   * itself, which does not go through any line of our interface.
   */
  onCallScreen: (stream: MediaStream | null) => void
  onCallEnded: () => void
  /** Call mechanics, for local logging. Never content. */
  onCallDiagnostic: (code: string, detail?: string) => void
  /** `detail` is the error key and `cause` is its data (see `CallEvents.error` in the core). */
  onCallError: (detail: string, cause?: unknown) => void
  /** Live presence from the server: a channel-mate connected/disconnected. */
  onPresence: (address: string, online: boolean) => void
  /** Somebody joined or left a call, in any channel we belong to — and which
   * voice room they did it in, so the sidebar can show life where it is. */
  onCallActivity: (event: {
    channel: string
    from: string
    joined: boolean
    room: string
    /** What the person transmits in that room, read from the announcement (phase 1i). */
    transmite?: "ecra" | "musica" | "ecra+musica"
  }) => void
  /**
   * This account was moved to a voice room by request of whoever has that
   * responsibility.
   *
   * The client already obeyed when this arrives, the call has changed. It exists for
   * the screen to follow along and to tell the person who was speaking: a call that
   * changes under your feet without explanation reads as a fault.
   */
  onCallMoved: (event: { channel: string; room: string; by: string }) => void
  /** Whoever has `mover` pulled us from the call ("Hang up"). `ended` comes anyway. */
  onCallDesligado?: ((event: { channel: string; by: string }) => void) | undefined
}

/**
 * Every subscription the shell holds against the bridge, in one place.
 *
 * Registered once, on mount, exactly like the effect it replaces: the handlers
 * captured are the first render's, which close over stable state setters.
 */
export function useSessionEvents(bridge: EnclaveBridge, handlers: SessionEventHandlers): void {
  useEffect(() => {
    const off = [
      bridge.on.message((raw) => handlers.onMessage(raw as ChatMessage)),
      bridge.on.status((raw) => {
        const event = raw as Partial<SessionStatus>
        // The suspension warning comes from the other side of the bridge: it enters only if it passes validation.
        const aviso = event.code === "account-suspended" ? AvisoDeSuspensao.safeParse(event.aviso) : null
        handlers.onStatus({
          detail: event.detail ?? "",
          level: event.level ?? "info",
          ...(event.code ? { code: event.code } : {}),
          ...(event.route ? { route: event.route } : {}),
          ...(event.channel ? { channel: event.channel } : {}),
          ...(event.actor ? { actor: event.actor } : {}),
          ...(aviso?.success ? { aviso: aviso.data } : {}),
          // The decision on a report this account made: without it, `App` does not put
          // anything in the bell (art. 16, no. 5 of DSA). Only the two values that exist.
          ...(event.code === "denuncia-decidida" && (event.decisao === "suspensa" || event.decisao === "sem-accao")
            ? { decisao: event.decisao }
            : {}),
        })
      }),
      bridge.on.epoch((raw) => handlers.onEpoch((raw as { channel?: string }).channel ?? "")),
      bridge.on.connection((raw) => {
        const event = raw as { state: ConnectionState; detail?: string }
        handlers.onConnection(event.state, event.detail ?? null)
      }),
      bridge.on.channels((raw) => handlers.onChannels((raw as { channels: string[] }).channels)),
      bridge.on.presence((event) => handlers.onPresence(event.address, event.online)),
      bridge.call.on("participants", (event) => handlers.onCallParticipants(event.participants)),
      bridge.call.on("local", (event) => handlers.onCallLocalStream(event.stream)),
      bridge.call.on("screen", (event) => handlers.onCallScreen(event.stream)),
      bridge.call.on("ended", () => handlers.onCallEnded()),
      bridge.call.on("error", (event) => handlers.onCallError(event.detail, event.cause)),
      bridge.call.on("diagnostic", (event) => handlers.onCallDiagnostic(event.code, event.detail)),
      bridge.on.callActivity((event) => handlers.onCallActivity(event)),
      bridge.call.on("moved", (event) => handlers.onCallMoved(event)),
      bridge.call.on("desligado", (event) => handlers.onCallDesligado?.(event)),
      // The shared audio context paused by the system, for the call log.
      // See `vigiarContextoDeAudio`.
      vigiarContextoDeAudio((mudanca) =>
        mudanca.t === "parou"
          ? handlers.onCallDiagnostic("audio-contexto-parado", mudanca.estado)
          : handlers.onCallDiagnostic("audio-contexto-voltou"),
      ),
    ]
    return () => off.forEach((remove) => remove())
    // Intentionally empty, mirroring the original effect in App.tsx.
  }, [])
}
