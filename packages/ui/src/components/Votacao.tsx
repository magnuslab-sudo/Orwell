import { strings } from "../strings.js"
import type { Apuramento, Votacao as VotacaoDados } from "../lib/votacoes.js"

/** How many names fit in a line before the rest becomes "and N more". */
const NOMES_A_MOSTRAR = 3

/**
 * A poll: the question, the options, and what each received.
 *
 * **Same card in the chat and on the wall.** Both travel in the same format,
 * optional `message` and `post` fields, and drawing them twice was a guarantee
 * they would differ someday: one marking the choice and the other not, one showing
 * who voted and the other hiding it.
 *
 * **The numbers are sums of what THIS device has**, not a total someone
 * guarantees. There is no counter anywhere: not on the server (it reads nothing),
 * not in the vault (it would have to keep it in sync). Two people with different
 * histories see different numbers without either being wrong, someone who joined
 * yesterday does not have the keys to votes from two days ago. This is forward
 * secrecy working, and republishing (see `republishPosts`) is what eases it, not
 * what erases it.
 *
 * **Who voted appears by name, and it is intentional.** The footer says votes
 * are visible; the names below each option are what make that statement true
 * instead of theoretical. In an end-to-end encrypted channel, everyone there
 * decrypts everything the channel says: hiding names from the interface would not
 * make the vote secret, it would make the interface dishonest.
 *
 * Without `onVote` there are no buttons, options stay as read-only rows. It is the
 * house rule: what you cannot use does not appear. That is what happens on an
 * older host, which cannot record a vote, and the poll keeps reading.
 */
export function Votacao({
  votacao,
  apuramento,
  nameFor,
  onVote,
}: {
  votacao: VotacaoDados
  apuramento: Apuramento
  nameFor: (address: string) => string
  /**
   * Vote for an option, or withdraw by tapping the one already chosen.
   *
   * Absent is absent: without this the card draws but you cannot vote.
   */
  onVote?: ((opcao: number) => void) | undefined
}): React.JSX.Element {
  const { porOpcao, total, minha } = apuramento

  return (
    <section className="votacao">
      {/* An `h4`, not a paragraph: in a long chat, the question is the heading of a
          block and that is how a screen reader announces it. */}
      <h4 className="votacao-pergunta">{votacao.question}</h4>

      <ul className="votacao-opcoes">
        {votacao.options.map((opcao, indice) => {
          const votantes = porOpcao[indice] ?? []
          const escolhida = minha === indice
          /* The bar is proportion of the total, not of the largest: with one option at 3
             and another at 2 out of 5 total, what you want to read is "more than
             half" not "the top choice filled the line". With no votes there is no
             bar at all, not five full bars dividing zero. */
          const parte = total > 0 ? Math.round((votantes.length / total) * 100) : 0
          const nomes = votantes.map(nameFor)
          const rotulo = escolhida ? strings.votacao.retirarVoto(opcao) : strings.votacao.votarEm(opcao)

          const conteudo = (
            <>
              <span className="votacao-barra" style={{ width: `${parte}%` }} aria-hidden="true" />
              <span className="votacao-texto">{opcao}</span>
              <span className="votacao-conta">{votantes.length}</span>
            </>
          )

          return (
            <li key={indice}>
              {onVote ? (
                <button
                  type="button"
                  className={escolhida ? "votacao-opcao escolhida" : "votacao-opcao"}
                  aria-pressed={escolhida}
                  aria-label={rotulo}
                  title={rotulo}
                  onClick={() => onVote(indice)}
                >
                  {conteudo}
                </button>
              ) : (
                <div className={escolhida ? "votacao-opcao lida escolhida" : "votacao-opcao lida"}>{conteudo}</div>
              )}

              {/* Who voted, by name. Cut at three so a poll with thirty people does not become
                  a wall, and the rest stays in the title, because the promise is
                  that votes can be seen. */}
              {nomes.length > 0 && (
                <p className="votacao-quem" title={strings.votacao.quemVotou(nomes)}>
                  {strings.votacao.quemVotou(
                    nomes.slice(0, NOMES_A_MOSTRAR),
                    Math.max(0, nomes.length - NOMES_A_MOSTRAR),
                  )}
                </p>
              )}
            </li>
          )
        })}
      </ul>

      <p className="votacao-rodape">
        <span>{total === 0 ? strings.votacao.semVotos : strings.votacao.total(total)}</span>
        <span className="sep" aria-hidden="true">
          ·
        </span>
        {/* The phrase that must be there, and is here and not only on the creation sheet:
            the voter is not the person who wrote the question. */}
        <span title={strings.votacao.votosVisiveisAjuda}>{strings.votacao.votosVisiveis}</span>
      </p>
    </section>
  )
}
