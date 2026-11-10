import { moradaDeTeste } from "../../testes/moradas.js"
import { lembrarFichasDosCanais } from "./tipoDoCanal.js"
import { beforeEach, describe, expect, it } from "vitest"
import { INVITE_TTL_MS } from "@enclave/protocol"
import type { ChatMessage } from "../types.js"
import { aceitesAEspera, convitesDe } from "./convites.js"

// The sheet for each channel (1.0 "Arca", slice 6b): no sheet, a channel is a room.
beforeEach(() => lembrarFichasDosCanais({ [DM]: { tipo: "directa", par: "@ana:s" } }))

/*
  Accepted invites waiting for a slot, shown gray in the sidebar.
  The cuts matter: a "waiting" line for a channel we are already in, or have
  left, would be a lie.
*/

const EU = "@eu:s"
const ANA = "@ana:s"
const DM = moradaDeTeste("directa ana eu", "s")
const ALVO = "!clube:s"
const AGORA = 1_000_000_000

function convite(at = AGORA - 1000): ChatMessage {
  return { channel: DM, seq: 1, sender: ANA, payload: { t: "message", invite: { channel: ALVO, name: "Clube", at } } }
}

function aceite(at = AGORA - 500): ChatMessage {
  return { channel: DM, seq: 2, sender: EU, payload: { t: "message", inviteReply: { channel: ALVO, accepted: true, at } } }
}

describe("aceitesAEspera", () => {
  it("um convite aceite cujo canal ainda não chegou está à espera, com o nome que o convite dizia", () => {
    const lista = aceitesAEspera(convitesDe([convite(), aceite()], EU, AGORA), [], new Map())
    expect(lista).toHaveLength(1)
    expect(lista[0]?.target).toBe(ALVO)
    expect(lista[0]?.name).toBe("Clube")
  })

  it("um convite por responder não está à espera de entrada: está à espera de mim", () => {
    expect(aceitesAEspera(convitesDe([convite()], EU, AGORA), [], new Map())).toEqual([])
  })

  it("quando o canal chega, a linha sai", () => {
    expect(aceitesAEspera(convitesDe([convite(), aceite()], EU, AGORA), [ALVO], new Map())).toEqual([])
  })

  it('um canal onde já se esteve (arquivado, ou visto nesta sessão) não volta como "à espera"', () => {
    expect(aceitesAEspera(convitesDe([convite(), aceite()], EU, AGORA), [], new Map([[ALVO, AGORA]]))).toEqual([])
  })

  it("um convite NOVO depois da última vez que lá se esteve volta a esperar-se", () => {
    // We were in the channel before the invite (the channel time is earlier than the invite time).
    const lista = aceitesAEspera(convitesDe([convite(), aceite()], EU, AGORA), [], new Map([[ALVO, AGORA - 5000]]))
    expect(lista).toHaveLength(1)
  })

  it("passado o prazo do convite, deixa de se esperar (a dobra diz caducado)", () => {
    const velho = AGORA - INVITE_TTL_MS - 1
    expect(aceitesAEspera(convitesDe([convite(velho), aceite(velho + 1)], EU, AGORA), [], new Map())).toEqual([])
  })
})
