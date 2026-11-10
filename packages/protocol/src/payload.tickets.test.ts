import { describe, expect, it } from "vitest"
import { decodePayload, encodePayload, POWERS, IRREVERSIBLE_POWERS, type Payload } from "./payload.js"

/**
 * The ticket room, and the decision it DID NOT make.
 *
 * The obvious path was a third value in `channel.meta.kind`. The comment above
 * that field advises against it in writing, and says why: a `kind` the receiver
 * does not know rejects the entire `channel.meta`, and with it goes the
 * `removed` tombstone (a rejected tombstone brings the room back, because
 * silence does not propagate). Swapping the `z.enum` for an open format today would
 * save no one: the clients out there have the `z.enum` they already downloaded,
 * and it is THEIR validation that decides.
 *
 * The same comment says what to do instead, and it happens to say it about
 * this exact case: *"A forum or an announcement are text rooms with a different
 * layout (…): they need a presentation field, not a third `kind`."* A ticket
 * room carries application messages like any text room; what changes is how
 * they are read. So: `kind` stays `text`, and the layout travels in a new
 * optional field.
 *
 * What this buys, and it is what these tests pin down: a client that never
 * heard of tickets drops the field it does not know, reads the room as a text
 * room, and the ticket conversation appears to it as what it is, messages.
 */
describe("a disposição de uma sala viaja em campo próprio", () => {
  it("uma sala de tickets é uma sala de texto com outra disposição", () => {
    const sala: Payload = {
      t: "channel.meta",
      room: "forum-abc-def",
      name: "Apoio",
      category: "",
      kind: "text",
      layout: "tickets",
      position: 0,
      closed: false,
      removed: false,
      updatedAt: 1,
    }
    expect(decodePayload(encodePayload(sala))).toMatchObject({ kind: "text", layout: "tickets" })
  })

  it("uma sala publicada por um cliente ANTIGO continua a ler-se, e sem disposição", () => {
    // All `channel.meta` that are recorded in today's vaults. Without the field
    // being optional, opening the new app would make every already published room
    // count as an ignored event, and consecutive ignored events mark the channel
    // deaf, which is the cascade that already erased history once.
    const antigo = {
      t: "channel.meta",
      room: "forum-abc-def",
      name: "conversa",
      category: "",
      kind: "text",
      position: 0,
      closed: false,
      removed: false,
      updatedAt: 2,
    }
    const lido = decodePayload(new TextEncoder().encode(JSON.stringify(antigo))) as Record<string, unknown>
    expect(lido).toMatchObject({ name: "conversa", kind: "text" })
    expect(lido["layout"]).toBeUndefined()
  })

  it("um cliente ANTIGO não fica surdo com uma sala publicada por um novo", () => {
    // The direction that matters to the cascade, and the one no one checks because they
    // already wrote the new schema. `inventado` stands in for a field the old
    // version does not know, which is exactly what `layout` is to it.
    const novo = JSON.stringify({
      t: "channel.meta",
      room: "forum-abc-def",
      name: "Apoio",
      category: "",
      kind: "text",
      layout: "tickets",
      inventado: "o que vier depois disto",
      position: 0,
      closed: false,
      removed: false,
      updatedAt: 3,
    })
    const lido = decodePayload(new TextEncoder().encode(novo)) as Record<string, unknown>
    expect(lido).toMatchObject({ name: "Apoio" })
    expect(lido).not.toHaveProperty("inventado")
  })

  /**
   * A ticket room tombstone must survive someone who does not know what it is.
   * This is the whole reason the layout is not a `kind`.
   */
  it("a lápide de uma sala de tickets continua a ser uma lápide", () => {
    const lapide = JSON.stringify({
      t: "channel.meta",
      room: "forum-abc-def",
      name: "Apoio",
      category: "",
      kind: "text",
      layout: "tickets",
      position: 0,
      closed: true,
      removed: true,
      updatedAt: 4,
    })
    expect(decodePayload(new TextEncoder().encode(lapide))).toMatchObject({ removed: true, closed: true })
  })

  /**
   * The path that was not taken, pinned down so no one takes it by accident.
   *
   * If one day someone opens `kind` to a third value, this test turns red and
   * forces a read of the comment above the field, where the cost has been
   * worked out. It is not a product test: it is an alarm bell.
   */
  it("um `kind` que não seja texto nem voz continua a reprovar a sala inteira", () => {
    const proibido = JSON.stringify({
      t: "channel.meta",
      room: "forum-abc-def",
      name: "Apoio",
      category: "",
      kind: "tickets",
      position: 0,
      closed: false,
      removed: true,
      updatedAt: 5,
    })
    expect(() => decodePayload(new TextEncoder().encode(proibido))).toThrow()
  })

  it("uma disposição com forma de lixo é recusada nos dois lados", () => {
    // An optional field is not a field without rules. What this format prevents is
    // half a megabyte of nothing in a field whose content is always one word.
    const torto = {
      t: "channel.meta",
      room: "forum-abc-def",
      name: "Apoio",
      category: "",
      kind: "text",
      layout: "url(javascript:alert(1))",
      position: 0,
      closed: false,
      removed: false,
      updatedAt: 6,
    }
    expect(() => decodePayload(new TextEncoder().encode(JSON.stringify(torto)))).toThrow()
    expect(() => encodePayload(torto as unknown as Payload)).toThrow()
  })
})

/**
 * The invariant that justifies everything above, pinned in code.
 *
 * A survey on August 18 found the gap: **there was no test that said an unknown
 * `t` breaks the union.** The rule "optional fields, never a new `t`" is cited
 * in every protocol warning in this file and in `payload.ts`, and it decided
 * that tickets travel inside `message`, but it was documentation, not code.
 * One day someone swaps the union for something more lenient, the suite turns
 * green, and the rule becomes folklore.
 *
 * It stays here, nowhere else, because this is the file that depends most on
 * it: if this stops being true, the design choice tickets made stops making
 * sense, and someone has to know.
 */
describe("a razão de tudo isto: um `t` desconhecido rebenta a união inteira", () => {
  it("um payload com um `t` que esta versão não conhece é recusado", () => {
    // And "rejected" means, on the receiving end: discarded silently, counted as
    // an ignored event, and consecutive ones mark the channel deaf, which forces
    // a new seat in the group and takes the history with it, for forward
    // secrecy. It is the cascade that already erased history once.
    const inventado = JSON.stringify({ t: "ticket.open", id: "t1", subject: "Impressora", at: 1 })
    expect(() => decodePayload(new TextEncoder().encode(inventado))).toThrow()
  })

  it("mas um CAMPO desconhecido dentro de um `t` conhecido passa sem custo", () => {
    // The contrast is the whole rule in one line. Same content, same old client:
    // as its own `t` kills the channel, as a field it gets dropped and the
    // message arrives.
    const comoCampo = JSON.stringify({
      t: "message",
      id: "mensagem-0007",
      sentAt: 1,
      body: "Abriu um ticket: Impressora",
      attachments: [],
      links: [],
      mentions: [],
      ticket: { id: "ticket-0001", subject: "Impressora", at: 1 },
      oQueVierDepois: { seja: "o que for" },
    })
    const lido = decodePayload(new TextEncoder().encode(comoCampo)) as Record<string, unknown>
    expect(lido).toMatchObject({ body: "Abriu um ticket: Impressora" })
    expect(lido).not.toHaveProperty("oQueVierDepois")
  })

  it("um payload sem `t` nenhum também é recusado", () => {
    expect(() => decodePayload(new TextEncoder().encode(JSON.stringify({ body: "sem t" })))).toThrow()
  })

  /**
   * What these three tests DO NOT pin down, so no one thinks they do.
   *
   * They do not pin down that the union is `discriminatedUnion` and not
   * `z.union`. Measured: swapping one for the other keeps us green, and keeps
   * us green because both reject an unknown `t`: the `discriminatedUnion` by
   * not finding the branch, `z.union` by all branches failing. They are
   * equivalent for this invariant, and the difference between them is error
   * message and speed.
   *
   * What they pin down is the behavior that matters, and the mutation that
   * confirms it is different: a lenient `decodePayload` that returns the raw
   * payload when it does not validate turns the first test red. That is the
   * regression the rule fears: someone "solving" the old client problem by
   * letting through what they do not understand, and erasing with that the
   * reason fields are optional.
   */
})

/**
 * The ticket itself: optional field inside `message`, never a new `t`.
 *
 * It follows the `ChannelInvite` path, and the reason is written there at
 * length: a `t` the receiver does not know fails validation, is discarded
 * whole, counts as an ignored event, and a string of them marks the channel
 * deaf, which triggers a reseat and takes the history with it. An optional field
 * inside `message` does not run that risk: the old client strips the field it
 * does not know and shows the message.
 *
 * And that is what decides how the body is written. The body of a ticket
 * message must read BY ITSELF, because for half the world it is all that is
 * left: whoever does not know the field reads "Fechou o ticket." and knows
 * what happened, with no button to press.
 */
describe("um ticket viaja dentro de uma mensagem", () => {
  it("a abertura leva assunto e estado", () => {
    const abertura: Payload = {
      t: "message",
      room: "forum-abc-def",
      id: "mensagem-0001",
      sentAt: 1,
      body: "Abriu um ticket: Impressora avariada",
      attachments: [],
      links: [],
      mentions: [],
      ticket: { id: "ticket-0001", subject: "Impressora avariada", state: "open", at: 1 },
    }
    expect(decodePayload(encodePayload(abertura))).toMatchObject({
      ticket: { id: "ticket-0001", subject: "Impressora avariada", state: "open" },
    })
  })

  it("uma resposta dentro do ticket leva só o identificador", () => {
    const resposta: Payload = {
      t: "message",
      room: "forum-abc-def",
      id: "mensagem-0002",
      sentAt: 2,
      body: "Já lhe pego.",
      attachments: [],
      links: [],
      mentions: [],
      ticket: { id: "ticket-0001", at: 2 },
    }
    const lido = decodePayload(encodePayload(resposta)) as { ticket: Record<string, unknown> }
    expect(lido.ticket).toMatchObject({ id: "ticket-0001" })
    expect(lido.ticket["state"]).toBeUndefined()
    expect(lido.ticket["subject"]).toBeUndefined()
  })

  it("uma mensagem sem ticket continua a ser uma mensagem, e sem o campo", () => {
    // Every message that has ever been said. This is the normal case and the
    // easiest to break without noticing.
    const normal = {
      t: "message",
      id: "mensagem-0003",
      sentAt: 3,
      body: "bom dia",
      attachments: [],
      links: [],
      mentions: [],
    }
    const lido = decodePayload(new TextEncoder().encode(JSON.stringify(normal))) as Record<string, unknown>
    expect(lido).toMatchObject({ body: "bom dia" })
    expect(lido["ticket"]).toBeUndefined()
  })

  it("um cliente ANTIGO lê o corpo da mensagem e deita fora o ticket", () => {
    // The proof that the body must read by itself: this is literally all a client
    // that does not know tickets sees.
    const novo = JSON.stringify({
      t: "message",
      room: "forum-abc-def",
      id: "mensagem-0004",
      sentAt: 4,
      body: "Fechou o ticket.",
      attachments: [],
      links: [],
      mentions: [],
      ticket: { id: "ticket-0001", state: "closed", at: 4 },
      inventado: "o que vier depois disto",
    })
    const lido = decodePayload(new TextEncoder().encode(novo)) as Record<string, unknown>
    expect(lido).toMatchObject({ body: "Fechou o ticket." })
    expect(lido).not.toHaveProperty("inventado")
  })

  it("um estado do futuro atravessa a validação, para ser descontado na leitura", () => {
    // Same rule as `powers` and `colour`: the reader judges the value, not the
    // schema. A state made up by a later version cannot get the message rejected:
    // rejecting here would cost the text the person wrote, just to avoid painting a
    // label.
    const futuro = JSON.stringify({
      t: "message",
      id: "mensagem-0005",
      sentAt: 5,
      body: "Ficou à espera de peças.",
      attachments: [],
      links: [],
      mentions: [],
      ticket: { id: "ticket-0001", state: "aguardapecas", at: 5 },
    })
    expect(decodePayload(new TextEncoder().encode(futuro))).toMatchObject({
      ticket: { state: "aguardapecas" },
    })
  })

  it("um ticket sem identificador é recusado nos dois lados", () => {
    // The identifier is what ties all messages together in a ticket. Without it
    // the message does not belong to any ticket, and accepting it would store a
    // conversation that is never found again.
    const semId = {
      t: "message",
      id: "mensagem-0006",
      sentAt: 6,
      body: "olá",
      attachments: [],
      links: [],
      mentions: [],
      ticket: { at: 6 },
    }
    expect(() => decodePayload(new TextEncoder().encode(JSON.stringify(semId)))).toThrow()
    expect(() => encodePayload(semId as unknown as Payload)).toThrow()
  })
})

/**
 * Handling tickets is a responsibility, and it goes in the list with the others.
 *
 * `role.define.powers` is already an open format (`NarrowName`) and not a
 * `z.enum(POWERS)`, precisely for this: a power that a version does not know
 * is filtered out by the reader (`rolesOf`), and never rejects the entire role.
 */
describe("atender tickets é uma responsabilidade como as outras", () => {
  it("está na lista, depois das que já lá estavam", () => {
    // The order of `POWERS` is the order in which powers appear on screen, and
    // `powersOf` filters by it. New entries always go at the end: `moderar`
    // (phase 3) came later, and `atender` stayed behind `fixar`.
    expect(POWERS).toContain("atender")
    expect(POWERS.indexOf("atender")).toBeGreaterThan(POWERS.indexOf("fixar"))
  })

  it("tem volta, e por isso não é irreversível", () => {
    // The choice that `IRREVERSIBLE_POWERS` forces, and that silence would settle
    // the wrong way. A closed ticket can be reopened; nothing handling does is done
    // for good. It is the opposite of expulsion and deletion.
    expect(IRREVERSIBLE_POWERS).not.toContain("atender")
  })

  it("um papel com atender atravessa a codificação", () => {
    const papel: Payload = {
      t: "role.define",
      role: "apoio",
      name: "Apoio",
      powers: ["atender"],
      position: 0,
      removed: false,
      definedAt: 1,
    }
    expect(decodePayload(encodePayload(papel))).toMatchObject({ powers: ["atender"] })
  })

  it("um cliente ANTIGO guarda o papel inteiro, e só deixa cair o poder que não conhece", () => {
    // What this test pins down is the schema, not the filtering: `powers` accepts
    // any narrow name, so the role passes. `rolesOf` does the filtering, in the
    // core, and applies it against the list the version knows.
    const novo = JSON.stringify({
      t: "role.define",
      role: "apoio",
      name: "Apoio",
      powers: ["convidar", "atender", "oquevierdepois"],
      position: 0,
      removed: false,
      definedAt: 2,
    })
    expect(decodePayload(new TextEncoder().encode(novo))).toMatchObject({
      name: "Apoio",
      powers: ["convidar", "atender", "oquevierdepois"],
    })
  })
})
