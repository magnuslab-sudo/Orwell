import { createContext, useContext, useEffect, useRef } from "react"
import { TextoDeErro } from "./TextoDeErro.js"
import { AvisosDeAmigosContext, PilhaDeAvisosDeAmigos } from "./AvisosDeAmigos.js"
import { useAvisosDeAmigos } from "../hooks/useAvisosDeAmigos.js"
import { useToasts, type AccaoDoToast, type Toast, type ToastLevel } from "../hooks/useToasts.js"
import { strings } from "../strings.js"

/**
 * How a screen raises a toast without the shell threading a callback through
 * every intermediate component. `ToastProvider` supplies `push` from `useToasts`.
 */
export type EmpurrarToast = (detail: string, level?: ToastLevel, accao?: AccaoDoToast) => void

export const ToastContext = createContext<EmpurrarToast | null>(null)

/** Remove the alerts whose text is no longer true. See `useToasts`. */
export const DispensarToastContext = createContext<((detail: string) => void) | null>(null)

/** The action that removes an alert by its text. Outside `ToastProvider`, it does nothing. */
export function useDispensarToast(): (detail: string) => void {
  return useContext(DispensarToastContext) ?? nadaADispensar
}

function nadaADispensar(): void {}

export function useToast(): EmpurrarToast {
  const push = useContext(ToastContext)
  if (!push) throw new Error("useToast must be used inside a ToastContext provider")
  return push
}

/**
 * Owns the toast queue, above the shell rather than inside it.
 *
 * The queue is the app's most frequently changing state — every send, every
 * status event touches it. Held in the shell it re-rendered the entire tree per
 * toast; held here, a toast re-renders only this component, and `children` (the
 * shell element, created by a parent that did not re-render) bails out. `push`
 * is a stable callback, so consumers of the context never re-render either.
 */
export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { toasts, push, dismiss, pausar, retomar, dispensarTexto } = useToasts()
  // Friend cards in the style of MSN live in the same corner, below the alerts: two
  // stacks in the same corner would overlap. See `AvisosDeAmigos.tsx`.
  const amigos = useAvisosDeAmigos()
  return (
    <ToastContext.Provider value={push}>
      <DispensarToastContext.Provider value={dispensarTexto}>
      <AvisosDeAmigosContext.Provider value={amigos.empurrar}>
        {children}
        <ToastHost toasts={toasts} onDismiss={dismiss} onPausar={pausar} onRetomar={retomar}>
          <PilhaDeAvisosDeAmigos
            avisos={amigos.avisos}
            onFechar={amigos.fechar}
            onPausar={amigos.pausar}
            onRetomar={amigos.retomar}
          />
        </ToastHost>
      </AvisosDeAmigosContext.Provider>
      </DispensarToastContext.Provider>
    </ToastContext.Provider>
  )
}

/**
 * The visible stack, bottom-right, newest last.
 *
 * The container is a polite live region, so info toasts are announced without
 * interrupting; each error is additionally a `role="alert"`, which is what
 * makes screen readers say it now rather than eventually.
 */
export function ToastHost({
  toasts,
  onDismiss,
  onPausar,
  onRetomar,
  children,
}: {
  toasts: Toast[]
  onDismiss: (id: number) => void
  /** Stop the alert timer. See `useToasts` and WCAG 2.2.1. */
  onPausar?: ((id: number) => void) | undefined
  onRetomar?: ((id: number) => void) | undefined
  /** What sits below the alerts in the same corner: the friend cards. */
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) =>
        toast.level === "error" ? (
          <div key={toast.id} className="toast error" role="alert">
            <p>
              <TextoDeErro texto={toast.detail} />
            </p>
            <button
              className="toast-dismiss"
              aria-label={strings.common.close}
              onClick={() => onDismiss(toast.id)}
            >
              ×
            </button>
          </div>
        ) : toast.accao ? (
          <ToastComAccao
            key={toast.id}
            toast={toast}
            accao={toast.accao}
            onDismiss={onDismiss}
            onPausar={onPausar}
            onRetomar={onRetomar}
          />
        ) : (
          <div key={toast.id} className="toast">
            <p>{toast.detail}</p>
          </div>
        ),
      )}
      {children}
    </div>
  )
}

/**
 * An alert with an undo path ("Undo", "Show again").
 *
 * The action closes the alert before running: tapping twice does not undo twice.
 * The "×" stays, because an alert that lasts ten seconds must be dismissible by
 * keyboard without undoing anything.
 *
 * The timer pauses when the mouse hovers OR focus enters the alert, and resumes
 * only when both leave. Checking one is not enough: a user who reaches the button
 * by Tab and then moves the mouse away has not left the alert. Focus is checked
 * via `relatedTarget`, because moving from "Undo" to "×" is a `blur` followed by
 * a `focus` within the same alert, which is not leaving.
 */
function ToastComAccao({
  toast,
  accao,
  onDismiss,
  onPausar,
  onRetomar,
}: {
  toast: Toast
  accao: AccaoDoToast
  onDismiss: (id: number) => void
  onPausar?: ((id: number) => void) | undefined
  onRetomar?: ((id: number) => void) | undefined
}): React.JSX.Element {
  const dentro = useRef({ rato: false, foco: false })
  const caixa = useRef<HTMLDivElement>(null)
  const mudar = (qual: "rato" | "foco", agora: boolean): void => {
    const antes = dentro.current.rato || dentro.current.foco
    dentro.current[qual] = agora
    const depois = dentro.current.rato || dentro.current.foco
    if (!antes && depois) onPausar?.(toast.id)
    if (antes && !depois) onRetomar?.(toast.id)
  }
  // The window regains focus while focus is still inside the alert: it stays paused.
  // Covers a `blur` that some browsers may miss when switching windows.
  const mudarRef = useRef(mudar)
  mudarRef.current = mudar
  useEffect(() => {
    const aoVoltar = (): void => {
      if (caixa.current?.contains(document.activeElement)) mudarRef.current("foco", true)
    }
    window.addEventListener("focus", aoVoltar)
    return () => window.removeEventListener("focus", aoVoltar)
  }, [])
  return (
    <div
      ref={caixa}
      className="toast com-accao"
      onMouseEnter={() => mudar("rato", true)}
      onMouseLeave={() => mudar("rato", false)}
      onFocus={() => mudar("foco", true)}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        // The entire window lost focus (another app, another tab): the user did not leave
        // the alert, and it cannot dismiss while they are not looking.
        if (!document.hasFocus()) return
        mudar("foco", false)
      }}
    >
      <p>{toast.detail}</p>
      <button
        type="button"
        className="toast-accao"
        onClick={() => {
          onDismiss(toast.id)
          accao.fazer()
        }}
      >
        {accao.rotulo}
      </button>
      <button
        type="button"
        className="toast-dismiss"
        aria-label={strings.common.close}
        onClick={() => onDismiss(toast.id)}
      >
        ×
      </button>
    </div>
  )
}
