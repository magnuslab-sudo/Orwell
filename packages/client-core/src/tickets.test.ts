import { describe, expect, it } from "vitest"
import type { StoredChatMessage } from "./vault.js"
import { ticketsOf, ticketThread } from "./tickets.js"

const SALA = "forum-abc-def"

/** A ticket message as it arrives in the vault. */
function linha(
  sender: string,
  at: number,
  ticket: Record<string, unknown>,
  body = ".",
  room: string = SALA,
): StoredChatMessage {
  return {
    seq: at,
    sender,
    at,
    payload: { t: "message", room, id: `m-${sender}-${at}`, sentAt: at, body, ticket },
  }
}

/** Who attends, for tests that are not about who attends. */
const qualquerUm = (): boolean => true
const ninguem = (): boolean => false

describe("o quadro de tickets, tal como ele se lê", () => {
  it("um ticket aberto mostra o assunto, quem o abriu e a hora", () => {
    const quadro = ticketsOf(
      [linha("@ana:s", 10, { id: "t1", subject: "Impressora avariada", state: "open", at: 10 })],
      SALA,
      qualquerUm,
    )
    expect(quadro).toHaveLength(1)
    expect(quadro[0]).toMatchObject({
      id: "t1",
      subject: "Impressora avariada",
      state: "open",
      opener: "@ana:s",
      assignee: "",
      openedAt: 10,
    })
  })

  it("as respostas contam-se, e a última mexida é a que se vê", () => {
    // What the list needs to show for someone to pick where to find it: where
    // there was a chat, and when was the last time.
    const quadro = ticketsOf(
      [
        linha("@ana:s", 10, { id: "t1", subject: "Impressora", state: "open", at: 10 }),
        linha("@ana:s", 20, { id: "t1", at: 20 }, "e agora fuma"),
        linha("@bento:s", 30, { id: "t1", at: 30 }, "vou já"),
      ],
      SALA,
      qualquerUm,
    )
    expect(quadro[0]).toMatchObject({ messages: 3, updatedAt: 30 })
  })

  it("um ticket sem abertura legível aparece na mesma, e diz que não a tem", () => {
    // The case persistent secrecy creates: whoever joins later gets the replies
    // but not the opening, because it was encrypted in an epoch they will never have.
    // Hiding the ticket meant hiding a chat that exists.
    const quadro = ticketsOf([linha("@bento:s", 30, { id: "t1", at: 30 }, "já está")], SALA, qualquerUm)
    expect(quadro).toHaveLength(1)
    expect(quadro[0]).toMatchObject({ id: "t1", subject: "", opener: "", state: "open" })
  })

  it("os tickets de outra sala não entram neste quadro", () => {
    const quadro = ticketsOf(
      [
        linha("@ana:s", 10, { id: "t1", subject: "Desta sala", state: "open", at: 10 }),
        linha("@ana:s", 11, { id: "t2", subject: "Da outra", state: "open", at: 11 }, ".", "forum-zzz-zzz"),
      ],
      SALA,
      qualquerUm,
    )
    expect(quadro.map((t) => t.subject)).toEqual(["Desta sala"])
  })

  it("uma mensagem sem ticket não inventa um ticket", () => {
    const conversa: StoredChatMessage = {
      seq: 1,
      sender: "@ana:s",
      at: 1,
      payload: { t: "message", room: SALA, id: "m1", sentAt: 1, body: "bom dia" },
    }
    expect(ticketsOf([conversa], SALA, qualquerUm)).toEqual([])
  })

  it("os abertos vêm primeiro, e os fechados ao fundo", () => {
    // The sort order that works for someone managing the list: open items first,
    // and within each state the most recent first.
    const quadro = ticketsOf(
      [
        linha("@ana:s", 10, { id: "velho", subject: "Velho", state: "open", at: 10 }),
        linha("@ana:s", 20, { id: "feito", subject: "Feito", state: "open", at: 20 }),
        linha("@bento:s", 25, { id: "feito", state: "closed", at: 25 }),
        linha("@ana:s", 30, { id: "novo", subject: "Novo", state: "open", at: 30 }),
      ],
      SALA,
      qualquerUm,
    )
    expect(quadro.map((t) => t.subject)).toEqual(["Novo", "Velho", "Feito"])
  })
})

/**
 * Who can decide a ticket's state, and who cannot.
 *
 * Both sides, always. Hiding the button is not permission: what we measure here
 * is what each client COUNTS after the message arrives, because the message
 * arrives all the same, written by an altered client, and this is where it stops
 * being valid.
 */
describe("atender é uma responsabilidade, e desconta-se na leitura", () => {
  it("quem tem atender fecha o ticket de outra pessoa", () => {
    const quadro = ticketsOf(
      [
        linha("@ana:s", 10, { id: "t1", subject: "Impressora", state: "open", at: 10 }),
        linha("@bento:s", 20, { id: "t1", state: "closed", at: 20 }),
      ],
      SALA,
      (quem) => quem === "@bento:s",
    )
    expect(quadro[0]).toMatchObject({ state: "closed" })
  })

  it("quem NÃO tem atender não fecha o ticket de outra pessoa", () => {
    // The same message, the same sender, the same room. Only who they are changes.
    const quadro = ticketsOf(
      [
        linha("@ana:s", 10, { id: "t1", subject: "Impressora", state: "open", at: 10 }),
        linha("@carlos:s", 20, { id: "t1", state: "closed", at: 20 }),
      ],
      SALA,
      ninguem,
    )
    expect(quadro[0]).toMatchObject({ state: "open" })
  })

  it("quem abriu fecha o seu próprio ticket sem precisar de atender", () => {
    // This is not an exception to the rule, it is how the rule applies: handling is
    // changing OTHER PEOPLE's tickets. The person who filed the complaint never
    // needed permission to say it is already resolved.
    const quadro = ticketsOf(
      [
        linha("@ana:s", 10, { id: "t1", subject: "Impressora", state: "open", at: 10 }),
        linha("@ana:s", 20, { id: "t1", state: "closed", at: 20 }),
      ],
      SALA,
      ninguem,
    )
    expect(quadro[0]).toMatchObject({ state: "closed" })
  })

  it("quem abriu NÃO nomeia quem atende, mesmo no seu próprio ticket", () => {
    // Closing your own is one thing; giving work to someone else is another.
    const quadro = ticketsOf(
      [
        linha("@ana:s", 10, { id: "t1", subject: "Impressora", state: "open", at: 10 }),
        linha("@ana:s", 20, { id: "t1", assignee: "@bento:s", at: 20 }),
      ],
      SALA,
      ninguem,
    )
    expect(quadro[0]).toMatchObject({ assignee: "" })
  })

  it("num ticket sem abertura legível, só quem atende lhe mexe", () => {
    // No opening means no owner, and no owner means nobody is privileged. This is
    // the case persistent secrecy creates for whoever joins midway, and the
    // conservative answer is right: the opposite would let anyone control a ticket
    // just because the opening never reached this vault.
    const semDono = [linha("@carlos:s", 30, { id: "t1", at: 30 }, "isto está resolvido")]
    expect(ticketsOf([...semDono, linha("@carlos:s", 40, { id: "t1", state: "closed", at: 40 })], SALA, ninguem)[0])
      .toMatchObject({ state: "open" })
    expect(ticketsOf([...semDono, linha("@bento:s", 40, { id: "t1", state: "closed", at: 40 })], SALA, (quem) => quem === "@bento:s")[0])
      .toMatchObject({ state: "closed" })
  })

  it("quem tem atender toma o ticket, e o quadro passa a dizer quem o atende", () => {
    const quadro = ticketsOf(
      [
        linha("@ana:s", 10, { id: "t1", subject: "Impressora", state: "open", at: 10 }),
        linha("@bento:s", 20, { id: "t1", assignee: "@bento:s", state: "working", at: 20 }),
      ],
      SALA,
      (quem) => quem === "@bento:s",
    )
    expect(quadro[0]).toMatchObject({ assignee: "@bento:s", state: "working" })
  })

  it("largar um ticket é dizer que não há ninguém, e não é o mesmo que calar-se", () => {
    const quadro = ticketsOf(
      [
        linha("@ana:s", 10, { id: "t1", subject: "Impressora", state: "open", at: 10 }),
        linha("@bento:s", 20, { id: "t1", assignee: "@bento:s", at: 20 }),
        linha("@bento:s", 30, { id: "t1", assignee: "", at: 30 }),
      ],
      SALA,
      (quem) => quem === "@bento:s",
    )
    expect(quadro[0]).toMatchObject({ assignee: "" })
  })

  it("ninguém rouba um ticket abrindo-o outra vez com o mesmo identificador", () => {
    // An altered client publishes whatever opening it wants. The first one counts.
    // Otherwise reopening it would be enough to become the owner and gain the right
    // to change its state.
    const quadro = ticketsOf(
      [
        linha("@ana:s", 10, { id: "t1", subject: "Impressora", state: "open", at: 10 }),
        linha("@carlos:s", 20, { id: "t1", subject: "Meu agora", state: "open", at: 20 }),
        linha("@carlos:s", 30, { id: "t1", state: "closed", at: 30 }),
      ],
      SALA,
      ninguem,
    )
    expect(quadro[0]).toMatchObject({ subject: "Impressora", opener: "@ana:s", state: "open" })
  })
})

describe("o que uma versão futura escrever não estraga o que esta sabe", () => {
  it("um estado que esta versão não conhece deixa o anterior de pé", () => {
    // The safe discount that `rolesOf` already applies to an unknown permission.
    // Making up a state from a name we do not know how to draw was worse than
    // staying with what we knew.
    const quadro = ticketsOf(
      [
        linha("@ana:s", 10, { id: "t1", subject: "Impressora", state: "open", at: 10 }),
        linha("@bento:s", 20, { id: "t1", state: "working", at: 20 }),
        linha("@bento:s", 30, { id: "t1", state: "aguardapecas", at: 30 }),
      ],
      SALA,
      qualquerUm,
    )
    expect(quadro[0]).toMatchObject({ state: "working" })
  })

  it("a decisão mais recente ganha, e não a última a chegar", () => {
    // The recovered history brings old messages after new ones. Without the timestamp
    // to decide, reopening the app would change a ticket's state on its own.
    const quadro = ticketsOf(
      [
        linha("@ana:s", 10, { id: "t1", subject: "Impressora", state: "open", at: 10 }),
        linha("@bento:s", 30, { id: "t1", state: "closed", at: 30 }),
        linha("@bento:s", 20, { id: "t1", state: "working", at: 20 }),
      ],
      SALA,
      qualquerUm,
    )
    expect(quadro[0]).toMatchObject({ state: "closed" })
  })

  it("um ticket dito duas vezes é um ticket, e não dois", () => {
    // A repost says the same opening again, with the same `id` and the same timestamp.
    // The frame must collapse it, the way the feed collapses posts.
    const abertura = linha("@ana:s", 10, { id: "t1", subject: "Impressora", state: "open", at: 10 })
    const quadro = ticketsOf([abertura, { ...abertura, seq: 99 }], SALA, qualquerUm)
    expect(quadro).toHaveLength(1)
    expect(quadro[0]).toMatchObject({ messages: 1 })
  })

  it("um ticket com forma errada é ignorado, e não deita o quadro abaixo", () => {
    // The vault stores raw payloads and may have been written by an older version.
    const tortos: StoredChatMessage[] = [
      { seq: 1, sender: "@ana:s", at: 1, payload: { t: "message", room: SALA, id: "m1", sentAt: 1, body: ".", ticket: null } },
      { seq: 2, sender: "@ana:s", at: 2, payload: { t: "message", room: SALA, id: "m2", sentAt: 2, body: ".", ticket: { id: 7 } } },
      { seq: 3, sender: "@ana:s", at: 3, payload: { t: "message", room: SALA, id: "m3", sentAt: 3, body: ".", ticket: { id: "" } } },
    ]
    expect(ticketsOf(tortos, SALA, qualquerUm)).toEqual([])
  })
})

describe("a conversa de um ticket", () => {
  it("traz as mensagens desse ticket, por ordem, e não as dos outros", () => {
    const linhas = ticketThread(
      [
        linha("@ana:s", 10, { id: "t1", subject: "Impressora", state: "open", at: 10 }, "Abriu um ticket: Impressora"),
        linha("@bento:s", 30, { id: "t2", at: 30 }, "isto é de outro ticket"),
        linha("@bento:s", 20, { id: "t1", at: 20 }, "vou já"),
      ],
      SALA,
      "t1",
    )
    expect(linhas.map((l) => l.body)).toEqual(["Abriu um ticket: Impressora", "vou já"])
    expect(linhas.map((l) => l.sender)).toEqual(["@ana:s", "@bento:s"])
  })

  it("a mesma mensagem dita duas vezes aparece uma vez", () => {
    // A repost says the same thing again. The frame counts one; the conversation must
    // show one, or the count and what you see will disagree.
    const abertura = linha("@ana:s", 10, { id: "t1", subject: "Impressora", state: "open", at: 10 }, "abriu")
    expect(ticketThread([abertura, { ...abertura, seq: 99 }], SALA, "t1")).toHaveLength(1)
  })

  it("o que o quadro conta e o que a conversa mostra é o mesmo número", () => {
    // Both reads use the same membership rule, and that is what binds here: two copies
    // of the rule would make the frame say three about a conversation that shows two.
    const entradas = [
      linha("@ana:s", 10, { id: "t1", subject: "Impressora", state: "open", at: 10 }),
      linha("@bento:s", 20, { id: "t1", at: 20 }),
      linha("@bento:s", 30, { id: "t1", state: "closed", at: 30 }),
      linha("@ana:s", 40, { id: "t2", subject: "Outro", state: "open", at: 40 }),
    ]
    const quadro = ticketsOf(entradas, SALA, qualquerUm)
    const t1 = quadro.find((t) => t.id === "t1")
    expect(ticketThread(entradas, SALA, "t1")).toHaveLength(t1?.messages ?? -1)
  })
})

/**
 * Ticket tombstone (phase 3): the moderator deletes a closed ticket, and it
 * leaves the frame. Only when closed, only by a moderator, and no undo.
 */
describe("eliminar um ticket fechado", () => {
  const modera = (quem: string): boolean => quem === "@mod:s"
  const fechado = [
    linha("@ana:s", 10, { id: "t1", subject: "Impressora", state: "open", at: 10 }),
    linha("@ana:s", 20, { id: "t1", state: "closed", at: 20 }),
  ]

  it("quem modera tira-o do quadro", () => {
    const quadro = ticketsOf([...fechado, linha("@mod:s", 30, { id: "t1", removed: true, at: 30 })], SALA, qualquerUm, modera)
    expect(quadro).toEqual([])
  })

  it("sem o poder, a lápide não conta", () => {
    const comLapide = [...fechado, linha("@ana:s", 30, { id: "t1", removed: true, at: 30 })]
    expect(ticketsOf(comLapide, SALA, qualquerUm, modera)).toHaveLength(1)
    // A client that does not ask for moderation rights (the pre-phase 3 one) also does not see it.
    expect(ticketsOf(comLapide, SALA, qualquerUm)).toHaveLength(1)
  })

  it("um ticket aberto não se elimina", () => {
    const aberto = [
      linha("@ana:s", 10, { id: "t1", subject: "Impressora", state: "open", at: 10 }),
      linha("@mod:s", 30, { id: "t1", removed: true, at: 30 }),
    ]
    expect(ticketsOf(aberto, SALA, qualquerUm, modera)[0]).toMatchObject({ id: "t1", state: "open" })
  })

  it("é absorvente: reabrir depois não o traz de volta", () => {
    const depois = [
      ...fechado,
      linha("@mod:s", 30, { id: "t1", removed: true, at: 30 }),
      linha("@ana:s", 40, { id: "t1", state: "open", at: 40 }),
    ]
    expect(ticketsOf(depois, SALA, qualquerUm, modera)).toEqual([])
  })
})
