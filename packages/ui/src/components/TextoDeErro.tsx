import { CODIGO_DESCONHECIDO } from "../lib/codigosDeErro.js"

/**
 * An error on screen is two lines: the code ("Error 104") and the message.
 *
 * The text arrives with the line break already in it (see `translateError`).
 * Here we only bold the code, and only when the first line IS a code. A catalog
 * warning that takes two screen lines does not get bold in the middle of the
 * sentence. The break stays as a text node, not as `<br>`, so `textContent`
 * keeps saying the same as the string and CSS (`white-space: pre-line`) draws
 * it.
 *
 * "Error 900" has a third line: the message in the raw form, which the app does
 * not know. It goes smaller, below the message, so it does not mix with it. It
 * is there so it can be copied into a report.
 */
export function TextoDeErro({ texto }: { texto: string }): React.JSX.Element {
  const quebra = texto.indexOf("\n")
  const cabeca = quebra < 0 ? "" : texto.slice(0, quebra)
  const codigo = /^\S+ (\d{3})$/.exec(cabeca)?.[1]
  if (codigo === undefined) return <>{texto}</>
  const resto = texto.slice(quebra + 1)
  const segunda = resto.indexOf("\n")
  if (Number(codigo) === CODIGO_DESCONHECIDO && segunda >= 0) {
    return (
      <>
        <strong>{cabeca}</strong>
        {"\n"}
        {resto.slice(0, segunda)}
        {"\n"}
        <small className="erro-em-cru">{resto.slice(segunda + 1)}</small>
      </>
    )
  }
  return (
    <>
      <strong>{cabeca}</strong>
      {"\n"}
      {resto}
    </>
  )
}
