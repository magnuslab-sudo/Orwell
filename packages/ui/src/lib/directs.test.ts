import { moradaDeTeste } from "../../testes/moradas.js"
import { lembrarFichasDosCanais } from "./tipoDoCanal.js"
import { beforeEach, describe, expect, it } from "vitest"
import type { ChatMessage } from "../types.js"
import {
  closeDirect,
  listDirects,
  readClosedDirects,
  reopenDirect,
  writeClosedDirects,
  type ClosedDirects,
} from "./directs.js"

const MEU_FEED = moradaDeTeste("mural eu", "orwell.pt")
// The sheet for each channel (1.0 "Arca", slice 6b): no sheet, a channel is a room.
beforeEach(() =>
  lembrarFichasDosCanais({
    [CONVERSA]: { tipo: "directa", par: "@zz-yy-xx-ww:orwell.pt" },
    [OUTRA]: { tipo: "directa", par: "@mm-nn-oo-pp:orwell.pt" },
    [MEU_FEED]: { tipo: "mural", dono: "@aa-bb-cc-dd:orwell.pt" },
  }),
)

const EU = "@aa-bb-cc-dd:orwell.pt"
const ELA = "@zz-yy-xx-ww:orwell.pt"
/** The identifier includes both sides, in order. See `dmPeerAddress`. */
const CONVERSA = moradaDeTeste("directa eu zz", "orwell.pt")
const OUTRA = moradaDeTeste("directa eu mm", "orwell.pt")

function fala(channel: string, sender: string, body: string, sentAt: number): ChatMessage {
  return { channel, seq: sentAt, sender, payload: { t: "message", body, sentAt } }
}

describe("as conversas directas que se listam", () => {
  it("mostra uma conversa que nunca foi fechada, com o começo da última fala", () => {
    const entradas = listDirects([CONVERSA], [fala(CONVERSA, ELA, "olá", 10)], {}, EU, null)
    expect(entradas).toHaveLength(1)
    expect(entradas[0]).toMatchObject({ channel: CONVERSA, peer: ELA, lastAt: 10, preview: "olá", minha: false })
  })

  it("deixa de fora tudo o que não é uma conversa directa", () => {
    // The entire separation depends on this line: a channel is a group with rooms and
    // roles, a direct conversation is a person, and the Friends column only knows how
    // to draw the second.
    const entradas = listDirects(["!geral:orwell.pt", MEU_FEED, CONVERSA], [], {}, EU, null)
    expect(entradas.map((entrada) => entrada.channel)).toEqual([CONVERSA])
  })

  it("põe em cima quem falou por último", () => {
    const messages = [fala(CONVERSA, ELA, "primeiro", 10), fala(OUTRA, EU, "depois", 20)]
    const entradas = listDirects([CONVERSA, OUTRA], messages, {}, EU, null)
    expect(entradas.map((entrada) => entrada.channel)).toEqual([OUTRA, CONVERSA])
  })

  it("diz quando a última fala é minha", () => {
    const entradas = listDirects([CONVERSA], [fala(CONVERSA, EU, "vou já", 10)], {}, EU, null)
    expect(entradas[0]?.minha).toBe(true)
  })

  it("um pedido de amizade traz a conversa para a lista, e para cima", () => {
    /*
      Only messages counted, and a friend request is not one: it arrived at the
      direct conversation but the conversation did not rise, gained no line, and if
      closed it would not even reappear. A request that arrives somewhere nobody sees
      is a request that never arrived.
    */
    const pedido: ChatMessage = { channel: OUTRA, seq: 20, sender: ELA, payload: { t: "friend.request", sentAt: 20 } }
    const entradas = listDirects([CONVERSA, OUTRA], [fala(CONVERSA, ELA, "olá", 10), pedido], {}, EU, null)
    expect(entradas.map((entrada) => entrada.channel)).toEqual([OUTRA, CONVERSA])
    // Without a body there is no preview: the line puts a label in its place, and this
    // marker tells the UI so.
    expect(entradas[0]).toMatchObject({ pedido: true, preview: "" })
    expect(entradas[1]?.pedido).toBe(false)
  })

  it("um convite para um canal entra pela porta das mensagens, que é o que ele é", () => {
    // The invite travels INSIDE a message, see `ChannelInvite` in the protocol, so it
    // needs no special case here: it rises, shows the body, and reopens the conversation
    // like anything else said.
    const convite: ChatMessage = {
      channel: OUTRA,
      seq: 30,
      sender: ELA,
      payload: {
        t: "message",
        body: 'Convido-te para "Lagar do Zé".',
        sentAt: 30,
        invite: { channel: "!lagar:orwell.pt", name: "Lagar do Zé", at: 30 },
      },
    }
    const entradas = listDirects([CONVERSA, OUTRA], [fala(CONVERSA, ELA, "olá", 10), convite], {}, EU, null)
    expect(entradas[0]).toMatchObject({ channel: OUTRA, preview: 'Convido-te para "Lagar do Zé".', pedido: false })
  })

  it("lista uma conversa ainda sem uma única mensagem", () => {
    // Opening a conversation with someone and saying nothing is the normal case in the
    // first second. Without this, clicking "send message" opened a conversation that
    // appeared nowhere.
    const entradas = listDirects([CONVERSA], [], {}, EU, null)
    expect(entradas).toHaveLength(1)
    expect(entradas[0]).toMatchObject({ lastAt: 0, preview: "" })
  })
})

describe("fechar uma conversa esconde-a sem a apagar", () => {
  it("uma conversa fechada sai da lista", () => {
    const fechadas = closeDirect({}, CONVERSA, [fala(CONVERSA, ELA, "olá", 10)])
    expect(listDirects([CONVERSA], [fala(CONVERSA, ELA, "olá", 10)], fechadas, EU, null)).toEqual([])
  })

  it("volta sozinha assim que lhe chegar mensagem nova", () => {
    // This is what makes closing a gesture without regret: there is nothing to undo,
    // because whoever writes brings the conversation back.
    const messages = [fala(CONVERSA, ELA, "olá", 10)]
    const fechadas = closeDirect({}, CONVERSA, messages)
    const depois = [...messages, fala(CONVERSA, ELA, "ainda aí?", Date.now() + 5_000)]
    expect(listDirects([CONVERSA], depois, fechadas, EU, null)).toHaveLength(1)
  })

  it("não esconde a conversa que está aberta à frente da pessoa", () => {
    // Closing what you are reading would make the line vanish under the cursor, and that
    // reads as a bug, not a choice.
    const fechadas = closeDirect({}, CONVERSA, [])
    expect(listDirects([CONVERSA], [], fechadas, EU, CONVERSA)).toHaveLength(1)
  })

  it("fechar carimba à frente de um relógio adiantado", () => {
    // Without this, a conversation from someone with the clock ahead would reappear the
    // instant after closing, and there was no way to close it at all.
    const futuro = Date.now() + 3_600_000
    const messages = [fala(CONVERSA, ELA, "do futuro", futuro)]
    const fechadas = closeDirect({}, CONVERSA, messages)
    expect(fechadas[CONVERSA]).toBeGreaterThanOrEqual(futuro)
    expect(listDirects([CONVERSA], messages, fechadas, EU, null)).toEqual([])
  })

  it("reabrir tira a marca", () => {
    const fechadas = closeDirect({}, CONVERSA, [])
    expect(listDirects([CONVERSA], [], reopenDirect(fechadas, CONVERSA), EU, null)).toHaveLength(1)
  })

  it("reabrir o que não estava fechado devolve o mesmo objecto", () => {
    const fechadas: ClosedDirects = {}
    expect(reopenDirect(fechadas, CONVERSA)).toBe(fechadas)
  })
})

describe("a memória de quais estão fechadas", () => {
  function armazenamento(raw: string | null): Pick<Storage, "getItem"> {
    return { getItem: () => raw }
  }

  it("lê o que lá está", () => {
    expect(readClosedDirects(armazenamento(`{"${CONVERSA}":7}`))).toEqual({ [CONVERSA]: 7 })
  })

  it("aguenta chave em falta, JSON partido e lixo", () => {
    expect(readClosedDirects(armazenamento(null))).toEqual({})
    expect(readClosedDirects(armazenamento("{"))).toEqual({})
    expect(readClosedDirects(armazenamento("[1,2]"))).toEqual({})
    expect(readClosedDirects(armazenamento(`{"${CONVERSA}":"ontem"}`))).toEqual({})
  })

  it("não deita a sessão abaixo se o armazenamento recusar escrever", () => {
    // Private mode, quota full: the list stays correct until the window closes, which is
    // much better than a blank screen.
    expect(() =>
      writeClosedDirects({ [CONVERSA]: 1 }, {
        setItem: () => {
          throw new Error("cheio")
        },
      }),
    ).not.toThrow()
  })
})
