import type { ReactNode } from "react"
import { Button } from "../../components/Button.js"
import { strings } from "../../strings.js"

/**
 * A request: an invite to a channel, or a friend request.
 *
 * In the conversation, because that is where the person is reading. An invite
 * arrives as a private message and the conversation is where they see it; making
 * them go to another screen to reply is making them discover that screen exists.
 *
 * **The same card everywhere there is a friend request**: the conversation, the
 * Pending tab, the bell, and the profile sheet. Each place had its own row with
 * its own buttons, and one of them did not have "Refuse". One card gives one
 * label only and the same two buttons.
 *
 * **What you cannot do does not appear.** Without `onAceitar` there are no buttons:
 * not grayed out, not "you already replied" pretending to be a button. What stays
 * is the status line, which says what happened and, when it applies, what still
 * needs to happen.
 */
export function PedidoCard({
  titulo,
  estado,
  ocupado = false,
  aceitar,
  aceitando,
  recusar,
  onAceitar,
  onRecusar,
  cara,
  detalhe,
  className,
}: {
  /**
   * Absent where the line next to it already says who the requester is, like at
   * the bell. Written twice, forty pixels apart, was the same name read twice in
   * a row.
   */
  titulo?: string | undefined
  /** A phrase saying where this is. Absent only with `titulo` also absent. */
  estado?: string | undefined
  /** A halfway response: both buttons go out of reach, not just the active one. */
  ocupado?: boolean | undefined
  aceitar: string
  /** The label of the accept button while the reply runs. */
  aceitando?: string | undefined
  recusar: string
  /** Absent when there is nothing to reply to, and then there are no buttons at all. */
  onAceitar?: (() => void) | undefined
  onRecusar?: (() => void) | undefined
  /** The face of whoever is requesting, where the card lives in a people list. */
  cara?: ReactNode
  /**
   * An extra line below the status: the address of whoever is requesting, in a
   * list. The name is what the person says about themselves; the address is who
   * they are.
   */
  detalhe?: ReactNode
  className?: string | undefined
}): React.JSX.Element {
  const texto = (
    <>
      {titulo && <p className="pedido-titulo">{titulo}</p>}
      {(titulo || estado) && <p className="pedido-estado">{ocupado ? strings.convite.aResponder : estado}</p>}
      {detalhe}
    </>
  )
  return (
    <div className={className ? `pedido-card ${className}` : "pedido-card"}>
      {cara ? (
        <div className="pedido-quem">
          {cara}
          <div className="pedido-texto">{texto}</div>
        </div>
      ) : (
        texto
      )}
      {onAceitar && (
        <div className="pedido-accoes">
          {/* Accept and refuse at the same time is a race nobody has to be able to start:
              while a reply runs, both stop. */}
          <Button variant="primary" disabled={ocupado} onClick={onAceitar}>
            {ocupado && aceitando ? aceitando : aceitar}
          </Button>
          {onRecusar && (
            <Button variant="ghost" disabled={ocupado} onClick={onRecusar}>
              {recusar}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
