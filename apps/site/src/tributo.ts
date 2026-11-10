/**
 * The credits zone, written at build time from `embaixadores.json`.
 *
 * At build time, not in the browser: the ambassador pages run no JavaScript.
 * `vite.config.ts` replaces the markers `%TRIBUTO%` and `%TRIBUTO_LINHA%` with what
 * these functions return, just as it does with the version.
 *
 * Since November 2, 2026 the credits are a simple list of names, in the owner's order:
 * "the credits are a mix, no need for discrimination". Each name is whatever the person
 * or community wants to see written, without saying which is which or where they came from.
 *
 * Names are escaped. They come from a file the owner writes by hand, but a name with `<`
 * or `&` would break the page, and a name is text, never markup.
 *
 * A malformed file fails the build, with the reason. Silently ignoring it would publish
 * an empty zone, and no one would notice until an ambassador asks where their name is.
 */
export type Lingua = "pt" | "en"

export const FRASE_DO_VAZIO = "Os primeiros nomes ficam aqui."

/**
 * The credit phrases in the two site languages (English first since November 3, 2026).
 * Names are not translated: they are what each person wanted to see written. The language
 * comes from the `<html lang>` of the page (`vite.config.ts`).
 */
const FRASES: Record<Lingua, { vazio: string; linha: string }> = {
  pt: { vazio: FRASE_DO_VAZIO, linha: "Já testam connosco:" },
  en: { vazio: "The first names go here.", linha: "Already testing with us:" },
}

function escapar(texto: string): string {
  return texto
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

/** Reads and validates the data file. Returns the names, or fails with the reason. */
export function lerNomes(dados: unknown): string[] {
  const lista = (dados as { nomes?: unknown } | null)?.nomes
  if (!Array.isArray(lista)) throw new Error('embaixadores.json: falta a lista "nomes".')
  return lista.map((nome: unknown, i) => {
    if (typeof nome !== "string" || nome.trim() === "") {
      throw new Error(`embaixadores.json: o nome ${i + 1} tem de ser texto, e não vazio.`)
    }
    return nome.trim()
  })
}

/** The markup of the zone: the list, or the empty phrase. */
export function desenharTributo(dados: unknown, lingua: Lingua = "pt"): string {
  const nomes = lerNomes(dados)
  if (nomes.length === 0) return `<p class="tributo-vazio">${FRASES[lingua].vazio}</p>`
  return `<ul class="mural-nomes tributo">${nomes.map((nome) => `<li><strong>${escapar(nome)}</strong></li>`).join("")}</ul>`
}

/**
 * The banner on the landing page: the names in a loop, or nothing.
 *
 * Requested by the owner on November 2, 2026 (the line) and November 3 (the banner:
 * "names scroll in a loop, with more prominence and animation"). Empty shows nothing:
 * the empty phrase lives only on the app page, where the space is explained.
 *
 * The list goes TWICE on the track, so the loop has no seam: the animation
 * (`estilo.css`, `.faixa-pista`) moves halfway down the track and starts again, and at
 * that moment the second copy is exactly where the first one started. The second copy
 * gets `aria-hidden`: the screen reader reads the list once.
 *
 * The `tabindex` lets the banner be reached by keyboard. With focus on it, or with the
 * mouse over it, the banner stops (WCAG 2.2.2). The banner's name is the visible phrase.
 */
export function desenharTributoEmLinha(dados: unknown, lingua: Lingua = "pt"): string {
  const nomes = lerNomes(dados)
  if (nomes.length === 0) return ""
  const itens = nomes.map((nome) => `<li>${escapar(nome)}</li>`).join("")
  return (
    `<div class="tributo-linha">` +
    `<p class="tributo-frase" id="tributo-frase">${FRASES[lingua].linha}</p>` +
    `<div class="faixa" tabindex="0" role="group" aria-labelledby="tributo-frase">` +
    `<div class="faixa-pista">` +
    `<ul class="faixa-nomes">${itens}</ul>` +
    `<ul class="faixa-nomes" aria-hidden="true">${itens}</ul>` +
    `</div></div></div>`
  )
}
