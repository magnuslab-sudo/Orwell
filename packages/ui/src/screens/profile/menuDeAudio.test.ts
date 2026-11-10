import { describe, expect, it, vi } from "vitest"
import { itensDoMicrofone, itensDoSom } from "./menuDeAudio.js"
import { strings } from "../../strings.js"

/**
 * What the microphone arrow offers, and most of all what it does NOT offer.
 *
 * The house rule is that what you cannot do does not show, and never shows
 * greyed out. In a device menu that has a concrete and non-obvious consequence:
 * `enumerateDevices()` always responds, but only puts a NAME on devices after
 * someone grants microphone access once. Before that the list exists but is
 * unreadable, and listing it like this would offer a choice you cannot make,
 * which is the same as a greyed button in another form.
 */

const NADA = { abrirDefinicoes: () => {}, abrirConta: () => {} }

describe("o menu do microfone", () => {
  it("sem nomes, não lista aparelhos nenhuns — oferece o caminho para os escolher", () => {
    const abrirDefinicoes = vi.fn()
    const itens = itensDoMicrofone({
      // There are devices, and that is the point: they exist and are unreadable.
      microfones: [
        { deviceId: "abc", label: "" },
        { deviceId: "def", label: "" },
      ],
      nomeados: false,
      escolhido: "",
      escolher: () => {},
      ...NADA,
      abrirDefinicoes,
    })

    expect(itens.map((item) => item.label)).toEqual([
      strings.call.inputDevicePick,
      strings.call.inputVolume,
      strings.call.audioSettings,
    ])
    // The account is NOT here, and that is on purpose: you reach it through the
    // identity on the same card. An entry that shows in three places tells you none
    // of them is the right place. Owner decision on August 19, 2026.
    expect(itens.some((item) => item.label === "A minha conta…")).toBe(false)
    // And the entry that is there actually leads somewhere.
    itens[0]?.onSelect()
    expect(abrirDefinicoes).toHaveBeenCalledTimes(1)
  })

  it("com nomes, lista-os e marca o que está escolhido", () => {
    const itens = itensDoMicrofone({
      microfones: [
        { deviceId: "abc", label: "Auscultadores USB" },
        { deviceId: "def", label: "Microfone do portátil" },
      ],
      nomeados: true,
      escolhido: "def",
      escolher: () => {},
      ...NADA,
    })

    const listados = itens.map((item) => item.label)
    // The omission first, always: it is the only entry that works on any device,
    // and it is where you go back when the chosen one disappears.
    expect(listados[0]).toContain(strings.call.inputDeviceDefault)
    expect(listados[1]).toContain("Auscultadores USB")
    expect(listados[2]).toContain("Microfone do portátil")
    // One badge, and only one: a menu with two badges does not say where you are.
    expect(listados.filter((label) => label.startsWith("✓"))).toHaveLength(1)
    expect(listados[2]?.startsWith("✓")).toBe(true)
  })

  it("sem escolha guardada, a marca fica na omissão", () => {
    const itens = itensDoMicrofone({
      microfones: [{ deviceId: "abc", label: "Auscultadores USB" }],
      nomeados: true,
      escolhido: "",
      escolher: () => {},
      ...NADA,
    })
    expect(itens[0]?.label.startsWith("✓")).toBe(true)
  })

  it("escolher um aparelho devolve o identificador dele, e a omissão devolve vazio", () => {
    const escolher = vi.fn()
    const itens = itensDoMicrofone({
      microfones: [{ deviceId: "abc", label: "Auscultadores USB" }],
      nomeados: true,
      escolhido: "abc",
      escolher,
      ...NADA,
    })
    itens[1]?.onSelect()
    expect(escolher).toHaveBeenLastCalledWith("abc")
    // Empty, not a "default" identifier: that is an alias that changes when the
    // system changes its default. See `useMicrofones`.
    itens[0]?.onSelect()
    expect(escolher).toHaveBeenLastCalledWith("")
  })

  it("nenhuma entrada é inerte: todas levam a algum lado", () => {
    const itens = itensDoMicrofone({
      microfones: [{ deviceId: "abc", label: "Auscultadores USB" }],
      nomeados: true,
      escolhido: "",
      escolher: () => {},
      ...NADA,
    })
    // `MenuItem` does not even have a disabled state, and that is on purpose, but
    // an entry with an empty `onSelect` would be the same greyed out in another
    // form. Each one calls someone.
    expect(itens.every((item) => typeof item.onSelect === "function")).toBe(true)
    expect(itens.length).toBeGreaterThan(0)
  })
})

describe("o menu do som", () => {
  it("não oferece escolha de altifalante, porque o produto não a sabe aplicar", () => {
    const itens = itensDoSom(NADA)
    expect(itens.map((item) => item.label)).toEqual([
      strings.call.notificationVolume,
      strings.call.audioSettings,
    ])
    expect(itens.some((item) => item.label === "A minha conta…")).toBe(false)
    // A list of outputs that does not change the sound coming out is worse than
    // no list: the person chooses, hears no difference, and stops trusting the
    // rest of the menu.
    expect(itens.some((item) => item.label.toLowerCase().includes("altifalante"))).toBe(false)
  })

  it("cada entrada leva a quem a atende", () => {
    const abrirDefinicoes = vi.fn()
    const abrirConta = vi.fn()
    const itens = itensDoSom({ abrirDefinicoes, abrirConta })
    for (const item of itens) item.onSelect()
    expect(abrirDefinicoes).toHaveBeenCalledTimes(2)
    // Zero, and that is the entire statement of this line: the account left this
    // menu, and `abrirConta` stays in the contract because the card uses it.
    expect(abrirConta).toHaveBeenCalledTimes(0)
  })
})
