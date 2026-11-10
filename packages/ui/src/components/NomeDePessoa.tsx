import { vemDoEndereco } from "../lib/format.js"
import { strings } from "../strings.js"

/**
 * A person's name, already resolved, drawn according to its origin.
 *
 * A chosen name comes out as is. A name derived from the address (`nomeEmFalta`)
 * comes out in italics and in secondary color, with the title "From the address",
 * so no one reads it as a name the person chose. Owner order of November 4, 2026.
 *
 * Only the drawing changes: the text is the same, and so sentences, `aria-label`
 * and system notices continue to use `nameFor` directly.
 */
export function NomeDePessoa({
  nome,
  endereco,
}: {
  nome: string
  /** The account whose name this is. Without it you cannot know the origin, and it comes out as a chosen name. */
  endereco?: string | null | undefined
}): React.JSX.Element {
  if (!vemDoEndereco(nome, endereco)) return <>{nome}</>
  return (
    <span className="nome-do-endereco" title={strings.profile.nomeDoEndereco}>
      {nome}
    </span>
  )
}
