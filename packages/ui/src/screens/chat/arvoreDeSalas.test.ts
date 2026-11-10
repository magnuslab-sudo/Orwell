import { describe, expect, it } from "vitest"
import { renderHook } from "@testing-library/react"
import type { ChannelRoom, EnclaveBridge } from "../../bridge.js"
import { useRooms } from "../../hooks/useRooms.js"
import type { QuemVe } from "./categorias.js"
import { canalTemArvore, temArvore, type CategoriaDoCofre } from "./arvoreDeSalas.js"

/**
 * The rule that decides if the drawer leaves the screen, and the two gates
 * to it.
 *
 * `temArvore` answers about the groups of the OPEN channel (what the sidebar
 * holds). `canalTemArvore` answers about the vault of ANY channel (what exists
 * at the moment of the tap, before the chosen channel becomes the open one).
 *
 * The last test is what matters: puts the two side by side against the same
 * channels, including edge cases, declared but empty category, category
 * restricted to those who can't see it, the default room in a category. Without
 * it, the two readings diverge silently and the symptom is a drawer that closes
 * on top of a tree, which is exactly the bug this was meant to fix.
 */
const SALA = (room: string, category = "", name = room || "geral"): ChannelRoom => ({
  room,
  name,
  category,
  kind: "text",
  position: 0,
})

/** A channel as the vault gives it, and the name we call it by in tests. */
interface Caso {
  nome: string
  salas: ChannelRoom[]
  categorias: CategoriaDoCofre[]
  quemVe?: QuemVe
  arvore: boolean
}

const CASOS: Caso[] = [
  { nome: "canal vazio, nem a sala por omissão publicada", salas: [], categorias: [], arvore: false },
  { nome: "só a sala por omissão", salas: [SALA("")], categorias: [], arvore: false },
  { nome: "a sala por omissão e mais uma", salas: [SALA(""), SALA("lagar")], categorias: [], arvore: true },
  { nome: "uma sala que não é a por omissão, sozinha", salas: [SALA("lagar")], categorias: [], arvore: true },
  {
    nome: "uma categoria declarada e vazia (é onde se largam salas)",
    salas: [SALA("")],
    categorias: [{ category: "Voz" }],
    arvore: true,
  },
  {
    nome: "uma categoria com salas lá dentro",
    salas: [SALA(""), SALA("reunioes", "Voz")],
    categorias: [{ category: "Voz" }],
    arvore: true,
  },
  {
    nome: "categoria restrita a um papel que esta conta não tem",
    salas: [SALA(""), SALA("direccao", "Direcção")],
    categorias: [{ category: "Direcção", roles: ["chefia"] }],
    quemVe: { papeis: [], administra: false },
    arvore: false,
  },
  {
    nome: "a mesma categoria restrita, vista por quem tem o papel",
    salas: [SALA(""), SALA("direccao", "Direcção")],
    categorias: [{ category: "Direcção", roles: ["chefia"] }],
    quemVe: { papeis: ["chefia"], administra: false },
    arvore: true,
  },
  {
    nome: "a mesma categoria restrita, vista por quem administra (vê sempre)",
    salas: [SALA(""), SALA("direccao", "Direcção")],
    categorias: [{ category: "Direcção", roles: ["chefia"] }],
    quemVe: { papeis: [], administra: true },
    arvore: true,
  },
  {
    nome: "a sala por omissão metida numa categoria restrita: ela nunca se esconde",
    salas: [SALA("", "Direcção")],
    categorias: [{ category: "Direcção", roles: ["chefia"] }],
    quemVe: { papeis: [], administra: false },
    arvore: true,
  },
  {
    nome: "sem ninguém identificado não se esconde nada",
    salas: [SALA(""), SALA("direccao", "Direcção")],
    categorias: [{ category: "Direcção", roles: ["chefia"] }],
    arvore: true,
  },
]

describe("temArvore, sobre os grupos do canal aberto", () => {
  it("a sala por omissão sozinha não é árvore", () => {
    expect(temArvore([{ category: "", rooms: [SALA("")] }])).toBe(false)
  })

  it("mais do que a sala por omissão é árvore", () => {
    expect(temArvore([{ category: "", rooms: [SALA(""), SALA("lagar")] }])).toBe(true)
  })

  it("uma categoria declarada e vazia também é árvore", () => {
    expect(temArvore([{ category: "", rooms: [SALA("")] }, { category: "Voz", rooms: [] }])).toBe(true)
  })

  it("nenhum grupo nenhum é árvore", () => {
    expect(temArvore([])).toBe(false)
  })
})

describe("canalTemArvore, sobre o cofre de um canal qualquer", () => {
  for (const caso of CASOS) {
    it(`${caso.nome}: ${caso.arvore ? "árvore" : "conversa só"}`, () => {
      expect(canalTemArvore(caso.salas, caso.categorias, caso.quemVe)).toBe(caso.arvore)
    })
  }
})

describe("as duas portas respondem o mesmo", () => {
  /** The minimal bridge that `useRooms` reads: just this channel's vault. */
  function ponte(caso: Caso): EnclaveBridge {
    return {
      channels: {
        rooms: () => caso.salas,
        closedRooms: () => [],
        categories: () => caso.categorias.map((c) => ({ category: c.category, position: 0, roles: [...(c.roles ?? [])] })),
      },
    } as unknown as EnclaveBridge
  }

  for (const caso of CASOS) {
    it(caso.nome, () => {
      const { result } = renderHook(() => useRooms(ponte(caso), "!canal:casa.pt", [], caso.quemVe))
      expect(temArvore(result.current.groups)).toBe(canalTemArvore(caso.salas, caso.categorias, caso.quemVe))
      expect(canalTemArvore(caso.salas, caso.categorias, caso.quemVe)).toBe(caso.arvore)
    })
  }
})
