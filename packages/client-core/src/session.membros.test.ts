import { describe, expect, it } from "vitest"
import { chegouAlguemNovo, type MembrosVistos } from "./session.js"

/**
 * The question that triggers republishing the profile in a channel, measured.
 *
 * Someone who just joined a channel cannot decrypt anything said there: by forward secrecy,
 * everything that describes it, who founded it, what rooms it has, what people are called,  * was encrypted in epochs they will never have. The fix is to republish those four things
 * when someone joins, and it is `chegouAlguemNovo` that decides someone joined.
 *
 * It used to decide by the TOTAL leaf count of the tree, and "the total did not go up" read as
 * "nobody joined". They are different things, and the difference costs a name:
 * `publishedProfileAt` marks the profile as published in that channel and
 * `publishProfile` without `force` skips it, so someone who joined without the total going up
 * stayed seeing the first word of everyone's address, forever, with nothing in the system
 * to change it.
 *
 * This is deliberate, like `surdezConfirmada`: the decision lives outside the session
 * so it can be asked directly, instead of inferred from a profile that appeared or did not
 * appear in the feed.
 */

const vistos = (enderecos: string[], folhas = enderecos.length): MembrosVistos => ({
  folhas,
  enderecos: new Set(enderecos),
})

describe("chegouAlguemNovo", () => {
  it("sem memória nenhuma responde sim: é a direcção certa de estar errado", () => {
    // The first epoch after the app opens. This does not go in the vault,
    // and the cost of republishing one more time is a profile; the cost of
    // republishing less is someone with no name forever.
    expect(chegouAlguemNovo(undefined, ["@ana:s", "@bento:s"])).toBe(true)
  })

  it("um endereço novo é alguém novo, mesmo com a árvore do mesmo tamanho", () => {
    // The defect. An exit and an entry in the same commit leave the leaves there were,
    // and Carlos stayed seeing Ana's address.
    expect(chegouAlguemNovo(vistos(["@ana:s", "@bento:s"]), ["@ana:s", "@carlos:s"])).toBe(true)
  })

  it("e com a árvore MENOR, que é o caso que o total nunca podia apanhar", () => {
    // Two of Bento's devices left and Carlos came in: three leaves become two,
    // the total went down, and someone joined who never saw our profile.
    expect(chegouAlguemNovo(vistos(["@ana:s", "@bento:s"], 3), ["@ana:s", "@carlos:s"])).toBe(true)
  })

  it("uma saída sozinha não é entrada de ninguém", () => {
    // The contrast that keeps this from being a "yes" to everything. Republishing on every
    // epoch change once put 124 KB of profile per channel and per person, almost the entire
    // database of a live server.
    expect(chegouAlguemNovo(vistos(["@ana:s", "@bento:s"]), ["@ana:s"])).toBe(false)
  })

  it("nem uma rotação de chave, que muda a epoch e não a composição", () => {
    expect(chegouAlguemNovo(vistos(["@ana:s", "@bento:s"]), ["@ana:s", "@bento:s"])).toBe(false)
  })

  it("um aparelho novo de quem já cá estava conta como entrada", () => {
    // Intentional, even though the vault does not change: a device paired weeks ago
    // brings the vault from then, and it may not have our profile. This is the
    // behavior that already existed in total, and we don't lose it in the swap.
    expect(chegouAlguemNovo(vistos(["@ana:s", "@bento:s"]), ["@ana:s", "@bento:s", "@bento:s"])).toBe(true)
  })

  it("e um aparelho a menos não conta como entrada", () => {
    expect(chegouAlguemNovo(vistos(["@ana:s", "@bento:s", "@bento:s"]), ["@ana:s", "@bento:s"])).toBe(false)
  })

  it("um canal que fica só com quem o lê não republica nada", () => {
    expect(chegouAlguemNovo(vistos(["@ana:s"]), ["@ana:s"])).toBe(false)
  })
})
