import { describe, expect, it } from "vitest"
import type { ChannelRoom } from "../../bridge.js"
import {
  categoriaVisivel,
  modoDeVisibilidade,
  mudarCategoria,
  osQueFicaramParaTras,
  PAPEL_ADMINISTRACAO,
  papeisDoModo,
} from "./categorias.js"

function sala(over: Partial<ChannelRoom> & { room: string }): ChannelRoom {
  return { name: over.room, category: "", kind: "text", position: 0, ...over }
}

/** A tree with two categories and one channel outside them. */
const ARVORE: ChannelRoom[] = [
  sala({ room: "solto", name: "geral" }),
  sala({ room: "a1", name: "actas", category: "Direcção" }),
  sala({ room: "a2", name: "coordenação", category: "Direcção", position: 100 }),
  sala({ room: "b1", name: "obras", category: "Operações" }),
]

describe("mudar o nome a uma categoria", () => {
  it("reescreve o nome em TODOS os canais que a declaram", () => {
    // One publication per channel, not one per category. The category exists nowhere except in each channel's field.
    const { publicacoes } = mudarCategoria(ARVORE, "Direcção", "Mesa")
    expect(publicacoes.map((sala) => sala.room)).toEqual(["a1", "a2"])
    expect(publicacoes.every((sala) => sala.category === "Mesa")).toBe(true)
  })

  it("não toca nos canais de outras categorias nem nos que estão soltos", () => {
    const { publicacoes } = mudarCategoria(ARVORE, "Direcção", "Mesa")
    expect(publicacoes.some((sala) => sala.room === "b1" || sala.room === "solto")).toBe(false)
  })

  it("guarda tudo o resto do canal: só o campo da categoria muda", () => {
    // Republishing a channel means rewriting the entire `channel.meta`. Losing the type or position here would turn a voice channel into a text channel when changing its category.
    const voz = sala({ room: "v1", name: "pátio", category: "Direcção", kind: "voice", position: 300 })
    const { publicacoes } = mudarCategoria([voz], "Direcção", "Mesa")
    expect(publicacoes[0]).toEqual({ ...voz, category: "Mesa" })
  })

  it("uma categoria que ninguém declara não manda publicar nada", () => {
    expect(mudarCategoria(ARVORE, "Não existe", "Mesa").publicacoes).toEqual([])
  })

  it("mudar para o mesmo nome não é mudar", () => {
    // Without this, confirming a name that was already there would be an encrypted message per channel saying exactly what was already said.
    expect(mudarCategoria(ARVORE, "Direcção", "Direcção").publicacoes).toEqual([])
  })

  it("os espaços à volta do nome não contam", () => {
    expect(mudarCategoria(ARVORE, "Direcção", "  Mesa  ").publicacoes[0]?.category).toBe("Mesa")
    expect(mudarCategoria(ARVORE, "Direcção", "  Direcção  ").publicacoes).toEqual([])
  })
})

describe("mudar para um nome que já existe", () => {
  it("funde as duas, e diz que funde antes de acontecer", () => {
    // Two identical labels are the same label: the model working as intended, not a bug. So we don't reject it, we warn.
    const { publicacoes, funde } = mudarCategoria(ARVORE, "Direcção", "Operações")
    expect(funde).toBe(true)
    expect(publicacoes.map((sala) => sala.room)).toEqual(["a1", "a2"])
    expect(publicacoes.every((sala) => sala.category === "Operações")).toBe(true)
  })

  it("e o canal que já lá estava não é republicado", () => {
    // It already has the correct name written. Merging is not rewriting the target category; it's writing its name into the incoming ones.
    const { publicacoes } = mudarCategoria(ARVORE, "Direcção", "Operações")
    expect(publicacoes.some((sala) => sala.room === "b1")).toBe(false)
  })

  it("um nome novo não funde com ninguém", () => {
    expect(mudarCategoria(ARVORE, "Direcção", "Mesa").funde).toBe(false)
  })
})

describe("apagar uma categoria", () => {
  it("solta os canais, e não apaga nenhum", () => {
    // The costly mistake in this gesture: the category is the label, the channels are the content. As many come out as go in.
    const { publicacoes } = mudarCategoria(ARVORE, "Direcção", "")
    expect(publicacoes).toHaveLength(2)
    expect(publicacoes.map((sala) => sala.name)).toEqual(["actas", "coordenação"])
    expect(publicacoes.every((sala) => sala.category === "")).toBe(true)
  })

  it("soltar não funde com os que já estavam soltos", () => {
    // "No category" is not a category to collide with, and warning of a merge here would alarm without reason.
    expect(mudarCategoria(ARVORE, "Direcção", "").funde).toBe(false)
  })
})

/**
 * The middle ground.
 *
 * There is no transaction to invent: each `channel.meta` is an independent encrypted message, and a channel that doesn't receive its update keeps the old name. The choice is not between splitting and not splitting, it's between splitting silently and splitting with warning.
 */
describe("os canais que ficaram para trás", () => {
  const publicacoes = [sala({ room: "a1", name: "actas" }), sala({ room: "a2", name: "coordenação" })]

  it("correndo tudo bem, não há nada a dizer", () => {
    const resultados: PromiseSettledResult<unknown>[] = [
      { status: "fulfilled", value: { ok: true } },
      { status: "fulfilled", value: { ok: true } },
    ]
    expect(osQueFicaramParaTras(publicacoes, resultados)).toEqual([])
  })

  it("falhando algumas, nomeia exactamente essas", () => {
    // By name, not by ID: the name is what appears on screen, and that's what the person repeats.
    const resultados: PromiseSettledResult<unknown>[] = [
      { status: "fulfilled", value: { ok: true } },
      { status: "rejected", reason: new Error("offline") },
    ]
    expect(osQueFicaramParaTras(publicacoes, resultados)).toEqual(["coordenação"])
  })

  it("falhando todas, nomeia todas — nunca cala", () => {
    const resultados: PromiseSettledResult<unknown>[] = [
      { status: "rejected", reason: new Error("offline") },
      { status: "rejected", reason: new Error("offline") },
    ]
    expect(osQueFicaramParaTras(publicacoes, resultados)).toEqual(["actas", "coordenação"])
  })
})

/**
 * Who sees the rooms in a category.
 *
 * The decision is small and the consequences of getting it wrong are not: one way hides the sidebar from everyone, the other hides a category from whoever hid it and leaves no way to bring it back. Each case below is one of those.
 *
 * None of these tests prove any protection, and they can't: anyone in the channel has the keys to all its public rooms. What matters here is what the LIST shows, nothing else.
 */
describe("visibilidade de uma categoria", () => {
  const ninguem = { papeis: [], administra: false }

  it("sem restrição, vê-se — e é o caso de quase todas", () => {
    expect(categoriaVisivel([], ninguem)).toBe(true)
  })

  it("uma categoria publicada por um cliente antigo não traz o campo, e vê-se", () => {
    // The case that hid the sidebar from all existing channels: the declarations stored in today's vaults have no roles, and reading the absence as "nobody sees" hid them from everyone at once.
    expect(categoriaVisivel(undefined, ninguem)).toBe(true)
  })

  it("com restrição, quem tem o papel vê", () => {
    expect(categoriaVisivel(["direccao"], { papeis: ["direccao"], administra: false })).toBe(true)
  })

  it('com restrição, quem tem UM dos papéis vê — a lista é "ou", não "e"', () => {
    // Requiring all roles was a rule nobody writes on purpose: two roles in the list were enough to make the category invisible to everyone except whoever had both.
    expect(categoriaVisivel(["direccao", "socios"], { papeis: ["socios"], administra: false })).toBe(true)
  })

  it("com restrição, quem não tem papel nenhum não vê", () => {
    expect(categoriaVisivel(["direccao"], ninguem)).toBe(false)
  })

  it("com restrição, quem tem OUTRO papel não vê", () => {
    expect(categoriaVisivel(["direccao"], { papeis: ["convidado"], administra: false })).toBe(false)
  })

  it("quem administra vê sempre, mesmo sem o papel exigido", () => {
    // Without this, restricting a category to a role you don't have hides it from yourself, and the only way to undo the gesture is the category that just disappeared. Tidying cannot be irreversible.
    expect(categoriaVisivel(["direccao"], { papeis: [], administra: true })).toBe(true)
  })
})

/**
 * The three choices, and how they translate to the only thing that travels over the wire.
 *
 * `channel.category` carries a list of roles and nothing else. "Everyone", "admins only", and "these roles" are three WAYS TO READ that list, and the conversion must close both ways here, otherwise the UI shows one choice and the wire carries another.
 */
describe("as três escolhas de quem vê uma categoria", () => {
  it('a lista vazia é "todos", e continua a ser', () => {
    // The invariant the entire sidebar reads. It became a named choice; it didn't become something else.
    expect(modoDeVisibilidade([])).toBe("todos")
    expect(papeisDoModo("todos", ["socios"])).toEqual([])
  })

  it('o campo ausente também é "todos" — é o que está nos cofres de hoje', () => {
    expect(modoDeVisibilidade(undefined)).toBe("todos")
  })

  it('só o papel embutido é "só quem administra"', () => {
    expect(modoDeVisibilidade([PAPEL_ADMINISTRACAO])).toBe("administracao")
    expect(papeisDoModo("administracao", [])).toEqual([PAPEL_ADMINISTRACAO])
  })

  it("o embutido ao lado de outro papel é uma lista de papéis, não a administração", () => {
    // Two different things: "admins only" is the maximum restriction, and "admins OR partners" is wider than it. Reading them as the same tightened the category without anyone asking.
    expect(modoDeVisibilidade([PAPEL_ADMINISTRACAO, "socios"])).toBe("papeis")
  })

  it('qualquer outra lista é "papéis específicos", e vai tal e qual', () => {
    expect(modoDeVisibilidade(["socios"])).toBe("papeis")
    expect(papeisDoModo("papeis", ["direccao", "socios"])).toEqual(["direccao", "socios"])
  })

  it("a ida e a volta fecham para as três", () => {
    for (const publicado of [[], [PAPEL_ADMINISTRACAO], ["direccao", "socios"]]) {
      expect(papeisDoModo(modoDeVisibilidade(publicado), publicado)).toEqual(publicado)
    }
  })
})

/**
 * What "admins only" means on arrival, which is the question that matters.
 *
 * The marker is not a magic value that other clients need to learn: it's the built-in role ID passing through the usual path. These cases prove it against `categoriaVisivel`, which decides, not against the UI.
 */
describe('"só quem administra", visto de quem lê a lista', () => {
  it("quem administra vê, mesmo sem papel nenhum", () => {
    expect(categoriaVisivel([PAPEL_ADMINISTRACAO], { papeis: [], administra: true })).toBe(true)
  })

  it("quem tem o papel embutido vê — é o que `rolesFor` devolve a um administrador", () => {
    expect(categoriaVisivel([PAPEL_ADMINISTRACAO], { papeis: [PAPEL_ADMINISTRACAO], administra: false })).toBe(true)
  })

  it("quem não administra não vê, tenha os papéis que tiver", () => {
    // The maximum restriction: not even the highest role in the channel reaches it, because what it asks for is not a role, it's being an admin.
    expect(categoriaVisivel([PAPEL_ADMINISTRACAO], { papeis: ["direccao", "socios"], administra: false })).toBe(false)
  })
})
