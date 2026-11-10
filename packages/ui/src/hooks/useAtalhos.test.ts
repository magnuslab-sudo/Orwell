import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, renderHook } from "@testing-library/react"
import { ATALHOS_POR_OMISSAO } from "../lib/atalhosDeVoz.js"
import { accaoDe, accaoDoRato, aEscrever, useAtalhos } from "./useAtalhos.js"

afterEach(cleanup)

/**
 * The shortcuts table, held without a document.
 *
 * What matters to store is the mapping between key combo and action, and that
 * is a pure function. Tying it to the `document` to test it would make the test
 * slower while proving the same thing, and would compete with modals that
 * listen to the same keys.
 */
describe("os atalhos de teclado", () => {
  it("reconhece os três, com Ctrl e com Cmd", () => {
    expect(accaoDe({ key: "m", ctrlKey: true, shiftKey: true })).toBe("alternarMicrofone")
    // On macOS the hand presses Cmd without thinking; asking for Ctrl would be a
    // shortcut nobody gets right the first time.
    expect(accaoDe({ key: "M", metaKey: true, shiftKey: true })).toBe("alternarMicrofone")
    expect(accaoDe({ key: "ArrowUp", altKey: true })).toBe("canalAnterior")
    expect(accaoDe({ key: "ArrowDown", altKey: true })).toBe("canalSeguinte")
  })

  it("não reage a teclas que alguém possa querer escrever", () => {
    /*
      The reason all three carry modifiers. A bare letter shortcut would force
      us to guess whether the cursor is in a text box, and guessing wrong once
      is enough for someone to stop trusting the keyboard.
    */
    expect(accaoDe({ key: "m" })).toBeNull()
    expect(accaoDe({ key: "M", shiftKey: true })).toBeNull()
    expect(accaoDe({ key: "ArrowUp" })).toBeNull()
    expect(accaoDe({ key: "ArrowDown" })).toBeNull()
  })

  it("não rouba as combinações vizinhas", () => {
    // Ctrl+M without Shift is something else, and arrow keys with Ctrl too.
    expect(accaoDe({ key: "m", ctrlKey: true })).toBeNull()
    expect(accaoDe({ key: "ArrowUp", ctrlKey: true })).toBeNull()
  })

  it("o Escape não é nosso: quem o trata são os modais e o menu", () => {
    // Each of them knows what to close, and Modal even tells accidental exit from
    // deliberate so it does not throw away an edit in progress. A global shortcut
    // on top of that would compete with them and add nothing.
    expect(accaoDe({ key: "Escape" })).toBeNull()
  })

  it("sabe quando alguém está a escrever", () => {
    // Today no shortcut depends on this, all three carry modifiers. It stays
    // written and tested because it is the first thing forgotten when the fourth
    // shows up.
    const input = document.createElement("input")
    const textarea = document.createElement("textarea")
    const div = document.createElement("div")
    const editavel = document.createElement("div")
    editavel.contentEditable = "true"

    expect(aEscrever(input)).toBe(true)
    expect(aEscrever(textarea)).toBe(true)
    expect(aEscrever(div)).toBe(false)
    expect(aEscrever(null)).toBe(false)
  })
})

describe("os atalhos de voz, configuráveis", () => {
  it("o mapa da pessoa manda: a mesma tecla pode mudar de dono", () => {
    const mapa = { ...ATALHOS_POR_OMISSAO, microfone: "Alt+M", som: "Mod+Shift+M" }
    expect(accaoDe({ key: "m", altKey: true }, mapa)).toBe("alternarMicrofone")
    expect(accaoDe({ key: "m", ctrlKey: true, shiftKey: true }, mapa)).toBe("alternarSom")
    expect(accaoDe({ key: "e", metaKey: true, shiftKey: true }, mapa)).toBe("alternarEcra")
    expect(accaoDe({ key: "l", ctrlKey: true, shiftKey: true }, mapa)).toBe("sairDaChamada")
  })

  it("sem tecla para falar, falar não dispara", () => {
    expect(accaoDe({ key: "F8" })).toBeNull()
    expect(accaoDe({ key: "F8" }, { ...ATALHOS_POR_OMISSAO, falar: "F8" })).toBe("falar")
  })

  it("carregar para falar: desce uma vez, não repete, e larga na tecla certa ou ao perder o foco", () => {
    const falar = vi.fn()
    renderHook(() => useAtalhos({ falar }, () => ({ ...ATALHOS_POR_OMISSAO, falar: "F8" })))

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "F8" }))
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "F8", repeat: true }))
    expect(falar.mock.calls).toEqual([[true]])

    document.dispatchEvent(new KeyboardEvent("keyup", { key: "F9" }))
    expect(falar.mock.calls).toEqual([[true]])
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "F8" }))
    expect(falar.mock.calls).toEqual([[true], [false]])

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "F8" }))
    window.dispatchEvent(new Event("blur"))
    expect(falar.mock.calls).toEqual([[true], [false], [true], [false]])
  })

  it("numa caixa de texto, o que escreve é da caixa; uma tecla de função ou Mod/Alt é atalho na mesma", () => {
    /*
      Changed in 1.0.6. Before, a function key in a text box did not fire; but
      F13 does not type anything, and muting mid-sentence is exactly when you
      need the shortcut. What does type (a letter, a `` ` ``, space) stays with
      the box.
    */
    const alternarMicrofone = vi.fn()
    const alternarSom = vi.fn()
    const falar = vi.fn()
    renderHook(() =>
      useAtalhos({ alternarMicrofone, alternarSom, falar }, () => ({ ...ATALHOS_POR_OMISSAO, falar: "F8", som: "`" })),
    )
    const caixa = document.createElement("textarea")
    document.body.appendChild(caixa)

    caixa.dispatchEvent(new KeyboardEvent("keydown", { key: "`", bubbles: true }))
    expect(alternarSom).not.toHaveBeenCalled()
    caixa.dispatchEvent(new KeyboardEvent("keydown", { key: "F8", bubbles: true }))
    expect(falar).toHaveBeenCalledWith(true)
    caixa.dispatchEvent(new KeyboardEvent("keydown", { key: "m", ctrlKey: true, shiftKey: true, bubbles: true }))
    expect(alternarMicrofone).toHaveBeenCalledTimes(1)
    caixa.remove()

    // Outside the box, the same key that types is a shortcut.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "`" }))
    expect(alternarSom).toHaveBeenCalledTimes(1)
  })

  it("uma letra sozinha serve de atalho fora das caixas de texto", () => {
    const alternarMicrofone = vi.fn()
    renderHook(() => useAtalhos({ alternarMicrofone }, () => ({ ...ATALHOS_POR_OMISSAO, microfone: "M" })))
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "m" }))
    expect(alternarMicrofone).toHaveBeenCalledTimes(1)
  })
})

describe("os botões 4 e 5 do rato (ponto 8)", () => {
  it("reconhece o botão pelo mapa", () => {
    const mapa = { ...ATALHOS_POR_OMISSAO, microfone: "Mouse4", som: "Mod+Mouse5" }
    expect(accaoDoRato({ button: 3 }, mapa)).toBe("alternarMicrofone")
    expect(accaoDoRato({ button: 4, ctrlKey: true }, mapa)).toBe("alternarSom")
    expect(accaoDoRato({ button: 4 }, mapa)).toBeNull()
    expect(accaoDoRato({ button: 0 }, mapa)).toBeNull()
  })

  it('carregar para falar com o botão 4: abre ao descer, fecha ao subir, e impede o "recuar" do browser', () => {
    const falar = vi.fn()
    renderHook(() => useAtalhos({ falar }, () => ({ ...ATALHOS_POR_OMISSAO, falar: "Mouse4" })))

    const desce = new MouseEvent("mousedown", { button: 3, cancelable: true })
    document.dispatchEvent(desce)
    expect(falar.mock.calls).toEqual([[true]])
    expect(desce.defaultPrevented).toBe(true)

    // Another button going up does not let go.
    document.dispatchEvent(new MouseEvent("mouseup", { button: 4, cancelable: true }))
    expect(falar.mock.calls).toEqual([[true]])

    const sobe = new MouseEvent("mouseup", { button: 3, cancelable: true })
    document.dispatchEvent(sobe)
    expect(falar.mock.calls).toEqual([[true], [false]])
    expect(sobe.defaultPrevented).toBe(true)

    const auxclick = new MouseEvent("auxclick", { button: 3, cancelable: true })
    document.dispatchEvent(auxclick)
    expect(auxclick.defaultPrevented).toBe(true)
  })

  it("um botão sem comando não se impede: a navegação de quem não o usa fica", () => {
    renderHook(() => useAtalhos({ falar: vi.fn() }, () => ATALHOS_POR_OMISSAO))
    const sobe = new MouseEvent("mouseup", { button: 3, cancelable: true })
    document.dispatchEvent(sobe)
    expect(sobe.defaultPrevented).toBe(false)
  })
})

describe("com atalhos globais na app de secretária", () => {
  it("o que já é global não se trata outra vez com a janela à frente", () => {
    /*
      If the system gave the key to both (global and window), the microphone
      would toggle twice and end up the same.
    */
    const alternarMicrofone = vi.fn()
    const alternarSom = vi.fn()
    renderHook(() =>
      useAtalhos(
        { alternarMicrofone, alternarSom },
        () => ATALHOS_POR_OMISSAO,
        () => new Set(["microfone"] as const),
      ),
    )
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "m", ctrlKey: true, shiftKey: true }))
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "d", ctrlKey: true, shiftKey: true }))
    expect(alternarMicrofone).not.toHaveBeenCalled()
    expect(alternarSom).toHaveBeenCalledTimes(1)
  })
})
