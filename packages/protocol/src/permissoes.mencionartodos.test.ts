import { describe, expect, it } from "vitest"
import { z } from "zod"
import { decodePayload, encodePayload, Payload, POWERS, type Power, type Sobreposicao } from "./payload.js"
import {
  CARGO_ADMIN,
  CARGO_TODOS,
  type CargoDefinido,
  type EstadoDePermissoes,
  MENCAO_TODOS,
  mencoesConferidas,
  permissoesEm,
  PODERES_CUMPRIDOS,
  PODERES_DE_TODOS_POR_OMISSAO,
  PODERES_POR_SALA,
  PODERES_POR_SALA_CUMPRIDOS,
} from "./permissoes.js"

/**
 * `@all` (item #10 of the parity plan): the `mentionall` permission, the rule
 * that grants the mention to everyone, and what a 1.1.0 reads.
 */

const ANA = "@ana:t" // fundadora
const BRUNO = "@bruno:t" // admin
const CARLA = "@carla:t" // no role
const DARIO = "@dario:t" // announcements (with mentionall)

function estado(opcoes: { todos?: Power[]; salas?: Record<string, Sobreposicao[]>; cargos?: Record<string, CargoDefinido> } = {}): EstadoDePermissoes {
  const de: Record<string, string[]> = { [BRUNO]: [CARGO_ADMIN], [DARIO]: ["anuncios"] }
  const cargos: Record<string, CargoDefinido> = opcoes.cargos ?? { anuncios: { powers: ["mencionartodos"], rank: 1 } }
  return {
    fundador: ANA,
    cargosDe: (address) => de[address] ?? [],
    cargo: (role) => cargos[role],
    todos: opcoes.todos ?? PODERES_DE_TODOS_POR_OMISSAO,
    categoriaDaSala: () => "",
    sobreposicoesDaSala: (room) => opcoes.salas?.[room],
  }
}

const pode = (e: EstadoDePermissoes, quem: string, sala?: string): boolean =>
  permissoesEm(e, quem, sala === undefined ? {} : { sala }).includes("mencionartodos")

describe("a permissão mencionartodos", () => {
  it("é cumprida nesta versão, no canal e por sala, sem gastar um lugar de POWERS", () => {
    expect(POWERS).toHaveLength(30)
    expect(PODERES_CUMPRIDOS).toContain("mencionartodos")
    expect(PODERES_POR_SALA).toContain("mencionartodos")
    expect(PODERES_POR_SALA_CUMPRIDOS).toContain("mencionartodos")
  })

  it("a fundadora e o admin têm-na; toda a gente não, por omissão; um cargo dá-a", () => {
    const e = estado()
    expect(PODERES_DE_TODOS_POR_OMISSAO).not.toContain("mencionartodos")
    expect(pode(e, ANA)).toBe(true)
    expect(pode(e, BRUNO)).toBe(true)
    expect(pode(e, CARLA)).toBe(false)
    expect(pode(e, DARIO)).toBe(true)
    // "Everyone" with it: Carla can now.
    expect(pode(estado({ todos: [...PODERES_DE_TODOS_POR_OMISSAO, "mencionartodos"] }), CARLA)).toBe(true)
  })

  it("a sobreposição por sala tira-a a um cargo, ou dá-a a toda a gente, só nessa sala", () => {
    const e = estado({
      salas: {
        recados: [{ role: "anuncios", allow: [], deny: ["mencionartodos"] }],
        avisos: [{ role: CARGO_TODOS, allow: ["mencionartodos"], deny: [] }],
      },
    })
    expect(pode(e, DARIO, "")).toBe(true)
    expect(pode(e, DARIO, "recados")).toBe(false)
    expect(pode(e, CARLA, "recados")).toBe(false)
    expect(pode(e, CARLA, "avisos")).toBe(true)
    expect(pode(e, CARLA, "")).toBe(false)
    // The admin and founder lose nothing in a room.
    expect(pode(e, BRUNO, "recados")).toBe(true)
    expect(pode(e, ANA, "recados")).toBe(true)
  })
})

describe("mencoesConferidas: a menção de toda a gente só de quem tem a permissão", () => {
  it("o autor sem a permissão: MENCAO_TODOS sai, os endereços ficam", () => {
    expect(mencoesConferidas([MENCAO_TODOS, "@ana:t"], false)).toEqual(["@ana:t"])
    expect(mencoesConferidas([MENCAO_TODOS], false)).toEqual([])
  })

  it("o autor com a permissão, ou sem MENCAO_TODOS: a mesma lista, sem cópia", () => {
    const com = [MENCAO_TODOS, "@ana:t"]
    expect(mencoesConferidas(com, true)).toBe(com)
    const sem = ["@ana:t"]
    expect(mencoesConferidas(sem, false)).toBe(sem)
  })

  it("MENCAO_TODOS nunca é um endereço: um endereço começa por @", () => {
    expect(MENCAO_TODOS.startsWith("@")).toBe(false)
  })
})

describe("uma 1.1.0 a ler uma mensagem com @all", () => {
  /** The "message" branch of the schema. This branch did not change in this slice: it is from 1.1.0, and `mentions` is a list of texts. */
  const ramo = Payload.options.find((opcao) => (opcao.shape as { t: z.ZodLiteral<string> }).t.value === "message") as unknown as z.ZodObject

  const mensagem = {
    t: "message",
    body: "@all reunião às 9",
    sentAt: 1_762_000_000_000,
    id: "mensagem-1",
    attachments: [],
    links: [],
    mentions: [MENCAO_TODOS, "@ana:t"],
  }

  it("lê-a sem reprovar, e o corpo diz @all por extenso", () => {
    const lido = decodePayload(encodePayload(mensagem as never)) as { body: string; mentions: string[] }
    expect(lido.body).toBe("@all reunião às 9")
    expect(lido.mentions).toEqual([MENCAO_TODOS, "@ana:t"])
    expect(ramo.safeParse(mensagem).success).toBe(true)
  })

  it("e não a conta como menção para quem não está nomeado: a regra dela é o endereço", () => {
    // `mencionaMe` from 1.1.0, verbatim: `mentions.includes(me)`.
    const mencionaMeDa110 = (mentions: readonly string[], me: string): boolean => mentions.includes(me)
    expect(mencionaMeDa110(mensagem.mentions, CARLA)).toBe(false)
    expect(mencionaMeDa110(mensagem.mentions, "@ana:t")).toBe(true)
  })
})
