import { describe, expect, it } from "vitest"
import { EMBAIXADORES, ehEmbaixador } from "./embaixadores.js"

/**
 * The ambassador badge depends only on this response. If it errs toward yes, any
 * account wears the badge; if it errs toward no, the owner publishes a name and it
 * does not show.
 */
describe("ehEmbaixador", () => {
  const lista = new Set(["@ana-7f3a:orwell.pt"])

  it("diz sim ao endereço que está na lista", () => {
    expect(ehEmbaixador("@ana-7f3a:orwell.pt", lista)).toBe(true)
  })

  it("diz não a um endereço que não está", () => {
    expect(ehEmbaixador("@rui-1b2c:orwell.pt", lista)).toBe(false)
  })

  it("não se deixa imitar por um endereço parecido", () => {
    // The same name on another server, another account with the same name, and the address
    // with another domain: none of them is the ambassador.
    expect(ehEmbaixador("@ana-7f3a:outro.pt", lista)).toBe(false)
    expect(ehEmbaixador("@ana-9999:orwell.pt", lista)).toBe(false)
    expect(ehEmbaixador("@ANA-7F3A:orwell.pt", lista)).toBe(false)
    expect(ehEmbaixador("ana-7f3a", lista)).toBe(false)
  })

  it("diz não quando não há endereço", () => {
    expect(ehEmbaixador(null, lista)).toBe(false)
    expect(ehEmbaixador(undefined, lista)).toBe(false)
    expect(ehEmbaixador("", lista)).toBe(false)
  })

  it("a lista publicada só tem endereços completos", () => {
    // A bare name ("ana") never matches any address, and the badge stayed unshown with no
    // error visible. This catches it the day the owner adds the first one.
    for (const endereco of EMBAIXADORES) expect(endereco).toMatch(/^@[^:\s]+:[^:\s]+/)
  })
})
