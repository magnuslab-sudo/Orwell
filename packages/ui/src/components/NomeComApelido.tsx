import { NomeDePessoa } from "./NomeDePessoa.js"

/**
 * A person's name, with the channel surname in front when they have one (phase 3).
 *
 * The surname is what you read first; the account name comes next, more faded,
 * so you always know who it is underneath. Without a surname, it is the name and
 * nothing else, as it has always been. Used in the members list and in messages,
 * for both places to say the same thing the same way.
 */
export function NomeComApelido({
  nome,
  apelido,
  endereco,
}: {
  nome: string
  apelido?: string | undefined
  /** The account, for the name derived from the address to come out discreet (`NomeDePessoa`). */
  endereco?: string | undefined
}): React.JSX.Element {
  if (!apelido) return <NomeDePessoa nome={nome} endereco={endereco} />
  return (
    <>
      <span className="apelido">{apelido}</span>{" "}
      <span className="nome-sob-apelido">
        <NomeDePessoa nome={nome} endereco={endereco} />
      </span>
    </>
  )
}
