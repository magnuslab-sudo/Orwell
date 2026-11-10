import { describe, expect, it } from "vitest"
import { MOTIVOS } from "@enclave/protocol"
import { passoAVista, passoAnterior, passoSeguinte, pedeDetalhes, validarEscolha, type EscolhaDaDenuncia } from "./denunciar.js"

const escolha = (over: Partial<EscolhaDaDenuncia> = {}): EscolhaDaDenuncia => ({
  motivo: 3,
  nota: "",
  boaFe: true,
  nome: "",
  email: "",
  ...over,
})

describe("as regras da folha de denunciar", () => {
  // Since 4/11/2026 the details live in the reason step (design chosen
  // by the owner): the "details" step no longer exists, and the rules stay
  // the same, now on leaving the reason step.
  it("o motivo 1 não pede detalhes", () => {
    expect(pedeDetalhes(1)).toBe(false)
    for (const motivo of MOTIVOS.filter((m) => m !== 1)) expect(pedeDetalhes(motivo)).toBe(true)
    expect(passoSeguinte("motivo", escolha({ motivo: 1, boaFe: false }), true)).toBe("previsualizacao")
    expect(passoSeguinte("motivo", escolha({ motivo: 2 }), true)).toBe("previsualizacao")
    expect(passoSeguinte("motivo", escolha({ motivo: 2, boaFe: false }), true)).toBe("motivo")
    // And in reason 1 nothing is validated: no note, no good faith.
    expect(validarEscolha(escolha({ motivo: 1, boaFe: false }))).toBeNull()
    expect(passoAnterior("previsualizacao")).toBe("motivo")
  })

  it("o motivo 8 sem nota dá 'the report needs a note'", () => {
    expect(validarEscolha(escolha({ motivo: 8, nota: "" }))).toBe("the report needs a note")
    expect(validarEscolha(escolha({ motivo: 8, nota: "   " }))).toBe("the report needs a note")
    expect(validarEscolha(escolha({ motivo: 8, nota: "Vende contas roubadas." }))).toBeNull()
    // The note is only required in reason 8.
    expect(validarEscolha(escolha({ motivo: 3, nota: "" }))).toBeNull()
    expect(passoSeguinte("motivo", escolha({ motivo: 8, nota: "" }), true)).toBe("motivo")
  })

  it("os motivos 2 a 8 sem boa-fé dão 'the report needs the good-faith confirmation'", () => {
    for (const motivo of MOTIVOS.filter((m) => m !== 1)) {
      expect(validarEscolha(escolha({ motivo, nota: "nota", boaFe: false }))).toBe(
        "the report needs the good-faith confirmation",
      )
    }
    expect(passoSeguinte("motivo", escolha({ boaFe: false }), true)).toBe("motivo")
    expect(passoSeguinte("motivo", escolha(), true)).toBe("previsualizacao")
  })

  it("sem cópia, da pré-visualização vai-se direito a enviar", () => {
    expect(passoSeguinte("previsualizacao", escolha(), false)).toBe("enviada")
    expect(passoSeguinte("previsualizacao", escolha(), true)).toBe("aviso")
    expect(passoSeguinte("aviso", escolha(), true)).toBe("enviada")
    expect(passoAnterior("aviso")).toBe("previsualizacao")
    expect(passoAnterior("previsualizacao")).toBe("motivo")
  })

  it("três passos à vista: o aviso e a confirmação são os dois o Enviar", () => {
    expect(passoAVista("motivo")).toBe("motivo")
    expect(passoAVista("previsualizacao")).toBe("rever")
    expect(passoAVista("aviso")).toBe("enviar")
    expect(passoAVista("enviada")).toBe("enviar")
  })

  it("sem motivo não se sai do primeiro passo", () => {
    expect(passoSeguinte("motivo", escolha({ motivo: null }), true)).toBe("motivo")
  })
})
