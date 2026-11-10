import { describe, expect, it } from "vitest"
import { z } from "zod"
import { decodePayload, encodePayload, type Payload } from "./payload.js"

/**
 * A poll crosses the wire without a new `t`, and an old client does not get hurt.
 *
 * The fourth time this policy applies in this file, after muted mic, screen share
 * and address-based invite, and the first where what travels is an entire structure
 * and not a boolean. Worth repeating the reason, because it decides whether the
 * product survives the feature: a `t` the receiver does not know rejects the ENTIRE
 * union, the payload is discarded in silence, counts as an ignored event, and
 * consecutive ignored events declare the channel deaf, which triggers the repair
 * that WIPES HISTORY. There are people in production now.
 *
 * So the poll is an optional field of `message` and `post`, and the vote is an
 * optional field of `post.reaction`, which is a `t` all clients already know.
 */

/**
 * The union as it was BEFORE this feature, reconstructed by hand.
 *
 * This is the client that is open right now on another computer. Without this
 * replica, a test that only ran through today's `decodePayload` would measure the
 * new schema against itself, which is precisely the direction no one checks
 * because they already wrote the schema.
 *
 * Only the three frames this change touches, and with the fields that matter: the
 * point is not to copy the file, it is to have a `z.discriminatedUnion` without
 * any `passthrough` receiving today's bytes.
 */
const Antigo = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("message"),
    id: z.string().min(8).max(64),
    sentAt: z.number().int().nonnegative(),
    body: z.string().max(16_000),
    attachments: z.array(z.unknown()).max(10).default([]),
    links: z.array(z.unknown()).max(4).default([]),
    mentions: z.array(z.string()).max(64).default([]),
  }),
  z.object({
    t: z.literal("post"),
    id: z.string().min(8).max(64),
    postedAt: z.number().int().nonnegative(),
    caption: z.string().max(4200),
    media: z.array(z.unknown()).max(10).default([]),
    links: z.array(z.unknown()).max(4).default([]),
    tags: z.array(z.string().max(32)).max(30).default([]),
  }),
  z.object({
    t: z.literal("post.reaction"),
    id: z.string().min(8).max(64),
    target: z.string().min(8).max(64),
    emoji: z.string().max(32),
    at: z.number().int().nonnegative(),
    remove: z.boolean().default(false),
  }),
])

/** What an old client would do with these bytes: either read it, or count an ignored event. */
function comoUmClienteAntigo(bytes: Uint8Array): { lido: true; valor: unknown } | { lido: false } {
  const resultado = Antigo.safeParse(JSON.parse(new TextDecoder().decode(bytes)))
  return resultado.success ? { lido: true, valor: resultado.data } : { lido: false }
}

const PERGUNTA = "Qual é o melhor dia?"
const OPCOES = ["Segunda", "Terça"]

const mensagemComVotacao: Payload = {
  t: "message",
  id: "mensagem-votacao-1",
  sentAt: 1_700_000_000_000,
  body: `${PERGUNTA}\n1. Segunda\n2. Terça`,
  attachments: [],
  links: [],
  mentions: [],
  poll: { question: PERGUNTA, options: OPCOES },
}

const publicacaoComVotacao: Payload = {
  t: "post",
  id: "publicacao-votacao-1",
  postedAt: 1_700_000_000_000,
  caption: `${PERGUNTA}\n1. Segunda\n2. Terça`,
  media: [],
  links: [],
  tags: [],
  poll: { question: PERGUNTA, options: OPCOES },
}

const voto: Payload = {
  t: "post.reaction",
  id: "voto-1234",
  target: "mensagem-votacao-1",
  emoji: "",
  at: 1_700_000_000_500,
  remove: false,
  vote: 1,
}

describe("a votação viaja sem `t` novo", () => {
  it("na conversa: a pergunta e as opções fazem a ida e a volta dentro da mensagem", () => {
    expect(decodePayload(encodePayload(mensagemComVotacao))).toMatchObject({
      t: "message",
      poll: { question: PERGUNTA, options: OPCOES },
    })
  })

  it("no mural: a mesma votação dentro da publicação", () => {
    expect(decodePayload(encodePayload(publicacaoComVotacao))).toMatchObject({
      t: "post",
      poll: { question: PERGUNTA, options: OPCOES },
    })
  })

  it("o voto é o índice da opção, e viaja numa reacção", () => {
    expect(decodePayload(encodePayload(voto))).toMatchObject({ t: "post.reaction", vote: 1, emoji: "" })
  })

  it("o índice zero sobrevive, que é a primeira opção e a que um falso valor apagaria", () => {
    expect(decodePayload(encodePayload({ ...voto, vote: 0 }))).toMatchObject({ vote: 0 })
  })

  it("retirar o voto viaja como retirar um polegar", () => {
    expect(decodePayload(encodePayload({ ...voto, remove: true }))).toMatchObject({ vote: 1, remove: true })
  })

  it("a forma ANTIGA dos três frames continua a decodificar, e sem os campos novos", () => {
    // What a client that never heard of polls puts on the wire today. If this
    // stopped being read, the entire conversation in progress would start
    // counting ignored events, the cascade, started by the feature that does not
    // touch it.
    const antigos = [
      { t: "message", id: "mensagem-1", sentAt: 1, body: "olá" },
      { t: "post", id: "publicacao-1", postedAt: 1, caption: "olá" },
      { t: "post.reaction", id: "reaccao-1", target: "publicacao-1", emoji: "👍", at: 1 },
    ]
    for (const antigo of antigos) {
      const lido = decodePayload(new TextEncoder().encode(JSON.stringify(antigo))) as Record<string, unknown>
      expect(lido).toMatchObject({ t: antigo.t })
      expect(lido["poll"]).toBeUndefined()
      expect(lido["vote"]).toBeUndefined()
    }
  })
})

/**
 * The direction no one checks because they already wrote the new schema, and the
 * only one that matters for the cascade.
 */
describe("um cliente ANTIGO não fica surdo com uma votação", () => {
  it("lê a mensagem, deita fora a votação, e fica com o texto que a diz", () => {
    const resultado = comoUmClienteAntigo(encodePayload(mensagemComVotacao))
    expect(resultado.lido).toBe(true)
    // And what it shows is not an empty message: the body carries the question and
    // the options in full, which is why the body is written this way.
    expect(resultado).toMatchObject({ valor: { body: expect.stringContaining(PERGUNTA) as unknown as string } })
    expect((resultado as { valor: Record<string, unknown> }).valor["poll"]).toBeUndefined()
  })

  it("lê a publicação, deita fora a votação, e fica com a legenda que a diz", () => {
    const resultado = comoUmClienteAntigo(encodePayload(publicacaoComVotacao))
    expect(resultado.lido).toBe(true)
    expect(resultado).toMatchObject({ valor: { caption: expect.stringContaining(PERGUNTA) as unknown as string } })
  })

  it("lê o voto como uma reacção qualquer, e não como um evento ignorado", () => {
    // This is the one that counts for deafness: a poll with ten people brings
    // dozens of votes in a row, and five rejected payloads were enough to declare
    // the channel deaf.
    const resultado = comoUmClienteAntigo(encodePayload(voto))
    expect(resultado.lido).toBe(true)
    expect((resultado as { valor: Record<string, unknown> }).valor["vote"]).toBeUndefined()
  })

  it("e o emoji vazio faz o voto não ser contado como polegar por quem não o entende", () => {
    // The old client reads the reaction, but its `engagementOf` discards a
    // reaction whose emoji is not a thumbs up. Without this, a vote for option 2
    // would show up on its wall as a like.
    const lido = comoUmClienteAntigo(encodePayload(voto)) as { valor: Record<string, unknown> }
    expect(lido.valor["emoji"]).toBe("")
  })
})

/**
 * An unreadable poll means no poll, never loss of the message.
 *
 * It is the `.catch(undefined)` being measured. Without it, an optional field with
 * a narrow schema inside would still kill the entire payload: a future version with
 * twelve options would erase the author's sentence on the screen of everyone
 * who had not updated yet, and count an ignored event for each one.
 */
describe("uma votação ilegível não leva a mensagem com ela", () => {
  const comVotacaoEstragada = (poll: unknown): Record<string, unknown> =>
    decodePayload(
      new TextEncoder().encode(
        JSON.stringify({ t: "message", id: "mensagem-1234", sentAt: 1, body: "a pergunta, por extenso", poll }),
      ),
    ) as Record<string, unknown>

  it("uma votação de uma versão futura, com opções a mais", () => {
    const doze = Array.from({ length: 12 }, (_, indice) => `Opção ${indice + 1}`)
    const lido = comVotacaoEstragada({ question: PERGUNTA, options: doze })
    expect(lido["body"]).toBe("a pergunta, por extenso")
    expect(lido["poll"]).toBeUndefined()
  })

  it("uma votação com uma opção só", () => {
    expect(comVotacaoEstragada({ question: PERGUNTA, options: ["Sim"] })["poll"]).toBeUndefined()
  })

  it("uma votação sem pergunta", () => {
    expect(comVotacaoEstragada({ question: "", options: OPCOES })["poll"]).toBeUndefined()
  })

  it("lixo no lugar da votação", () => {
    expect(comVotacaoEstragada("uma cadeia qualquer")["poll"]).toBeUndefined()
    expect(comVotacaoEstragada(42)["poll"]).toBeUndefined()
    expect(comVotacaoEstragada({ question: PERGUNTA })["poll"]).toBeUndefined()
  })

  it("e um campo futuro DENTRO da votação é despido sem levar nada atrás", () => {
    const lido = comVotacaoEstragada({ question: PERGUNTA, options: OPCOES, prazo: 1_700_000_000_000 })
    expect(lido["poll"]).toMatchObject({ question: PERGUNTA, options: OPCOES })
    expect((lido["poll"] as Record<string, unknown>)["prazo"]).toBeUndefined()
  })
})

describe("um voto absurdo não leva a reacção com ele", () => {
  const comVoto = (vote: unknown): Record<string, unknown> =>
    decodePayload(
      new TextEncoder().encode(
        JSON.stringify({ t: "post.reaction", id: "voto-1234", target: "alvo-1234", emoji: "", at: 1, vote }),
      ),
    ) as Record<string, unknown>

  it("negativo, fraccionário ou texto valem ausência de voto", () => {
    for (const absurdo of [-1, 1.5, "2", null]) {
      const lido = comVoto(absurdo)
      expect(lido["t"]).toBe("post.reaction")
      expect(lido["vote"]).toBeUndefined()
    }
  })

  /**
   * A large index passes here on purpose.
   *
   * The schema does not know the poll this vote answers (it travels in another
   * message), so it has no way to know how many options exist. The reader filters
   * it out, with the options at hand. Faking a cap here would mean making up a
   * number that is not the right one for any poll.
   */
  it("um índice fora das opções passa no esquema, e é descontado por quem lê", () => {
    expect(comVoto(99)["vote"]).toBe(99)
  })
})
