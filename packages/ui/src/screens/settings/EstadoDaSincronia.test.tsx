import { moradaDeTeste } from "../../../testes/moradas.js"
import { lembrarFichasDosCanais } from "../../lib/tipoDoCanal.js"
import { beforeEach, afterEach, describe, expect, it } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge, SincroniaDoCanal } from "../../bridge.js"
import { feedOwnerOf, formatTime, nomeEmFalta } from "../../lib/format.js"
import { strings } from "../../strings.js"
import { EstadoDaSincronia } from "./EstadoDaSincronia.js"

const DIRECTA = moradaDeTeste("directa abc", "s")
const MURAL = moradaDeTeste("mural ana abc", "s")
// The sheet for each channel (1.0 "Arca", slice 6b): no sheet, a channel is a room.
beforeEach(() =>
  lembrarFichasDosCanais({
    [DIRECTA]: { tipo: "directa" },
    [MURAL]: { tipo: "mural", dono: "@ana-abc:s" },
  }),
)

/** In Diagnostics, one line per channel with the sync status (S5, §2.5). */

afterEach(cleanup)

const HORA = Date.UTC(2026, 9, 21, 14, 2)

function montar(lista: SincroniaDoCanal[]): { avisar: (estado: SincroniaDoCanal) => void } {
  let ouvinte: ((estado: SincroniaDoCanal) => void) | null = null
  const bridge = {
    sincronia: { estado: async () => lista, lugarEm: async () => null },
    channels: { meta: (canal: string) => (canal === "!lagar:s" ? { name: "Lagar", updatedAt: 1 } : null) },
    on: {
      sincronia: (handler: (estado: SincroniaDoCanal) => void) => {
        ouvinte = handler
        return () => {}
      },
    },
  } as unknown as EnclaveBridge
  render(
    <BridgeContext.Provider value={bridge}>
      <EstadoDaSincronia />
    </BridgeContext.Provider>,
  )
  return { avisar: (estado) => ouvinte?.(estado) }
}

const linha = (canal: string, estado: SincroniaDoCanal["estado"], ultimaComparacao: number | null = HORA): SincroniaDoCanal => ({
  channel: canal,
  estado,
  aReceber: false,
  progresso: [],
  ultimaComparacao,
})

async function assentar(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

describe("EstadoDaSincronia", () => {
  it("uma linha por canal, com o nome, o estado e a hora da última comparação", async () => {
    montar([linha("!lagar:s", "igual"), linha("!forja:s", "sem-resposta"), linha("!adega:s", "por-comparar", null)])
    await assentar()
    const linhas = screen.getAllByRole("listitem")
    expect(linhas.map((l) => l.querySelector(".estado-sincronia-nome")?.textContent)).toEqual(["adega", "forja", "Lagar"])
    const lagar = linhas[2]!
    expect(lagar.textContent).toContain(strings.sincronia.estados.igual)
    expect(lagar.textContent).toContain(strings.sincronia.ultima(formatTime(HORA)))
    expect(linhas[1]!.textContent).toContain(strings.sincronia.estados["sem-resposta"])
    // No comparison, no time.
    expect(linhas[0]!.querySelector(".estado-sincronia-hora")).toBeNull()
  })

  // It was "Unnamed" until November 4, 2026; the resource changed to the owner's
  // address word (owner's order), never the full address.
  it("o feed de alguém diz-se pelo dono, e sem nome conhecido pela palavra do endereço dele", async () => {
    montar([linha(MURAL, "igual")])
    await assentar()
    const texto = screen.getByRole("listitem").textContent ?? ""
    expect(texto).toContain(strings.sincronia.feedDe(nomeEmFalta(feedOwnerOf(MURAL))))
    expect(texto).not.toContain(strings.profile.noName)
    expect(texto).not.toContain(feedOwnerOf(MURAL))
  })

  it("as conversas directas ficam de fora", async () => {
    montar([linha(DIRECTA, "por-comparar"), linha("!lagar:s", "igual")])
    await assentar()
    expect(screen.getAllByRole("listitem")).toHaveLength(1)
  })

  it("muda a linha quando a ponte avisa", async () => {
    const { avisar } = montar([linha("!lagar:s", "igual")])
    await assentar()
    await act(async () => avisar(linha("!lagar:s", "a-reparar")))
    expect(screen.getByRole("listitem").textContent).toContain(strings.sincronia.estados["a-reparar"])
  })

  it("nenhum estado usa jargão", () => {
    for (const frase of [...Object.values(strings.sincronia.estados), strings.sincronia.titulo, strings.sincronia.nota]) {
      expect(frase).not.toMatch(/época|MLS|resumo|epoch|relato/i)
    }
  })
})
