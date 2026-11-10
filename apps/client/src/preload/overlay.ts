import { contextBridge, ipcRenderer } from "electron"

/**
 * The bridge for the game overlay page, and it is small on purpose.
 *
 * The page only draws what the main process sends it, and only says four
 * things: the mouse is over the pill, a drag started or ended, the pill has
 * this width, and "return to center". It has no network, no keys, reads no
 * messages, and picks no channel names.
 *
 * **Channel names are hardcoded here, not imported from `main/overlay.ts`.**
 * This file and `preload/index.ts` are two entry points of the same build; a
 * module imported by both becomes a third shared file, and a `preload` with
 * `sandbox: true` cannot `require` our files. `overlay.preload.test.ts` locks
 * these names to `CANAIS_DA_OVERLAY`.
 */
const CANAIS = {
  desenhar: "overlay:desenhar",
  carasDaPagina: "overlay:caras-da-pagina",
  rato: "overlay:rato",
  arrastar: "overlay:arrastar",
  largura: "overlay:largura",
  repor: "overlay:repor",
} as const

function ouvir(canal: string, fazer: (valor: unknown) => void): () => void {
  const ouvinte = (_evento: unknown, valor: unknown): void => fazer(valor)
  ipcRenderer.on(canal, ouvinte)
  return () => ipcRenderer.removeListener(canal, ouvinte)
}

contextBridge.exposeInMainWorld("orwellOverlay", {
  aoDesenhar: (fazer: (valor: unknown) => void) => ouvir(CANAIS.desenhar, fazer),
  aoReceberCaras: (fazer: (valor: unknown) => void) => ouvir(CANAIS.carasDaPagina, fazer),
  rato: (dentro: boolean) => ipcRenderer.send(CANAIS.rato, dentro === true),
  arrastar: (fase: "inicio" | "fim") => ipcRenderer.send(CANAIS.arrastar, fase === "inicio" ? "inicio" : "fim"),
  largura: (pixeis: number) => ipcRenderer.send(CANAIS.largura, Number(pixeis)),
  repor: () => ipcRenderer.send(CANAIS.repor),
})
