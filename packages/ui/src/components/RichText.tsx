import { Fragment } from "react"
import { analisarFormatacao, ENDERECO_FONTE, type Pedaco } from "../lib/formatacao.js"
import { MENTION_ADDRESS } from "../lib/mentions.js"
import { Spoiler } from "./Spoiler.js"
import { NomeDePessoa } from "./NomeDePessoa.js"

/**
 * Text of a message or post, with web addresses and mentions
 * made clickable.
 *
 * Done by splitting, not HTML: the text is cut into pieces and pieces become
 * React elements. There is never a markup string to be interpreted,
 * so there's no way a message from someone else can inject anything,  * `dangerouslySetInnerHTML` would solve this in three lines and open the door
 * that the rest of the product spends all its time closing. Mentions come in the
 * same way and for the same reason.
 *
 * Opening in a new tab adds `noopener` and `noreferrer`, and both matter
 * for different reasons: without `noopener` the target page gains
 * access to this window and can swap it for another; without `noreferrer` the site can
 * tell where the person came from, and where they came from is this product.
 *
 * **The mention stores the address and shows the name now**, read when
 * this draws. Storing the name in the text would let it age: whoever
 * changed their name stayed mentioned by the old name forever. See
 * `lib/mentions.ts`.
 *
 * **All formatting comes through the SAME path**, which is why it can come at all:
 * `analisarFormatacao` returns a tree of pieces with type, and this
 * function turns it into elements. There is still no markup to be
 * interpreted. See `lib/formatacao.ts`, which says
 * why underline is not italic and how markers inside an address
 * stop counting.
 *
 * **The spoiler (`||assim||`) is the only one with state**, and that is why it is the only
 * one that is a component and not a tag: see `Spoiler.tsx`, which says
 * why masking with `visibility: hidden` is not the same as masking with
 * `opacity: 0`.
 */

/**
 * Recognizes http(s):// and www., enough for what people write.
 *
 * The grammar comes from `lib/formatacao.ts` and is not written here: both
 * files MUST agree on what is a URL, or a formatting marker would count in one
 * place and not the other. The capture group is from here, the `PEDACOS` below
 * needs it.
 */
const ENDERECOS = new RegExp(`(${ENDERECO_FONTE})`, "gi")

/**
 * URLs and mentions, in one split.
 *
 * Two chained `split` calls would partition already-partitioned chunks and the
 * order would decide the result. One expression with two groups cuts once and
 * returns both kinds interleaved, which is what the `map` after expects.
 */
// `ENDERECOS` already brings its own group; wrapping it in another gave two
// groups for the same chunk and `split` returned each URL in duplicate.
const PEDACOS = new RegExp(`${ENDERECOS.source}|(${MENTION_ADDRESS.source})`, "gi")

/** End punctuation is not part of the URL. See the usage, same reason. */
const PONTUACAO_FINAL = /[.,;:!?]+$/

/**
 * The first URL in a text, or nothing.
 *
 * Lives here, next to what renders it, so the input box recognizes exactly the
 * same URLs that the conversation makes clickable. Two separate expressions
 * would eventually disagree, and the symptom would be a link you can preview
 * but not open, or the opposite.
 */
export function primeiroEndereco(texto: string): string | null {
  ENDERECOS.lastIndex = 0
  const encontrado = ENDERECOS.exec(texto)?.[0]
  ENDERECOS.lastIndex = 0
  if (!encontrado) return null
  const limpo = encontrado.replace(PONTUACAO_FINAL, "")
  if (!limpo) return null
  return limpo.startsWith("www.") ? `https://${limpo}` : limpo
}

export function RichText({
  children,
  nameFor,
  onMention,
}: {
  children: string
  /**
   * The current name of whoever was mentioned. Without this, the mention shows
   * the address, which is ugly but still true, and is what you want in a place
   * that does not yet have a directory at hand.
   */
  nameFor?: ((address: string) => string) | undefined
  /** Click a mention. Without this the mention renders, but does not open anything. */
  onMention?: ((address: string) => void) | undefined
}): React.JSX.Element {
  return <>{desenharArvore(analisarFormatacao(children), nameFor, onMention)}</>
}

/** The formatting tree as elements. Text leaves go to the URL and mention
 * partition, which is where it all was before this existed. */
function desenharArvore(
  pedacos: Pedaco[],
  nameFor: ((address: string) => string) | undefined,
  onMention: ((address: string) => void) | undefined,
): React.ReactNode {
  return pedacos.map((pedaco, indice) => {
    if (pedaco.tipo === "codigo") {
      // Literal inside, and so does NOT go through partitioning: a URL inside a code
      // block is meant to be read, not clicked.
      return (
        <code key={indice} className="inline-code">
          {pedaco.texto}
        </code>
      )
    }
    if (pedaco.tipo === "forte") {
      return <strong key={indice}>{desenharArvore(pedaco.filhos, nameFor, onMention)}</strong>
    }
    if (pedaco.tipo === "enfase") {
      return <em key={indice}>{desenharArvore(pedaco.filhos, nameFor, onMention)}</em>
    }
    if (pedaco.tipo === "rasurado") {
      // `<s>` not `<del>`: `del` says this was removed from a document, and what
      // the person meant was "this no longer applies". These are different things and
      // screen readers announce them differently.
      return <s key={indice}>{desenharArvore(pedaco.filhos, nameFor, onMention)}</s>
    }
    if (pedaco.tipo === "spoiler") {
      return <Spoiler key={indice}>{desenharArvore(pedaco.filhos, nameFor, onMention)}</Spoiler>
    }
    return <Fragment key={indice}>{desenharTexto(pedaco.texto, nameFor, onMention)}</Fragment>
  })
}

function desenharTexto(
  children: string,
  nameFor: ((address: string) => string) | undefined,
  onMention: ((address: string) => void) | undefined,
): React.ReactNode {
  // `split` with groups also returns the separators, and groups that did not
  // participate come as `undefined`, hence the filter, not a direct `map`.
  const pedacos = children.split(PEDACOS).filter((pedaco) => pedaco !== undefined && pedaco !== "")

  return (
    <>
      {pedacos.map((pedaco, indice) => {
        MENTION_ADDRESS.lastIndex = 0
        if (MENTION_ADDRESS.test(pedaco)) {
          MENTION_ADDRESS.lastIndex = 0
          // The URL already has the at sign; the name does not. Without this distinction,
          // a place without a directory at hand would render "@@milsinda-…".
          const rotulo = nameFor ? (
            <>
              @<NomeDePessoa nome={nameFor(pedaco)} endereco={pedaco} />
            </>
          ) : (
            pedaco
          )
          // A `button` not an `a`: this does not navigate anywhere, it opens a sheet
          // inside the app. A fake link steals the right-click menu and promises an
          // address that does not exist.
          if (!onMention) {
            return (
              <span key={indice} className="mention">
                {rotulo}
              </span>
            )
          }
          return (
            <button key={indice} type="button" className="mention" onClick={() => onMention(pedaco)}>
              {rotulo}
            </button>
          )
        }
        MENTION_ADDRESS.lastIndex = 0

        if (!ENDERECOS.test(pedaco)) {
          ENDERECOS.lastIndex = 0
          return <span key={indice}>{pedaco}</span>
        }
        ENDERECOS.lastIndex = 0

        // End punctuation is not part of the URL: "see example.com." ends the sentence,
        // not the domain.
        const limpo = pedaco.replace(PONTUACAO_FINAL, "")
        const sobra = pedaco.slice(limpo.length)
        const href = limpo.startsWith("www.") ? `https://${limpo}` : limpo

        return (
          <span key={indice}>
            <a href={href} target="_blank" rel="noopener noreferrer" className="linkified">
              {limpo}
            </a>
            {sobra}
          </span>
        )
      })}
    </>
  )
}
