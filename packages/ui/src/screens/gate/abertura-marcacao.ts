import { MARCA_CHEIA } from "../../marca.gen.js"

/**
 * The opening in data and in HTML, without React and without the DOM.
 *
 * Two draw the same screen: the `Splash` (React) and `apps/web/index.html`, which brings it already written for the first draw to come out with the mark, the ring and the text, without waiting for the two megabytes of the bundle. The `apps/web/abertura-no-html.ts` plugin writes the HTML at build time with this function; `Splash.test.tsx` ties the two markups to each other, character by character. If they diverged, swapping the HTML for React would be a jump.
 *
 * This module only imports `marca.gen.ts`, and must stay that way: it runs inside the Vite config, in Node.
 */

/**
 * Which line of the O each banner is on, from top (0) to bottom.
 *
 * Banners light up line by line, and the two halves of a line light up together. The line comes from the height of each path (the `y` of the first `M`), not from the order in the file: the generator can reorder without breaking the animation.
 */
export const LINHA_DA_TARJA: ReadonlyMap<string, number> = (() => {
  const alturaDe = (d: string): number => Number(/^M[\d.-]+[ ,]([\d.-]+)/.exec(d)?.[1] ?? 0)
  const alturas = [...new Set(MARCA_CHEIA.map(alturaDe))].sort((a, b) => a - b)
  return new Map(MARCA_CHEIA.map((d) => [d, alturas.indexOf(alturaDe(d))]))
})()

/** The opening text in one language, for the HTML that does not yet know which one. */
export interface TextoNaLingua {
  readonly lingua: string
  readonly texto: string
}

/**
 * The exact markup that `Splash` draws, minus the emergency exit.
 *
 * With one text, it is character by character `renderToStaticMarkup(<Splash />)`. With several (the `index.html`, which is written before we know the language), each goes in a `<span lang>`, and the stylesheet that the plugin writes hides the ones that are not on the page. The `lingua-cedo.ts` marks the `<html lang>` before the browser reaches the `<body>`, so the first draw already comes out right.
 */
export function aberturaEmHtml(texto: string | readonly TextoNaLingua[]): string {
  const tarjas = MARCA_CHEIA.map((d) => `<path d="${escapar(d)}" style="--linha:${LINHA_DA_TARJA.get(d) ?? 0}"></path>`).join("")
  const dito =
    typeof texto === "string"
      ? escapar(texto)
      : texto.map((t) => `<span lang="${escapar(t.lingua)}">${escapar(t.texto)}</span>`).join("")
  return (
    '<div class="gate"><div class="abertura">' +
    '<div class="abertura-sinal" aria-hidden="true">' +
    '<span class="abertura-anel"></span>' +
    `<svg class="abertura-marca" viewBox="0 0 24 24" fill="currentColor" focusable="false">${tarjas}</svg>` +
    "</div>" +
    `<p class="abertura-texto">${dito}</p>` +
    "</div></div>"
  )
}

/** Only the texts of each `<span lang>` that are not in the page language. */
export function folhaDasLinguas(linguas: readonly string[]): string {
  const minhas = linguas.map((l) => `html[lang="${l}"] .abertura-texto>[lang="${l}"]`).join(",")
  return `.abertura-texto>[lang]{display:none}${minhas}{display:inline}`
}

function escapar(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
