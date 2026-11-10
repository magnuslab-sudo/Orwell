import { useCallback, useEffect, useRef } from "react"

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Which dialogs are open, from oldest to newest.
 *
 * It exists because of Escape. Each dialog listens for the key on the DOCUMENT,
 * and two listeners registered on the same node both fire: `stopPropagation`
 * stops the climb up the tree but not a sibling, for that you would need
 * `stopImmediatePropagation`, and even that would not work, because whoever
 * fires first is whoever registered first, which is always the one below. A key
 * would close the sheet on top AND the one below.
 *
 * A stack solves it by asking the right question: do I respond? Only the last
 * one to open. The one below stays exactly where it was, which is where the
 * person wants to return after closing the top one.
 *
 * A module and not a React context because the problem is not one of tree: two
 * sibling dialogs, mounted by different screens, compete for the SAME key on
 * the same document. Who is on top is a matter of time, not nesting.
 */
const abertos: symbol[] = []

/**
 * The one dialog primitive: overlay plus card, with the behavior every modal
 * owes its user, focus moves inside on open, Tab cycles within, Escape and a
 * click on the backdrop close it, and focus returns to whatever opened it.
 *
 * `confirmDiscard` guards only the accidental exits (Escape, click-outside):
 * when it returns false the dialog stays. Explicit close buttons call `onClose`
 * directly and are never guarded, pressing "Fechar" is not an accident. The
 * guard can respond with a promise: that is what lets you ask with the home
 * "Confirmar", which does not block like `window.confirm` did.
 *
 * `role` is "alertdialog" only in "Confirmar": a question that interrupts and
 * asks for an answer, and the screen reader reads it right away, with the body
 * (`describedBy`).
 *
 * When `onSubmit` is given the card renders as a `<form>`, so Enter submits.
 *
 * Stacked, only the top one listens for Escape. See `abertos`.
 */
export function Modal({
  className,
  labelledBy,
  onClose,
  confirmDiscard,
  onSubmit,
  role = "dialog",
  describedBy,
  children,
}: {
  /** The card's class, verbatim: "sheet", "sheet narrow", "prompt", … */
  className: string
  /** id of the heading that names this dialog. */
  labelledBy: string
  onClose: () => void
  confirmDiscard?: () => boolean | Promise<boolean>
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void
  role?: "dialog" | "alertdialog"
  /** ID of the text that explains the dialog. */
  describedBy?: string
  children: React.ReactNode
}): React.JSX.Element {
  const card = useRef<HTMLElement | null>(null)
  const closeRef = useRef(onClose)
  const discardRef = useRef(confirmDiscard)
  closeRef.current = onClose
  discardRef.current = confirmDiscard
  /** This dialog's identity in the stack. One per instance, and only one. */
  const eu = useRef<symbol | null>(null)
  eu.current ??= Symbol("modal")

  /** There is a "discard?" question waiting for an answer. Two clicks on the backdrop do not make two. */
  const pergunta = useRef(false)
  const requestClose = useCallback((): void => {
    const guard = discardRef.current
    if (!guard) return closeRef.current()
    if (pergunta.current) return
    const resposta = guard()
    if (typeof resposta === "boolean") {
      if (resposta) closeRef.current()
      return
    }
    pergunta.current = true
    void resposta
      .then((sim) => {
        if (sim) closeRef.current()
      })
      // Without a confirmation provider the question is rejected: everything stays as it is.
      .catch(() => {})
      .finally(() => {
        pergunta.current = false
      })
  }, [])

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const node = card.current
    const first = node?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? node)?.focus()

    const identidade = eu.current as symbol
    abertos.push(identidade)

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        // Only the top one. See `abertos`: the key reaches all open dialogs at the same
        // time, and without this it would close them all at once.
        if (abertos[abertos.length - 1] !== identidade) return
        // An open menu INSIDE the dialog (the "⋯" of the profile sheet) closes first. Without
        // this, the key closed the entire sheet below it.
        if (event.target instanceof Element && event.target.closest('[role="menu"]')) return
        event.stopPropagation()
        requestClose()
        return
      }
      if (event.key !== "Tab" || !card.current) return
      // Also only the top one: the one below pulled focus to itself and the top one
      // returned it to the first button, and Tab got stuck on "Cancelar".
      if (abertos[abertos.length - 1] !== identidade) return
      const focusable = [...card.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (focusable.length === 0) {
        event.preventDefault()
        card.current.focus()
        return
      }
      const firstItem = focusable[0] as HTMLElement
      const lastItem = focusable[focusable.length - 1] as HTMLElement
      const current = document.activeElement
      if (!(current instanceof HTMLElement) || !card.current.contains(current)) {
        event.preventDefault()
        firstItem.focus()
        return
      }
      if (event.shiftKey && current === firstItem) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && current === lastItem) {
        event.preventDefault()
        firstItem.focus()
      }
    }

    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("keydown", onKey)
      const onde = abertos.indexOf(identidade)
      if (onde >= 0) abertos.splice(onde, 1)
      opener?.focus()
    }
  }, [requestClose])

  const stop = (event: React.MouseEvent): void => event.stopPropagation()

  return (
    <div className="overlay" onMouseDown={requestClose}>
      {onSubmit ? (
        <form
          ref={(element) => {
            card.current = element
          }}
          className={className}
          role={role}
          aria-modal="true"
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          tabIndex={-1}
          onMouseDown={stop}
          onSubmit={onSubmit}
        >
          {children}
        </form>
      ) : (
        <div
          ref={(element) => {
            card.current = element
          }}
          className={className}
          role={role}
          aria-modal="true"
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          tabIndex={-1}
          onMouseDown={stop}
        >
          {children}
        </div>
      )}
    </div>
  )
}
