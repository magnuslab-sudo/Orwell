import { describe, expect, it } from "vitest"
import { ambitoDaChamada, ClientFrame } from "./wire.js"

/**
 * The scope identifier, calculated on the caller's side.
 *
 * The server VALIDATES the format (43 caracteres base64url, see `sfu.scope.join`) and
 * uses the pair `(canal, âmbito)` as the router key. The CLIENT calculates it,
 * and that's why these guarantees live here: if two clients in the same room
 * arrive at different digests, they end up in different routers and can't hear each other,  * with the call appearing connected on both sides, which is the most expensive
 * defect this layer can produce to diagnose.
 */
describe("o âmbito de uma chamada", () => {
  it("tem a forma que o esquema exige", () => {
    const ambito = ambitoDaChamada("#geral:orwell.pt", "voz")
    expect(ambito).toMatch(/^[A-Za-z0-9_-]{43}$/)

    // The real proof is not the repeated regex: it is the protocol schema
    // accepting what this function produces. Two identical regexes in different
    // places diverge the day someone changes one.
    const frame = ClientFrame.safeParse({ t: "sfu.scope.join", channel: "#geral:orwell.pt", scope: ambito })
    expect(frame.success).toBe(true)
  })

  it("dá o mesmo resumo às duas pessoas da mesma sala", () => {
    expect(ambitoDaChamada("#geral:orwell.pt", "voz")).toBe(ambitoDaChamada("#geral:orwell.pt", "voz"))
  })

  it("separa duas salas do mesmo canal", () => {
    // Without this, two voice rooms in the same channel land in the same router
    // and people in one hear the other. This is why scope exists.
    expect(ambitoDaChamada("#geral:orwell.pt", "voz")).not.toBe(ambitoDaChamada("#geral:orwell.pt", "musica"))
  })

  it("separa a sala por omissão de uma sala chamada coisa nenhuma", () => {
    // The default room is the empty string throughout `call.ts`. It must have
    // its own stable scope and not be a special case that breaks.
    expect(ambitoDaChamada("#geral:orwell.pt", "")).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(ambitoDaChamada("#geral:orwell.pt", "")).not.toBe(ambitoDaChamada("#geral:orwell.pt", "voz"))
  })

  it("separa a mesma sala em canais diferentes", () => {
    expect(ambitoDaChamada("#geral:orwell.pt", "voz")).not.toBe(ambitoDaChamada("#outro:orwell.pt", "voz"))
  })

  /**
   * The separator trap, which the gate already pays for with the length prefix.
   *
   * With `${canal}|${sala}` and nothing else, `("#a|b:x", "c")` and `("#a", "b:x|c")`
   * amount to the same thing: two different calls on the same router, and
   * people in one hearing those in the other. Channel names on this platform don't
   * include `|` today, but the design can't depend on a prohibition that isn't
   * written anywhere, and shortening the concatenation GIVES THE APPEARANCE of
   * solving it. See `chaveDeAmbito` in the gate, where this same reasoning
   * is already written.
   */
  it("não junta duas chamadas por causa do separador", () => {
    expect(ambitoDaChamada("#a|b:x", "c")).not.toBe(ambitoDaChamada("#a", "b:x|c"))
  })
})
