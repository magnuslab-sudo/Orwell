import { describe, expect, it } from "vitest"
import { envolver, marcadorDe } from "./atalhosDeFormatacao.js"

/**
 * What the key combination means.
 *
 * Separated from the effect so the table can be locked without a document, the
 * same split that `accaoDe` in `useAtalhos.ts` does, and for the same reason.
 */
describe("marcadorDe", () => {
  it("os dois universais: negrito e itálico", () => {
    expect(marcadorDe({ key: "b", metaKey: true })).toBe("**")
    expect(marcadorDe({ key: "b", ctrlKey: true })).toBe("**")
    expect(marcadorDe({ key: "i", metaKey: true })).toBe("*")
    expect(marcadorDe({ key: "i", ctrlKey: true })).toBe("*")
  })

  it("os dois com Shift: rasurado e coberto", () => {
    expect(marcadorDe({ key: "x", metaKey: true, shiftKey: true })).toBe("~~")
    expect(marcadorDe({ key: "e", metaKey: true, shiftKey: true })).toBe("||")
  })

  it("com Shift carregado, a tecla chega em maiúscula — e conta na mesma", () => {
    // The browser delivers "X" in `key` for Shift+x. Comparing without lowercasing
    // made the shortcut work in theory and never in practice.
    expect(marcadorDe({ key: "X", metaKey: true, shiftKey: true })).toBe("~~")
    expect(marcadorDe({ key: "E", ctrlKey: true, shiftKey: true })).toBe("||")
  })

  it("uma letra sozinha é uma letra, e nunca um atalho", () => {
    // The rule that makes this bearable inside a text box: without a modifier, the
    // keyboard belongs to whoever is typing.
    expect(marcadorDe({ key: "b" })).toBeNull()
    expect(marcadorDe({ key: "i" })).toBeNull()
    expect(marcadorDe({ key: "x", shiftKey: true })).toBeNull()
  })

  it("o negrito e o itálico NÃO levam Shift", () => {
    // `Ctrl+Shift+B` is Chrome's bookmarks bar and `Ctrl+Shift+I` is the developer
    // tools: two combinations the browser never sends us. Claiming them would
    // promise a shortcut that never arrives.
    expect(marcadorDe({ key: "b", metaKey: true, shiftKey: true })).toBeNull()
    expect(marcadorDe({ key: "i", metaKey: true, shiftKey: true })).toBeNull()
  })

  it("com Alt não é nosso: é a porta dos acentos e dos menus", () => {
    expect(marcadorDe({ key: "b", metaKey: true, altKey: true })).toBeNull()
  })

  it("as teclas que já têm dono não são reclamadas", () => {
    // `Ctrl+Shift+M` is the microphone in `useAtalhos.ts`. Two owners for the same
    // combination is the fastest way to break both.
    expect(marcadorDe({ key: "m", metaKey: true, shiftKey: true })).toBeNull()
  })
})

/**
 * Wrap the selection, which is the whole gesture.
 *
 * The most important guarantee is not putting markers: it is that the LETTERS
 * stay and the selection remains on the same ones. A shortcut that moved the
 * selection would force the user to mark it again with the mouse to press the
 * second shortcut, and at that point typing the asterisks by hand was faster.
 */
describe("envolver", () => {
  it("põe os marcadores à volta da selecção", () => {
    expect(envolver("isto é urgente", 7, 14, "**")).toEqual({
      texto: "isto é **urgente**",
      inicio: 9,
      fim: 16,
    })
  })

  it("a selecção fica sobre as MESMAS letras depois de envolver", () => {
    const antes = "isto é urgente"
    const depois = envolver(antes, 7, 14, "**")
    expect(depois.texto.slice(depois.inicio, depois.fim)).toBe(antes.slice(7, 14))
  })

  it("carregar outra vez tira os marcadores", () => {
    // The toggle, which is what "alternate" means. The selection is over the
    // letters, and the markers are outside.
    expect(envolver("isto é **urgente**", 9, 16, "**")).toEqual({
      texto: "isto é urgente",
      inicio: 7,
      fim: 14,
    })
  })

  it("também tira quando a selecção apanhou os marcadores por dentro", () => {
    // Users who mark with the mouse often catch the asterisks too. It still means
    // remove bold, not apply it twice.
    expect(envolver("isto é **urgente**", 7, 18, "**")).toEqual({
      texto: "isto é urgente",
      inicio: 7,
      fim: 14,
    })
  })

  it("envolver e voltar a envolver devolve o texto original, para os quatro", () => {
    for (const marcador of ["**", "*", "~~", "||"] as const) {
      const original = "vai isto"
      const posto = envolver(original, 4, 8, marcador)
      const tirado = envolver(posto.texto, posto.inicio, posto.fim, marcador)
      expect(tirado.texto, marcador).toBe(original)
      expect([tirado.inicio, tirado.fim], marcador).toEqual([4, 8])
    }
  })

  it("sem selecção, deixa o par aberto e o cursor lá dentro", () => {
    // The other gesture: press Cmd+B BEFORE typing, and type already in bold.
    // Without this, the shortcut only worked for people who remembered to select
    // first.
    expect(envolver("olá ", 4, 4, "**")).toEqual({ texto: "olá ****", inicio: 6, fim: 6 })
    expect(envolver("", 0, 0, "||")).toEqual({ texto: "||||", inicio: 2, fim: 2 })
  })

  it("um itálico não confunde metade de um negrito com o seu marcador", () => {
    // `**a**` with "a" selected and Cmd+I: the outer asterisk belongs to bold.
    // Removing it left `*a*`, bold undone by a request for italic, which no one
    // asked for.
    const feito = envolver("**a**", 2, 3, "*")
    expect(feito.texto).toBe("***a***")
  })

  it("as letras de fora da selecção nunca são tocadas", () => {
    const original = "antes MEIO depois"
    for (const marcador of ["**", "*", "~~", "||"] as const) {
      const feito = envolver(original, 6, 10, marcador)
      expect(feito.texto.startsWith("antes "), marcador).toBe(true)
      expect(feito.texto.endsWith(" depois"), marcador).toBe(true)
      expect(feito.texto.replace(/[*~|]/g, ""), marcador).toBe(original)
    }
  })

  it("uma selecção às avessas é lida na mesma", () => {
    // Dragging the mouse right to left gives `selectionStart` larger than
    // `selectionEnd` on some paths. Without this, the text got cut off.
    expect(envolver("isto é urgente", 14, 7, "**").texto).toBe("isto é **urgente**")
  })
})
