import { describe, expect, it } from "vitest"
import {
  ALTURA_DA_PILULA,
  LARGURA_DO_AVISO,
  MARGEM_DA_JANELA,
  ALTURA_DO_AVISO,
  INTERVALO,
  MAX_PESSOAS,
  deveMostrar,
  janelaDaOverlay,
  lerPosicoes,
  mudancasNaSala,
  posicaoGuardada,
  posicaoPorOmissao,
  guardarPosicao,
  sanearPreferencias,
  sanearCaras,
  sanearResumo,
} from "./overlay.js"

const ecra = { x: 0, y: 0, width: 1920, height: 1040 }
const segundo = { x: 1920, y: 0, width: 1280, height: 1024 }

describe("quando a overlay aparece", () => {
  const base = { ligada: true, emSala: true, janelaAFrente: false, escondidaPelaPessoa: false }

  it("aparece numa sala de voz com a janela principal atrás", () => {
    expect(deveMostrar(base)).toBe(true)
  })

  it("não aparece com a janela principal à frente: lá já se vê a chamada", () => {
    expect(deveMostrar({ ...base, janelaAFrente: true })).toBe(false)
  })

  it("não aparece fora de uma sala de voz, desligada, ou escondida pelo atalho", () => {
    expect(deveMostrar({ ...base, emSala: false })).toBe(false)
    expect(deveMostrar({ ...base, ligada: false })).toBe(false)
    expect(deveMostrar({ ...base, escondidaPelaPessoa: true })).toBe(false)
  })
})

describe("a posição", () => {
  it("por omissão fica ao centro, em cima", () => {
    expect(posicaoPorOmissao(ecra)).toEqual({ cx: 960, y: 16 })
    expect(posicaoPorOmissao(segundo)).toEqual({ cx: 2560, y: 16 })
  })

  it("a janela leva a pílula e o aviso por baixo, centrados no mesmo eixo", () => {
    const janela = janelaDaOverlay({ cx: 960, y: 16 }, 400, ecra)
    const largura = Math.max(400, LARGURA_DO_AVISO) + 2 * MARGEM_DA_JANELA
    expect(janela.lado).toBe("abaixo")
    expect(janela.width).toBe(largura)
    expect(janela.x).toBe(Math.round(960 - largura / 2))
    // The pill starts at the saved `y`, with the window margin above it.
    expect(janela.y).toBe(16 - MARGEM_DA_JANELA)
    expect(janela.height).toBe(ALTURA_DA_PILULA + INTERVALO + ALTURA_DO_AVISO + 2 * MARGEM_DA_JANELA)
  })

  it("fica presa aos limites do ecrã, nos quatro lados", () => {
    const esquerda = janelaDaOverlay({ cx: -500, y: 16 }, 400, ecra)
    expect(esquerda.x).toBe(0)
    const direita = janelaDaOverlay({ cx: 5000, y: 16 }, 400, ecra)
    expect(direita.x + direita.width).toBe(1920)
    const cima = janelaDaOverlay({ cx: 960, y: -300 }, 400, ecra)
    expect(cima.y).toBe(0)
    const baixo = janelaDaOverlay({ cx: 960, y: 5000 }, 400, ecra)
    expect(baixo.y + baixo.height).toBe(1040)
  })

  it("no fundo do ecrã o aviso passa para cima da pílula, e a pílula não salta", () => {
    const perto = janelaDaOverlay({ cx: 960, y: 960 }, 400, ecra)
    expect(perto.lado).toBe("acima")
    // The pill stays where it was, its top at y, with the alert above it.
    expect(perto.pilulaY).toBe(960)
    expect(perto.y + perto.height).toBe(960 + ALTURA_DA_PILULA + MARGEM_DA_JANELA)
  })

  it("devolve onde a pílula ficou depois de presa, para guardar o que se vê", () => {
    const presa = janelaDaOverlay({ cx: 5000, y: -300 }, 400, ecra)
    expect(presa.posicao.y).toBe(MARGEM_DA_JANELA)
    expect(presa.posicao.cx).toBe(1920 - presa.width / 2)
  })

  it("um ecrã mais pequeno do que a janela não a põe fora dele pela esquerda", () => {
    const minusculo = { x: 0, y: 0, width: 200, height: 100 }
    const janela = janelaDaOverlay({ cx: 100, y: 0 }, 400, minusculo)
    expect(janela.x).toBe(0)
    expect(janela.y).toBe(0)
  })
})

describe("a posição guardada, por ecrã", () => {
  it("guarda-se relativa à área do ecrã e volta ao mesmo sítio", () => {
    const guardadas = guardarPosicao({ ecras: {}, ultimo: null }, "2", segundo, { cx: 2000, y: 100 })
    expect(guardadas.ultimo).toBe("2")
    expect(guardadas.ecras["2"]).toEqual({ dx: 80, dy: 100 })
    expect(posicaoGuardada(guardadas, "2", segundo)).toEqual({ cx: 2000, y: 100 })
  })

  it("um ecrã sem posição guardada usa o centro em cima", () => {
    expect(posicaoGuardada({ ecras: {}, ultimo: null }, "9", ecra)).toEqual({ cx: 960, y: 16 })
  })

  it('lê um ficheiro estragado como "nada guardado", e corta o lixo', () => {
    expect(lerPosicoes("isto não é json")).toEqual({ ecras: {}, ultimo: null })
    expect(lerPosicoes(null)).toEqual({ ecras: {}, ultimo: null })
    expect(
      lerPosicoes({ ecras: { "1": { dx: 10, dy: 20 }, "2": { dx: "x", dy: 1 }, "3": { dx: Infinity, dy: 0 } }, ultimo: "1" }),
    ).toEqual({ ecras: { "1": { dx: 10, dy: 20 } }, ultimo: "1" })
  })
})

describe("o resumo que chega do renderer", () => {
  it("guarda só o nome da sala e, por pessoa, nome, a falar e silenciada", () => {
    const resumo = sanearResumo({
      sala: "  Sala de jogo ",
      entrada: 3,
      chave: "abc",
      segredo: "não passa",
      pessoas: [{ id: "a@x", nome: "Kaori", aFalar: true, micCalado: false, somDesligado: false, chave: "k", corpo: "olá" }],
    })
    expect(resumo).toEqual({
      sala: "Sala de jogo",
      entrada: 3,
      pessoas: [{ id: "a@x", nome: "Kaori", aFalar: true, micCalado: false, somDesligado: false }],
    })
  })

  it("deixa passar a marca do nome tirado do endereço só quando é verdadeira", () => {
    const resumo = sanearResumo({
      sala: "S",
      pessoas: [
        { id: "a", nome: "Milsinda", doEndereco: true },
        { id: "b", nome: "Kaori", doEndereco: "sim" },
        { id: "c", nome: "Rui" },
      ],
    })
    expect(resumo?.pessoas.map((p) => p.doEndereco)).toEqual([true, undefined, undefined])
    expect(Object.keys(resumo?.pessoas[1] ?? {})).not.toContain("doEndereco")
  })

  it("corta o nome, a sala e o número de pessoas", () => {
    const muitas = Array.from({ length: 80 }, (_, i) => ({ id: `p${i}`, nome: "N".repeat(200) }))
    const resumo = sanearResumo({ sala: "S".repeat(300), pessoas: muitas })
    expect(resumo?.pessoas).toHaveLength(MAX_PESSOAS)
    expect(resumo?.pessoas[0]?.nome.length).toBeLessThanOrEqual(48)
    expect(resumo?.sala.length).toBeLessThanOrEqual(64)
  })

  it('`null` e lixo querem dizer "fora de uma sala"', () => {
    expect(sanearResumo(null)).toBeNull()
    expect(sanearResumo("x")).toBeNull()
    expect(sanearResumo({ sala: "S", pessoas: "x" })).toBeNull()
  })

  it("uma pessoa sem id ou repetida cai", () => {
    const resumo = sanearResumo({ sala: "S", pessoas: [{ nome: "sem id" }, { id: "a", nome: "A" }, { id: "a", nome: "B" }] })
    expect(resumo?.pessoas.map((p) => p.nome)).toEqual(["A"])
  })
})

describe("as caras, que viajam à parte e uma vez", () => {
  const cara = "data:image/png;base64,AAAA"

  it("aceita imagens embutidas de mapa de bits, e mais nada", () => {
    expect(
      sanearCaras({
        a: cara,
        b: "https://exemplo.pt/cara.png",
        c: "data:image/svg+xml;base64,AAAA",
        d: `data:image/png;base64,${"A".repeat(300_000)}`,
        e: 7,
      }),
    ).toEqual({ a: cara, b: null, c: null, d: null, e: null })
  })

  it("não aceita mais caras do que pessoas cabem na pílula", () => {
    const muitas = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`p${i}`, cara]))
    expect(Object.keys(sanearCaras(muitas))).toHaveLength(MAX_PESSOAS)
    expect(sanearCaras("x")).toEqual({})
  })
})

describe("as preferências que chegam do renderer", () => {
  it("lixo vale desligada e 45 %", () => {
    expect(sanearPreferencias(undefined)).toMatchObject({ ligada: false, opacidade: 0.45 })
    expect(sanearPreferencias({ ligada: false, opacidade: 0.3 })).toMatchObject({ ligada: false, opacidade: 0.3 })
    expect(sanearPreferencias({ ligada: "sim", opacidade: 7 })).toMatchObject({ ligada: false, opacidade: 1 })
    expect(sanearPreferencias({ ligada: true, opacidade: 0 })).toMatchObject({ ligada: true, opacidade: 0.2 })
  })

  it("as frases do aviso vêm da interface, curtas, e sem elas valem as portuguesas", () => {
    expect(sanearPreferencias({ textos: { entrou: "joined the room", saiu: "left the room" } }).textos).toEqual({
      entrou: "joined the room",
      saiu: "left the room",
    })
    expect(sanearPreferencias({ textos: { entrou: 3, saiu: "x".repeat(500) } }).textos).toEqual({
      entrou: "entrou na sala",
      saiu: "x".repeat(40),
    })
  })
})

describe("quem entrou e quem saiu", () => {
  const pessoa = (id: string) => ({ id, nome: id.toUpperCase(), aFalar: false, micCalado: false, somDesligado: false })

  it("compara duas fotografias da mesma entrada na sala", () => {
    const antes = { sala: "S", entrada: 1, pessoas: [pessoa("eu"), pessoa("a")] }
    const depois = { sala: "S", entrada: 1, pessoas: [pessoa("eu"), pessoa("b")] }
    expect(mudancasNaSala(antes, depois)).toEqual([
      { tipo: "entrou", pessoa: pessoa("b") },
      { tipo: "saiu", pessoa: pessoa("a") },
    ])
  })

  it("a primeira fotografia, ou uma entrada nova (outra sala, mesmo com o mesmo nome), não avisa de ninguém", () => {
    expect(mudancasNaSala(null, { sala: "S", entrada: 1, pessoas: [pessoa("a")] })).toEqual([])
    expect(
      mudancasNaSala({ sala: "S", entrada: 1, pessoas: [pessoa("a")] }, { sala: "S", entrada: 2, pessoas: [pessoa("b")] }),
    ).toEqual([])
  })

  it("mudar só quem fala não é entrar nem sair", () => {
    const antes = { sala: "S", entrada: 1, pessoas: [pessoa("a")] }
    const depois = { sala: "S", entrada: 1, pessoas: [{ ...pessoa("a"), aFalar: true }] }
    expect(mudancasNaSala(antes, depois)).toEqual([])
  })
})
