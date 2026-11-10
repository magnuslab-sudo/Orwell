import { describe, expect, it } from "vitest"
import type { ChatMessage } from "../../types.js"
import { engagementOf, GOSTO, NAO_GOSTO } from "./engagement.js"
import { moradaDeTeste } from "../../../testes/moradas.js"

const MURAL_ANA = moradaDeTeste("mural ana", "s")

function reaction(sender: string, emoji: string, at: number, remove = false): ChatMessage {
  return {
    channel: MURAL_ANA,
    seq: 1,
    sender,
    payload: { t: "post.reaction", id: `r-${sender}-${at}`, target: "p1", emoji, at, remove },
  }
}

function comment(sender: string, id: string, body: string, postedAt: number): ChatMessage {
  return {
    channel: MURAL_ANA,
    seq: 1,
    sender,
    payload: { t: "post.comment", id, target: "p1", body, postedAt },
  }
}

function redact(sender: string, target: string, redactedAt = 500): ChatMessage {
  return {
    channel: MURAL_ANA,
    seq: 1,
    sender,
    payload: { t: "redact", id: `x-${target}`, target, redactedAt },
  }
}

describe("engagementOf — votos", () => {
  it("conta pessoas e não mensagens", () => {
    // A counter would be a number someone has to guarantee. Here the number is
    // the result of counting who voted, and someone who votes twice is still one
    // person.
    const engagement = engagementOf(
      [reaction("@ana:s", GOSTO, 10), reaction("@ana:s", GOSTO, 20), reaction("@bru:s", GOSTO, 30)],
      "@eu:s",
    )
    expect(engagement.get("p1")).toMatchObject({ up: 2, down: 0, mine: null })
  })

  it("o voto mais recente de cada pessoa é o que conta, pelo carimbo e não pela chegada", () => {
    // Retrieving old history delivers old messages after new ones. If arrival
    // order decided, a thumbs up would change direction by itself.
    const engagement = engagementOf(
      [reaction("@ana:s", NAO_GOSTO, 200), reaction("@ana:s", GOSTO, 100)],
      "@eu:s",
    )
    expect(engagement.get("p1")).toMatchObject({ up: 0, down: 1 })
  })

  it("trocar de polegar não deixa os dois de pé", () => {
    const engagement = engagementOf([reaction("@ana:s", GOSTO, 10), reaction("@ana:s", NAO_GOSTO, 20)], "@eu:s")
    expect(engagement.get("p1")).toMatchObject({ up: 0, down: 1 })
  })

  it("retirar o voto tira a pessoa da conta", () => {
    const engagement = engagementOf(
      [reaction("@ana:s", GOSTO, 10), reaction("@ana:s", GOSTO, 20, true)],
      "@eu:s",
    )
    expect(engagement.get("p1")).toMatchObject({ up: 0, down: 0 })
  })

  it("diz qual foi o meu voto, para o polegar aparecer carregado", () => {
    const engagement = engagementOf([reaction("@eu:s", NAO_GOSTO, 10), reaction("@ana:s", GOSTO, 10)], "@eu:s")
    expect(engagement.get("p1")).toMatchObject({ up: 1, down: 1, mine: "down" })
  })

  it("um emoji que não é polegar nenhum não entra na conta", () => {
    // It comes from a future version or an altered client. Counting it as a like
    // would be inventing an intent nobody declared.
    const engagement = engagementOf([reaction("@ana:s", "🎉", 10)], "@eu:s")
    expect(engagement.get("p1")).toBeUndefined()
  })
})

/**
 * Thumbs and votes share `t` and do not share the sum.
 *
 * `post.reaction` carries both on purpose, a new `t` would reject the whole
 * union in an old client and pull the history with it, see the protocol. What
 * separates them is the `vote` field, and the separation has to work both ways:
 * a vote on an option cannot show up here as a like, and removing a vote cannot
 * erase the like the same person gave.
 */
describe("engagementOf — o que é de uma votação não é um polegar", () => {
  const votoNaOpcao = (sender: string, opcao: number, at: number, remove = false): ChatMessage => ({
    channel: MURAL_ANA,
    seq: 1,
    sender,
    payload: { t: "post.reaction", id: `v-${sender}-${at}`, target: "p1", emoji: "", at, remove, vote: opcao },
  })

  it("um voto não conta como gosto nem como não gosto", () => {
    const engagement = engagementOf([votoNaOpcao("@ana:s", 0, 10), votoNaOpcao("@bru:s", 1, 20)], "@ana:s")
    expect(engagement.get("p1")).toBeUndefined()
  })

  it("e retirar um voto não apaga o gosto que a mesma pessoa deu", () => {
    const engagement = engagementOf(
      [reaction("@ana:s", GOSTO, 10), votoNaOpcao("@ana:s", 0, 20, true)],
      "@ana:s",
    )
    expect(engagement.get("p1")).toMatchObject({ up: 1, mine: "up" })
  })
})

describe("engagementOf — comentários", () => {
  it("ficam por ordem de escrita, não de chegada", () => {
    const engagement = engagementOf(
      [comment("@ana:s", "c2", "segundo", 200), comment("@bru:s", "c1", "primeiro", 100)],
      "@eu:s",
    )
    expect(engagement.get("p1")?.comments.map((entry) => entry.body)).toEqual(["primeiro", "segundo"])
  })

  it("o mesmo comentário duas vezes é um comentário", () => {
    // The vault's history and what arrives over the network overlap: two identical
    // lines read as two people saying the same thing.
    const engagement = engagementOf([comment("@ana:s", "c1", "olá", 100), comment("@ana:s", "c1", "olá", 100)], "@eu:s")
    expect(engagement.get("p1")?.comments).toHaveLength(1)
  })

  it("quem comentou é o remetente autenticado, nunca um campo do payload", () => {
    const forjado: ChatMessage = {
      channel: MURAL_ANA,
      seq: 1,
      sender: "@bru:s",
      // An altered client can write whatever it wants inside here.
      payload: { t: "post.comment", id: "c9", target: "p1", body: "sou a ana", postedAt: 1, note: "@ana:s" },
    }
    expect(engagementOf([forjado], "@eu:s").get("p1")?.comments[0]?.sender).toBe("@bru:s")
  })

  it("votos e comentários da mesma publicação vivem na mesma entrada", () => {
    const engagement = engagementOf([reaction("@ana:s", GOSTO, 10), comment("@bru:s", "c1", "boa", 20)], "@eu:s")
    expect(engagement.get("p1")).toMatchObject({ up: 1, mine: null })
    expect(engagement.get("p1")?.comments).toHaveLength(1)
  })

  it("quem escreveu um comentário pode fazê-lo desaparecer", () => {
    const engagement = engagementOf([comment("@ana:s", "c1", "arrependi-me", 100), redact("@ana:s", "c1")], "@eu:s")
    expect(engagement.get("p1")?.comments).toHaveLength(0)
  })

  it("só o autor o apaga — nem o dono do feed, nem quem passa por lá", () => {
    // The same rule that already applies to posts in `feedOf`: the author is the
    // sender authenticated by MLS. Any feed member can *send* a redact; none can
    // erase another person's words.
    const engagement = engagementOf(
      [comment("@ana:s", "c1", "fica", 100), redact("@bru:s", "c1"), redact("@ana2:s", "c1")],
      "@eu:s",
    )
    expect(engagement.get("p1")?.comments.map((entry) => entry.body)).toEqual(["fica"])
  })

  it("o apagar chega antes do comentário e vale na mesma", () => {
    // Retrieving history delivers messages out of order, and a comment that came
    // back because the redact arrived first was worse than not deleting it: the
    // user saw it disappear and it comes back on its own.
    const engagement = engagementOf([redact("@ana:s", "c1"), comment("@ana:s", "c1", "apagado", 100)], "@eu:s")
    expect(engagement.get("p1")?.comments).toHaveLength(0)
  })

  it("um redact sobre a publicação não leva os comentários dela", () => {
    // `p1` is the post; deleting it is a matter for `feedOf` and not here. What
    // cannot happen is a post redact clearing comments nobody told to delete, the
    // ids live in the same space.
    const engagement = engagementOf([comment("@ana:s", "c1", "fica", 100), redact("@ana:s", "p1")], "@eu:s")
    expect(engagement.get("p1")?.comments).toHaveLength(1)
  })

  it("mensagens que não são reacções nem comentários não contam para nada", () => {
    const edit: ChatMessage = {
      channel: MURAL_ANA,
      seq: 1,
      sender: "@ana:s",
      payload: { t: "edit", id: "e1", target: "p1", body: "outra legenda", editedAt: 5 },
    }
    expect(engagementOf([edit], "@eu:s").size).toBe(0)
  })
})
