import { afterEach, describe, expect, it } from "vitest"
import { convitesDe } from "./convites.js"
import { admiteAdministracao, dmPeerAddress, feedChannelOf, feedOwnerOf, isDirect, isFeed } from "./format.js"
import { lembrarFichasDosCanais, tipoNaInterface } from "./tipoDoCanal.js"
import type { ChatMessage } from "../types.js"

/**
 * The interface asks the channel type from the vault cards (1.0 "Vault", slice 2).
 *
 * Opaque addresses on purpose: if the interface still read the form, an address
 * with no `!dm-` or `!feed-` was always a room, and these tests would fail.
 */

const EU = "@ana:orwell.pt"
const BENTO = "@bento:orwell.pt"
const DIRECTA = "!abcdefghijklmnopqrstuvwxyz234567abcdefgh:orwell.pt"
const MURAL = "!hgfedcbaabcdefghijklmnopqrstuvwxyz234567:orwell.pt"
const SALA = "!lagar:orwell.pt"

afterEach(() => lembrarFichasDosCanais({}))

describe("o tipo do canal na interface", () => {
  it("uma morada opaca é o que a ficha diz: directa com par, mural com dono", () => {
    lembrarFichasDosCanais({
      [DIRECTA]: { tipo: "directa", par: BENTO },
      [MURAL]: { tipo: "mural", dono: BENTO },
    })
    expect(isDirect(DIRECTA)).toBe(true)
    expect(dmPeerAddress(DIRECTA, EU)).toBe(BENTO)
    expect(admiteAdministracao(DIRECTA)).toBe(false)
    expect(isFeed(MURAL)).toBe(true)
    expect(feedOwnerOf(MURAL)).toBe(BENTO)
    expect(isDirect(SALA)).toBe(false)
  })

  it("sem ficha, um canal é uma sala, tenha a forma que tiver (fatia 3: a porta antiga fechou)", () => {
    expect(tipoNaInterface(DIRECTA)).toBe("sala")
    expect(dmPeerAddress("!dm-ana.bento:orwell.pt", EU)).toBeNull()
    expect(feedOwnerOf("!feed-bento:orwell.pt")).toBe("")
    expect(isDirect("!dm-ana.bento:orwell.pt")).toBe(false)
  })

  it("o mural de alguém sai da ficha, e não do endereço", () => {
    expect(feedChannelOf(BENTO)).toBe("")
    lembrarFichasDosCanais({ [MURAL]: { tipo: "mural", dono: BENTO } })
    expect(feedChannelOf(BENTO)).toBe(MURAL)
  })

  it("a ficha vence a forma: um `!dm-` que o cofre diz ser sala não tem par", () => {
    lembrarFichasDosCanais({ "!dm-ana.bento:orwell.pt": { tipo: "sala" } })
    expect(isDirect("!dm-ana.bento:orwell.pt")).toBe(false)
    expect(dmPeerAddress("!dm-ana.bento:orwell.pt", EU)).toBeNull()
  })

  it("um convite meu numa directa opaca é para o par da ficha", () => {
    lembrarFichasDosCanais({ [DIRECTA]: { tipo: "directa", par: BENTO } })
    const convite = {
      channel: DIRECTA,
      sender: EU,
      payload: { t: "message", invite: { channel: SALA, name: "Lagar", at: 1 } },
    } as unknown as ChatMessage
    const { ties } = convitesDe([convite], EU, 2)
    expect([...ties.values()].map((tie) => tie.peer)).toEqual([BENTO])
  })
})
