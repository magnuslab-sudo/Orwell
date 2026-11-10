import { Button } from "../../components/Button.js"
import { OrwellWordmark } from "../../components/Logo.js"
import { strings } from "../../strings.js"

/**
 * The screen for a tab that is not the owner of the account.
 *
 * Only the web shows it: `apps/web/src/main.tsx` draws it instead of the
 * application when another tab in the same browser already has the vault lock.
 * This tab does not open the vault or connect to the server. See
 * `apps/web/src/posse-do-separador.ts`, which explains why two owners broke a
 * room.
 *
 * It stays intentionally outside the `App`: the `App` starts the gate, and the
 * gate reads the vault. A waiting tab cannot touch it.
 */
export function OutroSeparador({
  aPedir,
  semResposta = false,
  temConvite = false,
  temEmparelhamento = false,
  onUsar,
  onForcar = onUsar,
}: {
  /** The person already tapped the button and the request is in flight to the other tab. */
  aPedir: boolean
  /**
   * The timeout passed with no response: the other tab may be frozen. Taking
   * ownership by force requires a second tap, stated in full.
   */
  semResposta?: boolean
  /**
   * The page opened with an invite or pairing link, stored in this tab. It
   * only opens here, and only after this tab takes over: it is stated, so the
   * person does not go looking for it on the other one.
   */
  temConvite?: boolean
  temEmparelhamento?: boolean
  onUsar: () => void
  onForcar?: () => void
}): React.JSX.Element {
  return (
    <div className="gate">
      <div className="gate-card outro-separador">
        <h1>
          <OrwellWordmark size={30} />
        </h1>
        <p className="gate-lead">{strings.separadores.titulo}</p>
        <p>{strings.separadores.texto}</p>
        {temConvite && <p role="status">{strings.separadores.temConvite}</p>}
        {temEmparelhamento && <p role="status">{strings.separadores.temEmparelhamento}</p>}
        {semResposta ? (
          <>
            <p role="alert">{strings.separadores.semResposta}</p>
            <Button variant="primary" onClick={onForcar}>
              {strings.separadores.forcar}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onUsar} disabled={aPedir}>
            {aPedir ? strings.separadores.aPedir : strings.separadores.usar}
          </Button>
        )}
        <p className="field-note">{strings.separadores.nota}</p>
      </div>
    </div>
  )
}
