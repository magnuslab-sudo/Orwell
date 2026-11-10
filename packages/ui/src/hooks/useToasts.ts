import { useCallback, useEffect, useReducer, useRef } from "react"

export type ToastLevel = "info" | "error"

/**
 * The path back from a reversible gesture: "Undo", "Show again".
 *
 * It exists so the reversible does not need confirmation. Asking before a
 * gesture that undoes teaches people to hit "yes" without reading, and wastes
 * that attention where it does not matter. You do the gesture, and the toast
 * brings it back.
 */
export interface AccaoDoToast {
  rotulo: string
  fazer: () => void
  /**
   * How long this toast stays, in milliseconds, instead of the default time
   * (`ACTION_TOAST_MS`). A friend online toast uses 2 s: it is presence, not a
   * gesture to undo (owner's call, 2 November 2026).
   */
  duracaoMs?: number
}

export interface Toast {
  id: number
  detail: string
  level: ToastLevel
  accao?: AccaoDoToast
}

/** How long an info toast stays before dismissing itself. Errors never do. */
export const INFO_TOAST_MS = 5000

/**
 * How long a toast with an action stays: twice as long.
 *
 * Five seconds are enough to read, or not read, realize you closed the wrong
 * room and get to the button. Anyone using a screen reader or keyboard needs
 * more.
 */
export const ACTION_TOAST_MS = 10000

/**
 * How many toasts may be on screen at once.
 *
 * A stack taller than this stops being a notification and becomes a wall —
 * and since errors never dismiss themselves, without a ceiling a bad minute
 * could bury the interface under its own complaints. The oldest INFO toast is
 * the one that goes: it has already been read, or it never mattered.
 */
export const MAX_TOASTS = 3

type ToastAction = { type: "push"; toast: Toast } | { type: "dismiss"; id: number }

export function toastsReducer(state: Toast[], action: ToastAction): Toast[] {
  switch (action.type) {
    case "push": {
      const next = [...state, action.toast]
      if (next.length <= MAX_TOASTS) return next
      // Drop the oldest info toast; only if there is none does an error go,
      // and then the oldest, because the newest is the one just raised.
      const victim = next.findIndex((toast) => toast.level === "info")
      return next.filter((_, index) => index !== (victim === -1 ? 0 : victim))
    }
    case "dismiss":
      return state.filter((toast) => toast.id !== action.id)
  }
}

/**
 * The clock of a toast that leaves on its own: how much time is left, and the
 * timer that is counting, if there is one.
 *
 * Stores what is LEFT, not the exit time, because pausing and resuming is the
 * normal case: someone who rests the cursor on the toast at 8 of 10 seconds and
 * leaves a minute later must have the 2 that were left, not 0 or 10 again.
 */
interface Relogio {
  restante: number
  desde: number
  timer: ReturnType<typeof setTimeout> | null
}

/**
 * The toast queue, as a reducer plus an id counter.
 *
 * Info toasts announce something that already succeeded, so they leave on their
 * own; error toasts describe something that still needs the person's attention,
 * so they stay until dismissed. `push` and `dismiss` are stable, which lets the
 * shell hand them to subscriptions registered once on mount.
 *
 * `pausar` and `retomar` exist because of WCAG 2.2.1 (adjustable time): a toast
 * with an action cannot leave from under the cursor or keyboard focus while the
 * person is going to the button. The toast pauses while someone is over it and
 * resumes, with the time that was left, when they leave.
 */
export function useToasts(): {
  toasts: Toast[]
  push: (detail: string, level?: ToastLevel, accao?: AccaoDoToast) => void
  dismiss: (id: number) => void
  pausar: (id: number) => void
  retomar: (id: number) => void
  dispensarTexto: (detail: string) => void
} {
  const [toasts, dispatch] = useReducer(toastsReducer, [])
  // Mirrored in a ref so `dispensarTexto` is stable and sees the current stack.
  const toastsRef = useRef(toasts)
  toastsRef.current = toasts
  const counter = useRef(0)
  const relogios = useRef<Map<number, Relogio>>(new Map())

  const dismiss = useCallback((id: number) => {
    const relogio = relogios.current.get(id)
    if (relogio?.timer) clearTimeout(relogio.timer)
    relogios.current.delete(id)
    dispatch({ type: "dismiss", id })
  }, [])

  const armar = useCallback((id: number, relogio: Relogio) => {
    relogio.desde = Date.now()
    relogio.timer = setTimeout(() => {
      relogios.current.delete(id)
      dispatch({ type: "dismiss", id })
    }, relogio.restante)
  }, [])

  const push = useCallback(
    (detail: string, level: ToastLevel = "info", accao?: AccaoDoToast) => {
      const id = ++counter.current
      dispatch({ type: "push", toast: { id, detail, level, ...(accao ? { accao } : {}) } })
      if (level !== "info") return
      const restante = accao?.duracaoMs ?? (accao ? ACTION_TOAST_MS : INFO_TOAST_MS)
      const relogio: Relogio = { restante, desde: 0, timer: null }
      relogios.current.set(id, relogio)
      armar(id, relogio)
    },
    [armar],
  )

  const pausar = useCallback((id: number) => {
    const relogio = relogios.current.get(id)
    // An error has no clock, and a toast already paused does not pause twice.
    if (!relogio?.timer) return
    clearTimeout(relogio.timer)
    relogio.timer = null
    relogio.restante = Math.max(0, relogio.restante - (Date.now() - relogio.desde))
  }, [])

  const retomar = useCallback(
    (id: number) => {
      const relogio = relogios.current.get(id)
      if (!relogio || relogio.timer) return
      armar(id, relogio)
    },
    [armar],
  )

  // Pending auto-dismissals die with the hook, not after it.
  useEffect(() => {
    const pendentes = relogios.current
    return () => {
      for (const relogio of pendentes.values()) if (relogio.timer) clearTimeout(relogio.timer)
    }
  }, [])

  /**
   * Remove the alerts with this text: an alert that is no longer true (1.3.6).
   *
   * The "request sent" alert sat on top of the compose bar of the direct chat
   * that opened right after, and stayed there after the request was accepted.
   * Whoever knows the sentence no longer holds removes it, instead of waiting
   * for the timer.
   */
  const dispensarTexto = useCallback(
    (detail: string) => {
      for (const toast of toastsRef.current) if (toast.detail === detail) dismiss(toast.id)
    },
    [dismiss],
  )

  return { toasts, push, dismiss, pausar, retomar, dispensarTexto }
}
