import { describe, expect, it } from "vitest"
import { vazioDaConversa } from "./vazioDaConversa.js"

/**
 * The entire table, which is four entries not three: the two flags cross, and the line that matters is the bottom one, a channel with saved history AND more to load must fall into what we can still fetch, not what is no longer here.
 */
describe("porque é que uma conversa está vazia", () => {
  it("sem nada guardado e sem nada para abrir, o canal é novo neste aparelho", () => {
    expect(vazioDaConversa({ temMensagensGuardadas: false, podeCarregarAntigas: false })).toBe("nova")
  })

  it("com histórico guardado e nada para abrir, o que aqui esteve já não está", () => {
    expect(vazioDaConversa({ temMensagensGuardadas: true, podeCarregarAntigas: false })).toBe("despejado")
  })

  it("havendo mais para abrir, é isso que manda", () => {
    expect(vazioDaConversa({ temMensagensGuardadas: true, podeCarregarAntigas: true })).toBe("por-abrir")
  })

  it("e manda mesmo sem o canal ter passado pelo semeador", () => {
    // The seeder flag is set once, when the vault opens. A channel that gains history only after that keeps the flag wrong, and requiring both would force the user to write the first message over a conversation that was there beside it, waiting to be opened.
    expect(vazioDaConversa({ temMensagensGuardadas: false, podeCarregarAntigas: true })).toBe("por-abrir")
  })
})
