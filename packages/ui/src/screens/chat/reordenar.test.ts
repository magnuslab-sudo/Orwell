import { describe, expect, it } from "vitest"
import type { ChannelRoom } from "../../bridge.js"
import { largarAntesDe, largarNaCategoria } from "./reordenar.js"

function sala(room: string, name: string, category: string, position: number): ChannelRoom {
  return { room, name, category, kind: "text", position }
}

/**
 * The order of channels, and the trap these tests exist to lock down:
 * `position` is an integer. Inserting "in the middle" with an average gave a
 * half number, and the sender rejected it after the gesture, so we renumber.
 */
describe("largar um canal antes de outro", () => {
  const lista = [
    sala("a", "avisos", "Início", 0),
    sala("b", "banhos", "Início", 100),
    sala("c", "conversa", "Início", 200),
  ]

  it("põe o arrastado imediatamente antes do alvo", () => {
    const mudancas = largarAntesDe(lista, "c", "b")
    // alerts, conversation, bathrooms, and only the two that changed position change.
    expect(mudancas).toEqual([
      { room: "c", category: "Início", position: 100 },
      { room: "b", category: "Início", position: 200 },
    ])
  })

  it("dá sempre números inteiros, que é o que o protocolo aceita", () => {
    for (const mudanca of largarAntesDe(lista, "c", "a")) {
      expect(Number.isInteger(mudanca.position)).toBe(true)
    }
  })

  it("não publica o que já estava certo", () => {
    // Dropping the second on top of the third leaves the first where it was.
    const mudancas = largarAntesDe(lista, "b", "c")
    expect(mudancas.map((m) => m.room)).not.toContain("a")
  })

  it("largar em cima de um canal de outra categoria muda-o de categoria", () => {
    const misturada = [...lista, sala("v", "voz", "Voz", 0)]
    const mudancas = largarAntesDe(misturada, "a", "v")
    expect(mudancas[0]).toEqual({ room: "a", category: "Voz", position: 0 })
  })

  it("largar em cima de si próprio não mexe em nada", () => {
    expect(largarAntesDe(lista, "b", "b")).toEqual([])
  })

  it("um canal que não existe não move nada", () => {
    expect(largarAntesDe(lista, "fantasma", "b")).toEqual([])
    expect(largarAntesDe(lista, "b", "fantasma")).toEqual([])
  })

  it("a sala por omissão arruma-se como qualquer outra", () => {
    // Empty identifier, nothing special: it is a room like any other as soon as
    // someone touches it.
    const comOmissao = [sala("", "geral", "Início", -1), ...lista]
    const mudancas = largarAntesDe(comOmissao, "", "c")
    expect(mudancas.find((m) => m.room === "")).toEqual({ room: "", category: "Início", position: 200 })
  })
})

describe("largar um canal numa categoria", () => {
  const lista = [sala("a", "avisos", "Início", 0), sala("v", "voz", "Voz", 0)]

  it("põe-no no fim dessa categoria", () => {
    const mudancas = largarNaCategoria(lista, "a", "Voz")
    expect(mudancas).toEqual([{ room: "a", category: "Voz", position: 100 }])
  })

  it("largar na categoria onde já é o último não faz nada", () => {
    expect(largarNaCategoria(lista, "v", "Voz")).toEqual([])
  })

  it("serve para pôr um canal numa categoria vazia de tudo o resto", () => {
    const mudancas = largarNaCategoria(lista, "a", "Arquivo")
    expect(mudancas).toEqual([{ room: "a", category: "Arquivo", position: 0 }])
  })
})
