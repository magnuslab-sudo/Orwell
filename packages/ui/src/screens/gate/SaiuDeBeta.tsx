import { Button } from "../../components/Button.js"
import { strings } from "../../strings.js"

/**
 * The cutoff screen: "Orwell is out of beta." (1.0 "Arca", plan
 * `docs/planos/moradas-opacas-e-corte.md`, section 2, text D3 approved by the
 * owner on October 27, 2026).
 *
 * It appears in the gate, BEFORE `Unlock`, when the vault on this device is
 * from beta (no `orwv2` header). The owner's order is that 1.0 never reads an
 * old vault. That is why this screen has no password field: asking for the
 * password was inviting key derivation, and the key is not derived. For the
 * same reason there is no export (export forced decryption) and no "How it works"
 * (one more door for someone with one thing to do).
 *
 * One button only. Who fires it is the `App` (slice 5b): it deletes the old
 * vault without opening it, and opens `Setup`. This component knows nothing
 * about the bridge on purpose: that way the test proves the screen without
 * faking a vault, and the decision to delete stays in one place.
 */
export function SaiuDeBeta({ onCriarContaNova }: { onCriarContaNova: () => void }): React.JSX.Element {
  return (
    <div className="gate">
      <div className="gate-pilha">
        <div className="gate-card">
          <h1>{strings.saiuDeBeta.titulo}</h1>
          <p className="gate-lead">{strings.saiuDeBeta.texto}</p>
          <Button variant="primary" type="button" onClick={onCriarContaNova}>
            {strings.saiuDeBeta.criarContaNova}
          </Button>
        </div>
      </div>
    </div>
  )
}
