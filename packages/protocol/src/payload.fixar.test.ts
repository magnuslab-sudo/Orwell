import { describe, expect, it } from "vitest"
import { decodePayload, encodePayload, MAX_PINNED, type Payload, PINNED_BODY_MAX } from "./payload.js"

/**
 * The invariant that everyone cites and no one had written down.
 *
 * A half dozen comments in `payload.ts` justify themselves by saying that **an unknown `t`
 * fails the entire union**, and that is why each new feature enters as an optional field
 * in a form that already exists, never as a new type. The claim is correct, but it was folklore:
 * nothing enforced it, and the entire policy rested on the memory of whoever wrote it.
 *
 * This block tests it in both directions, because it is the difference between them
 * that decides the policy:
 *
 * - a `t` that the union does not know FAILS, and a failed payload is discarded
 *   silently, counted as an ignored event, and consecutive ignored events mark
 *   the channel deaf and trigger the repair that clears history;
 * - a FIELD that the union does not know is dropped on read and takes nothing with it.
 *
 * Whoever comes to add a new event type stumbles first here, which is the place
 * where the rule costs one line instead of costing conversations.
 */
describe("a regra que decide a forma de tudo o que se acrescenta", () => {
  it("um `t` que esta versão não conhece REPROVA o payload inteiro", () => {
    // A type that a future version might have invented for pinned messages, instead
    // of the field they use. Not theory: it was the first idea.
    const doFuturo = JSON.stringify({ t: "message.pin", target: "m-1234567890", at: 7 })
    expect(() => decodePayload(new TextEncoder().encode(doFuturo))).toThrow()
  })

  it("e reprova mesmo quando tudo o resto lá dentro é válido", () => {
    // The temptation is to think a well-formed payload passes and only the strange
    // type gets lost. It doesn't pass: discrimination is by `t`, and without a branch
    // there is nothing to validate against. This line makes the rule absolute.
    const quaseMensagem = JSON.stringify({
      t: "message.pinned",
      id: "m-1234567890",
      sentAt: 1_700_000_000_000,
      body: "isto seria uma mensagem perfeitamente boa",
      attachments: [],
      links: [],
      mentions: [],
    })
    expect(() => decodePayload(new TextEncoder().encode(quaseMensagem))).toThrow()
  })

  it("um CAMPO que esta versão não conhece cai, e o payload chega inteiro", () => {
    // The other side of the same coin, and why new features enter here: the schema
    // is not `strict()`.
    const doFuturo = JSON.stringify({
      t: "channel.meta",
      room: "geral",
      name: "Geral",
      category: "",
      kind: "text",
      position: 0,
      closed: false,
      removed: false,
      updatedAt: 9,
      oQueVierDepoisDisto: { seja: "o que for" },
    })
    const lido = decodePayload(new TextEncoder().encode(doFuturo)) as Record<string, unknown>

    expect(lido).toMatchObject({ t: "channel.meta", room: "geral", name: "Geral" })
    expect(lido).not.toHaveProperty("oQueVierDepoisDisto")
  })
})

/**
 * Pinned messages in a room, traveling without the new `t`.
 *
 * Same policy as muted microphone and screen share, and for the reason the block
 * above just pinned down. What these tests guard, beyond the round trip, are the two
 * decisions that make the feature fit in a field:
 *
 * 1. **Absent is not an empty list.** That is what lets renaming or closing a
 *    room (a different responsibility, done by a different person) unpin
 *    nothing. A `.default([])` here would erase pins at the first sidebar
 *    cleanup, silently.
 * 2. **The text travels with the identifier.** Someone arriving later can never
 *    open the original message (forward secrecy), and the channel history has
 *    a cap: without the copy, "pinned" would be a list of identifiers pointing
 *    to nothing.
 */
describe("as mensagens fixadas viajam sem `t` novo", () => {
  const fixada = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: "m-1234567890",
    sender: "@ana:orwell.pt",
    body: "As inscrições fecham na sexta.",
    sentAt: 1_700_000_000_000,
    pinnedAt: 1_700_000_060_000,
    pinnedBy: "@rui:orwell.pt",
    ...extra,
  })

  const sala = (pinned?: unknown): Payload =>
    ({
      t: "channel.meta",
      room: "avisos",
      name: "Avisos",
      category: "",
      kind: "text",
      position: 0,
      closed: false,
      removed: false,
      updatedAt: 1_700_000_060_000,
      ...(pinned === undefined ? {} : { pinned }),
    }) as Payload

  it("a sala leva a lista fixada, com quem disse, o que disse e quem fixou", () => {
    const lida = decodePayload(encodePayload(sala([fixada()]))) as Record<string, unknown>

    expect(lida).toMatchObject({ t: "channel.meta", room: "avisos" })
    expect(lida["pinned"]).toEqual([
      {
        id: "m-1234567890",
        sender: "@ana:orwell.pt",
        body: "As inscrições fecham na sexta.",
        sentAt: 1_700_000_000_000,
        pinnedAt: 1_700_000_060_000,
        pinnedBy: "@rui:orwell.pt",
      },
    ])
  })

  it("a lista VAZIA sobrevive ao fio: é assim que se diz «desafixei a última»", () => {
    // Without this, removing the last pin was indistinguishable from not mentioning
    // the topic, and the last pinned message would never leave the top of the room.
    const lida = decodePayload(encodePayload(sala([]))) as Record<string, unknown>
    expect(lida["pinned"]).toEqual([])
  })

  it("a forma ANTIGA da sala continua a ler, e o campo fica INDEFINIDO", () => {
    // What all production clients put on the wire today. `undefined` and not `[]`:
    // the reader has to tell "did not mention pins" from "none are pinned", or the
    // first name change unpins everything.
    const antiga = {
      t: "channel.meta",
      room: "avisos",
      name: "Avisos",
      category: "",
      kind: "text",
      position: 0,
      closed: false,
      removed: false,
      updatedAt: 3,
    }
    const lida = decodePayload(new TextEncoder().encode(JSON.stringify(antiga))) as Record<string, unknown>

    expect(lida).toMatchObject({ t: "channel.meta", room: "avisos" })
    expect(lida["pinned"]).toBeUndefined()
  })

  it("um cliente ANTIGO não fica surdo com a sala de um cliente NOVO", () => {
    // The direction that no one checks because they already wrote the new schema, and
    // the only one the history-wiping cascade cares about. `inventado` stands in for a field
    // the old version doesn't know, which is what `pinned` is to it.
    const nova = JSON.stringify({
      t: "channel.meta",
      room: "avisos",
      name: "Avisos",
      category: "",
      kind: "text",
      position: 0,
      closed: false,
      removed: false,
      updatedAt: 4,
      inventado: [{ id: "m-1234567890" }],
    })
    const lida = decodePayload(new TextEncoder().encode(nova)) as Record<string, unknown>

    expect(lida).toMatchObject({ t: "channel.meta", room: "avisos", name: "Avisos" })
    expect(lida).not.toHaveProperty("inventado")
  })

  it("uma mensagem só de imagens fixa-se: corpo vazio é legítimo", () => {
    const lida = decodePayload(encodePayload(sala([fixada({ body: "" })]))) as Record<string, unknown>
    expect((lida["pinned"] as { body: string }[])[0]?.body).toBe("")
  })

  it("mais do que o tecto de fixadas é recusado NO REMETENTE", () => {
    // Where someone sees it. On the other side, a rejected payload is discarded
    // silently, counts as an ignored event, and the entire room goes with it, the
    // name, the category, the tombstone.
    const demais = Array.from({ length: MAX_PINNED + 1 }, (_, indice) => fixada({ id: `m-${indice}0000000` }))
    expect(() => encodePayload(sala(demais))).toThrow()
    expect(() => decodePayload(new TextEncoder().encode(JSON.stringify(sala(demais))))).toThrow()
  })

  it("exactamente o tecto passa: o limite é um limite, não uma margem", () => {
    const cheio = Array.from({ length: MAX_PINNED }, (_, indice) => fixada({ id: `m-${indice}0000000` }))
    const lida = decodePayload(encodePayload(sala(cheio))) as Record<string, unknown>
    expect(lida["pinned"]).toHaveLength(MAX_PINNED)
  })

  it("um corpo maior do que o tecto é recusado, e não truncado em silêncio", () => {
    // The pinner does the truncating, and truncates knowing they did. A schema that
    // truncated would leave the sender convinced they published the whole text.
    expect(() => encodePayload(sala([fixada({ body: "a".repeat(PINNED_BODY_MAX + 1) })]))).toThrow()

    const noLimite = decodePayload(encodePayload(sala([fixada({ body: "a".repeat(PINNED_BODY_MAX) })]))) as Record<
      string,
      unknown
    >
    expect(noLimite["pinned"]).toHaveLength(1)
  })

  it("uma fixação sem identificador, ou com um que não é de mensagem, é recusada", () => {
    // The identifier is what links the copy to the original message. Without it, the
    // pin is an orphaned quote that no one can go see.
    expect(() => encodePayload(sala([{ ...fixada(), id: undefined }]))).toThrow()
    expect(() => encodePayload(sala([{ ...fixada(), id: "curto" }]))).toThrow()
  })

  it("uma fixação sem `pinnedBy` é recusada: republicar reescreveria a autoria", () => {
    // The list is republished by the room organizer to each person entering the
    // channel, and there the authenticated sender is the republisher. Without this
    // field, a republish would attribute all pins to whoever republished.
    expect(() => encodePayload(sala([{ ...fixada(), pinnedBy: undefined }]))).toThrow()
  })

  it("`pinned` que não é uma lista é recusado, e não silenciosamente acreditado", () => {
    expect(() => decodePayload(new TextEncoder().encode(JSON.stringify(sala("m-1234567890"))))).toThrow()
  })
})
