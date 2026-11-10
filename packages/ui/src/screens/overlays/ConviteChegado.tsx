import { useId } from "react"
import { Button } from "../../components/Button.js"
import { Modal } from "../../components/Modal.js"
import {
  canalDoConviteParaMostrar,
  quemConvidaParaMostrar,
  servidorParaMostrar,
  type DestinoDoConvite,
  type NomeDoConvite,
} from "../../lib/conviteDeArranque.js"
import { strings } from "../../strings.js"

/**
 * The prompt an invite link shows before doing anything.
 *
 * A click on a link cannot add someone's account to a channel: joining shows
 * their address to those in it, and a link is something that arrives from
 * anywhere. That is why this prompts, and closing the window (Esc, click
 * outside) counts the same as "Not now".
 *
 * **The channel name is text from whoever sent the link, and is not verified.**
 * The join request only carries the fingerprint of the code, so anyone with a
 * real invite to a channel can write it a different name. Two consequences
 * here: what shows goes through `canalParaMostrar` (no direction marks, no
 * controls, with a cap), and the phrase says "the link says", not "you were
 * invited to".
 *
 * **The name comes from the seal** (1.0 "Arca", slice 5c): with opaque
 * addresses, the address says nothing, and the name only comes from the seal
 * that whoever made the invite encrypted with the code. Without a seal that
 * opens, the prompt says "a channel", never the address. See
 * `canalDoConviteParaMostrar`.
 *
 * The destination arrives already decided. An invite from another server never
 * shows "Join": offering a button that only serves to error was making the
 * person press to find out what was already known when the window opened.
 */
export function ConviteChegado({
  destino,
  nome = null,
  onAccept,
  onDecline,
}: {
  destino: Exclude<DestinoDoConvite, { que: "ja-la-estou" }>
  /** What the invite seal said, or `null` without a seal that opens. */
  nome?: NomeDoConvite | null
  onAccept: () => void
  onDecline: () => void
}): React.JSX.Element {
  const heading = useId()

  if (destino.que === "outro-servidor") {
    return (
      <Modal className="prompt convite-chegado" labelledBy={heading} onClose={onDecline}>
        <h2 id={heading}>{strings.invite.arrivedTitle}</h2>
        <p className="convite-chegado-corpo">
          {strings.invite.otherServer(servidorParaMostrar(destino.deles), servidorParaMostrar(destino.meu))}
        </p>
        <div className="prompt-actions">
          <Button variant="primary" type="button" onClick={onDecline}>
            {strings.common.close}
          </Button>
        </div>
      </Modal>
    )
  }

  const canal = canalDoConviteParaMostrar(destino.canal, nome)
  const quem = quemConvidaParaMostrar(nome) ?? undefined
  const servidor = servidorParaMostrar(destino.servidor)

  return (
    <Modal
      className="prompt convite-chegado"
      labelledBy={heading}
      onClose={onDecline}
      onSubmit={(event) => {
        event.preventDefault()
        onAccept()
      }}
    >
      <h2 id={heading}>{strings.invite.arrivedTitle}</h2>
      <p className="convite-chegado-corpo">
        {canal === null ? strings.invite.arrivedBodyUnnamed(servidor) : strings.invite.arrivedBody(canal, servidor, quem)}
      </p>
      <p className="field-note">{strings.invite.arrivedNote}</p>
      <div className="prompt-actions">
        {/*
          "Not now" comes BEFORE "Join" in the JSX, on purpose. `Modal` puts
          focus on the first focusable on opening, and Enter on a focused button
          presses that button: a rushed Enter, given to a window nobody asked
          for, REFUSES. Swapping the order for looks would make that Enter a
          yes.
          */}
        <Button variant="ghost" type="button" onClick={onDecline}>
          {strings.invite.arrivedDecline}
        </Button>
        <Button variant="primary" type="submit">
          {strings.invite.arrivedAccept}
        </Button>
      </div>
    </Modal>
  )
}
