import { describe, expect, it, vi } from "vitest"
import { CANAIS_DA_OVERLAY } from "./overlay.js"

/*
  The overlay bridge (`preload/overlay.ts`) hardcodes the channel names because
  it can't share modules with the other `preload` (see its header). This test
  ties them to `CANAIS_DA_OVERLAY`.
*/
const exposto: Record<string, Record<string, (...argumentos: unknown[]) => unknown>> = {}
const enviados: [string, unknown][] = []
const ouvidos: string[] = []

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (nome: string, api: Record<string, (...argumentos: unknown[]) => unknown>) => {
      exposto[nome] = api
    },
  },
  ipcRenderer: {
    send: (canal: string, valor: unknown) => enviados.push([canal, valor]),
    on: (canal: string) => ouvidos.push(canal),
    removeListener: () => {},
  },
}))

describe("a ponte da página da overlay", () => {
  it("usa os mesmos canais que o principal, e só esses", async () => {
    await import("../preload/overlay.js")
    const api = exposto.orwellOverlay!
    expect(Object.keys(api).sort()).toEqual(["aoDesenhar", "aoReceberCaras", "arrastar", "largura", "rato", "repor"])
    api.aoDesenhar!(() => {})
    api.aoReceberCaras!(() => {})
    api.rato!(true)
    api.arrastar!("inicio")
    api.arrastar!("qualquer coisa")
    api.largura!("200")
    api.repor!()
    expect(ouvidos).toEqual([CANAIS_DA_OVERLAY.desenhar, CANAIS_DA_OVERLAY.carasDaPagina])
    expect(enviados).toEqual([
      [CANAIS_DA_OVERLAY.rato, true],
      [CANAIS_DA_OVERLAY.arrastar, "inicio"],
      [CANAIS_DA_OVERLAY.arrastar, "fim"],
      [CANAIS_DA_OVERLAY.largura, 200],
      [CANAIS_DA_OVERLAY.repor, undefined],
    ])
  })
})
