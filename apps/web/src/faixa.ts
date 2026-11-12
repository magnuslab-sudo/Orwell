/**
 * The pill at the bottom of the screen, outside the React tree.
 *
 * Outside it because it must appear also when `App` does not exist: in a
 * tab waiting, or one that never started because it is old. It serves the
 * new version ("Reload to continue") and the tab with old code writing
 * underneath (`separadores.outroEscritor`).
 *
 * Owner's choice B, 28 October 2026, among six mockups: up to now it was a smooth
 * indigo band end to end, with the system font. Now it is a pill at the
 * center, in the panels' color, with cyan outline and shine, the
 * update icon, the short phrase with the detail more faded, and the full cyan
 * button. The styles go inline and with fallback: the pill may appear before
 * the app sheet loads, and in that case uses the skin colors written here.
 */
export function mostrarFaixa(
  texto: string,
  botao?: { rotulo: string; aoCarregar: () => void },
  detalhe?: string,
): HTMLElement {
  const pilula = document.createElement("div")
  pilula.setAttribute("role", "status")
  pilula.dataset["faixa"] = "versao"
  pilula.style.cssText =
    "position:fixed;left:50%;bottom:calc(14px + env(safe-area-inset-bottom, 0px));transform:translateX(-50%);" +
    "z-index:9999;box-sizing:border-box;max-width:calc(100vw - 28px);" +
    "display:flex;gap:10px;align-items:center;padding:8px 8px 8px 14px;border-radius:999px;" +
    "background:var(--painel-tinta, rgba(12, 17, 35, 0.92));" +
    "border:1px solid color-mix(in srgb, var(--acento, #8be9fd) 30%, transparent);" +
    "box-shadow:0 10px 28px rgba(0, 0, 0, 0.45), 0 0 18px color-mix(in srgb, var(--acento, #8be9fd) 14%, transparent);" +
    "color:var(--titulo, #f1f4ff);font:500 14px/1.35 var(--fonte, system-ui, sans-serif)"

  // The update icon: two arrows in a circle, filled, in the accent color.
  const icone = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  icone.setAttribute("viewBox", "0 0 24 24")
  icone.setAttribute("aria-hidden", "true")
  icone.setAttribute("focusable", "false")
  icone.style.cssText = "flex:none;width:18px;height:18px;color:var(--acento, #8be9fd)"
  const caminho = document.createElementNS("http://www.w3.org/2000/svg", "path")
  caminho.setAttribute("fill", "currentColor")
  caminho.setAttribute(
    "d",
    "M12 4a8 8 0 0 1 6.9 4H16v2h6V4h-2v2.3A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8zm8 8a8 8 0 0 1-14.9 4H8v-2H2v6h2v-2.3A10 10 0 0 0 22 12h-2z",
  )
  icone.append(caminho)
  pilula.append(icone)

  const frase = document.createElement("span")
  frase.style.cssText = "min-width:0"
  frase.textContent = texto
  if (detalhe) {
    const pequeno = document.createElement("small")
    pequeno.style.cssText = "display:block;font-size:12px;color:var(--apagado, #9aa6c8)"
    pequeno.textContent = detalhe
    frase.append(pequeno)
  }
  pilula.append(frase)

  if (botao) {
    const elemento = document.createElement("button")
    elemento.type = "button"
    elemento.textContent = botao.rotulo
    elemento.style.cssText =
      "flex:none;border:none;border-radius:999px;padding:6px 12px;cursor:pointer;" +
      "background:var(--acento, #8be9fd);color:var(--tinta, #080c1a);font:600 13px var(--fonte, system-ui, sans-serif)"
    elemento.onclick = botao.aoCarregar
    pilula.append(elemento)
  }
  document.body.appendChild(pilula)
  return pilula
}
