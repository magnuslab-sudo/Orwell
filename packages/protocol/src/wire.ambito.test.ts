import { describe, expect, it } from "vitest"
import { ambitoDaChamada, ClientFrame } from "./wire.js"

/**
 * The scope identifier, on the side that computes it.
 *
 * The server VALIDATES the format (43 base64url characters, see `sfu.scope.join`) and
 * uses the pair `(canal, âmbito)` as the router key. The CLIENT computes it,
 * and that's why these guarantees live here: if two clients in the same room
 * arrive at different digests, they end up in different routers and can't hear each other,
 * with the call showing as connected on both sides, which is the most expensive
 * defect to diagnose that this layer can produce.
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
   * The separator trap, which the gateway already avoids with the length prefix.
   *
   * With `${canal}|${sala}` and nothing else, `("#a|b:x", "c")` and `("#a", "b:x|c")`
   * hash to the same thing: two different calls on the same router, and
   * people in one hearing those in the other. Channel names on this platform don't
   * include `|` today, but the design can't depend on a prohibition that isn't
   * written anywhere, and hashing the concatenation only LOOKS like it solves
   * it. See `chaveDeAmbito` in the gateway, where this same reasoning
   * is already written.
   */
  it("não junta duas chamadas por causa do separador", () => {
    expect(ambitoDaChamada("#a|b:x", "c")).not.toBe(ambitoDaChamada("#a", "b:x|c"))
  })
})
