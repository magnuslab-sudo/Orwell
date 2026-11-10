import { describe, expect, it } from "vitest"
import { strings } from "../strings.js"
import { nomeEmFalta, palavrasRepetidas, vemDoEndereco } from "./format.js"

/**
 * The name of someone who did not choose one: the first word of their address,
 * with the first letter capitalized, and the second if another account on the same
 * screen starts with the same letter. Owner's order on November 4, 2026.
 */
const GINVODRA = "@ginvodra-sastybis-dirgybus-boblytum:orwell.pt"
const GINVODRA_OUTRA = "@ginvodra-pelmara-sostrin-quavely:orwell.pt"

describe("nomeEmFalta", () => {
  it("é a primeira palavra do endereço, com a primeira letra maiúscula", () => {
    expect(nomeEmFalta(GINVODRA)).toBe("Ginvodra")
  })

  it("vale igual para endereços de outros servidores, com porta ou sem ela", () => {
    expect(nomeEmFalta("@milsinda-odreto-viddyvox-pofletum:outro.pt")).toBe("Milsinda")
    expect(nomeEmFalta("@milsinda-odreto-viddyvox-pofletum:localhost:8448")).toBe("Milsinda")
  })

  it("nunca leva o endereço inteiro, a arroba, o servidor nem os hífens", () => {
    const nome = nomeEmFalta(GINVODRA)
    expect(nome).not.toContain("@")
    expect(nome).not.toContain(":")
    expect(nome).not.toContain("-")
    expect(nome).not.toContain("orwell.pt")
  })

  it("põe maiúscula só na primeira letra, e endereços em maiúsculas saem iguais", () => {
    expect(nomeEmFalta("@GINVODRA-sastybis:orwell.pt")).toBe("Ginvodra")
    expect(nomeEmFalta("@ana:casa.pt")).toBe("Ana")
  })

  it("sem endereço de pessoa, «Sem nome»: não há palavra nenhuma a dizer", () => {
    expect(nomeEmFalta()).toBe(strings.profile.noName)
    expect(nomeEmFalta("")).toBe(strings.profile.noName)
    expect(nomeEmFalta("@:orwell.pt")).toBe(strings.profile.noName)
    // A channel is not a person: the secret `!` does not give a name.
    expect(nomeEmFalta("!sala:orwell.pt")).toBe(strings.profile.noName)
    expect(nomeEmFalta("ana")).toBe(strings.profile.noName)
  })

  it("com a primeira palavra repetida no ecrã, leva a segunda, nas duas contas", () => {
    const repetidas = palavrasRepetidas([GINVODRA, GINVODRA_OUTRA, "@ana:casa.pt"])
    expect(nomeEmFalta(GINVODRA, repetidas)).toBe("Ginvodra Sastybis")
    expect(nomeEmFalta(GINVODRA_OUTRA, repetidas)).toBe("Ginvodra Pelmara")
    expect(nomeEmFalta("@ana:casa.pt", repetidas)).toBe("Ana")
  })

  it("um endereço de uma palavra só fica com ela, mesmo a colidir", () => {
    const repetidas = palavrasRepetidas(["@ana:casa.pt", "@ana-rita:casa.pt"])
    expect(nomeEmFalta("@ana:casa.pt", repetidas)).toBe("Ana")
    expect(nomeEmFalta("@ana-rita:casa.pt", repetidas)).toBe("Ana Rita")
  })
})

describe("palavrasRepetidas", () => {
  it("conta contas distintas: a mesma conta duas vezes não colide consigo", () => {
    expect([...palavrasRepetidas([GINVODRA, GINVODRA])]).toEqual([])
  })

  it("colide entre servidores, porque o que se lê é a palavra", () => {
    expect([...palavrasRepetidas([GINVODRA, "@ginvodra-x-y-z:outro.pt"])]).toEqual(["ginvodra"])
  })

  it("ignora o que não é endereço de pessoa", () => {
    expect([...palavrasRepetidas(["!ginvodra:orwell.pt", GINVODRA, "ginvodra"])]).toEqual([])
  })
})

describe("vemDoEndereco", () => {
  it("reconhece a palavra do endereço, numa forma e na outra", () => {
    expect(vemDoEndereco("Ginvodra", GINVODRA)).toBe(true)
    expect(vemDoEndereco("Ginvodra Sastybis", GINVODRA)).toBe(true)
  })

  it("um nome escolhido não vem do endereço", () => {
    expect(vemDoEndereco("Ana Silva", GINVODRA)).toBe(false)
  })

  it("a palavra do endereço de OUTRA pessoa, escolhida como nome, não passa por vinda do endereço", () => {
    expect(vemDoEndereco("Ginvodra", "@milsinda-odreto-viddyvox-pofletum:orwell.pt")).toBe(false)
  })

  it("sem endereço não se sabe, e o nome sai como escolhido", () => {
    expect(vemDoEndereco("Ginvodra", undefined)).toBe(false)
    expect(vemDoEndereco(strings.profile.noName, null)).toBe(false)
  })
})
