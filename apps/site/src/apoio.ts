/**
 * The meter for the "Support" section: how much the GoFundMe campaign has raised.
 *
 * Request from the owner on 3 November 2026. Visitors never make a request to
 * GoFundMe: our server reads the campaign at 15 em 15 minutos and serves the amount
 * in `/_enclave/apoiar.json`, from this origin (`apps/server/src/apoio.ts`). This
 * script only fetches that JSON (`connect-src 'self'` in CSP), with no cookies.
 *
 * The bar measures against the first goal (2 200 €). When the amount passes the
 * first goal, the bar measures against the total goal (10 000 €).
 *
 * The bar's place already comes in the HTML, empty and hidden, with the height reserved
 * in the stylesheet: when the numbers arrive, nothing on the page jumps. Without the
 * JSON, or if it fails, the place stays hidden and the section looks the same as before:
 * the text and button, with no error.
 *
 * The fill animates when the bar enters the screen. With reduced motion it animates
 * more slowly and does not stop (owner's rule; see `estilo.css`).
 */

export const ENDERECO_DO_APOIO = "/_enclave/apoiar.json"

/**
 * SWITCHED OFF since November 9, 2026, to be confirmed by the owner.
 *
 * The page moved to ask for donations only through Ko-fi, and GoFundMe left the
 * top banner and the "Support" section. This meter reads the GoFundMe campaign:
 * next to a Ko-fi button, it showed a value that does not count what people give
 * through Ko-fi. So the script does not request the JSON, and the meter's spot
 * comes with `hidden` in the HTML. The code stays, tested, for when there is a
 * correct value to show. To switch it on: `true` here and remove `hidden` from
 * both pages.
 */
export const MEDIDOR_LIGADO = false

export interface Apoio {
  angariado: number
  meta: number
  metaTotal: number
  doacoes: number
  moeda: string
  lidoEm: string
}

export type Lingua = "en" | "pt"

/** The language of `<html lang>`: "pt-PT" and "pt" become "pt"; everything else is "en". */
export function linguaDe(lang: string): Lingua {
  return /^pt\b/i.test(lang) ? "pt" : "en"
}

/** The JSON, if it is a support value that can be displayed. Anything else gives `undefined`. */
export function validarApoio(dados: unknown): Apoio | undefined {
  if (typeof dados !== "object" || dados === null) return undefined
  const { angariado, meta, metaTotal, doacoes, moeda, lidoEm } = dados as Record<string, unknown>
  const numero = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0
  if (!numero(angariado) || !numero(meta) || !numero(metaTotal) || !numero(doacoes)) return undefined
  if (meta <= 0 || metaTotal < meta || !Number.isInteger(doacoes)) return undefined
  // The text writes the euro symbol: any other currency does not show.
  if (moeda !== "EUR" || typeof lidoEm !== "string") return undefined
  return { angariado, meta, metaTotal, doacoes, moeda, lidoEm }
}

/** The goal against which the bar measures, and how much of it is filled (0 to 1). */
export function medir(apoio: Apoio): { alvo: number; fraccao: number } {
  const alvo = apoio.angariado >= apoio.meta ? apoio.metaTotal : apoio.meta
  return { alvo, fraccao: Math.min(1, apoio.angariado / alvo) }
}

/** An integer value with the thousands separator for the language. */
function agrupar(valor: number, separador: string): string {
  return String(Math.floor(valor)).replace(/\B(?=(\d{3})+(?!\d))/g, separador)
}

/** "€120 raised of €2,200 · 4 donations", or "120 € angariados de 2 200 € · 4 doações". */
export function textoDoApoio(apoio: Apoio, lingua: Lingua): string {
  const { alvo } = medir(apoio)
  if (lingua === "en") {
    const euros = (n: number) => `€${agrupar(n, ",")}`
    const doacoes = `${agrupar(apoio.doacoes, ",")} ${apoio.doacoes === 1 ? "donation" : "donations"}`
    return `${euros(apoio.angariado)} raised of ${euros(alvo)} · ${doacoes}`
  }
  // Non-breaking space in thousands and before the symbol: "2 200 €" does not wrap.
  const euros = (n: number) => `${agrupar(n, " ")} €`
  const doacoes = `${agrupar(apoio.doacoes, " ")} ${apoio.doacoes === 1 ? "doação" : "doações"}`
  return `${euros(apoio.angariado)} angariados de ${euros(alvo)} · ${doacoes}`
}

/**
 * The width of the fill, as a percentage. A value above zero shows at least one
 * stroke: €5 of €2,200 would be 0.2%, which is not visible.
 */
export function larguraDoEnchimento(fraccao: number): string {
  const percentagem = fraccao > 0 ? Math.max(fraccao * 100, 1.5) : 0
  return `${Math.round(percentagem * 100) / 100}%`
}

/** Shows the meter with this support. The fill animates when the bar enters the viewport. */
export function mostrarApoio(medidor: HTMLElement, apoio: Apoio, lingua: Lingua): void {
  const numeros = medidor.querySelector<HTMLElement>(".apoio-numeros")
  const enchimento = medidor.querySelector<HTMLElement>(".apoio-enchimento")
  if (!numeros || !enchimento) return
  numeros.textContent = textoDoApoio(apoio, lingua)
  medidor.dataset.estado = "pronto"

  // Via CSSOM, not a `style` attribute: the CSP (`style-src 'self'`) refuses the
  // attribute, but allows this.
  const encher = () => enchimento.style.setProperty("width", larguraDoEnchimento(medir(apoio).fraccao))
  if (typeof IntersectionObserver === "undefined") return encher()
  const observador = new IntersectionObserver((entradas) => {
    if (!entradas.some((entrada) => entrada.isIntersecting)) return
    observador.disconnect()
    encher()
  })
  observador.observe(medidor)
}

/** Requests the JSON and shows the meter. Any failure leaves the section as it was. */
export async function carregarApoio(medidor: HTMLElement, lingua: Lingua, pedir: typeof fetch = fetch): Promise<boolean> {
  try {
    const resposta = await pedir(ENDERECO_DO_APOIO, { credentials: "omit", headers: { accept: "application/json" } })
    if (!resposta.ok) return false
    const apoio = validarApoio(await resposta.json())
    if (!apoio) return false
    mostrarApoio(medidor, apoio, lingua)
    return true
  } catch {
    return false
  }
}

if (MEDIDOR_LIGADO && typeof document !== "undefined" && typeof fetch !== "undefined") {
  const medidor = document.getElementById("apoio-medidor")
  if (medidor) void carregarApoio(medidor, linguaDe(document.documentElement.lang))
}
