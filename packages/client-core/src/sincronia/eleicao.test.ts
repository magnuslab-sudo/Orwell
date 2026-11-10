import { describe, expect, it } from "vitest"
import { candidatos, eleger, esperaDeSupressao, Recuo, TECTOS_DA_SINCRONIA, TectoPorMinuto, Vivacidade, type Folha } from "./eleicao.js"

const folha = (indice: number, aparelho = `ap${indice}`): Folha => ({ indice, address: `@c${indice}:x`, aparelho })

describe("a eleição (§4.4)", () => {
  const folhas = [folha(3), folha(0), folha(5), folha(1), folha(2)]

  it("responde a folha viva mais baixa, sem o próprio, sem as que não sabem e sem as mortas", () => {
    const lista = candidatos(folhas, {
      proprio: "ap0",
      capaz: (f) => f.indice !== 1,
      viva: (f) => f.indice !== 2,
    })
    expect(lista.map((f) => f.indice)).toEqual([3, 5])
    expect(eleger(lista)?.indice).toBe(3)
  })

  it("todos os membros escolhem o mesmo, seja qual for a ordem em que vêem a árvore", () => {
    const opcoes = { proprio: "zz", capaz: () => true, viva: () => true }
    const a = eleger(candidatos(folhas, opcoes))
    const b = eleger(candidatos([...folhas].reverse(), opcoes))
    expect(a).toEqual(b)
  })

  it("só as folhas com os dados, quando se sabe quem os tem (nível 2)", () => {
    const lista = candidatos(folhas, { proprio: "zz", capaz: () => true, viva: () => true, comDados: (f) => f.indice >= 2 })
    expect(eleger(lista)?.indice).toBe(2)
  })

  it("a folha seguinte em cada tentativa, e nada depois da terceira", () => {
    const lista = candidatos(folhas, { proprio: "zz", capaz: () => true, viva: () => true })
    expect([0, 1, 2].map((t) => eleger(lista, t)?.indice)).toEqual([0, 1, 2])
    expect(eleger(lista, TECTOS_DA_SINCRONIA.tentativasPorPedido)).toBeNull()
  })
})

describe("a supressão", () => {
  it("espera posição × 2 s, contando com o próprio", () => {
    const folhas = [folha(4), folha(1), folha(9)]
    expect(esperaDeSupressao(folhas, "ap1")).toBe(0)
    expect(esperaDeSupressao(folhas, "ap4")).toBe(2_000)
    expect(esperaDeSupressao(folhas, "ap9")).toBe(4_000)
  })
})

describe("a vida", () => {
  it("viva até 120 s depois do último sinal", () => {
    const vivas = new Vivacidade()
    vivas.notar("a", 1_000)
    expect(vivas.viva("a", 1_000 + TECTOS_DA_SINCRONIA.vidaMs)).toBe(true)
    expect(vivas.viva("a", 1_001 + TECTOS_DA_SINCRONIA.vidaMs)).toBe(false)
    expect(vivas.viva("b", 1_000)).toBe(false)
  })
})

describe("os tectos por minuto", () => {
  it("contam por chave numa janela deslizante, e o que não cabe não gasta", () => {
    const tecto = new TectoPorMinuto()
    expect(tecto.gastar("r0|c", 1, 2, 0)).toBe(true)
    expect(tecto.gastar("r0|c", 1, 2, 10)).toBe(true)
    expect(tecto.gastar("r0|c", 1, 2, 20)).toBe(false)
    expect(tecto.gastar("r0|outro", 1, 2, 20)).toBe(true)
    // A minute after the first, there is a seat again.
    expect(tecto.gastar("r0|c", 1, 2, 60_000)).toBe(true)
    expect(tecto.gastar("bytes", 900, 1000, 0)).toBe(true)
    expect(tecto.gastar("bytes", 200, 1000, 1)).toBe(false)
    expect(tecto.usado("bytes", 1)).toBe(900)
  })

  it("os tectos do cliente ficam abaixo dos do servidor (120/min, 16 KiB, 4 MiB de saída por canal)", () => {
    expect(TECTOS_DA_SINCRONIA.sinaisPorMinuto).toBeLessThan(120)
    expect(TECTOS_DA_SINCRONIA.sinalMaxCaracteres).toBeLessThan(16 * 1024)
    // The client byte limit is for OUTGOING (size × copies), like the server's,
    // and it is only part of it: the server's sum all members. What proves the
    // client counts copies is in `pedido.test.ts` ("onze ligações").
    expect(TECTOS_DA_SINCRONIA.bytesDeSinalPorCanalPorMinuto).toBeLessThanOrEqual(2 * 1024 * 1024)
  })
})

describe("o recuo", () => {
  it("começa no retryAfterMs, dobra a cada recusa seguida, e tem tecto", () => {
    const recuo = new Recuo()
    expect(recuo.recusado("c", 0, 500)).toBe(500)
    expect(recuo.bloqueado("c", 499)).toBe(true)
    expect(recuo.bloqueado("c", 500)).toBe(false)
    expect(recuo.recusado("c", 600, 500)).toBe(1_000)
    expect(recuo.recusado("c", 2_000, 500)).toBe(2_000)
    for (let i = 0; i < 20; i++) recuo.recusado("c", 3_000 + i, 500)
    expect(recuo.recusado("c", 4_000, 500)).toBe(TECTOS_DA_SINCRONIA.recuoMaximoMs)
  })

  it("sem retryAfterMs começa no recuo inicial; uma recusa muito depois recomeça a conta", () => {
    const recuo = new Recuo()
    expect(recuo.recusado("c", 0)).toBe(TECTOS_DA_SINCRONIA.recuoInicialMs)
    expect(recuo.recusado("c", 10)).toBe(2 * TECTOS_DA_SINCRONIA.recuoInicialMs)
    expect(recuo.recusado("c", 10 * 60_000)).toBe(TECTOS_DA_SINCRONIA.recuoInicialMs)
  })
})
