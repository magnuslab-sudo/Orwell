import { useId } from "react"
import { CopyIcon, LinkIcon, PersonAddIcon } from "../../icons.js"
import { strings } from "../../strings.js"

/**
 * The first screen after creating an account: how to reach someone.
 *
 * There is no people search here and no phone contact list, on purpose. So
 * someone who just created an account would end up in a public room or an empty
 * screen with nothing saying what comes next. There are three steps, and only
 * these: share your address, request friendship from an address, or join via an
 * invite link. Each button leads to an existing flow; the card has no flow of
 * its own.
 *
 * Closes by hand, or disappears on its own with the first friend or channel.
 * See `usePrimeirosPassos`.
 */
export function PrimeirosPassos({
  onCopiarEndereco,
  onAdicionarAmigo,
  onEntrarComLink,
  onFechar,
}: {
  onCopiarEndereco: () => void
  onAdicionarAmigo: () => void
  onEntrarComLink: () => void
  onFechar: () => void
}): React.JSX.Element {
  const titulo = useId()
  return (
    <section className="primeiros-passos" aria-labelledby={titulo}>
      <div className="primeiros-passos-texto">
        <h2 id={titulo}>{strings.primeirosPassos.titulo}</h2>
        <p>{strings.primeirosPassos.corpo}</p>
      </div>
      <div className="primeiros-passos-accoes">
        <button type="button" onClick={onCopiarEndereco}>
          <CopyIcon size={15} />
          {strings.primeirosPassos.copiar}
        </button>
        <button type="button" onClick={onAdicionarAmigo}>
          <PersonAddIcon size={15} />
          {strings.primeirosPassos.amigo}
        </button>
        <button type="button" onClick={onEntrarComLink}>
          <LinkIcon size={15} />
          {strings.primeirosPassos.link}
        </button>
      </div>
      <button
        type="button"
        className="primeiros-passos-fechar"
        aria-label={strings.primeirosPassos.fechar}
        title={strings.primeirosPassos.fechar}
        onClick={onFechar}
      >
        ×
      </button>
    </section>
  )
}
