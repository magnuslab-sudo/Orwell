import { describe, expect, it } from "vitest"
import { analisarFormatacao } from "./formatacao.js"
import { comandosASugerir, corpoDoMe, lerComando } from "./comandosDaBarra.js"

describe("lerComando", () => {
  it("lê o nome e o argumento, sem os espaços à volta", () => {
    expect(lerComando("/me acena ao grupo")).toEqual({ nome: "me", argumento: "acena ao grupo" })
    expect(lerComando("  /away   fui almoçar  ")).toEqual({ nome: "away", argumento: "fui almoçar" })
    expect(lerComando("/estado")).toEqual({ nome: "estado", argumento: "" })
  })

  it("lê o nome sem maiúsculas: no telemóvel a primeira letra sai grande", () => {
    expect(lerComando("/Me acena")?.nome).toBe("me")
  })

  it("um caminho ou um comando desconhecido é texto, e sai como foi escrito", () => {
    expect(lerComando("/home/ana/notas.txt")).toBeNull()
    expect(lerComando("/xyz olá")).toBeNull()
    expect(lerComando("olá /me")).toBeNull()
    expect(lerComando("//me isto é texto")).toBeNull()
  })

  it("conhece os seis, incluindo os três que ainda não fazem nada", () => {
    for (const nome of ["me", "away", "estado", "nick", "topic", "kick"]) {
      expect(lerComando(`/${nome} x`)?.nome).toBe(nome)
    }
  })
})

describe("comandosASugerir", () => {
  it("a barra sozinha mostra todos, os que funcionam primeiro", () => {
    expect(comandosASugerir("/").map((c) => c.nome)).toEqual(["me", "away", "estado", "nick", "topic", "kick"])
  })

  it("filtra pelo início do nome", () => {
    expect(comandosASugerir("/e").map((c) => c.nome)).toEqual(["estado"])
    expect(comandosASugerir("/K").map((c) => c.nome)).toEqual(["kick"])
  })

  it("depois do espaço, ou sem barra no início, não sugere nada", () => {
    expect(comandosASugerir("/me ")).toEqual([])
    expect(comandosASugerir("olá /")).toEqual([])
    expect(comandosASugerir("")).toEqual([])
    expect(comandosASugerir("/zz")).toEqual([])
  })
})

describe("corpoDoMe", () => {
  it("põe o nome à frente, tudo em itálico pela sintaxe que já existe", () => {
    const corpo = corpoDoMe("acena ao grupo", "Duarte")
    expect(corpo).toBe("*Duarte acena ao grupo*")
    expect(analisarFormatacao(corpo)).toEqual([
      { tipo: "enfase", filhos: [{ tipo: "texto", texto: "Duarte acena ao grupo" }] },
    ])
  })

  it("sem nome, sai só a acção, como no Discord", () => {
    expect(corpoDoMe("acena")).toBe("*acena*")
    expect(corpoDoMe("acena", "  ")).toBe("*acena*")
  })

  it("um asterisco de dentro não fecha o itálico a meio", () => {
    const corpo = corpoDoMe("grita **muito**", "Ana")
    const pedacos = analisarFormatacao(corpo)
    expect(pedacos).toHaveLength(1)
    expect(pedacos[0]?.tipo).toBe("enfase")
  })
})
