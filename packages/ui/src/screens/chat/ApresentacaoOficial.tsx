import { useId } from "react"
import { OrwellMark } from "../../icons.js"
import { strings } from "../../strings.js"

/**
 * What you read when you enter the common channel for the first time.
 *
 * Introduction, not tutorial: it says where you are and invites you to join.
 * It doesn't explain how the product works, doesn't list guarantees, doesn't
 * teach you to click anything. Someone who reaches this screen already created
 * an account without email or phone and already read on the `gate` what that
 * means; repeating the lesson here would treat them as if they didn't read it.
 *
 * Appears once, `useApresentacao` remembers who read it on this device, and
 * takes up a stripe, not the screen. A modal covering the chat in the first
 * second of use says "read this before you exist here", which is the opposite
 * of what a shared house wants to say to someone walking in.
 */
export function ApresentacaoOficial({
  onFechar,
}: {
  onFechar: () => void
}): React.JSX.Element {
  const titulo = useId()

  return (
    <section className="apresentacao-oficial" aria-labelledby={titulo}>
      <span className="apresentacao-marca" aria-hidden="true">
        <OrwellMark size={26} />
      </span>
      <div className="apresentacao-texto">
        <h2 id={titulo}>{strings.oficial.apresentacaoTitle}</h2>
        <p>{strings.oficial.apresentacaoBody}</p>
      </div>
      {/* Close is the only action. A card with buttons competing with the compose
          box would get in the way of what people came here to do. */}
      <button
        type="button"
        className="apresentacao-fechar"
        aria-label={strings.oficial.apresentacaoFechar}
        title={strings.oficial.apresentacaoFechar}
        onClick={onFechar}
      >
        {strings.oficial.apresentacaoFechar}
      </button>
    </section>
  )
}
