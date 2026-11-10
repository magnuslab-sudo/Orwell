import { describe, expect, it } from "vitest"
import { MAX_ICONE, entregaDoAviso, sanearAviso, sanearPrazo } from "./aviso.js"

/**
 * The system notice, on the main process side, measured without Electron.
 *
 * Request from the owner and community (November 2, 2026, point 6): the notice
 * also shows with the window in front, and a friend coming online notice
 * includes the face.
 */
describe("a entrega do aviso", () => {
  it("com a janela à frente, o aviso sai na mesma", () => {
    expect(entregaDoAviso({ cofreAberto: true, suportado: true, aFrente: true, contavel: true }).recusa).toBeNull()
  })

  it("com a janela à frente não conta no ícone: quem está a olhar não tem nada por ler na barra", () => {
    expect(entregaDoAviso({ cofreAberto: true, suportado: true, aFrente: true, contavel: true }).contar).toBe(false)
    expect(entregaDoAviso({ cofreAberto: true, suportado: true, aFrente: false, contavel: true }).contar).toBe(true)
    expect(entregaDoAviso({ cofreAberto: true, suportado: true, aFrente: false, contavel: false }).contar).toBe(false)
  })

  it("o cofre fechado e o sistema sem avisos continuam a recusar", () => {
    expect(entregaDoAviso({ cofreAberto: false, suportado: true, aFrente: false, contavel: true }).recusa).toBe(
      "cofre-fechado",
    )
    expect(entregaDoAviso({ cofreAberto: true, suportado: false, aFrente: false, contavel: true }).recusa).toBe(
      "sem-suporte",
    )
  })
})

describe("a cara no aviso", () => {
  const base = { id: "amigo:1", title: "Orwell", body: "Ana está online" }
  const png = "data:image/png;base64,iVBORw0KGgo="

  it("aceita uma imagem pequena, em data URL", () => {
    expect(sanearAviso({ ...base, icon: png })?.icon).toBe(png)
  })

  it("recusa tudo o que não for uma imagem embutida: o processo principal não vai buscar nada à rede", () => {
    expect(sanearAviso({ ...base, icon: "https://exemplo.pt/cara.png" })?.icon).toBeNull()
    expect(sanearAviso({ ...base, icon: "file:///etc/passwd" })?.icon).toBeNull()
    expect(sanearAviso({ ...base, icon: "data:image/svg+xml;base64,PHN2Zz4=" })?.icon).toBeNull()
    expect(sanearAviso({ ...base, icon: 42 })?.icon).toBeNull()
  })

  it("recusa uma imagem grande demais", () => {
    const grande = `data:image/png;base64,${"A".repeat(MAX_ICONE)}`
    expect(sanearAviso({ ...base, icon: grande })?.icon).toBeNull()
  })

  it("o aviso sem cara continua igual", () => {
    expect(sanearAviso(base)).toEqual({ ...base, channel: null, countable: false, icon: null, expiraEmMs: null })
  })
})

describe("o aviso que se fecha sozinho", () => {
  it("aceita o prazo do amigo online (2 s) e passa-o à bandeja", () => {
    expect(sanearAviso({ id: "amigo:x", title: "Orwell", body: "A Ana está online.", expiraEmMs: 2000 })?.expiraEmMs).toBe(2000)
  })

  it("recusa prazos fora de meio segundo a um minuto, e o que não é número inteiro", () => {
    for (const cru of [0, 499, 60_001, 1500.5, "2000", null, undefined, Number.NaN]) {
      expect(sanearPrazo(cru), String(cru)).toBeNull()
    }
    expect(sanearPrazo(500)).toBe(500)
    expect(sanearPrazo(60_000)).toBe(60_000)
  })
})
