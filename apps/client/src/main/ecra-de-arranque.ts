/**
 * The Windows splash screen, like Discord: a small frameless window with the
 * banner illustration, the name, a line of text, and a progress bar.
 *
 * No `electron` here. This file only defines what to show (the HTML and the
 * bit of code that updates the text and bar). `index.ts` opens the window.
 * This way text can be measured in a test, without a window.
 *
 * ## Why the page has no script
 *
 * The page policy is `script-src 'none'`. The text and bar change via
 * `webContents.executeJavaScript` with a snippet written here, with text
 * passed through `JSON.stringify`. Nothing from the network enters the screen
 * except the version, and that only arrives here after passing the validator
 * (three dot-separated numbers).
 */
import type { EstadoDoEcra } from "./actualizacao-windows.js"
import { ARTE_DO_ARRANQUE, FONTE_DO_ARRANQUE, TARJAS_DO_ARRANQUE } from "./arte-do-arranque.gen.js"

/** Whole megabytes: the watcher wants to see the number move, not decimals. */
function mb(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`
}

/** The two lines and bar for each phase, in short sentences (STE100). */
export function textoDoArranque(estado: EstadoDoEcra): { titulo: string; detalhe: string; progresso: number | null } {
  switch (estado.fase) {
    case "a-procurar":
      return { titulo: "A procurar actualizações", detalhe: "", progresso: null }
    case "a-descarregar": {
      const fraccao = estado.total > 0 ? Math.min(1, estado.recebidos / estado.total) : 0
      return {
        titulo: `A descarregar a versão ${estado.versao}`,
        detalhe: `${mb(estado.recebidos)} de ${mb(estado.total)}`,
        progresso: fraccao,
      }
    }
    // Before the UAC window (installation to Program Files). No bar: the title
    // has two lines and takes its place.
    case "a-pedir-autorizacao":
      return {
        titulo: `O Windows vai pedir autorização para instalar a versão ${estado.versao}.`,
        detalhe: 'Carrega em "Sim" para continuar.',
        progresso: null,
      }
    case "a-instalar":
      return {
        titulo: `A instalar a versão ${estado.versao}`,
        detalhe: "A aplicação abre de novo quando terminar.",
        progresso: 1,
      }
  }
}

/** The code that puts a state on screen. Only our text, via `JSON.stringify`. */
export function codigoDoEstado(estado: EstadoDoEcra): string {
  const { titulo, detalhe, progresso } = textoDoArranque(estado)
  const largura = progresso === null ? "null" : JSON.stringify(`${(progresso * 100).toFixed(1)}%`)
  return `(() => {
    document.getElementById("titulo").textContent = ${JSON.stringify(titulo)};
    document.getElementById("detalhe").textContent = ${JSON.stringify(detalhe)};
    const barra = document.getElementById("barra");
    const largura = ${largura};
    barra.hidden = largura === null;
    if (largura !== null) document.getElementById("cheio").style.width = largura;
  })()`
}

/** The O banner in SVG: the same mark as the window corner. */
const MARCA_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true">${TARJAS_DO_ARRANQUE.map((d) => `<path d="${d}"/>`).join("")}</svg>`

/**
 * The page as a `data:` URL. Direction B ("Banners"), chosen by the owner on
 * 3/11/2026: illustration at the top, wordmark, text and bar below.
 *
 * Art and font are embedded in the page, also as `data:`, and policy only
 * opens this: `img-src data:` and `font-src data:`. Nothing goes to the
 * network. Text and bar remain HTML, because they change per phase. The window
 * is 320×400 (`index.ts`); positions below are from the approved design.
 */
export const HTML_DO_ARRANQUE = `<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'none'">
<title>Orwell</title>
<style>
  @font-face { font-family: "Space Grotesk"; font-weight: 300 700; src: url("${FONTE_DO_ARRANQUE}") format("woff2"); }
  html, body { margin: 0; height: 100%; overflow: hidden; color: #e6ecff;
    background: #080c1a url("${ARTE_DO_ARRANQUE}") top center / 320px 280px no-repeat;
    font: 14px/1.4 "Space Grotesk", "Segoe UI", system-ui, sans-serif; -webkit-user-select: none; user-select: none; }
  body { position: relative; -webkit-app-region: drag; }
  .marca { position: absolute; top: 264px; left: 0; right: 0; display: flex; justify-content: center;
    align-items: center; gap: 0.06em; font-size: 22px; font-weight: 600; line-height: 1; letter-spacing: 0.01em; }
  .marca svg { width: 1.04em; height: 1.04em; fill: #7a85f5; flex: none; }
  #titulo { position: absolute; top: 302px; left: 12px; right: 12px; text-align: center; font-weight: 500; line-height: 20px; }
  #barra { position: absolute; top: 334px; left: 60px; width: 200px; height: 6px; border-radius: 3px;
    background: #1b2340; overflow: hidden; }
  #cheio { width: 0; height: 100%; background: #7a85f5; transition: width 120ms linear; }
  #detalhe { position: absolute; top: 350px; left: 12px; right: 12px; text-align: center; color: #9aa6c8;
    font-size: 12px; min-height: 17px; }
</style>
</head>
<body>
  <div class="marca" role="img" aria-label="Orwell">${MARCA_SVG}<span aria-hidden="true">rwell</span></div>
  <div id="titulo">A procurar actualizações</div>
  <div id="barra" hidden><div id="cheio"></div></div>
  <div id="detalhe"></div>
</body>
</html>`
