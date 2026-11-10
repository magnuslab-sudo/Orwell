import { moradaDeTeste } from "../../testes/moradas.js"
import { lembrarFichasDosCanais } from "../lib/tipoDoCanal.js"
import { beforeEach, describe, expect, it } from "vitest"
import type { AppNotification } from "../lib/notifications.js"
import { mencionaMe } from "../lib/mentions.js"
import { caladoPelaPausa, somDaMensagem, somDaNotificacao, somDoCanal, somDoSilencio, tocaOToque, type MensagemParaSom, type QuemDoTicket } from "./acontecimentos.js"
import type { TipoDeSom } from "./familia.js"

const FEED_DA_ANA = moradaDeTeste("mural ana", "casa.pt")
// The sheet for each channel (1.0 "Arca", slice 6b): no sheet, a channel is a room.
beforeEach(() =>
  lembrarFichasDosCanais({
    [DM]: { tipo: "directa" },
    [FEED_DA_ANA]: { tipo: "mural", dono: "@ana:casa.pt" },
  }),
)

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const SALA = "!lagar:casa.pt"
const DM = moradaDeTeste("directa ana eu", "casa.pt")

describe("o som de cada entrada do sino", () => {
  /**
   * Exhaustive on purpose: written as `Record<kind, …>`, a new sound type stops
   * compiling here until someone decides what it sounds like.
   */
  it("cada tipo tem o seu som, e a entrada por convite não tem nenhum", () => {
    const esperado: Record<AppNotification["kind"], TipoDeSom | null> = {
      "dm-message": "directa",
      "dm-new": "directa",
      mention: "mencao",
      "room-added": "mencao",
      "friend-request": "pedido",
      "friend-accept": "aceite",
      "channel-join": null,
      // The ring already played while the call was ringing.
      "missed-call": null,
      // A report in my channel goes to the bell, silent.
      "report-copy": null,
      "report-decision": null,
    }
    for (const [kind, som] of Object.entries(esperado)) {
      expect(somDaNotificacao(kind as AppNotification["kind"]), kind).toBe(som)
    }
  })
})

describe("o som de uma mensagem que não entra no sino", () => {
  const nenhumTicket: QuemDoTicket = () => null
  const mensagem = (over: Partial<MensagemParaSom> & { payload?: MensagemParaSom["payload"] } = {}): MensagemParaSom => ({
    channel: SALA,
    sender: ANA,
    payload: { t: "message" },
    ...over,
  })

  it("uma mensagem qualquer numa sala de grupo não faz som", () => {
    expect(somDaMensagem(mensagem(), EU, nenhumTicket)).toBeNull()
  })

  it("um ticket novo toca para quem está na sala", () => {
    const novo = mensagem({ payload: { t: "message", ticket: { id: "t1", subject: "Não entra", at: 1 } } })
    expect(somDaMensagem(novo, EU, nenhumTicket)).toBe("ticket")
  })

  it("uma resposta toca a quem abriu o ticket e a quem o atende", () => {
    const resposta = mensagem({ payload: { t: "message", ticket: { id: "t1", at: 2 } } })
    expect(somDaMensagem(resposta, EU, () => ({ opener: EU, assignee: "" }))).toBe("ticket")
    expect(somDaMensagem(resposta, EU, () => ({ opener: ANA, assignee: EU }))).toBe("ticket")
  })

  it("uma resposta num ticket dos outros não é comigo", () => {
    const resposta = mensagem({ payload: { t: "message", ticket: { id: "t1", at: 2 } } })
    expect(somDaMensagem(resposta, EU, () => ({ opener: ANA, assignee: "@rui:casa.pt" }))).toBeNull()
    expect(somDaMensagem(resposta, EU, nenhumTicket)).toBeNull()
  })

  it("um ticket meu não toca para mim", () => {
    const novo = mensagem({ sender: EU, payload: { t: "message", ticket: { id: "t1", subject: "x", at: 1 } } })
    expect(somDaMensagem(novo, EU, nenhumTicket)).toBeNull()
  })

  it("um ticket que me menciona toca uma vez, pela menção, e não duas", () => {
    const novo = mensagem({ payload: { t: "message", mentions: [EU], ticket: { id: "t1", subject: "x", at: 1 } } })
    expect(somDaMensagem(novo, EU, nenhumTicket)).toBeNull()
  })

  it("uma publicação no mural de um amigo toca o som da publicação", () => {
    const feed = FEED_DA_ANA
    expect(somDaMensagem(mensagem({ channel: feed, payload: { t: "post" } }), EU, nenhumTicket)).toBe("publicacao")
    // A post of mine does not ring for me.
    expect(somDaMensagem(mensagem({ channel: feed, sender: EU, payload: { t: "post" } }), EU, nenhumTicket)).toBeNull()
  })

  it("uma directa não passa por aqui: vem do sino", () => {
    expect(somDaMensagem(mensagem({ channel: DM }), EU, nenhumTicket)).toBeNull()
  })
})

describe("o toque da chamada", () => {
  /*
    Owner request (2 November 2026, point 7): the ring is only for private
    messages. In a voice room of a community nobody calls anyone: whoever enters
    shows up in the room roster, and that is all.
  */
  it("toca só numa conversa privada, nunca numa sala de uma comunidade", () => {
    expect(tocaOToque(DM)).toBe(true)
    expect(tocaOToque(SALA)).toBe(false)
  })
})

describe("a pausa das Notificações", () => {
  it("cala tudo menos os sons das chamadas, até à hora de fim", () => {
    for (const tipo of ["directa", "mencao", "pedido", "aceite", "cotovelada", "ticket", "publicacao"] as const) {
      expect(caladoPelaPausa(tipo, 2000, 1000)).toBe(true)
      expect(caladoPelaPausa(tipo, 2000, 2000)).toBe(false)
      expect(caladoPelaPausa(tipo, undefined, 1000)).toBe(false)
    }
    for (const tipo of ["chamada", "entrou", "saiu", "ligado"] as const) expect(caladoPelaPausa(tipo, 2000, 1000)).toBe(false)
    // The mute sounds respond to a gesture now: the pause does not silence them.
    for (const tipo of ["mic-silenciado", "mic-ligado", "tudo-silenciado", "tudo-ligado"] as const)
      expect(caladoPelaPausa(tipo, 2000, 1000)).toBe(false)
  })
})

describe("o som do silenciar (ponto 3)", () => {
  const solto = { micMuted: false, soundOff: false }
  it("o microfone: um som ao calar, outro ao voltar", () => {
    expect(somDoSilencio(solto, { micMuted: true, soundOff: false })).toBe("mic-silenciado")
    expect(somDoSilencio({ micMuted: true, soundOff: false }, solto)).toBe("mic-ligado")
  })

  it('"silenciar tudo" manda sobre o microfone, nos dois sentidos', () => {
    expect(somDoSilencio(solto, { micMuted: false, soundOff: true })).toBe("tudo-silenciado")
    // Clicking the mic with everything muted brings both back: it is the
    // "mute all" that ends, and that is its sound.
    expect(somDoSilencio({ micMuted: true, soundOff: true }, solto)).toBe("tudo-ligado")
  })

  it("sem mudança, sem som", () => {
    expect(somDoSilencio(solto, solto)).toBeNull()
  })
})

/**
 * Answer (4/11/2026): "@ Mention" on puts the author of the original in
 * `mentions`, and the reply is a mention like any other: silences the channel
 * sound and rings the mention through the bell. Off, it is a normal message, and
 * rings the channel sound. No new rule: it is the `replyTo` that changes nothing
 * here.
 */
describe("o som de uma resposta", () => {
  const resposta = (mentions: string[]): MensagemParaSom => ({
    channel: SALA,
    sender: ANA,
    aoVivo: true,
    payload: { t: "message", replyTo: "original-0001", mentions } as MensagemParaSom["payload"],
  })

  it("com a menção ligada, conta como menção: o som do canal cala-se, e toca o da menção", () => {
    expect(somDoCanal(resposta([EU]), EU)).toBeNull()
    expect(mencionaMe(resposta([EU]).payload.mentions as string[], EU)).toBe(true)
    expect(somDaNotificacao("mention")).toBe("mencao")
  })

  it("com a menção desligada, é uma mensagem normal: toca o som do canal", () => {
    expect(mencionaMe(resposta([]).payload.mentions as string[], EU)).toBe(false)
    expect(somDoCanal(resposta([]), EU)).toBe("canal")
  })

  it("uma resposta a outra pessoa, com a menção dela, não me menciona", () => {
    expect(mencionaMe(resposta(["@bruno:casa.pt"]).payload.mentions as string[], EU)).toBe(false)
    expect(somDoCanal(resposta(["@bruno:casa.pt"]), EU)).toBe("canal")
  })
})
