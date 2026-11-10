import type { FonteCapturada } from "@enclave/client-core"

/**
 * The DJ's capture request, in the desktop app.
 *
 * In the app, the DJ's `getDisplayMedia` hits the SAME `setDisplayMediaRequestHandler`
 * as screen share, and the main process doesn't know who asked. The one who
 * answers is the interface (`usePartilhaDeEcra`), and it needs to know this
 * request is from the DJ, to:
 *
 *  - **System audio:** answer on its own with a screen, no picker. The
 *    image is thrown away right away (see `somDoDj.ts` in the core); only the
 *    `loopback` stays.
 *  - **Tab or window:** open the picker in "audio only" mode, with only
 *    windows, and save the window name for the DJ's card.
 *
 * One request at a time: the DJ marks it before `getDisplayMedia` and clears it
 * after. In the browser none of this is used: the picker is Chrome's.
 */

export interface PedidoDoDj {
  fonte: FonteCapturada
  /** The name of the window chosen in the app's picker, if there was a choice. */
  nome: string | null
}

let pendente: PedidoDoDj | null = null

/** The DJ is about to request a capture. Call right before `getDisplayMedia`. */
export function marcarPedidoDoDj(fonte: FonteCapturada): void {
  pendente = { fonte, nome: null }
}

/** The DJ's pending request, or nothing (the request is from screen share). */
export function pedidoDoDj(): PedidoDoDj | null {
  return pendente
}

/** The app's picker chose this window. */
export function nomearPedidoDoDj(nome: string): void {
  if (pendente) pendente.nome = nome
}

/** The request is done. Return it, with the name the picker gave it. */
export function largarPedidoDoDj(): PedidoDoDj | null {
  const era = pendente
  pendente = null
  return era
}

/**
 * What the desktop app tells the DJ: whether the system provides system audio.
 *
 * Registered by `usePartilhaDeEcra`, which is the one with the bridge
 * (`bridge.ecra`). Absent in the browser. Asked BEFORE the picker: opening a
 * capture that won't bring audio would turn on the recording badge for nothing.
 */
export interface AppDoDj {
  somDoSistema: () => Promise<boolean>
  /**
   * macOS already refused to record the screen, and won't ask again. Without
   * this `getDisplayMedia` would reject with `NotAllowedError`, which reads as
   * "cancelled", and the button would do nothing.
   */
  gravacaoNegada: () => Promise<boolean>
}

let app: AppDoDj | null = null

export function registarAppDoDj(novo: AppDoDj | null): void {
  app = novo
}

export function appDoDj(): AppDoDj | null {
  return app
}
