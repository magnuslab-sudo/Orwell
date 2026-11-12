/**
 * The system notice, in decisions that don't need Electron.
 *
 * Separated from `bandeja.ts` for the same reason as `ecra.ts`: what the main
 * process decides is measured without opening a window. The tray wires this to
 * the real `Notification`.
 */

/** What the interface tells to show. See `SystemNotice` in `@enclave/ui`. */
export interface Aviso {
  id: string
  title: string
  body: string
  channel: string | null
  /**
   * The notice can be seen by everyone.
   *
   * False when the user has turned off "Show content": in that case the bar
   * icon doesn't change at all. A number on the icon is content, it tells
   * anyone passing by the screen that someone is talking to you and how many,    * and the preference to hide text hides that too for the same reason.
   */
  countable: boolean
  /**
   * The face of who the notice is about, as a data URL, or `null`.
   *
   * Only a friend coming online notice includes it (point 6, November 2, 2026),
   * and only with "Show content" on: a face is a name in another form.
   */
  icon: string | null
  /**
   * Closes automatically after this time, in milliseconds, or `null` to use
   * the system time. See `expiraEmMs` in `SystemNotice` (friend comes online: 2 s).
   */
  expiraEmMs: number | null
}

/** The accepted timeout for a notice to close itself: from half a second to one minute. */
export function sanearPrazo(cru: unknown): number | null {
  return typeof cru === "number" && Number.isInteger(cru) && cru >= 500 && cru <= 60_000 ? cru : null
}

/** Possible refusals, so the caller can tell "no" apart from "failed". */
export type Recusa = "cofre-fechado" | "sem-suporte" | null

/** The cap on text that crosses IPC to the notification system. */
const MAX_TEXTO = 180

/**
 * The cap on the avatar, in data URL characters.
 *
 * Profile photos are scaled down before publishing and fit here with room to
 * spare. A larger value is not an avatar: it is someone pushing megabytes
 * through IPC to the OS.
 */
export const MAX_ICONE = 256 * 1024

/**
 * Embedded images only, and only in bitmap formats.
 *
 * A network or file path would make the main process fetch something at the
 * renderer's request, and that never happens. SVG is out: it is code, and the
 * OS does not need it to display an avatar.
 */
const ICONE_VALIDO = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/

export function sanearIcone(cru: unknown, maximo: number = MAX_ICONE): string | null {
  if (typeof cru !== "string" || cru.length > maximo) return null
  return ICONE_VALIDO.test(cru) ? cru : null
}

/**
 * What arrives from the renderer is text that someone else wrote.
 *
 * It comes from a process without Node and without network, but the body of a
 * notice is, by design, a message from someone else, so it is trimmed here,
 * not where it was composed. Line breaks are dropped: a body with fifty lines
 * pushes everything else out of the system notification center.
 */
export function sanearAviso(cru: unknown): Aviso | null {
  if (typeof cru !== "object" || cru === null) return null
  const campo = (nome: string): string => {
    const valor = (cru as Record<string, unknown>)[nome]
    return typeof valor === "string" ? valor.replace(/\s+/g, " ").trim().slice(0, MAX_TEXTO) : ""
  }
  const id = campo("id")
  const title = campo("title")
  const body = campo("body")
  if (!id || !title) return null
  const canal = (cru as Record<string, unknown>)["channel"]
  return {
    id,
    title,
    body,
    channel: typeof canal === "string" && canal ? canal.slice(0, MAX_TEXTO) : null,
    countable: (cru as Record<string, unknown>)["countable"] === true,
    icon: sanearIcone((cru as Record<string, unknown>)["icon"]),
    expiraEmMs: sanearPrazo((cru as Record<string, unknown>)["expiraEmMs"]),
  }
}

export interface FactosDaEntrega {
  cofreAberto: boolean
  /** The system can show notifications (`Notification.isSupported()`). */
  suportado: boolean
  /** The window is visible and has focus. */
  aFrente: boolean
  /** The notice can be counted (`Aviso.countable`). */
  contavel: boolean
}

/**
 * Whether the notice shows and whether it counts in the taskbar icon.
 *
 * The foreground window was once a refusal here. It stopped being one (point 6,
 * November 2, 2026): anyone reading a conversation needs to know when a
 * message arrives in another one. The only conversation the foreground window
 * silences is the one being read, and only the screen knows that
 * (`systemNoticeVerdictOf`, in `@enclave/ui`).
 *
 * What the foreground window still changes is the count. With someone watching,
 * a number in the taskbar would stay lit until they switched windows and came
 * back, for something they already saw.
 */
export function entregaDoAviso(factos: FactosDaEntrega): { recusa: Recusa; contar: boolean } {
  if (!factos.cofreAberto) return { recusa: "cofre-fechado", contar: false }
  if (!factos.suportado) return { recusa: "sem-suporte", contar: false }
  return { recusa: null, contar: factos.contavel && !factos.aFrente }
}
