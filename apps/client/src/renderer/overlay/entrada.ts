import "../../../../../packages/ui/src/styles/fontes.css"
import "./overlay.css"
import { montarOverlay, type PonteDaOverlay } from "./pagina.js"

const raiz = document.getElementById("overlay")
const ponte = (window as { orwellOverlay?: PonteDaOverlay }).orwellOverlay
if (raiz && ponte) {
  montarOverlay({
    raiz,
    ponte,
    reduzido: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  })
}
