import { describe, expect, it } from "vitest"
import { agruparPorDia, entraNoFiltro, filtroDoTipo, ofertaEntraNoFiltro } from "./linhaDoTempo.js"
import type { AppNotification } from "./notifications.js"

const entrada = (id: string, at: number, kind: AppNotification["kind"] = "mention"): AppNotification => ({
  id,
  kind,
  at,
  read: false,
})

describe("os filtros do sino", () => {
  it("o mapa tipo → filtro", () => {
    expect(filtroDoTipo("mention")).toBe("mencoes")
    expect(filtroDoTipo("missed-call")).toBe("chamadas")
    expect(filtroDoTipo("room-added")).toBe("convites")
    expect(filtroDoTipo("channel-join")).toBe("convites")
    expect(filtroDoTipo("friend-request")).toBe("amigos")
    expect(filtroDoTipo("friend-accept")).toBe("amigos")
    expect(filtroDoTipo("dm-message")).toBeNull()
    expect(filtroDoTipo("dm-new")).toBeNull()
  })

  it('"Tudo" leva tudo, as mensagens privadas incluídas', () => {
    expect(entraNoFiltro("dm-message", "tudo")).toBe(true)
    expect(entraNoFiltro("dm-message", "mencoes")).toBe(false)
    expect(entraNoFiltro("mention", "mencoes")).toBe(true)
    expect(entraNoFiltro("mention", "amigos")).toBe(false)
  })

  it("as ofertas de sucessão: adicionar é de amigos, convidar de convites", () => {
    expect(ofertaEntraNoFiltro({ de: "a", para: "b", tipo: "amigo" }, "amigos")).toBe(true)
    expect(ofertaEntraNoFiltro({ de: "a", para: "b", tipo: "canal", canal: "!c" }, "convites")).toBe(true)
    expect(ofertaEntraNoFiltro({ de: "a", para: "b", tipo: "canal", canal: "!c" }, "amigos")).toBe(false)
  })
})

describe("os grupos por dia", () => {
  const agora = new Date(2026, 10, 3, 14, 0).getTime()

  it("Hoje, Ontem e o dia, o mais recente em cima, pela hora local", () => {
    const grupos = agruparPorDia(
      [
        entrada("antiga", new Date(2026, 9, 30, 9, 0).getTime()),
        entrada("hoje-cedo", new Date(2026, 10, 3, 0, 5).getTime()),
        entrada("ontem-tarde", new Date(2026, 10, 2, 23, 55).getTime()),
        entrada("hoje", new Date(2026, 10, 3, 13, 0).getTime()),
      ],
      agora,
    )
    expect(grupos.map((grupo) => grupo.dia)).toEqual(["hoje", "ontem", "2026-10-30"])
    expect(grupos[0]?.entradas.map((e) => e.id)).toEqual(["hoje", "hoje-cedo"])
  })

  it("sem entradas, sem grupos", () => {
    expect(agruparPorDia([], agora)).toEqual([])
  })
})
