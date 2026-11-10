import { describe, expect, it } from "vitest"
import {
  chaveDoEvento,
  dobrarConversa,
  dobrarEnvolvimento,
  dobrarMural,
  dobrarVotos,
  GOSTO,
  NAO_GOSTO,
  porOrdemDoServidor,
  venceCarimbo,
  type EntradaDeDobra,
} from "./dobras.js"
import { moradaDeTeste } from "../testes/moradas.js"

const ANA = "@ana:x"
const BRUNO = "@bruno:x"
const FEED_ANA = moradaDeTeste("mural ana", "x")

type E = EntradaDeDobra & { payload: { t: string } & Record<string, unknown> }

const e = (seq: number, sender: string, payload: { t: string } & Record<string, unknown>, extra: Partial<E> = {}): E => ({
  seq,
  sender,
  channel: FEED_ANA,
  payload,
  ...extra,
})

const dono = (canal: string): string | null => (canal === FEED_ANA ? ANA : null)

/** Shuffle with a fixed seed, to make the test repeatable. */
function baralhar<T>(lista: readonly T[], semente: number): T[] {
  const copia = [...lista]
  let s = semente
  for (let i = copia.length - 1; i > 0; i--) {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648
    const j = s % (i + 1)
    ;[copia[i], copia[j]] = [copia[j] as T, copia[i] as T]
  }
  return copia
}

describe("porOrdemDoServidor", () => {
  it("ordena pelo seq, e um envio nosso sem eco fica depois do seq que se via quando saiu", () => {
    const lista = [e(5, BRUNO, { t: "message", id: "b" }), e(-1, ANA, { t: "message", id: "a" }, { apos: 2 }), e(2, BRUNO, { t: "message", id: "c" })]
    expect(porOrdemDoServidor(lista).map((x) => x.payload["id"])).toEqual(["c", "a", "b"])
  })

  it("sem a marca `apos`, o envio nosso fica depois do maior seq antes dele na lista", () => {
    const lista = [e(3, BRUNO, { t: "message", id: "x" }), e(-1, ANA, { t: "message", id: "a" }), e(1, BRUNO, { t: "message", id: "y" })]
    expect(porOrdemDoServidor(lista).map((x) => x.payload["id"])).toEqual(["y", "x", "a"])
  })

  it("com a mesma chave, o evento com seq real vem antes do envio nosso", () => {
    const lista = [e(-1, ANA, { t: "message", id: "a" }, { apos: 4 }), e(4, BRUNO, { t: "message", id: "b" })]
    expect(porOrdemDoServidor(lista).map((x) => x.payload["id"])).toEqual(["b", "a"])
  })
})

describe("dobrarConversa", () => {
  it("a última edição pela ordem do servidor vence, mesmo com um editedAt menor", () => {
    const lista = [
      e(1, ANA, { t: "message", id: "m", body: "um" }),
      e(3, ANA, { t: "edit", id: "e2", target: "m", body: "três", editedAt: 10 }),
      e(2, ANA, { t: "edit", id: "e1", target: "m", body: "dois", editedAt: 50 }),
    ]
    expect(dobrarConversa(lista)[0]?.payload["body"]).toBe("três")
  })

  it("uma edição de outra pessoa não conta; uma lápide do autor é absorvente", () => {
    const lista = [
      e(1, ANA, { t: "message", id: "m", body: "um" }),
      e(2, BRUNO, { t: "edit", id: "e", target: "m", body: "falso", editedAt: 9 }),
    ]
    expect(dobrarConversa(lista)[0]?.payload["body"]).toBe("um")
    const apagada = [...lista, e(3, ANA, { t: "redact", id: "r", target: "m" }), e(4, ANA, { t: "edit", id: "e3", target: "m", body: "volta?" })]
    expect(dobrarConversa(apagada)).toEqual([])
  })
})

/**
 * The tombstone of who moderates (phase 3): another person's message stays on the line,
 * without content, marked `moderada`. Without the power, the tombstone does not count.
 */
describe("dobrarConversa com moderação", () => {
  const modera = (quem: string): boolean => quem === BRUNO
  const conversa = [
    e(1, ANA, { t: "message", id: "m", body: "um insulto", attachments: [{ name: "x" }], mentions: [BRUNO] }),
    e(2, BRUNO, { t: "redact", id: "r", target: "m", redactedAt: 2 }),
  ]

  it("quem tem moderar esconde o conteúdo e deixa a linha", () => {
    const [linha] = dobrarConversa(conversa, { modera })
    expect(linha?.payload).toMatchObject({ id: "m", body: "", attachments: [], mentions: [], moderada: true })
  })

  it("sem o poder, a lápide de outra pessoa não conta (como antes da fase 3)", () => {
    expect(dobrarConversa(conversa)[0]?.payload["body"]).toBe("um insulto")
    expect(dobrarConversa(conversa, { modera: () => false })[0]?.payload["body"]).toBe("um insulto")
  })

  it("é absorvente: uma edição do autor depois não traz o texto de volta", () => {
    const depois = [...conversa, e(3, ANA, { t: "edit", id: "e", target: "m", body: "voltei", editedAt: 3 })]
    expect(dobrarConversa(depois, { modera })[0]?.payload).toMatchObject({ body: "", moderada: true })
  })

  it("a lápide do próprio autor continua a tirar a linha inteira", () => {
    const doAutor = [...conversa, e(3, ANA, { t: "redact", id: "r2", target: "m", redactedAt: 3 })]
    expect(dobrarConversa(doAutor, { modera })).toEqual([])
  })

  it("a ordem de chegada não muda o resultado", () => {
    for (let semente = 1; semente < 6; semente++) {
      expect(dobrarConversa(baralhar(conversa, semente), { modera })[0]?.payload["moderada"]).toBe(true)
    }
  })
})

describe("dobrarMural", () => {
  it("só as publicações do dono do feed, uma por id, mais recentes primeiro, com a edição", () => {
    const lista = [
      e(1, ANA, { t: "post", id: "p1", postedAt: 1, caption: "a" }),
      e(2, ANA, { t: "post", id: "p2", postedAt: 2, caption: "b" }),
      e(3, ANA, { t: "post", id: "p1", postedAt: 1, caption: "a" }),
      e(4, BRUNO, { t: "post", id: "p3", postedAt: 3, caption: "intruso" }),
      e(5, ANA, { t: "edit", id: "e", target: "p1", body: "novo #tag", editedAt: 7 }),
    ]
    const mural = dobrarMural(lista, dono)
    expect(mural.map((p) => p.payload["id"])).toEqual(["p2", "p1"])
    expect(mural[1]?.payload["caption"]).toBe("novo #tag")
    expect(mural[1]?.payload["tags"]).toEqual(["tag"])
  })
})

describe("dobrarEnvolvimento e dobrarVotos", () => {
  it("um voto por pessoa: vence o carimbo, e o seq desempata carimbos iguais", () => {
    const lista = [
      e(1, BRUNO, { t: "post.reaction", id: "r1", target: "p", emoji: GOSTO, at: 5 }),
      e(3, BRUNO, { t: "post.reaction", id: "r3", target: "p", emoji: GOSTO, at: 4 }),
      e(2, BRUNO, { t: "post.reaction", id: "r2", target: "p", emoji: NAO_GOSTO, at: 5 }),
    ]
    // Timestamp 5 beats 4; between the two with timestamp 5, seq 2 comes after seq 1.
    const estado = dobrarEnvolvimento(lista, BRUNO).get("p")
    expect(estado).toMatchObject({ up: 0, down: 1, mine: "down" })
  })

  it("um comentário conta uma vez por autor e id, e a lápide do autor vale mesmo antes dele", () => {
    const lista = [
      e(1, BRUNO, { t: "redact", id: "x", target: "c2" }),
      e(2, BRUNO, { t: "post.comment", id: "c1", target: "p", body: "um", postedAt: 1 }),
      e(3, BRUNO, { t: "post.comment", id: "c1", target: "p", body: "um", postedAt: 1 }),
      e(4, ANA, { t: "post.comment", id: "c1", target: "p", body: "outro", postedAt: 2 }),
      e(5, BRUNO, { t: "post.comment", id: "c2", target: "p", body: "apagado", postedAt: 3 }),
    ]
    expect(dobrarEnvolvimento(lista, null).get("p")?.comments.map((c) => `${c.sender}:${c.body}`)).toEqual([
      `${BRUNO}:um`,
      `${ANA}:outro`,
    ])
  })

  it("os votos de votação são outra conta, e retirar deixa a pessoa sem opção", () => {
    const lista = [
      e(1, BRUNO, { t: "post.reaction", id: "v1", target: "p", emoji: "", vote: 2, at: 1 }),
      e(2, ANA, { t: "post.reaction", id: "v2", target: "p", emoji: "", vote: 0, at: 1 }),
      e(3, ANA, { t: "post.reaction", id: "v3", target: "p", emoji: "", vote: 0, at: 2, remove: true }),
    ]
    expect([...(dobrarVotos(lista).get("p") ?? new Map())]).toEqual([[BRUNO, 2]])
    expect(dobrarEnvolvimento(lista, null).get("p")).toBeUndefined()
  })
})

describe("propriedade: baralhar a entrada não muda a dobra", () => {
  const lista: E[] = [
    e(1, ANA, { t: "post", id: "p1", postedAt: 1, caption: "a" }),
    e(2, ANA, { t: "post", id: "p2", postedAt: 2, caption: "b" }),
    e(3, BRUNO, { t: "post.comment", id: "c1", target: "p1", body: "x", postedAt: 3 }),
    e(4, BRUNO, { t: "post.reaction", id: "r1", target: "p1", emoji: GOSTO, at: 4 }),
    e(5, BRUNO, { t: "post.reaction", id: "r2", target: "p1", emoji: NAO_GOSTO, at: 4 }),
    e(6, ANA, { t: "edit", id: "e1", target: "p2", body: "b1", editedAt: 9 }),
    e(7, ANA, { t: "edit", id: "e2", target: "p2", body: "b2", editedAt: 1 }),
    e(8, BRUNO, { t: "redact", id: "x", target: "c1" }),
    e(9, ANA, { t: "message", id: "m1", body: "olá" }),
    e(10, ANA, { t: "edit", id: "e3", target: "m1", body: "olá!" }),
    e(11, BRUNO, { t: "post.reaction", id: "v1", target: "p2", emoji: "", vote: 1, at: 2 }),
    e(12, BRUNO, { t: "post.reaction", id: "v2", target: "p2", emoji: "", vote: 0, at: 2 }),
  ]
  const instantaneo = (entradas: readonly E[]): string =>
    JSON.stringify({
      mural: dobrarMural(entradas, dono).map((p) => p.payload),
      envolvimento: [...dobrarEnvolvimento(entradas, ANA)],
      votos: [...dobrarVotos(entradas)].map(([alvo, m]) => [alvo, [...m]]),
      conversa: dobrarConversa(entradas).map((m) => m.payload),
    })
  const esperado = instantaneo(lista)

  it("25 baralhadas dão o mesmo estado", () => {
    for (let semente = 1; semente <= 25; semente++) expect(instantaneo(baralhar(lista, semente))).toBe(esperado)
  })
})

describe("venceCarimbo e chaveDoEvento", () => {
  it("vence o carimbo maior; num empate, o seq maior; o seq desconhecido perde", () => {
    expect(venceCarimbo(undefined, { at: 1 })).toBe(true)
    expect(venceCarimbo({ at: 5, seq: 9 }, { at: 4, seq: 99 })).toBe(false)
    expect(venceCarimbo({ at: 5, seq: 9 }, { at: 5, seq: 3 })).toBe(false)
    expect(venceCarimbo({ at: 5, seq: 3 }, { at: 5, seq: 9 })).toBe(true)
    expect(venceCarimbo({ at: 5, seq: 3 }, { at: 5, seq: -1 })).toBe(false)
    expect(venceCarimbo({ at: 5, seq: -1 }, { at: 5, seq: 3 })).toBe(true)
    expect(venceCarimbo({ at: 5 }, { at: 5 })).toBe(true)
  })

  it("a chave leva o tipo, o autor e o id; sem id não há chave", () => {
    expect(chaveDoEvento({ sender: ANA, payload: { t: "post", id: "p" } as never })).toBe(`post|${ANA}|p`)
    expect(chaveDoEvento({ sender: ANA, payload: { t: "profile" } })).toBeNull()
  })
})
