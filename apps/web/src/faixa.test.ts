// @vitest-environment jsdom
/**
 * The new version pill (owner's choice B, 28 October 2026).
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { mostrarFaixa } from "./faixa.js"

afterEach(() => {
  document.body.innerHTML = ""
})

describe("a pílula no fundo do ecrã", () => {
  it("é uma pílula ao centro, com ícone, frase, detalhe e botão", () => {
    const aoCarregar = vi.fn()
    const pilula = mostrarFaixa("Versão nova.", { rotulo: "Recarregar", aoCarregar }, "Recarrega para continuar.")
    expect(pilula.getAttribute("role")).toBe("status")
    expect(pilula.style.position).toBe("fixed")
    expect(pilula.style.borderRadius).toBe("999px")
    expect(pilula.style.left).toBe("50%")
    expect(pilula.querySelector("svg path")?.getAttribute("fill")).toBe("currentColor")
    expect(pilula.textContent).toContain("Versão nova.")
    expect(pilula.querySelector("small")?.textContent).toBe("Recarrega para continuar.")
    const botao = pilula.querySelector("button")
    expect(botao?.textContent).toBe("Recarregar")
    expect(botao?.style.borderRadius).toBe("999px")
    botao?.click()
    expect(aoCarregar).toHaveBeenCalledTimes(1)
  })

  it("sem botão nem detalhe, fica a frase e o ícone", () => {
    const pilula = mostrarFaixa("Fecha o outro separador.")
    expect(pilula.querySelector("button")).toBeNull()
    expect(pilula.querySelector("small")).toBeNull()
    expect(pilula.querySelector("svg")).toBeTruthy()
    expect(document.body.contains(pilula)).toBe(true)
  })
})
