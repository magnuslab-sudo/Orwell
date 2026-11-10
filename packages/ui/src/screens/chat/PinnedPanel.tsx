import { useEffect, useRef } from "react"
import { Avatar } from "../../components/Avatar.js"
import { Button } from "../../components/Button.js"
import type { PinnedMessage, Profile } from "../../bridge.js"
import { formatRelative, formatStamp } from "../../lib/format.js"
import { strings } from "../../strings.js"
import { NomeDePessoa } from "../../components/NomeDePessoa.js"

/**
 * What is pinned in this room.
 *
 * A sheet anchored to the header button, dismissed like a menu, click outside
 * or Escape, and never modal: nothing here needs an answer.
 *
 * **The text you read can be the copy, not the message.** Whoever pins makes a
 * copy of the body and it travels with the pin, because the original message was
 * encrypted in an epoch that later arrivals do not have access to, and because
 * the channel history has a cap and dumps the oldest. Whoever HAS the original
 * reads that, that is what `corpoDe` does, and the copy is what remains for
 * those who do not have it. The footnote says this in words, because it is the
 * only thing here a person can understand more about: pinning keeps the text, it
 * does not keep the conversation.
 */
export function PinnedPanel({
  ancora,
  pins,
  directory,
  nameFor,
  podeDesafixar,
  corpoDe,
  onDesafixar,
  onAbrir,
  onClose,
}: {
  /**
   * What counts as "inside here" for the click-outside that dismisses the sheet.
   *
   * The button that opens it is OUTSIDE it, and without this the click on it was
   * a click outside: the sheet closed on `mousedown` and the `click` after opened
   * it again. The button looked broken, pressing it closed nothing. By passing in
   * the wrapper that holds both, the button becomes a toggle again.
   */
  ancora?: React.RefObject<HTMLElement | null> | undefined
  pins: PinnedMessage[]
  directory: Map<string, Profile>
  nameFor: (address: string) => string
  /** Without the pin capability, there is no button at all, no greyed out state. */
  podeDesafixar: boolean
  /**
   * The body of the original message, if this account still has it.
   *
   * Returning nothing is the normal case and not a failure: anyone who arrived
   * in the channel later will never be able to open the message, and that is
   * exactly what the copy exists for.
   */
  corpoDe: (id: string) => string | undefined
  onDesafixar: (id: string) => void
  /** Jump to the message, if it is in this person's conversation. */
  onAbrir?: ((id: string) => void) | undefined
  onClose: () => void
}): React.JSX.Element {
  const folha = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const dispensar = (event: MouseEvent): void => {
      if (!(event.target instanceof Node)) return
      const dentro = ancora?.current ?? folha.current
      if (dentro?.contains(event.target)) return
      onClose()
    }
    const teclado = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("mousedown", dispensar, true)
    window.addEventListener("keydown", teclado)
    return () => {
      window.removeEventListener("mousedown", dispensar, true)
      window.removeEventListener("keydown", teclado)
    }
  }, [onClose, ancora])

  return (
    <div ref={folha} className="pinned-panel" role="dialog" aria-label={strings.chat.pinnedTitle}>
      <header className="pinned-head">
        <h2>{strings.chat.pinnedTitle}</h2>
      </header>

      {pins.length === 0 ? (
        // Those who can pin need the empty state to show how: without it the form
        // announces a feature but does not say how to use it. Those who cannot see
        // a door that does not exist, same rule as the member panel footer.
        // `podeDesafixar` owns the pin responsibility.
        <p className="pinned-empty">{podeDesafixar ? strings.chat.pinnedEmptyCanPin : strings.chat.pinnedEmpty}</p>
      ) : (
        <ul className="pinned-list">
          {/* Most recent first: what just got pinned is what gets read next. */}
          {[...pins].reverse().map((fixada) => {
            const original = corpoDe(fixada.id)
            const corpo = original ?? fixada.body
            return (
              <li key={fixada.id} className="pinned-row">
                <Avatar profile={directory.get(fixada.sender)} fallback={fixada.sender[1] ?? "?"} />
                <div className="pinned-corpo">
                  <span className="pinned-autor">
                    <NomeDePessoa nome={nameFor(fixada.sender)} endereco={fixada.sender} />
                    <time title={formatStamp(fixada.sentAt)}>{formatRelative(fixada.sentAt)}</time>
                  </span>
                  {/* The button jumps to the message; with nowhere to jump to
                      it is just text. A button that leads nowhere
                      signals that the app is broken. */}
                  {onAbrir && original !== undefined ? (
                    <button type="button" className="pinned-texto" onClick={() => onAbrir(fixada.id)}>
                      {corpo || strings.chat.pinnedNoText}
                    </button>
                  ) : (
                    <p className="pinned-texto">{corpo || strings.chat.pinnedNoText}</p>
                  )}
                  <span className="pinned-quem">{strings.chat.pinnedBy(nameFor(fixada.pinnedBy))}</span>
                </div>
                {podeDesafixar && (
                  <Button variant="ghost" onClick={() => onDesafixar(fixada.id)}>
                    {strings.chat.messageUnpin}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <p className="pinned-note">{strings.chat.pinnedNote}</p>
    </div>
  )
}
