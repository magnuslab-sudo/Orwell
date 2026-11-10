import { useContext } from "react"
import { copiarTexto } from "../lib/copiar.js"
import { CopyIcon } from "../icons.js"
import { strings } from "../strings.js"
import { ToastContext } from "./Toast.js"

/**
 * The small button that copies a person's id, next to their name.
 *
 * Order from the owner to 27 October 2026: "I don't want ids exposed". The
 * address (`@palavra-palavra-palavra-palavra:servidor`) came out of the profile text, the person's page, the members
 * panel and settings. It stays what you give someone to be added, and so it doesn't
 * disappear: it's one click away, on this button, and never in sight.
 *
 * The toast reads from context, not `useToast`, which breaks without a provider:
 * this button goes into lists tested without the toast provider, and a copy
 * button cannot crash the list it's in. Without a provider, it copies anyway
 * and says nothing.
 */
export function BotaoCopiarId({
  id,
  rotulo,
  className,
}: {
  id: string
  /** What the screen reader and tooltip say: "Copy id of Ana". */
  rotulo: string
  className?: string | undefined
}): React.JSX.Element {
  const toast = useContext(ToastContext)
  return (
    <button
      type="button"
      className={className ? `copiar-id ${className}` : "copiar-id"}
      aria-label={rotulo}
      title={rotulo}
      onClick={(event) => {
        // On a clickable line, the click lands here: copying does not open the person.
        event.stopPropagation()
        void copiarTexto(id)
          .then(() => toast?.(strings.copiarId.copiado))
          .catch(() => toast?.(strings.common.copyFailed, "error"))
      }}
    >
      <CopyIcon size={14} />
    </button>
  )
}
