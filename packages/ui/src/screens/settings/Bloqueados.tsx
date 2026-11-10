import { Button } from "../../components/Button.js"
import { formatStamp, nomeEmFalta } from "../../lib/format.js"
import { strings } from "../../strings.js"
import { NomeDePessoa } from "../../components/NomeDePessoa.js"

/**
 * Who is blocked on this device, and the "Unblock" action for each.
 *
 * The list comes from above (`useAmizade`), which is what blocks and re-reads the bridge
 * after each action: a second read here would be a second copy of the same state,
 * and the two would diverge on the first failure.
 *
 * The note explains the limit that cannot be inferred from the label: the list lives in this
 * device's vault, and another device on the same account does not know about it.
 */
export function Bloqueados({
  lista,
  nomeDe,
  onDesbloquear,
}: {
  lista: readonly { address: string; at: number }[]
  nomeDe?: ((address: string) => string) | undefined
  onDesbloquear: (address: string) => void
}): React.JSX.Element {
  return (
    <section className="card settings-card bloqueados">
      <h2>{strings.settings.blocked}</h2>
      <p className="field-note">{strings.settings.blockedNote}</p>
      {lista.length === 0 ? (
        <p className="field-note">{strings.settings.blockedEmpty}</p>
      ) : (
        <ul className="arquivados-lista">
          {lista.map(({ address, at }) => (
            <li key={address} className="arquivado">
              <div className="arquivado-linha">
                <span className="arquivado-nome" title={address}>
                  <NomeDePessoa nome={nomeDe?.(address) || nomeEmFalta(address)} endereco={address} />
                  <span className="field-note"> · {strings.settings.blockedSince(formatStamp(at))}</span>
                </span>
                <Button variant="ghost" type="button" onClick={() => onDesbloquear(address)}>
                  {strings.people.unblock}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
