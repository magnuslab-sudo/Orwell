import { describe, expect, it } from "vitest"
import {
  ACCOES_GLOBAIS,
  ATALHOS_POR_OMISSAO,
  SO_NA_SECRETARIA,
  accaoDaCombinacao,
  avisoDaCombinacao,
  botaoDoRato,
  combinacaoDeEvento,
  combinacaoDeRato,
  combinacaoValida,
  formatarCombinacao,
  lerMapaDeAtalhos,
  pedeAcessibilidadeNoMac,
  pertenceACaixaDeTexto,
  teclaComum,
} from "./atalhosDeVoz.js"

describe("atalhos de voz", () => {
  it("lê a combinação de um evento, com Ctrl e Cmd a darem o mesmo", () => {
    expect(combinacaoDeEvento({ key: "m", ctrlKey: true, shiftKey: true })).toBe("Mod+Shift+M")
    expect(combinacaoDeEvento({ key: "M", metaKey: true, shiftKey: true })).toBe("Mod+Shift+M")
    expect(combinacaoDeEvento({ key: "F8" })).toBe("F8")
    expect(combinacaoDeEvento({ key: " ", altKey: true })).toBe("Alt+Space")
  })

  it("um modificador sozinho ainda não é combinação nenhuma", () => {
    expect(combinacaoDeEvento({ key: "Shift", shiftKey: true })).toBeNull()
    expect(combinacaoDeEvento({ key: "Control", ctrlKey: true })).toBeNull()
    expect(combinacaoDeEvento({ key: "Escape" })).toBeNull()
  })

  it("desde a 1.0.6 serve qualquer tecla sozinha (ponto 8: sem Ctrl), menos as que têm dono", () => {
    expect(combinacaoValida("M")).toBe(true)
    expect(combinacaoValida("Shift+M")).toBe(true)
    expect(combinacaoValida("F13")).toBe(true)
    expect(combinacaoValida("`")).toBe(true)
    expect(combinacaoValida("F8")).toBe(true)
    expect(combinacaoValida("Alt+Space")).toBe(true)
    expect(combinacaoValida("Mod+Shift+M")).toBe(true)
    expect(combinacaoValida("Shift+Space")).toBe(true)
    expect(combinacaoValida("Mod+Escape")).toBe(false)
    expect(combinacaoValida("Tab")).toBe(false)
    expect(combinacaoValida("Enter")).toBe(false)
    expect(combinacaoValida("Lixo+M")).toBe(false)
    expect(combinacaoValida("Shift+Shift+M")).toBe(false)
  })

  it("os botões 4 e 5 do rato são atalhos; os três primeiros têm dono", () => {
    // The DOM counts from zero: button 3 is "button 4" (the back one).
    expect(combinacaoDeRato({ button: 3 })).toBe("Mouse4")
    expect(combinacaoDeRato({ button: 4, ctrlKey: true })).toBe("Mod+Mouse5")
    expect(combinacaoDeRato({ button: 0 })).toBeNull()
    expect(combinacaoDeRato({ button: 1 })).toBeNull()
    expect(combinacaoDeRato({ button: 2 })).toBeNull()
    expect(combinacaoValida("Mouse4")).toBe(true)
    expect(combinacaoValida("Mouse1")).toBe(false)
    expect(botaoDoRato("Alt+Mouse5")).toBe(5)
    expect(botaoDoRato("F13")).toBeNull()
  })

  it("sabe que teclas são comuns e quais escrevem, para avisar ao gravar", () => {
    expect(teclaComum("M")).toBe(true)
    expect(teclaComum("Shift+7")).toBe(true)
    expect(teclaComum("Space")).toBe(true)
    expect(teclaComum("ArrowUp")).toBe(true)
    expect(teclaComum("Mod+M")).toBe(false)
    expect(teclaComum("`")).toBe(false)
    expect(teclaComum("F13")).toBe(false)
    expect(avisoDaCombinacao("M")).toBe("comum")
    expect(avisoDaCombinacao("`")).toBe("escreve")
    expect(avisoDaCombinacao("F13")).toBeNull()
    expect(avisoDaCombinacao("Mod+Shift+M")).toBeNull()
    expect(avisoDaCombinacao("Mouse4")).toBeNull()
  })

  it("numa caixa de texto, o que escreve ou move o cursor é da caixa", () => {
    expect(pertenceACaixaDeTexto("M")).toBe(true)
    expect(pertenceACaixaDeTexto("`")).toBe(true)
    expect(pertenceACaixaDeTexto("Shift+Space")).toBe(true)
    expect(pertenceACaixaDeTexto("ArrowLeft")).toBe(true)
    expect(pertenceACaixaDeTexto("F13")).toBe(false)
    expect(pertenceACaixaDeTexto("Mod+Shift+M")).toBe(false)
    expect(pertenceACaixaDeTexto("MediaPlayPause")).toBe(false)
  })

  it("só as quatro teclas de multimédia pedem Acessibilidade no macOS", () => {
    expect(pedeAcessibilidadeNoMac("MediaPlayPause")).toBe(true)
    expect(pedeAcessibilidadeNoMac("MediaTrackNext")).toBe(true)
    expect(pedeAcessibilidadeNoMac("AudioVolumeMute")).toBe(false)
    expect(pedeAcessibilidadeNoMac("F13")).toBe(false)
  })

  it("mostra-se como um Mac ou como o resto do mundo a lê", () => {
    expect(formatarCombinacao("Mod+Shift+M", "mac")).toBe("⌘⇧M")
    expect(formatarCombinacao("Mod+Shift+M", "outra")).toBe("Ctrl+Shift+M")
    expect(formatarCombinacao("Alt+Space", "outra")).toBe("Alt+Space")
    expect(formatarCombinacao("Mouse4", "outra", (n) => `Rato ${n}`)).toBe("Rato 4")
    expect(formatarCombinacao("Mod+Mouse5", "outra", (n) => `Rato ${n}`)).toBe("Ctrl+Rato 5")
    expect(formatarCombinacao("Mod+Mouse5", "mac", (n) => `Rato ${n}`)).toBe("⌘ Rato 5")
  })

  it("a overlay de jogo tem atalho de fábrica sem Ctrl, que pode ser global", () => {
    expect(ATALHOS_POR_OMISSAO.overlay).toBe("Alt+Shift+O")
    expect(teclaComum("Alt+Shift+O")).toBe(false)
    expect(ACCOES_GLOBAIS).toContain("overlay")
    expect(SO_NA_SECRETARIA).toContain("overlay")
  })

  it("encontra a acção pela combinação", () => {
    expect(accaoDaCombinacao("Mod+Shift+M", ATALHOS_POR_OMISSAO)).toBe("microfone")
    expect(accaoDaCombinacao("Mod+M", ATALHOS_POR_OMISSAO)).toBeNull()
    expect(accaoDaCombinacao("F8", { ...ATALHOS_POR_OMISSAO, falar: "F8" })).toBe("falar")
  })

  it("sanea o que vem do disco: o inválido cai para a predefinição, o limpo fica limpo", () => {
    expect(lerMapaDeAtalhos(undefined)).toEqual(ATALHOS_POR_OMISSAO)
    expect(lerMapaDeAtalhos({ microfone: "Tab", som: null, falar: "F8", camara: "Mouse4", lixo: "x" })).toEqual({
      ...ATALHOS_POR_OMISSAO,
      som: null,
      falar: "F8",
      camara: "Mouse4",
    })
  })
})
